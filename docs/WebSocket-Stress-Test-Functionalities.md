# WebSocket Stress Testing — Full Functionality List

**Project:** GulfTMT Phase 3B — Chat Service  
**Source:** `gulfnet-tmt-backend/chat-service` + Flutter client (`socket_service.dart`)  
**STOMP endpoint:** `/chat`  
**App prefix:** `/app`  
**Date:** 2026-08-04  

---

## Purpose

Current k6 coverage focuses on **group SIMPLE messages** only. This document lists **all** WebSocket-related functionalities that should be included in stress / load testing, including:

1. Direct STOMP send actions  
2. REST actions that fan out over WebSocket  
3. Subscribe / receive channels  
4. Connection and infrastructure scenarios  

---

## Current coverage status

| Area | Status |
|------|--------|
| Group message (`SIMPLE`) via `/app/chat/groupMessage` | Covered |
| Subscribe `/user/{groupId}/queue/reply` | Covered |
| Reply, Like, Confirm, Emoji, Private, Typing, Forward, Broadcast, Simultaneous, etc. | Not covered |

---

## 1. Direct STOMP send actions (client → server)

These are published over WebSocket using `@MessageMapping` in `ChatController`.

| # | Functionality | STOMP destination | Message / payload notes | Priority |
|---|---------------|-------------------|-------------------------|----------|
| 1 | **Group message (SIMPLE)** | `/app/chat/groupMessage` | `messageType: SIMPLE` | P0 — done |
| 2 | **Private / 1:1 message** | `/app/chat/privateMessage` | Sender + receiver conversation | P0 |
| 3 | **Reply** | `/app/chat/groupMessage` or `/app/chat/privateMessage` | `messageType: REPLY` + `repliedOnChatId` | P0 |
| 4 | **Broadcast message** | `/app/chat/broadcastMessage` | Fans out to multiple groups | P1 |
| 5 | **Forward message** | `/app/chat/forwardMessage` | Targets contacts and/or groups | P1 |
| 6 | **Simultaneous message** | `/app/chat/simultaneousMessage` | Many-to-many (contacts + groups) | P1 |
| 7 | **Typing indicator** | `/app/typing` | Broadcasts to `/topic/typing` | P0 |

### MessageType enum values (on chat payloads)

| MessageType | Description | Typical send path |
|-------------|-------------|-------------------|
| `SIMPLE` | Normal text / media message | group / private |
| `REPLY` | Reply to an existing message | group / private |
| `FORWARD` | Forwarded message | `/app/chat/forwardMessage` |
| `BROADCAST` | Broadcast to selected groups | `/app/chat/broadcastMessage` |
| `SIMULTANEOUS` | Same message to many destinations | `/app/chat/simultaneousMessage` |
| `THANKYOU` | Thank-you message | via chat / thank-you flow |
| `FORM` | Form submission message | form APIs → WS delivery |

---

## 2. REST actions that stress WebSocket fan-out

These are triggered by **HTTP**, but updates are published to Kafka and delivered over WebSocket (`/queue/reply` and related queues). Stress tests must assert **WS delivery**, not only HTTP success.

| # | Functionality | API | What to validate on WebSocket | Priority |
|---|---------------|-----|-------------------------------|----------|
| 8 | **Like / unlike** | `PATCH /read-receipt/isLiked` | Updated `likeCount` on subscribers | P0 |
| 9 | **Confirm / unconfirm** | `PATCH /read-receipt/isConfirmed` | Updated `confirmCount` on subscribers | P0 |
| 10 | **Add / change / remove emoji** | `POST /emoji-reaction` | Toggle / replace reaction; live update | P0 |
| 11 | **Mark as read** | `GET /read-receipt/status/` | Read status + home refresh | P2 |
| 12 | **Star / unstar** | `PATCH /read-receipt/isStarred` | Starred state updates | P2 |
| 13 | **Delete for me** | `PATCH /read-receipt/isDeleted?forEveryone=false` | Delete event for user | P1 |
| 14 | **Delete for everyone** | `PATCH /read-receipt/isDeleted?forEveryone=true` | Delete fan-out to all members | P1 |
| 15 | **Edit message** | `PATCH /editChat` | Edited content broadcast | P1 |
| 16 | **Approval stamp** | `POST /chat-approval` | Stamp details on message | P2 |
| 17 | **Undo approval stamp** | `DELETE /chat-approval` | Stamp removed update | P2 |
| 18 | **Form submission message** | Form submit APIs → `messageType=FORM` | FORM message delivery over WS | P2 |

### Related read-only APIs (optional under load)

| Functionality | API | Notes |
|---------------|-----|-------|
| Liked members list | `GET /read-receipt/likedmessage-members` | REST only |
| Confirmed members list | `GET /read-receipt/confirmedmessage-members` | REST only |
| Emoji reacted members | `GET /emoji-reaction/emoji-reacted-members` | REST only |
| Starred messages | `GET /read-receipt/starredMessages` | REST only |
| Unread count | `GET /read-receipt/unread-count/` | REST only |

---

## 3. Subscribe / receive channels (server → client)

Stress testing is incomplete if VUs only send and never measure receive fan-out.

| # | Channel | Purpose | Priority |
|---|---------|---------|----------|
| 19 | `/user/{groupId}/queue/reply` | Group message delivery | P0 |
| 20 | `/user/{userId}/queue/reply/{conversationId}` | Private message delivery | P0 |
| 21 | `/user/{userId}/queue/reply` | User-level reply (simultaneous / some group paths) | P1 |
| 22 | `/topic/typing` | Typing indicator fan-out | P0 |
| 23 | `/topic/conversationUpdate` | Conversation list updates | P1 |
| 24 | `/user/{userId}/queue/home-screen-refresh` | Home screen refresh | P2 |
| 25 | `/user/{userId}/queue/latest-group-messages-refresh` | Latest group feed refresh | P2 |
| 26 | `/user/{userId}/queue/conversation-settings/{conversationId}` | Pin / delete / settings sync | P2 |

---

## 4. Connection and infrastructure scenarios

| # | Scenario | Why it matters | Priority |
|---|----------|----------------|----------|
| 27 | **Connect / disconnect / reconnect** | STOMP handshake + auth under load | P0 |
| 28 | **Heartbeat** (send 10s / expect 20s) | Idle connection stability | P1 |
| 29 | **Subscribe / unsubscribe churn** | Broker subscription table pressure | P1 |
| 30 | **Mixed traffic** (send + react + type together) | Realistic user mix | P0 |
| 31 | **Simultaneous copy propagation** | Like / emoji / reply mirrored across linked copies | P1 |

---

## 5. Complete checklist (all functionalities)

Use this as the master checklist for WebSocket stress coverage.

### A. Messaging (STOMP)

- [ ] Group SIMPLE message  
- [ ] Private SIMPLE message  
- [ ] Reply (`REPLY`) — group  
- [ ] Reply (`REPLY`) — private  
- [ ] Forward message  
- [ ] Broadcast message  
- [ ] Simultaneous message  
- [ ] Thank-you message (`THANKYOU`)  
- [ ] Form message delivery (`FORM`)  
- [ ] Typing start / stop  

### B. Reactions & acknowledgements (REST → WS)

- [ ] Like message  
- [ ] Unlike / cancel like  
- [ ] Confirm message  
- [ ] Unconfirm / cancel confirm  
- [ ] Add emoji reaction  
- [ ] Change emoji reaction  
- [ ] Remove emoji reaction (toggle off)  

### C. Message lifecycle (REST → WS)

- [ ] Edit message  
- [ ] Delete for me  
- [ ] Delete for everyone  
- [ ] Mark as read  
- [ ] Star message  
- [ ] Unstar message  
- [ ] Add approval stamp  
- [ ] Undo approval stamp  

### D. Receive / subscribe under load

- [ ] Group `/queue/reply` receive latency & loss  
- [ ] Private `/queue/reply/{conversationId}` receive  
- [ ] Typing topic receive  
- [ ] Conversation update topic  
- [ ] Home-screen refresh queue  
- [ ] Latest-group-messages refresh queue  
- [ ] Conversation-settings queue  

### E. Connection / reliability

- [ ] Mass connect  
- [ ] Disconnect / reconnect storms  
- [ ] Heartbeat under idle load  
- [ ] Subscribe / unsubscribe churn  
- [ ] Mixed workload (messages + likes + confirms + emoji + typing)  
- [ ] Simultaneous destination propagation under load  

---

## 6. Recommended k6 rollout order

### Phase P0 (next)

1. Reply (`REPLY`)  
2. Like  
3. Confirm  
4. Emoji reaction  
5. Private message  
6. Typing  

### Phase P1

7. Forward  
8. Broadcast  
9. Simultaneous  
10. Delete for everyone  
11. Edit message  
12. Heartbeat / reconnect / mixed traffic  

### Phase P2

13. Read receipt  
14. Star / unstar  
15. Approval stamp  
16. Thank-you message  
17. Form message  
18. Home / conversation refresh channels  

---

## 7. Test design notes

1. **Send path**  
   Use STOMP `/app/...` for messages, typing, forward, broadcast, and simultaneous.

2. **Reaction path**  
   Use REST for like / confirm / emoji, then assert the update arrives on `/user/.../queue/reply`.

3. **Fan-out measurement**  
   Keep all group VUs subscribed to `/user/{groupId}/queue/reply` so stress measures **broadcast delivery**, not only publish success.

4. **Meaningful checks**  
   - STOMP CONNECT success rate  
   - SEND / publish success rate  
   - Receive rate and latency on `/queue/reply`  
   - Reaction update delivery latency after REST call  
   - Error / disconnect rate under peak VU  

5. **Existing scripts (reference)**  
   - `Scripts/ws-group-message-dynamic.js`  
   - `Scripts/ws-group-message-500-users.js`  
   - `Scripts/ws-group-message-500-users-once.js`  
   - `Scripts/ws-group-message.js`  

---

## 8. Backend reference map

| Component | Location |
|-----------|----------|
| STOMP mappings | `chat-service/.../controller/ChatController.java` |
| WebSocket config | `chat-service/.../config/WebSocketConfig.java` |
| Message types | `chat-service/.../util/enums/MessageType.java` |
| Like / confirm / read / delete / star | `chat-service/.../controller/ReadReceiptController.java` |
| Emoji reactions | `chat-service/.../controller/EmojiReactionDetailsController.java` |
| Approval stamps | `chat-service/.../controller/ChatApprovalController.java` |
| Flutter destinations | `gulfnet-tmt-mobile/lib/helper/socket_service.dart` |

### STOMP send destinations (summary)

```
/app/typing
/app/chat/privateMessage
/app/chat/groupMessage
/app/chat/broadcastMessage
/app/chat/forwardMessage
/app/chat/simultaneousMessage
```

### Primary subscribe destinations (summary)

```
/user/{groupId}/queue/reply
/user/{userId}/queue/reply/{conversationId}
/user/{userId}/queue/reply
/topic/typing
/topic/conversationUpdate
/user/{userId}/queue/home-screen-refresh
/user/{userId}/queue/latest-group-messages-refresh
/user/{userId}/queue/conversation-settings/{conversationId}
```

---

## Document history

| Date | Change |
|------|--------|
| 2026-08-04 | Initial list of all WebSocket stress-test functionalities derived from chat-service + Flutter client |
