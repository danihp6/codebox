/**
 * `text/event-stream` framing, pure and clock-free: the bridge decides which frame, the handler
 * decides when to write it. `data` is one JSON line, never a multi-line payload.
 */
export function retryFrame(retryMs: number): string {
  return `retry: ${retryMs}\n\n`;
}

export function heartbeatFrame(): string {
  return ': ping\n\n';
}

export function eventFrame(input: {
  readonly id: number;
  readonly event: string;
  readonly data: unknown;
}): string {
  return `id: ${input.id}\nevent: ${input.event}\ndata: ${JSON.stringify(input.data)}\n\n`;
}

export function gapFrame(input: {
  readonly afterId: number;
  readonly latestId: number;
  readonly ts: string;
}): string {
  const data = JSON.stringify({
    afterId: input.afterId,
    latestId: input.latestId,
    ts: input.ts,
  });
  return `event: gap\ndata: ${data}\n\n`;
}
