import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { PromptRoutine, ReminderRoutine, SseStreamEvent } from '@codebox/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { RoutinesPanel } from './routines-panel';

const REMINDER_ID = 'rtn_01JABCDEFGHJKMNPQRSV';
const PROMPT_ID = 'rtn_01JABCDEFGHJKMNPQRSW';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const CHAT_ID = 'chat_01JABCDEFGHJKMNPQRSV';
const TS = '2026-10-24T18:03:11Z';
const ROUTINES_URL = '/v1/routines?limit=100';

const REMINDER: ReminderRoutine = {
  id: REMINDER_ID,
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

const PROMPT: PromptRoutine = {
  id: PROMPT_ID,
  kind: 'prompt',
  title: 'Morning summary',
  cron: '0 8 * * *',
  timezone: 'Europe/Madrid',
  enabled: false,
  notify: false,
  repoId: REPO_ID,
  prompt: 'Summarise the repository in five bullets.',
  chatSessionId: CHAT_ID,
  createdAt: TS,
  nextFireAt: null,
  lastFiredAt: null,
};

const FAILURE = {
  error: {
    code: 'internal',
    message: 'Boom',
    requestId: 'req_01JABCDEFGHJKMNPQRSV',
  },
};

interface Mounted {
  readonly fixture: ComponentFixture<RoutinesPanel>;
  readonly element: HTMLElement;
  readonly sse: WritableSignal<SseStreamEvent | null>;
  readonly http: HttpTestingController;
}

async function mount(
  routines: readonly (ReminderRoutine | PromptRoutine)[],
  locale: 'en' | 'es' = 'en',
): Promise<Mounted> {
  const sse = signal<SseStreamEvent | null>(null);
  const localeSignal = signal<'en' | 'es'>(locale);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SseService, useValue: { event: sse } },
      { provide: I18nService, useValue: { locale: localeSignal } },
    ],
  });
  const fixture = TestBed.createComponent(RoutinesPanel);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(ROUTINES_URL).flush({ data: [...routines], nextCursor: null });
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, sse, http };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function button(element: HTMLElement, id: string): HTMLButtonElement | null {
  return element.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
}

function text(element: HTMLElement | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function typeInto(element: HTMLElement | null, value: string): void {
  if (element === null) throw new Error('missing input');
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = value;
  }
  element.dispatchEvent(new Event('input'));
}

describe('RoutinesPanel', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('renders a reminder with its kind, its cost, its local schedule and its next fire', async () => {
    const { fixture, element } = await mount([REMINDER]);

    const row = hook(element, 'routine-row');
    expect(row?.getAttribute('data-routine-id')).toBe(REMINDER_ID);
    expect(row?.getAttribute('data-kind')).toBe('reminder');
    expect(row?.getAttribute('data-enabled')).toBe('true');
    expect(text(hook(element, 'routine-kind'))).toBe('Reminder');
    expect(text(hook(element, 'routine-cost'))).toBe('No model, no tokens');
    expect(text(hook(element, 'routine-schedule'))).toBe('Every day at 07:00 · Europe/Madrid');
    expect(hook(element, 'routine-next')?.getAttribute('data-at')).toBe(REMINDER.nextFireAt);
    expect(text(hook(element, 'routine-last'))).toBe('Never');
    expect(text(hook(element, 'routine-state'))).toBe('Enabled');

    button(element, 'routine-edit')?.click();
    await fixture.whenStable();

    expect(hook(element, 'routine-sheet')?.getAttribute('role')).toBe('dialog');
    expect(hook(element, 'routine-sheet')?.getAttribute('aria-modal')).toBe('true');
    expect(hook(element, 'routine-form-prompt')).toBeNull();
    expect(hook(element, 'routine-form-cron')).not.toBeNull();
  });

  it('renders a prompt with its cost and its prompt in the editor', async () => {
    const { element, fixture } = await mount([PROMPT]);

    expect(text(hook(element, 'routine-kind'))).toBe('Prompt');
    expect(text(hook(element, 'routine-cost'))).toBe('Uses the chat model');
    expect(hook(element, 'routine-next')).toBeNull();
    expect(button(element, 'routine-resume')).not.toBeNull();

    button(element, 'routine-edit')?.click();
    await fixture.whenStable();

    const prompt = hook(element, 'routine-form-prompt');
    expect(prompt).not.toBeNull();
    expect((prompt as HTMLTextAreaElement).value).toBe(PROMPT.prompt);
  });

  it('sends pause, resume and run-now to the daemon routes', async () => {
    const { element, http, fixture } = await mount([REMINDER, PROMPT]);

    button(element, 'routine-pause')?.click();
    await fixture.whenStable();
    http
      .expectOne({ method: 'POST', url: `/v1/routines/${REMINDER_ID}/pause` })
      .flush({ ...REMINDER, enabled: false, nextFireAt: null });
    await fixture.whenStable();

    button(element, 'routine-resume')?.click();
    await fixture.whenStable();
    http
      .expectOne({ method: 'POST', url: `/v1/routines/${REMINDER_ID}/resume` })
      .flush(REMINDER);
    await fixture.whenStable();

    button(element, 'routine-run-now')?.click();
    await fixture.whenStable();
    http
      .expectOne({ method: 'POST', url: `/v1/routines/${REMINDER_ID}/run` })
      .flush(REMINDER, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();

    expect(hook(element, 'routines-error')).toBeNull();
  });

  it('sends no request until the delete is confirmed', async () => {
    const { element, http, fixture } = await mount([REMINDER, PROMPT]);

    button(element, 'routine-delete')?.click();
    await fixture.whenStable();

    http.expectNone({ method: 'DELETE', url: `/v1/routines/${REMINDER_ID}` });
    expect(hook(element, 'routine-row')?.getAttribute('data-armed')).toBe('true');

    button(element, 'routine-delete-cancel')?.click();
    await fixture.whenStable();
    expect(hook(element, 'routine-row')?.getAttribute('data-armed')).toBeNull();

    button(element, 'routine-delete')?.click();
    await fixture.whenStable();
    button(element, 'routine-delete-confirm')?.click();
    await fixture.whenStable();

    http
      .expectOne({ method: 'DELETE', url: `/v1/routines/${REMINDER_ID}` })
      .flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();

    expect(element.querySelectorAll('[data-testid="routine-row"]')).toHaveLength(1);
  });

  it('patches a reminder with exactly title, cron, timezone and notify', async () => {
    const { element, http, fixture } = await mount([REMINDER]);

    button(element, 'routine-edit')?.click();
    await fixture.whenStable();

    typeInto(hook(element, 'routine-form-title'), 'Stretch');
    typeInto(hook(element, 'routine-form-timezone'), 'Europe/Madrid');
    typeInto(hook(element, 'cron-input'), '30 7 * * *');
    await fixture.whenStable();

    button(element, 'routine-form-save')?.click();
    await fixture.whenStable();

    const request = http.expectOne({ method: 'PATCH', url: `/v1/routines/${REMINDER_ID}` });
    expect(request.request.body).toEqual({
      title: 'Stretch',
      cron: '30 7 * * *',
      timezone: 'Europe/Madrid',
      notify: true,
    });
    expect(Object.keys(request.request.body as Record<string, unknown>).sort()).toEqual([
      'cron',
      'notify',
      'timezone',
      'title',
    ]);

    request.flush({ ...REMINDER, title: 'Stretch', cron: '30 7 * * *' });
    await fixture.whenStable();

    expect(hook(element, 'routine-sheet')).toBeNull();
    expect(hook(element, 'routine-row')?.textContent).toContain('Stretch');
  });

  it('patches a prompt with the extra prompt field', async () => {
    const { element, http, fixture } = await mount([PROMPT]);

    button(element, 'routine-edit')?.click();
    await fixture.whenStable();

    typeInto(hook(element, 'routine-form-prompt'), 'Summarise the last run.');
    button(element, 'routine-form-save')?.click();
    await fixture.whenStable();

    const request = http.expectOne({ method: 'PATCH', url: `/v1/routines/${PROMPT_ID}` });
    expect(request.request.body).toEqual({
      title: PROMPT.title,
      cron: PROMPT.cron,
      timezone: PROMPT.timezone,
      notify: PROMPT.notify,
      prompt: 'Summarise the last run.',
    });
    request.flush({ ...PROMPT, prompt: 'Summarise the last run.' });
  });

  it('refuses an invalid cron locally and sends nothing', async () => {
    const { element, http, fixture } = await mount([REMINDER]);

    button(element, 'routine-edit')?.click();
    await fixture.whenStable();

    typeInto(hook(element, 'cron-input'), '61 7 * * *');
    await fixture.whenStable();
    button(element, 'routine-form-save')?.click();
    await fixture.whenStable();

    http.expectNone({ method: 'PATCH', url: `/v1/routines/${REMINDER_ID}` });
    expect(hook(element, 'routine-form-error')?.getAttribute('data-code')).toBe(
      'validation_failed',
    );
    expect(hook(element, 'routine-sheet')).not.toBeNull();
  });

  it('shows the error code of a refused patch and keeps the editor open', async () => {
    const { element, http, fixture } = await mount([PROMPT]);

    button(element, 'routine-edit')?.click();
    await fixture.whenStable();
    button(element, 'routine-form-save')?.click();
    await fixture.whenStable();

    http
      .expectOne({ method: 'PATCH', url: `/v1/routines/${PROMPT_ID}` })
      .flush(
        {
          error: {
            code: 'validation_failed',
            message: 'The prompt is not valid.',
            requestId: 'req_01JABCDEFGHJKMNPQRSV',
            details: { path: 'routine.prompt' },
          },
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    await fixture.whenStable();

    expect(hook(element, 'routine-form-error')?.getAttribute('data-code')).toBe(
      'validation_failed',
    );
    expect(hook(element, 'routine-sheet')).not.toBeNull();
    expect(element.querySelectorAll('[data-testid="routine-row"]')).toHaveLength(1);
  });

  it('renders the loading state before the first page arrives', async () => {
    const sse = signal<SseStreamEvent | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SseService, useValue: { event: sse } },
        { provide: I18nService, useValue: { locale: signal<'en' | 'es'>('en') } },
      ],
    });
    const fixture = TestBed.createComponent(RoutinesPanel);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(hook(element, 'routines-loading')).not.toBeNull();
    expect(hook(element, 'routines-panel')?.getAttribute('data-loading')).toBe('true');

    const http = TestBed.inject(HttpTestingController);
    http.expectOne(ROUTINES_URL).flush({ data: [], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'routines-loading')).toBeNull();
    expect(hook(element, 'routines-empty')).not.toBeNull();
    expect(hook(element, 'routines-panel')?.getAttribute('data-loading')).toBe('false');
  });

  it('renders the error block with its code and retries the read', async () => {
    const sse = signal<SseStreamEvent | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SseService, useValue: { event: sse } },
        { provide: I18nService, useValue: { locale: signal<'en' | 'es'>('en') } },
      ],
    });
    const fixture = TestBed.createComponent(RoutinesPanel);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const http = TestBed.inject(HttpTestingController);

    http.expectOne(ROUTINES_URL).flush(FAILURE, {
      status: 500,
      statusText: 'Internal Server Error',
    });
    await fixture.whenStable();

    expect(hook(element, 'routines-error')?.getAttribute('data-code')).toBe('internal');

    button(element, 'routines-retry')?.click();
    await fixture.whenStable();
    http.expectOne(ROUTINES_URL).flush({ data: [REMINDER], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'routines-error')).toBeNull();
    expect(element.querySelectorAll('[data-testid="routine-row"]')).toHaveLength(1);
  });

  it('reloads on a routine.fired frame', async () => {
    const { element, http, fixture, sse } = await mount([REMINDER]);

    sse.set({
      event: 'routine.fired',
      data: { routineId: REMINDER_ID, kind: 'reminder', scheduledFor: TS, ts: TS },
    });
    await fixture.whenStable();

    http.expectOne(ROUTINES_URL).flush({ data: [REMINDER], nextCursor: null });
    await fixture.whenStable();

    expect(element.querySelectorAll('[data-testid="routine-row"]')).toHaveLength(1);
  });
});
