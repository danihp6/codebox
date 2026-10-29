import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { REPO_TABS, RepoTabs } from './repo-tabs';
import { STRINGS, translate } from './repo-chrome.i18n';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';

const i18nStub = { locale: () => 'en' as const };

function mount(): HTMLElement {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: I18nService, useValue: i18nStub }],
  });
  const fixture = TestBed.createComponent(RepoTabs);
  fixture.componentRef.setInput('repoId', REPO_ID);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('REPO_TABS', () => {
  it('declares exactly the four tabs of a repository, in order', () => {
    expect(REPO_TABS.map((tab) => tab.id)).toEqual(['backlog', 'workers', 'schedule', 'design']);
    expect(Object.isFrozen(REPO_TABS)).toBe(true);
    expect(REPO_TABS.map((tab) => tab.labelKey)).toEqual([
      'repoTabs.backlog',
      'repoTabs.workers',
      'repoTabs.schedule',
      'repoTabs.design',
    ]);
  });

  it('builds each link from the repository id and the tab path', () => {
    expect(REPO_TABS.map((tab) => tab.link(REPO_ID))).toEqual([
      ['/repos', REPO_ID],
      ['/repos', REPO_ID, 'workers'],
      ['/repos', REPO_ID, 'schedule'],
      ['/repos', REPO_ID, 'design'],
    ]);
  });
});

describe('RepoTabs', () => {
  it('renders one link per tab with its hook, href and label', () => {
    const element = mount();

    expect(element.querySelectorAll('[data-testid^="repo-tab-"]')).toHaveLength(4);
    for (const tab of REPO_TABS) {
      const link = element.querySelector<HTMLAnchorElement>(`[data-testid="repo-tab-${tab.id}"]`);
      expect(link, `tab ${tab.id} is missing`).not.toBeNull();
      expect(link?.textContent?.trim()).toBe(translate('en', tab.labelKey));
      expect(link?.getAttribute('href')).toBe(
        `/repos/${REPO_ID}${tab.id === 'backlog' ? '' : `/${tab.id}`}`,
      );
    }
  });

  it('ships every tab label in both locales, in the same order', () => {
    expect(Object.keys(STRINGS.es)).toEqual(Object.keys(STRINGS.en));
    for (const locale of ['en', 'es'] as const) {
      for (const tab of REPO_TABS) {
        expect(translate(locale, tab.labelKey), `${locale} ${tab.labelKey}`).not.toBe(tab.labelKey);
      }
    }
  });
});
