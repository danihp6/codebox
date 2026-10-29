import { describe, expect, it } from 'vitest';
import {
  DESIGN_RULES,
  designPreviewSchema,
  designRuleSchema,
  parseDesignPreview,
} from './design.js';
import type { DesignPreview } from './design.js';
import { ContractParseError } from './parse.js';

const PREVIEW: DesignPreview = {
  repoId: 'repo_01JABCDEFGHJKMNPQRSV',
  revision: '9f1c2ab',
  present: true,
  tokens: [
    { name: 'color.brand.bright', type: 'color', value: '#22c55e' },
    { name: 'space.gap', type: 'dimension', value: '8' },
  ],
  routes: [{ path: '/repos/:id', screen: 'Repo · backlog', component: 'RepoBacklogPage' }],
  screens: [
    {
      screen: 'Repo · backlog',
      route: '/repos/:id',
      states: {
        loading: 'Rows grey until the file parses',
        empty: 'Empty file, one chat button',
        error: 'Envelope over the list',
      },
      snapshotSha256: null,
    },
  ],
  findings: [
    {
      file: 'design/screens/repo-backlog.json',
      line: 1,
      rule: 'screen_state_missing',
      message: 'screen Repo · backlog has no empty state',
    },
  ],
  checkedAt: '2026-10-29T10:00:00Z',
};

function refused(mutate: (input: Record<string, unknown>) => void): boolean {
  const input = structuredClone(PREVIEW) as unknown as Record<string, unknown>;
  mutate(input);
  return designPreviewSchema.safeParse(input).success === false;
}

describe('design preview contract', () => {
  it('parses the complete fixture and round-trips', () => {
    expect(parseDesignPreview(PREVIEW)).toEqual(PREVIEW);
    expect(designPreviewSchema.parse(PREVIEW)).toEqual(PREVIEW);
    expect(DESIGN_RULES).toEqual([
      'colour_outside_tokens',
      'route_without_component',
      'screen_state_missing',
      'snapshot_hash_mismatch',
    ]);
    expect(designRuleSchema.options).toEqual([...DESIGN_RULES]);
  });

  it('refuses a missing revision and a revision that is not 7-40 lowercase hex', () => {
    expect(refused((input) => delete input['revision'])).toBe(true);
    expect(refused((input) => (input['revision'] = '9f1c2'))).toBe(true);
    expect(refused((input) => (input['revision'] = '9F1C2AB'))).toBe(true);
    expect(refused((input) => (input['revision'] = 'z'.repeat(41)))).toBe(true);
    expect(refused((input) => (input['revision'] = 42))).toBe(true);
  });

  it('refuses an unknown rule and a non-positive line', () => {
    expect(
      refused((input) => {
        const findings = input['findings'] as Record<string, unknown>[];
        findings[0]!['rule'] = 'colour_inside_tokens';
      }),
    ).toBe(true);
    expect(
      refused((input) => {
        const findings = input['findings'] as Record<string, unknown>[];
        findings[0]!['line'] = 0;
      }),
    ).toBe(true);
  });

  it('refuses a snapshotSha256 that is not 64 lowercase hex', () => {
    expect(
      refused((input) => {
        const screens = input['screens'] as Record<string, unknown>[];
        screens[0]!['snapshotSha256'] = 'AB'.repeat(32);
      }),
    ).toBe(true);
    expect(
      refused((input) => {
        const screens = input['screens'] as Record<string, unknown>[];
        screens[0]!['snapshotSha256'] = 'a'.repeat(63);
      }),
    ).toBe(true);
    expect(
      refused((input) => {
        const screens = input['screens'] as Record<string, unknown>[];
        screens[0]!['snapshotSha256'] = 'c'.repeat(64);
      }),
    ).toBe(false);
  });

  it('refuses an unknown key at every level', () => {
    expect(refused((input) => (input['extra'] = true))).toBe(true);
    expect(
      refused((input) => {
        const tokens = input['tokens'] as Record<string, unknown>[];
        tokens[0]!['resolved'] = true;
      }),
    ).toBe(true);
    expect(
      refused((input) => {
        const screens = input['screens'] as Record<string, unknown>[];
        const states = screens[0]!['states'] as Record<string, unknown>;
        states['idle'] = 'Nothing to do';
      }),
    ).toBe(true);
  });

  it('refuses a repoId without the repo_ prefix', () => {
    expect(refused((input) => (input['repoId'] = 'wrk_01JABCDEFGHJKMNPQRSV'))).toBe(true);
    expect(refused((input) => (input['repoId'] = '01JABCDEFGHJKMNPQRSV'))).toBe(true);
  });

  it('names the designPreview boundary with a ContractParseError', () => {
    let caught: unknown = null;
    try {
      parseDesignPreview({ ...PREVIEW, revision: 'nope' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContractParseError);
    expect(caught instanceof ContractParseError ? caught.boundary : null).toBe('designPreview');
    expect(caught instanceof ContractParseError ? caught.first.path : null).toBe(
      'designPreview.revision',
    );
  });
});
