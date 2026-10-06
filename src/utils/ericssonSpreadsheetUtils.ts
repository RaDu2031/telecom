import * as XLSX from 'xlsx';
import {
  ERICSSON_ORIGINAL_COLUMNS,
  ERICSSON_SITE_LIST_COLUMNS,
  EricssonRow,
  EricssonEngineeringRow,
  EricssonDocGroup,
  EricssonDocStatusCategory,
  EricssonConsolidatedStats,
  EricssonVistoriaStatus,
} from '../types/telecom';

function normalizeHeader(h: unknown): string {
  return String(h || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatEricssonCellValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    const dd = String(val.getDate()).padStart(2, '0');
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const yyyy = val.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  const str = String(val).trim();
  const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    const m = mdyMatch[1].padStart(2, '0');
    const d = mdyMatch[2].padStart(2, '0');
    let y = mdyMatch[3];
    if (y.length === 2) y = `20${y}`;
    return `${d}/${m}/${y}`;
  }
  return str;
}

export function buildEricssonRowKey(
  chaves: string,
  registro: string,
  siteIdA: string,
  siteIdB: string
): string {
  const c = (chaves || '').trim().toUpperCase();
  const r = (registro || '').trim().toUpperCase();
  const a = (siteIdA || '').trim().toUpperCase();
  const b = (siteIdB || '').trim().toUpperCase();
  return `${c}__${r}__${a}__${b}`;
}

export function parseEricssonWorkbookBuffer(buffer: ArrayBuffer): {
  tabName: string;
  columns: string[];
  rows: EricssonRow[];
} {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  const targetSheetName =
    workbook.SheetNames.find(
      (n) =>
        n.trim().toUpperCase() === 'ERICSSON CLARO TX' ||
        n.toUpperCase().includes('ERICSSON')
    ) ||
    workbook.SheetNames.find(
      (n) =>
        !['REPORT', 'EQUIPES', 'ESCOPO'].includes(n.trim().toUpperCase()) &&
        !n.toUpperCase().includes('APOIO')
    ) ||
    workbook.SheetNames[0];

  if (!targetSheetName) {
    return { tabName: 'ERICSSON CLARO TX', columns: ERICSSON_ORIGINAL_COLUMNS, rows: [] };
  }

  const sheet = workbook.Sheets[targetSheetName];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (rawRows.length === 0) {
    return { tabName: targetSheetName, columns: ERICSSON_ORIGINAL_COLUMNS, rows: [] };
  }

  // Locate header row (usually row index 2 in ERICSSON CLARO TX where "01.00. Chaves" and "01.21.Site ID A" appear)
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(12, rawRows.length); i++) {
    const rowCells = (rawRows[i] || []).map((c) => normalizeHeader(c).toLowerCase());
    const hasSiteIdA = rowCells.some(
      (c) => c.includes('site id a') || c === '01.21.site id a'
    );
    const hasChaves = rowCells.some((c) => c.includes('chaves'));
    if (hasSiteIdA || hasChaves) {
      headerRowIndex = i;
      break;
    }
  }

  const headerCells = (rawRows[headerRowIndex] || []).map((c) => normalizeHeader(c));
  // Preserve exact columns from the spreadsheet in order (filtering trailing completely blank header cells)
  let lastNonEmptyIdx = headerCells.length - 1;
  while (lastNonEmptyIdx >= 0 && !headerCells[lastNonEmptyIdx]) {
    lastNonEmptyIdx--;
  }

  const detectedColumns: string[] = [];
  const colIndexMap = new Map<number, string>();
  const usedNames = new Set<string>();

  for (let cIdx = 0; cIdx <= lastNonEmptyIdx; cIdx++) {
    let colName = headerCells[cIdx] || `Coluna ${cIdx + 1}`;
    if (usedNames.has(colName)) {
      let suffix = 2;
      while (usedNames.has(`${colName}${suffix}`)) {
        suffix++;
      }
      colName = `${colName}${suffix}`;
    }
    usedNames.add(colName);
    detectedColumns.push(colName);
    colIndexMap.set(cIdx, colName);
  }

  const columns =
    detectedColumns.length > 0 ? detectedColumns : [...ERICSSON_ORIGINAL_COLUMNS];

  const now = new Date().toISOString();
  const parsedRows: EricssonRow[] = [];

  for (let rIdx = headerRowIndex + 1; rIdx < rawRows.length; rIdx++) {
    const row = rawRows[rIdx];
    if (!Array.isArray(row)) continue;

    const fields: Record<string, string> = {};
    let hasAnyValue = false;

    columns.forEach((colName, cIdx) => {
      const val = formatEricssonCellValue(row[cIdx]);
      if (val) hasAnyValue = true;
      fields[colName] = val;
    });

    if (!hasAnyValue) continue;

    const chaves = fields['01.00. Chaves'] || fields['Chaves'] || '';
    const registro = fields['Registro'] || '';
    const state = fields['00.03.State'] || fields['State'] || fields['UF'] || '';
    const meta = fields['Meta'] || '';
    const siteIdA = (
      fields['01.21.Site ID A'] ||
      fields['Site ID A'] ||
      ''
    )
      .trim()
      .toUpperCase();
    const idDetentoraA = fields['ID Detentora A'] || '';
    const siteIdB = (
      fields['01.21.Site ID B'] ||
      fields['Site ID B'] ||
      ''
    )
      .trim()
      .toUpperCase();
    const idDetentoraB = fields['ID Detentora B'] || '';

    if (!chaves && !siteIdA && !siteIdB) continue;

    fields['01.21.Site ID A'] = siteIdA;
    fields['01.21.Site ID B'] = siteIdB;

    const siteName =
      fields['00.04.Site Name'] ||
      (siteIdA && siteIdB ? `${siteIdA}-${siteIdB}` : siteIdA || siteIdB);

    const statusA = fields['Status A'] || '';
    const statusB = fields['Status B'] || '';
    const cidadeA = fields['CIDADE A'] || '';
    const cidadeB = fields['CIDADE B'] || '';
    const equipe = fields['EQUIPE'] || '';
    const servico = fields['Serviço'] || '';

    const rowKey = buildEricssonRowKey(chaves, registro, siteIdA, siteIdB);

    parsedRows.push({
      id: `eric-row-${rIdx - headerRowIndex}`,
      rowKey,
      chaves,
      registro,
      state,
      meta,
      siteIdA,
      idDetentoraA,
      siteIdB,
      idDetentoraB,
      siteName,
      statusA,
      statusB,
      cidadeA,
      cidadeB,
      equipe,
      servico,
      fields,
      siteAVistoriaStatus: 'Pendente',
      siteBVistoriaStatus: 'Pendente',
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    tabName: targetSheetName,
    columns,
    rows: parsedRows,
  };
}

interface SiteVistoriaSnapshot {
  status: EricssonVistoriaStatus;
  fileId?: string;
  folderId?: string;
  fileName?: string;
  fileUrl?: string;
  downloadUrl?: string;
  deliveredAt?: string;
  uploadedBy?: string;
  uploadedByEmail?: string;
}

export function mergeEricssonRowsPreservingVistoria(
  existingRows: EricssonRow[],
  incomingRows: EricssonRow[],
  mode: 'upsert' | 'replace' = 'replace'
): {
  rows: EricssonRow[];
  insertedCount: number;
  updatedCount: number;
  preservedVistoriasCount: number;
} {
  const byRowKey = new Map<string, EricssonRow>();
  const byPairKey = new Map<string, EricssonRow>();
  const byChavesKey = new Map<string, EricssonRow>();
  // Also index delivered vistoria snapshots by Site ID (so even if Chaves or Registro changes in Excel, a delivered site keeps its vistoria!)
  const deliveredBySiteId = new Map<string, SiteVistoriaSnapshot>();

  existingRows.forEach((row) => {
    if (row.rowKey) {
      byRowKey.set(row.rowKey.toUpperCase(), row);
    }
    const pairKey = `${row.siteIdA.trim().toUpperCase()}__${row.siteIdB.trim().toUpperCase()}`;
    if (row.siteIdA || row.siteIdB) {
      if (
        !byPairKey.has(pairKey) ||
        row.siteAVistoriaStatus === 'Entregue' ||
        row.siteBVistoriaStatus === 'Entregue'
      ) {
        byPairKey.set(pairKey, row);
      }
    }
    if (row.chaves) {
      const ck = row.chaves.trim().toUpperCase();
      if (
        !byChavesKey.has(ck) ||
        row.siteAVistoriaStatus === 'Entregue' ||
        row.siteBVistoriaStatus === 'Entregue'
      ) {
        byChavesKey.set(ck, row);
      }
    }

    if (row.siteIdA && row.siteAVistoriaStatus === 'Entregue') {
      deliveredBySiteId.set(row.siteIdA.trim().toUpperCase(), {
        status: 'Entregue',
        fileId: row.siteAVistoriaFileId,
        folderId: row.siteAVistoriaFolderId,
        fileName: row.siteAVistoriaFileName,
        fileUrl: row.siteAVistoriaFileUrl,
        downloadUrl: row.siteAVistoriaDownloadUrl,
        deliveredAt: row.siteAVistoriaDeliveredAt,
        uploadedBy: row.siteAVistoriaUploadedBy,
        uploadedByEmail: row.siteAVistoriaUploadedByEmail,
      });
    }
    if (row.siteIdB && row.siteBVistoriaStatus === 'Entregue') {
      deliveredBySiteId.set(row.siteIdB.trim().toUpperCase(), {
        status: 'Entregue',
        fileId: row.siteBVistoriaFileId,
        folderId: row.siteBVistoriaFolderId,
        fileName: row.siteBVistoriaFileName,
        fileUrl: row.siteBVistoriaFileUrl,
        downloadUrl: row.siteBVistoriaDownloadUrl,
        deliveredAt: row.siteBVistoriaDeliveredAt,
        uploadedBy: row.siteBVistoriaUploadedBy,
        uploadedByEmail: row.siteBVistoriaUploadedByEmail,
      });
    }
  });

  let insertedCount = 0;
  let updatedCount = 0;
  let preservedVistoriasCount = 0;
  const matchedExistingIds = new Set<string>();

  const mergedIncoming = incomingRows.map((inc, index) => {
    const rk = inc.rowKey.toUpperCase();
    const pairKey = `${inc.siteIdA.trim().toUpperCase()}__${inc.siteIdB.trim().toUpperCase()}`;
    const ck = inc.chaves.trim().toUpperCase();

    const matched =
      byRowKey.get(rk) ||
      byPairKey.get(pairKey) ||
      (ck ? byChavesKey.get(ck) : undefined);

    if (matched) {
      matchedExistingIds.add(matched.id);
      updatedCount++;
    } else {
      insertedCount++;
    }

    // Resolve Site A vistoria status (from matched row or deliveredBySiteId fallback)
    const snapAFromRow: SiteVistoriaSnapshot | undefined =
      matched && matched.siteAVistoriaStatus !== 'Pendente'
        ? {
            status: matched.siteAVistoriaStatus,
            fileId: matched.siteAVistoriaFileId,
            folderId: matched.siteAVistoriaFolderId,
            fileName: matched.siteAVistoriaFileName,
            fileUrl: matched.siteAVistoriaFileUrl,
            downloadUrl: matched.siteAVistoriaDownloadUrl,
            deliveredAt: matched.siteAVistoriaDeliveredAt,
            uploadedBy: matched.siteAVistoriaUploadedBy,
            uploadedByEmail: matched.siteAVistoriaUploadedByEmail,
          }
        : deliveredBySiteId.get(inc.siteIdA.trim().toUpperCase());

    const snapBFromRow: SiteVistoriaSnapshot | undefined =
      matched && matched.siteBVistoriaStatus !== 'Pendente'
        ? {
            status: matched.siteBVistoriaStatus,
            fileId: matched.siteBVistoriaFileId,
            folderId: matched.siteBVistoriaFolderId,
            fileName: matched.siteBVistoriaFileName,
            fileUrl: matched.siteBVistoriaFileUrl,
            downloadUrl: matched.siteBVistoriaDownloadUrl,
            deliveredAt: matched.siteBVistoriaDeliveredAt,
            uploadedBy: matched.siteBVistoriaUploadedBy,
            uploadedByEmail: matched.siteBVistoriaUploadedByEmail,
          }
        : deliveredBySiteId.get(inc.siteIdB.trim().toUpperCase());

    const resolvedStatusA: EricssonVistoriaStatus =
      snapAFromRow?.status ||
      (snapBFromRow?.status === 'Entregue' ? 'Dispensado' : 'Pendente');
    const resolvedStatusB: EricssonVistoriaStatus =
      snapBFromRow?.status ||
      (snapAFromRow?.status === 'Entregue' ? 'Dispensado' : 'Pendente');

    if (resolvedStatusA === 'Entregue') preservedVistoriasCount++;
    if (resolvedStatusB === 'Entregue') preservedVistoriasCount++;
    if (matched?.losStatus === 'Entregue') preservedVistoriasCount++;

    return {
      ...inc,
      id: matched ? matched.id : inc.id || `eric-row-${Date.now()}-${index}`,
      siteAVistoriaStatus: resolvedStatusA,
      siteAVistoriaFileId: snapAFromRow?.fileId,
      siteAVistoriaFolderId: snapAFromRow?.folderId,
      siteAVistoriaFileName: snapAFromRow?.fileName,
      siteAVistoriaFileUrl: snapAFromRow?.fileUrl,
      siteAVistoriaDownloadUrl: snapAFromRow?.downloadUrl,
      siteAVistoriaDeliveredAt: snapAFromRow?.deliveredAt,
      siteAVistoriaUploadedBy: snapAFromRow?.uploadedBy,
      siteAVistoriaUploadedByEmail: snapAFromRow?.uploadedByEmail,
      siteBVistoriaStatus: resolvedStatusB,
      siteBVistoriaFileId: snapBFromRow?.fileId,
      siteBVistoriaFolderId: snapBFromRow?.folderId,
      siteBVistoriaFileName: snapBFromRow?.fileName,
      siteBVistoriaFileUrl: snapBFromRow?.fileUrl,
      siteBVistoriaDownloadUrl: snapBFromRow?.downloadUrl,
      siteBVistoriaDeliveredAt: snapBFromRow?.deliveredAt,
      siteBVistoriaUploadedBy: snapBFromRow?.uploadedBy,
      siteBVistoriaUploadedByEmail: snapBFromRow?.uploadedByEmail,
      losStatus: matched?.losStatus || 'Pendente',
      losLinkedSiteId: matched?.losLinkedSiteId,
      losFileId: matched?.losFileId,
      losFolderId: matched?.losFolderId,
      losFileName: matched?.losFileName,
      losFileUrl: matched?.losFileUrl,
      losDownloadUrl: matched?.losDownloadUrl,
      losDeliveredAt: matched?.losDeliveredAt,
      losUploadedBy: matched?.losUploadedBy,
      losUploadedByEmail: matched?.losUploadedByEmail,
      createdAt: matched?.createdAt || inc.createdAt,
      updatedAt: new Date().toISOString(),
    };
  });

  // Keep any rows that had delivered vistorias or were manually created and weren't in the incoming sheet
  const preservedUnmatched = existingRows.filter((row) => {
    if (matchedExistingIds.has(row.id)) return false;
    if (mode === 'upsert') return true;
    return (
      row.isManualRow ||
      row.siteAVistoriaStatus === 'Entregue' ||
      row.siteBVistoriaStatus === 'Entregue' ||
      row.losStatus === 'Entregue'
    );
  });

  return {
    rows: [...mergedIncoming, ...preservedUnmatched],
    insertedCount,
    updatedCount,
    preservedVistoriasCount,
  };
}

export interface EricssonSiteCounters {
  totalPairs: number;
  totalSites: number; // Counts every Site A + every Site B individually
  vistoriaEntregueSites: number;
  vistoriaDispensadoSites: number;
  vistoriaPendenteSites: number;
  statusConcluidoSites: number;
  statusEmAndamentoSites: number;
  statusImprodutivaSites: number;
  statusCanceladoSites: number;
  statusOutrosSites: number;
}

export function computeEricssonSiteCounters(rows: EricssonRow[]): EricssonSiteCounters {
  let totalSites = 0;
  let vistoriaEntregueSites = 0;
  let vistoriaDispensadoSites = 0;
  let vistoriaPendenteSites = 0;
  let statusConcluidoSites = 0;
  let statusEmAndamentoSites = 0;
  let statusImprodutivaSites = 0;
  let statusCanceladoSites = 0;
  let statusOutrosSites = 0;

  const classifySheetStatus = (rawStatus: string) => {
    const s = (rawStatus || '').trim().toLowerCase();
    if (s.includes('conclu') || s.includes('liberad')) {
      statusConcluidoSites++;
    } else if (
      s.includes('andamento') ||
      s.includes('execu') ||
      s.includes('programad') ||
      s.includes('acesso') ||
      s.includes('pend') ||
      s.includes('aguard')
    ) {
      statusEmAndamentoSites++;
    } else if (s.includes('improdutiv')) {
      statusImprodutivaSites++;
    } else if (s.includes('cancelad') || s.includes('desmobiliz')) {
      statusCanceladoSites++;
    } else {
      statusOutrosSites++;
    }
  };

  rows.forEach((row) => {
    if (row.siteIdA && row.siteIdA.trim()) {
      totalSites++;
      if (row.siteAVistoriaStatus === 'Entregue') {
        vistoriaEntregueSites++;
      } else if (row.siteAVistoriaStatus === 'Dispensado') {
        vistoriaDispensadoSites++;
      } else {
        vistoriaPendenteSites++;
      }
      classifySheetStatus(row.statusA || row.fields?.['Status A'] || '');
    }

    if (row.siteIdB && row.siteIdB.trim()) {
      totalSites++;
      if (row.siteBVistoriaStatus === 'Entregue') {
        vistoriaEntregueSites++;
      } else if (row.siteBVistoriaStatus === 'Dispensado') {
        vistoriaDispensadoSites++;
      } else {
        vistoriaPendenteSites++;
      }
      classifySheetStatus(row.statusB || row.fields?.['Status B'] || '');
    }
  });

  return {
    totalPairs: rows.length,
    totalSites,
    vistoriaEntregueSites,
    vistoriaDispensadoSites,
    vistoriaPendenteSites,
    statusConcluidoSites,
    statusEmAndamentoSites,
    statusImprodutivaSites,
    statusCanceladoSites,
    statusOutrosSites,
  };
}

// ============================================================================
// ERICSSON ENGENHARIA UTILS (WR, QRF, PPI, BOQ & 51 COLUNAS EXATAS)
// ============================================================================

export function classifyEricssonDocGroup(tipoDocRaw: string): EricssonDocGroup | null {
  const norm = String(tipoDocRaw || '').toUpperCase();
  if (norm.includes('SMART')) return 'SMART';
  if (norm.includes('SDC')) return 'SDC';
  if (norm.includes('WR')) return 'WR';
  if (norm.includes('QRF')) return 'QRF';
  if (norm.includes('PPI')) return 'PPI';
  if (norm.includes('BOQ')) return 'BOQ';
  return null;
}

export function rowMatchesEricssonDocGroup(tipoDocRaw: string, group: EricssonDocGroup): boolean {
  const norm = String(tipoDocRaw || '').toUpperCase();
  return norm.includes(group);
}

export function classifyEricssonStatus(statusRaw: string): EricssonDocStatusCategory {
  const norm = String(statusRaw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (norm.includes('duvida')) return 'Dúvida';
  if (
    norm.includes('finaliz') ||
    norm.includes('conclu') ||
    norm.includes('aprovad') ||
    norm.includes('entregue') ||
    norm.includes('pronto')
  ) {
    return 'Finalizado';
  }
  if (
    norm.includes('producao') ||
    norm.includes('produz') ||
    norm.includes('correcao') ||
    norm.includes('ajuste')
  ) {
    return 'Em produção';
  }
  // Default for all active / pending statuses
  return 'Pendente';
}

export function computeEricssonConsolidatedStats(
  rows: EricssonEngineeringRow[]
): EricssonConsolidatedStats {
  const initGroup = () => ({
    total: 0,
    finalizado: 0,
    emProducao: 0,
    pendente: 0,
    duvida: 0,
    outros: 0,
  });

  const stats: EricssonConsolidatedStats = {
    totalRows: rows.length,
    wr: initGroup(),
    qrf: initGroup(),
    ppi: initGroup(),
    boq: initGroup(),
    smart: initGroup(),
    sdc: initGroup(),
    outrosDocs: 0,
  };

  rows.forEach((r) => {
    const rawTipo = String(r.tipoDoc || r.fields?.['Tipo doc'] || '').toUpperCase();
    const statusCat = classifyEricssonStatus(r.status || r.fields?.['Status'] || '');

    let matchedAny = false;

    const assignTo = (group: typeof stats.wr) => {
      group.total++;
      if (statusCat === 'Finalizado') group.finalizado++;
      else if (statusCat === 'Em produção') group.emProducao++;
      else if (statusCat === 'Pendente') group.pendente++;
      else if (statusCat === 'Dúvida') group.duvida++;
      else group.outros++;
      matchedAny = true;
    };

    if (rawTipo.includes('WR')) assignTo(stats.wr);
    if (rawTipo.includes('QRF')) assignTo(stats.qrf);
    if (rawTipo.includes('PPI')) assignTo(stats.ppi);
    if (rawTipo.includes('BOQ')) assignTo(stats.boq);
    if (rawTipo.includes('SMART')) assignTo(stats.smart);
    if (rawTipo.includes('SDC')) assignTo(stats.sdc);

    if (!matchedAny) {
      stats.outrosDocs++;
    }
  });

  return stats;
}

export function parseEricssonEngineeringWorkbookBuffer(buffer: ArrayBuffer): {
  tabName: string;
  columns: string[];
  rows: EricssonEngineeringRow[];
} {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  const targetSheetName =
    workbook.SheetNames.find((n) => n.trim().toLowerCase() === 'site list') ||
    workbook.SheetNames.find(
      (n) =>
        !['REPORT', 'REPORT ERICSSON', 'RECURSOS DOC', 'COMBOS', 'ORIENTAÇÕES', 'ORIENTACOES'].includes(
          n.trim().toUpperCase()
        )
    ) ||
    workbook.SheetNames[0];

  if (!targetSheetName) {
    return { tabName: 'Site list', columns: [...ERICSSON_SITE_LIST_COLUMNS], rows: [] };
  }

  const sheet = workbook.Sheets[targetSheetName];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (rawRows.length === 0) {
    return { tabName: targetSheetName, columns: [...ERICSSON_SITE_LIST_COLUMNS], rows: [] };
  }

  // Find header row: look for row that contains 'ASP' or 'Intervencao Claro' or has maximum non-empty cells
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowCells = (rawRows[i] || []).map((c) => normalizeHeader(c).toLowerCase());
    if (rowCells.some((c) => c === 'asp' || c.includes('intervencao') || c.includes('tipo doc'))) {
      headerRowIndex = i;
      break;
    }
  }

  const rawHeaders = (rawRows[headerRowIndex] || []).map((c) => normalizeHeader(c));
  const detectedColumns: string[] = [];
  rawHeaders.forEach((h, idx) => {
    if (h) detectedColumns.push(h);
    else if (idx < ERICSSON_SITE_LIST_COLUMNS.length) {
      detectedColumns.push(ERICSSON_SITE_LIST_COLUMNS[idx]);
    }
  });

  const columns =
    detectedColumns.length >= 10 ? detectedColumns : [...ERICSSON_SITE_LIST_COLUMNS];

  const parsedRows: EricssonEngineeringRow[] = [];
  const now = new Date().toISOString();

  for (let rIdx = headerRowIndex + 1; rIdx < rawRows.length; rIdx++) {
    const row = rawRows[rIdx];
    if (!Array.isArray(row)) continue;

    const fields: Record<string, string> = {};
    let hasAnyValue = false;

    columns.forEach((colName, cIdx) => {
      const val = formatEricssonCellValue(row[cIdx]);
      if (val) hasAnyValue = true;
      fields[colName] = val;
    });

    if (!hasAnyValue) continue;

    const intervencao = fields['Intervencao Claro'] || '';
    let siteIdA = intervencao;
    let siteIdB = '';

    if (intervencao.includes('-')) {
      const parts = intervencao.split('-');
      siteIdA = parts[0].trim();
      siteIdB = parts[1] ? parts[1].trim() : '';
    } else if (intervencao.includes('/')) {
      const parts = intervencao.split('/');
      siteIdA = parts[0].trim();
      siteIdB = parts[1] ? parts[1].trim() : '';
    }

    const rowId = `eric-eng-${rIdx - headerRowIndex}`;
    const statusVal = fields['Status'] || '';
    const tipoDocVal = fields['Tipo doc'] || '';

    parsedRows.push({
      id: rowId,
      rowKey: `${intervencao}__${tipoDocVal}__${rIdx}`,
      intervencaoClaro: intervencao,
      siteIdA: siteIdA || `SITE_${rIdx}`,
      siteIdB: siteIdB,
      statusA: statusVal || 'Pendente',
      statusB: siteIdB ? statusVal || 'Pendente' : '',
      tipoDoc: tipoDocVal,
      status: statusVal,
      regional: fields['Regional'] || '',
      tipoSite: fields['TIPO SITE'] || '',
      executor: fields['EXECUTOR'] || '',
      fields,
      siteAVistoriaStatus: 'Pendente',
      siteBVistoriaStatus: siteIdB ? 'Pendente' : undefined,
      updatedAt: now,
    });
  }

  return {
    tabName: targetSheetName,
    columns,
    rows: parsedRows,
  };
}

export function exportEricssonEngineeringToXlsx(
  rows: EricssonEngineeringRow[],
  columns: string[],
  fileName: string = 'Engenharia_Ericsson.xlsx'
): void {
  const cols = columns && columns.length > 0 ? columns : ERICSSON_SITE_LIST_COLUMNS;
  const data = rows.map((r) => {
    const obj: Record<string, string> = {};
    cols.forEach((c) => {
      obj[c] = r.fields?.[c] || '';
    });
    return obj;
  });

  const ws = XLSX.utils.json_to_sheet(data, { header: cols });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Site list');
  XLSX.writeFile(wb, fileName);
}

export function exportEricssonEngineeringToCsv(
  rows: EricssonEngineeringRow[],
  columns: string[],
  fileName: string = 'Engenharia_Ericsson.csv'
): void {
  const cols = columns && columns.length > 0 ? columns : ERICSSON_SITE_LIST_COLUMNS;
  const headerLine = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(';');
  const dataLines = rows.map((r) =>
    cols
      .map((c) => `"${(r.fields?.[c] || '').replace(/"/g, '""')}"`)
      .join(';')
  );
  const csvContent = [headerLine, ...dataLines].join('\r\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function isEricssonRowAssignedToExecutor(
  row: { executor?: string; fields?: Record<string, string> },
  executorName: string
): boolean {
  if (!executorName) return false;
  const exCandidates = [
    row.executor,
    row.fields?.['EXECUTOR'],
    row.fields?.['EXECUTOR PPI'],
    row.fields?.['EXECUTOR QRF'],
    row.fields?.['EXECUTOR WR'],
    row.fields?.['Executor'],
  ]
    .filter(Boolean)
    .map((v) => normalizeAccents(String(v).toLowerCase().trim()));

  if (exCandidates.length === 0) return false;

  const targetNorm = normalizeAccents(executorName.toLowerCase().trim());

  return exCandidates.some((c) => {
    if (c === targetNorm) return true;
    const insideParen = targetNorm.match(/\((.*?)\)/)?.[1];
    if (insideParen && (c.includes(insideParen) || insideParen.includes(c))) return true;
    const mainName = targetNorm.replace(/\(.*?\)/g, '').trim();
    if (mainName && (c.includes(mainName) || mainName.includes(c))) return true;
    const targetWords = targetNorm.split(/\s+/).filter((w) => w.length > 2);
    const candWords = c.split(/\s+/).filter((w) => w.length > 2);
    const commonWords = targetWords.filter((w) => candWords.includes(w));
    return commonWords.length >= 2;
  });
}


