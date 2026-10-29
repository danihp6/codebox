import { z } from 'zod';
import { snapshotHash } from './snapshot.js';
import type {
  DesignIssue,
  DesignRoute,
  DesignTokens,
  ScreenBox,
  ScreenLayout,
  ScreenLayoutMode,
  ScreenRegion,
  ScreenSpec,
  ScreenState,
  ScreenTypeRow,
} from './types.js';

export interface FigmaRegion {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The fill exactly as the file writes it (`#121821`, `rgba(…, 0.25)`), or null. */
  readonly fill: string | null;
  readonly radius: number;
  readonly stroke: number;
}

export interface FigmaTypeRow {
  readonly role: string;
  readonly family: string;
  readonly weight: number;
  readonly size: number;
  readonly lineHeight: number;
  readonly colour: string | null;
}

export interface FigmaFrameLayout {
  readonly box: ScreenBox;
  readonly layoutMode: ScreenLayoutMode;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly itemSpacing: number;
  readonly cornerRadius: number;
  readonly strokes: number;
  readonly inferred: boolean;
  readonly regions: readonly FigmaRegion[];
  readonly type: readonly FigmaTypeRow[];
}

export interface FigmaFrame {
  /** The Figma node id, e.g. `12:34`. Opaque to this package. */
  readonly id: string;
  /** The frame's name exactly as drawn; the map and this field are the join key. */
  readonly caption: string;
  readonly width: number;
  readonly height: number;
  /** The frame's distinct fills, as written in the file (`#0b0f14`, `rgba(…, 0.5)`). */
  readonly fills: readonly string[];
  /** Absent when the frame is not measurable (no direct child with a box). */
  readonly layout?: FigmaFrameLayout;
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
  /** When given, every projected layout colour is resolved to one of its keys. */
  readonly tokens?: DesignTokens;
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

/** First key in `Object.keys(tokens)` order wins when two tokens hold the same colour. */
function tokenKeysByValue(tokens: DesignTokens | undefined): ReadonlyMap<string, string> | null {
  if (tokens === undefined) return null;
  const byValue = new Map<string, string>();
  for (const key of Object.keys(tokens)) {
    const value = tokens[key]?.$value;
    if (value === undefined) continue;
    const normalised = String(value).trim().toLowerCase();
    if (!byValue.has(normalised)) byValue.set(normalised, key);
  }
  return byValue;
}

function tokenKeyOf(
  value: string | null,
  byValue: ReadonlyMap<string, string> | null,
): string | null {
  if (value === null || byValue === null) return null;
  return byValue.get(value.trim().toLowerCase()) ?? null;
}

function projectRegions(
  regions: readonly FigmaRegion[],
  byValue: ReadonlyMap<string, string> | null,
): readonly ScreenRegion[] {
  return regions.map((region) => ({
    name: region.name,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    fill: tokenKeyOf(region.fill, byValue),
    radius: region.radius,
    stroke: region.stroke,
  }));
}

function projectType(
  rows: readonly FigmaTypeRow[],
  byValue: ReadonlyMap<string, string> | null,
): readonly ScreenTypeRow[] {
  return rows.map((row) => ({
    role: row.role,
    family: row.family,
    weight: row.weight,
    size: row.size,
    lineHeight: row.lineHeight,
    colour: tokenKeyOf(row.colour, byValue),
  }));
}

function projectLayout(
  layout: FigmaFrameLayout,
  byValue: ReadonlyMap<string, string> | null,
): ScreenLayout {
  return {
    box: {
      x: layout.box.x,
      y: layout.box.y,
      width: layout.box.width,
      height: layout.box.height,
    },
    layoutMode: layout.layoutMode,
    paddingTop: layout.paddingTop,
    paddingRight: layout.paddingRight,
    paddingBottom: layout.paddingBottom,
    paddingLeft: layout.paddingLeft,
    itemSpacing: layout.itemSpacing,
    cornerRadius: layout.cornerRadius,
    strokes: layout.strokes,
    inferred: layout.inferred,
    regions: projectRegions(layout.regions, byValue),
    type: projectType(layout.type, byValue),
  };
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
  const byValue = tokenKeysByValue(input.tokens);

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
    const spec: ScreenSpec = {
      screen: entry.screen,
      route: entry.route,
      states: entry.states,
      snapshotSha256: entry.snapshot === true && bytes !== undefined ? snapshotSha256(bytes) : null,
    };
    screens.push(
      frame.layout === undefined ? spec : { ...spec, layout: projectLayout(frame.layout, byValue) },
    );

    for (const fill of frame.fills) colours.add(fill.trim().toLowerCase());
  });

  return { routes, screens, colours: [...colours].sort() };
}

/** sha256 of the bytes, named for the spec field it fills. */
export function snapshotSha256(bytes: Uint8Array): string {
  return snapshotHash(bytes);
}
