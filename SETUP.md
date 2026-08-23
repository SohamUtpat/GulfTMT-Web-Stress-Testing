# K6 Chat Load Test — 500 Users

Runs a WebSocket group-chat load test using pre-exported users and tokens.

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) installed
- `data/users_result.json` — 500 users with login tokens (`sender_id`, `sender_name`, `user_code`, `sender_token`)
- `data/group-chat.json` — group / conversation / WS URL
- Stress-test users must be **members** of the target group (Point 7).
  - SQL: `data/sql/ensure-stress-users-in-test-group.sql`
  - k6 fail-fast: both load scripts check in `setup()`, or run `k6 run -e VUS=500 Scripts/check-group-membership.js`

## Run (recommended — 500 users hybrid)

```powershell
k6 run Scripts/ws-group-message-500-users.js
```

Ramp profile (~12 min):

| Phase | Target VUs | Duration |
|-------|------------|----------|
| Ramp up | 0 → 100 → 200 → 400 → 500 | ~5m |
| Peak hold | 500 | 4m |
| Ramp down | 500 → 300 → 100 → 0 | ~3m |

Each VU maps to a unique user from `users_result.json` (VU 1 → user 1 … VU 500 → user 500).

## Longer staged run (optional)

```powershell
k6 run Scripts/ws-group-message.js
```

Uses slower step holds (~40 min): 50 → 100 → 200 → 400 → 500 → 300 → 100 → 50 → 0.

## Optional env overrides

```powershell
k6 run -e MSG_INTERVAL_MS=3000 -e VU_HOLD_MS=55000 Scripts/ws-group-message.js
```

| Env | Default | Meaning |
|-----|---------|---------|
| `MSG_INTERVAL_MS` | `3000` | How often each VU sends a group message |
| `VU_HOLD_MS` | `55000` | How long each VU holds a WS connection before reconnecting (keeps ramp-down responsive) |

## File overview

| File | Purpose |
|------|---------|
| `data/users_result.json` | 500 users + JWT tokens (input) |
| `data/group-chat.json` | Group / conversation / WS URL |
| `Scripts/ws-group-message-500-users.js` | Recommended 500-user hybrid ramp (~12 min) |
| `Scripts/ws-group-message.js` | Longer staged ramp (~40 min) |
