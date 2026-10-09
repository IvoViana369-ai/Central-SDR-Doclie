/**
 * Erros da Cloud API traduzidos para quem usa o app (docs/INTEGRATIONS.md
 * §6.2 e §14). A tabela segue a referência de códigos da Meta (revalidar a
 * cada atualização da versão da Graph API); código desconhecido mostra o
 * número para o suporte.
 */

export type WhatsappErrorKind =
  /** A Meta pede para esperar (a mensagem não saiu): dá para tentar de novo em minutos. */
  | 'RATE_LIMITED'
  /** Serviço indisponível antes de aceitar (a mensagem não saiu): dá para tentar de novo. */
  | 'UNAVAILABLE'
  /** Não se sabe se saiu: nunca reenviar sozinho. */
  | 'UNKNOWN_OUTCOME'
  /** Mais de 24 h desde a última mensagem do contato: só modelo. */
  | 'WINDOW_CLOSED'
  /** O contato pediu ao WhatsApp para não receber marketing da empresa. */
  | 'MARKETING_OPT_OUT'
  /** A Meta segurou a entrega (limite de marketing por pessoa). */
  | 'MARKETING_LIMIT'
  | 'UNDELIVERABLE'
  | 'TEMPLATE'
  | 'ACCOUNT'
  | 'AUTH'
  | 'BAD_REQUEST'
  | 'SENDS_DISABLED'
  | 'UNKNOWN';

interface ErrorInfo {
  kind: WhatsappErrorKind;
  message: string;
}

const META_ERRORS: Record<string, ErrorInfo> = {
  '131047': {
    kind: 'WINDOW_CLOSED',
    message:
      'Já passaram 24 horas desde a última mensagem do contato: só um modelo aprovado pode ser enviado.',
  },
  '131050': {
    kind: 'MARKETING_OPT_OUT',
    message:
      'O contato pediu ao WhatsApp para não receber mensagens de marketing da empresa. Não envie de novo.',
  },
  '131049': {
    kind: 'MARKETING_LIMIT',
    message:
      'A Meta não entregou para preservar a experiência do contato (limite de mensagens de marketing). Não insista agora.',
  },
  '131026': {
    kind: 'UNDELIVERABLE',
    message:
      'Não foi possível entregar: o número pode não ter WhatsApp, usar uma versão antiga ou não ter aceitado os termos.',
  },
  '131021': { kind: 'BAD_REQUEST', message: 'O destinatário é o próprio número da empresa.' },
  '131051': { kind: 'BAD_REQUEST', message: 'Tipo de mensagem não suportado.' },
  '131008': { kind: 'BAD_REQUEST', message: 'Faltou um campo obrigatório no pedido.' },
  '131009': { kind: 'BAD_REQUEST', message: 'Um valor do pedido é inválido.' },
  '100': { kind: 'BAD_REQUEST', message: 'Pedido inválido para a Graph API.' },
  '131042': { kind: 'ACCOUNT', message: 'Problema de pagamento na conta do WhatsApp na Meta.' },
  '131031': {
    kind: 'ACCOUNT',
    message: 'A conta do WhatsApp foi bloqueada ou restrita pela Meta.',
  },
  '368': {
    kind: 'ACCOUNT',
    message: 'A conta está temporariamente bloqueada por violação de política da Meta.',
  },
  '131064': {
    kind: 'ACCOUNT',
    message:
      'Limite de mensagens excedido por violação na classificação dos modelos. Revise os modelos com a Meta.',
  },
  '133010': { kind: 'ACCOUNT', message: 'O número da empresa não está registrado na Cloud API.' },
  '190': {
    kind: 'AUTH',
    message: 'Token da Meta inválido ou expirado. Gere um novo token do System User.',
  },
  '10': { kind: 'AUTH', message: 'O token da Meta não tem a permissão necessária.' },
  '200': { kind: 'AUTH', message: 'O token da Meta não tem a permissão necessária.' },
  '0': { kind: 'AUTH', message: 'Falha de autenticação na Meta.' },
  '130429': {
    kind: 'RATE_LIMITED',
    message: 'Limite de envio por segundo atingido. Tente de novo em alguns minutos.',
  },
  '131056': {
    kind: 'RATE_LIMITED',
    message:
      'Muitas mensagens para o mesmo número em pouco tempo. Tente de novo em alguns minutos.',
  },
  '80007': {
    kind: 'RATE_LIMITED',
    message: 'Limite de uso da conta atingido. Tente de novo em alguns minutos.',
  },
  '4': {
    kind: 'RATE_LIMITED',
    message: 'Limite de chamadas do app atingido. Tente de novo em alguns minutos.',
  },
  '131016': { kind: 'UNAVAILABLE', message: 'Serviço do WhatsApp indisponível no momento.' },
  '2': { kind: 'UNAVAILABLE', message: 'Serviço da Meta temporariamente indisponível.' },
  '131000': { kind: 'UNKNOWN', message: 'Erro desconhecido na Meta.' },
  '1': { kind: 'UNKNOWN', message: 'Erro desconhecido na Meta.' },
  '132000': {
    kind: 'TEMPLATE',
    message: 'A quantidade de variáveis não confere com a do modelo aprovado.',
  },
  '132001': {
    kind: 'TEMPLATE',
    message: 'O modelo não existe nesse idioma ou ainda não foi aprovado. Sincronize os modelos.',
  },
  '132005': { kind: 'TEMPLATE', message: 'O texto do modelo ficou longo demais com as variáveis.' },
  '132007': { kind: 'TEMPLATE', message: 'O conteúdo das variáveis viola a política da Meta.' },
  '132012': { kind: 'TEMPLATE', message: 'O formato das variáveis não confere com o do modelo.' },
  '132015': { kind: 'TEMPLATE', message: 'O modelo foi pausado pela Meta por baixa qualidade.' },
  '132016': { kind: 'TEMPLATE', message: 'O modelo foi desativado pela Meta.' },
};

/** Nossos códigos, quando a falha não veio da Meta. */
const LOCAL_ERRORS: Record<string, ErrorInfo> = {
  TIMEOUT: {
    kind: 'UNKNOWN_OUTCOME',
    message:
      'A Meta não respondeu a tempo e não dá para saber se a mensagem saiu. Confira no WhatsApp antes de enviar de novo.',
  },
  CONNECTION_LOST: {
    kind: 'UNKNOWN_OUTCOME',
    message:
      'A conexão caiu durante o envio e não dá para saber se a mensagem saiu. Confira no WhatsApp antes de enviar de novo.',
  },
  UNREACHABLE: { kind: 'UNAVAILABLE', message: 'Não foi possível conectar à Meta.' },
  REAL_SENDS_DISABLED: {
    kind: 'SENDS_DISABLED',
    message: 'Envios reais estão desligados neste ambiente (ALLOW_REAL_SENDS).',
  },
  INVALID_RESPONSE: {
    kind: 'UNKNOWN_OUTCOME',
    message: 'Resposta inesperada da Meta. Confira no WhatsApp antes de enviar de novo.',
  },
};

export function describeWhatsappError(code: string): ErrorInfo {
  return (
    META_ERRORS[code] ??
    LOCAL_ERRORS[code] ?? { kind: 'UNKNOWN', message: `Erro da Meta (código ${code}).` }
  );
}

/**
 * Falha passageira e a mensagem não saiu. O envio não repete sozinho (ADR 022):
 * a pessoa usa "Tentar de novo"; a sincronização e a checagem do número rodam no
 * próximo ciclo.
 */
export function isRetryableWhatsappError(code: string): boolean {
  const { kind } = describeWhatsappError(code);
  return kind === 'RATE_LIMITED' || kind === 'UNAVAILABLE';
}
