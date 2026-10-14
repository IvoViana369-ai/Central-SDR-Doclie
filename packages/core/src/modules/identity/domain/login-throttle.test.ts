import { describe, expect, it } from 'vitest';
import { formatWait, throttleDelaySeconds } from './login-throttle';

describe('limite de login por conta', () => {
  it('sem atraso até 4 falhas; atraso progressivo a partir da 5ª, com teto de 15 min', () => {
    expect([0, 1, 4].map(throttleDelaySeconds)).toEqual([0, 0, 0]);
    expect([5, 6, 7, 8, 9].map(throttleDelaySeconds)).toEqual([30, 60, 120, 240, 480]);
    expect(throttleDelaySeconds(10)).toBe(900);
    expect(throttleDelaySeconds(50)).toBe(900);
  });

  it('formata a espera para a mensagem', () => {
    expect(formatWait(1)).toBe('1 segundo');
    expect(formatWait(30)).toBe('30 segundos');
    expect(formatWait(60)).toBe('1 minuto');
    expect(formatWait(61)).toBe('2 minutos');
    expect(formatWait(900)).toBe('15 minutos');
  });
});
