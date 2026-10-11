// Módulo outbox (Fase 12; ADR 035): eventos de negócio para fora, gravados na
// mesma transação da mudança, com uma entrega por destino de webhook. Base de
// baixo nível: não importa outros módulos, para que oportunidades e
// conformidade possam publicar sem ciclo.
export {
  eventLeads,
  leadCodeLabel,
  opportunityReferences,
  publishEvents,
  type EventLead,
  type OutboundEventInput,
} from './application/publish';
