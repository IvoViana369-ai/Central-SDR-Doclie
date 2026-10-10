/**
 * Os testes de integração APAGAM o banco. Esta trava impede que rodem contra
 * qualquer banco cujo nome não termine em `_test`.
 */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error('DATABASE_URL_TEST não definida (ver .env.example).');
  }
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Recusando rodar testes de integração no banco "${name}": o nome deve terminar em _test.`,
    );
  }
  return url;
}
