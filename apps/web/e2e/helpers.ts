import { existsSync, readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { OUTBOX_FILE } from '../playwright.config';

export const ADMIN = { email: 'admin@e2e.example', password: 'cavalo-correto-bateria-grampo' };
export const SDR = {
  name: 'Bruno Prospector',
  email: 'bruno@e2e.example',
  password: 'sdr-senha-forte-do-teste',
};

export function adminInviteUrl(): string {
  const state = JSON.parse(
    readFileSync(new URL('./.state/admin-invite.json', import.meta.url), 'utf8'),
  ) as {
    inviteUrl: string;
  };
  return state.inviteUrl;
}

/** Último link de convite enviado para o endereço (provedor de e-mail em arquivo). */
export function lastInviteLinkFor(email: string): string {
  if (!existsSync(OUTBOX_FILE)) throw new Error('Nenhum e-mail enviado ainda.');
  const emails = readFileSync(OUTBOX_FILE, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { to: string; text: string; category: string })
    .filter((m) => m.to === email && m.category === 'invitation');
  const link = emails.at(-1)?.text.match(/https?:\/\/\S+\/convite\/\S+/)?.[0];
  if (!link) throw new Error(`Nenhum convite encontrado para ${email}.`);
  return link;
}

/** Falha o teste se a página registrar violação de CSP no console. */
export function watchCsp(page: Page): () => void {
  const violations: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(text))
      violations.push(text);
  });
  return () => expect(violations, 'violações de CSP no console').toEqual([]);
}

export async function setPassword(page: Page, password: string) {
  await page.getByLabel('Nova senha', { exact: true }).fill(password);
  await page.getByLabel('Confirme a nova senha').fill(password);
}

/** Faz login pela tela. Por padrão aguarda chegar ao dashboard (sessão criada). */
export async function signIn(
  page: Page,
  email: string,
  password: string,
  { expectSuccess = true } = {},
) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  if (expectSuccess) await expect(page).toHaveURL(/\/dashboard$/);
}

/** Alertas da aplicação (ignora o anunciador de rotas do Next, que também usa role="alert"). */
export function appAlert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}
