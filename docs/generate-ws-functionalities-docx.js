const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, BorderStyle, WidthType, AlignmentType, ShadingType } = require('docx');
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
    shading: header ? headerShading : (shade ? altShading : undefined),
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
      children: row.map((v, i) => cell(v, { width: widths[i], shade: ri % 2 === 1 })),
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
    children: [new TextRun({ text, bold: true, size: 28, font: 'Calibri', color: '1F4E79' })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size: 24, font: 'Calibri', color: '2E75B6' })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, size: 20, font: 'Calibri', color: '404040' })],
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

function checkbox(text) {
  return new Paragraph({
    spacing: { after: 40 },
    indent: { left: 360 },
    children: [new TextRun({ text: `☐  ${text}`, size: 20, font: 'Calibri' })],
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

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
          spacing: { after: 80 },
          children: [
            new TextRun({
              text: 'WebSocket Stress Testing',
              bold: true,
              size: 36,
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
              text: 'Full Functionality List',
              bold: true,
              size: 32,
              font: 'Calibri',
              color: '2E75B6',
            }),
          ],
        }),
        p('Project: GulfTMT Phase 3B — Chat Service'),
        p('Source: gulfnet-tmt-backend/chat-service + Flutter client (socket_service.dart)'),
        p('STOMP endpoint: /chat'),
        p('App prefix: /app'),
        p('Date: 2026-08-04'),
        spacer(),

        h1('1. Purpose'),
        p('Current k6 coverage focuses on group SIMPLE messages only. This document lists all WebSocket-related functionalities that should be included in stress / load testing, including:'),
        bullet('Direct STOMP send actions'),
        bullet('REST actions that fan out over WebSocket'),
        bullet('Subscribe / receive channels'),
        bullet('Connection and infrastructure scenarios'),
        spacer(),

        h1('2. Current Coverage Status'),
        makeTable(
          ['Area', 'Status'],
          [
            ['Group message (SIMPLE) via /app/chat/groupMessage', 'Covered'],
            ['Subscribe /user/{groupId}/queue/reply', 'Covered'],
            ['Reply, Like, Confirm, Emoji, Private, Typing, Forward, Broadcast, Simultaneous, etc.', 'Not covered'],
          ],
          [6500, 2500]
        ),
        spacer(),

        h1('3. Direct STOMP Send Actions (Client → Server)'),
        p('These are published over WebSocket using @MessageMapping in ChatController.'),
        spacer(),
        makeTable(
          ['#', 'Functionality', 'STOMP Destination', 'Message / Payload Notes', 'Priority'],
          [
            ['1', 'Group message (SIMPLE)', '/app/chat/groupMessage', 'messageType: SIMPLE', 'P0 — done'],
            ['2', 'Private / 1:1 message', '/app/chat/privateMessage', 'Sender + receiver conversation', 'P0'],
            ['3', 'Reply', '/app/chat/groupMessage or /app/chat/privateMessage', 'messageType: REPLY + repliedOnChatId', 'P0'],
            ['4', 'Broadcast message', '/app/chat/broadcastMessage', 'Fans out to multiple groups', 'P1'],
            ['5', 'Forward message', '/app/chat/forwardMessage', 'Targets contacts and/or groups', 'P1'],
            ['6', 'Simultaneous message', '/app/chat/simultaneousMessage', 'Many-to-many (contacts + groups)', 'P1'],
            ['7', 'Typing indicator', '/app/typing', 'Broadcasts to /topic/typing', 'P0'],
          ],
          [600, 2200, 2800, 2600, 1200]
        ),
        spacer(),

        h2('3.1 MessageType Enum Values'),
        makeTable(
          ['MessageType', 'Description', 'Typical Send Path'],
          [
            ['SIMPLE', 'Normal text / media message', 'group / private'],
            ['REPLY', 'Reply to an existing message', 'group / private'],
            ['FORWARD', 'Forwarded message', '/app/chat/forwardMessage'],
            ['BROADCAST', 'Broadcast to selected groups', '/app/chat/broadcastMessage'],
            ['SIMULTANEOUS', 'Same message to many destinations', '/app/chat/simultaneousMessage'],
            ['THANKYOU', 'Thank-you message', 'via chat / thank-you flow'],
            ['FORM', 'Form submission message', 'form APIs → WS delivery'],
          ],
          [2200, 3600, 3200]
        ),
        spacer(),

        h1('4. REST Actions That Stress WebSocket Fan-Out'),
        p('These are triggered by HTTP, but updates are published to Kafka and delivered over WebSocket (/queue/reply and related queues). Stress tests must assert WS delivery, not only HTTP success.'),
        spacer(),
        makeTable(
          ['#', 'Functionality', 'API', 'What to Validate on WebSocket', 'Priority'],
          [
            ['8', 'Like / unlike', 'PATCH /read-receipt/isLiked', 'Updated likeCount on subscribers', 'P0'],
            ['9', 'Confirm / unconfirm', 'PATCH /read-receipt/isConfirmed', 'Updated confirmCount on subscribers', 'P0'],
            ['10', 'Add / change / remove emoji', 'POST /emoji-reaction', 'Toggle / replace reaction; live update', 'P0'],
            ['11', 'Mark as read', 'GET /read-receipt/status/', 'Read status + home refresh', 'P2'],
            ['12', 'Star / unstar', 'PATCH /read-receipt/isStarred', 'Starred state updates', 'P2'],
            ['13', 'Delete for me', 'PATCH /read-receipt/isDeleted?forEveryone=false', 'Delete event for user', 'P1'],
            ['14', 'Delete for everyone', 'PATCH /read-receipt/isDeleted?forEveryone=true', 'Delete fan-out to all members', 'P1'],
            ['15', 'Edit message', 'PATCH /editChat', 'Edited content broadcast', 'P1'],
            ['16', 'Approval stamp', 'POST /chat-approval', 'Stamp details on message', 'P2'],
            ['17', 'Undo approval stamp', 'DELETE /chat-approval', 'Stamp removed update', 'P2'],
            ['18', 'Form submission message', 'Form submit APIs → messageType=FORM', 'FORM message delivery over WS', 'P2'],
          ],
          [600, 2200, 3000, 2600, 1000]
        ),
        spacer(),

        h2('4.1 Related Read-Only APIs (Optional Under Load)'),
        makeTable(
          ['Functionality', 'API', 'Notes'],
          [
            ['Liked members list', 'GET /read-receipt/likedmessage-members', 'REST only'],
            ['Confirmed members list', 'GET /read-receipt/confirmedmessage-members', 'REST only'],
            ['Emoji reacted members', 'GET /emoji-reaction/emoji-reacted-members', 'REST only'],
            ['Starred messages', 'GET /read-receipt/starredMessages', 'REST only'],
            ['Unread count', 'GET /read-receipt/unread-count/', 'REST only'],
          ],
          [2800, 4200, 2000]
        ),
        spacer(),

        h1('5. Subscribe / Receive Channels (Server → Client)'),
        p('Stress testing is incomplete if VUs only send and never measure receive fan-out.'),
        spacer(),
        makeTable(
          ['#', 'Channel', 'Purpose', 'Priority'],
          [
            ['19', '/user/{groupId}/queue/reply', 'Group message delivery', 'P0'],
            ['20', '/user/{userId}/queue/reply/{conversationId}', 'Private message delivery', 'P0'],
            ['21', '/user/{userId}/queue/reply', 'User-level reply (simultaneous / some group paths)', 'P1'],
            ['22', '/topic/typing', 'Typing indicator fan-out', 'P0'],
            ['23', '/topic/conversationUpdate', 'Conversation list updates', 'P1'],
            ['24', '/user/{userId}/queue/home-screen-refresh', 'Home screen refresh', 'P2'],
            ['25', '/user/{userId}/queue/latest-group-messages-refresh', 'Latest group feed refresh', 'P2'],
            ['26', '/user/{userId}/queue/conversation-settings/{conversationId}', 'Pin / delete / settings sync', 'P2'],
          ],
          [600, 4200, 3200, 1000]
        ),
        spacer(),

        h1('6. Connection and Infrastructure Scenarios'),
        makeTable(
          ['#', 'Scenario', 'Why It Matters', 'Priority'],
          [
            ['27', 'Connect / disconnect / reconnect', 'STOMP handshake + auth under load', 'P0'],
            ['28', 'Heartbeat (send 10s / expect 20s)', 'Idle connection stability', 'P1'],
            ['29', 'Subscribe / unsubscribe churn', 'Broker subscription table pressure', 'P1'],
            ['30', 'Mixed traffic (send + react + type together)', 'Realistic user mix', 'P0'],
            ['31', 'Simultaneous copy propagation', 'Like / emoji / reply mirrored across linked copies', 'P1'],
          ],
          [600, 3600, 4000, 1000]
        ),
        spacer(),

        h1('7. Complete Checklist (All Functionalities)'),
        p('Use this as the master checklist for WebSocket stress coverage.'),
        spacer(),

        h3('A. Messaging (STOMP)'),
        checkbox('Group SIMPLE message'),
        checkbox('Private SIMPLE message'),
        checkbox('Reply (REPLY) — group'),
        checkbox('Reply (REPLY) — private'),
        checkbox('Forward message'),
        checkbox('Broadcast message'),
        checkbox('Simultaneous message'),
        checkbox('Thank-you message (THANKYOU)'),
        checkbox('Form message delivery (FORM)'),
        checkbox('Typing start / stop'),
        spacer(),

        h3('B. Reactions & Acknowledgements (REST → WS)'),
        checkbox('Like message'),
        checkbox('Unlike / cancel like'),
        checkbox('Confirm message'),
        checkbox('Unconfirm / cancel confirm'),
        checkbox('Add emoji reaction'),
        checkbox('Change emoji reaction'),
        checkbox('Remove emoji reaction (toggle off)'),
        spacer(),

        h3('C. Message Lifecycle (REST → WS)'),
        checkbox('Edit message'),
        checkbox('Delete for me'),
        checkbox('Delete for everyone'),
        checkbox('Mark as read'),
        checkbox('Star message'),
        checkbox('Unstar message'),
        checkbox('Add approval stamp'),
        checkbox('Undo approval stamp'),
        spacer(),

        h3('D. Receive / Subscribe Under Load'),
        checkbox('Group /queue/reply receive latency & loss'),
        checkbox('Private /queue/reply/{conversationId} receive'),
        checkbox('Typing topic receive'),
        checkbox('Conversation update topic'),
        checkbox('Home-screen refresh queue'),
        checkbox('Latest-group-messages refresh queue'),
        checkbox('Conversation-settings queue'),
        spacer(),

        h3('E. Connection / Reliability'),
        checkbox('Mass connect'),
        checkbox('Disconnect / reconnect storms'),
        checkbox('Heartbeat under idle load'),
        checkbox('Subscribe / unsubscribe churn'),
        checkbox('Mixed workload (messages + likes + confirms + emoji + typing)'),
        checkbox('Simultaneous destination propagation under load'),
        spacer(),

        h1('8. Recommended k6 Rollout Order'),
        h3('Phase P0 (Next)'),
        bullet('1. Reply (REPLY)'),
        bullet('2. Like'),
        bullet('3. Confirm'),
        bullet('4. Emoji reaction'),
        bullet('5. Private message'),
        bullet('6. Typing'),
        spacer(),
        h3('Phase P1'),
        bullet('7. Forward'),
        bullet('8. Broadcast'),
        bullet('9. Simultaneous'),
        bullet('10. Delete for everyone'),
        bullet('11. Edit message'),
        bullet('12. Heartbeat / reconnect / mixed traffic'),
        spacer(),
        h3('Phase P2'),
        bullet('13. Read receipt'),
        bullet('14. Star / unstar'),
        bullet('15. Approval stamp'),
        bullet('16. Thank-you message'),
        bullet('17. Form message'),
        bullet('18. Home / conversation refresh channels'),
        spacer(),

        h1('9. Test Design Notes'),
        bullet('Send path: Use STOMP /app/... for messages, typing, forward, broadcast, and simultaneous.'),
        bullet('Reaction path: Use REST for like / confirm / emoji, then assert the update arrives on /user/.../queue/reply.'),
        bullet('Fan-out measurement: Keep all group VUs subscribed to /user/{groupId}/queue/reply so stress measures broadcast delivery, not only publish success.'),
        bullet('Checks: STOMP CONNECT success rate; SEND success rate; receive latency on /queue/reply; reaction update latency after REST; error / disconnect rate.'),
        bullet('Existing scripts: Scripts/ws-group-message-dynamic.js, ws-group-message-500-users.js, ws-group-message-500-users-once.js, ws-group-message.js'),
        spacer(),

        h1('10. Backend Reference Map'),
        makeTable(
          ['Component', 'Location'],
          [
            ['STOMP mappings', 'chat-service/.../controller/ChatController.java'],
            ['WebSocket config', 'chat-service/.../config/WebSocketConfig.java'],
            ['Message types', 'chat-service/.../util/enums/MessageType.java'],
            ['Like / confirm / read / delete / star', 'chat-service/.../controller/ReadReceiptController.java'],
            ['Emoji reactions', 'chat-service/.../controller/EmojiReactionDetailsController.java'],
            ['Approval stamps', 'chat-service/.../controller/ChatApprovalController.java'],
            ['Flutter destinations', 'gulfnet-tmt-mobile/lib/helper/socket_service.dart'],
          ],
          [3500, 5500]
        ),
        spacer(),

        h2('10.1 STOMP Send Destinations'),
        bullet('/app/typing'),
        bullet('/app/chat/privateMessage'),
        bullet('/app/chat/groupMessage'),
        bullet('/app/chat/broadcastMessage'),
        bullet('/app/chat/forwardMessage'),
        bullet('/app/chat/simultaneousMessage'),
        spacer(),

        h2('10.2 Primary Subscribe Destinations'),
        bullet('/user/{groupId}/queue/reply'),
        bullet('/user/{userId}/queue/reply/{conversationId}'),
        bullet('/user/{userId}/queue/reply'),
        bullet('/topic/typing'),
        bullet('/topic/conversationUpdate'),
        bullet('/user/{userId}/queue/home-screen-refresh'),
        bullet('/user/{userId}/queue/latest-group-messages-refresh'),
        bullet('/user/{userId}/queue/conversation-settings/{conversationId}'),
        spacer(),

        h1('11. Document History'),
        makeTable(
          ['Date', 'Change'],
          [
            ['2026-08-04', 'Initial list of all WebSocket stress-test functionalities derived from chat-service + Flutter client'],
          ],
          [2000, 7000]
        ),
      ],
    },
  ],
});

const outPath = path.join(__dirname, 'WebSocket-Stress-Test-Functionalities.docx');
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log('Created:', outPath);
});
