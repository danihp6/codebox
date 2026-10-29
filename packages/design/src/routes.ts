import { z } from 'zod';
import { DesignDocumentError } from './types.js';
import type { DesignIssue, DesignRoute } from './types.js';

const routeSchema = z.strictObject({
  path: z.string(),
  screen: z.string(),
  component: z.string().optional(),
});

const routesSchema = z.strictObject({
  routes: z.array(z.unknown()),
});

function issueOf(prefix: string, error: z.ZodError): DesignIssue[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter((part) => part !== '').join('.'),
    message: String(issue.message),
  }));
}

/**
 * `component` is not validated here on purpose: an empty one is a `route_without_component`
 * finding, which names the route, not a document that refuses to load at all.
 */
export function parseRoutes(input: unknown): readonly DesignRoute[] {
  const document = routesSchema.safeParse(input);
  if (!document.success) throw new DesignDocumentError('routes', issueOf('', document.error));

  const issues: DesignIssue[] = [];
  const routes: DesignRoute[] = [];
  document.data.routes.forEach((entry, index) => {
    const parsed = routeSchema.safeParse(entry);
    if (!parsed.success) {
      issues.push(...issueOf(`routes.${index}`, parsed.error));
      return;
    }
    if (parsed.data.path.trim() === '') {
      issues.push({ path: `routes.${index}.path`, message: 'route path is empty' });
      return;
    }
    if (parsed.data.screen.trim() === '') {
      issues.push({ path: `routes.${index}.screen`, message: 'route screen is empty' });
      return;
    }
    routes.push({
      path: parsed.data.path,
      screen: parsed.data.screen,
      component: parsed.data.component ?? '',
    });
  });
  if (issues.length > 0) throw new DesignDocumentError('routes', issues);
  return routes;
}
