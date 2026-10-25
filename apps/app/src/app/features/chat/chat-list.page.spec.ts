import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { ChatSession, Page, Repo, SseStreamEvent } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { SseService } from '../../core/events/sse.service';
import { ChatListPage } from './chat-list.page';

const TS = '2026-10-24T18:04:02Z';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const CHAT = 'chat_01JABCDEFGHJKMNPQRSV';

const REPO: Repo = {
  id: REPO_ID,
  slug: 'owner/repo',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: TS,
};

const SESSION: ChatSession = {
  id: CHAT,
  repoId: REPO_ID,
  title: 'First chat',
  status: 'working',
  createdAt: TS,
  updatedAt: TS,
  lastMessage: {
    id: 'msg_01JABCDEFGHJKMNPQRSV',
    chatId: CHAT,
    role: 'assistant',
    text: 'last reply',
    createdAt: TS,
  },
};

const REPOS_URL = '/v1/repos';
const SESSIONS_URL = '/v1/chat/sessions';

function page<T>(data: readonly T[]): Page<T> {
  return { data: [...data], nextCursor: null };
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
  readonly fixture: ComponentFixture<ChatListPage>;
  readonly element: HTMLElement;
  readonly sse: WritableSignal<SseStreamEvent | null>;
  readonly http: HttpTestingController;
}

async function mount(
  repos: Page<Repo> = page([REPO]),
  sessions: Page<ChatSession> = page([SESSION]),
): Promise<Mounted> {
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
  const fixture = TestBed.createComponent(ChatListPage);
  await fixture.whenStable();

  const http = TestBed.inject(HttpTestingController);
  http.expectOne((request) => request.url === REPOS_URL).flush(repos);
  http.expectOne((request) => request.url === SESSIONS_URL).flush(sessions);
  await fixture.whenStable();

  return { fixture, element: fixture.nativeElement as HTMLElement, sse, http };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe('ChatListPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('renders one row per session with its status and last message', async () => {
    const { element } = await mount();

    const rows = element.querySelectorAll('[data-testid="chat-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-chat-id')).toBe(CHAT);
    expect(rows[0]?.getAttribute('data-status')).toBe('working');
    expect(hook(element, 'chat-row-last')?.textContent).toContain('last reply');
    expect(element.textContent).toContain('owner/repo');
    expect(hook(element, 'chat-empty')).toBeNull();
    expect(hook(element, 'chat-list-loading')).toBeNull();
  });

  it('renders the empty state for an empty page', async () => {
    const { element } = await mount(page([REPO]), page<ChatSession>([]));

    expect(element.querySelectorAll('[data-testid="chat-row"]')).toHaveLength(0);
    expect(hook(element, 'chat-empty')).not.toBeNull();
  });

  it('reloads the sessions of the chosen repository', async () => {
    const { fixture, element, http } = await mount();

    const option = element.querySelector<HTMLElement>(
      `[data-testid="repo-option"][data-repo-id="${REPO_ID}"]`,
    );
    expect(option).not.toBeNull();
    option?.click();
    await fixture.whenStable();

    const request = http.expectOne(
      (candidate) => candidate.url === SESSIONS_URL && candidate.method === 'GET',
    );
    expect(request.request.params.get('repoId')).toBe(REPO_ID);
    request.flush(page([SESSION]));
    await fixture.whenStable();

    expect(fixture.componentInstance.store.repoFilter()).toBe(REPO_ID);
    expect(element.querySelectorAll('[data-testid="chat-row"]')).toHaveLength(1);
  });

  it('disables the new chat action while there is no repository', async () => {
    const { element } = await mount(page<Repo>([]), page<ChatSession>([]));

    const button = element.querySelector<HTMLButtonElement>('[data-testid="chat-new"]');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
  });

  it('creates a session and opens it only after the 201', async () => {
    const { fixture, element, http } = await mount();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const button = element.querySelector<HTMLButtonElement>('[data-testid="chat-new"]');
    expect(button?.disabled).toBe(false);
    button?.click();

    const request = http.expectOne({ method: 'POST', url: SESSIONS_URL });
    expect(request.request.body).toEqual({ repoId: REPO_ID });
    expect(navigate).not.toHaveBeenCalled();

    request.flush(SESSION, { status: 201, statusText: 'Created' });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/chat', CHAT]);
  });

  it('renders the error block with its code and retries the list', async () => {
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
    const fixture = TestBed.createComponent(ChatListPage);
    await fixture.whenStable();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.url === REPOS_URL).flush(page<Repo>([]));
    http
      .expectOne((request) => request.url === SESSIONS_URL)
      .flush(
        {
          error: {
            code: 'internal',
            message: 'Boom',
            requestId: 'req_01JABCDEFGHJKMNPQRSV',
          },
        },
        { status: 500, statusText: 'Server Error' },
      );
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(hook(element, 'chat-list-error')?.getAttribute('data-code')).toBe('internal');

    hook(element, 'chat-list-retry')?.click();
    await fixture.whenStable();
    http.expectOne((request) => request.url === SESSIONS_URL).flush(page([SESSION]));
    await fixture.whenStable();

    expect(hook(element, 'chat-list-error')).toBeNull();
    expect(element.querySelectorAll('[data-testid="chat-row"]')).toHaveLength(1);
  });

  it('updates a row preview from a chat.message stream event', async () => {
    const { fixture, element, sse } = await mount();

    sse.set({
      event: 'chat.message',
      data: {
        chatId: CHAT,
        seq: 4,
        ts: TS,
        message: {
          id: 'msg_01JABCDEFGHJKMNPQRSW',
          chatId: CHAT,
          role: 'assistant',
          text: 'fresh reply',
          createdAt: TS,
        },
      },
    });
    await fixture.whenStable();

    expect(hook(element, 'chat-row-last')?.textContent).toContain('fresh reply');
  });
});
