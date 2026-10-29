import { describe, expect, it } from 'vitest';
import {
  REPORT_ONLY_DESIGN_RULES,
  classifyDesignFindings,
  designRuleEnforcement,
} from './design-gate.js';

interface Finding {
  readonly rule: string;
  readonly file: string;
}

describe('design rule enforcement', () => {
  it('reports a missing screen state and enforces the other three rules', () => {
    expect(designRuleEnforcement('screen_state_missing')).toBe('report-only');
    expect(designRuleEnforcement('colour_outside_tokens')).toBe('enforced');
    expect(designRuleEnforcement('route_without_component')).toBe('enforced');
    expect(designRuleEnforcement('snapshot_hash_mismatch')).toBe('enforced');
  });

  it('enforces an empty rule name and a rule this build does not know', () => {
    expect(designRuleEnforcement('')).toBe('enforced');
    expect(designRuleEnforcement('something_new')).toBe('enforced');
  });

  it('pins one frozen report-only rule', () => {
    expect(REPORT_ONLY_DESIGN_RULES).toEqual(['screen_state_missing']);
    expect(Object.isFrozen(REPORT_ONLY_DESIGN_RULES)).toBe(true);
  });
});

describe('classifyDesignFindings', () => {
  it('partitions a mixed list and keeps the input order inside each half', () => {
    const findings: readonly Finding[] = [
      { rule: 'colour_outside_tokens', file: 'a' },
      { rule: 'screen_state_missing', file: 'b' },
      { rule: 'something_new', file: 'c' },
      { rule: 'screen_state_missing', file: 'd' },
    ];

    const classified = classifyDesignFindings(findings);

    expect(classified.enforced).toEqual([
      { rule: 'colour_outside_tokens', file: 'a' },
      { rule: 'something_new', file: 'c' },
    ]);
    expect(classified.reportOnly).toEqual([
      { rule: 'screen_state_missing', file: 'b' },
      { rule: 'screen_state_missing', file: 'd' },
    ]);
  });

  it('returns two empty halves for an empty list and does not mutate the input', () => {
    const findings: readonly Finding[] = [{ rule: 'screen_state_missing', file: 'a' }];

    expect(classifyDesignFindings<Finding>([])).toEqual({ enforced: [], reportOnly: [] });
    const classified = classifyDesignFindings(findings);
    expect(classified.reportOnly).toHaveLength(1);
    expect(findings).toHaveLength(1);
    expect(classified.reportOnly[0]).toBe(findings[0]);
  });
});
