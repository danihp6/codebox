import { ROUTES_PATH, SCREENS_DIR, SCREEN_STATES, TOKENS_PATH } from './types.js';
import type { DesignDocuments, DesignFinding, DesignRoute, ScreenSpec } from './types.js';
import { tokenValues } from './tokens.js';

export interface DesignPatchInput {
  /** The `git diff` text. */
  readonly patch: string;
  /** The values `tokenValues()` returned for `design/tokens.json`. */
  readonly tokenValues: readonly string[];
}

const COMPONENT_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

const ALLOW_MARKER = 'codebox-design: allow';

const COLOUR_SOURCES: readonly string[] = [
  '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\\b',
  '\\b(?:rgb|rgba|hsl|hsla)\\([^)\\n]*\\)',
];

const DIFF_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const DEV_NULL = '/dev/null';
const B_PREFIX = 'b/';

/** `Repo · backlog` → `repo-backlog`, the export and the spec file share one slug (§4). */
function screenSlug(screen: string): string {
  return screen
    .replace(/\s*·\s*/g, '-')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function screenFile(screen: string): string {
  return `${SCREENS_DIR}/${screenSlug(screen)}.json`;
}

function findColours(text: string): readonly string[] {
  const found: string[] = [];
  for (const source of COLOUR_SOURCES) {
    for (const match of text.matchAll(new RegExp(source, 'gi'))) found.push(match[0]);
  }
  return found;
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

function sortFindings(findings: readonly DesignFinding[]): readonly DesignFinding[] {
  return [...findings].sort((left, right) => {
    if (left.file !== right.file) return left.file < right.file ? -1 : 1;
    return left.line - right.line;
  });
}

function stripDiffPrefix(target: string): string {
  return target.startsWith(B_PREFIX) ? target.slice(B_PREFIX.length) : target;
}

function captionColours(spec: ScreenSpec): readonly string[] {
  const found = new Set<string>();
  for (const state of SCREEN_STATES) {
    const caption = spec.states[state];
    if (caption === null) continue;
    for (const colour of findColours(caption)) found.add(normalise(colour));
  }
  return [...found];
}

function routeComponentFinding(route: DesignRoute): DesignFinding | null {
  if (COMPONENT_PATTERN.test(route.component)) return null;
  return {
    file: ROUTES_PATH,
    line: 1,
    rule: 'route_without_component',
    message: `route ${route.path} has no component`,
  };
}

function stateFindings(spec: ScreenSpec): readonly DesignFinding[] {
  const file = screenFile(spec.screen);
  const findings: DesignFinding[] = [];
  for (const state of SCREEN_STATES) {
    if (spec.states[state] !== null) continue;
    findings.push({
      file,
      line: 1,
      rule: 'screen_state_missing',
      message: `screen ${spec.screen} has no ${state} state`,
    });
  }
  return findings;
}

function colourFindings(spec: ScreenSpec, tokens: ReadonlySet<string>): readonly DesignFinding[] {
  const outside = captionColours(spec).some((colour) => !tokens.has(colour));
  if (!outside) return [];
  return [
    {
      file: screenFile(spec.screen),
      line: 1,
      rule: 'colour_outside_tokens',
      message: 'snapshot declares a colour outside the tokens',
    },
  ];
}

/**
 * The four document questions, in rule order and then sorted by file and line. Captions are
 * data: a caption that writes a colour instead of naming a token fails the same way a stylesheet
 * would.
 */
export function checkDocuments(input: DesignDocuments): readonly DesignFinding[] {
  const tokens = new Set(tokenValues(input.tokens));
  const specs = new Set(input.screens.map((spec) => spec.screen));
  const findings: DesignFinding[] = [];

  for (const route of input.routes) {
    const finding = routeComponentFinding(route);
    if (finding !== null) findings.push(finding);
  }
  for (const spec of input.screens) findings.push(...stateFindings(spec));
  for (const route of input.routes) {
    if (specs.has(route.screen)) continue;
    findings.push({
      file: ROUTES_PATH,
      line: 1,
      rule: 'screen_state_missing',
      message: `route ${route.path} has no spec`,
    });
  }
  for (const spec of input.screens) findings.push(...colourFindings(spec, tokens));

  return sortFindings(findings);
}

/**
 * Only added lines are inspected: a colour that already lived in the file is not this diff's
 * fault, and the token document itself is where literals are allowed to be born.
 */
export function checkPatch(input: DesignPatchInput): readonly DesignFinding[] {
  const tokens = new Set(input.tokenValues.map(normalise));
  const found = new Map<string, DesignFinding>();
  let pendingPath: string | null = null;
  let currentPath: string | null = null;
  let nextLine = 0;

  for (const raw of input.patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('diff --git ')) {
      pendingPath = DIFF_HEADER.exec(line)?.[2] ?? null;
      currentPath = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      currentPath = target === DEV_NULL ? null : stripDiffPrefix(target);
      if (target === DEV_NULL) pendingPath = null;
      continue;
    }
    if (line.startsWith('@@')) {
      const header = HUNK_HEADER.exec(line);
      if (header === null) continue;
      nextLine = Number(header[1]);
      if (currentPath === null && pendingPath !== null) currentPath = pendingPath;
      continue;
    }
    if (line.startsWith('+')) {
      const text = line.slice(1);
      if (currentPath !== null && currentPath !== TOKENS_PATH && !text.includes(ALLOW_MARKER)) {
        for (const colour of findColours(text)) {
          const key = `${currentPath}\u0000${nextLine}\u0000${colour}`;
          if (tokens.has(normalise(colour)) || found.has(key)) continue;
          found.set(key, {
            file: currentPath,
            line: nextLine,
            rule: 'colour_outside_tokens',
            message: `colour ${colour} is not a token`,
          });
        }
      }
      nextLine += 1;
      continue;
    }
    if (line.startsWith(' ')) nextLine += 1;
  }

  return sortFindings([...found.values()]);
}
