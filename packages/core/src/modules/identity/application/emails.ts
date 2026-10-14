import type { TransactionalEmail } from '../../../ports/email';
import { escapeHtml } from '../../../shared/html';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Fortaleza',
});

export function invitationEmail(params: {
  to: string;
  name: string;
  inviteUrl: string;
  invitedByName: string | null;
  expiresAt: Date;
}): TransactionalEmail {
  const firstName = params.name.split(' ')[0] ?? params.name;
  const by = params.invitedByName ? ` por ${params.invitedByName}` : '';
  const expires = dateFormatter.format(params.expiresAt);
  const text = [
    `Olá, ${firstName}!`,
    '',
    `Você foi convidado${by} para acessar o Docline SDR, a central de prospecção da Docline.`,
    '',
    `Para definir sua senha e entrar, acesse: ${params.inviteUrl}`,
    '',
    `O link é pessoal e expira em ${expires}. Se você não esperava este convite, ignore este e-mail.`,
  ].join('\n');
  const html = `<p>Olá, ${escapeHtml(firstName)}!</p>
<p>Você foi convidado${escapeHtml(by)} para acessar o <strong>Docline SDR</strong>, a central de prospecção da Docline.</p>
<p><a href="${escapeHtml(params.inviteUrl)}">Definir minha senha e entrar</a></p>
<p>O link é pessoal e expira em ${escapeHtml(expires)}. Se você não esperava este convite, ignore este e-mail.</p>`;
  return {
    to: params.to,
    subject: 'Seu acesso ao Docline SDR',
    text,
    html,
    category: 'invitation',
  };
}

export function passwordResetEmail(params: {
  to: string;
  name: string;
  resetUrl: string;
}): TransactionalEmail {
  const firstName = params.name.split(' ')[0] ?? params.name;
  const text = [
    `Olá, ${firstName}!`,
    '',
    'Recebemos um pedido para redefinir a sua senha do Docline SDR.',
    '',
    `Para criar uma nova senha, acesse: ${params.resetUrl}`,
    '',
    'O link vale por 30 minutos e só pode ser usado uma vez. Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.',
  ].join('\n');
  const html = `<p>Olá, ${escapeHtml(firstName)}!</p>
<p>Recebemos um pedido para redefinir a sua senha do <strong>Docline SDR</strong>.</p>
<p><a href="${escapeHtml(params.resetUrl)}">Criar uma nova senha</a></p>
<p>O link vale por 30 minutos e só pode ser usado uma vez. Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.</p>`;
  return {
    to: params.to,
    subject: 'Redefinição de senha — Docline SDR',
    text,
    html,
    category: 'password_reset',
  };
}

/** Alerta aos administradores: pico de falhas de login em uma conta (docs/SECURITY.md §12). */
export function loginAlertEmail(params: {
  to: string;
  name: string;
  maskedEmail: string;
  failures: number;
  sources: number;
  windowMinutes: number;
  auditUrl: string;
}): TransactionalEmail {
  const firstName = params.name.split(' ')[0] ?? params.name;
  const summary = `${params.failures} tentativas de login com senha errada na conta ${params.maskedEmail} nos últimos ${params.windowMinutes} minutos, de ${params.sources} origem(ns).`;
  const text = [
    `Olá, ${firstName}!`,
    '',
    `O Docline SDR registrou ${summary}`,
    '',
    'A conta não foi bloqueada: quem erra a senha passa a esperar cada vez mais entre as tentativas. Se não reconhecer o movimento, confira a auditoria e combine com a pessoa a troca da senha.',
    '',
    `Auditoria: ${params.auditUrl}`,
  ].join('\n');
  const html = `<p>Olá, ${escapeHtml(firstName)}!</p>
<p>O <strong>Docline SDR</strong> registrou ${escapeHtml(summary)}</p>
<p>A conta não foi bloqueada: quem erra a senha passa a esperar cada vez mais entre as tentativas. Se não reconhecer o movimento, confira a auditoria e combine com a pessoa a troca da senha.</p>
<p><a href="${escapeHtml(params.auditUrl)}">Abrir a auditoria</a></p>`;
  return {
    to: params.to,
    subject: 'Alerta de segurança: tentativas de login — Docline SDR',
    text,
    html,
    category: 'notification',
  };
}
