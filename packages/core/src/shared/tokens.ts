import { createHash, randomBytes } from 'node:crypto';

/** Token aleatório de alta entropia (32 bytes), seguro para URLs. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash SHA-256 do token: guardamos só o hash no banco. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
