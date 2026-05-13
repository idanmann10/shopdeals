import { createRequire } from 'node:module';
import pino from 'pino';
import { env } from './env.ts';

// pino-pretty is a devDependency. Only attempt to use it when (a) we're in
// development AND (b) the module actually resolves. In a production container
// (`npm ci --omit=dev`) pino-pretty is absent and pino throws on import if we
// ask for it as a transport target; we fall back to plain JSON logs instead.
const require = createRequire(import.meta.url);

function resolvePrettyTransport(): { target: string; options: object } | undefined {
  if (env().NODE_ENV !== 'development') return undefined;
  try {
    require.resolve('pino-pretty');
    return {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    };
  } catch {
    return undefined;
  }
}

const prettyTransport = resolvePrettyTransport();

export const log = pino({
  level: env().LOG_LEVEL,
  ...(prettyTransport ? { transport: prettyTransport } : {}),
  base: { service: 'shopdeals' },
  redact: {
    paths: [
      '*.api_key',
      '*.apiKey',
      '*.token',
      '*.password',
      '*.authorization',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
});
