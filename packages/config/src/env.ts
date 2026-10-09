import { z } from 'zod';

/**
 * Esquema das variáveis de ambiente do servidor (web e worker).
 *
 * Fonte da verdade da configuração: `.env.example` documenta cada variável;
 * este arquivo valida. A aplicação não sobe com configuração inválida
 * (docs/SECURITY.md §5). As mensagens de erro nunca incluem os valores.
 */

/** Strings vazias (comuns em `.env`) são tratadas como ausentes. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

const withDefault = <T extends z.ZodType>(schema: T, fallback: z.output<T>) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.default(fallback as never),
  );

const secret = (minLength: number) =>
  z.string().min(minLength, `deve ter ao menos ${minLength} caracteres`);

const base64Key32 = z.string().refine((v) => {
  try {
    return Buffer.from(v, 'base64').length === 32;
  } catch {
    return false;
  }
}, 'deve ser uma chave de 32 bytes em base64 (openssl rand -base64 32)');

export const APP_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const serverEnvShape = {
  // Aplicação
  APP_ENV: withDefault(z.enum(APP_ENVS), 'development'),
  APP_URL: withDefault(z.url(), 'http://localhost:3000'),
  APP_TIMEZONE: withDefault(z.string().min(1), 'America/Fortaleza'),
  LOG_LEVEL: withDefault(
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    'info',
  ),

  // Proxies confiáveis à frente da aplicação (IPs/CIDRs, separados por vírgula).
  // Usados para extrair o IP real do cliente do X-Forwarded-For sem aceitar
  // valores forjados. Vazio = só confia num cabeçalho com um único IP.
  TRUSTED_PROXIES: withDefault(
    z
      .string()
      .transform((v) =>
        v
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(
          z
            .string()
            .regex(
              /^[0-9a-fA-F:.]+(\/\d{1,3})?$/,
              'cada item deve ser um IP ou CIDR (ex.: 10.0.0.0/8)',
            ),
        ),
      ),
    [],
  ),

  // Banco e fila
  DATABASE_URL: z.url({ message: 'deve ser uma URL postgresql:// válida' }),
  JOB_QUEUE_SCHEMA: withDefault(z.string().regex(/^[a-z_][a-z0-9_]*$/), 'pgboss'),
  REDIS_URL: optional(z.url()),

  // Autenticação e criptografia
  BETTER_AUTH_SECRET: secret(32),
  BETTER_AUTH_URL: optional(z.url()),
  ENCRYPTION_KEY: optional(base64Key32),
  // Obrigatória em todos os ambientes: sem ela, contatos não são cruzados com a
  // Lista Não Contatar (docs/LGPD.md §8).
  SUPPRESSION_HASH_PEPPER: secret(32),

  // Seleção de provedores
  WHATSAPP_PROVIDER: withDefault(z.enum(['assisted', 'fake', 'meta_cloud']), 'assisted'),
  INSTAGRAM_PROVIDER: withDefault(z.enum(['assisted', 'fake', 'meta_graph']), 'assisted'),
  PLACES_PROVIDER: withDefault(z.enum(['disabled', 'fake', 'google_places']), 'disabled'),
  COMPANY_REGISTRY_PROVIDER: withDefault(
    z.enum(['disabled', 'fake', 'receita_open_data', 'brasilapi']),
    'disabled',
  ),
  AI_PROVIDER: withDefault(z.enum(['fake', 'anthropic']), 'fake'),
  EMAIL_PROVIDER: withDefault(z.enum(['console', 'file', 'smtp', 'resend']), 'console'),
  CRM_PROVIDER: withDefault(z.enum(['disabled', 'fake', 'webhook', 'docline']), 'disabled'),
  ALLOW_REAL_SENDS: withDefault(z.stringbool(), false),

  // Meta
  META_APP_ID: optional(z.string()),
  META_APP_SECRET: optional(z.string()),
  META_ACCESS_TOKEN: optional(z.string()),
  META_GRAPH_API_VERSION: optional(z.string().regex(/^v\d+\.\d+$/, 'formato esperado: v26.0')),
  META_WEBHOOK_VERIFY_TOKEN: optional(z.string()),
  WHATSAPP_BUSINESS_ACCOUNT_ID: optional(z.string()),
  WHATSAPP_PHONE_NUMBER_ID: optional(z.string()),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: optional(z.string()),

  // Google
  GOOGLE_API_KEY: optional(z.string()),
  GOOGLE_PLACES_DAILY_QUOTA: withDefault(z.coerce.number().int().nonnegative(), 200),

  // IA
  AI_API_KEY: optional(z.string()),
  AI_MODEL: withDefault(z.string().min(1), 'claude-opus-5-5'),
  AI_MODEL_CLASSIFICATION: optional(z.string()),
  AI_EFFORT_GENERATION: withDefault(z.enum(['low', 'medium', 'high']), 'medium'),
  AI_EFFORT_CLASSIFICATION: withDefault(z.enum(['low', 'medium', 'high']), 'low'),
  AI_MAX_GENERATIONS_PER_USER_PER_DAY: withDefault(z.coerce.number().int().positive(), 200),
  AI_MONTHLY_BUDGET_USD: optional(z.coerce.number().positive()),

  // E-mail
  EMAIL_FROM: withDefault(z.string().min(3), 'Docline SDR <nao-responda@example.com>'),
  SMTP_URL: optional(z.url()),
  RESEND_API_KEY: optional(z.string()),
  EMAIL_OUTBOX_FILE: withDefault(z.string().min(1), '.data/outbox.jsonl'),

  // Observabilidade
  SENTRY_DSN: optional(z.url()),

  // Armazenamento
  STORAGE_PROVIDER: withDefault(z.enum(['none', 's3']), 'none'),
  S3_ENDPOINT: optional(z.url()),
  S3_REGION: optional(z.string()),
  S3_BUCKET: optional(z.string()),
  S3_ACCESS_KEY_ID: optional(z.string()),
  S3_SECRET_ACCESS_KEY: optional(z.string()),

  // Integrações Docline
  DOCLINE_CRM_BASE_URL: optional(z.url()),
  DOCLINE_CRM_API_KEY: optional(z.string()),
  OUTBOUND_WEBHOOK_SIGNING_SECRET: optional(secret(32)),

  // Limites operacionais
  IMPORT_MAX_FILE_MB: withDefault(z.coerce.number().int().positive().max(100), 10),
  IMPORT_MAX_ROWS: withDefault(z.coerce.number().int().positive().max(500_000), 50_000),
};

export const serverEnvSchema = z.object(serverEnvShape).superRefine((env, ctx) => {
  const requireAll = (reason: string, keys: (keyof typeof env)[]) => {
    for (const key of keys) {
      if (env[key] === undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: `obrigatória quando ${reason}` });
      }
    }
  };

  if (env.WHATSAPP_PROVIDER === 'meta_cloud') {
    requireAll('WHATSAPP_PROVIDER=meta_cloud', [
      'META_APP_SECRET',
      'META_ACCESS_TOKEN',
      'META_GRAPH_API_VERSION',
      'META_WEBHOOK_VERIFY_TOKEN',
      'WHATSAPP_BUSINESS_ACCOUNT_ID',
      'WHATSAPP_PHONE_NUMBER_ID',
    ]);
  }
  if (env.INSTAGRAM_PROVIDER === 'meta_graph') {
    requireAll('INSTAGRAM_PROVIDER=meta_graph', [
      'META_APP_SECRET',
      'META_ACCESS_TOKEN',
      'META_GRAPH_API_VERSION',
      'INSTAGRAM_BUSINESS_ACCOUNT_ID',
    ]);
  }
  if (env.PLACES_PROVIDER === 'google_places') {
    requireAll('PLACES_PROVIDER=google_places', ['GOOGLE_API_KEY']);
  }
  if (env.AI_PROVIDER === 'anthropic') {
    requireAll('AI_PROVIDER=anthropic', ['AI_API_KEY']);
  }
  if (env.EMAIL_PROVIDER === 'smtp') requireAll('EMAIL_PROVIDER=smtp', ['SMTP_URL']);
  if (env.EMAIL_PROVIDER === 'resend') requireAll('EMAIL_PROVIDER=resend', ['RESEND_API_KEY']);
  if (env.CRM_PROVIDER === 'docline') {
    requireAll('CRM_PROVIDER=docline', ['DOCLINE_CRM_BASE_URL', 'DOCLINE_CRM_API_KEY']);
  }
  if (env.CRM_PROVIDER === 'webhook') {
    requireAll('CRM_PROVIDER=webhook', ['OUTBOUND_WEBHOOK_SIGNING_SECRET']);
  }
  if (env.STORAGE_PROVIDER === 's3') {
    requireAll('STORAGE_PROVIDER=s3', [
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ]);
  }

  const deployed = env.APP_ENV === 'production' || env.APP_ENV === 'staging';
  if (deployed) {
    requireAll(`APP_ENV=${env.APP_ENV}`, ['ENCRYPTION_KEY']);
    if (!env.APP_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'deve usar https fora do ambiente local',
      });
    }
  }
  if (deployed && env.EMAIL_PROVIDER === 'file') {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_PROVIDER'],
      message: 'file é apenas para desenvolvimento e testes',
    });
  }
  if (env.APP_ENV === 'production' && env.EMAIL_PROVIDER === 'console') {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_PROVIDER'],
      message: 'console não envia e-mails; use smtp ou resend em produção',
    });
  }
});

export type ServerEnv = z.output<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuração de ambiente inválida:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Valida as variáveis de ambiente. Lança `EnvValidationError` listando os
 * problemas (nome da variável + motivo), sem expor valores.
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(raiz)';
      const message =
        issue.code === 'invalid_type' && issue.input === undefined ? 'obrigatória' : issue.message;
      return `${key}: ${message}`;
    });
    throw new EnvValidationError(problems);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Lê e valida `process.env` uma única vez por processo. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/** Somente para testes. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
