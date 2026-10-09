import {
  InstagramProviderError,
  type InstagramAccountInfo,
  type InstagramDiscovery,
  type InstagramProvider,
  type InstagramSendResult,
  type InstagramUserProfile,
} from '../../../ports/instagram';

/** IGSID simulado de um @ (o simulador de webhooks usa o mesmo formato). */
export function fakeInstagramUserId(handle: string): string {
  return `fake-igsid-${handle.toLowerCase()}`;
}

/**
 * Instagram simulado (`INSTAGRAM_PROVIDER=fake`): desenvolvimento, testes, E2E
 * e demonstração em staging sem conta da Meta. Nada sai do servidor; mensagens
 * e comentários chegam como na produção, por webhooks no formato da Meta
 * (`pnpm instagram:simulate`).
 *
 * - O @ de quem escreveu sai do IGSID simulado (`fake-igsid-<@>`) ou de
 *   `profiles`, que os testes preenchem.
 * - Marcas no texto simulam falhas: `[fake:janela-fechada]`, `[fake:indisponivel]`,
 *   `[fake:limite]` e `[fake:incerto]`.
 * - Business Discovery determinístico pelo @: com "naoexiste" ou "pessoal" não
 *   é conta profissional; "inativo" publicou há 120 dias; "semposts" não tem
 *   publicações; "limite" falha por limite da Meta; os demais publicaram há
 *   poucos dias.
 */
export class FakeInstagramProvider implements InstagramProvider {
  readonly name = 'fake';
  readonly accountId = 'fake-ig-account';
  /** Mensagens "enviadas", para os testes conferirem. */
  readonly sent: { kind: 'text' | 'private_reply'; to: string; text: string; mid: string }[] = [];
  /** IGSID → perfil (além do formato `fake-igsid-<@>`). */
  readonly profiles = new Map<string, InstagramUserProfile>();
  /** @ consultados no Business Discovery, para os testes conferirem. */
  readonly discovered: string[] = [];
  private counter = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  private fail(text: string) {
    if (text.includes('[fake:janela-fechada]')) {
      throw new InstagramProviderError('Outside of allowed window', {
        outcome: 'NOT_SENT',
        retryable: false,
        code: '10/2018278',
        httpStatus: 400,
      });
    }
    if (text.includes('[fake:indisponivel]')) {
      throw new InstagramProviderError('User unavailable', {
        outcome: 'NOT_SENT',
        retryable: false,
        code: '551',
        httpStatus: 400,
      });
    }
    if (text.includes('[fake:limite]')) {
      throw new InstagramProviderError('Rate limit', {
        outcome: 'NOT_SENT',
        retryable: true,
        code: '613',
        httpStatus: 429,
      });
    }
    if (text.includes('[fake:incerto]')) {
      throw new InstagramProviderError('Tempo esgotado', {
        outcome: 'UNKNOWN',
        retryable: false,
        code: 'TIMEOUT',
      });
    }
  }

  async sendText(input: { recipientId: string; text: string }): Promise<InstagramSendResult> {
    this.fail(input.text);
    this.counter += 1;
    const mid = `mid.fake-${this.counter}-${Date.now()}`;
    this.sent.push({ kind: 'text', to: input.recipientId, text: input.text, mid });
    return { providerMessageId: mid, recipientId: input.recipientId };
  }

  async sendPrivateReply(input: { commentId: string; text: string }): Promise<InstagramSendResult> {
    this.fail(input.text);
    this.counter += 1;
    const mid = `mid.fake-reply-${this.counter}-${Date.now()}`;
    this.sent.push({ kind: 'private_reply', to: input.commentId, text: input.text, mid });
    return { providerMessageId: mid, recipientId: null };
  }

  async getUserProfile(igsid: string): Promise<InstagramUserProfile | null> {
    const known = this.profiles.get(igsid);
    if (known) return known;
    const handle = igsid.startsWith('fake-igsid-') ? igsid.slice('fake-igsid-'.length) : null;
    return handle ? { username: handle, name: null } : null;
  }

  async discover(handle: string): Promise<InstagramDiscovery> {
    this.discovered.push(handle);
    if (handle.includes('limite')) {
      throw new InstagramProviderError('Rate limit', {
        outcome: 'NOT_SENT',
        retryable: true,
        code: '4',
        httpStatus: 429,
      });
    }
    if (handle.includes('naoexiste') || handle.includes('pessoal')) return { found: false };
    const hash = [...handle].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 100_000, 7);
    const day = 86_400_000;
    if (handle.includes('semposts')) {
      return { found: true, followersCount: 50 + (hash % 100), mediaCount: 0, lastPostAt: null };
    }
    const daysAgo = handle.includes('inativo') ? 120 : (hash % 15) + 1;
    return {
      found: true,
      followersCount: 500 + (hash % 5000),
      mediaCount: 40 + (hash % 300),
      lastPostAt: new Date(this.now().getTime() - daysAgo * day),
    };
  }

  async getAccount(): Promise<InstagramAccountInfo> {
    return {
      id: this.accountId,
      username: 'docline.demo',
      name: 'Docline (demonstração)',
      followersCount: 1234,
    };
  }
}
