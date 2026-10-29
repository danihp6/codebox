import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLINK_PHASES, BLINK_STAGGER_MS, assignBlinkPhases, blinkPhase } from './workers.motion';

const CSS = readFileSync(resolve(process.cwd(), 'src/theme/variables.css'), 'utf8');
const DECORATIONS = ['.cb-workers-truck', '.cb-workers-package', '.cb-workers-token'] as const;

function blockAt(index: number): string {
  const open = CSS.indexOf('{', index);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open + 1, close);
}

function rule(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return blockAt(at);
}

function blocks(selector: string): string[] {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const at = CSS.indexOf(`${selector} {`, from);
    if (at === -1) break;
    found.push(blockAt(at));
    from = at + selector.length;
  }
  return found;
}

function hasRule(selector: string, declaration: string): boolean {
  return blocks(selector).some((body) => body.includes(declaration));
}

function groupedRule(selector: string): string {
  const at = CSS.indexOf(selector);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return blockAt(at);
}

describe('blinkPhase', () => {
  it('wraps every integer into the four phases', () => {
    expect(blinkPhase(0)).toBe(0);
    expect(blinkPhase(1)).toBe(1);
    expect(blinkPhase(2)).toBe(2);
    expect(blinkPhase(3)).toBe(3);
    expect(blinkPhase(4)).toBe(0);
    expect(blinkPhase(-1)).toBe(3);
    expect(blinkPhase(-4)).toBe(0);
    expect(blinkPhase(-5)).toBe(3);
    expect(blinkPhase(7)).toBe(3);

    for (const index of [-1234, -9, -1, 0, 1, 3, 4, 5, 1234]) {
      const phase = blinkPhase(index);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThanOrEqual(BLINK_PHASES - 1);
      expect(Number.isInteger(phase)).toBe(true);
    }
  });

  it('exports the phase count and the one-second stagger', () => {
    expect(BLINK_PHASES).toBe(4);
    expect(BLINK_STAGGER_MS).toBe(1000);
  });
});

describe('assignBlinkPhases', () => {
  it('gives the first four cards four distinct phases and repeats phase 0 on the fifth', () => {
    const cards = ['a', 'b', 'c', 'd', 'e'].map((workId) => ({ workId }));

    const phases = assignBlinkPhases(cards);

    expect([...phases.entries()]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
      ['e', 0],
    ]);
    expect(new Set(cards.slice(0, 4).map((card) => phases.get(card.workId))).size).toBe(4);
    expect(phases.size).toBe(cards.length);
  });

  it('returns an empty map for an empty board and keeps the cards untouched', () => {
    const cards = Object.freeze([Object.freeze({ workId: 'wrk_01' })]);

    expect([...assignBlinkPhases([])]).toEqual([]);
    expect(assignBlinkPhases(cards).get('wrk_01')).toBe(0);
    expect(cards).toHaveLength(1);
  });
});

describe('workers motion css', () => {
  it('carries the four contract animations and their keyframes', () => {
    expect(hasRule('.cb-workers-truck', 'animation: cb-truck-in 5s ease-in-out infinite;')).toBe(
      true,
    );
    expect(hasRule('.cb-workers-package', 'animation: cb-package-belt 4s linear infinite;')).toBe(
      true,
    );
    expect(
      hasRule('.cb-workers-token', 'animation: cb-token-cross 3.2s ease-in-out infinite;'),
    ).toBe(true);
    expect(hasRule('.cb-worker-face', 'animation: cb-face-blink 4s steps(1, end) infinite;')).toBe(
      true,
    );

    for (const name of ['cb-truck-in', 'cb-package-belt', 'cb-token-cross', 'cb-face-blink']) {
      expect(CSS).toContain(`@keyframes ${name} {`);
    }
  });

  it('makes the three decorations pointer transparent', () => {
    for (const selector of DECORATIONS) {
      expect(groupedRule(selector)).toContain('pointer-events: none;');
    }
  });

  it('staggers the four face phases by one second each', () => {
    const delays: readonly (readonly [number, string])[] = [
      [0, '0ms'],
      [1, '1000ms'],
      [2, '2000ms'],
      [3, '3000ms'],
    ];

    for (const [phase, delay] of delays) {
      const block = rule(`.cb-worker-face[data-blink-phase='${phase}']`);
      expect(block).toContain(`animation-delay: ${delay};`);
    }
  });

  it('stops every loop under prefers-reduced-motion: reduce', () => {
    const reduced = '@media (prefers-reduced-motion: reduce)';
    const at = CSS.indexOf(reduced);
    expect(at).toBeGreaterThanOrEqual(0);

    const tail = CSS.slice(at);
    expect(tail).toContain('animation: none;');
    expect(tail).not.toContain('animation-play-state');
    for (const selector of ['.cb-worker-face', ...DECORATIONS]) {
      expect(tail).toContain(selector);
    }

    let depth = 0;
    let end = -1;
    for (let index = 0; index < tail.length; index += 1) {
      const char = tail[index];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    expect(end).toBeGreaterThan(0);
    expect(tail.slice(end + 1).trim()).toBe('');
  });
});
