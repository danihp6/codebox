import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
  it('reads a fenced block as one code block with its language and verbatim text', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1;\n```');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ kind: 'code', language: 'ts', text: 'const a = 1;' });
  });

  it('reads consecutive dash lines as one list with the markers stripped', () => {
    expect(parseMarkdown('- a\n- b')).toEqual([{ kind: 'list', items: ['a', 'b'] }]);
  });

  it('reads star lines as a list too', () => {
    expect(parseMarkdown('* a\n* b')).toEqual([{ kind: 'list', items: ['a', 'b'] }]);
  });

  it('splits paragraphs on a blank line', () => {
    expect(parseMarkdown('first line\nstill first\n\nsecond')).toEqual([
      { kind: 'paragraph', text: 'first line\nstill first' },
      { kind: 'paragraph', text: 'second' },
    ]);
  });

  it('never interprets markup', () => {
    expect(parseMarkdown('<b>hi</b>')).toEqual([{ kind: 'paragraph', text: '<b>hi</b>' }]);
  });

  it('keeps code inside a fence verbatim, blank lines included', () => {
    const blocks = parseMarkdown('```\nline 1\n\nline 3\n```');

    expect(blocks).toEqual([{ kind: 'code', language: '', text: 'line 1\n\nline 3' }]);
  });

  it('mixes paragraphs, lists and code in order', () => {
    const blocks = parseMarkdown('Intro\n- one\n- two\n\n```json\n{"a":1}\n```\nOutro');

    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'list', 'code', 'paragraph']);
  });

  it('returns nothing for empty text', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n')).toEqual([]);
  });
});
