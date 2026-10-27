import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { ChatSession, Page, Repo, Telemetry } from '@codebox/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { CONTEXT_WINDOW_TOKENS, ChatContextSheet, contextState } from './context-sheet';
import { STRINGS, translate } from './context-sheet.i18n';
import type { Locale } from './context-sheet.i18n';

const TS = '2026-10-24T18:04:02Z';
const CHAT = 'chat_01JABCDEFGHJKMNPQRSV';
const REPO = 'repo_01JABCDEFGHJKMNPQRSV';
const REQUEST = 'req_01JABCDEFGHJKMNPQRSV';

const SESSION_URL = `/v1/chat/sessions/${CHAT}`;
const COMPACT_URL = `${SESSION_URL}/compact`;
const CREATE_URL = '/v1/chat/sessions';
const REPOS_URL = '/v1/repos';
const TELEMETRY_URL = '/v1/telemetry?range=24h';

const REPO_ROW: Repo = {
  id: REPO,
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: TS,
};

const TELEMETRY: Telemetry = {
  range: '24h',
  since: TS,
  spendUsd: 1.25,
  runs: { total: 2, succeeded: 1, failed: 1, cancelled: 0 },
  disk: { freeBytes: 10_000, totalBytes: 100_000, usedPercent: 10 },
  queueDepth: 0,
};

interface SessionPatch {
  readonly contextTokens?: number;
  readonly contextEpoch?: number;
  readonly status?: ChatSession['status'];
  readonly repoId?: string | null;
}

function session(patch: SessionPatch = {}): ChatSession {
  const repoId = patch.repoId === undefined ? REPO : patch.repoId;
  return {
    id: CHAT,
    repoId,
    kind: repoId === null ? 'free' : 'repo',
    title: 'Chat',
    status: patch.status ?? 'idle',
    usage: { usd: 0.42, tokensIn: 12_400, tokensOut: 3_100 },
    contextTokens: patch.contextTokens ?? 12_400,
    contextEpoch: patch.contextEpoch ?? 1,
    createdAt: TS,
    updatedAt: TS,
    lastMessage: null,
  };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function button(element: HTMLElement, id: string): HTMLButtonElement | null {
  return element.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
}

function styleOf(element: HTMLElement | null): string {
  return element?.getAttribute('style') ?? '';
}

interface Mounted {
  readonly fixture: ComponentFixture<ChatContextSheet>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

async function mount(
  input: ChatSession = session(),
  options: { readonly dayFailed?: boolean } = {},
): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: I18nService,
        useValue: { locale: signal<Locale>('en') as WritableSignal<Locale> },
      },
    ],
  });
  const fixture = TestBed.createComponent(ChatContextSheet);
  fixture.componentRef.setInput('session', input);
  await fixture.whenStable();

  const http = TestBed.inject(HttpTestingController);
  http.expectOne(REPOS_URL).flush({ data: [REPO_ROW], nextCursor: null } satisfies Page<Repo>);
  const spend = http.expectOne(TELEMETRY_URL);
  if (options.dayFailed === true) {
    spend.flush(
      { error: { code: 'internal', message: 'Telemetry failed', requestId: REQUEST } },
      { status: 500, statusText: 'Internal Server Error' },
    );
  } else {
    spend.flush(TELEMETRY);
  }
  await fixture.whenStable();

  return { fixture, element: fixture.nativeElement as HTMLElement, http };
}

describe('contextState', () => {
  it('pins the four states at every documented boundary', () => {
    expect(CONTEXT_WINDOW_TOKENS).toBe(200_000);
    expect(contextState(0)).toBe('ok');
    expect(contextState(149_999)).toBe('ok');
    expect(contextState(150_000)).toBe('warn');
    expect(contextState(179_999)).toBe('warn');
    expect(contextState(180_000)).toBe('high');
    expect(contextState(189_999)).toBe('high');
    expect(contextState(190_000)).toBe('full');
    expect(contextState(250_000)).toBe('full');
  });
});

describe('ChatContextSheet', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('blocks the composer at full and keeps it usable at warn and high', async () => {
    const full = await mount(session({ contextTokens: 190_000 }));
    expect(hook(full.element, 'context-sheet')?.getAttribute('data-state')).toBe('full');
    expect(hook(full.element, 'context-bar')?.getAttribute('data-state')).toBe('full');
    expect(hook(full.element, 'context-composer')?.getAttribute('data-disabled')).toBe('true');
    expect(hook(full.element, 'context-composer')?.getAttribute('aria-disabled')).toBe('true');
    expect(button(full.element, 'context-compact')).not.toBeNull();
    expect(button(full.element, 'context-compact')?.disabled).toBe(false);
    TestBed.resetTestingModule();

    const warn = await mount(session({ contextTokens: 150_000 }));
    expect(hook(warn.element, 'context-bar')?.getAttribute('data-state')).toBe('warn');
    expect(hook(warn.element, 'context-composer')?.getAttribute('data-disabled')).toBe('false');
    expect(hook(warn.element, 'context-numbers')?.getAttribute('data-percent')).toBe('75');
    TestBed.resetTestingModule();

    const high = await mount(session({ contextTokens: 180_000 }));
    expect(hook(high.element, 'context-bar')?.getAttribute('data-state')).toBe('high');
    expect(hook(high.element, 'context-composer')?.getAttribute('data-disabled')).toBe('false');
    expect(hook(high.element, 'context-state')?.getAttribute('data-state')).toBe('high');
  });

  it('clamps the fill at 100 % while the numbers keep the real percentage', async () => {
    const { element } = await mount(session({ contextTokens: 250_000 }));

    expect(hook(element, 'context-numbers')?.getAttribute('data-percent')).toBe('125');
    expect(styleOf(hook(element, 'context-bar-fill'))).toContain('inline-size: 100%');
    expect(hook(element, 'context-bar')?.getAttribute('aria-valuenow')).toBe('100');
  });

  it('renders the repository slug and the environment rows in order', async () => {
    const { element } = await mount(session());

    const rows = [...element.querySelectorAll<HTMLElement>('.cb-context-row')].map((row) =>
      row.getAttribute('data-testid'),
    );
    expect(rows).toEqual([
      'context-repository',
      'context-scope',
      'context-epoch',
      'context-chat-cost',
      'context-day-cost',
    ]);
    expect(hook(element, 'context-repository')?.getAttribute('data-slug')).toBe('acme/widgets');
    expect(hook(element, 'context-scope')?.getAttribute('data-scope')).toBe('repo');
    expect(hook(element, 'context-epoch')?.getAttribute('data-epoch')).toBe('1');
    expect(hook(element, 'context-chat-cost')?.getAttribute('data-usd')).toBe('0.42');
    expect(hook(element, 'context-chat-cost')?.getAttribute('data-tokens-in')).toBe('12400');
    expect(hook(element, 'context-chat-cost')?.getAttribute('data-tokens-out')).toBe('3100');
    expect(hook(element, 'context-day-cost')?.getAttribute('data-usd')).toBe('1.25');
    expect(hook(element, 'context-day-cost')?.getAttribute('data-unavailable')).toBe('false');
  });

  it('issues one compact POST per tap and renders the divider at the daemon epoch', async () => {
    const { fixture, element, http } = await mount(session({ contextTokens: 185_000 }));

    expect(hook(element, 'context-divider')).toBeNull();

    button(element, 'context-compact')?.click();
    const request = http.expectOne({ method: 'POST', url: COMPACT_URL });
    expect(request.request.body).toBeNull();

    button(element, 'context-compact')?.click();
    http.expectNone({ method: 'POST', url: COMPACT_URL });

    request.flush(session({ contextTokens: 0, contextEpoch: 2 }));
    await fixture.whenStable();

    http.expectNone({ method: 'POST', url: COMPACT_URL });

    const divider = hook(element, 'context-divider');
    expect(divider?.getAttribute('data-epoch')).toBe('2');
    expect(divider?.nextElementSibling).toBe(hook(element, 'context-numbers'));
    expect(hook(element, 'context-numbers')?.getAttribute('data-tokens')).toBe('0');
    expect(hook(element, 'context-epoch')?.getAttribute('data-epoch')).toBe('2');
    expect(hook(element, 'context-sheet')?.getAttribute('data-state')).toBe('ok');
  });

  it('renders the code of a 409 chat_archived and keeps the old epoch with no divider', async () => {
    const { fixture, element, http } = await mount(
      session({ contextTokens: 195_000, contextEpoch: 3 }),
    );

    button(element, 'context-compact')?.click();
    http.expectOne({ method: 'POST', url: COMPACT_URL }).flush(
      {
        error: {
          code: 'conflict',
          message: 'The chat session is archived',
          requestId: REQUEST,
          details: { reason: 'chat_archived' },
        },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();

    expect(hook(element, 'context-error')?.getAttribute('data-code')).toBe('conflict');
    expect(hook(element, 'context-error')?.getAttribute('data-status')).toBe('409');
    expect(hook(element, 'context-epoch')?.getAttribute('data-epoch')).toBe('3');
    expect(hook(element, 'context-divider')).toBeNull();
    expect(button(element, 'context-compact')?.disabled).toBe(false);
  });

  it('renders the code of a 500 and leaves the session and the sheet usable', async () => {
    const { fixture, element, http } = await mount(
      session({ contextTokens: 195_000, contextEpoch: 2 }),
    );

    button(element, 'context-compact')?.click();
    http
      .expectOne({ method: 'POST', url: COMPACT_URL })
      .flush(
        { error: { code: 'internal', message: 'Compact failed', requestId: REQUEST } },
        { status: 500, statusText: 'Internal Server Error' },
      );
    await fixture.whenStable();

    expect(hook(element, 'context-error')?.getAttribute('data-code')).toBe('internal');
    expect(hook(element, 'context-epoch')?.getAttribute('data-epoch')).toBe('2');
    expect(hook(element, 'context-divider')).toBeNull();
    expect(hook(element, 'context-numbers')?.getAttribute('data-tokens')).toBe('195000');
  });

  it('starts one chat in this repo for a bound chat and offers nothing for a free one', async () => {
    const bound = await mount();
    const created: ChatSession[] = [];
    bound.fixture.componentInstance.created.subscribe((value) => created.push(value));

    button(bound.element, 'context-new-chat')?.click();
    const request = bound.http.expectOne({ method: 'POST', url: CREATE_URL });
    expect(request.request.body).toEqual({ repoId: REPO });
    button(bound.element, 'context-new-chat')?.click();
    bound.http.expectNone({ method: 'POST', url: CREATE_URL });

    request.flush(session({ contextTokens: 0 }));
    await bound.fixture.whenStable();

    expect(created).toHaveLength(1);
    expect(created[0]?.id).toBe(CHAT);
    expect(button(bound.element, 'context-compact')).not.toBeNull();
    TestBed.resetTestingModule();

    const free = await mount(session({ repoId: null }));
    expect(button(free.element, 'context-new-chat')).toBeNull();
    expect(hook(free.element, 'context-repository')?.getAttribute('data-slug')).toBe('');
    expect(hook(free.element, 'context-repository')?.textContent).toContain('No repository');
    expect(hook(free.element, 'context-scope')?.getAttribute('data-scope')).toBe('free');
  });

  it('issues no request of its own: only load reads, never a POST', async () => {
    const { element, http } = await mount();

    http.expectNone({ method: 'POST', url: CREATE_URL });
    http.expectNone({ method: 'POST', url: COMPACT_URL });
    http.expectNone(
      (request) =>
        request.method === 'GET' && request.url !== REPOS_URL && request.url !== TELEMETRY_URL,
    );
    expect(hook(element, 'context-loading')).toBeNull();
  });

  it('leaves the sheet usable when the day spend read fails', async () => {
    const { element } = await mount(session(), { dayFailed: true });

    expect(hook(element, 'context-day-cost')?.getAttribute('data-unavailable')).toBe('true');
    expect(hook(element, 'context-day-cost')?.getAttribute('data-usd')).toBe('');
    expect(hook(element, 'context-day-cost')?.textContent).toContain('Unavailable');
    expect(hook(element, 'context-error')).toBeNull();
    expect(hook(element, 'context-numbers')?.getAttribute('data-tokens')).toBe('12400');
    expect(hook(element, 'context-loading')).toBeNull();
  });

  it('closes from its header and never reads the API itself', async () => {
    const { fixture, element } = await mount();
    let closes = 0;
    fixture.componentInstance.closed.subscribe(() => {
      closes += 1;
    });

    button(element, 'context-close')?.click();

    expect(closes).toBe(1);

    const source = readFileSync(
      resolve(process.cwd(), 'src/app/features/chat/context-sheet.ts'),
      'utf8',
    );
    expect(source).not.toContain('HttpClient');
    expect(source).not.toContain('context-sheet.api');
  });

  it('ships both dictionaries with the same keys and resolves every key the sheet uses', () => {
    const en = Object.keys(STRINGS.en).sort();
    const es = Object.keys(STRINGS.es).sort();

    expect(es).toEqual(en);
    for (const key of en) {
      expect(STRINGS.en[key], `en ${key}`).toBeTruthy();
      expect(STRINGS.es[key], `es ${key}`).toBeTruthy();
    }

    const source = readFileSync(
      resolve(process.cwd(), 'src/app/features/chat/context-sheet.ts'),
      'utf8',
    );
    const keys = new Set<string>([
      'sheet.composer.blocked',
      'sheet.composer.ready',
      'sheet.action.compact',
      'sheet.action.compacting',
    ]);
    for (const match of source.matchAll(/t\('([^']+)'\)/g)) {
      if (match[1] !== undefined) keys.add(match[1]);
    }
    for (const state of ['ok', 'warn', 'high', 'full']) keys.add(`sheet.usage.${state}`);
    for (const scope of ['free', 'repo', 'schedule']) keys.add(`sheet.scope.${scope}`);

    expect(keys.size).toBeGreaterThan(10);
    for (const locale of ['en', 'es'] as const satisfies readonly Locale[]) {
      for (const key of keys) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});
