#!/usr/bin/env node

// One work order, opened at most once. A model that opens an issue by hand can open it twice
// — a retried step, a second agent, a resumed cycle — and the measurement backlog doubles
// (#22/#23, 2026-10-26). This module lists the open `agent-review` and `agent-blocked`
// issues, matches the requested title and either creates one issue or comments on the lowest
// matching number. It never closes, relabels or edits an existing issue.
//
// `listOpen` reads at most 200 open issues. That is a bound, not a pagination: a work order
// outside the first 200 open issues reads as absent.
//
// Residual race, stated on purpose: GitHub has no unique constraint on an issue title, so two
// processes that both list before either creates can still both create. This helper shrinks
// the window from "a model checks by hand" to "one list and one create" and reports
// `duplicates` so the cycle sees a pair when it happens. It is not atomic.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The two labels a work order may carry. Frozen. */
export const HANDOFF_LABELS = ['agent-review', 'agent-blocked'];

const AGAIN = 'Reported again by a second attempt; the original report stands.';
const LIST_LIMIT = '200';
const FLAGS = ['--label', '--title', '--body', '--body-file'];

/** @typedef {{ number: number, title: string, labels: string[] }} OpenIssue */

class UsageError extends Error {}

/**
 * Trim, collapse runs of whitespace to one space and lowercase. The comparison key of a
 * title. Exported so the test can pin it.
 * @param {string} title
 * @returns {string}
 */
export function titleKey(title) {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Every open issue whose `titleKey` equals `titleKey(title)` and whose labels include one of
 * HANDOFF_LABELS, ascending by `number`.
 * @param {OpenIssue[]} issues
 * @param {string} title
 * @returns {{ number: number, title: string }[]}
 */
export function findDuplicates(issues, title) {
  const key = titleKey(title);
  return issues
    .filter((issue) => HANDOFF_LABELS.some((label) => issue.labels.includes(label)))
    .filter((issue) => titleKey(issue.title) === key)
    .map((issue) => ({ number: issue.number, title: issue.title }))
    .sort((left, right) => left.number - right.number);
}

/**
 * The decision, as a pure function.
 * @param {{ issues: OpenIssue[], title: string, label: string }} input
 * @returns {{ action: 'create', title: string, label: string, duplicates: number[] }
 *         | { action: 'comment', number: number, title: string, label: string, duplicates: number[] }}
 */
export function decideHandoff({ issues, title, label }) {
  assertLabel(label);
  const clean = normaliseTitle(title);
  const duplicates = findDuplicates(issues, title).map((issue) => issue.number);
  if (duplicates.length > 0) {
    return { action: 'comment', number: duplicates[0], title: clean, label, duplicates };
  }
  return { action: 'create', title: clean, label, duplicates };
}

/**
 * The effect. Lists once, decides, then creates or comments — never both.
 * @param {{
 *   gh: GhPort,
 *   title: string,
 *   label: string,
 *   body: string,
 * }} input
 * @returns {Promise<{ action: 'created' | 'commented', number: number, url: string, duplicates: number[] }>}
 */
export async function handoff({ gh, title, label, body }) {
  assertLabel(label);
  const issues = await gh.listOpen();
  const decision = decideHandoff({ issues, title, label });
  if (decision.action === 'comment') {
    const { url } = await gh.comment({ number: decision.number, body: `${AGAIN}\n\n${body}` });
    return {
      action: 'commented',
      number: decision.number,
      url,
      duplicates: decision.duplicates,
    };
  }
  const created = await gh.create({ title: decision.title, label: decision.label, body });
  return {
    action: 'created',
    number: created.number,
    url: created.url,
    duplicates: decision.duplicates,
  };
}

/**
 * The real `gh` adapter. The only place in this module that spawns a process.
 * @returns {GhPort}
 */
export function createGhPort() {
  return {
    async listOpen() {
      const output = gh([
        'issue',
        'list',
        '--state',
        'open',
        '--limit',
        LIST_LIMIT,
        '--json',
        'number,title,labels',
      ]);
      return JSON.parse(output).map((row) => ({
        number: row.number,
        title: row.title,
        labels: (row.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)),
      }));
    },
    async create({ title, label, body }) {
      const output = gh(
        ['issue', 'create', '--label', label, '--title', title, '--body-file', '-'],
        body,
      );
      const url = lastLine(output);
      return { number: issueNumber(url), url };
    },
    async comment({ number, body }) {
      const output = gh(['issue', 'comment', String(number), '--body-file', '-'], body);
      return { url: lastLine(output) };
    },
  };
}

/**
 * @typedef {object} GhPort
 * @property {() => Promise<OpenIssue[]>} listOpen
 *   `gh issue list --state open --limit 200 --json number,title,labels`, normalised to
 *   `{ number, title, labels: string[] }`.
 * @property {(input: { title: string, label: string, body: string }) => Promise<{ number: number, url: string }>} create
 *   `gh issue create --label <label> --title <title> --body-file -`.
 * @property {(input: { number: number, body: string }) => Promise<{ url: string }>} comment
 *   `gh issue comment <number> --body-file -`.
 */

function normaliseTitle(title) {
  return title.trim().replace(/\s+/g, ' ');
}

function assertLabel(label) {
  if (!HANDOFF_LABELS.includes(label)) throw new Error(`unknown handoff label: ${label}`);
}

function gh(args, input) {
  const result = spawnSync('gh', args, { input, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const message = (result.stderr ?? '').trim();
    throw new Error(message || `gh ${args[0]} ${args[1]} exited with status ${result.status}`);
  }
  return result.stdout ?? '';
}

function lastLine(output) {
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.length > 0 ? lines[lines.length - 1].trim() : '';
}

function issueNumber(url) {
  const match = /(\d+)$/.exec(url);
  if (!match) throw new Error(`gh printed no issue number: ${url}`);
  return Number(match[1]);
}

function readBody(source) {
  return readFileSync(source === '-' ? 0 : source, 'utf8');
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!FLAGS.includes(name)) throw new UsageError(`unknown argument: ${name}`);
    const value = argv[index + 1];
    if (value === undefined) throw new UsageError(`missing value for ${name}`);
    values[name.slice(2)] = value;
  }
  if (!values.title) throw new UsageError('missing --title');
  if (values.body === undefined && values['body-file'] === undefined) {
    throw new UsageError('missing --body or --body-file');
  }
  const body = values.body ?? readBody(values['body-file']);
  return { label: values.label, title: values.title, body };
}

function report(error, code) {
  process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
  process.exitCode = code;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    report(error, error instanceof UsageError ? 2 : 1);
    return;
  }
  try {
    const result = await handoff({ gh: createGhPort(), ...options });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    report(error, 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
