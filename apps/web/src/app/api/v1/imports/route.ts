import { createImportBatch, listImportBatches, ValidationError } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  listImportBatches(deps, actor, query() as never, meta),
);

/** Folga para os campos do formulário multipart além do arquivo. */
const MULTIPART_OVERHEAD = 64 * 1024;

/**
 * Upload da planilha (multipart: `file` e, opcional, `sheet`). O tamanho é
 * conferido antes de ler o corpo; a leitura acontece no worker (`import.parse`).
 */
export const POST = apiHandler(
  async ({ request, deps, actor, meta }) => {
    const length = Number(request.headers.get('content-length') ?? '0');
    const limit = deps.importLimits.maxBytes;
    if (length > limit + MULTIPART_OVERHEAD) {
      throw new ValidationError([
        {
          path: 'file',
          message: `O arquivo passa do limite de ${Math.round(limit / 1024 / 1024)} MB.`,
        },
      ]);
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ValidationError([{ path: 'file', message: 'Envie o arquivo pelo formulário.' }]);
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new ValidationError([{ path: 'file', message: 'Escolha um arquivo .csv ou .xlsx.' }]);
    }
    const sheet = form.get('sheet');
    return createImportBatch(
      deps,
      actor,
      {
        fileName: file.name,
        content: new Uint8Array(await file.arrayBuffer()),
        sheet: typeof sheet === 'string' && sheet ? sheet : null,
      },
      meta,
    );
  },
  { status: 201 },
);
