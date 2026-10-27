import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  Approval,
  ChatMessage,
  ChatSession,
  Page,
  ReminderRoutine,
  Repo,
  Run,
  SseStreamEvent,
} from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { SseService } from '../../core/events/sse.service';
import { ChatRunLink } from './chat-store';
import { ChatPage } from './chat.page';
import { STRINGS, translate } from './i18n';
import type { Locale } from './i18n';

const TS = '2026-10-24T18:04:02Z';
const CHAT = 'chat_01JABCDEFGHJKMNPQRSV';
const REPO = 'repo_01JABCDEFGHJKMNPQRSV';
const APPROVAL = 'apv_01JABCDEFGHJKMNPQRSV';
const RUN_ID = 'run_01JABCDEFGHJKMNPQRSV';
const PR_URL = 'https://github.com/o/r/pull/42';

const SESSION: ChatSession = {
  id: CHAT,
  repoId: REPO,
  title: 'Chat',
  status: 'idle',
  createdAt: TS,
  updatedAt: TS,
  lastMessage: null,
};

const APPROVAL_BODY: Approval = {
  id: APPROVAL,
  state: 'allowed',
  tool: 'bash',
  title: 'Run ls',
  runId: null,
  chatId: CHAT,
  input: {},
  createdAt: TS,
  expiresAt: TS,
  resolvedAt: TS,
};

const SESSION_URL = `/v1/chat/sessions/${CHAT}`;
const MESSAGES_URL = `${SESSION_URL}/messages`;
const INTERRUPT_URL = `${SESSION_URL}/interrupt`;
const PROMOTE_URL = `${SESSION_URL}/promote`;
const REPLY_URL = `/v1/approvals/${APPROVAL}/reply`;
const ROUTINES_URL = '/v1/routines?limit=10';
const REPOS_URL = '/v1/repos?limit=200';
const RUN_URL = `/v1/runs/${RUN_ID}`;

const RUN: Run = {
  id: RUN_ID,
  repoId: REPO,
  jobId: null,
  state: 'pr_open',
  trigger: 'promote',
  branch: 'cb/run-x',
  baseRef: 'main',
  pr: { number: 42, url: PR_URL, mergeable: true },
  gate: { status: 'passed', exitCode: 0, durationMs: 900 },
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
  createdAt: TS,
  finishedAt: null,
};

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

const REMINDER: ReminderRoutine = {
  id: 'rtn_01JABCDEFGHJKMNPQRSV',
  kind: 'reminder',
  title: 'Stand up',
  cron: '0 7 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: true,
  createdAt: TS,
  nextFireAt: '2026-10-25T06:00:00Z',
  lastFiredAt: null,
};

function message(
  id: string,
  role: ChatMessage['role'],
  text: string,
  createdAt: string,
): ChatMessage {
  return { id, chatId: CHAT, role, text, createdAt };
}

function page(...messages: readonly ChatMessage[]): Page<ChatMessage> {
  return { data: [...messages], nextCursor: null };
}

function delta(seq: number, text: string): SseStreamEvent {
  return { event: 'chat.delta', data: { chatId: CHAT, seq, delta: text, ts: TS } };
}

function permission(seq: number): SseStreamEvent {
  return {
    event: 'chat.permission',
    data: { chatId: CHAT, seq, approvalId: APPROVAL, tool: 'bash', title: 'Run ls', ts: TS },
  };
}

function memoryStore(): SecureStore {
  const values = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      values.clear();
      return Promise.resolve();
    },
  };
}

interface Mounted {
  readonly fixture: ComponentFixture<ChatPage>;
  readonly element: HTMLElement;
  readonly sse: WritableSignal<SseStreamEvent | null>;
  readonly http: HttpTestingController;
}

async function mount(messages: Page<ChatMessage> = page(), run?: Run): Promise<Mounted> {
  const sse = signal<SseStreamEvent | null>(null);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SECURE_STORE, useValue: memoryStore() },
      { provide: SseService, useValue: { event: sse } },
    ],
  });
  if (run !== undefined) TestBed.inject(ChatRunLink).remember(CHAT, run.id);
  const fixture = TestBed.createComponent(ChatPage);
  fixture.componentRef.setInput('id', CHAT);
  await fixture.whenStable();

  const http = TestBed.inject(HttpTestingController);
  http.expectOne(SESSION_URL).flush(SESSION);
  http.expectOne((request) => request.url === MESSAGES_URL).flush(messages);
  if (run !== undefined) {
    http.expectOne(RUN_URL).flush(run);
  }
  await fixture.whenStable();

  return { fixture, element: fixture.nativeElement as HTMLElement, sse, http };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function button(element: HTMLElement, id: string): HTMLButtonElement | null {
  return element.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
}

describe('ChatPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('renders a permission card with three live buttons and disables them after the reply', async () => {
    const { fixture, element, sse, http } = await mount();

    sse.set(permission(2));
    await fixture.whenStable();

    const card = hook(element, 'chat-permission');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-approval-id')).toBe(APPROVAL);
    expect(button(element, 'permission-allow-once')?.disabled).toBe(false);
    expect(button(element, 'permission-allow-session')?.disabled).toBe(false);
    expect(button(element, 'permission-deny')?.disabled).toBe(false);

    button(element, 'permission-allow-session')?.click();
    const request = http.expectOne({ method: 'POST', url: REPLY_URL });
    expect(request.request.body).toEqual({ decision: 'allow', scope: 'session' });
    request.flush(APPROVAL_BODY);
    await fixture.whenStable();

    expect(button(element, 'permission-allow-once')?.disabled).toBe(true);
    expect(button(element, 'permission-allow-session')?.disabled).toBe(true);
    expect(button(element, 'permission-deny')?.disabled).toBe(true);

    button(element, 'permission-allow-session')?.click();
    http.expectNone({ method: 'POST', url: REPLY_URL });
  });

  it('keeps the composer usable while the agent works and offers the stop button', async () => {
    const { fixture, element, sse } = await mount();

    expect(hook(element, 'chat-idle')).not.toBeNull();
    expect(hook(element, 'composer-stop')).toBeNull();

    sse.set(delta(1, 'working'));
    await fixture.whenStable();

    const input = hook(element, 'composer-input');
    expect(input?.tagName).toBe('TEXTAREA');
    expect((input as HTMLTextAreaElement | null)?.disabled).toBe(false);
    expect(hook(element, 'composer-stop')).not.toBeNull();
    expect(hook(element, 'chat-idle')).toBeNull();
    expect(hook(element, 'page-chat-detail')?.getAttribute('data-status')).toBe('working');
  });

  it('renders a fenced code block with its language label', async () => {
    const { element } = await mount(
      page(message('msg_01JABCDEFGHJKMNPQRSV', 'assistant', '```ts\nconst a = 1;\n```', TS)),
    );

    const code = hook(element, 'chat-code');
    expect(code?.getAttribute('data-language')).toBe('ts');
    expect(code?.textContent).toContain('const a = 1;');
    expect(hook(element, 'chat-message')?.getAttribute('data-role')).toBe('assistant');
    expect(hook(element, 'chat-message')?.getAttribute('data-key')).toBe(
      'msg:msg_01JABCDEFGHJKMNPQRSV',
    );
  });

  it('renders one chat-message per item and the empty state', async () => {
    const empty = await mount();
    expect(hook(empty.element, 'chat-message-empty')).not.toBeNull();
    expect(hook(empty.element, 'chat-message')).toBeNull();
    TestBed.resetTestingModule();

    const filled = await mount(
      page(
        message('msg_01JABCDEFGHJKMNPQRSV', 'user', 'hi', '2026-10-24T18:00:01Z'),
        message('msg_01JABCDEFGHJKMNPQRSW', 'assistant', 'hello', '2026-10-24T18:00:02Z'),
      ),
    );

    expect(filled.element.querySelectorAll('[data-testid="chat-message"]')).toHaveLength(2);
    expect(hook(filled.element, 'chat-message-empty')).toBeNull();
  });

  it('renders a tool card with its tool and status', async () => {
    const { fixture, element, sse } = await mount();

    sse.set({
      event: 'chat.tool',
      data: { chatId: CHAT, seq: 3, tool: 'bash', status: 'ok', detail: 'exit 0', ts: TS },
    });
    await fixture.whenStable();

    const card = hook(element, 'chat-tool');
    expect(card?.getAttribute('data-tool')).toBe('bash');
    expect(card?.getAttribute('data-status')).toBe('ok');
    expect(card?.textContent).toContain('exit 0');
  });

  it('renders the gate and PR cards from the run object and never from prose', async () => {
    const prose = await mount(
      page(
        message(
          'msg_01JABCDEFGHJKMNPQRSV',
          'assistant',
          'Gate passed. Pull request #99 opened.',
          TS,
        ),
      ),
    );
    expect(prose.element.querySelectorAll('[data-testid="chat-system"]')).toHaveLength(0);
    expect(hook(prose.element, 'chat-message')?.textContent).toContain('Pull request #99');
    TestBed.resetTestingModule();

    const { element } = await mount(
      page(message('msg_01JABCDEFGHJKMNPQRSV', 'assistant', 'done', TS)),
      RUN,
    );
    const cards = element.querySelectorAll<HTMLElement>('[data-testid="chat-system"]');
    expect(cards).toHaveLength(2);

    const gate = cards[0];
    expect(gate?.getAttribute('data-kind')).toBe('gate');
    expect(gate?.getAttribute('data-role')).toBe('system');
    expect(gate?.getAttribute('data-run-id')).toBe(RUN_ID);
    expect(gate?.getAttribute('data-status')).toBe('passed');
    expect(gate?.querySelector('[data-testid="chat-system-link"]')).toBeNull();

    const pr = cards[1];
    expect(pr?.getAttribute('data-kind')).toBe('pr');
    expect(pr?.getAttribute('data-status')).toBe('open');
    expect(pr?.getAttribute('data-run-id')).toBe(RUN_ID);
    expect(
      pr
        ?.querySelector<HTMLAnchorElement>('[data-testid="chat-system-link"]')
        ?.getAttribute('href'),
    ).toBe(PR_URL);
  });

  it('updates the gate card from a live frame without reading the run again', async () => {
    const { fixture, element, sse, http } = await mount(
      page(message('msg_01JABCDEFGHJKMNPQRSV', 'assistant', 'done', TS)),
      RUN,
    );

    expect(hook(element, 'chat-system')?.getAttribute('data-status')).toBe('passed');

    sse.set({
      event: 'run.gate',
      data: {
        runId: RUN_ID,
        seq: 4,
        ts: TS,
        gate: { status: 'failed', exitCode: 1, durationMs: 1200 },
      },
    });
    await fixture.whenStable();

    expect(hook(element, 'chat-system')?.getAttribute('data-status')).toBe('failed');
    http.expectNone(RUN_URL);
  });

  it('stops the agent once when the stop button is pressed', async () => {
    const { fixture, element, sse, http } = await mount();

    sse.set(delta(1, 'working'));
    await fixture.whenStable();

    button(element, 'composer-stop')?.click();
    const request = http.expectOne({ method: 'POST', url: INTERRUPT_URL });
    expect(request.request.body).toBeNull();
    request.flush({ ...SESSION, status: 'idle' });
    await fixture.whenStable();

    http.expectNone(INTERRUPT_URL);
  });

  it('confirms the repository, base branch and prompt before promoting', async () => {
    const { fixture, element, http } = await mount(
      page(message('msg_01JABCDEFGHJKMNPQRSV', 'assistant', 'fix the failing gate', TS)),
    );

    button(element, 'chat-promote')?.click();
    await fixture.whenStable();
    http.expectOne(REPOS_URL).flush({ data: [REPO_ROW], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'chat-promote-confirm')).not.toBeNull();
    expect(hook(element, 'promote-repo')?.textContent?.trim()).toBe('acme/widgets');
    expect(hook(element, 'promote-base')?.textContent?.trim()).toBe('main');
    expect(hook(element, 'promote-prompt')?.textContent?.trim()).toBe('fix the failing gate');

    button(element, 'promote-cancel')?.click();
    await fixture.whenStable();

    expect(hook(element, 'chat-promote-confirm')).toBeNull();
    http.expectNone({ method: 'POST', url: PROMOTE_URL });
  });

  it('renders the error block with its code when the session cannot be read', async () => {
    const sse = signal<SseStreamEvent | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SECURE_STORE, useValue: memoryStore() },
        { provide: SseService, useValue: { event: sse } },
      ],
    });
    const fixture = TestBed.createComponent(ChatPage);
    fixture.componentRef.setInput('id', CHAT);
    await fixture.whenStable();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne(SESSION_URL).flush(
      {
        error: {
          code: 'not_found',
          message: 'Missing',
          requestId: 'req_01JABCDEFGHJKMNPQRSV',
        },
      },
      { status: 404, statusText: 'Not Found' },
    );
    http.expectOne((request) => request.url === MESSAGES_URL).flush(page());
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(hook(element, 'chat-error')?.getAttribute('data-code')).toBe('not_found');
    expect(hook(element, 'chat-loading')).toBeNull();
  });

  it('renders a corroborated routine card with its local time and next fire', async () => {
    const { fixture, element, sse, http } = await mount();

    sse.set({
      event: 'chat.tool',
      data: { chatId: CHAT, seq: 4, tool: 'routine.create', status: 'ok', ts: TS },
    });
    await fixture.whenStable();

    http.expectOne(ROUTINES_URL).flush({ data: [REMINDER], nextCursor: null });
    await fixture.whenStable();

    const card = hook(element, 'chat-routine-card');
    expect(card?.getAttribute('data-routine-id')).toBe(REMINDER.id);
    expect(card?.getAttribute('data-kind')).toBe('reminder');

    const kind = (hook(element, 'chat-routine-kind')?.textContent ?? '').trim();
    expect(['Reminder', 'Recordatorio']).toContain(kind);

    const local = (hook(element, 'chat-routine-local')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(local).toContain('07:00');
    expect(local).toContain('Europe/Madrid');

    expect(hook(element, 'chat-routine-next')?.getAttribute('data-at')).toBe(REMINDER.nextFireAt);
    expect(hook(element, 'chat-routine-open')?.getAttribute('href')).toBe('/jobs');
  });

  it('badges a message a routine produced and links to the routines list', async () => {
    const id = 'msg_01JABCDEFGHJKMNPQRSV';
    const { fixture, element, sse } = await mount(page(message(id, 'assistant', 'done', TS)));

    sse.set({
      event: 'routine.replied',
      data: { routineId: REMINDER.id, chatId: CHAT, messageId: id, ts: TS },
    });
    await fixture.whenStable();

    expect(hook(element, 'chat-routine-badge')).not.toBeNull();
    expect(hook(element, 'chat-routine-link')?.getAttribute('href')).toBe('/jobs');
  });

  it('ships both dictionaries with the same keys and no empty value', () => {
    const en = Object.keys(STRINGS.en).sort();
    const es = Object.keys(STRINGS.es).sort();

    expect(es).toEqual(en);
    for (const key of en) {
      expect(STRINGS.en[key], `en ${key}`).toBeTruthy();
      expect(STRINGS.es[key], `es ${key}`).toBeTruthy();
    }

    const routineKeys = [
      'chat.routine.title',
      'chat.routine.kind.prompt',
      'chat.routine.kind.reminder',
      'chat.routine.local',
      'chat.routine.next',
      'chat.routine.open',
      'chat.routine.badge',
      'chat.routine.list',
    ];
    for (const key of routineKeys) {
      expect(STRINGS.en[key], `en ${key}`).toBeTruthy();
      expect(STRINGS.es[key], `es ${key}`).toBeTruthy();
    }

    const systemKeys = [
      'chat.system.label',
      'chat.system.gate',
      'chat.system.pr',
      'chat.system.gate.passed',
      'chat.system.gate.failed',
      'chat.system.gate.skipped',
      'chat.system.pr.open',
      'chat.system.pr.merged',
      'chat.promote.title',
      'chat.promote.repo',
      'chat.promote.base',
      'chat.promote.prompt',
      'chat.promote.confirm',
      'chat.promote.cancel',
      'chat.promote.loading',
    ];
    for (const locale of ['en', 'es'] as const satisfies readonly Locale[]) {
      for (const key of systemKeys) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });

  it('resolves every key the chat templates use', () => {
    const sources = ['chat.page.ts', 'chat-list.page.ts'].map((file) =>
      readFileSync(resolve(process.cwd(), 'src/app/features/chat', file), 'utf8'),
    );
    const keys = new Set<string>([
      'chat.status.idle',
      'chat.status.working',
      'chat.status.archived',
    ]);
    for (const source of sources) {
      for (const match of source.matchAll(/t\('([^']+)'\)/g)) {
        if (match[1] !== undefined) keys.add(match[1]);
      }
    }

    expect(keys.size).toBeGreaterThan(10);
    for (const locale of ['en', 'es'] as const satisfies readonly Locale[]) {
      for (const key of keys) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});
