import type { Logger } from '@docline/core';
import { pino } from 'pino';

/**
 * Caminhos mascarados nos logs (docs/SECURITY.md §5): credenciais, tokens e
 * dados pessoais de contato nunca são gravados em claro.
 */
export const REDACT_PATHS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'email',
  'phone',
  '*.password',
  '*.token',
  '*.secret',
  '*.accessToken',
  '*.refreshToken',
  '*.authorization',
  '*.cookie',
  '*.email',
  '*.phone',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];

export interface CreateLoggerOptions {
  service: 'web' | 'worker' | 'cli';
  level?: string;
  appEnv?: string;
  /** Destino alternativo (testes). Padrão: stdout em JSON. */
  destination?: pino.DestinationStream;
}

export type AppLogger = Logger & { child(bindings: object): AppLogger };

export function createLogger(options: CreateLoggerOptions): AppLogger {
  return pino(
    {
      level: options.level ?? 'info',
      base: { service: options.service, env: options.appEnv },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    options.destination,
  ) as unknown as AppLogger;
}
