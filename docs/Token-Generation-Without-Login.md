# Token Generation (Without Manual Login)

How to mint valid Gulf TMT JWTs for existing users when you already have user ids / usernames.

Based on `gulfnet-tmt-backend` → `user-management-service` (`JwtService`) + gateway `/authenticate`.

---

## What you need per user

| Input | From |
|-------|------|
| `user_id` (UUID) | DB / your user list |
| `user_name` | DB — becomes JWT `sub` |
| `TOKEN_SIGNING_KEY` | Same secret as UMS for that environment |
| New or existing `sessionId` | UUID for `LOGIN_AUDIT.id` |
| `expiry` | One datetime used in **both** JWT `exp` and `login_audit.login_expiry_date` |

Password is **not** required.

---

## Generation steps

For each user:

1. Ensure user is Active (`status = "1"`).
2. Pick `expiry` (e.g. now + 24 hours), truncated to **seconds**.
3. Insert or update `LOGIN_AUDIT`:
   - `id` = `sessionId` (UUID)
   - `user_id` = user UUID
   - `login_expiry_date` = `expiry`
   - `is_active` = `true`
4. Sign JWT (HMAC-SHA256) with claims below.
5. Save output for k6 / clients.

---

## JWT details

| Item | Value |
|------|--------|
| Algorithm | HMAC-SHA256 |
| Secret | env `TOKEN_SIGNING_KEY` (`token.signing.key`) |
| Sign (prod) | Auth0 `Algorithm.HMAC256` |
| Issuer / Audience | Not used |

### Claims

| Claim | Value |
|-------|--------|
| `sub` | **Username** (`user_name`), not user UUID |
| `iat` | Issue time (seconds) |
| `exp` | Same as `login_audit.login_expiry_date` (seconds) |
| `roles` | Space-separated names, e.g. `"Mobile HQ Delete Approver"` |
| `sessionId` | `login_audit.id` (UUID string) |

### Sample payload

```json
{
  "sub": "loadtest001",
  "iat": 1753947000,
  "exp": 1754033400,
  "roles": "Mobile HQ Delete Approver",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

User UUID is **not** in the token — keep it beside the token as `sender_id`.

---

## Backend mint method

`JwtService.generateToken(UserDetails, Date expiryTime, String scope, UUID sessionId)`:

```java
JWT.create()
  .withSubject(userDetails.getUsername())
  .withIssuedAt(new Date())
  .withExpiresAt(expiryTime)
  .withClaim("roles", scope)
  .withClaim("sessionId", sessionId.toString())
  .sign(Algorithm.HMAC256(jwtSigningKey));
```

There is no HTTP “mint token” API — generate offline or in a tool using the same secret + `LOGIN_AUDIT` row.

---

## `LOGIN_AUDIT` (required with the token)

| Column | Value |
|--------|--------|
| `id` | JWT `sessionId` |
| `user_id` | User UUID |
| `login_expiry_date` | Exact JWT `exp` |
| `is_active` | `true` |

If `exp` ≠ `login_expiry_date` (second precision), or session is inactive, `/authenticate` rejects the token.

---

## Config

```properties
token.signing.key=${TOKEN_SIGNING_KEY}
mobile.token.expiry.time.hr=${MOBILE_TOKEN_EXPIRY_TIME_HR}   # often 24
```

Use the **target environment** signing key (dev key for `api.ntmt.dev.gulftmt.com`).

---

## Pseudocode

```text
secret = TOKEN_SIGNING_KEY
expirySeconds = floor(now/1000) + (hours * 3600)

for each user:
  sessionId = uuid()   // or reuse login_audit.id

  UPSERT login_audit(id, user_id, login_expiry_date=expirySeconds, is_active=true)

  token = HS256.sign({
    sub: user.user_name,
    iat: nowSeconds,
    exp: expirySeconds,
    roles: "Mobile HQ Delete Approver",
    sessionId: sessionId
  }, secret)

  emit { sender_id: user.id, user_code: user.user_name, sender_token: token }
```

---

## Output format (k6)

```json
{
  "1": {
    "sender_id": "<user-uuid>",
    "sender_name": "Load Test",
    "user_code": "loadtest001",
    "sender_token": "<jwt>"
  }
}
```

WebSocket usage: `?at=Bearer%20<jwt>` and header `Authorization: Bearer <jwt>`.

---

## Checklist

- [ ] Correct `TOKEN_SIGNING_KEY` for the environment
- [ ] `sub` = username; `sender_id` stored separately
- [ ] `LOGIN_AUDIT` active; `id` = `sessionId`
- [ ] JWT `exp` == `login_expiry_date` (seconds)
- [ ] Token not expired

---

## Source files

| File | Role |
|------|------|
| `user-management-service/.../security/JwtService.java` | Sign / validate |
| `user-management-service/.../entity/LoginAudit.java` | Session row |
| `user-management-service/.../util/DateConversionUtil.java` | Second-normalize expiry |
| `user-management-service/.../test/.../AuthTestHelper.java` | Test mint pattern |
