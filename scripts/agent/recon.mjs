#!/usr/bin/env node

// The cycle's durable state, read from git refs instead of inferred by an agent:
// `origin/main` holds what shipped, a live `origin/task-<ID>` holds a task in
// flight, and the subject of that branch's tip says whose turn it is. This file is
// the one place that turns those refs into a table an Orchestrator can act on.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const TASK_LINE = /^\s*-\s*\[([ x!])\]\s*\*\*\[Task-(\d+)\]/;
const TASK_BRANCH = /^refs\/remotes\/origin\/task-(\d+)$/;

export const specPath = (id) => `.agent_specs/task-${id}.md`;

const QA_MARK = 'qa: pass';
const DEV_MARK = 'dev: done';

export function parseTodo(text) {
  const open = new Set();
  const blocked = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = TASK_LINE.exec(line);
    if (!match) continue;
    const [, mark, id] = match;
    if (mark === ' ') open.add(id);
    else if (mark === '!') blocked.add(id);
  }
  return {
    isOpen: (id) => open.has(id),
    isBlocked: (id) => !open.has(id) && blocked.has(id),
    openCount: open.size,
    blockedCount: blocked.size,
  };
}

export function classify({ merged, open, blocked, subject }) {
  if (merged) return 'merged';
  if (blocked) return 'blocked';
  if (!open) return 'orphan';
  if (subject.startsWith(QA_MARK)) return 'ship';
  if (subject.startsWith(DEV_MARK)) return 'qa';
  return 'partial';
}

export function collect(git, done, base = 'origin/main') {
  const baseSha = git(['rev-parse', base]).trim();
  const baseIso = git(['log', '-1', '--format=%cI', base]).trim();
  const lines = git([
    'for-each-ref',
    '--format=%(refname)\t%(objectname)\t%(subject)',
    'refs/remotes/origin/task-*',
  ])
    .split(/\r?\n/)
    .filter(Boolean);

  const branches = [];
  for (const line of lines) {
    const [ref, sha, subject] = line.split('\t');
    const id = TASK_BRANCH.exec(ref)?.[1];
    if (!id) continue;
    const merged = isAncestor(git, sha, base);
    const hasSpec = hasFile(git, sha, specPath(id));
    const state = classify({
      merged,
      open: done.isOpen(id),
      blocked: done.isBlocked(id),
      subject,
    });
    branches.push({ id, sha, subject, merged, hasSpec, state });
  }

  const rank = { ship: 0, qa: 1, partial: 2, blocked: 3, orphan: 4, merged: 5 };
  branches.sort((a, b) => rank[a.state] - rank[b.state] || Number(a.id) - Number(b.id));

  return { base: { sha: baseSha, iso: baseIso }, todo: done, branches };
}

function isAncestor(git, sha, ref) {
  try {
    git(['merge-base', '--is-ancestor', sha, ref]);
    return true;
  } catch {
    return false;
  }
}

function hasFile(git, sha, path) {
  try {
    git(['cat-file', '-e', `${sha}:${path}`]);
    return true;
  } catch {
    return false;
  }
}

const NEXT = {
  ship: 'merge, tick, changelog, gate, one push',
  qa: 'run Task QA from an integration worktree',
  partial: 'the dev did not finish: delete the branch and redo the task',
  blocked: 'the task is `[!]`: delete the branch',
  orphan: 'the branch has no open task: needs a human',
  merged: 'already in main: prune the branch',
};

export function renderReport(state, now = '') {
  const { base, todo, branches } = state;
  const lines = [];
  lines.push('# Cycle resume state', '');
  lines.push(
    'Read this before cutting anything. **A live `task-*` branch is a task already',
    'in flight: adopt those tasks instead of cutting a new batch.**',
    '',
  );
  lines.push(`- base: \`origin/main\` @ \`${base.sha.slice(0, 7)}\` (${base.iso})`);
  lines.push(`- queue: ${todo.openCount} open · ${todo.blockedCount} blocked`);
  lines.push(`- branches alive: ${branches.length}${now ? ` · read at ${now}` : ''}`, '');

  if (branches.length === 0) {
    lines.push(
      'No task branch is alive: cut the lowest pending batch of the plan.',
      '',
    );
    return `${lines.join('\n')}\n`;
  }

  lines.push('| Task | Tip | Marker | Spec | State | Next |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const branch of branches) {
    const marker = branch.subject.length > 44 ? `${branch.subject.slice(0, 41)}...` : branch.subject;
    lines.push(
      `| Task-${branch.id} | \`${branch.sha.slice(0, 7)}\` | \`${marker}\` | ${branch.hasSpec ? 'yes' : 'no'} | **${branch.state}** | ${NEXT[branch.state]} |`,
    );
  }

  const specs = branches.filter((branch) => branch.hasSpec && !branch.merged);
  if (specs.length > 0) {
    lines.push('', 'Restore a spec with:');
    for (const branch of specs) {
      lines.push(
        `- Task-${branch.id}: \`git show origin/task-${branch.id}:${specPath(branch.id)} > ${specPath(branch.id)}\``,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function arg(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function main() {
  const argv = process.argv.slice(2);
  const todoPath = arg(argv, '--todo', 'TODO.md');
  const outPath = arg(argv, '--out', '.agent_specs/resume.md');
  const base = arg(argv, '--base', 'origin/main');

  const todo = parseTodo(readFileSync(todoPath, 'utf8'));
  const state = collect(runGit, todo, base);
  const report = renderReport(state, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report);
  process.stdout.write(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
