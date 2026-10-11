import { describe, expect, it } from 'vitest';
import { buildIcs, googleCalendarLink, meetingEvent } from './domain/calendar';

const event = meetingEvent({
  taskId: '0190f0aa-0000-7000-8000-00000000000a',
  title: 'Reunião de apresentação',
  description: 'Levar a proposta; ver certificado A1, A3',
  dueAt: new Date('2026-10-14T13:00:00Z'),
  lead: { id: 'lead-1', displayName: 'Escritório Fictício Ipê; Contabilidade' },
  appUrl: 'https://sdr.example.com/',
});

describe('reunião na agenda (F12-05)', () => {
  it('evento de 30 minutos com o escritório no título e o link da ficha', () => {
    expect(event).toMatchObject({
      uid: 'task-0190f0aa-0000-7000-8000-00000000000a@docline-sdr',
      title: 'Reunião de apresentação — Escritório Fictício Ipê; Contabilidade',
      start: new Date('2026-10-14T13:00:00Z'),
      end: new Date('2026-10-14T13:30:00Z'),
      url: 'https://sdr.example.com/leads/lead-1',
    });
  });

  it('link de modelo do Google Agenda (sem OAuth)', () => {
    const url = new URL(googleCalendarLink(event));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261014T130000Z/20261014T133000Z');
    expect(url.searchParams.get('text')).toBe(event.title);
    expect(url.searchParams.get('details')).toBe(
      'Levar a proposta; ver certificado A1, A3\n\nFicha: https://sdr.example.com/leads/lead-1',
    );
  });

  it('.ics válido: CRLF, escapes e linhas dobradas em 75 octetos', () => {
    const ics = buildIcs(event, new Date('2026-10-13T12:00:00Z'));
    expect(ics.endsWith('\r\n')).toBe(true);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('DTSTART:20261014T130000Z\r\n');
    expect(unfolded).toContain('DTEND:20261014T133000Z\r\n');
    expect(unfolded).toContain('DTSTAMP:20261013T120000Z\r\n');
    expect(unfolded).toContain(
      'SUMMARY:Reunião de apresentação — Escritório Fictício Ipê\\; Contabilidade\r\n',
    );
    expect(unfolded).toContain(
      'DESCRIPTION:Levar a proposta\\; ver certificado A1\\, A3\\n\\nFicha: https://sdr.example.com/leads/lead-1\r\n',
    );
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
  });
});
