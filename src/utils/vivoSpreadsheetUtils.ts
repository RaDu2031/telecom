import * as XLSX from 'xlsx';
import { VIVO_DOC_COLUMNS, VivoActivityRow } from '../types/telecom';

export const VIVO_DEFAULT_CSV_ASSET_URL =
  '/assets/aistudio/AMETA_VIVO_REPORT_DOCUMENTACAO_PLANEJAMENTO_WXX_b48c8831.csv';
export const VIVO_DEFAULT_CSV_FILENAME =
  'AMETA_VIVO_REPORT DOCUMENTACAO_PLANEJAMENTO_WXX.csv';

// IBM CP850 (OEM DOS Western Europe / Portuguese) mapping table for bytes 0x80..0xFF
const CP850_HIGH_CHARS =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒ' +
  'áíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐' +
  '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀' +
  'ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00AD±‗¾¶§÷¸°¨·¹³²■\u00A0';

/**
 * Decodes raw bytes from a Vivo CSV file with smart encoding detection:
 * - UTF-8 (with or without BOM) if valid UTF-8 with Portuguese accents or pure ASCII
 * - IBM CP850 (OEM DOS — used by Excel Portuguese export of Vivo report)
 * - Windows-1252 fallback
 */
export function decodeVivoCsvBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  // UTF-8 BOM check
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }

  // Try strict UTF-8 first
  let hasHighBytes = false;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 0x80) {
      hasHighBytes = true;
      break;
    }
  }
  if (!hasHighBytes) {
    return new TextDecoder('ascii').decode(bytes);
  }

  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return utf8;
  } catch {
    // Not valid UTF-8 — distinguish CP850 (DOS OEM) vs Windows-1252 (ANSI)
    // In Portuguese CP850: 0x87='ç', 0xC6='ã', 0xA0='á', 0x82='é', 0xA1='í', 0xA2='ó', 0xA3='ú', 0x88='ê', 0x83='â', 0x93='ô', 0xE4='õ', 0x80='Ç', 0xC7='Ã'
    // In Windows-1252: 0xE7='ç', 0xE3='ã', 0xE1='á', 0xE9='é', 0xED='í', 0xF3='ó', 0xFA='ú', 0xEA='ê', 0xE2='â', 0xF4='ô', 0xF5='õ', 0xC7='Ç', 0xC3='Ã'
    let cp850Score = 0;
    let win1252Score = 0;
    const sampleLimit = Math.min(bytes.length, 32768);
    for (let i = 0; i < sampleLimit; i++) {
      const b = bytes[i];
      if (b < 0x80) continue;
      if (
        b === 0x87 ||
        b === 0xc6 ||
        b === 0xa0 ||
        b === 0x82 ||
        b === 0xa1 ||
        b === 0xa2 ||
        b === 0xa3 ||
        b === 0x88 ||
        b === 0x83 ||
        b === 0x80 ||
        b === 0xb5 ||
        b === 0xd6 ||
        b === 0xd2 ||
        b === 0xe4
      ) {
        cp850Score += 2;
      }
      if (
        b === 0xe7 ||
        b === 0xe3 ||
        b === 0xe1 ||
        b === 0xe9 ||
        b === 0xed ||
        b === 0xf3 ||
        b === 0xfa ||
        b === 0xea ||
        b === 0xe2 ||
        b === 0xf4 ||
        b === 0xf5 ||
        b === 0xc3
      ) {
        win1252Score += 2;
      }
    }

    if (cp850Score >= win1252Score) {
      let out = '';
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        out += b < 0x80 ? String.fromCharCode(b) : CP850_HIGH_CHARS[b - 0x80];
      }
      return out;
    }

    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      return new TextDecoder('iso-8859-1').decode(bytes);
    }
  }
}

/**
 * Auto-detects CSV delimiter (';' vs ',' vs '\t') from the first few non-empty lines.
 */
export function detectCsvDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).slice(0, 8).filter((l) => l.trim().length > 0);
  let semis = 0;
  let commas = 0;
  let tabs = 0;
  for (const line of lines) {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (!inQuotes) {
        if (c === ';') semis++;
        else if (c === ',') commas++;
        else if (c === '\t') tabs++;
      }
    }
  }
  if (tabs > semis && tabs > commas) return '\t';
  if (semis >= commas) return ';';
  return ',';
}

/**
 * RFC-4180 compliant CSV parser supporting multi-line quoted cells and escaped double quotes.
 */
export function parseCsvMatrix(text: string, delimiter?: string): string[][] {
  const delim = delimiter || detectCsvDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field);
        field = '';
      } else if (c === '\r') {
        if (text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function normalizeHeaderKey(raw: string): string {
  return (raw || '')
    .replace(/\uFEFF/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const CANONICAL_HEADER_LOOKUP = new Map<string, string>(
  VIVO_DOC_COLUMNS.map((col) => [normalizeHeaderKey(col), col])
);

/**
 * Locates the header row index in a raw 2D matrix (Vivo CSV has summary counts on row 0 and headers on row 1).
 */
export function findVivoHeaderRowIndex(matrix: string[][]): number {
  const maxScan = Math.min(matrix.length, 15);
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < maxScan; i++) {
    const row = matrix[i] || [];
    let score = 0;
    for (const cell of row) {
      const k = normalizeHeaderKey(String(cell ?? ''));
      if (!k) continue;
      if (CANONICAL_HEADER_LOOKUP.has(k)) score += 3;
      if (k === '00.02.site name' || k === 'site name' || k === 'tipo doc' || k === 'status' || k === 'executor') {
        score += 5;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestScore > 0 ? bestIdx : 0;
}

/**
 * Normalizes Vivo activity document type names so minor case variations (e.g. "PDI VIVO" vs "PDI Vivo")
 * group together cleanly in charts and filters.
 */
export function normalizeVivoDocType(raw: string): string {
  const clean = (raw || '').trim().replace(/\s+/g, ' ');
  if (!clean) return 'Outros';
  const low = clean.toLowerCase();
  if (low === 'rf sheet vivo' || low === 'rf sheet') return 'RF Sheet Vivo';
  if (low === 'ppi vivo' || low === 'ppi') return 'PPI Vivo';
  if (low === 'pdi vivo' || low === 'pdi') return 'PDI Vivo';
  if (low === 'war room vivo' || low === 'war room' || low === 'wr vivo') return 'War Room Vivo';
  if (low === 'pirf vivo' || low === 'pirf') return 'PIRF Vivo';
  if (low === 'boq vivo' || low === 'boq') return 'BoQ Vivo';
  return clean;
}

export type VivoStatusGroup =
  | 'finalizado'
  | 'aguardando_aprovacao'
  | 'em_producao'
  | 'pendente'
  | 'cancelada'
  | 'outros';

/**
 * Classifies any raw Vivo Status string into one of the executive dashboard groups.
 */
export function classifyVivoStatus(rawStatus: string): VivoStatusGroup {
  const s = (rawStatus || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!s) return 'outros';
  if (s.includes('cancelad')) return 'cancelada';
  if (s.includes('finalizado') || s.includes('concluido') || s.includes('entregue')) {
    return 'finalizado';
  }
  if (s.includes('aguardando aprovacao') || s.includes('wr aguardando')) {
    return 'aguardando_aprovacao';
  }
  if (s.includes('pendente') || s.includes('pendencia') || s.includes('paralisad')) {
    return 'pendente';
  }
  if (
    s.includes('em producao') ||
    s.includes('a produzir') ||
    s.includes('em correcao') ||
    s.includes('em andamento')
  ) {
    return 'em_producao';
  }
  return 'outros';
}

export function hasVivoRevision(row: VivoActivityRow): boolean {
  const f = row.fields || {};
  const check = (v?: string) => {
    const clean = (v || '').trim().toUpperCase();
    return Boolean(clean && clean !== '0' && clean !== '-' && clean !== 'NAO' && clean !== 'NÃO' && clean !== '#N/A');
  };
  return (
    check(f['WR Revisar']) ||
    check(f['PIRF REVISAR']) ||
    check(f['PPI REVISAR']) ||
    check(f['RF SHEET REVISAR']) ||
    check(row.ofensor)
  );
}

export function isVivoFaturado(row: VivoActivityRow): boolean {
  const clean = (row.faturamento || row.fields?.['FATURAMENTO'] || '').trim();
  return Boolean(clean && clean !== '-' && clean !== '0' && clean.toUpperCase() !== '#N/A');
}

export function parseNumericSla(raw?: string): number | null {
  const clean = (raw || '').trim().replace(',', '.');
  if (!clean || clean.startsWith('#')) return null;
  const num = Number(clean);
  if (!Number.isFinite(num) || num < 0 || num > 365) return null;
  return num;
}

export interface ParsedVivoImportResult {
  rows: VivoActivityRow[];
  columns: string[];
  headerRowIndex: number;
  totalRead: number;
}

/**
 * Converts a parsed 2D matrix into strongly typed VivoActivityRow records.
 * Supports deterministic seed IDs (for idempotent base load) OR unique append-only import IDs.
 */
export function buildVivoRowsFromMatrix(
  matrix: string[][],
  options: {
    fileName?: string;
    importCode?: string;
    updatedBy?: string;
    deterministicPrefix?: string; // e.g. 'vivo_base' for idempotent base dataset
  } = {}
): ParsedVivoImportResult {
  if (!matrix || matrix.length === 0) {
    return { rows: [], columns: [...VIVO_DOC_COLUMNS], headerRowIndex: 0, totalRead: 0 };
  }

  const headerRowIndex = findVivoHeaderRowIndex(matrix);
  const rawHeaders = (matrix[headerRowIndex] || []).map((h) => String(h ?? '').trim());

  // Map column index -> canonical column name (or original header if extra custom column)
  const resolvedHeaders: string[] = rawHeaders.map((raw, idx) => {
    const norm = normalizeHeaderKey(raw);
    const canonical = CANONICAL_HEADER_LOOKUP.get(norm);
    if (canonical) return canonical;
    return raw || `Coluna ${idx + 1}`;
  });

  // Deduplicate any duplicate header names safely
  const seenHeaders = new Map<string, number>();
  const finalHeaders = resolvedHeaders.map((h) => {
    const count = seenHeaders.get(h) || 0;
    seenHeaders.set(h, count + 1);
    return count === 0 ? h : `${h} (${count + 1})`;
  });

  const nowIso = new Date().toISOString();
  const importCode =
    options.importCode || `VIVO_${Date.now().toString(36).toUpperCase()}`;
  const rows: VivoActivityRow[] = [];

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const rawRow = matrix[r];
    if (!rawRow || !rawRow.some((cell) => String(cell ?? '').trim() !== '')) {
      continue;
    }

    const fields: Record<string, string> = {};
    for (let c = 0; c < finalHeaders.length; c++) {
      const colName = finalHeaders[c];
      const val = rawRow[c] !== undefined && rawRow[c] !== null ? String(rawRow[c]).trim() : '';
      fields[colName] = val;
    }

    // Ensure all canonical 46 columns exist in fields
    for (const canonicalCol of VIVO_DOC_COLUMNS) {
      if (!(canonicalCol in fields)) {
        fields[canonicalCol] = '';
      }
    }

    const siteName = fields['00.02.Site Name'] || '';
    const idRegister = fields['ID Register'] || '';
    const regional = fields['Regional'] || '';
    const tipoDoc = normalizeVivoDocType(fields['Tipo doc'] || '');
    const status = fields['Status'] || '';
    const comentarioStatus = fields['Comentário STATUS'] || '';
    const prioridade = fields['Prioridade'] || '';
    const demanda = fields['Demanda'] || '';
    const planejado = fields['Planejado'] || '';
    const replan = fields['REPLAN'] || '';
    const dataReplan = fields['DATA REPLAN'] || '';
    const entregue = fields['Entregue'] || '';
    const executor = fields['EXECUTOR'] || '';
    const slaDoc = fields['SLA DOC'] || '';
    const entregueWeek = fields['Entregue Week'] || '';
    const ofensor = fields['Ofensor'] || '';
    const faturamento = fields['FATURAMENTO'] || '';

    const rowNumberInFile = r + 1;
    const seq = rows.length + 1;
    const id = options.deterministicPrefix
      ? `${options.deterministicPrefix}_${String(seq).padStart(5, '0')}`
      : `vivo_${importCode}_${String(seq).padStart(5, '0')}`;

    rows.push({
      id,
      vendor: 'ERICSSON_VIVO',
      siteName,
      idRegister,
      regional,
      tipoDoc,
      status,
      comentarioStatus,
      prioridade,
      demanda,
      planejado,
      replan,
      dataReplan,
      entregue,
      executor,
      slaDoc,
      entregueWeek,
      ofensor,
      faturamento,
      fields,
      fileName: options.fileName || VIVO_DEFAULT_CSV_FILENAME,
      rowNumberInFile,
      importCode,
      createdAt: nowIso,
      updatedAt: nowIso,
      updatedBy: options.updatedBy || 'Importação Planilha Vivo',
    });
  }

  return {
    rows,
    columns: finalHeaders.length >= 10 ? finalHeaders : [...VIVO_DOC_COLUMNS],
    headerRowIndex,
    totalRead: rows.length,
  };
}

/**
 * Parses a Vivo CSV from raw bytes (Uint8Array / ArrayBuffer).
 */
export function parseVivoCsvBuffer(
  buffer: ArrayBuffer | Uint8Array,
  options?: {
    fileName?: string;
    importCode?: string;
    updatedBy?: string;
    deterministicPrefix?: string;
  }
): ParsedVivoImportResult {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const text = decodeVivoCsvBytes(bytes);
  const matrix = parseCsvMatrix(text);
  return buildVivoRowsFromMatrix(matrix, options);
}

/**
 * Parses a Vivo spreadsheet File (.csv, .xlsx, .xls) in the browser.
 */
export async function parseVivoSpreadsheetFile(
  file: File,
  options?: { updatedBy?: string; importCode?: string }
): Promise<ParsedVivoImportResult> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const buffer = await file.arrayBuffer();

  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
    return parseVivoCsvBuffer(buffer, {
      fileName: file.name,
      importCode: options?.importCode,
      updatedBy: options?.updatedBy,
    });
  }

  const wb = XLSX.read(buffer, { type: 'array', raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { rows: [], columns: [...VIVO_DOC_COLUMNS], headerRowIndex: 0, totalRead: 0 };
  }
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  return buildVivoRowsFromMatrix(
    matrix.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])),
    {
      fileName: file.name,
      importCode: options?.importCode,
      updatedBy: options?.updatedBy,
    }
  );
}

// ============================================================================
// DASHBOARD ANALYTICS AGGREGATION (PURE, TESTABLE)
// ============================================================================

export interface VivoDocTypeBreakdown {
  tipoDoc: string;
  total: number;
  finalizadas: number;
  aguardandoAprovacao: number;
  emProducao: number;
  pendentes: number;
  canceladas: number;
  outros: number;
  faturadas: number;
  percentConcluido: number;
}

export interface VivoStatusBreakdown {
  status: string;
  group: VivoStatusGroup;
  count: number;
  percent: number;
}

export interface VivoExecutorBreakdown {
  executor: string;
  total: number;
  finalizadas: number;
  emAberto: number;
  pendentes: number;
  percentConcluido: number;
  avgSla: number | null;
}

export interface VivoRegionalBreakdown {
  regional: string;
  total: number;
  finalizadas: number;
  emAberto: number;
  percentConcluido: number;
}

export interface VivoWeekDelivery {
  week: string;
  weekNum: number;
  count: number;
}

export interface VivoOffenderBreakdown {
  ofensor: string;
  count: number;
}

export interface VivoDashboardMetrics {
  totalAtividades: number;
  uniqueSites: number;
  finalizadas: number;
  percentFinalizadas: number;
  aguardandoAprovacao: number;
  emProducao: number;
  pendentes: number;
  canceladas: number;
  outros: number;
  faturadas: number;
  percentFaturadas: number;
  comRevisao: number;
  revisoesPorTipo: {
    wr: number;
    pirf: number;
    ppi: number;
    rfSheet: number;
  };
  avgSlaDoc: number | null;
  slaSampleSize: number;
  byDocType: VivoDocTypeBreakdown[];
  byStatus: VivoStatusBreakdown[];
  byExecutor: VivoExecutorBreakdown[];
  byRegional: VivoRegionalBreakdown[];
  byWeek: VivoWeekDelivery[];
  byOffender: VivoOffenderBreakdown[];
}

export function computeVivoDashboardMetrics(rows: VivoActivityRow[]): VivoDashboardMetrics {
  const totalAtividades = rows.length;
  const siteSet = new Set<string>();

  let finalizadas = 0;
  let aguardandoAprovacao = 0;
  let emProducao = 0;
  let pendentes = 0;
  let canceladas = 0;
  let outros = 0;
  let faturadas = 0;
  let comRevisao = 0;

  let slaSum = 0;
  let slaCount = 0;

  const revisoesPorTipo = { wr: 0, pirf: 0, ppi: 0, rfSheet: 0 };

  const docMap = new Map<
    string,
    {
      total: number;
      finalizadas: number;
      aguardandoAprovacao: number;
      emProducao: number;
      pendentes: number;
      canceladas: number;
      outros: number;
      faturadas: number;
    }
  >();

  const statusMap = new Map<string, { group: VivoStatusGroup; count: number }>();
  const execMap = new Map<
    string,
    { total: number; finalizadas: number; pendentes: number; slaSum: number; slaCount: number }
  >();
  const regMap = new Map<string, { total: number; finalizadas: number }>();
  const weekMap = new Map<string, number>();
  const offenderMap = new Map<string, number>();

  const hasRevFlag = (val?: string) => {
    const clean = (val || '').trim().toUpperCase();
    return Boolean(clean && clean !== '0' && clean !== '-' && clean !== 'NAO' && clean !== 'NÃO' && clean !== '#N/A');
  };

  for (const row of rows) {
    const siteKey = (row.siteName || '').trim().toUpperCase();
    if (siteKey) siteSet.add(siteKey);

    const group = classifyVivoStatus(row.status);
    if (group === 'finalizado') finalizadas++;
    else if (group === 'aguardando_aprovacao') aguardandoAprovacao++;
    else if (group === 'em_producao') emProducao++;
    else if (group === 'pendente') pendentes++;
    else if (group === 'cancelada') canceladas++;
    else outros++;

    const fat = isVivoFaturado(row);
    if (fat) faturadas++;

    const f = row.fields || {};
    const revWr = hasRevFlag(f['WR Revisar']);
    const revPirf = hasRevFlag(f['PIRF REVISAR']);
    const revPpi = hasRevFlag(f['PPI REVISAR']);
    const revRf = hasRevFlag(f['RF SHEET REVISAR']);
    if (revWr) revisoesPorTipo.wr++;
    if (revPirf) revisoesPorTipo.pirf++;
    if (revPpi) revisoesPorTipo.ppi++;
    if (revRf) revisoesPorTipo.rfSheet++;
    if (revWr || revPirf || revPpi || revRf || hasRevFlag(row.ofensor)) {
      comRevisao++;
    }

    const slaVal = parseNumericSla(row.slaDoc);
    if (slaVal !== null) {
      slaSum += slaVal;
      slaCount++;
    }

    // By Doc Type
    const docKey = normalizeVivoDocType(row.tipoDoc);
    const dEntry = docMap.get(docKey) || {
      total: 0,
      finalizadas: 0,
      aguardandoAprovacao: 0,
      emProducao: 0,
      pendentes: 0,
      canceladas: 0,
      outros: 0,
      faturadas: 0,
    };
    dEntry.total++;
    if (group === 'finalizado') dEntry.finalizadas++;
    else if (group === 'aguardando_aprovacao') dEntry.aguardandoAprovacao++;
    else if (group === 'em_producao') dEntry.emProducao++;
    else if (group === 'pendente') dEntry.pendentes++;
    else if (group === 'cancelada') dEntry.canceladas++;
    else dEntry.outros++;
    if (fat) dEntry.faturadas++;
    docMap.set(docKey, dEntry);

    // By Status
    const statusLabel = (row.status || '').trim() || 'Sem Status';
    const sEntry = statusMap.get(statusLabel) || { group, count: 0 };
    sEntry.count++;
    statusMap.set(statusLabel, sEntry);

    // By Executor
    const execLabel = (row.executor || '').trim() || 'Sem Executor';
    const eEntry = execMap.get(execLabel) || {
      total: 0,
      finalizadas: 0,
      pendentes: 0,
      slaSum: 0,
      slaCount: 0,
    };
    eEntry.total++;
    if (group === 'finalizado') eEntry.finalizadas++;
    if (group === 'pendente') eEntry.pendentes++;
    if (slaVal !== null) {
      eEntry.slaSum += slaVal;
      eEntry.slaCount++;
    }
    execMap.set(execLabel, eEntry);

    // By Regional
    const regLabel = (row.regional || '').trim() || 'N/I';
    const rEntry = regMap.get(regLabel) || { total: 0, finalizadas: 0 };
    rEntry.total++;
    if (group === 'finalizado') rEntry.finalizadas++;
    regMap.set(regLabel, rEntry);

    // By Week (numeric week > 0)
    const rawWeek = (row.entregueWeek || '').trim();
    const weekNum = parseInt(rawWeek, 10);
    if (Number.isFinite(weekNum) && weekNum > 0 && weekNum <= 53) {
      const wKey = String(weekNum);
      weekMap.set(wKey, (weekMap.get(wKey) || 0) + 1);
    }

    // By Offender
    const offLabel = (row.ofensor || '').trim();
    if (offLabel) {
      offenderMap.set(offLabel, (offenderMap.get(offLabel) || 0) + 1);
    }
  }

  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

  const byDocType: VivoDocTypeBreakdown[] = Array.from(docMap.entries())
    .map(([tipoDoc, stats]) => ({
      tipoDoc,
      ...stats,
      percentConcluido: pct(stats.finalizadas, stats.total),
    }))
    .sort((a, b) => b.total - a.total);

  const byStatus: VivoStatusBreakdown[] = Array.from(statusMap.entries())
    .map(([status, info]) => ({
      status,
      group: info.group,
      count: info.count,
      percent: pct(info.count, totalAtividades),
    }))
    .sort((a, b) => b.count - a.count);

  const byExecutor: VivoExecutorBreakdown[] = Array.from(execMap.entries())
    .map(([executor, info]) => ({
      executor,
      total: info.total,
      finalizadas: info.finalizadas,
      emAberto: info.total - info.finalizadas,
      pendentes: info.pendentes,
      percentConcluido: pct(info.finalizadas, info.total),
      avgSla: info.slaCount > 0 ? Math.round((info.slaSum / info.slaCount) * 10) / 10 : null,
    }))
    .sort((a, b) => b.total - a.total);

  const byRegional: VivoRegionalBreakdown[] = Array.from(regMap.entries())
    .map(([regional, info]) => ({
      regional,
      total: info.total,
      finalizadas: info.finalizadas,
      emAberto: info.total - info.finalizadas,
      percentConcluido: pct(info.finalizadas, info.total),
    }))
    .sort((a, b) => b.total - a.total);

  const byWeek: VivoWeekDelivery[] = Array.from(weekMap.entries())
    .map(([week, count]) => ({ week: `W${week.padStart(2, '0')}`, weekNum: parseInt(week, 10), count }))
    .sort((a, b) => a.weekNum - b.weekNum);

  const byOffender: VivoOffenderBreakdown[] = Array.from(offenderMap.entries())
    .map(([ofensor, count]) => ({ ofensor, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalAtividades,
    uniqueSites: siteSet.size,
    finalizadas,
    percentFinalizadas: pct(finalizadas, totalAtividades),
    aguardandoAprovacao,
    emProducao,
    pendentes,
    canceladas,
    outros,
    faturadas,
    percentFaturadas: pct(faturadas, totalAtividades),
    comRevisao,
    revisoesPorTipo,
    avgSlaDoc: slaCount > 0 ? Math.round((slaSum / slaCount) * 10) / 10 : null,
    slaSampleSize: slaCount,
    byDocType,
    byStatus,
    byExecutor,
    byRegional,
    byWeek,
    byOffender,
  };
}

/**
 * Exports Vivo activities to an Excel (.xlsx) workbook with all 46 canonical columns.
 */
export function exportVivoRowsToXlsx(rows: VivoActivityRow[], fileName?: string): void {
  const cols = [...VIVO_DOC_COLUMNS];
  const aoa: string[][] = [
    cols,
    ...rows.map((row) =>
      cols.map((col) => {
        if (col === '00.02.Site Name') return row.siteName || row.fields?.[col] || '';
        if (col === 'ID Register') return row.idRegister || row.fields?.[col] || '';
        if (col === 'Regional') return row.regional || row.fields?.[col] || '';
        if (col === 'Tipo doc') return row.tipoDoc || row.fields?.[col] || '';
        if (col === 'Status') return row.status || row.fields?.[col] || '';
        if (col === 'Comentário STATUS') return row.comentarioStatus || row.fields?.[col] || '';
        if (col === 'Prioridade') return row.prioridade || row.fields?.[col] || '';
        if (col === 'Demanda') return row.demanda || row.fields?.[col] || '';
        if (col === 'Planejado') return row.planejado || row.fields?.[col] || '';
        if (col === 'REPLAN') return row.replan || row.fields?.[col] || '';
        if (col === 'DATA REPLAN') return row.dataReplan || row.fields?.[col] || '';
        if (col === 'Entregue') return row.entregue || row.fields?.[col] || '';
        if (col === 'EXECUTOR') return row.executor || row.fields?.[col] || '';
        if (col === 'SLA DOC') return row.slaDoc || row.fields?.[col] || '';
        if (col === 'Entregue Week') return row.entregueWeek || row.fields?.[col] || '';
        if (col === 'Ofensor') return row.ofensor || row.fields?.[col] || '';
        if (col === 'FATURAMENTO') return row.faturamento || row.fields?.[col] || '';
        return row.fields?.[col] || '';
      })
    ),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vivo Documentacao');
  const outName =
    fileName ||
    `AMETA_VIVO_ATIVIDADES_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, outName);
}
