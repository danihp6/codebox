import {
  DesignDocumentError,
  ROUTES_PATH,
  TOKENS_PATH,
  checkDocuments,
  parseRoutes,
  parseScreenSpec,
  parseTokens,
} from '@codebox/design';
import type { DesignRoute, DesignTokens, ScreenSpec } from '@codebox/design';
import type {
  DesignFindingView,
  DesignPreview,
  DesignRouteView,
  DesignScreenView,
  DesignTokenView,
} from '@codebox/contracts';

export interface DesignSource {
  readonly tokens: string | null;
  readonly routes: string | null;
  readonly screens: readonly { readonly file: string; readonly text: string }[];
}

export interface DesignPreviewInput {
  readonly repoId: string;
  readonly revision: string;
  readonly checkedAt: string;
  readonly source: DesignSource;
}

/** A document that exists at the commit and does not parse. The route maps it to 422. */
export class DesignPreviewError extends Error {
  readonly file: string;

  constructor(file: string, message: string) {
    super(message);
    this.name = 'DesignPreviewError';
    this.file = file;
  }
}

function parseDocument<T>(file: string, text: string, parse: (input: unknown) => T): T {
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    throw new DesignPreviewError(file, 'document is not valid JSON');
  }
  try {
    return parse(input);
  } catch (error) {
    if (!(error instanceof DesignDocumentError)) throw error;
    throw new DesignPreviewError(file, error.issues[0]?.message ?? error.message);
  }
}

function tokenViews(tokens: DesignTokens): DesignTokenView[] {
  return Object.entries(tokens)
    .map(([name, token]) => ({ name, type: token.$type, value: String(token.$value) }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

function routeViews(routes: readonly DesignRoute[]): DesignRouteView[] {
  return routes
    .map((route) => ({ path: route.path, screen: route.screen, component: route.component }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function screenViews(screens: readonly ScreenSpec[]): DesignScreenView[] {
  return screens
    .map((spec) => ({
      screen: spec.screen,
      route: spec.route,
      states: {
        loading: spec.states.loading,
        empty: spec.states.empty,
        error: spec.states.error,
      },
      snapshotSha256: spec.snapshotSha256,
    }))
    .sort((left, right) => (left.screen < right.screen ? -1 : left.screen > right.screen ? 1 : 0));
}

function findingViews(
  tokens: DesignTokens,
  routes: readonly DesignRoute[],
  screens: readonly ScreenSpec[],
): DesignFindingView[] {
  return checkDocuments({ tokens, routes, screens }).map((finding) => ({
    file: finding.file,
    line: finding.line,
    rule: finding.rule,
    message: finding.message,
  }));
}

/**
 * `design/` is the repository's spec, never a canvas (D52). A repository without a token
 * document has no design to preview, which is exactly how the gate decides to skip it.
 */
export function buildDesignPreview(input: DesignPreviewInput): DesignPreview {
  const source = input.source;
  if (source.tokens === null) {
    return {
      repoId: input.repoId,
      revision: input.revision,
      present: false,
      tokens: [],
      routes: [],
      screens: [],
      findings: [],
      checkedAt: input.checkedAt,
    };
  }

  const tokens = parseDocument(TOKENS_PATH, source.tokens, parseTokens);
  const routes =
    source.routes === null ? [] : parseDocument(ROUTES_PATH, source.routes, parseRoutes);
  const specs = source.screens.map((screen) =>
    parseDocument(screen.file, screen.text, parseScreenSpec),
  );

  return {
    repoId: input.repoId,
    revision: input.revision,
    present: true,
    tokens: tokenViews(tokens),
    routes: routeViews(routes),
    screens: screenViews(specs),
    findings: findingViews(tokens, routes, specs),
    checkedAt: input.checkedAt,
  };
}
