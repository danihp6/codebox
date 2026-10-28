import { RunApiError } from '../runs/errors.js';

/** docs/api.md §3: one envelope, `details.reason` carries the machine token. */
export function notFound(): RunApiError {
  return new RunApiError('not_found', 404, { path: 'session.id' });
}

export function repoNotFound(): RunApiError {
  return new RunApiError('not_found', 404, { path: 'repo.id' });
}

export function conflict(reason: string, details: Record<string, unknown> = {}): RunApiError {
  return new RunApiError('conflict', 409, { reason, ...details });
}

export function invalid(path: string, details: Record<string, unknown> = {}): RunApiError {
  return new RunApiError('validation_failed', 422, { path, ...details });
}

export function unavailable(): RunApiError {
  return new RunApiError('agent_unavailable', 502, { reason: 'agent_unavailable' });
}

export function providerUnavailable(): RunApiError {
  return new RunApiError('provider_unavailable', 502, { reason: 'provider_unavailable' });
}

export function workspaceUnavailable(): RunApiError {
  return new RunApiError('agent_unavailable', 503, { reason: 'workspace_unavailable' });
}
