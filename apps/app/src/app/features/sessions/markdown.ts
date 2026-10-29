export type MarkdownBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'code'; readonly language: string; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] };

const FENCE = /^```(.*)$/;
const LIST_ITEM = /^[-*] (.*)$/;

export function parseMarkdown(text: string): readonly MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  let code: string[] | null = null;
  let language = '';

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  const flushList = (): void => {
    if (items.length === 0) return;
    blocks.push({ kind: 'list', items: [...items] });
    items = [];
  };
  const flushText = (): void => {
    flushParagraph();
    flushList();
  };

  for (const line of text.split('\n')) {
    if (code !== null) {
      if (FENCE.test(line)) {
        blocks.push({ kind: 'code', language, text: code.join('\n') });
        code = null;
        language = '';
        continue;
      }
      code.push(line);
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      flushText();
      language = (fence[1] ?? '').trim().split(/\s+/)[0] ?? '';
      code = [];
      continue;
    }

    if (line.trim() === '') {
      flushText();
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item !== null) {
      flushParagraph();
      items.push(item[1] ?? '');
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (code !== null) blocks.push({ kind: 'code', language, text: code.join('\n') });
  flushText();
  return blocks;
}
