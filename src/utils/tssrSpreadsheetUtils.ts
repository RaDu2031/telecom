import * as XLSX from 'xlsx';
import {
  TssrRow,
  TSSR_TIM_NOKIA_ORIGINAL_COLUMNS,
  TSSR_SYSTEM_COLUMNS,
  TSSR_ALL_COLUMNS,
  VendorType,
} from '../types/telecom';

export function normalizeTssrHeader(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatTssrCellValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const d = String(val.getUTCDate()).padStart(2, '0');
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const y = val.getUTCFullYear();
    return `${d}/${m}/${y}`;
  }
  const str = String(val).trim();
  // Match ISO date string like 2026-03-09T00:00:00.000Z
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  return str;
}

export function buildTssrRowKey(siteIdRaw: string, ocSitePreRaw?: string): string {
  const sid = String(siteIdRaw || '').trim().toUpperCase();
  const oc = String(ocSitePreRaw || '').trim().toUpperCase();
  if (sid && oc) return `${sid}__${oc}`;
  return sid || oc || `ROW_${Date.now()}`;
}

/**
 * Matches a header cell from the TSSR spreadsheet to one of the 37 canonical TSSR_TIM_NOKIA_ORIGINAL_COLUMNS.
 */
export function matchCanonicalTssrColumn(rawHeader: unknown): string | null {
  const clean = normalizeTssrHeader(rawHeader).toLowerCase();
  if (!clean) return null;
  for (const col of TSSR_TIM_NOKIA_ORIGINAL_COLUMNS) {
    if (col.toLowerCase() === clean) return col;
  }
  // Handle slight line-break or accent variations if needed
  const cleanNoAccents = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const col of TSSR_TIM_NOKIA_ORIGINAL_COLUMNS) {
    const colNoAccents = col
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (colNoAccents === cleanNoAccents) return col;
  }
  return null;
}

/**
 * Parses a TSSR Excel workbook buffer (.xlsx / .xls) and extracts rows from "CONTROLE TSSR"
 * (or the first sheet containing TSSR columns), preserving the exact 37 columns.
 */
export function parseTssrWorkbookBuffer(
  buffer: ArrayBuffer | Buffer,
  vendor: VendorType = 'NOKIA',
  tabName = 'TSSR TIM Nokia'
): {
  rows: TssrRow[];
  sheetNameUsed: string;
} {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const targetSheetName =
    wb.SheetNames.find(
      (n) =>
        n.toUpperCase().includes('CONTROLE TSSR') ||
        n.toUpperCase().includes('TSSR')
    ) || wb.SheetNames[0];

  const ws = wb.Sheets[targetSheetName];
  if (!ws) {
    return { rows: [], sheetNameUsed: targetSheetName || '' };
  }

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
  });

  if (rawRows.length === 0) {
    return { rows: [], sheetNameUsed: targetSheetName };
  }

  // Find header row (in CONTROLE TSSR it is usually row index 1 because row 0 has subtotal counts, or row 0)
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const r = rawRows[i] || [];
    const matchedCount = r.filter((cell) => matchCanonicalTssrColumn(cell) !== null).length;
    if (matchedCount >= 5) {
      headerRowIdx = i;
      break;
    }
  }

  const headerRow = rawRows[headerRowIdx] || [];
  const colIndexToCanonical = new Map<number, string>();
  headerRow.forEach((cell, idx) => {
    const matched = matchCanonicalTssrColumn(cell);
    if (matched) {
      colIndexToCanonical.set(idx, matched);
    } else if (idx < TSSR_TIM_NOKIA_ORIGINAL_COLUMNS.length && normalizeTssrHeader(cell)) {
      // Fallback positional if header text was slightly different
      colIndexToCanonical.set(idx, TSSR_TIM_NOKIA_ORIGINAL_COLUMNS[idx]);
    }
  });

  // If no header row matched at all, map positionally 0..36
  if (colIndexToCanonical.size === 0) {
    TSSR_TIM_NOKIA_ORIGINAL_COLUMNS.forEach((col, idx) => {
      colIndexToCanonical.set(idx, col);
    });
  }

  const now = new Date().toISOString();
  const parsedRows: TssrRow[] = [];

  for (let rIdx = headerRowIdx + 1; rIdx < rawRows.length; rIdx++) {
    const row = rawRows[rIdx];
    if (!Array.isArray(row)) continue;

    const fields: Record<string, string> = {};
    TSSR_TIM_NOKIA_ORIGINAL_COLUMNS.forEach((col) => {
      fields[col] = '';
    });

    colIndexToCanonical.forEach((colName, cIdx) => {
      fields[colName] = formatTssrCellValue(row[cIdx]);
    });

    const siteId = (fields['Site Id'] || '').trim().toUpperCase();
    const ocSitePre = (fields['Oc Site Pre'] || '').trim();
    const enderecoId = (fields['Enderecoid'] || '').trim();

    // Skip completely empty rows
    if (!siteId && !ocSitePre && !enderecoId) continue;

    fields['Site Id'] = siteId;

    parsedRows.push({
      id: `tssr-${vendor.toLowerCase()}-${rIdx}-${Math.random().toString(36).slice(2, 7)}`,
      rowKey: buildTssrRowKey(siteId, ocSitePre),
      vendor,
      tabName,
      siteId,
      ocSitePre,
      enderecoId,
      fields,
      vistoriaStatus: 'Pendente',
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    rows: parsedRows,
    sheetNameUsed: targetSheetName,
  };
}

/**
 * Merges incoming TSSR rows with existing TSSR rows:
 * Updates the 37 original spreadsheet columns while strictly preserving
 * the 4 automatic system columns (vistoriaStatus, vistoriaFile*, vistoriaDeliveredAt, vistoriaUploadedBy)
 * matched by Site Id + Oc Site Pre (or Site Id fallback).
 */
export function mergeTssrRowsPreservingVistoria(
  existingRows: TssrRow[],
  incomingRows: TssrRow[],
  vendor: VendorType,
  tabName = 'TSSR TIM Nokia'
): {
  merged: TssrRow[];
  insertedCount: number;
  updatedCount: number;
} {
  const otherVendorOrTabRows = existingRows.filter(
    (r) => !(r.vendor === vendor && r.tabName === tabName)
  );
  const currentTabRows = existingRows.filter(
    (r) => r.vendor === vendor && r.tabName === tabName
  );

  // Build lookup maps by (Site Id + Oc Site Pre) and by (Site Id)
  const byFullKey = new Map<string, TssrRow>();
  const bySiteId = new Map<string, TssrRow>();
  const matchedExistingIds = new Set<string>();

  currentTabRows.forEach((r) => {
    const fullKey = buildTssrRowKey(r.siteId, r.ocSitePre);
    byFullKey.set(fullKey, r);
    const sid = (r.siteId || '').trim().toUpperCase();
    if (sid) {
      // Prefer keeping delivered status if multiple rows share Site Id
      const prev = bySiteId.get(sid);
      if (!prev || r.vistoriaStatus === 'Entregue') {
        bySiteId.set(sid, r);
      }
    }
  });

  const now = new Date().toISOString();
  let insertedCount = 0;
  let updatedCount = 0;
  const nextTabRows: TssrRow[] = [];

  incomingRows.forEach((inc, idx) => {
    const sid = (inc.siteId || inc.fields?.['Site Id'] || '').trim().toUpperCase();
    const oc = (inc.ocSitePre || inc.fields?.['Oc Site Pre'] || '').trim();
    const enderecoId = (inc.enderecoId || inc.fields?.['Enderecoid'] || '').trim();
    const fullKey = buildTssrRowKey(sid, oc);

    const existing = byFullKey.get(fullKey) || (sid ? bySiteId.get(sid) : undefined);

    const normalizedFields: Record<string, string> = {};
    TSSR_TIM_NOKIA_ORIGINAL_COLUMNS.forEach((col) => {
      normalizedFields[col] = inc.fields?.[col] ?? existing?.fields?.[col] ?? '';
    });
    normalizedFields['Site Id'] = sid;
    if (oc) normalizedFields['Oc Site Pre'] = oc;
    if (enderecoId) normalizedFields['Enderecoid'] = enderecoId;

    if (existing) {
      matchedExistingIds.add(existing.id);
      updatedCount++;
      nextTabRows.push({
        ...existing,
        rowKey: fullKey,
        siteId: sid,
        ocSitePre: oc,
        enderecoId,
        fields: normalizedFields,
        // Strictly preserve automatic system columns!
        vistoriaStatus: existing.vistoriaStatus || 'Pendente',
        vistoriaFileId: existing.vistoriaFileId,
        vistoriaFileName: existing.vistoriaFileName,
        vistoriaFileUrl: existing.vistoriaFileUrl,
        vistoriaDownloadUrl: existing.vistoriaDownloadUrl,
        vistoriaDeliveredAt: existing.vistoriaDeliveredAt,
        vistoriaUploadedBy: existing.vistoriaUploadedBy,
        vistoriaUploadedByEmail: existing.vistoriaUploadedByEmail,
        updatedAt: now,
      });
    } else {
      insertedCount++;
      nextTabRows.push({
        id: inc.id || `tssr-${vendor.toLowerCase()}-${Date.now()}-${idx}`,
        rowKey: fullKey,
        vendor,
        tabName,
        siteId: sid,
        ocSitePre: oc,
        enderecoId,
        fields: normalizedFields,
        vistoriaStatus: inc.vistoriaStatus || 'Pendente',
        vistoriaFileId: inc.vistoriaFileId,
        vistoriaFileName: inc.vistoriaFileName,
        vistoriaFileUrl: inc.vistoriaFileUrl,
        vistoriaDownloadUrl: inc.vistoriaDownloadUrl,
        vistoriaDeliveredAt: inc.vistoriaDeliveredAt,
        vistoriaUploadedBy: inc.vistoriaUploadedBy,
        vistoriaUploadedByEmail: inc.vistoriaUploadedByEmail,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  // Also preserve any manually created rows (created during Vistoriador upload when site was not in spreadsheet)
  // that already have a delivered file and weren't in the newly uploaded spreadsheet
  currentTabRows.forEach((r) => {
    if (!matchedExistingIds.has(r.id) && r.vistoriaStatus === 'Entregue') {
      const alreadyHasSameSite = nextTabRows.some(
        (nr) => nr.siteId.toUpperCase() === r.siteId.toUpperCase() && nr.vistoriaStatus === 'Entregue'
      );
      if (!alreadyHasSameSite) {
        nextTabRows.unshift(r);
      }
    }
  });

  return {
    merged: [...otherVendorOrTabRows, ...nextTabRows],
    insertedCount,
    updatedCount,
  };
}

export function getTssrColumnValue(row: TssrRow, colName: string): string {
  if (colName === 'Status da vistoria') {
    return row.vistoriaStatus || 'Pendente';
  }
  if (colName === 'Arquivo da vistoria') {
    return row.vistoriaFileName || '';
  }
  if (colName === 'Data/hora da entrega') {
    return row.vistoriaDeliveredAt || '';
  }
  if (colName === 'Vistoriador que enviou') {
    return row.vistoriaUploadedBy || '';
  }
  if (colName === 'Site Id') {
    return row.fields?.['Site Id'] || row.siteId || '';
  }
  if (colName === 'Oc Site Pre') {
    return row.fields?.['Oc Site Pre'] || row.ocSitePre || '';
  }
  if (colName === 'Enderecoid') {
    return row.fields?.['Enderecoid'] || row.enderecoId || '';
  }
  return row.fields?.[colName] || '';
}

export function exportTssrRowsToXlsx(
  rows: TssrRow[],
  fileName: string,
  sheetName = 'TSSR TIM Nokia'
): void {
  const headers = [
    ...TSSR_TIM_NOKIA_ORIGINAL_COLUMNS,
    ...TSSR_SYSTEM_COLUMNS.map((c) => `${c} [SISTEMA]`),
  ];

  const data = rows.map((r) => [
    ...TSSR_TIM_NOKIA_ORIGINAL_COLUMNS.map((col) => getTssrColumnValue(r, col)),
    r.vistoriaStatus || 'Pendente',
    r.vistoriaFileName || '',
    r.vistoriaDeliveredAt || '',
    r.vistoriaUploadedBy || '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName);
}

export function exportTssrRowsToCsv(rows: TssrRow[], fileName: string): void {
  const headers = [
    ...TSSR_TIM_NOKIA_ORIGINAL_COLUMNS,
    ...TSSR_SYSTEM_COLUMNS.map((c) => `${c} [SISTEMA]`),
  ];

  const escapeCsv = (val: string) => {
    const clean = String(val ?? '').replace(/\r?\n/g, ' ');
    if (clean.includes(';') || clean.includes('"')) {
      return `"${clean.replace(/"/g, '""')}"`;
    }
    return clean;
  };

  const lines = [
    headers.map(escapeCsv).join(';'),
    ...rows.map((r) =>
      [
        ...TSSR_TIM_NOKIA_ORIGINAL_COLUMNS.map((col) => getTssrColumnValue(r, col)),
        r.vistoriaStatus || 'Pendente',
        r.vistoriaFileName || '',
        r.vistoriaDeliveredAt || '',
        r.vistoriaUploadedBy || '',
      ]
        .map(escapeCsv)
        .join(';')
    ),
  ];

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export { TSSR_ALL_COLUMNS };
