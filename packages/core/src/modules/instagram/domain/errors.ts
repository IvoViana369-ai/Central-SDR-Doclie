/**
 * Erros da API do Instagram traduzidos para quem usa o app (docs/INTEGRATIONS.md
 * §7.2 e §14). Códigos com subcódigo vêm como "código/subcódigo". A tabela
 * segue a referência de erros da Meta para mensagens do Instagram; **revalidar**
 * a cada troca de versão da Graph API (a página oficial não pôde ser lida
 * quando esta tabela foi escrita). Código desconhecido mostra o número.
 */

export type InstagramErrorKind =
  /** A Meta pede para esperar (a mensagem não saiu): dá para tentar de novo em minutos. */
  | 'RATE_LIMITED'
  /** Serviço indisponível antes de aceitar (a mensagem não saiu). */
  | 'UNAVAILABLE'
  /** Não se sabe se saiu: nunca reenviar sozinho. */
  | 'UNKNOWN_OUTCOME'
  /** Mais de 24 h desde a última mensagem da pessoa. */
  | 'WINDOW_CLOSED'
  /** A pessoa não pode receber (bloqueou a conta, restringiu mensagens, conta removida). */
  | 'USER_UNAVAILABLE'
  /** A resposta privada passou do prazo ou o comentário já foi respondido. */
  | 'REPLY_NOT_ALLOWED'
  | 'AUTH'
  | 'BAD_REQUEST'
  | 'SENDS_DISABLED'
  | 'UNKNOWN';

interface ErrorInfo {
  kind: InstagramErrorKind;
  message: string;
}

const META_ERRORS: Record<string, ErrorInfo> = {
  '10/2018278': {
    kind: 'WINDOW_CLOSED',
    message:
      'Já passaram 24 horas desde a última mensagem da pessoa: a API não permite enviar. Se fizer sentido, responda pelo app do Instagram.',
  },
  '551': {
    kind: 'USER_UNAVAILABLE',
    message:
      'A pessoa não está disponível para receber mensagens (pode ter bloqueado a conta ou restringido mensagens).',
  },
  '100/2018001': {
    kind: 'USER_UNAVAILABLE',
    message: 'A Meta não encontrou a pessoa desta conversa.',
  },
  '10903': {
    kind: 'REPLY_NOT_ALLOWED',
    message:
      'A Meta não aceitou a resposta privada: o comentário tem mais de 7 dias ou já foi respondido.',
  },
  '190': {
    kind: 'AUTH',
    message: 'Token da Página inválido ou expirado. Gere um novo token do System User.',
  },
  '10': { kind: 'AUTH', message: 'O token não tem a permissão necessária para o Instagram.' },
  '200': { kind: 'AUTH', message: 'O token não tem a permissão necessária para o Instagram.' },
  '4': {
    kind: 'RATE_LIMITED',
    message: 'Limite de chamadas do app atingido. Tente de novo em alguns minutos.',
  },
  '17': {
    kind: 'RATE_LIMITED',
    message: 'Limite de chamadas atingido. Tente de novo em alguns minutos.',
  },
  '32': {
    kind: 'RATE_LIMITED',
    message: 'Limite de chamadas da Página atingido. Tente de novo em alguns minutos.',
  },
  '613': {
    kind: 'RATE_LIMITED',
    message: 'Limite de chamadas atingido. Tente de novo em alguns minutos.',
  },
  '80002': {
    kind: 'RATE_LIMITED',
    message: 'Muitas chamadas para a conta do Instagram. Tente de novo em alguns minutos.',
  },
  '2': { kind: 'UNAVAILABLE', message: 'Serviço da Meta temporariamente indisponível.' },
  '1': { kind: 'UNKNOWN', message: 'Erro desconhecido na Meta.' },
  '100': { kind: 'BAD_REQUEST', message: 'Pedido inválido para a Graph API.' },
};

/** Nossos códigos, quando a falha não veio da Meta. */
const LOCAL_ERRORS: Record<string, ErrorInfo> = {
  TIMEOUT: {
    kind: 'UNKNOWN_OUTCOME',
    message:
      'A Meta não respondeu a tempo e não dá para saber se a mensagem saiu. Confira no Instagram antes de enviar de novo.',
  },
  CONNECTION_LOST: {
    kind: 'UNKNOWN_OUTCOME',
    message:
      'A conexão caiu durante o envio e não dá para saber se a mensagem saiu. Confira no Instagram antes de enviar de novo.',
  },
  INVALID_RESPONSE: {
    kind: 'UNKNOWN_OUTCOME',
    message: 'Resposta inesperada da Meta. Confira no Instagram antes de enviar de novo.',
  },
  UNREACHABLE: { kind: 'UNAVAILABLE', message: 'Não foi possível conectar à Meta.' },
  REAL_SENDS_DISABLED: {
    kind: 'SENDS_DISABLED',
    message: 'Envios reais estão desligados neste ambiente (ALLOW_REAL_SENDS).',
  },
  // Conferido de novo na hora do envio; pode mudar (horário, intervalo entre contatos).
  GATE_BLOCKED: {
    kind: 'UNKNOWN',
    message:
      'As regras de contato bloquearam o envio (Lista Não Contatar, base legal, horário ou intervalo).',
  },
};

export function describeInstagramError(code: string): ErrorInfo {
  const base = code.split('/')[0] ?? code;
  return (
    META_ERRORS[code] ??
    LOCAL_ERRORS[code] ??
    META_ERRORS[base] ?? { kind: 'UNKNOWN', message: `Erro da Meta (código ${code}).` }
  );
}

/**
 * Falha passageira e a mensagem não saiu. O envio não repete sozinho (ADR 022):
 * a pessoa usa "Tentar de novo"; a consulta de perfis roda no próximo ciclo.
 */
export function isRetryableInstagramError(code: string): boolean {
  const { kind } = describeInstagramError(code);
  return kind === 'RATE_LIMITED' || kind === 'UNAVAILABLE';
}
