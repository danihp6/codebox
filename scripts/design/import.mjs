#!/usr/bin/env node

// The command is importable before `@codebox/design` is built (the gate tests before it builds),
// so the package is resolved lazily inside `main` and never at module scope.
import { Buffer } from 'node:buffer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FIGMA_API = 'https://api.figma.com';

const USAGE = `usage: node scripts/design/import.mjs --file <key> [--check] [--map <path>] [--root <dir>]

  --file <key>    the Figma file key (default: FIGMA_FILE_KEY)
  --map <path>    the import map (default: <root>/design/import.json)
  --root <dir>    the repository root to read and write (default: the working directory)
  --check         write nothing; exit 1 when any artifact differs
  --help          this text`;

const VALUE_FLAGS = new Set(['--file', '--map', '--root']);

/** Thrown for every failure the command reports itself. `code` is the frozen string below. */
export class ImportCommandError extends Error {
  /** @param {string} code @param {string} message @param {number} exitCode */
  constructor(code, message, exitCode) {
    super(message);
    this.name = 'ImportCommandError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

/**
 * Flags only. Accepts `--flag value` and `--flag=value`.
 * @param {string[]} argv
 * @returns {{ file: string | null, map: string | null, root: string | null,
 *             check: boolean, help: boolean }}
 * @throws {ImportCommandError} code 'usage', exitCode 2
 */
export function parseArgs(argv) {
  const options = { file: null, map: null, root: null, check: false, help: false };
  const args = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const equals = arg.indexOf('=');
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (!VALUE_FLAGS.has(flag)) {
      throw new ImportCommandError('usage', `unknown option '${arg}'`, 2);
    }
    let value;
    if (equals === -1) {
      value = args[index + 1];
      if (value === undefined) throw new ImportCommandError('usage', `'${flag}' needs a value`, 2);
      index += 1;
    } else {
      value = arg.slice(equals + 1);
    }
    if (value === '') throw new ImportCommandError('usage', `'${flag}' needs a value`, 2);
    if (flag === '--file') options.file = value;
    else if (flag === '--map') options.map = value;
    else options.root = value;
  }
  return options;
}

/**
 * `Repo · backlog` → `repo-backlog`. The rule is `packages/design/src/check.ts`'s private
 * `screenSlug`, copied verbatim: `·` and its surrounding spaces become `-`, every run of
 * non-alphanumerics becomes `-`, the ends are trimmed, then lowercased.
 * @param {string} screen @returns {string}
 */
export function screenSlug(screen) {
  return screen
    .replace(/\s*·\s*/g, '-')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message) {
  return new ImportCommandError('file_invalid', message, 1);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function channel(value) {
  return Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, '0');
}

function paintColour(paint, frameId) {
  const colour = paint.color;
  const channels = isRecord(colour) ? [colour.r, colour.g, colour.b] : [];
  const usable = channels.length === 3 && channels.every((value) => Number.isFinite(value));
  if (!usable) throw invalid(`frame '${frameId}' has a SOLID paint without a colour`);
  const [r, g, b] = channels;
  const opacity = paint.opacity;
  if (opacity === undefined || opacity === 1) {
    return `#${channel(r)}${channel(g)}${channel(b)}`;
  }
  if (!Number.isFinite(opacity)) {
    throw invalid(`frame '${frameId}' has a SOLID paint without a colour`);
  }
  const alpha = String(Math.round(opacity * 1000) / 1000);
  return `rgba(${Math.round(clamp01(r) * 255)}, ${Math.round(clamp01(g) * 255)}, ${Math.round(clamp01(b) * 255)}, ${alpha})`;
}

function collectFills(node, frameId, into) {
  const paints = node.fills;
  if (Array.isArray(paints)) {
    for (const paint of paints) {
      if (!isRecord(paint)) continue;
      if (paint.type !== 'SOLID' || paint.visible === false) continue;
      into.push(paintColour(paint, frameId));
    }
  }
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (isRecord(child)) collectFills(child, frameId, into);
    }
  }
}

function measurableBox(node) {
  const box = node.absoluteBoundingBox;
  if (!isRecord(box)) return null;
  const values = [box.x, box.y, box.width, box.height];
  if (!values.every((value) => Number.isFinite(value))) return null;
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function radiusOf(node) {
  if (Number.isFinite(node.cornerRadius)) return node.cornerRadius;
  const radii = node.rectangleCornerRadii;
  if (Array.isArray(radii)) {
    const usable = radii.filter((value) => Number.isFinite(value));
    if (usable.length > 0) return Math.max(...usable);
  }
  return 0;
}

function strokeOf(node) {
  const paints = node.strokes;
  const visible =
    Array.isArray(paints) && paints.some((paint) => isRecord(paint) && paint.visible !== false);
  if (!visible || !Number.isFinite(node.strokeWeight)) return 0;
  return node.strokeWeight;
}

function solidColour(node, frameId) {
  const paints = node.fills;
  if (!Array.isArray(paints)) return null;
  for (const paint of paints) {
    if (!isRecord(paint)) continue;
    if (paint.type !== 'SOLID' || paint.visible === false) continue;
    return paintColour(paint, frameId);
  }
  return null;
}

function regionOf(child, origin, frameId) {
  const box = measurableBox(child);
  if (box === null) return null;
  const name = typeof child.name === 'string' ? child.name.trim() : '';
  return {
    name: name === '' ? 'region' : name,
    x: box.x - origin.x,
    y: box.y - origin.y,
    width: box.width,
    height: box.height,
    fill: solidColour(child, frameId),
    radius: radiusOf(child),
    stroke: strokeOf(child),
  };
}

function textNodesOf(node, into) {
  const children = node.children;
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (!isRecord(child)) continue;
    if (child.type === 'TEXT') into.push(child);
    textNodesOf(child, into);
  }
}

function typeRowOf(node) {
  const id = typeof node.id === 'string' ? node.id : '?';
  const style = node.style;
  if (!isRecord(style)) throw invalid(`text node '${id}' has no style`);
  if (!Number.isFinite(style.fontSize)) throw invalid(`text node '${id}' has no style.fontSize`);
  const family = typeof style.fontFamily === 'string' ? style.fontFamily.trim() : '';
  if (family === '') throw invalid(`text node '${id}' has no style.fontFamily`);
  const role = typeof node.name === 'string' ? node.name.trim() : '';
  const size = style.fontSize;
  return {
    role: role === '' ? 'text' : role,
    family: style.fontFamily,
    weight: Number.isFinite(style.fontWeight) ? style.fontWeight : 400,
    size,
    lineHeight: Number.isFinite(style.lineHeightPx) ? style.lineHeightPx : size,
    colour: solidColour(node, id),
  };
}

function typeOf(node) {
  const nodes = [];
  textNodesOf(node, nodes);
  const rows = [];
  const seen = new Set();
  for (const text of nodes) {
    const row = typeRowOf(text);
    const key = [row.role, row.family, row.weight, row.size, row.lineHeight, row.colour].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

function layoutOf(node, frameId) {
  const own = node.absoluteBoundingBox;
  const origin = {
    x: isRecord(own) ? finiteOrZero(own.x) : 0,
    y: isRecord(own) ? finiteOrZero(own.y) : 0,
  };
  const children = Array.isArray(node.children) ? node.children.filter(isRecord) : [];
  const measured = [];
  children.forEach((child, index) => {
    const region = regionOf(child, origin, frameId);
    if (region !== null) measured.push({ region, index });
  });
  if (measured.length === 0) return undefined;

  const declared = typeof node.layoutMode === 'string' ? node.layoutMode.toLowerCase() : '';
  const layoutMode = declared === 'horizontal' || declared === 'vertical' ? declared : 'none';
  const inferred = layoutMode === 'none';
  const ordered = inferred
    ? [...measured].sort(
        (left, right) =>
          left.region.y - right.region.y ||
          left.region.x - right.region.x ||
          left.index - right.index,
      )
    : measured;

  return {
    box: {
      x: origin.x,
      y: origin.y,
      width: own.width,
      height: own.height,
    },
    layoutMode,
    paddingTop: finiteOrZero(node.paddingTop),
    paddingRight: finiteOrZero(node.paddingRight),
    paddingBottom: finiteOrZero(node.paddingBottom),
    paddingLeft: finiteOrZero(node.paddingLeft),
    itemSpacing: finiteOrZero(node.itemSpacing),
    cornerRadius: radiusOf(node),
    strokes: strokeOf(node),
    inferred,
    regions: ordered.map((entry) => entry.region),
    type: typeOf(node),
  };
}

function collectFrameNodes(nodes, into) {
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    if (node.type === 'FRAME' || node.type === 'COMPONENT') {
      into.push(node);
      continue;
    }
    if (node.type === 'SECTION') {
      collectFrameNodes(Array.isArray(node.children) ? node.children : [], into);
    }
  }
}

/**
 * One page of the `/v1/files/:key?depth=6` body, projected. Walks only what the response
 * contains; the command never assumes a deeper tree than `depth=6` returned. A `SECTION` is
 * traversed for the frames it holds and never becomes a frame of its own; a frame carries a
 * `layout` only when at least one direct child has a measurable box.
 * @param {unknown} body        the parsed JSON body
 * @param {string} page         the page caption to select, from the map
 * @param {string} fileKey      the key the command asked for; becomes `snapshot.fileKey`
 * @returns {{ fileKey: string, page: string, frames: Array<{
 *   id: string, caption: string, width: number, height: number, fills: string[],
 *   layout?: Record<string, unknown> }> }}
 * @throws {ImportCommandError} 'page_missing' (exit 1) or 'file_invalid' (exit 1)
 */
export function projectPage(body, page, fileKey) {
  if (!isRecord(body) || !isRecord(body.document) || !Array.isArray(body.document.children)) {
    throw invalid('the file body is not a Figma document');
  }
  const canvases = body.document.children.filter(
    (node) => isRecord(node) && node.type === 'CANVAS',
  );
  const names = canvases.map((node) => (typeof node.name === 'string' ? node.name : ''));
  const canvas = canvases.find((node) => node.name === page);
  if (canvas === undefined) {
    const listed = names.length === 0 ? '(none)' : names.join(', ');
    throw new ImportCommandError(
      'page_missing',
      `page '${page}' is absent; the file has: ${listed}`,
      1,
    );
  }

  const frames = [];
  const nodes = [];
  collectFrameNodes(Array.isArray(canvas.children) ? canvas.children : [], nodes);
  for (const node of nodes) {
    const id = node.id;
    if (typeof id !== 'string') throw invalid('a frame is missing its id');
    const box = node.absoluteBoundingBox;
    if (!isRecord(box) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) {
      throw invalid(`frame '${id}' has no size`);
    }
    const caption = node.name;
    if (typeof caption !== 'string') throw invalid(`frame '${id}' is missing its name`);

    const painted = [];
    collectFills(node, id, painted);
    const fills = [];
    const seen = new Set();
    for (const fill of painted) {
      if (seen.has(fill)) continue;
      seen.add(fill);
      fills.push(fill);
    }
    const frame = { id, caption, width: box.width, height: box.height, fills };
    const layout = layoutOf(node, id);
    frames.push(layout === undefined ? frame : { ...frame, layout });
  }

  return { fileKey, page, frames };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

async function requestJson(fetchImpl, url, token) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { 'X-Figma-Token': token } });
  } catch (error) {
    throw new ImportCommandError('http_error', `${url} failed: ${messageOf(error)}`, 1);
  }
  if (!response.ok) {
    throw new ImportCommandError('http_error', `GET ${url} answered ${response.status}`, 1);
  }
  try {
    return await response.json();
  } catch {
    throw new ImportCommandError('http_error', `GET ${url} did not return JSON`, 1);
  }
}

function frameMissing(error) {
  if (error && error.name === 'DesignImportError' && error.code === 'frame_missing') {
    return new ImportCommandError(
      'frame_missing',
      `no frame captioned '${error.caption}' (${error.path})`,
      1,
    );
  }
  return error;
}

async function loadDesign() {
  try {
    const resolved = createRequire(import.meta.url).resolve('@codebox/design');
    return await import(pathToFileURL(resolved).href);
  } catch {
    throw new ImportCommandError(
      'design_package_missing',
      'build @codebox/design first (npm run build -w @codebox/design)',
      2,
    );
  }
}

function sameBytes(path, content) {
  let existing;
  try {
    existing = readFileSync(path);
  } catch {
    return false;
  }
  const expected =
    typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  return existing.equals(expected);
}

/**
 * The whole command. Never throws for a failure it knows: writes `<code>: <message>` to
 * `io.stderr` and resolves with the exit code. An unexpected exception is not caught.
 * @param {string[]} argv
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   cwd?: string,
 *   fetch?: typeof globalThis.fetch,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 *   design?: Record<string, unknown> | null,
 * }} [io]
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  const fetchImpl = io.fetch ?? globalThis.fetch;
  const stdout =
    io.stdout ??
    ((line) => {
      process.stdout.write(line);
    });
  const stderr =
    io.stderr ??
    ((line) => {
      process.stderr.write(line);
    });
  const provided = io.design ?? null;

  try {
    const options = parseArgs(argv);
    if (options.help) {
      stdout(`${USAGE}\n`);
      return 0;
    }

    const token = env.FIGMA_TOKEN;
    if (typeof token !== 'string' || token === '') {
      throw new ImportCommandError(
        'token_missing',
        'FIGMA_TOKEN is not set (export it; the command does not read .env)',
        2,
      );
    }
    const envKey = env.FIGMA_FILE_KEY;
    const key = options.file ?? (typeof envKey === 'string' && envKey !== '' ? envKey : null);
    if (key === null) {
      throw new ImportCommandError(
        'file_missing',
        'FIGMA_FILE_KEY is not set and --file was not given',
        2,
      );
    }

    const design = provided ?? (await loadDesign());
    const root = options.root === null ? cwd : resolve(cwd, options.root);
    const mapPath =
      options.map === null
        ? join(root, design.DESIGN_DIR, 'import.json')
        : resolve(cwd, options.map);

    let mapText;
    try {
      mapText = readFileSync(mapPath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new ImportCommandError('map_missing', `${mapPath} is missing`, 2);
      }
      throw error;
    }

    let map;
    try {
      map = design.parseImportMap(JSON.parse(mapText));
    } catch (error) {
      if (error && error.name === 'DesignImportError' && error.code === 'map_invalid') {
        stderr('map_invalid: invalid import map\n');
        for (const issue of error.issues) stderr(`  ${issue.path}: ${issue.message}\n`);
        return 1;
      }
      if (error instanceof SyntaxError) {
        stderr('map_invalid: invalid import map\n');
        return 1;
      }
      throw error;
    }

    if (map.fileKey !== key) {
      throw new ImportCommandError(
        'file_mismatch',
        `the map is for '${map.fileKey}' but the command was given '${key}'`,
        2,
      );
    }

    const fileUrl = `${FIGMA_API}/v1/files/${encodeURIComponent(key)}?depth=6`;
    const body = await requestJson(fetchImpl, fileUrl, token);
    const snapshot = projectPage(body, map.page, key);

    try {
      design.importDesign({ snapshot, map });
    } catch (error) {
      throw frameMissing(error);
    }

    let tokens = null;
    let tokenValues = null;
    try {
      const tokensDocument = JSON.parse(readFileSync(join(root, design.TOKENS_PATH), 'utf8'));
      tokens = design.parseTokens(tokensDocument);
      tokenValues = design.tokenValues(tokens);
    } catch {
      tokens = null;
      tokenValues = null;
      stderr(`tokens_unavailable: ${design.TOKENS_PATH}\n`);
    }

    const targets = [];
    for (const entry of map.frames) {
      if (entry.snapshot !== true) continue;
      const frame = snapshot.frames.find((candidate) => candidate.caption === entry.caption);
      targets.push({ caption: entry.caption, frame });
    }

    // A caption is untrusted Figma data; a null prototype keeps `__proto__` a plain key.
    const exported = Object.create(null);
    if (targets.length > 0) {
      const ids = targets.map((target) => target.frame.id).join(',');
      const imagesUrl = `${FIGMA_API}/v1/images/${encodeURIComponent(key)}?ids=${ids}&format=png&scale=2`;
      const imagesBody = await requestJson(fetchImpl, imagesUrl, token);
      if (isRecord(imagesBody) && imagesBody.err !== null && imagesBody.err !== undefined) {
        throw new ImportCommandError('export_missing', String(imagesBody.err), 1);
      }
      const images = isRecord(imagesBody) && isRecord(imagesBody.images) ? imagesBody.images : {};
      for (const target of targets) {
        const url = images[target.frame.id];
        if (typeof url !== 'string' || url === '') {
          throw new ImportCommandError('export_missing', `no export for '${target.caption}'`, 1);
        }
        let response;
        try {
          response = await fetchImpl(url);
        } catch (error) {
          throw new ImportCommandError('http_error', `${url} failed: ${messageOf(error)}`, 1);
        }
        if (!response.ok) {
          throw new ImportCommandError(
            'export_missing',
            `${target.caption} export answered ${response.status}`,
            1,
          );
        }
        try {
          exported[target.caption] = new Uint8Array(await response.arrayBuffer());
        } catch {
          throw new ImportCommandError('export_missing', `no export for '${target.caption}'`, 1);
        }
      }
    }

    let result;
    try {
      result = design.importDesign({
        snapshot,
        map,
        exports: exported,
        tokens: tokens ?? undefined,
      });
    } catch (error) {
      throw frameMissing(error);
    }

    let coloursOutsideTokens = null;
    if (tokenValues !== null) {
      const known = new Set(tokenValues);
      const outside = result.colours.filter((colour) => !known.has(colour));
      coloursOutsideTokens = outside.length;
      for (const colour of outside) stderr(`colour outside tokens: ${colour}\n`);
    }

    const routesContent = `${JSON.stringify({ routes: result.routes }, null, 2)}\n`;
    const screens = result.screens.map((spec) => ({
      relative: `${design.SCREENS_DIR}/${screenSlug(spec.screen)}.json`,
      content: `${JSON.stringify(spec, null, 2)}\n`,
    }));
    const exportedFiles = result.screens
      .map((spec, index) => ({ spec, entry: map.frames[index] }))
      .filter((item) => item.entry !== undefined && item.entry.snapshot === true)
      .map((item) => ({
        relative: `${design.EXPORTS_DIR}/${screenSlug(item.spec.screen)}.png`,
        content: exported[item.entry.caption],
      }));

    let drifted = false;
    if (options.check) {
      const artifacts = [
        { relative: design.ROUTES_PATH, content: routesContent },
        ...screens,
        ...exportedFiles,
      ];
      for (const artifact of artifacts) {
        if (sameBytes(join(root, artifact.relative), artifact.content)) continue;
        drifted = true;
        stderr(`drift: ${artifact.relative}\n`);
      }
    } else {
      mkdirSync(join(root, design.SCREENS_DIR), { recursive: true });
      mkdirSync(join(root, design.EXPORTS_DIR), { recursive: true });
      writeFileSync(join(root, design.ROUTES_PATH), routesContent);
      stdout(`wrote ${design.ROUTES_PATH} (${result.routes.length} routes)\n`);
      for (const screen of screens) {
        writeFileSync(join(root, screen.relative), screen.content);
        stdout(`wrote ${screen.relative}\n`);
      }
      for (const file of exportedFiles) {
        writeFileSync(join(root, file.relative), file.content);
        stdout(`wrote ${file.relative} (${file.content.length} bytes)\n`);
      }
    }

    const mappedCaptions = new Set(map.frames.map((entry) => entry.caption));
    const matchedCaptions = new Set(
      snapshot.frames
        .filter((frame) => mappedCaptions.has(frame.caption))
        .map((frame) => frame.caption),
    );
    const summary = {
      frames: snapshot.frames.length,
      mapped: map.frames.length,
      unmapped: snapshot.frames.length - matchedCaptions.size,
      colours: result.colours.length,
      coloursOutsideTokens,
      routes: result.routes.length,
      screens: result.screens.length,
      exports: exportedFiles.length,
    };
    stdout(`${JSON.stringify(summary)}\n`);

    return drifted ? 1 : 0;
  } catch (error) {
    if (error instanceof ImportCommandError) {
      stderr(`${error.code}: ${error.message}\n`);
      if (error.code === 'usage') stderr(`${USAGE}\n`);
      return error.exitCode;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
