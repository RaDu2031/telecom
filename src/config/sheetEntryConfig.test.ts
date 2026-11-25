import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIVO_SHEET_ENTRY_CONFIG,
  VIVO_TIPO_DOC_OPTIONS,
  appendHistoryEntries,
  brDateToIsoInput,
  buildNewVivoActivityRow,
  buildSingleFieldUpdatePatch,
  extractDynamicFieldOptions,
  filterEligibleExecutorUsers,
  findDuplicateRecord,
  findSiteAutofillData,
  formatTodayBr,
  getInitialStatusFromRows,
  isExecutorOwnerOfRow,
  normalizeDateValueToBr,
  parseEntradaRapidaLines,
  resolveTipoDocOption,
} from './sheetEntryConfig';
import { AmetaUser, VivoActivityRow } from '../types/telecom';

function makeRow(overrides: Partial<VivoActivityRow> = {}): VivoActivityRow {
  return {
    id: overrides.id || 'vivo_row_1',
    vendor: 'ERICSSON_VIVO',
    siteName: overrides.siteName ?? 'SP_SITE_01',
    idRegister: overrides.idRegister ?? 'REG-100',
    regional: overrides.regional ?? 'SP',
    tipoDoc: overrides.tipoDoc ?? 'RF Sheet Vivo',
    status: overrides.status ?? 'Em produção',
    comentarioStatus: overrides.comentarioStatus ?? '',
    prioridade: overrides.prioridade ?? 'P1',
    demanda: overrides.demanda ?? '10/05/2026',
    planejado: overrides.planejado ?? '20/05/2026',
    replan: overrides.replan ?? '',
    dataReplan: overrides.dataReplan ?? '',
    entregue: overrides.entregue ?? '',
    executor: overrides.executor ?? '',
    slaDoc: overrides.slaDoc ?? '',
    entregueWeek: overrides.entregueWeek ?? '',
    ofensor: overrides.ofensor ?? '',
    faturamento: overrides.faturamento ?? '',
    fields: {
      '00.02.Site Name': overrides.siteName ?? 'SP_SITE_01',
      'ID Register': overrides.idRegister ?? 'REG-100',
      Regional: overrides.regional ?? 'SP',
      'Tipo doc': overrides.tipoDoc ?? 'RF Sheet Vivo',
      Status: overrides.status ?? 'Em produção',
      ...(overrides.fields || {}),
    },
    updatedAt: '2026-05-10T10:00:00.000Z',
    ...overrides,
  };
}

test('getInitialStatusFromRows picks first used status in sheet, falling back when empty', () => {
  const rows = [
    makeRow({ id: '1', status: 'Finalizado' }),
    makeRow({ id: '2', status: 'Em produção' }),
    makeRow({ id: '3', status: 'Em produção' }),
  ];
  assert.equal(getInitialStatusFromRows(rows, VIVO_SHEET_ENTRY_CONFIG), 'Em produção');
  assert.equal(getInitialStatusFromRows([], VIVO_SHEET_ENTRY_CONFIG), 'A produzir');
});

test('findSiteAutofillData populates Regional and fixed fields when site exists', () => {
  const rows = [
    makeRow({
      siteName: 'RJ_NITER_02',
      regional: 'RJ/ES',
      idRegister: 'REG-9988',
      fields: {
        '00.02.Site Name': 'RJ_NITER_02',
        Regional: 'RJ/ES',
        'ID Register': 'REG-9988',
        UF: 'RJ',
      },
    }),
  ];

  const found = findSiteAutofillData(rows, '  rj_niter_02 ', VIVO_SHEET_ENTRY_CONFIG);
  assert.ok(found.matchedRow);
  assert.equal(found.values.regional, 'RJ/ES');
  assert.equal(found.values.idRegister, 'REG-9988');
  assert.equal(found.fixedFields['UF'], 'RJ');

  const missing = findSiteAutofillData(rows, 'UNKNOWN_99', VIVO_SHEET_ENTRY_CONFIG);
  assert.equal(missing.matchedRow, null);
});

test('findDuplicateRecord matches Site Name + Tipo doc accurately', () => {
  const rows = [
    makeRow({ id: 'r1', siteName: 'SP_CAMP_01', tipoDoc: 'PPI Vivo' }),
    makeRow({ id: 'r2', siteName: 'SP_CAMP_01', tipoDoc: 'BoQ Vivo' }),
  ];

  const dup = findDuplicateRecord(rows, 'sp_camp_01', 'PPI Vivo', VIVO_SHEET_ENTRY_CONFIG);
  assert.equal(dup?.id, 'r1');

  const noDup = findDuplicateRecord(rows, 'SP_CAMP_01', 'PIRF Vivo', VIVO_SHEET_ENTRY_CONFIG);
  assert.equal(noDup, null);
});

test('parseEntradaRapidaLines handles SITE, SITE;TIPO, duplicates, and errors', () => {
  const existing = [
    makeRow({ id: 'ex1', siteName: 'SITE_DUP', tipoDoc: 'RF Sheet Vivo', regional: 'MG' }),
    makeRow({ id: 'ex2', siteName: 'SITE_KNOWN', tipoDoc: 'BoQ Vivo', regional: 'PR' }),
  ];

  const input = [
    'SITE_NOVO_1',
    'SITE_KNOWN;PPI',
    'SITE_DUP',
    'SITE_NOVO_1', // repeated in same paste
    'SITE_ERR;TIPO_INVENTADO',
    'X', // too short
    '',
  ].join('\n');

  const res = parseEntradaRapidaLines(input, 'RF Sheet Vivo', existing, VIVO_SHEET_ENTRY_CONFIG);

  assert.equal(res.novosCount, 2);
  assert.equal(res.repetidosCount, 2);
  assert.equal(res.errosCount, 2);
  assert.equal(res.validItems.length, 4);

  const itemKnown = res.items.find((i) => i.siteName === 'SITE_KNOWN');
  assert.equal(itemKnown?.tipoDoc, 'PPI Vivo');
  assert.equal(itemKnown?.regionalAutofill, 'PR');
  assert.equal(itemKnown?.status, 'novo');
});

test('appendHistoryEntries keeps at most 20 items, newest first', () => {
  let history = appendHistoryEntries([], {
    campo: 'Status',
    antes: '',
    depois: 'v0',
    quem: 'Coord',
    quando: '2026-05-01T00:00:00.000Z',
    acao: 'edicao',
  });

  for (let i = 1; i <= 25; i++) {
    history = appendHistoryEntries(
      history,
      {
        campo: 'Status',
        antes: `v${i - 1}`,
        depois: `v${i}`,
        quem: 'Coord',
        quando: `2026-05-01T00:00:${String(i).padStart(2, '0')}.000Z`,
        acao: 'edicao',
      },
      20
    );
  }

  assert.equal(history.length, 20);
  assert.equal(history[0].depois, 'v25');
  assert.equal(history[19].depois, 'v6');
});

test('date normalization converts between ISO yyyy-mm-dd and BR dd/mm/aaaa', () => {
  assert.equal(normalizeDateValueToBr('2026-05-24'), '24/05/2026');
  assert.equal(normalizeDateValueToBr('5/6/2026'), '05/06/2026');
  assert.equal(brDateToIsoInput('24/05/2026'), '2026-05-24');
  assert.equal(formatTodayBr(new Date(2026, 4, 9)), '09/05/2026');
});

test('buildNewVivoActivityRow sets Demanda=today, unique ID, creator audit, and demand fields when executor chosen', () => {
  const execUser: AmetaUser = {
    id: 'uid-exec-1',
    name: 'Carlos Executor',
    email: 'carlos@ametaservicos.com.br',
    role: 'Executor',
    situacao: 'ativo',
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const now = new Date(2026, 4, 15, 14, 30, 0);
  const r1 = buildNewVivoActivityRow({
    siteName: 'SP_TESTE_99',
    tipoDoc: 'War Room Vivo',
    regional: 'SP',
    prioridade: 'P1',
    planejado: '2026-05-30',
    executorUser: execUser,
    comentarioStatus: 'Urgente',
    initialStatus: 'A produzir',
    actorName: 'Rafael ADM',
    actorEmail: 'rafael@ametaservicos.com.br',
    now,
    index: 0,
  });
  const r2 = buildNewVivoActivityRow({
    siteName: 'SP_TESTE_99',
    tipoDoc: 'War Room Vivo',
    initialStatus: 'A produzir',
    actorName: 'Rafael ADM',
    actorEmail: 'rafael@ametaservicos.com.br',
    now,
    index: 1,
  });

  assert.notEqual(r1.id, r2.id);
  assert.equal(r1.vendor, 'ERICSSON_VIVO');
  assert.equal(r1.demanda, '15/05/2026');
  assert.equal(r1.planejado, '30/05/2026');
  assert.equal(r1.status, 'A produzir');
  assert.equal(r1.executor, 'Carlos Executor');
  assert.equal(r1.responsavelDemand, 'Carlos Executor');
  assert.deepEqual(r1.responsaveisEmails, ['carlos@ametaservicos.com.br']);
  assert.deepEqual(r1.responsaveisUids, ['uid-exec-1']);
  assert.equal(r1.history?.length, 2);
  assert.equal(r1.history?.[0].acao, 'demanda');
  assert.equal(r1.history?.[1].acao, 'criacao');
});

test('buildSingleFieldUpdatePatch updates ONLY targeted field + metadata and records demanda / remocao_demanda', () => {
  const row = makeRow({ status: 'A produzir', executor: '' });
  const statusRes = buildSingleFieldUpdatePatch({
    row,
    fieldKey: 'status',
    rawNewValue: 'Finalizado',
    actorName: 'Coord A',
  });
  assert.equal(statusRes.changed, true);
  assert.equal(statusRes.patch.status, 'Finalizado');
  assert.equal(statusRes.patch.fields['Status'], 'Finalizado');
  assert.equal(statusRes.action, 'edicao');
  assert.equal(statusRes.nextHistory[0].campo, 'Status');
  assert.equal(statusRes.nextHistory[0].antes, 'A produzir');
  assert.equal(statusRes.nextHistory[0].depois, 'Finalizado');
  assert.equal('prioridade' in statusRes.patch, false);

  const execUser: AmetaUser = {
    id: 'u-2',
    name: 'Maria Exec',
    email: 'maria@ametaservicos.com.br',
    role: 'Executor',
    situacao: 'ativo',
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const assignRes = buildSingleFieldUpdatePatch({
    row,
    fieldKey: 'executor',
    rawNewValue: 'Maria Exec',
    executorUser: execUser,
    actorName: 'Coord A',
  });
  assert.equal(assignRes.action, 'demanda');
  assert.deepEqual(assignRes.patch.responsaveisEmails, ['maria@ametaservicos.com.br']);

  const assignedRow = { ...row, executor: 'Maria Exec', responsavelDemand: 'Maria Exec' };
  const removeRes = buildSingleFieldUpdatePatch({
    row: assignedRow,
    fieldKey: 'executor',
    rawNewValue: '',
    actorName: 'Coord A',
  });
  assert.equal(removeRes.action, 'remocao_demanda');
  assert.deepEqual(removeRes.patch.responsaveisEmails, []);
});

test('isExecutorOwnerOfRow grants access only to assigned executor', () => {
  const exec1: AmetaUser = {
    id: 'uid-1',
    name: 'Joao Silva',
    email: 'joao@ametaservicos.com.br',
    role: 'Executor',
    situacao: 'ativo',
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const exec2: AmetaUser = {
    id: 'uid-2',
    name: 'Ana Costa',
    email: 'ana@ametaservicos.com.br',
    role: 'Executor',
    situacao: 'ativo',
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const row = makeRow({
    executor: 'Joao Silva',
    responsaveisEmails: ['joao@ametaservicos.com.br'],
    responsaveisUids: ['uid-1'],
  });

  assert.equal(isExecutorOwnerOfRow(row, exec1), true);
  assert.equal(isExecutorOwnerOfRow(row, exec2), false);
});

test('resolveTipoDocOption & filterEligibleExecutorUsers & extractDynamicFieldOptions', () => {
  assert.equal(resolveTipoDocOption('WR'), 'War Room Vivo');
  assert.equal(resolveTipoDocOption('boq vivo'), 'BoQ Vivo');
  assert.equal(resolveTipoDocOption('Desconhecido'), null);
  assert.equal(VIVO_TIPO_DOC_OPTIONS.length, 6);

  const users: AmetaUser[] = [
    { id: '1', name: 'Exec Ativo', email: 'a@ametaservicos.com.br', role: 'Executor', situacao: 'ativo', emailVerified: true, createdAt: '' },
    { id: '2', name: 'Exec Desativado', email: 'b@ametaservicos.com.br', role: 'Executor', situacao: 'bloqueado', desativado: true, emailVerified: true, createdAt: '' },
    { id: '3', name: 'Coord', email: 'c@ametaservicos.com.br', role: 'Coordenador Geral', situacao: 'ativo', emailVerified: true, createdAt: '' },
  ];
  const eligible = filterEligibleExecutorUsers(users);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].name, 'Exec Ativo');

  const opts = extractDynamicFieldOptions(
    [makeRow({ regional: 'RJ' }), makeRow({ regional: 'SP' }), makeRow({ regional: 'SP' })],
    'regional',
    'Regional'
  );
  assert.deepEqual(opts, ['SP', 'RJ']);
});
