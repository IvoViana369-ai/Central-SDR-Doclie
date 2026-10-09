import { describe, expect, it } from 'vitest';
import { DEFAULT_OPT_OUT_KEYWORDS } from '../../settings';
import { detectOptOut } from './opt-out';

const detect = (text: string) => detectOptOut(text, DEFAULT_OPT_OUT_KEYWORDS);

describe('detecção de opt-out nas respostas (suíte de opt-out)', () => {
  it('a resposta curta com a palavra é opt-out certo, com qualquer caixa e pontuação', () => {
    for (const text of ['SAIR', 'Sair.', 'pare!', 'Stop', 'sair por favor', '  PARAR  ']) {
      expect(detect(text), text).toMatchObject({ level: 'CERTAIN' });
    }
  });

  it('expressões de várias palavras valem em qualquer posição, com ou sem acento', () => {
    expect(detect('Bom dia. Não quero receber essas mensagens, obrigado')).toEqual({
      level: 'CERTAIN',
      match: 'nao quero receber',
    });
    expect(detect('Por gentileza, me tire da lista de vocês')).toMatchObject({
      level: 'CERTAIN',
      match: 'me tire da lista',
    });
    expect(detect('REMOVA MEU NÚMERO')).toMatchObject({ level: 'CERTAIN' });
    expect(detect('não me procure mais')).toMatchObject({ level: 'CERTAIN' });
  });

  it('palavra solta num texto maior é só uma possibilidade: a pessoa decide', () => {
    expect(detect('Hoje vou sair mais cedo, me liga amanhã')).toEqual({
      level: 'POSSIBLE',
      match: 'sair',
    });
    expect(detect('Pode parar de mandar, já temos fornecedor de certificado')).toMatchObject({
      level: 'POSSIBLE',
    });
  });

  it('respostas comuns não são opt-out', () => {
    for (const text of [
      'Tenho interesse, pode me ligar?',
      'Qual o valor do certificado A1?',
      'Estou de férias até dia 20',
      'Saindo agora, falamos depois', // "saindo" não é "sair"
      '',
    ]) {
      expect(detect(text), text).toEqual({ level: 'NONE', match: null });
    }
  });

  it('usa a lista configurada pelo ADMIN', () => {
    expect(detectOptOut('CANCELAR', ['cancelar'])).toMatchObject({ level: 'CERTAIN' });
    expect(detectOptOut('CANCELAR', ['sair'])).toMatchObject({ level: 'NONE' });
  });
});
