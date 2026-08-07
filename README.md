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
│   └── ws-group-reply-subreply-dynamic.js   # Root → reply → sub-reply threads
├── data/
│   ├── users_result.json                    # User tokens (sensitive)
│   └── group-chat.json                      # Group / WS endpoint config
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
| `RAMP_STYLE` | `scaled` | `scaled` — stepped ramp (20% → 40% → 80% → 100%). `simple` — single ramp-up → hold → ramp-down. |
| `RAMP_UP` | `5m` | Ramp-up duration when `RAMP_STYLE=simple`. |
| `RAMP_DOWN` | `3m` | Ramp-down duration when `RAMP_STYLE=simple`. |
| `VU_HOLD_MS` | `55000` (continuous) / `240000` (once) | How long each VU keeps the WebSocket open per iteration (milliseconds). |
| `MSG_INTERVAL_MS` | `3000` | Pause between sends (group message) or between completed thread cycles (reply script) in **continuous** mode. |

### Reply / sub-reply script only

| Variable | Default | Description |
|----------|---------|-------------|
| `STEP_GAP_MS` | `800` | Pause after a parent echo before sending reply or sub-reply. |
| `PARENT_WAIT_MS` | `15000` | Max wait for a parent message echo before retrying or timing out the cycle. |

---

## Modes

### `MODE=continuous`

- VUs connect, send repeatedly, then disconnect after `VU_HOLD_MS`.
- **Group message script:** sends a new SIMPLE message every `MSG_INTERVAL_MS`.
- **Reply script:** completes root → reply → sub-reply cycles, then waits `MSG_INTERVAL_MS` before the next cycle.
- Best for sustained load and throughput testing.

### `MODE=once`

- Each VU sends **exactly one** message (group script) or **one full thread cycle** (reply script), then idles until the connection closes.
- Uses a longer default `VU_HOLD_MS` (4 minutes) so echoes can arrive before disconnect.
- Best for spike / burst tests (e.g. 1000 users each send once).

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
k6 run -e VUS=1 -e HOLD=30s -e MODE=once -e RAMP_STYLE=simple -e RAMP_UP=1s -e RAMP_DOWN=1s -e VU_HOLD_MS=30000 Scripts/ws-group-reply-subreply-dynamic.js
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

### Faster thread steps (reply script)

```powershell
k6 run -e VUS=100 -e HOLD=5m -e MODE=continuous -e STEP_GAP_MS=400 -e PARENT_WAIT_MS=10000 Scripts/ws-group-reply-subreply-dynamic.js
```

---

## Reports

After each run, k6 writes an HTML summary to `reports/`:

| Script | Report path pattern |
|--------|---------------------|
| Group message | `reports/ws-group-message-dynamic-{VUS}vus-{MODE}-report.html` |
| Reply / sub-reply | `reports/ws-group-reply-subreply-dynamic-{VUS}vus-{MODE}-report.html` |

Example: `reports/ws-group-message-dynamic-900vus-once-report.html`

Console output also includes a text summary with checks, counters, and latency trends.

---

## Metrics (what to watch)

### Group message script

- `ws_stomp_connected` — successful STOMP handshakes
- `ws_group_messages_sent` / `ws_group_messages_received`
- `ws_group_message_roundtrip_ms` — send → echo latency
- `ws_send_errors`

### Reply / sub-reply script

- `ws_group_roots_sent`, `ws_group_replies_sent`, `ws_group_subreplies_sent`
- `ws_group_root_roundtrip_ms`, `ws_group_reply_roundtrip_ms`, `ws_group_subreply_roundtrip_ms`
- `ws_thread_parent_timeouts` — parent echo not received in time

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
| `Invalid MODE=...` | Use only `continuous` or `once`. |
| `No users in data/users_result.json` | Missing or empty token file. |
| WS upgrade failed (not 101) | Expired token, wrong URL, or gateway down. |
| High `ws_thread_parent_timeouts` | Increase `PARENT_WAIT_MS` or reduce `VUS` / `STEP_GAP_MS`. |

At startup, each script logs its resolved config (VUS, HOLD, MODE, etc.) — verify values before a long run.

---

## Further reading

- `docs/WebSocket-Stress-Test-Functionalities.md` — full checklist of WebSocket features to cover beyond group messaging.
