export const DESIGN_DIR = 'design';
export const TOKENS_PATH = 'design/tokens.json';
export const ROUTES_PATH = 'design/routes.json';
export const SCREENS_DIR = 'design/screens';
export const EXPORTS_DIR = 'design/exports';

/** The three states every screen must declare. `loading` and `empty` are docs/app.md §5/§12;
 *  `error` is the typed envelope. A screen with no state of one kind declares it as null. */
export const SCREEN_STATES = ['loading', 'empty', 'error'] as const;

export type ScreenState = (typeof SCREEN_STATES)[number];

export type DesignRule =
  | 'colour_outside_tokens'
  | 'route_without_component'
  | 'screen_state_missing'
  | 'snapshot_hash_mismatch';

export interface DesignFinding {
  /** Repo-relative, forward slashes. */
  readonly file: string;
  /** 1-based. A document-level finding reports line 1; a patch finding reports the new-file line. */
  readonly line: number;
  readonly rule: DesignRule;
  readonly message: string;
}

export interface DesignIssue {
  readonly path: string;
  readonly message: string;
}

export type DesignBoundary = 'tokens' | 'routes' | 'screen';

export class DesignDocumentError extends Error {
  readonly boundary: DesignBoundary;
  readonly issues: readonly DesignIssue[];

  constructor(boundary: DesignBoundary, issues: readonly DesignIssue[]) {
    super(`invalid design ${boundary} document`);
    this.name = 'DesignDocumentError';
    this.boundary = boundary;
    this.issues = issues;
  }
}

export interface DesignToken {
  readonly $value: string | number;
  readonly $type: string;
  readonly $description?: string;
}

/** Flat map, keyed by dot path (`color.brand.green`), aliases already resolved. */
export type DesignTokens = Readonly<Record<string, DesignToken>>;

export interface DesignRoute {
  readonly path: string;
  readonly screen: string;
  readonly component: string;
}

export interface ScreenSpec {
  readonly screen: string;
  readonly route: string;
  readonly states: Readonly<Record<ScreenState, string | null>>;
  readonly snapshotSha256: string | null;
}

export interface DesignDocuments {
  readonly tokens: DesignTokens;
  readonly routes: readonly DesignRoute[];
  readonly screens: readonly ScreenSpec[];
}
