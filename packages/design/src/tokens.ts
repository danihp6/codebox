import { z } from 'zod';
import { DesignDocumentError } from './types.js';
import type { DesignIssue, DesignToken, DesignTokens } from './types.js';

const TOKEN_TYPES = [
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'duration',
  'cubicBezier',
  'number',
] as const;

const TOKEN_RESERVED = ['$value', '$type', '$description'];

const ALIAS_PATTERN = /^\{([^{}\s]+)\}$/;

const tokenTypeSchema = z.enum(TOKEN_TYPES);

const tokenValueSchema = z.union([z.string(), z.number()]);

interface RawLeaf {
  readonly value: string | number;
  readonly type: string | undefined;
  readonly description: string | undefined;
}

function pathOf(segments: readonly string[]): string {
  return segments.join('.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  return typeof value === 'string' ? value : typeof value;
}

function collectLeaves(
  node: Record<string, unknown>,
  segments: readonly string[],
  leaves: Map<string, RawLeaf>,
  issues: DesignIssue[],
): void {
  const keys = Object.keys(node);
  if (keys.includes('$value')) {
    collectLeaf(node, segments, leaves, issues);
    return;
  }
  if (keys.some((key) => key.startsWith('$'))) {
    issues.push({ path: pathOf(segments), message: 'token is missing $value' });
    return;
  }
  for (const key of keys) {
    const child = node[key];
    if (!isRecord(child)) {
      issues.push({ path: pathOf([...segments, key]), message: 'group is not an object' });
      continue;
    }
    collectLeaves(child, [...segments, key], leaves, issues);
  }
}

function collectLeaf(
  node: Record<string, unknown>,
  segments: readonly string[],
  leaves: Map<string, RawLeaf>,
  issues: DesignIssue[],
): void {
  const path = pathOf(segments);
  const unknownKey = Object.keys(node).find((key) => !TOKEN_RESERVED.includes(key));
  if (unknownKey !== undefined) {
    issues.push({ path, message: `unknown token field ${unknownKey}` });
    return;
  }
  const value = tokenValueSchema.safeParse(node['$value']);
  if (!value.success) {
    issues.push({ path, message: 'token $value is not a string or a number' });
    return;
  }
  const rawType = node['$type'];
  let type: string | undefined;
  if (rawType !== undefined) {
    const parsed = tokenTypeSchema.safeParse(rawType);
    if (!parsed.success) {
      issues.push({ path, message: `unknown $type ${describeValue(rawType)}` });
      return;
    }
    type = parsed.data;
  }
  const rawDescription = node['$description'];
  if (rawDescription !== undefined && typeof rawDescription !== 'string') {
    issues.push({ path, message: '$description is not a string' });
    return;
  }
  const aliased = typeof value.data === 'string' && ALIAS_PATTERN.test(value.data);
  if (type === undefined && !aliased) {
    issues.push({ path, message: 'token is missing $type' });
    return;
  }
  leaves.set(path, { value: value.data, type, description: rawDescription });
}

function buildToken(token: {
  readonly value: string | number;
  readonly type: string;
  readonly description: string | undefined;
}): DesignToken {
  if (token.description === undefined) return { $value: token.value, $type: token.type };
  return { $value: token.value, $type: token.type, $description: token.description };
}

function resolveToken(
  key: string,
  leaves: ReadonlyMap<string, RawLeaf>,
  resolved: Map<string, DesignToken>,
  stack: readonly string[],
  issues: DesignIssue[],
): DesignToken | null {
  const done = resolved.get(key);
  if (done !== undefined) return done;
  if (stack.includes(key)) {
    issues.push({ path: key, message: 'alias cycle' });
    return null;
  }
  const leaf = leaves.get(key);
  if (leaf === undefined) return null;
  const target =
    typeof leaf.value === 'string' ? ALIAS_PATTERN.exec(leaf.value)?.[1]?.trim() : undefined;
  let token: DesignToken | null;
  if (target !== undefined) {
    if (!leaves.has(target)) {
      issues.push({ path: key, message: `alias {${target}} does not resolve` });
      return null;
    }
    const aliased = resolveToken(target, leaves, resolved, [...stack, key], issues);
    if (aliased === null) return null;
    token =
      leaf.type === undefined
        ? aliased
        : buildToken({ value: aliased.$value, type: leaf.type, description: leaf.description });
  } else {
    token = buildToken({
      value: leaf.value,
      type: leaf.type ?? '',
      description: leaf.description,
    });
  }
  resolved.set(key, token);
  return token;
}

/**
 * The DTCG document as one flat map. A document that does not parse is a `tokens` boundary
 * failure, never a silently empty token set: the colour rule is only as good as this map.
 */
export function parseTokens(input: unknown): DesignTokens {
  if (!isRecord(input)) {
    throw new DesignDocumentError('tokens', [{ path: '', message: 'tokens is not an object' }]);
  }
  const issues: DesignIssue[] = [];
  const leaves = new Map<string, RawLeaf>();
  collectLeaves(input, [], leaves, issues);
  if (issues.length > 0) throw new DesignDocumentError('tokens', issues);

  const resolved = new Map<string, DesignToken>();
  for (const key of leaves.keys()) resolveToken(key, leaves, resolved, [], issues);
  if (issues.length > 0) throw new DesignDocumentError('tokens', issues);
  return Object.fromEntries(resolved);
}

/** Every resolved token value, lowercased and trimmed, deduplicated, sorted. */
export function tokenValues(tokens: DesignTokens): readonly string[] {
  const values = new Set<string>();
  for (const token of Object.values(tokens)) {
    values.add(String(token.$value).trim().toLowerCase());
  }
  return [...values].sort();
}
