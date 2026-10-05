import { describe, expect, it } from 'vitest';
import { invitationEmail } from './emails';

describe('invitationEmail', () => {
  const email = invitationEmail({
    to: 'ana@example.com',
    name: 'Ana<img/src=x> Souza',
    inviteUrl: 'https://sdr.example.com/convite/abc',
    invitedByName: 'Carlos <script>',
    expiresAt: new Date('2026-10-08T15:00:00Z'),
  });

  it('inclui o link e o prazo (horário de Fortaleza)', () => {
    expect(email.text).toContain('https://sdr.example.com/convite/abc');
    expect(email.text).toContain('08/10/2026, 12:00');
    expect(email.text).toContain('por Carlos');
    expect(email.subject).toBe('Seu acesso ao Docline SDR');
  });

  it('escapa dados no HTML', () => {
    expect(email.html).toContain('Olá, Ana&lt;img/src=x&gt;!');
    expect(email.html).toContain('por Carlos &lt;script&gt;');
    expect(email.html).not.toMatch(/<img|<script/);
  });
});
