import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { CspNonce } from '@/components/csp-nonce';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Docline SDR', template: '%s · Docline SDR' },
  description: 'Central Inteligente de Prospecção da Docline.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#16181f' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonce da CSP gerado no proxy.ts, repassado aos scripts inline (tema).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <CspNonce nonce={nonce} />
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
