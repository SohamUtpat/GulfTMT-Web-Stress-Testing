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

/**
 * STOMP over WebSocket — group reply + sub-reply (thread) load test.
 *
 * Same ramp / auth / VU mapping as ws-group-message-dynamic.js, but each VU
 * drives a 3-level thread (backend MAX_THREAD_DEPTH = 3):
 *
 *   1. ROOT      SIMPLE  → wait for server chat id on /queue/reply
 *   2. REPLY     REPLY   → repliedOnChatId = root Mongo id   (threadDepth 2)
 *   3. SUB-REPLY REPLY   → repliedOnChatId = reply Mongo id  (threadDepth 3)
 *
 * Echo correlation (same rules at 100 / 1k / 10k / 30k — only VUs / hold /
 * thresholds change). chat-service processReplyMessage often assigns a new
 * uniqueMessageId on REPLY; that is not a delivery failure.
 *
 *   SIMPLE / root: match outbound uniqueMessageId when the backend keeps it;
 *                  else senderId + content + SIMPLE. Store echo.id /
 *                  echo.uniqueMessageId before sending a reply.
 *   REPLY / sub-REPLY: do not require echo.uniqueMessageId === outbound.
 *                  Match senderId + messageType=REPLY + repliedOnChatId
 *                  parent Mongo id (+ content). Then store the server
 *                  uniqueMessageId and Mongo id for the next thread step.
 *   "Reply matched" = those rules, not uniqueMessageId equality.
 *
 * Message text is numbered by VU so threads are easy to spot in the group:
 *   VU 1: "This is the 1st main message"
 *         "This is the 1st reply on the 1st main message"
 *         "This is the 1st sub-reply of the 1st reply of the 1st main message"
 *   Later cycles (continuous): "... the 2nd main message from user 1"
 *
 * Destinations (from chat-service + Flutter socket_service.dart):
 *   SEND:      /app/chat/groupMessage
 *   SUBSCRIBE: /user/queue/reply
 *              /user/{groupId}/queue/reply
 *
 * Auth (API gateway): query param ?at=Bearer <jwt>
 *
 * Prerequisites:
 *   - data/users_result.json  (users with sender_token)
 *   - data/group-chat.json
 *   - Test users should be members of the group for realistic receive fan-out
 *
 * Run (from project root):
 *   k6 run -e VUS=500  -e HOLD=4m  -e MODE=continuous Scripts/ws-group-reply-subreply-dynamic.js
 *   k6 run -e VUS=1000 -e HOLD=10m -e MODE=once       Scripts/ws-group-reply-subreply-dynamic.js
 *   k6 run -e STRICT_SLO=true -e VUS=500 -e HOLD=4m   Scripts/ws-group-reply-subreply-dynamic.js
 *
 * Wait modes (parent echo):
 *   diagnostic (default) — PARENT_WAIT_MS=60000 so late echoes are measurable.
 *                          Does NOT mean the system is healthy; it only improves measurement.
 *   slo / STRICT_SLO=true — PARENT_WAIT_MS=15000 (product SLO). Fail cycles that miss 15s.
 *   Explicit PARENT_WAIT_MS always wins over the mode default.
 *
 * Env knobs:
 *   VUS              Peak concurrent users (default 500). Must be <= token count.
 *   HOLD             Time spent at peak VUs (default 4m).
 *   MODE             continuous | once (default continuous).
 *                    once: one thread attempt per VU — after a parent timeout
 *                    the VU does not reconnect and send another root.
 *   MSG_INTERVAL_MS  Pause between completed thread cycles in continuous mode (default 3000).
 *   SEND_ORDER       parallel | sequential (default parallel / burst).
 *                    parallel   — every VU sends as soon as it is connected.
 *                    sequential — VU 1 posts the 1st main message, then VU 2, then VU 3.
 *   SEND_STAGGER_MS  Gap between sequential first root sends (default 300).
 *   STEP_GAP_MS      Pause after a parent echo before sending reply / sub-reply (default 800).
 *   WAIT_MODE        diagnostic | slo (default diagnostic). Alias: STRICT_SLO=true → slo.
 *   PARENT_WAIT_MS   Max wait for a parent echo (default 60000 diagnostic / 15000 slo).
 *   VU_HOLD_MS       How long each VU keeps the WS open per iteration
 *                    (default: enough for one full thread under PARENT_WAIT_MS,
 *                    at least 55000 continuous / 240000 once).
 *                    Not auto-capped to scenario length; if it is longer, k6
 *                    teardown Session closed / 1002 is excluded from
 *                    ws_send_error_rate and a startup warning is logged.
 *   RAMP_STYLE       scaled | simple (default scaled).
 *   RAMP_UP          Used when RAMP_STYLE=simple (default 5m).
 *   RAMP_DOWN        Used when RAMP_STYLE=simple (default 3m).
 *   STOMP_CONNECT_RATE_MIN   Min STOMP CONNECTED / connect attempts (default 0.95).
 *   THREAD_CYCLE_RATE_MIN    Min completed cycles / (completed + abandoned) (default 0.90).
 *   SEND_ERROR_RATE_MAX      Max real send/STOMP errors / (successful chat
 *                            sends + those errors) (default 0.05). Teardown
 *                            Session closed / WS 1002 do not count.
 *   PARENT_TIMEOUT_RATE_MAX  Max parent timeouts / (in-time echoes + timeouts) (default 0.10).
 *   ROOT_RTT_P95_MS          Optional p95 root RTT SLO (ms). Default: PARENT_WAIT_MS in slo
 *                            mode, disabled (0) in diagnostic mode.
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
const STEP_GAP_MS = Number(__ENV.STEP_GAP_MS || 800);

function envTruthy(name) {
    const v = String(__ENV[name] || '').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

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

const STRICT_SLO = envTruthy('STRICT_SLO');
let WAIT_MODE = String(__ENV.WAIT_MODE || '').toLowerCase();
if (WAIT_MODE !== 'slo' && WAIT_MODE !== 'diagnostic') {
    WAIT_MODE = STRICT_SLO ? 'slo' : 'diagnostic';
}

// diagnostic: 60s so ~30s avg / ~60s p95 root echoes under load can still be counted.
// slo: 15s product wait. Raising the wait does not make the backend faster.
const DEFAULT_PARENT_WAIT_MS = WAIT_MODE === 'slo' ? 15000 : 60000;
const PARENT_WAIT_MS = Number(__ENV.PARENT_WAIT_MS || DEFAULT_PARENT_WAIT_MS);

const ALIGN_AFTER_MS = sequentialAlignAfterMs(RAMP_STYLE, RAMP_UP);
const SEQUENTIAL_TAIL_MS = sequentialTailMs(SEND_ORDER, VUS, SEND_STAGGER_MS);
const minHoldForThread = PARENT_WAIT_MS * 3 + STEP_GAP_MS * 2 + 5000;
const sequentialHoldExtra =
    SEND_ORDER === 'sequential' ? ALIGN_AFTER_MS + SEQUENTIAL_TAIL_MS : 0;
const DEFAULT_VU_HOLD_MS =
    (MODE === 'once'
        ? Math.max(240000, minHoldForThread)
        : Math.max(55000, minHoldForThread)) + sequentialHoldExtra;
const VU_HOLD_MS = Number(__ENV.VU_HOLD_MS || DEFAULT_VU_HOLD_MS);
const GRACEFUL_RAMP_DOWN = MODE === 'once' ? '60s' : '30s';
const SCENARIO_DURATION_MS = rampingScenarioDurationMs({
    rampStyle: RAMP_STYLE,
    hold: HOLD,
    rampUp: RAMP_UP,
    rampDown: RAMP_DOWN,
    gracefulRampDown: GRACEFUL_RAMP_DOWN,
});

const STOMP_CONNECT_RATE_MIN = parseUnitRate(__ENV.STOMP_CONNECT_RATE_MIN, 0.95);
const THREAD_CYCLE_RATE_MIN = parseUnitRate(__ENV.THREAD_CYCLE_RATE_MIN, 0.9);
const SEND_ERROR_RATE_MAX = parseUnitRate(__ENV.SEND_ERROR_RATE_MAX, 0.05);
const PARENT_TIMEOUT_RATE_MAX = parseUnitRate(__ENV.PARENT_TIMEOUT_RATE_MAX, 0.1);
const ROOT_RTT_P95_MS = Number(
    __ENV.ROOT_RTT_P95_MS || (WAIT_MODE === 'slo' ? PARENT_WAIT_MS : 0)
);

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
if (!Number.isFinite(PARENT_WAIT_MS) || PARENT_WAIT_MS < 1) {
    throw new Error(`Invalid PARENT_WAIT_MS=${__ENV.PARENT_WAIT_MS}. Use milliseconds (e.g. 15000).`);
}
if (users.length === 0) {
    throw new Error('No users in data/users_result.json — provide sender_token entries');
}
if (VUS > users.length) {
    throw new Error(
        `VUS=${VUS} but only ${users.length} tokens in users_result.json. Lower VUS or add more users.`
    );
}

function buildStages(peakVus) {
    if (RAMP_STYLE === 'simple') {
        return [
            { duration: RAMP_UP, target: peakVus },
            { duration: HOLD, target: peakVus },
            { duration: RAMP_DOWN, target: 0 },
        ];
    }

    const p20 = Math.max(1, Math.round(peakVus * 0.2));
    const p40 = Math.max(1, Math.round(peakVus * 0.4));
    const p60 = Math.max(1, Math.round(peakVus * 0.6));
    const p80 = Math.max(1, Math.round(peakVus * 0.8));

    return [
        { duration: '1m', target: p20 },
        { duration: '1m', target: p40 },
        { duration: '1m', target: p80 },
        { duration: '2m', target: peakVus },
        { duration: HOLD, target: peakVus },
        { duration: '1m', target: p60 },
        { duration: '1m', target: p20 },
        { duration: '1m', target: 0 },
    ];
}

const wsConnected = new Counter('ws_stomp_connected');
const rootsSent = new Counter('ws_group_roots_sent');
const repliesSent = new Counter('ws_group_replies_sent');
const subRepliesSent = new Counter('ws_group_subreplies_sent');
const messagesReceived = new Counter('ws_group_messages_received');
const sendErrors = new Counter('ws_send_errors');
const teardownCloses = new Counter('ws_teardown_closes');
const sessionClosedErrors = new Counter('ws_session_closed_errors');
const parentTimeouts = new Counter('ws_thread_parent_timeouts');
const lateEchoes = new Counter('ws_thread_late_echoes');
const rootsMatched = new Counter('ws_group_roots_matched');
const repliesMatched = new Counter('ws_group_replies_matched');
const subRepliesMatched = new Counter('ws_group_subreplies_matched');
const uidRewrites = new Counter('ws_echo_uid_rewritten');
const messageLatency = new Trend('ws_group_message_roundtrip_ms', true);
const rootLatency = new Trend('ws_group_root_roundtrip_ms', true);
const replyLatency = new Trend('ws_group_reply_roundtrip_ms', true);
const subReplyLatency = new Trend('ws_group_subreply_roundtrip_ms', true);
const lateEchoLatency = new Trend('ws_thread_late_echo_ms', true);
// Rates — these are the pass/fail gates (not count>0).
// ws_stomp_connect_rate: STOMP CONNECTED / VU iterations that attempted ws.connect
const stompConnectRate = new Rate('ws_stomp_connect_rate');
// ws_thread_cycle_ok: completed root→reply→sub-reply cycles / (completed + abandoned)
const threadCycleRate = new Rate('ws_thread_cycle_ok');
// ws_send_error_rate: real chat SEND / STOMP / WS errors during active messaging
// / (successful chat sends + those errors). Teardown Session closed / 1002
// go to ws_teardown_closes and do not fail this gate.
const sendErrorRate = new Rate('ws_send_error_rate');
// ws_parent_timeout_rate: parent-wait timeouts / (in-time parent echoes + timeouts)
const parentTimeoutRate = new Rate('ws_parent_timeout_rate');

function buildThresholds() {
    const thresholds = {
        ws_stomp_connect_rate: [`rate>=${STOMP_CONNECT_RATE_MIN}`],
        ws_thread_cycle_ok: [`rate>=${THREAD_CYCLE_RATE_MIN}`],
        ws_send_error_rate: [`rate<${SEND_ERROR_RATE_MAX}`],
        ws_parent_timeout_rate: [`rate<${PARENT_TIMEOUT_RATE_MAX}`],
    };
    if (ROOT_RTT_P95_MS > 0) {
        thresholds.ws_group_root_roundtrip_ms = [`p(95)<${ROOT_RTT_P95_MS}`];
    }
    return thresholds;
}

export const options = {
    scenarios: {
        group_reply_subreply_dynamic: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: buildStages(VUS),
            gracefulRampDown: GRACEFUL_RAMP_DOWN,
        },
    },
    thresholds: buildThresholds(),
};

console.log(
    `ws-group-reply-subreply-dynamic | VUS=${VUS} HOLD=${HOLD} MODE=${MODE} ` +
        `SEND_ORDER=${SEND_ORDER} SEND_STAGGER_MS=${SEND_STAGGER_MS} ` +
        `RAMP_STYLE=${RAMP_STYLE} MSG_INTERVAL_MS=${MSG_INTERVAL_MS} ` +
        `WAIT_MODE=${WAIT_MODE} PARENT_WAIT_MS=${PARENT_WAIT_MS} ` +
        `STEP_GAP_MS=${STEP_GAP_MS} VU_HOLD_MS=${VU_HOLD_MS} ` +
        `scenario~${SCENARIO_DURATION_MS}ms tokens=${users.length} | ` +
        `gates: connect>=${STOMP_CONNECT_RATE_MIN} cycle>=${THREAD_CYCLE_RATE_MIN} ` +
        `send_err<${SEND_ERROR_RATE_MAX} parent_to<${PARENT_TIMEOUT_RATE_MAX}` +
        (ROOT_RTT_P95_MS > 0 ? ` root_p95<${ROOT_RTT_P95_MS}ms` : ' root_p95=off')
);
if (SEND_ORDER === 'sequential') {
    console.log(
        `SEND_ORDER=sequential | first ROOT sends start after ${ALIGN_AFTER_MS}ms ramp, ` +
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
if (VU_HOLD_MS < PARENT_WAIT_MS) {
    console.log(
        `WARNING: VU_HOLD_MS=${VU_HOLD_MS} < PARENT_WAIT_MS=${PARENT_WAIT_MS}. ` +
            `VUs may disconnect before the parent wait; unfinished cycles count as abandoned.`
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

/** STOMP content-length must be UTF-8 bytes, not JS string.length. */
function utf8ByteLength(str) {
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c <= 0x7f) {
            bytes += 1;
        } else if (c <= 0x7ff) {
            bytes += 2;
        } else if (c >= 0xd800 && c <= 0xdbff) {
            bytes += 4;
            i++;
        } else {
            bytes += 3;
        }
    }
    return bytes;
}

function getUser() {
    return users[(__VU - 1) % users.length];
}

function scheduleFirstSend(socket, sendFn) {
    const delay = firstSendDelayMs(SEND_ORDER, SEND_STAGGER_MS, __VU, ALIGN_AFTER_MS);
    if (shouldLog() && SEND_ORDER === 'sequential') {
        console.log(`VU${__VU} sequential first ROOT in ${delay}ms`);
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

function ordinal(n) {
    const num = Number(n);
    const mod100 = num % 100;
    if (mod100 >= 11 && mod100 <= 13) {
        return num + 'th';
    }
    switch (num % 10) {
        case 1:
            return num + 'st';
        case 2:
            return num + 'nd';
        case 3:
            return num + 'rd';
        default:
            return num + 'th';
    }
}

/** ASCII-only bodies (avoids accidental multi-byte content-length mistakes). */
function mainMessageLabel(seq) {
    const cycle = seq || 1;
    if (cycle <= 1) {
        return `the ${ordinal(__VU)} main message`;
    }
    return `the ${ordinal(cycle)} main message from user ${__VU}`;
}

function buildThreadContent(kind, seq) {
    const main = mainMessageLabel(seq);
    if (kind === 'root') {
        return `This is ${main}`;
    }
    if (kind === 'reply') {
        return `This is the 1st reply on ${main}`;
    }
    return `This is the 1st sub-reply of the 1st reply of ${main}`;
}

function buildRepliedOnChatId(parent) {
    // Parent must be the server Mongo id from the previous echo, not the
    // client uniqueMessageId. Flutter still sends a JSON string; chat-service
    // stores the resolved id.
    return JSON.stringify({
        chatId: parent.id,
        senderId: parent.senderId,
        senderName: parent.senderName,
        content: parent.content,
    });
}

function buildGroupPayload(user, kind, seq, parent) {
    const idPrefix = MODE === 'once' ? 'k6-once' : 'k6';
    const isRoot = kind === 'root';
    const content = buildThreadContent(kind, seq);

    const payload = {
        conversationId: groupChat.conversationId,
        senderId: user.userId,
        senderName: user.senderName || user.userName,
        receiverId: groupChat.groupId,
        receiverName: groupChat.receiverName || 'test',
        content: content,
        messageType: isRoot ? 'SIMPLE' : 'REPLY',
        uniqueMessageId: `${idPrefix}-${kind}-${__VU}-${seq}-${Date.now()}`,
        attachmentURL: [],
        attachmentThumbURL: [],
        taggedUserDetails: [],
        latitude: '0.00',
        longitude: '0.00',
    };

    if (!isRoot && parent && parent.id) {
        payload.repliedOnChatId = buildRepliedOnChatId(parent);
    }

    return payload;
}

let alreadyCompletedOnce = false;

export default function () {
    if (MODE === 'once' && alreadyCompletedOnce) {
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
    let cycle = 0;
    let phase = 'idle';
    let sentRoot = false;
    let sentReply = false;
    let sentSubReply = false;
    let matchedRoot = false;
    let matchedReply = false;
    let matchedSubReply = false;
    let chainCompleted = false;
    const pendingByUid = {};
    const seenMessageKeys = {};
    let lastRoot = null;
    let lastReply = null;
    let waitingSince = 0;

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
            function sendStomp(destination, payload) {
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

            function trackPending(kind, payload, parent) {
                pendingByUid[payload.uniqueMessageId] = {
                    kind: kind,
                    sentAt: Date.now(),
                    content: payload.content,
                    senderId: payload.senderId,
                    senderName: payload.senderName,
                    parentId: parent && parent.id ? String(parent.id) : '',
                    outboundUid: payload.uniqueMessageId,
                    timedOut: false,
                };
            }

            function sendRoot() {
                if (!connected) {
                    return;
                }
                // once-mode: one root per VU. Do not start another thread on this
                // connection or after a parent timeout (ramping-vus would otherwise
                // reconnect and spam extra roots — e.g. VU50/100 looping).
                if (MODE === 'once' && (alreadyCompletedOnce || sentRoot)) {
                    return;
                }
                cycle += 1;
                lastRoot = null;
                lastReply = null;
                phase = 'wait-root';
                waitingSince = Date.now();

                const payload = buildGroupPayload(user, 'root', cycle, null);
                trackPending('root', payload, null);

                try {
                    sendStomp('/app/chat/groupMessage', payload);
                    rootsSent.add(1);
                    sendErrorRate.add(0);
                    sentRoot = true;
                    if (MODE === 'once') {
                        alreadyCompletedOnce = true;
                    }
                    if (shouldLog()) {
                        console.log(
                            `VU${__VU} ROOT #${cycle} | ${payload.content.substring(0, 60)}`
                        );
                    }
                } catch (e) {
                    errTracker.onSendThrow(e);
                    threadCycleRate.add(false);
                    phase = 'idle';
                }
            }

            function sendReply() {
                // Wait for the root's server Mongo id before parenting the REPLY.
                if (!connected || !lastRoot || !lastRoot.id) {
                    return;
                }
                phase = 'wait-reply';
                waitingSince = Date.now();

                const payload = buildGroupPayload(user, 'reply', cycle, lastRoot);
                trackPending('reply', payload, lastRoot);

                try {
                    sendStomp('/app/chat/groupMessage', payload);
                    repliesSent.add(1);
                    sendErrorRate.add(0);
                    sentReply = true;
                    if (shouldLog()) {
                        console.log(
                            `VU${__VU} REPLY #${cycle} → ${lastRoot.id} | ${payload.content.substring(0, 50)}`
                        );
                    }
                } catch (e) {
                    errTracker.onSendThrow(e);
                    threadCycleRate.add(false);
                    phase = 'idle';
                }
            }

            function sendSubReply() {
                if (!connected || !lastReply || !lastReply.id) {
                    return;
                }
                phase = 'wait-subreply';
                waitingSince = Date.now();

                const payload = buildGroupPayload(user, 'subreply', cycle, lastReply);
                trackPending('subreply', payload, lastReply);

                try {
                    sendStomp('/app/chat/groupMessage', payload);
                    subRepliesSent.add(1);
                    sendErrorRate.add(0);
                    sentSubReply = true;
                    if (shouldLog()) {
                        console.log(
                            `VU${__VU} SUB-REPLY #${cycle} → ${lastReply.id} | ${payload.content.substring(0, 50)}`
                        );
                    }
                } catch (e) {
                    errTracker.onSendThrow(e);
                    threadCycleRate.add(false);
                    phase = 'idle';
                }
            }

            function startNextCycle() {
                if (!connected) {
                    return;
                }
                if (MODE === 'once') {
                    alreadyCompletedOnce = true;
                    chainCompleted = true;
                    return;
                }
                socket.setTimeout(function () {
                    if (connected && phase === 'idle') {
                        sendRoot();
                    }
                }, MSG_INTERVAL_MS);
            }

            function onOwnEcho(parsed, match) {
                const latency = Date.now() - (match.sentAt || Date.now());
                messageLatency.add(latency);
                parentTimeoutRate.add(false);

                // Server Mongo id + uniqueMessageId from this echo — use these
                // as parent / correlation ids for later REPLY / sub-REPLY steps.
                const snapshot = {
                    id: parsed.id,
                    uniqueMessageId: parsed.uniqueMessageId,
                    senderId: parsed.senderId || user.userId,
                    senderName: parsed.senderName || user.senderName || user.userName,
                    content: parsed.content || match.content,
                };

                if (match.kind === 'root') {
                    rootLatency.add(latency);
                    lastRoot = snapshot;
                    matchedRoot = true;
                    rootsMatched.add(1);
                    if (shouldLog() && cycle === 1) {
                        console.log(
                            `VU${__VU} ROOT ack id=${snapshot.id} uid=${snapshot.uniqueMessageId} rt=${latency}ms`
                        );
                    }
                    socket.setTimeout(function () {
                        if (connected && phase === 'wait-root' && lastRoot && lastRoot.id) {
                            sendReply();
                        }
                    }, STEP_GAP_MS);
                    return;
                }

                if (match.kind === 'reply') {
                    replyLatency.add(latency);
                    lastReply = snapshot;
                    matchedReply = true;
                    repliesMatched.add(1);
                    if (shouldLog() && cycle === 1) {
                        console.log(
                            `VU${__VU} REPLY ack id=${snapshot.id} uid=${snapshot.uniqueMessageId} ` +
                                `parent=${match.parentId || (lastRoot && lastRoot.id) || ''} rt=${latency}ms`
                        );
                    }
                    socket.setTimeout(function () {
                        if (connected && phase === 'wait-reply' && lastReply && lastReply.id) {
                            sendSubReply();
                        }
                    }, STEP_GAP_MS);
                    return;
                }

                if (match.kind === 'subreply') {
                    subReplyLatency.add(latency);
                    matchedSubReply = true;
                    subRepliesMatched.add(1);
                    phase = 'idle';
                    chainCompleted = true;
                    threadCycleRate.add(true);
                    if (MODE === 'once') {
                        alreadyCompletedOnce = true;
                    }
                    if (shouldLog()) {
                        console.log(
                            `VU${__VU} SUB-REPLY ack id=${snapshot.id} uid=${snapshot.uniqueMessageId} ` +
                                `cycle=${cycle} rt=${latency}ms`
                        );
                    }
                    startNextCycle();
                }
            }

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
                    wsConnected.add(1);
                    if (shouldLog()) {
                        console.log(`VU${__VU} (${user.userName}) STOMP CONNECTED`);
                    }

                    socket.send(
                        stompFrame('SUBSCRIBE', {
                            id: `sub-user-reply-${__VU}`,
                            destination: '/user/queue/reply',
                            ack: 'auto',
                        })
                    );
                    subscribedUserQueue = true;

                    socket.send(
                        stompFrame('SUBSCRIBE', {
                            id: `sub-group-reply-${__VU}`,
                            destination: `/user/${groupChat.groupId}/queue/reply`,
                            ack: 'auto',
                        })
                    );
                    subscribedGroupQueue = true;

                    scheduleFirstSend(socket, sendRoot);
                    return;
                }

                if (text.indexOf('ERROR') === 0) {
                    errTracker.onStompError(text);
                    return;
                }

                if (text.indexOf('MESSAGE') === 0) {
                    messagesReceived.add(1);

                    const bodyIdx = text.indexOf('\n\n');
                    if (bodyIdx < 0) {
                        return;
                    }

                    const msgBody = text.substring(bodyIdx + 2).replace(/\0/g, '');
                    let parsed;
                    try {
                        parsed = JSON.parse(msgBody);
                    } catch (e) {
                        return;
                    }

                    const result = correlateOwnEcho(parsed, {
                        pendingByUid: pendingByUid,
                        userId: user.userId,
                        phase: phase,
                    });
                    if (!result) {
                        return;
                    }

                    const dedupeKey =
                        (parsed.id || '') +
                        '|' +
                        (parsed.uniqueMessageId || '') +
                        '|' +
                        (result.pending.kind || phase);
                    if (seenMessageKeys[dedupeKey]) {
                        return;
                    }
                    seenMessageKeys[dedupeKey] = true;

                    // Need the server Mongo id before parenting the next thread level.
                    if (!parsed.id) {
                        return;
                    }

                    if (result.uidRewritten) {
                        uidRewrites.add(1);
                        if (shouldLog()) {
                            console.log(formatUidRewriteLog(__VU, parsed, result));
                        }
                    }

                    delete pendingByUid[result.pendingKey];

                    const match = result.pending;

                    // Echo after PARENT_WAIT_MS: the backend did deliver, but k6 already
                    // abandoned this cycle. Count it for diagnosis; do not treat as success.
                    if (match.timedOut) {
                        lateEchoes.add(1);
                        lateEchoLatency.add(Date.now() - (match.sentAt || Date.now()));
                        if (shouldLog()) {
                            console.log(
                                `VU${__VU} LATE ECHO kind=${match.kind} cycle=${cycle} ` +
                                    `id=${parsed.id} uid=${parsed.uniqueMessageId || ''} ` +
                                    `(timed out in k6; message did arrive)`
                            );
                        }
                        return;
                    }

                    onOwnEcho(parsed, match);
                }
            });

            socket.on('error', function (e) {
                errTracker.onWsError(e);
            });

            socket.on('close', function () {
                connected = false;
                if (MODE === 'once' && (sentRoot || cycle > 0 || phase !== 'idle')) {
                    alreadyCompletedOnce = true;
                }
                if (phase !== 'idle') {
                    parentTimeouts.add(1);
                    parentTimeoutRate.add(true);
                    threadCycleRate.add(false);
                    for (const uid of Object.keys(pendingByUid)) {
                        if (pendingByUid[uid] && !pendingByUid[uid].timedOut) {
                            pendingByUid[uid].timedOut = true;
                        }
                    }
                }
                if (shouldLog()) {
                    console.log(`VU${__VU} WS closed`);
                }
            });

            socket.setInterval(function () {
                if (!connected || phase === 'idle') {
                    return;
                }
                if (Date.now() - waitingSince < PARENT_WAIT_MS) {
                    return;
                }

                parentTimeouts.add(1);
                parentTimeoutRate.add(true);
                threadCycleRate.add(false);

                for (const uid of Object.keys(pendingByUid)) {
                    if (pendingByUid[uid] && !pendingByUid[uid].timedOut) {
                        pendingByUid[uid].timedOut = true;
                    }
                }

                if (shouldLog()) {
                    console.log(
                        `VU${__VU} parent wait timeout in phase=${phase} cycle=${cycle} ` +
                            `(wait=${PARENT_WAIT_MS}ms; late echoes still counted if they arrive)`
                    );
                }

                if (MODE === 'once') {
                    alreadyCompletedOnce = true;
                    phase = 'idle';
                    return;
                }

                phase = 'idle';
                sendRoot();
            }, 1000);

            socket.setTimeout(function () {
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

    check(null, {
        'STOMP connected': () => stompConnected,
        'Subscribed /user/queue/reply': () => subscribedUserQueue,
        'Subscribed /user/{groupId}/queue/reply': () => subscribedGroupQueue,
        'Sent root SIMPLE': () => sentRoot,
        'Sent REPLY': () => sentReply,
        'Sent sub-REPLY': () => sentSubReply,
        'Root matched (WS echo)': () => matchedRoot,
        'REPLY matched (WS echo)': () => matchedReply,
        'Sub-REPLY matched (WS echo)': () => matchedSubReply,
        'Completed thread cycle': () => chainCompleted,
    });

    sleep(1);
}

export function handleSummary(data) {
    const stamp = `${VUS}vus-${MODE}`;
    return {
        stdout: textSummary(data, { indent: ' ', enableColors: true }),
        [`reports/ws-group-reply-subreply-dynamic-${stamp}-report.html`]: htmlReport(data),
    };
}
