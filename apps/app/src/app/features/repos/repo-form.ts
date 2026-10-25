import { branchSchema, slugSchema } from '@codebox/contracts';
import type { RepoCreateBody } from './repos.api';

export interface RepoFormValues {
  readonly slug: string;
  readonly defaultBranch: string;
  readonly gate: string;
  readonly protectedPaths: string;
}

export type RepoFormProblem = 'slug' | 'defaultBranch' | 'gate';

export function validateRepoForm(values: RepoFormValues): readonly RepoFormProblem[] {
  const problems: RepoFormProblem[] = [];
  if (!slugSchema.safeParse(values.slug.trim()).success) problems.push('slug');
  if (!branchSchema.safeParse(values.defaultBranch.trim()).success) problems.push('defaultBranch');
  if (values.gate.trim() === '') problems.push('gate');
  return problems;
}

export function toCreateBody(values: RepoFormValues): RepoCreateBody {
  const protectedPaths = splitProtectedPaths(values.protectedPaths);
  const body: {
    slug: string;
    defaultBranch: string;
    gate: string;
    protectedPaths?: readonly string[];
  } = {
    slug: values.slug.trim(),
    defaultBranch: values.defaultBranch.trim(),
    gate: values.gate.trim(),
  };
  if (protectedPaths.length > 0) body.protectedPaths = protectedPaths;
  return body;
}

export function splitProtectedPaths(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
