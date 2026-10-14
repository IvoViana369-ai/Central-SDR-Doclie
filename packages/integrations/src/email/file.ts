import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EmailProvider, TransactionalEmail } from '@docline/core';

/**
 * Desenvolvimento e testes E2E: grava cada e-mail como uma linha JSON.
 * Proibido em staging e produção pela validação de ambiente.
 */
export class FileEmailProvider implements EmailProvider {
  readonly name = 'file';

  constructor(private readonly path: string) {}

  async send(email: TransactionalEmail): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(
      this.path,
      `${JSON.stringify({ ...email, sentAt: new Date().toISOString() })}\n`,
      'utf8',
    );
  }
}
