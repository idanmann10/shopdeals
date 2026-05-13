/**
 * Hono middleware factory that gates a route on a single scope being present
 * in the resolved principal. Use in series with `authMiddleware`.
 */

import type { MiddlewareHandler } from 'hono';
import type { AuthPrincipal, Scope } from '../auth/types.ts';

export const requireScope =
  (scope: Scope): MiddlewareHandler<{ Variables: { principal: AuthPrincipal } }> =>
  async (c, next) => {
    const principal = c.get('principal') as AuthPrincipal | undefined;
    if (!principal) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (!principal.scopes.includes(scope)) {
      return c.json({ error: 'forbidden', required: scope }, 403);
    }
    return next();
  };
