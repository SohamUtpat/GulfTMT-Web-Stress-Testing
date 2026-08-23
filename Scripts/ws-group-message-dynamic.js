import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend, Rate } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { createSendErrorTracker } from './lib/ws-send-error.js';
import { parseK6DurationMs, rampingScenarioDurationMs } from './lib/k6-scenario.js';
import {
    firstSendDelayMs,
    parseSendOrder,
    parseSendStaggerMs,
    sequentialAlignAfterMs,
    sequentialTailMs,
} from './lib/send-order.js';
import { correlateOwnEcho, formatUidRewriteLog } from './lib/echo-correlation.js';
import { assertVuUsersAreGroupMembers } from './lib/group-membership.js';

/**
 * STOMP over WebSocket — dynamic group chat load test.
 *
 * One script for any user count (up to tokens in users_result.json).
 * Pass VUS / HOLD / MODE at run time — no need to edit stages.
 *
 * Echo correlation (same rules at every load size): SIMPLE / root usually
 * keeps the client uniqueMessageId. If the echo's uniqueMessageId differs
 * or is omitted, match senderId + content and still count the WS echo.
 * Store the server uniqueMessageId / Mongo id from that payload when present.
 *
 * Point 7: setup() fails fast unless every VU user is a member of groupId
 * (override with -e CHECK_GROUP_MEMBERSHIP=false).
 *
 * Destinations (from chat-service / mobile):
 *   SEND:      /app/chat/groupMessage
 *   SUBSCRIBE: /user/queue/reply
 *              /user/{groupId}/queue/reply   (group fan-out channel)
 *
 * Auth (API gateway): query param ?at=Bearer <jwt>
 *
 * Prerequisites:
 *   - data/users_result.json  (users with sender_token; supports ~30k)
 *   - data/group-chat.json
 *   - Test users should be members of the group for realistic receive fan-out
 *
 * Run (from project root):
 *   k6 run -e VUS=500  -e HOLD=4m  -e MODE=continuous Scripts/ws-group-message-dynamic.js
 *   k6 run -e VUS=1000 -e HOLD=10m -e MODE=once       Scripts/ws-group-message-dynamic.js
 *   k6 run -e VUS=5000 -e HOLD=15m -e MODE=continuous Scripts/ws-group-message-dynamic.js
 *
 * Env knobs:
 *   VUS              Peak concurrent users (default 500). Must be <= token count.
 *   HOLD             Time spent at peak VUs (default 4m).
 *   MODE             continuous | once (default continuous).
 *   MSG_INTERVAL_MS  Send interval for continuous mode (default 3000).
 *   SEND_ORDER       parallel | sequential (default parallel / burst).
 *                    parallel   — every VU sends as soon as it is connected.
 *                    sequential — VU 1 posts, then VU 2, then VU 3.
 *   SEND_STAGGER_MS  Gap between sequential first sends (default 300).
 *   VU_HOLD_MS       How long each VU keeps the WS open per iteration
 *                    (default: 55000 continuous, 240000 once; sequential
 *                    adds ramp-up + last-VU stagger so the last user can send).
 *                    Not auto-capped to scenario length; if it is longer, k6
 *                    teardown Session closed / 1002 is excluded from
 *                    ws_send_error_rate and a startup warning is logged.
 *   RAMP_STYLE       scaled | simple (default scaled).
 *                    scaled  = same shape as 500-user scripts (20%→40%→80%→100%).
 *                    simple  = single ramp-up → hold → ramp-down.
 *   RAMP_UP          Used when RAMP_STYLE=simple (default 5m).
 *   RAMP_DOWN        Used when RAMP_STYLE=simple (default 3m).
 *   STOMP_CONNECT_RATE_MIN  Min STOMP CONNECTED / connect attempts (default 0.95).
 *   ECHO_RATE_MIN           Min own-echoes / messages whose echo was resolved
 *                           (received, or pending >10s at disconnect) (default 0.90).
 *   SEND_ERROR_RATE_MAX     Max real send/STOMP errors / (successful chat
 *                           sends + those errors) (default 0.05). Teardown
 *                           Session closed / WS 1002 do not count.
 *   MSG_RTT_P95_MS          Optional p95 send→echo SLO (ms). Unset/0 = disabled.
 */

const users = new SharedArray('users', function () {
    const raw = JSON.parse(open('../data/users_result.json'));
    const keys = Object.keys(raw).sort((a, b) => Number(a) - Number(b));
    const list = [];
    for (let i = 0; i < keys.length; i++) {
        const u = raw[keys[i]];
        if (u && u.sender_token) {
            list.push({
                userId: u.sender_id,
                userName: u.user_code,
                senderName: u.sender_name,
                token: u.sender_token,
            });
        }
    }
    return list;
});

const groupChat = JSON.parse(open('../data/group-chat.json'));

const VUS = Number(__ENV.VUS || 500);
const HOLD = __ENV.HOLD || '4m';
const MODE = String(__ENV.MODE || 'continuous').toLowerCase();
const SEND_ORDER = parseSendOrder(__ENV.SEND_ORDER);
const SEND_STAGGER_MS = parseSendStaggerMs(__ENV.SEND_STAGGER_MS, 300);
const sequentialDefaultRamp = SEND_ORDER === 'sequential' && !__ENV.RAMP_STYLE;
const RAMP_STYLE = String(
    __ENV.RAMP_STYLE || (SEND_ORDER === 'sequential' ? 'simple' : 'scaled')
).toLowerCase();
const RAMP_UP = __ENV.RAMP_UP || (sequentialDefaultRamp ? '10s' : '5m');
const RAMP_DOWN = __ENV.RAMP_DOWN || (sequentialDefaultRamp ? '15s' : '3m');
const MSG_INTERVAL_MS = Number(__ENV.MSG_INTERVAL_MS || 3000);
const ALIGN_AFTER_MS = sequentialAlignAfterMs(RAMP_STYLE, RAMP_UP);
const SEQUENTIAL_TAIL_MS = sequentialTailMs(SEND_ORDER, VUS, SEND_STAGGER_MS);
const VU_HOLD_MS = Number(
    __ENV.VU_HOLD_MS ||
        (MODE === 'once' ? 240000 : 55000) +
            (SEND_ORDER === 'sequential' ? ALIGN_AFTER_MS + SEQUENTIAL_TAIL_MS : 0)
);
const GRACEFUL_RAMP_DOWN = MODE === 'once' ? '60s' : '30s';
const SCENARIO_DURATION_MS = rampingScenarioDurationMs({
    rampStyle: RAMP_STYLE,
    hold: HOLD,
    rampUp: RAMP_UP,
    rampDown: RAMP_DOWN,
    gracefulRampDown: GRACEFUL_RAMP_DOWN,
});

/** Accept 0–1 or percent (e.g. 95 → 0.95). */
function parseUnitRate(envVal, fallback) {
    const n = Number(envVal);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    if (n > 1) {
        return Math.min(1, n / 100);
    }
    if (n < 0) {
        return fallback;
    }
    return n;
}

const STOMP_CONNECT_RATE_MIN = parseUnitRate(__ENV.STOMP_CONNECT_RATE_MIN, 0.95);
const ECHO_RATE_MIN = parseUnitRate(__ENV.ECHO_RATE_MIN, 0.9);
const SEND_ERROR_RATE_MAX = parseUnitRate(__ENV.SEND_ERROR_RATE_MAX, 0.05);
const MSG_RTT_P95_MS = Number(__ENV.MSG_RTT_P95_MS || 0);

if (!Number.isFinite(VUS) || VUS < 1) {
    throw new Error(`Invalid VUS=${__ENV.VUS}. Use a positive number (e.g. -e VUS=1000).`);
}
if (MODE !== 'continuous' && MODE !== 'once') {
    throw new Error(`Invalid MODE=${MODE}. Use continuous or once.`);
}
if (SEQUENTIAL_TAIL_MS > 20 * 60 * 1000) {
    throw new Error(
        `SEND_ORDER=sequential with VUS=${VUS} and SEND_STAGGER_MS=${SEND_STAGGER_MS} ` +
            `would take ~${Math.round(SEQUENTIAL_TAIL_MS / 60000)}m for the last user. ` +
            `Use -e SEND_ORDER=parallel for load tests, or lower VUS / SEND_STAGGER_MS.`
    );
}
if (users.length === 0) {
    throw new Error('No users in data/users_result.json — provide sender_token entries');
}
if (VUS > users.length) {
    throw new Error(
        `VUS=${VUS} but only ${users.length} tokens in users_result.json. Lower VUS or add more users.`
    );
}

/**
 * Build ramp stages for the requested peak VU count.
 * scaled  mirrors ws-group-message-500-users.js proportions.
 * simple  is a single climb → hold → descend.
 */
function buildStages(peakVus) {
    if (RAMP_STYLE === 'simple') {
        return [
            { duration: RAMP_UP, target: peakVus },
            { duration: HOLD, target: peakVus },
            { duration: RAMP_DOWN, target: 0 },
        ];
    }

    // scaled (default) — same shape as the 500-user scripts
    const p20 = Math.max(1, Math.round(peakVus * 0.2));
    const p40 = Math.max(1, Math.round(peakVus * 0.4));
    const p60 = Math.max(1, Math.round(peakVus * 0.6));
    const p80 = Math.max(1, Math.round(peakVus * 0.8));

    return [
        // Ramp up (~5 min)
        { duration: '1m', target: p20 },
        { duration: '1m', target: p40 },
        { duration: '1m', target: p80 },
        { duration: '2m', target: peakVus },
        // Peak hold
        { duration: HOLD, target: peakVus },
        // Ramp down (~3 min)
        { duration: '1m', target: p60 },
        { duration: '1m', target: p20 },
        { duration: '1m', target: 0 },
    ];
}

const wsConnected = new Counter('ws_stomp_connected');
const messagesSent = new Counter('ws_group_messages_sent');
const messagesReceived = new Counter('ws_group_messages_received');
const ownEchoesReceived = new Counter('ws_group_own_echoes_received');
const sendErrors = new Counter('ws_send_errors');
const teardownCloses = new Counter('ws_teardown_closes');
const sessionClosedErrors = new Counter('ws_session_closed_errors');
const uidRewrites = new Counter('ws_echo_uid_rewritten');
const messageLatency = new Trend('ws_group_message_roundtrip_ms', true);
const sessionDurationMs = new Trend('ws_group_session_hold_ms', true);
// Rates — these are the pass/fail gates (not count>0).
// ws_stomp_connect_rate: STOMP CONNECTED / VU iterations that attempted ws.connect
const stompConnectRate = new Rate('ws_stomp_connect_rate');
// ws_group_echo_rate: own echoes received / (echoes received + still pending at close)
const echoRate = new Rate('ws_group_echo_rate');
// ws_send_error_rate: real chat SEND / STOMP / WS errors during active messaging
// / (successful chat sends + those errors). Teardown Session closed / 1002
// go to ws_teardown_closes and do not fail this gate.
const sendErrorRate = new Rate('ws_send_error_rate');

function buildThresholds() {
    const thresholds = {
        ws_stomp_connect_rate: [`rate>=${STOMP_CONNECT_RATE_MIN}`],
        ws_group_echo_rate: [`rate>=${ECHO_RATE_MIN}`],
        ws_send_error_rate: [`rate<${SEND_ERROR_RATE_MAX}`],
    };
    if (MSG_RTT_P95_MS > 0) {
        thresholds.ws_group_message_roundtrip_ms = [`p(95)<${MSG_RTT_P95_MS}`];
    }
    return thresholds;
}

export const options = {
    scenarios: {
        group_chat_dynamic: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: buildStages(VUS),
            gracefulRampDown: GRACEFUL_RAMP_DOWN,
        },
    },
    thresholds: buildThresholds(),
    setupTimeout: '3m',
};

export function setup() {
    assertVuUsersAreGroupMembers({
        users: users,
        groupId: groupChat.groupId,
        wsUrl: groupChat.wsUrl,
        vus: VUS,
    });
    return {};
}

// Log config once at init (VU 0 context)
console.log(
    `ws-group-message-dynamic | VUS=${VUS} HOLD=${HOLD} MODE=${MODE} ` +
        `SEND_ORDER=${SEND_ORDER} SEND_STAGGER_MS=${SEND_STAGGER_MS} ` +
        `RAMP_STYLE=${RAMP_STYLE} MSG_INTERVAL_MS=${MSG_INTERVAL_MS} ` +
        `VU_HOLD_MS=${VU_HOLD_MS} scenario~${SCENARIO_DURATION_MS}ms tokens=${users.length} | ` +
        `gates: connect>=${STOMP_CONNECT_RATE_MIN} echo>=${ECHO_RATE_MIN} ` +
        `send_err<${SEND_ERROR_RATE_MAX}` +
        (MSG_RTT_P95_MS > 0 ? ` msg_p95<${MSG_RTT_P95_MS}ms` : ' msg_p95=off')
);
if (SEND_ORDER === 'sequential') {
    console.log(
        `SEND_ORDER=sequential | first SENDs start after ${ALIGN_AFTER_MS}ms ramp, ` +
            `then ${SEND_STAGGER_MS}ms apart (last VU ~${SEQUENTIAL_TAIL_MS}ms later). ` +
            `Use -e SEND_ORDER=parallel for a concurrent burst.`
    );
}
if (
    SEND_ORDER === 'sequential' &&
    parseK6DurationMs(HOLD, 0) > 0 &&
    SEQUENTIAL_TAIL_MS > parseK6DurationMs(HOLD, 0)
) {
    console.log(
        `WARNING: sequential wave ~${SEQUENTIAL_TAIL_MS}ms exceeds HOLD=${HOLD}. ` +
            `Raise HOLD or lower VUS / SEND_STAGGER_MS so every user can send.`
    );
}
if (VU_HOLD_MS > SCENARIO_DURATION_MS) {
    console.log(
        `WARNING: VU_HOLD_MS=${VU_HOLD_MS} exceeds scenario length ~${SCENARIO_DURATION_MS}ms. ` +
            `k6 will close sockets at scenario end; Session closed / WS 1002 are ` +
            `excluded from ws_send_error_rate (see ws_teardown_closes). ` +
            `Set VU_HOLD_MS shorter than the scenario if you want a clean STOMP DISCONNECT.`
    );
}

/**
 * STOMP content-length must be UTF-8 byte count, not JS string.length.
 * Multi-byte chars (e.g. em-dash) otherwise cause:
 *   "Frame must be terminated with a null octet" / WS close 1002.
 */
function utf8ByteLength(str) {
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c <= 0x7f) {
            bytes += 1;
        } else if (c <= 0x7ff) {
            bytes += 2;
        } else if (c >= 0xd800 && c <= 0xdbff) {
            // high surrogate — full code point is 4 UTF-8 bytes
            bytes += 4;
            i++;
        } else {
            bytes += 3;
        }
    }
    return bytes;
}

function stompFrame(command, headers, body) {
    let frame = command + '\n';
    for (const key of Object.keys(headers)) {
        frame += key + ':' + headers[key] + '\n';
    }
    frame += '\n';
    if (body !== undefined && body !== null) {
        frame += body;
    }
    frame += '\0';
    return frame;
}

function sendStompJson(socket, destination, payload) {
    const body = JSON.stringify(payload);
    socket.send(
        stompFrame(
            'SEND',
            {
                destination: destination,
                'content-type': 'application/json',
                'content-length': String(utf8ByteLength(body)),
            },
            body
        )
    );
}

function getUser() {
    // 1 VU ↔ 1 unique user for VUS <= token count
    return users[(__VU - 1) % users.length];
}

function scheduleFirstSend(socket, sendFn) {
    const delay = firstSendDelayMs(SEND_ORDER, SEND_STAGGER_MS, __VU, ALIGN_AFTER_MS);
    if (shouldLog() && SEND_ORDER === 'sequential') {
        console.log(`VU${__VU} sequential first SEND in ${delay}ms`);
    }
    if (delay >= VU_HOLD_MS) {
        console.log(
            `VU${__VU} WARNING: sequential delay ${delay}ms >= VU_HOLD_MS=${VU_HOLD_MS}; ` +
                `this VU may disconnect before sending.`
        );
    }
    if (delay > 0) {
        socket.setTimeout(sendFn, delay);
        return;
    }
    sendFn();
}

function shouldLog() {
    // Keep logs light at high VU counts (including ~30k)
    const step = VUS >= 10000 ? 1000 : VUS >= 5000 ? 500 : VUS >= 1000 ? 100 : 50;
    return __VU <= 5 || __VU % step === 0;
}

// ASCII-only bodies (avoids accidental multi-byte content-length mistakes).
const REALISTIC_MESSAGES = [
    'Hey team, can someone share the latest status on this?',
    'Just joined - catching up on the conversation now.',
    'Sounds good, I will follow up after lunch.',
    'Please review the document I shared earlier today.',
    'Are we still meeting at 3 PM?',
    'Thanks for the update, that clears things up.',
    'I am on it - will post an update shortly.',
    'Can we move this discussion to tomorrow morning?',
    'Got it. I will check and get back to you.',
    'Quick reminder: please submit your inputs by EOD.',
    'Happy to help if anyone needs a second pair of eyes.',
    'Confirmed on my side. Looking good so far.',
    'Any blockers I should be aware of?',
    'Let me know if you need anything else from me.',
    'Great work everyone - appreciate the quick turnaround.',
];

function pickMessageContent(seq) {
    const index = (__VU + (seq || 1) - 1) % REALISTIC_MESSAGES.length;
    return REALISTIC_MESSAGES[index];
}

function buildGroupMessage(user, seq) {
    const idPrefix = MODE === 'once' ? 'k6-once' : 'k6';
    return {
        conversationId: groupChat.conversationId,
        senderId: user.userId,
        senderName: user.senderName || user.userName,
        receiverId: groupChat.groupId,
        receiverName: groupChat.receiverName || 'test',
        content: pickMessageContent(seq || 1),
        messageType: 'SIMPLE',
        uniqueMessageId: `${idPrefix}-${__VU}-${seq || 1}-${Date.now()}`,
        attachmentURL: [],
        attachmentThumbURL: [],
        taggedUserDetails: [],
        latitude: '0.00',
        longitude: '0.00',
    };
}

// Per-VU isolate: used only in MODE=once
let alreadySent = false;

export default function () {
    if (MODE === 'once' && alreadySent) {
        sleep(5);
        return;
    }

    const user = getUser();
    const token = user.token;
    const url = `${groupChat.wsUrl}?at=${encodeURIComponent('Bearer ' + token)}`;

    let connected = false;
    let stompConnected = false;
    let subscribedUserQueue = false;
    let subscribedGroupQueue = false;
    let seq = 0;
    let sentOnce = false;
    let receivedOwnEcho = false;
    let hadStompError = false;
    let intentionalClose = false;
    let sessionStartMs = 0;
    let sessionEndMs = 0;
    const pendingSends = {};

    const errTracker = createSendErrorTracker({
        sendErrors: sendErrors,
        sendErrorRate: sendErrorRate,
        teardownCloses: teardownCloses,
        sessionClosedErrors: sessionClosedErrors,
        shouldLog: shouldLog,
        vus: VUS,
        vu: __VU,
    });

    const res = ws.connect(
        url,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Origin: 'https://ntmt.dev.gulftmt.com',
            },
        },
        function (socket) {
            socket.on('open', function () {
                socket.send(
                    stompFrame('CONNECT', {
                        'accept-version': '1.1,1.2',
                        'heart-beat': '10000,10000',
                        Authorization: `Bearer ${token}`,
                    })
                );
            });

            socket.on('message', function (data) {
                const text = String(data);

                if (text.indexOf('CONNECTED') === 0) {
                    connected = true;
                    stompConnected = true;
                    sessionStartMs = Date.now();
                    wsConnected.add(1);
                    if (shouldLog()) {
                        console.log(`VU${__VU} (${user.userName}) STOMP CONNECTED`);
                    }

                    // Personal queue (direct / some server paths)
                    socket.send(
                        stompFrame('SUBSCRIBE', {
                            id: `sub-user-reply-${__VU}`,
                            destination: '/user/queue/reply',
                            ack: 'auto',
                        })
                    );
                    subscribedUserQueue = true;

                    // Group fan-out channel (matches mobile: /user/{groupId}/queue/reply)
                    socket.send(
                        stompFrame('SUBSCRIBE', {
                            id: `sub-group-reply-${__VU}`,
                            destination: `/user/${groupChat.groupId}/queue/reply`,
                            ack: 'auto',
                        })
                    );
                    subscribedGroupQueue = true;

                    function sendChatMessage() {
                        if (!connected) {
                            return;
                        }
                        if (MODE === 'once' && sentOnce) {
                            return;
                        }
                        seq += 1;
                        if (MODE === 'once') {
                            sentOnce = true;
                            alreadySent = true;
                        }
                        const payload = buildGroupMessage(user, MODE === 'once' ? 1 : seq);
                        pendingSends[payload.uniqueMessageId] = {
                            kind: 'root',
                            sentAt: Date.now(),
                            content: payload.content,
                            senderId: payload.senderId,
                            parentId: '',
                            outboundUid: payload.uniqueMessageId,
                            timedOut: false,
                        };

                        try {
                            sendStompJson(socket, '/app/chat/groupMessage', payload);
                            messagesSent.add(1);
                            sendErrorRate.add(0);
                            if (shouldLog() && (MODE === 'once' || seq === 1 || seq % 10 === 0)) {
                                console.log(
                                    MODE === 'once'
                                        ? `VU${__VU} SENT once | ${payload.content.substring(0, 60)}`
                                        : `VU${__VU} SENT #${seq} | ${payload.content.substring(0, 60)}`
                                );
                            }
                        } catch (e) {
                            errTracker.onSendThrow(e);
                            if (MODE === 'once') {
                                alreadySent = false;
                                sentOnce = false;
                            }
                        }
                    }

                    if (MODE === 'once' || SEND_ORDER === 'sequential') {
                        scheduleFirstSend(socket, function () {
                            sendChatMessage();
                            if (MODE === 'continuous' && connected) {
                                socket.setInterval(sendChatMessage, MSG_INTERVAL_MS);
                            }
                        });
                    } else {
                        socket.setInterval(sendChatMessage, MSG_INTERVAL_MS);
                    }

                    return;
                }

                if (text.indexOf('ERROR') === 0) {
                    if (errTracker.onStompError(text)) {
                        hadStompError = true;
                    }
                    return;
                }

                if (text.indexOf('MESSAGE') === 0) {
                    messagesReceived.add(1);

                    const bodyIdx = text.indexOf('\n\n');
                    if (bodyIdx >= 0) {
                        const msgBody = text.substring(bodyIdx + 2).replace(/\0/g, '');
                        try {
                            const parsed = JSON.parse(msgBody);
                            const result = correlateOwnEcho(parsed, {
                                pendingByUid: pendingSends,
                                userId: user.userId,
                                phase: 'wait-root',
                            });
                            if (!result) {
                                return;
                            }

                            const pending = result.pending;
                            const sentAt = pending.sentAt || Date.now();
                            messageLatency.add(Date.now() - sentAt);
                            delete pendingSends[result.pendingKey];

                            if (result.uidRewritten) {
                                uidRewrites.add(1);
                                if (shouldLog()) {
                                    console.log(formatUidRewriteLog(__VU, parsed, result));
                                }
                            }

                            echoRate.add(true);
                            if (!receivedOwnEcho) {
                                receivedOwnEcho = true;
                                ownEchoesReceived.add(1);
                            }
                        } catch (e) {
                            // non-JSON or partial frame — ignore for latency
                        }
                    }
                }
            });

            socket.on('error', function (e) {
                errTracker.onWsError(e);
            });

            socket.on('close', function () {
                connected = false;
                sessionEndMs = Date.now();
                if (sessionStartMs > 0) {
                    sessionDurationMs.add(sessionEndMs - sessionStartMs);
                }
                for (const k of Object.keys(pendingSends)) {
                    const pending = pendingSends[k];
                    const sentAt = pending && pending.sentAt != null ? pending.sentAt : pending;
                    const ageMs = sessionEndMs - sentAt;
                    if (ageMs >= 10000) {
                        echoRate.add(false);
                    }
                    delete pendingSends[k];
                }
                if (shouldLog()) {
                    console.log(
                        `VU${__VU} WS closed` +
                            (intentionalClose ? ' (hold complete)' : ' (unexpected)')
                    );
                }
            });

            socket.setTimeout(function () {
                intentionalClose = true;
                errTracker.beginShutdown();
                if (connected) {
                    try {
                        socket.send(stompFrame('DISCONNECT', { receipt: `rcpt-${__VU}` }));
                    } catch (e) {
                        // Closing socket — do not count as a chat send failure.
                    }
                }
                socket.close();
            }, VU_HOLD_MS);
        }
    );

    const wsOk = check(res, {
        'WS status 101': (r) => r && r.status === 101,
    });

    stompConnectRate.add(stompConnected);

    if (!wsOk && shouldLog()) {
        console.log(
            `VU${__VU} (${user.userName}) WS upgrade failed | status=${res ? res.status : 'n/a'}`
        );
    }

    const heldMs =
        sessionStartMs > 0 ? (sessionEndMs || Date.now()) - sessionStartMs : 0;
    // Catch instant kills (protocol/OOM) without failing VUs cut short by ramp-down.
    const minHoldMs = Math.min(30000, Math.floor(VU_HOLD_MS * 0.5));

    const checks = {
        'STOMP connected': () => stompConnected,
        'Subscribed /user/queue/reply': () => subscribedUserQueue,
        'Subscribed /user/{groupId}/queue/reply': () => subscribedGroupQueue,
        'No STOMP ERROR': () => !hadStompError,
        'Session held after connect': () =>
            !stompConnected || intentionalClose || heldMs >= minHoldMs,
    };
    if (MODE === 'once') {
        checks['Sent one message'] = () => sentOnce || alreadySent;
        checks['Received own echo'] = () => receivedOwnEcho;
    }
    check(null, checks);

    sleep(1);
}

export function handleSummary(data) {
    const stamp = `${VUS}vus-${MODE}`;
    return {
        stdout: textSummary(data, { indent: ' ', enableColors: true }),
        [`reports/ws-group-message-dynamic-${stamp}-report.html`]: htmlReport(data),
    };
}
