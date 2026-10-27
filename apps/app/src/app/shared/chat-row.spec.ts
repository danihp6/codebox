import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRowView } from './chat-row';
import { ChatRow } from './chat-row';

const VIEW: ChatRowView = {
  id: 'chat_01JABCDEFGHJKMNPQRSV',
  title: 'Alpha refactor',
  preview: 'Refactored the module',
  scope: 'repo',
  scopeLabel: 'owner/alpha',
  costLabel: '$0.42',
  contextLabel: '12.4K ctx',
  status: 'idle',
  statusLabel: 'Idle',
  unread: true,
  unreviewed: true,
  unreadLabel: 'Unread',
  unreviewedLabel: 'Not reviewed',
};

async function mount(view: ChatRowView = VIEW): Promise<ComponentFixture<ChatRow>> {
  TestBed.configureTestingModule({ imports: [ChatRow] });
  const fixture = TestBed.createComponent(ChatRow);
  fixture.componentRef.setInput('view', view);
  await fixture.whenStable();
  return fixture;
}

function element(fixture: ComponentFixture<ChatRow>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function hook(host: HTMLElement, id: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function stylesOf(source: string): string {
  return source.slice(source.indexOf('styles: ['), source.indexOf('template:'));
}

describe('ChatRow', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('renders one button with the title, the preview and the flow', async () => {
    const fixture = await mount();
    const host = element(fixture);
    const buttons = host.querySelectorAll('button');

    expect(buttons).toHaveLength(1);
    const button = buttons[0] as HTMLButtonElement;
    expect(button.getAttribute('data-testid')).toBe('chat-row');
    expect(button.getAttribute('data-chat-id')).toBe(VIEW.id);
    expect(button.getAttribute('data-scope')).toBe('repo');
    expect(button.getAttribute('data-status')).toBe('idle');
    expect(button.getAttribute('type')).toBe('button');
    expect(hook(host, 'chat-row-title')?.textContent).toContain('Alpha refactor');
    expect(hook(host, 'chat-row-preview')?.textContent).toContain('Refactored the module');
    expect(hook(host, 'chat-row-scope')?.textContent).toContain('owner/alpha');
    expect(hook(host, 'chat-row-cost')?.textContent).toContain('$0.42');
    expect(hook(host, 'chat-row-context')?.textContent).toContain('12.4K ctx');
    expect(hook(host, 'chat-row-status')?.textContent).toContain('Idle');
  });

  it('carries both signals on the same row', async () => {
    const fixture = await mount();
    const host = element(fixture);
    const button = host.querySelector('[data-testid="chat-row"]');

    expect(button?.getAttribute('data-unread')).toBe('true');
    expect(button?.getAttribute('data-unreviewed')).toBe('true');
    expect(button?.classList.contains('cb-chat-row-unreviewed')).toBe(true);
    expect(hook(host, 'chat-row-unread')?.getAttribute('role')).toBe('img');
    expect(hook(host, 'chat-row-unread')?.getAttribute('aria-label')).toBe('Unread');
    expect(hook(host, 'chat-row-unreviewed')?.getAttribute('aria-label')).toBe('Not reviewed');
  });

  it('drops both signals when the row is read and reviewed', async () => {
    const fixture = await mount({ ...VIEW, unread: false, unreviewed: false });
    const host = element(fixture);
    const button = host.querySelector('[data-testid="chat-row"]');

    expect(button?.getAttribute('data-unread')).toBe('false');
    expect(button?.getAttribute('data-unreviewed')).toBe('false');
    expect(button?.classList.contains('cb-chat-row-unreviewed')).toBe(false);
    expect(hook(host, 'chat-row-unread')).toBeNull();
    expect(hook(host, 'chat-row-unreviewed')).toBeNull();
  });

  it('omits the cost and the context when there is nothing to print', async () => {
    const fixture = await mount({ ...VIEW, costLabel: null, contextLabel: null });
    const host = element(fixture);

    expect(hook(host, 'chat-row-cost')).toBeNull();
    expect(hook(host, 'chat-row-context')).toBeNull();
    expect(hook(host, 'chat-row-scope')).not.toBeNull();
    expect(hook(host, 'chat-row-status')).not.toBeNull();
  });

  it('renders the micro-text as one flow of spans', async () => {
    const fixture = await mount();
    const host = element(fixture);
    const flows = host.querySelectorAll('[data-testid="chat-row-flow"]');

    expect(flows).toHaveLength(1);
    const children = [...(flows[0]?.children ?? [])];
    expect(children.map((child) => child.tagName)).toEqual([
      'SPAN',
      'SPAN',
      'SPAN',
      'SPAN',
      'SPAN',
      'SPAN',
    ]);
    expect(children.map((child) => child.getAttribute('data-testid'))).toEqual([
      'chat-row-unread',
      'chat-row-scope',
      'chat-row-cost',
      'chat-row-context',
      'chat-row-status',
      'chat-row-unreviewed',
    ]);
  });

  it('emits the chat id when the operator opens the row', async () => {
    const fixture = await mount();
    const opened: string[] = [];
    fixture.componentInstance.open.subscribe((id) => opened.push(id));

    (element(fixture).querySelector('[data-testid="chat-row"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(opened).toEqual([VIEW.id]);
  });

  it('wraps instead of pinning the micro-text to fixed positions', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/shared/chat-row.ts'), 'utf8');
    const styles = stylesOf(source);
    const withoutClipRule = styles.replace(/\.cb-visually-hidden\s*\{[^}]*\}/, '');

    expect(styles).toContain('.cb-visually-hidden');
    expect(withoutClipRule).toContain('flex-wrap: wrap');
    expect(withoutClipRule).not.toMatch(/position\s*:/);
    expect(withoutClipRule).not.toMatch(/left\s*:/);
    expect(withoutClipRule).not.toContain('inset-inline-start');
  });

  it('declares no fixed size except the dot', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/shared/chat-row.ts'), 'utf8');
    const withoutClipRule = stylesOf(source).replace(/\.cb-visually-hidden\s*\{[^}]*\}/, '');
    const lengths = [...withoutClipRule.matchAll(/\d+px/g)].map((match) => match[0]);
    const sized = [
      ...withoutClipRule.matchAll(/(?:inline-size|block-size|width|height)\s*:\s*[^;]*px/g),
    ].map((match) => match[0].replace(/\s+/g, ' ').trim());

    expect([...new Set(lengths)].sort()).toEqual(['1px', '2px', '8px']);
    expect(sized).toEqual(['inline-size: 8px', 'block-size: 8px']);
  });
});
