import type { BacklogItem, BacklogRef } from '@codebox/contracts';

export type RailEdgeKind = 'chain' | 'branch' | 'external';

export interface RailEdge {
  readonly from: BacklogRef;
  readonly to: BacklogRef;
  readonly kind: RailEdgeKind;
}

function kindOf(item: BacklogItem, to: BacklogRef, items: readonly BacklogItem[]): RailEdgeKind {
  if (!items.some((candidate) => candidate.ref === to)) return 'external';
  return item.needs.length > 1 ? 'branch' : 'chain';
}

/** One edge per `needs` entry, in row order and then need order; a root contributes none. */
export function railEdges(items: readonly BacklogItem[]): readonly RailEdge[] {
  return items.flatMap((item) =>
    item.needs.map((to) => ({ from: item.ref, to, kind: kindOf(item, to, items) })),
  );
}

/** Every need whose target is missing from `items` or is not checked, in need order. */
export function unmetNeeds(
  item: BacklogItem,
  items: readonly BacklogItem[],
): readonly BacklogRef[] {
  return item.needs.filter((need) => {
    const target = items.find((candidate) => candidate.ref === need);
    return target === undefined || !target.checked;
  });
}
