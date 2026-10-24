import { describe, expect, it } from 'vitest';
import { classify, collect, parseTodo, renderReport, specPath } from './recon.mjs';

const todo = `# Plan

- [ ] **[Task-68]** the MOVES tab
- [x] **[Task-66]** shipped
- [!] **[Task-67]** blocked for a reason
- [!] **[Task-67] The 61 descriptions** duplicated in another section
- [ ] **[Task-90]** not a branch yet
- [ ] **[Task-70]** in flight
`;

describe('parseTodo', () => {
  it('reads open, blocked and shipped marks', () => {
    const parsed = parseTodo(todo);
    expect(parsed.isOpen('68')).toBe(true);
    expect(parsed.isOpen('66')).toBe(false);
    expect(parsed.isBlocked('67')).toBe(true);
    expect(parsed.isOpen('67')).toBe(false);
    expect(parsed.openCount).toBe(3);
    expect(parsed.blockedCount).toBe(1);
  });

  it('lets an open duplicate win over a blocked one', () => {
    const parsed = parseTodo('- [!] **[Task-5]** blocked\n- [ ] **[Task-5]** freed\n');
    expect(parsed.isOpen('5')).toBe(true);
    expect(parsed.isBlocked('5')).toBe(false);
  });

  it('reads CRLF files and ignores other list items', () => {
    const parsed = parseTodo('- [ ] **not a task**\r\n- [ ] **[Task-12]** x\r\n');
    expect(parsed.openCount).toBe(1);
    expect(parsed.isOpen('12')).toBe(true);
  });
});

describe('classify', () => {
  it('treats a merged branch as shipped even when the task is gone from TODO', () => {
    expect(classify({ merged: true, open: false, blocked: false, subject: 'dev: done task-1' })).toBe(
      'merged',
    );
  });

  it('reads the tip marker as the turnstile', () => {
    const base = { merged: false, open: true, blocked: false };
    expect(classify({ ...base, subject: 'qa: pass task-1' })).toBe('ship');
    expect(classify({ ...base, subject: 'dev: done task-1' })).toBe('qa');
    expect(classify({ ...base, subject: 'feat: half a task' })).toBe('partial');
  });

  it('prunes a branch of a blocked task and flags a taskless one', () => {
    expect(classify({ merged: false, open: false, blocked: true, subject: 'dev: done task-1' })).toBe(
      'blocked',
    );
    expect(classify({ merged: false, open: false, blocked: false, subject: 'qa: pass task-9' })).toBe(
      'orphan',
    );
  });
});

describe('renderReport', () => {
  const base = { sha: 'aad7b7b1111', iso: '2026-10-19T21:02:35Z' };

  it('says to cut a batch when nothing is alive', () => {
    const report = renderReport({ base, todo: parseTodo(todo), branches: [] });
    expect(report).toContain('No task branch is alive');
    expect(report).toContain('3 open · 1 blocked');
  });

  it('orders ship before qa before partial and names the next action', () => {
    const parsed = parseTodo(todo);
    const state = {
      base,
      todo: parsed,
      branches: [
        { id: '90', sha: 'c3333333', subject: 'dev: done task-90', hasSpec: true, merged: false, state: 'qa' },
        { id: '68', sha: 'b2222222', subject: 'qa: pass task-68', hasSpec: true, merged: false, state: 'ship' },
        {
          id: '70',
          sha: 'd4444444',
          subject: 'feat: half a task',
          hasSpec: false,
          merged: false,
          state: 'partial',
        },
      ],
    };
    state.branches.sort(
      (a, b) =>
        ({ ship: 0, qa: 1, partial: 2 })[a.state] - ({ ship: 0, qa: 1, partial: 2 })[b.state],
    );
    const report = renderReport(state, '2026-10-20T00:00:00Z');
    expect(report.indexOf('Task-68')).toBeLessThan(report.indexOf('Task-90'));
    expect(report.indexOf('Task-90')).toBeLessThan(report.indexOf('Task-70'));
    expect(report).toContain('**ship**');
    expect(report).toContain('**qa**');
    expect(report).toContain('**partial**');
    expect(report).toContain(
      `git show origin/task-68:${specPath('68')} > ${specPath('68')}`,
    );
    expect(report).not.toContain('task-70:');
    expect(report).toContain('read at 2026-10-20T00:00:00Z');
  });
});

describe('collect', () => {
  it('reads refs, detects merged branches and missing specs', () => {
    const calls = [];
    const git = (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'rev-parse') return 'aad7b7b1\n';
      if (args[0] === 'log') return '2026-10-19T21:02:35Z\n';
      if (args[0] === 'for-each-ref') {
        return [
          'refs/remotes/origin/task-68\tb2222222\tqa: pass task-68',
          'refs/remotes/origin/task-90\tc3333333\tdev: done task-90',
          'refs/remotes/origin/task-70\td4444444\tfeat: half',
        ].join('\n');
      }
      if (args[0] === 'merge-base') {
        if (args[2] === 'b2222222') return '';
        throw Object.assign(new Error('exit 1'), { status: 1 });
      }
      if (args[0] === 'cat-file') {
        if (args[2] === 'b2222222:.agent_specs/task-68.md') return '';
        throw Object.assign(new Error('exit 1'), { status: 1 });
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    };
    const parsed = parseTodo(todo);
    const state = collect(git, parsed);
    const byId = Object.fromEntries(state.branches.map((branch) => [branch.id, branch]));

    expect(byId['68'].merged).toBe(true);
    expect(byId['68'].state).toBe('merged');
    expect(byId['68'].hasSpec).toBe(true);
    expect(byId['90'].merged).toBe(false);
    expect(byId['90'].state).toBe('qa');
    expect(byId['90'].hasSpec).toBe(false);
    expect(byId['70'].state).toBe('partial');
    expect(calls).toContain('merge-base --is-ancestor b2222222 origin/main');
  });
});
