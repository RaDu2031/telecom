import {
  AmetaUser,
  VIVO_DOC_COLUMNS,
  VendorType,
  VivoActivityRow,
  VivoHistoryEntry,
} from '../types/telecom';

export type SheetHistoryAction = 'criacao' | 'edicao' | 'demanda' | 'remocao_demanda';

export interface SheetHistoryEntry {
  campo: string;
  antes: string;
  depois: string;
  quem: string;
  quando: string;
  acao?: SheetHistoryAction;
}

export type SheetFieldKind = 'text' | 'textarea' | 'select' | 'combobox' | 'date' | 'executor';

export interface SheetFieldConfig {
  /** Property key on the normalized row object (e.g. 'siteName', 'tipoDoc', 'planejado') */
  key: string;
  /** Human-readable label shown in forms, table headers and history */
  label: string;
  /** Exact column name in the raw `fields` dictionary */
  columnName: string;
  /** Input control type */
  kind: SheetFieldKind;
  /** Whether the field is required in NovoRegistroModal */
  required?: boolean;
  /** Static allowlist of options (e.g. Tipo doc list) */
  fixedOptions?: readonly string[];
  /** Fallback options merged with dynamic options from existing rows */
  defaultOptions?: readonly string[];
  /** Pull existing distinct values from existing rows */
  useDynamicOptions?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Included in NovoRegistroModal */
  inNewForm?: boolean;
  /** Included as a shared field in EntradaRapidaModal */
  inQuickBatchShared?: boolean;
  /** Editable inline in table for ADM, Dono & Coordenadores */
  inInlineEdit?: boolean;
  /** Editable inline in table for Executor on their own rows */
  executorEditable?: boolean;
  /** Available in bulk "Alterar campo" action */
  inBulkEdit?: boolean;
}

export interface SheetEntryConfig {
  id: string;
  title: string;
  collectionName: string;
  vendor: VendorType;
  siteFieldKey: string;
  siteColumnName: string;
  typeFieldKey: string;
  typeColumnName: string;
  statusFieldKey: string;
  statusColumnName: string;
  executorFieldKey: string;
  executorColumnName: string;
  demandDateFieldKey: string;
  demandDateColumnName: string;
  commentFieldKey: string;
  commentColumnName: string;
  /** Fields compared to detect duplicate records */
  duplicateKeyFields: [string, string];
  /** Row keys auto-filled from existing rows sharing the same Site Name */
  autofillRowKeys: string[];
  /** Additional raw `fields` columns copied when auto-filling from an existing site */
  autofillExtraColumns: string[];
  /** Default status fallback when the sheet has no rows yet */
  defaultStatusFallback: string;
  /** Max number of history entries retained per row */
  maxHistoryEntries: number;
  /** Firestore write batch chunk size */
  batchSize: number;
  /** Full canonical column list to initialize `fields` */
  allColumns: string[];
  /** Field definitions */
  fields: SheetFieldConfig[];
}

export const VIVO_TIPO_DOC_OPTIONS = [
  'RF Sheet Vivo',
  'PPI Vivo',
  'PDI Vivo',
  'War Room Vivo',
  'PIRF Vivo',
  'BoQ Vivo',
] as const;

export const VIVO_DEFAULT_PRIORIDADES = [
  'P1',
  'P2',
  'P3',
  'Alta',
  'Média',
  'Baixa',
] as const;

export const VIVO_DEFAULT_STATUS_FALLBACK = 'A produzir';

export const VIVO_SHEET_ENTRY_CONFIG: SheetEntryConfig = {
  id: 'ERICSSON_VIVO',
  title: 'Atividades Vivo',
  collectionName: 'ericsson_vivo',
  vendor: 'ERICSSON_VIVO',
  siteFieldKey: 'siteName',
  siteColumnName: '00.02.Site Name',
  typeFieldKey: 'tipoDoc',
  typeColumnName: 'Tipo doc',
  statusFieldKey: 'status',
  statusColumnName: 'Status',
  executorFieldKey: 'executor',
  executorColumnName: 'EXECUTOR',
  demandDateFieldKey: 'demanda',
  demandDateColumnName: 'Demanda',
  commentFieldKey: 'comentarioStatus',
  commentColumnName: 'Comentário STATUS',
  duplicateKeyFields: ['siteName', 'tipoDoc'],
  autofillRowKeys: ['regional', 'idRegister'],
  autofillExtraColumns: [
    'ID Register',
    'Regional',
    '00.03.Site ID',
    '00.04.End ID',
    'UF',
    'Município',
    'Projeto',
    'Tecnologia',
  ],
  defaultStatusFallback: VIVO_DEFAULT_STATUS_FALLBACK,
  maxHistoryEntries: 20,
  batchSize: 250,
  allColumns: [...VIVO_DOC_COLUMNS],
  fields: [
    {
      key: 'siteName',
      label: 'Site Name',
      columnName: '00.02.Site Name',
      kind: 'text',
      required: true,
      placeholder: 'Ex.: SP_CAMPINAS_01',
      inNewForm: true,
      inQuickBatchShared: false,
      inInlineEdit: false,
      executorEditable: false,
      inBulkEdit: false,
    },
    {
      key: 'tipoDoc',
      label: 'Tipo doc',
      columnName: 'Tipo doc',
      kind: 'select',
      required: true,
      fixedOptions: VIVO_TIPO_DOC_OPTIONS,
      inNewForm: true,
      inQuickBatchShared: true,
      inInlineEdit: true,
      executorEditable: false,
      inBulkEdit: true,
    },
    {
      key: 'regional',
      label: 'Regional',
      columnName: 'Regional',
      kind: 'combobox',
      useDynamicOptions: true,
      placeholder: 'Selecione ou digite a Regional',
      inNewForm: true,
      inQuickBatchShared: false,
      inInlineEdit: true,
      executorEditable: false,
      inBulkEdit: true,
    },
    {
      key: 'prioridade',
      label: 'Prioridade',
      columnName: 'Prioridade',
      kind: 'combobox',
      useDynamicOptions: true,
      defaultOptions: VIVO_DEFAULT_PRIORIDADES,
      placeholder: 'Selecione a Prioridade',
      inNewForm: true,
      inQuickBatchShared: true,
      inInlineEdit: true,
      executorEditable: false,
      inBulkEdit: true,
    },
    {
      key: 'status',
      label: 'Status',
      columnName: 'Status',
      kind: 'select',
      useDynamicOptions: true,
      defaultOptions: [
        'A produzir',
        'Em produção',
        'Aguardando aprovação',
        'Finalizado',
        'Pendente',
        'Cancelada',
      ],
      inNewForm: false,
      inQuickBatchShared: false,
      inInlineEdit: true,
      executorEditable: true,
      inBulkEdit: true,
    },
    {
      key: 'planejado',
      label: 'Planejado',
      columnName: 'Planejado',
      kind: 'date',
      inNewForm: true,
      inQuickBatchShared: true,
      inInlineEdit: true,
      executorEditable: false,
      inBulkEdit: true,
    },
    {
      key: 'entregue',
      label: 'Entregue',
      columnName: 'Entregue',
      kind: 'date',
      inNewForm: false,
      inQuickBatchShared: false,
      inInlineEdit: true,
      executorEditable: false,
      inBulkEdit: true,
    },
    {
      key: 'replan',
      label: 'REPLAN',
      columnName: 'REPLAN',
      kind: 'date',
      inNewForm: false,
      inQuickBatchShared: false,
      inInlineEdit: true,
      executorEditable: false,
      inBulkEdit: true,
    },
    {
      key: 'dataReplan',
      label: 'DATA REPLAN',
      columnName: 'DATA REPLAN',
      kind: 'date',
      inNewForm: false,
      inQuickBatchShared: false,
      inInlineEdit: true,
      executorEditable: false,
      inBulkEdit: true,
    },
    {
      key: 'executor',
      label: 'Executor',
      columnName: 'EXECUTOR',
      kind: 'executor',
      inNewForm: true,
      inQuickBatchShared: true,
      inInlineEdit: true,
      executorEditable: false,
      inBulkEdit: true,
    },
    {
      key: 'comentarioStatus',
      label: 'Comentário STATUS',
      columnName: 'Comentário STATUS',
      kind: 'textarea',
      placeholder: 'Observações iniciais ou atualização de status...',
      inNewForm: true,
      inQuickBatchShared: false,
      inInlineEdit: true,
      executorEditable: true,
      inBulkEdit: true,
    },
  ],
};

// ============================================================================
// PURE HELPERS (GENERIC & CONFIG-DRIVEN)
// ============================================================================

export function normalizeCompareToken(val?: string | null): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function formatTodayBr(date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Converts HTML date input (YYYY-MM-DD) to Brazilian date (DD/MM/YYYY).
 * If already DD/MM/YYYY, normalizes padding and returns it.
 */
export function normalizeDateValueToBr(raw?: string | null): string {
  const clean = String(raw || '').trim();
  if (!clean) return '';
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const brMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (brMatch) {
    const dd = brMatch[1].padStart(2, '0');
    const mm = brMatch[2].padStart(2, '0');
    const yyyy = brMatch[3].length === 2 ? `20${brMatch[3]}` : brMatch[3];
    return `${dd}/${mm}/${yyyy}`;
  }
  return clean;
}

/**
 * Converts Brazilian date (DD/MM/YYYY) to HTML date input format (YYYY-MM-DD).
 */
export function brDateToIsoInput(raw?: string | null): string {
  const clean = String(raw || '').trim();
  if (!clean) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const brMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (brMatch) {
    const dd = brMatch[1].padStart(2, '0');
    const mm = brMatch[2].padStart(2, '0');
    const yyyy = brMatch[3].length === 2 ? `20${brMatch[3]}` : brMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return '';
}

/**
 * Prepends one or more history entries and caps the array to maxItems (default 20).
 */
export function appendHistoryEntries(
  existing: SheetHistoryEntry[] | undefined | null,
  additions: SheetHistoryEntry | SheetHistoryEntry[],
  maxItems = 20
): SheetHistoryEntry[] {
  const list = Array.isArray(additions) ? additions : [additions];
  const prev = Array.isArray(existing) ? existing : [];
  return [...list, ...prev].slice(0, Math.max(1, maxItems));
}

/**
 * Extracts distinct non-empty values for a field from existing rows, ordered by frequency (most used first).
 */
export function extractDynamicFieldOptions(
  rows: Record<string, any>[],
  fieldKey: string,
  columnName?: string,
  fallbackOptions: readonly string[] = []
): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of rows || []) {
    const raw = String(
      row?.[fieldKey] ?? (columnName ? row?.fields?.[columnName] : '') ?? ''
    ).trim();
    if (!raw || raw === '-' || raw === '—') continue;
    const norm = normalizeCompareToken(raw);
    const cur = counts.get(norm);
    if (cur) {
      cur.count += 1;
    } else {
      counts.set(norm, { label: raw, count: 1 });
    }
  }

  const ordered = Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
    .map((x) => x.label);

  if (ordered.length === 0 && fallbackOptions.length > 0) {
    return [...fallbackOptions];
  }

  // Append fallback options not yet present
  const seen = new Set(ordered.map((v) => normalizeCompareToken(v)));
  for (const opt of fallbackOptions) {
    const norm = normalizeCompareToken(opt);
    if (!seen.has(norm)) {
      seen.add(norm);
      ordered.push(opt);
    }
  }

  return ordered;
}

/**
 * Returns the initial Status for new records:
 * strictly the first status in the list of statuses already used in the sheet (or fallback if sheet is empty).
 */
export function getInitialStatusFromRows(
  rows: Record<string, any>[],
  config: SheetEntryConfig
): string {
  const usedStatuses = extractDynamicFieldOptions(
    rows,
    config.statusFieldKey,
    config.statusColumnName,
    []
  );
  if (usedStatuses.length > 0) {
    return usedStatuses[0];
  }
  return config.defaultStatusFallback;
}

/**
 * Resolves a user-supplied Tipo doc token against the config's fixedOptions (case/accent insensitive + common shorthands).
 * Returns canonical label or null if invalid.
 */
export function resolveTipoDocOption(
  rawInput: string,
  fixedOptions: readonly string[] = VIVO_TIPO_DOC_OPTIONS
): string | null {
  const clean = String(rawInput || '').trim();
  if (!clean) return null;
  const norm = normalizeCompareToken(clean);

  // Exact normalized match
  for (const opt of fixedOptions) {
    if (normalizeCompareToken(opt) === norm) return opt;
  }

  // Shorthand / prefix matching for Vivo types
  const aliases: Record<string, string> = {
    'rf sheet': 'RF Sheet Vivo',
    'rfsheet': 'RF Sheet Vivo',
    'rf': 'RF Sheet Vivo',
    'ppi': 'PPI Vivo',
    'pdi': 'PDI Vivo',
    'war room': 'War Room Vivo',
    'warroom': 'War Room Vivo',
    'wr': 'War Room Vivo',
    'pirf': 'PIRF Vivo',
    'boq': 'BoQ Vivo',
  };

  const aliasHit = aliases[norm];
  if (aliasHit && fixedOptions.includes(aliasHit)) {
    return aliasHit;
  }

  // Match option without "vivo" suffix
  for (const opt of fixedOptions) {
    const withoutVivo = normalizeCompareToken(opt.replace(/\bvivo\b/gi, ''));
    if (withoutVivo && withoutVivo === norm) return opt;
  }

  return null;
}

export interface SiteAutofillResult {
  matchedRow: Record<string, any> | null;
  values: Record<string, string>;
  fixedFields: Record<string, string>;
}

/**
 * Searches existing rows for the same Site Name and extracts Regional + other fixed site fields for auto-fill.
 */
export function findSiteAutofillData(
  rows: Record<string, any>[],
  siteName: string,
  config: SheetEntryConfig
): SiteAutofillResult {
  const target = normalizeCompareToken(siteName);
  if (!target) {
    return { matchedRow: null, values: {}, fixedFields: {} };
  }

  const matched =
    (rows || []).find((row) => {
      const rowSite = String(
        row?.[config.siteFieldKey] ?? row?.fields?.[config.siteColumnName] ?? ''
      );
      return normalizeCompareToken(rowSite) === target;
    }) || null;

  if (!matched) {
    return { matchedRow: null, values: {}, fixedFields: {} };
  }

  const values: Record<string, string> = {};
  for (const key of config.autofillRowKeys) {
    const fieldDef = config.fields.find((f) => f.key === key);
    const val = String(
      matched[key] ?? (fieldDef ? matched.fields?.[fieldDef.columnName] : '') ?? ''
    ).trim();
    if (val) values[key] = val;
  }

  const fixedFields: Record<string, string> = {};
  for (const col of config.autofillExtraColumns) {
    const val = String(matched.fields?.[col] ?? '').trim();
    if (val) fixedFields[col] = val;
  }
  if (matched.idRegister && !fixedFields['ID Register']) {
    fixedFields['ID Register'] = String(matched.idRegister).trim();
  }
  if (matched.regional && !fixedFields['Regional']) {
    fixedFields['Regional'] = String(matched.regional).trim();
  }

  return { matchedRow: matched, values, fixedFields };
}

/**
 * Finds an existing row matching the duplicate key fields (Site Name + Tipo doc).
 */
export function findDuplicateRecord<T extends Record<string, any>>(
  rows: T[],
  siteName: string,
  tipoDoc: string,
  config: SheetEntryConfig
): T | null {
  const targetSite = normalizeCompareToken(siteName);
  const targetType = normalizeCompareToken(tipoDoc);
  if (!targetSite || !targetType) return null;

  const [k1, k2] = config.duplicateKeyFields;
  return (
    (rows || []).find((row) => {
      const v1 = normalizeCompareToken(
        String(row?.[k1] ?? row?.fields?.[config.siteColumnName] ?? '')
      );
      const v2 = normalizeCompareToken(
        String(row?.[k2] ?? row?.fields?.[config.typeColumnName] ?? '')
      );
      return v1 === targetSite && v2 === targetType;
    }) || null
  );
}

export interface EntradaRapidaParsedLine {
  lineNumber: number;
  rawLine: string;
  siteName: string;
  tipoDoc: string;
  regionalAutofill: string;
  autofillRow: Record<string, any> | null;
  status: 'novo' | 'repetido' | 'erro';
  reason?: string;
}

export interface EntradaRapidaParseResult {
  items: EntradaRapidaParsedLine[];
  novosCount: number;
  repetidosCount: number;
  errosCount: number;
  validItems: EntradaRapidaParsedLine[];
}

/**
 * Parses textarea lines for EntradaRapidaModal.
 * Accepts one Site Name per line OR "SITE;TIPO" per line.
 * Classifies each line as 'novo', 'repetido' (already in sheet or duplicated in same paste), or 'erro'.
 */
export function parseEntradaRapidaLines(
  rawText: string,
  sharedTipoDoc: string,
  existingRows: Record<string, any>[],
  config: SheetEntryConfig
): EntradaRapidaParseResult {
  const typeField = config.fields.find((f) => f.key === config.typeFieldKey);
  const allowedTypes = typeField?.fixedOptions || VIVO_TIPO_DOC_OPTIONS;

  const existingPairs = new Set<string>();
  for (const row of existingRows || []) {
    const s = normalizeCompareToken(
      String(row?.[config.siteFieldKey] ?? row?.fields?.[config.siteColumnName] ?? '')
    );
    const t = normalizeCompareToken(
      String(row?.[config.typeFieldKey] ?? row?.fields?.[config.typeColumnName] ?? '')
    );
    if (s && t) existingPairs.add(`${s}||${t}`);
  }

  const seenInBatch = new Set<string>();
  const rawLines = String(rawText || '').split(/\r?\n/);
  const items: EntradaRapidaParsedLine[] = [];

  rawLines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    const lineNumber = index + 1;
    let rawSite = trimmed;
    let rawTipo = '';

    if (trimmed.includes(';')) {
      const parts = trimmed.split(';');
      rawSite = (parts[0] || '').trim();
      rawTipo = (parts[1] || '').trim();
    }

    if (!rawSite || rawSite.length < 2 || /^[-_.,;:/\\]+$/.test(rawSite)) {
      items.push({
        lineNumber,
        rawLine: trimmed,
        siteName: rawSite,
        tipoDoc: rawTipo || sharedTipoDoc,
        regionalAutofill: '',
        autofillRow: null,
        status: 'erro',
        reason: 'Site Name inválido ou muito curto',
      });
      return;
    }

    let resolvedTipo = '';
    if (rawTipo) {
      const matchedTipo = resolveTipoDocOption(rawTipo, allowedTypes);
      if (!matchedTipo) {
        items.push({
          lineNumber,
          rawLine: trimmed,
          siteName: rawSite,
          tipoDoc: rawTipo,
          regionalAutofill: '',
          autofillRow: null,
          status: 'erro',
          reason: `Tipo doc não reconhecido: "${rawTipo}"`,
        });
        return;
      }
      resolvedTipo = matchedTipo;
    } else {
      const matchedShared = resolveTipoDocOption(sharedTipoDoc, allowedTypes);
      if (!matchedShared) {
        items.push({
          lineNumber,
          rawLine: trimmed,
          siteName: rawSite,
          tipoDoc: '',
          regionalAutofill: '',
          autofillRow: null,
          status: 'erro',
          reason: 'Selecione um Tipo doc padrão ou informe SITE;TIPO',
        });
        return;
      }
      resolvedTipo = matchedShared;
    }

    const pairKey = `${normalizeCompareToken(rawSite)}||${normalizeCompareToken(resolvedTipo)}`;
    const autofill = findSiteAutofillData(existingRows, rawSite, config);
    const isExistingDup = existingPairs.has(pairKey);
    const isBatchDup = seenInBatch.has(pairKey);
    seenInBatch.add(pairKey);

    if (isExistingDup || isBatchDup) {
      items.push({
        lineNumber,
        rawLine: trimmed,
        siteName: rawSite,
        tipoDoc: resolvedTipo,
        regionalAutofill: autofill.values.regional || '',
        autofillRow: autofill.matchedRow,
        status: 'repetido',
        reason: isExistingDup
          ? 'Já existe na base (será criado como registro independente)'
          : 'Repetido nesta lista (será criado como registro independente)',
      });
      return;
    }

    items.push({
      lineNumber,
      rawLine: trimmed,
      siteName: rawSite,
      tipoDoc: resolvedTipo,
      regionalAutofill: autofill.values.regional || '',
      autofillRow: autofill.matchedRow,
      status: 'novo',
    });
  });

  const novosCount = items.filter((i) => i.status === 'novo').length;
  const repetidosCount = items.filter((i) => i.status === 'repetido').length;
  const errosCount = items.filter((i) => i.status === 'erro').length;
  const validItems = items.filter((i) => i.status !== 'erro');

  return {
    items,
    novosCount,
    repetidosCount,
    errosCount,
    validItems,
  };
}

/**
 * Checks whether an Executor user owns a specific Vivo row (may edit Status and Comentário STATUS).
 */
export function isExecutorOwnerOfRow(
  row: VivoActivityRow | null | undefined,
  user: AmetaUser | null | undefined
): boolean {
  if (!row || !user) return false;
  const userUid = String(user.id || '').trim();
  const userEmail = String(user.email || '').trim().toLowerCase();
  const userName = normalizeCompareToken(user.name);

  if (userUid && Array.isArray(row.responsaveisUids) && row.responsaveisUids.includes(userUid)) {
    return true;
  }

  if (userEmail) {
    if (
      Array.isArray(row.responsaveisEmails) &&
      row.responsaveisEmails.some((e) => String(e || '').trim().toLowerCase() === userEmail)
    ) {
      return true;
    }
    const emailDupla = String(row.fields?.['E-MAIL DUPLA'] || '').toLowerCase();
    if (emailDupla && emailDupla.split(/[,;\s]+/).includes(userEmail)) {
      return true;
    }
  }

  if (userName) {
    const rowExec = normalizeCompareToken(row.executor || row.fields?.['EXECUTOR']);
    const rowResp = normalizeCompareToken(row.responsavelDemand);
    if ((rowExec && rowExec === userName) || (rowResp && rowResp === userName)) {
      return true;
    }
  }

  return false;
}

/**
 * Generates a guaranteed-unique Firestore document ID for a Vivo record.
 */
export function buildUniqueVivoRecordId(index = 0): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `vivo_${ts}_${String(index).padStart(3, '0')}_${rand}`;
}

export interface NewVivoRecordInput {
  siteName: string;
  tipoDoc: string;
  regional?: string;
  prioridade?: string;
  planejado?: string;
  executorName?: string;
  executorUser?: AmetaUser | null;
  comentarioStatus?: string;
  initialStatus: string;
  autofillFixedFields?: Record<string, string>;
  idRegister?: string;
  actorName: string;
  actorEmail: string;
  rowNumberInFile?: number;
  index?: number;
  now?: Date;
}

/**
 * Builds a complete, Firestore-ready VivoActivityRow with automatic Demanda=today,
 * initial Status, creator metadata, optional Executor demand fields, and initial history entries.
 */
export function buildNewVivoActivityRow(input: NewVivoRecordInput): VivoActivityRow {
  const now = input.now || new Date();
  const nowIso = now.toISOString();
  const todayBr = formatTodayBr(now);
  const cleanSite = input.siteName.trim();
  const cleanTipo = input.tipoDoc.trim();
  const cleanRegional = (input.regional || input.autofillFixedFields?.['Regional'] || '').trim();
  const cleanPrioridade = (input.prioridade || '').trim();
  const cleanPlanejado = normalizeDateValueToBr(input.planejado);
  const cleanComentario = (input.comentarioStatus || '').trim();
  const cleanStatus = (input.initialStatus || VIVO_DEFAULT_STATUS_FALLBACK).trim();
  const cleanExecutor = (input.executorUser?.name || input.executorName || '').trim();
  const execEmail = (input.executorUser?.email || '').trim().toLowerCase();
  const execUid = (input.executorUser?.id || '').trim();
  const cleanIdRegister = (input.idRegister || input.autofillFixedFields?.['ID Register'] || '').trim();
  const actorLabel = input.actorName || input.actorEmail || 'Sistema';

  const fields: Record<string, string> = {};
  for (const col of VIVO_DOC_COLUMNS) {
    fields[col] = input.autofillFixedFields?.[col] || '';
  }

  fields['00.02.Site Name'] = cleanSite;
  fields['ID Register'] = cleanIdRegister;
  fields['Regional'] = cleanRegional;
  fields['Tipo doc'] = cleanTipo;
  fields['Status'] = cleanStatus;
  fields['Prioridade'] = cleanPrioridade;
  fields['Demanda'] = todayBr;
  fields['Planejado'] = cleanPlanejado;
  fields['EXECUTOR'] = cleanExecutor;
  fields['Comentário STATUS'] = cleanComentario;

  if (cleanExecutor) {
    fields['Data Demanda'] = todayBr;
    if (execEmail) {
      fields['E-MAIL DUPLA'] = execEmail;
    }
  }

  const history: VivoHistoryEntry[] = [
    {
      campo: 'Registro',
      antes: '',
      depois: `${cleanSite} · ${cleanTipo}`,
      quem: actorLabel,
      quando: nowIso,
      acao: 'criacao',
    },
  ];

  if (cleanExecutor) {
    history.unshift({
      campo: 'Executor',
      antes: '',
      depois: cleanExecutor,
      quem: actorLabel,
      quando: nowIso,
      acao: 'demanda',
    });
  }

  return {
    id: buildUniqueVivoRecordId(input.index || 0),
    vendor: 'ERICSSON_VIVO',
    siteName: cleanSite,
    idRegister: cleanIdRegister,
    regional: cleanRegional,
    tipoDoc: cleanTipo,
    status: cleanStatus,
    comentarioStatus: cleanComentario,
    prioridade: cleanPrioridade,
    demanda: todayBr,
    planejado: cleanPlanejado,
    replan: '',
    dataReplan: '',
    entregue: '',
    executor: cleanExecutor,
    slaDoc: '',
    entregueWeek: '',
    ofensor: '',
    faturamento: '',
    fields,
    rowNumberInFile: input.rowNumberInFile,
    createdAt: nowIso,
    createdBy: actorLabel,
    createdByEmail: input.actorEmail,
    responsavelDemand: cleanExecutor,
    responsaveisUids: execUid ? [execUid] : [],
    responsaveisEmails: execEmail ? [execEmail] : [],
    history: history.slice(0, VIVO_SHEET_ENTRY_CONFIG.maxHistoryEntries),
    updatedAt: nowIso,
    updatedBy: actorLabel,
  };
}

export interface FieldUpdatePatchResult {
  changed: boolean;
  /** Dot-notation / partial patch ready for Firestore `updateDoc` */
  patch: Record<string, any>;
  /** Human-readable before/after values */
  beforeValue: string;
  afterValue: string;
  /** Action classification for history & demand sync */
  action: SheetHistoryAction;
  /** Resulting next history array (max 20) */
  nextHistory: VivoHistoryEntry[];
}

/**
 * Builds a minimal targeted Firestore update patch for modifying ONLY ONE field on a Vivo row,
 * updating `fields.<col>`, `updatedAt`, `updatedBy`, `history` (capped at 20), and demand links if Executor changed.
 */
export function buildSingleFieldUpdatePatch(params: {
  row: VivoActivityRow;
  fieldKey: string;
  rawNewValue: string;
  actorName: string;
  config?: SheetEntryConfig;
  executorUser?: AmetaUser | null;
  now?: Date;
}): FieldUpdatePatchResult {
  const config = params.config || VIVO_SHEET_ENTRY_CONFIG;
  const fieldDef = config.fields.find((f) => f.key === params.fieldKey);
  if (!fieldDef) {
    throw new Error(`Campo desconhecido para atualização: ${params.fieldKey}`);
  }

  const nowIso = (params.now || new Date()).toISOString();
  const todayBr = formatTodayBr(params.now || new Date());
  const beforeValue = String(
    (params.row as any)[fieldDef.key] ?? params.row.fields?.[fieldDef.columnName] ?? ''
  ).trim();

  let afterValue =
    fieldDef.kind === 'date'
      ? normalizeDateValueToBr(params.rawNewValue)
      : String(params.rawNewValue || '').trim();

  if (fieldDef.key === 'executor' && params.executorUser?.name) {
    afterValue = params.executorUser.name.trim();
  }

  if (beforeValue === afterValue) {
    return {
      changed: false,
      patch: {},
      beforeValue,
      afterValue,
      action: 'edicao',
      nextHistory: params.row.history || [],
    };
  }

  let action: SheetHistoryAction = 'edicao';
  if (fieldDef.key === config.executorFieldKey) {
    action = afterValue ? 'demanda' : 'remocao_demanda';
  }

  const nextHistory = appendHistoryEntries(
    params.row.history,
    {
      campo: fieldDef.label,
      antes: beforeValue,
      depois: afterValue,
      quem: params.actorName || 'Sistema',
      quando: nowIso,
      acao: action,
    },
    config.maxHistoryEntries
  );

  // Build updated `fields` object ONLY changing the targeted column(s) to work seamlessly with
  // Firestore rules (dot-notation with dots/accents in column names like '00.02.Site Name' can break Firestore paths).
  const nextFields: Record<string, string> = {
    ...(params.row.fields || {}),
    [fieldDef.columnName]: afterValue,
  };

  const patch: Record<string, any> = {
    [fieldDef.key]: afterValue,
    fields: nextFields,
    history: nextHistory,
    updatedAt: nowIso,
    updatedBy: params.actorName || 'Sistema',
  };

  if (fieldDef.key === config.executorFieldKey) {
    if (afterValue) {
      const execEmail = (params.executorUser?.email || '').trim().toLowerCase();
      const execUid = (params.executorUser?.id || '').trim();
      patch.responsavelDemand = afterValue;
      patch.responsaveisEmails = execEmail ? [execEmail] : [];
      patch.responsaveisUids = execUid ? [execUid] : [];
      nextFields['Data Demanda'] = params.row.demanda || todayBr;
      if (execEmail) {
        nextFields['E-MAIL DUPLA'] = execEmail;
      } else {
        nextFields['E-MAIL DUPLA'] = '';
      }
    } else {
      patch.responsavelDemand = '';
      patch.responsaveisEmails = [];
      patch.responsaveisUids = [];
      nextFields['E-MAIL DUPLA'] = '';
      nextFields['Data Demanda'] = '';
    }
  }

  return {
    changed: true,
    patch,
    beforeValue,
    afterValue,
    action,
    nextHistory,
  };
}

/**
 * Filters registered users to active Executor users suitable for assignment in Vivo.
 */
export function filterEligibleExecutorUsers(users: AmetaUser[] = []): AmetaUser[] {
  const byKey = new Map<string, AmetaUser>();
  for (const u of users || []) {
    if (!u || u.desativado) continue;
    if (u.situacao === 'bloqueado' || u.situacao === 'recusado' || u.situacao === 'aguardando') {
      continue;
    }
    if (u.role !== 'Executor') continue;
    const key = (u.email || u.id || u.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, u);
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', 'pt-BR')
  );
}
