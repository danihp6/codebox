export interface SseFrame {
  readonly id: string | null;
  readonly event: string;
  readonly data: string;
}

export interface SseClientOptions {
  readonly url: string;
  readonly token: () => string | null;
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
  readonly onFrame: (frame: SseFrame) => void;
  readonly onGap: (data: { afterId: number; latestId: number }) => void;
  readonly onState: (state: 'connecting' | 'open' | 'closed') => void;
}

export interface SseClient {
  start(afterId: number): void;
  markProcessed(id: number): void;
  stop(): void;
  readonly backoffMs: () => number;
}

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const JITTER_RANGE = 0.4;

interface FrameParts {
  id?: string | null;
  event?: string;
  data: string[];
}

export function parseSseChunk(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalised = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lastBreak = normalised.lastIndexOf('\n\n');
  if (lastBreak === -1) return { frames: [], rest: buffer };

  const head = normalised.slice(0, lastBreak);
  const rest = normalised.slice(lastBreak + 2);
  const frames: SseFrame[] = [];
  for (const block of head.split('\n\n')) {
    const frame = parseBlock(block);
    if (frame !== null) frames.push(frame);
  }
  return { frames, rest };
}

function parseBlock(block: string): SseFrame | null {
  const parts: FrameParts = { data: [] };
  for (const line of block.split('\n')) {
    if (line.length === 0 || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? '' : line.slice(separator + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'id') parts.id = value;
    else if (field === 'event') parts.event = value;
    else if (field === 'data') parts.data.push(value);
  }
  if (parts.data.length === 0) return null;
  const frame: SseFrame = {
    id: parts.id ?? null,
    event: parts.event === undefined || parts.event.length === 0 ? 'message' : parts.event,
    data: parts.data.join('\n'),
  };
  return frame;
}

export function createSseClient(options: SseClientOptions): SseClient {
  let resumeAt = 0;
  let attempt = 0;
  let stopped = true;
  let generation = 0;
  let controller: AbortController | null = null;

  const delayForAttempt = (): number => {
    const base = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
    return Math.round(base * (1 - JITTER_RANGE / 2 + JITTER_RANGE * options.random()));
  };

  const halt = (): void => {
    controller?.abort();
    controller = null;
  };

  const stop = (): void => {
    if (stopped) {
      halt();
      return;
    }
    stopped = true;
    generation += 1;
    halt();
    options.onState('closed');
  };

  const start = (afterId: number): void => {
    stopped = true;
    generation += 1;
    halt();
    resumeAt = afterId;
    attempt = 0;
    stopped = false;
    const run = generation;
    void loop(run);
  };

  const markProcessed = (id: number): void => {
    resumeAt = id;
  };

  const waitBeforeRetry = async (): Promise<void> => {
    const delay = delayForAttempt();
    attempt += 1;
    await options.sleep(delay);
  };

  const fetchStream = async (): Promise<Response | null> => {
    const streamController = new AbortController();
    controller = streamController;
    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      'last-event-id': String(resumeAt),
    };
    const token = options.token();
    if (token !== null) headers['authorization'] = `Bearer ${token}`;
    try {
      const response = await options.fetch(options.url, {
        method: 'GET',
        headers,
        signal: streamController.signal,
      });
      if (!response.ok || response.body === null) return null;
      return response;
    } catch {
      return null;
    }
  };

  const readStream = async (response: Response, run: number): Promise<void> => {
    const reader = response.body?.getReader();
    if (reader === undefined) return;
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        if (stopped || run !== generation) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.frames) {
          attempt = 0;
          if (frame.event === 'gap') {
            const gap = decodeGap(frame.data);
            if (gap !== null) {
              resumeAt = gap.latestId;
              options.onGap(gap);
              return;
            }
            continue;
          }
          options.onFrame(frame);
          if (stopped || run !== generation) return;
        }
      }
    } finally {
      void reader.cancel().catch(() => undefined);
    }
  };

  const loop = async (run: number): Promise<void> => {
    while (!stopped && run === generation) {
      options.onState('connecting');
      const response: Response | null = await fetchStream();
      if (stopped || run !== generation) return;
      if (response !== null) {
        options.onState('open');
        try {
          await readStream(response, run);
        } catch {
          // A dropped stream is retried like a clean close; the resume point is unchanged.
        }
        if (stopped || run !== generation) return;
        options.onState('closed');
      } else {
        options.onState('closed');
      }
      await waitBeforeRetry();
    }
  };

  return { start, markProcessed, stop, backoffMs: delayForAttempt };
}

function decodeGap(data: string): { afterId: number; latestId: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { afterId?: unknown; latestId?: unknown };
  if (typeof record.afterId !== 'number' || typeof record.latestId !== 'number') return null;
  return { afterId: record.afterId, latestId: record.latestId };
}
