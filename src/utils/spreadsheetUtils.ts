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

export type SpreadsheetDestinationType =
  | 'NOKIA_SITES'
  | 'NOKIA_TSSR'
  | 'ERICSSON_SITES'
  | 'ERICSSON_ENGENHARIA'
  | 'UNKNOWN';

export function normalizeHeaderSignature(str: unknown): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectarTipoPlanilhaFromHeaders(headers: string[]): SpreadsheetDestinationType {
  const normalized = headers.map(normalizeHeaderSignature);
  const combined = normalized.join(' ');

  let tssrScore = 0;
  if (combined.includes('oc site pre') || combined.includes('ocsitepre')) tssrScore += 5;
  if (combined.includes('projeto tim') || combined.includes('projetotim')) tssrScore += 4;
  if (combined.includes('tssr status') || combined.includes('tssr status final')) tssrScore += 5;
  if (combined.includes('tssr tim nokia') || combined.includes('tssrtimnokia') || combined.includes('controle tssr')) tssrScore += 5;
  if (combined.includes('data envio tssr') || combined.includes('enviado para nokia')) tssrScore += 4;
  if (combined.includes('acumulado apos critica') || combined.includes('critica')) tssrScore += 3;
  if (combined.includes('regional nokia') || combined.includes('codigo site pre')) tssrScore += 4;
  if (tssrScore >= 5) return 'NOKIA_TSSR';

  let ericEngScore = 0;
  if (combined.includes('chave unica') || combined.includes('chave_unica')) ericEngScore += 5;
  if (combined.includes('empresa engenharia')) ericEngScore += 5;
  if (combined.includes('versao tssr') || combined.includes('situacao tssr')) ericEngScore += 5;
  if (combined.includes('project type') || combined.includes('project_type')) ericEngScore += 4;
  if (combined.includes('uf de trabalho')) ericEngScore += 4;
  if (combined.includes('estatus vistoria laudo') || combined.includes('situacao laudo') || combined.includes('situacao tss') || combined.includes('situacao projeto')) ericEngScore += 4;
  if (ericEngScore >= 5) return 'ERICSSON_ENGENHARIA';

  let ericSitesScore = 0;
  if (combined.includes('registro de vistoria sites') || combined.includes('registro vistoria sites')) ericSitesScore += 6;
  if (combined.includes('fornecedor de vistoria')) ericSitesScore += 5;
  if (combined.includes('solicitacao de vistoria')) ericSitesScore += 5;
  if (combined.includes('status da vistoria da sites') || combined.includes('status vistoria sites')) ericSitesScore += 5;
  if (combined.includes('situacao do registro sites') || combined.includes('situacao registro sites')) ericSitesScore += 5;
  if (combined.includes('01 00 chaves') || combined.includes('01 21 site id a') || combined.includes('chaves')) ericSitesScore += 3;
  if (ericSitesScore >= 5) return 'ERICSSON_SITES';

  let nokiaSitesScore = 0;
  if (combined.includes('empresa vistoriadora')) nokiaSitesScore += 5;
  if (combined.includes('status agendamento vistoria') || combined.includes('agendamento vistoria')) nokiaSitesScore += 5;
  if (combined.includes('data vistoria integrador')) nokiaSitesScore += 5;
  if (combined.includes('comentarios do acesso') || combined.includes('comentario acesso')) nokiaSitesScore += 4;
  if (combined.includes('endereco id') || combined.includes('enderecoid')) nokiaSitesScore += 3;
  if (combined.includes('site id') || combined.includes('siteid') || combined.includes('sigla')) nokiaSitesScore += 2;
  if (combined.includes('uf') && (combined.includes('municipio') || combined.includes('cidade'))) nokiaSitesScore += 2;
  if (nokiaSitesScore >= 4) return 'NOKIA_SITES';

  if (tssrScore > 0 && tssrScore >= ericEngScore && tssrScore >= ericSitesScore && tssrScore >= nokiaSitesScore) return 'NOKIA_TSSR';
  if (ericEngScore > 0 && ericEngScore >= tssrScore && ericEngScore >= ericSitesScore && ericEngScore >= nokiaSitesScore) return 'ERICSSON_ENGENHARIA';
  if (ericSitesScore > 0 && ericSitesScore >= tssrScore && ericSitesScore >= ericEngScore && ericSitesScore >= nokiaSitesScore) return 'ERICSSON_SITES';
  if (nokiaSitesScore > 0) return 'NOKIA_SITES';

  return 'UNKNOWN';
}

export function detectarTipoPlanilha(input: unknown): SpreadsheetDestinationType {
  if (!input) return 'UNKNOWN';

  if (Array.isArray(input) && input.length > 0) {
    if (typeof input[0] === 'string') {
      return detectarTipoPlanilhaFromHeaders(input as string[]);
    }
    if (typeof input[0] === 'object' && input[0] !== null) {
      if (Array.isArray(input[0])) {
        for (let i = 0; i < Math.min(10, input.length); i++) {
          const row = input[i];
          if (Array.isArray(row)) {
            const headers = row.map((cell) => String(cell || ''));
            const type = detectarTipoPlanilhaFromHeaders(headers);
            if (type !== 'UNKNOWN') return type;
          }
        }
      } else {
        const headers = Object.keys(input[0]);
        return detectarTipoPlanilhaFromHeaders(headers);
      }
    }
  }

  if (input instanceof ArrayBuffer || input instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(input))) {
    try {
      const wb = XLSX.read(input, { type: 'array', cellDates: true });
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;
        const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
        for (let i = 0; i < Math.min(10, rawRows.length); i++) {
          const row = rawRows[i];
          if (Array.isArray(row) && row.length > 0) {
            const headers = row.map((cell) => String(cell || ''));
            const type = detectarTipoPlanilhaFromHeaders(headers);
            if (type !== 'UNKNOWN') return type;
          }
        }
      }
    } catch {
      return 'UNKNOWN';
    }
  }

  return 'UNKNOWN';
}

export function getNomeTipoPlanilha(type: SpreadsheetDestinationType): string {
  switch (type) {
    case 'NOKIA_SITES':
      return 'Nokia – Sites (Vistoria)';
    case 'NOKIA_TSSR':
      return 'Nokia – Engenharia';
    case 'ERICSSON_SITES':
      return 'Ericsson – Sites';
    case 'ERICSSON_ENGENHARIA':
      return 'Ericsson – Engenharia';
    default:
      return 'Desconhecido / Outro';
  }
}

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
  const norm = normalizeKey(colHeader);
  if (norm === 'siteid' || colHeader.toUpperCase() === 'SITE ID' || colHeader === 'Coluna B') {
    return (
      site.customFields?.['SITE ID'] ||
      site.customFields?.['Site ID'] ||
      site.customFields?.['SITE_ID'] ||
      site.customFields?.['siteId'] ||
      site.siteId ||
      ''
    ).trim();
  }
  if (site.customFields && colHeader in site.customFields) {
    return site.customFields[colHeader] ?? '';
  }
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
  if (norm === 'siteid' || colHeader.toUpperCase() === 'SITE ID' || colHeader === 'Coluna B') {
    const cleanVal = newValue.trim();
    updatedCustomFields['SITE ID'] = cleanVal;
    updates.siteId = cleanVal;
    return updates;
  }
  const mappedField = HEADER_FIELD_MAP[norm];

  // Unify Equipe Executante (Duplas) and Executor with Responsible Demand assignment
  if (
    norm === 'equipeexecutante' ||
    norm === 'equipe' ||
    norm === 'equipeparceira' ||
    norm === 'executor' ||
    norm === 'talonviewexecutor' ||
    norm === 'responsavelcampo' ||
    norm === 'responsavel'
  ) {
    const cleanVal = newValue.trim();
    const isClearing =
      !cleanVal ||
      cleanVal === '—' ||
      cleanVal === '-' ||
      cleanVal.toLowerCase() === 'sem dupla' ||
      cleanVal.toLowerCase() === 'sem executor' ||
      cleanVal.toLowerCase() === 'sem equipe' ||
      cleanVal.toLowerCase() === 'a definir';

    if (isClearing) {
      updatedCustomFields['EQUIPE EXECUTANTE'] = '';
      updatedCustomFields['Executor'] = '';
      updatedCustomFields['Responsável'] = '';
      updatedCustomFields['Data de demanda'] = '';
      updatedCustomFields['Data Demanda'] = '';
      updatedCustomFields['E-MAIL DUPLA'] = '';
      updates.responsavelDemand = '';
      updates.equipeParceira = '';
      updates.responsavelCampo = '';
      updates.equipe = '';
      updates.responsaveisEmails = [];
    } else {
      const todayStr = new Date().toLocaleDateString('pt-BR');
      updatedCustomFields['EQUIPE EXECUTANTE'] = cleanVal;
      updatedCustomFields['Executor'] = cleanVal;
      updatedCustomFields['Responsável'] = cleanVal;
      if (!updatedCustomFields['Data de demanda']) {
        updatedCustomFields['Data de demanda'] = todayStr;
      }
      if (!updatedCustomFields['Data Demanda']) {
        updatedCustomFields['Data Demanda'] = todayStr;
      }
      updates.responsavelDemand = cleanVal;
      updates.equipeParceira = cleanVal;
      updates.responsavelCampo = cleanVal;
      updates.equipe = cleanVal;
    }
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

  // Coluna B ("SITE ID") takes absolute priority for Nokia sites
  const colBSiteId = (
    result.customFields?.['SITE ID'] ||
    result.customFields?.['Site ID'] ||
    (record['SITE ID'] as string) ||
    (record['Site ID'] as string) ||
    (record['Coluna B'] as string) ||
    ''
  ).trim();

  if (colBSiteId) {
    result.siteId = colBSiteId;
    if (!result.customFields) result.customFields = {};
    result.customFields['SITE ID'] = colBSiteId;
  } else if (!result.siteId) {
    const fromCustom =
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
    if (
      colIdx === 1 &&
      (!cleaned ||
        normalizeKey(cleaned) === 'siteid' ||
        normalizeKey(cleaned) === 'site' ||
        normalizeKey(cleaned) === 'colunab')
    ) {
      return 'SITE ID';
    }
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
      // Ensure Coluna B (index 1) is captured as SITE ID for Nokia sites
      if (rowSlice.length > 1 && rowSlice[1] !== undefined && rowSlice[1] !== null) {
        const valB = String(rowSlice[1]).trim();
        if (valB && (!record['SITE ID'] || headers[1]?.toUpperCase() === 'SITE ID')) {
          record['SITE ID'] = valB;
        }
      }
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
    // In positional fallback, index 1 is strictly Coluna B (SITE ID)
    if (sliced.length > 1 && sliced[1] !== undefined && sliced[1] !== null) {
      const valB = String(sliced[1]).trim();
      if (valB) record['SITE ID'] = valB;
    }
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
      // Ensure Coluna B (index 1) is captured as SITE ID for Nokia sites
      if (rowSlice.length > 1 && rowSlice[1] !== undefined && rowSlice[1] !== null) {
        const valB = String(rowSlice[1]).trim();
        if (valB && (!record['SITE ID'] || headers[1]?.toUpperCase() === 'SITE ID')) {
          record['SITE ID'] = valB;
        }
      }
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

export function matchesDuplaName(candidate: string | undefined | null, targetName: string): boolean {
  if (!candidate || !targetName) return false;
  const candTrim = String(candidate).trim();
  const targetTrim = String(targetName).trim();
  if (!candTrim || candTrim === '—' || candTrim === '-' || !targetTrim) return false;
  const candNorm = normalizeAccents(candTrim.toLowerCase());
  const targetNorm = normalizeAccents(targetTrim.toLowerCase());
  if (candNorm === targetNorm) return true;
  const candCanon = normalizeAccents((getCanonicalDuplaName(candTrim) || candTrim).toLowerCase());
  const targetCanon = normalizeAccents((getCanonicalDuplaName(targetTrim) || targetTrim).toLowerCase());
  return Boolean(candCanon && targetCanon && (candCanon === targetCanon || candCanon === targetNorm || candNorm === targetCanon));
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
  'vistoriadores / campo',
  'vistoriadores campo',
  'vistoriador / campo',
  'vistoriador campo',
  'vistoriadores',
  'vistoriador',
  'equipe vistoria',
  'coordenacao / adm',
  'coordenacao adm',
  'equipe de teste',
  'n/def',
  'ndef',
  'a definir',
  'sem dupla',
  'sem equipe',
  'sem executor',
  'cancelado',
  'nao liberado',
]);

export function isGenericNonTeamName(raw?: string | null): boolean {
  if (!raw) return true;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return true;
  const norm = normalizeAccents(trimmed.toLowerCase());
  if (!norm || GENERIC_NON_DUPLA_EQUIPES.has(norm)) return true;
  if (/^\d+$/.test(norm)) return true;
  return false;
}

/**
 * Checks if a Nokia TelecomSite was explicitly demanded in the system ("o que mandamos"),
 * ignoring raw historical spreadsheet values that were never demanded.
 */
export function isNokiaSiteActivelyDemanded(site?: TelecomSite | null): boolean {
  if (!site) return false;
  if (site.sheetName === 'Equipes' || site.sheetName === 'Controle Cancelados') return false;

  const hasDemandDate = Boolean(
    (site.customFields?.['Data de demanda'] || site.customFields?.['Data Demanda'] || '').trim()
  );
  const hasDemandEmail = Boolean(
    (site.customFields?.['E-MAIL DUPLA'] || site.customFields?.['EMAIL_DUPLA'] || '').trim() ||
      (Array.isArray(site.responsaveisEmails) && site.responsaveisEmails.length > 0)
  );
  const respDemand = (site.responsavelDemand || '').trim();
  const hasValidRespDemand = !isGenericNonTeamName(respDemand);

  if (!hasValidRespDemand && !hasDemandDate && !hasDemandEmail) {
    return false;
  }

  // Also ensure there is an actual non-empty responsible name or email on the site
  const rawResp = (
    site.responsavelDemand ||
    site.customFields?.['Executor'] ||
    site.customFields?.['EQUIPE EXECUTANTE'] ||
    site.equipeParceira ||
    site.responsavelCampo ||
    site.equipe ||
    ''
  ).trim();

  return !isGenericNonTeamName(rawResp) || hasDemandEmail;
}

/**
 * Checks if an Ericsson Mother Sheet row (EricssonRow) was explicitly demanded in the system ("o que mandamos"),
 * ignoring raw historical spreadsheet values in EQUIPE that were never demanded.
 */
export function isEricssonRowActivelyDemanded(row?: EricssonRow | null): boolean {
  if (!row) return false;
  const rAny = row as any;
  const hasDemandDate = Boolean(
    (row.fields?.['Data de demanda'] || row.fields?.['Data Demanda'] || '').trim()
  );
  const hasDemandEmail = Boolean((row.fields?.['E-MAIL DUPLA'] || '').trim());
  const respDemand = String(rAny.responsavelDemand || '').trim();
  const hasValidRespDemand = !isGenericNonTeamName(respDemand);

  if (!hasValidRespDemand && !hasDemandDate && !hasDemandEmail) {
    return false;
  }

  const rawEq = String(
    rAny.responsavelDemand ||
      row.equipe ||
      row.fields?.['EQUIPE'] ||
      row.fields?.['EQUIPE EXECUTANTE'] ||
      ''
  ).trim();

  return !isGenericNonTeamName(rawEq) || hasDemandEmail;
}

function splitEmailTokens(raw?: string | null): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
}

export function doesSiteMatchEquipe(site: TelecomSite, targetEquipe: string): boolean {
  if (!targetEquipe || targetEquipe === 'ALL') return true;

  const isDemanded = isNokiaSiteActivelyDemanded(site);
  const rawSiteEq = isDemanded
    ? (
        site.responsavelDemand ||
        getCellValueForColumn(site, 'EQUIPE EXECUTANTE') ||
        getCellValueForColumn(site, 'EQUIPE') ||
        site.equipeParceira ||
        site.equipe ||
        ''
      ).trim()
    : '';

  const canonSiteEq = getCanonicalDuplaName(rawSiteEq);
  if (targetEquipe === 'Sem Dupla') {
    return !isDemanded || !canonSiteEq;
  }

  if (!isDemanded || !rawSiteEq) return false;
  return matchesDuplaName(rawSiteEq, targetEquipe);
}

export function doesSiteMatchExecutor(site: TelecomSite, targetExecutor: string): boolean {
  if (!targetExecutor || targetExecutor === 'ALL') return true;
  if (!isNokiaSiteActivelyDemanded(site)) return false;

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

  if (!rawExec || isGenericNonTeamName(rawExec) || isGenericNonTeamName(targetExecutor)) {
    return false;
  }

  if (matchesDuplaName(rawExec, targetExecutor)) return true;

  const canonSiteExec = getCanonicalExecutorName(rawExec);
  const canonTargetExec = getCanonicalExecutorName(targetExecutor);
  if (
    canonSiteExec &&
    canonTargetExec &&
    canonSiteExec !== 'Sem Executor' &&
    canonTargetExec !== 'Sem Executor' &&
    canonSiteExec.toLowerCase() === canonTargetExec.toLowerCase()
  ) {
    return true;
  }

  const normSite = normalizeAccents(rawExec.toLowerCase());
  const normTarget = normalizeAccents(targetExecutor.toLowerCase());
  return Boolean(normSite && normTarget && normSite === normTarget);
}

export function doesSiteMatchResponsible(
  site: TelecomSite,
  userOrName:
    | { uid?: string; id?: string; name?: string; email?: string; equipe?: string; linkedTeams?: string[] }
    | string,
  linkedEmails: string[] = []
): boolean {
  if (!site || !userOrName) return false;

  if (typeof userOrName === 'string') {
    const cleanStr = userOrName.trim();
    if (!cleanStr || cleanStr === 'ALL') return true;
  }

  if (!isNokiaSiteActivelyDemanded(site)) {
    return false;
  }

  const rawSiteEq = (
    site.responsavelDemand ||
    getCellValueForColumn(site, 'Executor') ||
    getCellValueForColumn(site, 'EQUIPE EXECUTANTE') ||
    getCellValueForColumn(site, 'EQUIPE') ||
    getCellValueForColumn(site, 'Responsável') ||
    site.equipeParceira ||
    site.responsavelCampo ||
    site.equipe ||
    ''
  ).trim();

  const siteEmailTokens = new Set<string>([
    ...splitEmailTokens(site.customFields?.['E-MAIL DUPLA']),
    ...splitEmailTokens(site.customFields?.['EMAIL_DUPLA']),
    ...(Array.isArray(site.responsaveisEmails)
      ? site.responsaveisEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
      : []),
  ]);

  const responsaveisUids = Array.isArray(site.responsaveisUids)
    ? site.responsaveisUids.map((u) => String(u).trim()).filter(Boolean)
    : [];

  const emailSet = new Set(
    linkedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)
  );

  // 1. String argument (Dupla name, Executor name, or email)
  if (typeof userOrName === 'string') {
    const cleanStr = userOrName.trim();
    if (!cleanStr || cleanStr === 'ALL') return true;

    if (cleanStr.includes('@')) {
      const lower = cleanStr.toLowerCase();
      if (siteEmailTokens.has(lower) || emailSet.has(lower)) {
        return true;
      }
    }

    if (emailSet.size > 0) {
      for (const em of emailSet) {
        if (siteEmailTokens.has(em)) return true;
      }
    }

    if (doesSiteMatchEquipe(site, cleanStr)) return true;
    if (doesSiteMatchExecutor(site, cleanStr)) return true;
    return matchesDuplaName(rawSiteEq, cleanStr);
  }

  // 2. Direct UID Match
  const userUid = userOrName.uid || userOrName.id;
  if (userUid && responsaveisUids.includes(userUid)) {
    return true;
  }

  // 3. Direct Email Match
  if (userOrName.email) {
    const targetEmail = userOrName.email.trim().toLowerCase();
    if (targetEmail) {
      emailSet.add(targetEmail);
      if (siteEmailTokens.has(targetEmail)) {
        return true;
      }
    }
  }

  if (emailSet.size > 0) {
    for (const em of emailSet) {
      if (siteEmailTokens.has(em)) return true;
    }
  }

  // 4. Linked teams explicitly resolved from Duplas/Executores email maps
  const candidateTeams = new Set<string>();
  if (Array.isArray((userOrName as any).linkedTeams)) {
    (userOrName as any).linkedTeams.forEach((t: string) => {
      if (t && !isGenericNonTeamName(t)) candidateTeams.add(t.trim());
    });
  }
  if (userOrName.equipe && !isGenericNonTeamName(userOrName.equipe)) {
    candidateTeams.add(userOrName.equipe.trim());
  }

  for (const team of candidateTeams) {
    if (doesSiteMatchEquipe(site, team) || doesSiteMatchExecutor(site, team) || matchesDuplaName(rawSiteEq, team)) {
      return true;
    }
  }

  // 5. Exact User Name Match (only if not a generic placeholder)
  if (userOrName.name) {
    const cleanUserName = userOrName.name.replace(/\s*\(.*?\)\s*/g, '').trim();
    if (cleanUserName && !isGenericNonTeamName(cleanUserName)) {
      if (
        doesSiteMatchExecutor(site, cleanUserName) ||
        doesSiteMatchEquipe(site, cleanUserName) ||
        matchesDuplaName(rawSiteEq, cleanUserName)
      ) {
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
  userOrName:
    | { name: string; email?: string; equipe?: string; linkedTeams?: string[] }
    | string,
  linkedEmails: string[] = []
): boolean {
  if (!row || !userOrName) return false;

  if (typeof userOrName === 'string') {
    const cleanStr = userOrName.trim();
    if (!cleanStr || cleanStr === 'ALL') return true;
  }

  if (!isEricssonRowActivelyDemanded(row)) {
    return false;
  }

  const rAny = row as any;
  const rawCandidates = [
    rAny.responsavelDemand,
    row.equipe,
    row.fields?.['EQUIPE'],
    row.fields?.['EQUIPE EXECUTANTE'],
    row.fields?.['Equipe Executante'],
    row.fields?.['DUPLA'],
    row.fields?.['Dupla'],
    row.fields?.['Executor'],
    row.fields?.['EXECUTOR'],
    rAny.executor,
  ]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter((s) => !isGenericNonTeamName(s));

  const rowEmailTokens = new Set<string>(splitEmailTokens(row.fields?.['E-MAIL DUPLA']));
  const emailSet = new Set(
    linkedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)
  );

  if (rawCandidates.length === 0 && rowEmailTokens.size === 0) {
    return false;
  }

  if (typeof userOrName === 'string') {
    const cleanTarget = userOrName.trim();
    if (!cleanTarget || cleanTarget === 'ALL') return true;
    if (cleanTarget.includes('@')) {
      const lower = cleanTarget.toLowerCase();
      if (rowEmailTokens.has(lower) || emailSet.has(lower)) return true;
    }
    if (emailSet.size > 0) {
      for (const em of emailSet) {
        if (rowEmailTokens.has(em)) return true;
      }
    }
    return rawCandidates.some((cand) => matchesDuplaName(cand, cleanTarget));
  }

  if (userOrName.email) {
    const targetEmail = userOrName.email.trim().toLowerCase();
    if (targetEmail) {
      emailSet.add(targetEmail);
      if (rowEmailTokens.has(targetEmail)) {
        return true;
      }
    }
  }

  if (emailSet.size > 0) {
    for (const em of emailSet) {
      if (rowEmailTokens.has(em)) return true;
    }
  }

  const candidateTeams = new Set<string>();
  if (Array.isArray((userOrName as any).linkedTeams)) {
    (userOrName as any).linkedTeams.forEach((t: string) => {
      if (t && !isGenericNonTeamName(t)) candidateTeams.add(t.trim());
    });
  }
  if (userOrName.equipe && !isGenericNonTeamName(userOrName.equipe)) {
    candidateTeams.add(userOrName.equipe.trim());
  }

  for (const team of candidateTeams) {
    if (rawCandidates.some((cand) => matchesDuplaName(cand, team))) {
      return true;
    }
  }

  if (userOrName.name) {
    const cleanUserName = userOrName.name.replace(/\s*\(.*?\)\s*/g, '').trim();
    if (cleanUserName && !isGenericNonTeamName(cleanUserName)) {
      if (rawCandidates.some((cand) => matchesDuplaName(cand, cleanUserName))) {
        return true;
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

