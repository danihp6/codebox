import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DesignDocumentError, parseTokens, tokenValues } from './index.js';

const FIXTURE_TOKENS = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/tokens.json', import.meta.url)), 'utf8'),
) as unknown;

describe('parseTokens', () => {
  it('flattens nested DTCG groups to dot paths', () => {
    const tokens = parseTokens({
      color: { brand: { green: { $value: '#15803d', $type: 'color' } } },
      space: { gap: { $value: 8, $type: 'dimension' } },
    });

    expect(Object.keys(tokens).sort()).toEqual(['color.brand.green', 'space.gap']);
    expect(tokens['color.brand.green']).toEqual({ $value: '#15803d', $type: 'color' });
    expect(tokens['space.gap']).toEqual({ $value: 8, $type: 'dimension' });
  });

  it('keeps $value exactly as written and carries $description', () => {
    const tokens = parseTokens({
      color: { night: { $value: ' #0B1120 ', $type: 'color', $description: 'Surface.' } },
    });

    expect(tokens['color.night']).toEqual({
      $value: ' #0B1120 ',
      $type: 'color',
      $description: 'Surface.',
    });
  });

  it('resolves aliases to the token they name, and a chain to its end', () => {
    const tokens = parseTokens({
      color: {
        night: { $value: '#0b1120', $type: 'color' },
        ink: { $value: '{color.night}' },
        text: { $value: '{color.ink}' },
      },
    });

    expect(tokens['color.ink']).toEqual({ $value: '#0b1120', $type: 'color' });
    expect(tokens['color.text']).toEqual({ $value: '#0b1120', $type: 'color' });
  });

  it('accepts every pinned $type and an empty document', () => {
    const types = [
      'color',
      'dimension',
      'fontFamily',
      'fontWeight',
      'duration',
      'cubicBezier',
      'number',
    ];
    const document = Object.fromEntries(types.map((type) => [type, { $value: 'x', $type: type }]));

    const tokens = parseTokens(document);

    expect(Object.keys(tokens)).toHaveLength(types.length);
    expect(parseTokens({})).toEqual({});
  });

  it('rejects a leaf without $value', () => {
    expect(() => parseTokens({ color: { green: { $type: 'color' } } })).toThrow(
      DesignDocumentError,
    );
    try {
      parseTokens({ color: { green: { $type: 'color' } } });
    } catch (error) {
      expect(error).toMatchObject({
        boundary: 'tokens',
        issues: [{ path: 'color.green', message: 'token is missing $value' }],
      });
    }
  });

  it('rejects an unknown $type', () => {
    expect(() => parseTokens({ color: { green: { $value: '#15803d', $type: 'colour' } } })).toThrow(
      DesignDocumentError,
    );
  });

  it('rejects an unresolved alias and an alias cycle', () => {
    expect(() => parseTokens({ color: { ink: { $value: '{color.missing}' } } })).toThrow(
      DesignDocumentError,
    );
    expect(() =>
      parseTokens({
        color: {
          a: { $value: '{color.b}' },
          b: { $value: '{color.a}' },
        },
      }),
    ).toThrow(DesignDocumentError);
  });

  it('rejects a non-object group, a non-object document and an unknown field', () => {
    expect(() => parseTokens({ color: 'red' })).toThrow(DesignDocumentError);
    expect(() => parseTokens([])).toThrow(DesignDocumentError);
    expect(() => parseTokens(null)).toThrow(DesignDocumentError);
    expect(() =>
      parseTokens({ color: { green: { $value: '#15803d', $type: 'color', $extra: 1 } } }),
    ).toThrow(DesignDocumentError);
  });

  it('parses the fixture and reports only the boundary it broke', () => {
    const tokens = parseTokens(FIXTURE_TOKENS);

    expect(Object.keys(tokens)).toContain('color.ink');
    expect(tokens['color.ink']).toEqual({ $value: '#0b1120', $type: 'color' });
  });
});

describe('tokenValues', () => {
  it('lowercases, trims, deduplicates and sorts every resolved value', () => {
    const tokens = parseTokens({
      a: { $value: ' #FF00FF ', $type: 'color' },
      b: { $value: '#ff00ff', $type: 'color' },
      c: { $value: 8, $type: 'dimension' },
    });

    expect(tokenValues(tokens)).toEqual(['#ff00ff', '8']);
  });

  it('lists the fixture literals the colour rule accepts', () => {
    const values = tokenValues(parseTokens(FIXTURE_TOKENS));

    expect(values).toContain('#15803d');
    expect(values).toContain('#0b1120');
    expect(values).toContain('8');
    expect([...values].sort()).toEqual(values);
    expect(new Set(values).size).toBe(values.length);
  });
});
