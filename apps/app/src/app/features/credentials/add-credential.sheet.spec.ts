import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { AddCredentialSheet } from './add-credential.sheet';
import type { CreateCredentialBody } from './credentials.api';
import { STRINGS, translate } from './i18n';

const SECRET = 'sentinel-value-9876';

const USED_KEYS: readonly string[] = [
  'credentials.action.addOpen',
  'credentials.action.back',
  'credentials.action.cancel',
  'credentials.action.continue',
  'credentials.action.save',
  'credentials.expose.daemon',
  'credentials.expose.env',
  'credentials.expose.envBlocked',
  'credentials.expose.envWarning',
  'credentials.expose.tool',
  'credentials.kind',
  'credentials.kind.api_key',
  'credentials.kind.basic',
  'credentials.kind.bearer',
  'credentials.kind.github_app',
  'credentials.kind.model_key',
  'credentials.name',
  'credentials.problem.name',
  'credentials.problem.value',
  'credentials.value',
];

interface Mounted {
  readonly fixture: ComponentFixture<AddCredentialSheet>;
  readonly element: HTMLElement;
  readonly component: AddCredentialSheet;
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

async function mount(): Promise<Mounted> {
  const locale = signal<'en' | 'es'>('en');
  TestBed.configureTestingModule({
    providers: [{ provide: I18nService, useValue: { locale } }],
  });
  const fixture = TestBed.createComponent(AddCredentialSheet);
  await fixture.whenStable();
  fixture.detectChanges();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance,
  };
}

async function fill(
  fixture: ComponentFixture<AddCredentialSheet>,
  element: HTMLElement,
  id: string,
  value: string,
): Promise<void> {
  const input = hook(element, id);
  if (input === null) throw new Error(`${id} is missing`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${id} is not an input`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  await fixture.whenStable();
}

async function choose(
  fixture: ComponentFixture<AddCredentialSheet>,
  element: HTMLElement,
  id: string,
  value: string,
): Promise<void> {
  const select = hook(element, id);
  if (select === null) throw new Error(`${id} is missing`);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`${id} is not a select`);
  select.value = value;
  select.dispatchEvent(new Event('change'));
  fixture.detectChanges();
  await fixture.whenStable();
}

async function click(
  fixture: ComponentFixture<AddCredentialSheet>,
  element: HTMLElement,
  id: string,
): Promise<void> {
  const button = hook(element, id);
  if (button === null) throw new Error(`${id} is missing`);
  button.click();
  fixture.detectChanges();
  await fixture.whenStable();
}

async function reachReview(
  fixture: ComponentFixture<AddCredentialSheet>,
  element: HTMLElement,
): Promise<void> {
  await fill(fixture, element, 'credential-name', 'OpenAI');
  await fill(fixture, element, 'credential-value', SECRET);
  await click(fixture, element, 'credential-continue');
}

describe('AddCredentialSheet', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('only offers the save control after the review step', async () => {
    const { fixture, element } = await mount();

    expect(hook(element, 'credential-save')).toBeNull();
    expect(hook(element, 'credential-review')).toBeNull();

    await reachReview(fixture, element);

    expect(hook(element, 'credential-save')).not.toBeNull();
    expect(hook(element, 'credential-review')).not.toBeNull();
    expect(hook(element, 'credential-value')).toBeNull();
  });

  it('shows only the last four characters of the value on review', async () => {
    const { fixture, element } = await mount();
    await reachReview(fixture, element);

    const tail = hook(element, 'credential-review-tail');
    expect(tail?.textContent).toBe('9876');
    expect(hook(element, 'credential-review')?.textContent).not.toContain(SECRET);
    expect(element.textContent).not.toContain(SECRET);
  });

  it('treats the value input as a password and clears it after the save', async () => {
    const { fixture, element, component } = await mount();
    const input = hook(element, 'credential-value');
    expect(input?.getAttribute('type')).toBe('password');
    expect(input?.getAttribute('autocomplete')).toBe('off');

    await reachReview(fixture, element);
    const saved: CreateCredentialBody[] = [];
    component.saved.subscribe((body) => saved.push(body));

    await click(fixture, element, 'credential-save');

    expect(saved).toEqual([{ name: 'OpenAI', kind: 'api_key', expose: 'daemon', value: SECRET }]);
    expect(component.value()).toBe('');
    const cleared = hook(element, 'credential-value');
    expect(cleared).not.toBeNull();
    expect((cleared as HTMLInputElement).value).toBe('');
    expect(element.textContent).not.toContain(SECRET);
  });

  it('warns about the model environment and blocks env with any other kind', async () => {
    const { fixture, element } = await mount();

    expect(hook(element, 'credential-env-warning')).toBeNull();
    expect(hook(element, 'credential-env-blocked')).toBeNull();

    await choose(fixture, element, 'credential-expose', 'env');

    expect(hook(element, 'credential-env-warning')).not.toBeNull();
    expect(hook(element, 'credential-env-blocked')).not.toBeNull();
    expect((hook(element, 'credential-continue') as HTMLButtonElement).disabled).toBe(true);

    await choose(fixture, element, 'credential-kind', 'model_key');

    expect(hook(element, 'credential-env-warning')).not.toBeNull();
    expect(hook(element, 'credential-env-blocked')).toBeNull();
    expect((hook(element, 'credential-continue') as HTMLButtonElement).disabled).toBe(false);
  });

  it('never warns or blocks the daemon and tool exposures', async () => {
    const { fixture, element } = await mount();

    expect(hook(element, 'credential-env-warning')).toBeNull();
    await choose(fixture, element, 'credential-expose', 'tool');
    expect(hook(element, 'credential-env-warning')).toBeNull();
    expect(hook(element, 'credential-env-blocked')).toBeNull();
  });

  it('refuses to continue without a name or a value', async () => {
    const { fixture, element } = await mount();

    await click(fixture, element, 'credential-continue');
    expect(hook(element, 'credential-problem')).not.toBeNull();
    expect(hook(element, 'credential-review')).toBeNull();

    await fill(fixture, element, 'credential-name', 'OpenAI');
    await click(fixture, element, 'credential-continue');
    expect(hook(element, 'credential-problem')?.textContent).toBe(
      translate('en', 'credentials.problem.value'),
    );
    expect(hook(element, 'credential-review')).toBeNull();
  });

  it('closes without saving and forgets the value', async () => {
    const { fixture, element, component } = await mount();
    let closed = 0;
    component.closed.subscribe(() => {
      closed += 1;
    });

    await fill(fixture, element, 'credential-value', SECRET);
    await click(fixture, element, 'credential-cancel');

    expect(closed).toBe(1);
    expect(component.value()).toBe('');
    expect(hook(element, 'credential-value')).not.toBeNull();
  });

  it('ships the same keys in both dictionaries and resolves every template key', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());
    for (const locale of ['en', 'es'] as const) {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        expect(value, `${locale} ${key}`).not.toBe('');
        expect(translate(locale, key), `${locale} ${key}`).toBe(value);
      }
      for (const key of USED_KEYS) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});
