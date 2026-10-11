import {
  findExternalReferences,
  removeExternalReference,
  upsertExternalReference,
} from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Referências externas (F12-03). Busca pelo id no outro sistema
 * (?entityType=LEAD&system=DOCLINE_CRM&externalId=…) ou lista as de um
 * registro (?entityType=LEAD&entityId=…). Chave com `references:read`.
 */
export const GET = apiHandler(
  async ({ deps, actor, meta, query }) => {
    const { entityType, entityId, system, externalId } = query();
    return findExternalReferences(
      deps,
      actor,
      {
        entityType: entityType as never,
        entityId: entityId || undefined,
        system: system || undefined,
        externalId: externalId || undefined,
      },
      meta,
    );
  },
  { apiKey: 'references:read' },
);

/** Vincula ou atualiza ({ entityType, entityId, system?, externalId, url? }). */
export const PUT = apiHandler(
  async ({ deps, actor, meta, body }) =>
    upsertExternalReference(deps, actor, (await body()) as never, meta),
  { apiKey: 'references:write' },
);

/** Desfaz o vínculo (?entityType=&entityId=&system=). */
export const DELETE = apiHandler(
  async ({ deps, actor, meta, query }) => {
    const { entityType, entityId, system } = query();
    return removeExternalReference(
      deps,
      actor,
      { entityType: entityType as never, entityId: entityId as never, system: system || undefined },
      meta,
    );
  },
  { apiKey: 'references:write' },
);
