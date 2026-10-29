import { z } from 'zod';
import { DesignDocumentError, SCREEN_STATES } from './types.js';
import type { DesignIssue, DesignTokens, ScreenLayout, ScreenSpec, ScreenState } from './types.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TOKEN_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

const statesSchema = z.strictObject({
  loading: z.string().nullable().optional(),
  empty: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

const finiteNumber = z.number().refine(Number.isFinite, { message: 'must be a finite number' });

const nonNegativeNumber = finiteNumber.refine((value) => value >= 0, {
  message: 'must be zero or greater',
});

const tokenKeySchema = z
  .string()
  .regex(TOKEN_KEY_PATTERN, { message: 'must be a dotted lowercase token key' });

const boxSchema = z.strictObject({
  x: finiteNumber,
  y: finiteNumber,
  width: nonNegativeNumber,
  height: nonNegativeNumber,
});

const regionSchema = z.strictObject({
  name: z.string(),
  x: finiteNumber,
  y: finiteNumber,
  width: nonNegativeNumber,
  height: nonNegativeNumber,
  fill: tokenKeySchema.nullable(),
  radius: nonNegativeNumber,
  stroke: nonNegativeNumber,
});

const nonEmptySchema = z.string().refine((value) => value.trim() !== '', {
  message: 'must not be empty',
});

const typeRowSchema = z.strictObject({
  role: nonEmptySchema,
  family: nonEmptySchema,
  weight: nonNegativeNumber,
  size: nonNegativeNumber,
  lineHeight: nonNegativeNumber,
  colour: tokenKeySchema.nullable(),
});

const layoutSchema = z.strictObject({
  box: boxSchema,
  layoutMode: z.enum(['none', 'horizontal', 'vertical']),
  paddingTop: nonNegativeNumber,
  paddingRight: nonNegativeNumber,
  paddingBottom: nonNegativeNumber,
  paddingLeft: nonNegativeNumber,
  itemSpacing: nonNegativeNumber,
  cornerRadius: nonNegativeNumber,
  strokes: nonNegativeNumber,
  inferred: z.boolean(),
  regions: z.array(regionSchema),
  type: z.array(typeRowSchema),
});

const screenSpecSchema = z.strictObject({
  screen: z.string(),
  route: z.string(),
  states: statesSchema.optional(),
  snapshotSha256: z.string().nullable().optional(),
  layout: layoutSchema.optional(),
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

function tokenIssues(layout: ScreenLayout, tokens: DesignTokens): DesignIssue[] {
  const issues: DesignIssue[] = [];
  layout.regions.forEach((region, index) => {
    if (region.fill === null) return;
    if (Object.hasOwn(tokens, region.fill)) return;
    issues.push({
      path: `layout.regions.${index}.fill`,
      message: `unknown token key ${region.fill}`,
    });
  });
  layout.type.forEach((row, index) => {
    if (row.colour === null) return;
    if (Object.hasOwn(tokens, row.colour)) return;
    issues.push({
      path: `layout.type.${index}.colour`,
      message: `unknown token key ${row.colour}`,
    });
  });
  return issues;
}

/**
 * A screen's spec: three captions it may declare or decline, the hash of its export and, when
 * the frame is measurable, the layout the import projected. `tokens` turns a token key from a
 * shape into a membership test.
 */
export function parseScreenSpec(input: unknown, tokens?: DesignTokens): ScreenSpec {
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

  const layout = parsed.data.layout;
  if (layout !== undefined && tokens !== undefined) {
    const unknown = tokenIssues(layout, tokens);
    if (unknown.length > 0) throw new DesignDocumentError('screen', unknown);
  }

  const spec: ScreenSpec = {
    screen: parsed.data.screen,
    route: parsed.data.route,
    states,
    snapshotSha256: declared,
  };
  return layout === undefined ? spec : { ...spec, layout };
}
