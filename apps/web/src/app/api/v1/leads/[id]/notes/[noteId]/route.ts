import { removeNote, setNotePinned } from '@docline/core';
import { apiHandler } from '@/server/api';

type Params = { id: string; noteId: string };

/** Fixar/desafixar ({ pinned }). */
export const PATCH = apiHandler<Params>(async ({ deps, actor, meta, params, body }) =>
  setNotePinned(
    deps,
    actor,
    { ...((await body()) as object), leadId: params.id, noteId: params.noteId } as never,
    meta,
  ),
);

/** Remoção lógica (autor ou ADMIN). */
export const DELETE = apiHandler<Params>(async ({ deps, actor, meta, params }) =>
  removeNote(deps, actor, { leadId: params.id, noteId: params.noteId }, meta),
);
