/**
 * Porta da base aberta do CNPJ (docs/INTEGRATIONS.md §9.1): os arquivos que a
 * Receita Federal publica todo mês, já descompactados. O adaptador cuida do
 * download e do ZIP; o core lê o CSV (`;`, Latin-1, sem cabeçalho), filtra os
 * CNAEs de contabilidade e grava o recorte. Nada de consulta a sites nem de
 * dados de sócios.
 *
 * Sem provedor (`COMPANY_REGISTRY_PROVIDER=disabled`), `CoreDeps.companyRegistry`
 * é `null`.
 */

/** Tipos de arquivo usados (os demais, como Sócios e Simples, não são lidos). */
export type RegistryFileKind = 'ESTABLISHMENTS' | 'COMPANIES' | 'MUNICIPALITIES';

export interface RegistryFile {
  /** Nome do arquivo no mês (ex.: `Estabelecimentos0.zip`). */
  name: string;
  kind: RegistryFileKind;
}

/** Falha da fonte já traduzida. */
export class CompanyRegistryError extends Error {
  constructor(
    message: string,
    readonly code:
      /** O mês pedido ainda não foi publicado (ou a pasta está incompleta). */
      | 'NOT_PUBLISHED'
      /** Servidor fora do ar, tempo esgotado ou conexão caída: tenta na próxima vez. */
      | 'UNAVAILABLE'
      /** Arquivo corrompido ou fora do formato esperado. */
      | 'INVALID_FILE'
      /** Arquivo maior que o limite de segurança. */
      | 'TOO_LARGE',
  ) {
    super(message);
    this.name = 'CompanyRegistryError';
  }
}

export interface CompanyRegistrySource {
  /** `fake` ou `receita_open_data`. */
  readonly name: string;
  /** Mês mais recente publicado e completo (AAAA-MM). */
  latestReference(): Promise<string>;
  /** Arquivos do mês que interessam à carga. */
  listFiles(reference: string): Promise<RegistryFile[]>;
  /** Conteúdo do arquivo descompactado (CSV em Latin-1), em pedaços. */
  open(reference: string, file: RegistryFile): AsyncIterable<Uint8Array>;
}
