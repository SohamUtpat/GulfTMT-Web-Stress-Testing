import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

/**
 * STOMP over WebSocket — dynamic group chat load test.
 *
 * One script for any user count (up to tokens in users_result.json).
 * Pass VUS / HOLD / MODE at run time — no need to edit stages.
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
 *   VU_HOLD_MS       How long each VU keeps the WS open per iteration
 *                    (default: 55000 continuous, 240000 once).
 *   RAMP_STYLE       scaled | simple (default scaled).
 *                    scaled  = same shape as 500-user scripts (20%→40%→80%→100%).
 *                    simple  = single ramp-up → hold → ramp-down.
 *   RAMP_UP          Used when RAMP_STYLE=simple (default 5m).
 *   RAMP_DOWN        Used when RAMP_STYLE=simple (default 3m).
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
const RAMP_STYLE = String(__ENV.RAMP_STYLE || 'scaled').toLowerCase();
const RAMP_UP = __ENV.RAMP_UP || '5m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '3m';
const MSG_INTERVAL_MS = Number(__ENV.MSG_INTERVAL_MS || 3000);
const VU_HOLD_MS = Number(
    __ENV.VU_HOLD_MS || (MODE === 'once' ? 240000 : 55000)
);

if (!Number.isFinite(VUS) || VUS < 1) {
    throw new Error(`Invalid VUS=${__ENV.VUS}. Use a positive number (e.g. -e VUS=1000).`);
}
if (MODE !== 'continuous' && MODE !== 'once') {
    throw new Error(`Invalid MODE=${MODE}. Use continuous or once.`);
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
const messageLatency = new Trend('ws_group_message_roundtrip_ms', true);
const sessionDurationMs = new Trend('ws_group_session_hold_ms', true);

export const options = {
    scenarios: {
        group_chat_dynamic: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: buildStages(VUS),
            gracefulRampDown: MODE === 'once' ? '60s' : '30s',
        },
    },
    thresholds: {
        ws_stomp_connected: ['count>0'],
        ws_group_messages_sent: ['count>0'],
    },
};

// Log config once at init (VU 0 context)
console.log(
    `ws-group-message-dynamic | VUS=${VUS} HOLD=${HOLD} MODE=${MODE} ` +
        `RAMP_STYLE=${RAMP_STYLE} MSG_INTERVAL_MS=${MSG_INTERVAL_MS} ` +
        `VU_HOLD_MS=${VU_HOLD_MS} tokens=${users.length}`
);

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

function shouldLog() {
    // Keep logs light at high VU counts
    const step = VUS >= 5000 ? 500 : VUS >= 1000 ? 100 : 50;
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

                    if (MODE === 'once') {
                        // Exactly one SEND per VU (same behaviour as 500-users-once)
                        if (!sentOnce) {
                            sentOnce = true;
                            alreadySent = true;

                            const payload = buildGroupMessage(user, 1);
                            pendingSends[payload.uniqueMessageId] = Date.now();

                            try {
                                sendStompJson(socket, '/app/chat/groupMessage', payload);
                                messagesSent.add(1);
                                if (shouldLog()) {
                                    console.log(
                                        `VU${__VU} SENT once | ${payload.content.substring(0, 60)}`
                                    );
                                }
                            } catch (e) {
                                sendErrors.add(1);
                                console.log(`VU${__VU} SEND ERROR: ${e}`);
                                alreadySent = false;
                                sentOnce = false;
                            }
                        }
                        return;
                    }

                    // continuous — send on interval (same behaviour as 500-users)
                    socket.setInterval(function () {
                        if (!connected) {
                            return;
                        }
                        seq += 1;
                        const payload = buildGroupMessage(user, seq);
                        pendingSends[payload.uniqueMessageId] = Date.now();

                        try {
                            sendStompJson(socket, '/app/chat/groupMessage', payload);
                            messagesSent.add(1);
                            if ((seq === 1 || seq % 10 === 0) && shouldLog()) {
                                console.log(
                                    `VU${__VU} SENT #${seq} | ${payload.content.substring(0, 60)}`
                                );
                            }
                        } catch (e) {
                            sendErrors.add(1);
                            console.log(`VU${__VU} SEND ERROR: ${e}`);
                        }
                    }, MSG_INTERVAL_MS);

                    return;
                }

                if (text.indexOf('ERROR') === 0) {
                    hadStompError = true;
                    sendErrors.add(1);
                    console.log(`VU${__VU} STOMP ERROR: ${text.substring(0, 300)}`);
                    return;
                }

                if (text.indexOf('MESSAGE') === 0) {
                    messagesReceived.add(1);

                    const bodyIdx = text.indexOf('\n\n');
                    if (bodyIdx >= 0) {
                        const msgBody = text.substring(bodyIdx + 2).replace(/\0/g, '');
                        try {
                            const parsed = JSON.parse(msgBody);
                            const key = parsed.uniqueMessageId;
                            const matchedPending = key && pendingSends[key];
                            // Fallback: once-mode echo may omit uniqueMessageId but still carry senderId
                            const matchedSender =
                                !matchedPending &&
                                sentOnce &&
                                !receivedOwnEcho &&
                                parsed.senderId === user.userId &&
                                Object.keys(pendingSends).length > 0;

                            if (matchedPending || matchedSender) {
                                if (matchedPending) {
                                    messageLatency.add(Date.now() - pendingSends[key]);
                                    delete pendingSends[key];
                                } else {
                                    // clear any pending once we accept sender-matched echo
                                    for (const k of Object.keys(pendingSends)) {
                                        messageLatency.add(Date.now() - pendingSends[k]);
                                        delete pendingSends[k];
                                    }
                                }
                                if (!receivedOwnEcho) {
                                    receivedOwnEcho = true;
                                    ownEchoesReceived.add(1);
                                }
                            }
                        } catch (e) {
                            // non-JSON or partial frame — ignore for latency
                        }
                    }
                }
            });

            socket.on('error', function (e) {
                console.log(`VU${__VU} WS error: ${e}`);
                sendErrors.add(1);
            });

            socket.on('close', function () {
                sessionEndMs = Date.now();
                if (sessionStartMs > 0) {
                    sessionDurationMs.add(sessionEndMs - sessionStartMs);
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
                if (connected) {
                    socket.send(stompFrame('DISCONNECT', { receipt: `rcpt-${__VU}` }));
                }
                socket.close();
            }, VU_HOLD_MS);
        }
    );

    const wsOk = check(res, {
        'WS status 101': (r) => r && r.status === 101,
    });

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
        'STOMP connected': () => connected,
        'Subscribed /user/queue/reply': () => subscribedUserQueue,
        'Subscribed /user/{groupId}/queue/reply': () => subscribedGroupQueue,
        'No STOMP ERROR': () => connected && !hadStompError,
        'Session held after connect': () =>
            !connected || intentionalClose || heldMs >= minHoldMs,
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
