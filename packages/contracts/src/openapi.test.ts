import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractParseError } from './parse.js';
import {
  OPENAPI_INFO,
  OPENAPI_VERSION,
  buildOpenApiDocument,
  openApiDocumentSchema,
  parseOpenApiDocument,
} from './openapi.js';
import type { OpenApiOperation } from './openapi.js';

const requiredComponents = [
  'Repo',
  'RepoDetail',
  'Job',
  'Run',
  'Approval',
  'ChatSession',
  'ChatMessage',
  'Device',
  'Health',
  'Version',
  'Telemetry',
  'ProviderStatus',
  'PushSubscription',
  'Settings',
  'NotificationPreferences',
  'Routine',
  'Work',
  'WorkDetail',
  'Backlog',
  'DesignPreview',
  'Session',
  'SessionMessage',
  'WorkPage',
  'RepoSchedule',
  'RepoScheduleDetail',
  'RepoSchedulePage',
  'SessionPage',
  'SessionMessagePage',
  'ProviderAccount',
  'ProviderOauthStart',
  'ProviderAccountTest',
  'CredentialSummary',
  'CredentialSummaryPage',
  'SseEvent',
  'Error',
  'Page',
];

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

function refOf(operation: OpenApiOperation | undefined, status: string): string | null {
  const success = operation?.responses[status] as
    | { content?: Record<string, { schema?: { $ref?: string } }> }
    | undefined;
  return success?.content?.['application/json']?.schema?.['$ref'] ?? null;
}

function docsPaths(): string[] {
  const url = new URL('../../../docs/api.md', import.meta.url);
  const markdown = readFileSync(url, 'utf8');
  const start = markdown.indexOf('\n## 2.');
  const end = markdown.indexOf('\n## 8.');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const section = markdown.slice(start, end);
  const found = new Set<string>();
  for (const line of section.split('\n')) {
    const match = /^\|\s*`?(GET|POST|PATCH|DELETE)`?\s*\|\s*([^|]+)\|/.exec(line);
    if (match === null) continue;
    const raw = (match[2] ?? '').trim().replaceAll('`', '');
    const path = raw.split('?')[0] ?? '';
    found.add(path);
  }
  found.add('/v1/events');
  return [...found].sort();
}

describe('openapi', () => {
  it('OpenAPI document validates as 3.1', () => {
    const document = buildOpenApiDocument();
    expect(document.openapi).toBe('3.1.0');
    expect(OPENAPI_VERSION).toBe('3.1.0');
    expect(OPENAPI_INFO).toEqual({ title: 'Codebox API', version: '1.0.0' });
    expect(parseOpenApiDocument(document)).toEqual(document);

    const names = Object.keys(document.components.schemas);
    for (const name of requiredComponents) {
      expect(names).toContain(name);
    }
    const refs = collectRefs(document);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const match = /^#\/components\/schemas\/([A-Za-z0-9_]+)$/.exec(ref);
      expect(match, ref).not.toBeNull();
      expect(names).toContain(match?.[1] ?? '');
    }
    for (const [path, item] of Object.entries(document.paths)) {
      const operations = Object.entries(item).filter(
        ([key]) => key !== 'parameters' && key !== 'summary',
      );
      expect(operations.length, path).toBeGreaterThan(0);
      for (const [, operation] of operations) {
        expect(operation.operationId.length, path).toBeGreaterThan(0);
        expect(Object.keys(operation.responses).length, path).toBeGreaterThan(0);
      }
    }
  });

  it('docs/api.md routes match the OpenAPI paths', () => {
    const document = buildOpenApiDocument();
    expect(Object.keys(document.paths).sort()).toEqual(docsPaths());
    // 63 before D56 plus the four unique schedule paths behind the seven operations.
    expect(Object.keys(document.paths)).toHaveLength(67);
  });

  it('documents the seven schedule paths of D56', () => {
    const document = buildOpenApiDocument();
    const expected = [
      {
        path: '/v1/schedules',
        method: 'get',
        operationId: 'listSchedules',
        status: '200',
        response: 'RepoSchedulePage',
      },
      {
        path: '/v1/schedules',
        method: 'post',
        operationId: 'createSchedule',
        status: '201',
        response: 'RepoSchedule',
      },
      {
        path: '/v1/schedules/{id}',
        method: 'get',
        operationId: 'getSchedule',
        status: '200',
        response: 'RepoScheduleDetail',
      },
      {
        path: '/v1/schedules/{id}',
        method: 'patch',
        operationId: 'updateSchedule',
        status: '200',
        response: 'RepoSchedule',
      },
      {
        path: '/v1/schedules/{id}',
        method: 'delete',
        operationId: 'deleteSchedule',
        status: '204',
        response: null,
      },
      {
        path: '/v1/schedules/{id}/pause',
        method: 'post',
        operationId: 'pauseSchedule',
        status: '200',
        response: 'RepoSchedule',
      },
      {
        path: '/v1/schedules/{id}/resume',
        method: 'post',
        operationId: 'resumeSchedule',
        status: '200',
        response: 'RepoSchedule',
      },
    ] as const;

    for (const spec of expected) {
      const label = `${spec.method} ${spec.path}`;
      const item = document.paths[spec.path];
      expect(item, label).toBeDefined();
      const operation = item?.[spec.method];
      expect(operation, label).toBeDefined();
      expect(operation?.operationId, label).toBe(spec.operationId);
      expect(operation?.tags, label).toEqual(['schedules']);
      const success = operation?.responses[spec.status] as
        | { content?: Record<string, { schema?: { $ref?: string } }> }
        | undefined;
      expect(success, label).toBeDefined();
      const ref = success?.content?.['application/json']?.schema?.['$ref'] ?? null;
      const wanted = spec.response === null ? null : `#/components/schemas/${spec.response}`;
      expect(ref, label).toBe(wanted);
    }

    expect(document.tags.map((tag) => tag.name)).toContain('schedules');
    expect(parseOpenApiDocument(document)).toEqual(document);
  });

  it('documents the eight credential and integration paths', () => {
    const document = buildOpenApiDocument();
    const paths = [
      '/v1/credentials',
      '/v1/credentials/{id}',
      '/v1/credentials/{id}/rotate',
      '/v1/integrations',
      '/v1/integrations/{id}',
      '/v1/integrations/{id}/request',
      '/v1/integrations/github/complete',
      '/v1/integrations/github/manifest',
    ];
    for (const path of paths) {
      expect(Object.keys(document.paths)).toContain(path);
      expect(docsPaths()).toContain(path);
    }
    const operations = Object.values(document.paths)
      .flatMap((item) => [item.get, item.post, item.delete])
      .filter((operation) => operation?.tags.includes('credentials') ?? false);
    expect(operations).toHaveLength(10);
    for (const operation of operations) expect(operation?.operationId).toBeTruthy();

    const list = document.paths['/v1/credentials']?.get;
    const create = document.paths['/v1/credentials']?.post;
    const rotate = document.paths['/v1/credentials/{id}/rotate']?.post;
    const remove = document.paths['/v1/credentials/{id}']?.delete;
    expect(refOf(list, '200')).toBe('#/components/schemas/CredentialSummaryPage');
    expect(refOf(create, '201')).toBe('#/components/schemas/CredentialSummary');
    expect(refOf(rotate, '200')).toBe('#/components/schemas/CredentialSummary');
    expect(remove?.responses['204']).toEqual({ description: 'No content' });
  });

  it('retires the chat and routine paths', () => {
    const document = buildOpenApiDocument();
    const paths = Object.keys(document.paths);
    for (const path of paths) {
      expect(path.startsWith('/v1/chat/'), path).toBe(false);
      expect(path === '/v1/routines' || path.startsWith('/v1/routines/'), path).toBe(false);
    }
    expect(paths).toContain('/v1/works');
    expect(paths).toContain('/v1/sessions');
  });

  it('the OpenAPI document lists the three routine events', () => {
    const document = buildOpenApiDocument();
    const schemas = JSON.stringify(document.components.schemas);
    for (const name of ['routine.fired', 'routine.replied', 'routine.failed']) {
      expect(schemas).toContain(name);
    }
    expect(Object.keys(document.components.schemas)).toContain('Routine');
    expect(parseOpenApiDocument(document)).toEqual(document);
  });

  it('rejects a document that is not 3.1 and one that misses a required key', () => {
    const document = buildOpenApiDocument();
    expect(openApiDocumentSchema.safeParse({ ...document, openapi: '3.0.3' }).success).toBe(false);
    const withoutInfo: Record<string, unknown> = { ...document };
    delete withoutInfo.info;
    expect(openApiDocumentSchema.safeParse(withoutInfo).success).toBe(false);
  });

  it('rejects a dangling $ref', () => {
    const document = buildOpenApiDocument();
    const path = '/v1/health';
    const item = document.paths[path];
    const operation = item?.get;
    expect(operation).toBeDefined();
    const broken = {
      ...document,
      paths: {
        ...document.paths,
        [path]: {
          get: {
            ...operation,
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Missing' } },
                },
              },
            },
          },
        },
      },
    };
    const result = openApiDocumentSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('rejects a path set that differs from the documented one, and duplicate ids', () => {
    const document = buildOpenApiDocument();
    const fewerPaths = { ...document.paths };
    delete fewerPaths['/v1/version'];
    expect(openApiDocumentSchema.safeParse({ ...document, paths: fewerPaths }).success).toBe(false);

    const duplicate = buildOpenApiDocument();
    const health = duplicate.paths['/v1/health']?.get;
    expect(health).toBeDefined();
    const doubled = {
      ...duplicate,
      paths: {
        ...duplicate.paths,
        '/v1/health': {
          ...duplicate.paths['/v1/health'],
          get: { ...health, operationId: 'getVersion' },
        },
      },
    };
    expect(openApiDocumentSchema.safeParse(doubled).success).toBe(false);
  });

  it('rejects a path item with an unknown key or an empty response map', () => {
    const document = buildOpenApiDocument();
    const withUnknownKey = {
      ...document,
      paths: {
        ...document.paths,
        '/v1/health': { ...document.paths['/v1/health'], head: { operationId: 'x' } },
      },
    };
    expect(openApiDocumentSchema.safeParse(withUnknownKey).success).toBe(false);

    const emptyResponses = {
      ...document,
      paths: {
        ...document.paths,
        '/v1/health': {
          get: { operationId: 'getHealth', summary: 'x', tags: ['health'], responses: {} },
        },
      },
    };
    expect(openApiDocumentSchema.safeParse(emptyResponses).success).toBe(false);
  });

  it('names the openapi boundary when the document is unparseable', () => {
    let caught: unknown = null;
    try {
      parseOpenApiDocument({ openapi: '3.1.0' });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(ContractParseError);
    expect(caught instanceof ContractParseError ? caught.boundary : null).toBe('openapi');
  });
});
