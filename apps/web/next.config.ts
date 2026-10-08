import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Desenvolvimento: usa o .env da raiz do monorepo. Em produção as variáveis vêm
// da plataforma (Render) e este arquivo não existe.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Pacotes internos publicados como TypeScript.
  transpilePackages: ['@docline/config', '@docline/core', '@docline/db', '@docline/integrations'],
  // Bibliotecas de servidor carregadas pelo Node, sem bundling.
  serverExternalPackages: [
    '@prisma/client',
    '@prisma/adapter-pg',
    'pg',
    'pg-boss',
    'pino',
    'nodemailer',
  ],
  async headers() {
    // CSP com nonce é aplicada no proxy.ts; aqui ficam os cabeçalhos estáticos.
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
