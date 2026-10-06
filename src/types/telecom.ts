export type VendorType = 'NOKIA' | 'ERICSSON';

export const DEFAULT_ONEDRIVE_TSSR_URL = 'https://onedrive.live.com/:x:/g/personal/d82e752e01e5afdd/IQDgA-L4WLPYSbYY7rdSiedCAY39Y72Mn2s6Vn9Ijm0Tq-k?rtime=i_gLDa-r3kg&redeem=aHR0cHM6Ly8xZHJ2Lm1zL3gvYy9kODJlNzUyZTAxZTVhZmRkL0lRRGdBLUw0V0xQWVNiWVk3cmRTaWVkQ0FZMzlZNzJNbjJzNlZuOUlqbTBUcS1rP2U9WEV0d0F4';
export const DEFAULT_ERICSSON_ENG_ONEDRIVE_URL = 'https://onedrive.live.com/:x:/g/personal/d82e752e01e5afdd/IQCOlAu1cXsYS4GTeMznod4DAcUTBaeVfylro6lYCHY4BQY?rtime=lKiFN4Uj30g&redeem=aHR0cHM6Ly8xZHJ2Lm1zL3gvYy9kODJlNzUyZTAxZTVhZmRkL0lRQ09sQXUxY1hzWVM0R1RlTXpub2Q0REFjVVRCYWVWZnlscm82bFlDSFk0QlFZP2U9TzJIbnRI';

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
  responsaveisUids?: string[];
  responsaveisEmails?: string[];
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

export type UserRole =
  | 'ADM'
  | 'Coordenador Geral'
  | 'Coordenador Engenharia'
  | 'Executor'
  | 'Vistoriador';

export type AssignedPlatformScope = 'NOKIA' | 'ERICSSON' | 'BOTH' | 'AMBAS';

export type UserSituacao = 'dono' | 'aguardando' | 'ativo' | 'bloqueado';

export const OWNER_ADM_EMAILS = [
  'rafael.araujo@ametaservicos.com.br',
  'rafael.araujo0797@gmail.com',
];

export function isOwnerAdmUser(email?: string | null, situacao?: UserSituacao | string | null): boolean {
  if (situacao === 'dono') return true;
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return OWNER_ADM_EMAILS.includes(clean);
}

export function isUserDono(user?: AmetaUser | null): boolean {
  if (!user) return false;
  return user.situacao === 'dono' || user.role === 'ADM' || isOwnerAdmUser(user.email, user.situacao);
}

export function isUserAguardando(user?: AmetaUser | null): boolean {
  if (!user) return false;
  if (isUserDono(user)) return false;
  return (
    user.situacao === 'aguardando' ||
    user.situacao === 'bloqueado' ||
    user.accessReleased === false
  );
}

export function normalizeUserRole(raw?: string, email?: string): UserRole {
  if (email && isOwnerAdmUser(email)) {
    return 'ADM';
  }
  if (!raw) return 'Executor';
  const r = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Only the Owner (Rafael Araújo) can be ADM; any other user previously marked ADM becomes Coordenador Geral
  if (r === 'adm' || r.includes('admin')) {
    return email && !isOwnerAdmUser(email) ? 'Coordenador Geral' : 'ADM';
  }
  if (r.includes('engenharia') && (r.includes('coord') || r.includes('coordenador'))) {
    return 'Coordenador Engenharia';
  }
  if (r.includes('coord') || r.includes('coordenador')) {
    return 'Coordenador Geral';
  }
  if (r.includes('vistori')) {
    return 'Vistoriador';
  }
  return 'Executor';
}

export function hasFullSpreadsheetAccess(role: UserRole): boolean {
  return role === 'ADM' || role === 'Coordenador Geral';
}

export function isEngineeringCoordinatorRole(role: UserRole): boolean {
  return role === 'Coordenador Engenharia';
}

export function canUserAccessVendor(
  user: AmetaUser | null | undefined,
  vendor: VendorType
): boolean {
  if (!user) return false;
  if (isUserDono(user) || isOwnerAdmUser(user.email, user.situacao) || user.role === 'ADM') return true;
  if (isUserAguardando(user)) return false;
  const scope = user.plataforma === 'AMBAS' ? 'BOTH' : user.plataforma || user.assignedPlatform || user.preferredVendor || 'NOKIA';
  if (scope === 'BOTH') return true;
  return scope === vendor;
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
    const item: UserMandatoryDocument = {
      type: meta.type,
      label: meta.label,
      fileName: found?.fileName || '',
      fileSize: found?.fileSize || 0,
      uploadedAt: found?.uploadedAt || '',
      uploadedBy: found?.uploadedBy || '',
      storageFileName: found?.storageFileName || '',
      expiresAt: found?.expiresAt || '',
      notes: found?.notes || '',
    };
    if (found?.statusOverride) {
      item.statusOverride = found.statusOverride;
    }
    return item;
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

  let overallStatus: 'VALIDADO' | 'A VENCER' | 'VENCIDO' | 'DISPENSADO' = 'VALIDADO';

  if (isUserDispensado || dispensados.length === docs.length) {
    overallStatus = 'DISPENSADO';
  } else if (vencidos.length > 0) {
    overallStatus = 'VENCIDO';
  } else if (aVencer.length > 0) {
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
  uid?: string; // Firebase Auth UID
  name: string;
  email: string;
  role: UserRole;
  situacao?: UserSituacao; // 'dono' | 'aguardando' | 'ativo' | 'bloqueado'
  plataforma?: AssignedPlatformScope;
  assignedPlatform?: AssignedPlatformScope; // 'NOKIA' (TIM/Nokia), 'ERICSSON', or 'BOTH'
  accessReleased?: boolean; // Released/approved by ADM Dono
  releasedByEmail?: string;
  releasedAt?: string;
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
  updatedAt?: string;
}

export type NotificationEventType =
  | 'SITE_DEMANDADO_EXECUTOR'
  | 'EXECUTOR_ATUALIZOU_EQUIPE'
  | 'VISTORIA_OK_PASTA'
  | 'TSSR_ENVIADO_EXECUTOR'
  | 'ARQUIVO_ASSOCIADO_SITE_VISTORIADOR'
  | 'PERMISSAO_LIBERADA_ADM';

export interface AmetaNotification {
  id: string;
  type: NotificationEventType;
  vendor: VendorType; // 'NOKIA' (TIM/Nokia) or 'ERICSSON'
  title: string;
  message: string;
  siteId?: string;
  fileName?: string;
  actorName: string;
  actorEmail: string;
  actorRole?: UserRole;
  targetRoles: UserRole[];
  targetEquipes?: string[];
  targetEmails?: string[];
  readByEmails: string[];
  createdAt: string;
}

export function doesNotificationMatchUser(
  notif: AmetaNotification,
  user: AmetaUser | null | undefined,
  effectiveRole: UserRole,
  activeVendor?: VendorType
): boolean {
  if (!user) return false;

  const userEmail = (user.email || '').trim().toLowerCase();

  // Direct email match
  if (
    Array.isArray(notif.targetEmails) &&
    notif.targetEmails.length > 0 &&
    notif.targetEmails.some((e) => e.trim().toLowerCase() === userEmail)
  ) {
    return true;
  }

  // ADM Dono (when not simulating another role) sees all notifications for the active platform (or all)
  if (effectiveRole === 'ADM' && isOwnerAdmUser(user.email)) {
    if (activeVendor && notif.vendor !== activeVendor) {
      return false;
    }
    return true;
  }

  // Platform check: Each platform has its own Coordinator, Engineering Coordinator, and Executor
  const allowedPlatform = user.assignedPlatform || user.preferredVendor;
  if (allowedPlatform && allowedPlatform !== 'BOTH' && notif.vendor !== allowedPlatform) {
    return false;
  }
  if (activeVendor && notif.vendor !== activeVendor) {
    return false;
  }

  if (!Array.isArray(notif.targetRoles) || !notif.targetRoles.includes(effectiveRole)) {
    return false;
  }

  // If role is Executor or Vistoriador and notification specifies targetEquipes, verify team/name match
  if (
    (effectiveRole === 'Executor' || effectiveRole === 'Vistoriador') &&
    Array.isArray(notif.targetEquipes) &&
    notif.targetEquipes.length > 0
  ) {
    const cleanUserEquipe = (user.equipe || '').trim().toLowerCase();
    const cleanUserName = (user.name || '').trim().toLowerCase();
    const matchesTeam = notif.targetEquipes.some((eq) => {
      const target = (eq || '').trim().toLowerCase();
      if (!target) return false;
      return (
        (cleanUserEquipe &&
          (cleanUserEquipe.includes(target) || target.includes(cleanUserEquipe))) ||
        (cleanUserName && (cleanUserName.includes(target) || target.includes(cleanUserName)))
      );
    });
    return matchesTeam;
  }

  return true;
}

export interface EngineeringFolder {
  id: string;
  parentId: string | null; // null for root "Vistorias"
  name: string;
  vendor: VendorType;
  description?: string;
  assignedTo?: string; // Responsible user name or email for demand filtering
  createdByUid?: string;
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
  rowId?: string; // Optional linked Ericsson or custom row ID
  engineeringRowId?: string; // Optional linked Ericsson Engineering row ID
  intervencaoClaro?: string; // Optional linked Intervencao Claro
  tipoDoc?: string; // Optional linked Tipo de doc (WR, QRF, PPI, SDC, SMART, BOQ)
  docGroup?: string;
  status?: string; // Status of the linked document/site
  regional?: string; // Regional of the linked document/site
  ocSitePre?: string; // Optional linked Work Order / Oc Site Pre
  tssrRowId?: string; // Optional linked row ID in TSSR TIM Nokia
  notes?: string;
  assignedTo?: string; // Responsible user name or email who should see this document in their demand
  uploadedByUid?: string;
  uploadedByName: string; // Required name of the person who uploaded the file
  uploadedByEmail: string;
  uploadedAt: string;
  storageFileName?: string; // File name stored in data/uploads/
  dataUrl?: string;
  responsaveisUids?: string[];
  responsaveisEmails?: string[];
}

export const TSSR_TIM_NOKIA_ORIGINAL_COLUMNS: string[] = [
  'Oc Site Pre',
  'Enderecoid',
  'Site Id',
  'Reg',
  'UF',
  'Cidade',
  'PROJETO',
  'DETENTORA',
  'DEMANDA RECEBIDA',
  'STATUS Engenharia',
  'TIPO DE DOC',
  'Prioridade Homero',
  'Executor',
  'Data de demanda',
  'Plan entrega',
  'RECEBIDO',
  'Enviado para NOKIA',
  'GDC Portal',
  'REPROVAÇÃO',
  'RETORNO REPROVAÇÃO',
  'OBSERVAÇÃO',
  'DATA OBSERVAÇÃO',
  'Modelo de Site',
  'Tipo Site',
  'Faturamento ASP',
  'EXECUÇÃO DE H&S',
  'Faturamento H&S',
  'ITEM',
  'SPO',
  'SGR',
  'NFS',
  'DATA NFS',
  'Envio Edcom',
  'Status Financeiro',
  'Observações/Motivo',
  'Apoio',
  'Check',
];

export const TSSR_SYSTEM_COLUMNS: string[] = [
  'Status da vistoria',
  'Arquivo da vistoria',
  'Data/hora da entrega',
  'Vistoriador que enviou',
];

export const TSSR_ALL_COLUMNS: string[] = [
  ...TSSR_TIM_NOKIA_ORIGINAL_COLUMNS,
  ...TSSR_SYSTEM_COLUMNS,
];

export type TssrVistoriaStatus = 'Pendente' | 'Entregue';

export interface TssrRow {
  id: string;
  rowKey: string; // Site Id + Oc Site Pre (or Site Id)
  vendor: VendorType;
  tabName: string; // e.g. "TSSR TIM Nokia"
  siteId: string; // "Site Id"
  ocSitePre: string; // "Oc Site Pre"
  enderecoId: string; // "Enderecoid"
  fields: Record<string, string>; // All 37 original TSSR columns
  // System columns (preserved across TSSR spreadsheet reloads)
  vistoriaStatus: TssrVistoriaStatus;
  vistoriaFileId?: string;
  vistoriaFileName?: string;
  vistoriaFileUrl?: string;
  vistoriaDownloadUrl?: string;
  vistoriaDeliveredAt?: string;
  vistoriaUploadedBy?: string;
  vistoriaUploadedByEmail?: string;
  responsaveisUids?: string[];
  responsaveisEmails?: string[];
  createdAt?: string;
  updatedAt: string;
}

export interface TssrSheetMeta {
  id: string;
  vendor: VendorType;
  tabName: string; // "TSSR TIM Nokia"
  sourceFileName?: string;
  liveSyncUrl?: string;
  lastSyncAt: string;
  totalRows: number;
}

export const ERICSSON_ORIGINAL_COLUMNS: string[] = [
  '01.00. Chaves',
  'Auxiliar',
  '00.03.State',
  'Registro',
  'Meta',
  '01.21.Site ID A',
  'ID Detentora A',
  '01.21.Site ID B',
  'ID Detentora B',
  '00.04.Site Name',
  'Altura Definida A',
  'Altura Definida B',
  'Status A',
  'Status B',
  'CIDADE A',
  'CIDADE B',
  'EQUIPE',
  '02.00.Scope',
  'Serviço',
  'Trabalho em Altura A',
  'Trabalho em Altura B',
  'Demanda Recebida',
  'Cálculo de Desempenho Recebido',
  'Aceite Sydle',
  'Detentora A',
  'ESTRUTURA',
  'Detentora B',
  'ESTRUTURA2',
  'Solicitado',
  'Solicitado3',
  'A',
  'B',
  'Aprovado',
  'Aprovado4',
  'Validade',
  'Validade5',
  'Solicitado A',
  'Solicitado B',
  'CRQ Solicitado',
  'Aprovado6',
  'Validade7',
  'SYDLE EQUIPE, CRQ e ACESSO',
  'PLAN A',
  'REAL A',
  'PLAN B',
  'REAL B',
  'Replan',
  'Improdutiva',
  'Observações',
  'Executor EHS Site Survey',
  'EHS Site Survey Demandado',
  'Site Survey A+B',
  'EHS Site Survey Sydle',
  'PPI Demanda',
  'PPI Executor',
  'PPI + SDC PLAN',
  'PPI + SDC A',
  'PPI + SDC B',
  'PPI Overdue',
  'PPI + SDC A Sydle',
  'PPI + SDC B Sydle',
  'LOS Plan',
  'LOS Overdue',
  'LOS na Sydle',
  'PPI + SDC A+B Reprovado',
  'PPI + SDC A+B Sydle',
  'LOS Reprovado',
  'LOS revisado na Sydle',
  'Obs',
  'Obra',
  'P.O.',
  'MIGO',
  'Line of Sight - Up to 3 points',
  'Site Survey MW',
  'SCI/SDC - MW',
  'PPI - MW',
  'Combo Claro MW',
  'Displacement',
  'CR 4x4',
  'CR Add',
  'Observações8',
  'LoS Multa',
  'Multa TSSR A',
  'Multa TSSR B',
  'Multa PPI A',
  'Multa PPI B',
  'LoS Multa2',
  'Multa TSSR A2',
  'Multa TSSR B2',
  'Multa PPI A2',
  'Multa PPI B2',
  'Liberado na Sydle Emitir Nota',
  'Pendência Finaceira',
  'MULTA DE H&S',
  'MOTIVO DA MULTA DE H&S',
  '% DE MULTA',
  'ID',
  'Observação',
  'Check',
  'Liberação de Faturamento LoS',
  'Liberação de Faturamento TSSR',
  'Liberação de Faturamento PPI_SDC',
  'EHS Site Survey',
  'CR 4x42',
  'Adicional',
  'Motivo',
];

export const ERICSSON_SYSTEM_COLUMNS_PER_SITE: string[] = [
  'Status da vistoria',
  'Arquivo da vistoria',
  'Data/hora da entrega',
  'Enviada por',
];

export type EricssonVistoriaStatus = 'Pendente' | 'Entregue' | 'Dispensado';

export interface EricssonRow {
  id: string;
  rowKey: string; // Chaves + Registro + Site ID A + Site ID B
  chaves: string;
  registro: string;
  state: string;
  meta: string;
  siteIdA: string;
  idDetentoraA: string;
  siteIdB: string;
  idDetentoraB: string;
  siteName: string;
  statusA: string;
  statusB: string;
  cidadeA: string;
  cidadeB: string;
  equipe: string;
  servico: string;
  fields: Record<string, string>; // All 106 original Ericsson columns
  // System columns for Site A (preserved across spreadsheet reloads)
  siteAVistoriaStatus: EricssonVistoriaStatus;
  siteAVistoriaFileId?: string;
  siteAVistoriaFolderId?: string;
  siteAVistoriaFileName?: string;
  siteAVistoriaFileUrl?: string;
  siteAVistoriaDownloadUrl?: string;
  siteAVistoriaDeliveredAt?: string;
  siteAVistoriaUploadedBy?: string;
  siteAVistoriaUploadedByEmail?: string;
  // System columns for Site B (preserved across spreadsheet reloads)
  siteBVistoriaStatus: EricssonVistoriaStatus;
  siteBVistoriaFileId?: string;
  siteBVistoriaFolderId?: string;
  siteBVistoriaFileName?: string;
  siteBVistoriaFileUrl?: string;
  siteBVistoriaDownloadUrl?: string;
  siteBVistoriaDeliveredAt?: string;
  siteBVistoriaUploadedBy?: string;
  siteBVistoriaUploadedByEmail?: string;
  // System columns for LOS (preserved across spreadsheet reloads)
  losStatus?: EricssonVistoriaStatus;
  losLinkedSiteId?: string;
  losFileId?: string;
  losFolderId?: string;
  losFileName?: string;
  losFileUrl?: string;
  losDownloadUrl?: string;
  losDeliveredAt?: string;
  losUploadedBy?: string;
  losUploadedByEmail?: string;
  // System columns for SMART (preserved across spreadsheet reloads)
  smartStatus?: EricssonVistoriaStatus;
  smartLinkedSiteId?: string;
  smartFileId?: string;
  smartFolderId?: string;
  smartFileName?: string;
  smartFileUrl?: string;
  smartDownloadUrl?: string;
  smartDeliveredAt?: string;
  smartUploadedBy?: string;
  smartUploadedByEmail?: string;
  // System columns for SDC (preserved across spreadsheet reloads)
  sdcStatus?: EricssonVistoriaStatus;
  sdcLinkedSiteId?: string;
  sdcFileId?: string;
  sdcFolderId?: string;
  sdcFileName?: string;
  sdcFileUrl?: string;
  sdcDownloadUrl?: string;
  sdcDeliveredAt?: string;
  sdcUploadedBy?: string;
  sdcUploadedByEmail?: string;
  responsaveisUids?: string[];
  responsaveisEmails?: string[];
  isManualRow?: boolean;
  createdAt?: string;
  updatedAt: string;
}

export interface EricssonSheetMeta {
  id: string;
  tabName: string; // "ERICSSON CLARO TX"
  sourceFileName?: string;
  liveSyncUrl?: string;
  lastSyncAt: string;
  totalRows: number;
  totalSites: number;
  columns: string[];
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
    | 'FILE_DELETED'
    | 'TSSR_UPDATED'
    | 'ERICSSON_UPDATED'
    | 'ERICSSON_ENGENHARIA_UPDATED'
    | 'USER_DOCUMENT_UPDATED';
  timestamp: string;
  actorEmail?: string;
  vendor?: VendorType;
  summary?: string;
}

// ============================================================================
// ERICSSON ENGENHARIA — PLANILHA DOCUMENTAÇÃO & PLANEJAMENTO (51 COLUNAS EXATAS)
// ============================================================================
export const ERICSSON_SITE_LIST_COLUMNS: string[] = [
  'ASP',
  'Intervencao Claro',
  'TIPO SITE',
  'Regional',
  'Tipo doc',
  'Status',
  'Comentário STATUS',
  'Demanda',
  'Planejado',
  'REPLAN',
  'DATA REPLAN',
  'MOTIVO REPLAN',
  'Entregue',
  'EXECUTOR',
  'SLA DOC',
  'Week Produção',
  'Entregue Week',
  'Entregue Week Ameta',
  'MOS',
  'Prioridade | Engineering Target',
  'Double Check',
  'DOC APROVADO\r\nWR/QRF/PPI',
  'VERIFICAÇÃO DOC\r\nQRF/PPI',
  'WR REVISAR',
  'EXECUTOR WR',
  'MOTIVO',
  'OFENSOR',
  'WR REV. PLAN',
  'WR ENTREGUE',
  'SLA WR',
  'QRF REVISAR',
  'EXECUTOR QRF',
  'MOTIVO DE REVISÃO DO QRF',
  'QRF - nº reprovações',
  'QRF REV. PLAN',
  'QRF ENTREGUE',
  'SLA QRF',
  'PPI REVISAR',
  'EXECUTOR PPI',
  'MOTIVO DE REVISÃO DO PPI',
  'OFENSOR  DOC',
  'PPI - nº reprovações',
  'PPI REV. PLAN',
  'PPI ENTREGUE',
  'SLA PPI',
  'Faturamento',
  'Fat. Adicional',
  'Comentários',
  'Antecipação WR',
  'Demandado WR',
  'Finalizado WR',
];

export type EricssonDocGroup = 'WR' | 'QRF' | 'PPI' | 'BOQ' | 'SMART' | 'SDC';
export type EricssonDocStatusCategory = 'Finalizado' | 'Em produção' | 'Pendente' | 'Dúvida';

export const ERICSSON_REAL_STATUSES_BY_DOC: Record<EricssonDocGroup, string[]> = {
  WR: [
    'Finalizado',
    'Documentação paralisada',
    'Demanda cancelada',
    'Em correção',
    'Pendente Verificação EDB',
    'Pendente PE',
    'Pendente - Dúvida',
    'Pendente Vistoria',
    'Em produção',
  ],
  QRF: [
    'Aguardando Predecessor',
    'Finalizado',
    'Em correção',
    'Demanda cancelada',
    'Documentação paralisada',
    'Pendente - Dúvida',
    'Pronto para envio',
    'Em produção',
  ],
  PPI: [
    'Finalizado',
    'Documentação paralisada',
    'Em correção',
    'Demanda cancelada',
    'Aguardando Predecessor',
    'Pendente - Dúvida',
    'Pendente PE',
    'Pronto para envio',
    'Em produção',
  ],
  SDC: [
    'Finalizado',
    'Documentação paralisada',
    'Em correção',
    'Demanda cancelada',
    'Aguardando Predecessor',
    'Pendente - Dúvida',
    'Em produção',
  ],
  SMART: [
    'Finalizado',
    'Demanda cancelada',
    'Pendente Verificação EDB',
    'Em correção',
    'Pendente - Dúvida',
    'Em produção',
  ],
  BOQ: [
    'Finalizado',
    'BoQ-Pendencia',
    'Em produção',
    'Demanda cancelada',
  ],
};

export interface EricssonAttachedFile {
  id: string;
  name: string;
  url: string;
  uploadedBy?: string;
  uploadedByEmail?: string;
  uploadedAt: string;
  sizeBytes?: number;
}

export interface EricssonAuditLogEntry {
  id: string;
  user: string;
  userEmail?: string;
  timestamp: string;
  action: string;
  details?: string;
  fieldChanges?: Record<string, { old: string; new: string }>;
}

export interface EricssonReprovacaoRecord {
  id: string;
  rowId?: string;
  intervencaoClaro: string;
  tipoDoc: EricssonDocGroup | string;
  executor: string; // Quem reprovou ou executor responsável
  motivo: string;
  dataReprovacao: string; // YYYY-MM-DD ou ISO
  regional?: string;
  tipoSite?: string;
  statusOriginal?: string;
  createdAt?: string;
  createdBy?: string;
}

export interface EricssonEngineeringRow {
  id: string;
  rowKey: string;
  intervencaoClaro: string;
  siteIdA: string;
  siteIdB: string;
  statusA: string;
  statusB: string;
  tipoDoc: string;
  status: string;
  regional: string;
  tipoSite: string;
  executor: string;
  fields: Record<string, string>;
  siteAVistoriaStatus?: EricssonVistoriaStatus;
  siteBVistoriaStatus?: EricssonVistoriaStatus;
  attachedFileId?: string;
  attachedFileName?: string;
  attachedFileUrl?: string;
  attachedUploadedBy?: string;
  attachedUploadedAt?: string;
  attachedFiles?: EricssonAttachedFile[];
  history?: EricssonAuditLogEntry[];
  reprovacoes?: EricssonReprovacaoRecord[];
  updatedAt: string;
}

export interface EricssonDocItemStats {
  total: number;
  finalizado: number;
  taxaFinalizacao: number;
  emProducao?: number;
  pendente?: number;
  duvida?: number;
  outros?: number;
  statusCounts: Record<string, number>;
}

export interface EricssonConsolidatedStats {
  totalRows: number;
  wr: EricssonDocItemStats;
  qrf: EricssonDocItemStats;
  ppi: EricssonDocItemStats;
  boq: EricssonDocItemStats;
  smart: EricssonDocItemStats;
  sdc: EricssonDocItemStats;
  outrosDocs: number;
}

export interface EricssonColaborador {
  nome: string;
  atividade: string;
  capacidade: string;
  observacoes?: string;
}

export const DEFAULT_ERICSSON_COLABORADORES: EricssonColaborador[] = [
  {
    nome: 'Rafael de Souza Caldeira (Alex Magalhães)',
    atividade: 'PPI',
    capacidade: '4',
    observacoes: '',
  },
  {
    nome: 'Felipe França Pimentel',
    atividade: 'PPI',
    capacidade: '2',
    observacoes: '',
  },
  {
    nome: 'Fernando Minoru Sakamoto',
    atividade: 'PPI',
    capacidade: '2',
    observacoes: '',
  },
  {
    nome: 'Fulvio Franca Pimentel',
    atividade: 'PPI',
    capacidade: '1',
    observacoes: '',
  },
  {
    nome: 'Samuel Soares/ Marcus Vinicius (Thiago)',
    atividade: 'PPI',
    capacidade: '1',
    observacoes: '',
  },
  {
    nome: 'Wagner Luis Fernandes dos Santos',
    atividade: 'PPI',
    capacidade: '3',
    observacoes: '',
  },
  {
    nome: 'Roberto dos Santos',
    atividade: 'QRF',
    capacidade: '5',
    observacoes: '',
  },
  {
    nome: 'Gisele Trespach Vieira',
    atividade: 'QRF',
    capacidade: '5',
    observacoes: '',
  },
  {
    nome: 'Fernando Sale de Souza',
    atividade: 'PPI/ QRF',
    capacidade: '2/6',
    observacoes: '',
  },
  {
    nome: 'Alexandre Leandro - Verificador QRF',
    atividade: 'QRF',
    capacidade: '20',
    observacoes: '',
  },
];


