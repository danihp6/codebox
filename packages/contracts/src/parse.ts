import { z } from 'zod';

export interface ParseIssue {
  path: string;
  message: string;
  code: string;
}

export class ContractParseError extends Error {
  readonly boundary: string;
  readonly issues: readonly ParseIssue[];
  /** The first issue, never undefined; `path` is the field that failed. */
  readonly first: ParseIssue;

  constructor(boundary: string, issues: readonly ParseIssue[]) {
    const first = issues[0] ?? {
      path: boundary,
      message: 'invalid input',
      code: 'custom',
    };
    super(`Invalid ${first.path}: ${first.message}`);
    this.name = 'ContractParseError';
    this.boundary = boundary;
    this.issues = issues;
    this.first = first;
  }
}

export function toParseIssues(error: z.ZodError, boundary: string): ParseIssue[] {
  const issues: ParseIssue[] = [];
  for (const issue of error.issues) {
    const base = [boundary, ...issue.path.map((segment) => String(segment))];
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        issues.push({
          path: [...base, key].join('.'),
          message: issue.message,
          code: issue.code,
        });
      }
      continue;
    }
    issues.push({ path: base.join('.'), message: issue.message, code: issue.code });
  }
  return issues;
}

export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, boundary: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ContractParseError(boundary, toParseIssues(result.error, boundary));
  }
  return result.data;
}

/**
 * Same contract as `parseOrThrow`, with one hook that lets `parseConfig` hide the value of a
 * secret key before the issue leaves the boundary. Internal: the package entry point does not
 * re-export it.
 */
export function parseOrThrowRedacted<T>(
  schema: z.ZodType<T>,
  input: unknown,
  boundary: string,
  sanitise: (issue: ParseIssue) => ParseIssue,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = toParseIssues(result.error, boundary).map(sanitise);
    throw new ContractParseError(boundary, issues);
  }
  return result.data;
}
