import { describe, expect, it } from 'vitest';
import { toCreateBody, validateRepoForm } from './repo-form';
import type { RepoFormValues } from './repo-form';

const VALID: RepoFormValues = {
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm ci && npm test',
  protectedPaths: '',
};

describe('validateRepoForm', () => {
  it('accepts owner/name with a branch and a gate', () => {
    expect(validateRepoForm(VALID)).toEqual([]);
    expect(validateRepoForm({ ...VALID, protectedPaths: '.github/**\nops/**' })).toEqual([]);
  });

  it('rejects a slug that is not exactly one owner/name pair', () => {
    for (const slug of ['widgets', 'a/b/c', ' / ']) {
      expect(validateRepoForm({ ...VALID, slug }), slug).toEqual(['slug']);
    }
  });

  it('rejects an empty gate', () => {
    expect(validateRepoForm({ ...VALID, gate: '   ' })).toEqual(['gate']);
  });

  it('rejects a branch with a space', () => {
    expect(validateRepoForm({ ...VALID, defaultBranch: 'two words' })).toEqual(['defaultBranch']);
    expect(validateRepoForm({ ...VALID, defaultBranch: 'feature/..main' })).toEqual([
      'defaultBranch',
    ]);
  });

  it('reports every problem at once', () => {
    expect(
      validateRepoForm({ slug: 'widgets', defaultBranch: '', gate: '', protectedPaths: '' }),
    ).toEqual(['slug', 'defaultBranch', 'gate']);
  });
});

describe('toCreateBody', () => {
  it('omits protectedPaths when the textarea is empty', () => {
    const body = toCreateBody(VALID);
    expect(body).toEqual({
      slug: 'acme/widgets',
      defaultBranch: 'main',
      gate: 'npm ci && npm test',
    });
    expect('protectedPaths' in body).toBe(false);
  });

  it('omits protectedPaths when the textarea holds only blank lines', () => {
    expect('protectedPaths' in toCreateBody({ ...VALID, protectedPaths: ' \n\t\n' })).toBe(false);
  });

  it('splits the textarea into one glob per line', () => {
    const body = toCreateBody({ ...VALID, protectedPaths: '.github/**\nops/**' });
    expect(body.protectedPaths).toEqual(['.github/**', 'ops/**']);
  });

  it('trims every field it sends', () => {
    const body = toCreateBody({
      slug: '  acme/widgets ',
      defaultBranch: ' main ',
      gate: ' npm test ',
      protectedPaths: ' ops/** \n',
    });
    expect(body).toEqual({
      slug: 'acme/widgets',
      defaultBranch: 'main',
      gate: 'npm test',
      protectedPaths: ['ops/**'],
    });
  });
});
