import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import { RepoId, commitShaSchema, timestampSchema } from './primitives.js';

/** The four rules of `docs/jobs.md` §5, by name, exactly as `@codebox/design` spells them. */
export const DESIGN_RULES = [
  'colour_outside_tokens',
  'route_without_component',
  'screen_state_missing',
  'snapshot_hash_mismatch',
] as const;
export const designRuleSchema = z.enum(DESIGN_RULES);
export type DesignRule = z.infer<typeof designRuleSchema>;

export const designTokenViewSchema = z.strictObject({
  name: z.string().min(1),
  type: z.string().min(1),
  value: z.string(),
});
export type DesignTokenView = z.infer<typeof designTokenViewSchema>;

export const designRouteViewSchema = z.strictObject({
  path: z.string().min(1),
  screen: z.string().min(1),
  component: z.string(),
});
export type DesignRouteView = z.infer<typeof designRouteViewSchema>;

export const designStatesSchema = z.strictObject({
  loading: z.string().nullable(),
  empty: z.string().nullable(),
  error: z.string().nullable(),
});
export type DesignStates = z.infer<typeof designStatesSchema>;

export const designScreenViewSchema = z.strictObject({
  screen: z.string().min(1),
  route: z.string().min(1),
  states: designStatesSchema,
  snapshotSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
});
export type DesignScreenView = z.infer<typeof designScreenViewSchema>;

export const designFindingViewSchema = z.strictObject({
  file: z.string().min(1),
  line: z.number().int().positive(),
  rule: designRuleSchema,
  message: z.string().min(1),
});
export type DesignFindingView = z.infer<typeof designFindingViewSchema>;

export const designPreviewSchema = z.strictObject({
  repoId: RepoId,
  revision: commitShaSchema,
  present: z.boolean(),
  tokens: z.array(designTokenViewSchema),
  routes: z.array(designRouteViewSchema),
  screens: z.array(designScreenViewSchema),
  findings: z.array(designFindingViewSchema),
  checkedAt: timestampSchema,
});
export type DesignPreview = z.infer<typeof designPreviewSchema>;

export function parseDesignPreview(input: unknown): DesignPreview {
  return parseOrThrow(designPreviewSchema, input, 'designPreview');
}
