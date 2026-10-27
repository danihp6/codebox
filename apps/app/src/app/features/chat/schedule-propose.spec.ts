import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { Schedule } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locale } from '../../core/i18n/i18n.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { formatFire } from '../jobs/time-format';
import type { ScheduleProposal } from '../schedules/schedule-filter';
import { STRINGS } from './schedule-propose.i18n';
import { ScheduleProposeCard, toCreateBody } from './schedule-propose';

const SCHEDULE_URL = '/v1/schedules';

function scheduleFixture(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch_01JABCDEFG',
    repoId: null,
    chatSessionId: null,
    title: 'Nightly triage',
    prompt: 'Review the open pull requests.',
    mode: 'every',
    cron: '0 7 * * *',
    timezone: 'Europe/Madrid',
    windowStart: null,
    windowEnd: null,
    cooldownMinutes: 0,
    maxFires: null,
    maxCostPerFireUsd: null,
    firePolicy: 'new_chat',
    consecutiveFailures: 0,
    firesCount: 0,
    spendUsd: 0,
    enabled: true,
    policy: 'auto',
    nextFireAt: '2026-07-02T05:00:00.000Z',
    lastFiredAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

const WINDOW_PROPOSAL: ScheduleProposal = {
  title: 'Nightly triage',
  mode: 'window',
  cron: null,
  timezone: 'Europe/Madrid',
  windowStart: '22:00',
  windowEnd: '06:00',
  prompt: 'Review the open pull requests.',
  repoId: 'repo_01JABCDEFG',
  cooldownMinutes: 30,
  maxCostPerFireUsd: 2.5,
  nextFireAt: '2026-07-01T21:30:00.000Z',
};

const CRON_PROPOSAL: ScheduleProposal = {
  title: 'Daily digest',
  mode: 'every',
  cron: '0 7 * * *',
  timezone: 'UTC',
  windowStart: null,
  windowEnd: null,
  prompt: 'Summarise yesterday.',
  repoId: null,
};

const FAILURE = {
  error: {
    code: 'validation_failed',
    message: 'the window does not parse',
    requestId: 'req_01JABCDEFGHJKMNPQRSV',
  },
};

interface Mounted {
  readonly fixture: ComponentFixture<ScheduleProposeCard>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
  readonly locale: WritableSignal<Locale>;
  readonly emitted: Schedule[];
  readonly dismissed: () => number;
}

async function mount(proposal: ScheduleProposal, locale: Locale = 'en'): Promise<Mounted> {
  const localeSignal = signal<Locale>(locale);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: { locale: localeSignal } },
    ],
  });
  const fixture = TestBed.createComponent(ScheduleProposeCard);
  fixture.componentRef.setInput('proposal', proposal);
  await fixture.whenStable();
  const emitted: Schedule[] = [];
  fixture.componentInstance.created.subscribe((schedule) => emitted.push(schedule));
  let dismissals = 0;
  fixture.componentInstance.dismissed.subscribe(() => {
    dismissals += 1;
  });
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    locale: localeSignal,
    emitted,
    dismissed: () => dismissals,
  };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function createButton(element: HTMLElement): HTMLButtonElement {
  const button = hook(element, 'propose-create');
  if (!(button instanceof HTMLButtonElement)) throw new Error('missing create button');
  return button;
}

describe('ScheduleProposeCard', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the assumption block without issuing a request', async () => {
    const mounted = await mount(WINDOW_PROPOSAL);

    expect(hook(mounted.element, 'propose-title')?.textContent?.trim()).toBe('Nightly triage');
    expect(hook(mounted.element, 'propose-mode')?.textContent?.trim()).toBe('Window');
    expect(hook(mounted.element, 'propose-when')?.textContent?.trim()).toBe('22:00–06:00');
    expect(hook(mounted.element, 'propose-zone')?.textContent?.trim()).toBe('Europe/Madrid');
    expect(hook(mounted.element, 'propose-next')?.textContent?.trim()).toBe(
      formatFire('2026-07-01T21:30:00.000Z', 'Europe/Madrid', 'en'),
    );
    expect(hook(mounted.element, 'propose-cost')?.getAttribute('data-cost-usd')).toBe('2.5');
    expect(hook(mounted.element, 'propose-repo')?.textContent?.trim()).toBe('repo_01JABCDEFG');
    expect(hook(mounted.element, 'propose-none')?.textContent).toContain(
      'Nothing is scheduled until you tap Create.',
    );

    expect(mounted.http.match(() => true)).toHaveLength(0);
    mounted.http.verify();
  });

  it('says the daemon computes the fire when the proposal has no timestamp', async () => {
    const mounted = await mount(CRON_PROPOSAL);

    expect(hook(mounted.element, 'propose-when')?.textContent?.trim()).toBe('Every day at 07:00');
    expect(hook(mounted.element, 'propose-next')?.textContent?.trim()).toBe(
      'Computed by the daemon once you create it',
    );
    expect(hook(mounted.element, 'propose-cost')).toBeNull();
    expect(hook(mounted.element, 'propose-repo')).toBeNull();
    mounted.http.verify();
  });

  it('creates a window proposal with one POST on one tap and emits the parsed schedule once', async () => {
    const mounted = await mount(WINDOW_PROPOSAL);
    const button = createButton(mounted.element);

    button.click();
    mounted.fixture.componentInstance.create();
    await mounted.fixture.whenStable();

    expect(button.disabled).toBe(true);
    const request = mounted.http.expectOne({ method: 'POST', url: SCHEDULE_URL });
    expect(request.request.body).toEqual({
      title: 'Nightly triage',
      prompt: 'Review the open pull requests.',
      mode: 'window',
      cron: null,
      timezone: 'Europe/Madrid',
      windowStart: '22:00',
      windowEnd: '06:00',
      repoId: 'repo_01JABCDEFG',
      cooldownMinutes: 30,
      maxCostPerFireUsd: 2.5,
    });

    const created = scheduleFixture({
      mode: 'window',
      cron: null,
      windowStart: '22:00',
      windowEnd: '06:00',
      chatSessionId: 'chat_01JABCDEFG',
    });
    request.flush(created);
    await mounted.fixture.whenStable();

    expect(mounted.emitted).toHaveLength(1);
    expect(mounted.emitted[0]).toEqual(created);
    expect(button.disabled).toBe(false);
    mounted.http.verify();
  });

  it('creates a cron proposal with null bounds and no invented keys', async () => {
    const mounted = await mount(CRON_PROPOSAL);

    createButton(mounted.element).click();
    await mounted.fixture.whenStable();

    const request = mounted.http.expectOne({ method: 'POST', url: SCHEDULE_URL });
    expect(request.request.body).toEqual({
      title: 'Daily digest',
      prompt: 'Summarise yesterday.',
      mode: 'every',
      cron: '0 7 * * *',
      timezone: 'UTC',
      windowStart: null,
      windowEnd: null,
      repoId: null,
    });
    expect(Object.keys(request.request.body as Record<string, unknown>).sort()).toEqual([
      'cron',
      'mode',
      'prompt',
      'repoId',
      'timezone',
      'title',
      'windowEnd',
      'windowStart',
    ]);

    request.flush(scheduleFixture({ id: 'sch_01JABCDEFH', title: 'Daily digest' }));
    await mounted.fixture.whenStable();
    expect(mounted.emitted).toHaveLength(1);
    mounted.http.verify();
  });

  it('maps a window proposal to the create body with the window family null-shaped', () => {
    expect(toCreateBody(WINDOW_PROPOSAL).cron).toBeNull();
    expect(toCreateBody(WINDOW_PROPOSAL).windowStart).toBe('22:00');
    expect(toCreateBody(CRON_PROPOSAL).cron).toBe('0 7 * * *');
    expect(toCreateBody(CRON_PROPOSAL).windowStart).toBeNull();
    expect(toCreateBody(CRON_PROPOSAL).windowEnd).toBeNull();
    expect('cooldownMinutes' in toCreateBody(CRON_PROPOSAL)).toBe(false);
    expect('maxCostPerFireUsd' in toCreateBody(CRON_PROPOSAL)).toBe(false);
  });

  it('renders the 422 code and re-enables the button', async () => {
    const mounted = await mount(CRON_PROPOSAL);
    const button = createButton(mounted.element);

    button.click();
    await mounted.fixture.whenStable();
    mounted.http
      .expectOne({ method: 'POST', url: SCHEDULE_URL })
      .flush(FAILURE, { status: 422, statusText: 'Unprocessable Content' });
    await mounted.fixture.whenStable();

    expect(hook(mounted.element, 'propose-error')?.getAttribute('data-code')).toBe(
      'validation_failed',
    );
    expect(button.disabled).toBe(false);
    expect(mounted.emitted).toHaveLength(0);
    mounted.http.verify();
  });

  it('emits dismissed when the dismiss button is pressed', async () => {
    const mounted = await mount(CRON_PROPOSAL);

    hook(mounted.element, 'propose-dismiss')?.click();
    await mounted.fixture.whenStable();

    expect(mounted.dismissed()).toBe(1);
    mounted.http.verify();
  });

  it('ships the same key set in en and es and renders the Spanish copy', async () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());

    const mounted = await mount(WINDOW_PROPOSAL, 'es');
    expect(mounted.element.querySelector('h3')?.textContent).toContain('Horario propuesto');
    expect(hook(mounted.element, 'propose-mode')?.textContent?.trim()).toBe('Ventana');
    expect(hook(mounted.element, 'propose-none')?.textContent).toContain(
      'No hay nada programado hasta que pulses Crear.',
    );
    expect(hook(mounted.element, 'propose-next')?.textContent?.trim()).toBe(
      formatFire('2026-07-01T21:30:00.000Z', 'Europe/Madrid', 'es'),
    );
    mounted.http.verify();
  });
});
