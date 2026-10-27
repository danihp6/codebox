import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import { errorEnvelopeSchema } from './errors.js';
import { sseEventSchema } from './events.js';
import { pageOfRun } from './pagination.js';
import { routineSchema } from './routines.js';
import {
  approvalSchema,
  brakeSchema,
  chatMessageSchema,
  chatSessionSchema,
  deviceSchema,
  healthSchema,
  jobSchema,
  meSchema,
  notificationPreferencesSchema,
  providerStatusSchema,
  providersSchema,
  pushSubscriptionSchema,
  repoDetailSchema,
  repoSchema,
  runSchema,
  settingsSchema,
  telemetrySchema,
  versionSchema,
} from './resources.js';

export const OPENAPI_VERSION = '3.1.0';
export const OPENAPI_INFO = { title: 'Codebox API', version: '1.0.0' } as const;

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  tags: string[];
  parameters?: unknown[] | undefined;
  responses: Record<string, unknown>;
}

export interface OpenApiPathItem {
  get?: OpenApiOperation | undefined;
  post?: OpenApiOperation | undefined;
  put?: OpenApiOperation | undefined;
  patch?: OpenApiOperation | undefined;
  delete?: OpenApiOperation | undefined;
  parameters?: unknown[] | undefined;
  summary?: string | undefined;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description?: string | undefined };
  servers: { url: string; description?: string | undefined }[];
  paths: Record<string, OpenApiPathItem>;
  components: { schemas: Record<string, unknown> };
  tags: { name: string; description?: string | undefined }[];
}

interface RouteSpec {
  path: string;
  method: HttpMethod;
  operationId: string;
  summary: string;
  tag: string;
  status: string;
  response: string | null;
}

const ROUTES: readonly RouteSpec[] = [
  {
    path: '/v1/admin/brake',
    method: 'post',
    operationId: 'setBrake',
    summary: 'Arm or release the global auto-merge brake.',
    tag: 'admin',
    status: '200',
    response: 'Brake',
  },
  {
    path: '/v1/admin/cache/wipe',
    method: 'post',
    operationId: 'wipeCache',
    summary: 'Remove finished worktrees and keep the bare clones.',
    tag: 'admin',
    status: '202',
    response: null,
  },
  {
    path: '/v1/approvals',
    method: 'get',
    operationId: 'listApprovals',
    summary: 'The approval inbox.',
    tag: 'approvals',
    status: '200',
    response: 'Page',
  },
  {
    path: '/v1/approvals/{id}',
    method: 'get',
    operationId: 'getApproval',
    summary: 'One permission request with its redacted tool input.',
    tag: 'approvals',
    status: '200',
    response: 'Approval',
  },
  {
    path: '/v1/approvals/{id}/reply',
    method: 'post',
    operationId: 'replyApproval',
    summary: 'Allow or deny a permission request.',
    tag: 'approvals',
    status: '200',
    response: 'Approval',
  },
  {
    path: '/v1/auth/logout',
    method: 'post',
    operationId: 'logout',
    summary: "Revoke the calling device's refresh token.",
    tag: 'auth',
    status: '204',
    response: null,
  },
  {
    path: '/v1/auth/refresh',
    method: 'post',
    operationId: 'refreshToken',
    summary: 'Rotate the access and refresh tokens.',
    tag: 'auth',
    status: '200',
    response: null,
  },
  {
    path: '/v1/chat/sessions',
    method: 'get',
    operationId: 'listChatSessions',
    summary: 'Chat sessions, newest activity first.',
    tag: 'chat',
    status: '200',
    response: 'Page',
  },
  {
    path: '/v1/chat/sessions',
    method: 'post',
    operationId: 'createChatSession',
    summary: 'Create the worktree and the OpenCode session.',
    tag: 'chat',
    status: '201',
    response: 'ChatSession',
  },
  {
    path: '/v1/chat/sessions/{id}',
    method: 'get',
    operationId: 'getChatSession',
    summary: 'Session, repository, status and last message.',
    tag: 'chat',
    status: '200',
    response: 'ChatSession',
  },
  {
    path: '/v1/chat/sessions/{id}',
    method: 'delete',
    operationId: 'archiveChatSession',
    summary: 'Archive the session; the worktree follows retention.',
    tag: 'chat',
    status: '204',
    response: null,
  },
  {
    path: '/v1/chat/sessions/{id}/compact',
    method: 'post',
    operationId: 'compactChatSession',
    summary: 'Start a new session in the same worktree and bump the context epoch.',
    tag: 'chat',
    status: '200',
    response: 'ChatSession',
  },
  {
    path: '/v1/chat/sessions/{id}/interrupt',
    method: 'post',
    operationId: 'interruptChatSession',
    summary: 'Stop the agent and return the session to idle.',
    tag: 'chat',
    status: '200',
    response: 'ChatSession',
  },
  {
    path: '/v1/chat/sessions/{id}/messages',
    method: 'get',
    operationId: 'listChatMessages',
    summary: 'Messages, oldest first, paginated.',
    tag: 'chat',
    status: '200',
    response: 'Page',
  },
  {
    path: '/v1/chat/sessions/{id}/messages',
    method: 'post',
    operationId: 'createChatMessage',
    summary: 'Send a message; the reply arrives as events.',
    tag: 'chat',
    status: '202',
    response: 'ChatMessage',
  },
  {
    path: '/v1/chat/sessions/{id}/promote',
    method: 'post',
    operationId: 'promoteChatSession',
    summary: 'Promote the chat worktree into a run.',
    tag: 'chat',
    status: '202',
    response: 'Run',
  },
  {
    path: '/v1/chat/sessions/{id}/repo',
    method: 'post',
    operationId: 'bindChatSessionRepo',
    summary: 'Connect a repository and hand the transcript to a new session.',
    tag: 'chat',
    status: '200',
    response: 'ChatSession',
  },
  {
    path: '/v1/chat/sessions/{id}/reviewed',
    method: 'post',
    operationId: 'reviewChatSession',
    summary: 'Mark the chat reviewed, once.',
    tag: 'chat',
    status: '200',
    response: 'ChatSession',
  },
  {
    path: '/v1/credentials',
    method: 'get',
    operationId: 'listCredentials',
    summary: 'Configured credentials, without a value.',
    tag: 'credentials',
    status: '200',
    response: null,
  },
  {
    path: '/v1/credentials',
    method: 'post',
    operationId: 'createCredential',
    summary: 'Seal one credential and report only its last four.',
    tag: 'credentials',
    status: '201',
    response: null,
  },
  {
    path: '/v1/credentials/{id}',
    method: 'delete',
    operationId: 'deleteCredential',
    summary: 'Forget a credential and its seal.',
    tag: 'credentials',
    status: '204',
    response: null,
  },
  {
    path: '/v1/credentials/{id}/rotate',
    method: 'post',
    operationId: 'rotateCredential',
    summary: 'Replace the value and keep the identity.',
    tag: 'credentials',
    status: '200',
    response: null,
  },
  {
    path: '/v1/devices',
    method: 'get',
    operationId: 'listDevices',
    summary: 'Paired devices, last seen and scopes.',
    tag: 'auth',
    status: '200',
    response: 'Page',
  },
  {
    path: '/v1/devices/{id}',
    method: 'delete',
    operationId: 'deleteDevice',
    summary: 'Revoke one device.',
    tag: 'auth',
    status: '204',
    response: null,
  },
  {
    path: '/v1/events',
    method: 'get',
    operationId: 'streamEvents',
    summary: 'The single SSE stream.',
    tag: 'events',
    status: '200',
    response: null,
  },
  {
    path: '/v1/health',
    method: 'get',
    operationId: 'getHealth',
    summary: 'Dependency status without secrets or paths.',
    tag: 'health',
    status: '200',
    response: 'Health',
  },
  {
    path: '/v1/integrations',
    method: 'get',
    operationId: 'listIntegrations',
    summary: 'Saved outbound integrations.',
    tag: 'credentials',
    status: '200',
    response: null,
  },
  {
    path: '/v1/integrations',
    method: 'post',
    operationId: 'createIntegration',
    summary: 'Record a base URL, auth kind and host allowlist.',
    tag: 'credentials',
    status: '201',
    response: null,
  },
  {
    path: '/v1/integrations/{id}',
    method: 'delete',
    operationId: 'deleteIntegration',
    summary: 'Forget an integration; its credential stays.',
    tag: 'credentials',
    status: '204',
    response: null,
  },
  {
    path: '/v1/integrations/{id}/request',
    method: 'post',
    operationId: 'requestIntegration',
    summary: 'Call the integration server-side inside the allowlist.',
    tag: 'credentials',
    status: '200',
    response: null,
  },
  {
    path: '/v1/integrations/github/complete',
    method: 'post',
    operationId: 'completeGithubManifest',
    summary: 'Exchange the manifest code for the app PEM.',
    tag: 'credentials',
    status: '200',
    response: null,
  },
  {
    path: '/v1/integrations/github/manifest',
    method: 'post',
    operationId: 'startGithubManifest',
    summary: 'Build the GitHub App manifest and its single-use state.',
    tag: 'credentials',
    status: '200',
    response: null,
  },
  {
    path: '/v1/jobs',
    method: 'get',
    operationId: 'listJobs',
    summary: 'Jobs with their next fire.',
    tag: 'jobs',
    status: '200',
    response: 'Page',
  },
  {
    path: '/v1/jobs',
    method: 'post',
    operationId: 'createJob',
    summary: 'Create a job.',
    tag: 'jobs',
    status: '201',
    response: 'Job',
  },
  {
    path: '/v1/jobs/{id}',
    method: 'get',
    operationId: 'getJob',
    summary: 'Job, last runs and next fires.',
    tag: 'jobs',
    status: '200',
    response: 'Job',
  },
  {
    path: '/v1/jobs/{id}',
    method: 'patch',
    operationId: 'updateJob',
    summary: 'Partial update; a cron change recomputes the next fire.',
    tag: 'jobs',
    status: '200',
    response: 'Job',
  },
  {
    path: '/v1/jobs/{id}',
    method: 'delete',
    operationId: 'deleteJob',
    summary: 'Delete a job and keep its runs.',
    tag: 'jobs',
    status: '204',
    response: null,
  },
  {
    path: '/v1/jobs/{id}/next',
    method: 'get',
    operationId: 'getJobNext',
    summary: 'Preview the next fires in the job timezone.',
    tag: 'jobs',
    status: '200',
    response: null,
  },
  {
    path: '/v1/jobs/{id}/pause',
    method: 'post',
    operationId: 'pauseJob',
    summary: 'Stop the scheduler from selecting the job.',
    tag: 'jobs',
    status: '200',
    response: 'Job',
  },
  {
    path: '/v1/jobs/{id}/resume',
    method: 'post',
    operationId: 'resumeJob',
    summary: 'Recompute the next fire from now.',
    tag: 'jobs',
    status: '200',
    response: 'Job',
  },
  {
    path: '/v1/jobs/{id}/run',
    method: 'post',
    operationId: 'runJob',
    summary: 'Run the job now, ignored by the pause switch.',
    tag: 'jobs',
    status: '202',
    response: 'Run',
  },
  {
    path: '/v1/me',
    method: 'get',
    operationId: 'getMe',
    summary: 'The calling device, its scopes and the server time.',
    tag: 'auth',
    status: '200',
    response: 'Me',
  },
  {
    path: '/v1/notifications/preferences',
    method: 'get',
    operationId: 'getNotificationPreferences',
    summary: 'Per-event subscriptions and quiet hours.',
    tag: 'settings',
    status: '200',
    response: 'NotificationPreferences',
  },
  {
    path: '/v1/notifications/preferences',
    method: 'patch',
    operationId: 'updateNotificationPreferences',
    summary: 'Replace the notification preferences.',
    tag: 'settings',
    status: '200',
    response: 'NotificationPreferences',
  },
  {
    path: '/v1/pair',
    method: 'post',
    operationId: 'pair',
    summary: 'Exchange a one-time code for a device identity.',
    tag: 'auth',
    status: '200',
    response: null,
  },
  {
    path: '/v1/pair/code',
    method: 'post',
    operationId: 'issuePairCode',
    summary: 'Issue a one-time pairing code on the admin socket.',
    tag: 'auth',
    status: '201',
    response: null,
  },
  {
    path: '/v1/providers',
    method: 'get',
    operationId: 'getProviders',
    summary: 'Per provider: configured, mode, last success and fingerprint.',
    tag: 'health',
    status: '200',
    response: 'Providers',
  },
  {
    path: '/v1/push/subscriptions',
    method: 'post',
    operationId: 'createPushSubscription',
    summary: 'Register a push endpoint.',
    tag: 'settings',
    status: '201',
    response: 'PushSubscription',
  },
  {
    path: '/v1/push/subscriptions/{id}',
    method: 'delete',
    operationId: 'deletePushSubscription',
    summary: 'Unsubscribe one push endpoint.',
    tag: 'settings',
    status: '204',
    response: null,
  },
  {
    path: '/v1/repos',
    method: 'get',
    operationId: 'listRepos',
    summary: 'Registered repositories.',
    tag: 'repos',
    status: '200',
    response: 'Page',
  },
  {
    path: '/v1/repos',
    method: 'post',
    operationId: 'createRepo',
    summary: 'Register a repository inside the allowlist.',
    tag: 'repos',
    status: '201',
    response: 'Repo',
  },
  {
    path: '/v1/repos/{id}',
    method: 'get',
    operationId: 'getRepo',
    summary: 'Repository, policy, last run and gate summary.',
    tag: 'repos',
    status: '200',
    response: 'RepoDetail',
  },
  {
    path: '/v1/repos/{id}',
    method: 'patch',
    operationId: 'updateRepo',
    summary: 'Gate, policy, protected paths and enabled flag.',
    tag: 'repos',
    status: '200',
    response: 'Repo',
  },
  {
    path: '/v1/repos/{id}',
    method: 'delete',
    operationId: 'deleteRepo',
    summary: 'Delete a repository without a live run.',
    tag: 'repos',
    status: '204',
    response: null,
  },
  {
    path: '/v1/repos/{id}/verify',
    method: 'post',
    operationId: 'verifyRepo',
    summary: 'Check the default branch and push access.',
    tag: 'repos',
    status: '200',
    response: null,
  },
  {
    path: '/v1/routines',
    method: 'get',
    operationId: 'listRoutines',
    summary: 'Chat schedules, newest first.',
    tag: 'routines',
    status: '200',
    response: 'Page',
  },
  {
    path: '/v1/routines',
    method: 'post',
    operationId: 'createRoutine',
    summary: 'Create a routine; the chat tool is the normal path.',
    tag: 'routines',
    status: '201',
    response: 'Routine',
  },
  {
    path: '/v1/routines/{id}',
    method: 'get',
    operationId: 'getRoutine',
    summary: 'One routine with its next and last fire.',
    tag: 'routines',
    status: '200',
    response: 'Routine',
  },
  {
    path: '/v1/routines/{id}',
    method: 'patch',
    operationId: 'updateRoutine',
    summary: 'Title, cron, timezone, prompt, notify or enabled.',
    tag: 'routines',
    status: '200',
    response: 'Routine',
  },
  {
    path: '/v1/routines/{id}',
    method: 'delete',
    operationId: 'deleteRoutine',
    summary: 'Delete a routine and stop its schedule.',
    tag: 'routines',
    status: '204',
    response: null,
  },
  {
    path: '/v1/routines/{id}/pause',
    method: 'post',
    operationId: 'pauseRoutine',
    summary: 'The scheduler stops selecting it.',
    tag: 'routines',
    status: '200',
    response: 'Routine',
  },
  {
    path: '/v1/routines/{id}/resume',
    method: 'post',
    operationId: 'resumeRoutine',
    summary: 'Recompute the next fire from now.',
    tag: 'routines',
    status: '200',
    response: 'Routine',
  },
  {
    path: '/v1/routines/{id}/run',
    method: 'post',
    operationId: 'runRoutine',
    summary: 'Fire it once now, outside the schedule.',
    tag: 'routines',
    status: '202',
    response: 'Routine',
  },
  {
    path: '/v1/runs',
    method: 'get',
    operationId: 'listRuns',
    summary: 'Runs, newest first.',
    tag: 'runs',
    status: '200',
    response: 'Page',
  },
  {
    path: '/v1/runs',
    method: 'post',
    operationId: 'createRun',
    summary: 'Start a run.',
    tag: 'runs',
    status: '202',
    response: 'Run',
  },
  {
    path: '/v1/runs/{id}',
    method: 'get',
    operationId: 'getRun',
    summary: 'State, gate, PR, guardrails and cost.',
    tag: 'runs',
    status: '200',
    response: 'Run',
  },
  {
    path: '/v1/runs/{id}/cancel',
    method: 'post',
    operationId: 'cancelRun',
    summary: 'Kill the session and remove the worktree.',
    tag: 'runs',
    status: '202',
    response: 'Run',
  },
  {
    path: '/v1/runs/{id}/diff',
    method: 'get',
    operationId: 'getRunDiff',
    summary: 'Stat and changed files; the patch lives on GitHub.',
    tag: 'runs',
    status: '200',
    response: null,
  },
  {
    path: '/v1/runs/{id}/events',
    method: 'get',
    operationId: 'listRunEvents',
    summary: 'Event replay as JSON, not SSE.',
    tag: 'runs',
    status: '200',
    response: 'Page',
  },
  {
    path: '/v1/runs/{id}/revert',
    method: 'post',
    operationId: 'revertRun',
    summary: 'Open a revert run for the merge commit.',
    tag: 'runs',
    status: '202',
    response: 'Run',
  },
  {
    path: '/v1/settings',
    method: 'get',
    operationId: 'getSettings',
    summary: 'Non-secret settings and their defaults.',
    tag: 'settings',
    status: '200',
    response: 'Settings',
  },
  {
    path: '/v1/settings',
    method: 'patch',
    operationId: 'updateSettings',
    summary: 'Update the keys the schema lists.',
    tag: 'settings',
    status: '200',
    response: 'Settings',
  },
  {
    path: '/v1/telemetry',
    method: 'get',
    operationId: 'getTelemetry',
    summary: 'Spend, runs, failures, disk and queue depth.',
    tag: 'health',
    status: '200',
    response: 'Telemetry',
  },
  {
    path: '/v1/version',
    method: 'get',
    operationId: 'getVersion',
    summary: 'Version, commit, build time and node version.',
    tag: 'health',
    status: '200',
    response: 'Version',
  },
];

const OPENAPI_PATHS: readonly string[] = Object.freeze(
  [...new Set(ROUTES.map((route) => route.path))].sort(),
);

const componentSchemas: Readonly<Record<string, z.ZodType>> = Object.freeze({
  Repo: repoSchema,
  RepoDetail: repoDetailSchema,
  Job: jobSchema,
  Run: runSchema,
  Approval: approvalSchema,
  ChatSession: chatSessionSchema,
  ChatMessage: chatMessageSchema,
  Device: deviceSchema,
  Health: healthSchema,
  Version: versionSchema,
  Telemetry: telemetrySchema,
  ProviderStatus: providerStatusSchema,
  Providers: providersSchema,
  PushSubscription: pushSubscriptionSchema,
  Settings: settingsSchema,
  NotificationPreferences: notificationPreferencesSchema,
  Me: meSchema,
  Brake: brakeSchema,
  Routine: routineSchema,
  SseEvent: sseEventSchema,
  Error: errorEnvelopeSchema,
  Page: pageOfRun,
});

const tagSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});

const operationSchema = z.strictObject({
  operationId: z.string().min(1),
  summary: z.string().min(1),
  tags: z.array(z.string().min(1)),
  parameters: z.array(z.unknown()).optional(),
  responses: z
    .record(z.string(), z.unknown())
    .refine((responses) => Object.keys(responses).length > 0, {
      message: 'expected at least one response',
    }),
});

const pathItemSchema = z
  .strictObject({
    get: operationSchema.optional(),
    post: operationSchema.optional(),
    put: operationSchema.optional(),
    patch: operationSchema.optional(),
    delete: operationSchema.optional(),
    parameters: z.array(z.unknown()).optional(),
    summary: z.string().min(1).optional(),
  })
  .refine((item) => HTTP_METHODS.some((method) => item[method] !== undefined), {
    message: 'expected at least one operation',
  });

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectRefs(entry, refs);
    return refs;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === '$ref' && typeof entry === 'string') refs.push(entry);
      else collectRefs(entry, refs);
    }
  }
  return refs;
}

export const openApiDocumentSchema: z.ZodType<OpenApiDocument> = z
  .strictObject({
    openapi: z.literal(OPENAPI_VERSION),
    info: z.strictObject({
      title: z.string().min(1),
      version: z.string().min(1),
      description: z.string().min(1).optional(),
    }),
    servers: z.array(
      z.strictObject({ url: z.string().min(1), description: z.string().min(1).optional() }),
    ),
    tags: z.array(tagSchema),
    paths: z.record(z.string(), pathItemSchema),
    components: z.strictObject({ schemas: z.record(z.string(), z.looseObject({})) }),
  })
  .superRefine((document, ctx) => {
    const names = new Set(Object.keys(document.components.schemas));
    for (const ref of collectRefs(document)) {
      const match = /^#\/components\/schemas\/([A-Za-z0-9_]+)$/.exec(ref);
      if (match === null || !names.has(match[1] ?? '')) {
        ctx.addIssue({ code: 'custom', message: `unresolved $ref: ${ref}` });
      }
    }
    const actualPaths = Object.keys(document.paths).sort();
    if (actualPaths.join('\n') !== OPENAPI_PATHS.join('\n')) {
      ctx.addIssue({
        code: 'custom',
        message: `paths must be exactly the documented set: ${OPENAPI_PATHS.join(', ')}`,
      });
    }
    const operationIds = new Set<string>();
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = item[method];
        if (operation === undefined) continue;
        if (operationIds.has(operation.operationId)) {
          ctx.addIssue({
            code: 'custom',
            message: `duplicate operationId: ${operation.operationId}`,
            path: ['paths', path, method, 'operationId'],
          });
        }
        operationIds.add(operation.operationId);
      }
    }
  });

function jsonResponse(schemaName: string, description: string): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } },
    },
  };
}

const STATUS_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  '200': 'OK',
  '201': 'Created',
  '202': 'Accepted',
  '204': 'No content',
});

function successResponse(route: RouteSpec): Record<string, unknown> {
  const description = STATUS_DESCRIPTIONS[route.status] ?? 'OK';
  if (route.response === null) return { description };
  return jsonResponse(route.response, description);
}

function responsesFor(route: RouteSpec): Record<string, unknown> {
  return {
    [route.status]: successResponse(route),
    '401': jsonResponse('Error', 'Missing, expired or revoked token'),
    '422': jsonResponse('Error', 'Schema failure; details.path names the field'),
  };
}

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  const document: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(generated)) {
    if (key !== '$schema') document[key] = value;
  }
  return document;
}

export function buildOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, OpenApiPathItem> = {};
  for (const route of ROUTES) {
    const item = paths[route.path] ?? {};
    item[route.method] = {
      operationId: route.operationId,
      summary: route.summary,
      tags: [route.tag],
      responses: responsesFor(route),
    };
    paths[route.path] = item;
  }
  const schemas: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(componentSchemas)) {
    schemas[name] = jsonSchemaOf(schema);
  }
  return {
    openapi: OPENAPI_VERSION,
    info: {
      ...OPENAPI_INFO,
      description: 'The executable form of docs/api.md: one versioned HTTP + SSE contract.',
    },
    servers: [{ url: '/', description: 'The daemon origin, reached through Cloudflare Tunnel.' }],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => (a < b ? -1 : 1))),
    components: { schemas },
    tags: [
      { name: 'admin', description: 'Admin-only brake and cache controls.' },
      { name: 'approvals', description: 'Permission requests.' },
      { name: 'auth', description: 'Pairing, tokens and devices.' },
      { name: 'chat', description: 'Persistent chat sessions.' },
      { name: 'credentials', description: 'Runtime credentials and outbound integrations.' },
      { name: 'events', description: 'The SSE stream of docs/api.md §6.' },
      { name: 'health', description: 'Health, version and telemetry.' },
      { name: 'jobs', description: 'Saved intentions and their schedule.' },
      { name: 'repos', description: 'Registered repositories.' },
      { name: 'routines', description: 'Chat schedules: reminders and prompts.' },
      { name: 'runs', description: 'Executions, gate, PR and guardrails.' },
      { name: 'settings', description: 'Settings, notifications and push.' },
    ],
  };
}

export function parseOpenApiDocument(input: unknown): OpenApiDocument {
  return parseOrThrow(openApiDocumentSchema, input, 'openapi');
}
