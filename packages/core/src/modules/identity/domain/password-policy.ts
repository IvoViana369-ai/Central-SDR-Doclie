import { ValidationError } from '../../../shared/errors';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Senhas óbvias recusadas mesmo com o tamanho mínimo (docs/SECURITY.md §3).
 * Lista curta e local; a verificação contra vazamentos públicos pode ser
 * adicionada depois sem mudar a interface.
 */
const COMMON = new Set([
  '123456789012',
  '1234567890123',
  'senha1234567',
  'senhasenha12',
  'password1234',
  'qwertyuiop12',
  'docline12345',
  'doclinesdr123',
  'mudar@123456',
  'abcdefghijkl',
]);

export function passwordProblems(password: string, context: { email?: string } = {}): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`);
  }
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) {
    problems.push('Essa senha é muito comum. Escolha outra.');
  }
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) {
    problems.push('A senha não pode conter o seu e-mail.');
  }
  return problems;
}

export function assertPasswordPolicy(password: string, context: { email?: string } = {}): void {
  const problems = passwordProblems(password, context);
  if (problems.length > 0) {
    throw new ValidationError(problems.map((message) => ({ path: 'password', message })));
  }
}
