import { uuidv7 } from 'uuidv7';

/** Novo identificador UUIDv7 (ordenado no tempo — docs/DATABASE.md §1). */
export function newId(): string {
  return uuidv7();
}
