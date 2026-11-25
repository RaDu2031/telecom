import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEricssonEngenhariaRecord,
  buildEricssonSiteRecord,
  buildNokiaOrClaroSiteRecord,
  buildNokiaTssrRecord,
  buildVivoActivityRecord,
  computeIsoWeekNumber,
  expandBatchToDrafts,
  normalizeDateToBr,
  parseQuickBatchLines,
} from './quickAcionamentoUtils';

test('normalizeDateToBr converts ISO dates to Brazilian dd/mm/aaaa format', () => {
  assert.equal(normalizeDateToBr('2026-11-24'), '24/11/2026');
  assert.equal(normalizeDateToBr('05/03/2026'), '05/03/2026');
});

test('computeIsoWeekNumber calculates ISO week correctly', () => {
  assert.equal(computeIsoWeekNumber('2026-01-01'), 1);
  assert.equal(computeIsoWeekNumber('2026-11-24'), 48);
});

test('parseQuickBatchLines parses single codes, TSV Excel paste, semicolon CSV, and preserves duplicates', () => {
  const raw = [
    'SITE ID; UF; MUNICÍPIO; EQUIPE',
    'SN-001',
    'SN-002\tSP\tSão Paulo\tMagno/Luchini',
    'SN-002; RJ; Niterói; Gilvan',
    '',
    '   ',
    'sn-003, MG, Belo Horizonte, Equipe 3',
  ].join('\n');

  const parsed = parseQuickBatchLines(raw);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].siteId, 'SN-001');
  assert.equal(parsed[1].siteId, 'SN-002');
  assert.equal(parsed[1].col2, 'SP');
  assert.equal(parsed[1].col3, 'São Paulo');
  assert.equal(parsed[1].col4, 'Magno/Luchini');
  // Duplicate preserved as independent acionamento
  assert.equal(parsed[2].siteId, 'SN-002');
  assert.equal(parsed[2].col2, 'RJ');
  assert.equal(parsed[3].siteId, 'SN-003');
  assert.equal(parsed[3].col2, 'MG');
});

test('buildNokiaOrClaroSiteRecord enforces strict NOKIA vs CLARO_TIM isolation', () => {
  const timRec = buildNokiaOrClaroSiteRecord(
    {
      siteId: 'sn-tim-01',
      uf: 'sp',
      municipio: 'Campinas',
      equipe: 'Magno/Luchini',
      dataAcionamento: '2026-11-24',
    },
    'NOKIA',
    'gestor@ametaservicos.com.br'
  );
  assert.equal(timRec.vendor, 'NOKIA');
  assert.equal(timRec.siteId, 'SN-TIM-01');
  assert.equal(timRec.sheetName, 'Controle Geral');
  assert.equal(timRec.customFields?.['ACIONAMENTO'], '24/11/2026');
  assert.equal(timRec.customFields?.['EQUIPE EXECUTANTE'], 'Magno/Luchini');
  assert.equal(timRec.isNew, true);

  const claroRec = buildNokiaOrClaroSiteRecord(
    {
      siteId: 'cl-01',
      uf: 'rj',
      municipio: 'Rio de Janeiro',
      dataAcionamento: '2026-11-24',
    },
    'CLARO_TIM',
    'gestor@ametaservicos.com.br'
  );
  assert.equal(claroRec.vendor, 'CLARO_TIM');
  assert.equal(claroRec.energiaRetificadora, 'CLARO');
  assert.equal(claroRec.customFields?.['SITE ID'], 'CL-01');
});

test('buildNokiaTssrRecord builds valid TSSR row with ACIONAMENTO field', () => {
  const tssr = buildNokiaTssrRecord(
    {
      siteId: 'sn-tssr-99',
      uf: 'df',
      municipio: 'Brasília',
      executor: 'Rafael',
      status: 'Em produção',
      dataAcionamento: '2026-11-24',
    },
    'TSSR TIM Nokia'
  );
  assert.equal(tssr.vendor, 'NOKIA');
  assert.equal(tssr.siteId, 'SN-TSSR-99');
  assert.equal(tssr.fields['ACIONAMENTO'], '24/11/2026');
  assert.equal(tssr.fields['STATUS Engenharia'], 'Em produção');
  assert.equal(tssr.fields['Executor'], 'Rafael');
});

test('buildEricssonSiteRecord supports single tower A and pair A/B', () => {
  const row = buildEricssonSiteRecord({
    siteId: 'escit33',
    siteIdB: 'escit81',
    uf: 'sp',
    municipio: 'São Paulo',
    equipe: 'Equipe 6',
    dataAcionamento: '2026-11-24',
  });
  assert.equal(row.siteIdA, 'ESCIT33');
  assert.equal(row.siteIdB, 'ESCIT81');
  assert.equal(row.fields['01.21.Site ID A'], 'ESCIT33');
  assert.equal(row.fields['01.21.Site ID B'], 'ESCIT81');
  assert.equal(row.fields['Acionamento'], '24/11/2026');
});

test('buildEricssonEngenhariaRecord populates Tipo doc, Status, Regional and Demanda', () => {
  const eng = buildEricssonEngenhariaRecord({
    siteId: 'smpinb6_5a',
    tipoDoc: 'WR',
    status: 'Em produção',
    regional: 'spm',
    executor: 'Carlos',
    dataAcionamento: '2026-11-24',
  });
  assert.equal(eng.intervencaoClaro, 'SMPINB6_5A');
  assert.equal(eng.tipoDoc, 'WR');
  assert.equal(eng.fields['Demanda'], '24/11/2026');
  assert.equal(eng.fields['EXECUTOR'], 'Carlos');
});

test('buildVivoActivityRecord tags ERICSSON_VIVO and populates dashboard fields', () => {
  const vivo = buildVivoActivityRecord(
    {
      siteId: 'sp_jardins_01',
      tipoDoc: 'RF Sheet Vivo',
      status: 'A produzir',
      regional: 'sp',
      executor: 'Ana',
      dataAcionamento: '2026-11-24',
      planejado: '2026-11-30',
    },
    2083,
    'gestor@ametaservicos.com.br'
  );
  assert.equal(vivo.vendor, 'ERICSSON_VIVO');
  assert.equal(vivo.siteName, 'SP_JARDINS_01');
  assert.equal(vivo.tipoDoc, 'RF Sheet Vivo');
  assert.equal(vivo.demanda, '24/11/2026');
  assert.equal(vivo.planejado, '30/11/2026');
  assert.equal(vivo.fields['00.02.Site Name'], 'SP_JARDINS_01');
  assert.equal(vivo.fields['Demanda'], '24/11/2026');
  assert.equal(vivo.rowNumberInFile, 2083);
});

test('expandBatchToDrafts applies shared defaults when row columns are omitted', () => {
  const items = parseQuickBatchLines('SP_01\nMG_02; PPI Vivo; MG; João');
  const drafts = expandBatchToDrafts(items, 'ERICSSON_VIVO', {
    tipoDoc: 'RF Sheet Vivo',
    status: 'A produzir',
    regional: 'SP',
    executor: 'Equipe Padrão',
    dataAcionamento: '2026-11-24',
  });
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].siteId, 'SP_01');
  assert.equal(drafts[0].tipoDoc, 'RF Sheet Vivo');
  assert.equal(drafts[0].regional, 'SP');
  assert.equal(drafts[0].executor, 'Equipe Padrão');
  assert.equal(drafts[1].siteId, 'MG_02');
  assert.equal(drafts[1].tipoDoc, 'PPI Vivo');
  assert.equal(drafts[1].regional, 'MG');
  assert.equal(drafts[1].executor, 'João');
});

test('builders throw clear error when siteId is empty', () => {
  assert.throws(() => buildNokiaOrClaroSiteRecord({ siteId: '   ' }, 'NOKIA', 'u@a.com'));
  assert.throws(() => buildVivoActivityRecord({ siteId: '' }, 1, 'u@a.com'));
  assert.throws(() => buildEricssonSiteRecord({ siteId: '', siteIdB: '' }));
});
