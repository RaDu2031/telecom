import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validarCompatibilidadePlanilha,
  isClaroSiteRecord,
} from './spreadsheetUtils';

test('Nokia TIM 50-column spreadsheet with CRQ / NDPd / Informações p/ NF is NOT blocked on NOKIA_SITES', () => {
  const timHeaders = [
    'Oc Site Pre',
    'SITE ID',
    'END ID',
    'SMP',
    'ID. DETENTORA',
    'REG.',
    'UF',
    'MUNICÍPIO',
    'PROJETO',
    'STATUS',
    'EQUIPE EXECUTANTE',
    'CRQ',
    'NDPd',
    'Informações p/ NF',
  ];

  const res = validarCompatibilidadePlanilha(
    timHeaders,
    'NOKIA_SITES',
    'Controle Geral Site Investigation_Nokia_2026(Controle Geral) (2).csv'
  );
  assert.equal(res.shouldBlock, false);
  assert.equal(res.targetType, 'NOKIA_SITES');
});

test('Claro Sites spreadsheet is NOT blocked on CLARO_SITES', () => {
  const claroHeaders = ['Oc Site Pre', 'SITE ID', 'END ID', 'CRQ', 'NDPd', 'Informações p/ NF'];
  const res = validarCompatibilidadePlanilha(claroHeaders, 'CLARO_SITES', 'Claro_Sites_2026.xlsx');
  assert.equal(res.shouldBlock, false);
  assert.equal(res.targetType, 'CLARO_SITES');
});

test('isClaroSiteRecord separates strictly by vendor so Nokia TIM records with shared columns are never hidden', () => {
  const nokiaTimWithSharedCols = {
    id: 'TIM_001',
    siteId: 'TIM_001',
    vendor: 'NOKIA' as const,
    fileName: 'Controle Geral Site Investigation_Nokia_2026(Controle Geral) (2).csv',
    customFields: {
      'Oc Site Pre': 'OC123',
      CRQ: 'CRQ001',
      NDPd: 'NDP001',
      'Informações p/ NF': 'NF OK',
    },
  };

  const claroRecord = {
    id: 'CLA_001',
    siteId: 'CLA_001',
    vendor: 'CLARO_TIM' as const,
    customFields: {
      'Oc Site Pre': 'CLATCM01',
      CRQ: 'CRQ002',
    },
  };

  assert.equal(isClaroSiteRecord(nokiaTimWithSharedCols), false);
  assert.equal(isClaroSiteRecord(claroRecord), true);
  assert.equal(isClaroSiteRecord(null), false);
});
