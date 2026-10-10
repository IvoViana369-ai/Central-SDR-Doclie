/** `default` aponta para o pipeline padrão (a tela não precisa saber o id). */
export const pipelineIdFrom = (id: string) => (id === 'default' ? undefined : id);
