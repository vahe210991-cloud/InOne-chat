# Durable MLS inbox policy

The client inbox is stored only in the device's SQLCipher database. Incoming MLS application events are not considered processed until the following are committed in one SQLite transaction:

1. OpenMLS group/ratchet state resulting from processing the event;
2. the inbox row (event ID, room ID, kind, and text body for readable text);
3. the processed-event marker;
4. a fixed diagnostic code for unreadable events, when applicable.

This transaction boundary prevents a restart from leaving the ratchet advanced while losing the corresponding application message. A failed write or full inbox rolls back the transaction; the event remains eligible for retry.

## Delivery and acknowledgement

- `pending_incoming()` returns every unacknowledged item in sequence order. Reading is non-destructive and may be repeated after any restart.
- The application must durably accept/store an item before calling `acknowledge_incoming(event_ids)`.
- ACK is idempotent. Unknown IDs are ignored; duplicate ACKs do not create duplicate delivery.
- A server event ID is the unique inbox key, so event replay cannot reset an ACK or replace previously persisted content.
- Unreadable events are stored as metadata-only rows. No rejected payload bytes or plaintext are stored in their diagnostic record.

## Capacity and retention

- Maximum pending items: 10,000 per device database.
- Maximum combined pending text body size: 32 MiB per device database.
- If either pending limit would be exceeded, the transaction is rolled back and the event is left unprocessed for retry after the application drains the inbox.
- Acknowledged rows are retained for 30 days, then removed during inbox insertion or pending-inbox reads.
- The SQLCipher database key remains platform-managed (Keychain/Keystore); this policy does not introduce a second key or plaintext export.

These limits are intentionally per-device. They are not server retention limits and do not alter room membership, recovery, or MLS authorization.
