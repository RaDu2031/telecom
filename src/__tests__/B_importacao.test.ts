import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createFirestoreMockModule,
  createFirebaseAuthMockModule,
  resetMockFirestore,
  getCollectionDocs,
  installMockLocalStorage,
} from './mockFirestore';

vi.mock('firebase/firestore', () => createFirestoreMockModule());
vi.mock('firebase/auth', () => createFirebaseAuthMockModule());
vi.mock('../lib/firebase', () => ({
  db: { __mockDb: true },
  auth: { currentUser: { uid: 'adm-1', email: 'rafael.araujo@ametaservicos.com.br' } },
  storage: {},
}));

import { dataService, FIRESTORE_COLLECTIONS } from '../services/dataService';
import {
  parseExcelWorkbookBuffer,
  parseClipboardOrCsvText,
  detectarTipoPlanilha,
  validarCompatibilidadePlanilha,
} from '../utils/spreadsheetUtils';
import {
  parseEricssonWorkbookBuffer,
  parseEricssonEngineeringWorkbookBuffer,
  formatEricssonCellValue,
} from '../utils/ericssonSpreadsheetUtils';
import { parseTssrWorkbookBuffer } from '../utils/tssrSpreadsheetUtils';
import { TelecomSite } from '../types/telecom';

function makeWorkbookArrayBuffer(
  sheets: Array<{ name: string; rows: unknown[][]; merges?: XLSX.Range[] }>
): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    if (s.merges) ws['!merges'] = s.merges;
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const u8 = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return u8;
}

describe('Área B — Importação e Planilhas', () => {
  beforeEach(() => {
    resetMockFirestore();
    installMockLocalStorage();
  });

  it('B-01: Importação de 805 linhas exatas -> 805 documentos gravados sem perda e histórico registrado', async () => {
    const rows: TelecomSite[] = Array.from({ length: 805 }, (_, i) => ({
      id: `SITE_${i + 1}`,
      siteId: `SITE_${String(i + 1).padStart(4, '0')}`,
      siteName: `END_${i + 1}`,
      vendor: 'NOKIA',
      sheetName: 'Controle Geral',
      uf: 'SP',
      municipio: 'São Paulo',
      regional: 'SP',
      endereco: '',
      latitude: '',
      longitude: '',
      tipoInfra: '',
      tecnologias: '5G',
      bandas: '',
      gabineteBbu: '',
      modulosRf: '',
      versaoSw: '',
      setores: '',
      azimutes: '',
      alturaAntena: '',
      tiltEletrico: '',
      transporteTx: '',
      ipGerencia: '',
      vlanOm: '',
      energiaRetificadora: '',
      status: 'Vistoria - A Executar',
      progressoRollout: 0,
      dataIntegracao: '',
      dataAtivacao: '',
      responsavelCampo: '',
      equipeParceira: '',
      ordemServico: `OC-${i + 1}`,
      alarmesAtivos: '',
      observacoes: '',
      rowNumberInFile: i + 2,
      updatedAt: new Date().toISOString(),
      updatedBy: 'qa',
      customFields: { 'SITE ID': `SITE_${String(i + 1).padStart(4, '0')}`, 'Oc Site Pre': `OC-${i + 1}` },
    }));

    const res = await dataService.importarSitesNokiaEmLote(rows, [], {}, {
      mode: 'append_only',
      sourceFileName: 'nokia_805.xlsx',
      vendor: 'NOKIA',
    });

    expect(res.totalAnalisados).toBe(805);
    expect(res.totalGravados).toBe(805);
    expect(res.novas).toBe(805);
    expect(res.comErro).toBe(0);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.NOKIA_SITES)).toHaveLength(805);

    const hist = getCollectionDocs(FIRESTORE_COLLECTIONS.HISTORICO_IMPORTACOES);
    expect(hist).toHaveLength(1);
    expect(hist[0].data.totalLidas).toBe(805);
    expect(hist[0].data.totalAdicionadas).toBe(805);
  });

  it('B-02: Linhas repetidas viram registros independentes com ID único e append-only nunca apaga/sobrescreve registros anteriores', async () => {
    const firstBatch: TelecomSite[] = [
      {
        id: 'DUP_1',
        siteId: 'MAALL02',
        siteName: 'END_A',
        vendor: 'CLARO_TIM',
        sheetName: 'Controle Geral',
        uf: 'MA',
        municipio: 'ALTO ALEGRE',
        regional: 'NO',
        endereco: '',
        latitude: '',
        longitude: '',
        tipoInfra: '',
        tecnologias: '5G',
        bandas: '',
        gabineteBbu: '',
        modulosRf: '',
        versaoSw: '',
        setores: '',
        azimutes: '',
        alturaAntena: '',
        tiltEletrico: '',
        transporteTx: '',
        ipGerencia: '',
        vlanOm: '',
        energiaRetificadora: '',
        status: 'Vistoria - Finalizada',
        progressoRollout: 100,
        dataIntegracao: '',
        dataAtivacao: '',
        responsavelCampo: '',
        equipeParceira: '',
        ordemServico: 'OC-1',
        alarmesAtivos: '',
        observacoes: 'PRIMEIRO',
        rowNumberInFile: 2,
        updatedAt: new Date().toISOString(),
        updatedBy: 'qa',
        customFields: { 'SITE ID': 'MAALL02', Observacoes: 'PRIMEIRO' },
      },
      {
        id: 'DUP_1',
        siteId: 'MAALL02',
        siteName: 'END_A',
        vendor: 'CLARO_TIM',
        sheetName: 'Controle Geral',
        uf: 'MA',
        municipio: 'ALTO ALEGRE',
        regional: 'NO',
        endereco: '',
        latitude: '',
        longitude: '',
        tipoInfra: '',
        tecnologias: '5G',
        bandas: '',
        gabineteBbu: '',
        modulosRf: '',
        versaoSw: '',
        setores: '',
        azimutes: '',
        alturaAntena: '',
        tiltEletrico: '',
        transporteTx: '',
        ipGerencia: '',
        vlanOm: '',
        energiaRetificadora: '',
        status: 'Vistoria - A Executar',
        progressoRollout: 0,
        dataIntegracao: '',
        dataAtivacao: '',
        responsavelCampo: '',
        equipeParceira: '',
        ordemServico: 'OC-1',
        alarmesAtivos: '',
        observacoes: 'SEGUNDO',
        rowNumberInFile: 3,
        updatedAt: new Date().toISOString(),
        updatedBy: 'qa',
        customFields: { 'SITE ID': 'MAALL02', Observacoes: 'SEGUNDO' },
      },
    ];

    const res1 = await dataService.importarSitesNokiaEmLote(firstBatch, [], {}, {
      mode: 'append_only',
      vendor: 'CLARO_TIM',
      importCode: 'IMP1',
    });
    expect(res1.totalGravados).toBe(2);

    // Second import with identical siteId -> must append as 3rd record without overwriting the first two
    const res2 = await dataService.importarSitesNokiaEmLote([firstBatch[0]], [], {}, {
      mode: 'append_only',
      vendor: 'CLARO_TIM',
      importCode: 'IMP2',
    });
    expect(res2.totalGravados).toBe(1);

    const stored = getCollectionDocs(FIRESTORE_COLLECTIONS.CLARO_SITES);
    expect(stored).toHaveLength(3);
    expect(new Set(stored.map((d) => d.id)).size).toBe(3);
    expect(stored.some((d) => d.data.observacoes === 'PRIMEIRO')).toBe(true);
    expect(stored.some((d) => d.data.observacoes === 'SEGUNDO')).toBe(true);
  });

  it('B-03: Cabeçalho na linha 2, cabeçalhos com espaços, linhas vazias, #N/A, datas Excel e números preservados', () => {
    const excelDate = new Date(Date.UTC(2026, 9, 13)); // 13/10/2026
    const buf = makeWorkbookArrayBuffer([
      {
        name: 'Aba Aleatoria',
        rows: [
          ['Subtotal', 2, '', '', '', ''], // Linha 1 (contagem)
          ['  Oc Site Pre  ', '  SITE ID ', ' END ID ', ' UF ', ' ACIONAMENTO ', ' Prioridade '], // Linha 2 (cabeçalho real)
          ['OC-100', 'MAALL01', 'MAALL01_6A', 'MA', excelDate, 2],
          ['', '', '', '', '', ''], // Linha vazia
          ['#N/A', 'MASIS01', 'MASIS01_6A', 'MA', '13/10/2026', '#N/A'],
        ],
      },
    ]);

    const parsed = parseExcelWorkbookBuffer(buf, 'CLARO_TIM');
    expect(parsed.sheetNames).toEqual(['Aba Aleatoria']);
    const rows = parsed.sheetsData['Aba Aleatoria'];
    expect(rows).toHaveLength(2);
    expect(rows[0].siteId).toBe('MAALL01');
    expect(rows[0].customFields?.['Oc Site Pre']).toBe('OC-100');
    expect(rows[0].customFields?.['ACIONAMENTO']).toBe('13/10/2026');
    expect(rows[0].customFields?.['Prioridade']).toBe('2');
    expect(rows[0].sheetName).toBe('Controle Geral');
    expect(rows[1].siteId).toBe('MASIS01');
    expect(rows[1].customFields?.['Oc Site Pre']).toBe('#N/A');
    expect(rows[1].customFields?.['Prioridade']).toBe('#N/A');
  });

  it('B-04: Planilha com várias abas (multi-sheet) preserva dados de cada aba e sheetName fixo "Controle Geral" para Nokia Sites', () => {
    const buf = makeWorkbookArrayBuffer([
      {
        name: 'Aba1_Custom',
        rows: [
          ['Oc Site Pre', 'SITE ID', 'END ID', 'UF'],
          ['OC-1', 'S1', 'E1', 'SP'],
        ],
      },
      {
        name: 'Aba2_Custom',
        rows: [
          ['Oc Site Pre', 'SITE ID', 'END ID', 'UF'],
          ['OC-2', 'S2', 'E2', 'RJ'],
        ],
      },
    ]);

    const parsed = parseExcelWorkbookBuffer(buf, 'NOKIA');
    expect(parsed.sheetNames).toEqual(['Aba1_Custom', 'Aba2_Custom']);
    expect(parsed.sheetsData['Aba1_Custom']).toHaveLength(1);
    expect(parsed.sheetsData['Aba2_Custom']).toHaveLength(1);
    // Verificar se parseExcelWorkbookBuffer fixa sheetName = 'Controle Geral' também para NOKIA (como faz para CLARO_TIM)
    expect(parsed.sheetsData['Aba1_Custom'][0].sheetName).toBe('Controle Geral');
  });

  it('B-05: Células mescladas (!merges) propagam valor para linhas filhas da mesclagem', () => {
    const buf = makeWorkbookArrayBuffer([
      {
        name: 'Controle Geral',
        rows: [
          ['Oc Site Pre', 'SITE ID', 'UF', 'MUNICÍPIO'],
          ['OC-1', 'SITE_A', 'MA', 'SANTA INÊS'],
          ['OC-2', 'SITE_B', '', ''], // UF e MUNICÍPIO mesclados com linha acima
        ],
        merges: [
          { s: { r: 1, c: 2 }, e: { r: 2, c: 2 } },
          { s: { r: 1, c: 3 }, e: { r: 2, c: 3 } },
        ],
      },
    ]);

    const parsed = parseExcelWorkbookBuffer(buf, 'NOKIA');
    const rows = parsed.sheetsData['Controle Geral'];
    expect(rows).toHaveLength(2);
    // Esperado: célula mesclada preencher UF='MA' na segunda linha
    expect(rows[1].uf).toBe('MA');
  });

  it('B-06: CSV sem nome de aba e colagem do Excel (TSV Ctrl+V) via parseClipboardOrCsvText', () => {
    const tsv = [
      'Oc Site Pre\tSITE ID\tEND ID\tUF\tSTATUS',
      'OC-901\tSP001\tSP001_A\tSP\tVistoria - A Executar',
      'OC-902\tSP002\tSP002_A\tSP\tVistoria - Finalizada',
    ].join('\n');

    const resTsv = parseClipboardOrCsvText(tsv, 'NOKIA', 'Controle Geral');
    expect(resTsv.sites).toHaveLength(2);
    expect(resTsv.sites[0].siteId).toBe('SP001');
    expect(resTsv.sites[1].siteId).toBe('SP002');

    const csv = [
      'Oc Site Pre;SITE ID;END ID;UF',
      'OC-903;MA001;MA001_A;MA',
    ].join('\n');

    const resCsv = parseClipboardOrCsvText(csv, 'CLARO_TIM', '');
    expect(resCsv.sites).toHaveLength(1);
    expect(resCsv.sites[0].siteId).toBe('MA001');
    expect(resCsv.sites[0].sheetName).toBe('Controle Geral');
  });

  it('B-07: Detecção de tipo de planilha (detectarTipoPlanilha) para Nokia Sites, Nokia TSSR, Ericsson Sites, Ericsson Engenharia e Claro', () => {
    expect(
      detectarTipoPlanilha(['Oc Site Pre', 'SITE ID', 'Empresa Vistoriadora', 'Status Agendamento Vistoria', 'Comentários do Acesso'])
    ).toBe('NOKIA_SITES');

    expect(
      detectarTipoPlanilha(['Oc Site Pre', 'Site Id', 'TSSR Status', 'Data Envio TSSR', 'Enviado para Nokia'])
    ).toBe('NOKIA_TSSR');

    expect(
      detectarTipoPlanilha(['01.00. Chaves', '01.21.Site ID A', 'Registro de Vistoria Sites', 'Fornecedor de Vistoria'])
    ).toBe('ERICSSON_SITES');

    expect(
      detectarTipoPlanilha(['Chave Unica', 'Empresa Engenharia', 'Versao TSSR', 'Executor WR', 'Executor QRF'])
    ).toBe('ERICSSON_ENGENHARIA');

    // Claro Sites com colunas exclusivas (CRQ, NDPd, Informações p/ NF)
    expect(
      detectarTipoPlanilha(['Oc Site Pre', 'SITE ID', 'END ID', 'CRQ', 'NDPd', 'Informações p/ NF'], 'base_operacao.xlsx')
    ).toBe('CLARO_SITES');
  });

  it('B-08: Falso positivo de "Oc Site Pre" — planilha apenas com "Oc Site Pre" não deve bloquear indevidamente Nokia Sites vs Nokia TSSR', () => {
    const resNokiaSites = validarCompatibilidadePlanilha(['Oc Site Pre', 'SITE ID', 'UF'], 'NOKIA_SITES');
    expect(resNokiaSites.shouldBlock).toBe(false);

    const resNokiaTssr = validarCompatibilidadePlanilha(['Oc Site Pre', 'Site Id', 'UF'], 'NOKIA_TSSR');
    expect(resNokiaTssr.shouldBlock).toBe(false);
  });

  it('B-09: validarCompatibilidadePlanilha bloqueia planilha Ericsson/TSSR importada por engano na aba CLARO_SITES', () => {
    const ericssonHeaders = ['01.00. Chaves', '01.21.Site ID A', 'Registro de Vistoria Sites', 'Fornecedor de Vistoria'];
    const res = validarCompatibilidadePlanilha(ericssonHeaders, 'CLARO_SITES', 'ericsson_tx.xlsx');
    // Esperado: bloquear planilha Ericsson quando destino é CLARO_SITES
    expect(res.shouldBlock).toBe(true);
  });

  it('B-10: validarCompatibilidadePlanilha bloqueia buffer XLSX da Claro (sem "claro" no nome) quando destino é NOKIA_SITES', () => {
    const buf = makeWorkbookArrayBuffer([
      {
        name: 'Controle Geral',
        rows: [
          ['Oc Site Pre', 'SITE ID', 'CRQ', 'NDPd', 'Informações p/ NF'],
          ['CLATCM01', 'MAALL01', 'CRQ0001', 'NDP1', 'INFO'],
        ],
      },
    ]);
    const res = validarCompatibilidadePlanilha(buf, 'NOKIA_SITES', 'planilha_nova.xlsx');
    // Esperado: detectar colunas exclusivas Claro no ArrayBuffer e bloquear importação em NOKIA_SITES
    expect(res.shouldBlock).toBe(true);
  });

  it('B-11: Ericsson formatEricssonCellValue não deve inverter datas brasileiras DD/MM/YYYY (ex.: 13/10/2026)', () => {
    expect(formatEricssonCellValue('13/10/2026')).toBe('13/10/2026');
  });

  it('B-12: parseEricssonEngineeringWorkbookBuffer com colunas em ordem diferente da canônica mapeia cada coluna corretamente', () => {
    const buf = makeWorkbookArrayBuffer([
      {
        name: 'Site list',
        rows: [
          ['Status', 'Tipo doc', 'Intervencao Claro', 'ASP', 'Meta'],
          ['Finalizado', 'WR', 'INT_999', 'AMETA', 'Meta Março'],
        ],
      },
    ]);
    const parsed = parseEricssonEngineeringWorkbookBuffer(buf);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].intervencaoClaro).toBe('INT_999');
    expect(parsed.rows[0].status).toBe('Finalizado');
    expect(parsed.rows[0].tipoDoc).toBe('WR');
    expect(parsed.rows[0].meta).toBe('Meta Março');
  });

  it('B-13: parseEricssonWorkbookBuffer e parseTssrWorkbookBuffer filtram linhas vazias e extraem registros corretamente', () => {
    const ericBuf = makeWorkbookArrayBuffer([
      {
        name: 'ERICSSON CLARO TX',
        rows: [
          ['01.00. Chaves', 'Registro', '00.03.State', 'Meta', '01.21.Site ID A', '01.21.Site ID B', 'EQUIPE'],
          ['CH01', 'R01', 'PR', 'Meta 1', 'PRAON04', 'PRPNG02', 'Equipe A'],
          ['', '', '', '', '', '', ''],
          ['TOTAL GERAL', '', '', '', 'TOTAL', '', ''],
        ],
      },
    ]);
    const ericParsed = parseEricssonWorkbookBuffer(ericBuf);
    expect(ericParsed.rows).toHaveLength(1);
    expect(ericParsed.rows[0].id).toBe('PRAON04__PRPNG02');

    const tssrBuf = makeWorkbookArrayBuffer([
      {
        name: 'CONTROLE TSSR',
        rows: [
          ['Contagem', 1, '', '', '', ''],
          ['Oc Site Pre', 'Enderecoid', 'Site Id', 'Reg', 'UF', 'Cidade', 'STATUS Engenharia'],
          ['OC-10', 'END-10', 'SPSP10', 'SP', 'SP', 'Campinas', 'Em produção'],
          ['', '', '', '', '', '', ''],
        ],
      },
    ]);
    const tssrParsed = parseTssrWorkbookBuffer(tssrBuf, 'NOKIA');
    expect(tssrParsed.rows).toHaveLength(1);
    expect(tssrParsed.rows[0].siteId).toBe('SPSP10');
  });
});
