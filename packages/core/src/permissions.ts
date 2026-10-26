export type PermissionMode = 'chat' | 'run';
export type PermissionTool = 'read' | 'edit' | 'bash' | 'webfetch' | 'routine' | 'other';
export type PermissionDecision = 'allow' | 'ask' | 'deny';

export const PERMISSION_MATRIX: Readonly<
  Record<PermissionMode, Readonly<Record<PermissionTool, PermissionDecision>>>
> = Object.freeze({
  chat: Object.freeze({
    read: 'allow',
    edit: 'ask',
    bash: 'ask',
    webfetch: 'deny',
    routine: 'allow',
    other: 'deny',
  }),
  run: Object.freeze({
    read: 'allow',
    edit: 'allow',
    bash: 'allow',
    webfetch: 'deny',
    routine: 'deny',
    other: 'deny',
  }),
});

export interface PermissionRequest {
  readonly tool: string;
  readonly mode: PermissionMode;
  readonly path: string | null;
  readonly worktree: string;
}

const READ_TOOLS: readonly string[] = Object.freeze(['read', 'list', 'glob', 'grep', 'lsp']);
const EDIT_TOOLS: readonly string[] = Object.freeze([
  'edit',
  'write',
  'patch',
  'multiedit',
  'apply_patch',
]);
const BASH_TOOLS: readonly string[] = Object.freeze(['bash', 'shell', 'terminal']);
const WEB_TOOLS: readonly string[] = Object.freeze(['webfetch', 'websearch', 'fetch']);
// The chat tool server exposes exactly these three; anything else is `other` and fails closed.
const ROUTINE_TOOLS: readonly string[] = Object.freeze([
  'routine.create',
  'routine.list',
  'routine.pause',
]);

export function classifyTool(tool: string): PermissionTool {
  const name = tool.trim().toLowerCase();
  if (READ_TOOLS.includes(name)) return 'read';
  if (EDIT_TOOLS.includes(name)) return 'edit';
  if (BASH_TOOLS.includes(name)) return 'bash';
  if (WEB_TOOLS.includes(name)) return 'webfetch';
  if (ROUTINE_TOOLS.includes(name)) return 'routine';
  return 'other';
}

function segmentsOf(path: string): readonly string[] | null {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    segments.push(segment);
  }
  return segments;
}

export function isInsideWorktree(path: string, worktree: string): boolean {
  if (!path.startsWith('/') || !worktree.startsWith('/')) return false;
  const root = segmentsOf(worktree);
  const target = segmentsOf(path);
  if (root === null || target === null) return false;
  if (root.length === 0 || root.length > target.length) return false;
  return root.every((segment, index) => target[index] === segment);
}

export function decidePermission(request: PermissionRequest): PermissionDecision {
  const tool = classifyTool(request.tool);
  if (tool === 'webfetch' || tool === 'other') return 'deny';
  if (request.path !== null && !isInsideWorktree(request.path, request.worktree)) return 'deny';
  return PERMISSION_MATRIX[request.mode][tool];
}
