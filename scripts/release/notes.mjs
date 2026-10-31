#!/usr/bin/env node

// Release notes come from the changelog that is already in the tree: the section for the tag,
// or `## Unreleased` when the tag has none. The changelog is read and never written — the
// entry is authored in a pull request, not by the release job.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = `usage: node scripts/release/notes.mjs --version V [--changelog FILE] [--out FILE] [--help]

  --version V      the release version the section must name
  --changelog FILE the markdown to read (default 'CHANGELOG.md')
  --out FILE       write the notes here instead of stdout
  --help           this text
`;

/** The heading the notes need is absent, or present and empty. */
export class ReleaseNotesMissingError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ReleaseNotesMissingError';
  }
}

/** @param {string} text @returns {string} */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `# Codebox <version>` plus the body of `## [<version>]` (an optional date may follow the
 * bracket) or, when that heading is absent, of `## Unreleased`. The body stops at the next
 * level-2 heading and is trimmed; an empty body is a release without notes, which is a
 * failure rather than an empty release.
 * @param {{ markdown: string, version: string }} input
 * @returns {string}
 */
export function releaseNotes(input) {
  const lines = input.markdown.split('\n');
  const versioned = new RegExp(`^##\\s+\\[${escapeRegExp(input.version)}\\](?:\\s|$)`);
  const start = lines.findIndex((line) => versioned.test(line));
  const heading =
    start === -1 ? lines.findIndex((line) => /^##\s+Unreleased\s*$/.test(line)) : start;
  if (heading === -1) {
    throw new ReleaseNotesMissingError(
      `no '## [${input.version}]' or '## Unreleased' section for ${input.version}`,
    );
  }
  let end = heading + 1;
  while (end < lines.length && !/^## /.test(lines[end])) end += 1;
  const body = lines
    .slice(heading + 1, end)
    .join('\n')
    .trim();
  if (body === '') {
    throw new ReleaseNotesMissingError(`the section for ${input.version} is empty`);
  }
  return `# Codebox ${input.version}\n\n${body}`;
}

function parseArgs(argv) {
  const options = { version: null, changelog: 'CHANGELOG.md', out: null, help: false };
  const valued = new Set(['--version', '--changelog', '--out']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const equals = arg.indexOf('=');
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (!valued.has(flag)) {
      process.stderr.write(`unknown option '${arg}'\n\n${USAGE}`);
      return { exitCode: 2 };
    }
    let value;
    if (equals === -1) {
      value = argv[index + 1];
      index += 1;
    } else {
      value = arg.slice(equals + 1);
    }
    if (value === undefined || value === '') {
      process.stderr.write(`'${flag}' needs a value\n\n${USAGE}`);
      return { exitCode: 2 };
    }
    if (flag === '--version') options.version = value;
    else if (flag === '--changelog') options.changelog = value;
    else options.out = value;
  }
  return { options };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.exitCode !== undefined) return parsed.exitCode;
  const options = parsed.options;
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (options.version === null) {
    process.stderr.write(`--version is required\n\n${USAGE}`);
    return 2;
  }
  let markdown;
  try {
    markdown = readFileSync(resolve(options.changelog), 'utf8');
  } catch (error) {
    process.stderr.write(`cannot read ${options.changelog}: ${error.message}\n`);
    return 2;
  }
  let notes;
  try {
    notes = releaseNotes({ markdown, version: options.version });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return error instanceof ReleaseNotesMissingError ? 4 : 1;
  }
  const text = notes.endsWith('\n') ? notes : `${notes}\n`;
  if (options.out === null) {
    process.stdout.write(text);
  } else {
    writeFileSync(resolve(options.out), text);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
