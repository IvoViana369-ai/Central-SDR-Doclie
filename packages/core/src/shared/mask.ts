/** Mascara e-mail para logs e auditoria: "joao.silva@example.com" → "j***@example.com". */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}
