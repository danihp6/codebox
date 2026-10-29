import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDocuments, checkPatch, parseRoutes, parseScreenSpec, parseTokens } from './index.js';
import type { DesignDocuments, DesignRoute, ScreenSpec, ScreenState } from './index.js';

const ROOT = new URL('./fixtures/', import.meta.url);

function fixtureJson(relative: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, ROOT)), 'utf8')) as unknown;
}

function fixtureText(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, ROOT)), 'utf8');
}

function documents(
  routes: readonly DesignRoute[] = [],
  screens: readonly ScreenSpec[] = [],
): DesignDocuments {
  return { tokens: parseTokens(fixtureJson('tokens.json')), routes, screens };
}

function spec(states: Partial<Record<ScreenState, string | null>>): ScreenSpec {
  return parseScreenSpec({
    screen: 'Repo · backlog',
    route: '/repos/:id',
    states,
  });
}

const COMPLETE = (): DesignDocuments =>
  documents(
    parseRoutes(fixtureJson('routes.json')),
    ['dashboard', 'repo-backlog'].map((name) =>
      parseScreenSpec(fixtureJson(`screens/${name}.json`)),
    ),
  );

describe('checkDocuments', () => {
  it('passes the fixtures: every route has a component, a spec and three states', () => {
    expect(checkDocuments(COMPLETE())).toEqual([]);
  });

  it('fails a route without component', () => {
    const findings = checkDocuments(
      documents([
        { path: '/works/:id', screen: 'Work · run log', component: '' },
        { path: '/dashboard', screen: 'Dashboard', component: 'Component' },
        { path: '/repos/:id', screen: 'Repo · backlog', component: '9Page' },
        { path: '/about', screen: 'About', component: 'aboutPage' },
      ]),
    );

    const component = findings.filter((finding) => finding.rule === 'route_without_component');
    expect(component.map((finding) => finding.message)).toEqual([
      'route /works/:id has no component',
      'route /repos/:id has no component',
      'route /about has no component',
    ]);
    expect(findings[0]).toEqual({
      file: 'design/routes.json',
      line: 1,
      rule: 'route_without_component',
      message: 'route /works/:id has no component',
    });
  });

  it('fails a screen state that is missing, naming the spec file and the state', () => {
    const findings = checkDocuments(
      documents([], [spec({ loading: 'Rows grey', empty: 'Empty file', error: null })]),
    );

    expect(findings).toEqual([
      {
        file: 'design/screens/repo-backlog.json',
        line: 1,
        rule: 'screen_state_missing',
        message: 'screen Repo · backlog has no error state',
      },
    ]);
  });

  it('fails a route whose screen has no spec at all', () => {
    const findings = checkDocuments(
      documents([{ path: '/about', screen: 'About', component: 'AboutPage' }], []),
    );

    expect(findings).toEqual([
      {
        file: 'design/routes.json',
        line: 1,
        rule: 'screen_state_missing',
        message: 'route /about has no spec',
      },
    ]);
  });

  it('fails a caption that writes a colour outside the tokens', () => {
    const findings = checkDocuments(
      documents(
        [],
        [spec({ loading: 'Rows grey', empty: 'Empty file', error: 'Badge in #ff00ff' })],
      ),
    );

    expect(findings).toEqual([
      {
        file: 'design/screens/repo-backlog.json',
        line: 1,
        rule: 'colour_outside_tokens',
        message: 'snapshot declares a colour outside the tokens',
      },
    ]);
  });

  it('accepts a caption that names a token value, in any case', () => {
    const findings = checkDocuments(
      documents(
        [],
        [spec({ loading: 'Rows grey', empty: 'Empty file', error: 'Badge in #15803D' })],
      ),
    );

    expect(findings).toEqual([]);
  });

  it('sorts by file and then line, whatever the rule order', () => {
    const findings = checkDocuments(
      documents(
        [],
        [
          spec({ loading: 'x', empty: 'y', error: null }),
          parseScreenSpec({
            screen: 'Dashboard',
            route: '/dashboard',
            states: { loading: 'x', empty: null, error: 'z' },
          }),
        ],
      ),
    );

    expect(findings.map((finding) => `${finding.file}:${finding.line}`)).toEqual([
      'design/screens/dashboard.json:1',
      'design/screens/repo-backlog.json:1',
    ]);
  });
});

describe('checkPatch', () => {
  it('fails a colour written outside the tokens, with its file and new line', () => {
    const findings = checkPatch({
      patch: fixtureText('patch/colour-outside.patch'),
      tokenValues: ['#15803d', '#22c55e'],
    });

    expect(findings).toEqual([
      {
        file: 'apps/app/src/theme/extra.css',
        line: 3,
        rule: 'colour_outside_tokens',
        message: 'colour #ff00ff is not a token',
      },
    ]);
  });

  it('accepts a token literal, an allowed line and the token document itself', () => {
    expect(
      checkPatch({
        patch: fixtureText('patch/clean.patch'),
        tokenValues: ['#15803d', '#22c55e'],
      }),
    ).toEqual([]);
  });

  it('tracks the new-file line across context and several hunks', () => {
    const patch = [
      'diff --git a/apps/app/src/a.css b/apps/app/src/a.css',
      '--- a/apps/app/src/a.css',
      '+++ b/apps/app/src/a.css',
      '@@ -10,2 +10,3 @@',
      ' .a {',
      '   margin: 0;',
      '+  color: rgb(255, 0, 255);',
      '@@ -20,0 +22,1 @@',
      '+  background: #ff00ff;',
      '',
    ].join('\n');

    expect(checkPatch({ patch, tokenValues: [] })).toEqual([
      {
        file: 'apps/app/src/a.css',
        line: 12,
        rule: 'colour_outside_tokens',
        message: 'colour rgb(255, 0, 255) is not a token',
      },
      {
        file: 'apps/app/src/a.css',
        line: 22,
        rule: 'colour_outside_tokens',
        message: 'colour #ff00ff is not a token',
      },
    ]);
  });

  it('ignores removed lines, files with no diff header and non-colour additions', () => {
    const patch = [
      '-  color: #ff00ff;',
      'diff --git a/apps/app/src/b.css b/apps/app/src/b.css',
      '--- a/apps/app/src/b.css',
      '+++ b/apps/app/src/b.css',
      '@@ -1,0 +2,2 @@',
      '-  color: #ff00ff;',
      '+  color: hsl(0, 0%, 0%);',
      '+  padding: 8px;',
      '',
    ].join('\n');

    const findings = checkPatch({ patch, tokenValues: [] });

    expect(findings).toEqual([
      {
        file: 'apps/app/src/b.css',
        line: 2,
        rule: 'colour_outside_tokens',
        message: 'colour hsl(0, 0%, 0%) is not a token',
      },
    ]);
  });

  it('matches a token value case-insensitively', () => {
    const patch = [
      'diff --git a/apps/app/src/c.css b/apps/app/src/c.css',
      '--- a/apps/app/src/c.css',
      '+++ b/apps/app/src/c.css',
      '@@ -1,0 +1,1 @@',
      '+  color: #FF00FF;',
      '',
    ].join('\n');

    expect(checkPatch({ patch, tokenValues: ['#ff00ff'] })).toEqual([]);
  });
});
