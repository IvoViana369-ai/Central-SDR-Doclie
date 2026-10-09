// Módulo ai-sdr (docs/AI-SDR.md): copiloto do SDR. Gera rascunhos e sugere
// classificações; nada sai sem aprovação humana. O provedor fica atrás da
// porta AiProvider (ports/ai.ts).
export * from './domain';
export * from './prompts';
export { FAKE_MODEL, FakeAiProvider } from './infra/fake-provider';
