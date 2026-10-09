import * as XLSX from 'xlsx';
import {
  TelecomSite,
  VendorType,
  SiteStatus,
  CONTROLE_GERAL_COLUMNS,
  EngineeringFile,
  EngineeringFolder,
  EricssonRow,
} from '../types/telecom';

export function getExcelColumnLetter(colIdx: number): string {
  return XLSX.utils.encode_col(colIdx);
}

export function normalizeKey(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const HEADER_FIELD_MAP: Record<string, keyof TelecomSite> = {
  siteid: 'siteId',
  id: 'siteId',
  codigosite: 'siteId',
  sigla: 'siteId',
  estacao: 'siteId',
  nodeb: 'siteId',
  enodeb: 'siteId',
  gnodeb: 'siteId',

  endid: 'siteName',
  enderecoid: 'siteName',
  sitename: 'siteName',
  nome: 'siteName',
  nomedosite: 'siteName',
  nomeestacao: 'siteName',
  descricao: 'siteName',

  vendor: 'vendor',
  fabricante: 'vendor',
  fornecedor: 'vendor',
  tecnologiafabricante: 'vendor',

  uf: 'uf',
  estado: 'uf',

  municipio: 'municipio',
  cidade: 'municipio',
  localidade: 'municipio',

  reg: 'regional',
  regional: 'regional',
  regiao: 'regional',
  cluster: 'regional',

  endereco: 'endereco',
  logradouro: 'endereco',
  localizacao: 'endereco',
  comentariosdoacesso: 'endereco',

  latitude: 'latitude',
  lat: 'latitude',

  longitude: 'longitude',
  long: 'longitude',
  lon: 'longitude',
  lng: 'longitude',

  tiposite: 'tipoInfra',
  tipoinfra: 'tipoInfra',
  infra: 'tipoInfra',
  infraestrutura: 'tipoInfra',
  tipodetorre: 'tipoInfra',
  estrutura: 'tipoInfra',

  projeto: 'tecnologias',
  tecnologias: 'tecnologias',
  tecnologia: 'tecnologias',
  rat: 'tecnologias',
  sistema: 'tecnologias',
  atividade: 'tecnologias',

  swapcluster: 'bandas',
  bandas: 'bandas',
  frequencia: 'bandas',
  frequencias: 'bandas',
  banda: 'bandas',

  smp: 'gabineteBbu',
  gabinetebbu: 'gabineteBbu',
  bbu: 'gabineteBbu',
  gabinete: 'gabineteBbu',
  baseband: 'gabineteBbu',
  airscale: 'gabineteBbu',
  hardware: 'gabineteBbu',

  iddetentora: 'modulosRf',
  modulosrf: 'modulosRf',
  rru: 'modulosRf',
  radio: 'modulosRf',
  radios: 'modulosRf',
  air: 'modulosRf',
  mimo: 'modulosRf',

  prioridade: 'versaoSw',
  versaosw: 'versaoSw',
  software: 'versaoSw',
  release: 'versaoSw',
  versao: 'versaoSw',

  escopo: 'setores',
  setores: 'setores',
  setor: 'setores',
  qtdsetores: 'setores',

  azimutes: 'azimutes',
  azimute: 'azimutes',

  alturaantena: 'alturaAntena',
  altura: 'alturaAntena',

  tilteletrico: 'tiltEletrico',
  tilt: 'tiltEletrico',

  acesso: 'transporteTx',
  transportetx: 'transporteTx',
  tx: 'transporteTx',
  transporte: 'transporteTx',
  backhaul: 'transporteTx',

  spo: 'ipGerencia',
  ipgerencia: 'ipGerencia',
  ip: 'ipGerencia',
  ipom: 'ipGerencia',
  telefone: 'ipGerencia',

  sgr: 'vlanOm',
  vlanom: 'vlanOm',
  vlan: 'vlanOm',
  cpf: 'vlanOm',

  impdetentora: 'energiaRetificadora',
  energiaretificadora: 'energiaRetificadora',
  energia: 'energiaRetificadora',
  retificadora: 'energiaRetificadora',
  bateria: 'energiaRetificadora',

  status: 'status',
  situacao: 'status',
  estadooperacional: 'status',

  progressorollout: 'progressoRollout',
  progresso: 'progressoRollout',
  avanco: 'progressoRollout',

  acionamento: 'dataIntegracao',
  siplanned: 'dataIntegracao',
  dataintegracao: 'dataIntegracao',
  integracao: 'dataIntegracao',

  siexecuted: 'dataAtivacao',
  dataativacao: 'dataAtivacao',
  ativacao: 'dataAtivacao',
  dataonair: 'dataAtivacao',

  executor: 'responsavelCampo',
  talonviewexecutor: 'responsavelCampo',
  responsavelcampo: 'responsavelCampo',
  responsavel: 'responsavelCampo',
  engenheiro: 'responsavelCampo',
  tecnico: 'responsavelCampo',

  equipeexecutante: 'equipeParceira',
  equipeparceira: 'equipeParceira',
  equipe: 'equipeParceira',
  parceira: 'equipeParceira',
  empreiteira: 'equipeParceira',

  ocsitepre: 'ordemServico',
  ordemservico: 'ordemServico',
  os: 'ordemServico',
  chamado: 'ordemServico',

  statusfinanceiro: 'alarmesAtivos',
  pendenciaengenharia: 'alarmesAtivos',
  alarmesativos: 'alarmesAtivos',
  alarmes: 'alarmesAtivos',
  alarme: 'alarmesAtivos',
  pendencia: 'alarmesAtivos',

  observacoesmotivo: 'observacoes',
  observacoes: 'observacoes',
  observacao: 'observacoes',
  obs: 'observacoes',
  notas: 'observacoes',
};

function preserveOrNormalizeStatus(raw?: string): SiteStatus {
  if (!raw || !raw.trim()) return 'Vistoria - A Executar';
  const trimmed = raw.trim();
  const s = trimmed.toLowerCase();
  if (
    s.startsWith('vistoria') ||
    s.startsWith('acesso') ||
    s.includes('cancelad') ||
    s.includes('ressalva') ||
    s.includes('cadastro') ||
    s.includes('vencid') ||
    s.includes('rejeitad')
  ) {
    return trimmed;
  }
  if (s === 'ativo' || s.includes('on air') || s.includes('operac') || s === 'ok') {
    return trimmed === 'ATIVO' ? 'Ativo' : trimmed;
  }
  if (s.includes('comiss') || s.includes('integr')) {
    return 'Em Comissionamento';
  }
  if (s.includes('manut') || s.includes('prev')) {
    return 'Manutenção';
  }
  if (s.includes('crit') || s.includes('alarm') || s.includes('falha') || s.includes('down')) {
    return 'Crítico';
  }
  if (s.includes('pend') || s.includes('aguard') || s.includes('bloq')) {
    return trimmed;
  }
  return trimmed;
}

export function formatExcelCellValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const d = String(val.getUTCDate()).padStart(2, '0');
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const y = val.getUTCFullYear();
    return `${d}/${m}/${y}`;
  }
  return String(val).replace(/\r?\n/g, ' ').trim();
}

export function getCellValueForColumn(site: TelecomSite, colHeader: string): string {
  if (site.customFields && colHeader in site.customFields) {
    return site.customFields[colHeader] ?? '';
  }
  const norm = normalizeKey(colHeader);
  const mappedField = HEADER_FIELD_MAP[norm];
  if (mappedField && mappedField !== 'customFields') {
    const v = site[mappedField];
    return v !== undefined && v !== null ? String(v) : '';
  }
  return '';
}

export function syncSiteColumnUpdate(
  site: TelecomSite,
  colHeader: string,
  newValue: string
): Partial<TelecomSite> {
  const updatedCustomFields: Record<string, string> = {
    ...(site.customFields || {}),
    [colHeader]: newValue,
  };
  const updates: Partial<TelecomSite> = {
    customFields: updatedCustomFields,
  };

  const norm = normalizeKey(colHeader);
  const mappedField = HEADER_FIELD_MAP[norm];

  // Unify Equipe Executante (Duplas) with Responsible Demand assignment
  if (norm === 'equipeexecutante' || norm === 'equipe' || norm === 'equipeparceira') {
    updatedCustomFields['EQUIPE EXECUTANTE'] = newValue;
    updatedCustomFields['Executor'] = newValue;
    updates.equipeParceira = newValue;
    updates.responsavelCampo = newValue;
    return updates;
  }

  if (mappedField && mappedField !== 'customFields' && mappedField !== 'vendor') {
    if (mappedField === 'progressoRollout') {
      const num = parseInt(newValue.replace(/[^0-9]/g, ''), 10);
      updates.progressoRollout = isNaN(num) ? site.progressoRollout : Math.min(100, Math.max(0, num));
    } else if (mappedField === 'status') {
      updates.status = newValue;
      const lower = newValue.toLowerCase();
      if (lower.includes('finalizada') || lower === 'ativo') {
        updates.progressoRollout = 100;
      } else if (lower.includes('cancelad')) {
        updates.progressoRollout = 0;
      }
    } else {
      (updates as Record<string, unknown>)[mappedField] = newValue;
    }
  }
  return updates;
}

export function mapRecordToSite(
  record: Record<string, unknown>,
  defaultVendor: VendorType,
  defaultSheetName: string,
  index: number
): Partial<TelecomSite> {
  const result: Partial<TelecomSite> = {
    vendor: defaultVendor,
    sheetName: defaultSheetName,
    customFields: {},
  };

  for (const [rawHeader, rawVal] of Object.entries(record)) {
    const cleanHeader = rawHeader.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    const val = formatExcelCellValue(rawVal);
    if (!cleanHeader) continue;

    // Always store exact column in customFields so Column A -> Observação table view has 100% of columns
    result.customFields = {
      ...(result.customFields || {}),
      [cleanHeader]: val,
    };

    const normKey = normalizeKey(cleanHeader);
    const mappedField = HEADER_FIELD_MAP[normKey];

    if (mappedField && val !== '') {
      if (mappedField === 'vendor') {
        const vUpper = val.toUpperCase();
        if (vUpper.includes('ERIC')) result.vendor = 'ERICSSON';
        else if (vUpper.includes('NOK')) result.vendor = 'NOKIA';
      } else if (mappedField === 'status') {
        result.status = preserveOrNormalizeStatus(val);
      } else if (mappedField === 'progressoRollout') {
        const num = parseInt(val.replace(/[^0-9]/g, ''), 10);
        result.progressoRollout = isNaN(num) ? 75 : Math.min(100, Math.max(0, num));
      } else {
        (result as Record<string, unknown>)[mappedField] = val;
      }
    }
  }

  if (!result.siteId) {
    const fromCustom =
      result.customFields?.['SITE ID'] ||
      result.customFields?.['END ID'] ||
      result.customFields?.['EQUIPE'];
    if (fromCustom) {
      result.siteId = fromCustom;
    } else {
      const prefix = (result.vendor || defaultVendor) === 'NOKIA' ? 'NK' : 'ER';
      const ufPart = (result.uf || 'SP').toUpperCase().slice(0, 2);
      result.siteId = `${prefix}-${ufPart}-${String(100 + index + 1)}`;
    }
  }

  if (!result.siteName) {
    result.siteName =
      result.customFields?.['END ID'] ||
      result.customFields?.['NOME'] ||
      result.siteId ||
      `SITE_${index + 1}`;
  }

  if (!result.status) {
    result.status =
      defaultSheetName.toLowerCase().includes('cancelad')
        ? 'Site Cancelado'
        : 'Vistoria - Finalizada';
  }

  const stLower = String(result.status).toLowerCase();
  if (result.progressoRollout === undefined) {
    result.progressoRollout =
      stLower.includes('finalizada') || stLower === 'ativo'
        ? 100
        : stLower.includes('cancelad')
        ? 0
        : 65;
  }

  return result;
}

/**
 * Finds the header row and slices columns from Column A (index 0) up to the "Observação" column (inclusive)
 * if an Observação column exists on that row.
 */
export function detectHeaderAndSliceUpToObservacao(rows: unknown[][]): {
  headerRowIdx: number;
  maxColIdx: number;
  headers: string[];
} {
  let headerRowIdx = 0;
  let obsColIdx = -1;

  for (let r = 0; r < Math.min(8, rows.length); r++) {
    const row = rows[r] || [];
    const foundObsIdx = row.findIndex((cell) => {
      const norm = normalizeKey(String(cell ?? ''));
      return norm.includes('observac') || norm === 'obs';
    });
    if (foundObsIdx !== -1) {
      headerRowIdx = r;
      obsColIdx = foundObsIdx;
      break;
    }
  }

  // If no explicit "Observação" column was found, look for the row with "SITE ID" or most known headers
  if (obsColIdx === -1) {
    let bestScore = -1;
    for (let r = 0; r < Math.min(6, rows.length); r++) {
      const row = rows[r] || [];
      let score = 0;
      row.forEach((cell) => {
        const norm = normalizeKey(String(cell ?? ''));
        if (norm && HEADER_FIELD_MAP[norm]) score++;
      });
      if (score > bestScore) {
        bestScore = score;
        headerRowIdx = r;
      }
    }
    const headerRow = rows[headerRowIdx] || [];
    let lastNonEmpty = headerRow.length - 1;
    while (lastNonEmpty > 0 && !String(headerRow[lastNonEmpty] ?? '').trim()) {
      lastNonEmpty--;
    }
    obsColIdx = Math.max(0, lastNonEmpty);
  }

  const rawHeaders = (rows[headerRowIdx] || []).slice(0, obsColIdx + 1);
  const headers = rawHeaders.map((h, colIdx) => {
    const cleaned = String(h ?? '')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || `Coluna ${getExcelColumnLetter(colIdx)}`;
  });

  return {
    headerRowIdx,
    maxColIdx: obsColIdx,
    headers,
  };
}

export function parseClipboardOrCsvText(
  rawText: string,
  defaultVendor: VendorType,
  defaultSheetName: string
): { sites: Partial<TelecomSite>[]; detectedColumns: string[] } {
  const lines = rawText
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { sites: [], detectedColumns: [] };
  }

  // Detect delimiter: Tab (\t) from Excel Ctrl+C has priority, then ';', then ','
  const sampleLine = lines[Math.min(1, lines.length - 1)] || lines[0];
  let delimiter = '\t';
  if (sampleLine.includes('\t') || lines[0].includes('\t')) {
    delimiter = '\t';
  } else if (sampleLine.split(';').length > sampleLine.split(',').length) {
    delimiter = ';';
  } else if (sampleLine.includes(',')) {
    delimiter = ',';
  }

  const splitLine = (line: string): string[] =>
    line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ''));

  const matrix = lines.map(splitLine);

  // Check if any of the first 4 rows has headers (including when Row 1 is Excel SUBTOTAL counts)
  let hasHeaderRow = false;
  for (let r = 0; r < Math.min(4, matrix.length); r++) {
    const rowCells = matrix[r];
    const matches = rowCells.filter((c) => HEADER_FIELD_MAP[normalizeKey(c)]).length;
    const hasObsOrSite = rowCells.some((c) => {
      const k = normalizeKey(c);
      return k.includes('observac') || k === 'siteid' || k === 'ocsitepre' || k === 'endid';
    });
    if (matches >= 2 || hasObsOrSite) {
      hasHeaderRow = true;
      break;
    }
  }

  if (hasHeaderRow && matrix.length >= 2) {
    const { headerRowIdx, maxColIdx, headers } = detectHeaderAndSliceUpToObservacao(matrix);
    const sites: Partial<TelecomSite>[] = [];

    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
      const rowSlice = matrix[r].slice(0, maxColIdx + 1);
      if (rowSlice.every((c) => !String(c ?? '').trim())) continue;
      const record: Record<string, unknown> = {};
      headers.forEach((h, colIdx) => {
        record[h] = rowSlice[colIdx] ?? '';
      });
      sites.push(mapRecordToSite(record, defaultVendor, defaultSheetName, sites.length));
    }

    return { sites, detectedColumns: headers };
  }

  // Positional fallback using CONTROLE_GERAL_COLUMNS (Coluna A até Observações/Motivo)
  const positionalHeaders = CONTROLE_GERAL_COLUMNS;
  const sites: Partial<TelecomSite>[] = [];
  let maxColsFound = 0;

  matrix.forEach((cells, rowIdx) => {
    const sliced = cells.slice(0, positionalHeaders.length);
    if (sliced.every((c) => !c)) return;
    maxColsFound = Math.max(maxColsFound, sliced.length);
    const record: Record<string, unknown> = {};
    sliced.forEach((cellVal, colIdx) => {
      const headerName = positionalHeaders[colIdx] || `Coluna ${getExcelColumnLetter(colIdx)}`;
      record[headerName] = cellVal;
    });
    sites.push(mapRecordToSite(record, defaultVendor, defaultSheetName, rowIdx));
  });

  return {
    sites,
    detectedColumns: positionalHeaders.slice(0, Math.max(1, maxColsFound)),
  };
}

export function parseExcelWorkbookBuffer(
  buffer: ArrayBuffer,
  defaultVendor: VendorType
): {
  sheetNames: string[];
  sheetsData: Record<string, Partial<TelecomSite>[]>;
  sheetsColumns: Record<string, string[]>;
} {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  const sheetsData: Record<string, Partial<TelecomSite>[]> = {};
  const sheetsColumns: Record<string, string[]> = {};

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: '',
      raw: true,
    });
    if (rows.length < 2) continue;

    const { headerRowIdx, maxColIdx, headers } = detectHeaderAndSliceUpToObservacao(rows);
    const parsedRows: Partial<TelecomSite>[] = [];

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const rowSlice = (rows[r] || []).slice(0, maxColIdx + 1).map(formatExcelCellValue);
      if (rowSlice.every((c) => c === '')) continue;

      const record: Record<string, unknown> = {};
      headers.forEach((h, colIdx) => {
        record[h] = rowSlice[colIdx] ?? '';
      });
      parsedRows.push(mapRecordToSite(record, defaultVendor, sheetName, parsedRows.length));
    }

    if (parsedRows.length > 0) {
      sheetsData[sheetName] = parsedRows;
      sheetsColumns[sheetName] = headers;
    }
  }

  return {
    sheetNames: Object.keys(sheetsData),
    sheetsData,
    sheetsColumns,
  };
}

export async function parseExcelWorkbookFile(
  file: File,
  defaultVendor: VendorType
): Promise<{
  sheetNames: string[];
  sheetsData: Record<string, Partial<TelecomSite>[]>;
  sheetsColumns: Record<string, string[]>;
}> {
  const buffer = await file.arrayBuffer();
  return parseExcelWorkbookBuffer(buffer, defaultVendor);
}

export function buildExportRows(
  sites: TelecomSite[],
  orderedColumns?: string[]
): Record<string, string | number>[] {
  if (orderedColumns && orderedColumns.length > 0) {
    return sites.map((s) => {
      const row: Record<string, string | number> = {};
      orderedColumns.forEach((col) => {
        row[col] = getCellValueForColumn(s, col);
      });
      return row;
    });
  }

  // Fallback if no orderedColumns provided: check if sites have Controle Geral columns in customFields
  const firstWithCustom = sites.find(
    (s) => s.customFields && Object.keys(s.customFields).length >= 5
  );
  if (firstWithCustom && firstWithCustom.customFields) {
    const cols = Object.keys(firstWithCustom.customFields);
    return sites.map((s) => {
      const row: Record<string, string | number> = {};
      cols.forEach((col) => {
        row[col] = getCellValueForColumn(s, col);
      });
      return row;
    });
  }

  return sites.map((s) => ({
    'Oc Site Pre': s.ordemServico,
    'SITE ID': s.siteId,
    'END ID': s.siteName,
    SMP: s.gabineteBbu,
    'ID. DETENTORA': s.modulosRf,
    'REG.': s.regional,
    UF: s.uf,
    MUNICÍPIO: s.municipio,
    PROJETO: s.tecnologias,
    Prioridade: s.versaoSw,
    STATUS: s.status,
    ACIONAMENTO: s.dataIntegracao,
    'EQUIPE EXECUTANTE': s.equipeParceira,
    'SI Executed': s.dataAtivacao,
    Executor: s.responsavelCampo,
    'Tipo Site': s.tipoInfra,
    'IMP Detentora': s.energiaRetificadora,
    Acesso: s.transporteTx,
    SPO: s.ipGerencia,
    SGR: s.vlanOm,
    'Status Financeiro': s.alarmesAtivos,
    'Observações/Motivo': s.observacoes,
  }));
}

export function exportSitesToCsv(
  sites: TelecomSite[],
  filename: string,
  orderedColumns?: string[],
  delimiter: ';' | ',' = ';'
): void {
  const rows = buildExportRows(sites, orderedColumns);
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const escapeCell = (val: string | number) => {
    const str = String(val ?? '').replace(/"/g, '""');
    if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
      return `"${str}"`;
    }
    return str;
  };

  const csvLines = [
    headers.map(escapeCell).join(delimiter),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h] ?? '')).join(delimiter)),
  ];

  const csvContent = '\uFEFF' + csvLines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportSitesToXlsx(
  sites: TelecomSite[],
  filename: string,
  sheetName = 'Controle Geral',
  orderedColumns?: string[]
): void {
  const rows = buildExportRows(sites, orderedColumns);
  if (rows.length === 0) return;

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export const STATUS_FINANCEIRO_OPTIONS: string[] = [
  'NF Emitida postada Edicom',
  'NF Pronta p/ Envio EdIcom',
  'Emitir NF',
  'Aguardando SPO',
  'Aguardando SGR',
  'Liberado p/ Faturamento',
  'Faturado / Pago',
  'Em Análise Financeira',
  'Pendente NF / Abono',
];

export function normalizeAccents(str: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function getUserMatchKeywords(userOrName: { name: string } | string): string[] {
  const rawName = typeof userOrName === 'string' ? userOrName : userOrName.name;
  const n = normalizeAccents(rawName);
  if (!n) return [];

  const tokens = n.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const first = tokens[0];
  const keywords = new Set<string>([first]);

  if (first === 'usuario' && tokens.length > 1) {
    // e.g. "Usuário Teste" -> match "teste" and "usuario teste" rather than generic "usuario"
    keywords.delete('usuario');
    keywords.add(tokens.slice(1).join(' '));
    tokens.slice(1).forEach((tk) => keywords.add(tk));
  }

  // Add known distinctive surnames / aliases used in EQUIPE EXECUTANTE and Executor columns
  const distinctiveAliases = [
    'teste',
    'oglio',
    'malta',
    'luchini',
    'ribas',
    'nassu',
    'washington',
    'frederico',
    'viana',
    'vitorino',
    'andrade',
    'ruis',
    'francelino',
  ];

  tokens.forEach((tk) => {
    if (distinctiveAliases.includes(tk)) {
      keywords.add(tk);
    }
  });

  if (first === 'mateus') {
    keywords.add('metus');
  }
  if (first === 'jose' && tokens.includes('malta')) {
    // Match "Malta" rather than generic "jose"
    keywords.delete('jose');
    keywords.add('malta');
  }
  if (first === 'marcelo' && tokens.includes('oglio')) {
    keywords.add('oglio');
  }
  if (first === 'eduardo' && tokens.includes('luchini')) {
    keywords.add('luchini');
  }

  return Array.from(keywords);
}

export function getCanonicalDuplaName(rawEquipe: string): string {
  const trimmed = String(rawEquipe || '').trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return '';

  const norm = normalizeAccents(trimmed);
  if (
    !norm ||
    norm === 'cancelado' ||
    norm === 'nao liberado' ||
    norm === 'a definir' ||
    norm === 'sem dupla'
  ) {
    return '';
  }

  // Unify all spreadsheet variations of the same Dupla / Equipe Executante
  if ((norm.includes('magno') && norm.includes('gilvan')) || norm === 'gilvan/magno') {
    return 'Magno / Gilvan';
  }
  if (norm.includes('magno') && norm.includes('luchini')) {
    return 'Magno / Luchini';
  }
  if (norm.includes('magno') && (norm.includes('mateus') || norm.includes('metus'))) {
    return 'Magno / Mateus';
  }
  if (norm.includes('magno') && norm.includes('alexandre')) {
    return 'Magno / Alexandre da Silva';
  }
  if ((norm.includes('mateus') || norm.includes('metus')) && norm.includes('oglio')) {
    return 'Mateus / Oglio';
  }
  if ((norm.includes('mateus') || norm.includes('metus')) && norm.includes('luis')) {
    return 'Mateus / Luís Fernando';
  }
  if (norm.includes('malta') && norm.includes('luis')) {
    return 'Malta / Luís';
  }
  if (norm.includes('diego') && norm.includes('vagner')) {
    return 'Diego / Vagner';
  }
  if (norm.includes('bruno') && norm.includes('kleber')) {
    return 'Bruno / Kleber';
  }
  if (norm.includes('felipe') && norm.includes('renato')) {
    return 'Felipe / Renato';
  }
  if (norm.includes('alexandre') && norm.includes('/')) {
    return 'Alexandre / Alexandre';
  }
  if (norm.includes('reinaldo') && norm.includes('erick')) {
    return 'Reinaldo / Erick';
  }
  if (norm === 'mateus' || norm === 'metus') {
    return 'Mateus';
  }
  if (norm === 'magno') {
    return 'Magno';
  }
  if (norm.includes('usuario teste') || norm === 'teste') {
    return 'Usuário Teste';
  }

  // Normalize custom slash/hyphen separated duplas (e.g. "Carlos/Eduardo" -> "Carlos / Eduardo")
  if (trimmed.includes('/') || trimmed.includes('-')) {
    const parts = trimmed
      .split(/\s*[\/\-]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return parts.join(' / ');
    }
  }

  return trimmed;
}

export function getCanonicalExecutorName(rawExecutor: string): string {
  const trimmed = String(rawExecutor || '').trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return 'Sem Executor';

  const norm = normalizeAccents(trimmed);
  if (!norm) return 'Sem Executor';

  if (norm.includes('magno')) return 'Magno';
  if (norm.includes('mateus') || norm.includes('metus')) return 'Mateus';
  if (norm.includes('rafael') && (norm.includes('araujo') || norm.includes('araujio'))) {
    return 'Rafael Araujo';
  }
  if (norm.includes('ana paula')) return 'Ana Paula';
  if (norm.includes('luchini')) return 'Luchini';

  return trimmed;
}

export function doesSiteMatchEquipe(site: TelecomSite, targetEquipe: string): boolean {
  if (!targetEquipe || targetEquipe === 'ALL') return true;

  const rawSiteEq = (
    getCellValueForColumn(site, 'EQUIPE EXECUTANTE') ||
    getCellValueForColumn(site, 'EQUIPE') ||
    site.equipeParceira ||
    ''
  ).trim();

  const canonSiteEq = getCanonicalDuplaName(rawSiteEq);
  if (targetEquipe === 'Sem Dupla') {
    return !canonSiteEq;
  }

  const canonTarget = getCanonicalDuplaName(targetEquipe);
  if (canonTarget && canonSiteEq) {
    if (normalizeAccents(canonSiteEq) === normalizeAccents(canonTarget)) return true;
  }

  const normRawSite = normalizeAccents(rawSiteEq);
  const normRawTarget = normalizeAccents(targetEquipe);
  if (normRawSite && normRawTarget && normRawSite === normRawTarget) {
    return true;
  }

  return false;
}

export function doesSiteMatchExecutor(site: TelecomSite, targetExecutor: string): boolean {
  if (!targetExecutor || targetExecutor === 'ALL') return true;
  const rawExec = (
    site.responsavelDemand ||
    getCellValueForColumn(site, 'Executor') ||
    getCellValueForColumn(site, 'TalonView Executor') ||
    site.responsavelCampo ||
    site.equipeParceira ||
    site.equipe ||
    (site.customFields && site.customFields['EQUIPE EXECUTANTE']) ||
    ''
  ).trim();

  const canonSiteExec = getCanonicalExecutorName(rawExec);
  const canonTargetExec = getCanonicalExecutorName(targetExecutor);
  if (canonSiteExec.toLowerCase() === canonTargetExec.toLowerCase()) return true;

  const normSite = normalizeAccents(rawExec.toLowerCase());
  const normTarget = normalizeAccents(targetExecutor.toLowerCase());
  if (normSite === normTarget) return true;
  if (normSite && normTarget && (normSite.includes(normTarget) || normTarget.includes(normSite))) {
    return true;
  }
  return false;
}

export const DEFAULT_EQUIPES_DUPLAS: string[] = [];

const GENERIC_NON_DUPLA_EQUIPES = new Set([
  'ametaservicos',
  'ameta servicos',
  'ametaservicos.com.br',
  'ametatelecom',
  'ameta telecom',
  'ameta',
  'campo / engenharia',
  'campo engenharia',
  'campo / execucao',
  'campo execucao',
  'coordenacao / adm',
  'coordenacao adm',
  'equipe de teste',
]);

export function doesSiteMatchResponsible(
  site: TelecomSite,
  userOrName: { uid?: string; id?: string; name?: string; email?: string; equipe?: string } | string,
  linkedEmails: string[] = []
): boolean {
  if (!site) return false;

  const rawSiteEq = (
    site.responsavelDemand ||
    site.responsavelCampo ||
    site.equipeParceira ||
    site.equipe ||
    getCellValueForColumn(site, 'EQUIPE EXECUTANTE') ||
    getCellValueForColumn(site, 'EQUIPE') ||
    getCellValueForColumn(site, 'Executor') ||
    getCellValueForColumn(site, 'Responsável') ||
    ''
  ).trim();
  const siteNorm = normalizeAccents(rawSiteEq.toLowerCase());
  const canonSiteEq = getCanonicalDuplaName(rawSiteEq) || getCanonicalExecutorName(rawSiteEq);

  const emailDuplaVal = (
    (site.customFields &&
      (site.customFields['E-MAIL DUPLA'] ||
        site.customFields['EMAIL_DUPLA'])) ||
    ''
  ).trim().toLowerCase();

  const responsaveisEmails = Array.isArray(site.responsaveisEmails)
    ? site.responsaveisEmails.map((e) => String(e).trim().toLowerCase())
    : [];
  const responsaveisUids = Array.isArray(site.responsaveisUids)
    ? site.responsaveisUids.map((u) => String(u).trim())
    : [];

  const emailSet = new Set(
    linkedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)
  );

  // 1. If userOrName is a string (e.g. Dupla name, Executor name or filter value)
  if (typeof userOrName === 'string') {
    const cleanStr = userOrName.trim();
    if (!cleanStr || cleanStr === 'ALL') return true;

    if (cleanStr.includes('@')) {
      const lower = cleanStr.toLowerCase();
      if (emailDuplaVal.includes(lower) || responsaveisEmails.includes(lower) || emailSet.has(lower)) {
        return true;
      }
    }

    if (doesSiteMatchEquipe(site, cleanStr)) return true;
    if (doesSiteMatchExecutor(site, cleanStr)) return true;

    const normTarget = normalizeAccents(cleanStr.toLowerCase());
    if (siteNorm && normTarget && siteNorm === normTarget) return true;

    const canonTarget = getCanonicalDuplaName(cleanStr) || getCanonicalExecutorName(cleanStr);
    if (canonSiteEq && canonTarget && canonSiteEq.toLowerCase() === canonTarget.toLowerCase()) {
      return true;
    }

    // Check linked emails
    if (emailSet.size > 0) {
      for (const em of emailSet) {
        if (emailDuplaVal.includes(em) || responsaveisEmails.includes(em)) return true;
      }
    }

    // Exact word boundary match
    if (siteNorm && normTarget) {
      const siteWords = siteNorm.split(/[\s/\\-]+/).filter(Boolean);
      const targetWords = normTarget.split(/[\s/\\-]+/).filter(Boolean);
      if (siteWords.includes(normTarget) || targetWords.includes(siteNorm)) {
        return true;
      }
    }

    return false;
  }

  // 2. Direct UID Match
  const userUid = userOrName.uid || userOrName.id;
  if (userUid && responsaveisUids.includes(userUid)) {
    return true;
  }

  // 3. Direct Email Match (in customFields['E-MAIL DUPLA'], site.responsaveisEmails or linkedEmails)
  if (userOrName.email) {
    const targetEmail = userOrName.email.trim().toLowerCase();
    if (targetEmail) {
      emailSet.add(targetEmail);
      if (emailDuplaVal.includes(targetEmail) || responsaveisEmails.includes(targetEmail)) {
        return true;
      }
    }
  }

  if (emailSet.size > 0) {
    for (const em of emailSet) {
      if (emailDuplaVal.includes(em) || responsaveisEmails.includes(em)) return true;
    }
  }

  // 4. Direct Dupla / Equipe Match on user profile object
  if (userOrName.equipe) {
    const normUserEq = normalizeAccents(userOrName.equipe.toLowerCase());
    if (normUserEq && !GENERIC_NON_DUPLA_EQUIPES.has(normUserEq)) {
      if (doesSiteMatchEquipe(site, userOrName.equipe)) return true;
      if (siteNorm && siteNorm === normUserEq) return true;
      const cUserEq = getCanonicalDuplaName(userOrName.equipe);
      if (canonSiteEq && cUserEq && canonSiteEq.toLowerCase() === cUserEq.toLowerCase()) return true;
      const siteWords = siteNorm.split(/[\s/\\-]+/).filter(Boolean);
      if (siteWords.includes(normUserEq)) return true;
    }
  }

  // 5. User Name Match (as executor or part of dupla)
  if (userOrName.name) {
    const cleanUserName = userOrName.name.replace(/\s*\(.*?\)\s*/g, '').trim();
    if (cleanUserName) {
      if (doesSiteMatchExecutor(site, cleanUserName)) return true;
      if (doesSiteMatchEquipe(site, cleanUserName)) return true;

      const normUser = normalizeAccents(cleanUserName.toLowerCase());
      if (normUser && siteNorm && siteNorm === normUser) return true;

      const cUserName = getCanonicalExecutorName(cleanUserName);
      if (canonSiteEq && cUserName && canonSiteEq.toLowerCase() === cUserName.toLowerCase()) return true;

      if (normUser && siteNorm) {
        const siteWords = siteNorm.split(/[\s/\\-]+/).filter(Boolean);
        const nameWords = normUser.split(/[\s/\\-]+/).filter(Boolean);
        if (siteWords.includes(normUser) || nameWords.includes(siteNorm)) {
          return true;
        }
      }
    }
  }

  // 6. Direct responsavelDemand or customFields['Executor'] check against name or equipe
  const siteDemandResp = (
    site.responsavelDemand ||
    (site.customFields && site.customFields['Executor']) ||
    (site.customFields && site.customFields['EQUIPE EXECUTANTE']) ||
    ''
  ).trim();
  if (siteDemandResp) {
    const normResp = normalizeAccents(siteDemandResp.toLowerCase());
    if (userOrName.name) {
      const normName = normalizeAccents(userOrName.name.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase());
      if (normName && (normResp === normName || normResp.includes(normName) || normName.includes(normResp))) {
        return true;
      }
    }
    if (userOrName.equipe) {
      const normEq = normalizeAccents(userOrName.equipe.toLowerCase());
      if (normEq && (normResp === normEq || normResp.includes(normEq) || normEq.includes(normResp))) {
        return true;
      }
    }
  }

  return false;
}

export function doesDocumentMatchResponsible(
  file: EngineeringFile,
  folder: EngineeringFolder | undefined,
  userOrName: { name: string; email?: string } | string
): boolean {
  const keywords = getUserMatchKeywords(userOrName);
  const targetEmail =
    typeof userOrName === 'object' && userOrName.email
      ? userOrName.email.trim().toLowerCase()
      : '';

  // Check explicit assignment on the file or its parent folder
  const assignedRaw = [file.assignedTo || '', folder?.assignedTo || ''].join(' ').trim();
  const normAssigned = normalizeAccents(assignedRaw);

  if (normAssigned) {
    if (targetEmail && assignedRaw.toLowerCase().includes(targetEmail)) {
      return true;
    }
    const assignedTokens = normAssigned.split(/[^a-z0-9]+/).filter(Boolean);
    if (keywords.some((kw) => assignedTokens.includes(kw) || normAssigned.includes(kw))) {
      return true;
    }
  }

  // Also match if the non-ADM user themselves uploaded the file (by email or name)
  const targetName =
    typeof userOrName === 'object' && userOrName.name
      ? userOrName.name.trim().toLowerCase()
      : typeof userOrName === 'string'
      ? userOrName.trim().toLowerCase()
      : '';

  if (targetEmail && file.uploadedByEmail?.trim().toLowerCase() === targetEmail) {
    return true;
  }
  if (targetName && file.uploadedByName?.trim().toLowerCase() === targetName) {
    return true;
  }

  return false;
}

export function doesEricssonRowMatchResponsible(
  row: EricssonRow,
  userOrName: { name: string; email?: string; equipe?: string } | string
): boolean {
  if (!row) return false;
  const rAny = row as any;
  const rawCandidates = [
    row.equipe,
    row.fields?.['EQUIPE'],
    rAny.responsavelDemand,
    rAny.responsavelCampo,
    row.fields?.['Executor'],
    row.fields?.['EXECUTOR'],
    row.fields?.['Responsável'],
    row.fields?.['EQUIPE EXECUTANTE'],
    rAny.executor,
  ]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter(
      (s) =>
        s.length > 0 &&
        s !== '—' &&
        s !== '-' &&
        s.toLowerCase() !== 'a definir' &&
        s.toLowerCase() !== 'sem executor' &&
        s.toLowerCase() !== 'sem dupla' &&
        s.toLowerCase() !== 'sem equipe'
    );

  const emailDuplaVal = (row.fields?.['E-MAIL DUPLA'] || '').trim().toLowerCase();

  if (rawCandidates.length === 0 && !emailDuplaVal) {
    return false;
  }

  if (typeof userOrName === 'string') {
    const cleanTarget = getCanonicalDuplaName(userOrName) || userOrName.trim();
    const normTarget = normalizeAccents(cleanTarget);
    if (!normTarget) return false;
    return rawCandidates.some((cand) => {
      const canonRowEq = getCanonicalDuplaName(cand) || cand;
      const normRowEq = normalizeAccents(canonRowEq);
      return (
        normRowEq === normTarget ||
        normRowEq.includes(normTarget) ||
        normTarget.includes(normRowEq)
      );
    });
  }

  if (userOrName.email) {
    const targetEmail = userOrName.email.trim().toLowerCase();
    if (targetEmail && emailDuplaVal && emailDuplaVal.includes(targetEmail)) {
      return true;
    }
    if (
      targetEmail &&
      (row.siteAVistoriaUploadedByEmail?.trim().toLowerCase() === targetEmail ||
        row.siteBVistoriaUploadedByEmail?.trim().toLowerCase() === targetEmail ||
        row.losUploadedByEmail?.trim().toLowerCase() === targetEmail)
    ) {
      return true;
    }
  }

  for (const cand of rawCandidates) {
    const canonRowEq = getCanonicalDuplaName(cand) || cand;
    const normRowEq = normalizeAccents(canonRowEq);
    if (!normRowEq) continue;

    if (userOrName.equipe) {
      const cleanUserEq = getCanonicalDuplaName(userOrName.equipe) || userOrName.equipe.trim();
      const normUserEq = normalizeAccents(cleanUserEq);
      if (normUserEq && !GENERIC_NON_DUPLA_EQUIPES.has(normUserEq)) {
        if (
          normRowEq === normUserEq ||
          normRowEq.includes(normUserEq) ||
          normUserEq.includes(normRowEq)
        ) {
          return true;
        }
      }
    }

    if (userOrName.name) {
      const cleanUserName = userOrName.name.replace(/\s*\(.*?\)\s*/g, '').trim();
      const normUserName = normalizeAccents(cleanUserName);
      if (normUserName) {
        if (
          normRowEq === normUserName ||
          normRowEq.includes(normUserName) ||
          normUserName.includes(normRowEq)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

export function doesFileMatchUserResponsibleSites(
  file: EngineeringFile,
  userOrName: { name: string; email?: string; equipe?: string } | string,
  nokiaSites: TelecomSite[] = [],
  ericssonRows: EricssonRow[] = []
): boolean {
  const cleanFileSite = (file.siteId || '').trim().toUpperCase();
  const cleanFileOc = (file.ocSitePre || '').trim().toUpperCase();
  const cleanFileName = (file.fileName || '').trim().toUpperCase();

  if (file.vendor === 'ERICSSON') {
    const responsibleRows = ericssonRows.filter((r) =>
      doesEricssonRowMatchResponsible(r, userOrName)
    );
    if (responsibleRows.length === 0) return false;

    const rowIds = new Set<string>();
    const linkedFileIds = new Set<string>();
    const siteTokens = new Set<string>();

    responsibleRows.forEach((r) => {
      rowIds.add(r.id);
      if (r.siteAVistoriaFileId) linkedFileIds.add(r.siteAVistoriaFileId);
      if (r.siteBVistoriaFileId) linkedFileIds.add(r.siteBVistoriaFileId);
      if (r.losFileId) linkedFileIds.add(r.losFileId);

      [r.siteIdA, r.siteIdB, r.chaves, r.siteName].forEach((val) => {
        const clean = (val || '').trim().toUpperCase();
        if (clean) siteTokens.add(clean);
      });
    });

    if (linkedFileIds.has(file.id)) return true;
    if (file.tssrRowId && rowIds.has(file.tssrRowId)) return true;
    if (cleanFileOc && siteTokens.has(cleanFileOc)) return true;

    if (cleanFileSite) {
      if (siteTokens.has(cleanFileSite)) return true;
      const parts = cleanFileSite.split(/[\s[\]()↔/,-]+/).filter(Boolean);
      if (parts.some((p) => siteTokens.has(p))) return true;
      for (const tok of siteTokens) {
        if (tok.length >= 4 && cleanFileSite.includes(tok)) return true;
      }
    }

    for (const tok of siteTokens) {
      if (tok.length >= 4 && cleanFileName.includes(tok)) return true;
    }

    return false;
  }

  // TIM / Nokia: Match against sites the user is responsible for doing
  const responsibleSites = nokiaSites.filter(
    (s) =>
      s.vendor === 'NOKIA' &&
      s.sheetName !== 'Equipes' &&
      s.sheetName !== 'Controle Cancelados' &&
      doesSiteMatchResponsible(s, userOrName)
  );
  if (responsibleSites.length === 0) return false;

  const siteTokens = new Set<string>();
  responsibleSites.forEach((s) => {
    const sid = (s.siteId || '').trim().toUpperCase();
    if (sid) siteTokens.add(sid);
    const sname = (s.siteName || '').trim().toUpperCase();
    if (sname && sname.length >= 4) siteTokens.add(sname);
    const endId = String(s.customFields?.['END ID'] || '').trim().toUpperCase();
    if (endId && endId.length >= 4) siteTokens.add(endId);
    const oc = String(s.customFields?.['Oc Site Pre'] || s.ordemServico || '')
      .trim()
      .toUpperCase();
    if (oc && oc.length >= 4) siteTokens.add(oc);
  });

  if (cleanFileOc && siteTokens.has(cleanFileOc)) return true;

  if (cleanFileSite) {
    if (siteTokens.has(cleanFileSite)) return true;
    const parts = cleanFileSite.split(/[\s[\]()↔/,-]+/).filter(Boolean);
    if (parts.some((p) => siteTokens.has(p))) return true;
    for (const tok of siteTokens) {
      if (tok.length >= 4 && cleanFileSite.includes(tok)) return true;
    }
  }

  for (const tok of siteTokens) {
    if (tok.length >= 4 && cleanFileName.includes(tok)) return true;
  }

  return false;
}

export function getShortResponsibleLabel(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 2) return fullName.trim();
  const nLower = normalizeAccents(fullName);
  if (nLower.includes('oglio')) return 'Marcelo Oglio';
  if (nLower.includes('malta')) return 'José Malta';
  if (nLower.includes('luchini')) return 'Eduardo Luchini';
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

