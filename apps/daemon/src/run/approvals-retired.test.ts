import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceDir = path.resolve(import.meta.dirname, '..');

function sources(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sources(full));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(full);
  }
  return files;
}

describe('the approval inbox is retired from the agent paths', () => {
  it('finds no daemon source that creates an approval row', () => {
    const files = sources(sourceDir);

    expect(files.length).toBeGreaterThan(60);
    const writers = files.filter((file) =>
      readFileSync(file, 'utf8').includes('approvals.create('),
    );
    expect(writers).toEqual([]);
  });

  it('leaves no chat subsystem to carry an approval table', () => {
    expect(existsSync(path.join(sourceDir, 'chat'))).toBe(false);
    expect(existsSync(path.join(sourceDir, 'routines'))).toBe(false);
  });
});
