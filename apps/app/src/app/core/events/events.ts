import { parseSseStreamEvent } from '@codebox/contracts';
import type { SseStreamEvent } from '@codebox/contracts';
import type { SseFrame } from './sse-client';

export type SseConnectionState = 'connecting' | 'open' | 'closed';

/** Untrusted stream data becomes a typed event only through the contracts schema. */
export function toStreamEvent(frame: SseFrame): SseStreamEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(frame.data);
  } catch {
    return null;
  }
  try {
    return parseSseStreamEvent({ event: frame.event, data });
  } catch {
    return null;
  }
}
