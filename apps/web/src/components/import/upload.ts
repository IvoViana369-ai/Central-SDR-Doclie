import { ApiError } from '@/lib/api-client';

/** Envia a planilha (multipart) e devolve o lote criado ou a mensagem de erro. */
export async function uploadSpreadsheet(
  file: File,
  sheet: string | null,
  maxFileMb: number,
): Promise<{ ok: true; batchId: string } | { ok: false; message: string }> {
  if (file.size > maxFileMb * 1024 * 1024) {
    return { ok: false, message: `O arquivo passa do limite de ${maxFileMb} MB.` };
  }
  const form = new FormData();
  form.append('file', file);
  if (sheet) form.append('sheet', sheet);
  try {
    const response = await fetch('/api/v1/imports', {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    });
    const body = (await response.json().catch(() => ({}))) as {
      batchId?: string;
      detail?: string;
      errors?: { message: string }[];
    };
    if (response.ok && body.batchId) return { ok: true, batchId: body.batchId };
    return {
      ok: false,
      message: body.errors?.[0]?.message ?? body.detail ?? 'Não foi possível enviar o arquivo.',
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApiError ? error.message : 'Falha de conexão ao enviar o arquivo.',
    };
  }
}
