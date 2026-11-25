import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  decodeVivoCsvBytes,
  parseVivoCsvBuffer,
  computeVivoDashboardMetrics,
  classifyVivoStatus,
  normalizeVivoDocType,
} from './vivoSpreadsheetUtils';

const REAL_CSV_PATH = path.resolve(
  process.cwd(),
  'public/assets/aistudio/AMETA_VIVO_REPORT_DOCUMENTACAO_PLANEJAMENTO_WXX_b48c8831.csv'
);

test('decodes attached CP850 Vivo CSV with zero mojibake and exact Portuguese accents', () => {
  const buf = fs.readFileSync(REAL_CSV_PATH);
  const text = decodeVivoCsvBytes(new Uint8Array(buf));

  assert.ok(text.includes('Comentário STATUS'), 'Should decode Comentário STATUS');
  assert.ok(text.includes('Descrição'), 'Should decode Descrição');
  assert.ok(text.includes('MOTIVO DE REVISÃO DO PIRF'), 'Should decode MOTIVO DE REVISÃO DO PIRF');
  assert.ok(text.includes('Em produção'), 'Should decode Em produção');
  assert.ok(text.includes('WR Aguardando Aprovação'), 'Should decode WR Aguardando Aprovação');
  assert.ok(text.includes('Victor Alcântara'), 'Should decode Victor Alcântara');
  assert.ok(text.includes('BoQ Pendência'), 'Should decode BoQ Pendência');
  assert.ok(!text.includes('Coment\u00A0rio'), 'Must not contain raw CP850 mojibake');
});

test('parses all 2,082 logical rows from real attached Vivo CSV preserving multiline comments and 46 headers', () => {
  const buf = fs.readFileSync(REAL_CSV_PATH);
  const parsed = parseVivoCsvBuffer(new Uint8Array(buf), {
    deterministicPrefix: 'vivo_base',
    fileName: 'AMETA_VIVO_REPORT.csv',
  });

  assert.equal(parsed.headerRowIndex, 1, 'Header row must be detected at index 1 (skipping row 0 counts)');
  assert.equal(parsed.columns.length, 46, 'Must detect all 46 canonical columns');
  assert.equal(parsed.rows.length, 2082, 'Must parse all 2,082 non-empty activity rows');
  assert.equal(parsed.rows[0].id, 'vivo_base_00001');
  assert.equal(parsed.rows[0].vendor, 'ERICSSON_VIVO');
  assert.equal(parsed.rows[0].siteName, 'SPC1CS1');
  assert.equal(parsed.rows[0].tipoDoc, 'PPI Vivo');
  assert.equal(parsed.rows[0].status, 'Finalizado');
  assert.equal(parsed.rows[0].executor, 'Victor Alcântara');

  // Verify unique IDs across all rows
  const idSet = new Set(parsed.rows.map((r) => r.id));
  assert.equal(idSet.size, 2082, 'Every row must have a unique ID');
});

test('computes exact Vivo dashboard metrics matching the real 2,082 rows', () => {
  const buf = fs.readFileSync(REAL_CSV_PATH);
  const parsed = parseVivoCsvBuffer(new Uint8Array(buf), { deterministicPrefix: 'vivo_base' });
  const m = computeVivoDashboardMetrics(parsed.rows);

  assert.equal(m.totalAtividades, 2082);
  assert.equal(m.finalizadas, 1891, 'Finalizado (1818) + BoQ Finalizado (73) = 1891');
  assert.equal(m.aguardandoAprovacao, 97, 'WR Aguardando Aprovação = 97');
  assert.equal(m.emProducao, 63, 'Em produção (37) + A produzir (25) + Em correção (1) = 63');
  assert.equal(m.pendentes, 22, 'Pendências (10 + 7 + 2 + 2 + 1) = 22');
  assert.equal(m.canceladas, 9, 'Demanda cancelada = 9');
  assert.equal(
    m.finalizadas + m.aguardandoAprovacao + m.emProducao + m.pendentes + m.canceladas + m.outros,
    m.totalAtividades,
    'Status group counts must sum exactly to totalAtividades'
  );
  assert.equal(m.faturadas, 276, 'Faturadas count must equal 276');

  // Doc types normalized: PDI VIVO (232) + PDI Vivo (34) = 266
  const pdi = m.byDocType.find((d) => d.tipoDoc === 'PDI Vivo');
  assert.ok(pdi, 'PDI Vivo normalized group must exist');
  assert.equal(pdi.total, 266);

  const rf = m.byDocType.find((d) => d.tipoDoc === 'RF Sheet Vivo');
  assert.equal(rf?.total, 779);

  const sumByDoc = m.byDocType.reduce((acc, d) => acc + d.total, 0);
  assert.equal(sumByDoc, 2082, 'Sum across doc types must equal totalAtividades');

  assert.ok(m.byExecutor.length > 10, 'Should aggregate executors');
  assert.equal(m.byExecutor[0].executor, 'Carol Dalesse');
  assert.equal(m.byExecutor[0].total, 782);
});

test('handles UTF-8 CSV imports and status/doc normalization cleanly', () => {
  const csv = [
    'Resumo;00.02.Site Name;ID Register;Regional;Tipo doc;Status;Comentário STATUS;EXECUTOR;SLA DOC;FATURAMENTO',
    'AMETA;SP1234;REG-1;SPC;PDI VIVO;Em produção;"Linha 1\nLinha 2 com ç e ã";João Silva;2;15/05/2026',
    'AMETA;MG9999;REG-2;MG;boq vivo;BoQ Pendência;Aguardando revisão;Maria Costa;#VALOR!;',
  ].join('\n');

  const parsed = parseVivoCsvBuffer(new TextEncoder().encode(csv), {
    fileName: 'teste_utf8.csv',
  });

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].tipoDoc, 'PDI Vivo');
  assert.equal(parsed.rows[0].comentarioStatus, 'Linha 1\nLinha 2 com ç e ã');
  assert.equal(parsed.rows[0].executor, 'João Silva');
  assert.equal(parsed.rows[1].tipoDoc, 'BoQ Vivo');
  assert.equal(classifyVivoStatus(parsed.rows[0].status), 'em_producao');
  assert.equal(classifyVivoStatus(parsed.rows[1].status), 'pendente');
  assert.equal(normalizeVivoDocType('PDI VIVO'), 'PDI Vivo');
});
