import { z } from 'zod';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  approvalSchema,
  approvalStateSchema,
  parseApproval,
  parseOrThrow,
  parsePage,
} from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { RunApiError, handle, json, queryInput, readJson, requireScope } from './errors.js';
import { runsServiceInternals } from './service.js';
import type { RunsService } from './service.js';

const listApprovalsQuerySchema = z.strictObject({
  state: approvalStateSchema.default('pending'),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

const replySchema = z.strictObject({
  decision: z.enum(['allow', 'deny']),
  scope: z.enum(['once', 'session']),
});

export function registerApprovalRoutes(app: DaemonApp, runs: RunsService): void {
  const internals = runsServiceInternals(runs);

  app.get(`${API_PREFIX}/approvals`, (c) =>
    handle(c, 'approvals', () => {
      // Every approvals request sweeps first, so an expired row never reaches the inbox.
      runs.sweepApprovals();
      const query = parseOrThrow(listApprovalsQuerySchema, queryInput(c, 'approvals'), 'approvals');
      const page = internals.store.approvals.list(query.state, {
        limit: query.limit,
        cursor: query.cursor ?? null,
      });
      return json(c, parsePage(approvalSchema, page, 'approvals'), 200);
    }),
  );

  app.get(`${API_PREFIX}/approvals/:id`, (c) =>
    handle(c, 'approvals', () => {
      runs.sweepApprovals();
      const approval = internals.store.approvals.get(c.req.param('id'));
      if (approval === null) throw new RunApiError('not_found', 404, { path: 'approval.id' });
      return json(c, parseApproval(approval), 200);
    }),
  );

  app.post(`${API_PREFIX}/approvals/:id/reply`, (c) =>
    handle(c, 'approvals', async () => {
      requireScope(c, 'write');
      runs.sweepApprovals();
      const body = parseOrThrow(replySchema, await readJson(c), 'approval.reply');
      const approval = runs.replyApproval({
        id: c.req.param('id'),
        decision: body.decision,
        scope: body.scope,
      });
      return json(c, parseApproval(approval), 200);
    }),
  );
}
