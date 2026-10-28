import type {
  BacklogEntry,
  BacklogWorkState,
  RefusedItem,
  SelectionPolicy,
  SelectionRefusal,
  SelectionResult,
} from './types.js';

function refusalFor(
  item: BacklogEntry,
  works: readonly BacklogWorkState[],
  counts: ReadonlyMap<string, number>,
  policy: SelectionPolicy,
): SelectionRefusal | null {
  if ((counts.get(item.ref) ?? 0) > 1) {
    return 'ambiguous_ref';
  }
  if (item.state === 'blocked') {
    return 'blocked';
  }
  const own = works.filter((work) => work.ref === item.ref);
  if (own.some((work) => work.state === 'needs_decision')) {
    return 'needs_decision';
  }
  if (own.some((work) => work.state === 'queued' || work.state === 'running')) {
    return 'live_work';
  }
  const highest = own.reduce((max, work) => Math.max(max, work.attempts), 0);
  if (highest >= policy.maxAttempts) {
    return 'attempts_exhausted';
  }
  return null;
}

export function selectNextItem(
  items: readonly BacklogEntry[],
  works: readonly BacklogWorkState[],
  policy: SelectionPolicy,
): SelectionResult {
  const wanted = new Set<string>(policy.refs);
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.ref, (counts.get(item.ref) ?? 0) + 1);
  }
  const candidates = items.filter(
    (item) =>
      (item.state === 'open' || item.state === 'blocked') &&
      (policy.selection === 'nextPending' || wanted.has(item.ref)),
  );
  if (candidates.length === 0) {
    return { kind: 'nothing_pending' };
  }
  const refused: RefusedItem[] = [];
  for (const item of candidates) {
    const reason = refusalFor(item, works, counts, policy);
    if (reason === null) {
      return { kind: 'selected', item };
    }
    refused.push({ ref: item.ref, line: item.line, reason });
  }
  return { kind: 'nothing_runnable', refused };
}
