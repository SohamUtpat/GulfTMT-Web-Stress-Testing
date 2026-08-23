# GulfTMT WebSocket Stress Testing (k6)

k6 load tests for **GulfTMT Phase 3B** chat service over **STOMP / WebSocket**.  
Scripts live in `Scripts/` and are configured at run time with environment variables — no need to edit the script for different VU counts, durations, or modes.

---

## Prerequisites

1. **[k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)** installed and on your `PATH`.
2. Run all commands from the **project root** (`Stress-Testing GulfTMT/`).
3. Required data files:
   - `data/users_result.json` — test users with valid `sender_token` (supports ~30k users).
   - `data/group-chat.json` — target group, conversation, and WebSocket URL.

Test users should be **members of the target group** so receive fan-out behaves realistically.

---

## Project layout

```
Stress-Testing GulfTMT/
├── Scripts/
│   ├── ws-group-message-dynamic.js          # Group SIMPLE messages
│   ├── ws-group-reply-subreply-dynamic.js   # Root → reply → sub-reply threads
│   ├── check-group-membership.js            # Point 7: fail if VU users are not in the test group
│   └── lib/
│       ├── echo-correlation.js              # Own-echo matching (server ids on REPLY)
│       ├── group-membership.js              # setup() membership pre-check
│       ├── ws-send-error.js                 # Send vs teardown error classification
│       ├── k6-scenario.js                   # Duration / scenario-length helpers
│       └── send-order.js                    # sequential vs parallel first-send timing
├── data/
│   ├── users_result.json                    # User tokens (sensitive)
│   ├── group-chat.json                      # Group / WS endpoint config
│   └── sql/
│       └── ensure-stress-users-in-test-group.sql  # Add missing USER_GROUP rows
├── reports/                                 # HTML reports (auto-generated)
└── docs/
    └── WebSocket-Stress-Test-Functionalities.md
```

---

## Scripts

| Script | What it tests |
|--------|----------------|
| `ws-group-message-dynamic.js` | Sends group **SIMPLE** messages to `/app/chat/groupMessage`, subscribes to `/user/queue/reply`. |
| `ws-group-reply-subreply-dynamic.js` | Drives a **3-level thread** per VU: root SIMPLE → REPLY → sub-REPLY (backend max thread depth = 3). Subscribes to `/user/queue/reply` and `/user/{groupId}/queue/reply`. |

Both scripts share the same ramp, auth, and VU-to-user mapping: **1 VU = 1 unique user** (up to the token count in `users_result.json`).

By default **`SEND_ORDER=parallel`** (burst): each user posts as soon as their WebSocket is connected. That is the load-test pattern. Pass `-e SEND_ORDER=sequential` only when you want a readable 1, then 2, then 3 timeline — that mode is **not** a concurrent stress burst. When sequential is on and you do not set `RAMP_STYLE`, the scripts use a fast `simple` ramp (`RAMP_UP=10s`) so all users are connected before the ordered wave starts.

---

## Basic command format

```powershell
k6 run -e VUS=<number> -e HOLD=<duration> -e MODE=<mode> Scripts/<script-name>.js
```

**PowerShell / Windows** — use the same `-e KEY=value` flags as shown above.

**Linux / macOS** — same syntax:

```bash
k6 run -e VUS=500 -e HOLD=4m -e MODE=continuous Scripts/ws-group-message-dynamic.js
```

---

## Environment variables

### Core (both scripts)

| Variable | Default | Description |
|----------|---------|-------------|
| `VUS` | `500` | Peak concurrent virtual users. Must be ≤ number of tokens in `users_result.json`. |
| `HOLD` | `4m` | Time at **peak** VUs during the hold stage. k6 duration format: `30s`, `4m`, `1h30m`. |
| `MODE` | `continuous` | `continuous` — keep sending on an interval. `once` — each VU sends one cycle then idles. |
| `RAMP_STYLE` | `simple` when sequential and unset; otherwise `scaled` | `scaled` — stepped ramp (20% → 40% → 80% → 100%). `simple` — single ramp-up → hold → ramp-down. Sequential opt-in still defaults to `simple`. |
| `RAMP_UP` | `10s` sequential opt-in; `5m` otherwise | Ramp-up duration when `RAMP_STYLE=simple`. |
| `RAMP_DOWN` | `15s` sequential opt-in; `3m` otherwise | Ramp-down duration when `RAMP_STYLE=simple`. |
| `VU_HOLD_MS` | Group message: `55000` continuous / `240000` once. Reply script: at least one full thread under `PARENT_WAIT_MS` (and not below those floors). Sequential adds ramp-up + last-VU stagger. | How long each VU keeps the WebSocket open per iteration (milliseconds). Defaults are **not** capped to the scenario length — a short smoke `HOLD` can finish before `VU_HOLD_MS`, which is expected. k6 then tears sockets down first; `Session closed` / WS 1002 are excluded from `ws_send_error_rate`. Scripts log a warning when `VU_HOLD_MS` exceeds the scenario. Optionally set `VU_HOLD_MS` shorter than `RAMP_UP + HOLD + RAMP_DOWN` if you want a clean STOMP `DISCONNECT` instead. |
| `MSG_INTERVAL_MS` | `3000` | Pause between sends (group message) or between completed thread cycles (reply script) in **continuous** mode. |
| `SEND_ORDER` | `parallel` | `parallel` — every VU sends as soon as it connects (burst / load test). `sequential` — user 1 posts, then user 2, then user 3 (`SEND_STAGGER_MS` apart). Use sequential only for an ordered timeline, not for stress. |
| `SEND_STAGGER_MS` | `300` | Gap between sequential first sends. Ignored when `SEND_ORDER=parallel`. |
| `CHECK_GROUP_MEMBERSHIP` | `true` | Before any WebSocket, fail the run if any of the first `VUS` token users are not members of `group-chat.json` `groupId`. Stops reply/echo failures from being blamed on chat when the cause is missing `USER_GROUP` rows. Set `false` / `skip` to disable. |
| `HTTP_BASE_URL` | derived from `wsUrl` | API gateway origin for the membership GET (e.g. `https://api.ntmt.dev.gulftmt.com`). |

### Group membership (Point 7)

Every stress user used by a run **must** be a member of the test group in `data/group-chat.json`. Chat-service will still accept some sends, but replies, fan-out, and “own echo” checks fail in ways that look like a chat bug.

**Fix in DB (idempotent):** run `data/sql/ensure-stress-users-in-test-group.sql` on UAT. It inserts missing `USER_GROUP` rows for `stresstest%` users into group `0a14c4b7-2a03-419d-a32a-60df68e7d5dc`.

**Fail-fast in k6:** both load scripts call this in `setup()` (once, before VUs). Or check without load:

```powershell
k6 run -e VUS=500 Scripts/check-group-membership.js
k6 run -e VUS=30000 Scripts/check-group-membership.js
```

If the check fails, fix membership with the SQL (or the admin **Add users to group** API) and re-run. Do not raise chat timeouts to hide missing members.

### Reply / sub-reply script only

| Variable | Default | Description |
|----------|---------|-------------|
| `STEP_GAP_MS` | `800` | Pause after a parent echo before sending reply or sub-reply. |
| `WAIT_MODE` | `diagnostic` | `diagnostic` — longer parent wait so late echoes are visible. `slo` — product SLO wait (15s). Alias: `STRICT_SLO=true` → `slo`. |
| `PARENT_WAIT_MS` | `60000` (diagnostic) / `15000` (slo) | Max wait for a parent echo before abandoning that cycle. Explicit value always overrides the mode default. |
| `STRICT_SLO` | `false` | `true` / `1` / `yes` selects `WAIT_MODE=slo` when `WAIT_MODE` is omitted. |

Raising `PARENT_WAIT_MS` only improves **measurement**. It does **not** make chat-service faster. Under 500-VU load, root echo has been ~32s average / ~60s p95 — a 15s wait will time out most threads even when the backend still delivers later.

When `VU_HOLD_MS` is omitted, the reply script sizes the socket hold to at least one full 3-level thread (`3 × PARENT_WAIT_MS + step gaps`). Set `VU_HOLD_MS` yourself only if you know it is long enough for the wait mode you chose.

### Quality-gate thresholds (both scripts)

These replace the old `count>0` counters. A run where only a handful of users succeed **fails** (non-zero exit). Values may be `0–1` or percent (`95` = `0.95`).

| Variable | Default | Script | Meaning |
|----------|---------|--------|---------|
| `STOMP_CONNECT_RATE_MIN` | `0.95` | both | Min rate of STOMP `CONNECTED` / VU iterations that attempted `ws.connect`. |
| `THREAD_CYCLE_RATE_MIN` | `0.90` | reply | Min rate of **completed** root→reply→sub-reply cycles / (completed + abandoned). Abandoned = parent timeout, send failure, or disconnect while still waiting. Late echoes are **not** completions. |
| `ECHO_RATE_MIN` | `0.90` | group message | Min rate of own echoes received / (echoes received + pending sends older than 10s at disconnect). In-flight sends at close are excluded so they do not look like failures. |
| `SEND_ERROR_RATE_MAX` | `0.05` | both | Max rate of **real** chat SEND / STOMP / WS errors / (successful chat sends + those errors). End-of-test `Session closed` and WebSocket close **1002** are **not** included (see below). |
| `PARENT_TIMEOUT_RATE_MAX` | `0.10` | reply | Max rate of parent-wait timeouts / (in-time parent echoes + timeouts). |
| `ROOT_RTT_P95_MS` | `PARENT_WAIT_MS` in slo; off in diagnostic | reply | Optional p95 root round-trip SLO (ms). `0` disables. |
| `MSG_RTT_P95_MS` | off (`0`) | group message | Optional p95 send→echo SLO (ms). `0` disables. |

---

## What “pass” means (exit code)

k6 **exit code 0 means thresholds passed**, not that the product is healthy in a qualitative sense — and it is no longer a `count>0` “anything succeeded once” gate.

| Exit | Meaning |
|------|---------|
| `0` | Every configured **rate / p95** threshold passed. HTML report is still written. |
| non-zero (typically `99`) | At least one threshold failed. HTML report is still written — read it. |

A run in which only a tiny fraction of users connect or complete a thread **must fail**. Example: 27% checks with a few successful STOMP connections used to exit 0 because `ws_stomp_connected: count>0` was enough. That is no longer true.

**Do not** treat a green run as a capacity pass if you only increased `PARENT_WAIT_MS` (diagnostic mode). That wait is a measurement window, not an SLO.

---

## Parent wait: SLO vs diagnostic (reply script)

Under known 500-VU load, root echo was ~32s average / ~60s p95. The old default of **15s** abandoned most threads even when chat-service delivered later.

| Mode | How to select | Default `PARENT_WAIT_MS` | Use when |
|------|----------------|--------------------------|----------|
| **Diagnostic** (default) | omit flags, or `-e WAIT_MODE=diagnostic` | `60000` (60s) | Capacity diagnosis — count late arrivals; see `ws_thread_late_echoes`. |
| **Product SLO** | `-e STRICT_SLO=true` or `-e WAIT_MODE=slo` | `15000` (15s) | Pass/fail against a 15s parent-echo SLO. Also enables p95 root RTT ≤ wait unless you override `ROOT_RTT_P95_MS`. |

Override the wait in either mode:

```powershell
k6 run -e PARENT_WAIT_MS=90000 ...   # even longer diagnostic window
k6 run -e STRICT_SLO=true -e PARENT_WAIT_MS=15000 ...
```

Late echoes (`ws_thread_late_echoes` / `ws_thread_late_echo_ms`) mean: **k6 already timed out this cycle, but the message did arrive**. They are **not** counted as completed-thread success.

---

## Modes

### `MODE=continuous`

- VUs connect, send repeatedly, then disconnect after `VU_HOLD_MS`.
- **Group message script:** sends a new SIMPLE message every `MSG_INTERVAL_MS`.
- **Reply script:** completes root → reply → sub-reply cycles, then waits `MSG_INTERVAL_MS` before the next cycle.
- Best for sustained load and throughput testing.

### `MODE=once`

- Each VU sends **exactly one** message (group script) or **one full thread cycle** (reply script), then idles until the connection closes.
- **Reply script:** after a parent timeout (or after the first root is sent), the VU does **not** reconnect and start another root. Extra once-mode iterations only `sleep`.
- Uses a longer default `VU_HOLD_MS` (4 minutes) so echoes can arrive before disconnect.
- Best for spike / burst tests (e.g. 1000 users each send once).
- A short `HOLD` (e.g. 1m) is fine for a smoke run. You do **not** need `VU_HOLD_MS ≤ scenario duration` to pass `ws_send_error_rate` — unclean teardown is excluded from that gate. Optionally still set `VU_HOLD_MS` shorter if you want a clean STOMP `DISCONNECT` instead of k6 killing the socket.

---

## Ramp styles and total duration

### `RAMP_STYLE=scaled` (default)

Fixed shape (~5 min ramp-up, your `HOLD`, ~3 min ramp-down):

| Stage | Duration | Target VUs |
|-------|----------|------------|
| Ramp | 1m | 20% of `VUS` |
| Ramp | 1m | 40% |
| Ramp | 1m | 80% |
| Ramp | 2m | 100% (`VUS`) |
| **Hold** | **`HOLD`** | **`VUS`** |
| Ramp down | 1m | 60% |
| Ramp down | 1m | 20% |
| Ramp down | 1m | 0 |

**Approximate total runtime:** `8m + HOLD + gracefulRampDown`  
(`gracefulRampDown` is 30s for continuous, 60s for once)

### `RAMP_STYLE=simple`

Single climb → hold → descend:

**Approximate total runtime:** `RAMP_UP + HOLD + RAMP_DOWN + gracefulRampDown`

---

## Example commands

### Quick smoke test (1 user, short run)

```powershell
k6 run -e VUS=1 -e HOLD=30s -e MODE=once -e RAMP_STYLE=simple -e RAMP_UP=1s -e RAMP_DOWN=1s -e STRICT_SLO=true -e VU_HOLD_MS=50000 Scripts/ws-group-reply-subreply-dynamic.js
```

### Group messages — sequential order (1, then 2, then 3)

Opt-in only. After a 10s ramp, each user waits `(VU-1) × 300ms` before the first send. Keep `HOLD` long enough for the last user plus thread waits — sequential is not a load burst.

```powershell
k6 run -e SEND_ORDER=sequential -e VUS=100 -e HOLD=6m -e MODE=once Scripts/ws-group-reply-subreply-dynamic.js
```

Same for SIMPLE group messages:

```powershell
k6 run -e SEND_ORDER=sequential -e VUS=100 -e HOLD=4m -e MODE=once Scripts/ws-group-message-dynamic.js
```

### Group messages — continuous load (500 users, 4 min at peak)

```powershell
k6 run -e VUS=500 -e HOLD=4m -e MODE=continuous Scripts/ws-group-message-dynamic.js
```

### Group messages — one message per user (1000 users)

```powershell
k6 run -e VUS=1000 -e HOLD=5m -e MODE=once Scripts/ws-group-message-dynamic.js
```

### Reply + sub-reply threads — continuous (500 users)

```powershell
k6 run -e VUS=500 -e HOLD=4m -e MODE=continuous Scripts/ws-group-reply-subreply-dynamic.js
```

### Reply + sub-reply — burst / once (900 users)

```powershell
k6 run -e VUS=900 -e HOLD=4m -e MODE=once Scripts/ws-group-reply-subreply-dynamic.js
```

### High load — 5000 users, 15 min hold, continuous

```powershell
k6 run -e VUS=5000 -e HOLD=15m -e MODE=continuous Scripts/ws-group-message-dynamic.js
```

### Custom timing — simple ramp, faster sends

```powershell
k6 run -e VUS=200 -e HOLD=10m -e MODE=continuous -e RAMP_STYLE=simple -e RAMP_UP=2m -e RAMP_DOWN=1m -e MSG_INTERVAL_MS=1500 Scripts/ws-group-message-dynamic.js
```

### Reply + sub-reply — product SLO (strict 15s parent wait)

```powershell
k6 run -e STRICT_SLO=true -e VUS=500 -e HOLD=4m -e MODE=once Scripts/ws-group-reply-subreply-dynamic.js
```

Equivalent: `-e WAIT_MODE=slo`. Fail the run if connect/cycle/error/timeout (and p95 root RTT) gates miss.

### Reply + sub-reply — diagnostic (longer wait, late echoes visible)

```powershell
k6 run -e VUS=500 -e HOLD=4m -e MODE=once Scripts/ws-group-reply-subreply-dynamic.js
```

Default `WAIT_MODE=diagnostic` (`PARENT_WAIT_MS=60000`). To wait even longer:

```powershell
k6 run -e VUS=500 -e HOLD=4m -e MODE=once -e PARENT_WAIT_MS=90000 Scripts/ws-group-reply-subreply-dynamic.js
```

This does **not** fix backend latency; it only keeps the socket open long enough to measure it.

### Faster thread steps (reply script)

```powershell
k6 run -e VUS=100 -e HOLD=5m -e MODE=continuous -e STEP_GAP_MS=400 Scripts/ws-group-reply-subreply-dynamic.js
```

### Short once smoke (previously false-failed on teardown)

```powershell
k6 run -e VUS=10 -e HOLD=1m -e MODE=once -e RAMP_STYLE=simple -e RAMP_UP=5s -e RAMP_DOWN=5s Scripts/ws-group-reply-subreply-dynamic.js
```

Expect full threads to succeed. `ws_send_error_rate` must **not** fail just because k6 closed sockets (`Session closed` / 1002). Those show up on `ws_teardown_closes` instead.

### Large run (~30k users)

Requires ≥ 30k tokens in `data/users_result.json`. Use a long enough `HOLD` (and ramp) for connects + one thread under load; default `VU_HOLD_MS` once-mode is 4 minutes. Logs are sampled (every 1000th VU at 10k+).

```powershell
k6 run -e VUS=30000 -e HOLD=10m -e MODE=once Scripts/ws-group-reply-subreply-dynamic.js
```

Ramp-down will produce many teardown closes. That is expected and does not fail `ws_send_error_rate`. Watch connect / cycle / parent-timeout rates and RTT separately — slow echoes are not fixed by this metric change.

---

## Reports

After each run, k6 writes an HTML summary to `reports/`:

| Script | Report path pattern |
|--------|---------------------|
| Group message | `reports/ws-group-message-dynamic-{VUS}vus-{MODE}-report.html` |
| Reply / sub-reply | `reports/ws-group-reply-subreply-dynamic-{VUS}vus-{MODE}-report.html` |

Example: `reports/ws-group-message-dynamic-900vus-once-report.html`

HTML reports are written even when thresholds fail (non-zero exit). Console output also includes a text summary with checks, counters, rates, and latency trends.

---

## Metrics (what to watch)

### Pass/fail rates (both scripts)

- `ws_stomp_connect_rate` — STOMP connected / connect attempts (threshold ≥ 95% by default). Counted from a sticky handshake flag, not the live `connected` bit (that is cleared on socket close and used to be 0% while `ws_stomp_connected` still incremented).
- `ws_send_error_rate` — **real** chat send / STOMP / WS errors relative to successful chat sends (threshold < 5% by default)

### How `ws_send_error_rate` is computed

```
real_send_errors / (successful_chat_sends + real_send_errors)
```

- **Denominator successes** = chat SENDs that did not throw (root / reply / sub-reply, or group SIMPLE). Not `ws_msgs_sent`.
- **`ws_msgs_sent`** is k6’s built-in count of **all** `socket.send()` frames (CONNECT, SUBSCRIBE, DISCONNECT, chat SEND). Do not use it as chat-send success.
- **Counted as errors (fails the 5% gate):** `send()` throws on a chat SEND; STOMP `ERROR` frames during active messaging that are not session teardown; unexpected WS errors while still sending.
- **Not counted as send errors:** STOMP `ERROR` / `Session closed`, WebSocket close **1002** (protocol error), and other close-on-shutdown events after k6 ramps down or after the script’s `DISCONNECT`. Those are **teardown**, not failed chat sends. A single close is counted once on the session counters even if STOMP ERROR and 1002 both arrive.

| Metric | Role |
|--------|------|
| `ws_send_errors` | Real send / STOMP / WS failures (feeds the rate) |
| `ws_teardown_closes` | Every classified teardown event (Session closed, 1002, post-shutdown errors). Expected to be high at ramp-down, including 30k. |
| `ws_session_closed_errors` | Unique sessions that had at least one teardown close (avoids double-counting the STOMP + 1002 pair) |

Do **not** raise `SEND_ERROR_RATE_MAX` to hide teardown. The 5% gate stays for real send failures.

### Group message script

- `ws_stomp_connected` — successful STOMP handshakes (counter; not a pass gate)
- `ws_group_messages_sent` / `ws_group_messages_received`
- `ws_group_echo_rate` — own echoes / (echoes + pending sends older than 10s at disconnect)
- `ws_echo_uid_rewritten` — own echo whose uniqueMessageId differed from outbound (rare for SIMPLE; not a failure)
- `ws_group_message_roundtrip_ms` — send → echo latency (optional p95 via `MSG_RTT_P95_MS`)
- `ws_send_errors` / `ws_teardown_closes` / `ws_session_closed_errors`

### Reply / sub-reply script

- `ws_group_roots_sent`, `ws_group_replies_sent`, `ws_group_subreplies_sent`
- `ws_group_roots_matched`, `ws_group_replies_matched`, `ws_group_subreplies_matched` — WS echo accepted via the correlation rules below (not uniqueMessageId equality)
- `ws_echo_uid_rewritten` — echo accepted whose uniqueMessageId differed from the outbound id (expected on REPLY; not a failure)
- `ws_thread_cycle_ok` — completed thread cycles / (completed + abandoned)
- `ws_group_root_roundtrip_ms`, `ws_group_reply_roundtrip_ms`, `ws_group_subreply_roundtrip_ms`
- `ws_thread_parent_timeouts` / `ws_parent_timeout_rate` — parent echo not received within `PARENT_WAIT_MS`
- `ws_thread_late_echoes` / `ws_thread_late_echo_ms` — echo arrived **after** k6 already timed out the cycle (diagnostic; not a success)
- `ws_send_errors` / `ws_teardown_closes` / `ws_session_closed_errors`

### Echo correlation (all load sizes)

chat-service `processReplyMessage` often assigns a **new** `uniqueMessageId` on REPLY. The k6 scripts do **not** fail a reply because `echo.uniqueMessageId !== outbound.uniqueMessageId`. The same matching rules are used at 100, 1k, 10k, and 30k VUs — only VUs, hold, and thresholds change per run.

| Kind | How the echo is matched | Parent for the next send |
|------|-------------------------|--------------------------|
| SIMPLE / root | Outbound `uniqueMessageId` when the backend keeps it; otherwise `senderId` + content + `SIMPLE` | Store echo Mongo `id` and server `uniqueMessageId`; wait for that `id` before sending a REPLY |
| REPLY / sub-REPLY | `senderId` + `messageType=REPLY` + `repliedOnChatId` parent Mongo id (+ content). UID equality is optional. | Store echo Mongo `id` and server `uniqueMessageId`; sub-REPLY uses the reply's server `id` |

A sampled debug log (`uniqueMessageId rewrite (not a delivery failure)`) prints outbound UID, inbound UID, parent id, and a content snippet when the backend rewrote the id.

---

## Configuration files

### `data/group-chat.json`

```json
{
  "groupId": "<uuid>",
  "conversationId": "<id>",
  "receiverName": "test",
  "wsUrl": "wss://api.ntmt.dev.gulftmt.com/api/chat-service/chat"
}
```

Update `wsUrl`, `groupId`, and `conversationId` for your environment.

### `data/users_result.json`

Each entry needs at least:

- `sender_id`
- `sender_name` / `user_code`
- `sender_token` (JWT)

**Security:** tokens are credentials. Do not commit real production tokens to public repos. `.gitignore` already excludes `data/tokens.json` and admin credential files; treat `users_result.json` the same way if it contains live JWTs.

---

## Troubleshooting

| Error | Likely cause |
|-------|----------------|
| `VUS=N but only M tokens` | Increase users in `users_result.json` or lower `VUS`. |
| Messages not in 1, 2, 3 order | Burst (`parallel`) is the default, so the UI will interleave. For ordered posting use `-e SEND_ORDER=sequential` and confirm the startup log. Use `-e SEND_STAGGER_MS=500` if the UI still shuffles same-second rows. |
| `Invalid MODE=...` | Use only `continuous` or `once`. |
| `No users in data/users_result.json` | Missing or empty token file. |
| WS upgrade failed (not 101) | Expired token, wrong URL, or gateway down. |
| `CHECK_GROUP_MEMBERSHIP failed: N of M VU users are NOT members` | Stress users are missing `USER_GROUP` rows for `group-chat.json` `groupId`. Run `data/sql/ensure-stress-users-in-test-group.sql` on UAT, then re-run. Do not treat this as a chat-service defect. |
| uniqueMessageId on echo differs from what k6 sent | Expected for REPLY (`processReplyMessage` rewrites it). The script matches by parent id + senderId and logs a sampled rewrite line. Not a delivery failure. |
| High `ws_thread_parent_timeouts` | Under load, 15s is often too short (~32s avg / ~60s p95 root RTT has been observed). For **diagnosis**, use default diagnostic wait or `-e PARENT_WAIT_MS=60000` (or `90000`) and inspect `ws_thread_late_echoes`. For **SLO pass/fail**, use `-e STRICT_SLO=true`. Raising the wait does not fix backend latency. Also consider lowering `VUS`. |
| `ws_send_error_rate` ~33% on a short once run (old behaviour) | Was teardown: k6 closed sockets before `VU_HOLD_MS` DISCONNECT; server sent `Session closed` + close 1002, often **twice per VU**. Current scripts exclude that from the rate. Confirm `ws_group_*_sent` matches completed threads and look at `ws_teardown_closes` instead. |
| `ws_stomp_connect_rate` / "STOMP connected" check 0% while `ws_stomp_connected` is high | Was: socket `close` cleared `connected` before the rate/check ran. Scripts now record a sticky `stompConnected` flag. |
| Extra roots from VU50/100 in `MODE=once` | Was: after parent timeout the VU iteration ended and ramping-vus opened a new socket. Once-mode now locks after the first root / parent timeout and does not send another root. |
| High `ws_teardown_closes` at 30k | Expected on ramp-down. Not a send-failure gate. |
| Thresholds failed / exit 99 | Read the HTML report. Exit 0 is a quality-gate pass, not “at least one counter incremented”. |

At startup, each script logs its resolved config (VUS, HOLD, MODE, etc.) — verify values before a long run.

---

## Further reading

- `docs/WebSocket-Stress-Test-Functionalities.md` — full checklist of WebSocket features to cover beyond group messaging.
