/** Erro padronizado da API v1 (application/problem+json). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

/** Chamada à API v1 a partir de componentes cliente. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  if (response.ok) return (await response.json()) as T;
  let detail = 'Não foi possível concluir a operação.';
  let code = 'UNKNOWN';
  let errors: { path: string; message: string }[] = [];
  try {
    const problem = (await response.json()) as {
      detail?: string;
      code?: string;
      errors?: typeof errors;
    };
    detail = problem.detail ?? detail;
    code = problem.code ?? code;
    errors = problem.errors ?? [];
  } catch {
    // resposta sem corpo JSON
  }
  if (response.status === 401) {
    detail = 'Sua sessão expirou. Recarregue a página e entre novamente.';
    errors = [];
  }
  throw new ApiError(response.status, code, errors[0]?.message ?? detail, errors);
}
