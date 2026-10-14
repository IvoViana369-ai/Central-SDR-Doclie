-- Fase 5: motivos de encerramento da cadência para lead bloqueado na Lista Não
-- Contatar (reclamação, decisão interna, ordem legal) e lead mesclado em outro.
-- PostgreSQL 12+ aceita vários ADD VALUE na mesma transação.

ALTER TYPE "enrollment_stop_reason" ADD VALUE 'BLOCKED';
ALTER TYPE "enrollment_stop_reason" ADD VALUE 'LEAD_MERGED';
