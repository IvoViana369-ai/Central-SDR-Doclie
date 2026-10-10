import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import {
  CompanyRegistryError,
  type CompanyRegistrySource,
  type RegistryFile,
  type RegistryFileKind,
} from '@docline/core';

/**
 * Base aberta do CNPJ publicada pela Receita Federal (docs/INTEGRATIONS.md
 * §9.1): pastas mensais `AAAA-MM/` no servidor oficial de arquivos, com
 * `Estabelecimentos0..9.zip`, `Empresas0..9.zip` e `Municipios.zip` (um CSV
 * por ZIP). Nada de consulta a páginas de pesquisa: só o download dos arquivos
 * abertos, como a Receita os disponibiliza.
 *
 * - O mês só é usado com a publicação completa (a Receita sobe os arquivos ao
 *   longo de horas; meia base apagaria escritórios que continuam ativos).
 * - O ZIP é lido em streaming: o cabeçalho local é conferido e o conteúdo
 *   comprimido vai direto para o `zlib`, sem guardar o arquivo em disco nem na
 *   memória (os CSVs passam de 1 GB e podem usar ZIP64).
 * - Limites contra arquivo inesperadamente grande (comprimido e expandido) e
 *   contra download parado.
 */

export interface ReceitaOpenDataConfig {
  /** Pasta dos dados abertos do CNPJ, sem barra no fim. */
  baseUrl: string;
  /** Mês fixo (AAAA-MM); sem ele, o mais recente publicado. */
  reference?: string | null;
  /** Partes de Estabelecimentos e de Empresas esperadas por mês (hoje, 10). */
  expectedParts?: number;
  /** Tempo para a listagem responder ou o download começar. */
  timeoutMs?: number;
  /** Tempo máximo sem receber dados no meio do download. */
  idleTimeoutMs?: number;
  maxCompressedBytes?: number;
  maxUncompressedBytes?: number;
  fetch?: typeof fetch;
}

const GIB = 1024 ** 3;
const LOCAL_HEADER = 0x04034b50;

const FILE_PATTERNS: [RegExp, RegistryFileKind][] = [
  [/^Municipios\.zip$/i, 'MUNICIPALITIES'],
  [/^Estabelecimentos\d+\.zip$/i, 'ESTABLISHMENTS'],
  [/^Empresas\d+\.zip$/i, 'COMPANIES'],
];

/** Links de uma listagem de diretório (Apache/nginx "Index of"). */
export function directoryLinks(html: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*"([^"?#]+)"/gi)) {
    const href = decodeURIComponent(match[1]!);
    links.add(href.replace(/^.*\/(?=[^/]+\/?$)/, ''));
  }
  return [...links];
}

export class ReceitaOpenDataSource implements CompanyRegistrySource {
  readonly name = 'receita_open_data';
  private readonly baseUrl: string;
  private readonly expectedParts: number;
  private readonly timeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly maxCompressedBytes: number;
  private readonly maxUncompressedBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ReceitaOpenDataConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.expectedParts = config.expectedParts ?? 10;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.idleTimeoutMs = config.idleTimeoutMs ?? 120_000;
    this.maxCompressedBytes = config.maxCompressedBytes ?? 8 * GIB;
    this.maxUncompressedBytes = config.maxUncompressedBytes ?? 32 * GIB;
    this.fetchImpl = config.fetch ?? fetch;
  }

  private async listing(path: string): Promise<string[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'text/html' },
      });
    } catch {
      throw new CompanyRegistryError('Servidor da Receita indisponível.', 'UNAVAILABLE');
    }
    if (response.status === 404) {
      throw new CompanyRegistryError('Pasta não publicada pela Receita.', 'NOT_PUBLISHED');
    }
    if (!response.ok) {
      throw new CompanyRegistryError(
        `Servidor da Receita respondeu ${response.status}.`,
        'UNAVAILABLE',
      );
    }
    return directoryLinks(await response.text());
  }

  async latestReference(): Promise<string> {
    if (this.config.reference) return this.config.reference;
    const months = (await this.listing(''))
      .map((link) => /^(\d{4}-\d{2})\/?$/.exec(link)?.[1])
      .filter((m): m is string => Boolean(m))
      .sort();
    const latest = months.at(-1);
    if (!latest) {
      throw new CompanyRegistryError('Nenhum mês publicado na pasta da Receita.', 'NOT_PUBLISHED');
    }
    return latest;
  }

  async listFiles(reference: string): Promise<RegistryFile[]> {
    if (!/^\d{4}-\d{2}$/.test(reference)) {
      throw new CompanyRegistryError('Mês inválido.', 'NOT_PUBLISHED');
    }
    const files: RegistryFile[] = [];
    for (const link of await this.listing(`${reference}/`)) {
      const kind = FILE_PATTERNS.find(([pattern]) => pattern.test(link))?.[1];
      if (kind) files.push({ name: link, kind });
    }
    const count = (kind: RegistryFileKind) => files.filter((f) => f.kind === kind).length;
    if (
      count('MUNICIPALITIES') !== 1 ||
      count('ESTABLISHMENTS') !== this.expectedParts ||
      count('COMPANIES') !== this.expectedParts
    ) {
      throw new CompanyRegistryError(
        `Publicação de ${reference} incompleta na Receita (ainda subindo arquivos).`,
        'NOT_PUBLISHED',
      );
    }
    const order: RegistryFileKind[] = ['MUNICIPALITIES', 'ESTABLISHMENTS', 'COMPANIES'];
    return files.sort(
      (a, b) =>
        order.indexOf(a.kind) - order.indexOf(b.kind) ||
        a.name.localeCompare(b.name, 'en', { numeric: true }),
    );
  }

  async *open(reference: string, file: RegistryFile): AsyncIterable<Uint8Array> {
    const controller = new AbortController();
    const startTimer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${reference}/${file.name}`, {
        signal: controller.signal,
      });
    } catch {
      throw new CompanyRegistryError(
        `Download de ${file.name} não começou (servidor da Receita indisponível).`,
        'UNAVAILABLE',
      );
    } finally {
      clearTimeout(startTimer);
    }
    if (response.status === 404) {
      throw new CompanyRegistryError(`${file.name} não está publicado.`, 'NOT_PUBLISHED');
    }
    if (!response.ok || !response.body) {
      throw new CompanyRegistryError(
        `Servidor da Receita respondeu ${response.status} para ${file.name}.`,
        'UNAVAILABLE',
      );
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > this.maxCompressedBytes) {
      controller.abort();
      throw new CompanyRegistryError(`${file.name} maior que o limite de segurança.`, 'TOO_LARGE');
    }
    yield* this.inflateFirstEntry(file.name, response.body, controller);
  }

  /** Conteúdo da primeira entrada do ZIP, descompactado em streaming. */
  private async *inflateFirstEntry(
    fileName: string,
    body: ReadableStream<Uint8Array>,
    controller: AbortController,
  ): AsyncGenerator<Uint8Array> {
    const maxCompressed = this.maxCompressedBytes;
    const idleTimeoutMs = this.idleTimeoutMs;
    let compressed = 0;
    let idle: NodeJS.Timeout | undefined;
    const reader = body[Symbol.asyncIterator]();
    const nextChunk = async (): Promise<Uint8Array | null> => {
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), idleTimeoutMs);
      try {
        const result = await reader.next();
        if (result.done) return null;
        compressed += result.value.length;
        if (compressed > maxCompressed) {
          throw new CompanyRegistryError(
            `${fileName} maior que o limite de segurança.`,
            'TOO_LARGE',
          );
        }
        return result.value;
      } catch (error) {
        if (error instanceof CompanyRegistryError) throw error;
        throw new CompanyRegistryError(
          `Download de ${fileName} interrompido (conexão caída ou parada).`,
          'UNAVAILABLE',
        );
      } finally {
        clearTimeout(idle);
      }
    };

    try {
      // Cabeçalho local do ZIP: assinatura, flags, método, tamanhos do nome e do campo extra.
      let head = Buffer.alloc(0);
      const need = async (size: number) => {
        while (head.length < size) {
          const chunk = await nextChunk();
          if (!chunk) {
            throw new CompanyRegistryError(`${fileName} não é um ZIP válido.`, 'INVALID_FILE');
          }
          head = Buffer.concat([head, chunk]);
        }
      };
      await need(30);
      const flags = head.readUInt16LE(6);
      const method = head.readUInt16LE(8);
      if (head.readUInt32LE(0) !== LOCAL_HEADER || (flags & 0x1) !== 0 || method !== 8) {
        throw new CompanyRegistryError(
          `${fileName} fora do formato esperado (ZIP com deflate, sem senha).`,
          'INVALID_FILE',
        );
      }
      const dataStart = 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      await need(dataStart);
      const first = head.subarray(dataStart);

      async function* compressedStream() {
        if (first.length > 0) yield first;
        for (;;) {
          const chunk = await nextChunk();
          if (!chunk) return;
          yield chunk;
        }
      }
      const source = Readable.from(compressedStream());
      const inflater = zlib.createInflateRaw();
      let failure: unknown = null;
      source.on('error', (error) => {
        failure = error;
        inflater.destroy(error);
      });
      source.pipe(inflater);
      let expanded = 0;
      try {
        for await (const out of inflater) {
          expanded += (out as Buffer).length;
          if (expanded > this.maxUncompressedBytes) {
            throw new CompanyRegistryError(
              `${fileName} expandido maior que o limite de segurança.`,
              'TOO_LARGE',
            );
          }
          yield out as Buffer;
        }
      } catch (error) {
        if (failure instanceof CompanyRegistryError) throw failure;
        if (error instanceof CompanyRegistryError) throw error;
        throw new CompanyRegistryError(`${fileName} corrompido.`, 'INVALID_FILE');
      } finally {
        source.destroy();
      }
    } finally {
      // Fim da entrada (o diretório central não interessa) ou falha: encerra o download.
      controller.abort();
      await reader.return?.(undefined).catch(() => undefined);
    }
  }
}
