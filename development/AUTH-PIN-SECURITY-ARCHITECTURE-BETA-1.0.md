# AUTH PIN Security Architecture — Beta 1.0

**Status:** architecture baseline for implementation in PR #171  
**Decision date:** 2026-11-27  
**Scope:** registration, account recovery, authenticated PIN management, weekly reminders and mandatory monthly verification.  
**Out of scope:** InOne Identity launch, SMS ownership verification, phone-based recovery, unrelated MLS/session protocol changes.

This document is an implementation contract, not a completion report. AUTH-08 stays open until implementation, automated tests on the exact PR SHA, independent security review and merge are complete.

## 1. Product invariants

1. Recovery PIN is exactly eight ASCII digits (0–9), stored and transported as a string. Leading zeroes are significant.
2. Registration requires two matching PIN entries. Account creation and PIN-hash persistence are one atomic transaction. Registration must never create an account without a PIN.
3. PIN is not the account password, is not a standalone login credential and is not used to authenticate a normal login.
4. Recovery requires both a one-time code sent to the verified primary email and the PIN. Both proofs belong to one server-side recovery request and one expiry window. Phone number and phone visibility are irrelevant to recovery.
5. PIN is never stored or logged in plaintext and never appears in URLs, deep links, email, analytics, crash reports or request logs.
6. The server clock and durable database state are authoritative for expiry, lockout, weekly reminders and monthly verification.
7. PIN verification limits are shared across recovery, monthly verification and PIN-management operations. Parallel requests must serialize against one durable account-level lock.
8. A forgotten PIN cannot be bypassed by email-only account recovery. PIN replacement is a separate protected operation.

## 2. PIN KDF and secret handling

- Use Node.js native `crypto.argon2` (Node 24.7.0+) with Argon2id, a unique 16-byte cryptographically random salt, a 32-byte derived key and explicit versioned parameters: memory 65,536 KiB, passes 3, parallelism 1. The profile is fixed server-side; production latency/memory calibration remains a release gate.
- Use a server-held pepper as an additional secret input, obtained from deployment secrets and never stored in PostgreSQL. Fail closed when the pepper is absent or below the required entropy/length.
- Store a self-describing encoded record containing algorithm/version, parameters, salt and derived hash so future parameter upgrades can be performed safely.
- Compare derived values with a constant-time comparison. Validate encoded records strictly before KDF work; malformed database values must fail closed without unbounded allocation.
- Keep PIN KDF work asynchronous through Node's native crypto worker pool and bound it to two active derivations plus a finite queue of sixteen. Overflow fails closed with a retryable 503. Do not accept client-selected KDF parameters.
- Do not silently downgrade existing PIN hashes. Existing scrypt hashes from the previous 6–12 digit policy remain verifiable only through a compatibility path: a legacy 8-digit PIN upgrades to Argon2id on successful verification; a valid legacy PIN of another length is accepted only to prove possession and immediately routes the user to protected reset for a new 8-digit PIN. New Argon2id hashes accept exactly eight digits. Legacy accounts without a PIN must complete protected PIN setup before protected account access and may not use email-only recovery.

## 3. Attempt policy and lockout state machine

The lockout is enforced by the backend and persisted in the account PIN record. A database row lock/transaction serializes each attempt; the memory store must mirror the same transitions for deterministic development behavior.

| Event | Result |
|---|---|
| First wrong PIN | Reject; no lock |
| Second wrong PIN | Reject; no lock |
| Third consecutive wrong PIN | Lock PIN-protected operations for 30 minutes |
| First wrong attempt after the 30-minute lock expires | Lock for 1 hour |
| Next wrong attempt after expiry | Lock for 2 hours |
| Subsequent wrong attempts | Double the previous lock duration: 4, 8, 16 hours, capped at 24 hours |
| Correct PIN | Reset consecutive-failure state and lockout |

After each lock expires, exactly one verification attempt is allowed. A wrong answer starts the next longer lock immediately. Requests received during a lock do not execute the KDF and do not increment attempts. A correct answer resets the progression.

The lock applies to PIN-protected operations and the monthly access gate. It must not be implemented as an unauthenticated global account ban that lets an attacker deny ordinary password login indefinitely. During a monthly gate, the user remains restricted from protected account APIs until successful PIN verification or completion of the separate protected reset process.

The API returns a generic PIN failure and a retry time only when the caller is already authenticated or has passed the email proof. Pre-auth responses must not disclose account existence or whether the PIN factor was correct.

## 4. Registration flow

1. Email verification produces the existing short-lived registration ticket.
2. Every registration path (verified email, provider-backed and development-only open registration) collects a required phone where configured and PIN twice. The canonical verified registration flow collects nickname, password, required phone and PIN twice.
3. Client validation is UX only. Backend validates both PIN values as exactly eight ASCII digits and checks equality.
4. Backend derives the PIN hash before opening the account-creation transaction.
5. A single PostgreSQL transaction consumes the registration ticket, creates account/profile/phone state and inserts the PIN hash/security metadata. Phone uniqueness is serialized with a transaction-scoped advisory lock; any failure rolls back every write, including ticket consumption. Optional SMS delivery occurs after commit and cannot turn a successfully created account into a failed/partial registration.
6. The memory store must provide equivalent atomic semantics.
7. The successful response must never include the PIN or its hash.

## 5. Recovery flow

1. Client submits email to POST /recovery/start. The public response remains privacy-preserving and identical for existing and unknown addresses.
2. For an eligible account without a Google/Apple recovery path, the backend sends a one-time code only to its verified primary email. It does not use the phone number, SMS or backup email as a recovery factor. Recovery challenges have a one-hour TTL and strict resend/start limits.
3. The user enters the email code first. No email confirmation link is required for new Beta 1.0 recovery requests; the old deep-link confirmation endpoint remains only for challenges created before this change. The PIN is not checked before successful email-code validation.
4. The user then enters the PIN. New Argon2id accounts require exactly eight digits; a legacy scrypt record may accept its former 6–12 digit value solely for migration. A valid legacy value of any length other than eight still forces protected PIN replacement after recovery. The server validates the email code and PIN against the same pending recovery request, using one account-bound challenge and server-side expiry.
5. Only after both factors pass may the recovery completion transaction change the password and begin the existing 48-hour recovery window.
6. The challenge is consumed atomically with password update and recovery-state transition. A concurrent/replayed completion must not change the password twice or create a second recovery window.
7. Wrong email codes use the existing recovery-code attempt/lock policy. Wrong PIN uses the shared PIN attempt policy above. Do not clear PIN lockout merely because a new recovery email code was requested.
8. A missing PIN is a hard failure, never a reason to fall back to email-only recovery.

## 6. PIN management and forgotten-PIN reset

### Authenticated PIN replacement

- The settings reminder action «Не помню, заменить» opens a dedicated reset flow.
- Require a valid authenticated session and a one-time code sent to the verified primary email. Accounts with password sign-in must also re-enter the password at reset start. Provider-only accounts use their authenticated provider session plus the separate email challenge; no password is assumed or requested.
- The email code is purpose-bound to PIN reset, short-lived, one-use, rate-limited and stored only as a keyed hash. It cannot be replayed as a registration, login, recovery or other step-up code.
- New PIN is entered twice and validated server-side. PIN replacement and challenge consumption are atomic. The old PIN becomes invalid immediately after commit.
- Send a security notification to the verified account email and other configured security-notification recipients. Never include the PIN or email code in the notification.
- If the user has no authenticated session, they cannot reset the PIN using email alone. They must use the full account recovery flow, which still requires the existing PIN, or a separately approved high-assurance support process. No email-only escape hatch is introduced.

### Legacy accounts without a PIN or with an old-format PIN

- A legacy account is not silently grandfathered into email-only recovery.
- Legacy scrypt PINs from the previous 6–12 digit policy are identified server-side. An old 8-digit PIN upgrades to Argon2id after successful verification. A correct old PIN of another length does not unlock protected areas; it immediately routes the authenticated user to the email-code + password reset flow to create a new eight-digit PIN.
- After any successful login, the server enforces a restricted PIN-setup-required state. Only logout, refresh, PIN status, protected reset and the minimal security endpoints remain available.
- PIN setup requires authenticated re-authentication and verified-email confirmation. It does not accept a PIN-less recovery completion.

## 7. Monthly verification gate

- Store last_verified_at durably per account, not in the mobile client or session memory.
- After any successful authentication, Flutter calls GET /pin/status. If there is no PIN verification timestamp or 30 days have elapsed, the server issues/keeps the session in a restricted state and the mobile host routes to the PIN gate.
- A request-level backend gate blocks protected APIs until PIN verification. Allow only the minimal endpoints required to inspect PIN status, verify PIN, complete protected reset, refresh the session, change locale if necessary, and log out.
- POST /pin/verify updates last_verified_at only after successful PIN verification. It must be atomic with the PIN attempt state.
- Access-token refresh, process restart, device clock changes, replayed requests or a new session must not clear the gate.
- A successful monthly verification does not replace password authentication and does not alter the recovery process.

## 8. Weekly reminder

- The profile/settings surface calls an authenticated PIN-status endpoint. The backend computes reminder eligibility using server time.
- A reminder becomes due at most once per seven-day interval. The server persists the next reminder/acknowledgement time.
- «Помню» records acknowledgement and schedules the next reminder no earlier than seven days later. It does not update the monthly verification timestamp and cannot satisfy the monthly gate.
- «Не помню, заменить» starts the protected reset flow described above. The reminder remains pending until reset succeeds or the user explicitly acknowledges it.
- The email templates are localized in Armenian, Russian and English. Mobile reminder/verification copy is currently authored in Russian; wiring it to the account locale remains a release task. It must not contain or request the PIN itself.

## 9. API surface

The final route names must be kept synchronized with OpenAPI/mobile API contracts and Flutter dispatch. The intended responsibilities are:

| Endpoint | Purpose |
|---|---|
| POST /register (verified/open) and POST /register/provider | Accept required matching PIN fields and atomically create account + PIN; phone is committed in the same transaction where required |
| POST /recovery/start | Privacy-preserving email recovery request |
| POST /recovery/complete | Complete only with verified email code + PIN + new password in the same pending recovery request |
| GET /pin/status | Return PIN configured/gate/reminder state without exposing hash or attempt internals |
| POST /pin/verify | Verify PIN for monthly gate and update server timestamp |
| POST /pin/reminder/ack | Record «Помню» and defer reminder by seven days |
| POST /pin/reset/start | Start purpose-bound email challenge after authenticated re-authentication |
| POST /pin/reset/complete | Consume reset challenge and replace PIN atomically |
| POST /pin/set and POST /pin/remove | Disabled with 410; PIN cannot be silently created or removed through legacy routes |

Exact request/response schemas must be added to the API contract before client wiring. Responses must be no-store and must never include secret material.

## 10. Persistence and migration

Add a forward-only migration (next available migration number) that:
- extends the PIN record with failure progression, monthly verification timestamp and weekly reminder timestamp; KDF version and parameters are encoded in the hash record;
- creates a dedicated PIN-reset challenge table with user, challenge ID, keyed code hash, device binding, expiry, attempts, resend time and consumed timestamp;
- adds foreign keys, indexes for expiry cleanup and check constraints for valid states;
- preserves existing PIN hashes for explicit legacy migration; does not fabricate a PIN for existing users;
- updates both canonical schema and migration runner integrity checks.

Any schema/state update that affects a PIN attempt, reset challenge, recovery completion or registration must be transactionally consistent. PostgreSQL is authoritative in production; memory store parity is mandatory.

## 11. Logging, privacy and abuse resistance

- Redact PIN, confirmation PIN, email code, reset challenge, recovery code, password and tokens at every logging boundary.
- Never include secret-bearing request bodies in audit logs or error objects.
- Do not distinguish unknown account, wrong email code, missing PIN or wrong PIN in public pre-auth responses before the relevant proof is established.
- Apply per-account, per-IP and distributed throttles to start/resend/verification flows. IP limits complement, not replace, account-level PIN state.
- Ensure lockout survives process restart, multiple server instances and race conditions.
- Bound body sizes, string lengths and KDF concurrency before expensive cryptographic work.
- Security notifications are queued transactionally with the state mutation where the mailer supports transactional outbox.
- Never let a failed email delivery leave a reset challenge consumed without a retryable delivery state.

## 12. Implementation order and acceptance gate

1. Complete this architecture and API contract alignment.
2. Implement migration + PostgreSQL/memory store primitives.
3. Implement KDF and shared atomic lockout.
4. Make registration PIN creation atomic.
5. Implement email + PIN recovery completion atomically.
6. Implement PIN status, reminder, monthly gate and protected reset.
7. Wire Flutter registration, recovery, settings reminder and monthly gate.
8. Update security notifications, localized copy and threat-model documentation.
9. Only after code and contracts are complete, run static analysis and targeted automated tests, then full backend/mobile/DB suites on the exact PR SHA.
10. Require independent security review and all applicable CI checks before marking AUTH-08 done or merging.

**No tests are authorized before the implementation and contract audit are complete.** A queued/pending workflow is not a passing result. No task is marked complete based on documentation or code presence alone. The current implementation has not been test-run; runtime performance calibration, exact-SHA automated tests and independent security review remain mandatory.
