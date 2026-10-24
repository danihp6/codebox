#!/usr/bin/env node

// The cycle's verdict, as a pure function. The job's conclusion is the outcome, not
// `opencode`'s exit code: a red gate fails whatever else happened, a moved `main` or a
// new issue is a green cycle even when the model stream died after shipping, and a
// cycle that moved nothing and opened nothing is the failure mode the guard exists for.

/**
 * @param {object} input
 * @param {boolean} input.gateOk   `npm ci` + lint + test + build on the merged tree
 * @param {boolean} input.agentOk  the orchestrator's own exit status
 * @param {boolean} input.moved    `main` moved during the cycle
 * @param {boolean} input.issued   an issue was opened during the cycle
 * @param {boolean} input.merge    merge was authorised for this run
 */
export function decideVerdict({ gateOk, agentOk, moved, issued, merge }) {
  if (!gateOk) {
    return { ok: false, status: 'failed', reason: 'the merged tree does not pass the gate' };
  }
  if (moved || issued) {
    return agentOk
      ? { ok: true, status: 'shipped', reason: 'main moved and/or an issue was opened' }
      : { ok: true, status: 'resumed', reason: 'interrupted, but it left a trace' };
  }
  if (!merge && agentOk) {
    return { ok: true, status: 'stopped', reason: 'stopped after QA on purpose (merge disabled)' };
  }
  return {
    ok: false,
    status: 'failed',
    reason: 'the cycle moved nothing and opened no issue',
  };
}

function flag(argv, name) {
  const at = argv.indexOf(`--${name}`);
  const value = at === -1 ? 'false' : String(argv[at + 1] ?? 'true');
  return value === 'true' || value === 'yes' || value === '1';
}

if (process.argv[1]?.endsWith('verdict.mjs')) {
  const argv = process.argv.slice(2);
  const verdict = decideVerdict({
    gateOk: flag(argv, 'gate'),
    agentOk: flag(argv, 'agent'),
    moved: flag(argv, 'moved'),
    issued: flag(argv, 'issued'),
    merge: flag(argv, 'merge'),
  });
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
}
