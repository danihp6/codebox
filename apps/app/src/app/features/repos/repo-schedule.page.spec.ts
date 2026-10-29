import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Schedule } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { RepoSchedulePage } from './repo-schedule.page';
import { STRINGS, translate } from './repo-chrome.i18n';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const LIST_URL = `/v1/schedules?repoId=${REPO_ID}`;

const SCHEDULE: Schedule = {
  id: 'sch_01JABCDEFGHJK',
  repoId: REPO_ID,
  chatSessionId: null,
  title: 'Backlog shift',
  prompt: 'Work the backlog in file order.',
  mode: 'window',
  cron: null,
  timezone: 'Europe/Madrid',
  windowStart: '09:00',
  windowEnd: '17:00',
  cooldownMinutes: 15,
  maxFires: null,
  maxCostPerFireUsd: null,
  firePolicy: 'new_chat',
  consecutiveFailures: 0,
  firesCount: 3,
  spendUsd: 1.5,
  enabled: true,
  policy: 'auto',
  nextFireAt: '2026-10-30T09:00:00Z',
  lastFiredAt: '2026-10-29T09:00:00Z',
  createdAt: '2026-10-28T09:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
};

const i18nStub = { locale: () => 'en' as const };

interface Mounted {
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
  readonly fixture: ComponentFixture<RepoSchedulePage>;
}

async function mount(schedule: Schedule | null = SCHEDULE): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: i18nStub },
    ],
  });
  const fixture = TestBed.createComponent(RepoSchedulePage);
  fixture.componentRef.setInput('id', REPO_ID);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(LIST_URL).flush({
    data: schedule === null ? [] : [schedule],
    nextCursor: null,
  });
  await fixture.whenStable();
  return { element: fixture.nativeElement as HTMLElement, http, fixture };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe('RepoSchedulePage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the mode, the window and the next fire from the row', async () => {
    const { element } = await mount();

    expect(hook(element, 'page-repo-schedule')).not.toBeNull();
    expect(hook(element, 'repo-schedule-row')?.getAttribute('data-schedule-id')).toBe(SCHEDULE.id);
    expect(hook(element, 'repo-schedule-mode')?.textContent?.trim()).toBe(
      translate('en', 'repoSchedule.mode.window'),
    );
    expect(hook(element, 'repo-schedule-window')?.textContent?.trim()).toBe('09:00–17:00');

    const expected = new Intl.DateTimeFormat('en', {
      timeZone: SCHEDULE.timezone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(SCHEDULE.nextFireAt ?? ''));
    expect(hook(element, 'repo-schedule-next-fire')?.textContent?.trim()).toBe(expected);
    expect(hook(element, 'repo-schedule-timezone')?.textContent?.trim()).toBe(SCHEDULE.timezone);
  });

  it('ships no field the wire does not carry', async () => {
    const { element } = await mount();

    const ids = [...element.querySelectorAll('[data-testid]')].map(
      (node) => node.getAttribute('data-testid') ?? '',
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => /selection|refs|attempts/.test(id))).toEqual([]);
    expect(hook(element, 'repo-schedule-max-fires')?.textContent?.trim()).toBe(
      translate('en', 'repoSchedule.noCap'),
    );
  });

  it('maps a refused run-next to the notice and navigates nowhere', async () => {
    const { element, http, fixture } = await mount();

    hook(element, 'repo-schedule-run-next')?.click();
    await fixture.whenStable();
    http
      .expectOne({ method: 'POST', url: `/v1/repos/${REPO_ID}/run-next` })
      .flush(
        { error: { code: 'conflict', message: 'Nothing', details: { reason: 'nothing_pending' } } },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();

    expect(hook(element, 'repo-schedule-notice')?.getAttribute('data-reason')).toBe(
      'nothing_pending',
    );
    expect(hook(element, 'repo-schedule-error')).toBeNull();
    expect(hook(element, 'repo-schedule-next-run')).toBeNull();
  });

  it('creates a cron schedule once from an empty tab', async () => {
    const { element, http, fixture } = await mount(null);

    expect(hook(element, 'repo-schedule-empty')).not.toBeNull();
    const form = hook(element, 'repo-schedule-create');
    expect(form).not.toBeNull();

    hook(element, 'repo-schedule-create-submit')?.click();
    await fixture.whenStable();

    const create = http.expectOne({ method: 'POST', url: '/v1/schedules' });
    expect(create.request.body).toEqual({
      repoId: REPO_ID,
      mode: 'every',
      timezone: 'UTC',
      cron: '0 9 * * 1-5',
    });
    create.flush(SCHEDULE, { status: 201, statusText: 'Created' });
    await fixture.whenStable();

    expect(hook(element, 'repo-schedule-row')).not.toBeNull();
    expect(hook(element, 'repo-schedule-empty')).toBeNull();
  });

  it('ships both locales key-for-key', () => {
    expect(Object.keys(STRINGS.es)).toEqual(Object.keys(STRINGS.en));
    for (const locale of ['en', 'es'] as const) {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        expect(translate(locale, key), `${locale} ${key}`).toBe(value);
      }
    }
  });
});
