import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import * as design from '../../packages/design/src/index.ts';
import { ImportCommandError, main, parseArgs, projectPage, screenSlug } from './import.mjs';

const KEY = '3HMV2UN6QviuNXe2T3Htsr';
const TOKEN = 'test-token';
const DASHBOARD_CAPTION = '05 · Dashboard — mobile dark';
const DASHBOARD_INDEX = 5;
const SLUGS = [
  'pairing',
  'repo-list',
  'repo-backlog',
  'repo-workers',
  'design-session',
  'dashboard',
  'settings',
  'devices',
  'credentials',
  'notifications',
  'about',
];
const IDS = [
  '1:100',
  '2:110',
  '3:120',
  '4:130',
  '5:140',
  '6:150',
  '7:160',
  '8:170',
  '9:180',
  '9:190',
  '10:190',
];
const OUTSIDE = 'rgba(51, 102, 153, 0.25)';
const SUMMARY =
  '{"frames":13,"mapped":11,"unmapped":2,"colours":8,"coloursOutsideTokens":1,"routes":11,"screens":11,"exports":11}';
const USAGE = `usage: node scripts/design/import.mjs --file <key> [--check] [--map <path>] [--root <dir>]

  --file <key>    the Figma file key (default: FIGMA_FILE_KEY)
  --map <path>    the import map (default: <root>/design/import.json)
  --root <dir>    the repository root to read and write (default: the working directory)
  --check         write nothing; exit 1 when any artifact differs
  --help          this text`;

const SCRIPT = fileURLToPath(new URL('./import.mjs', import.meta.url));
const COMMITTED_TOKENS = fileURLToPath(new URL('../../design/tokens.json', import.meta.url));
const PNG = readFileSync(new URL('./fixtures/export-frame.png', import.meta.url));

const roots = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

function fixture(name) {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

function jsonFixture(name) {
  return JSON.parse(readFileSync(fixture(name), 'utf8'));
}

function tmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cb-design-import-'));
  roots.push(root);
  return root;
}

function makeRoot({ map = true, tokens = readFileSync(COMMITTED_TOKENS) } = {}) {
  const root = tmpRoot();
  mkdirSync(join(root, 'design'), { recursive: true });
  if (tokens !== null) writeFileSync(join(root, 'design/tokens.json'), tokens);
  if (map) copyFileSync(fixture('import.json'), join(root, 'design/import.json'));
  return root;
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function binaryResponse(bytes) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function stubFetch(options = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('https://api.figma.com/v1/files/')) {
      if (options.file === 'reject') throw new Error('boom');
      if (options.file === 'html') {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token <');
          },
        };
      }
      if (options.file === 'error') return { ok: false, status: 500, json: async () => ({}) };
      return jsonResponse(options.fileBody ?? jsonFixture('file.json'));
    }
    if (url.startsWith('https://api.figma.com/v1/images/')) {
      return jsonResponse(options.imagesBody ?? jsonFixture('images.json'));
    }
    if (url.startsWith('https://figma-images.example/')) {
      if (options.png === 'error') return { ok: false, status: 404 };
      return binaryResponse(PNG);
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return { calls, fetch };
}

async function runMain(root, options = {}) {
  const stub = stubFetch(options.fetch);
  const stdout = [];
  const stderr = [];
  const io = {
    env: options.env ?? { FIGMA_TOKEN: TOKEN, FIGMA_FILE_KEY: KEY },
    cwd: process.cwd(),
    fetch: stub.fetch,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    design,
  };
  const argv = options.argv ?? ['--file', KEY, '--root', root];
  const code = await main(argv, io);
  const out = stdout.join('');
  return {
    code,
    calls: stub.calls,
    stdout,
    stderr,
    out,
    err: stderr.join(''),
    lines: out === '' ? [] : out.replace(/\n$/, '').split('\n'),
    drifts: stderr
      .filter((line) => line.startsWith('drift: '))
      .map((line) => line.replace(/\n$/, '')),
  };
}

function tree(root, prefix = '') {
  const found = {};
  const directory = prefix === '' ? root : join(root, prefix);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(found, tree(root, relative));
    else found[relative] = readFileSync(join(root, relative)).toString('base64');
  }
  return found;
}

function expectFailure(error, code, exitCode) {
  expect(error).toBeInstanceOf(ImportCommandError);
  expect(error.code).toBe(code);
  expect(error.exitCode).toBe(exitCode);
}

function renamedFileBody() {
  const body = jsonFixture('file.json');
  body.document.children[1].children[DASHBOARD_INDEX].name = `${DASHBOARD_CAPTION} v2`;
  return body;
}

describe('parseArgs', () => {
  it('has no key, map or root by default', () => {
    expect(parseArgs([])).toEqual({ file: null, map: null, root: null, check: false, help: false });
  });

  it('reads both value forms and the check switch', () => {
    expect(parseArgs(['--file', KEY, '--map=m.json', '--root', 'tree', '--check'])).toEqual({
      file: KEY,
      map: 'm.json',
      root: 'tree',
      check: true,
      help: false,
    });
  });

  it('refuses an unknown option', () => {
    for (const argv of [['--frobnicate'], ['stray'], ['--check=on']]) {
      try {
        parseArgs(argv);
        throw new Error(`parseArgs accepted ${argv.join(' ')}`);
      } catch (error) {
        expectFailure(error, 'usage', 2);
      }
    }
  });

  it('refuses a missing or empty value', () => {
    for (const argv of [['--file'], ['--map'], ['--root'], ['--file', ''], ['--file=']]) {
      try {
        parseArgs(argv);
        throw new Error(`parseArgs accepted ${argv.join(' ')}`);
      } catch (error) {
        expectFailure(error, 'usage', 2);
      }
    }
  });

  it('accepts --help and -h', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });
});

describe('screenSlug', () => {
  it('drops the middle dot and keeps the words', () => {
    expect(screenSlug('Repo · backlog')).toBe('repo-backlog');
    expect(screenSlug('Design · session')).toBe('design-session');
  });

  it('agrees with the file name checkDocuments derives', () => {
    const spec = {
      screen: 'Repo · backlog',
      route: '/repos/:id',
      states: { loading: null, empty: null, error: null },
      snapshotSha256: null,
    };
    const findings = design.checkDocuments({
      tokens: {},
      routes: [{ path: '/repos/:id', screen: 'Repo · backlog', component: 'RepoBacklogPage' }],
      screens: [spec],
    });
    const files = new Set(findings.map((finding) => finding.file));
    expect(files.has(`design/screens/${screenSlug(spec.screen)}.json`)).toBe(true);
  });
});

describe('projectPage', () => {
  it('selects the named page after the cover and keeps top-level frames only', () => {
    const snapshot = projectPage(jsonFixture('file.json'), 'Page 1', KEY);
    expect(snapshot.fileKey).toBe(KEY);
    expect(snapshot.page).toBe('Page 1');
    expect(snapshot.frames).toHaveLength(13);
    expect(snapshot.frames.map((frame) => frame.caption)).not.toContain('Cover frame');
    expect(snapshot.frames.map((frame) => frame.caption)).not.toContain('Annotation');
  });

  it('projects id, caption, size and every expected fill', () => {
    const expected = {
      '1:100': ['#0b0f14', '#121821', '#e6edf3'],
      '2:110': ['#0b0f14', '#8b98a5'],
      '3:120': ['#0b0f14', '#121821'],
      '4:130': ['#0b0f14', '#22c55e'],
      '5:140': ['#0b0f14', '#f59e0b', OUTSIDE],
      '6:150': ['#0b0f14', '#121821', '#e6edf3'],
      '7:160': ['#0b0f14', '#8b98a5'],
      '8:170': ['#0b0f14'],
      '9:180': ['#0b0f14'],
      '9:190': ['#0b0f14'],
      '10:190': ['#0b0f14', '#5b6772'],
      '11:900': ['#0b0f14', '#ff00ff'],
      '12:910': ['#121821', '#abcdef'],
    };
    const snapshot = projectPage(jsonFixture('file.json'), 'Page 1', KEY);
    for (const frame of snapshot.frames) expect(frame.fills).toEqual(expected[frame.id]);
    const first = snapshot.frames[0];
    expect(first).toEqual({
      id: '1:100',
      caption: '01 · Pairing — mobile dark',
      width: 390,
      height: 844,
      fills: ['#0b0f14', '#121821', '#e6edf3'],
    });
    expect(snapshot.frames[11].width).toBe(1280);
    expect(snapshot.frames[11].height).toBe(800);
  });

  it('names the page it could not find and every page the file has', () => {
    try {
      projectPage(jsonFixture('file.json'), 'Page 2', KEY);
      throw new Error('projectPage accepted a missing page');
    } catch (error) {
      expectFailure(error, 'page_missing', 1);
      expect(error.message).toContain("'Page 2'");
      expect(error.message).toContain('Cover');
      expect(error.message).toContain('Page 1');
    }
  });

  it('fails a frame without a size', () => {
    const body = jsonFixture('file.json');
    delete body.document.children[1].children[0].absoluteBoundingBox;
    try {
      projectPage(body, 'Page 1', KEY);
      throw new Error('projectPage accepted a frame without a size');
    } catch (error) {
      expectFailure(error, 'file_invalid', 1);
      expect(error.message).toContain("frame '1:100' has no size");
    }
  });
});

describe('main — write', () => {
  it('ships the fixtures the command is measured against', () => {
    const committed = readFileSync(
      fileURLToPath(new URL('../../design/import.json', import.meta.url)),
    );
    expect(readFileSync(fixture('import.json')).equals(committed)).toBe(true);

    const images = jsonFixture('images.json');
    expect(images.err).toBeNull();
    expect(Object.keys(images.images)).toEqual(IDS);

    expect(PNG.length).toBeLessThan(400);
    expect(PNG.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(PNG.readUInt32BE(16)).toBe(1);
    expect(PNG.readUInt32BE(20)).toBe(1);
  });

  it('writes 23 status lines and then the frozen summary', async () => {
    const root = makeRoot();
    const run = await runMain(root);
    expect(run.code).toBe(0);
    expect(run.lines).toHaveLength(24);
    expect(run.lines[0]).toBe('wrote design/routes.json (11 routes)');
    expect(run.lines.slice(1, 12)).toEqual(
      SLUGS.map((slug) => `wrote design/screens/${slug}.json`),
    );
    expect(run.lines.slice(12, 23)).toEqual(
      SLUGS.map((slug) => `wrote design/exports/${slug}.png (${PNG.length} bytes)`),
    );
    expect(run.lines[23]).toBe(SUMMARY);
  });

  it('writes the three artifact families the package parses back', async () => {
    const root = makeRoot();
    const run = await runMain(root);
    expect(run.code).toBe(0);

    const routes = design.parseRoutes(
      JSON.parse(readFileSync(join(root, 'design/routes.json'), 'utf8')),
    );
    expect(routes).toHaveLength(11);
    expect(routes[2]).toEqual({
      path: '/repos/:id',
      screen: 'Repo · backlog',
      component: 'RepoBacklogPage',
    });

    const files = readdirSync(join(root, 'design/screens')).sort();
    expect(files).toEqual([...SLUGS].sort().map((slug) => `${slug}.json`));

    const screens = files.map((file) =>
      design.parseScreenSpec(JSON.parse(readFileSync(join(root, 'design/screens', file), 'utf8'))),
    );
    const hash = design.snapshotHash(PNG);
    for (const spec of screens) expect(spec.snapshotSha256).toBe(hash);

    const tokens = design.parseTokens(
      JSON.parse(readFileSync(join(root, 'design/tokens.json'), 'utf8')),
    );
    const findings = design.checkDocuments({
      tokens,
      routes,
      screens,
    });
    expect(findings.filter((finding) => finding.rule === 'route_without_component')).toEqual([]);

    for (const slug of SLUGS) {
      const bytes = readFileSync(join(root, 'design/exports', `${slug}.png`));
      expect(bytes.equals(PNG)).toBe(true);
    }

    const dashboard = readFileSync(join(root, 'design/screens/dashboard.json'), 'utf8');
    expect(
      dashboard.startsWith(
        '{\n  "screen": "Dashboard",\n  "route": "/dashboard",\n  "states": {\n    "loading": null,',
      ),
    ).toBe(true);
  });

  it('calls the two API endpoints with the token and the PNG URLs with one argument', async () => {
    const root = makeRoot();
    const run = await runMain(root);
    expect(run.code).toBe(0);
    expect(run.calls).toHaveLength(13);

    const api = run.calls.slice(0, 2);
    expect(api.map((call) => call.url)).toEqual([
      `https://api.figma.com/v1/files/${KEY}?depth=6`,
      `https://api.figma.com/v1/images/${KEY}?ids=${IDS.join(',')}&format=png&scale=2`,
    ]);
    for (const call of api) expect(call.init.headers['X-Figma-Token']).toBe(TOKEN);

    const png = run.calls.slice(2);
    expect(png).toHaveLength(11);
    for (const call of png) expect(call.init).toBeUndefined();
    for (const id of IDS) {
      expect(
        png.some((call) => call.url === `https://figma-images.example/${id.replace(':', '-')}.png`),
      ).toBe(true);
    }
    for (const call of run.calls) expect(call.url).not.toContain('/styles');
  });

  it('measures the colours outside the tokens without failing', async () => {
    const root = makeRoot();
    const run = await runMain(root);
    expect(run.code).toBe(0);
    expect(run.lines[23]).toBe(SUMMARY);
    expect(run.err).toContain(`colour outside tokens: ${OUTSIDE}`);
    expect(run.err.match(/colour outside tokens:/g)).toHaveLength(1);
  });

  it('reports the second colour once a token is removed', async () => {
    const tokens = JSON.parse(readFileSync(COMMITTED_TOKENS, 'utf8'));
    delete tokens.color.ink['muted-light'];
    const root = makeRoot({ tokens: `${JSON.stringify(tokens, null, 2)}\n` });
    const run = await runMain(root);
    expect(run.code).toBe(0);
    expect(run.lines[23]).toBe(
      '{"frames":13,"mapped":11,"unmapped":2,"colours":8,"coloursOutsideTokens":2,"routes":11,"screens":11,"exports":11}',
    );
    expect(run.err).toContain('colour outside tokens: #5b6772');
    expect(run.err).toContain(`colour outside tokens: ${OUTSIDE}`);
  });

  it('still writes when the token document is absent', async () => {
    const root = makeRoot({ tokens: null });
    const run = await runMain(root);
    expect(run.code).toBe(0);
    expect(run.err).toContain('tokens_unavailable: design/tokens.json');
    expect(run.lines[23]).toBe(
      '{"frames":13,"mapped":11,"unmapped":2,"colours":8,"coloursOutsideTokens":null,"routes":11,"screens":11,"exports":11}',
    );
    expect(readdirSync(join(root, 'design')).sort()).toEqual([
      'exports',
      'import.json',
      'routes.json',
      'screens',
    ]);
  });
});

describe('main — check', () => {
  it('reports no drift on a current root and writes nothing', async () => {
    const root = makeRoot();
    const written = await runMain(root);
    expect(written.code).toBe(0);
    const before = tree(root);

    const run = await runMain(root, { argv: ['--file', KEY, '--root', root, '--check'] });
    expect(run.code).toBe(0);
    expect(run.lines).toEqual([SUMMARY]);
    expect(run.drifts).toEqual([]);
    expect(run.err).toContain(`colour outside tokens: ${OUTSIDE}`);
    expect(tree(root)).toEqual(before);
  });

  it('exits 1 on a single appended byte and leaves it in place', async () => {
    const root = makeRoot();
    await runMain(root);
    const routesPath = join(root, 'design/routes.json');
    writeFileSync(routesPath, `${readFileSync(routesPath, 'utf8')} `);

    const run = await runMain(root, { argv: ['--file', KEY, '--root', root, '--check'] });
    expect(run.code).toBe(1);
    expect(run.drifts).toEqual(['drift: design/routes.json']);
    expect(readFileSync(routesPath, 'utf8').endsWith(' ')).toBe(true);
  });

  it('treats a missing artifact as drift', async () => {
    const root = makeRoot();
    await runMain(root);
    rmSync(join(root, 'design/screens/dashboard.json'));
    const run = await runMain(root, { argv: ['--file', KEY, '--root', root, '--check'] });
    expect(run.code).toBe(1);
    expect(run.drifts).toContain('drift: design/screens/dashboard.json');
    expect(readdirSync(join(root, 'design/screens'))).not.toContain('dashboard.json');
  });
});

describe('main — failures', () => {
  it('stops before any request when FIGMA_TOKEN is missing', async () => {
    const root = makeRoot();
    const run = await runMain(root, { env: { FIGMA_FILE_KEY: KEY } });
    expect(run.code).toBe(2);
    expect(run.err).toContain('token_missing');
    expect(run.err).toContain('FIGMA_TOKEN');
    expect(run.calls).toHaveLength(0);
  });

  it('names the default map path when the map is absent', async () => {
    const root = makeRoot({ map: false });
    const run = await runMain(root);
    expect(run.code).toBe(2);
    expect(run.err).toContain(`map_missing: ${join(root, 'design/import.json')} is missing`);
    expect(run.calls).toHaveLength(0);
  });

  it('names the missing page and every page the file has, and writes nothing', async () => {
    const root = makeRoot();
    const map = jsonFixture('import.json');
    map.page = 'Page 2';
    writeFileSync(join(root, 'design/import.json'), `${JSON.stringify(map, null, 2)}\n`);

    const run = await runMain(root);
    expect(run.code).toBe(1);
    expect(run.err).toContain('page_missing');
    expect(run.err).toContain("'Page 2'");
    expect(run.err).toContain('Cover');
    expect(run.err).toContain('Page 1');
    expect(readdirSync(join(root, 'design')).sort()).toEqual(['import.json', 'tokens.json']);
  });

  it('fails when a mapped caption is no longer on the page', async () => {
    const root = makeRoot();
    const run = await runMain(root, { fetch: { fileBody: renamedFileBody() } });
    expect(run.code).toBe(1);
    expect(run.err).toContain("frame_missing: no frame captioned '05 · Dashboard — mobile dark'");
    expect(run.err).toContain(`frames.${DASHBOARD_INDEX}.caption`);
  });

  it('refuses a map that names another file key', async () => {
    const root = makeRoot();
    const map = jsonFixture('import.json');
    map.fileKey = 'OTHERFILEKEY';
    writeFileSync(join(root, 'design/import.json'), `${JSON.stringify(map, null, 2)}\n`);

    const run = await runMain(root);
    expect(run.code).toBe(2);
    expect(run.err).toContain('file_mismatch');
    expect(run.err).toContain("'OTHERFILEKEY'");
    expect(run.err).toContain(`'${KEY}'`);
    expect(run.calls).toHaveLength(0);
  });

  it('reports an invalid map with its issues', async () => {
    const root = makeRoot();
    const map = jsonFixture('import.json');
    map.frames[0].component = 'wrong component';
    writeFileSync(join(root, 'design/import.json'), `${JSON.stringify(map, null, 2)}\n`);

    const run = await runMain(root);
    expect(run.code).toBe(1);
    expect(run.stderr[0]).toBe('map_invalid: invalid import map\n');
    expect(run.stderr[1]).toMatch(/^ {2}frames\.0\.component: /);
  });

  it('reports the file request failures with their URL and status', async () => {
    const root = makeRoot();
    const url = `https://api.figma.com/v1/files/${KEY}?depth=6`;

    const rejected = await runMain(root, { fetch: { file: 'reject' } });
    expect(rejected.code).toBe(1);
    expect(rejected.err).toBe(`http_error: ${url} failed: boom\n`);

    const failed = await runMain(root, { fetch: { file: 'error' } });
    expect(failed.code).toBe(1);
    expect(failed.err).toBe(`http_error: GET ${url} answered 500\n`);

    const notJson = await runMain(root, { fetch: { file: 'html' } });
    expect(notJson.code).toBe(1);
    expect(notJson.err).toBe(`http_error: GET ${url} did not return JSON\n`);
  });

  it('reports every export failure as export_missing', async () => {
    const root = makeRoot();

    const noExport = await runMain(root, {
      fetch: { imagesBody: { err: 'image generation failed', images: {} } },
    });
    expect(noExport.code).toBe(1);
    expect(noExport.err).toBe('export_missing: image generation failed\n');

    const missingId = await runMain(root, {
      fetch: { imagesBody: { err: null, images: {} } },
    });
    expect(missingId.code).toBe(1);
    expect(missingId.err).toBe("export_missing: no export for '01 · Pairing — mobile dark'\n");

    const badPng = await runMain(root, { fetch: { png: 'error' } });
    expect(badPng.code).toBe(1);
    expect(badPng.err).toBe('export_missing: 01 · Pairing — mobile dark export answered 404\n');
  });

  it('prints the frozen usage block and exits 0 for --help', async () => {
    const root = makeRoot();
    const run = await runMain(root, { argv: ['--help'], env: {}, fetch: { file: 'reject' } });
    expect(run.code).toBe(0);
    expect(run.out).toBe(`${USAGE}\n`);
    expect(run.calls).toHaveLength(0);
  });

  it('runs --help as a CLI without loading the package', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${USAGE}\n`);
    expect(result.stderr).toBe('');
  });

  it('runs the CLI with FIGMA_TOKEN unset and exits 2', () => {
    const env = { ...process.env };
    delete env.FIGMA_TOKEN;
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^token_missing: .*FIGMA_TOKEN/);
  });
});
