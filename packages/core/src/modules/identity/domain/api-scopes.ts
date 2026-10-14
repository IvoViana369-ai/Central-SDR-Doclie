import type { Permission } from './permissions';

/**
 * Escopos das chaves de API (Fase 12; docs/SECURITY.md §4.4).
 *
 * Uma chave nunca herda um perfil: cada escopo libera só as permissões
 * listadas aqui, e a rota ainda precisa aceitar chave com aquele escopo.
 * Nenhum escopo dá acesso a usuários, configurações, auditoria ou às próprias
 * chaves e webhooks.
 */
export const API_SCOPES = {
  'leads:read': {
    label: 'Ler leads e oportunidades',
    description: 'Ficha do lead (com contatos) e oportunidades, para o CRM completar o cadastro.',
    permissions: ['lead.read'],
  },
  'references:read': {
    label: 'Consultar referências externas',
    description: 'Achar o lead ou a oportunidade pelo id em outro sistema Docline.',
    permissions: ['reference.read'],
  },
  'references:write': {
    label: 'Gravar referências externas',
    description: 'Vincular, atualizar e desfazer o id do registro em outro sistema Docline.',
    permissions: ['reference.read', 'reference.manage'],
  },
  'suppression:check': {
    label: 'Consultar a Lista Não Contatar',
    description: 'Saber se um telefone, e-mail, @ ou CNPJ está na lista (sem ver a lista).',
    permissions: ['suppression.check'],
  },
  'suppression:write': {
    label: 'Registrar opt-out',
    description: 'Incluir na Lista Não Contatar um pedido recebido em outro sistema Docline.',
    permissions: ['suppression.check', 'optout.register'],
  },
  'bi:read': {
    label: 'Exportação para BI',
    description: 'Eventos e indicadores diários em formato incremental, sem dados pessoais.',
    permissions: ['bi.export'],
  },
} as const satisfies Record<
  string,
  { label: string; description: string; permissions: readonly Permission[] }
>;

export type ApiScope = keyof typeof API_SCOPES;

export const API_SCOPE_KEYS = Object.keys(API_SCOPES) as ApiScope[];

export function isApiScope(value: string): value is ApiScope {
  return Object.hasOwn(API_SCOPES, value);
}

/** A chave com estes escopos tem a permissão? */
export function scopesGrant(scopes: readonly string[], permission: Permission): boolean {
  return scopes.some(
    (scope) =>
      isApiScope(scope) &&
      (API_SCOPES[scope].permissions as readonly Permission[]).includes(permission),
  );
}
