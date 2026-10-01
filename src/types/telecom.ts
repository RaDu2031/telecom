export type VendorType = 'NOKIA' | 'ERICSSON';

export type SiteStatus =
  | 'Vistoria - Finalizada'
  | 'Vistoria - A Executar'
  | 'Vistoria - Em Andamento'
  | 'Acesso - Solicitado p/ Nokia'
  | 'Vistoria - Sem Acesso'
  | 'Vistoria - Sem Chave'
  | 'Vistoria - Sem Acesso e Chave'
  | 'Vistoria - Zeladoria'
  | 'Vistoria - Pendênte'
  | 'Vistoria - Aguard. Definição'
  | 'Vistoria Cancelada - Saving TSSR'
  | 'Site Cancelado'
  | 'Ativo'
  | 'Em Implantação'
  | 'Em Comissionamento'
  | 'Manutenção'
  | 'Pendente'
  | 'Crítico'
  | string;

export const CONTROLE_GERAL_COLUMNS: string[] = [
  'Oc Site Pre',
  'SITE ID',
  'END ID',
  'SMP',
  'ID. DETENTORA',
  'REG.',
  'UF',
  'MUNICÍPIO',
  'PROJETO',
  'Prioridade',
  'STATUS',
  'ACIONAMENTO',
  'APOIO',
  'CallOff Solicitado',
  'DEC',
  'EQUIPE EXECUTANTE',
  'SI Planned',
  'SI Executed',
  'Executor',
  'NDPc TalonView',
  'SI Report GDC Portal',
  'Comentários',
  'Improdutiva',
  'Pendência Engenharia',
  'Data do Abono',
  'Escopo',
  'SI REPLANNED',
  'MOTIVO REPLAN',
  'Tipo Site',
  'Modelo De Site',
  'Prioridade Engenharia',
  'Swap Cluster',
  'IMP Detentora',
  'Acesso',
  'Data',
  'Comentários do Acesso',
  'Lib. Fat. ASP',
  'Lib. Fat. TalonView',
  'ITEM',
  'SPO',
  'SGR',
  'N° da NF',
  'DATA NF',
  'Envio Edcom',
  'Status Financeiro',
  'Observações/Motivo',
];

export const CONTROLE_CANCELADOS_COLUMNS: string[] = [
  'Oc Site Pre',
  'SITE ID',
  'END ID',
  'SMP',
  'ID. DETENTORA',
  'REG.',
  'UF',
  'CIDADE',
  'PROJETO',
  'Prioridade',
  'STATUS',
  'ACIONAMENTO',
  'APOIO',
  'CallOff Solicitado',
  'DEC',
  'EQUIPE EXECUTANTE',
  'SI Planned',
  'SI Executed',
  'TalonView Executor',
  'NDPc TalonView',
  'SI Report GDC Portal',
  'Comentários',
  'Improdutiva',
  'Pendência Engenharia',
  'Data do Abono',
  'Escopo',
  'SI REPLANNED',
  'MOTIVO REPLAN',
  'Tipo Site',
  'Modelo De Site',
  'Prioridade Engenharia',
  'Swap Cluster',
  'IMP Detentora',
  'Acesso',
  'Data',
  'Comentários do Acesso',
  'Lib. Fat. ASP',
  'Lib. Fat. TalonView',
  'ITEM',
  'SPO',
  'SGR',
  'N° da NF',
  'DATA NF',
  'Status Financeiro',
  'Observações/Motivo',
];

export const EQUIPES_COLUMNS: string[] = [
  'EQUIPE',
  'NOME',
  'TELEFONE',
  'CPF',
  'RG',
  'ORGÃO EMISSOR',
  'DATA NASCIMENTO',
  'E-MAIL',
  'ATIVIDADE',
  'STATUS',
  'OBSERVAÇÕES',
];

export interface TelecomSite {
  id: string; // Internal UUID or unique key
  siteId: string; // e.g. "SN-OI65J2" or "NK-SP-0104"
  vendor: VendorType;
  sheetName: string; // e.g. "Controle Geral", "Controle Cancelados"
  siteName: string; // END ID e.g. "DFBSA_1601"
  uf: string; // e.g. "DF", "SP", "GO", "MS", "AM"
  municipio: string; // MUNICÍPIO / CIDADE
  regional: string; // REG. e.g. "TCO", "TSP", "TNE", "TNO"
  endereco: string;
  latitude: string;
  longitude: string;
  tipoInfra: string; // Tipo Site: "Greenfield" | "Rooftop" | "Estação Móvel"
  tecnologias: string; // PROJETO / Escopo
  bandas: string; // Swap Cluster / Modelo De Site
  gabineteBbu: string; // SMP / Hardware
  modulosRf: string; // ID. DETENTORA / RRU
  versaoSw: string; // Prioridade / Prioridade Engenharia
  setores: string;
  azimutes: string;
  alturaAntena: string;
  tiltEletrico: string;
  transporteTx: string;
  ipGerencia: string; // SPO / IP
  vlanOm: string; // SGR / VLAN
  energiaRetificadora: string; // IMP Detentora
  status: SiteStatus;
  progressoRollout: number; // 0 to 100
  dataIntegracao: string; // ACIONAMENTO / SI Planned
  dataAtivacao: string; // SI Executed
  responsavelCampo: string; // Executor
  equipeParceira: string; // EQUIPE EXECUTANTE
  ordemServico: string; // Oc Site Pre
  alarmesAtivos: string; // Pendência Engenharia / Status Financeiro
  observacoes: string; // Observações/Motivo / Comentários
  customFields?: Record<string, string>; // Exact columns from Column A to Observação
  isNew?: boolean; // True when newly added/imported into the system
  createdAt?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SpreadsheetMeta {
  id: string;
  vendor: VendorType;
  name: string;
  description: string;
  lastSyncAt: string;
  sourceFileName?: string;
  liveSyncUrl?: string;
  autoRefreshSeconds?: number;
  columns?: string[]; // Ordered headers from Coluna A to Observação
}

export type UserRole = 'ADM' | 'Executor' | 'Vistoriador';

export function normalizeUserRole(raw?: string): UserRole {
  if (!raw) return 'Executor';
  const r = raw.trim().toLowerCase();
  if (r === 'adm' || r.includes('admin')) return 'ADM';
  if (r.includes('vistori')) return 'Vistoriador';
  return 'Executor';
}

export type MandatoryDocType =
  | 'NR10'
  | 'NR35'
  | 'ASO'
  | 'PCMSO'
  | 'PGR'
  | 'PRIMEIROS_SOCORROS'
  | 'CONTRATO_TRABALHO'
  | 'RG';

export type UserDocStatus =
  | 'VALIDADO'
  | 'A_VENCER'
  | 'VENCIDO'
  | 'DISPENSADO'
  | 'PENDENTE';

export interface UserMandatoryDocument {
  type: MandatoryDocType;
  label: string;
  fileName?: string;
  fileSize?: number;
  uploadedAt?: string;
  uploadedBy?: string;
  storageFileName?: string;
  expiresAt?: string; // YYYY-MM-DD
  statusOverride?: 'VALIDADO' | 'A_VENCER' | 'VENCIDO' | 'DISPENSADO';
  notes?: string;
}

export const MANDATORY_USER_DOCUMENTS: Array<{
  type: MandatoryDocType;
  label: string;
  shortLabel: string;
}> = [
  { type: 'NR10', label: 'NR 10', shortLabel: 'NR 10' },
  { type: 'NR35', label: 'NR 35', shortLabel: 'NR 35' },
  { type: 'ASO', label: 'ASO', shortLabel: 'ASO' },
  { type: 'PCMSO', label: 'PCMSO', shortLabel: 'PCMSO' },
  { type: 'PGR', label: 'PGR', shortLabel: 'PGR' },
  {
    type: 'PRIMEIROS_SOCORROS',
    label: 'Primeiros Socorros',
    shortLabel: '1º Socorros',
  },
  {
    type: 'CONTRATO_TRABALHO',
    label: 'Contrato de Trabalho',
    shortLabel: 'Contrato',
  },
  { type: 'RG', label: 'RG', shortLabel: 'RG' },
];

export function ensureUserMandatoryDocuments(
  existing?: UserMandatoryDocument[]
): UserMandatoryDocument[] {
  const map = new Map<MandatoryDocType, UserMandatoryDocument>();
  if (Array.isArray(existing)) {
    existing.forEach((d) => {
      if (d && d.type) {
        map.set(d.type, d);
      }
    });
  }
  return MANDATORY_USER_DOCUMENTS.map((meta) => {
    const found = map.get(meta.type);
    return {
      type: meta.type,
      label: meta.label,
      fileName: found?.fileName || '',
      fileSize: found?.fileSize || 0,
      uploadedAt: found?.uploadedAt || '',
      uploadedBy: found?.uploadedBy || '',
      storageFileName: found?.storageFileName || '',
      expiresAt: found?.expiresAt || '',
      statusOverride: found?.statusOverride,
      notes: found?.notes || '',
    };
  });
}

export function evaluateDocumentExpiration(
  doc: UserMandatoryDocument,
  userDispensado?: boolean
): {
  status: UserDocStatus;
  daysRemaining: number | null;
  statusLabel: 'VALIDADO' | 'A VENCER' | 'VENCIDO' | 'DISPENSADO' | 'PENDENTE';
} {
  if (userDispensado || doc.statusOverride === 'DISPENSADO') {
    return { status: 'DISPENSADO', daysRemaining: null, statusLabel: 'DISPENSADO' };
  }

  if (doc.expiresAt && doc.expiresAt.trim()) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expParts = doc.expiresAt.trim().split('-').map(Number);
    if (expParts.length === 3 && !expParts.some(isNaN)) {
      const expDate = new Date(expParts[0], expParts[1] - 1, expParts[2]);
      expDate.setHours(0, 0, 0, 0);
      const diffMs = expDate.getTime() - today.getTime();
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (daysRemaining < 0) {
        return { status: 'VENCIDO', daysRemaining, statusLabel: 'VENCIDO' };
      }
      if (daysRemaining <= 30) {
        return { status: 'A_VENCER', daysRemaining, statusLabel: 'A VENCER' };
      }
      return { status: 'VALIDADO', daysRemaining, statusLabel: 'VALIDADO' };
    }
  }

  if (doc.statusOverride === 'VENCIDO') {
    return { status: 'VENCIDO', daysRemaining: null, statusLabel: 'VENCIDO' };
  }
  if (doc.statusOverride === 'A_VENCER') {
    return { status: 'A_VENCER', daysRemaining: null, statusLabel: 'A VENCER' };
  }
  if (doc.statusOverride === 'VALIDADO' || (doc.fileName && doc.fileName.trim())) {
    return { status: 'VALIDADO', daysRemaining: null, statusLabel: 'VALIDADO' };
  }

  return { status: 'PENDENTE', daysRemaining: null, statusLabel: 'PENDENTE' };
}

export function evaluateUserOverallDocumentStatus(user: AmetaUser) {
  const isUserDispensado =
    Boolean(user.dispensadoDocumentos) ||
    (user.statusRecurso || '').toUpperCase() === 'DISPENSADO';

  const docs = ensureUserMandatoryDocuments(user.documents);
  const evaluated = docs.map((d) => ({
    ...d,
    eval: evaluateDocumentExpiration(d, isUserDispensado),
  }));

  const vencidos = evaluated.filter((d) => d.eval.status === 'VENCIDO');
  const aVencer = evaluated.filter((d) => d.eval.status === 'A_VENCER');
  const validados = evaluated.filter((d) => d.eval.status === 'VALIDADO');
  const dispensados = evaluated.filter((d) => d.eval.status === 'DISPENSADO');
  const pendentes = evaluated.filter((d) => d.eval.status === 'PENDENTE');

  const rawManual = (user.statusRecurso || '').toUpperCase();
  let overallStatus: 'VALIDADO' | 'A VENCER' | 'VENCIDO' | 'DISPENSADO' = 'VALIDADO';

  if (isUserDispensado || dispensados.length === docs.length) {
    overallStatus = 'DISPENSADO';
  } else if (vencidos.length > 0 || rawManual === 'VENCIDO') {
    overallStatus = 'VENCIDO';
  } else if (aVencer.length > 0 || rawManual === 'A VENCER' || rawManual === 'A_VENCER') {
    overallStatus = 'A VENCER';
  } else {
    overallStatus = 'VALIDADO';
  }

  return {
    isUserDispensado,
    evaluated,
    vencidos,
    aVencer,
    validados,
    dispensados,
    pendentes,
    overallStatus,
  };
}

export interface AmetaUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  equipe?: string;
  telefone?: string;
  cpf?: string;
  rg?: string;
  atividade?: string;
  statusRecurso?: string;
  dispensadoDocumentos?: boolean;
  documents?: UserMandatoryDocument[];
  emailVerified: boolean;
  verificationCode?: string;
  verifiedAt?: string;
  preferredVendor?: VendorType;
  createdAt: string;
}

export interface EngineeringFolder {
  id: string;
  parentId: string | null; // null for root "Vistorias"
  name: string;
  vendor: VendorType;
  description?: string;
  assignedTo?: string; // Responsible user name or email for demand filtering
  createdByName: string;
  createdByEmail: string;
  createdAt: string;
  isSystem?: boolean; // True for Vistorias, Vistorias Executadas, TSSR Entrada, TSSR
}

export interface EngineeringFile {
  id: string;
  folderId: string;
  vendor: VendorType;
  fileName: string;
  fileType: 'zip' | 'rar' | '7z' | 'excel' | 'pdf' | 'word' | 'image' | 'other';
  extension: string; // e.g. ".zip", ".rar", ".xlsx", ".pdf"
  fileSize: number; // in bytes
  siteId?: string; // Optional linked Site ID e.g. "SN-OI65J2"
  notes?: string;
  assignedTo?: string; // Responsible user name or email who should see this document in their demand
  uploadedByName: string; // Required name of the person who uploaded the file
  uploadedByEmail: string;
  uploadedAt: string;
  storageFileName?: string; // File name stored in data/uploads/
}

export interface SyncEventPayload {
  type:
    | 'FULL_STATE'
    | 'SITE_UPDATED'
    | 'SITE_CREATED'
    | 'SITES_BULK_UPSERT'
    | 'SITE_DELETED'
    | 'SHEET_CREATED'
    | 'FOLDER_CREATED'
    | 'FOLDER_UPDATED'
    | 'FOLDER_DELETED'
    | 'FILE_UPLOADED'
    | 'FILE_UPDATED'
    | 'FILE_DELETED';
  timestamp: string;
  actorEmail?: string;
  vendor?: VendorType;
  summary?: string;
}
