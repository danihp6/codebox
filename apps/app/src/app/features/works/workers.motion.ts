export const BLINK_PHASES = 4;
export const BLINK_STAGGER_MS = 1000;

/** `index` modulo four, always in `0 | 1 | 2 | 3`, for any integer. */
export function blinkPhase(index: number): number {
  return ((index % BLINK_PHASES) + BLINK_PHASES) % BLINK_PHASES;
}

/**
 * Assigns a phase to every card in board order: the road in, then ORQ, ARC, DEV and QA in
 * drawing order, then the belt out. The first card gets phase 0, the fourth phase 3, the fifth
 * phase 0 again. The map is keyed by `workId`.
 */
export function assignBlinkPhases(
  cards: readonly { readonly workId: string }[],
): ReadonlyMap<string, number> {
  const phases = new Map<string, number>();
  cards.forEach((card, index) => {
    phases.set(card.workId, blinkPhase(index));
  });
  return phases;
}
