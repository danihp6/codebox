export type DesignRuleEnforcement = 'enforced' | 'report-only';

/** Exactly one rule is report-only until L5 draws the missing frames (D57). */
export const REPORT_ONLY_DESIGN_RULES: readonly string[] = Object.freeze(['screen_state_missing']);

/**
 * A rule this build does not know fails closed: a new rule name in `@codebox/design` turns the
 * run red before anyone has decided it is safe to report only.
 */
export function designRuleEnforcement(rule: string): DesignRuleEnforcement {
  return REPORT_ONLY_DESIGN_RULES.includes(rule) ? 'report-only' : 'enforced';
}

export interface ClassifiedDesignFindings<T> {
  readonly enforced: readonly T[];
  readonly reportOnly: readonly T[];
}

export function classifyDesignFindings<T extends { readonly rule: string }>(
  findings: readonly T[],
): ClassifiedDesignFindings<T> {
  const enforced: T[] = [];
  const reportOnly: T[] = [];
  for (const finding of findings) {
    if (designRuleEnforcement(finding.rule) === 'report-only') reportOnly.push(finding);
    else enforced.push(finding);
  }
  return { enforced, reportOnly };
}
