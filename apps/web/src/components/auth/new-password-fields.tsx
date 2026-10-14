'use client';

import { PASSWORD_MIN_LENGTH, passwordProblems } from '@docline/core/password-policy';
import { Field } from '@/components/ui/input';
import { PasswordInput } from './password-input';

/** Valida nova senha + confirmação com a mesma política do servidor. */
export function validateNewPassword(
  password: string,
  confirmation: string,
  email?: string,
): string | null {
  const problems = passwordProblems(password, { email });
  if (problems.length > 0) return problems[0]!;
  if (password !== confirmation) return 'As senhas não conferem.';
  return null;
}

export function NewPasswordFields() {
  return (
    <>
      <Field
        label="Nova senha"
        htmlFor="password"
        hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres. Prefira uma frase fácil de lembrar.`}
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
        />
      </Field>
      <Field label="Confirme a nova senha" htmlFor="confirmation">
        <PasswordInput id="confirmation" name="confirmation" autoComplete="new-password" required />
      </Field>
    </>
  );
}
