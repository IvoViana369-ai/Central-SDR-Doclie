export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Categoria para logs/métricas (sem dados pessoais). */
  category: 'invitation' | 'password_reset' | 'notification';
}

/** Envio de e-mails transacionais (convites, redefinição de senha). */
export interface EmailProvider {
  readonly name: string;
  send(email: TransactionalEmail): Promise<void>;
}
