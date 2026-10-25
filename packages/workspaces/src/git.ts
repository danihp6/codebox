import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

import { gitStartFailure } from './errors.js';
import type { GitCommandInput, GitResult, GitRunner } from './types.js';

export const GIT_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: '/usr/local/bin:/usr/bin:/bin',
  HOME: homedir(),
  GIT_TERMINAL_PROMPT: '0',
  LC_ALL: 'C',
});

export function createGitRunner(): GitRunner {
  return {
    run(input: GitCommandInput): Promise<GitResult> {
      return new Promise<GitResult>((resolve, reject) => {
        const child = spawn('git', [...input.args], {
          cwd: input.cwd,
          env: { ...input.env },
          shell: false,
          timeout: input.timeoutMs,
          killSignal: 'SIGKILL',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout?.on('data', (chunk: Buffer) => {
          stdout.push(chunk);
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr.push(chunk);
        });
        child.once('error', reject);
        child.once('close', (code) => {
          resolve({
            code: code ?? 1,
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
          });
        });
      });
    },
  };
}

export interface GitCall {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}

export async function runGit(git: GitRunner, call: GitCall): Promise<GitResult> {
  const command = call.args[0] ?? 'git';
  try {
    return await git.run({
      args: call.args,
      cwd: call.cwd,
      timeoutMs: call.timeoutMs,
      env: GIT_ENV,
    });
  } catch {
    throw gitStartFailure(command);
  }
}
