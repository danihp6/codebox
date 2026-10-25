# `src/push`

The push subsystem: the `docs/api.md` §5.7 notification routes, the two settings rows that hold
the preferences and the web subscriptions, and the pump that turns the event log into one Web
Push per device per finished run. A VAPID request is signed with `node:crypto` and the payload
encrypted as RFC 8291 `aes128gcm`; no push library is installed.

## Files

- `index.ts` — the `createModule` seam: one service, the four routes, the pump and its
  shutdown hook; it also re-exports the service, mapping, transport and storage surface.
- `service.ts` — the pump (cursor, dedupe set, quiet-hours hold list), delivery to every
  subscription, the preference and subscription APIs, and the injected transports.
- `routes.ts` — the four §5.7 handlers, their body schema, the `write` scope check and the
  web-endpoint validation.
- `errors.ts` — `PushError`, its fixed messages and the status-to-envelope mapping.
- `ids.ts` — the only `sub_` subscription id generator.
- `storage.ts` — the `notifications.preferences` and `push.subscriptions` settings rows and
  their contract parsers.
- `mapping.ts` — the frozen event-to-notification table, the delivery key, the preference gate
  and the message text.
- `quiet-hours.ts` — the `HH:MM-HH:MM` window in the configured `Intl` zone.
- `vapid.ts` — the ES256 VAPID JWT and the `vapid t=…, k=…` authorization header.
- `rfc8291.ts` — the `aes128gcm` payload: ECDH, HKDF-SHA256 and one AES-128-GCM record.
- `transport.ts` — the `PushTransport` port and the `web` implementation over `fetch`.
- `ids.test.ts` — id shape, uniqueness and pinned bytes.
- `storage.test.ts` — defaults, round-trips, malformed rows and removal.
- `mapping.test.ts` — the mapping table, the preference gate and the message text.
- `quiet-hours.test.ts` — wrapping and same-day windows, zones and unusable input.
- `vapid.test.ts` — JWT header, claims, ES256 verification and key refusal.
- `rfc8291.test.ts` — header layout and an independent decrypt of the body.
- `transport.test.ts` — request headers, encryption round-trip, status mapping and aborts.
- `service.test.ts` — dedupe, pruning, preferences, quiet hours, limits and unconfigured mode.
- `routes.test.ts` — the §5.7 HTTP contract: bodies, scopes, envelopes and silent logs.
- `index.test.ts` — the module seam and the pump timer.

## Notes

- The cursor, the dedupe set (last 500 tags, FIFO) and the quiet-hours hold list are process
  memory. A restart drops them and pushes nothing that happened while the daemon was down; the
  durable record is the event log, which the app refetches.
- The first `pump()` of a process only moves the cursor to `latestId()`: a restart never
  replays the backlog.
- `run.merged` and `run.finished` share the `run:<runId>` tag, so one finished run is one push
  per device even when both events are stored.
- Only `kind: 'web'` has a transport. `fcm` and `apns` subscriptions are stored, listed and
  skipped (`push_skipped`, reason `unsupported_kind`) until their task lands.
- A refused or timed-out push is logged once with the subscription id and the tag; the
  endpoint, the subscription keys, the VAPID private key, the JWT and the message body are
  never logged, and the logger redacts every field named `key`, so the frozen `{ key }` field
  of `push_config_invalid` / `push_storage_invalid` arrives masked.
