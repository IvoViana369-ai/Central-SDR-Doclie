/**
 * Porta do Instagram em modo API (docs/INTEGRATIONS.md §7.2): API do Instagram
 * com Facebook Login (conta profissional da Docline ligada a uma Página). O
 * domínio usa tipos próprios; nenhum tipo da Graph API atravessa a porta. Os
 * webhooks chegam no formato da Meta e são lidos por `parseInstagramWebhook`
 * (o provedor simulado também fala esse formato).
 *
 * A API não permite iniciar conversa: só responder a quem escreveu (janela de
 * 24 h) e responder em particular, uma vez, a quem comentou (até 7 dias). O
 * primeiro contato continua assistido, pelo app.
 *
 * Sem provedor (`INSTAGRAM_PROVIDER=assisted`), `CoreDeps.instagram` é `null`.
 */

export interface InstagramSendResult {
  /** `mid` da mensagem na Meta. */
  providerMessageId: string;
  /** IGSID de quem recebeu (na resposta privada, só se descobre aqui). */
  recipientId: string | null;
}

/** Perfil de quem escreveu (só existe depois que a pessoa mandou mensagem). */
export interface InstagramUserProfile {
  username: string | null;
  name: string | null;
}

/** Métricas públicas de uma conta profissional (Business Discovery). */
export type InstagramDiscovery =
  | {
      found: true;
      followersCount: number | null;
      mediaCount: number | null;
      /** Data da publicação mais recente (null se a conta não tem publicações). */
      lastPostAt: Date | null;
    }
  /** O @ não existe ou não é conta profissional (a API só mostra essas). */
  | { found: false };

/** Conta da Docline no Instagram (sem segredos). */
export interface InstagramAccountInfo {
  id: string;
  username: string | null;
  name: string | null;
  followersCount: number | null;
}

/**
 * Como a falha deixa a mensagem (mesma regra do WhatsApp, ADR 022):
 * - `NOT_SENT`: a Meta não aceitou (ou o pedido nem saiu);
 * - `UNKNOWN`: o pedido saiu e a resposta não chegou. Nunca se reenvia sozinho.
 */
export type InstagramSendOutcome = 'NOT_SENT' | 'UNKNOWN';

/** Falha do provedor já traduzida (código da Meta, quando houver). */
export class InstagramProviderError extends Error {
  constructor(
    message: string,
    readonly details: {
      outcome: InstagramSendOutcome;
      retryable: boolean;
      /** Código da Meta (ex.: "10/2018278" com o subcódigo), ou nosso (TIMEOUT). */
      code: string;
      httpStatus?: number;
    },
  ) {
    super(message);
    this.name = 'InstagramProviderError';
  }
}

export interface InstagramProvider {
  /** `fake` ou `meta_graph` (gravado em `messages.provider`). */
  readonly name: string;
  /** Id da conta profissional da Docline (reconhece as mensagens dela nos webhooks). */
  readonly accountId: string;
  /** Mensagem de texto para quem escreveu (só dentro da janela de 24 h). */
  sendText(input: { recipientId: string; text: string }): Promise<InstagramSendResult>;
  /** Resposta privada a um comentário (uma por comentário, até 7 dias). */
  sendPrivateReply(input: { commentId: string; text: string }): Promise<InstagramSendResult>;
  /** @ e nome de quem escreveu, pelo IGSID (null se a Meta não informar). */
  getUserProfile(igsid: string): Promise<InstagramUserProfile | null>;
  /** Métricas públicas de uma conta profissional, pelo @ (Business Discovery). */
  discover(handle: string): Promise<InstagramDiscovery>;
  getAccount(): Promise<InstagramAccountInfo>;
}
