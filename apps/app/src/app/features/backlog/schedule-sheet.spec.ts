import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import type { RepoSchedule, Run } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { formatFire } from '../../core/util/time-format';
import { STRINGS, translate } from './i18n';
import { ScheduleSheet, scheduleFields, scheduleWrite } from './schedule-sheet';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const REPO_SLUG = 'acme/widgets';
const LIST_URL = `/v1/schedules?repoId=${REPO_ID}`;
const CREATE_URL = '/v1/schedules';
const PATCH_URL = '/v1/schedules/sch_01JABCDEFGHJK';

const SCHEDULE: RepoSchedule = {
  id: 'sch_01JABCDEFGHJK',
  repoId: REPO_ID,
  mode: 'window',
  cron: null,
  timezone: 'Europe/Madrid',
  windowStart: '09:00',
  windowEnd: '17:00',
  cooldownMinutes: 0,
  selection: 'nextPending',
  refs: [],
  maxAttempts: 2,
  maxFires: 4,
  maxCostPerFireUsd: 2,
  consecutiveFailures: 0,
  firesCount: 3,
  spendUsd: 1.5,
  enabled: true,
  nextFireAt: '2026-10-30T09:00:00Z',
  lastFiredAt: '2026-10-29T09:00:00Z',
  createdAt: '2026-10-28T09:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
};

const RUN: Run = {
  id: 'run_01JABCDEFGHJK',
  repoId: REPO_ID,
  jobId: null,
  state: 'queued',
  trigger: 'manual',
  branch: 'cb/run-next',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
  createdAt: '2026-10-29T08:00:00Z',
  finishedAt: null,
};

const i18nStub = { locale: () => 'en' as const };

interface Mounted {
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
  readonly fixture: ComponentFixture<ScheduleSheet>;
}

let mounted: ComponentFixture<ScheduleSheet> | null = null;

async function mount(schedule: RepoSchedule | null = SCHEDULE): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: i18nStub },
    ],
  });
  const fixture = TestBed.createComponent(ScheduleSheet);
  fixture.componentRef.setInput('repoId', REPO_ID);
  fixture.componentRef.setInput('repoSlug', REPO_SLUG);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(LIST_URL).flush({
    data: schedule === null ? [] : [schedule],
    nextCursor: null,
  });
  await fixture.whenStable();
  mounted = fixture;
  return { element: fixture.nativeElement as HTMLElement, http, fixture };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function fill(element: HTMLElement, id: string, value: string): void {
  const input = element.querySelector<HTMLInputElement>(`[data-testid="${id}"]`);
  if (input === null) throw new Error(`${id} is missing`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('scheduleFields', () => {
  it('maps a stored window schedule to the draft, caps as strings', () => {
    expect(scheduleFields(SCHEDULE)).toEqual({
      mode: 'window',
      timezone: 'Europe/Madrid',
      cron: '0 9 * * 1-5',
      windowStart: '09:00',
      windowEnd: '17:00',
      selection: 'nextPending',
      refs: [],
      maxAttempts: 2,
      maxFires: '4',
      maxCost: '2',
    });
  });

  it('copies a stored refs selection so a save cannot fall back to the draft', () => {
    const refs: RepoSchedule = {
      ...SCHEDULE,
      selection: 'refs',
      refs: ['Task-35', 'Task-36'],
      maxAttempts: 3,
    };
    expect(scheduleFields(refs)).toMatchObject({
      selection: 'refs',
      refs: ['Task-35', 'Task-36'],
      maxAttempts: 3,
    });
  });

  it('falls back to the create defaults when a value is missing', () => {
    const cron: RepoSchedule = {
      ...SCHEDULE,
      mode: 'every',
      cron: '0 6 * * *',
      windowStart: null,
      windowEnd: null,
      maxFires: null,
      maxCostPerFireUsd: null,
    };

    expect(scheduleFields(cron)).toEqual({
      mode: 'every',
      timezone: 'Europe/Madrid',
      cron: '0 6 * * *',
      windowStart: '09:00',
      windowEnd: '17:00',
      selection: 'nextPending',
      refs: [],
      maxAttempts: 2,
      maxFires: '',
      maxCost: '',
    });
  });
});

describe('scheduleWrite', () => {
  const fields = {
    mode: 'window' as const,
    timezone: ' Europe/Madrid ',
    cron: ' 0 9 * * 1-5 ',
    windowStart: '09:00',
    windowEnd: '17:00',
    selection: 'nextPending' as const,
    refs: [] as readonly string[],
    maxAttempts: 2,
    maxFires: '4',
    maxCost: '2.5',
  };

  it('emits the window family with a trimmed zone and no cron', () => {
    expect(scheduleWrite(fields)).toEqual({
      mode: 'window',
      timezone: 'Europe/Madrid',
      cron: null,
      windowStart: '09:00',
      windowEnd: '17:00',
      selection: 'nextPending',
      refs: [],
      maxAttempts: 2,
      maxFires: 4,
      maxCostPerFireUsd: 2.5,
    });
  });

  it('emits the cron family with a trimmed cron and no window bounds', () => {
    expect(scheduleWrite({ ...fields, mode: 'every' })).toEqual({
      mode: 'every',
      timezone: 'Europe/Madrid',
      cron: '0 9 * * 1-5',
      windowStart: null,
      windowEnd: null,
      selection: 'nextPending',
      refs: [],
      maxAttempts: 2,
      maxFires: 4,
      maxCostPerFireUsd: 2.5,
    });
  });

  it('emits the hidden selection pair and retry budget unchanged', () => {
    expect(
      scheduleWrite({ ...fields, selection: 'refs', refs: ['Task-35'], maxAttempts: 3 }),
    ).toMatchObject({ selection: 'refs', refs: ['Task-35'], maxAttempts: 3 });
  });

  it('reads an empty cap as no cap', () => {
    expect(scheduleWrite({ ...fields, maxFires: '', maxCost: '' })).toMatchObject({
      maxFires: null,
      maxCostPerFireUsd: null,
    });
  });

  it('refuses the whole draft when a cap is not a valid value', () => {
    for (const maxFires of ['0', '-1', '1.5', 'abc']) {
      expect(scheduleWrite({ ...fields, maxFires }), maxFires).toBeNull();
    }
    for (const maxCost of ['abc', '-1']) {
      expect(scheduleWrite({ ...fields, maxCost }), maxCost).toBeNull();
    }
  });
});

describe('ScheduleSheet', () => {
  afterEach(() => {
    mounted?.destroy();
    mounted = null;
    TestBed.resetTestingModule();
  });

  it('renders the stored schedule: mode, window fields, caps and next fire', async () => {
    const { element } = await mount();

    expect(hook(element, 'schedule-sheet')?.getAttribute('role')).toBe('dialog');
    expect(hook(element, 'schedule-sheet')?.getAttribute('aria-modal')).toBe('true');
    expect(hook(element, 'schedule-sheet')?.getAttribute('data-repo-id')).toBe(REPO_ID);

    const form = hook(element, 'schedule-sheet-fields');
    expect(form?.getAttribute('data-mode')).toBe('window');
    expect(hook(element, 'schedule-sheet-mode-once')?.getAttribute('aria-pressed')).toBe('false');
    expect(hook(element, 'schedule-sheet-mode-every')?.getAttribute('aria-pressed')).toBe('false');
    expect(hook(element, 'schedule-sheet-mode-window')?.getAttribute('aria-pressed')).toBe('true');

    const start = element.querySelector<HTMLInputElement>(
      '[data-testid="schedule-sheet-window-start"]',
    );
    const end = element.querySelector<HTMLInputElement>('[data-testid="schedule-sheet-window-end"]');
    expect(start?.value).toBe('09:00');
    expect(end?.value).toBe('17:00');
    expect(start?.getAttribute('type')).toBe('time');
    expect(
      element.querySelector<HTMLInputElement>('[data-testid="schedule-sheet-timezone"]')?.value,
    ).toBe('Europe/Madrid');
    expect(hook(element, 'schedule-sheet-cron')).toBeNull();

    const fires = element.querySelector<HTMLInputElement>(
      '[data-testid="schedule-sheet-max-fires"]',
    );
    const cost = element.querySelector<HTMLInputElement>('[data-testid="schedule-sheet-max-cost"]');
    expect(fires?.value).toBe('4');
    expect(fires?.getAttribute('type')).toBe('number');
    expect(cost?.value).toBe('2');
    expect(cost?.getAttribute('type')).toBe('number');

    const instant = formatFire(SCHEDULE.nextFireAt ?? '', SCHEDULE.timezone, 'en');
    const nextFire = hook(element, 'schedule-sheet-next-fire')?.textContent ?? '';
    expect(nextFire).toContain(translate('en', 'scheduleSheet.nextFire'));
    expect(nextFire).toContain(instant);
    expect(nextFire).toContain('1');

    expect(hook(element, 'schedule-sheet-empty')).toBeNull();
  });

  it('saves the stored schedule with a PATCH of exactly the ten keys', async () => {
    const { element, http, fixture } = await mount();

    hook(element, 'schedule-sheet-save')?.click();
    await fixture.whenStable();

    const patch = http.expectOne({ method: 'PATCH', url: PATCH_URL });
    expect(patch.request.body).toEqual({
      mode: 'window',
      timezone: 'Europe/Madrid',
      cron: null,
      windowStart: '09:00',
      windowEnd: '17:00',
      selection: 'nextPending',
      refs: [],
      maxAttempts: 2,
      maxFires: 4,
      maxCostPerFireUsd: 2,
    });
    expect(patch.request.body).not.toHaveProperty('title');
    expect(patch.request.body).not.toHaveProperty('prompt');
    patch.flush(SCHEDULE);
    await fixture.whenStable();

    http.expectNone({ method: 'POST', url: CREATE_URL });
    expect(hook(element, 'schedule-sheet-error')).toBeNull();
  });

  it('keeps the stored refs of a refs schedule on save', async () => {
    const refs: RepoSchedule = {
      ...SCHEDULE,
      selection: 'refs',
      refs: ['Task-35'],
      maxAttempts: 3,
    };
    const { element, http, fixture } = await mount(refs);

    hook(element, 'schedule-sheet-save')?.click();
    await fixture.whenStable();

    const patch = http.expectOne({ method: 'PATCH', url: PATCH_URL });
    expect(patch.request.body).toMatchObject({
      selection: 'refs',
      refs: ['Task-35'],
      maxAttempts: 3,
    });
    patch.flush(refs);
    await fixture.whenStable();

    expect(hook(element, 'schedule-sheet-fields-error')).toBeNull();
  });

  it('renders the empty card, reveals the form and creates with the eleven-key body', async () => {
    const { element, http, fixture } = await mount(null);

    expect(hook(element, 'schedule-sheet-empty')?.textContent).toContain(
      translate('en', 'scheduleSheet.empty.title'),
    );
    expect(hook(element, 'schedule-sheet-empty')?.textContent).toContain(
      translate('en', 'scheduleSheet.empty.body'),
    );
    expect(hook(element, 'schedule-sheet-fields')).toBeNull();

    hook(element, 'schedule-sheet-create')?.click();
    await fixture.whenStable();

    expect(hook(element, 'schedule-sheet-empty')).toBeNull();
    expect(hook(element, 'schedule-sheet-fields')?.getAttribute('data-mode')).toBe('every');
    expect(
      element.querySelector<HTMLInputElement>('[data-testid="schedule-sheet-cron"]')?.value,
    ).toBe('0 9 * * 1-5');
    expect(
      element.querySelector<HTMLInputElement>('[data-testid="schedule-sheet-timezone"]')?.value,
    ).toBe('UTC');

    hook(element, 'schedule-sheet-save')?.click();
    await fixture.whenStable();

    const create = http.expectOne({ method: 'POST', url: CREATE_URL });
    expect(create.request.body).toEqual({
      mode: 'every',
      timezone: 'UTC',
      cron: '0 9 * * 1-5',
      windowStart: null,
      windowEnd: null,
      selection: 'nextPending',
      refs: [],
      maxAttempts: 2,
      maxFires: null,
      maxCostPerFireUsd: null,
      repoId: REPO_ID,
    });
    expect(create.request.body).not.toHaveProperty('title');
    expect(create.request.body).not.toHaveProperty('prompt');
    create.flush(SCHEDULE, { status: 201, statusText: 'Created' });
    await fixture.whenStable();

    expect(hook(element, 'schedule-sheet-empty')).toBeNull();
    expect(hook(element, 'schedule-sheet-fields')?.getAttribute('data-mode')).toBe('window');
  });

  it('starts one run and renders its id and state', async () => {
    const { element, http, fixture } = await mount();

    hook(element, 'schedule-sheet-run-next')?.click();
    await fixture.whenStable();
    http
      .expectOne({ method: 'POST', url: `/v1/repos/${REPO_ID}/run-next` })
      .flush(RUN, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();

    const started = hook(element, 'schedule-sheet-started');
    expect(started?.getAttribute('data-run-id')).toBe(RUN.id);
    expect(started?.getAttribute('data-state')).toBe('queued');
    expect(hook(element, 'schedule-sheet-notice')).toBeNull();
  });

  it('renders a refused run next as the notice and not as an error', async () => {
    const { element, http, fixture } = await mount();

    hook(element, 'schedule-sheet-run-next')?.click();
    await fixture.whenStable();
    http
      .expectOne({ method: 'POST', url: `/v1/repos/${REPO_ID}/run-next` })
      .flush(
        { error: { code: 'conflict', message: 'Nothing', details: { reason: 'nothing_pending' } } },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();

    expect(hook(element, 'schedule-sheet-notice')?.getAttribute('data-reason')).toBe(
      'nothing_pending',
    );
    expect(hook(element, 'schedule-sheet-error')).toBeNull();
    expect(hook(element, 'schedule-sheet-started')).toBeNull();
  });

  it('refuses an invalid cap inline and issues no request', async () => {
    const { element, http, fixture } = await mount();

    fill(element, 'schedule-sheet-max-fires', '0');
    await fixture.whenStable();
    hook(element, 'schedule-sheet-save')?.click();
    await fixture.whenStable();

    expect(hook(element, 'schedule-sheet-fields-error')).not.toBeNull();
    http.expectNone({ method: 'PATCH', url: PATCH_URL });
    http.expectNone({ method: 'POST', url: CREATE_URL });
  });

  it('closes by the × button, the scrim and Escape, emitting closed once and no request', async () => {
    const { element, http, fixture } = await mount();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => {
      closed += 1;
    });

    expect(document.activeElement).toBe(hook(element, 'schedule-sheet-close'));

    hook(element, 'schedule-sheet-close')?.click();
    hook(element, 'schedule-sheet-scrim')?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();

    expect(closed).toBe(1);
    http.expectNone({ method: 'PATCH', url: PATCH_URL });
    http.expectNone({ method: 'POST', url: CREATE_URL });
    http.expectNone({ method: 'POST', url: `/v1/repos/${REPO_ID}/run-next` });
  });

  it('wraps Tab from the last control to the close button', async () => {
    const { element } = await mount();
    const close = hook(element, 'schedule-sheet-close');
    const last = hook(element, 'schedule-sheet-run-next');
    expect(close).not.toBeNull();
    expect(last).not.toBeNull();
    last?.focus();
    expect(document.activeElement).toBe(last);

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it('wraps Shift+Tab from the close button to the last control', async () => {
    const { element } = await mount();
    const close = hook(element, 'schedule-sheet-close');
    const last = hook(element, 'schedule-sheet-run-next');
    expect(document.activeElement).toBe(close);

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('leaves Tab alone in the middle and pulls an outside focus in', async () => {
    const { element } = await mount();
    const middle = hook(element, 'schedule-sheet-max-fires');
    const close = hook(element, 'schedule-sheet-close');
    middle?.focus();

    const inside = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(middle);

    (document.activeElement as HTMLElement | null)?.blur();
    const outside = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it('ships both locales key-for-key, in the same order', () => {
    expect(Object.keys(STRINGS.es)).toEqual(Object.keys(STRINGS.en));
    for (const key of Object.keys(STRINGS.en)) {
      if (!key.startsWith('scheduleSheet.') && key !== 'backlog.schedule') continue;
      expect(STRINGS.en[key], `en ${key}`).toBeTruthy();
      expect(STRINGS.es[key], `es ${key}`).toBeTruthy();
    }
  });
});
