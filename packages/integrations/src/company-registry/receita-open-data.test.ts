import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CompanyRegistryError,
  encodeLatin1,
  fakeCnpj,
  parseEstablishmentLine,
  readLatin1Lines,
  receitaCsvLine,
  type RegistryFile,
} from '@docline/core';
import { Zip, ZipDeflate, zipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { directoryLinks, ReceitaOpenDataSource } from './receita-open-data';

/** Servidor local que imita a pasta de arquivos da Receita: sem rede, sem dados reais. */
let server: Server;
let baseUrl = '';
type Handler = (res: ServerResponse) => void;
let routes = new Map<string, Handler>();
const requested: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requested.push(req.url ?? '');
    const handler = routes.get(req.url ?? '');
    if (!handler) {
      res.writeHead(404).end('Not found');
      return;
    }
    handler(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/dados/cnpj/dados_abertos_cnpj`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  routes = new Map();
  requested.length = 0;
});

const PATH = '/dados/cnpj/dados_abertos_cnpj';
const html = (links: string[]) =>
  `<html><body><h1>Index of ${PATH}</h1><a href="../">Parent</a>${links
    .map((l) => `<a href="${l}">${l}</a>`)
    .join('\n')}</body></html>`;
const send =
  (body: string | Uint8Array, status = 200, type = 'text/html'): Handler =>
  (res) => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };

/** CSV fictício de Estabelecimentos (Latin-1), com um escritório e uma padaria. */
function establishmentsCsv(): Uint8Array {
  const line = (root: string, name: string, cnae: string) => {
    const cnpj = fakeCnpj(root);
    return receitaCsvLine([
      root,
      '0001',
      cnpj.slice(12),
      '1',
      name,
      '02',
      '20200101',
      '00',
      '',
      '',
      '20150310',
      cnae,
      '',
      'RUA',
      'FICTÍCIA',
      '10',
      '',
      'CENTRO',
      '62010000',
      'CE',
      '1559',
      '88',
      '36110001',
      '',
      '',
      '',
      '',
      'contato@ficticia.example',
      '',
      '',
    ]);
  };
  return encodeLatin1(
    `${line('FK000101', 'CONTABILIDADE AÇAÍ', '6920601')}\r\n${line('FK000102', 'PADARIA', '1091101')}\r\n`,
  );
}

function streamedZip(name: string, content: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const parts: Uint8Array[] = [];
    const zip = new Zip((error, data, final) => {
      if (error) return reject(error);
      parts.push(data);
      if (final) resolve(Buffer.concat(parts));
    });
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(content, true);
    zip.end();
  });
}

const source = (overrides: Partial<ConstructorParameters<typeof ReceitaOpenDataSource>[0]> = {}) =>
  new ReceitaOpenDataSource({ baseUrl, expectedParts: 2, timeoutMs: 2000, ...overrides });

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const chunk of stream) parts.push(chunk);
  return Buffer.concat(parts);
}

const ESTAB: RegistryFile = { name: 'Estabelecimentos0.zip', kind: 'ESTABLISHMENTS' };

describe('base aberta do CNPJ na pasta oficial da Receita (adaptador)', () => {
  it('listagem: mês mais recente, mês fixo e links relativos ou absolutos', async () => {
    expect(directoryLinks(html(['2026-08/', `${PATH}/2026-09/`, 'regras.pdf']))).toEqual([
      '../',
      '2026-08/',
      '2026-09/',
      'regras.pdf',
    ]);
    routes.set(`${PATH}/`, send(html(['2025-12/', '2026-09/', '2026-08/', 'cnpj.tar.gz'])));
    expect(await source().latestReference()).toBe('2026-09');
    expect(await source({ reference: '2026-07' }).latestReference()).toBe('2026-07');
    routes.set(`${PATH}/`, send(html(['leia-me.txt'])));
    await expect(source().latestReference()).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });
  });

  it('mês incompleto não é usado; completo vem em ordem (municípios, estabelecimentos, empresas)', async () => {
    routes.set(
      `${PATH}/2026-09/`,
      send(html(['Empresas0.zip', 'Estabelecimentos0.zip', 'Municipios.zip', 'Socios0.zip'])),
    );
    await expect(source().listFiles('2026-09')).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });
    routes.set(
      `${PATH}/2026-09/`,
      send(
        html([
          'Estabelecimentos1.zip',
          'Empresas1.zip',
          'Empresas0.zip',
          'Estabelecimentos0.zip',
          'Municipios.zip',
          'Socios0.zip',
          'Simples.zip',
        ]),
      ),
    );
    expect(await source().listFiles('2026-09')).toEqual([
      { name: 'Municipios.zip', kind: 'MUNICIPALITIES' },
      { name: 'Estabelecimentos0.zip', kind: 'ESTABLISHMENTS' },
      { name: 'Estabelecimentos1.zip', kind: 'ESTABLISHMENTS' },
      { name: 'Empresas0.zip', kind: 'COMPANIES' },
      { name: 'Empresas1.zip', kind: 'COMPANIES' },
    ]);
    await expect(source().listFiles('2026-10')).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });
  });

  it('ZIP comum e ZIP em streaming (com descritor): o CSV sai em Latin-1 e é lido pelo core', async () => {
    const csv = establishmentsCsv();
    routes.set(
      `${PATH}/2026-09/Estabelecimentos0.zip`,
      send(zipSync({ 'K3241.K03200Y0.D60913.ESTABELE': csv }), 200, 'application/zip'),
    );
    expect(Buffer.compare(await collect(source().open('2026-09', ESTAB)), Buffer.from(csv))).toBe(
      0,
    );

    routes.set(
      `${PATH}/2026-09/Estabelecimentos0.zip`,
      send(await streamedZip('K3241.K03200Y0.D60913.ESTABELE', csv), 200, 'application/zip'),
    );
    const kept: string[] = [];
    for await (const line of readLatin1Lines(source().open('2026-09', ESTAB))) {
      const parsed = parseEstablishmentLine(line, { includeSecondaryCnae: false });
      if (parsed.kind === 'kept') kept.push(parsed.establishment.tradeName ?? '');
    }
    expect(kept).toEqual(['Contabilidade Açaí']);
  });

  it('falhas: não publicado, servidor fora, arquivo corrompido, armazenado sem compressão, grande demais', async () => {
    await expect(collect(source().open('2026-09', ESTAB))).rejects.toMatchObject({
      code: 'NOT_PUBLISHED',
    });
    routes.set(`${PATH}/2026-09/Estabelecimentos0.zip`, send('erro', 503));
    await expect(collect(source().open('2026-09', ESTAB))).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    routes.set(`${PATH}/2026-09/Estabelecimentos0.zip`, send('não é zip'));
    await expect(collect(source().open('2026-09', ESTAB))).rejects.toMatchObject({
      code: 'INVALID_FILE',
    });
    const zipped = zipSync({ 'X.ESTABELE': establishmentsCsv() });
    const corrupted = Buffer.from(zipped);
    corrupted.fill(0xff, 60, 90);
    routes.set(`${PATH}/2026-09/Estabelecimentos0.zip`, send(corrupted));
    await expect(collect(source().open('2026-09', ESTAB))).rejects.toMatchObject({
      code: 'INVALID_FILE',
    });
    routes.set(
      `${PATH}/2026-09/Estabelecimentos0.zip`,
      send(zipSync({ 'X.ESTABELE': establishmentsCsv() }, { level: 0 })),
    );
    await expect(collect(source().open('2026-09', ESTAB))).rejects.toMatchObject({
      code: 'INVALID_FILE',
    });
    routes.set(
      `${PATH}/2026-09/Estabelecimentos0.zip`,
      send(zipSync({ 'X.ESTABELE': new Uint8Array(200_000).fill(65) })),
    );
    await expect(
      collect(source({ maxUncompressedBytes: 50_000 }).open('2026-09', ESTAB)),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(
      collect(source({ maxCompressedBytes: 10 }).open('2026-09', ESTAB)),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('download parado no meio é interrompido e vira indisponível (tenta na próxima vez)', async () => {
    const zipped = zipSync({ 'X.ESTABELE': establishmentsCsv() });
    routes.set(`${PATH}/2026-09/Estabelecimentos0.zip`, (res) => {
      res.writeHead(200, { 'content-type': 'application/zip' });
      res.write(Buffer.from(zipped.subarray(0, 40)));
      // Não termina: o servidor "trava".
    });
    const error = await collect(source({ idleTimeoutMs: 300 }).open('2026-09', ESTAB)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CompanyRegistryError);
    expect(error).toMatchObject({ code: 'UNAVAILABLE' });
  });
});
