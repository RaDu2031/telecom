import * as XLSX from 'xlsx';
import {
  ERICSSON_ORIGINAL_COLUMNS,
  ERICSSON_SITE_LIST_COLUMNS,
  ERICSSON_REAL_STATUSES_BY_DOC,
  EricssonRow,
  EricssonEngineeringRow,
  EricssonDocGroup,
  EricssonDocStatusCategory,
  EricssonConsolidatedStats,
  EricssonDocItemStats,
  EricssonVistoriaStatus,
  EricssonReprovacaoRecord,
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

function cleanHeaderKey(h: unknown): string {
  return String(h || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function scoreRowAsHeader(row: unknown[]): number {
  if (!Array.isArray(row) || row.length === 0) return 0;
  let score = 0;
  let nonEmpty = 0;
  for (const cell of row) {
    if (cell === null || cell === undefined || cell === '') continue;
    nonEmpty++;
    const k = cleanHeaderKey(cell);
    if (!k) continue;

    if (k.includes('site id a') || k === 'site a' || k.includes('01 21 site id a')) score += 8;
    else if (k.includes('site id b') || k === 'site b' || k.includes('01 21 site id b')) score += 8;
    else if (k === 'site id' || k.includes('site id')) score += 4;
    else if (k.includes('chaves') || k === 'chave' || k.includes('01 00 chaves')) score += 6;
    else if (k.includes('registro') || k === 'reg') score += 4;
    else if (k === 'meta') score += 3;
    else if (k === 'state' || k === 'uf' || k === 'estado' || k.includes('00 03 state')) score += 4;
    else if (k === 'status a' || k === 'status b' || k.includes('status')) score += 4;
    else if (k.includes('cidade a') || k.includes('cidade b') || k.includes('municipio')) score += 4;
    else if (k.includes('equipe') || k.includes('equipe executante')) score += 4;
    else if (k.includes('servico') || k.includes('scope') || k.includes('escopo')) score += 4;
    else if (k.includes('detentora')) score += 4;
    else if (k.includes('site survey') || k.includes('vistoria') || k.includes('tssr') || k.includes('los')) score += 3;
  }
  return nonEmpty >= 3 ? score : 0;
}

function isBlankOrPlaceholder(val?: string | null): boolean {
  if (!val) return true;
  const s = val.trim().toUpperCase();
  return (
    !s ||
    s === '—' ||
    s === '-' ||
    s === '--' ||
    s === 'N/A' ||
    s === '#N/A' ||
    s === 'TOTAL' ||
    s === 'TOTAL GERAL' ||
    s === 'SOMA' ||
    s === 'SUBTOTAL' ||
    s === '0' ||
    s === 'NULL' ||
    s === 'UNDEFINED' ||
    s === 'LEGENDA' ||
    s === 'OBS' ||
    s === 'OBSERVAÇÕES' ||
    s === 'OBSERVACOES'
  );
}

export function parseEricssonWorkbookBuffer(buffer: ArrayBuffer): {
  tabName: string;
  columns: string[];
  rows: EricssonRow[];
} {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return { tabName: 'ERICSSON CLARO TX', columns: ERICSSON_ORIGINAL_COLUMNS, rows: [] };
  }

  // Find the best worksheet by scoring header detection across sheets
  let bestSheetName = workbook.SheetNames[0];
  let bestSheetScore = -1;
  let bestSheetHeaderRow = 0;
  let bestSheetRawRows: unknown[][] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });
    if (!rawRows || rawRows.length === 0) continue;

    // Scan up to 25 rows for header candidates
    let maxScore = 0;
    let bestRowIdx = 0;
    const limit = Math.min(25, rawRows.length);
    for (let r = 0; r < limit; r++) {
      const score = scoreRowAsHeader(rawRows[r] || []);
      if (score > maxScore) {
        maxScore = score;
        bestRowIdx = r;
      }
    }

    // Boost score if sheet name strongly indicates Ericsson Claro TX
    const upperName = sheetName.trim().toUpperCase();
    let bonus = 0;
    if (upperName.includes('ERICSSON CLARO TX')) bonus += 15;
    else if (upperName.includes('ERICSSON') && upperName.includes('TX')) bonus += 12;
    else if (upperName.includes('ERICSSON')) bonus += 8;
    else if (upperName.includes('TX') || upperName.includes('SITES')) bonus += 5;
    else if (['REPORT', 'EQUIPES', 'ESCOPO', 'APOIO'].includes(upperName)) bonus -= 30;

    const totalSheetScore = maxScore + bonus;
    if (totalSheetScore > bestSheetScore) {
      bestSheetScore = totalSheetScore;
      bestSheetName = sheetName;
      bestSheetHeaderRow = bestRowIdx;
      bestSheetRawRows = rawRows;
    }
  }

  const rawRows = bestSheetRawRows.length > 0
    ? bestSheetRawRows
    : XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[bestSheetName], {
        header: 1,
        defval: '',
        raw: false,
      });

  if (rawRows.length === 0) {
    return { tabName: bestSheetName, columns: ERICSSON_ORIGINAL_COLUMNS, rows: [] };
  }

  const headerRowIndex = bestSheetHeaderRow;
  const headerCells = (rawRows[headerRowIndex] || []).map((c) => normalizeHeader(c));

  // Determine last non-empty header cell
  let lastNonEmptyIdx = headerCells.length - 1;
  while (lastNonEmptyIdx >= 0 && !headerCells[lastNonEmptyIdx]) {
    lastNonEmptyIdx--;
  }

  const detectedColumns: string[] = [];
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
  }

  const columns =
    detectedColumns.length > 0 ? detectedColumns : [...ERICSSON_ORIGINAL_COLUMNS];

  // Map each column index to canonical fields
  const colRoleMap = new Map<number, string>();
  columns.forEach((colName, cIdx) => {
    const k = cleanHeaderKey(colName);
    if (!k) return;

    if (
      !k.includes('detentora') &&
      !k.includes('status') &&
      !k.includes('cidade') &&
      !k.includes('vistoria') &&
      !k.includes('tssr') &&
      !k.includes('smart') &&
      !k.includes('sdc') &&
      !k.includes('ppi') &&
      !k.includes('altura')
    ) {
      if (k.includes('site id a') || k === 'site a' || k.includes('01 21 site id a') || k === 'siteida' || k === 'id site a') {
        colRoleMap.set(cIdx, 'siteIdA');
        return;
      }
      if (k.includes('site id b') || k === 'site b' || k.includes('01 21 site id b') || k === 'siteidb' || k === 'id site b') {
        colRoleMap.set(cIdx, 'siteIdB');
        return;
      }
    }

    if (k.includes('chaves') || k === 'chave' || k.includes('01 00 chaves')) {
      colRoleMap.set(cIdx, 'chaves');
    } else if (k.includes('registro') || k === 'reg' || k.includes('n registro')) {
      colRoleMap.set(cIdx, 'registro');
    } else if (k === 'state' || k === 'uf' || k === 'estado' || k.includes('00 03 state')) {
      colRoleMap.set(cIdx, 'state');
    } else if (k === 'meta') {
      colRoleMap.set(cIdx, 'meta');
    } else if (k.includes('detentora a') || k.includes('id detentora a')) {
      colRoleMap.set(cIdx, 'idDetentoraA');
    } else if (k.includes('detentora b') || k.includes('id detentora b')) {
      colRoleMap.set(cIdx, 'idDetentoraB');
    } else if (k === 'status a' || k === 'status site a') {
      colRoleMap.set(cIdx, 'statusA');
    } else if (k === 'status b' || k === 'status site b') {
      colRoleMap.set(cIdx, 'statusB');
    } else if (k.includes('cidade a') || k.includes('municipio a')) {
      colRoleMap.set(cIdx, 'cidadeA');
    } else if (k.includes('cidade b') || k.includes('municipio b')) {
      colRoleMap.set(cIdx, 'cidadeB');
    } else if (k === 'equipe' || k.includes('equipe executante') || k === 'equipe demandada') {
      colRoleMap.set(cIdx, 'equipe');
    } else if (k.includes('servico') || k.includes('scope') || k.includes('escopo') || k.includes('02 00 scope')) {
      colRoleMap.set(cIdx, 'servico');
    } else if (k.includes('site name') || k.includes('00 04 site name') || k === 'nome site') {
      colRoleMap.set(cIdx, 'siteName');
    }
  });

  const now = new Date().toISOString();
  const parsedRows: EricssonRow[] = [];

  for (let rIdx = headerRowIndex + 1; rIdx < rawRows.length; rIdx++) {
    const row = rawRows[rIdx];
    if (!Array.isArray(row)) continue;

    const fields: Record<string, string> = {};
    let hasAnyValue = false;
    let extractedSiteIdA = '';
    let extractedSiteIdB = '';
    let extractedChaves = '';
    let extractedRegistro = '';
    let extractedState = '';
    let extractedMeta = '';
    let extractedIdDetentoraA = '';
    let extractedIdDetentoraB = '';
    let extractedStatusA = '';
    let extractedStatusB = '';
    let extractedCidadeA = '';
    let extractedCidadeB = '';
    let extractedEquipe = '';
    let extractedServico = '';
    let extractedSiteName = '';

    columns.forEach((colName, cIdx) => {
      const val = formatEricssonCellValue(row[cIdx]);
      if (val) hasAnyValue = true;
      fields[colName] = val;

      const role = colRoleMap.get(cIdx);
      if (role && val) {
        if (role === 'siteIdA' && !extractedSiteIdA) extractedSiteIdA = val.trim().toUpperCase();
        else if (role === 'siteIdB' && !extractedSiteIdB) extractedSiteIdB = val.trim().toUpperCase();
        else if (role === 'chaves' && !extractedChaves) extractedChaves = val.trim();
        else if (role === 'registro' && !extractedRegistro) extractedRegistro = val.trim();
        else if (role === 'state' && !extractedState) extractedState = val.trim();
        else if (role === 'meta' && !extractedMeta) extractedMeta = val.trim();
        else if (role === 'idDetentoraA' && !extractedIdDetentoraA) extractedIdDetentoraA = val.trim();
        else if (role === 'idDetentoraB' && !extractedIdDetentoraB) extractedIdDetentoraB = val.trim();
        else if (role === 'statusA' && !extractedStatusA) extractedStatusA = val.trim();
        else if (role === 'statusB' && !extractedStatusB) extractedStatusB = val.trim();
        else if (role === 'cidadeA' && !extractedCidadeA) extractedCidadeA = val.trim();
        else if (role === 'cidadeB' && !extractedCidadeB) extractedCidadeB = val.trim();
        else if (role === 'equipe' && !extractedEquipe) extractedEquipe = val.trim();
        else if (role === 'servico' && !extractedServico) extractedServico = val.trim();
        else if (role === 'siteName' && !extractedSiteName) extractedSiteName = val.trim();
      }
    });

    if (!hasAnyValue) continue;

    // Direct fallbacks from common column name variations in fields
    const chaves = extractedChaves || fields['01.00. Chaves'] || fields['Chaves'] || fields['CHAVES'] || '';
    const registro = extractedRegistro || fields['Registro'] || fields['REGISTRO'] || '';
    const state = extractedState || fields['00.03.State'] || fields['State'] || fields['STATE'] || fields['UF'] || fields['ESTADO'] || '';
    const meta = extractedMeta || fields['Meta'] || fields['META'] || '';
    const siteIdA = (extractedSiteIdA || fields['01.21.Site ID A'] || fields['Site ID A'] || fields['SITE ID A'] || fields['Site A'] || '').trim().toUpperCase();
    const siteIdB = (extractedSiteIdB || fields['01.21.Site ID B'] || fields['Site ID B'] || fields['SITE ID B'] || fields['Site B'] || '').trim().toUpperCase();
    const idDetentoraA = extractedIdDetentoraA || fields['ID Detentora A'] || fields['Detentora A'] || '';
    const idDetentoraB = extractedIdDetentoraB || fields['ID Detentora B'] || fields['Detentora B'] || '';
    const statusA = extractedStatusA || fields['Status A'] || fields['STATUS A'] || '';
    const statusB = extractedStatusB || fields['Status B'] || fields['STATUS B'] || '';
    const cidadeA = extractedCidadeA || fields['CIDADE A'] || fields['Cidade A'] || fields['MUNICÍPIO A'] || fields['Municipio A'] || '';
    const cidadeB = extractedCidadeB || fields['CIDADE B'] || fields['Cidade B'] || fields['MUNICÍPIO B'] || fields['Municipio B'] || '';
    const equipe = extractedEquipe || fields['EQUIPE'] || fields['Equipe'] || fields['EQUIPE EXECUTANTE'] || '';
    const servico = extractedServico || fields['Serviço'] || fields['SERVIÇO'] || fields['Servico'] || fields['02.00.Scope'] || '';

    // STRICT CHECK: Eliminate blank lines ("linhas brancas") and summary / header rows
    // A valid site row MUST have at least one valid Site ID (Site ID A or Site ID B)
    if (isBlankOrPlaceholder(siteIdA) && isBlankOrPlaceholder(siteIdB)) {
      // Both Site A and Site B are empty or invalid placeholder -> Skip completely!
      continue;
    }

    // Ensure all standard and canonical keys are populated in fields for fast table lookup
    fields['01.00. Chaves'] = chaves;
    fields['Chaves'] = chaves;
    fields['00.03.State'] = state;
    fields['State'] = state;
    fields['UF'] = state;
    fields['Meta'] = meta;
    fields['01.21.Site ID A'] = siteIdA;
    fields['Site ID A'] = siteIdA;
    fields['01.21.Site ID B'] = siteIdB;
    fields['Site ID B'] = siteIdB;
    fields['Status A'] = statusA;
    fields['Status B'] = statusB;
    fields['CIDADE A'] = cidadeA;
    fields['CIDADE B'] = cidadeB;
    fields['EQUIPE'] = equipe;
    fields['Serviço'] = servico;
    fields['ID Detentora A'] = idDetentoraA;
    fields['ID Detentora B'] = idDetentoraB;

    const siteName =
      extractedSiteName ||
      fields['00.04.Site Name'] ||
      (siteIdA && siteIdB ? `${siteIdA}-${siteIdB}` : siteIdA || siteIdB);
    fields['00.04.Site Name'] = siteName;

    const rowKey = buildEricssonRowKey(chaves, registro, siteIdA, siteIdB);

    // Build a unique, reliable ID based on Site IDs + Chaves
    const safeA = siteIdA.replace(/[^A-Z0-9_-]/g, '_');
    const safeB = siteIdB.replace(/[^A-Z0-9_-]/g, '_');
    const safeChaves = chaves.toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    const rowId = safeA && safeB
      ? `${safeA}__${safeB}`
      : safeA
      ? `${safeA}__${safeChaves || 'A'}`
      : `${safeB}__${safeChaves || 'B'}`;

    parsedRows.push({
      id: rowId,
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
    tabName: bestSheetName,
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

    const preservedEquipe = inc.equipe || matched?.equipe || '';
    const preservedResponsavel = inc.responsavelDemand || matched?.responsavelDemand || '';

    return {
      ...inc,
      id: matched ? matched.id : inc.id || `eric-row-${Date.now()}-${index}`,
      equipe: preservedEquipe,
      responsavelDemand: preservedResponsavel,
      fields: {
        ...(matched?.fields || {}),
        ...(inc.fields || {}),
        EQUIPE: preservedEquipe,
      },
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

export function isEricssonStatusFinalizado(rawStatus?: string | null): boolean {
  if (!rawStatus) return false;
  const s = rawStatus.trim().toLowerCase();
  return (
    s.includes('finaliz') ||
    s.includes('conclu') ||
    s.includes('liberad') ||
    s.includes('entregue') ||
    s.includes('executad') ||
    s.includes('pronto') ||
    s.includes('aprovad') ||
    s.includes('ok') ||
    s.includes('100%')
  );
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
    if (s.includes('conclu') || s.includes('liberad') || s.includes('finaliz')) {
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
      const stA = row.statusA || row.fields?.['Status A'] || '';
      const isFinA = row.siteAVistoriaStatus === 'Entregue' || isEricssonStatusFinalizado(stA);
      if (isFinA) {
        vistoriaEntregueSites++;
      } else if (row.siteAVistoriaStatus === 'Dispensado') {
        vistoriaDispensadoSites++;
      } else {
        vistoriaPendenteSites++;
      }
      classifySheetStatus(stA);
    }

    if (row.siteIdB && row.siteIdB.trim()) {
      totalSites++;
      const stB = row.statusB || row.fields?.['Status B'] || '';
      const isFinB = row.siteBVistoriaStatus === 'Entregue' || isEricssonStatusFinalizado(stB);
      if (isFinB) {
        vistoriaEntregueSites++;
      } else if (row.siteBVistoriaStatus === 'Dispensado') {
        vistoriaDispensadoSites++;
      } else {
        vistoriaPendenteSites++;
      }
      classifySheetStatus(stB);
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

export interface EricssonRealStatusStyle {
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  badgeClass: string;
  hex: string;
}

export function getEricssonRealStatusStyle(statusName: string): EricssonRealStatusStyle {
  const norm = String(statusName || '').trim();
  const lower = norm.toLowerCase();

  if (lower === 'finalizado' || lower.includes('finaliz')) {
    return {
      label: 'Finalizado',
      bgClass: 'bg-emerald-500',
      textClass: 'text-emerald-700',
      borderClass: 'border-emerald-200',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      hex: '#10b981',
    };
  }
  if (lower === 'em produção' || lower === 'em producao' || lower.includes('produ')) {
    return {
      label: 'Em produção',
      bgClass: 'bg-blue-500',
      textClass: 'text-blue-700',
      borderClass: 'border-blue-200',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
      hex: '#3b82f6',
    };
  }
  if (lower === 'em correção' || lower === 'em correcao' || lower.includes('corre')) {
    return {
      label: 'Em correção',
      bgClass: 'bg-amber-500',
      textClass: 'text-amber-800',
      borderClass: 'border-amber-300',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-300',
      hex: '#f59e0b',
    };
  }
  if (lower.includes('paralisad')) {
    return {
      label: 'Documentação paralisada',
      bgClass: 'bg-slate-500',
      textClass: 'text-slate-700',
      borderClass: 'border-slate-300',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
      hex: '#64748b',
    };
  }
  if (lower.includes('cancelad')) {
    return {
      label: 'Demanda cancelada',
      bgClass: 'bg-rose-500',
      textClass: 'text-rose-700',
      borderClass: 'border-rose-200',
      badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
      hex: '#ef4444',
    };
  }
  if (lower.includes('dúvida') || lower.includes('duvida')) {
    return {
      label: 'Pendente - Dúvida',
      bgClass: 'bg-purple-500',
      textClass: 'text-purple-700',
      borderClass: 'border-purple-200',
      badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
      hex: '#8b5cf6',
    };
  }
  if (lower.includes('verificação edb') || lower.includes('verificacao edb') || lower.includes('edb')) {
    return {
      label: 'Pendente Verificação EDB',
      bgClass: 'bg-indigo-500',
      textClass: 'text-indigo-700',
      borderClass: 'border-indigo-200',
      badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      hex: '#6366f1',
    };
  }
  if (lower.includes('pendente pe') || lower === 'pe') {
    return {
      label: 'Pendente PE',
      bgClass: 'bg-cyan-500',
      textClass: 'text-cyan-700',
      borderClass: 'border-cyan-200',
      badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-200',
      hex: '#06b6d4',
    };
  }
  if (lower.includes('vistoria')) {
    return {
      label: 'Pendente Vistoria',
      bgClass: 'bg-teal-500',
      textClass: 'text-teal-700',
      borderClass: 'border-teal-200',
      badgeClass: 'bg-teal-50 text-teal-700 border-teal-200',
      hex: '#14b8a6',
    };
  }
  if (lower.includes('predecessor')) {
    return {
      label: 'Aguardando Predecessor',
      bgClass: 'bg-orange-500',
      textClass: 'text-orange-700',
      borderClass: 'border-orange-200',
      badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
      hex: '#f97316',
    };
  }
  if (lower.includes('pronto') || lower.includes('envio')) {
    return {
      label: 'Pronto para envio',
      bgClass: 'bg-lime-500',
      textClass: 'text-lime-800',
      borderClass: 'border-lime-300',
      badgeClass: 'bg-lime-50 text-lime-800 border-lime-300',
      hex: '#84cc16',
    };
  }
  if (lower.includes('pendencia') || lower.includes('pendência')) {
    return {
      label: 'BoQ-Pendencia',
      bgClass: 'bg-yellow-500',
      textClass: 'text-yellow-800',
      borderClass: 'border-yellow-300',
      badgeClass: 'bg-yellow-50 text-yellow-800 border-yellow-300',
      hex: '#eab308',
    };
  }

  return {
    label: norm || 'Pendente',
    bgClass: 'bg-slate-400',
    textClass: 'text-slate-700',
    borderClass: 'border-slate-200',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    hex: '#94a3b8',
  };
}

export function normalizeEricssonRealStatus(
  rawStatus: string | undefined | null,
  docGroup?: EricssonDocGroup
): string {
  const clean = String(rawStatus || '').trim();
  if (!clean) return 'Em produção';

  if (docGroup && ERICSSON_REAL_STATUSES_BY_DOC[docGroup]) {
    const list = ERICSSON_REAL_STATUSES_BY_DOC[docGroup];
    const exact = list.find((s) => s.toLowerCase() === clean.toLowerCase());
    if (exact) return exact;

    const norm = clean.toLowerCase();
    if (norm.includes('finaliz')) return 'Finalizado';
    if (norm.includes('paralisad')) return 'Documentação paralisada';
    if (norm.includes('cancelad')) return 'Demanda cancelada';
    if (norm.includes('corre')) return 'Em correção';
    if (norm.includes('predecessor')) return 'Aguardando Predecessor';
    if (norm.includes('edb')) return 'Pendente Verificação EDB';
    if (norm.includes('pe')) return 'Pendente PE';
    if (norm.includes('vistoria')) return 'Pendente Vistoria';
    if (norm.includes('duvida') || norm.includes('dúvida')) return 'Pendente - Dúvida';
    if (norm.includes('pronto') || norm.includes('envio')) return 'Pronto para envio';
    if (norm.includes('pendencia') || norm.includes('pendência')) return 'BoQ-Pendencia';
    if (norm.includes('produ')) return 'Em produção';
  }

  return clean;
}

export function isEricssonRowReproved(
  row: EricssonEngineeringRow,
  allReprovacoes?: EricssonReprovacaoRecord[]
): boolean {
  const status = (row.status || row.fields?.['Status'] || '').trim().toLowerCase();

  // If status is Finalizado, Pronto para envio, Demanda cancelada or Em produção without reproval, it is not reproved
  if (status.includes('finaliz') || status.includes('pronto') || status === 'em produção' || status === 'em producao') {
    // Only reproved if an explicit manual reproval record exists for this specific row/site
    if (Array.isArray(row.reprovacoes) && row.reprovacoes.length > 0) return true;
    if (allReprovacoes && allReprovacoes.length > 0) {
      const rowId = row.id;
      const interv = (row.intervencaoClaro || row.siteIdA || '').trim().toLowerCase();
      return allReprovacoes.some(
        (rep) =>
          rep.rowId === rowId ||
          (interv && rep.intervencaoClaro && rep.intervencaoClaro.trim().toLowerCase() === interv)
      );
    }
    return false;
  }

  // True reproval / correction statuses from Ericsson engineering
  if (
    status === 'em correção' ||
    status === 'em correcao' ||
    status === 'boq-pendencia' ||
    status.includes('corre') ||
    status.includes('reprov') ||
    status.includes('revisar')
  ) {
    return true;
  }

  // Check explicit reprovação collections
  if (Array.isArray(row.reprovacoes) && row.reprovacoes.length > 0) {
    return true;
  }

  const mot = row.fields?.['MOTIVO REPROVAÇÃO'] || row.fields?.['REPROVAÇÃO'];
  if (mot && mot.trim() && mot.trim() !== '—' && mot.trim() !== '-' && mot.trim() !== 'N/A') {
    return true;
  }

  if (allReprovacoes && allReprovacoes.length > 0) {
    const rowId = row.id;
    const interv = (row.intervencaoClaro || row.siteIdA || '').trim().toLowerCase();
    const matches = allReprovacoes.some(
      (rep) =>
        rep.rowId === rowId ||
        (interv && rep.intervencaoClaro && rep.intervencaoClaro.trim().toLowerCase() === interv)
    );
    if (matches) return true;
  }

  return false;
}

export function computeEricssonConsolidatedStats(
  rows: EricssonEngineeringRow[]
): EricssonConsolidatedStats {
  const createDocStats = (docGroup: EricssonDocGroup): EricssonDocItemStats => {
    const statusCounts: Record<string, number> = {};
    ERICSSON_REAL_STATUSES_BY_DOC[docGroup].forEach((st) => {
      statusCounts[st] = 0;
    });

    return {
      total: 0,
      finalizado: 0,
      taxaFinalizacao: 0,
      emProducao: 0,
      pendente: 0,
      duvida: 0,
      outros: 0,
      statusCounts,
    };
  };

  const stats: EricssonConsolidatedStats = {
    totalRows: rows.length,
    wr: createDocStats('WR'),
    qrf: createDocStats('QRF'),
    ppi: createDocStats('PPI'),
    boq: createDocStats('BOQ'),
    smart: createDocStats('SMART'),
    sdc: createDocStats('SDC'),
    outrosDocs: 0,
  };

  rows.forEach((r) => {
    const rawTipo = String(r.tipoDoc || r.fields?.['Tipo doc'] || '').toUpperCase();
    const rawStatus = (r.status || r.fields?.['Status'] || '').trim();

    let matched = false;

    const recordForGroup = (docGroup: EricssonDocGroup, groupStats: EricssonDocItemStats) => {
      matched = true;
      groupStats.total++;
      const realStatus = normalizeEricssonRealStatus(rawStatus, docGroup);
      groupStats.statusCounts[realStatus] = (groupStats.statusCounts[realStatus] || 0) + 1;
      if (realStatus === 'Finalizado') {
        groupStats.finalizado++;
      } else if (realStatus === 'Em produção') {
        groupStats.emProducao = (groupStats.emProducao || 0) + 1;
      }
    };

    if (rawTipo.includes('WR')) recordForGroup('WR', stats.wr);
    if (rawTipo.includes('QRF')) recordForGroup('QRF', stats.qrf);
    if (rawTipo.includes('PPI')) recordForGroup('PPI', stats.ppi);
    if (rawTipo.includes('BOQ')) recordForGroup('BOQ', stats.boq);
    if (rawTipo.includes('SMART')) recordForGroup('SMART', stats.smart);
    if (rawTipo.includes('SDC')) recordForGroup('SDC', stats.sdc);

    if (!matched) {
      stats.outrosDocs++;
    }
  });

  // Compute Taxa de Finalização (%) for each document group
  const docGroups: (keyof Pick<EricssonConsolidatedStats, 'wr' | 'qrf' | 'ppi' | 'boq' | 'smart' | 'sdc'>)[] = [
    'wr',
    'qrf',
    'ppi',
    'boq',
    'smart',
    'sdc',
  ];

  docGroups.forEach((g) => {
    const item = stats[g];
    item.taxaFinalizacao = item.total > 0 ? Number(((item.finalizado / item.total) * 100).toFixed(1)) : 0;
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

  const rawHeaders = (rawRows[headerRowIndex] || []).map((c) => String(c || '').trim());
  const canonical = [...ERICSSON_SITE_LIST_COLUMNS];
  const canonicalNorm = canonical.map((c) => c.toLowerCase().replace(/\r?\n/g, ' ').replace(/\s+/g, ' '));
  const columns: string[] = [];

  canonical.forEach((c) => {
    const cNorm = c.toLowerCase().replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
    const found = rawHeaders.find((h) => h.toLowerCase().replace(/\r?\n/g, ' ').replace(/\s+/g, ' ') === cNorm);
    if (found) {
      columns.push(found);
    } else {
      columns.push(c);
    }
  });

  rawHeaders.forEach((h) => {
    if (!h) return;
    const hNorm = h.toLowerCase().replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
    if (!canonicalNorm.includes(hNorm) && !columns.includes(h)) {
      columns.push(h);
    }
  });

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

    const rowSeq = rIdx - headerRowIndex;
    const rowId = `eric_eng_${rowSeq}`;
    const statusVal = fields['Status'] || '';
    const tipoDocVal = fields['Tipo doc'] || '';

    parsedRows.push({
      id: rowId,
      rowKey: `${intervencao}__${tipoDocVal}__${rowSeq}`,
      rowIndex: rowSeq,
      intervencaoClaro: intervencao,
      siteIdA: siteIdA || `SITE_${rowSeq}`,
      siteIdB: siteIdB,
      statusA: statusVal || 'Pendente',
      statusB: siteIdB ? statusVal || 'Pendente' : '',
      tipoDoc: tipoDocVal,
      status: statusVal,
      regional: fields['Regional'] || '',
      tipoSite: fields['TIPO SITE'] || '',
      executor:
        fields['EXECUTOR'] ||
        fields['EXECUTOR WR'] ||
        fields['EXECUTOR QRF'] ||
        fields['EXECUTOR PPI'] ||
        fields['Executor'] ||
        '',
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
  const sorted = [...rows].sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
  const data = sorted.map((r) => {
    const obj: Record<string, string> = {};
    cols.forEach((c) => {
      obj[c] = r.fields?.[c] ?? r.fields?.[c.replace(/\r?\n/g, ' ')] ?? '';
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
  const sorted = [...rows].sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
  const headerLine = cols.map((c) => `"${c.replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`).join(';');
  const dataLines = sorted.map((r) =>
    cols
      .map((c) => {
        const val = r.fields?.[c] ?? r.fields?.[c.replace(/\r?\n/g, ' ')] ?? '';
        return `"${String(val).replace(/"/g, '""')}"`;
      })
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

function normalizeAccents(str: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function isEricssonRowAssignedToExecutor(
  row: { executor?: string; fields?: Record<string, string> },
  executorName: string
): boolean {
  if (!executorName) return false;
  const rawCandidates = [
    row.executor,
    row.fields?.['EXECUTOR'],
    row.fields?.['EXECUTOR PPI'],
    row.fields?.['EXECUTOR QRF'],
    row.fields?.['EXECUTOR WR'],
    row.fields?.['Executor'],
  ].filter(Boolean);

  if (rawCandidates.length === 0) return false;

  const targetNorm = normalizeAccents(executorName).replace(/\*+/g, '').trim();
  if (!targetNorm) return false;

  return rawCandidates.some((raw) => {
    const cleanRaw = normalizeAccents(String(raw || '')).replace(/\*+/g, '').trim();
    if (!cleanRaw) return false;
    if (cleanRaw === targetNorm) return true;

    // Check slash or ampersand splits (e.g. Fulvio / Alex or Felipe Pimentel / Tatiane Brandão)
    const slashParts = cleanRaw.split(/[\/\&]/).map((p) => p.trim());
    if (slashParts.some((p) => p === targetNorm || p.includes(targetNorm) || targetNorm.includes(p))) {
      return true;
    }

    const insideParen = targetNorm.match(/\((.*?)\)/)?.[1];
    if (insideParen && (cleanRaw.includes(insideParen) || insideParen.includes(cleanRaw))) return true;
    const mainName = targetNorm.replace(/\(.*?\)/g, '').trim();
    if (mainName && (cleanRaw === mainName || cleanRaw.startsWith(mainName + ' ') || cleanRaw.endsWith(' ' + mainName))) return true;

    const targetWords = targetNorm.split(/\s+/).filter((w) => w.length > 2);
    const candWords = cleanRaw.split(/\s+/).filter((w) => w.length > 2);
    if (targetWords.length === 1 && candWords.length >= 1) {
      if (candWords.includes(targetWords[0])) return true;
    }
    const commonWords = targetWords.filter((w) => candWords.includes(w));
    return commonWords.length >= 2 || (targetWords.length === 1 && commonWords.length === 1);
  });
}


