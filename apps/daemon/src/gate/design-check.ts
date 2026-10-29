import { readFile as nodeReadFile, readdir as nodeReaddir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  DesignDocumentError,
  EXPORTS_DIR,
  ROUTES_PATH,
  SCREENS_DIR,
  TOKENS_PATH,
  checkDocuments,
  checkPatch,
  checkSnapshots,
  parseRoutes,
  parseScreenSpec,
  parseTokens,
  tokenValues,
} from '@codebox/design';
import type {
  DesignBoundary,
  DesignFinding,
  DesignIssue,
  DesignRoute,
  DesignTokens,
  ScreenSpec,
  SnapshotInput,
} from '@codebox/design';
import { GIT_ENV } from '@codebox/workspaces';
import type { GitRunner } from '@codebox/workspaces';

export const DESIGN_CHECK_MAX_BYTES = 4_194_304;

export interface DesignScanIo {
  readonly readFile: (path: string) => Promise<string>;
  readonly readDir: (path: string) => Promise<readonly string[]>;
}

export interface DesignScanInput {
  readonly cwd: string;
  readonly baseSha: string;
  readonly timeoutMs: number;
  /** Defaults to node:fs/promises readFile/readdir. Tests inject a stub and touch no disk. */
  readonly io?: DesignScanIo;
}

export interface DesignScanOutcome {
  readonly findings: readonly DesignFinding[];
  readonly skipped: boolean;
  readonly oversized: boolean;
}

export type DesignScanFailureCode = 'git_failed';

export class DesignScanError extends Error {
  readonly code: DesignScanFailureCode;

  constructor(code: DesignScanFailureCode) {
    super(`design scan failed: ${code}`);
    this.name = 'DesignScanError';
    this.code = code;
  }
}

interface ScreenEntry {
  readonly file: string;
  readonly spec: ScreenSpec;
}

const PNG_SUFFIX = '.png';
const JSON_SUFFIX = '.json';

/**
 * An export is read one character per byte (`latin1`), because only then does the sha256 of the
 * string's bytes equal the sha256 of the PNG the hash was declared over.
 */
function defaultIo(cwd: string): DesignScanIo {
  return {
    readFile: (path) =>
      nodeReadFile(join(cwd, path), path.endsWith(PNG_SUFFIX) ? 'latin1' : 'utf8'),
    readDir: (path) => nodeReaddir(join(cwd, path)),
  };
}

function parseJson(boundary: DesignBoundary, file: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DesignDocumentError(boundary, [
      { path: file, message: 'document is not valid JSON' },
    ]);
  }
}

async function readOptional(io: DesignScanIo, path: string): Promise<string | null> {
  try {
    return await io.readFile(path);
  } catch {
    return null;
  }
}

function boundaryFindings(
  boundary: DesignBoundary,
  file: string,
  issues: readonly DesignIssue[],
): readonly DesignFinding[] {
  return issues.map((issue) => ({
    file: boundary === 'routes' ? ROUTES_PATH : file,
    line: 1,
    rule: boundary === 'routes' ? 'route_without_component' : 'screen_state_missing',
    message: issue.message,
  }));
}

async function loadRoutes(
  io: DesignScanIo,
  findings: DesignFinding[],
): Promise<readonly DesignRoute[]> {
  const text = await readOptional(io, ROUTES_PATH);
  if (text === null) return [];
  try {
    return parseRoutes(parseJson('routes', ROUTES_PATH, text));
  } catch (error) {
    if (!(error instanceof DesignDocumentError)) throw error;
    findings.push(...boundaryFindings('routes', ROUTES_PATH, error.issues));
    return [];
  }
}

async function listScreenFiles(io: DesignScanIo): Promise<readonly string[]> {
  try {
    const names = await io.readDir(SCREENS_DIR);
    return names.filter((name) => name.endsWith(JSON_SUFFIX)).sort();
  } catch {
    return [];
  }
}

async function loadScreens(
  io: DesignScanIo,
  findings: DesignFinding[],
): Promise<readonly ScreenEntry[]> {
  const entries: ScreenEntry[] = [];
  for (const name of await listScreenFiles(io)) {
    const file = `${SCREENS_DIR}/${name}`;
    const text = await readOptional(io, file);
    if (text === null) continue;
    try {
      entries.push({ file, spec: parseScreenSpec(parseJson('screen', file, text)) });
    } catch (error) {
      if (!(error instanceof DesignDocumentError)) throw error;
      findings.push(...boundaryFindings('screen', file, error.issues));
    }
  }
  return entries;
}

async function loadTokens(io: DesignScanIo): Promise<DesignTokens | 'absent'> {
  const text = await readOptional(io, TOKENS_PATH);
  if (text === null) return 'absent';
  try {
    return parseTokens(parseJson('tokens', TOKENS_PATH, text));
  } catch (error) {
    if (error instanceof DesignDocumentError) throw new DesignScanError('git_failed');
    throw error;
  }
}

async function snapshotFindings(
  io: DesignScanIo,
  screens: readonly ScreenEntry[],
): Promise<readonly DesignFinding[]> {
  const inputs: SnapshotInput[] = [];
  for (const entry of screens) {
    if (entry.spec.snapshotSha256 === null) continue;
    const slug = basename(entry.file, JSON_SUFFIX);
    const text = await readOptional(io, `${EXPORTS_DIR}/${slug}${PNG_SUFFIX}`);
    inputs.push({
      file: entry.file,
      spec: entry.spec,
      bytes: text === null ? null : Buffer.from(text, 'latin1'),
    });
  }
  return checkSnapshots(inputs);
}

function sortFindings(findings: readonly DesignFinding[]): readonly DesignFinding[] {
  return [...findings].sort((left, right) => {
    if (left.file !== right.file) return left.file < right.file ? -1 : 1;
    return left.line - right.line;
  });
}

export function formatDesignFinding(finding: DesignFinding): string {
  return `${finding.file === '' ? '(unknown)' : finding.file}:${finding.line} ${finding.rule}`;
}

/**
 * The run's own diff against its base, plus the design documents it ships. A repository with no
 * `design/tokens.json` is skipped; a token document that does not parse fails closed, because
 * the colour rule has no meaning without the set of legal literals.
 */
export async function scanDesign(
  git: GitRunner,
  input: DesignScanInput,
): Promise<DesignScanOutcome> {
  const result = await git.run({
    args: ['diff', '--no-color', '--unified=0', '--no-ext-diff', input.baseSha, '--'],
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    env: GIT_ENV,
  });
  if (result.code !== 0) throw new DesignScanError('git_failed');
  if (Buffer.byteLength(result.stdout, 'utf8') > DESIGN_CHECK_MAX_BYTES) {
    return { findings: [], skipped: false, oversized: true };
  }

  const io = input.io ?? defaultIo(input.cwd);
  const tokens = await loadTokens(io);
  if (tokens === 'absent') return { findings: [], skipped: true, oversized: false };

  const findings: DesignFinding[] = [];
  const routes = await loadRoutes(io, findings);
  const screens = await loadScreens(io, findings);
  const specs = screens.map((entry) => entry.spec);
  findings.push(...checkDocuments({ tokens, routes, screens: specs }));
  findings.push(...checkPatch({ patch: result.stdout, tokenValues: tokenValues(tokens) }));
  findings.push(...(await snapshotFindings(io, screens)));
  return { findings: sortFindings(findings), skipped: false, oversized: false };
}
