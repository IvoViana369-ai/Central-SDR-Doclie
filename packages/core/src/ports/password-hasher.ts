/**
 * Hash de senha compatível com o provedor de autenticação (Better Auth), para
 * que senhas definidas por convite funcionem no login.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
}
