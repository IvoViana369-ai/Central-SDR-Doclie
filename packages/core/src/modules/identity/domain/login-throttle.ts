/**
 * Limite de tentativas de login por conta (docs/SECURITY.md §12), sem virar
 * ferramenta de bloqueio:
 * - o atraso vale para a combinação conta + IP. Quem erra a senha de um
 *   colega só atrasa a si mesmo; o colega, de outro IP, continua entrando;
 * - nada de bloqueio rígido: até 5 falhas na janela de 15 min sem atraso,
 *   depois 30 s, 1 min, 2 min… até 15 min entre tentativas;
 * - picos na mesma conta, somando todos os IPs, geram alerta ao ADMIN.
 * O limite por IP do Better Auth (10 / 15 min) continua valendo por cima.
 */
export const LOGIN_THROTTLE = {
  windowMinutes: 15,
  freeFailures: 5,
  baseDelaySeconds: 30,
  maxDelaySeconds: 15 * 60,
  /** Falhas na mesma conta (todos os IPs) dentro da janela que geram alerta. */
  alertFailures: 20,
} as const;

/** Espera exigida depois de `failures` falhas seguidas (conta + IP) na janela. */
export function throttleDelaySeconds(failures: number): number {
  if (failures < LOGIN_THROTTLE.freeFailures) return 0;
  return Math.min(
    LOGIN_THROTTLE.baseDelaySeconds * 2 ** (failures - LOGIN_THROTTLE.freeFailures),
    LOGIN_THROTTLE.maxDelaySeconds,
  );
}

/** "40 segundos", "1 minuto", "15 minutos". */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} segundo${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
}
