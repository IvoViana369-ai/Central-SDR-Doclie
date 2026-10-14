import type { DbClient } from './client';

/**
 * Coloca na etapa NEW do pipeline padrão os leads ainda sem etapa (leads de
 * antes da Fase 4 ou criados por uma versão anterior durante o deploy), com a
 * primeira linha do histórico. Idempotente; roda no seed e na subida do worker.
 * Devolve quantos leads foram posicionados.
 */
export async function backfillLeadStages(db: DbClient): Promise<number> {
  const placed = await db.$executeRaw`
    WITH stage AS (
      SELECT s.id, s.pipeline_id
      FROM pipeline_stages s
      JOIN pipelines p ON p.id = s.pipeline_id
      WHERE p.is_default AND s.key = 'NEW'
    ),
    placed AS (
      UPDATE leads l
      SET pipeline_id = stage.pipeline_id, stage_id = stage.id, stage_entered_at = l.created_at
      FROM stage
      WHERE l.stage_id IS NULL
      RETURNING l.id, l.stage_id, l.created_at
    )
    INSERT INTO lead_stage_history (id, lead_id, to_stage_id, automation_source, note, entered_at)
    SELECT gen_random_uuid(), id, stage_id, 'RULE', 'Etapa inicial (implantação do pipeline).', created_at
    FROM placed
    ON CONFLICT DO NOTHING`;
  return placed;
}
