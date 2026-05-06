import pino from 'pino';
import { env } from './env.ts';

export const log = pino({
  level: env().LOG_LEVEL,
  ...(env().NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }
    : {}),
  base: { service: 'snap-ai' },
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

export type Logger = typeof log;
