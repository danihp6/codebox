/** docs/api.md §7: three concurrent streams per device, counted in memory. */
export const SSE_CONNECTIONS_PER_DEVICE = 3;

export interface ConnectionLimiter {
  open(deviceId: string): () => void;
  count(deviceId: string): number;
}

export function createConnectionLimiter(
  limit: number = SSE_CONNECTIONS_PER_DEVICE,
): ConnectionLimiter {
  const effective =
    Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : SSE_CONNECTIONS_PER_DEVICE;
  const counts = new Map<string, number>();
  return {
    /** Over the limit the slot is not taken and the returned release does nothing. */
    open(deviceId: string): () => void {
      const current = counts.get(deviceId) ?? 0;
      if (current >= effective) return noop;
      counts.set(deviceId, current + 1);
      let released = false;
      return (): void => {
        if (released) return;
        released = true;
        const remaining = counts.get(deviceId) ?? 0;
        if (remaining <= 1) counts.delete(deviceId);
        else counts.set(deviceId, remaining - 1);
      };
    },
    count(deviceId: string): number {
      return counts.get(deviceId) ?? 0;
    },
  };
}

function noop(): void {
  // A refused connection has nothing to release.
}
