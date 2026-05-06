/**
 * Hono middleware that resolves an `AuthPrincipal` and exposes it as `c.var.principal`.
 *
 *   - `Authorization: Bearer sk_live_xxx` -> verifyApiKey -> principal or 401.
 *   - No header + `allowAnonymous` + non-prod -> anonymous principal.
 *   - Otherwise -> 401.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { parseAuthorizationHeader, verifyApiKey } from '../auth/api-key.ts';
import { anonymousPrincipal, isAnonymousAllowed } from '../auth/anonymous.ts';
import type { AuthPrincipal } from '../auth/types.ts';
import { env } from '../lib/env.ts';
import { log } from '../lib/log.ts';

export interface AuthVariables {
  principal: AuthPrincipal;
}

export interface AuthMiddlewareOptions {
  /** When set, requests without an Authorization header may pass as anonymous (dev only). */
  allowAnonymous?: boolean;
}

export const authMiddleware = (
  opts: AuthMiddlewareOptions = {},
): MiddlewareHandler<{ Variables: AuthVariables }> => {
  const allowAnonymous = opts.allowAnonymous ?? false;

  return async (c, next) => {
    const header = c.req.header('authorization');
    const parsed = parseAuthorizationHeader(header);

    if (parsed.type === 'bearer' && parsed.token) {
      const principal = await verifyApiKey(parsed.token);
      if (!principal) {
        log.warn(
          { hashPrefix: principal ? undefined : 'invalid', path: c.req.path },
          'invalid api key',
        );
        return jsonError(c, 401, 'invalid_api_key');
      }
      c.set('principal', principal);
      return next();
    }

    // No bearer.
    if (allowAnonymous) {
      const nodeEnv = env().NODE_ENV;
      if (isAnonymousAllowed(c.req.path, nodeEnv)) {
        c.set('principal', anonymousPrincipal());
        return next();
      }
    }

    return jsonError(c, 401, 'unauthorized');
  };
};

function jsonError(c: Context, status: 401 | 403 | 500, code: string) {
  return c.json({ error: code }, status);
}
