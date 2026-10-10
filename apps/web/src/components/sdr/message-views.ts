/**
 * Visões da tela Mensagens. Fora do componente cliente: a página (servidor)
 * também lê a lista para validar `?view=`.
 */
export const MESSAGE_VIEWS = [
  { key: 'pending', label: 'A confirmar', empty: 'Nenhum envio aguardando a sua confirmação.' },
  {
    key: 'unclassified',
    label: 'Sem classificação',
    empty: 'Todas as respostas estão classificadas.',
  },
  { key: 'replies', label: 'Respostas', empty: 'Nenhuma resposta registrada.' },
  { key: 'sent', label: 'Enviadas', empty: 'Nenhuma mensagem enviada.' },
] as const;

export type MessageViewKey = (typeof MESSAGE_VIEWS)[number]['key'];
