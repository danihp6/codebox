import type { BacklogRef, Selection, WorkState } from '@codebox/contracts';

/** The four checkbox marks `TODO.md` uses: `[ ]`, `[~]`, `[!]`, `[x]`. */
export type BacklogEntryState = 'open' | 'doing' | 'blocked' | 'done';

export interface BacklogEntry {
  /** The item key, `Task-<digits>`, the same grammar as `backlogRefSchema`. */
  readonly ref: BacklogRef;
  /** The text after `**[Task-NN]**` on the item line, trimmed; falls back to the ref. */
  readonly title: string;
  /** `title` followed by the item's continuation lines, trimmed, joined with `"\n"`. */
  readonly body: string;
  readonly state: BacklogEntryState;
  /** `state === 'done'`. Convenience for `backlogItemSchema.checked`. */
  readonly checked: boolean;
  /** 1-based line number of the item line in the markdown that produced it. */
  readonly line: number;
  /** The nearest preceding `## ` heading, trimmed; `''` before the first one. */
  readonly section: string;
}

export interface BacklogSection {
  readonly title: string;
  readonly items: readonly BacklogEntry[];
}

export interface ParsedBacklog {
  /** Every `## ` heading in document order, including ones with no items. */
  readonly sections: readonly BacklogSection[];
  /** Every item line in file order, flat. This is the order the selection walks. */
  readonly items: readonly BacklogEntry[];
  /** Refs that appear on more than one item line, first-appearance order, no repeats. */
  readonly duplicateRefs: readonly BacklogRef[];
}

export type TickOutcome =
  | { readonly kind: 'ticked'; readonly markdown: string; readonly line: number }
  | { readonly kind: 'already_done'; readonly markdown: string; readonly line: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous'; readonly lines: readonly number[] };

/** One row of the `works` table, as much of it as the selection needs. */
export interface BacklogWorkState {
  readonly ref: BacklogRef;
  readonly state: WorkState;
  readonly attempts: number;
}

export interface SelectionPolicy {
  /** `nextPending` takes any eligible item; `refs` restricts to `refs` and still walks file order. */
  readonly selection: Selection;
  readonly refs: readonly BacklogRef[];
  /** The schedule's `maxAttempts`, D56. */
  readonly maxAttempts: number;
}

export type SelectionRefusal =
  'blocked' | 'needs_decision' | 'live_work' | 'attempts_exhausted' | 'ambiguous_ref';

export interface RefusedItem {
  readonly ref: BacklogRef;
  readonly line: number;
  readonly reason: SelectionRefusal;
}

export type SelectionResult =
  | { readonly kind: 'selected'; readonly item: BacklogEntry }
  | { readonly kind: 'nothing_pending' }
  | { readonly kind: 'nothing_runnable'; readonly refused: readonly RefusedItem[] };
