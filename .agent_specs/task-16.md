# Spec: Task-16 — Notifications (Web Push, VAPID, dedupe, preferences)

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon.
- **Role:** Dev.
- **Objective:** the `push` subsystem stops being `absent`. After this task the daemon owns
  the four `docs/api.md` §5.7 notification routes (stored under two settings keys, no
  migration), and a pump that turns the event log into **one** Web Push per device per
  finished run, honouring per-event preferences and quiet hours, pruning a subscription the
  push service reports as gone, and signing the request with VAPID from
  `CB_VAPID_*` using `node:crypto` only.
- **Environment:** worktree `../wt-cb-16`, branch `task-16`, base `main`.
- **Dependencies:** both already merged on `main`; nothing else is needed.
  - Task-11 (`apps/daemon/src/modules.ts` — `DaemonContext`, `DaemonModule`,
    `ModuleFactory`, the `push` entry in `SUBSYSTEMS`; `apps/daemon/src/app.ts` —
    `API_PREFIX`, `errorBody`; `apps/daemon/src/logger.ts`).
  - Task-13 (`apps/daemon/src/events/notifier.ts`, `apps/daemon/src/events/bridge.ts`) and
    the event rows written by Task-14/15 (`packages/store/src/events.ts`).
  - `packages/contracts/src/resources.ts` and `primitives.ts` — the push types already exist;
    this task **uses** them and adds none.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/daemon/src/push/index.ts`
- `apps/daemon/src/push/service.ts`
- `apps/daemon/src/push/routes.ts`
- `apps/daemon/src/push/errors.ts`
- `apps/daemon/src/push/ids.ts`
- `apps/daemon/src/push/storage.ts`
- `apps/daemon/src/push/mapping.ts`
- `apps/daemon/src/push/quiet-hours.ts`
- `apps/daemon/src/push/vapid.ts`
- `apps/daemon/src/push/rfc8291.ts`
- `apps/daemon/src/push/transport.ts`
- `apps/daemon/src/push/ids.test.ts`
- `apps/daemon/src/push/storage.test.ts`
- `apps/daemon/src/push/mapping.test.ts`
- `apps/daemon/src/push/quiet-hours.test.ts`
- `apps/daemon/src/push/vapid.test.ts`
- `apps/daemon/src/push/rfc8291.test.ts`
- `apps/daemon/src/push/transport.test.ts`
- `apps/daemon/src/push/service.test.ts`
- `apps/daemon/src/push/routes.test.ts`
- `apps/daemon/src/push/index.test.ts`
- `apps/daemon/src/push/README.md`
- `apps/daemon/README.md` (section: **Files** — only the `src/push/**` bullets, inserted
  after the `src/gate/**` bullets and before `src/jobs/**`)

`docs/providers.md` is **not** touched: §10 already lists every key this task reads, with the
defaults this task uses, and no key is added, renamed or re-defaulted. The accepted encoding
of the VAPID key pair is an implementation detail frozen under 🔒 Contract and reaches the
operator through Task-30's docs pass, not through this task.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/api.md` (§3 errors, §5.7 settings and push, §6 SSE)
- `docs/providers.md` (§10 notifications, §15 validation)
- `docs/app.md` (§11 push payloads)
- `packages/contracts/src/primitives.ts` (`SubscriptionId`, `ID_PREFIXES`,
  `SSE_EVENT_NAMES`, `sseEventNameSchema`, `timestampSchema`)
- `packages/contracts/src/resources.ts` (`pushKindSchema`, `pushSubscriptionSchema`,
  `notificationPreferencesSchema`, `quietHoursSchema`, `providerStatusSchema`)
- `packages/contracts/src/events.ts` (`runMergedDataSchema`, `runFinishedDataSchema`,
  `runFailedDataSchema`, `runCancelledDataSchema`, `approvalCreatedDataSchema`,
  `routineFiredDataSchema`)
- `packages/contracts/src/config.ts` (`CB_VAPID_*`, `CB_QUIET_HOURS`, `CB_TIMEZONE`)
- `packages/contracts/src/index.ts` (the export list only)
- `packages/store/src/settings.ts`, `packages/store/src/events.ts`,
  `packages/store/src/store.ts`, `packages/store/src/routines.ts`,
  `packages/store/src/errors.ts`
- `packages/security/src/index.ts` (`hasScope`)
- `apps/daemon/src/modules.ts`, `apps/daemon/src/app.ts`, `apps/daemon/src/logger.ts`,
  `apps/daemon/src/config.ts`
- `apps/daemon/src/auth/index.ts`, `apps/daemon/src/auth/middleware.ts`,
  `apps/daemon/src/auth/errors.ts`
- `apps/daemon/src/chat/index.ts`, `apps/daemon/src/chat/routes.ts`,
  `apps/daemon/src/chat/errors.ts`, `apps/daemon/src/chat/ids.ts`,
  `apps/daemon/src/chat/README.md` (the pattern to copy)
- `apps/daemon/src/runs/errors.ts` (`requireScope`, `handle` — read for shape, do not import)
- `apps/daemon/src/chat/routes.test.ts` (the HTTP harness: `createApp` + auth module +
  `paired()`)
- `apps/daemon/src/events/notifier.ts`

## 🔒 Contract

Another task is written against this surface right now. Names, signatures, keys and defaults
are exact. `exactOptionalPropertyTypes` is on: an absent optional property is **omitted**,
never set to `undefined`.

### Module seam — `apps/daemon/src/push/index.ts`

```ts
import type { DaemonContext, DaemonModule } from '../modules.js';

export function createModule(context: DaemonContext): DaemonModule;
// { name: 'push', register(app, context), shutdown() }
```

`createModule` must not throw when push is unconfigured, must not open a socket and must not
start a timer. `register` mounts the four routes and then starts the pump. `shutdown` stops
the pump (idempotent). The daemon loads this file through `loadModules`; it is imported by
`apps/daemon/src/start.test.ts` and `apps/daemon/src/run/modules.test.ts`, so a throw here
turns into `report.failed` and a dead daemon.

`index.ts` also re-exports, because Task-35 consumes them:

```ts
export { createPushService, PUSH_PUMP_MS } from './service.js';
export type { PushService, CreatePushServiceOptions, PushPumpReport, PushDeliveryReport } from './service.js';
export { DEFAULT_NOTIFICATION_EVENTS, NOTIFICATION_TYPES, deliveryKeyOf } from './mapping.js';
export type { NotificationType, PushMessage } from './mapping.js';
export type { PushTransport, PushSendInput, PushSendOutcome } from './transport.js';
export { NOTIFICATION_PREFERENCES_KEY, PUSH_SUBSCRIPTIONS_KEY } from './storage.js';
```

### Service — `apps/daemon/src/push/service.ts`

```ts
export const PUSH_PUMP_MS = 2000;

export interface CreatePushServiceOptions {
  readonly context: DaemonContext;
  readonly transports?: Partial<Record<PushKind, PushTransport>>;
  readonly now?: () => Date;                    // default context.clock
  readonly random?: (size: number) => Buffer;   // default node:crypto.randomBytes
  readonly pumpIntervalMs?: number;             // default PUSH_PUMP_MS
  readonly batchSize?: number;                  // default 200
}

export interface PushPumpReport {
  readonly scanned: number;
  readonly sent: number;
  readonly held: number;
  readonly pruned: number;
  readonly skipped: number;
}

export interface PushDeliveryReport {
  readonly attempts: number;
  readonly sent: number;
  readonly pruned: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface PushService {
  /** True when at least one transport exists: an injected one, or the default `web` one
   *  built from a usable VAPID key pair and subject. */
  configured(): boolean;
  preferences(): NotificationPreferences;
  updatePreferences(input: NotificationPreferences): NotificationPreferences;
  listSubscriptions(): readonly PushSubscription[];
  subscribe(input: {
    readonly kind: PushKind;
    readonly endpoint: string;
    readonly keys: Readonly<Record<string, string>>;
  }): { readonly subscription: PushSubscription; readonly created: boolean };
  /** False when the id was unknown; the route turns that into a 404. */
  unsubscribe(id: string): boolean;
  /** One pump step over the event log. Public so tests drive it; the timer calls it too. */
  pump(): Promise<PushPumpReport>;
  /** Delivers one message to every current subscription. No dedupe, no preference gate. */
  deliver(message: PushMessage): Promise<PushDeliveryReport>;
  start(): void;   // idempotent; no-op when unconfigured
  stop(): void;    // idempotent
}

export function createPushService(options: CreatePushServiceOptions): PushService;
```

When `transports` is supplied it is used as-is, so a test or Task-35 can inject a fake and
needs no VAPID key. Otherwise the service builds exactly one transport, `web`, from
`CB_VAPID_PUBLIC_KEY` / `CB_VAPID_PRIVATE_KEY` / `CB_VAPID_SUBJECT`; if those are absent or
invalid the map is empty, `configured()` is false and `start()` does nothing.

**Pump semantics, in this order (frozen):**

1. It reads the event log with `context.store.events.readAfterId(cursor, batchSize)`.
2. On the first `pump()` of the process the cursor is set to
   `context.store.events.latestId()` and **nothing is processed** — a restart never pushes the
   backlog.
3. For each record, in ascending global id: `deliveryKeyOf(record)` → `null` means not
   push-eligible, skip. Then the preference gate (`isEnabled`). Then the dedupe set: a
   `tag` already recorded is skipped, which is what makes `run.merged` + `run.finished` one
   push for one run.
4. Quiet hours: if `inQuietHours(...)` is true and the message is not critical, it is appended
   to an in-memory hold list, the tag is recorded and the report counts `held` — no POST.
5. It delivers the message to every subscription whose `kind` has a transport. It records the
   tag **after** processing, whatever the transport answered, so a failing endpoint is not
   retried on every tick.
6. The cursor advances to the last record's `id` only after every send has settled.
7. Then, if the hold list is non-empty and quiet hours have ended, it drains the hold list in
   insertion order and clears it.

The in-memory cursor, dedupe set (last 500 tags, FIFO) and hold list are process state. A
restart drops them and no push is replayed; the durable record is the event log, which the app
refetches. This tradeoff is deliberate and needs no settings key beyond the two below.

### Mapping — `apps/daemon/src/push/mapping.ts`

```ts
export const NOTIFICATION_TYPES = [
  'run.merged',
  'run.finished',
  'run.failed',
  'run.cancelled',
  'approval.created',
  'routine.fired',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DEFAULT_NOTIFICATION_EVENTS: readonly SseEventName[] = Object.freeze([
  'run.finished',
  'run.failed',
  'approval.created',
]);

export interface PushMessage {
  readonly type: NotificationType;
  readonly title: string;        // 1–120 characters
  readonly body: string;         // 1–240 characters
  readonly url: string;          // a relative path starting with '/'
  readonly tag: string;          // the delivery key
  readonly runId?: string;
  readonly chatId?: string;
  readonly routineId?: string;
}

export function deliveryKeyOf(record: {
  readonly type: SseEventName;
  readonly data: Readonly<Record<string, unknown>>;
}): string | null;

export function preferenceNamesOf(type: NotificationType): readonly SseEventName[];
export function isEnabled(preferences: NotificationPreferences, type: NotificationType): boolean;
export function isCritical(type: NotificationType): boolean;   // true only for approval.created

export function messageFor(input: {
  readonly type: NotificationType;
  readonly data: Readonly<Record<string, unknown>>;
  readonly routineTitle?: string | null;
}): PushMessage;
```

Frozen mapping table (all strings English, no accent invented; a routine title is passed
through and truncated):

| event | tag | preference names | critical | url | title / body |
| --- | --- | --- | --- | --- | --- |
| `run.merged` | `run:<runId>` | `run.merged`, `run.finished` | no | `/runs/<runId>` | `Run merged` / `Pull request #<pr.number> was merged.` |
| `run.finished` | `run:<runId>` | `run.finished` | no | `/runs/<runId>` | `Run succeeded` / `Run <runId> finished.` |
| `run.failed` | `run:<runId>` | `run.failed` | no | `/runs/<runId>` | `Run failed` / `<code>: <message>` |
| `run.cancelled` | `run:<runId>` | `run.cancelled` | no | `/runs/<runId>` | `Run cancelled` / `Run <runId> was cancelled.` (+ ` reason: <reason>` when present) |
| `approval.created` | `approval:<approvalId>` | `approval.created` | **yes** | `/approvals` | `<title>` / `The agent is waiting for your approval.` |
| `routine.fired` | `routine:<routineId>:<scheduledFor>` | `routine.fired` | no | `/jobs` | `<routineTitle \| "Routine">` / `A scheduled routine fired.` (a `kind: "reminder"` body is `Reminder.`) |

- `title` is truncated to 120 characters and `body` to 240 with a single trailing `…` when
  longer; no other transformation.
- `runId`/`chatId`/`routineId` are present only when the source event carries them
  (`approval.created` carries `runId: string | null` and `chatId: string | null`; a `null`
  omits the key).
- Any other event name — `run.output`, `run.tool`, `run.gate`, `run.pr`, `run.queued`,
  `run.started`, `run.permission`, `chat.*`, `job.changed`, `approval.resolved`, `telemetry`,
  `routine.replied`, `routine.failed` — returns `null` from `deliveryKeyOf`. Notifications are
  not a log mirror.

### Quiet hours — `apps/daemon/src/push/quiet-hours.ts`

```ts
export function inQuietHours(input: {
  readonly now: Date;
  readonly quietHours: string | null;   // "HH:MM-HH:MM"
  readonly timeZone: string;            // config.CB_TIMEZONE
}): boolean;
```

- `null` → `false`. A window whose start equals its end is empty → `false`.
- `start < end` → `[start, end)` in the given zone. `start > end` wraps midnight.
- Local wall time comes from `Intl.DateTimeFormat` with `{ timeZone, hourCycle: 'h23' }`;
  no dependency, no `Date` arithmetic that can drift across a DST change.
- Unsuitable input (`timeZone` not in the zone database) → `false`, never a throw: the daemon
  must still deliver.

### VAPID — `apps/daemon/src/push/vapid.ts`

```ts
export interface VapidSignerOptions {
  readonly publicKey: string;   // base64url, 65-byte uncompressed P-256 point
  readonly privateKey: string;  // base64url, 32-byte raw scalar OR PKCS#8 DER
  readonly subject: string;     // "mailto:…" or an https URL
  readonly now: () => Date;
  readonly ttlSeconds?: number; // default 43_200 (12 h), clamped to 86_400
}

export interface VapidSigner {
  /** `vapid t=<jwt>, k=<publicKey>` for one endpoint. */
  authorization(endpoint: string): string;
}

export function createVapidSigner(options: VapidSignerOptions): VapidSigner;
```

- JWT header `{ "typ": "JWT", "alg": "ES256" }`; payload `{ aud, exp, sub }` where `aud` is
  `new URL(endpoint).origin`, `exp` is `Math.floor(now.getTime() / 1000) + ttlSeconds` and
  `sub` is the configured subject. Base64url without padding, signature from
  `crypto.sign('sha256', signingInput, { key, dsaEncoding: 'ieee-p1363' })`.
- A 32-byte decoded private key is wrapped into PKCS#8 with the fixed P-256 prefix before
  `createPrivateKey`; a longer DER is parsed as PKCS#8 directly.
- Construction throws `PushError('invalid_config', 503, { key })` when a key does not decode
  or the curve is not `prime256v1`. `createModule`/`createPushService` catch it, log
  `push_config_invalid` with `{ key }` (never the value) and mark the service unconfigured.

### RFC 8291 payload encryption — `apps/daemon/src/push/rfc8291.ts`

```ts
export interface EncryptPayloadInput {
  readonly plaintext: Uint8Array;
  readonly keys: { readonly p256dh: string; readonly auth: string };  // base64url
  readonly salt?: Uint8Array;                 // 16 bytes; default random
  readonly ephemeralPrivateKey?: Uint8Array;  // 32-byte scalar; default random, tests pin it
}

export interface EncryptedPayload {
  readonly body: Uint8Array;         // salt(16) | rs(4, big-endian 4096) | idlen(1, 65) | keyid(65) | ciphertext
  readonly salt: Uint8Array;
  readonly senderPublicKey: Uint8Array;  // the 65-byte uncompressed point used as keyid
}

export function encryptPayload(input: EncryptPayloadInput): EncryptedPayload;
```

`aes128gcm` (RFC 8188) with one record: ECDH P-256 with the subscription's `p256dh`, the
RFC 8291 §3.4 HKDF-SHA256 expansion with the `auth` secret and the salt, `aes-128-gcm`, a
single `0x02` padding delimiter after the plaintext. `node:crypto` only — no dependency.

### Transport port — `apps/daemon/src/push/transport.ts`

```ts
export type PushKind = PushSubscription['kind'];   // 'web' | 'fcm' | 'apns'; contracts exports
                                                   // the schema, not a type alias for it

export interface PushSendInput {
  readonly subscription: PushSubscription;   // id, kind, endpoint, keys
  readonly message: PushMessage;
}

export type PushSendOutcome =
  | { readonly kind: 'accepted'; readonly status: number }        // 200, 201, 202
  | { readonly kind: 'expired'; readonly status: 404 | 410 }      // prune this subscription
  | { readonly kind: 'failed'; readonly status: number }          // keep it, log once
  | { readonly kind: 'unreachable'; readonly error: string };     // keep it, log once

export interface PushTransport {
  send(input: PushSendInput): Promise<PushSendOutcome>;
}

export interface WebPushTransportOptions {
  readonly vapid: VapidSigner;
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;          // default 10_000
  readonly ttlSeconds?: number;         // header TTL, default 300
}

export function createWebPushTransport(options: WebPushTransportOptions): PushTransport;
```

Only `kind: 'web'` is wired in this task: the request is `POST <endpoint>` with
`Authorization: <vapid.authorization(endpoint)>`,
`Content-Type: application/encoding/aes128gcm`, `TTL: 300`,
`Urgency: high` for `approval.created` / `normal` otherwise, and the encrypted body of the
JSON `{ type, title, body, url, tag, runId?, chatId?, routineId? }`. A `fetch` rejection or an
abort is `unreachable`, never a throw.

### Storage — `apps/daemon/src/push/storage.ts`

```ts
export const NOTIFICATION_PREFERENCES_KEY = 'notifications.preferences';
export const PUSH_SUBSCRIPTIONS_KEY = 'push.subscriptions';
export const MAX_PUSH_SUBSCRIPTIONS = 20;

export function createPushStorage(
  store: Store,
  defaults: NotificationPreferences,
  now: () => Date,
): {
  preferences(): NotificationPreferences;
  writePreferences(value: NotificationPreferences): NotificationPreferences;
  subscriptions(): readonly PushSubscription[];
  writeSubscriptions(value: readonly PushSubscription[]): void;
  removeSubscription(id: string): boolean;
};
```

- Reads go through the contracts parser: `parseNotificationPreferences` /
  `pushSubscriptionSchema.safeParse`. A malformed stored value is replaced by the default and
  logged once (`push_storage_invalid`, warn, `{ key }` only), never thrown to a route.
- Writes use `store.settings.set(key, value, now().toISOString())`. No migration, no new table,
  no SQL.

### Routes — `apps/daemon/src/push/routes.ts`

```ts
export function registerPushRoutes(app: DaemonApp, service: PushService): void;
```

| Method | Path | Scope | Success | Body |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/notifications/preferences` | `read` (auth middleware) | `200` | `NotificationPreferences` |
| `PATCH` | `/v1/notifications/preferences` | `write` (handler) | `200` | full replacement, `NotificationPreferences` |
| `POST` | `/v1/push/subscriptions` | `write` (handler) | `201` created / `200` replaced | `PushSubscription` |
| `DELETE` | `/v1/push/subscriptions/:id` | `write` (handler) | `204`, empty body | — |

- `PATCH` is a **full replacement** of both fields, parsed with
  `notificationPreferencesSchema` (strict: an unknown key is a 422). The stored `events` array
  is deduplicated, first occurrence wins, order preserved.
- `POST` body schema: `z.strictObject({ kind: pushKindSchema, endpoint: z.string().min(1).max(2048), keys: z.record(z.string(), z.string().min(1)) })`;
  for `kind: 'web'` the endpoint must be an `https` URL and `keys` must carry non-empty
  `p256dh` and `auth`, else 422 with `details.path` `push.endpoint` or `push.keys.p256dh`.
  An existing subscription with the same `endpoint` is replaced in place (same `id`) and
  answers `200`; the 21st distinct subscription is 422 with `details.reason: "subscription_limit"`.
- `DELETE` of an unknown id → `404` with `details.path: "push.id"`.
- Every refusal is the §3 envelope built with `errorBody` from `../app.js` and the
  `x-request-id` already on the context.
- The handlers use the same wrapper shape as `chat/routes.ts`: a `.catch` that maps
  `PushError` and `ContractParseError` (to `422` with `failure.first.path`) and rethrows
  anything else to `app.onError`.

`apps/daemon/src/push/errors.ts`:

```ts
export class PushError extends Error {
  readonly reason: 'not_found' | 'invalid_payload' | 'unauthorized' | 'insufficient_scope' | 'invalid_config';
  readonly status: 401 | 403 | 404 | 422 | 503;
  readonly details?: Record<string, unknown>;
}
export function pushErrorResponse(c, error: PushError): Response;
```

Status→code map, exactly as §3: 401 `unauthorized`, 403 `forbidden`, 404 `not_found`,
422 `validation_failed`, 503 `provider_unavailable`.

### Ids — `apps/daemon/src/push/ids.ts`

```ts
export function newSubscriptionId(random: (size: number) => Buffer = randomBytes): SubscriptionId;
```

`${ID_PREFIXES.pushSubscription}${20 Crockford base32 chars}` — the shape is `sub_` plus 20
characters, matching `SubscriptionId` = `^sub_[0-9A-Za-z]{6,40}$`. `sub_`, not `pushSubscription_`.

### Log lines (frozen `msg` values)

`push_unconfigured` (info, once per start), `push_config_invalid` (error, `{ key }`),
`push_storage_invalid` (warn, `{ key }`), `push_skipped` (debug,
`{ reason: 'preference' | 'dedupe' | 'unsupported_kind', type, tag }`), `push_held` (info,
`{ tag, type }`), `push_sent` (debug, `{ tag, subscriptionId, status }`), `push_pruned` (info,
`{ subscriptionId, status }`), `push_failed` (warn, `{ tag, subscriptionId, status }`).

**Never logged:** the endpoint URL, `keys`, `p256dh`, `auth`, the VAPID private key, the JWT,
the encrypted payload, the message body. `subscriptionId` and `tag` are allowed.

### Purity

`mapping.ts`, `quiet-hours.ts`, `rfc8291.ts` and `vapid.ts` are pure: no store, no fetch, no
environment, no ambient clock (the clock is a parameter). `storage.ts`, `service.ts` and
`transport.ts` own the I/O. Nothing here may be moved into `@codebox/core`: it reads config,
SQLite and the network.

### Data

Two settings rows, introduced by this task, both `packages/store`'s key-value `settings`
table (no migration):

| Key | Shape | Default | Cap |
| --- | --- | --- | --- |
| `notifications.preferences` | `notificationPreferencesSchema` — `{ events: SseEventName[], quietHours: "HH:MM-HH:MM" \| null }` | `{ events: DEFAULT_NOTIFICATION_EVENTS, quietHours: config.CB_QUIET_HOURS }` | `events` deduplicated, no cap |
| `push.subscriptions` | `pushSubscriptionSchema[]` — `{ id, kind, endpoint, keys }`, `id` is `sub_…` | `[]` | 20 rows |

The dedupe set, the event cursor and the quiet-hours hold list are process memory and are
**not** persisted (see the pump semantics). No new table, no numbered migration, no column.

## 🧩 Configuration

Keys this task reads — all already in `packages/contracts/src/config.ts`. **No key is added.**

| Key | Default | Read as | Failure |
| --- | --- | --- | --- |
| `CB_VAPID_PUBLIC_KEY` | unset | base64url 65-byte P-256 point | unset → unconfigured (info); invalid → `push_config_invalid` (error), unconfigured |
| `CB_VAPID_PRIVATE_KEY` | unset | base64url 32-byte scalar or PKCS#8 DER | same |
| `CB_VAPID_SUBJECT` | `mailto:<CB_OWNER_EMAIL>` or null | JWT `sub` | null → unconfigured |
| `CB_QUIET_HOURS` | null | default of `preferences().quietHours` | `CB_*` parse already rejects a malformed window at boot |
| `CB_TIMEZONE` | `Europe/Madrid` | zone for quiet hours | `Intl` failure → never quiet |
| `CB_FCM_*`, `CB_APNS_*` | unset | **not read in this task** | their subscriptions are stored and skipped |

"Unconfigured" is a normal state (`docs/providers.md` §10): the routes still answer, the pump
does not run, and every delivery counts as `skipped`.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; it includes every `apps/daemon/src/push/*.test.ts`.
  - `npm run build` — `tsc -b` over the workspaces; the daemon must compile.
  - `git diff --name-only main...task-16` — audit against the exclusive paths; every path must
    start with `apps/daemon/src/push/` or be exactly `apps/daemon/README.md`.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint`, `npm run build`).
  - [ ] `[unit]` The declared tests exist and pass (`npm test -- --project apps/daemon`).
  - [ ] `[unit]` Nothing outside the exclusive paths was touched (`git diff --name-only
        main...task-16`).
  - [ ] `[unit]` One finished run yields exactly one push per subscribed device and not one per
        event: `service.test.ts` appends `run.merged` then `run.finished` for the same
        `runId` through `store.events.append`, subscribes two `web` subscriptions, drives
        `pump()`, and asserts the fake transport received exactly **two** sends (one per
        subscription) with `tag: 'run:<runId>'`, and that a second `pump()` sends nothing.
  - [ ] `[unit]` A `410` answer prunes exactly that subscription: `service.test.ts` configures
        a fake transport answering `{ kind: 'expired', status: 410 }` for the first
        subscription only, drives `pump()`, and asserts `listSubscriptions()` has one entry
        (the other), that `store.settings.get('push.subscriptions')` has one entry, and that a
        `push_pruned` log record carries that `subscriptionId`.
  - [ ] `[unit]` An event missing from the preferences is not sent:
        `updatePreferences({ events: ['run.failed'], quietHours: null })`, append
        `run.finished`, `pump()` → zero sends, `report.skipped` 1, a `push_skipped` record
        with `reason: 'preference'`.
  - [ ] `[unit]` Quiet hours hold a non-critical push: `quietHours: '22:00-08:00'`, a clock
        pinned to `2026-11-10T21:30:00.000Z` (22:30 in `Europe/Madrid`), a `run.finished`
        event → zero sends, `report.held` 1, a `push_held` record; moving the clock to
        `2026-11-11T07:30:00.000Z` (08:30 local) and calling `pump()` again sends it once and
        clears the hold list.
  - [ ] `[unit]` The VAPID JWT decodes with the configured public key and its `aud`/`exp` are
        correct: `vapid.test.ts` generates a P-256 pair with `node:crypto`, builds a signer
        with `ttlSeconds: 3600` and a pinned clock, calls `authorization('https://push.example.com/x?y=1')`,
        splits `vapid t=…, k=…`, splits the JWT, verifies the ES256 signature with
        `crypto.verify('sha256', …, publicKey, { dsaEncoding: 'ieee-p1363' })`, and asserts the
        header is `{ typ: 'JWT', alg: 'ES256' }`, `aud === 'https://push.example.com'`,
        `sub === subject`, and `exp === floor(now/1000) + 3600`.
  - [ ] `[unit]` The payload round-trips as `aes128gcm`: `rfc8291.test.ts` encrypts with a
        pinned salt and ephemeral key, asserts the header bytes (`salt` length 16,
        `rs === 4096`, `idlen === 65`) and decrypts the body with an independently written
        `createDecipheriv('aes-128-gcm')` path plus the recipient private key, recovering the
        plaintext with its `0x02` delimiter. A different salt produces a different body.
  - [ ] `[unit]` The four routes match `docs/api.md` §5.7: `routes.test.ts` builds the app with
        `createApp` + the auth module + `registerPushRoutes` (the harness of
        `chat/routes.test.ts`), and asserts: no token → 401 on all four; a `read`-only device →
        403 on `PATCH`, `POST` and `DELETE`; `GET` returns the defaults
        `{ events: ['run.finished','run.failed','approval.created'], quietHours: null }`; a
        `PATCH` with an unknown key → 422 `validation_failed` with a `details.path`; a
        `PATCH` with a bad quiet window → 422; `POST` with a `web` subscription without
        `keys.p256dh` → 422; `POST` a valid web subscription → 201 with a `sub_` id that
        parses as `PushSubscription`; the same endpoint again → 200 with the same id; a second
        endpoint → 201; `DELETE` → 204 with an empty body and the subscription gone from
        `service.listSubscriptions()` and from `store.settings.get('push.subscriptions')`;
        `DELETE` again → 404 with `details.path: 'push.id'`; every error body is the §3
        envelope and the request log lines contain no endpoint and no key.
  - [ ] `[unit]` `createModule(context).register(app)` mounts the routes and `shutdown()`
        clears the timer: `index.test.ts` asserts `name === 'push'`; with no VAPID key in the
        config the module logs `push_unconfigured`, and on an app that also mounted the auth
        module the four routes answer `401` without a token (so they exist and the middleware
        guards them); `shutdown()` twice does not throw. A second case, with a generated VAPID
        pair and `vi.useFakeTimers()`, asserts `vi.getTimerCount()` is `1` after `register` and
        `0` after `shutdown()`. With no VAPID key `start()` is a no-op, so
        `apps/daemon/src/start.test.ts` still exits cleanly.
  - [ ] `[live]` **Not measured by QA on CI: report it `not-run`.** One real browser
        subscription receives the push and deep-links to the run, measured on the VM: a real
        VAPID pair in `/etc/codebox/env`, the built PWA served by the daemon, the operator
        subscribes `navigator.serviceWorker.ready → pushManager.subscribe({ userVisibleOnly:
        true, applicationServerKey: <CB_VAPID_PUBLIC_KEY> })`, registers it with
        `curl -X POST /v1/push/subscriptions` using a `write` device token, then one run is
        started and allowed to finish; the measurement is (a) exactly one notification service
        worker `push` event for the run — not two for `run.merged`+`run.finished` — and (b)
        tapping it navigates to `/runs/<runId>` and that page shows the run's timeline. On CI
        the plan stops at the `[unit]` criteria and reports this line `not-run`.

## 📣 Coordination

- For the Architect: the `push` subsystem stops being `absent`; `DEFAULT_SUBSYSTEM_FLAGS.push`
  is already `true`, so nothing in `modules.ts` changes. `docs/providers.md` §10 is
  deliberately untouched.
- For Task-35 (routine engine): import `createPushService` and the `PushMessage` type from
  `apps/daemon/src/push/index.ts`. A reminder is
  `pushService.deliver({ type: 'routine.fired', title: routine.title, body: 'Reminder.', url: '/jobs', tag: 'routine:<routineId>:<scheduledFor>', routineId })`
  — `deliver()` does not consult the dedupe set, so the routine fire row is the dedupe.
  Call `configured()` first: an unconfigured daemon must make a reminder a no-op, not an
  error, and must not throw.
- For Task-23 (settings/notifications screen): the routes and bodies above are frozen. The
  screen needs `CB_VAPID_PUBLIC_KEY` to call `pushManager.subscribe`; §5.7 has no route that
  serves it (see the open note in the Architect's report). Do not invent one here.
- For Task-26 (e2e): a fake transport can be injected through
  `createPushService({ context, transports: { web: fake } })`; no test needs a real push
  service.

## ⛔ Out of scope

- No new npm dependency: no `web-push`, no `@types/web-push`, no JWT library. `node:crypto`
  and `node:url` only.
- No change to `package.json`, `package-lock.json`, `tsconfig*`, `apps/daemon/src/main.ts`,
  `apps/daemon/src/modules.ts`, `packages/contracts/**`, `packages/store/**`, `TODO.md`,
  `CHANGELOG.md`, `docs/**` — including `docs/providers.md` and `docs/api.md`.
- No new `CB_*` key, no migration, no push table.
- No FCM or APNs transport: `fcm`/`apns` subscriptions are stored, listed and skipped. No
  native Capacitor delivery.
- No notification for an event that is not in the mapping table — no `run.output` mirror, no
  per-tool notification.
- No retry queue across a restart, no persisted cursor, no background job runner.
- No provider-status plumbing (`providerStatusSchema.push`) — that belongs to the telemetry /
  providers task; do not touch `/v1/providers`.
- No refactor of `chat/**`, `events/**`, `runs/**` or `auth/**`. Reading them is fine; editing
  them is not.
