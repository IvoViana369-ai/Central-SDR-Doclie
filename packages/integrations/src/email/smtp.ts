import type { EmailProvider, TransactionalEmail } from '@docline/core';
import nodemailer, { type Transporter } from 'nodemailer';

/** SMTP (Mailpit no desenvolvimento; provedor transacional em produção). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(email: TransactionalEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: { 'X-Docline-Category': email.category },
    });
  }
}
