'use client';

import {
  availableActions,
  CAMPAIGN_ACTION_LABELS,
  canEditSettings,
  type CampaignAction,
} from '@docline/core/campaigns-domain';
import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api-client';

type Status = Parameters<typeof availableActions>[0];

/** O que cada ação faz, dito antes de confirmar. */
const CONFIRM: Partial<Record<CampaignAction, string>> = {
  build:
    'Congela a seleção de hoje (até 5.000 leads), avalia a elegibilidade de cada lead, distribui os aptos entre os SDRs e sorteia as variantes. Refazer substitui o retrato anterior. Nada é enviado.',
  activate:
    'A partir de agora, a cada hora, os leads aptos entram na cadência até o limite diário de cada SDR, nos dias de expediente (o primeiro lote já sai agora). Cada lead é conferido de novo na hora. A campanha não envia mensagens: cada contato é feito pelo SDR e passa pelo gate.',
  complete:
    'Encerra a liberação: quem ainda aguarda sai da campanha (os leads não são apagados). Os leads já liberados seguem na cadência e os resultados continuam contando por 90 dias.',
  archive: 'Tira a campanha da lista. Os dados ficam guardados.',
};

export function CampaignActions({
  campaignId,
  status,
  version,
}: {
  campaignId: string;
  status: Status;
  version: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<CampaignAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: CampaignAction) {
    setBusy(true);
    setError(null);
    try {
      await api(`/campaigns/${campaignId}/actions`, { method: 'POST', body: { action, version } });
      setConfirming(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(false);
    }
  }

  const actions = availableActions(status);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-2">
        {canEditSettings(status) ? (
          <Button asChild variant="outline">
            <Link href={`/campanhas/${campaignId}/editar`}>
              <Pencil /> Editar
            </Link>
          </Button>
        ) : null}
        {actions.map((action) => (
          <Button
            key={action}
            variant={
              action === 'activate' || action === 'build' || action === 'resume'
                ? 'default'
                : 'outline'
            }
            disabled={busy}
            onClick={() => (CONFIRM[action] ? setConfirming(action) : void run(action))}
          >
            {action === 'build' && status === 'READY'
              ? 'Montar de novo'
              : CAMPAIGN_ACTION_LABELS[action]}
          </Button>
        ))}
      </div>
      {error && !confirming ? <Alert variant="error">{error}</Alert> : null}
      {confirming ? (
        <Dialog open onOpenChange={(open) => (!open ? setConfirming(null) : undefined)}>
          <DialogContent title={`${CAMPAIGN_ACTION_LABELS[confirming]} a campanha?`}>
            <p className="text-sm">{CONFIRM[confirming]}</p>
            {error ? (
              <Alert variant="error" className="mt-3">
                {error}
              </Alert>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(null)}>
                Voltar
              </Button>
              <Button disabled={busy} onClick={() => void run(confirming)}>
                {CAMPAIGN_ACTION_LABELS[confirming]}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Enquanto a campanha é montada (job em segundo plano), recarrega a página. */
export function BuildingRefresher() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
