import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { describe, expect, it } from 'vitest';
import { SECURE_STORE } from '../core/auth/secure-store';
import type { SecureStore } from '../core/auth/secure-store';
import { SHELL_TABS, TabsPage } from './tabs.page';

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

describe('TabsPage', () => {
  it('renders the five bottom tabs in order', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        { provide: SECURE_STORE, useValue: memoryStore() },
      ],
    });
    const fixture = TestBed.createComponent(TabsPage);
    await fixture.whenStable();

    expect(SHELL_TABS.map((tab) => tab.id)).toEqual([
      'dashboard',
      'chat',
      'jobs',
      'runs',
      'settings',
    ]);
    const element = fixture.nativeElement as HTMLElement;
    const buttons = element.querySelectorAll<HTMLElement>('[data-testid^="tab-"]');
    expect(buttons).toHaveLength(5);
    expect(buttons[0]?.getAttribute('data-testid')).toBe('tab-dashboard');
  });
});
