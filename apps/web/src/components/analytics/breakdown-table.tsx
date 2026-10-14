import type { BreakdownRow } from '@docline/core';
import { MIN_SAMPLE } from '@docline/core/analytics-domain';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { fmtInt, fmtPct } from './format';

/**
 * Quebra por cidade, origem ou SDR. As taxas são da coorte do primeiro
 * contato no período; com menos de 20 leads na base, levam um asterisco e a
 * nota de rodapé (docs/SDR-FLOW.md §11).
 */
export function BreakdownTable({
  rows,
  first,
  activity = false,
  compact = false,
}: {
  rows: BreakdownRow[];
  first: string;
  /** Colunas do que a pessoa fez no período (relatório por SDR). */
  activity?: boolean;
  /** Versão do dashboard: só as colunas principais. */
  compact?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nada no período.</p>;
  }
  const anySmall = rows.some((r) => r.smallSample);
  const rate = (value: number | null, small: boolean) => (
    <>
      {fmtPct(value)}
      {small && value !== null ? (
        <span className="text-muted-foreground" title="Amostra pequena">
          *<span className="sr-only"> (amostra pequena)</span>
        </span>
      ) : null}
    </>
  );
  const num = 'text-right tabular-nums whitespace-nowrap';
  return (
    <>
      <Table>
        <THead>
          <Tr>
            <Th>{first}</Th>
            {compact ? null : <Th className="text-right">Ativos</Th>}
            {activity ? (
              <Th className="text-right" title="Leads distintos contatados pela pessoa no período">
                Contatados
              </Th>
            ) : (
              <Th className="text-right" title="Leads cadastrados no período">
                Novos
              </Th>
            )}
            {activity && !compact ? <Th className="text-right">Mensagens</Th> : null}
            {activity && !compact ? <Th className="text-right">Novos</Th> : null}
            <Th className="text-right" title="Leads com o primeiro contato no período">
              1º contato
            </Th>
            <Th className="text-right" title="Responderam ÷ primeiros contatos do período">
              Resposta
            </Th>
            {compact ? null : <Th className="text-right">Interessados</Th>}
            {compact ? null : (
              <Th
                className="text-right"
                title={
                  activity
                    ? 'Oportunidades transferidas pela pessoa no período'
                    : 'Da coorte do 1º contato no período, quantos viraram oportunidade'
                }
              >
                {activity ? 'Transferidas' : 'Oportunidades'}
              </Th>
            )}
            <Th className="text-right" title="Oportunidades ganhas ÷ primeiros contatos do período">
              Conversão
            </Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.key ?? 'none'}>
              <Td className="max-w-56 truncate font-medium" title={r.label}>
                {r.label}
              </Td>
              {compact ? null : <Td className={num}>{fmtInt(r.active)}</Td>}
              <Td className={num}>
                {fmtInt(activity ? (r.activity?.leadsContacted ?? 0) : r.newLeads)}
              </Td>
              {activity && !compact ? (
                <Td className={num}>{fmtInt(r.activity?.messagesSent ?? 0)}</Td>
              ) : null}
              {activity && !compact ? <Td className={num}>{fmtInt(r.newLeads)}</Td> : null}
              <Td className={num}>{fmtInt(r.firstContacts)}</Td>
              <Td className={num}>{rate(r.responseRate, r.smallSample)}</Td>
              {compact ? null : <Td className={num}>{fmtInt(r.interested)}</Td>}
              {compact ? null : (
                <Td className={num}>
                  {fmtInt(activity ? (r.activity?.opportunities ?? 0) : r.opportunities)}
                </Td>
              )}
              <Td className={num}>{rate(r.conversionRate, r.smallSample)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      {anySmall ? (
        <p className="mt-2 text-xs text-muted-foreground">
          * Menos de {MIN_SAMPLE} primeiros contatos: compare com cautela.
        </p>
      ) : null}
    </>
  );
}
