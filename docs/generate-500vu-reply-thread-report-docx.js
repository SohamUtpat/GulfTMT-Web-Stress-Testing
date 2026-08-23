/**
 * Generates: GulfTMT-500-User-Reply-Thread-Test-Report-2026-08-21.docx
 * Office-shareable brief of the 21 Aug 2026 500-VU reply/sub-reply k6 run.
 *
 * Run from project root:
 *   node docs/generate-500vu-reply-thread-report-docx.js
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
} = require('docx');
const fs = require('fs');
const path = require('path');

const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const borders = { top: border, bottom: border, left: border, right: border };
const headerShading = { type: ShadingType.CLEAR, fill: '1F4E79' };
const altShading = { type: ShadingType.CLEAR, fill: 'F2F2F2' };
const failShading = { type: ShadingType.CLEAR, fill: 'F4CCCC' };
const warnShading = { type: ShadingType.CLEAR, fill: 'FFF2CC' };
const okShading = { type: ShadingType.CLEAR, fill: 'D9EAD3' };

function cell(text, opts = {}) {
  const { bold = false, header = false, width = 2000, shade = false, fill } = opts;
  let shading;
  if (header) shading = headerShading;
  else if (fill) shading = { type: ShadingType.CLEAR, fill };
  else if (shade) shading = altShading;
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading,
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

function makeTable(headers, rows, widths, rowFills) {
  const headerRow = new TableRow({
    children: headers.map((h, i) => cell(h, { header: true, width: widths[i] })),
  });
  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map((v, i) =>
        cell(v, {
          width: widths[i],
          shade: !rowFills && ri % 2 === 1,
          fill: rowFills ? rowFills[ri] : undefined,
        })
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

function mono(text) {
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 200 },
    children: [new TextRun({ text, size: 18, font: 'Consolas' })],
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

const OUT = path.join(
  __dirname,
  'GulfTMT-500-User-Reply-Thread-Test-Report-2026-08-21.docx'
);

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
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
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
              text: '500-User Reply / Sub-Reply Thread Stress Test Report',
              bold: true,
              size: 28,
              font: 'Calibri',
              color: '1F4E79',
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: 'Environment: ntmt.dev  ·  Date: 21 August 2026  ·  Duration: 12 min 30 s  ·  Result: FAIL',
              size: 20,
              font: 'Calibri',
              color: 'C00000',
              bold: true,
            }),
          ],
        }),

        h1('Verdict'),
        p(
          '500 concurrent users reached the WebSocket, but the nested-chat workflow did not work. Only 28 users completed a full root → reply → sub-reply thread (about 6% of the 500-user target, 0.96% of checked attempts). Two failures: 72% of sockets never finished STOMP login, and 795 of 823 root messages timed out waiting for a server echo (median echo 32 seconds vs 15 seconds allowed).'
        ),
        spacer(),
        makeTable(
          ['Headline number', 'Value', 'Meaning'],
          [
            ['Peak concurrent users', '500', 'Load target was reached'],
            ['Full threads completed', '28', 'Official pass condition for this script'],
            ['STOMP login success', '28%', 'Chat protocol handshake after the socket opened'],
            ['Root echo timeouts', '795', 'Root posted; reply never started'],
            ['Overall k6 checks', '26.91% pass', '6,297 passed / 17,103 failed'],
            ['k6 exit code', '0', 'Weak bar only: counters > 0, not a quality pass'],
          ],
          [3200, 2400, 5200]
        ),

        h1('1. Exact run setup'),
        p(
          'Working directory: Stress-Testing GulfTMT. One virtual user = one unique JWT from data/users_result.json (30,000 tokens available). All users posted into the same group conversation.'
        ),
        p('Command:', { italics: true }),
        mono(
          'k6 run -e VUS=500 -e HOLD=4m -e MODE=once -e RAMP_STYLE=simple -e RAMP_UP=5m -e RAMP_DOWN=3m Scripts/ws-group-reply-subreply-dynamic.js'
        ),
        spacer(),
        makeTable(
          ['Setting', 'Value', 'Meaning'],
          [
            ['Script', 'ws-group-reply-subreply-dynamic.js', '3-level group thread: SIMPLE → REPLY → sub-REPLY'],
            ['Target WS', 'wss://api.ntmt.dev.gulftmt.com/api/chat-service/chat', 'Chat service via API gateway'],
            ['Group / conversation', '2fc57422…fa04 / 6a705e79d448df004f48b48a', 'Single shared group — every send fans out to members'],
            ['VUS', '500', 'Peak concurrent clients'],
            ['RAMP_STYLE', 'simple', 'Straight climb, hold, descend — not stepped'],
            ['RAMP_UP / HOLD / RAMP_DOWN', '5m / 4m / 3m', 'Load shape'],
            ['MODE', 'once', 'Each user should complete one thread, then idle'],
            ['VU_HOLD_MS', '240000 (4 min)', 'How long a socket is kept open per attempt'],
            ['PARENT_WAIT_MS', '15000 (15 s)', 'Max wait for parent echo before giving up that cycle'],
            ['STEP_GAP_MS', '800', 'Pause after echo before sending the next thread step'],
            ['gracefulRampDown', '60s', 'MODE=once extra drain at the end'],
          ],
          [3200, 4200, 3400]
        ),

        h1('2. Load timeline of this run'),
        p(
          'Planned concurrent virtual users vs elapsed time (k6 ramping-vus, simple ramp).'
        ),
        spacer(),
        makeTable(
          ['Elapsed time', 'Planned concurrent VUs', 'Stage'],
          [
            ['0:00', '0', 'Start'],
            ['5:00', '500', 'End of ramp-up — peak reached'],
            ['9:00', '500', 'End of 4-minute hold'],
            ['12:00', '0', 'End of ramp-down'],
            ['12:30', '0', 'Graceful shutdown complete'],
          ],
          [2400, 3600, 4800]
        ),
        spacer(),
        p(
          'Observed: min 1 VU, max 500 VUs. k6 reported 6,457 complete iterations and 195 interrupted during shutdown. Total runtime 12m30s. Data sent 9.76 MB, received 34.86 MB.'
        ),

        h1('3. Exact per-user workflow'),
        p(
          'Every virtual user follows this sequence. A pass requires all 11 steps. This run broke at STOMP CONNECT (step 3) and again at wait-for-root-echo (step 6).'
        ),
        spacer(),
        makeTable(
          ['Step', 'What the user does', 'Expected', 'This run'],
          [
            [
              '1. Pick user',
              'Map VU number to one JWT (1 VU = 1 unique user)',
              '500 distinct users',
              'Tokens were available (30,000). Mapping worked.',
            ],
            [
              '2. Open WebSocket',
              'Connect to chat URL with Bearer token',
              'HTTP 101 Switching Protocols',
              '2,921 / 2,925 checked attempts (99.86%). Network path is fine.',
            ],
            [
              '3. STOMP CONNECT',
              'Send CONNECT (accept-version 1.1/1.2, heart-beat 10s)',
              'Server replies CONNECTED',
              'FAILED. Only 823 CONNECTED (28.14%). 2,102 sockets never logged into chat.',
            ],
            [
              '4. Subscribe',
              'SUBSCRIBE /user/queue/reply and /user/{groupId}/queue/reply',
              'Both subscriptions set',
              'Same 823 — subscribe only runs after CONNECTED.',
            ],
            [
              '5. Send root',
              'SEND SIMPLE to /app/chat/groupMessage (new thread)',
              'Root posted after login',
              '823 roots posted. This step itself did not drop further.',
            ],
            [
              '6. Wait for root echo',
              'Match own message by uniqueMessageId; need server chat id',
              'Echo within 15 seconds',
              'FAILED. Median echo 31.8s, p95 59.9s. 795 parent-wait timeouts.',
            ],
            [
              '7. Send REPLY',
              'After 800ms gap, SEND REPLY with repliedOnChatId = root id',
              '500 replies (one per user)',
              'Only 28 replies sent. No parent id → no reply.',
            ],
            [
              '8. Wait for reply echo',
              'Need reply server chat id',
              'Echo within 15s',
              'Those 28 that continued had ~3.9s average reply echo (survivors only).',
            ],
            [
              '9. Send sub-REPLY',
              'SEND nested REPLY with repliedOnChatId = reply id (depth 3)',
              '500 sub-replies',
              '28 sent. Same 28 users as replies.',
            ],
            [
              '10. Complete cycle',
              'Sub-reply echo received → thread done; MODE=once then idle',
              '500 completed threads',
              '28 completed. Then those VUs slept 5s loops until the test ended.',
            ],
            [
              '11. Hold / close',
              'Keep socket 4 min, then DISCONNECT + close',
              'Stable 4-minute sessions',
              'Median session 45.5s. Many closed with WS 1002 protocol error.',
            ],
          ],
          [1800, 3200, 2400, 3400],
          [
            'D9EAD3',
            'D9EAD3',
            'F4CCCC',
            'F4CCCC',
            'F4CCCC',
            'F4CCCC',
            'F4CCCC',
            'F4CCCC',
            'F4CCCC',
            'F4CCCC',
            'F4CCCC',
          ]
        ),

        h1('4. Drop-off counts on that workflow'),
        p(
          'Successful vs failed checks at each workflow gate. Source: k6 checks. 2,925 attempts with a recorded check. 21 August 2026.'
        ),
        spacer(),
        makeTable(
          ['Workflow gate', 'Succeeded', 'Failed', 'Pass rate'],
          [
            ['WS 101 (socket upgrade)', '2,921', '4', '99.86%'],
            ['STOMP + subscribe + root sent', '823', '2,102', '28.14%'],
            ['REPLY sent', '28', '2,897', '0.96%'],
            ['Sub-REPLY + cycle done', '28', '2,897', '0.96%'],
          ],
          [3600, 2200, 2200, 2800],
          ['FFF2CC', 'F4CCCC', 'F4CCCC', 'F4CCCC']
        ),

        h1('5. Why it failed — two stacked problems'),
        h2('Failure A — STOMP login (largest drop)'),
        p(
          'After HTTP 101, the client must receive a STOMP CONNECTED frame before it can subscribe or send chat. 2,102 of 2,925 checked attempts never got that frame (28.14% pass). Terminal output during minutes ~11–12 is dominated by: websocket: close 1002 (protocol error). That is the server or gateway tearing the socket down, not k6 choosing to disconnect. Send/connection errors totaled 3,513. Median session lasted 45.5 seconds against a planned 4-minute hold, so connections were not stable at 500 concurrent users.'
        ),
        h2('Failure B — root echo too slow for a thread'),
        p(
          'A reply cannot be sent until chat-service returns the root message with a server-assigned id. The script waits 15 seconds (PARENT_WAIT_MS). Root round-trip for echoes that did arrive: average 31.46s, median 31.83s, p90 57.43s, p95 59.85s, max 66s. HTML report: ws_thread_parent_timeouts = 795. That equals 823 roots sent minus 28 replies. Those 795 users posted a first message and then the thread stopped.'
        ),
        spacer(),
        p('Echo latency for messages that received a server ack (reply/sub-reply are only 28 samples):'),
        spacer(),
        makeTable(
          ['Message type', 'Average', 'p95', 'vs 15s parent wait'],
          [
            ['Root SIMPLE', '31.46 s', '59.85 s', 'Far over the wait — this is why replies stopped'],
            ['REPLY', '3.87 s', '10.91 s', 'OK, but only 28 surviving samples'],
            ['Sub-REPLY', '4.75 s', '10.21 s', 'OK, but only 28 surviving samples'],
          ],
          [2400, 2000, 2000, 4400],
          ['F4CCCC', 'D9EAD3', 'D9EAD3']
        ),

        h2('What this is not'),
        bullet('Not a client-script crash. k6 finished the 12m30s schedule and wrote the HTML report.'),
        bullet('Not “only 4 connections failed.” HTTP 101 almost always succeeded. The product failed after the socket opened.'),
        bullet('Not a pass because exit code was 0. Thresholds were only count>0 on four counters. One successful thread would satisfy them.'),

        h2('Likely backend pressure'),
        bullet('Gateway or chat-service cannot complete STOMP CONNECT for most of 500 concurrent sockets (1002 protocol closes).'),
        bullet('Persist + fan-out of group SIMPLE messages is slow when many members are in one group. Own-echo waiting on that path exceeded 15s for nearly every root.'),
        bullet('Failed users reconnect (MODE=once only idles after a full cycle), which added extra sessions (3,120 sockets across the run) on top of the original 500.'),

        h1('6. Full metric sheet from this run'),
        makeTable(
          ['Metric', 'Value', 'How to read it'],
          [
            ['checks', '26.91% (6,297 pass / 17,103 fail)', 'Overall assertion rate. Failed.'],
            ['WS status 101', '99.86% (2,921 / 4)', 'TCP/WebSocket upgrade.'],
            ['STOMP connected', '28.14% (823 / 2,102)', 'Chat protocol login.'],
            ['Subscribe both queues', '28.14% (823 / 2,102)', 'Same population as STOMP.'],
            ['Sent root SIMPLE', '28.14% (823 / 2,102)', 'First message of the thread.'],
            ['Sent REPLY', '0.96% (28 / 2,897)', 'Could not start without parent id.'],
            ['Sent sub-REPLY', '0.96% (28 / 2,897)', 'Same 28 users.'],
            ['Completed thread cycle', '0.96% (28 / 2,897)', 'Official pass condition for this script.'],
            ['ws_sessions', '3,120 (4.16/s)', 'Total sockets, not concurrent users.'],
            ['ws_connecting', 'avg 504ms, med 398ms, max 21s', 'Upgrade time. Typical is fine; tail is slow.'],
            ['ws_session_duration', 'avg 1m11s, med 45.5s, max 4m0s', 'Unstable vs planned 4 min hold.'],
            ['ws_stomp_connected', '823', 'Logins over the whole test, not at once.'],
            ['ws_group_roots_sent', '823', 'Root SIMPLE posts.'],
            ['ws_group_replies_sent', '28', 'Thread replies.'],
            ['ws_group_subreplies_sent', '28', 'Depth-3 nested replies.'],
            ['ws_thread_parent_timeouts', '795', 'Root posted, echo did not arrive in 15s.'],
            ['ws_send_errors', '3,513', 'Failed sends + socket errors including 1002.'],
            ['ws_group_messages_received', '20,856 (27.8/s)', 'Includes other users’ fan-out, not only own echoes.'],
            ['ws_msgs_sent / received', '5,641 / 24,029', 'All STOMP frames (CONNECT, SUBSCRIBE, SEND, MESSAGE).'],
            ['ws_group_root_roundtrip_ms', 'avg 31.46s, med 31.83s, p95 59.85s', 'Time to see your own root message.'],
            ['ws_group_reply_roundtrip_ms', 'avg 3.87s, p95 10.91s', 'Only 28 samples.'],
            ['ws_group_subreply_roundtrip_ms', 'avg 4.75s, p95 10.21s', 'Only 28 samples.'],
            ['iterations', '6,457 complete + 195 interrupted', 'Reconnects + 5s idle loops after the 28 completions.'],
            ['iteration_duration', 'min/med 5s, avg 35.5s, max 4m1s', '5s = idle after success; 4m1s = full VU_HOLD.'],
            ['vus / vus_max', 'max 500 / cap 500', 'Peak concurrency hit the target.'],
          ],
          [3600, 3600, 3600]
        ),

        h1('7. Message for the office group'),
        p(
          'GulfTMT stress test (21 Aug, ntmt.dev) — 500 concurrent users, nested group thread (root → reply → sub-reply), 5 min ramp up, 4 min hold, 3 min ramp down, each user sending one thread. Result: FAIL. WebSocket upgrade was 99.9%, but only 28% of sessions completed STOMP chat login, and only 28 users finished a full thread. 795 root messages never got a server echo within 15s (median own-message echo ~32s, p95 ~60s). Many sockets dropped with WebSocket 1002 protocol error. Green k6 counters only mean “at least one succeeded”; overall checks were 27% pass. Connectivity to the gateway is largely OK. Completing a threaded conversation at 500 concurrent users in one group is not. Suggested next step: find the breaking point at 50 / 100 / 200 users and have backend review STOMP CONNECT capacity plus group fan-out latency.'
        ),

        h1('8. Suggested follow-up'),
        bullet('Re-run the same script at 50, then 100, then 200 VUs (same once + simple ramp).'),
        bullet('Do not raise PARENT_WAIT_MS first — that would hide slowness rather than find the breaking point.'),
        bullet('Ask backend whether 1002 closes are gateway limits, STOMP frame rejection, or chat-service overload on a single group with 500 members posting.'),
        spacer(),
        p(
          'Source: k6 summary and reports/ws-group-reply-subreply-dynamic-500vus-once-report.html. This Word file is the shareable version of the 500-user reply-thread canvas brief.',
          { italics: true, color: '666666', size: 18 }
        ),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log('Wrote', OUT);
});
