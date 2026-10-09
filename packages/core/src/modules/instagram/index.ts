// Módulo instagram (docs/INTEGRATIONS.md §7.2; Fase 8): mensagens recebidas e
// respostas na janela de 24 h, comentários de leads com a resposta privada e
// métricas públicas dos perfis (Business Discovery) para o score.
export * from './domain';
export { FakeInstagramProvider, fakeInstagramUserId } from './infra/fake-provider';
