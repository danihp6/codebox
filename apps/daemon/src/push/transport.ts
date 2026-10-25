import type { PushSubscription } from '@codebox/contracts';
import type { PushMessage } from './mapping.js';
import { encryptPayload } from './rfc8291.js';
import type { VapidSigner } from './vapid.js';

/** `web` | `fcm` | `apns`; contracts exports the schema, not a type alias for it. */
export type PushKind = PushSubscription['kind'];

export interface PushSendInput {
  readonly subscription: PushSubscription;
  readonly message: PushMessage;
}

export type PushSendOutcome =
  | { readonly kind: 'accepted'; readonly status: number }
  | { readonly kind: 'expired'; readonly status: 404 | 410 }
  | { readonly kind: 'failed'; readonly status: number }
  | { readonly kind: 'unreachable'; readonly error: string };

export interface PushTransport {
  send(input: PushSendInput): Promise<PushSendOutcome>;
}

export interface WebPushTransportOptions {
  readonly vapid: VapidSigner;
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
  readonly ttlSeconds?: number;
}

export const WEB_PUSH_TIMEOUT_MS = 10_000;
export const WEB_PUSH_TTL_SECONDS = 300;

const CONTENT_TYPE = 'application/encoding/aes128gcm';
const CRITICAL_URGENCY = 'high';
const NORMAL_URGENCY = 'normal';

export function createWebPushTransport(options: WebPushTransportOptions): PushTransport {
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? WEB_PUSH_TIMEOUT_MS));
  const ttlSeconds = Math.max(0, Math.trunc(options.ttlSeconds ?? WEB_PUSH_TTL_SECONDS));

  return {
    async send(input: PushSendInput): Promise<PushSendOutcome> {
      try {
        const encrypted = encryptPayload({
          plaintext: Buffer.from(JSON.stringify(payloadOf(input.message)), 'utf8'),
          keys: {
            p256dh: input.subscription.keys['p256dh'] ?? '',
            auth: input.subscription.keys['auth'] ?? '',
          },
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await fetchImpl(input.subscription.endpoint, {
            method: 'POST',
            headers: {
              authorization: options.vapid.authorization(input.subscription.endpoint),
              'content-type': CONTENT_TYPE,
              ttl: String(ttlSeconds),
              urgency:
                input.message.type === 'approval.created' ? CRITICAL_URGENCY : NORMAL_URGENCY,
            },
            body: encrypted.body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        return classify(response.status);
      } catch (error) {
        return { kind: 'unreachable', error: errorNameOf(error) };
      }
    },
  };
}

function payloadOf(message: PushMessage): Record<string, unknown> {
  return {
    type: message.type,
    title: message.title,
    body: message.body,
    url: message.url,
    tag: message.tag,
    ...(message.runId === undefined ? {} : { runId: message.runId }),
    ...(message.chatId === undefined ? {} : { chatId: message.chatId }),
    ...(message.routineId === undefined ? {} : { routineId: message.routineId }),
  };
}

function classify(status: number): PushSendOutcome {
  if (status === 200 || status === 201 || status === 202) return { kind: 'accepted', status };
  if (status === 404 || status === 410) return { kind: 'expired', status };
  return { kind: 'failed', status };
}

/** The name only: a thrown message can echo the endpoint, and the endpoint is never logged. */
function errorNameOf(error: unknown): string {
  return error instanceof Error && error.name !== '' ? error.name : 'unreachable';
}
