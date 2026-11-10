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
  it('enforces the four design rules', () => {
    expect(designRuleEnforcement('screen_state_missing')).toBe('enforced');
    expect(designRuleEnforcement('colour_outside_tokens')).toBe('enforced');
    expect(designRuleEnforcement('route_without_component')).toBe('enforced');
    expect(designRuleEnforcement('snapshot_hash_mismatch')).toBe('enforced');
  });

  it('enforces an empty rule name and a rule this build does not know', () => {
    expect(designRuleEnforcement('')).toBe('enforced');
    expect(designRuleEnforcement('something_new')).toBe('enforced');
  });

  it('pins an empty frozen report-only list', () => {
    expect(REPORT_ONLY_DESIGN_RULES).toEqual([]);
    expect(Object.isFrozen(REPORT_ONLY_DESIGN_RULES)).toBe(true);
  });
});

describe('classifyDesignFindings', () => {
  it('keeps every finding of a mixed list on the enforced side in the input order', () => {
    const findings: readonly Finding[] = [
      { rule: 'colour_outside_tokens', file: 'a' },
      { rule: 'screen_state_missing', file: 'b' },
      { rule: 'something_new', file: 'c' },
      { rule: 'route_without_component', file: 'd' },
      { rule: 'snapshot_hash_mismatch', file: 'e' },
    ];

    const classified = classifyDesignFindings(findings);

    expect(classified.enforced).toEqual([
      { rule: 'colour_outside_tokens', file: 'a' },
      { rule: 'screen_state_missing', file: 'b' },
      { rule: 'something_new', file: 'c' },
      { rule: 'route_without_component', file: 'd' },
      { rule: 'snapshot_hash_mismatch', file: 'e' },
    ]);
    expect(classified.enforced[0]).toBe(findings[0]);
    expect(classified.reportOnly).toEqual([]);
  });

  it('returns two empty halves for an empty list and does not mutate the input', () => {
    const findings: readonly Finding[] = [{ rule: 'screen_state_missing', file: 'a' }];

    expect(classifyDesignFindings<Finding>([])).toEqual({ enforced: [], reportOnly: [] });
    const classified = classifyDesignFindings(findings);
    expect(classified.enforced).toHaveLength(1);
    expect(findings).toHaveLength(1);
    expect(classified.enforced[0]).toBe(findings[0]);
  });
});
