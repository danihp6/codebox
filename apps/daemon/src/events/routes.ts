import type { Context } from 'hono';
import { z } from 'zod';
import {
  ChatId,
  ContractParseError,
  RunId,
  SSE_RETRY_MS,
  parseOrThrow,
  sseEventNameSchema,
} from '@codebox/contracts';
import type { ErrorCode, SseEventName } from '@codebox/contracts';
import { API_PREFIX, errorBody } from '../app.js';
import { authenticatedDevice } from '../auth/index.js';
import type { AppVariables, DaemonApp } from '../modules.js';
import { SSE_CONNECTIONS_PER_DEVICE } from './limits.js';
import type { ConnectionLimiter } from './limits.js';
import { eventFrame, gapFrame, heartbeatFrame, retryFrame } from './frames.js';
import type { SseBridge, SseFilter, SseFrame } from './bridge.js';

export interface RegisterEventRoutesOptions {
  readonly bridge: SseBridge;
  readonly limiter: ConnectionLimiter;
}

type AppContext = Context<{ Variables: AppVariables }>;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;
const EVENT_PATH = `${API_PREFIX}/events`;
const LAST_EVENT_ID = /^\d+$/;
const RETRY_AFTER_SECONDS = 60;

const querySchema = z.strictObject({
  types: z.string().min(1).optional(),
  runId: RunId.optional(),
  chatId: ChatId.optional(),
});

function queryInput(c: AppContext): Record<string, string> {
  const input: Record<string, string> = {};
  for (const [key, value] of new URL(c.req.url).searchParams) {
    if (Object.hasOwn(input, key)) throw invalid('events', `events.${key}`);
    input[key] = value;
  }
  return input;
}

function invalid(boundary: string, path: string): ContractParseError {
  return new ContractParseError(boundary, [
    { path, message: 'invalid query parameter', code: 'custom' },
  ]);
}

function parseTypes(raw: string | undefined): readonly SseEventName[] | undefined {
  if (raw === undefined) return undefined;
  const names: SseEventName[] = [];
  for (const entry of raw.split(',')) {
    const parsed = sseEventNameSchema.safeParse(entry.trim());
    if (!parsed.success) throw invalid('events', 'events.types');
    names.push(parsed.data);
  }
  return names;
}

function lastEventId(c: AppContext): number {
  const header = c.req.header('last-event-id');
  if (header === undefined) return 0;
  if (!LAST_EVENT_ID.test(header)) throw invalid('events', 'events.lastEventId');
  return Number(header);
}

function errorJson(
  c: AppContext,
  code: ErrorCode,
  message: string,
  status: 401 | 422 | 429,
  details: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  const body = errorBody({
    code,
    message,
    requestId: c.get('requestId'),
    details,
  });
  return c.json(body, status, { ...JSON_HEADERS, ...headers });
}

function frameText(frame: SseFrame): string {
  switch (frame.kind) {
    case 'event':
      return eventFrame({ id: frame.id, event: frame.event, data: frame.data });
    case 'gap':
      return gapFrame({ afterId: frame.afterId, latestId: frame.latestId, ts: frame.ts });
    case 'heartbeat':
      return heartbeatFrame();
  }
}

function sseResponse(frames: AsyncIterable<SseFrame>, release: () => void): Response {
  const encoder = new TextEncoder();
  const iterator = frames[Symbol.asyncIterator]();
  let released = false;
  const releaseOnce = (): void => {
    if (released) return;
    released = true;
    release();
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(encoder.encode(retryFrame(SSE_RETRY_MS)));
    },
    async pull(controller): Promise<void> {
      let step: IteratorResult<SseFrame>;
      try {
        step = await iterator.next();
      } catch {
        releaseOnce();
        controller.close();
        return;
      }
      if (step.done === true) {
        releaseOnce();
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(frameText(step.value)));
    },
    async cancel(): Promise<void> {
      releaseOnce();
      await iterator.return?.(undefined);
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

export function registerEventRoutes(app: DaemonApp, options: RegisterEventRoutesOptions): void {
  app.get(EVENT_PATH, (c): Response => {
    const device = authenticatedDevice(c);
    if (device === null) {
      return errorJson(c, 'unauthorized', 'Unauthorized', 401, { reason: 'unauthorized' });
    }
    let query: z.infer<typeof querySchema>;
    let afterId: number;
    let filter: SseFilter;
    try {
      query = parseOrThrow(querySchema, queryInput(c), 'events');
      afterId = lastEventId(c);
      const types = parseTypes(query.types);
      filter = {
        ...(types === undefined ? {} : { types }),
        ...(query.runId === undefined ? {} : { runId: query.runId }),
        ...(query.chatId === undefined ? {} : { chatId: query.chatId }),
      };
    } catch (error) {
      if (error instanceof ContractParseError) {
        return errorJson(c, 'validation_failed', 'Invalid request', 422, {
          path: error.first.path,
        });
      }
      throw error;
    }
    if (options.limiter.count(device.id) >= SSE_CONNECTIONS_PER_DEVICE) {
      return errorJson(
        c,
        'rate_limited',
        'Too many streams',
        429,
        { reason: 'sse_limit' },
        {
          'Retry-After': String(RETRY_AFTER_SECONDS),
        },
      );
    }
    return sseResponse(options.bridge.frames({ afterId, filter }), options.limiter.open(device.id));
  });
}
