-- Fase 6: um rascunho da IA pode ter um envio cancelado e depois outro; a
-- unicidade vale só para envios não cancelados.

-- DropIndex
DROP INDEX "messages_ai_generation_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "messages_ai_generation_active_key" ON "messages"("ai_generation_id") WHERE (status <> 'CANCELED');

