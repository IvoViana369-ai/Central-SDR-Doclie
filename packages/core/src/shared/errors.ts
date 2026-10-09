/**
 * Erros de domínio tipados. A camada HTTP os converte em
 * application/problem+json (docs/ARCHITECTURE.md §7.8).
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 422;

  constructor(
    readonly issues: ValidationIssue[],
    message = 'Dados inválidos.',
  ) {
    super(message);
  }
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  readonly status = 401;

  constructor(message = 'Sessão inválida ou expirada.') {
    super(message);
  }
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly status = 403;

  constructor(message = 'Você não tem permissão para esta ação.') {
    super(message);
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor(message = 'Registro não encontrado.') {
    super(message);
  }
}

export class ConflictError extends DomainError {
  /** Subclasses podem especializar o código (ex.: POSSIBLE_DUPLICATE). */
  readonly code: string = 'CONFLICT';
  readonly status = 409;
}

/** Regra de negócio violada (ex.: remover o último administrador). */
export class BusinessRuleError extends DomainError {
  readonly code = 'BUSINESS_RULE';
  readonly status = 422;
}

/** Limite de uso atingido (ex.: exportações por dia). */
export class RateLimitError extends DomainError {
  readonly code = 'RATE_LIMITED';
  readonly status = 429;
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
