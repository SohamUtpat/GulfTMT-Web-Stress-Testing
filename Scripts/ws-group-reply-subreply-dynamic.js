import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

/**
 * STOMP over WebSocket — group reply + sub-reply (thread) load test.
 *
 * Same ramp / auth / VU mapping as ws-group-message-dynamic.js, but each VU
 * drives a 3-level thread (backend MAX_THREAD_DEPTH = 3):
 *
 *   1. ROOT      SIMPLE  → wait for server chat id on /queue/reply
 *   2. REPLY     REPLY   → repliedOnChatId = root id   (threadDepth 2)
 *   3. SUB-REPLY REPLY   → repliedOnChatId = reply id  (threadDepth 3)
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
 *   k6 run -e VUS=5000 -e HOLD=15m -e MODE=continuous Scripts/ws-group-reply-subreply-dynamic.js
 *
 * Env knobs:
 *   VUS              Peak concurrent users (default 500). Must be <= token count.
 *   HOLD             Time spent at peak VUs (default 4m).
 *   MODE             continuous | once (default continuous).
 *   MSG_INTERVAL_MS  Pause between completed thread cycles in continuous mode (default 3000).
 *   STEP_GAP_MS      Pause after a parent echo before sending reply / sub-reply (default 800).
 *   PARENT_WAIT_MS   How long to wait for a parent echo before retrying the cycle (default 15000).
 *   VU_HOLD_MS       How long each VU keeps the WS open per iteration
 *                    (default: 55000 continuous, 240000 once).
 *   RAMP_STYLE       scaled | simple (default scaled).
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
const STEP_GAP_MS = Number(__ENV.STEP_GAP_MS || 800);
const PARENT_WAIT_MS = Number(__ENV.PARENT_WAIT_MS || 15000);
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
const parentTimeouts = new Counter('ws_thread_parent_timeouts');
const messageLatency = new Trend('ws_group_message_roundtrip_ms', true);
const rootLatency = new Trend('ws_group_root_roundtrip_ms', true);
const replyLatency = new Trend('ws_group_reply_roundtrip_ms', true);
const subReplyLatency = new Trend('ws_group_subreply_roundtrip_ms', true);

export const options = {
    scenarios: {
        group_reply_subreply_dynamic: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: buildStages(VUS),
            gracefulRampDown: MODE === 'once' ? '60s' : '30s',
        },
    },
    thresholds: {
        ws_stomp_connected: ['count>0'],
        ws_group_roots_sent: ['count>0'],
        ws_group_replies_sent: ['count>0'],
        ws_group_subreplies_sent: ['count>0'],
    },
};

console.log(
    `ws-group-reply-subreply-dynamic | VUS=${VUS} HOLD=${HOLD} MODE=${MODE} ` +
        `RAMP_STYLE=${RAMP_STYLE} MSG_INTERVAL_MS=${MSG_INTERVAL_MS} ` +
        `STEP_GAP_MS=${STEP_GAP_MS} PARENT_WAIT_MS=${PARENT_WAIT_MS} ` +
        `VU_HOLD_MS=${VU_HOLD_MS} tokens=${users.length}`
);

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

function shouldLog() {
    const step = VUS >= 5000 ? 500 : VUS >= 1000 ? 100 : 50;
    return __VU <= 5 || __VU % step === 0;
}

const ROOT_MESSAGES = [
    'Starting a new thread — please review when you can.',
    'Flagging this for the group. Details below.',
    'Opening a discussion on the latest update.',
    'Need eyes on this item before EOD.',
    'Sharing context so we can align quickly.',
];

const REPLY_MESSAGES = [
    'Got it — I will take a look and reply shortly.',
    'Thanks for raising this. Adding my notes.',
    'Acknowledged. Working through the details now.',
    'Makes sense. I have a couple of follow-up questions.',
    'On it. Will share an update in this thread.',
];

const SUB_REPLY_MESSAGES = [
    'Adding a sub-reply with the extra detail you asked for.',
    'Nested follow-up: this should close the open point.',
    'Sub-reply — confirming the approach on my side.',
    'Quick nested note so the thread stays complete.',
    'Following up under the reply with the final check.',
];

function pickText(list, seq) {
    return list[(__VU + (seq || 1) - 1) % list.length];
}

function buildRepliedOnChatId(parent) {
    // Flutter still sends a JSON string; chat-service accepts JSON or plain id.
    return JSON.stringify({
        chatId: parent.id,
        senderId: parent.senderId,
        senderName: parent.senderName,
        content: parent.content,
    });
}

function extractParentChatId(repliedOnChatId) {
    if (!repliedOnChatId) {
        return '';
    }
    const raw = String(repliedOnChatId);
    if (raw.charAt(0) === '{') {
        try {
            const parsed = JSON.parse(raw);
            return parsed && parsed.chatId ? String(parsed.chatId) : '';
        } catch (e) {
            return '';
        }
    }
    return raw;
}

function normalizeMessageType(value) {
    return String(value || '').toUpperCase();
}

function buildGroupPayload(user, kind, seq, parent) {
    const idPrefix = MODE === 'once' ? 'k6-once' : 'k6';
    const isRoot = kind === 'root';
    let content = pickText(ROOT_MESSAGES, seq);
    if (kind === 'reply') {
        content = pickText(REPLY_MESSAGES, seq);
    } else if (kind === 'subreply') {
        content = pickText(SUB_REPLY_MESSAGES, seq);
    }

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
    let subscribedUserQueue = false;
    let subscribedGroupQueue = false;
    let cycle = 0;
    let phase = 'idle';
    let sentRoot = false;
    let sentReply = false;
    let sentSubReply = false;
    let chainCompleted = false;
    const pendingByUid = {};
    const seenMessageKeys = {};
    let lastRoot = null;
    let lastReply = null;
    let waitingSince = 0;

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

            function trackPending(kind, payload) {
                pendingByUid[payload.uniqueMessageId] = {
                    kind: kind,
                    sentAt: Date.now(),
                    content: payload.content,
                    senderId: payload.senderId,
                    senderName: payload.senderName,
                };
            }

            function sendRoot() {
                if (!connected) {
                    return;
                }
                cycle += 1;
                lastRoot = null;
                lastReply = null;
                phase = 'wait-root';
                waitingSince = Date.now();

                const payload = buildGroupPayload(user, 'root', cycle, null);
                trackPending('root', payload);

                try {
                    sendStomp('/app/chat/groupMessage', payload);
                    rootsSent.add(1);
                    sentRoot = true;
                    if (shouldLog()) {
                        console.log(
                            `VU${__VU} ROOT #${cycle} | ${payload.content.substring(0, 60)}`
                        );
                    }
                } catch (e) {
                    sendErrors.add(1);
                    phase = 'idle';
                    console.log(`VU${__VU} ROOT SEND ERROR: ${e}`);
                }
            }

            function sendReply() {
                if (!connected || !lastRoot || !lastRoot.id) {
                    return;
                }
                phase = 'wait-reply';
                waitingSince = Date.now();

                const payload = buildGroupPayload(user, 'reply', cycle, lastRoot);
                trackPending('reply', payload);

                try {
                    sendStomp('/app/chat/groupMessage', payload);
                    repliesSent.add(1);
                    sentReply = true;
                    if (shouldLog()) {
                        console.log(
                            `VU${__VU} REPLY #${cycle} → ${lastRoot.id} | ${payload.content.substring(0, 50)}`
                        );
                    }
                } catch (e) {
                    sendErrors.add(1);
                    phase = 'idle';
                    console.log(`VU${__VU} REPLY SEND ERROR: ${e}`);
                }
            }

            function sendSubReply() {
                if (!connected || !lastReply || !lastReply.id) {
                    return;
                }
                phase = 'wait-subreply';
                waitingSince = Date.now();

                const payload = buildGroupPayload(user, 'subreply', cycle, lastReply);
                trackPending('subreply', payload);

                try {
                    sendStomp('/app/chat/groupMessage', payload);
                    subRepliesSent.add(1);
                    sentSubReply = true;
                    if (shouldLog()) {
                        console.log(
                            `VU${__VU} SUB-REPLY #${cycle} → ${lastReply.id} | ${payload.content.substring(0, 50)}`
                        );
                    }
                } catch (e) {
                    sendErrors.add(1);
                    phase = 'idle';
                    console.log(`VU${__VU} SUB-REPLY SEND ERROR: ${e}`);
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

            function matchOwnMessage(parsed) {
                const uid = parsed.uniqueMessageId;
                if (uid && pendingByUid[uid]) {
                    return pendingByUid[uid];
                }

                if (parsed.senderId !== user.userId) {
                    return null;
                }

                const msgType = normalizeMessageType(parsed.messageType);
                const parentId = extractParentChatId(parsed.repliedOnChatId);

                if (
                    phase === 'wait-reply' &&
                    msgType === 'REPLY' &&
                    lastRoot &&
                    parentId === lastRoot.id
                ) {
                    return { kind: 'reply', sentAt: waitingSince, content: parsed.content };
                }

                if (
                    phase === 'wait-subreply' &&
                    msgType === 'REPLY' &&
                    lastReply &&
                    parentId === lastReply.id
                ) {
                    return {
                        kind: 'subreply',
                        sentAt: waitingSince,
                        content: parsed.content,
                    };
                }

                return null;
            }

            function onOwnEcho(parsed, match) {
                const latency = Date.now() - (match.sentAt || Date.now());
                messageLatency.add(latency);

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
                    if (shouldLog() && cycle === 1) {
                        console.log(`VU${__VU} ROOT ack id=${snapshot.id} rt=${latency}ms`);
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
                    if (shouldLog() && cycle === 1) {
                        console.log(`VU${__VU} REPLY ack id=${snapshot.id} rt=${latency}ms`);
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
                    phase = 'idle';
                    chainCompleted = true;
                    if (MODE === 'once') {
                        alreadyCompletedOnce = true;
                    }
                    if (shouldLog()) {
                        console.log(
                            `VU${__VU} SUB-REPLY ack id=${snapshot.id} cycle=${cycle} rt=${latency}ms`
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

                    sendRoot();
                    return;
                }

                if (text.indexOf('ERROR') === 0) {
                    sendErrors.add(1);
                    console.log(`VU${__VU} STOMP ERROR: ${text.substring(0, 300)}`);
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

                    const dedupeKey =
                        (parsed.uniqueMessageId || '') + '|' + (parsed.id || '') + '|' + phase;
                    if (seenMessageKeys[dedupeKey]) {
                        return;
                    }
                    seenMessageKeys[dedupeKey] = true;

                    const match = matchOwnMessage(parsed);
                    if (!match) {
                        return;
                    }

                    if (parsed.uniqueMessageId && pendingByUid[parsed.uniqueMessageId]) {
                        delete pendingByUid[parsed.uniqueMessageId];
                    }

                    if (!parsed.id) {
                        return;
                    }

                    onOwnEcho(parsed, match);
                }
            });

            socket.on('error', function (e) {
                console.log(`VU${__VU} WS error: ${e}`);
                sendErrors.add(1);
            });

            socket.on('close', function () {
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
                if (shouldLog()) {
                    console.log(
                        `VU${__VU} parent wait timeout in phase=${phase} cycle=${cycle}`
                    );
                }

                if (MODE === 'once') {
                    phase = 'idle';
                    return;
                }

                phase = 'idle';
                sendRoot();
            }, 1000);

            socket.setTimeout(function () {
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

    check(null, {
        'STOMP connected': () => connected,
        'Subscribed /user/queue/reply': () => subscribedUserQueue,
        'Subscribed /user/{groupId}/queue/reply': () => subscribedGroupQueue,
        'Sent root SIMPLE': () => sentRoot,
        'Sent REPLY': () => sentReply,
        'Sent sub-REPLY': () => sentSubReply,
        'Completed thread cycle': () => chainCompleted || alreadyCompletedOnce,
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
