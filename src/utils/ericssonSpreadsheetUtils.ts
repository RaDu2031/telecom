import * as XLSX from 'xlsx';
import {
  ERICSSON_ORIGINAL_COLUMNS,
  EricssonRow,
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
