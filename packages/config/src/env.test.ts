import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseServerEnv, serverEnvShape } from './env';

const SECRET = 'x'.repeat(40);
const KEY32 = Buffer.alloc(32, 7).toString('base64');
const minimal = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  BETTER_AUTH_SECRET: SECRET,
  SUPPRESSION_HASH_PEPPER: SECRET,
};

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    parseServerEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseServerEnv', () => {
  it('aceita a configuração mínima e aplica padrões seguros', () => {
    const env = parseServerEnv(minimal);
    expect(env.APP_ENV).toBe('development');
    expect(env.WHATSAPP_PROVIDER).toBe('assisted');
    expect(env.AI_PROVIDER).toBe('fake');
    expect(env.PLACES_PROVIDER).toBe('disabled');
    expect(env.ALLOW_REAL_SENDS).toBe(false);
    expect(env.IMPORT_MAX_ROWS).toBe(50_000);
  });

  it('trata strings vazias como ausentes', () => {
    const env = parseServerEnv({ ...minimal, REDIS_URL: '', AI_MONTHLY_BUDGET_USD: '  ' });
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.AI_MONTHLY_BUDGET_USD).toBeUndefined();
  });

  it('converte números e booleanos', () => {
    const env = parseServerEnv({ ...minimal, IMPORT_MAX_FILE_MB: '25', ALLOW_REAL_SENDS: 'true' });
    expect(env.IMPORT_MAX_FILE_MB).toBe(25);
    expect(env.ALLOW_REAL_SENDS).toBe(true);
  });

  it('converte a lista de proxies confiáveis e valida cada item', () => {
    expect(parseServerEnv(minimal).TRUSTED_PROXIES).toEqual([]);
    expect(
      parseServerEnv({ ...minimal, TRUSTED_PROXIES: ' 10.0.0.0/8, 172.16.0.1 ,fd00::/8' })
        .TRUSTED_PROXIES,
    ).toEqual(['10.0.0.0/8', '172.16.0.1', 'fd00::/8']);
    expect(problemsOf({ ...minimal, TRUSTED_PROXIES: '10.0.0.0/8, proxy.render.com' })[0]).toMatch(
      /^TRUSTED_PROXIES\.1: cada item deve ser um IP ou CIDR/,
    );
  });

  it('lista variáveis obrigatórias ausentes', () => {
    const problems = problemsOf({});
    expect(problems).toContain('DATABASE_URL: obrigatória');
    expect(problems).toContain('BETTER_AUTH_SECRET: obrigatória');
    expect(problems).toContain('SUPPRESSION_HASH_PEPPER: obrigatória');
  });

  it('rejeita segredo curto sem expor o valor na mensagem', () => {
    const leaked = 'segredo-curto';
    let message = '';
    try {
      parseServerEnv({ ...minimal, BETTER_AUTH_SECRET: leaked });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).not.toContain(leaked);
  });

  it('exige credenciais quando um provedor real é escolhido', () => {
    const problems = problemsOf({
      ...minimal,
      WHATSAPP_PROVIDER: 'meta_cloud',
      AI_PROVIDER: 'anthropic',
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'META_ACCESS_TOKEN: obrigatória quando WHATSAPP_PROVIDER=meta_cloud',
        'WHATSAPP_PHONE_NUMBER_ID: obrigatória quando WHATSAPP_PROVIDER=meta_cloud',
        'AI_API_KEY: obrigatória quando AI_PROVIDER=anthropic',
      ]),
    );
  });

  it('valida a versão da Graph API', () => {
    expect(problemsOf({ ...minimal, META_GRAPH_API_VERSION: '23' })).toEqual([
      'META_GRAPH_API_VERSION: formato esperado: v23.0',
    ]);
  });

  it('exige chave de criptografia de 32 bytes', () => {
    expect(problemsOf({ ...minimal, ENCRYPTION_KEY: 'curta' })[0]).toMatch(
      /^ENCRYPTION_KEY: deve ser/,
    );
    expect(problemsOf({ ...minimal, ENCRYPTION_KEY: KEY32 })).toEqual([]);
  });

  it('aplica regras mais rígidas em produção', () => {
    const problems = problemsOf({
      ...minimal,
      APP_ENV: 'production',
      APP_URL: 'http://sdr.example.com',
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'ENCRYPTION_KEY: obrigatória quando APP_ENV=production',
        'APP_URL: deve usar https fora do ambiente local',
        'EMAIL_PROVIDER: console não envia e-mails; use smtp ou resend em produção',
      ]),
    );
  });

  it('proíbe o provedor de e-mail em arquivo fora de dev/testes', () => {
    expect(problemsOf({ ...minimal, EMAIL_PROVIDER: 'file' })).toEqual([]);
    expect(
      problemsOf({
        ...minimal,
        APP_ENV: 'staging',
        APP_URL: 'https://staging.example.com',
        ENCRYPTION_KEY: KEY32,
        EMAIL_PROVIDER: 'file',
      }),
    ).toEqual(['EMAIL_PROVIDER: file é apenas para desenvolvimento e testes']);
  });

  it('aceita uma configuração de produção completa', () => {
    const env = parseServerEnv({
      ...minimal,
      APP_ENV: 'production',
      APP_URL: 'https://sdr.example.com',
      ENCRYPTION_KEY: KEY32,
      EMAIL_PROVIDER: 'smtp',
      SMTP_URL: 'smtp://user:pass@smtp.example.com:587',
    });
    expect(env.APP_ENV).toBe('production');
  });
});

describe('.env.example', () => {
  it('documenta exatamente as variáveis validadas pelo esquema', () => {
    const path = fileURLToPath(new URL('../../../.env.example', import.meta.url));
    const documented = readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter((key): key is string => Boolean(key));
    const notInSchema = new Set(['NODE_ENV', 'DATABASE_URL_TEST']);
    expect(documented.filter((k) => !notInSchema.has(k)).sort()).toEqual(
      Object.keys(serverEnvShape).sort(),
    );
  });
});
