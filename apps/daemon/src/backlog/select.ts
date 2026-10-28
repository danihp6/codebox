import type { BacklogWorkState } from '@codebox/backlog';
import type { Store } from '@codebox/store';

export const WORK_PAGE = 500;

/**
 * The selection feed of docs/jobs.md §16: the repository's works, paged until exhausted, as much
 * of each row as `selectNextItem` reads. The package owns the rule; this only carries the rows.
 */
export function workStates(store: Store, repoId: string): BacklogWorkState[] {
  const states: BacklogWorkState[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = store.works.list({ repoId, limit: WORK_PAGE, cursor });
    for (const work of page.data) {
      states.push({ ref: work.backlogRef, state: work.state, attempts: work.attempts });
    }
    if (page.nextCursor === null) return states;
    cursor = page.nextCursor;
  }
}
