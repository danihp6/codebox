#!/usr/bin/env node
import { run } from '../dist/cli/main.js';

try {
  process.exitCode = await run({ argv: process.argv.slice(2) });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cb: ${message}\n`);
  process.exitCode = 5;
}
