import {
  EricssonEngineeringRow,
  EricssonRow,
  SiteStatus,
  TelecomSite,
  TssrRow,
  VivoActivityRow,
} from '../types/telecom';

export type AcionamentoTarget =
  | 'NOKIA_SITES'
  | 'CLARO_SITES'
  | 'NOKIA_ENGENHARIA'
  | 'ERICSSON_SITES'
  | 'ERICSSON_ENGENHARIA'
  | 'ERICSSON_VIVO';

export interface QuickAcionamentoDraft {
  siteId: string;
  siteIdB?: string;
  siteName?: string; // END ID / ID Register / Intervenção Claro
  uf?: string;
  municipio?: string;
  municipioB?: string;
  regional?: string;
  tipoDoc?: string;
  projeto?: string;
  status?: string;
  executor?: string;
  equipe?: string;
  dataAcionamento?: string; // ISO YYYY-MM-DD or BR dd/mm/aaaa
  planejado?: string; // ISO YYYY-MM-DD or BR dd/mm/aaaa
  prioridade?: string;
  ocSitePre?: string;
  chaves?: string;
  idDetentora?: string;
  idDetentoraB?: string;
  tipoSite?: string;
  servico?: string;
  observacoes?: string;
}

export interface ParsedBatchItem {
  rawLine: string;
  siteId: string;
  siteIdB: string;
  col2: string;
  col3: string;
  col4: string;
  col5: string;
}

export interface AcionamentoTargetConfig {
  target: AcionamentoTarget;
  title: string;
  destinationBadge: string;
  accentColor: string;
  siteLabel: string;
  sitePlaceholder: string;
  hasSiteB: boolean;
  hasTipoDoc: boolean;
  tipoDocOptions: string[];
  defaultTipoDoc: string;
  statusOptions: string[];
  defaultStatus: string;
  batchHint: string;
  batchPlaceholder: string;
}

export const ACIONAMENTO_TARGET_CONFIGS: Record<AcionamentoTarget, AcionamentoTargetConfig> = {
  NOKIA_SITES: {
    target: 'NOKIA_SITES',
    title: 'Novo Acionamento — Nokia TIM (Sites)',
    destinationBadge: 'Destino: Nokia · TIM — Sites (Controle Geral)',
    accentColor: '#223585',
    siteLabel: 'SITE ID',
    sitePlaceholder: 'Ex: SN-OI65J2',
    hasSiteB: false,
    hasTipoDoc: false,
    tipoDocOptions: [],
    defaultTipoDoc: '',
    statusOptions: [
      'Vistoria - A Executar',
      'Vistoria - Em Andamento',
      'Acesso - Solicitado p/ Nokia',
      'Vistoria - Sem Acesso',
      'Vistoria - Sem Chave',
      'Vistoria - Finalizada',
    ],
    defaultStatus: 'Vistoria - A Executar',
    batchHint: 'Cole 1 SITE ID por linha, ou colunas do Excel: SITE ID ; UF ; MUNICÍPIO ; EQUIPE',
    batchPlaceholder: 'SN-OI65J2\nSN-SP1044; SP; São Paulo; Magno/Luchini\nSN-RJ2088; RJ; Rio de Janeiro; Gilvan',
  },
  CLARO_SITES: {
    target: 'CLARO_SITES',
    title: 'Novo Acionamento — Nokia Claro (Sites)',
    destinationBadge: 'Destino: Nokia · Claro — Sites (Controle Geral)',
    accentColor: '#DC2626',
    siteLabel: 'SITE ID',
    sitePlaceholder: 'Ex: CL-SP0199',
    hasSiteB: false,
    hasTipoDoc: false,
    tipoDocOptions: [],
    defaultTipoDoc: '',
    statusOptions: [
      'Vistoria - A Executar',
      'Vistoria - Em Andamento',
      'Acesso - Solicitado p/ Nokia',
      'Vistoria - Sem Acesso',
      'Vistoria - Sem Chave',
      'Vistoria - Finalizada',
    ],
    defaultStatus: 'Vistoria - A Executar',
    batchHint: 'Cole 1 SITE ID por linha, ou colunas do Excel: SITE ID ; UF ; MUNICÍPIO ; EQUIPE',
    batchPlaceholder: 'CL-SP0199\nCL-RJ0210; RJ; Niterói; Equipe Claro 1',
  },
  NOKIA_ENGENHARIA: {
    target: 'NOKIA_ENGENHARIA',
    title: 'Novo Acionamento — Nokia Engenharia (TSSR)',
    destinationBadge: 'Destino: Nokia · TIM — Engenharia (TSSR)',
    accentColor: '#223585',
    siteLabel: 'Site Id (Sigla)',
    sitePlaceholder: 'Ex: SN-OI65J2',
    hasSiteB: false,
    hasTipoDoc: false,
    tipoDocOptions: [],
    defaultTipoDoc: '',
    statusOptions: [
      'A produzir',
      'Em produção',
      'Pendente',
      'Aguardando Vistoria',
      'Finalizado',
    ],
    defaultStatus: 'A produzir',
    batchHint: 'Cole 1 Site Id por linha, ou colunas: Site Id ; UF ; Cidade ; Executor',
    batchPlaceholder: 'SN-OI65J2\nSN-DF1601; DF; Brasília; Rafael',
  },
  ERICSSON_SITES: {
    target: 'ERICSSON_SITES',
    title: 'Novo Acionamento — Ericsson Claro (Sites)',
    destinationBadge: 'Destino: Ericsson · Claro — Sites (Vistoria)',
    accentColor: '#1E8E8D',
    siteLabel: 'Site ID A',
    sitePlaceholder: 'Ex: ESCIT33',
    hasSiteB: true,
    hasTipoDoc: false,
    tipoDocOptions: [],
    defaultTipoDoc: '',
    statusOptions: [
      'Em andamento',
      'Pendente',
      'Acesso Solicitado',
      'Liberado',
      'Concluído',
    ],
    defaultStatus: 'Em andamento',
    batchHint: 'Cole 1 Site A por linha, ou colunas: Site A ; Site B ; UF ; Cidade A ; Equipe',
    batchPlaceholder: 'ESCIT33; ESCIT81; SP; São Paulo; Equipe 6\nRJMAD12; ; RJ; Rio de Janeiro; Equipe 2',
  },
  ERICSSON_ENGENHARIA: {
    target: 'ERICSSON_ENGENHARIA',
    title: 'Novo Acionamento — Ericsson Claro (Engenharia)',
    destinationBadge: 'Destino: Ericsson · Claro — Engenharia',
    accentColor: '#1E8E8D',
    siteLabel: 'Intervenção Claro / Site A',
    sitePlaceholder: 'Ex: SMPINB6_5A',
    hasSiteB: true,
    hasTipoDoc: true,
    tipoDocOptions: [
      'WR',
      'QRF',
      'PPI',
      'PPI/SDC',
      'BOQ',
      'SMART',
      'SmartPlan - Revision',
      'SDC',
      'REVISÃO WR',
      'REVISÃO QRF',
      'REVISÃO PPI',
    ],
    defaultTipoDoc: 'WR',
    statusOptions: [
      'Em produção',
      'Pendente',
      'Pendente - Dúvida',
      'Documentação paralisada',
      'Finalizado',
      'Demanda cancelada',
    ],
    defaultStatus: 'Em produção',
    batchHint: 'Cole 1 Intervenção/Site por linha, ou: Site/Intervenção ; Tipo doc ; Regional ; Executor',
    batchPlaceholder: 'SMPINB6_5A\nSISML02_5A; WR; SPM; Rafael Souza\nRJBAR14_5A; PPI; RJ; Carlos',
  },
  ERICSSON_VIVO: {
    target: 'ERICSSON_VIVO',
    title: 'Novo Acionamento — Ericsson Vivo',
    destinationBadge: 'Destino: Ericsson · Vivo — Atividades & Documentação',
    accentColor: '#660099',
    siteLabel: 'Site Name',
    sitePlaceholder: 'Ex: SP_JARDINS_01',
    hasSiteB: false,
    hasTipoDoc: true,
    tipoDocOptions: [
      'RF Sheet Vivo',
      'PPI Vivo',
      'PDI Vivo',
      'War Room Vivo',
      'PIRF Vivo',
      'BoQ Vivo',
    ],
    defaultTipoDoc: 'RF Sheet Vivo',
    statusOptions: [
      'A produzir',
      'Em produção',
      'WR - Aguardando Aprovação',
      'Pendente',
      'Finalizado',
      'Demanda cancelada',
    ],
    defaultStatus: 'A produzir',
    batchHint: 'Cole 1 Site Name por linha, ou: Site Name ; Tipo doc ; Regional ; Executor',
    batchPlaceholder: 'SP_JARDINS_01\nMG_BHZ_042; PPI Vivo; MG; Rafael\nRJ_BARRA_11; War Room Vivo; RJ; Ana',
  },
};

/** Returns today's date in ISO format YYYY-MM-DD (local timezone). */
export function getTodayIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Converts YYYY-MM-DD or dd/mm/aaaa into clean dd/mm/aaaa. */
export function normalizeDateToBr(value?: string, fallbackNow: Date = new Date()): string {
  const clean = (value || '').trim();
  if (!clean) {
    const d = String(fallbackNow.getDate()).padStart(2, '0');
    const m = String(fallbackNow.getMonth() + 1).padStart(2, '0');
    const y = fallbackNow.getFullYear();
    return `${d}/${m}/${y}`;
  }
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  return clean;
}

/** Computes ISO week number (1..53) from a Date or YYYY-MM-DD string. */
export function computeIsoWeekNumber(input?: string | Date): number {
  let d: Date;
  if (input instanceof Date) {
    d = new Date(Date.UTC(input.getFullYear(), input.getMonth(), input.getDate()));
  } else if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    const [y, m, day] = input.trim().split('-').map(Number);
    d = new Date(Date.UTC(y, m - 1, day));
  } else {
    const now = new Date();
    d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Parses multi-line quick batch input (1 site per line or Excel/CSV/TSV columns).
 * Ignores blank lines, preserves duplicate codes as independent acionamentos.
 */
export function parseQuickBatchLines(rawText: string): ParsedBatchItem[] {
  const lines = (rawText || '').split(/\r?\n/);
  const items: ParsedBatchItem[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Detect delimiter: tab first (Excel paste), then semicolon, then pipe, then comma
    let parts: string[];
    if (trimmed.includes('\t')) {
      parts = trimmed.split('\t').map((p) => p.trim());
    } else if (trimmed.includes(';')) {
      parts = trimmed.split(';').map((p) => p.trim());
    } else if (trimmed.includes('|')) {
      parts = trimmed.split('|').map((p) => p.trim());
    } else if (trimmed.includes(',')) {
      parts = trimmed.split(',').map((p) => p.trim());
    } else {
      parts = [trimmed];
    }

    const first = (parts[0] || '').trim();
    if (!first) continue;

    // Skip obvious pasted header rows
    const firstLower = first.toLowerCase();
    if (
      parts.length > 1 &&
      (firstLower === 'site id' ||
        firstLower === 'site name' ||
        firstLower === '00.02.site name' ||
        firstLower === '01.21.site id a' ||
        firstLower === 'intervencao claro')
    ) {
      continue;
    }

    items.push({
      rawLine: trimmed,
      siteId: first.toUpperCase(),
      siteIdB: (parts[1] || '').trim().toUpperCase(),
      col2: (parts[1] || '').trim(),
      col3: (parts[2] || '').trim(),
      col4: (parts[3] || '').trim(),
      col5: (parts[4] || '').trim(),
    });
  }

  return items;
}

function makeUniqueId(prefix: string, index: number = 0): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now()}_${index}_${rand}`;
}

export function buildNokiaOrClaroSiteRecord(
  draft: QuickAcionamentoDraft,
  vendor: 'NOKIA' | 'CLARO_TIM',
  updatedBy: string,
  index: number = 0
): TelecomSite {
  const cleanSiteId = (draft.siteId || '').trim().toUpperCase();
  if (!cleanSiteId) {
    throw new Error('Informe o SITE ID para adicionar o acionamento.');
  }

  const nowIso = new Date().toISOString();
  const dataAcionamento = normalizeDateToBr(draft.dataAcionamento);
  const uf = (draft.uf || '').trim().toUpperCase();
  const municipio = (draft.municipio || '').trim();
  const regional = (draft.regional || '').trim().toUpperCase();
  const status = (draft.status || 'Vistoria - A Executar').trim() as SiteStatus;
  const equipe = (draft.equipe || '').trim();
  const executor = (draft.executor || '').trim();
  const projeto = (draft.projeto || '').trim();
  const ocSitePre = (draft.ocSitePre || '').trim();
  const endId = (draft.siteName || '').trim();
  const idDetentora = (draft.idDetentora || '').trim();
  const prioridade = (draft.prioridade || '').trim();
  const observacoes = (draft.observacoes || '').trim();

  const statusLower = status.toLowerCase();
  const progressoRollout =
    statusLower.includes('finalizada') || statusLower.includes('ativo') || statusLower.includes('conclu')
      ? 100
      : statusLower.includes('andamento')
      ? 50
      : 10;

  return {
    id: makeUniqueId(vendor === 'CLARO_TIM' ? 'claro_site' : 'nokia_site', index),
    siteId: cleanSiteId,
    vendor,
    sheetName: 'Controle Geral',
    siteName: endId || cleanSiteId,
    uf,
    municipio,
    regional,
    endereco: municipio && uf ? `${municipio} - ${uf}` : municipio || uf,
    latitude: '',
    longitude: '',
    tipoInfra: (draft.tipoSite || '').trim(),
    tecnologias: projeto,
    bandas: '',
    gabineteBbu: '',
    modulosRf: idDetentora,
    versaoSw: prioridade,
    setores: '',
    azimutes: '',
    alturaAntena: '',
    tiltEletrico: '',
    transporteTx: '',
    ipGerencia: '',
    vlanOm: '',
    energiaRetificadora: vendor === 'CLARO_TIM' ? 'CLARO' : 'TIM',
    status,
    progressoRollout,
    dataIntegracao: dataAcionamento,
    dataAtivacao: '',
    responsavelCampo: executor,
    equipe: equipe || undefined,
    equipeParceira: equipe,
    ordemServico: ocSitePre,
    alarmesAtivos: '',
    observacoes,
    isNew: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    updatedBy: updatedBy || 'usuario@ametaservicos.com.br',
    customFields: {
      'Oc Site Pre': ocSitePre,
      'SITE ID': cleanSiteId,
      'END ID': endId,
      'ID. DETENTORA': idDetentora,
      'REG.': regional,
      UF: uf,
      MUNICÍPIO: municipio,
      PROJETO: projeto,
      Prioridade: prioridade,
      STATUS: status,
      ACIONAMENTO: dataAcionamento,
      'EQUIPE EXECUTANTE': equipe,
      Executor: executor,
      'Tipo Site': (draft.tipoSite || '').trim(),
      'Observações/Motivo': observacoes,
    },
  };
}

export function buildNokiaTssrRecord(
  draft: QuickAcionamentoDraft,
  tabName: string,
  index: number = 0
): TssrRow {
  const cleanSiteId = (draft.siteId || '').trim().toUpperCase();
  if (!cleanSiteId) {
    throw new Error('Informe o Site Id para adicionar o acionamento.');
  }

  const nowIso = new Date().toISOString();
  const dataAcionamento = normalizeDateToBr(draft.dataAcionamento);
  const uf = (draft.uf || '').trim().toUpperCase();
  const cidade = (draft.municipio || '').trim();
  const reg = (draft.regional || '').trim().toUpperCase();
  const projeto = (draft.projeto || '').trim();
  const status = (draft.status || 'A produzir').trim();
  const executor = (draft.executor || '').trim();
  const ocSitePre = (draft.ocSitePre || '').trim();
  const enderecoId = (draft.siteName || '').trim();
  const observacoes = (draft.observacoes || '').trim();

  return {
    id: makeUniqueId('TSSR', index),
    rowKey: `${cleanSiteId}__${tabName || 'TSSR TIM Nokia'}__${Date.now()}_${index}`,
    vendor: 'NOKIA',
    tabName: tabName || 'TSSR TIM Nokia',
    siteId: cleanSiteId,
    ocSitePre,
    enderecoId,
    executor: executor || undefined,
    vistoriaStatus: 'Pendente',
    fields: {
      'Oc Site Pre': ocSitePre,
      Enderecoid: enderecoId,
      'Site Id': cleanSiteId,
      Reg: reg,
      UF: uf,
      Cidade: cidade,
      PROJETO: projeto,
      ACIONAMENTO: dataAcionamento,
      'STATUS Engenharia': status,
      Executor: executor,
      Observações: observacoes,
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function buildEricssonSiteRecord(
  draft: QuickAcionamentoDraft,
  index: number = 0
): EricssonRow {
  const siteIdA = (draft.siteId || '').trim().toUpperCase();
  const siteIdB = (draft.siteIdB || '').trim().toUpperCase();
  if (!siteIdA && !siteIdB) {
    throw new Error('Informe ao menos o Site ID A ou o Site ID B.');
  }

  const nowIso = new Date().toISOString();
  const dataAcionamento = normalizeDateToBr(draft.dataAcionamento);
  const chaves = (draft.chaves || '').trim();
  const state = (draft.uf || draft.regional || '').trim().toUpperCase();
  const meta = (draft.status || 'Em andamento').trim();
  const cidadeA = (draft.municipio || '').trim();
  const cidadeB = (draft.municipioB || '').trim();
  const equipe = (draft.equipe || draft.executor || '').trim();
  const servico = (draft.servico || draft.projeto || '').trim();
  const detentoraA = (draft.idDetentora || '').trim();
  const detentoraB = (draft.idDetentoraB || '').trim();
  const observacoes = (draft.observacoes || '').trim();

  return {
    id: makeUniqueId('eric', index),
    rowKey: `${chaves}_${siteIdA}_${siteIdB}_${Date.now()}_${index}`,
    registro: '',
    siteName: siteIdB ? `${siteIdA} / ${siteIdB}` : siteIdA || siteIdB,
    chaves,
    state,
    meta,
    siteIdA,
    idDetentoraA: detentoraA,
    statusA: meta,
    cidadeA,
    siteIdB,
    idDetentoraB: detentoraB,
    statusB: siteIdB ? meta : '',
    cidadeB,
    equipe,
    servico,
    siteAVistoriaStatus: 'Pendente',
    siteBVistoriaStatus: 'Pendente',
    updatedAt: nowIso,
    fields: {
      '01.00. Chaves': chaves,
      '00.03.State': state,
      Meta: meta,
      '01.21.Site ID A': siteIdA,
      'ID Detentora A': detentoraA,
      'Status A': meta,
      'CIDADE A': cidadeA,
      '01.21.Site ID B': siteIdB,
      'ID Detentora B': detentoraB,
      'Status B': siteIdB ? meta : '',
      'CIDADE B': cidadeB,
      EQUIPE: equipe,
      Serviço: servico,
      Acionamento: dataAcionamento,
      Observação: observacoes,
    },
  };
}

export function buildEricssonEngenhariaRecord(
  draft: QuickAcionamentoDraft,
  index: number = 0
): EricssonEngineeringRow {
  const cleanIntervencao = (draft.siteId || '').trim().toUpperCase();
  const siteIdB = (draft.siteIdB || '').trim().toUpperCase();
  if (!cleanIntervencao) {
    throw new Error('Informe a Intervenção Claro ou Site ID A.');
  }

  const nowIso = new Date().toISOString();
  const dataAcionamento = normalizeDateToBr(draft.dataAcionamento);
  const planejado = draft.planejado ? normalizeDateToBr(draft.planejado) : '';
  const tipoDoc = (draft.tipoDoc || 'WR').trim();
  const status = (draft.status || 'Em produção').trim();
  const regional = (draft.regional || draft.uf || '').trim().toUpperCase();
  const tipoSite = (draft.tipoSite || '').trim();
  const executor = (draft.executor || '').trim();
  const siteIdA = (draft.siteName || cleanIntervencao).trim().toUpperCase();
  const observacoes = (draft.observacoes || '').trim();

  return {
    id: makeUniqueId('eric_eng', index),
    rowKey: `${cleanIntervencao}_${tipoDoc}_${Date.now()}_${index}`,
    intervencaoClaro: cleanIntervencao,
    siteIdA,
    siteIdB,
    statusA: status,
    statusB: siteIdB ? status : '',
    tipoDoc,
    status,
    regional,
    tipoSite,
    executor,
    updatedAt: nowIso,
    fields: {
      'Intervencao Claro': cleanIntervencao,
      'Tipo doc': tipoDoc,
      Status: status,
      Regional: regional,
      'TIPO SITE': tipoSite,
      EXECUTOR: executor,
      Demanda: dataAcionamento,
      Planejado: planejado,
      'Comentário STATUS': observacoes,
    },
  };
}

export function buildVivoActivityRecord(
  draft: QuickAcionamentoDraft,
  rowNumberInFile: number,
  updatedBy: string,
  index: number = 0
): VivoActivityRow {
  const siteName = (draft.siteId || '').trim().toUpperCase();
  if (!siteName) {
    throw new Error('Informe o Site Name para adicionar o acionamento Vivo.');
  }

  const nowIso = new Date().toISOString();
  const demanda = normalizeDateToBr(draft.dataAcionamento);
  const planejado = draft.planejado ? normalizeDateToBr(draft.planejado) : '';
  const tipoDoc = (draft.tipoDoc || 'RF Sheet Vivo').trim();
  const status = (draft.status || 'A produzir').trim();
  const regional = (draft.regional || draft.uf || '').trim().toUpperCase();
  const executor = (draft.executor || '').trim();
  const prioridade = (draft.prioridade || '').trim();
  const idRegister = (draft.siteName || '').trim();
  const comentarioStatus = (draft.observacoes || '').trim();
  const isFinalizado = status.toLowerCase().includes('finalizado');
  const entregue = isFinalizado ? demanda : '';
  const entregueWeek = isFinalizado ? String(computeIsoWeekNumber(draft.dataAcionamento)) : '';

  return {
    id: makeUniqueId('vivo_act', index),
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
    replan: '',
    dataReplan: '',
    entregue,
    executor,
    slaDoc: '',
    entregueWeek,
    ofensor: '',
    faturamento: '',
    rowNumberInFile,
    createdAt: nowIso,
    updatedAt: nowIso,
    updatedBy: updatedBy || 'usuario@ametaservicos.com.br',
    fields: {
      '00.02.Site Name': siteName,
      'ID Register': idRegister,
      Regional: regional,
      'Tipo doc': tipoDoc,
      Status: status,
      'Comentário STATUS': comentarioStatus,
      Prioridade: prioridade,
      Demanda: demanda,
      Planejado: planejado,
      Entregue: entregue,
      EXECUTOR: executor,
      'Entregue Week': entregueWeek,
    },
  };
}

/** Converts parsed batch lines + shared defaults into drafts ready for the target spreadsheet. */
export function expandBatchToDrafts(
  items: ParsedBatchItem[],
  target: AcionamentoTarget,
  sharedDefaults: Omit<QuickAcionamentoDraft, 'siteId'>
): QuickAcionamentoDraft[] {
  return items.map((item) => {
    if (target === 'ERICSSON_SITES') {
      // Expected: Site A ; Site B ; UF ; Cidade A ; Equipe
      return {
        ...sharedDefaults,
        siteId: item.siteId,
        siteIdB: item.col2 ? item.col2.toUpperCase() : sharedDefaults.siteIdB || '',
        uf: item.col3 ? item.col3.toUpperCase() : sharedDefaults.uf || '',
        municipio: item.col4 || sharedDefaults.municipio || '',
        equipe: item.col5 || sharedDefaults.equipe || '',
      };
    }

    if (target === 'ERICSSON_VIVO' || target === 'ERICSSON_ENGENHARIA') {
      // Expected: Site/Intervenção ; Tipo doc ; Regional ; Executor
      return {
        ...sharedDefaults,
        siteId: item.siteId,
        tipoDoc: item.col2 || sharedDefaults.tipoDoc || '',
        regional: item.col3 ? item.col3.toUpperCase() : sharedDefaults.regional || '',
        executor: item.col4 || sharedDefaults.executor || '',
      };
    }

    // NOKIA_SITES, CLARO_SITES, NOKIA_ENGENHARIA
    // Expected: Site ID ; UF ; Município ; Equipe/Executor
    return {
      ...sharedDefaults,
      siteId: item.siteId,
      uf: item.col2 ? item.col2.toUpperCase() : sharedDefaults.uf || '',
      municipio: item.col3 || sharedDefaults.municipio || '',
      equipe: target === 'NOKIA_ENGENHARIA' ? sharedDefaults.equipe || '' : item.col4 || sharedDefaults.equipe || '',
      executor: target === 'NOKIA_ENGENHARIA' ? item.col4 || sharedDefaults.executor || '' : sharedDefaults.executor || '',
    };
  });
}
