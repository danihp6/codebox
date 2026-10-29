import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { Repo } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { SecureStore } from '../../core/auth/secure-store';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { Locale } from '../../core/i18n/i18n.service';
import { STRINGS, translate } from './i18n';
import { RepoPicker, pickerState } from './repo-picker';

const TS = '2026-10-27T11:00:00Z';

const CONNECTED: Repo = {
  id: 'repo_01JABCDEFGHJKMNPQRSV',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: TS,
};

const DISABLED: Repo = {
  ...CONNECTED,
  id: 'repo_02JABCDEFGHJKMNPQRSV',
  slug: 'acme/legacy',
  enabled: false,
};

const PICKER_KEYS: readonly string[] = [
  'repoPicker.aria',
  'repoPicker.state.connected',
  'repoPicker.state.cloning',
  'repoPicker.state.unavailable',
];

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
  readonly fixture: ComponentFixture<RepoPicker>;
  readonly element: HTMLElement;
  readonly picked: string[];
}

async function mount(repos: readonly Repo[], busyRepoId: string | null = null): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [{ provide: SECURE_STORE, useValue: memoryStore() }],
  });
  const fixture = TestBed.createComponent(RepoPicker);
  fixture.componentRef.setInput('repos', repos);
  fixture.componentRef.setInput('busyRepoId', busyRepoId);
  const picked: string[] = [];
  fixture.componentInstance.picked.subscribe((id) => picked.push(id));
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, picked };
}

function rows(element: HTMLElement): HTMLButtonElement[] {
  return [...element.querySelectorAll<HTMLButtonElement>('[data-testid="repo-picker-row"]')];
}

function row(element: HTMLElement, repoId: string): HTMLButtonElement | null {
  return element.querySelector<HTMLButtonElement>(
    `[data-testid="repo-picker-row"][data-repo-id="${repoId}"]`,
  );
}

describe('pickerState', () => {
  it('reads a connected repository', () => {
    expect(pickerState(CONNECTED, null)).toBe('connected');
    expect(pickerState(CONNECTED, DISABLED.id)).toBe('connected');
  });

  it('reads the repository a request is in flight for as cloning', () => {
    expect(pickerState(CONNECTED, CONNECTED.id)).toBe('cloning');
  });

  it('never reads a disabled repository as pickable', () => {
    expect(pickerState(DISABLED, null)).toBe('unavailable');
  });
});

describe('RepoPicker', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders one row per repository with its state', async () => {
    const { element } = await mount([CONNECTED, DISABLED], CONNECTED.id);

    expect(rows(element)).toHaveLength(2);
    expect(row(element, CONNECTED.id)?.getAttribute('data-state')).toBe('cloning');
    expect(row(element, DISABLED.id)?.getAttribute('data-state')).toBe('unavailable');
  });

  it('emits the id of a connected or cloning row only', async () => {
    const { fixture, element, picked } = await mount([CONNECTED, DISABLED]);

    row(element, DISABLED.id)?.click();
    await fixture.whenStable();
    expect(picked).toEqual([]);

    row(element, CONNECTED.id)?.click();
    await fixture.whenStable();
    expect(picked).toEqual([CONNECTED.id]);
  });

  it('emits from a cloning row too', async () => {
    const { fixture, element, picked } = await mount([CONNECTED], CONNECTED.id);

    row(element, CONNECTED.id)?.click();
    await fixture.whenStable();
    expect(picked).toEqual([CONNECTED.id]);
  });

  it('emits nothing on render', async () => {
    const { picked } = await mount([CONNECTED]);

    expect(picked).toEqual([]);
  });

  it('ships the picker copy in both locales', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());
    for (const locale of ['en', 'es'] as const satisfies readonly Locale[]) {
      for (const key of PICKER_KEYS) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});
