import { createHash, timingSafeEqual } from 'node:crypto';

function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
