import { z } from 'zod';
import { snapshotHash } from './snapshot.js';
import type { DesignIssue, DesignRoute, ScreenSpec, ScreenState } from './types.js';

export interface FigmaFrame {
  /** The Figma node id, e.g. `12:34`. Opaque to this package. */
  readonly id: string;
  /** The frame's name exactly as drawn; the map and this field are the join key. */
  readonly caption: string;
  readonly width: number;
  readonly height: number;
  /** The frame's distinct fills, as written in the file (`#0b0f14`, `rgba(…, 0.5)`). */
  readonly fills: readonly string[];
}

export interface FigmaFileSnapshot {
  readonly fileKey: string;
  readonly page: string;
  readonly frames: readonly FigmaFrame[];
}

export interface ImportMapFrame {
  readonly caption: string;
  readonly screen: string;
  readonly route: string;
  readonly component: string;
  readonly states: Readonly<Record<ScreenState, string | null>>;
  readonly snapshot: boolean;
}

export interface ImportMap {
  readonly fileKey: string;
  readonly page: string;
  readonly frames: readonly ImportMapFrame[];
}

export interface DesignImportInput {
  readonly snapshot: FigmaFileSnapshot;
  readonly map: ImportMap;
  /** PNG bytes keyed by the map's `caption`. Absent when the caller did not download one. */
  readonly exports?: Readonly<Record<string, Uint8Array>>;
}

export interface DesignImportResult {
  readonly routes: readonly DesignRoute[];
  readonly screens: readonly ScreenSpec[];
  /** Distinct, lowercased, trimmed and sorted fills across the mapped frames only. */
  readonly colours: readonly string[];
}

export type DesignImportErrorCode = 'frame_missing' | 'map_invalid';

export class DesignImportError extends Error {
  readonly code: DesignImportErrorCode;
  /** `frames.<index>.caption` for `frame_missing`; the first issue's path for `map_invalid`. */
  readonly path: string;
  /** The missing caption for `frame_missing`, otherwise null. */
  readonly caption: string | null;
  readonly issues: readonly DesignIssue[];

  constructor(
    code: DesignImportErrorCode,
    issues: readonly DesignIssue[],
    caption: string | null = null,
  ) {
    super(code === 'frame_missing' ? `frame_missing: ${caption ?? ''}` : 'invalid import map');
    this.name = 'DesignImportError';
    this.code = code;
    this.path = issues[0]?.path ?? '';
    this.caption = caption;
    this.issues = issues;
  }
}

// Textually identical to the private constant in `check.ts`: an import map can never emit a
// route that fails `route_without_component`.
const COMPONENT_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

const nonEmptySchema = z.string().refine((value) => value.trim() !== '', {
  message: 'must not be empty',
});

const stateSchema = z
  .string()
  .nullable()
  .refine((value) => value === null || value.trim() !== '', {
    message: 'must be null or a non-empty string',
  });

const importMapFrameSchema = z.strictObject({
  caption: nonEmptySchema,
  screen: nonEmptySchema,
  route: nonEmptySchema,
  component: nonEmptySchema.refine((value) => COMPONENT_PATTERN.test(value), {
    message: 'must match /^[A-Z][A-Za-z0-9]*$/',
  }),
  states: z.strictObject({
    loading: stateSchema,
    empty: stateSchema,
    error: stateSchema,
  }),
  snapshot: z.boolean(),
});

const importMapSchema = z
  .strictObject({
    fileKey: nonEmptySchema,
    page: nonEmptySchema,
    frames: z.array(importMapFrameSchema),
  })
  .superRefine((map, ctx) => {
    for (const field of ['caption', 'screen', 'route'] as const) {
      const seen = new Set<string>();
      map.frames.forEach((frame, index) => {
        if (seen.has(frame[field])) {
          ctx.addIssue({
            code: 'custom',
            path: ['frames', index, field],
            message: `${field} repeats an earlier entry`,
          });
        }
        seen.add(frame[field]);
      });
    }
  });

function issuesOf(error: z.ZodError): DesignIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: String(issue.message),
  }));
}

/** The committed map, parsed once at the edge. An empty `frames` list is a valid map. */
export function parseImportMap(input: unknown): ImportMap {
  const parsed = importMapSchema.safeParse(input);
  if (!parsed.success) throw new DesignImportError('map_invalid', issuesOf(parsed.error));
  return parsed.data;
}

/**
 * One projected page in, three artifact families out. The snapshot frames outside the map are
 * ignored rather than reported: only the caller knows whether it downloaded the whole page.
 */
export function importDesign(input: DesignImportInput): DesignImportResult {
  const byCaption = new Map<string, FigmaFrame>();
  for (const frame of input.snapshot.frames) {
    if (!byCaption.has(frame.caption)) byCaption.set(frame.caption, frame);
  }

  const routes: DesignRoute[] = [];
  const screens: ScreenSpec[] = [];
  const colours = new Set<string>();

  input.map.frames.forEach((entry, index) => {
    const frame = byCaption.get(entry.caption);
    if (frame === undefined) {
      const path = `frames.${index}.caption`;
      throw new DesignImportError(
        'frame_missing',
        [{ path, message: `no frame captioned ${entry.caption}` }],
        entry.caption,
      );
    }

    routes.push({ path: entry.route, screen: entry.screen, component: entry.component });

    const bytes = input.exports?.[entry.caption];
    screens.push({
      screen: entry.screen,
      route: entry.route,
      states: entry.states,
      snapshotSha256: entry.snapshot === true && bytes !== undefined ? snapshotSha256(bytes) : null,
    });

    for (const fill of frame.fills) colours.add(fill.trim().toLowerCase());
  });

  return { routes, screens, colours: [...colours].sort() };
}

/** sha256 of the bytes, named for the spec field it fills. */
export function snapshotSha256(bytes: Uint8Array): string {
  return snapshotHash(bytes);
}
