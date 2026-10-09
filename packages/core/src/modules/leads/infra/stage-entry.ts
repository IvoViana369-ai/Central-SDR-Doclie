import type { DbTransaction } from '@docline/db';

/** Chave da etapa de entrada: todo cadastro e toda importação começam aqui. */
export const ENTRY_STAGE_KEY = 'NEW';

/** Etapa "Novo" do pipeline padrão (criada pelo seed). */
export async function entryStage(tx: DbTransaction) {
  const stage = await tx.pipelineStage.findFirst({
    where: { key: ENTRY_STAGE_KEY, pipeline: { isDefault: true } },
    select: { id: true, pipelineId: true },
  });
  if (!stage) {
    throw new Error('Pipeline padrão sem a etapa "Novo": rode o seed (pnpm db:seed).');
  }
  return stage;
}
