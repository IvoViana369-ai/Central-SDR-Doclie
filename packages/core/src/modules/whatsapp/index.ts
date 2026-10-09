// Módulo whatsapp (docs/INTEGRATIONS.md §6.2; Fase 7): envio pela Cloud API
// (texto na janela de atendimento, modelos aprovados com opt-in), webhooks de
// status e de mensagens recebidas, modelos, conversas e saúde do número.
export * from './domain';
export { FAKE_TEMPLATES, FakeWhatsappProvider } from './infra/fake-provider';
