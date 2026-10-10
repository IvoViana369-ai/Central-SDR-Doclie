// Avaliação offline da IA (docs/AI-SDR.md §14): conjunto fictício, verificações
// automáticas, rubrica humana e regressão entre versões. Sem banco; usada pelo
// script `pnpm ai:eval` e pelos testes (com o provedor falso).
export * from './checks';
export * from './compare';
export * from './dataset';
export * from './format';
export * from './rubric';
export * from './runner';
