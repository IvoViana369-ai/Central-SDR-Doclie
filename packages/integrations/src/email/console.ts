import type { EmailProvider, Logger, TransactionalEmail } from '@docline/core';

/**
 * Desenvolvimento local: escreve o e-mail no log em vez de enviar.
 * Proibido em produção pela validação de ambiente.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  constructor(private readonly logger: Logger) {}

  async send(email: TransactionalEmail): Promise<void> {
    this.logger.info(
      {
        mail: {
          recipient: email.to,
          subject: email.subject,
          category: email.category,
          body: email.text,
        },
      },
      'E-mail (provedor console, não enviado)',
    );
  }
}
