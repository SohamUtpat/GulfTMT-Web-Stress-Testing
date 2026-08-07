# Stress Test Plan — Chat Web Application (0 → 30,000 Concurrent Users)

**Document version:** 1.0  
**Audience:** Manager / stakeholders / engineering  
**Primary tooling:** k6 + JWT Gen Token process (UAT)  
**Scope:** Real-time chat (WebSocket / STOMP group messaging)

---

## 1. Objective

Validate that the chat platform can support **up to 30,000 concurrent connected users** sending and receiving messages under controlled load, and identify:

- Maximum stable concurrent WebSocket connections  
- Message throughput and latency under load  
- Failure points (API gateway, chat-service, DB, Kafka, Redis)  
- Capacity and scaling needs before go-live / next release  

### Proposed success criteria (to be finalized with product)

At **30,000 concurrent users**, with an agreed message rate:

| Metric | Target |
|--------|--------|
| WebSocket / STOMP connect success | ≥ **99%** |
| Message send success | ≥ **99%** |
| p95 message round-trip latency | ≤ **agreed SLA** (e.g. 2–3 seconds) |
| System stability | No cascading outage; error rate within threshold during hold |

---

## 2. Scope

### In scope

- Mobile / chat WebSocket (STOMP): connect, subscribe, group message send/receive  
- Authentication via **pre-generated JWTs** (stress-scale approach)  
- Gradual ramp from **0 → 30,000** concurrent users  
- Application and infrastructure monitoring during tests  

### Out of scope (unless explicitly added later)

- Full browser UI / end-to-end Selenium-style tests  
- Attachment upload stress  
- Admin portal load testing  
- **Production** environment (tests run on **UAT only**)  

---

## 3. Recommended approach

### Why not “login 30k users from k6”?

| Approach | Suitable for 30k? | Notes |
|----------|-------------------|--------|
| Create + login each user via API in k6 | **No** | Too slow; floods login; tokens expire mid-run |
| **JWT Gen Token + DB session sync (documented SOP)** | **Yes** | Standard for large concurrent chat load |
| k6 for the actual WebSocket / chat load only | **Yes** | Measures chat capacity, not login capacity |

### Chosen strategy

1. Seed test users once in UAT DB  
2. Sync `login_expiry_date` in `login_audit` from one real logged-in user  
3. Generate JWTs offline (JWT Gen Spring Boot project)  
4. Run k6 WebSocket scenarios with a controlled ramp  

**k6 create/login scripts** remain useful for **local / small** checks (10–100 users), not for 30k stress.

---

## 4. Environment and prerequisites

| Item | Requirement |
|------|-------------|
| Environment | **UAT** (`Gulfnet-UAT-Server`) — not production |
| Access | EC2, DB (TablePlus), JWT Gen Spring Boot project, k6 load generators |
| Test users | ~30,000+ mobile users already in DB (dedicated prefix, e.g. `Josh%`) |
| Chat target | Fixed `groupId` + `conversationId`; all users must be members of the test group |
| Approval | Change window + stakeholder sign-off before 10k+ runs |

### Infrastructure note

A single laptop cannot sustainably open **30,000** WebSocket connections. Plan for **distributed k6** (multiple VMs, k6 Cloud, or several generators).

---

## 5. Phased execution plan (0 → 30k)

Do **not** jump to 30k. Each phase has exit criteria; proceed only after the previous phase passes.

### Phase 0 — Preparation (1–2 days)

**Activities**

- Confirm UAT healthy (gateway, user-management, chat-service, Kafka, Redis, DB)  
- Confirm ~30k users exist and are members of the target group  
- Run JWT Gen SOP (seed login → `login_audit` sync → generate token file)  
- Prepare k6 scripts and token file  
- Set up monitoring (CPU, memory, connections, Kafka lag, DB, error rates)  
- Agree SLAs and abort criteria with product / backend  

**Exit criteria**

- Sample 10–50 tokens successfully connect via WebSocket and send one group message  

---

### Phase 1 — Smoke (0 → 50 users) — ~30–60 minutes

| Item | Value |
|------|--------|
| Target | 50 concurrent WebSocket users |
| Duration | 10–15 minute hold |
| Goal | Validate script, auth, and STOMP destinations |

**Exit criteria:** Connect OK, send/receive OK, no auth failures.

---

### Phase 2 — Baseline (0 → 500) — ~1–2 hours

| Item | Value |
|------|--------|
| Ramp | 0 → 100 → 500 |
| Hold | 15–20 minutes at 500 |
| Goal | Establish baseline latency and error rates |

**Exit criteria:** p95 within baseline; errors &lt; 1%.

---

### Phase 3 — Medium (0 → 2,000) — ~half day

| Item | Value |
|------|--------|
| Ramp | 500 → 1,000 → 2,000 |
| Hold | 20–30 minutes at 2,000 |
| Goal | Detect early bottlenecks |

**Exit criteria:** Stable hold; no severe connection drop or memory growth.

---

### Phase 4 — High (0 → 10,000) — ~1 day

| Item | Value |
|------|--------|
| Ramp | 2,000 → 5,000 → 10,000 (slow ramp) |
| Hold | 30–45 minutes at 10,000 |
| Goal | Validate gateway and chat-service under significant load |

**Exit criteria:** Interim SLAs met; go/no-go decision for 30k attempt.

---

### Phase 5 — Peak (0 → 30,000) — 1–2 days

| Item | Value |
|------|--------|
| Ramp | 10k → 15k → 20k → 25k → 30k |
| Hold | 30–60 minutes at 30k (or at max stable level) |
| Goal | Prove peak capacity or document maximum sustainable concurrent users |

**Exit criteria:** Either 30k passes, or a documented **max concurrent users** figure with evidence.

---

### Phase 6 — Soak (optional but recommended)

- Hold **max stable** concurrency (e.g. 10k or 20k) for **2–4 hours**  
- Detect memory leaks, token expiry issues, and gradual degradation  

---

### Phase 7 — Report and recommendations

- Results pack for management  
- Bottleneck analysis and capacity recommendations  
- Go / No-Go for expected production concurrency  

---

## 6. Load model (what each virtual user does)

Representative chat user behavior (tune with product owners):

1. Open WebSocket and STOMP `CONNECT` with JWT  
2. `SUBSCRIBE` to `/user/queue/reply`  
3. Periodically `SEND` a group message to `/app/chat/groupMessage`  
4. Remain connected for the test duration  
5. Clean `DISCONNECT` at end  

### Message rate (must be agreed before Phase 4+)

Unrealistic spam will overwhelm Kafka/chat and invalidate results.

| Send interval per user | Approx. messages/sec at 30k users |
|------------------------|-----------------------------------|
| Every 60 seconds | ~500 msg/s |
| Every 30 seconds | ~1,000 msg/s |
| Every 10 seconds | ~3,000 msg/s (very aggressive) |

**Recommendation:** Start with a conservative interval (e.g. 30–60s) unless product requires higher.

### Key STOMP destinations (backend)

| Action | Destination |
|--------|-------------|
| Send group message | `/app/chat/groupMessage` |
| Receive messages | `/user/queue/reply` |

---

## 7. JWT generation process (stress-scale auth)

Detailed operational SOP (summary for this plan):

1. Start EC2 **Gulfnet-UAT-Server**  
2. Connect to UAT DB (TablePlus)  
3. Log in one real mobile user (e.g. `arunMobile`) in the web client; capture `userId`  
4. SQL: copy / upsert `login_audit.login_expiry_date` for all stress users (e.g. `Josh%`) from the logged-in user’s session  
5. Export user list (`sender_id`, `sender_name`, `user_code`) as JSON  
6. Copy JSON into **JWTGenToken** Spring Boot project  
7. Paste the logged-in user’s JWT into `JWTGenTokenProjectApplication.java`  
8. Run the Spring Boot app  
9. Copy `users_result.json` into the k6 project as the token source  

**Benefit:** Avoids 30,000 login API calls before every stress run.

**Operational notes**

- Replace the seed `user_id` in SQL whenever the seed login changes  
- Align SQL prefix (`Josh%`, etc.) with actual UAT test users  
- Set `login_expiry_date` long enough to cover the full test window  
- Do not commit real UAT JWTs to source control  

---

## 8. Metrics and pass / fail criteria

### Application metrics

- WebSocket connect success rate  
- STOMP `CONNECTED` success rate  
- Messages sent / received counters  
- Message round-trip latency (p50 / p95 / p99)  
- Disconnect and error counts  

### Infrastructure metrics

- API gateway CPU, memory, open connections  
- Chat-service CPU, memory, threads  
- Kafka consumer lag  
- Redis / MongoDB / PostgreSQL load  
- Network bandwidth and OS limits (file descriptors)  

### Abort criteria (stop the run)

Stop the test if any of the following hold for a sustained period (e.g. &gt; 5 minutes):

- Error rate &gt; **5%**  
- p95 latency above agreed SLA  
- Service crash / OOM  
- Database or Kafka unavailable  

---

## 9. Resources required

| Resource | Need |
|----------|------|
| People | 1 performance engineer + 1 backend owner on call |
| UAT window | Exclusive or low-traffic slots for Phases 4–5 |
| Load generators | Multiple machines and/or k6 Cloud for 30k WebSockets |
| DB / JWT tooling | TablePlus + JWT Gen project access |
| Monitoring | Existing APM / CloudWatch / Grafana (as available) |

---

## 10. Example timeline

| Week | Activity |
|------|----------|
| Week 1 | Preparation, JWT pipeline, smoke + 500 users |
| Week 2 | 2,000 → 10,000 users + bug fixes |
| Week 3 | 30,000 attempt, soak test, final report |

Adjust based on environment readiness and fix cycles.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| UAT shared or unstable | Dedicated windows; freeze unrelated deployments |
| Single generator cannot open 30k sockets | Distributed k6 / multiple generators |
| Unrealistic message spam | Agree think-time with product |
| Token expiry mid-test | Extend `login_expiry_date`; regenerate tokens if needed |
| Users missing from test group | Pre-check membership for all stress users |
| Accidental production traffic | Hardcode UAT URLs; pre-run checklist |

---

## 12. Deliverables

1. This test plan + signed SLAs  
2. k6 scripts + JWT generation runbook  
3. Phase-wise result sheets (50 / 500 / 2k / 10k / 30k)  
4. Final report including:  
   - Maximum stable concurrent users  
   - Latency and error charts  
   - Bottlenecks  
   - Capacity / scaling recommendations  
5. Go / No-Go recommendation for expected production concurrency  

---

## 13. Decision summary

| Question | Answer |
|----------|--------|
| Goal | Prove chat can handle up to **30,000 concurrent** users |
| Method | **JWT Gen + k6 WebSocket**, phased ramp 0 → 30k |
| Why not API login for 30k? | Too slow and distorts chat capacity results |
| Environment | **UAT only** |
| Approximate duration | **2–3 weeks** including fixes |
| Outcome | Evidence-based capacity number + action list |

---

## 14. Immediate next steps (approval requested)

1. Approve UAT stress windows for Phases 3–5  
2. Confirm target SLAs (latency and error %)  
3. Confirm realistic message send rate  
4. Confirm load-generator capacity (machines / budget)  
5. Kick off **Phase 0** (JWT pipeline + smoke test)  

---

## 15. Document control

| Field | Value |
|-------|--------|
| Title | Chat Web Application Stress Test Plan (0 → 30k) |
| Related SOPs | JWT Generate Token for Stress Test |
| Related scripts | k6 WebSocket group message scripts; JWT Gen Spring Boot project |
| Status | Draft — pending stakeholder approval |

---

*End of document*
