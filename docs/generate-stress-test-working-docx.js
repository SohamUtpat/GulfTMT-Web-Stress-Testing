/**
 * Generates: GulfTMT-WebSocket-Stress-Test-Working.docx
 * End-to-end documentation of how the k6 stress tests work.
 *
 * Run from project root or docs/:
 *   node docs/generate-stress-test-working-docx.js
 */
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  BorderStyle,
  WidthType,
  AlignmentType,
  ShadingType,
  PageBreak,
} = require('docx');
const fs = require('fs');
const path = require('path');

const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const borders = { top: border, bottom: border, left: border, right: border };
const headerShading = { type: ShadingType.CLEAR, fill: '1F4E79' };
const altShading = { type: ShadingType.CLEAR, fill: 'F2F2F2' };

function cell(text, opts = {}) {
  const { bold = false, header = false, width = 2000, shade = false } = opts;
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: header ? headerShading : shade ? altShading : undefined,
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: String(text ?? ''),
            bold: bold || header,
            color: header ? 'FFFFFF' : '000000',
            size: header ? 18 : 17,
            font: 'Calibri',
          }),
        ],
      }),
    ],
  });
}

function makeTable(headers, rows, widths) {
  const headerRow = new TableRow({
    children: headers.map((h, i) => cell(h, { header: true, width: widths[i] })),
  });
  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map((v, i) =>
        cell(v, { width: widths[i], shade: ri % 2 === 1 })
      ),
    })
  );
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [headerRow, ...dataRows],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [
      new TextRun({
        text,
        bold: true,
        size: 28,
        font: 'Calibri',
        color: '1F4E79',
      }),
    ],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text,
        bold: true,
        size: 24,
        font: 'Calibri',
        color: '2E75B6',
      }),
    ],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [
      new TextRun({
        text,
        bold: true,
        size: 20,
        font: 'Calibri',
        color: '404040',
      }),
    ],
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text, size: 20, font: 'Calibri', ...opts })],
  });
}

function bullet(text) {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: 360 },
    children: [new TextRun({ text: `•  ${text}`, size: 20, font: 'Calibri' })],
  });
}

function numbered(n, text) {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: `${n}.  ${text}`, size: 20, font: 'Calibri' }),
    ],
  });
}

function mono(text) {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: 360 },
    children: [
      new TextRun({
        text,
        size: 18,
        font: 'Consolas',
      }),
    ],
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

const TODAY = '2026-08-09';

const doc = new Document({
  styles: {
    default: {
      document: {
        styles: [{ id: 'Normal', run: { font: 'Calibri', size: 20 } }],
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: [
        // ── Title ──
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [
            new TextRun({
              text: 'GulfTMT Phase 3B',
              bold: true,
              size: 36,
              font: 'Calibri',
              color: '1F4E79',
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [
            new TextRun({
              text: 'WebSocket Stress Testing',
              bold: true,
              size: 32,
              font: 'Calibri',
              color: '2E75B6',
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: 'End-to-End Working Document',
              bold: true,
              size: 26,
              font: 'Calibri',
              color: '404040',
            }),
          ],
        }),
        p('Project: Stress-Testing GulfTMT (k6)'),
        p('Scope: Group SIMPLE messages and Root → Reply → Sub-reply threads'),
        p('Protocol: STOMP over WebSocket'),
        p('Endpoint: /api/chat-service/chat (via API gateway)'),
        p(`Document date: ${TODAY}`),
        spacer(),

        // ═══════════════════════════════════════════
        h1('1. Purpose and Overview'),
        p(
          'This document describes how the GulfTMT WebSocket stress tests work from preparation through connection, messaging, metrics collection, ramp-down, and reporting. It is written for engineers who need to run, interpret, or extend the k6 scripts.'
        ),
        p(
          'The suite uses Grafana k6 to simulate many concurrent chat users against the GulfTMT Phase 3B chat service. Each virtual user (VU) behaves like one real client: it authenticates with a JWT, opens a WebSocket, completes a STOMP handshake, subscribes to reply queues, sends chat payloads, waits for server echoes, and measures round-trip latency.'
        ),
        spacer(),
        h2('1.1 What We Are Stressing'),
        bullet(
          'API gateway WebSocket upgrade and JWT auth (?at=Bearer <jwt>)'
        ),
        bullet('STOMP CONNECT / SUBSCRIBE / SEND / DISCONNECT under load'),
        bullet(
          'Chat-service group message path: /app/chat/groupMessage'
        ),
        bullet(
          'Fan-out delivery on /user/queue/reply and /user/{groupId}/queue/reply'
        ),
        bullet(
          'Thread depth up to 3 (root SIMPLE → REPLY → sub-REPLY) for the reply script'
        ),
        bullet(
          'Sustained concurrent connections, send rate, and receive latency'
        ),
        spacer(),
        h2('1.2 Scripts Covered'),
        makeTable(
          ['Script', 'What It Does'],
          [
            [
              'Scripts/ws-group-message-dynamic.js',
              'Each VU sends group SIMPLE messages and measures own-echo round-trip.',
            ],
            [
              'Scripts/ws-group-reply-subreply-dynamic.js',
              'Each VU drives a full 3-level thread: root → reply → sub-reply, waiting for parent server IDs between steps.',
            ],
          ],
          [4200, 4800]
        ),
        spacer(),
        p(
          'Both scripts share the same ramp model, auth pattern, VU-to-user mapping (1 VU = 1 unique user), data files, and report generation approach. Configuration is entirely via environment variables (-e KEY=value); you do not edit the script for different VU counts or durations.'
        ),

        pageBreak(),

        // ═══════════════════════════════════════════
        h1('2. Prerequisites and Project Layout'),
        h2('2.1 Prerequisites'),
        numbered(1, 'Install k6 and ensure it is on PATH.'),
        numbered(
          2,
          'Run all commands from the project root: Stress-Testing GulfTMT/'
        ),
        numbered(
          3,
          'Provide data/users_result.json with valid sender_token JWTs (supports large user sets, ~30k).'
        ),
        numbered(
          4,
          'Provide data/group-chat.json with groupId, conversationId, receiverName, and wsUrl for the target environment.'
        ),
        numbered(
          5,
          'Ensure test users are members of the target group so receive fan-out is realistic.'
        ),
        spacer(),
        h2('2.2 Project Layout'),
        mono('Stress-Testing GulfTMT/'),
        mono('├── Scripts/'),
        mono('│   ├── ws-group-message-dynamic.js'),
        mono('│   └── ws-group-reply-subreply-dynamic.js'),
        mono('├── data/'),
        mono('│   ├── users_result.json          # User tokens (sensitive)'),
        mono('│   └── group-chat.json            # Group / WS endpoint'),
        mono('├── reports/                       # HTML reports (auto-generated)'),
        mono('└── docs/                          # This documentation'),
        spacer(),
        h2('2.3 Data File: group-chat.json'),
        p('Example shape:'),
        mono('{'),
        mono('  "groupId": "<uuid>",'),
        mono('  "conversationId": "<id>",'),
        mono('  "receiverName": "test",'),
        mono(
          '  "wsUrl": "wss://api.ntmt.dev.gulftmt.com/api/chat-service/chat"'
        ),
        mono('}'),
        spacer(),
        h2('2.4 Data File: users_result.json'),
        p(
          'Keyed object of users. Each entry used by the scripts must include at least:'
        ),
        bullet('sender_id — mapped to senderId in payloads'),
        bullet('sender_name / user_code — display / log identity'),
        bullet('sender_token — JWT used for WebSocket auth'),
        p(
          'Security note: tokens are credentials. Do not commit live production JWTs to public repositories.'
        ),

        pageBreak(),

        // ═══════════════════════════════════════════
        h1('3. End-to-End Flow (Start to Finish)'),
        p(
          'The following stages apply to both scripts. Differences for the reply/sub-reply script are called out in Section 5.'
        ),
        spacer(),

        h2('3.1 Stage A — Init (Before Any VU Runs)'),
        numbered(
          1,
          'k6 loads the script and evaluates top-level code once in the init context.'
        ),
        numbered(
          2,
          'users_result.json is loaded into a SharedArray (shared read-only across VUs). Only entries with sender_token are kept; keys are sorted numerically.'
        ),
        numbered(3, 'group-chat.json is parsed for group/conversation/WS URL.'),
        numbered(
          4,
          'Environment variables are resolved: VUS, HOLD, MODE, RAMP_STYLE, MSG_INTERVAL_MS, VU_HOLD_MS, and (reply script) STEP_GAP_MS / PARENT_WAIT_MS.'
        ),
        numbered(
          5,
          'Validation runs: VUS must be a positive number; MODE must be continuous or once; at least one user must exist; VUS must not exceed token count.'
        ),
        numbered(
          6,
          'Ramp stages are built (scaled or simple). Scenario options and thresholds are registered.'
        ),
        numbered(
          7,
          'A single config line is logged (VUS, HOLD, MODE, intervals, token count) so operators can confirm the run before load starts.'
        ),
        spacer(),

        h2('3.2 Stage B — Ramp Schedule (Executor)'),
        p(
          'Both scripts use the ramping-vus executor starting at 0 VUs. Peak concurrency is the VUS env value.'
        ),
        h3('Scaled ramp (default RAMP_STYLE=scaled)'),
        makeTable(
          ['Stage', 'Duration', 'Target VUs'],
          [
            ['Ramp', '1m', '20% of VUS'],
            ['Ramp', '1m', '40% of VUS'],
            ['Ramp', '1m', '80% of VUS'],
            ['Ramp', '2m', '100% (VUS)'],
            ['Hold', 'HOLD (e.g. 4m)', 'VUS'],
            ['Ramp down', '1m', '60% of VUS'],
            ['Ramp down', '1m', '20% of VUS'],
            ['Ramp down', '1m', '0'],
          ],
          [2200, 2800, 4000]
        ),
        spacer(),
        p(
          'Approximate total runtime: ~8 minutes of ramp + HOLD + gracefulRampDown (30s continuous / 60s once).'
        ),
        spacer(),
        h3('Simple ramp (RAMP_STYLE=simple)'),
        bullet('Ramp up over RAMP_UP (default 5m) to VUS'),
        bullet('Hold at VUS for HOLD'),
        bullet('Ramp down over RAMP_DOWN (default 3m) to 0'),
        spacer(),

        h2('3.3 Stage C — Per-VU User Mapping'),
        p(
          'Each VU picks a unique user with: users[(__VU - 1) % users.length]. Because VUS is validated to be ≤ token count, peak concurrency maps 1:1 to distinct users (no token reuse at peak).'
        ),
        spacer(),

        h2('3.4 Stage D — WebSocket Connect and Auth'),
        numbered(
          1,
          'Build URL: {wsUrl}?at=Bearer%20{jwt} (gateway query-param auth).'
        ),
        numbered(
          2,
          'Also send HTTP headers: Authorization: Bearer {jwt} and Origin: https://ntmt.dev.gulftmt.com.'
        ),
        numbered(
          3,
          'k6 ws.connect opens the socket. Success expects HTTP 101 Switching Protocols.'
        ),
        numbered(
          4,
          'On socket open, send STOMP CONNECT frame with accept-version 1.1,1.2, heart-beat 10000,10000, and Authorization Bearer token.'
        ),
        numbered(
          5,
          'When the server returns CONNECTED, increment ws_stomp_connected and proceed to subscribe.'
        ),
        spacer(),

        h2('3.5 Stage E — Subscribe to Reply Queues'),
        p(
          'Immediately after STOMP CONNECTED, each VU subscribes to both channels (matching the mobile client pattern):'
        ),
        bullet('/user/queue/reply — personal / some server reply paths'),
        bullet(
          '/user/{groupId}/queue/reply — group fan-out channel used for realistic receive measurement'
        ),
        p('Subscriptions use ack: auto.'),
        spacer(),

        h2('3.6 Stage F — Messaging Workload'),
        p(
          'See Section 4 (group SIMPLE) and Section 5 (reply/sub-reply) for the exact send loops. Common rules:'
        ),
        bullet(
          'Payloads are JSON SEND frames to /app/chat/groupMessage with correct UTF-8 content-length (not JS string.length) to avoid STOMP frame errors.'
        ),
        bullet(
          'Each send includes uniqueMessageId for correlating the own echo.'
        ),
        bullet(
          'Connection is held open for VU_HOLD_MS (default 55s continuous, 240s once), then DISCONNECT + close.'
        ),
        spacer(),

        h2('3.7 Stage G — Receive, Correlate, Measure'),
        numbered(
          1,
          'Incoming STOMP MESSAGE frames increment ws_group_messages_received.'
        ),
        numbered(
          2,
          'JSON body is parsed; own messages are matched by uniqueMessageId (and fallbacks where needed).'
        ),
        numbered(
          3,
          'Round-trip latency = now − send timestamp; recorded in Trend metrics.'
        ),
        numbered(
          4,
          'STOMP ERROR frames and WS errors increment ws_send_errors.'
        ),
        spacer(),

        h2('3.8 Stage H — Checks, Disconnect, Ramp-Down'),
        numbered(
          1,
          'After the socket closes (or fails to upgrade), k6 checks assert WS 101, STOMP connected, subscriptions, and script-specific send/echo conditions.'
        ),
        numbered(
          2,
          'Intentional close after VU_HOLD_MS sends DISCONNECT then socket.close().'
        ),
        numbered(
          3,
          'As the executor ramps VUs down, iterations stop; gracefulRampDown allows in-flight connections to finish cleanly.'
        ),
        spacer(),

        h2('3.9 Stage I — Summary and Reports'),
        numbered(
          1,
          'handleSummary prints a text summary to stdout (checks, counters, trends).'
        ),
        numbered(
          2,
          'An HTML report is written under reports/ with a stamp of {VUS}vus-{MODE}.'
        ),
        bullet(
          'Group message: reports/ws-group-message-dynamic-{VUS}vus-{MODE}-report.html'
        ),
        bullet(
          'Reply/sub-reply: reports/ws-group-reply-subreply-dynamic-{VUS}vus-{MODE}-report.html'
        ),

        pageBreak(),

        // ═══════════════════════════════════════════
        h1('4. Script A — Group SIMPLE Messages'),
        p('File: Scripts/ws-group-message-dynamic.js'),
        spacer(),
        h2('4.1 Goal'),
        p(
          'Simulate many concurrent group members each posting normal chat messages (messageType: SIMPLE) and measuring how long until their own message echo returns on the subscribed queues.'
        ),
        spacer(),
        h2('4.2 Payload Shape'),
        bullet('conversationId, senderId, senderName from user + group-chat.json'),
        bullet('receiverId = groupId; receiverName from config'),
        bullet('messageType: SIMPLE'),
        bullet(
          'content: rotated from a fixed list of realistic ASCII chat lines'
        ),
        bullet(
          'uniqueMessageId: k6-{VU}-{seq}-{timestamp} (or k6-once-... in once mode)'
        ),
        bullet('Empty attachment / tag arrays; latitude/longitude placeholders'),
        spacer(),
        h2('4.3 MODE=continuous Behaviour'),
        numbered(
          1,
          'After subscribe, start a setInterval every MSG_INTERVAL_MS (default 3000).'
        ),
        numbered(
          2,
          'Each tick builds a new SIMPLE payload, records pendingSends[uniqueMessageId]=now, SENDs to /app/chat/groupMessage, increments ws_group_messages_sent.'
        ),
        numbered(
          3,
          'When a MESSAGE arrives with a matching uniqueMessageId, record ws_group_message_roundtrip_ms and count own echoes.'
        ),
        numbered(
          4,
          'After VU_HOLD_MS, disconnect. The VU may reconnect in later iterations while the scenario still schedules it.'
        ),
        spacer(),
        h2('4.4 MODE=once Behaviour'),
        numbered(
          1,
          'Each VU sends exactly one SIMPLE message after subscribe, then does not send again (alreadySent / sentOnce guards).'
        ),
        numbered(
          2,
          'Waits for own echo (uniqueMessageId match, or senderId fallback if uniqueMessageId omitted).'
        ),
        numbered(
          3,
          'Uses longer default VU_HOLD_MS (240000 ms) so the echo can arrive before disconnect.'
        ),
        numbered(
          4,
          'Best for burst / spike tests (e.g. 1000 users each send once).'
        ),
        spacer(),
        h2('4.5 Metrics and Thresholds'),
        makeTable(
          ['Metric', 'Type', 'Meaning'],
          [
            ['ws_stomp_connected', 'Counter', 'Successful STOMP CONNECTED frames'],
            ['ws_group_messages_sent', 'Counter', 'SIMPLE sends attempted'],
            [
              'ws_group_messages_received',
              'Counter',
              'All MESSAGE frames received (own + others)',
            ],
            [
              'ws_group_own_echoes_received',
              'Counter',
              'Own-message echoes correlated',
            ],
            [
              'ws_group_message_roundtrip_ms',
              'Trend',
              'Send → own echo latency',
            ],
            ['ws_send_errors', 'Counter', 'Send / STOMP / WS errors'],
            [
              'ws_group_session_hold_ms',
              'Trend',
              'How long the STOMP session stayed open',
            ],
          ],
          [3200, 1400, 4400]
        ),
        spacer(),
        p('Thresholds (soft pass gates): ws_stomp_connected count>0; ws_group_messages_sent count>0.'),
        spacer(),
        h2('4.6 Key Checks'),
        bullet('WS status 101'),
        bullet('STOMP connected'),
        bullet('Subscribed /user/queue/reply'),
        bullet('Subscribed /user/{groupId}/queue/reply'),
        bullet('No STOMP ERROR'),
        bullet('Session held after connect (or intentional close)'),
        bullet('Once mode: Sent one message; Received own echo'),

        pageBreak(),

        // ═══════════════════════════════════════════
        h1('5. Script B — Root → Reply → Sub-reply Threads'),
        p('File: Scripts/ws-group-reply-subreply-dynamic.js'),
        spacer(),
        h2('5.1 Goal'),
        p(
          'Exercise the chat-service thread model with backend MAX_THREAD_DEPTH = 3. Each VU builds a complete nested conversation cycle and waits for server-assigned chat IDs between steps, matching how the Flutter client replies.'
        ),
        spacer(),
        h2('5.2 Thread Cycle (One Cycle)'),
        makeTable(
          ['Step', 'messageType', 'Parent Link', 'Thread Depth'],
          [
            ['1. ROOT', 'SIMPLE', 'None', '1'],
            [
              '2. REPLY',
              'REPLY',
              'repliedOnChatId → root server id',
              '2',
            ],
            [
              '3. SUB-REPLY',
              'REPLY',
              'repliedOnChatId → reply server id',
              '3',
            ],
          ],
          [2000, 2000, 3500, 1500]
        ),
        spacer(),
        h2('5.3 Phase State Machine'),
        p('Each VU connection tracks phase:'),
        bullet('idle — ready to start (or finished once-mode cycle)'),
        bullet('wait-root — root sent; waiting for own root echo with parsed.id'),
        bullet(
          'wait-reply — reply sent; waiting for own reply echo with parsed.id'
        ),
        bullet(
          'wait-subreply — sub-reply sent; waiting for own sub-reply echo'
        ),
        spacer(),
        h3('Detailed step sequence'),
        numbered(
          1,
          'After CONNECTED + subscribe, immediately sendRoot() (phase = wait-root).'
        ),
        numbered(
          2,
          'On matching root echo with server id: record rootLatency, store lastRoot, wait STEP_GAP_MS (default 800), then sendReply().'
        ),
        numbered(
          3,
          'Reply payload uses messageType REPLY and repliedOnChatId as a JSON string: { chatId, senderId, senderName, content } of the parent — same shape Flutter sends.'
        ),
        numbered(
          4,
          'On matching reply echo: record replyLatency, store lastReply, wait STEP_GAP_MS, then sendSubReply() parenting the reply.'
        ),
        numbered(
          5,
          'On matching sub-reply echo: record subReplyLatency, set phase idle / chainCompleted, and either stop (once) or schedule the next cycle after MSG_INTERVAL_MS (continuous).'
        ),
        spacer(),
        h2('5.4 Parent Wait Timeout'),
        p(
          'A 1-second interval watches waitingSince. If the VU stays in wait-root / wait-reply / wait-subreply longer than PARENT_WAIT_MS (default 15000):'
        ),
        bullet('Increment ws_thread_parent_timeouts'),
        bullet('Once mode: abandon the cycle (phase idle)'),
        bullet('Continuous mode: reset and start a new root (retry)'),
        spacer(),
        h2('5.5 Echo Matching'),
        p('Preferred: uniqueMessageId against pendingByUid.'),
        p(
          'Fallback while waiting for reply/sub-reply: same senderId, messageType REPLY, and repliedOnChatId parent id matching lastRoot / lastReply.'
        ),
        p(
          'Messages are deduped by uniqueMessageId|id|phase. Echoes without a server id are ignored for advancing the chain (id is required to parent the next level).'
        ),
        spacer(),
        h2('5.6 Metrics and Thresholds'),
        makeTable(
          ['Metric', 'Type', 'Meaning'],
          [
            ['ws_stomp_connected', 'Counter', 'STOMP CONNECTED'],
            ['ws_group_roots_sent', 'Counter', 'Root SIMPLE sends'],
            ['ws_group_replies_sent', 'Counter', 'Level-2 REPLY sends'],
            ['ws_group_subreplies_sent', 'Counter', 'Level-3 REPLY sends'],
            [
              'ws_group_messages_received',
              'Counter',
              'All MESSAGE frames received',
            ],
            [
              'ws_group_root_roundtrip_ms',
              'Trend',
              'Root send → echo latency',
            ],
            [
              'ws_group_reply_roundtrip_ms',
              'Trend',
              'Reply send → echo latency',
            ],
            [
              'ws_group_subreply_roundtrip_ms',
              'Trend',
              'Sub-reply send → echo latency',
            ],
            [
              'ws_group_message_roundtrip_ms',
              'Trend',
              'Any matched own-echo latency',
            ],
            [
              'ws_thread_parent_timeouts',
              'Counter',
              'Parent echo not received in time',
            ],
            ['ws_send_errors', 'Counter', 'Send / STOMP / WS errors'],
          ],
          [3400, 1400, 4200]
        ),
        spacer(),
        p(
          'Thresholds: connected, roots, replies, and sub-replies each count>0.'
        ),
        spacer(),
        h2('5.7 Key Checks'),
        bullet('WS status 101; STOMP connected; both subscriptions'),
        bullet('Sent root SIMPLE; Sent REPLY; Sent sub-REPLY'),
        bullet('Completed thread cycle'),

        pageBreak(),

        // ═══════════════════════════════════════════
        h1('6. Modes, Timing Knobs, and Example Commands'),
        h2('6.1 Modes'),
        makeTable(
          ['MODE', 'Behaviour', 'Best For'],
          [
            [
              'continuous',
              'Keep sending (messages or full thread cycles) on an interval until VU_HOLD_MS ends.',
              'Sustained load / throughput',
            ],
            [
              'once',
              'One message or one full thread cycle per VU, then idle until disconnect.',
              'Spike / burst tests',
            ],
          ],
          [1800, 4200, 3000]
        ),
        spacer(),
        h2('6.2 Environment Variables'),
        makeTable(
          ['Variable', 'Default', 'Applies To', 'Description'],
          [
            ['VUS', '500', 'Both', 'Peak concurrent users (≤ token count)'],
            ['HOLD', '4m', 'Both', 'Time at peak VUs'],
            ['MODE', 'continuous', 'Both', 'continuous | once'],
            ['RAMP_STYLE', 'scaled', 'Both', 'scaled | simple'],
            ['RAMP_UP', '5m', 'Both (simple)', 'Ramp-up duration'],
            ['RAMP_DOWN', '3m', 'Both (simple)', 'Ramp-down duration'],
            [
              'VU_HOLD_MS',
              '55000 / 240000',
              'Both',
              'WS open time per iteration (cont / once)',
            ],
            [
              'MSG_INTERVAL_MS',
              '3000',
              'Both',
              'Pause between sends or between thread cycles',
            ],
            [
              'STEP_GAP_MS',
              '800',
              'Reply script',
              'Pause after parent echo before next reply',
            ],
            [
              'PARENT_WAIT_MS',
              '15000',
              'Reply script',
              'Max wait for parent echo before timeout',
            ],
          ],
          [2200, 1800, 1800, 3200]
        ),
        spacer(),
        h2('6.3 Example Commands'),
        p('Quick smoke (1 user, short once run):'),
        mono(
          'k6 run -e VUS=1 -e HOLD=30s -e MODE=once -e RAMP_STYLE=simple -e RAMP_UP=1s -e RAMP_DOWN=1s -e VU_HOLD_MS=30000 Scripts/ws-group-reply-subreply-dynamic.js'
        ),
        spacer(),
        p('Group messages — continuous 500 users, 4 min hold:'),
        mono(
          'k6 run -e VUS=500 -e HOLD=4m -e MODE=continuous Scripts/ws-group-message-dynamic.js'
        ),
        spacer(),
        p('Group messages — once / burst 1000 users:'),
        mono(
          'k6 run -e VUS=1000 -e HOLD=5m -e MODE=once Scripts/ws-group-message-dynamic.js'
        ),
        spacer(),
        p('Reply + sub-reply — continuous 500 users:'),
        mono(
          'k6 run -e VUS=500 -e HOLD=4m -e MODE=continuous Scripts/ws-group-reply-subreply-dynamic.js'
        ),
        spacer(),
        p('High load — 5000 users, 15 min hold:'),
        mono(
          'k6 run -e VUS=5000 -e HOLD=15m -e MODE=continuous Scripts/ws-group-message-dynamic.js'
        ),

        pageBreak(),

        // ═══════════════════════════════════════════
        h1('7. Protocol and Backend Alignment'),
        h2('7.1 Destinations'),
        makeTable(
          ['Direction', 'Destination', 'Role'],
          [
            ['SEND', '/app/chat/groupMessage', 'Publish group chat payloads'],
            [
              'SUBSCRIBE',
              '/user/queue/reply',
              'Personal / alternate reply path',
            ],
            [
              'SUBSCRIBE',
              '/user/{groupId}/queue/reply',
              'Group fan-out (matches Flutter)',
            ],
          ],
          [1800, 3600, 3600]
        ),
        spacer(),
        h2('7.2 Auth'),
        p(
          'API gateway expects the JWT on the WebSocket URL as query param at=Bearer <jwt>. Scripts also send Authorization and Origin headers for compatibility with gateway / CORS expectations.'
        ),
        spacer(),
        h2('7.3 STOMP Framing Notes'),
        bullet(
          'Frames end with a null octet (\\0). content-length is UTF-8 byte length.'
        ),
        bullet(
          'ASCII-only sample message bodies reduce accidental multi-byte length mistakes.'
        ),
        bullet('Heart-beat advertised as 10000,10000 on CONNECT.'),
        spacer(),
        h2('7.4 Logging Policy'),
        p(
          'To keep console noise manageable at high VU counts, detailed logs are limited to the first few VUs and every Nth VU (step 50 / 100 / 500 depending on VUS).'
        ),

        pageBreak(),

        // ═══════════════════════════════════════════
        h1('8. How to Interpret Results'),
        h2('8.1 Healthy Run Signals'),
        bullet('WS status 101 and STOMP connected rates near 100% of attempts'),
        bullet('Send counters grow steadily during hold'),
        bullet(
          'Own-echo / thread completion rates high; parent timeouts low'
        ),
        bullet(
          'Round-trip Trends stay within acceptable latency for the environment'
        ),
        bullet('ws_send_errors and unexpected WS closes remain low'),
        spacer(),
        h2('8.2 Problem Signals'),
        makeTable(
          ['Symptom', 'Likely Cause / Action'],
          [
            [
              'VUS=N but only M tokens',
              'Add users to users_result.json or lower VUS',
            ],
            [
              'WS upgrade failed (not 101)',
              'Expired JWT, wrong wsUrl, or gateway down',
            ],
            [
              'High ws_thread_parent_timeouts',
              'Increase PARENT_WAIT_MS; reduce VUS or STEP_GAP_MS; check chat-service lag',
            ],
            [
              'STOMP ERROR / frame terminated',
              'Payload framing / content-length; check server logs',
            ],
            [
              'Sends high but echoes low',
              'Fan-out or membership issue; confirm users are group members',
            ],
          ],
          [3500, 5500]
        ),
        spacer(),
        h2('8.3 Artifacts to Keep'),
        bullet('Console text summary from the run'),
        bullet('HTML report under reports/'),
        bullet(
          'Resolved config line from script startup (VUS, HOLD, MODE, etc.)'
        ),
        bullet('Notes on environment (dev/stage), groupId, and approximate token age'),

        pageBreak(),

        // ═══════════════════════════════════════════
        h1('9. Start-to-End Operator Checklist'),
        numbered(
          1,
          'Confirm environment wsUrl and group/conversation IDs in group-chat.json.'
        ),
        numbered(
          2,
          'Confirm enough fresh JWTs in users_result.json for the planned VUS.'
        ),
        numbered(
          3,
          'Confirm test users are members of the target group.'
        ),
        numbered(4, 'Choose script: SIMPLE-only vs reply/sub-reply threads.'),
        numbered(
          5,
          'Choose MODE (continuous vs once), RAMP_STYLE, VUS, HOLD, and timing knobs.'
        ),
        numbered(
          6,
          'Run a 1-VU smoke test first; verify CONNECTED, send, and echo in logs.'
        ),
        numbered(7, 'Run the full load command from project root.'),
        numbered(
          8,
          'During hold, watch connected/sent/received counters and error rates.'
        ),
        numbered(
          9,
          'After completion, open the HTML report and archive results with run parameters.'
        ),
        numbered(
          10,
          'If failures appear, use Section 8 troubleshooting before increasing VUS further.'
        ),
        spacer(),

        h1('10. Document History'),
        makeTable(
          ['Date', 'Change'],
          [
            [
              TODAY,
              'Initial end-to-end working document for group message and reply/sub-reply k6 stress tests',
            ],
          ],
          [2000, 7000]
        ),
      ],
    },
  ],
});

const outPath = path.join(
  __dirname,
  'GulfTMT-WebSocket-Stress-Test-Working.docx'
);
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log('Created:', outPath);
});
