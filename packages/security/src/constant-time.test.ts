import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { safeEqual, sha256Hex } from './constant-time.js';

describe('constant-time comparison', () => {
  it('accepts equal strings and buffers', () => {
    expect(safeEqual('pa55word', 'pa55word')).toBe(true);
    expect(safeEqual(Buffer.from('pa55word'), Buffer.from('pa55word'))).toBe(true);
    expect(safeEqual('pa55word', Buffer.from('pa55word'))).toBe(true);
  });

  it('rejects different content and different lengths', () => {
    expect(safeEqual('pa55word', 'pa55worD')).toBe(false);
    expect(safeEqual('short', 'a much longer value')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('hashes with SHA-256 to lowercase hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex(Buffer.from('abc'))).toBe(sha256Hex('abc'));
    expect(sha256Hex('')).toBe(createHash('sha256').update('').digest('hex'));
  });
});
