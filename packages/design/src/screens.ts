import { z } from 'zod';
import { DesignDocumentError, SCREEN_STATES } from './types.js';
import type { DesignIssue, ScreenSpec, ScreenState } from './types.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const statesSchema = z.strictObject({
  loading: z.string().nullable().optional(),
  empty: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

const screenSpecSchema = z.strictObject({
  screen: z.string(),
  route: z.string(),
  states: statesSchema.optional(),
  snapshotSha256: z.string().nullable().optional(),
});

function issueOf(error: z.ZodError): DesignIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || 'document',
    message: String(issue.message),
  }));
}

function stateOf(
  states: { readonly [K in ScreenState]?: string | null | undefined } | undefined,
  state: ScreenState,
): string | null {
  return states?.[state] ?? null;
}

/** A screen's spec: three captions it may declare or decline, and the hash of its export. */
export function parseScreenSpec(input: unknown): ScreenSpec {
  const parsed = screenSpecSchema.safeParse(input);
  if (!parsed.success) throw new DesignDocumentError('screen', issueOf(parsed.error));

  const issues: DesignIssue[] = [];
  if (parsed.data.screen.trim() === '') {
    issues.push({ path: 'screen', message: 'screen is empty' });
  }
  if (parsed.data.route.trim() === '') {
    issues.push({ path: 'route', message: 'route is empty' });
  }
  const declared = parsed.data.snapshotSha256 ?? null;
  if (declared !== null && !SHA256_PATTERN.test(declared)) {
    issues.push({ path: 'snapshotSha256', message: 'snapshotSha256 is not 64 lowercase hex' });
  }
  if (issues.length > 0) throw new DesignDocumentError('screen', issues);

  const states = Object.fromEntries(
    SCREEN_STATES.map((state) => [state, stateOf(parsed.data.states, state)]),
  ) as Record<ScreenState, string | null>;

  return {
    screen: parsed.data.screen,
    route: parsed.data.route,
    states,
    snapshotSha256: declared,
  };
}
