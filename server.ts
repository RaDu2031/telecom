import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { INITIAL_SITES, INITIAL_SHEETS } from './src/data/initialSites.ts';
import {
  TelecomSite,
  SiteStatus,
  SpreadsheetMeta,
  AmetaUser,
  UserRole,
  normalizeUserRole,
  VendorType,
  EngineeringFolder,
  EngineeringFile,
  MandatoryDocType,
  UserMandatoryDocument,
  ensureUserMandatoryDocuments,
  evaluateDocumentExpiration,
  evaluateUserOverallDocumentStatus,
  TssrRow,
  TssrSheetMeta,
  TSSR_TIM_NOKIA_ORIGINAL_COLUMNS,
  EricssonRow,
  EricssonSheetMeta,
  ERICSSON_ORIGINAL_COLUMNS,
  ERICSSON_SITE_LIST_COLUMNS,
  EricssonEngineeringRow,
  EricssonColaborador,
  DEFAULT_ERICSSON_COLABORADORES,
  AmetaNotification,
  NotificationEventType,
  AssignedPlatformScope,
  isOwnerAdmUser,
  hasFullSpreadsheetAccess,
} from './src/types/telecom.ts';
import {
  parseExcelWorkbookBuffer,
  getCanonicalDuplaName,
  doesSiteMatchEquipe,
  doesSiteMatchResponsible,
  normalizeAccents,
} from './src/utils/spreadsheetUtils.ts';
import {
  parseTssrWorkbookBuffer,
  mergeTssrRowsPreservingVistoria,
  buildTssrRowKey,
} from './src/utils/tssrSpreadsheetUtils.ts';
import {
  parseEricssonWorkbookBuffer,
  mergeEricssonRowsPreservingVistoria,
  buildEricssonRowKey,
  computeEricssonSiteCounters,
  parseEricssonEngineeringWorkbookBuffer,
  computeEricssonConsolidatedStats,
} from './src/utils/ericssonSpreadsheetUtils.ts';

interface StoredUser extends AmetaUser {
  passwordHash: string;
}

interface DatabaseSchema {
  users: StoredUser[];
  sites: TelecomSite[];
  sheets: SpreadsheetMeta[];
  engineeringFolders: EngineeringFolder[];
  engineeringFiles: EngineeringFile[];
  tssrRows?: TssrRow[];
  tssrSheets?: TssrSheetMeta[];
  ericssonRows?: EricssonRow[];
  ericssonSheetMeta?: EricssonSheetMeta;
  ericssonFolders?: EngineeringFolder[];
  ericssonFiles?: EngineeringFile[];
  ericssonUsers?: StoredUser[];
  ericsson_engenharia?: EricssonEngineeringRow[];
  ericsson_engenharia_meta?: {
    id: string;
    tabName: string;
    sourceFileName?: string;
    liveSyncUrl?: string;
    lastSyncAt: string;
    totalRows: number;
    columns: string[];
  };
  ericsson_colaboradores?: EricssonColaborador[];
  ericssonExecutorEmailsMap?: Record<string, string[]>;
  ericssonDuplaEmailsMap?: Record<string, string[]>;
  notifications?: AmetaNotification[];
  duplaEmailsMap?: Record<string, string[]>;
  executorEmailsMap?: Record<string, string[]>;
  lastUpdated: string;
}

function pushNotification(
  db: DatabaseSchema,
  notif: Omit<AmetaNotification, 'id' | 'readByEmails' | 'createdAt'>
): AmetaNotification {
  if (!Array.isArray(db.notifications)) {
    db.notifications = [];
  }
  const created: AmetaNotification = {
    ...notif,
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    readByEmails: [],
    createdAt: new Date().toISOString(),
  };
  db.notifications.unshift(created);
  if (db.notifications.length > 350) {
    db.notifications = db.notifications.slice(0, 350);
  }
  return created;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = process.env.AMETA_UPLOADS_DIR
  ? path.resolve(process.env.AMETA_UPLOADS_DIR)
  : path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'ameta-db.json');
const TSSR_SEED_FILE = path.join(DATA_DIR, 'tssr-seed.json');
const ERICSSON_SEED_FILE = path.join(DATA_DIR, 'ericsson-seed.json');
const ERICSSON_ENG_SEED_FILE = path.join(DATA_DIR, 'ericsson-engineering-seed.json');
const DEFAULT_ERICSSON_ONEDRIVE_URL =
  'https://onedrive.live.com/:x:/g/personal/d82e752e01e5afdd/IQBkdW7amR5BQLwUz3WVNtySAWRS0ZetSRS24kMBQIjwE4E?rtime=bHml02143kg&redeem=aHR0cHM6Ly8xZHJ2Lm1zL3gvYy9kODJlNzUyZTAxZTVhZmRkL0lRQmtkVzdhbVI1QlFMd1V6M1dWTnR5U0FXUlMwWmV0U1JTMjRrTUJRSWp3RTRFP2U9cjhQT3B5';
const DEFAULT_ERICSSON_ENG_ONEDRIVE_URL =
  'https://onedrive.live.com/:x:/g/personal/d82e752e01e5afdd/IQCOlAu1cXsYS4GTeMznod4DAcUTBaeVfylro6lYCHY4BQY?rtime=lKiFN4Uj30g&redeem=aHR0cHM6Ly8xZHJ2Lm1zL3gvYy9kODJlNzUyZTAxZTVhZmRkL0lRQ09sQXUxY1hzWVM0R1RlTXpub2Q0REFjVVRCYWVWZnlscm82bFlDSFk0QlFZP2U9TzJIbnRI';

const REGIONAL_SUBFOLDERS = [
  'AM - Amazonas',
  'Controle de Endereços dos Sites',
  'DF - Distrito Federal',
  'GO - Goiânia',
  'MS - Mato Grosso do Sul',
  'MT - Mato Grosso',
  'Nordeste TNE',
  'SPI - São Paulo Interior',
];

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(`ameta_salt_${password}`).digest('hex');
}

function getDefaultValidityYearsForDocType(docType: MandatoryDocType): number {
  switch (docType) {
    case 'NR10':
    case 'NR35':
    case 'PGR':
      return 2;
    case 'RG':
      return 10;
    case 'ASO':
    case 'PCMSO':
    case 'PRIMEIROS_SOCORROS':
    case 'CONTRATO_TRABALHO':
    default:
      return 1;
  }
}

function addYearsToIsoDate(isoDate: string, years: number): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return isoDate;
  const d = new Date(parts[0] + years, parts[1] - 1, parts[2]);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeIsoDateCandidate(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim();
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }
  }
  const brMatch = clean.match(/(\d{2})[\/\-.\s](\d{2})[\/\-.\s](\d{4})/);
  if (brMatch) {
    const d = Number(brMatch[1]);
    const m = Number(brMatch[2]);
    const y = Number(brMatch[3]);
    if (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return null;
}

function detectMimeType(fileName: string, fileBase64?: string): string {
  if (fileBase64 && fileBase64.startsWith('data:')) {
    const match = fileBase64.match(/^data:([^;]+);base64,/i);
    if (match && match[1]) return match[1].toLowerCase();
  }
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.txt' || ext === '.csv') return 'text/plain';
  if (ext === '.html' || ext === '.htm') return 'text/html';
  return 'application/pdf';
}

function extractDateFromTextOrFilenameFallback(
  docType: MandatoryDocType,
  fileName: string,
  buffer: Buffer
): { expiresAt: string; source: string } {
  const validityYears = getDefaultValidityYearsForDocType(docType);
  // Extract printable ASCII/Latin1 strings from buffer + fileName
  const rawText = `${fileName} ${buffer.toString('latin1').replace(/[^\x20-\x7EÀ-ÿ\/\-.:]/g, ' ')}`;

  // 1. Look for explicit expiration keywords near a date
  const explicitKeywordRegex =
    /(?:validade|vencimento|v[aá]lido\s+at[eé]|venc\.?|val\.?|vig[eê]ncia\s+at[eé]|pr[oó]ximo\s+exame|expira\s+em)[^0-9]{0,25}(\d{2}[\/\-.]\d{2}[\/\-.]\d{4}|\d{4}-\d{2}-\d{2})/gi;
  let match: RegExpExecArray | null;
  const explicitDates: string[] = [];
  while ((match = explicitKeywordRegex.exec(rawText)) !== null) {
    const iso = normalizeIsoDateCandidate(match[1]);
    if (iso) explicitDates.push(iso);
  }
  if (explicitDates.length > 0) {
    explicitDates.sort();
    const chosen = explicitDates[explicitDates.length - 1];
    return {
      expiresAt: chosen,
      source: 'Data de vencimento lida diretamente do documento',
    };
  }

  // 2. Look for any DD/MM/YYYY or YYYY-MM-DD dates in filename or text
  const allDates: string[] = [];
  const brGlobal = /(\b\d{2}[\/\-.]\d{2}[\/\-.]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b)/g;
  while ((match = brGlobal.exec(rawText)) !== null) {
    const iso = normalizeIsoDateCandidate(match[1]);
    if (iso) {
      const year = Number(iso.slice(0, 4));
      if (year >= 2018 && year <= 2045) {
        allDates.push(iso);
      }
    }
  }

  if (allDates.length > 0) {
    allDates.sort();
    const latestDate = allDates[allDates.length - 1];
    const todayIso = new Date().toISOString().slice(0, 10);
    // If there are multiple dates or the date is in the future, treat latest as expiration
    if (allDates.length >= 2 || latestDate > todayIso) {
      return {
        expiresAt: latestDate,
        source: 'Data identificada automaticamente no documento',
      };
    }
    // Otherwise treat single past/today date as issue date and add regulatory validity
    const computed = addYearsToIsoDate(latestDate, validityYears);
    return {
      expiresAt: computed,
      source: `Calculado automaticamente (+${validityYears} ano${validityYears > 1 ? 's' : ''} a partir da data do documento)`,
    };
  }

  // 3. Fallback: calculate standard validity from today's upload date
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultExpires = addYearsToIsoDate(todayIso, validityYears);
  return {
    expiresAt: defaultExpires,
    source: `Vencimento padrão preenchido automaticamente (+${validityYears} ano${validityYears > 1 ? 's' : ''})`,
  };
}

async function extractExpirationFromDocument(params: {
  docType: MandatoryDocType;
  fileName: string;
  fileBase64: string;
  buffer: Buffer;
}): Promise<{ expiresAt: string; issuedAt?: string; source: string }> {
  const { docType, fileName, fileBase64, buffer } = params;
  const cleanBase64 = fileBase64.includes('base64,')
    ? fileBase64.split('base64,')[1]
    : fileBase64;
  const mimeType = detectMimeType(fileName, fileBase64);
  const validityYears = getDefaultValidityYearsForDocType(docType);
  const supportedGeminiMimes = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/html',
    'text/csv',
  ];

  if (process.env.GEMINI_API_KEY && supportedGeminiMimes.includes(mimeType)) {
    try {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const prompt = `Você é um leitor especialista de documentos trabalhistas e de Segurança do Trabalho (SST) no Brasil.
Analise o documento anexado (Tipo esperado: ${docType}, Nome do arquivo: "${fileName}").
Objetivo: Encontrar a DATA DE VENCIMENTO / VALIDADE deste documento no formato YYYY-MM-DD.
Regras:
1. Se o documento contiver explicitamente uma data de vencimento, validade, "válido até", "vencimento em", "próximo exame" ou "vigência final", retorne essa data exata em "expiresAt" (formato YYYY-MM-DD).
2. Se o documento contiver apenas a data de emissão, realização do exame, conclusão do treinamento ou assinatura (e não tiver data de vencimento explícita), retorne essa data em "issuedAt" (YYYY-MM-DD) e calcule "expiresAt" somando ${validityYears} ano(s) à data de emissão (padrão normativo para ${docType}).
3. Se houver várias datas no documento (por exemplo, data de realização e data de validade), "expiresAt" deve ser a data de validade/vencimento (a data mais futura referente à vigência do documento).
4. Se não houver nenhuma data legível na imagem/PDF, retorne string vazia "" em "expiresAt" e em "issuedAt".`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: cleanBase64,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              expiresAt: {
                type: Type.STRING,
                description: 'Data de vencimento no formato YYYY-MM-DD ou vazio se não encontrado',
              },
              issuedAt: {
                type: Type.STRING,
                description: 'Data de emissão/realização no formato YYYY-MM-DD ou vazio',
              },
              explanation: {
                type: Type.STRING,
                description: 'Breve explicação em português de onde a data foi lida',
              },
            },
            required: ['expiresAt', 'issuedAt', 'explanation'],
          },
        },
      });

      const rawJson = (response.text || '').trim();
      if (rawJson) {
        const parsed = JSON.parse(rawJson) as {
          expiresAt?: string;
          issuedAt?: string;
          explanation?: string;
        };
        const validExpires = normalizeIsoDateCandidate(parsed.expiresAt);
        const validIssued = normalizeIsoDateCandidate(parsed.issuedAt);

        if (validExpires) {
          return {
            expiresAt: validExpires,
            issuedAt: validIssued || undefined,
            source: parsed.explanation || 'Data de vencimento lida automaticamente do documento (IA)',
          };
        }
        if (validIssued) {
          const computed = addYearsToIsoDate(validIssued, validityYears);
          return {
            expiresAt: computed,
            issuedAt: validIssued,
            source:
              parsed.explanation ||
              `Calculado +${validityYears} ano(s) a partir da data de emissão lida (${validIssued})`,
          };
        }
      }
    } catch (err) {
      console.warn('Fallback de leitura de documento ativado:', err);
    }
  }

  return extractDateFromTextOrFilenameFallback(docType, fileName, buffer);
}

export function isValidAmetaDomain(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (isOwnerAdmUser(normalized)) return true;
  const parts = normalized.split('@');
  if (parts.length !== 2 || !parts[0]) return false;
  const domain = parts[1];
  return (
    domain === 'ametaservicos.com.br' ||
    domain.endsWith('.ametaservicos.com.br')
  );
}

function detectFileType(fileName: string): {
  fileType: EngineeringFile['fileType'];
  extension: string;
} {
  const ext = path.extname(fileName).toLowerCase() || '.bin';
  if (ext === '.zip') return { fileType: 'zip', extension: ext };
  if (ext === '.rar') return { fileType: 'rar', extension: ext };
  if (ext === '.7z' || ext === '.tar' || ext === '.gz') return { fileType: '7z', extension: ext };
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv')
    return { fileType: 'excel', extension: ext };
  if (ext === '.pdf') return { fileType: 'pdf', extension: ext };
  if (ext === '.doc' || ext === '.docx') return { fileType: 'word', extension: ext };
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext))
    return { fileType: 'image', extension: ext };
  return { fileType: 'other', extension: ext };
}

function createInitialEngineeringTree(): {
  folders: EngineeringFolder[];
  files: EngineeringFile[];
} {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const now = '2026-09-29T14:00:00.000Z';
  const folders: EngineeringFolder[] = [];

  // Create initial folder tree ONLY for NOKIA (Ericsson is a separate system with its own folders)
  (['NOKIA'] as VendorType[]).forEach((vendor) => {
    const vKey = vendor.toLowerCase();
    const rootId = `folder-${vKey}-vistorias`;

    // Root folder: Vistorias
    folders.push({
      id: rootId,
      parentId: null,
      name: 'Vistorias',
      vendor,
      description:
        'Repositório central de Engenharia para Vistorias Executadas, TSSR Entrada e TSSR (.zip, WinRAR .rar e documentos)',
      createdByName: 'Rafael Araújo',
      createdByEmail: 'rafael.araujo@ametaservicos.com.br',
      createdAt: now,
      isSystem: true,
    });

    const mainCategories = [
      {
        id: `folder-${vKey}-vistorias-executadas`,
        name: 'Vistorias Executadas',
        description:
          'Carregamento de relatórios fotográficos, pacotes .ZIP / WinRAR (.RAR) e checklists de vistorias executadas em campo',
      },
      {
        id: `folder-${vKey}-tssr-entrada`,
        name: 'TSSR Entrada',
        description:
          'Recebimento de pacotes TSSR preliminares de campo (.ZIP, WinRAR .RAR, planilhas e croquis) para validação',
      },
      {
        id: `folder-${vKey}-tssr-final`,
        name: 'TSSR',
        description:
          'Documentação TSSR final revisada, aprovada e liberada pela Engenharia Ameta',
      },
    ];

    mainCategories.forEach((cat) => {
      folders.push({
        id: cat.id,
        parentId: rootId,
        name: cat.name,
        vendor,
        description: cat.description,
        createdByName: 'Rafael Araújo',
        createdByEmail: 'rafael.araujo@ametaservicos.com.br',
        createdAt: now,
        isSystem: true,
      });

      // Regional subfolders ONLY inside "Vistorias Executadas" (TSSR Entrada and TSSR start blank)
      if (cat.name === 'Vistorias Executadas') {
        REGIONAL_SUBFOLDERS.forEach((regName, idx) => {
          const slug = regName
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-');
          folders.push({
            id: `${cat.id}-${slug}-${idx}`,
            parentId: cat.id,
            name: regName,
            vendor,
            description: `Pasta regional ${regName} (${cat.name})`,
            createdByName: 'Rafael Araújo',
            createdByEmail: 'rafael.araujo@ametaservicos.com.br',
            createdAt: now,
            isSystem: false,
          });
        });
      }
    });
  });

  const files: EngineeringFile[] = [];

  return { folders, files };
}

function syncEquipesResourcesToUsers(db: DatabaseSchema): boolean {
  let changed = false;

  // Remove old generic placeholder accounts, test accounts, and duplicate legacy admin account
  const legacySeedEmails = new Set([
    'engenharia@ametaservicos.com.br',
    'noc@ametaservicos.com.br',
    'rafael.araujo@ameta.com.br',
    'teste@ametaservicos.com.br',
    'teste@ameta.com.br',
    'executor.teste@ametaservicos.com.br',
    'coord.geral.tim@ametaservicos.com.br',
    'coord.engenharia.tim@ametaservicos.com.br',
    'coord.geral.ericsson@ametaservicos.com.br',
    'coord.engenharia.ericsson@ametaservicos.com.br',
  ]);
  const beforeLen = db.users.length;
  db.users = db.users.filter(
    (u) => !legacySeedEmails.has(u.email.toLowerCase()) && !u.id.startsWith('usr-recurso-')
  );
  if (db.users.length !== beforeLen) {
    changed = true;
  }

  // Ensure ONLY the single Owner account (Rafael Araújo - rafael.araujo@ametaservicos.com.br) is guaranteed
  const ownerEmail = 'rafael.araujo@ametaservicos.com.br';
  let adminUser = db.users.find((u) => u.email.toLowerCase() === ownerEmail);
  if (!adminUser) {
    db.users.unshift({
      id: 'usr-ameta-servicos-1',
      name: 'Rafael Araújo',
      email: ownerEmail,
      role: 'ADM',
      situacao: 'dono',
      plataforma: 'AMBAS',
      assignedPlatform: 'BOTH',
      accessReleased: true,
      dispensadoDocumentos: true,
      equipe: 'Coordenação / ADM',
      atividade: 'Gestão Geral & Engenharia',
      statusRecurso: 'DISPENSADO',
      emailVerified: true,
      verifiedAt: '2026-09-29T12:00:00.000Z',
      preferredVendor: 'NOKIA',
      createdAt: '2026-09-01T10:00:00.000Z',
      passwordHash: hashPassword('ameta2026'),
    });
    changed = true;
  } else if (
    adminUser.role !== 'ADM' ||
    adminUser.situacao !== 'dono' ||
    !adminUser.equipe
  ) {
    adminUser.role = 'ADM';
    adminUser.situacao = 'dono';
    adminUser.plataforma = 'AMBAS';
    adminUser.assignedPlatform = 'BOTH';
    adminUser.accessReleased = true;
    adminUser.dispensadoDocumentos = true;
    adminUser.equipe = adminUser.equipe || 'Coordenação / ADM';
    adminUser.atividade = adminUser.atividade || 'Gestão Geral & Engenharia';
    adminUser.statusRecurso = 'DISPENSADO';
    changed = true;
  }

  // Normalize any remaining user roles (only Rafael Araújo is ADM) and ensure mandatory 8-document structure on every profile
  db.users.forEach((u) => {
    const norm = isOwnerAdmUser(u.email)
      ? 'ADM'
      : normalizeUserRole(u.role, u.email);
    if (u.role !== norm) {
      u.role = norm;
      changed = true;
    }
    if (!u.assignedPlatform) {
      u.assignedPlatform = isOwnerAdmUser(u.email) ? 'BOTH' : 'NOKIA';
      changed = true;
    }
    if (typeof u.accessReleased !== 'boolean') {
      u.accessReleased = true;
      changed = true;
    }
    if (!Array.isArray(u.documents) || u.documents.length !== 8) {
      u.documents = ensureUserMandatoryDocuments(u.documents);
      changed = true;
    }
    // Clean up any leftover statusOverride === 'VENCIDO' or 'A_VENCER' when both fileName and expiresAt were already removed
    u.documents.forEach((d) => {
      const hasFile = Boolean(d.fileName && d.fileName.trim());
      const hasDate = Boolean(d.expiresAt && d.expiresAt.trim());
      if (
        !hasFile &&
        !hasDate &&
        (d.statusOverride === 'VENCIDO' || d.statusOverride === 'A_VENCER')
      ) {
        d.statusOverride = undefined;
        changed = true;
      }
    });
    const evaluated = evaluateUserOverallDocumentStatus(u);
    if (
      !u.statusRecurso ||
      u.statusRecurso === 'ATIVO' ||
      u.statusRecurso !== evaluated.overallStatus
    ) {
      u.statusRecurso = evaluated.overallStatus;
      changed = true;
    }
  });

  return changed;
}

function ensureEricssonSeedAndUsers(db: DatabaseSchema): boolean {
  let changed = false;

  if (
    (!Array.isArray(db.ericssonRows) || db.ericssonRows.length === 0) &&
    fs.existsSync(ERICSSON_SEED_FILE)
  ) {
    try {
      const seedRaw = JSON.parse(fs.readFileSync(ERICSSON_SEED_FILE, 'utf-8')) as {
        columns?: string[];
        rows?: EricssonRow[];
        users?: Array<Omit<StoredUser, 'passwordHash'>>;
      };
      if (Array.isArray(seedRaw.rows) && seedRaw.rows.length > 0) {
        db.ericssonRows = seedRaw.rows;
        const counters = computeEricssonSiteCounters(db.ericssonRows);
        db.ericssonSheetMeta = {
          id: 'ericsson-sheet-main',
          tabName: 'ERICSSON CLARO TX',
          sourceFileName: 'PLAN. AMETA_Controle EDB.xlsx',
          liveSyncUrl: DEFAULT_ERICSSON_ONEDRIVE_URL,
          lastSyncAt: new Date().toISOString(),
          totalRows: db.ericssonRows.length,
          totalSites: counters.totalSites,
          columns:
            Array.isArray(seedRaw.columns) && seedRaw.columns.length > 0
              ? seedRaw.columns
              : [...ERICSSON_ORIGINAL_COLUMNS],
        };
        changed = true;
      }
    } catch (err) {
      console.error('Failed to load Ericsson seed file:', err);
    }
  }

  if (!Array.isArray(db.ericssonRows)) {
    db.ericssonRows = [];
    changed = true;
  }

  if (!db.ericssonSheetMeta) {
    const counters = computeEricssonSiteCounters(db.ericssonRows);
    db.ericssonSheetMeta = {
      id: 'ericsson-sheet-main',
      tabName: 'ERICSSON CLARO TX',
      sourceFileName: 'PLAN. AMETA_Controle EDB.xlsx',
      liveSyncUrl: DEFAULT_ERICSSON_ONEDRIVE_URL,
      lastSyncAt: new Date().toISOString(),
      totalRows: db.ericssonRows.length,
      totalSites: counters.totalSites,
      columns: [...ERICSSON_ORIGINAL_COLUMNS],
    };
    changed = true;
  }

  if (!Array.isArray(db.ericssonUsers)) {
    db.ericssonUsers = [];
    changed = true;
  }

  // Remove legacy seeded accounts from db.ericssonUsers, keeping only the owner account (plus any real created accounts)
  const legacyEricEmails = new Set([
    'rafael.araujo@ameta.com.br',
    'teste@ametaservicos.com.br',
    'teste@ameta.com.br',
    'coord.geral.ericsson@ametaservicos.com.br',
    'coord.engenharia.ericsson@ametaservicos.com.br',
  ]);
  const beforeEricUsers = db.ericssonUsers.length;
  db.ericssonUsers = db.ericssonUsers.filter(
    (u) => !legacyEricEmails.has(u.email.toLowerCase())
  );
  if (db.ericssonUsers.length !== beforeEricUsers) {
    changed = true;
  }

  // Ensure ONLY the single Owner account exists by default in db.ericssonUsers
  const adminEmail = 'rafael.araujo@ametaservicos.com.br';
  if (!db.ericssonUsers.some((u) => u.email.toLowerCase() === adminEmail)) {
    db.ericssonUsers.unshift({
      id: 'usr-ameta-servicos-1',
      name: 'Rafael Araújo',
      email: adminEmail,
      role: 'ADM',
      situacao: 'dono',
      plataforma: 'AMBAS',
      assignedPlatform: 'BOTH',
      accessReleased: true,
      dispensadoDocumentos: true,
      equipe: 'Coordenação / ADM',
      atividade: 'Gestão Geral & Engenharia',
      statusRecurso: 'DISPENSADO',
      documents: ensureUserMandatoryDocuments([]),
      emailVerified: true,
      verifiedAt: '2026-09-29T12:00:00.000Z',
      preferredVendor: 'ERICSSON',
      createdAt: '2026-09-01T10:00:00.000Z',
      passwordHash: hashPassword('ameta2026'),
    });
    changed = true;
  }

  db.ericssonUsers.forEach((u) => {
    const norm = isOwnerAdmUser(u.email)
      ? 'ADM'
      : normalizeUserRole(u.role, u.email);
    if (u.role !== norm) {
      u.role = norm;
      changed = true;
    }
    if (!u.assignedPlatform) {
      u.assignedPlatform = isOwnerAdmUser(u.email) ? 'BOTH' : 'ERICSSON';
      changed = true;
    }
    if (typeof u.accessReleased !== 'boolean') {
      u.accessReleased = true;
      changed = true;
    }
    if (!Array.isArray(u.documents) || u.documents.length !== 8) {
      u.documents = ensureUserMandatoryDocuments(u.documents);
      changed = true;
    }
  });

  if (!Array.isArray(db.notifications)) {
    db.notifications = [];
    changed = true;
  }

  // Ensure complete isolation between Nokia (engineeringFolders/engineeringFiles) and Ericsson (ericssonFolders/ericssonFiles)
  if (!Array.isArray(db.ericssonFolders)) {
    db.ericssonFolders = [];
    changed = true;
  }
  if (!Array.isArray(db.ericssonFiles)) {
    db.ericssonFiles = [];
    changed = true;
  }

  // Migrate any real Ericsson files that were previously in db.engineeringFiles into db.ericssonFiles
  if (Array.isArray(db.engineeringFiles)) {
    const ericFilesInShared = db.engineeringFiles.filter((fl) => fl.vendor === 'ERICSSON');
    if (ericFilesInShared.length > 0) {
      ericFilesInShared.forEach((fl) => {
        if (!db.ericssonFiles!.some((ef) => ef.id === fl.id)) {
          db.ericssonFiles!.push(fl);
        }
      });
      db.engineeringFiles = db.engineeringFiles.filter((fl) => fl.vendor !== 'ERICSSON');
      changed = true;
    }
  }

  // Remove any Ericsson folders from Nokia's db.engineeringFolders
  if (Array.isArray(db.engineeringFolders)) {
    const beforeSharedFolders = db.engineeringFolders.length;
    db.engineeringFolders = db.engineeringFolders.filter((f) => f.vendor !== 'ERICSSON');
    if (db.engineeringFolders.length !== beforeSharedFolders) {
      changed = true;
    }
  }

  // Purge any replicated Nokia regional/system folders from db.ericssonFolders
  const nokiaReplicatedNames = new Set([
    ...REGIONAL_SUBFOLDERS,
    'Vistorias Executadas',
    'TSSR Entrada',
    'TSSR',
    'Vistorias',
  ]);
  const beforeEricFolders = db.ericssonFolders.length;
  db.ericssonFolders = db.ericssonFolders.filter(
    (f) =>
      f.id === 'folder-ericsson-root' ||
      (!f.id.startsWith('folder-ericsson-vistorias') &&
        !f.id.startsWith('folder-ericsson-tssr') &&
        !nokiaReplicatedNames.has(f.name))
  );
  if (db.ericssonFolders.length !== beforeEricFolders) {
    changed = true;
  }

  // Ensure the clean Ericsson root folder exists
  if (!db.ericssonFolders.some((f) => f.id === 'folder-ericsson-root')) {
    db.ericssonFolders.unshift({
      id: 'folder-ericsson-root',
      parentId: null,
      name: 'Vistoria Ericsson',
      vendor: 'ERICSSON',
      description: 'Repositório exclusivo de Vistoria e LOS do sistema Ericsson',
      createdByName: 'Rafael Araújo',
      createdByEmail: 'rafael.araujo@ametaservicos.com.br',
      createdAt: '2026-09-29T14:00:00.000Z',
      isSystem: true,
    });
    changed = true;
  }

  // Ensure any custom Ericsson folders have valid parentId pointing to folder-ericsson-root or another valid Ericsson folder
  const validEricFolderIds = new Set(db.ericssonFolders.map((f) => f.id));
  db.ericssonFolders.forEach((f) => {
    if (f.id !== 'folder-ericsson-root' && (!f.parentId || !validEricFolderIds.has(f.parentId))) {
      f.parentId = 'folder-ericsson-root';
      changed = true;
    }
  });

  // Ensure any existing Ericsson files point to a valid Ericsson folder (defaulting to folder-ericsson-root)
  db.ericssonFiles.forEach((fl) => {
    if (!fl.folderId || !validEricFolderIds.has(fl.folderId)) {
      fl.folderId = 'folder-ericsson-root';
      changed = true;
    }
  });

  // Ensure Ericsson Engenharia seed is loaded from ERICSSON_ENG_SEED_FILE
  if (
    (!Array.isArray(db.ericsson_engenharia) || db.ericsson_engenharia.length === 0) &&
    fs.existsSync(ERICSSON_ENG_SEED_FILE)
  ) {
    try {
      const engSeedRaw = JSON.parse(fs.readFileSync(ERICSSON_ENG_SEED_FILE, 'utf-8')) as {
        columns?: string[];
        rows?: EricssonEngineeringRow[];
        sourceFileName?: string;
        tabName?: string;
        liveSyncUrl?: string;
      };
      if (Array.isArray(engSeedRaw.rows) && engSeedRaw.rows.length > 0) {
        db.ericsson_engenharia = engSeedRaw.rows;
        db.ericsson_engenharia_meta = {
          id: 'ericsson-eng-sheet-main',
          tabName: engSeedRaw.tabName || 'Site list',
          sourceFileName: engSeedRaw.sourceFileName || 'AMETA_REPORT DOCUMENTACAO_PLANEJAMENTO_WXX.xlsx',
          liveSyncUrl: engSeedRaw.liveSyncUrl || DEFAULT_ERICSSON_ENG_ONEDRIVE_URL,
          lastSyncAt: new Date().toISOString(),
          totalRows: db.ericsson_engenharia.length,
          columns: Array.isArray(engSeedRaw.columns) && engSeedRaw.columns.length > 0
            ? engSeedRaw.columns
            : [...ERICSSON_SITE_LIST_COLUMNS],
        };
        changed = true;
      }
    } catch (err) {
      console.error('Failed to load Ericsson Engineering seed file:', err);
    }
  }

  if (!Array.isArray(db.ericsson_engenharia)) {
    db.ericsson_engenharia = [];
    changed = true;
  }

  if (!Array.isArray(db.ericsson_colaboradores) || db.ericsson_colaboradores.length === 0) {
    db.ericsson_colaboradores = [...DEFAULT_ERICSSON_COLABORADORES];
    changed = true;
  }

  return changed;
}

function loadDatabase(): DatabaseSchema {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const seedTree = createInitialEngineeringTree();

  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as DatabaseSchema;
      const hasControleGeral =
        parsed &&
        Array.isArray(parsed.sheets) &&
        parsed.sheets.some((s) => s.name === 'Controle Geral' && Array.isArray(s.columns));

      if (parsed && Array.isArray(parsed.sites) && Array.isArray(parsed.users) && hasControleGeral) {
        let needsSave = false;
        if (
          !Array.isArray(parsed.engineeringFolders) ||
          parsed.engineeringFolders.length === 0
        ) {
          parsed.engineeringFolders = seedTree.folders;
          needsSave = true;
        } else {
          // Ensure pre-seeded regional folders inside TSSR Entrada and TSSR are removed so they stay blank
          const beforeCount = parsed.engineeringFolders.length;
          parsed.engineeringFolders = parsed.engineeringFolders.filter(
            (f) =>
              !(
                (f.parentId?.endsWith('-tssr-entrada') ||
                  f.parentId?.endsWith('-tssr-final')) &&
                f.id.startsWith('folder-') &&
                REGIONAL_SUBFOLDERS.includes(f.name)
              )
          );
          if (parsed.engineeringFolders.length !== beforeCount) {
            needsSave = true;
          }
        }
        if (!Array.isArray(parsed.engineeringFiles)) {
          parsed.engineeringFiles = seedTree.files;
          needsSave = true;
        } else {
          // Remove initial seed files from TSSR Entrada and TSSR so they start blank
          const beforeFiles = parsed.engineeringFiles.length;
          parsed.engineeringFiles = parsed.engineeringFiles.filter(
            (fl) => !fl.id.startsWith('file-seed-')
          );
          if (parsed.engineeringFiles.length !== beforeFiles) {
            needsSave = true;
          }
        }

        // Ensure each registered Executor has their designated folder inside TSSR and TSSR Entrada
        const executorsSet = new Set<string>();
        parsed.users.forEach((u) => {
          if (normalizeUserRole(u.role) === 'Executor' && u.name) {
            executorsSet.add(u.name.trim());
          }
        });
        if (Array.isArray(parsed.tssrRows)) {
          parsed.tssrRows.forEach((r) => {
            const ex = (r.fields?.['Executor'] || '').trim();
            if (ex) executorsSet.add(ex);
          });
        }
        ['NOKIA', 'ERICSSON'].forEach((v) => {
          const vKey = v.toLowerCase();
          ['tssr-final', 'tssr-entrada'].forEach((subKey) => {
            const parentId = `folder-${vKey}-${subKey}`;
            const parentFolder = parsed.engineeringFolders.find((f) => f.id === parentId);
            if (!parentFolder) return;
            executorsSet.forEach((execName) => {
              const exists = parsed.engineeringFolders.some(
                (f) =>
                  f.vendor === v &&
                  f.parentId === parentId &&
                  (f.name.toLowerCase() === execName.toLowerCase() ||
                    (f.assignedTo && f.assignedTo.toLowerCase() === execName.toLowerCase()))
              );
              if (!exists) {
                parsed.engineeringFolders.push({
                  id: `folder-tssr-exec-${vKey}-${subKey}-${execName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                  parentId,
                  name: execName,
                  vendor: v as VendorType,
                  assignedTo: execName,
                  description: `Pasta de TSSR liberada para o executor ${execName}`,
                  createdByName: 'Gestor da Engenharia',
                  createdByEmail: 'rafael.araujo@ametaservicos.com.br',
                  createdAt: new Date().toISOString(),
                  isSystem: false,
                });
                needsSave = true;
              }
            });
          });
        });

        // Sync all registered Equipes resources and normalize user roles to ADM, Executor, Vistoriador
        if (syncEquipesResourcesToUsers(parsed)) {
          needsSave = true;
        }

        // If no site has isNew property initialized yet, mark the first 5 Controle Geral sites as newly entered
        const hasAnyIsNewDefined = parsed.sites.some((s) => typeof s.isNew === 'boolean');
        if (!hasAnyIsNewDefined) {
          let marked = 0;
          parsed.sites.forEach((s) => {
            if (s.sheetName === 'Controle Geral' && marked < 5) {
              s.isNew = true;
              s.createdAt = new Date().toISOString();
              marked++;
            } else {
              s.isNew = false;
            }
          });
          needsSave = true;
        }

        if (needsSave) {
          saveDatabase(parsed);
        }
        // Ensure TSSR TIM Nokia rows are initialized from seed if empty
        if (!Array.isArray(parsed.tssrRows) || parsed.tssrRows.length === 0) {
          if (fs.existsSync(TSSR_SEED_FILE)) {
            try {
              parsed.tssrRows = JSON.parse(fs.readFileSync(TSSR_SEED_FILE, 'utf-8')) as TssrRow[];
              parsed.tssrSheets = [
                {
                  id: 'tssr-sheet-nokia-1',
                  vendor: 'NOKIA',
                  tabName: 'TSSR TIM Nokia',
                  sourceFileName: 'CONTROLE TSSR (OneDrive)',
                  lastSyncAt: new Date().toISOString(),
                  totalRows: parsed.tssrRows.length,
                },
              ];
              saveDatabase(parsed);
            } catch {
              parsed.tssrRows = [];
              parsed.tssrSheets = [];
            }
          } else {
            parsed.tssrRows = [];
            parsed.tssrSheets = [];
          }
        }
        if (!Array.isArray(parsed.tssrSheets)) {
          parsed.tssrSheets = [];
        }
        if (ensureEricssonSeedAndUsers(parsed)) {
          saveDatabase(parsed);
        }
        return parsed;
      }
    } catch (err) {
      console.error('Error reading database file, re-initializing default seed:', err);
    }
  }

  let initialTssrRows: TssrRow[] = [];
  if (fs.existsSync(TSSR_SEED_FILE)) {
    try {
      initialTssrRows = JSON.parse(fs.readFileSync(TSSR_SEED_FILE, 'utf-8')) as TssrRow[];
    } catch {
      initialTssrRows = [];
    }
  }

  const defaultUsers: StoredUser[] = [
    {
      id: 'usr-ameta-servicos-1',
      name: 'Rafael Araújo',
      email: 'rafael.araujo@ametaservicos.com.br',
      role: 'ADM',
      situacao: 'dono',
      plataforma: 'AMBAS',
      assignedPlatform: 'BOTH',
      accessReleased: true,
      dispensadoDocumentos: true,
      equipe: 'Coordenação / ADM',
      atividade: 'Gestão Geral & Engenharia',
      statusRecurso: 'DISPENSADO',
      emailVerified: true,
      verifiedAt: '2026-09-29T12:00:00.000Z',
      preferredVendor: 'NOKIA',
      createdAt: '2026-09-01T10:00:00.000Z',
      passwordHash: hashPassword('ameta2026'),
    },
  ];

  const initialDb: DatabaseSchema = {
    users: defaultUsers,
    sites: INITIAL_SITES,
    sheets: INITIAL_SHEETS,
    engineeringFolders: seedTree.folders,
    engineeringFiles: seedTree.files,
    tssrRows: initialTssrRows,
    tssrSheets: [
      {
        id: 'tssr-sheet-nokia-1',
        vendor: 'NOKIA',
        tabName: 'TSSR TIM Nokia',
        sourceFileName: 'CONTROLE TSSR (OneDrive)',
        lastSyncAt: new Date().toISOString(),
        totalRows: initialTssrRows.length,
      },
    ],
    lastUpdated: new Date().toISOString(),
  };

  syncEquipesResourcesToUsers(initialDb);
  ensureEricssonSeedAndUsers(initialDb);
  saveDatabase(initialDb);
  return initialDb;
}

function saveDatabase(db: DatabaseSchema): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  db.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

function sanitizeUser(user: StoredUser): AmetaUser {
  const { passwordHash: _omitted, ...safeUser } = user;
  return safeUser;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Support up to 80MB payloads for .zip and WinRAR (.rar) uploads
  app.use(express.json({ limit: '80mb' }));

  const db = loadDatabase();

  // Connected SSE clients for instant real-time updates
  const sseClients = new Set<express.Response>();

  function broadcastUpdate(eventPayload: Record<string, unknown>) {
    const message = JSON.stringify({
      ...eventPayload,
      sites: db.sites,
      sheets: db.sheets,
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
      tssrRows: db.tssrRows || [],
      tssrSheets: db.tssrSheets || [],
      ericssonRows: db.ericssonRows || [],
      ericssonSheetMeta: db.ericssonSheetMeta,
      ericssonFolders: db.ericssonFolders || [],
      ericssonFiles: db.ericssonFiles || [],
      ericssonUsers: (db.ericssonUsers || []).map(sanitizeUser),
      ericsson_engenharia: db.ericsson_engenharia || [],
      ericsson_engenharia_meta: db.ericsson_engenharia_meta,
      ericsson_colaboradores: db.ericsson_colaboradores || DEFAULT_ERICSSON_COLABORADORES,
      ericssonExecutorEmailsMap: db.ericssonExecutorEmailsMap || {},
      ericssonDuplaEmailsMap: db.ericssonDuplaEmailsMap || {},
      users: db.users.map(sanitizeUser),
      duplaEmailsMap: db.duplaEmailsMap || {},
      executorEmailsMap: db.executorEmailsMap || {},
      notifications: db.notifications || [],
      lastUpdated: db.lastUpdated,
    });
    for (const client of sseClients) {
      try {
        client.write(`data: ${message}\n\n`);
        (client as unknown as { flush?: () => void }).flush?.();
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // ===================== AUTHENTICATION & @AMETA EMAIL VERIFICATION =====================

  app.post('/api/auth/register', (req, res) => {
    const { name, email, password, role, equipe, telefone, plataforma } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: AmetaUser['role'];
      equipe?: string;
      telefone?: string;
      plataforma?: AssignedPlatformScope;
    };

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Preencha nome completo, e-mail corporativo e senha.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidAmetaDomain(normalizedEmail)) {
      res.status(403).json({
        error:
          'Domínio não autorizado. Utilize exclusivamente e-mail corporativo do domínio @ametaservicos.com.br.',
      });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'A senha deve possuir no mínimo 8 caracteres.' });
      return;
    }

    const isOwner = isOwnerAdmUser(normalizedEmail);
    const cleanEquipe = (equipe || '').trim();
    const cleanTelefone = (telefone || '').trim();
    const chosenPlatform: AssignedPlatformScope = isOwner
      ? 'BOTH'
      : plataforma && ['NOKIA', 'ERICSSON', 'BOTH'].includes(plataforma)
        ? plataforma
        : 'NOKIA';

    const existing = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (existing) {
      existing.name = name.trim() || existing.name;
      existing.passwordHash = hashPassword(password);
      existing.emailVerified = true;
      if (cleanEquipe) existing.equipe = cleanEquipe;
      if (cleanTelefone) existing.telefone = cleanTelefone;
      if (isOwner) {
        existing.role = 'ADM';
        existing.situacao = 'dono';
        existing.plataforma = 'BOTH';
        existing.assignedPlatform = 'BOTH';
        existing.accessReleased = true;
      } else if (!existing.situacao) {
        existing.situacao = existing.accessReleased ? 'ativo' : 'aguardando';
      }
      saveDatabase(db);
      broadcastUpdate({
        type: 'USER_REGISTERED',
        timestamp: new Date().toISOString(),
        summary: isOwner
          ? `Conta do Dono atualizada: ${existing.name}`
          : `Solicitação de acesso recebida: ${existing.name} (${normalizedEmail})`,
      });
      res.status(200).json({
        user: sanitizeUser(existing),
        requiresVerification: false,
        message: isOwner
          ? 'Acesso de Dono liberado.'
          : `Solicitação enviada! Aguarde a liberação do Administrador (${normalizedEmail}).`,
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const newUser: StoredUser = {
      id: `usr-${Date.now()}`,
      name: name.trim(),
      email: normalizedEmail,
      situacao: isOwner ? 'dono' : 'aguardando',
      role: normalizeUserRole(isOwner ? 'ADM' : role || 'Vistoriador', normalizedEmail),
      plataforma: chosenPlatform,
      assignedPlatform: chosenPlatform,
      accessReleased: isOwner,
      equipe: isOwner ? 'Coordenação / ADM' : cleanEquipe || name.trim(),
      telefone: cleanTelefone,
      emailVerified: true,
      verifiedAt: nowIso,
      createdAt: nowIso,
      passwordHash: hashPassword(password),
    };

    db.users.push(newUser);
    if (!isOwner) {
      pushNotification(db, {
        type: 'PERMISSAO_LIBERADA_ADM',
        vendor: chosenPlatform === 'ERICSSON' ? 'ERICSSON' : 'NOKIA',
        title: `Nova Solicitação de Acesso: ${newUser.name}`,
        message: `${newUser.name} (${normalizedEmail}) solicitou cadastro no sistema como ${newUser.role}${cleanEquipe ? ` — Dupla/Equipe: ${cleanEquipe}` : ''}. Acesse o Painel de Liberação para aprovar.`,
        actorName: newUser.name,
        actorEmail: normalizedEmail,
        actorRole: newUser.role,
        targetRoles: ['ADM'],
        targetEmails: ['rafael.araujo@ametaservicos.com.br'],
      });
    }
    saveDatabase(db);
    broadcastUpdate({
      type: 'USER_REGISTERED',
      timestamp: nowIso,
      summary: `Nova solicitação de acesso: ${newUser.name} (${normalizedEmail})`,
    });

    res.status(201).json({
      user: sanitizeUser(newUser),
      requiresVerification: false,
      message: `Cadastro concluído! Sua solicitação foi enviada para liberação do Dono.`,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: 'Informe seu e-mail @ametaservicos.com.br e senha.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    let user =
      db.users.find((u) => u.email.toLowerCase() === normalizedEmail) ||
      (db.ericssonUsers || []).find((u) => u.email.toLowerCase() === normalizedEmail);

    if (!user && !isValidAmetaDomain(normalizedEmail)) {
      res.status(403).json({
        error:
          'Acesso bloqueado: Utilize exclusivamente um e-mail corporativo do domínio @ametaservicos.com.br.',
      });
      return;
    }

    if (!user && isOwnerAdmUser(normalizedEmail)) {
      user = {
        id: `usr-adm-${Date.now()}`,
        name: 'Rafael Araújo',
        email: normalizedEmail,
        situacao: 'dono',
        role: 'ADM',
        plataforma: 'BOTH',
        assignedPlatform: 'BOTH',
        accessReleased: true,
        equipe: 'Coordenação / ADM',
        atividade: 'Gestão Geral & Engenharia',
        statusRecurso: 'ATIVO',
        emailVerified: true,
        verifiedAt: new Date().toISOString(),
        preferredVendor: 'NOKIA',
        createdAt: new Date().toISOString(),
        passwordHash: hashPassword(password),
      };
      db.users.unshift(user);
      saveDatabase(db);
    }

    const isTestAccountLogin =
      isOwnerAdmUser(normalizedEmail) &&
      password.length >= 6;

    if (!user) {
      res.status(401).json({
        error: 'Nenhuma conta encontrada com este e-mail. Clique em "Criar Conta" para se cadastrar.',
      });
      return;
    }

    if (!isTestAccountLogin && user.passwordHash && user.passwordHash !== hashPassword(password)) {
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }

    if (!user.emailVerified) {
      if (!user.verificationCode) {
        user.verificationCode = String(Math.floor(100000 + Math.random() * 900000));
        saveDatabase(db);
      }
      res.status(200).json({
        user: sanitizeUser(user),
        requiresVerification: true,
        verificationCode: user.verificationCode,
        message: 'Verificação de e-mail pendente para liberar o acesso às planilhas.',
      });
      return;
    }

    res.status(200).json({
      user: sanitizeUser(user),
      requiresVerification: false,
    });
  });

  app.post('/api/auth/verify-email', (req, res) => {
    const { email, code } = req.body as { email?: string; code?: string };

    if (!email || !code) {
      res.status(400).json({ error: 'Informe o e-mail e o código de verificação de 6 dígitos.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    if (user.verificationCode !== code.trim()) {
      res.status(400).json({ error: 'Código de verificação inválido. Confira os 6 dígitos informados.' });
      return;
    }

    user.emailVerified = true;
    user.verifiedAt = new Date().toISOString();
    delete user.verificationCode;
    saveDatabase(db);

    res.status(200).json({
      user: sanitizeUser(user),
      message: 'E-mail corporativo @ameta verificado com sucesso!',
    });
  });

  app.post('/api/auth/resend-code', (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(400).json({ error: 'Informe o e-mail @ameta.' });
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (!user) {
      res.status(404).json({ error: 'Conta @ameta não encontrada.' });
      return;
    }

    const newCode = String(Math.floor(100000 + Math.random() * 900000));
    user.verificationCode = newCode;
    saveDatabase(db);

    res.status(200).json({
      verificationCode: newCode,
      message: `Novo código de verificação gerado para ${normalizedEmail}.`,
    });
  });

  app.patch('/api/auth/preference', (req, res) => {
    const { email, preferredVendor } = req.body as {
      email?: string;
      preferredVendor?: VendorType;
    };
    if (!email || !preferredVendor) {
      res.status(400).json({ error: 'Parâmetros inválidos.' });
      return;
    }
    const user = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (user) {
      user.preferredVendor = preferredVendor;
      saveDatabase(db);
      res.json({ user: sanitizeUser(user) });
      return;
    }
    res.status(404).json({ error: 'Usuário não encontrado.' });
  });

  // ===================== REAL-TIME STREAM (SSE) & DATA ENDPOINTS =====================

  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    sseClients.add(res);

    res.write(
      `data: ${JSON.stringify({
        type: 'FULL_STATE',
        timestamp: new Date().toISOString(),
        sites: db.sites,
        sheets: db.sheets,
        engineeringFolders: db.engineeringFolders,
        engineeringFiles: db.engineeringFiles,
        tssrRows: db.tssrRows || [],
        tssrSheets: db.tssrSheets || [],
        ericssonRows: db.ericssonRows || [],
        ericssonSheetMeta: db.ericssonSheetMeta,
        ericssonFolders: db.ericssonFolders || [],
        ericssonFiles: db.ericssonFiles || [],
        ericssonUsers: (db.ericssonUsers || []).map(sanitizeUser),
        ericsson_engenharia: db.ericsson_engenharia || [],
        ericsson_engenharia_meta: db.ericsson_engenharia_meta,
        ericsson_colaboradores: db.ericsson_colaboradores || DEFAULT_ERICSSON_COLABORADORES,
        ericssonExecutorEmailsMap: db.ericssonExecutorEmailsMap || {},
        ericssonDuplaEmailsMap: db.ericssonDuplaEmailsMap || {},
        users: db.users.map(sanitizeUser),
        notifications: db.notifications || [],
        duplaEmailsMap: db.duplaEmailsMap || {},
        executorEmailsMap: db.executorEmailsMap || {},
        lastUpdated: db.lastUpdated,
      })}\n\n`
    );
    (res as unknown as { flush?: () => void }).flush?.();

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
        (res as unknown as { flush?: () => void }).flush?.();
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  app.get('/api/state', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      sites: db.sites,
      sheets: db.sheets,
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
      tssrRows: db.tssrRows || [],
      tssrSheets: db.tssrSheets || [],
      ericssonRows: db.ericssonRows || [],
      ericssonSheetMeta: db.ericssonSheetMeta,
      ericssonFolders: db.ericssonFolders || [],
      ericssonFiles: db.ericssonFiles || [],
      ericssonUsers: (db.ericssonUsers || []).map(sanitizeUser),
      ericsson_engenharia: db.ericsson_engenharia || [],
      ericsson_engenharia_meta: db.ericsson_engenharia_meta,
      ericsson_colaboradores: db.ericsson_colaboradores || DEFAULT_ERICSSON_COLABORADORES,
      ericssonExecutorEmailsMap: db.ericssonExecutorEmailsMap || {},
      ericssonDuplaEmailsMap: db.ericssonDuplaEmailsMap || {},
      users: db.users.map(sanitizeUser),
      notifications: db.notifications || [],
      duplaEmailsMap: db.duplaEmailsMap || {},
      executorEmailsMap: db.executorEmailsMap || {},
      lastUpdated: db.lastUpdated,
      activeConnections: sseClients.size,
    });
  });

  // ===================== NOTIFICATIONS & OWNER ADM PERMISSIONS PANEL =====================

  app.post('/api/notifications/mark-read', (req, res) => {
    const { email, notificationId, markAll } = req.body as {
      email?: string;
      notificationId?: string;
      markAll?: boolean;
    };
    if (!email || !email.trim()) {
      res.status(400).json({ error: 'E-mail do usuário é obrigatório.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!Array.isArray(db.notifications)) db.notifications = [];

    db.notifications.forEach((n) => {
      if (markAll || n.id === notificationId) {
        if (!Array.isArray(n.readByEmails)) n.readByEmails = [];
        if (!n.readByEmails.includes(cleanEmail)) {
          n.readByEmails.push(cleanEmail);
        }
      }
    });

    saveDatabase(db);
    res.json({ notifications: db.notifications });
  });

  app.delete('/api/notifications/:id', (req, res) => {
    const { id } = req.params;
    if (!Array.isArray(db.notifications)) db.notifications = [];
    db.notifications = db.notifications.filter((n) => n.id !== id);
    saveDatabase(db);
    broadcastUpdate({
      type: 'NOTIFICATION_DELETED',
      timestamp: new Date().toISOString(),
      summary: 'Notificação removida',
    });
    res.json({ notifications: db.notifications });
  });

  // Exclusive ADM Dono endpoint to assign role (Coordenador Geral, Coordenador Engenharia, Executor, Vistoriador), platform (NOKIA / ERICSSON / BOTH), and release access
  app.post('/api/owner/permissions/release', (req, res) => {
    const {
      ownerEmail,
      userId,
      email,
      name,
      password,
      role,
      assignedPlatform = 'NOKIA',
      equipe,
      telefone,
      atividade,
      accessReleased = true,
    } = req.body as {
      ownerEmail?: string;
      userId?: string;
      email?: string;
      name?: string;
      password?: string;
      role?: UserRole;
      assignedPlatform?: AssignedPlatformScope;
      equipe?: string;
      telefone?: string;
      atividade?: string;
      accessReleased?: boolean;
    };

    if (!isOwnerAdmUser(ownerEmail)) {
      res.status(403).json({
        error: 'Acesso restrito: Apenas o ADM Dono (Rafael Araújo) pode liberar permissões e definir cargos.',
      });
      return;
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail && !userId) {
      res.status(400).json({ error: 'Informe o usuário ou e-mail para liberar a permissão.' });
      return;
    }

    const allowedRoles: UserRole[] = [
      'Coordenador Geral',
      'Coordenador Engenharia',
      'Executor',
      'Vistoriador',
    ];
    // Only the Owner can be ADM
    const targetIsOwner = isOwnerAdmUser(cleanEmail);
    const finalRole: UserRole = targetIsOwner
      ? 'ADM'
      : role && allowedRoles.includes(role)
      ? role
      : 'Executor';

    const finalPlatform: AssignedPlatformScope = targetIsOwner
      ? 'BOTH'
      : assignedPlatform && ['NOKIA', 'ERICSSON', 'BOTH'].includes(assignedPlatform)
      ? assignedPlatform
      : 'NOKIA';

    const now = new Date().toISOString();
    if (!Array.isArray(db.ericssonUsers)) db.ericssonUsers = [];

    const existingNokia = db.users.find(
      (u) => (userId && u.id === userId) || (cleanEmail && u.email.toLowerCase() === cleanEmail)
    );
    const existingEric = db.ericssonUsers.find(
      (u) => (userId && u.id === userId) || (cleanEmail && u.email.toLowerCase() === cleanEmail)
    );
    const baseUser = existingNokia || existingEric;

    const resolvedEmail = cleanEmail || baseUser?.email.toLowerCase() || '';
    const resolvedName = (name || baseUser?.name || resolvedEmail.split('@')[0]).trim();
    const resolvedEquipe =
      typeof equipe === 'string' && equipe.trim()
        ? equipe.trim()
        : baseUser?.equipe && baseUser.equipe !== 'Campo / Execução'
          ? baseUser.equipe
          : finalRole.includes('Coordenador')
            ? `Coordenação ${finalPlatform}`
            : resolvedName;
    const resolvedTelefone =
      typeof telefone === 'string' ? telefone.trim() : baseUser?.telefone || '';
    const resolvedAtividade =
      typeof atividade === 'string' && atividade.trim()
        ? atividade.trim()
        : finalRole === 'Coordenador Geral'
        ? 'Coordenação Geral (Todas as Planilhas)'
        : finalRole === 'Coordenador Engenharia'
        ? 'Coordenação de Engenharia & Vistoria'
        : finalRole === 'Executor'
        ? 'Execução de Sites & Envio de TSSR'
        : 'Vistoria de Campo';
    const resolvedPasswordHash =
      password && password.trim().length >= 4
        ? hashPassword(password.trim())
        : baseUser?.passwordHash || hashPassword('ameta2026');

    // Update or insert into Nokia (TIM) users if platform is NOKIA or BOTH
    if (finalPlatform === 'NOKIA' || finalPlatform === 'BOTH') {
      if (existingNokia) {
        existingNokia.name = resolvedName;
        existingNokia.role = finalRole;
        existingNokia.situacao = targetIsOwner
          ? 'dono'
          : Boolean(accessReleased)
            ? 'ativo'
            : 'bloqueado';
        existingNokia.plataforma = finalPlatform;
        existingNokia.assignedPlatform = finalPlatform;
        existingNokia.accessReleased = Boolean(accessReleased);
        existingNokia.releasedByEmail = ownerEmail?.trim();
        existingNokia.releasedAt = now;
        existingNokia.equipe = resolvedEquipe;
        existingNokia.telefone = resolvedTelefone;
        existingNokia.atividade = resolvedAtividade;
        existingNokia.preferredVendor = 'NOKIA';
        if (password && password.trim().length >= 4) {
          existingNokia.passwordHash = resolvedPasswordHash;
        }
      } else {
        db.users.unshift({
          id: baseUser?.id || `usr-${Date.now()}`,
          name: resolvedName,
          email: resolvedEmail,
          situacao: targetIsOwner ? 'dono' : Boolean(accessReleased) ? 'ativo' : 'bloqueado',
          role: finalRole,
          plataforma: finalPlatform,
          assignedPlatform: finalPlatform,
          accessReleased: Boolean(accessReleased),
          releasedByEmail: ownerEmail?.trim(),
          releasedAt: now,
          equipe: resolvedEquipe,
          telefone: resolvedTelefone,
          atividade: resolvedAtividade,
          statusRecurso: baseUser?.statusRecurso || 'VALIDADO',
          dispensadoDocumentos:
            baseUser?.dispensadoDocumentos ?? finalRole.includes('Coordenador'),
          documents: ensureUserMandatoryDocuments(baseUser?.documents),
          emailVerified: true,
          verifiedAt: now,
          preferredVendor: 'NOKIA',
          createdAt: baseUser?.createdAt || now,
          passwordHash: resolvedPasswordHash,
        });
      }
    } else if (existingNokia && !isOwnerAdmUser(existingNokia.email)) {
      // Keep record in db.users with assignedPlatform = 'ERICSSON' so login and simulation work seamlessly
      existingNokia.name = resolvedName;
      existingNokia.role = finalRole;
      existingNokia.situacao = Boolean(accessReleased) ? 'ativo' : 'bloqueado';
      existingNokia.plataforma = 'ERICSSON';
      existingNokia.assignedPlatform = 'ERICSSON';
      existingNokia.accessReleased = Boolean(accessReleased);
      existingNokia.releasedByEmail = ownerEmail?.trim();
      existingNokia.releasedAt = now;
      existingNokia.equipe = resolvedEquipe;
      existingNokia.telefone = resolvedTelefone;
      existingNokia.atividade = resolvedAtividade;
      existingNokia.preferredVendor = 'ERICSSON';
    }

    // Update or insert into Ericsson users if platform is ERICSSON or BOTH
    if (finalPlatform === 'ERICSSON' || finalPlatform === 'BOTH') {
      if (existingEric) {
        existingEric.name = resolvedName;
        existingEric.role = finalRole;
        existingEric.assignedPlatform = finalPlatform;
        existingEric.accessReleased = Boolean(accessReleased);
        existingEric.releasedByEmail = ownerEmail?.trim();
        existingEric.releasedAt = now;
        existingEric.equipe = resolvedEquipe;
        existingEric.telefone = resolvedTelefone;
        existingEric.atividade = resolvedAtividade;
        existingEric.preferredVendor = 'ERICSSON';
        if (password && password.trim().length >= 4) {
          existingEric.passwordHash = resolvedPasswordHash;
        }
      } else {
        db.ericssonUsers.unshift({
          id: baseUser?.id ? `eric-${baseUser.id}` : `eric-usr-${Date.now()}`,
          name: resolvedName,
          email: resolvedEmail,
          role: finalRole,
          assignedPlatform: finalPlatform,
          accessReleased: Boolean(accessReleased),
          releasedByEmail: ownerEmail?.trim(),
          releasedAt: now,
          equipe: resolvedEquipe,
          telefone: resolvedTelefone,
          atividade: resolvedAtividade,
          statusRecurso: baseUser?.statusRecurso || 'VALIDADO',
          dispensadoDocumentos:
            baseUser?.dispensadoDocumentos ?? finalRole.includes('Coordenador'),
          documents: ensureUserMandatoryDocuments(baseUser?.documents),
          emailVerified: true,
          verifiedAt: now,
          preferredVendor: 'ERICSSON',
          createdAt: baseUser?.createdAt || now,
          passwordHash: resolvedPasswordHash,
        });
      }
    } else if (existingEric && !isOwnerAdmUser(existingEric.email)) {
      existingEric.name = resolvedName;
      existingEric.role = finalRole;
      existingEric.assignedPlatform = 'NOKIA';
      existingEric.accessReleased = Boolean(accessReleased);
      existingEric.releasedByEmail = ownerEmail?.trim();
      existingEric.releasedAt = now;
      existingEric.equipe = resolvedEquipe;
      existingEric.telefone = resolvedTelefone;
      existingEric.atividade = resolvedAtividade;
      existingEric.preferredVendor = 'NOKIA';
    }

    // Automatically feed Duplas & Demanda (duplaEmailsMap) when a non-owner collaborator is released
    if (!targetIsOwner && Boolean(accessReleased) && resolvedEmail) {
      const duplaKey =
        resolvedEquipe &&
        !resolvedEquipe.startsWith('Coordenação') &&
        resolvedEquipe !== 'Ameta Telecom' &&
        resolvedEquipe !== 'Campo / Engenharia'
          ? resolvedEquipe
          : !finalRole.includes('Coordenador')
            ? resolvedName
            : '';
      if (duplaKey) {
        if (!db.duplaEmailsMap) db.duplaEmailsMap = {};
        const prevEmails = Array.isArray(db.duplaEmailsMap[duplaKey])
          ? db.duplaEmailsMap[duplaKey]
          : [];
        if (!prevEmails.some((e) => e.toLowerCase() === resolvedEmail)) {
          db.duplaEmailsMap[duplaKey] = [...prevEmails, resolvedEmail];
        }
      }
    }

    const platformLabel =
      finalPlatform === 'NOKIA'
        ? 'TIM / Nokia'
        : finalPlatform === 'ERICSSON'
        ? 'Ericsson'
        : 'TIM/Nokia & Ericsson';

    pushNotification(db, {
      type: 'PERMISSAO_LIBERADA_ADM',
      vendor: finalPlatform === 'ERICSSON' ? 'ERICSSON' : 'NOKIA',
      title: `Permissão Liberada: ${finalRole} (${platformLabel})`,
      message: `O ADM Dono (Rafael Araújo) configurou e liberou o acesso de ${resolvedName} como ${finalRole} na plataforma ${platformLabel}.`,
      actorName: 'Rafael Araújo (ADM Dono)',
      actorEmail: ownerEmail || 'rafael.araujo@ametaservicos.com.br',
      actorRole: 'ADM',
      targetRoles: [finalRole, 'ADM'],
      targetEmails: [resolvedEmail],
      targetEquipes: resolvedEquipe ? [resolvedEquipe] : [],
    });

    saveDatabase(db);
    broadcastUpdate({
      type: 'PERMISSIONS_UPDATED',
      timestamp: now,
      summary: `Permissão liberada pelo ADM Dono: ${resolvedName} → ${finalRole} (${platformLabel})`,
    });

    res.json({
      users: db.users.map(sanitizeUser),
      ericssonUsers: db.ericssonUsers.map(sanitizeUser),
      duplaEmailsMap: db.duplaEmailsMap || {},
      notifications: db.notifications || [],
    });
  });

  // ===================== ADM PANEL: USER & PROFILE ACCESS CONTROL =====================

  app.patch('/api/admin/users/:id/role', (req, res) => {
    const { id } = req.params;
    const { role } = req.body as { role?: UserRole };

    const validRoles: UserRole[] = [
      'ADM',
      'Coordenador Geral',
      'Coordenador Engenharia',
      'Executor',
      'Vistoriador',
    ];
    if (!role || !validRoles.includes(role)) {
      res.status(400).json({ error: 'Perfil inválido.' });
      return;
    }

    const target = db.users.find((u) => u.id === id);
    if (!target) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    // Only Rafael Araújo can be ADM
    target.role = role === 'ADM' && !isOwnerAdmUser(target.email) ? 'Coordenador Geral' : role;

    // Also update matching resource row in Equipes sheet if present
    db.sites.forEach((s) => {
      if (s.sheetName === 'Equipes' && s.customFields) {
        const rowName = (s.customFields['NOME'] || '').trim().toLowerCase();
        const rowEmail = (s.customFields['E-MAIL'] || '').trim().toLowerCase();
        if (
          rowName === target.name.trim().toLowerCase() ||
          (rowEmail && rowEmail === target.email.toLowerCase())
        ) {
          s.customFields['PERFIL'] = role;
        }
      }
    });

    saveDatabase(db);

    broadcastUpdate({
      type: 'FULL_STATE',
      timestamp: new Date().toISOString(),
      summary: `Perfil de ${target.name} alterado para ${role}`,
    });

    res.json({
      user: sanitizeUser(target),
      users: db.users.map(sanitizeUser),
    });
  });

  app.post('/api/admin/users', async (req, res) => {
    const {
      name,
      email,
      password,
      role,
      equipe,
      telefone,
      cpf,
      rg,
      atividade,
      statusRecurso,
      dispensadoDocumentos,
      documents,
    } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: UserRole;
      equipe?: string;
      telefone?: string;
      cpf?: string;
      rg?: string;
      atividade?: string;
      statusRecurso?: string;
      dispensadoDocumentos?: boolean;
      documents?: Array<
        UserMandatoryDocument & {
          fileBase64?: string;
        }
      >;
    };

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Informe nome do recurso, e-mail e senha.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidAmetaDomain(normalizedEmail)) {
      res.status(403).json({
        error: 'Utilize exclusivamente um e-mail corporativo do domínio @ametaservicos.com.br.',
      });
      return;
    }

    if (db.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      res.status(409).json({ error: 'Já existe um recurso cadastrado com este e-mail.' });
      return;
    }

    const validRole: UserRole =
      role &&
      ['Coordenador Geral', 'Coordenador Engenharia', 'Executor', 'Vistoriador'].includes(role)
        ? role
        : 'Vistoriador';

    const newUserId = `usr-${Date.now()}`;
    const baseDocs = ensureUserMandatoryDocuments(documents);

    // If any initial documents include base64 uploaded content, persist them to UPLOADS_DIR and auto-extract expiration if not manually filled
    if (Array.isArray(documents)) {
      for (const incomingDoc of documents) {
        if (incomingDoc && incomingDoc.type && incomingDoc.fileBase64 && incomingDoc.fileName) {
          const targetDoc = baseDocs.find((d) => d.type === incomingDoc.type);
          if (targetDoc) {
            const cleanBase64 = incomingDoc.fileBase64.includes('base64,')
              ? incomingDoc.fileBase64.split('base64,')[1]
              : incomingDoc.fileBase64;
            const buffer = Buffer.from(cleanBase64, 'base64');
            const ext = path.extname(incomingDoc.fileName) || '.pdf';
            const storageFileName = `userdoc-${newUserId}-${incomingDoc.type}-${Date.now()}${ext}`;
            fs.writeFileSync(path.join(UPLOADS_DIR, storageFileName), buffer);
            targetDoc.fileName = incomingDoc.fileName;
            targetDoc.fileSize = buffer.length;
            targetDoc.uploadedAt = new Date().toISOString();
            targetDoc.storageFileName = storageFileName;

            if (!targetDoc.expiresAt) {
              const extracted = await extractExpirationFromDocument({
                docType: targetDoc.type,
                fileName: incomingDoc.fileName,
                fileBase64: incomingDoc.fileBase64,
                buffer,
              });
              targetDoc.expiresAt = extracted.expiresAt;
            }
          }
        }
      }
    }

    const isExempt =
      Boolean(dispensadoDocumentos) ||
      (statusRecurso || '').toUpperCase() === 'DISPENSADO';

    const resolvedEquipe =
      equipe?.trim() && equipe.trim() !== 'Campo' && equipe.trim() !== 'Campo / Engenharia'
        ? equipe.trim()
        : name.trim();

    const tempUser: AmetaUser = {
      id: newUserId,
      name: name.trim(),
      email: normalizedEmail,
      situacao: 'ativo',
      role: validRole,
      plataforma: 'NOKIA',
      assignedPlatform: 'NOKIA',
      accessReleased: true,
      equipe: resolvedEquipe,
      telefone: telefone?.trim() || '',
      cpf: cpf?.trim() || '',
      rg: rg?.trim() || '',
      atividade: atividade?.trim() || 'ACESSO | TX',
      statusRecurso: isExempt ? 'DISPENSADO' : statusRecurso || 'VALIDADO',
      dispensadoDocumentos: isExempt,
      documents: baseDocs,
      emailVerified: true,
      verifiedAt: new Date().toISOString(),
      preferredVendor: 'NOKIA',
      createdAt: new Date().toISOString(),
    };

    const computedStatus = evaluateUserOverallDocumentStatus(tempUser).overallStatus;

    const newUser: StoredUser = {
      ...tempUser,
      statusRecurso: statusRecurso || computedStatus,
      passwordHash: hashPassword(password),
    };

    db.users.push(newUser);
    if (!validRole.includes('Coordenador') && resolvedEquipe) {
      if (!db.duplaEmailsMap) db.duplaEmailsMap = {};
      const prevEmails = Array.isArray(db.duplaEmailsMap[resolvedEquipe])
        ? db.duplaEmailsMap[resolvedEquipe]
        : [];
      if (!prevEmails.some((e) => e.toLowerCase() === normalizedEmail)) {
        db.duplaEmailsMap[resolvedEquipe] = [...prevEmails, normalizedEmail];
      }
    }
    saveDatabase(db);

    broadcastUpdate({
      type: 'FULL_STATE',
      timestamp: new Date().toISOString(),
      summary: `Usuário ${newUser.name} (${validRole}) adicionado pelo ADM`,
    });

    res.status(201).json({
      user: sanitizeUser(newUser),
      users: db.users.map(sanitizeUser),
      duplaEmailsMap: db.duplaEmailsMap || {},
    });
  });

  // Update a user's overall statusRecurso ('VALIDADO' | 'A VENCER' | 'VENCIDO' | 'DISPENSADO') or dispensadoDocumentos flag
  app.patch('/api/admin/users/:id/status', (req, res) => {
    const { id } = req.params;
    const { statusRecurso, dispensadoDocumentos } = req.body as {
      statusRecurso?: string;
      dispensadoDocumentos?: boolean;
    };
    const target = db.users.find((u) => u.id === id);
    if (!target) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    target.documents = ensureUserMandatoryDocuments(target.documents);

    const nextUpper = (statusRecurso || '').trim().toUpperCase();
    const isNextDispensado =
      typeof dispensadoDocumentos === 'boolean'
        ? dispensadoDocumentos
        : nextUpper === 'DISPENSADO';

    target.dispensadoDocumentos = isNextDispensado;

    // When admin sets user status to VALIDADO or DISPENSADO, clear any lingering VENCIDO / A_VENCER overrides or expired dates on documents
    if (nextUpper === 'VALIDADO' || isNextDispensado) {
      target.documents.forEach((d) => {
        if (d.statusOverride === 'VENCIDO' || d.statusOverride === 'A_VENCER') {
          d.statusOverride = undefined;
        }
        if (nextUpper === 'VALIDADO' && d.expiresAt) {
          const evalCheck = evaluateDocumentExpiration(d, false);
          if (evalCheck.status === 'VENCIDO' || evalCheck.status === 'A_VENCER') {
            d.expiresAt = '';
          }
        }
      });
    }

    const evaluated = evaluateUserOverallDocumentStatus(target);
    target.statusRecurso = evaluated.overallStatus;
    saveDatabase(db);

    broadcastUpdate({
      type: 'USER_DOCUMENT_UPDATED',
      timestamp: new Date().toISOString(),
      summary: `Status de ${target.name} atualizado para ${target.statusRecurso}`,
    });

    res.json({
      user: sanitizeUser(target),
      users: db.users.map(sanitizeUser),
    });
  });

  // Standalone endpoint to read a document (PDF/Image/etc.) and return its expiration date automatically
  app.post('/api/admin/documents/extract-expiration', async (req, res) => {
    const { docType, fileName, fileBase64 } = req.body as {
      docType?: MandatoryDocType;
      fileName?: string;
      fileBase64?: string;
    };

    if (!fileBase64 || !fileName) {
      res.status(400).json({ error: 'Arquivo não informado para leitura.' });
      return;
    }

    const cleanBase64 = fileBase64.includes('base64,')
      ? fileBase64.split('base64,')[1]
      : fileBase64;
    const buffer = Buffer.from(cleanBase64, 'base64');

    const extracted = await extractExpirationFromDocument({
      docType: docType || 'NR10',
      fileName,
      fileBase64,
      buffer,
    });

    res.json(extracted);
  });

  // Upload or update a mandatory document (NR10, NR35, ASO, PCMSO, PGR, PRIMEIROS_SOCORROS, CONTRATO_TRABALHO, RG)
  app.patch('/api/admin/users/:id/documents', async (req, res) => {
    const { id } = req.params;
    const {
      docType,
      fileName,
      fileBase64,
      expiresAt,
      statusOverride,
      notes,
      uploadedBy,
      clearFile,
      reExtractFromStoredFile,
    } = req.body as {
      docType?: MandatoryDocType;
      fileName?: string;
      fileBase64?: string;
      expiresAt?: string;
      statusOverride?: 'VALIDADO' | 'A_VENCER' | 'VENCIDO' | 'DISPENSADO' | '';
      notes?: string;
      uploadedBy?: string;
      clearFile?: boolean;
      reExtractFromStoredFile?: boolean;
    };

    const target = db.users.find((u) => u.id === id);
    if (!target) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    target.documents = ensureUserMandatoryDocuments(target.documents);
    const docEntry = target.documents.find((d) => d.type === docType);
    if (!docEntry) {
      res.status(400).json({ error: 'Tipo de documento inválido.' });
      return;
    }

    let autoExtractedInfo: { expiresAt: string; source: string } | null = null;

    if (clearFile) {
      if (docEntry.storageFileName) {
        const oldPath = path.join(UPLOADS_DIR, docEntry.storageFileName);
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch {
            // ignore
          }
        }
      }
      docEntry.fileName = '';
      docEntry.fileSize = 0;
      docEntry.uploadedAt = '';
      docEntry.uploadedBy = '';
      docEntry.storageFileName = '';
      docEntry.expiresAt = '';
      docEntry.statusOverride = undefined;
      docEntry.notes = '';
    } else if (fileBase64 && fileName) {
      const cleanBase64 = fileBase64.includes('base64,')
        ? fileBase64.split('base64,')[1]
        : fileBase64;
      const buffer = Buffer.from(cleanBase64, 'base64');
      const ext = path.extname(fileName) || '.pdf';
      const storageFileName = `userdoc-${target.id}-${docEntry.type}-${Date.now()}${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, storageFileName), buffer);

      docEntry.fileName = fileName;
      docEntry.fileSize = buffer.length;
      docEntry.uploadedAt = new Date().toISOString();
      docEntry.uploadedBy = uploadedBy || 'ADM';
      docEntry.storageFileName = storageFileName;

      // Automatically read expiration date from the uploaded document unless a custom expiresAt was explicitly sent
      if (!expiresAt) {
        const extracted = await extractExpirationFromDocument({
          docType: docEntry.type,
          fileName,
          fileBase64,
          buffer,
        });
        docEntry.expiresAt = extracted.expiresAt;
        docEntry.notes = extracted.source;
        // Clear manual statusOverride so the 30-day automatic evaluation rules apply to the extracted date
        if (docEntry.statusOverride !== 'DISPENSADO') {
          docEntry.statusOverride = undefined;
        }
        autoExtractedInfo = {
          expiresAt: extracted.expiresAt,
          source: extracted.source,
        };
      }
    } else if (reExtractFromStoredFile && docEntry.storageFileName) {
      const storedPath = path.join(UPLOADS_DIR, docEntry.storageFileName);
      if (fs.existsSync(storedPath)) {
        const buffer = fs.readFileSync(storedPath);
        const mime = detectMimeType(docEntry.fileName || docEntry.storageFileName);
        const b64 = `data:${mime};base64,${buffer.toString('base64')}`;
        const extracted = await extractExpirationFromDocument({
          docType: docEntry.type,
          fileName: docEntry.fileName || docEntry.storageFileName,
          fileBase64: b64,
          buffer,
        });
        docEntry.expiresAt = extracted.expiresAt;
        docEntry.notes = extracted.source;
        if (docEntry.statusOverride !== 'DISPENSADO') {
          docEntry.statusOverride = undefined;
        }
        autoExtractedInfo = {
          expiresAt: extracted.expiresAt,
          source: extracted.source,
        };
      }
    }

    if (typeof expiresAt === 'string') {
      docEntry.expiresAt = expiresAt.trim();
      // When user updates or clears expiration date, clear any VENCIDO / A_VENCER override so automatic evaluation runs cleanly
      if (statusOverride === undefined && docEntry.statusOverride !== 'DISPENSADO') {
        docEntry.statusOverride = undefined;
      }
    }
    if (statusOverride !== undefined) {
      docEntry.statusOverride = statusOverride ? statusOverride : undefined;
      // If user changes statusOverride away from VENCIDO without passing a new expiresAt, clear any past-due date so it doesn't stay VENCIDO
      if (
        statusOverride !== 'VENCIDO' &&
        typeof expiresAt !== 'string' &&
        docEntry.expiresAt
      ) {
        const evalCheck = evaluateDocumentExpiration(
          { ...docEntry, statusOverride: undefined },
          false
        );
        if (evalCheck.status === 'VENCIDO') {
          docEntry.expiresAt = '';
        }
      }
    }
    if (typeof notes === 'string') {
      docEntry.notes = notes.trim();
    }

    // Re-evaluate user's overall status automatically based on 30-day rule
    const evaluated = evaluateUserOverallDocumentStatus(target);
    target.statusRecurso = evaluated.overallStatus;

    saveDatabase(db);

    broadcastUpdate({
      type: 'USER_DOCUMENT_UPDATED',
      timestamp: new Date().toISOString(),
      summary: clearFile
        ? `Documento ${docEntry.label} de ${target.name} removido`
        : `Documento ${docEntry.label} de ${target.name} atualizado`,
    });

    res.json({
      user: sanitizeUser(target),
      users: db.users.map(sanitizeUser),
      autoExtracted: autoExtractedInfo,
    });
  });

  // Download a user's uploaded mandatory document
  app.get('/api/admin/users/:id/documents/:docType/download', (req, res) => {
    const { id, docType } = req.params;
    const target = db.users.find((u) => u.id === id);
    if (!target) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }
    const docs = ensureUserMandatoryDocuments(target.documents);
    const docEntry = docs.find((d) => d.type === docType);
    if (!docEntry || !docEntry.storageFileName) {
      res.status(404).json({ error: 'Arquivo não encontrado para este documento.' });
      return;
    }
    const filePath = path.join(UPLOADS_DIR, docEntry.storageFileName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Arquivo físico não encontrado no servidor.' });
      return;
    }
    res.download(filePath, docEntry.fileName || docEntry.storageFileName);
  });

  app.delete('/api/admin/users/:id', (req, res) => {
    const { id } = req.params;
    const target =
      db.users.find((u) => u.id === id) ||
      (db.ericssonUsers || []).find((u) => u.id === id);
    if (!target) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }
    if (isOwnerAdmUser(target.email, target.situacao)) {
      res.status(403).json({ error: 'O dono principal não pode ser removido.' });
      return;
    }

    const targetEmail = target.email.toLowerCase();
    db.users = db.users.filter((u) => u.id !== id && u.email.toLowerCase() !== targetEmail);
    if (Array.isArray(db.ericssonUsers)) {
      db.ericssonUsers = db.ericssonUsers.filter(
        (u) => u.id !== id && u.email.toLowerCase() !== targetEmail
      );
    }
    saveDatabase(db);

    broadcastUpdate({
      type: 'FULL_STATE',
      timestamp: new Date().toISOString(),
      summary: `Usuário ${target.name} removido`,
    });

    res.json({
      users: db.users.map(sanitizeUser),
      ericssonUsers: (db.ericssonUsers || []).map(sanitizeUser),
    });
  });

  // ===================== ENGINEERING VISTORIAS FOLDERS & FILES (.ZIP / .RAR / DOCS) =====================

  // Create a new folder inside Vistorias or any subfolder
  app.post('/api/engineering/folders', (req, res) => {
    const {
      name,
      parentId,
      vendor = 'NOKIA',
      description,
      assignedTo,
      createdByName,
      createdByEmail,
      createdByRole,
      isUploadedFolder,
    } = req.body as {
      name?: string;
      parentId?: string | null;
      vendor?: VendorType;
      description?: string;
      assignedTo?: string;
      createdByName?: string;
      createdByEmail?: string;
      createdByRole?: AmetaUser['role'];
      isUploadedFolder?: boolean;
    };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Informe o nome da pasta.' });
      return;
    }

    if (!createdByName || !createdByName.trim()) {
      res.status(400).json({ error: 'Informe o nome de quem está criando a pasta.' });
      return;
    }

    const matchedUser = createdByEmail
      ? db.users.find((u) => u.email.toLowerCase() === createdByEmail.trim().toLowerCase())
      : undefined;
    const effectiveRole = normalizeUserRole(
      createdByRole || matchedUser?.role,
      createdByEmail
    );

    if ((effectiveRole === 'Executor' || effectiveRole === 'Vistoriador') && !isUploadedFolder) {
      res.status(403).json({
        error:
          `Permissão negada: O perfil ${effectiveRole} não tem permissão para criar pastas manualmente. Ele pode apenas subir pastas/arquivos para o sistema.`,
      });
      return;
    }

    const rootFolderId = `folder-${vendor.toLowerCase()}-vistorias`;
    const targetParentId = parentId || rootFolderId;
    const parentFolder = db.engineeringFolders.find((f) => f.id === targetParentId);

    // At the root Vistorias level ("fora"), ONLY Admin has permission to create main folders
    const isCreatingAtRootVistorias =
      targetParentId === rootFolderId || (parentFolder && parentFolder.parentId === null);

    if (isCreatingAtRootVistorias) {
      if (effectiveRole !== 'ADM') {
        res.status(403).json({
          error:
            'Permissão negada: Apenas o perfil ADM pode criar pastas principais nesta parte.',
        });
        return;
      }
    }

    const duplicate = db.engineeringFolders.find(
      (f) =>
        f.vendor === vendor &&
        f.parentId === targetParentId &&
        f.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (duplicate) {
      res.status(409).json({ error: 'Já existe uma pasta com este nome neste local.' });
      return;
    }

    const now = new Date().toISOString();
    const newFolder: EngineeringFolder = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      parentId: targetParentId,
      name: name.trim(),
      vendor,
      description: description?.trim() || '',
      assignedTo: assignedTo?.trim() || undefined,
      createdByName: createdByName.trim(),
      createdByEmail: createdByEmail?.trim() || 'engenharia@ametaservicos.com.br',
      createdAt: now,
      isSystem: false,
    };

    db.engineeringFolders.push(newFolder);
    saveDatabase(db);

    broadcastUpdate({
      type: 'FOLDER_CREATED',
      timestamp: now,
      actorEmail: newFolder.createdByEmail,
      vendor,
      summary: `Nova pasta "${newFolder.name}" criada por ${newFolder.createdByName}`,
    });

    res.status(201).json({
      folder: newFolder,
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
    });
  });

  // Delete a folder (if not a protected system root folder)
  app.delete('/api/engineering/folders/:id', (req, res) => {
    const { id } = req.params;
    const actorEmail = String(req.query.actorEmail || req.body?.actorEmail || '').trim().toLowerCase();
    const actorName = String(req.query.actorName || req.body?.actorName || '').trim().toLowerCase();
    const actorRole = String(req.query.actorRole || req.body?.actorRole || '').trim();

    const target = db.engineeringFolders.find((f) => f.id === id);
    if (!target) {
      res.status(404).json({ error: 'Pasta não encontrada.' });
      return;
    }
    if (target.isSystem) {
      res.status(403).json({
        error: 'As pastas principais (Vistorias, Vistorias Executadas, TSSR Entrada e TSSR) são fixas do sistema.',
      });
      return;
    }

    const resolvedRole = normalizeUserRole(actorRole || undefined, actorEmail || undefined);
    if (resolvedRole === 'Executor' || resolvedRole === 'Vistoriador') {
      res.status(403).json({
        error: `Permissão negada: O perfil ${resolvedRole} não tem permissão para excluir pastas do sistema (apenas arquivos vinculados ao seu nome).`,
      });
      return;
    }

    // Collect all descendant folder IDs recursively
    const toRemoveIds = new Set<string>([id]);
    let added = true;
    while (added) {
      added = false;
      for (const f of db.engineeringFolders) {
        if (f.parentId && toRemoveIds.has(f.parentId) && !toRemoveIds.has(f.id)) {
          toRemoveIds.add(f.id);
          added = true;
        }
      }
    }

    // Remove physical files inside those folders
    db.engineeringFiles.forEach((file) => {
      if (toRemoveIds.has(file.folderId) && file.storageFileName) {
        const p = path.join(UPLOADS_DIR, file.storageFileName);
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch {
            // ignore unlink errors
          }
        }
      }
    });

    db.engineeringFolders = db.engineeringFolders.filter((f) => !toRemoveIds.has(f.id));
    db.engineeringFiles = db.engineeringFiles.filter((fl) => !toRemoveIds.has(fl.folderId));
    saveDatabase(db);

    broadcastUpdate({
      type: 'FOLDER_DELETED',
      timestamp: new Date().toISOString(),
      vendor: target.vendor,
      summary: `Pasta "${target.name}" removida`,
    });

    res.json({
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
    });
  });

  // Update folder metadata (e.g. name, description, assignedTo responsible user)
  app.put('/api/engineering/folders/:id', (req, res) => {
    const { id } = req.params;
    const { name, assignedTo, description, actorEmail, actorName, actorRole } = req.body as {
      name?: string;
      assignedTo?: string;
      description?: string;
      actorEmail?: string;
      actorName?: string;
      actorRole?: string;
    };

    const folder = db.engineeringFolders.find((f) => f.id === id);
    if (!folder) {
      res.status(404).json({ error: 'Pasta não encontrada.' });
      return;
    }
    if (folder.isSystem) {
      res.status(403).json({
        error: 'As pastas principais do sistema não podem ser modificadas.',
      });
      return;
    }

    const resolvedRole = normalizeUserRole(actorRole || undefined, actorEmail || undefined);
    if (resolvedRole === 'Executor' || resolvedRole === 'Vistoriador') {
      const fEmail = (folder.createdByEmail || '').trim().toLowerCase();
      const fName = (folder.createdByName || '').trim().toLowerCase();
      const aEmail = (actorEmail || '').trim().toLowerCase();
      const aName = (actorName || '').trim().toLowerCase();
      const isOwnFolder = (aEmail && fEmail === aEmail) || (aName && fName === aName);
      if (!isOwnFolder) {
        res.status(403).json({
          error:
            `Permissão negada: O perfil ${resolvedRole} pode modificar apenas as pastas que ele mesmo subiu para o sistema.`,
        });
        return;
      }
    }

    if (typeof name === 'string' && name.trim()) {
      folder.name = name.trim();
    }
    if (typeof assignedTo === 'string') {
      folder.assignedTo = assignedTo.trim() || undefined;
    }
    if (typeof description === 'string') {
      folder.description = description.trim();
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'FOLDER_UPDATED',
      timestamp: new Date().toISOString(),
      vendor: folder.vendor,
      summary: `Pasta "${folder.name}" atualizada`,
    });

    res.json({
      folder,
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
    });
  });

  // Liberar pasta para Executor específico dentro de TSSR / TSSR Entrada
  app.post('/api/engineering/liberar-pasta-executor', (req, res) => {
    const {
      vendor = 'NOKIA',
      executorName,
      folderType = 'TSSR',
      actorName,
      actorEmail,
    } = req.body as {
      vendor?: VendorType;
      executorName?: string;
      folderType?: 'TSSR' | 'TSSR Entrada';
      actorName?: string;
      actorEmail?: string;
    };

    if (!executorName || !executorName.trim()) {
      res.status(400).json({ error: 'Informe o nome do executor para liberar a pasta.' });
      return;
    }
    const cleanExec = executorName.trim();
    const vKey = vendor.toLowerCase();
    const parentId =
      folderType === 'TSSR Entrada'
        ? `folder-${vKey}-tssr-entrada`
        : `folder-${vKey}-tssr-final`;

    let parentFolder = db.engineeringFolders.find((f) => f.id === parentId);
    if (!parentFolder) {
      parentFolder =
        db.engineeringFolders.find((f) => f.vendor === vendor && f.name === folderType) ||
        db.engineeringFolders.find((f) => f.vendor === vendor && f.name === 'TSSR') ||
        db.engineeringFolders[0];
    }

    let existing = db.engineeringFolders.find(
      (f) =>
        f.vendor === vendor &&
        f.parentId === parentFolder.id &&
        (f.name.toLowerCase() === cleanExec.toLowerCase() ||
          (f.assignedTo && f.assignedTo.toLowerCase() === cleanExec.toLowerCase()))
    );

    const now = new Date().toISOString();
    if (existing) {
      existing.assignedTo = cleanExec;
      existing.description = `Pasta de TSSR liberada para o executor ${cleanExec}`;
    } else {
      existing = {
        id: `folder-tssr-exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        parentId: parentFolder.id,
        name: cleanExec,
        vendor,
        assignedTo: cleanExec,
        description: `Pasta de TSSR liberada para o executor ${cleanExec}`,
        createdByName: actorName || 'Gestor da Engenharia',
        createdByEmail: actorEmail || 'engenharia@ametaservicos.com.br',
        createdAt: now,
        isSystem: false,
      };
      db.engineeringFolders.push(existing);
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'FOLDER_CREATED',
      timestamp: now,
      vendor,
      summary: `Pasta de TSSR liberada para o executor ${cleanExec}`,
    });

    res.status(201).json({
      folder: existing,
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
    });
  });

  // Liberar pastas para TODOS os Executores dentro de TSSR
  app.post('/api/engineering/liberar-todas-pastas-executores', (req, res) => {
    const {
      vendor = 'NOKIA',
      folderType = 'TSSR',
      actorName,
      actorEmail,
    } = req.body as {
      vendor?: VendorType;
      folderType?: 'TSSR' | 'TSSR Entrada';
      actorName?: string;
      actorEmail?: string;
    };

    const vKey = vendor.toLowerCase();
    const parentId =
      folderType === 'TSSR Entrada'
        ? `folder-${vKey}-tssr-entrada`
        : `folder-${vKey}-tssr-final`;

    let parentFolder = db.engineeringFolders.find((f) => f.id === parentId);
    if (!parentFolder) {
      parentFolder =
        db.engineeringFolders.find((f) => f.vendor === vendor && f.name === folderType) ||
        db.engineeringFolders.find((f) => f.vendor === vendor && f.name === 'TSSR') ||
        db.engineeringFolders[0];
    }

    // Collect all executors from users, tssrRows, and sites
    const executorsSet = new Set<string>();
    db.users.forEach((u) => {
      if (normalizeUserRole(u.role) === 'Executor' && u.name) {
        executorsSet.add(u.name.trim());
      }
    });
    if (Array.isArray(db.tssrRows)) {
      db.tssrRows.forEach((r) => {
        const ex = (r.fields?.['Executor'] || '').trim();
        if (ex) executorsSet.add(ex);
      });
    }
    if (Array.isArray(db.sites)) {
      db.sites.forEach((s) => {
        const ex = (s.customFields?.['Executor'] || s.responsavelCampo || s.equipeParceira || '').trim();
        if (ex) executorsSet.add(ex);
      });
    }

    const now = new Date().toISOString();
    let createdCount = 0;

    executorsSet.forEach((execName) => {
      const exists = db.engineeringFolders.some(
        (f) =>
          f.vendor === vendor &&
          f.parentId === parentFolder.id &&
          (f.name.toLowerCase() === execName.toLowerCase() ||
            (f.assignedTo && f.assignedTo.toLowerCase() === execName.toLowerCase()))
      );
      if (!exists) {
        db.engineeringFolders.push({
          id: `folder-tssr-exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          parentId: parentFolder.id,
          name: execName,
          vendor,
          assignedTo: execName,
          description: `Pasta de TSSR liberada para o executor ${execName}`,
          createdByName: actorName || 'Gestor da Engenharia',
          createdByEmail: actorEmail || 'engenharia@ametaservicos.com.br',
          createdAt: now,
          isSystem: false,
        });
        createdCount++;
      }
    });

    saveDatabase(db);
    broadcastUpdate({
      type: 'FOLDER_CREATED',
      timestamp: now,
      vendor,
      summary: `Pastas de TSSR liberadas para ${executorsSet.size} executores`,
    });

    res.json({
      message: `Pastas liberadas para ${executorsSet.size} executores (${createdCount} novas criadas).`,
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
    });
  });

  // Upload one or more files (.zip, .rar WinRAR, .7z, .xlsx, .pdf, etc.) or an entire uploaded folder into a folder
  // Also supports automatic linking to a site in "TSSR TIM Nokia" (setting Status = Entregue, link, date/time, vistoriador)
  app.post('/api/engineering/files', (req, res) => {
    const {
      folderId,
      uploadedFolderName,
      vendor = 'NOKIA',
      uploadedByName,
      uploadedByEmail,
      uploadedByRole,
      siteId,
      ocSitePre,
      tssrRowId,
      createNewTssrRow,
      newTssrFields,
      requireSiteLink,
      updateTssrVistoria,
      notes,
      assignedTo,
      files,
    } = req.body as {
      folderId?: string;
      uploadedFolderName?: string;
      vendor?: VendorType;
      uploadedByName?: string;
      uploadedByEmail?: string;
      uploadedByRole?: string;
      siteId?: string;
      ocSitePre?: string;
      tssrRowId?: string;
      createNewTssrRow?: boolean;
      newTssrFields?: Record<string, string>;
      requireSiteLink?: boolean;
      updateTssrVistoria?: boolean;
      notes?: string;
      assignedTo?: string;
      files?: Array<{
        fileName: string;
        fileSize: number;
        base64Data: string;
      }>;
    };

    // Resolve target folder
    let folder = folderId ? db.engineeringFolders.find((f) => f.id === folderId) : undefined;
    if (!folder || folder.parentId === null) {
      folder =
        db.engineeringFolders.find(
          (f) => f.vendor === vendor && f.parentId !== null && f.name !== 'Vistorias Executadas'
        ) ||
        db.engineeringFolders.find((f) => f.vendor === vendor && f.parentId !== null) ||
        db.engineeringFolders[0];
    }

    // Check if target folder is inside "TSSR Entrada" or "TSSR"
    const isInsideTssrProjectFolder = (() => {
      let curr: EngineeringFolder | undefined = folder;
      const visited = new Set<string>();
      while (curr && !visited.has(curr.id)) {
        visited.add(curr.id);
        if (curr.name === 'TSSR Entrada' || curr.name === 'TSSR') {
          return true;
        }
        curr = curr.parentId
          ? db.engineeringFolders.find((f) => f.id === curr!.parentId)
          : undefined;
      }
      return false;
    })();

    const resolvedNokiaRole =
      uploadedByRole ||
      db.users.find(
        (u) => u.email.toLowerCase() === String(uploadedByEmail || '').trim().toLowerCase()
      )?.role ||
      '';

    if (
      resolvedNokiaRole === 'Vistoriador' &&
      (isInsideTssrProjectFolder || String(notes || '').toUpperCase().includes('[TSSR]'))
    ) {
      res.status(403).json({
        error:
          'O perfil Vistoriador não tem permissão para subir TSSR. Apenas o Executor e Coordenação de Engenharia podem subir TSSR.',
      });
      return;
    }

    const cleanSiteId = (siteId || '').trim().toUpperCase();
    const mustRequireSite =
      typeof requireSiteLink === 'boolean' ? requireSiteLink : !isInsideTssrProjectFolder;

    if (mustRequireSite && !cleanSiteId) {
      res.status(400).json({
        error: 'É obrigatório vincular um Site (Site Id) antes de enviar o arquivo da vistoria.',
      });
      return;
    }

    if (!uploadedByName || !uploadedByName.trim()) {
      res.status(400).json({
        error: 'É obrigatório informar o nome do responsável que enviou o arquivo.',
      });
      return;
    }

    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'Selecione pelo menos um arquivo (.zip, .rar, documento) para enviar.' });
      return;
    }

    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const now = new Date().toISOString();

    // Auto-detect linked executor to route TSSR files directly into the executor's designated folder inside TSSR
    let linkedExecutorName = String(assignedTo || '').trim();
    if (!linkedExecutorName && cleanSiteId) {
      const nokiaRow = Array.isArray(db.tssrRows)
        ? db.tssrRows.find((r) => r.siteId && r.siteId.trim().toUpperCase() === cleanSiteId)
        : undefined;
      const ericssonRow = Array.isArray(db.ericssonRows)
        ? db.ericssonRows.find(
            (r) =>
              (r.siteIdA && r.siteIdA.trim().toUpperCase() === cleanSiteId) ||
              (r.siteIdB && r.siteIdB.trim().toUpperCase() === cleanSiteId)
          )
        : undefined;
      if (nokiaRow?.fields?.['Executor']) {
        linkedExecutorName = nokiaRow.fields['Executor'].trim();
      } else if ((ericssonRow as any)?.executor || ericssonRow?.fields?.['EXECUTOR'] || ericssonRow?.fields?.['Executor']) {
        linkedExecutorName = String((ericssonRow as any)?.executor || ericssonRow?.fields?.['EXECUTOR'] || ericssonRow?.fields?.['Executor']).trim();
      }
    }
    if (!linkedExecutorName && resolvedNokiaRole === 'Executor') {
      linkedExecutorName = uploadedByName.trim();
    }
    if (!linkedExecutorName) {
      const matchedUser = db.users.find(
        (u) =>
          u.name.trim().toLowerCase() === uploadedByName.trim().toLowerCase() &&
          normalizeUserRole(u.role) === 'Executor'
      );
      if (matchedUser) {
        linkedExecutorName = matchedUser.name.trim();
      }
    }

    const isTssrContext =
      isInsideTssrProjectFolder ||
      String(notes || '').toUpperCase().includes('[TSSR]') ||
      files.some((f) => (f.fileName || '').toUpperCase().includes('TSSR')) ||
      resolvedNokiaRole === 'Executor';

    if (linkedExecutorName && isTssrContext) {
      // Find main TSSR folder for this vendor (TSSR final or TSSR Entrada)
      const vKey = vendor.toLowerCase();
      let tssrParent =
        db.engineeringFolders.find(
          (f) =>
            f.vendor === vendor &&
            (f.id === `folder-${vKey}-tssr-final` || f.name === 'TSSR')
        ) ||
        db.engineeringFolders.find(
          (f) =>
            f.vendor === vendor &&
            (f.id === `folder-${vKey}-tssr-entrada` || f.name === 'TSSR Entrada')
        ) ||
        folder;

      const tssrParentIds = new Set(
        db.engineeringFolders
          .filter(
            (f) =>
              f.vendor === vendor &&
              (f.name === 'TSSR' ||
                f.name === 'TSSR Entrada' ||
                f.id.endsWith('-tssr-final') ||
                f.id.endsWith('-tssr-entrada'))
          )
          .map((f) => f.id)
      );

      // Find executor's designated liberated folder inside TSSR
      let execSubfolder = db.engineeringFolders.find(
        (f) =>
          f.vendor === vendor &&
          (tssrParentIds.has(f.parentId || '') || f.id.includes('tssr-exec')) &&
          ((f.assignedTo && f.assignedTo.trim().toLowerCase() === linkedExecutorName.toLowerCase()) ||
            f.name.trim().toLowerCase() === linkedExecutorName.toLowerCase())
      );

      if (!execSubfolder) {
        execSubfolder = {
          id: `folder-tssr-exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          parentId: tssrParent.id,
          name: linkedExecutorName,
          vendor,
          assignedTo: linkedExecutorName,
          description: `Pasta de TSSR liberada para o executor ${linkedExecutorName}`,
          createdByName: uploadedByName.trim() || 'Gestor da Engenharia',
          createdByEmail: uploadedByEmail?.trim() || 'engenharia@ametaservicos.com.br',
          createdAt: now,
          isSystem: false,
        };
        db.engineeringFolders.push(execSubfolder);
      }
      folder = execSubfolder;
    }

    if (typeof uploadedFolderName === 'string' && uploadedFolderName.trim()) {
      const cleanFolderName = uploadedFolderName.trim();
      const parentTargetId = folder ? folder.id : `folder-${vendor.toLowerCase()}-vistorias-executadas`;
      const existingUploadedFolder = db.engineeringFolders.find(
        (f) =>
          f.vendor === vendor &&
          f.parentId === parentTargetId &&
          f.name.trim().toLowerCase() === cleanFolderName.toLowerCase()
      );
      if (existingUploadedFolder) {
        folder = existingUploadedFolder;
      } else {
        const newUploadedFolder: EngineeringFolder = {
          id: `folder-up-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          parentId: parentTargetId,
          name: cleanFolderName,
          vendor,
          description: notes?.trim() || `Pasta enviada por ${uploadedByName.trim()}`,
          createdByName: uploadedByName.trim(),
          createdByEmail: uploadedByEmail?.trim() || 'engenharia@ametaservicos.com.br',
          createdAt: now,
          isSystem: false,
        };
        db.engineeringFolders.push(newUploadedFolder);
        folder = newUploadedFolder;
      }
    }
    const formattedDeliveryDate = new Date(now).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const createdFiles: EngineeringFile[] = [];

    files.forEach((rawFile, idx) => {
      const cleanName = path.basename(rawFile.fileName || `arquivo_${idx + 1}.zip`);
      const fileId = `file-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
      const safeDiskName = `${fileId}_${cleanName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const diskPath = path.join(UPLOADS_DIR, safeDiskName);

      // Strip optional data URI prefix e.g. "data:application/zip;base64,..."
      const base64Clean = (rawFile.base64Data || '').includes(',')
        ? rawFile.base64Data.split(',')[1]
        : rawFile.base64Data || '';

      const buffer = Buffer.from(base64Clean, 'base64');
      fs.writeFileSync(diskPath, buffer);

      const { fileType, extension } = detectFileType(cleanName);

      const newFileRecord: EngineeringFile = {
        id: fileId,
        folderId: folder ? folder.id : `folder-${vendor.toLowerCase()}-vistorias-executadas`,
        vendor,
        fileName: cleanName,
        fileType,
        extension,
        fileSize: rawFile.fileSize || buffer.length,
        siteId: cleanSiteId || undefined,
        ocSitePre: ocSitePre?.trim() || undefined,
        tssrRowId: tssrRowId?.trim() || undefined,
        notes: notes?.trim() || undefined,
        assignedTo: (linkedExecutorName || assignedTo || '').trim() || undefined,
        uploadedByName: uploadedByName.trim(),
        uploadedByEmail: uploadedByEmail?.trim() || 'engenharia@ametaservicos.com.br',
        uploadedAt: now,
        storageFileName: safeDiskName,
      };

      db.engineeringFiles.unshift(newFileRecord);
      createdFiles.push(newFileRecord);
    });

    // Automatically update or create the linked site row in TSSR TIM Nokia when a Site ID is linked!
    const shouldUpdateTssrVistoria = Boolean(cleanSiteId);

    const primaryFile = createdFiles[0];
    if (shouldUpdateTssrVistoria && primaryFile) {
      if (!Array.isArray(db.tssrRows)) {
        db.tssrRows = [];
      }
      const fileViewUrl = `/api/engineering/files/${encodeURIComponent(primaryFile.id)}/view`;
      const fileDownloadUrl = `/api/engineering/files/${encodeURIComponent(primaryFile.id)}/download`;

      let matchedTssrCount = 0;
      db.tssrRows.forEach((row) => {
        const matchesById = tssrRowId && row.id === tssrRowId;
        const matchesBySiteAndOc =
          !tssrRowId &&
          ocSitePre &&
          row.siteId.trim().toUpperCase() === cleanSiteId &&
          row.ocSitePre.trim().toUpperCase() === ocSitePre.trim().toUpperCase();
        const matchesBySiteOnly =
          !tssrRowId && !ocSitePre && row.siteId.trim().toUpperCase() === cleanSiteId;

        if (matchesById || matchesBySiteAndOc || matchesBySiteOnly) {
          row.vistoriaStatus = 'Entregue';
          row.vistoriaFileId = primaryFile.id;
          row.vistoriaFileName = primaryFile.fileName;
          row.vistoriaFileUrl = fileViewUrl;
          row.vistoriaDownloadUrl = fileDownloadUrl;
          row.vistoriaDeliveredAt = formattedDeliveryDate;
          row.vistoriaUploadedBy = uploadedByName.trim();
          row.vistoriaUploadedByEmail = uploadedByEmail?.trim() || 'engenharia@ametaservicos.com.br';
          row.updatedAt = now;
          if (!row.fields) row.fields = {};
          row.fields['STATUS Engenharia'] = 'TSSR Aguardando aprovação';
          matchedTssrCount++;
        }
      });

      // If no row matched by exact criteria, try matching by Site Id across TSSR TIM Nokia
      if (matchedTssrCount === 0 && !createNewTssrRow) {
        db.tssrRows.forEach((row) => {
          if (row.siteId.trim().toUpperCase() === cleanSiteId) {
            row.vistoriaStatus = 'Entregue';
            row.vistoriaFileId = primaryFile.id;
            row.vistoriaFileName = primaryFile.fileName;
            row.vistoriaFileUrl = fileViewUrl;
            row.vistoriaDownloadUrl = fileDownloadUrl;
            row.vistoriaDeliveredAt = formattedDeliveryDate;
            row.vistoriaUploadedBy = uploadedByName.trim();
            row.vistoriaUploadedByEmail = uploadedByEmail?.trim() || 'engenharia@ametaservicos.com.br';
            row.updatedAt = now;
            if (!row.fields) row.fields = {};
            row.fields['STATUS Engenharia'] = 'TSSR Aguardando aprovação';
            matchedTssrCount++;
          }
        });
      }

      // Synchronize in db.sites as well so both spreadsheets reflect the status immediately
      if (Array.isArray(db.sites)) {
        db.sites.forEach((s) => {
          if (s.siteId?.trim().toUpperCase() === cleanSiteId) {
            if (!s.customFields) s.customFields = {};
            s.customFields['STATUS Engenharia'] = 'TSSR Aguardando aprovação';
            s.customFields['Status Engenharia'] = 'TSSR Aguardando aprovação';
            s.customFields['STATUS'] = 'Aguardando Aprovação';
            s.customFields['Status'] = 'Aguardando Aprovação';
            s.status = 'Aguardando Aprovação';
            s.updatedAt = now;
          }
        });
      }

      if (Array.isArray(db.ericssonRows)) {
        db.ericssonRows.forEach((er) => {
          if (
            (er.siteIdA && er.siteIdA.trim().toUpperCase() === cleanSiteId) ||
            (er.siteIdB && er.siteIdB.trim().toUpperCase() === cleanSiteId)
          ) {
            if (!er.fields) er.fields = {};
            er.fields['STATUS'] = 'Aguardando aprovação';
            er.fields['STATUS Engenharia'] = 'TSSR Aguardando aprovação';
            er.updatedAt = now;
          }
        });
      }

      // If still no row matched (or createNewTssrRow was requested), create the new row in TSSR TIM Nokia
      if (matchedTssrCount === 0) {
        const baseFields: Record<string, string> = {};
        TSSR_TIM_NOKIA_ORIGINAL_COLUMNS.forEach((col) => {
          baseFields[col] = newTssrFields?.[col] || '';
        });
        baseFields['Site Id'] = cleanSiteId;
        if (ocSitePre?.trim()) baseFields['Oc Site Pre'] = ocSitePre.trim();
        const isExecutorUpload =
          resolvedNokiaRole.toLowerCase().includes('execut') ||
          (primaryFile.fileName || '').toUpperCase().includes('TSSR') ||
          isInsideTssrProjectFolder;
        if (isExecutorUpload || !baseFields['STATUS Engenharia']) {
          baseFields['STATUS Engenharia'] = 'TSSR Aguardando aprovação';
        }

        const newRow: TssrRow = {
          id: `tssr-${vendor.toLowerCase()}-${Date.now()}`,
          rowKey: buildTssrRowKey(cleanSiteId, baseFields['Oc Site Pre']),
          vendor,
          tabName: 'TSSR TIM Nokia',
          siteId: cleanSiteId,
          ocSitePre: baseFields['Oc Site Pre'] || '',
          enderecoId: baseFields['Enderecoid'] || '',
          fields: baseFields,
          vistoriaStatus: 'Entregue',
          vistoriaFileId: primaryFile.id,
          vistoriaFileName: primaryFile.fileName,
          vistoriaFileUrl: fileViewUrl,
          vistoriaDownloadUrl: fileDownloadUrl,
          vistoriaDeliveredAt: formattedDeliveryDate,
          vistoriaUploadedBy: uploadedByName.trim(),
          vistoriaUploadedByEmail: uploadedByEmail?.trim() || 'engenharia@ametaservicos.com.br',
          createdAt: now,
          updatedAt: now,
        };
        db.tssrRows.unshift(newRow);
      }
    }

    // Create notifications for Engineering Coordinators when TSSR is uploaded or Vistoria goes to folder and changes status to OK
    const isTssrFile =
      isInsideTssrProjectFolder ||
      (primaryFile?.fileName || '').toUpperCase().includes('TSSR') ||
      (notes || '').toUpperCase().includes('TSSR');

    if (primaryFile) {
      if (isTssrFile) {
        pushNotification(db, {
          type: 'TSSR_ENVIADO_EXECUTOR',
          vendor,
          title: `TSSR Enviado para Engenharia (${cleanSiteId || folder?.name || 'TSSR'})`,
          message: `${uploadedByName.trim()} subiu o arquivo TSSR "${primaryFile.fileName}"${
            cleanSiteId ? ` do site ${cleanSiteId}` : ''
          } na pasta ${folder?.name || 'TSSR'} para análise da Coordenação de Engenharia.`,
          siteId: cleanSiteId || undefined,
          fileName: primaryFile.fileName,
          actorName: uploadedByName.trim(),
          actorEmail: uploadedByEmail?.trim() || 'executor@ametaservicos.com.br',
          targetRoles: ['Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
        });
      } else if (shouldUpdateTssrVistoria) {
        pushNotification(db, {
          type: 'VISTORIA_OK_PASTA',
          vendor,
          title: `Vistoria na Pasta — Status OK (${cleanSiteId})`,
          message: `A vistoria do site ${cleanSiteId} ("${primaryFile.fileName}") foi entregue na pasta "${
            folder?.name || 'Vistorias Executadas'
          }" por ${uploadedByName.trim()} e mudou o status para OK (Entregue).`,
          siteId: cleanSiteId,
          fileName: primaryFile.fileName,
          actorName: uploadedByName.trim(),
          actorEmail: uploadedByEmail?.trim() || 'vistoria@ametaservicos.com.br',
          targetRoles: ['Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
        });
      }

      if (cleanSiteId) {
        const matchedSite = db.sites.find(
          (s) =>
            s.vendor === vendor &&
            s.sheetName !== 'Equipes' &&
            s.sheetName !== 'Controle Cancelados' &&
            (s.siteId.trim().toUpperCase() === cleanSiteId || s.id.trim().toUpperCase() === cleanSiteId)
        );
        const siteEquipe = (
          matchedSite?.equipeParceira ||
          matchedSite?.responsavelCampo ||
          matchedSite?.customFields?.['EQUIPE EXECUTANTE'] ||
          assignedTo ||
          ''
        ).trim();
        const siteEmailRaw = (matchedSite?.customFields?.['E-MAIL DUPLA'] || '').trim();
        const siteEmails = siteEmailRaw
          ? siteEmailRaw.split(/[,;]/).map((e) => e.trim().toLowerCase()).filter(Boolean)
          : [];

        pushNotification(db, {
          type: 'ARQUIVO_ASSOCIADO_SITE_VISTORIADOR',
          vendor,
          title: `Arquivo Associado ao Site ${cleanSiteId}`,
          message: `Há ${createdFiles.length > 1 ? `${createdFiles.length} arquivos associados` : `um arquivo ("${primaryFile.fileName}") associado`} ao site ${cleanSiteId} pelo qual você é responsável (${folder?.name || 'Engenharia'}).`,
          siteId: cleanSiteId,
          fileName: primaryFile.fileName,
          actorName: uploadedByName.trim(),
          actorEmail: uploadedByEmail?.trim() || 'engenharia@ametaservicos.com.br',
          targetRoles: ['Vistoriador'],
          ...(siteEquipe ? { targetEquipes: [siteEquipe] } : {}),
          ...(siteEmails.length > 0 ? { targetEmails: siteEmails } : {}),
        });
      }
    }

    saveDatabase(db);

    broadcastUpdate({
      type: 'FILE_UPLOADED',
      timestamp: now,
      actorEmail: uploadedByEmail,
      vendor,
      summary: cleanSiteId
        ? `Arquivo ${primaryFile.fileName} (${cleanSiteId}) carregado por ${uploadedByName.trim()}`
        : `Arquivo ${primaryFile.fileName} carregado em ${folder?.name || 'Engenharia'} por ${uploadedByName.trim()}`,
    });

    res.status(201).json({
      targetFolderId: folder?.id,
      createdFiles,
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
      tssrRows: db.tssrRows,
      tssrSheets: db.tssrSheets || [],
      sites: db.sites,
      notifications: db.notifications || [],
    });
  });

  // View/open an engineering file directly in browser
  app.get('/api/engineering/files/:id/view', (req, res) => {
    const { id } = req.params;
    const fileRecord =
      db.engineeringFiles.find((f) => f.id === id) ||
      (db.ericssonFiles || []).find((f) => f.id === id);
    if (!fileRecord) {
      res.status(404).json({ error: 'Arquivo não encontrado.' });
      return;
    }

    if (fileRecord.storageFileName) {
      const diskPath = path.join(UPLOADS_DIR, fileRecord.storageFileName);
      if (fs.existsSync(diskPath)) {
        const mime = detectMimeType(fileRecord.fileName);
        res.setHeader('Content-Type', mime);
        res.setHeader(
          'Content-Disposition',
          `inline; filename="${encodeURIComponent(fileRecord.fileName)}"`
        );
        res.sendFile(diskPath);
        return;
      }
    }

    res.redirect(`/api/engineering/files/${encodeURIComponent(id)}/download`);
  });

  // Download an engineering file (.zip, .rar, .xlsx, .pdf, etc.)
  app.get('/api/engineering/files/:id/download', (req, res) => {
    const { id } = req.params;
    const fileRecord =
      db.engineeringFiles.find((f) => f.id === id) ||
      (db.ericssonFiles || []).find((f) => f.id === id);
    if (!fileRecord) {
      res.status(404).json({ error: 'Arquivo não encontrado.' });
      return;
    }

    if (fileRecord.storageFileName) {
      const diskPath = path.join(UPLOADS_DIR, fileRecord.storageFileName);
      if (fs.existsSync(diskPath)) {
        res.download(diskPath, fileRecord.fileName);
        return;
      }
    }

    // Fallback content if file on disk was cleaned up
    const fallbackBuffer = Buffer.from(
      `AMETA TELECOM - ARQUIVO DE ENGENHARIA\nArquivo: ${fileRecord.fileName}\nCarregado por: ${fileRecord.uploadedByName} (${fileRecord.uploadedByEmail})\nSite ID: ${fileRecord.siteId || 'N/A'}\nData: ${fileRecord.uploadedAt}\n`,
      'utf-8'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileRecord.fileName)}"`
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(fallbackBuffer);
  });

  // Update an engineering file (e.g. assign responsible user "assignedTo", fileName, siteId, notes, or replace file content)
  app.put('/api/engineering/files/:id', (req, res) => {
    const { id } = req.params;
    const {
      fileName,
      assignedTo,
      siteId,
      notes,
      base64Data,
      fileSize,
      actorEmail,
      actorName,
      actorRole,
    } = req.body as {
      fileName?: string;
      assignedTo?: string;
      siteId?: string;
      notes?: string;
      base64Data?: string;
      fileSize?: number;
      actorEmail?: string;
      actorName?: string;
      actorRole?: string;
    };

    const fileRecord = db.engineeringFiles.find((f) => f.id === id);
    if (!fileRecord) {
      res.status(404).json({ error: 'Arquivo não encontrado.' });
      return;
    }

    const resolvedRole = normalizeUserRole(actorRole || undefined, actorEmail || undefined);
    if (resolvedRole === 'Executor' || resolvedRole === 'Vistoriador') {
      const flEmail = (fileRecord.uploadedByEmail || '').trim().toLowerCase();
      const flName = (fileRecord.uploadedByName || '').trim().toLowerCase();
      const aEmail = (actorEmail || '').trim().toLowerCase();
      const aName = (actorName || '').trim().toLowerCase();
      const isOwn = (aEmail && flEmail === aEmail) || (aName && flName === aName);
      if (!isOwn) {
        res.status(403).json({
          error:
            `Permissão negada: O perfil ${resolvedRole} pode modificar apenas as pastas e arquivos que ele mesmo subiu para o sistema.`,
        });
        return;
      }
    }

    if (typeof fileName === 'string' && fileName.trim()) {
      const cleanName = path.basename(fileName.trim());
      fileRecord.fileName = cleanName;
      const { fileType, extension } = detectFileType(cleanName);
      fileRecord.fileType = fileType;
      fileRecord.extension = extension;
    }

    if (typeof base64Data === 'string' && base64Data.trim()) {
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }
      const cleanName = path.basename(fileRecord.fileName || 'arquivo.zip');
      const safeDiskName = `${fileRecord.id}_${cleanName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const diskPath = path.join(UPLOADS_DIR, safeDiskName);
      const base64Clean = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const buffer = Buffer.from(base64Clean, 'base64');
      fs.writeFileSync(diskPath, buffer);
      fileRecord.storageFileName = safeDiskName;
      fileRecord.fileSize = fileSize || buffer.length;
      fileRecord.uploadedAt = new Date().toISOString();
    }

    if (typeof assignedTo === 'string') {
      fileRecord.assignedTo = assignedTo.trim() || undefined;
    }
    if (typeof siteId === 'string') {
      fileRecord.siteId = siteId.trim().toUpperCase() || undefined;
    }
    if (typeof notes === 'string') {
      fileRecord.notes = notes.trim() || undefined;
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'FILE_UPDATED',
      timestamp: new Date().toISOString(),
      vendor: fileRecord.vendor,
      summary: `Documento "${fileRecord.fileName}" atualizado`,
    });

    res.json({
      file: fileRecord,
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
    });
  });

  // Delete an engineering file
  app.delete('/api/engineering/files/:id', (req, res) => {
    const { id } = req.params;
    const actorEmail = String(req.query.actorEmail || req.body?.actorEmail || '').trim().toLowerCase();
    const actorName = String(req.query.actorName || req.body?.actorName || '').trim().toLowerCase();
    const actorRole = String(req.query.actorRole || req.body?.actorRole || '').trim();

    const existing = db.engineeringFiles.find((f) => f.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Arquivo não encontrado.' });
      return;
    }

    const resolvedRole = normalizeUserRole(actorRole || undefined, actorEmail || undefined);
    const isGestorEngenharia =
      resolvedRole === 'Coordenador Engenharia' ||
      resolvedRole === 'Coordenador Geral' ||
      resolvedRole === 'ADM' ||
      isOwnerAdmUser(actorEmail);

    if (!isGestorEngenharia) {
      if (resolvedRole === 'Executor' || resolvedRole === 'Vistoriador') {
        const flEmail = (existing.uploadedByEmail || '').trim().toLowerCase();
        const flName = (existing.uploadedByName || '').trim().toLowerCase();
        const flAssigned = (existing.assignedTo || '').trim().toLowerCase();
        let isLinkedSiteExecutor = false;
        if (existing.siteId && Array.isArray(db.tssrRows)) {
          const sRow = db.tssrRows.find(
            (r) => r.siteId && r.siteId.trim().toUpperCase() === existing.siteId!.trim().toUpperCase()
          );
          if (sRow?.fields?.['Executor'] && sRow.fields['Executor'].trim().toLowerCase() === actorName) {
            isLinkedSiteExecutor = true;
          }
        }
        const isLinkedToUser =
          (actorEmail && flEmail === actorEmail) ||
          (actorName && flName === actorName) ||
          (actorName && flAssigned === actorName) ||
          (actorName && existing.fileName.toLowerCase().includes(actorName)) ||
          isLinkedSiteExecutor;
        if (!isLinkedToUser) {
          res.status(403).json({
            error:
              `Permissão negada: O Executor pode apagar apenas os documentos vinculados com o seu nome.`,
          });
          return;
        }
      } else {
        res.status(403).json({
          error: 'Permissão negada para excluir arquivos. Apenas Gestor da Engenharia ou o Executor responsável podem apagar.',
        });
        return;
      }
    }

    if (existing.storageFileName) {
      const diskPath = path.join(UPLOADS_DIR, existing.storageFileName);
      if (fs.existsSync(diskPath)) {
        try {
          fs.unlinkSync(diskPath);
        } catch {
          // ignore unlink error
        }
      }
    }

    db.engineeringFiles = db.engineeringFiles.filter((f) => f.id !== id);

    // If any TSSR row pointed to this deleted file, check if another file exists for that site or reset to Pendente
    if (Array.isArray(db.tssrRows)) {
      db.tssrRows.forEach((row) => {
        if (row.vistoriaFileId === id) {
          const fallbackFile = db.engineeringFiles.find(
            (fl) =>
              fl.siteId &&
              fl.siteId.trim().toUpperCase() === row.siteId.trim().toUpperCase()
          );
          if (fallbackFile) {
            row.vistoriaStatus = 'Entregue';
            row.vistoriaFileId = fallbackFile.id;
            row.vistoriaFileName = fallbackFile.fileName;
            row.vistoriaFileUrl = `/api/engineering/files/${encodeURIComponent(fallbackFile.id)}/view`;
            row.vistoriaDownloadUrl = `/api/engineering/files/${encodeURIComponent(fallbackFile.id)}/download`;
            row.vistoriaDeliveredAt = new Date(fallbackFile.uploadedAt).toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            row.vistoriaUploadedBy = fallbackFile.uploadedByName;
            row.vistoriaUploadedByEmail = fallbackFile.uploadedByEmail;
          } else {
            row.vistoriaStatus = 'Pendente';
            row.vistoriaFileId = undefined;
            row.vistoriaFileName = undefined;
            row.vistoriaFileUrl = undefined;
            row.vistoriaDownloadUrl = undefined;
            row.vistoriaDeliveredAt = undefined;
            row.vistoriaUploadedBy = undefined;
            row.vistoriaUploadedByEmail = undefined;
          }
        }
      });
    }

    // If any Ericsson row pointed to this deleted file, reset its vistoria status
    if (Array.isArray(db.ericssonRows)) {
      db.ericssonRows.forEach((row) => {
        if (row.siteAVistoriaFileId === id) {
          row.siteAVistoriaStatus = 'Pendente';
          row.siteAVistoriaFileId = undefined;
          row.siteAVistoriaFolderId = undefined;
          row.siteAVistoriaFileName = undefined;
          row.siteAVistoriaFileUrl = undefined;
          row.siteAVistoriaDownloadUrl = undefined;
          row.siteAVistoriaDeliveredAt = undefined;
          row.siteAVistoriaUploadedBy = undefined;
          row.siteAVistoriaUploadedByEmail = undefined;
          if (row.siteBVistoriaStatus === 'Dispensado') {
            row.siteBVistoriaStatus = 'Pendente';
          }
        }
        if (row.siteBVistoriaFileId === id) {
          row.siteBVistoriaStatus = 'Pendente';
          row.siteBVistoriaFileId = undefined;
          row.siteBVistoriaFolderId = undefined;
          row.siteBVistoriaFileName = undefined;
          row.siteBVistoriaFileUrl = undefined;
          row.siteBVistoriaDownloadUrl = undefined;
          row.siteBVistoriaDeliveredAt = undefined;
          row.siteBVistoriaUploadedBy = undefined;
          row.siteBVistoriaUploadedByEmail = undefined;
          if (row.siteAVistoriaStatus === 'Dispensado') {
            row.siteAVistoriaStatus = 'Pendente';
          }
        }
        if (row.losFileId === id) {
          row.losStatus = 'Pendente';
          row.losLinkedSiteId = undefined;
          row.losFileId = undefined;
          row.losFolderId = undefined;
          row.losFileName = undefined;
          row.losFileUrl = undefined;
          row.losDownloadUrl = undefined;
          row.losDeliveredAt = undefined;
          row.losUploadedBy = undefined;
          row.losUploadedByEmail = undefined;
        }
      });
    }

    saveDatabase(db);

    broadcastUpdate({
      type: 'FILE_DELETED',
      timestamp: new Date().toISOString(),
      vendor: existing.vendor,
      summary: `Arquivo "${existing.fileName}" removido`,
    });

    res.json({
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
      tssrRows: db.tssrRows || [],
      ericssonRows: db.ericssonRows || [],
    });
  });

  // ===================== CONTROLE DE ENGENHARIA: TSSR TIM NOKIA ENDPOINTS =====================

  // Import TSSR spreadsheet from OneDrive shared link
  app.post('/api/tssr/import-onedrive', async (req, res) => {
    const { url, vendor = 'NOKIA', tabName = 'TSSR TIM Nokia' } = req.body as {
      url?: string;
      vendor?: VendorType;
      tabName?: string;
    };

    if (!url || !url.trim()) {
      res.status(400).json({ error: 'Informe o link compartilhado da planilha TSSR no OneDrive.' });
      return;
    }

    try {
      let targetShareUrl = url.trim();
      try {
        const parsedUrl = new URL(targetShareUrl);
        const redeemParam = parsedUrl.searchParams.get('redeem');
        if (redeemParam) {
          const decoded = Buffer.from(redeemParam, 'base64').toString('utf-8');
          if (decoded.startsWith('http')) {
            targetShareUrl = decoded;
          }
        }
      } catch {
        // ignore URL parse error
      }

      const b64 = Buffer.from(targetShareUrl)
        .toString('base64')
        .replace(/=+$/, '')
        .replace(/\//g, '_')
        .replace(/\+/g, '-');
      const encodedToken = `u!${b64}`;

      const badgerRes = await fetch('https://api-badgerp.svc.ms/v1.0/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          AppId: '1141147648',
        },
        body: JSON.stringify({ appId: '5cbed6ac-a083-4e14-b191-b4ba07653de2' }),
      });

      if (!badgerRes.ok) {
        res.status(502).json({ error: 'Não foi possível obter token de leitura do OneDrive.' });
        return;
      }

      const badgerData = (await badgerRes.json()) as { token?: string };
      const metaUrl = `https://my.microsoftpersonalcontent.com/_api/v2.0/shares/${encodedToken}/driveitem`;
      const metaRes = await fetch(metaUrl, {
        headers: {
          Authorization: `Badger ${badgerData.token}`,
          Prefer: 'autoredeem',
        },
      });

      if (!metaRes.ok) {
        res.status(400).json({
          error: 'Não foi possível acessar a planilha TSSR no OneDrive. Verifique se o link é público.',
        });
        return;
      }

      const metaJson = (await metaRes.json()) as {
        name?: string;
        '@content.downloadUrl'?: string;
      };
      const downloadUrl = metaJson['@content.downloadUrl'];
      if (!downloadUrl) {
        res.status(400).json({ error: 'Link de download não encontrado nos metadados do OneDrive.' });
        return;
      }

      const dlRes = await fetch(downloadUrl);
      if (!dlRes.ok) {
        res.status(502).json({ error: 'Falha ao baixar o arquivo .xlsx da planilha TSSR.' });
        return;
      }

      const arrayBuffer = await dlRes.arrayBuffer();
      const parsed = parseTssrWorkbookBuffer(arrayBuffer, vendor, tabName);

      res.json({
        fileName: metaJson.name || 'CONTROLE_TSSR.xlsx',
        sheetNameUsed: parsed.sheetNameUsed,
        rows: parsed.rows,
      });
    } catch (err) {
      console.error('TSSR OneDrive import error:', err);
      res.status(500).json({ error: 'Erro ao processar planilha TSSR do OneDrive.' });
    }
  });

  // Bulk upsert/reload TSSR spreadsheet rows while strictly preserving automatic Vistoria system columns
  app.post('/api/tssr/bulk', (req, res) => {
    const {
      rows: incomingRows,
      vendor = 'NOKIA',
      tabName = 'TSSR TIM Nokia',
      sourceFileName,
      liveSyncUrl,
    } = req.body as {
      rows?: TssrRow[];
      vendor?: VendorType;
      tabName?: string;
      sourceFileName?: string;
      liveSyncUrl?: string;
    };

    if (!Array.isArray(incomingRows) || incomingRows.length === 0) {
      res.status(400).json({ error: 'Nenhuma linha válida encontrada na planilha TSSR.' });
      return;
    }

    const { merged, insertedCount, updatedCount } = mergeTssrRowsPreservingVistoria(
      db.tssrRows || [],
      incomingRows,
      vendor,
      tabName
    );

    db.tssrRows = merged;
    if (!Array.isArray(db.tssrSheets)) {
      db.tssrSheets = [];
    }

    const now = new Date().toISOString();
    const existingMeta = db.tssrSheets.find(
      (m) => m.vendor === vendor && m.tabName === tabName
    );
    const tabCount = db.tssrRows.filter(
      (r) => r.vendor === vendor && r.tabName === tabName
    ).length;

    if (existingMeta) {
      existingMeta.lastSyncAt = now;
      existingMeta.totalRows = tabCount;
      if (sourceFileName) existingMeta.sourceFileName = sourceFileName;
      if (liveSyncUrl) existingMeta.liveSyncUrl = liveSyncUrl;
    } else {
      db.tssrSheets.push({
        id: `tssr-sheet-${Date.now()}`,
        vendor,
        tabName,
        sourceFileName: sourceFileName || 'Planilha TSSR',
        liveSyncUrl,
        lastSyncAt: now,
        totalRows: tabCount,
      });
    }

    saveDatabase(db);

    broadcastUpdate({
      type: 'TSSR_UPDATED',
      timestamp: now,
      vendor,
      summary: `Planilha ${tabName} atualizada (${updatedCount} linhas atualizadas, ${insertedCount} novas — status e arquivos de vistoria preservados)`,
    });

    res.json({
      insertedCount,
      updatedCount,
      tssrRows: db.tssrRows,
      tssrSheets: db.tssrSheets,
    });
  });

  // Create a single new row in TSSR TIM Nokia
  app.post('/api/tssr/rows', (req, res) => {
    const {
      vendor = 'NOKIA',
      tabName = 'TSSR TIM Nokia',
      siteId,
      ocSitePre,
      enderecoId,
      fields,
    } = req.body as {
      vendor?: VendorType;
      tabName?: string;
      siteId?: string;
      ocSitePre?: string;
      enderecoId?: string;
      fields?: Record<string, string>;
    };

    const cleanSiteId = (siteId || fields?.['Site Id'] || '').trim().toUpperCase();
    if (!cleanSiteId) {
      res.status(400).json({ error: 'Informe a sigla do site (Site Id) para criar a nova linha.' });
      return;
    }

    const cleanOc = (ocSitePre || fields?.['Oc Site Pre'] || '').trim();
    const cleanEnd = (enderecoId || fields?.['Enderecoid'] || '').trim();

    const normalizedFields: Record<string, string> = {};
    TSSR_TIM_NOKIA_ORIGINAL_COLUMNS.forEach((col) => {
      normalizedFields[col] = fields?.[col] || '';
    });
    normalizedFields['Site Id'] = cleanSiteId;
    if (cleanOc) normalizedFields['Oc Site Pre'] = cleanOc;
    if (cleanEnd) normalizedFields['Enderecoid'] = cleanEnd;

    const now = new Date().toISOString();
    const newRow: TssrRow = {
      id: `tssr-${vendor.toLowerCase()}-${Date.now()}`,
      rowKey: buildTssrRowKey(cleanSiteId, cleanOc),
      vendor,
      tabName,
      siteId: cleanSiteId,
      ocSitePre: cleanOc,
      enderecoId: cleanEnd,
      fields: normalizedFields,
      vistoriaStatus: 'Pendente',
      createdAt: now,
      updatedAt: now,
    };

    if (!Array.isArray(db.tssrRows)) {
      db.tssrRows = [];
    }
    db.tssrRows.unshift(newRow);
    saveDatabase(db);

    broadcastUpdate({
      type: 'TSSR_UPDATED',
      timestamp: now,
      vendor,
      summary: `Nova linha ${cleanSiteId} criada em ${tabName}`,
    });

    res.status(201).json({
      row: newRow,
      tssrRows: db.tssrRows,
      tssrSheets: db.tssrSheets || [],
    });
  });

  // Update original spreadsheet fields of a TSSR row (system columns remain automatic)
  app.put('/api/tssr/rows/:id', (req, res) => {
    const { id } = req.params;
    const { fields } = req.body as { fields?: Record<string, string> };

    if (!Array.isArray(db.tssrRows)) {
      res.status(404).json({ error: 'Linha TSSR não encontrada.' });
      return;
    }

    const row = db.tssrRows.find((r) => r.id === id);
    if (!row) {
      res.status(404).json({ error: 'Linha TSSR não encontrada.' });
      return;
    }

    if (fields && typeof fields === 'object') {
      row.fields = {
        ...row.fields,
        ...fields,
      };
      if (fields['Site Id'] !== undefined) {
        row.siteId = fields['Site Id'].trim().toUpperCase();
        row.fields['Site Id'] = row.siteId;
      }
      if (fields['Oc Site Pre'] !== undefined) {
        row.ocSitePre = fields['Oc Site Pre'].trim();
        row.fields['Oc Site Pre'] = row.ocSitePre;
      }
      if (fields['Enderecoid'] !== undefined) {
        row.enderecoId = fields['Enderecoid'].trim();
        row.fields['Enderecoid'] = row.enderecoId;
      }
      row.rowKey = buildTssrRowKey(row.siteId, row.ocSitePre);
    }

    row.updatedAt = new Date().toISOString();
    saveDatabase(db);

    broadcastUpdate({
      type: 'TSSR_UPDATED',
      timestamp: row.updatedAt,
      vendor: row.vendor,
      summary: `Linha ${row.siteId} atualizada em ${row.tabName}`,
    });

    res.json({
      row,
      tssrRows: db.tssrRows,
    });
  });

  // Delete a TSSR row
  app.delete('/api/tssr/rows/:id', (req, res) => {
    const { id } = req.params;
    if (!Array.isArray(db.tssrRows)) {
      res.status(404).json({ error: 'Linha TSSR não encontrada.' });
      return;
    }
    const existing = db.tssrRows.find((r) => r.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Linha TSSR não encontrada.' });
      return;
    }
    db.tssrRows = db.tssrRows.filter((r) => r.id !== id);
    saveDatabase(db);

    broadcastUpdate({
      type: 'TSSR_UPDATED',
      timestamp: new Date().toISOString(),
      vendor: existing.vendor,
      summary: `Linha ${existing.siteId} removida de ${existing.tabName}`,
    });

    res.json({
      tssrRows: db.tssrRows,
    });
  });

  // Assign, unassign, clear, or rename executor on TSSR TIM Nokia engineering rows
  app.post('/api/engineering/assign-executor', (req, res) => {
    const {
      rowIds,
      executorName,
      demandDate,
      unassignRowIds,
      clearAllForExecutor,
      renameFrom,
      renameTo,
      linkedEmails,
    } = req.body as {
      rowIds?: string[];
      executorName?: string;
      demandDate?: string;
      unassignRowIds?: string[];
      clearAllForExecutor?: string;
      renameFrom?: string;
      renameTo?: string;
      linkedEmails?: string[];
    };

    if (!Array.isArray(db.tssrRows)) {
      db.tssrRows = [];
    }

    const now = new Date().toISOString();
    let updatedCount = 0;

    // 1. Rename Executor across all TSSR rows
    if (renameFrom && typeof renameTo === 'string') {
      const fromNorm = normalizeAccents(renameFrom.trim().toLowerCase());
      const toClean = renameTo.trim();

      if (db.executorEmailsMap && db.executorEmailsMap[renameFrom]) {
        db.executorEmailsMap[toClean] = db.executorEmailsMap[renameFrom];
        delete db.executorEmailsMap[renameFrom];
      }

      db.tssrRows.forEach((r) => {
        const curEx = (r.fields?.['Executor'] || '').trim();
        if (curEx && normalizeAccents(curEx.toLowerCase()) === fromNorm) {
          r.fields = {
            ...(r.fields || {}),
            Executor: toClean,
          };
          r.updatedAt = now;
          updatedCount++;
        }
      });
    }
    // 2. Clear all sites for an Executor
    else if (clearAllForExecutor && clearAllForExecutor.trim()) {
      const targetNorm = normalizeAccents(clearAllForExecutor.trim().toLowerCase());
      db.tssrRows.forEach((r) => {
        const curEx = (r.fields?.['Executor'] || '').trim();
        if (curEx && normalizeAccents(curEx.toLowerCase()) === targetNorm) {
          r.fields = {
            ...(r.fields || {}),
            Executor: '',
            'Data de demanda': '',
          };
          r.updatedAt = now;
          updatedCount++;
        }
      });
    }
    // 3. Unassign specific rows
    else if (Array.isArray(unassignRowIds) && unassignRowIds.length > 0) {
      const tokenSet = new Set(
        unassignRowIds.map((t) => String(t || '').trim().toUpperCase()).filter(Boolean)
      );
      db.tssrRows.forEach((r) => {
        const match =
          tokenSet.has(r.id.toUpperCase()) ||
          tokenSet.has(r.siteId.trim().toUpperCase()) ||
          (r.ocSitePre && tokenSet.has(r.ocSitePre.trim().toUpperCase()));
        if (match) {
          r.fields = {
            ...(r.fields || {}),
            Executor: '',
            'Data de demanda': '',
          };
          r.updatedAt = now;
          updatedCount++;
        }
      });
    }
    // 4. Assign rows to Executor
    else if (Array.isArray(rowIds) && rowIds.length > 0) {
      const targetExecutor = (executorName || '').trim();
      const targetDemandDate =
        demandDate && demandDate.trim()
          ? demandDate.trim()
          : new Date().toLocaleDateString('pt-BR');

      const tokenSet = new Set(
        rowIds.map((t) => String(t || '').trim().toUpperCase()).filter(Boolean)
      );

      db.tssrRows.forEach((r) => {
        const match =
          tokenSet.has(r.id.toUpperCase()) ||
          tokenSet.has(r.siteId.trim().toUpperCase()) ||
          (r.ocSitePre && tokenSet.has(r.ocSitePre.trim().toUpperCase()));
        if (match) {
          r.fields = {
            ...(r.fields || {}),
            Executor: targetExecutor,
            'Data de demanda': targetDemandDate,
          };
          r.updatedAt = now;
          updatedCount++;
        }
      });
    }

    if (Array.isArray(linkedEmails) && executorName && executorName.trim()) {
      if (!db.executorEmailsMap || typeof db.executorEmailsMap !== 'object') {
        db.executorEmailsMap = {};
      }
      db.executorEmailsMap[executorName.trim()] = linkedEmails;
    }

    saveDatabase(db);

    broadcastUpdate({
      type: 'TSSR_UPDATED',
      timestamp: now,
      vendor: 'NOKIA',
      summary: `Demanda de ${updatedCount} site(s) da Engenharia atualizada para ${executorName || 'Executores'}`,
    });

    res.json({
      success: true,
      updatedCount,
      tssrRows: db.tssrRows,
      executorEmailsMap: db.executorEmailsMap || {},
    });
  });

  // Link profile emails to an Executor
  app.post('/api/admin/executores/link-email', (req, res) => {
    const { executorName, emails } = req.body as {
      executorName: string;
      emails: string[];
    };
    if (!executorName || !executorName.trim()) {
      res.status(400).json({ error: 'Informe o nome do executor.' });
      return;
    }
    const cleanName = executorName.trim();
    const emailList = Array.isArray(emails)
      ? Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)))
      : [];

    if (!db.executorEmailsMap || typeof db.executorEmailsMap !== 'object') {
      db.executorEmailsMap = {};
    }
    db.executorEmailsMap[cleanName] = emailList;
    saveDatabase(db);

    res.json({
      success: true,
      executorName: cleanName,
      linkedEmails: emailList,
      executorEmailsMap: db.executorEmailsMap,
    });
  });

  // ===================== SITES CRUD & ONEDRIVE / BULK IMPORT =====================

  app.post('/api/sites', (req, res) => {
    const { site, actorEmail } = req.body as {
      site: Omit<TelecomSite, 'id' | 'updatedAt'>;
      actorEmail?: string;
    };

    if (!site || !site.siteId || !site.vendor) {
      res.status(400).json({ error: 'Site ID e Fabricante (Nokia ou Ericsson) são obrigatórios.' });
      return;
    }

    const now = new Date().toISOString();
    const newSite: TelecomSite = {
      ...site,
      id: `site-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      siteId: site.siteId.trim().toUpperCase(),
      isNew: true,
      createdAt: now,
      updatedAt: now,
      updatedBy: actorEmail || site.updatedBy || 'engenharia@ametaservicos.com.br',
    };

    if (newSite.sheetName) {
      const sheetExists = db.sheets.some(
        (s) => s.vendor === newSite.vendor && s.name === newSite.sheetName
      );
      if (!sheetExists) {
        db.sheets.push({
          id: `sheet-${Date.now()}`,
          vendor: newSite.vendor,
          name: newSite.sheetName,
          description: `Planilha ${newSite.vendor} criada automaticamente`,
          lastSyncAt: now,
        });
      }
    }

    db.sites.unshift(newSite);

    const demandedEquipe = (
      newSite.equipeParceira ||
      newSite.responsavelCampo ||
      newSite.customFields?.['EQUIPE EXECUTANTE'] ||
      newSite.customFields?.['Executor'] ||
      ''
    ).trim();

    if (demandedEquipe) {
      pushNotification(db, {
        type: 'SITE_DEMANDADO_EXECUTOR',
        vendor: newSite.vendor,
        title: `Novo Site Demandado: ${newSite.siteId}`,
        message: `O site ${newSite.siteId} (${newSite.municipio || newSite.uf || newSite.sheetName}) foi demandado para a equipe "${demandedEquipe}".`,
        siteId: newSite.siteId,
        actorName: actorEmail || 'Coordenação',
        actorEmail: newSite.updatedBy || 'coordenacao@ametaservicos.com.br',
        targetRoles: ['Executor', 'Vistoriador'],
        targetEquipes: [demandedEquipe],
      });
    }

    saveDatabase(db);

    broadcastUpdate({
      type: 'SITE_CREATED',
      timestamp: now,
      actorEmail: newSite.updatedBy,
      vendor: newSite.vendor,
      summary: `Site ${newSite.siteId} adicionado em ${newSite.vendor}`,
    });

    res.status(201).json({ site: newSite, sites: db.sites, sheets: db.sheets });
  });

  app.put('/api/sites/:id', (req, res) => {
    const { id } = req.params;
    const { updates, actorEmail, actorRole } = req.body as {
      updates: Partial<TelecomSite>;
      actorEmail?: string;
      actorRole?: string;
    };

    const index = db.sites.findIndex((s) => s.id === id || s.siteId === id);
    if (index === -1) {
      res.status(404).json({ error: 'Site não encontrado.' });
      return;
    }

    const currentSite = db.sites[index];
    const matchedUser = actorEmail
      ? db.users.find((u) => u.email.toLowerCase() === actorEmail.trim().toLowerCase())
      : undefined;
    const effectiveRole = normalizeUserRole(actorRole || matchedUser?.role);

    // Allowed roles with full spreadsheet editing: ADM and Coordenador Geral
    let allowedUpdates: Partial<TelecomSite> = updates;
    if (!hasFullSpreadsheetAccess(effectiveRole)) {
      const nextStatus =
        updates.status ||
        (updates.customFields && updates.customFields['STATUS']) ||
        currentSite.status;
      const hasSiExecutedUpdate =
        typeof updates.dataAtivacao === 'string' ||
        Boolean(updates.customFields && typeof updates.customFields['SI Executed'] === 'string');
      const nextSiExecuted = hasSiExecutedUpdate
        ? updates.customFields?.['SI Executed'] ?? updates.dataAtivacao ?? ''
        : currentSite.customFields?.['SI Executed'] ?? currentSite.dataAtivacao ?? '';

      allowedUpdates = {
        status: nextStatus as SiteStatus,
        dataAtivacao: String(nextSiExecuted),
        customFields: {
          ...(currentSite.customFields || {}),
          STATUS: String(nextStatus),
          'SI Executed': String(nextSiExecuted),
        },
      };
    }

    const now = new Date().toISOString();
    const updatedSite: TelecomSite = {
      ...currentSite,
      ...allowedUpdates,
      id: currentSite.id,
      updatedAt: now,
      updatedBy: actorEmail || updates.updatedBy || currentSite.updatedBy,
    };

    const prevEquipe = (
      currentSite.equipeParceira ||
      currentSite.responsavelCampo ||
      currentSite.customFields?.['EQUIPE EXECUTANTE'] ||
      ''
    ).trim();
    const nextEquipe = (
      updatedSite.equipeParceira ||
      updatedSite.responsavelCampo ||
      updatedSite.customFields?.['EQUIPE EXECUTANTE'] ||
      ''
    ).trim();

    db.sites[index] = updatedSite;

    // 1. If a site was demanded/assigned to an Executor equipe, notify that Executor
    if (nextEquipe && nextEquipe.toLowerCase() !== prevEquipe.toLowerCase()) {
      pushNotification(db, {
        type: 'SITE_DEMANDADO_EXECUTOR',
        vendor: updatedSite.vendor,
        title: `Site Demandado: ${updatedSite.siteId}`,
        message: `O site ${updatedSite.siteId} foi demandado para a equipe "${nextEquipe}" por ${
          matchedUser?.name || actorEmail || 'Coordenação'
        }.`,
        siteId: updatedSite.siteId,
        actorName: matchedUser?.name || actorEmail || 'Coordenação',
        actorEmail: actorEmail || 'coordenacao@ametaservicos.com.br',
        actorRole: effectiveRole,
        targetRoles: ['Executor', 'Vistoriador'],
        targetEquipes: [nextEquipe],
      });
    }

    // 2. If an Executor updates the site/status/equipe (or when equipe/status is updated), notify Coordinators
    if (
      effectiveRole === 'Executor' ||
      effectiveRole === 'Vistoriador' ||
      (nextEquipe && nextEquipe !== prevEquipe)
    ) {
      pushNotification(db, {
        type: 'EXECUTOR_ATUALIZOU_EQUIPE',
        vendor: updatedSite.vendor,
        title: `Atualização de Equipe / Site: ${updatedSite.siteId}`,
        message: `${matchedUser?.name || actorEmail || 'Executor'} (${
          nextEquipe || matchedUser?.equipe || 'Campo'
        }) atualizou o site ${updatedSite.siteId} (Status: ${updatedSite.status}).`,
        siteId: updatedSite.siteId,
        actorName: matchedUser?.name || actorEmail || 'Executor',
        actorEmail: actorEmail || 'executor@ametaservicos.com.br',
        actorRole: effectiveRole,
        targetRoles: ['Coordenador Geral', 'Coordenador Engenharia', 'ADM'],
      });
    }

    const sheet = db.sheets.find(
      (sh) => sh.vendor === updatedSite.vendor && sh.name === updatedSite.sheetName
    );
    if (sheet) {
      sheet.lastSyncAt = now;
    }

    saveDatabase(db);

    broadcastUpdate({
      type: 'SITE_UPDATED',
      timestamp: now,
      actorEmail: updatedSite.updatedBy,
      vendor: updatedSite.vendor,
      summary: `Site ${updatedSite.siteId} atualizado em tempo real`,
    });

    res.json({ site: updatedSite, sites: db.sites, sheets: db.sheets });
  });

  app.delete('/api/sites/:id', (req, res) => {
    const { id } = req.params;
    const actorEmail = (req.query.actorEmail as string) || 'engenharia@ametaservicos.com.br';
    const existing = db.sites.find((s) => s.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Site não encontrado.' });
      return;
    }

    db.sites = db.sites.filter((s) => s.id !== id);
    saveDatabase(db);

    broadcastUpdate({
      type: 'SITE_DELETED',
      timestamp: new Date().toISOString(),
      actorEmail,
      vendor: existing.vendor,
      summary: `Site ${existing.siteId} removido da planilha ${existing.vendor}`,
    });

    res.json({ sites: db.sites, sheets: db.sheets });
  });

  app.post('/api/sites/mark-seen', (req, res) => {
    const { siteIds, vendor } = req.body as {
      siteIds?: string[];
      vendor?: VendorType;
    };

    const idSet = Array.isArray(siteIds) && siteIds.length > 0 ? new Set(siteIds) : null;
    db.sites.forEach((s) => {
      if (!s.isNew) return;
      if (vendor && s.vendor !== vendor) return;
      if (!idSet || idSet.has(s.id)) {
        s.isNew = false;
      }
    });

    saveDatabase(db);
    broadcastUpdate({
      type: 'FULL_STATE',
      timestamp: new Date().toISOString(),
      vendor,
      summary: 'Sites novos marcados como visualizados',
    });

    res.json({ sites: db.sites });
  });

  // Link a Dupla (Equipe Executante) to one or more user profile emails ("vinculado com e-mail deles de perfil")
  app.post('/api/admin/duplas/link-email', (req, res) => {
    const { duplaName, emails, vendor } = req.body as {
      duplaName?: string;
      emails?: string[];
      vendor?: 'NOKIA' | 'ERICSSON';
    };

    if (!duplaName || !duplaName.trim()) {
      res.status(400).json({ error: 'Informe o nome da dupla.' });
      return;
    }

    const rawDupla = duplaName.trim();
    const cleanDupla = getCanonicalDuplaName(rawDupla) || rawDupla;
    const emailList = Array.isArray(emails)
      ? Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)))
      : [];
    const emailSet = new Set(emailList);

    if (vendor === 'ERICSSON') {
      if (!db.ericssonDuplaEmailsMap || typeof db.ericssonDuplaEmailsMap !== 'object') {
        db.ericssonDuplaEmailsMap = {};
      }
      db.ericssonDuplaEmailsMap[cleanDupla] = emailList;
      db.ericssonDuplaEmailsMap[rawDupla] = emailList;

      if (Array.isArray(db.ericssonUsers)) {
        db.ericssonUsers.forEach((u) => {
          const uEmail = u.email.trim().toLowerCase();
          const uCanonEq = getCanonicalDuplaName(u.equipe || '') || (u.equipe || '').trim();
          if (emailSet.has(uEmail)) {
            u.equipe = cleanDupla;
          } else if (normalizeAccents(uCanonEq) === normalizeAccents(cleanDupla)) {
            u.equipe = 'Campo / Engenharia';
          }
        });
      }

      const emailStr = emailList.join(', ');
      if (Array.isArray(db.ericssonRows)) {
        db.ericssonRows.forEach((r) => {
          const rowEq = getCanonicalDuplaName(r.equipe || r.fields?.['EQUIPE'] || '') || (r.equipe || '').trim();
          if (rowEq && normalizeAccents(rowEq) === normalizeAccents(cleanDupla)) {
            r.fields = {
              ...(r.fields || {}),
              'E-MAIL DUPLA': emailStr,
            };
          }
        });
      }
    } else {
      if (!db.duplaEmailsMap || typeof db.duplaEmailsMap !== 'object') {
        db.duplaEmailsMap = {};
      }
      db.duplaEmailsMap[cleanDupla] = emailList;
      db.duplaEmailsMap[rawDupla] = emailList;

      if (Array.isArray(db.users)) {
        db.users.forEach((u) => {
          const uEmail = u.email.trim().toLowerCase();
          const uCanonEq = getCanonicalDuplaName(u.equipe || '') || (u.equipe || '').trim();
          if (emailSet.has(uEmail)) {
            u.equipe = cleanDupla;
          } else if (normalizeAccents(uCanonEq) === normalizeAccents(cleanDupla)) {
            u.equipe = 'Campo / Engenharia';
          }
        });
      }

      const emailStr = emailList.join(', ');
      db.sites.forEach((s) => {
        if (s.sheetName === 'Equipes' || s.sheetName === 'Controle Cancelados') return;
        if (doesSiteMatchEquipe(s, cleanDupla)) {
          s.customFields = {
            ...(s.customFields || {}),
            'E-MAIL DUPLA': emailStr,
          };
        }
      });
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'FULL_STATE',
      timestamp: new Date().toISOString(),
      summary: `Equipe "${cleanDupla}" vinculada a ${emailList.length} e-mail(s) de perfil (${vendor || 'NOKIA'})`,
    });

    res.json({
      users: db.users.map(sanitizeUser),
      ericssonUsers: (db.ericssonUsers || []).map(sanitizeUser),
      duplaEmailsMap: db.duplaEmailsMap,
      ericssonDuplaEmailsMap: db.ericssonDuplaEmailsMap,
      sites: db.sites,
      ericssonRows: db.ericssonRows || [],
    });
  });

  // Bulk assign, unassign, rename, or clear Equipe Executante (Dupla) / Responsible for one or more sites (TIM/Nokia OR Ericsson)
  app.post('/api/sites/assign-responsible', (req, res) => {
    const {
      siteTokens,
      unassignSiteTokens,
      responsibleName,
      linkedEmails,
      vendor,
      clearAllForResponsible,
      renameFrom,
      renameTo,
    } = req.body as {
      siteTokens?: string[];
      unassignSiteTokens?: string[];
      responsibleName?: string;
      linkedEmails?: string[];
      vendor?: VendorType;
      clearAllForResponsible?: string;
      renameFrom?: string;
      renameTo?: string;
    };

    const now = new Date().toISOString();
    let updatedCount = 0;

    if (renameFrom && typeof renameTo === 'string') {
      const nextDupla = renameTo.trim();
      const canonFrom = getCanonicalDuplaName(renameFrom) || renameFrom.trim();

      if (db.duplaEmailsMap && db.duplaEmailsMap[renameFrom]) {
        db.duplaEmailsMap[nextDupla] = db.duplaEmailsMap[renameFrom];
        delete db.duplaEmailsMap[renameFrom];
      }

      const renameInUserList = (list?: StoredUser[]) => {
        if (!Array.isArray(list)) return;
        list.forEach((u) => {
          const uCanonEq = getCanonicalDuplaName(u.equipe || '') || (u.equipe || '').trim();
          if (
            normalizeAccents(uCanonEq) === normalizeAccents(canonFrom) ||
            normalizeAccents(u.equipe || '') === normalizeAccents(renameFrom)
          ) {
            u.equipe = nextDupla;
          }
        });
      };
      renameInUserList(db.users);
      renameInUserList(db.ericssonUsers);

      db.sites.forEach((s) => {
        if (s.sheetName === 'Equipes' || s.sheetName === 'Controle Cancelados') return;
        if (doesSiteMatchEquipe(s, renameFrom) || doesSiteMatchResponsible(s, renameFrom)) {
          s.equipeParceira = nextDupla;
          s.responsavelCampo = nextDupla;
          s.customFields = {
            ...(s.customFields || {}),
            'EQUIPE EXECUTANTE': nextDupla,
            Executor: nextDupla,
            Responsável: nextDupla,
          };
          s.updatedAt = now;
          updatedCount++;
        }
      });

      if (Array.isArray(db.ericssonRows)) {
        db.ericssonRows.forEach((r) => {
          const rEq = (r.equipe || r.fields?.['EQUIPE'] || '').trim();
          const rCanon = getCanonicalDuplaName(rEq) || rEq;
          if (
            rEq &&
            (normalizeAccents(rCanon) === normalizeAccents(canonFrom) ||
              normalizeAccents(rEq) === normalizeAccents(renameFrom))
          ) {
            r.equipe = nextDupla;
            r.fields = {
              ...(r.fields || {}),
              EQUIPE: nextDupla,
            };
            r.updatedAt = now;
            updatedCount++;
          }
        });
      }
    } else if (
      (clearAllForResponsible && clearAllForResponsible.trim()) ||
      (Array.isArray(unassignSiteTokens) && unassignSiteTokens.length > 0)
    ) {
      const hasClearAll = Boolean(clearAllForResponsible && clearAllForResponsible.trim());
      const tokenSet = new Set(
        (unassignSiteTokens || [])
          .map((t) => String(t || '').trim().toUpperCase())
          .filter(Boolean)
      );
      const targetDupla = (clearAllForResponsible || '').trim();
      const canonTargetDupla = getCanonicalDuplaName(targetDupla) || targetDupla;

      if (vendor === 'ERICSSON') {
        if (Array.isArray(db.ericssonRows)) {
          db.ericssonRows.forEach((r) => {
            const rEq = (r.equipe || r.fields?.['EQUIPE'] || '').trim();
            const rCanon = getCanonicalDuplaName(rEq) || rEq;
            const matchesToken =
              tokenSet.size > 0 &&
              (tokenSet.has(r.id.toUpperCase()) ||
                (r.siteIdA && tokenSet.has(r.siteIdA.trim().toUpperCase())) ||
                (r.siteIdB && tokenSet.has(r.siteIdB.trim().toUpperCase())) ||
                (r.siteName && tokenSet.has(r.siteName.trim().toUpperCase())) ||
                (r.chaves && tokenSet.has(r.chaves.trim().toUpperCase())));
            const matchesClearTarget =
              hasClearAll &&
              rEq !== '' &&
              (normalizeAccents(rCanon) === normalizeAccents(canonTargetDupla) ||
                normalizeAccents(rEq) === normalizeAccents(targetDupla));

            if (matchesToken || matchesClearTarget) {
              r.equipe = '';
              r.fields = {
                ...(r.fields || {}),
                EQUIPE: '',
                'E-MAIL DUPLA': '',
              };
              r.updatedAt = now;
              updatedCount++;
            }
          });
        }
      } else {
        const linkedUsersForDupla = hasClearAll
          ? db.users.filter((u) => {
              const uEq = getCanonicalDuplaName(u.equipe || '') || (u.equipe || '').trim();
              return normalizeAccents(uEq) === normalizeAccents(canonTargetDupla);
            })
          : [];

        db.sites.forEach((s) => {
          if (vendor && s.vendor !== vendor) return;
          if (s.sheetName === 'Equipes' || s.sheetName === 'Controle Cancelados') return;

          const matchesToken =
            tokenSet.size > 0 &&
            (tokenSet.has(s.id.toUpperCase()) || tokenSet.has(s.siteId.trim().toUpperCase()));

          const matchesClearTarget =
            hasClearAll &&
            (doesSiteMatchEquipe(s, targetDupla) ||
              doesSiteMatchResponsible(s, targetDupla) ||
              linkedUsersForDupla.some((u) => doesSiteMatchResponsible(s, u)));

          if (matchesToken || matchesClearTarget) {
            s.equipeParceira = '';
            s.responsavelCampo = '';
            s.customFields = {
              ...(s.customFields || {}),
              'EQUIPE EXECUTANTE': '',
              Executor: '',
              Responsável: '',
              'E-MAIL DUPLA': '',
              ...(s.customFields && 'EQUIPE' in s.customFields ? { EQUIPE: '' } : {}),
              ...(s.customFields && 'TalonView Executor' in s.customFields
                ? { 'TalonView Executor': '' }
                : {}),
              ...(s.customFields && 'EMAIL_DUPLA' in s.customFields ? { EMAIL_DUPLA: '' } : {}),
            };
            s.updatedAt = now;
            updatedCount++;
          }
        });
      }
    } else if (Array.isArray(siteTokens) && siteTokens.length > 0) {
      const tokenSet = new Set(
        siteTokens.map((t) => String(t || '').trim().toUpperCase()).filter(Boolean)
      );
      const nextResp = (responsibleName || '').trim();
      const canonNextResp = getCanonicalDuplaName(nextResp) || nextResp;
      const allUsersCombined = [...db.users, ...(db.ericssonUsers || [])];
      const autoLinkedEmails =
        Array.isArray(linkedEmails) && linkedEmails.length > 0
          ? linkedEmails
          : Array.from(
              new Set(
                allUsersCombined
                  .filter((u) => {
                    const uEq = getCanonicalDuplaName(u.equipe || '') || (u.equipe || '').trim();
                    return normalizeAccents(uEq) === normalizeAccents(canonNextResp);
                  })
                  .map((u) => u.email.toLowerCase())
              )
            );
      const emailStr = autoLinkedEmails.join(', ');

      const demandedSiteIds: string[] = [];

      if (vendor === 'ERICSSON') {
        if (Array.isArray(db.ericssonRows)) {
          db.ericssonRows.forEach((r) => {
            const matchRow =
              tokenSet.has(r.id.toUpperCase()) ||
              (r.siteIdA && tokenSet.has(r.siteIdA.trim().toUpperCase())) ||
              (r.siteIdB && tokenSet.has(r.siteIdB.trim().toUpperCase())) ||
              (r.siteName && tokenSet.has(r.siteName.trim().toUpperCase())) ||
              (r.chaves && tokenSet.has(r.chaves.trim().toUpperCase()));
            if (matchRow) {
              r.equipe = nextResp;
              r.fields = {
                ...(r.fields || {}),
                EQUIPE: nextResp,
                'E-MAIL DUPLA': emailStr,
              };
              r.updatedAt = now;
              updatedCount++;
              const label = r.siteIdA || r.siteIdB || r.siteName || r.chaves;
              if (label && !demandedSiteIds.includes(label)) {
                demandedSiteIds.push(label);
              }
            }
          });
        }
      } else {
        db.sites.forEach((s) => {
          if (vendor && s.vendor !== vendor) return;
          if (s.sheetName === 'Equipes' || s.sheetName === 'Controle Cancelados') return;
          if (tokenSet.has(s.id.toUpperCase()) || tokenSet.has(s.siteId.trim().toUpperCase())) {
            s.equipeParceira = nextResp;
            s.responsavelCampo = nextResp;
            s.customFields = {
              ...(s.customFields || {}),
              'EQUIPE EXECUTANTE': nextResp,
              Executor: nextResp,
              Responsável: nextResp,
              'E-MAIL DUPLA': emailStr,
            };
            s.updatedAt = now;
            updatedCount++;
            demandedSiteIds.push(s.siteId);
          }
        });
      }

      if (updatedCount > 0 && nextResp) {
        const previewIds = demandedSiteIds.slice(0, 6).join(', ');
        const extraLabel =
          demandedSiteIds.length > 6 ? ` (+${demandedSiteIds.length - 6})` : '';
        pushNotification(db, {
          type: 'SITE_DEMANDADO_EXECUTOR',
          vendor: vendor || 'NOKIA',
          title: `${updatedCount} Site(s) Demandado(s) para ${nextResp} (${
            vendor === 'ERICSSON' ? 'Ericsson' : 'TIM/Nokia'
          })`,
          message: `Os sites [${previewIds}${extraLabel}] (${
            vendor === 'ERICSSON' ? 'Ericsson' : 'TIM/Nokia'
          }) foram demandados para a equipe "${nextResp}".`,
          siteId: demandedSiteIds[0],
          actorName: 'Coordenação / ADM',
          actorEmail: 'coordenacao@ametaservicos.com.br',
          targetRoles: ['Executor', 'Vistoriador'],
          targetEquipes: [nextResp],
          targetEmails: autoLinkedEmails,
        });

        pushNotification(db, {
          type: 'EXECUTOR_ATUALIZOU_EQUIPE',
          vendor: vendor || 'NOKIA',
          title: `Equipe Atualizada: ${nextResp} (${updatedCount} site(s) ${
            vendor === 'ERICSSON' ? 'Ericsson' : 'TIM/Nokia'
          })`,
          message: `A equipe "${nextResp}" foi atribuída aos sites [${previewIds}${extraLabel}] na plataforma ${
            vendor === 'ERICSSON' ? 'Ericsson' : 'TIM/Nokia'
          }.`,
          siteId: demandedSiteIds[0],
          actorName: 'Coordenação / ADM',
          actorEmail: 'coordenacao@ametaservicos.com.br',
          targetRoles: ['Coordenador Geral', 'Coordenador Engenharia', 'ADM'],
        });

        // Also check if any of the newly assigned sites already have associated files and notify Vistoriador
        const demandedUpperSet = new Set(demandedSiteIds.map((id) => id.trim().toUpperCase()));
        const associatedFiles =
          vendor === 'ERICSSON'
            ? (db.ericssonFiles || []).filter((fl) => {
                const rawSite = (fl.siteId || '').replace(/\[.*?\]/g, '').trim().toUpperCase();
                return rawSite && Array.from(demandedUpperSet).some((d) => rawSite.includes(d) || d.includes(rawSite));
              })
            : db.engineeringFiles.filter((fl) => {
                const rawSite = (fl.siteId || '').trim().toUpperCase();
                return rawSite && demandedUpperSet.has(rawSite);
              });

        if (associatedFiles.length > 0) {
          pushNotification(db, {
            type: 'ARQUIVO_ASSOCIADO_SITE_VISTORIADOR',
            vendor: vendor || 'NOKIA',
            title: `Arquivos Associados aos Seus Sites (${associatedFiles.length})`,
            message: `Existem ${associatedFiles.length} arquivo(s) associado(s) ao(s) site(s) [${previewIds}${extraLabel}] pelos quais você está responsável.`,
            siteId: demandedSiteIds[0],
            fileName: associatedFiles[0].fileName,
            actorName: 'Engenharia AMETA',
            actorEmail: 'engenharia@ametaservicos.com.br',
            targetRoles: ['Vistoriador'],
            targetEquipes: [nextResp],
            targetEmails: autoLinkedEmails,
          });
        }
      }
    }

    saveDatabase(db);
    broadcastUpdate({
      type: vendor === 'ERICSSON' ? 'ERICSSON_UPDATED' : 'FULL_STATE',
      timestamp: now,
      vendor,
      summary: clearAllForResponsible
        ? `Demanda de "${clearAllForResponsible}" limpa (${updatedCount} site(s) desvinculado(s))`
        : `${updatedCount} site(s) atualizado(s) para Equipe/Dupla ${responsibleName || renameTo || '—'}`,
    });

    res.json({
      updatedCount,
      sites: db.sites,
      ericssonRows: db.ericssonRows || [],
      users: db.users.map(sanitizeUser),
      ericssonUsers: (db.ericssonUsers || []).map(sanitizeUser),
      notifications: db.notifications || [],
    });
  });

  app.post('/api/sites/import-onedrive', async (req, res) => {
    const { url, vendor = 'NOKIA' } = req.body as {
      url?: string;
      vendor?: VendorType;
    };

    if (!url || !url.trim()) {
      res.status(400).json({ error: 'Informe o link compartilhado do OneDrive.' });
      return;
    }

    try {
      let targetShareUrl = url.trim();
      try {
        const parsedUrl = new URL(targetShareUrl);
        const redeemParam = parsedUrl.searchParams.get('redeem');
        if (redeemParam) {
          const decoded = Buffer.from(redeemParam, 'base64').toString('utf-8');
          if (decoded.startsWith('http')) {
            targetShareUrl = decoded;
          }
        }
      } catch {
        // use raw url if URL parsing fails
      }

      const b64 = Buffer.from(targetShareUrl)
        .toString('base64')
        .replace(/=+$/, '')
        .replace(/\//g, '_')
        .replace(/\+/g, '-');
      const encodedToken = `u!${b64}`;

      const badgerRes = await fetch('https://api-badgerp.svc.ms/v1.0/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          AppId: '1141147648',
        },
        body: JSON.stringify({ appId: '5cbed6ac-a083-4e14-b191-b4ba07653de2' }),
      });

      if (!badgerRes.ok) {
        res.status(502).json({ error: 'Não foi possível obter token de leitura do OneDrive.' });
        return;
      }

      const badgerData = (await badgerRes.json()) as { token?: string };
      const metaUrl = `https://my.microsoftpersonalcontent.com/_api/v2.0/shares/${encodedToken}/driveitem`;
      const metaRes = await fetch(metaUrl, {
        headers: {
          Authorization: `Badger ${badgerData.token}`,
          Prefer: 'autoredeem',
        },
      });

      if (!metaRes.ok) {
        res.status(400).json({
          error: 'Não foi possível acessar a planilha no OneDrive. Verifique se o link é público.',
        });
        return;
      }

      const metaJson = (await metaRes.json()) as {
        name?: string;
        '@content.downloadUrl'?: string;
      };
      const downloadUrl = metaJson['@content.downloadUrl'];
      if (!downloadUrl) {
        res.status(400).json({ error: 'Link de download não encontrado nos metadados do OneDrive.' });
        return;
      }

      const dlRes = await fetch(downloadUrl);
      if (!dlRes.ok) {
        res.status(502).json({ error: 'Falha ao baixar o arquivo .xlsx do OneDrive.' });
        return;
      }

      const arrayBuffer = await dlRes.arrayBuffer();
      const parsed = parseExcelWorkbookBuffer(arrayBuffer, vendor);

      res.json({
        fileName: metaJson.name || 'OneDrive_Workbook.xlsx',
        sheetNames: parsed.sheetNames,
        sheetsData: parsed.sheetsData,
        sheetsColumns: parsed.sheetsColumns,
      });
    } catch (err) {
      console.error('OneDrive import error:', err);
      res.status(500).json({ error: 'Erro ao processar planilha do OneDrive.' });
    }
  });

  app.post('/api/sites/bulk', (req, res) => {
    const {
      sites: incomingSites,
      vendor,
      sheetName,
      mode = 'upsert',
      sourceFileName,
      liveSyncUrl,
      columns,
      actorEmail,
    } = req.body as {
      sites: Partial<TelecomSite>[];
      vendor: VendorType;
      sheetName: string;
      mode?: 'upsert' | 'append' | 'replace_sheet';
      sourceFileName?: string;
      liveSyncUrl?: string;
      columns?: string[];
      actorEmail?: string;
    };

    if (!Array.isArray(incomingSites) || incomingSites.length === 0 || !vendor || !sheetName) {
      res.status(400).json({ error: 'Nenhum site válido recebido para importação em massa.' });
      return;
    }

    const now = new Date().toISOString();
    const author = actorEmail || 'engenharia@ametaservicos.com.br';

    let sheet = db.sheets.find((s) => s.vendor === vendor && s.name === sheetName);
    if (!sheet) {
      sheet = {
        id: `sheet-${Date.now()}`,
        vendor,
        name: sheetName,
        description: sourceFileName
          ? `Planilha alimentada via arquivo ${sourceFileName}`
          : `Planilha ${vendor} alimentada em tempo real`,
        lastSyncAt: now,
        sourceFileName,
        liveSyncUrl,
        columns: Array.isArray(columns) && columns.length > 0 ? columns : undefined,
      };
      db.sheets.push(sheet);
    } else {
      sheet.lastSyncAt = now;
      if (sourceFileName) {
        sheet.sourceFileName = sourceFileName;
      }
      if (liveSyncUrl) {
        sheet.liveSyncUrl = liveSyncUrl;
      }
      if (Array.isArray(columns) && columns.length > 0) {
        sheet.columns = columns;
      }
    }

    if (mode === 'replace_sheet') {
      db.sites = db.sites.filter((s) => !(s.vendor === vendor && s.sheetName === sheetName));
    }

    let insertedCount = 0;
    let updatedCount = 0;
    const newlyInserted: TelecomSite[] = [];

    incomingSites.forEach((raw, idx) => {
      const normalizedSiteId = (raw.siteId || `${vendor === 'NOKIA' ? 'NK' : 'ER'}-NEW-${idx + 1}`)
        .toString()
        .trim()
        .toUpperCase();

      const existingIndex =
        mode === 'upsert'
          ? db.sites.findIndex(
              (s) =>
                s.vendor === vendor &&
                s.sheetName === (raw.sheetName || sheetName) &&
                s.siteId.toUpperCase() === normalizedSiteId &&
                (s.siteName || '') === (raw.siteName || s.siteName || '')
            )
          : -1;

      if (existingIndex !== -1) {
        const current = db.sites[existingIndex];
        db.sites[existingIndex] = {
          ...current,
          ...raw,
          id: current.id,
          siteId: normalizedSiteId,
          vendor,
          sheetName: raw.sheetName || sheetName,
          customFields: {
            ...(current.customFields || {}),
            ...(raw.customFields || {}),
          },
          updatedAt: now,
          updatedBy: author,
        };
        updatedCount++;
      } else {
        const newSite: TelecomSite = {
          id: `site-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          siteId: normalizedSiteId,
          vendor,
          sheetName: raw.sheetName || sheetName,
          siteName: raw.siteName || normalizedSiteId,
          uf: (raw.uf || 'SP').toUpperCase().slice(0, 2),
          municipio: raw.municipio || '',
          regional: raw.regional || '',
          endereco: raw.endereco || '',
          latitude: raw.latitude || '',
          longitude: raw.longitude || '',
          tipoInfra: raw.tipoInfra || 'Greenfield',
          tecnologias: raw.tecnologias || '',
          bandas: raw.bandas || '',
          gabineteBbu: raw.gabineteBbu || '',
          modulosRf: raw.modulosRf || '',
          versaoSw: raw.versaoSw || '',
          setores: raw.setores || '',
          azimutes: raw.azimutes || '',
          alturaAntena: raw.alturaAntena || '',
          tiltEletrico: raw.tiltEletrico || '',
          transporteTx: raw.transporteTx || '',
          ipGerencia: raw.ipGerencia || '',
          vlanOm: raw.vlanOm || '',
          energiaRetificadora: raw.energiaRetificadora || '',
          status: (raw.status as TelecomSite['status']) || 'Vistoria - Finalizada',
          progressoRollout:
            typeof raw.progressoRollout === 'number'
              ? Math.min(100, Math.max(0, raw.progressoRollout))
              : 100,
          dataIntegracao: raw.dataIntegracao || '',
          dataAtivacao: raw.dataAtivacao || '',
          responsavelCampo: raw.responsavelCampo || '',
          equipeParceira: raw.equipeParceira || '',
          ordemServico: raw.ordemServico || '',
          alarmesAtivos: raw.alarmesAtivos || '',
          observacoes: raw.observacoes || '',
          customFields: raw.customFields || {},
          isNew: mode !== 'replace_sheet',
          createdAt: now,
          updatedAt: now,
          updatedBy: author,
        };
        newlyInserted.push(newSite);
        insertedCount++;
      }
    });

    if (newlyInserted.length > 0) {
      db.sites.unshift(...newlyInserted);
    }

    syncEquipesResourcesToUsers(db);
    saveDatabase(db);

    broadcastUpdate({
      type: 'SITES_BULK_UPSERT',
      timestamp: now,
      actorEmail: author,
      vendor,
      summary: `Planilha ${vendor} atualizada: ${insertedCount} novos, ${updatedCount} atualizados`,
    });

    res.status(200).json({
      insertedCount,
      updatedCount,
      sites: db.sites,
      sheets: db.sheets,
      users: db.users.map(sanitizeUser),
    });
  });

  app.post('/api/sheets', (req, res) => {
    const { vendor, name, description, liveSyncUrl } = req.body as {
      vendor?: VendorType;
      name?: string;
      description?: string;
      liveSyncUrl?: string;
    };

    if (!vendor || !name) {
      res.status(400).json({ error: 'Informe o fabricante (Nokia/Ericsson) e o nome da planilha.' });
      return;
    }

    const now = new Date().toISOString();
    const existing = db.sheets.find(
      (s) => s.vendor === vendor && s.name.toLowerCase() === name.trim().toLowerCase()
    );

    if (existing) {
      existing.description = description || existing.description;
      existing.liveSyncUrl = liveSyncUrl ?? existing.liveSyncUrl;
      existing.lastSyncAt = now;
      saveDatabase(db);
      broadcastUpdate({
        type: 'SHEET_CREATED',
        timestamp: now,
        vendor,
        summary: `Planilha "${existing.name}" atualizada`,
      });
      res.json({ sheet: existing, sheets: db.sheets });
      return;
    }

    const newSheet: SpreadsheetMeta = {
      id: `sheet-${Date.now()}`,
      vendor,
      name: name.trim(),
      description: description || `Planilha operacional ${vendor}`,
      lastSyncAt: now,
      liveSyncUrl,
    };

    db.sheets.push(newSheet);
    saveDatabase(db);

    broadcastUpdate({
      type: 'SHEET_CREATED',
      timestamp: now,
      vendor,
      summary: `Nova planilha "${newSheet.name}" criada em ${vendor}`,
    });

    res.status(201).json({ sheet: newSheet, sheets: db.sheets });
  });

  // ===================== ERICSSON INDEPENDENT SYSTEM ENDPOINTS =====================

  async function downloadOneDriveWorkbookBuffer(rawUrl: string): Promise<{
    fileName: string;
    arrayBuffer: ArrayBuffer;
  }> {
    let targetShareUrl = rawUrl.trim();
    try {
      const parsedUrl = new URL(targetShareUrl);
      const redeemParam = parsedUrl.searchParams.get('redeem');
      if (redeemParam) {
        const decoded = Buffer.from(redeemParam, 'base64').toString('utf-8');
        if (decoded.startsWith('http')) {
          targetShareUrl = decoded;
        }
      }
    } catch {
      // use raw url if URL parsing fails
    }

    const b64 = Buffer.from(targetShareUrl)
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\//g, '_')
      .replace(/\+/g, '-');
    const encodedToken = `u!${b64}`;

    const badgerRes = await fetch('https://api-badgerp.svc.ms/v1.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AppId: '1141147648',
      },
      body: JSON.stringify({ appId: '5cbed6ac-a083-4e14-b191-b4ba07653de2' }),
    });

    if (!badgerRes.ok) {
      throw new Error('Não foi possível obter token de leitura do OneDrive.');
    }

    const badgerData = (await badgerRes.json()) as { token?: string };
    const metaUrl = `https://my.microsoftpersonalcontent.com/_api/v2.0/shares/${encodedToken}/driveitem`;
    const metaRes = await fetch(metaUrl, {
      headers: {
        Authorization: `Badger ${badgerData.token}`,
        Prefer: 'autoredeem',
      },
    });

    if (!metaRes.ok) {
      throw new Error('Não foi possível acessar a planilha no OneDrive. Verifique se o link é público.');
    }

    const metaJson = (await metaRes.json()) as {
      name?: string;
      '@content.downloadUrl'?: string;
    };
    const downloadUrl = metaJson['@content.downloadUrl'];
    if (!downloadUrl) {
      throw new Error('Link de download não encontrado nos metadados do OneDrive.');
    }

    const dlRes = await fetch(downloadUrl);
    if (!dlRes.ok) {
      throw new Error('Falha ao baixar o arquivo .xlsx do OneDrive.');
    }

    const arrayBuffer = await dlRes.arrayBuffer();
    return {
      fileName: metaJson.name || 'PLAN. AMETA_Controle EDB.xlsx',
      arrayBuffer,
    };
  }

  // ===================== ERICSSON ENGENHARIA — ÁREA EXCLUSIVA & SEPARADA =====================

  // 1. Get current Ericsson Engenharia data & consolidated stats (WR, QRF, PPI, BOQ)
  app.get('/api/ericsson/engenharia/data', (_req, res) => {
    const rows = db.ericsson_engenharia || [];
    const stats = computeEricssonConsolidatedStats(rows);
    res.json({
      rows,
      meta: db.ericsson_engenharia_meta || {
        id: 'ericsson-eng-sheet-main',
        tabName: 'Site list',
        sourceFileName: 'AMETA_REPORT DOCUMENTACAO_PLANEJAMENTO_WXX.xlsx',
        liveSyncUrl: DEFAULT_ERICSSON_ENG_ONEDRIVE_URL,
        lastSyncAt: new Date().toISOString(),
        totalRows: rows.length,
        columns: [...ERICSSON_SITE_LIST_COLUMNS],
      },
      columns: db.ericsson_engenharia_meta?.columns || [...ERICSSON_SITE_LIST_COLUMNS],
      stats,
    });
  });

  // 2. Import / Sync Ericsson Engenharia spreadsheet from OneDrive shared link
  app.post('/api/ericsson/engenharia/import-onedrive', async (req, res) => {
    const { url } = req.body as { url?: string };
    const targetUrl = (url || db.ericsson_engenharia_meta?.liveSyncUrl || DEFAULT_ERICSSON_ENG_ONEDRIVE_URL).trim();

    if (!targetUrl) {
      res.status(400).json({ error: 'Informe o link compartilhado da planilha da Ericsson no OneDrive.' });
      return;
    }

    try {
      const downloaded = await downloadOneDriveWorkbookBuffer(targetUrl);
      const parsed = parseEricssonEngineeringWorkbookBuffer(downloaded.arrayBuffer);

      if (parsed.rows.length === 0) {
        res.status(400).json({ error: 'Nenhuma linha válida encontrada na planilha de engenharia da Ericsson.' });
        return;
      }

      // Preserve any previously attached files
      const existingFilesMap = new Map<string, { fileId?: string; fileName?: string; fileUrl?: string; uploadedBy?: string; uploadedAt?: string }>();
      (db.ericsson_engenharia || []).forEach((r) => {
        if (r.attachedFileId) {
          existingFilesMap.set(r.id, {
            fileId: r.attachedFileId,
            fileName: r.attachedFileName,
            fileUrl: r.attachedFileUrl,
            uploadedBy: r.attachedUploadedBy,
            uploadedAt: r.attachedUploadedAt,
          });
          if (r.rowKey) {
            existingFilesMap.set(r.rowKey, {
              fileId: r.attachedFileId,
              fileName: r.attachedFileName,
              fileUrl: r.attachedFileUrl,
              uploadedBy: r.attachedUploadedBy,
              uploadedAt: r.attachedUploadedAt,
            });
          }
        }
      });

      const updatedRows = parsed.rows.map((r) => {
        const existingAttachment = existingFilesMap.get(r.id) || existingFilesMap.get(r.rowKey);
        if (existingAttachment) {
          return {
            ...r,
            attachedFileId: existingAttachment.fileId,
            attachedFileName: existingAttachment.fileName,
            attachedFileUrl: existingAttachment.fileUrl,
            attachedUploadedBy: existingAttachment.uploadedBy,
            attachedUploadedAt: existingAttachment.uploadedAt,
          };
        }
        return r;
      });

      db.ericsson_engenharia = updatedRows;
      const now = new Date().toISOString();
      db.ericsson_engenharia_meta = {
        id: 'ericsson-eng-sheet-main',
        tabName: parsed.tabName || 'Site list',
        sourceFileName: downloaded.fileName || 'AMETA_REPORT DOCUMENTACAO_PLANEJAMENTO_WXX.xlsx',
        liveSyncUrl: targetUrl,
        lastSyncAt: now,
        totalRows: updatedRows.length,
        columns: parsed.columns,
      };

      saveDatabase(db);
      broadcastUpdate({
        type: 'ERICSSON_ENGENHARIA_UPDATED',
        timestamp: now,
        vendor: 'ERICSSON',
        summary: `Planilha Engenharia Ericsson sincronizada com sucesso (${updatedRows.length} linhas)`,
      });

      const stats = computeEricssonConsolidatedStats(updatedRows);
      res.json({
        rows: updatedRows,
        meta: db.ericsson_engenharia_meta,
        stats,
        count: updatedRows.length,
      });
    } catch (err) {
      console.error('Ericsson Engenharia OneDrive sync error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao sincronizar planilha de Engenharia Ericsson via OneDrive.',
      });
    }
  });

  // 3. Import parsed rows for Ericsson Engenharia
  app.post('/api/ericsson/engenharia/import-rows', (req, res) => {
    const { rows: incomingRows, columns, tabName, sourceFileName } = req.body as {
      rows?: EricssonEngineeringRow[];
      columns?: string[];
      tabName?: string;
      sourceFileName?: string;
    };

    if (!Array.isArray(incomingRows) || incomingRows.length === 0) {
      res.status(400).json({ error: 'Nenhuma linha recebida para importação da Engenharia Ericsson.' });
      return;
    }

    const now = new Date().toISOString();
    db.ericsson_engenharia = incomingRows;
    db.ericsson_engenharia_meta = {
      id: 'ericsson-eng-sheet-main',
      tabName: tabName || 'Site list',
      sourceFileName: sourceFileName || 'Planilha_Engenharia_Ericsson.xlsx',
      lastSyncAt: now,
      totalRows: incomingRows.length,
      columns: Array.isArray(columns) && columns.length > 0 ? columns : [...ERICSSON_SITE_LIST_COLUMNS],
    };

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_ENGENHARIA_UPDATED',
      timestamp: now,
      vendor: 'ERICSSON',
      summary: `Planilha Engenharia Ericsson atualizada (${incomingRows.length} linhas)`,
    });

    const stats = computeEricssonConsolidatedStats(incomingRows);
    res.json({
      rows: incomingRows,
      meta: db.ericsson_engenharia_meta,
      stats,
      count: incomingRows.length,
    });
  });

  // 4. Add new row to Ericsson Engenharia
  app.post('/api/ericsson/engenharia/rows', (req, res) => {
    const body = req.body as Partial<EricssonEngineeringRow>;
    const intervencao = (body.intervencaoClaro || body.fields?.['Intervencao Claro'] || '').trim();
    if (!intervencao && !body.siteIdA) {
      res.status(400).json({ error: 'Informe a Intervenção Claro ou o Site ID.' });
      return;
    }

    if (!Array.isArray(db.ericsson_engenharia)) db.ericsson_engenharia = [];

    const now = new Date().toISOString();
    const newId = `eric-eng-manual-${Date.now()}`;
    const rowFields = body.fields || {};
    rowFields['Intervencao Claro'] = intervencao || body.siteIdA || '';
    if (body.tipoDoc) rowFields['Tipo doc'] = body.tipoDoc;
    if (body.status) rowFields['Status'] = body.status;
    if (body.regional) rowFields['Regional'] = body.regional;
    if (body.tipoSite) rowFields['TIPO SITE'] = body.tipoSite;
    if (body.executor) rowFields['EXECUTOR'] = body.executor;

    const newRow: EricssonEngineeringRow = {
      id: newId,
      rowKey: `${intervencao}__${body.tipoDoc || ''}__${Date.now()}`,
      intervencaoClaro: intervencao,
      siteIdA: (body.siteIdA || intervencao).trim(),
      siteIdB: (body.siteIdB || '').trim(),
      statusA: body.statusA || body.status || 'Pendente',
      statusB: body.statusB || (body.siteIdB ? body.status || 'Pendente' : ''),
      tipoDoc: body.tipoDoc || rowFields['Tipo doc'] || '',
      status: body.status || rowFields['Status'] || 'Pendente',
      regional: body.regional || rowFields['Regional'] || '',
      tipoSite: body.tipoSite || rowFields['TIPO SITE'] || '',
      executor: body.executor || rowFields['EXECUTOR'] || '',
      fields: rowFields,
      siteAVistoriaStatus: 'Pendente',
      siteBVistoriaStatus: body.siteIdB ? 'Pendente' : undefined,
      updatedAt: now,
    };

    db.ericsson_engenharia.unshift(newRow);
    if (db.ericsson_engenharia_meta) {
      db.ericsson_engenharia_meta.totalRows = db.ericsson_engenharia.length;
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_ENGENHARIA_UPDATED',
      timestamp: now,
      vendor: 'ERICSSON',
      summary: `Novo site/linha adicionada na Engenharia Ericsson: ${intervencao}`,
    });

    const stats = computeEricssonConsolidatedStats(db.ericsson_engenharia);
    res.status(201).json({ row: newRow, stats });
  });

  // 5. Update row in Ericsson Engenharia
  app.put('/api/ericsson/engenharia/rows/:id', (req, res) => {
    const { id } = req.params;
    const patch = req.body as Partial<EricssonEngineeringRow>;

    if (!Array.isArray(db.ericsson_engenharia)) db.ericsson_engenharia = [];
    const index = db.ericsson_engenharia.findIndex((r) => r.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Linha não encontrada na Engenharia Ericsson.' });
      return;
    }

    const current = db.ericsson_engenharia[index];
    const now = new Date().toISOString();
    const updatedFields = { ...(current.fields || {}), ...(patch.fields || {}) };

    if (patch.intervencaoClaro !== undefined) {
      updatedFields['Intervencao Claro'] = patch.intervencaoClaro;
    }
    if (patch.tipoDoc !== undefined) {
      updatedFields['Tipo doc'] = patch.tipoDoc;
    }
    if (patch.status !== undefined) {
      updatedFields['Status'] = patch.status;
    }
    if (patch.regional !== undefined) {
      updatedFields['Regional'] = patch.regional;
    }
    if (patch.tipoSite !== undefined) {
      updatedFields['TIPO SITE'] = patch.tipoSite;
    }
    if (patch.executor !== undefined) {
      updatedFields['EXECUTOR'] = patch.executor;
    }

    const updatedRow: EricssonEngineeringRow = {
      ...current,
      ...patch,
      fields: updatedFields,
      updatedAt: now,
    };

    db.ericsson_engenharia[index] = updatedRow;
    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_ENGENHARIA_UPDATED',
      timestamp: now,
      vendor: 'ERICSSON',
      summary: `Linha da Engenharia Ericsson atualizada (${updatedRow.intervencaoClaro})`,
    });

    const stats = computeEricssonConsolidatedStats(db.ericsson_engenharia);
    res.json({ row: updatedRow, stats });
  });

  // 6. Delete row in Ericsson Engenharia
  app.delete('/api/ericsson/engenharia/rows/:id', (req, res) => {
    const { id } = req.params;
    if (!Array.isArray(db.ericsson_engenharia)) db.ericsson_engenharia = [];
    const beforeCount = db.ericsson_engenharia.length;
    db.ericsson_engenharia = db.ericsson_engenharia.filter((r) => r.id !== id);

    if (db.ericsson_engenharia.length === beforeCount) {
      res.status(404).json({ error: 'Linha não encontrada para exclusão.' });
      return;
    }

    const now = new Date().toISOString();
    if (db.ericsson_engenharia_meta) {
      db.ericsson_engenharia_meta.totalRows = db.ericsson_engenharia.length;
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_ENGENHARIA_UPDATED',
      timestamp: now,
      vendor: 'ERICSSON',
      summary: `Linha removida da Engenharia Ericsson`,
    });

    const stats = computeEricssonConsolidatedStats(db.ericsson_engenharia);
    res.json({ success: true, count: db.ericsson_engenharia.length, stats });
  });

  // 6.1 Bulk assign Ericsson Engineering rows to collaborator/executor
  app.post('/api/ericsson/engenharia/rows/bulk-assign', (req, res) => {
    const { rowIds, executorName, demandDate } = req.body as {
      rowIds?: string[];
      executorName?: string;
      demandDate?: string;
    };
    if (!Array.isArray(rowIds) || !executorName) {
      res.status(400).json({ error: 'Parâmetros inválidos.' });
      return;
    }
    const targetDate = demandDate || new Date().toLocaleDateString('pt-BR');
    const idSet = new Set(rowIds.map((id) => String(id).trim().toUpperCase()));
    let updatedCount = 0;
    if (!Array.isArray(db.ericsson_engenharia)) db.ericsson_engenharia = [];
    db.ericsson_engenharia = db.ericsson_engenharia.map((row) => {
      if (
        idSet.has(row.id.toUpperCase()) ||
        idSet.has((row.intervencaoClaro || '').toUpperCase()) ||
        idSet.has((row.siteIdA || '').toUpperCase())
      ) {
        updatedCount++;
        return {
          ...row,
          executor: executorName,
          fields: {
            ...(row.fields || {}),
            EXECUTOR: executorName,
            'Data Demanda': targetDate,
          },
          updatedAt: new Date().toISOString(),
        };
      }
      return row;
    });
    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_ENGENHARIA_UPDATE',
      summary: `${updatedCount} demanda(s) da Engenharia Ericsson atribuídas para "${executorName}".`,
      ericsson_engenharia: db.ericsson_engenharia,
    });
    const stats = computeEricssonConsolidatedStats(db.ericsson_engenharia);
    res.json({ success: true, updatedCount, rows: db.ericsson_engenharia, stats });
  });

  // 6.2 Bulk unassign Ericsson Engineering rows
  app.post('/api/ericsson/engenharia/rows/bulk-unassign', (req, res) => {
    const { rowIds, executorName } = req.body as {
      rowIds?: string[];
      executorName?: string;
    };
    if (!Array.isArray(rowIds)) {
      res.status(400).json({ error: 'Parâmetros inválidos.' });
      return;
    }
    const idSet = new Set(rowIds.map((id) => String(id).trim().toUpperCase()));
    let updatedCount = 0;
    if (!Array.isArray(db.ericsson_engenharia)) db.ericsson_engenharia = [];
    db.ericsson_engenharia = db.ericsson_engenharia.map((row) => {
      if (
        idSet.has(row.id.toUpperCase()) ||
        idSet.has((row.intervencaoClaro || '').toUpperCase()) ||
        idSet.has((row.siteIdA || '').toUpperCase())
      ) {
        updatedCount++;
        const nextFields = { ...(row.fields || {}) };
        delete nextFields.EXECUTOR;
        delete nextFields['Data Demanda'];
        return {
          ...row,
          executor: '',
          fields: nextFields,
          updatedAt: new Date().toISOString(),
        };
      }
      return row;
    });
    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_ENGENHARIA_UPDATE',
      summary: `${updatedCount} demanda(s) desvinculadas de "${executorName || 'executor'}".`,
      ericsson_engenharia: db.ericsson_engenharia,
    });
    const stats = computeEricssonConsolidatedStats(db.ericsson_engenharia);
    res.json({ success: true, updatedCount, rows: db.ericsson_engenharia, stats });
  });

  // 6.3 Clear all demands for an Ericsson executor
  app.post('/api/ericsson/engenharia/rows/clear-executor', (req, res) => {
    const { executorName } = req.body as { executorName?: string };
    const target = (executorName || '').trim().toLowerCase();
    if (!target) {
      res.status(400).json({ error: 'Informe o nome do executor.' });
      return;
    }
    let updatedCount = 0;
    if (!Array.isArray(db.ericsson_engenharia)) db.ericsson_engenharia = [];
    db.ericsson_engenharia = db.ericsson_engenharia.map((row) => {
      if (
        (row.executor || '').trim().toLowerCase() === target ||
        (row.fields?.['EXECUTOR'] || '').trim().toLowerCase() === target
      ) {
        updatedCount++;
        const nextFields = { ...(row.fields || {}) };
        delete nextFields.EXECUTOR;
        delete nextFields['Data Demanda'];
        return {
          ...row,
          executor: '',
          fields: nextFields,
          updatedAt: new Date().toISOString(),
        };
      }
      return row;
    });
    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_ENGENHARIA_UPDATE',
      summary: `Todas as demandas desvinculadas de "${executorName}".`,
      ericsson_engenharia: db.ericsson_engenharia,
    });
    const stats = computeEricssonConsolidatedStats(db.ericsson_engenharia);
    res.json({ success: true, updatedCount, rows: db.ericsson_engenharia, stats });
  });

  // 6.4 Get Ericsson Collaborators / Team
  app.get('/api/ericsson/colaboradores', (_req, res) => {
    if (!Array.isArray(db.ericsson_colaboradores) || db.ericsson_colaboradores.length === 0) {
      db.ericsson_colaboradores = [...DEFAULT_ERICSSON_COLABORADORES];
      saveDatabase(db);
    }
    res.json({ colaboradores: db.ericsson_colaboradores });
  });

  // 6.5 Add or update Ericsson Collaborator
  app.post('/api/ericsson/colaboradores', (req, res) => {
    const { nome, atividade, capacidade, observacoes } = req.body as Partial<EricssonColaborador>;
    const cleanNome = (nome || '').trim();
    if (!cleanNome) {
      res.status(400).json({ error: 'Informe o nome do colaborador.' });
      return;
    }
    if (!Array.isArray(db.ericsson_colaboradores)) {
      db.ericsson_colaboradores = [...DEFAULT_ERICSSON_COLABORADORES];
    }
    const idx = db.ericsson_colaboradores.findIndex(
      (c) => c.nome.toLowerCase() === cleanNome.toLowerCase()
    );
    const newColab: EricssonColaborador = {
      nome: cleanNome,
      atividade: (atividade || 'PPI').trim(),
      capacidade: String(capacidade || '1').trim(),
      observacoes: (observacoes || '').trim(),
    };
    if (idx >= 0) {
      db.ericsson_colaboradores[idx] = newColab;
    } else {
      db.ericsson_colaboradores.push(newColab);
    }
    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_COLABORADORES_UPDATE',
      summary: `Equipe Ericsson atualizada: "${cleanNome}".`,
      ericsson_colaboradores: db.ericsson_colaboradores,
    });
    res.json({ success: true, colaboradores: db.ericsson_colaboradores });
  });

  // 6.6 Delete Ericsson Collaborator
  app.delete('/api/ericsson/colaboradores/:nome', (req, res) => {
    const target = decodeURIComponent(req.params.nome || '').trim().toLowerCase();
    if (!Array.isArray(db.ericsson_colaboradores)) {
      db.ericsson_colaboradores = [...DEFAULT_ERICSSON_COLABORADORES];
    }
    db.ericsson_colaboradores = db.ericsson_colaboradores.filter(
      (c) => c.nome.toLowerCase() !== target
    );
    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_COLABORADORES_UPDATE',
      summary: `Colaborador removido da equipe Ericsson.`,
      ericsson_colaboradores: db.ericsson_colaboradores,
    });
    res.json({ success: true, colaboradores: db.ericsson_colaboradores });
  });

  // 6.7 Link email to Ericsson Executor
  app.post('/api/ericsson/executores/link-email', (req, res) => {
    const { executorName, emails } = req.body as { executorName?: string; emails?: string[] };
    if (!executorName) {
      res.status(400).json({ error: 'Executor não informado.' });
      return;
    }
    if (!db.ericssonExecutorEmailsMap) db.ericssonExecutorEmailsMap = {};
    const cleanEmails = Array.from(new Set((emails || []).map((e) => e.trim().toLowerCase()).filter(Boolean)));
    db.ericssonExecutorEmailsMap[executorName.trim()] = cleanEmails;
    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_EXECUTOR_EMAILS_UPDATE',
      ericssonExecutorEmailsMap: db.ericssonExecutorEmailsMap,
    });
    res.json({ success: true, ericssonExecutorEmailsMap: db.ericssonExecutorEmailsMap });
  });

  // 7. Attach file directly to Ericsson site/row (no subfolders as requested)
  app.post('/api/ericsson/engenharia/upload-file', (req, res) => {
    const { rowId, fileName, fileDataUrl, uploaderName, uploaderEmail } = req.body as {
      rowId?: string;
      fileName?: string;
      fileDataUrl?: string;
      uploaderName?: string;
      uploaderEmail?: string;
    };

    if (!rowId || !fileName) {
      res.status(400).json({ error: 'Informe a linha de destino e o nome do arquivo.' });
      return;
    }

    if (!Array.isArray(db.ericsson_engenharia)) db.ericsson_engenharia = [];
    const row = db.ericsson_engenharia.find((r) => r.id === rowId);
    if (!row) {
      res.status(404).json({ error: 'Linha não encontrada na Engenharia Ericsson.' });
      return;
    }

    const fileId = `eric-eng-file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    // If fileDataUrl is present, write to disk in uploads
    let downloadUrl = `/api/ericsson/engenharia/files/${fileId}/download`;
    if (fileDataUrl && fileDataUrl.includes('base64,')) {
      try {
        const parts = fileDataUrl.split('base64,');
        const b64Data = parts[1];
        const buffer = Buffer.from(b64Data, 'base64');
        const safeName = `${fileId}__${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = path.join(UPLOADS_DIR, safeName);
        fs.writeFileSync(filePath, buffer);
      } catch (e) {
        console.error('Failed to write attached file to disk:', e);
      }
    }

    row.attachedFileId = fileId;
    row.attachedFileName = fileName;
    row.attachedFileUrl = downloadUrl;
    row.attachedUploadedBy = uploaderName || 'Equipe Engenharia';
    row.attachedUploadedAt = now;
    row.updatedAt = now;

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_ENGENHARIA_UPDATED',
      timestamp: now,
      vendor: 'ERICSSON',
      summary: `Arquivo "${fileName}" anexado à linha ${row.intervencaoClaro}`,
    });

    res.json({ row, fileId, fileName, downloadUrl });
  });

  // 1. Import Ericsson spreadsheet from OneDrive Excel Online URL (preserving system Vistoria columns)
  app.post('/api/ericsson/import-onedrive', async (req, res) => {
    const { url, mode = 'replace' } = req.body as {
      url?: string;
      mode?: 'upsert' | 'replace';
    };

    const targetUrl = (url || db.ericssonSheetMeta?.liveSyncUrl || DEFAULT_ERICSSON_ONEDRIVE_URL).trim();
    if (!targetUrl) {
      res.status(400).json({ error: 'Informe o link compartilhado do Excel Online (OneDrive) da Ericsson.' });
      return;
    }

    try {
      const downloaded = await downloadOneDriveWorkbookBuffer(targetUrl);
      const parsed = parseEricssonWorkbookBuffer(downloaded.arrayBuffer);
      if (parsed.rows.length === 0) {
        res.status(400).json({
          error: 'Nenhuma linha válida encontrada na planilha da Ericsson.',
        });
        return;
      }

      const merged = mergeEricssonRowsPreservingVistoria(
        db.ericssonRows || [],
        parsed.rows,
        mode
      );

      db.ericssonRows = merged.rows;
      const counters = computeEricssonSiteCounters(db.ericssonRows);
      const now = new Date().toISOString();
      db.ericssonSheetMeta = {
        id: 'ericsson-sheet-main',
        tabName: parsed.tabName || 'ERICSSON CLARO TX',
        sourceFileName: downloaded.fileName || 'PLAN. AMETA_Controle EDB.xlsx',
        liveSyncUrl: targetUrl,
        lastSyncAt: now,
        totalRows: db.ericssonRows.length,
        totalSites: counters.totalSites,
        columns: parsed.columns,
      };

      saveDatabase(db);
      broadcastUpdate({
        type: 'ERICSSON_UPDATED',
        timestamp: now,
        vendor: 'ERICSSON',
        summary: `Planilha Ericsson sincronizada (${counters.totalSites} sites em ${db.ericssonRows.length} pares, ${merged.preservedVistoriasCount} vistoria(s) preservada(s))`,
      });

      res.json({
        ericssonRows: db.ericssonRows,
        ericssonSheetMeta: db.ericssonSheetMeta,
        insertedCount: merged.insertedCount,
        updatedCount: merged.updatedCount,
        preservedVistoriasCount: merged.preservedVistoriasCount,
      });
    } catch (err) {
      console.error('Ericsson OneDrive import error:', err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Erro ao sincronizar planilha da Ericsson via OneDrive.',
      });
    }
  });

  // 2. Import Ericsson spreadsheet rows parsed from a local .xlsx file (preserving system Vistoria columns)
  app.post('/api/ericsson/import-rows', (req, res) => {
    const {
      rows: incomingRows,
      columns,
      tabName,
      sourceFileName,
      mode = 'replace',
    } = req.body as {
      rows?: EricssonRow[];
      columns?: string[];
      tabName?: string;
      sourceFileName?: string;
      mode?: 'upsert' | 'replace';
    };

    if (!Array.isArray(incomingRows) || incomingRows.length === 0) {
      res.status(400).json({ error: 'Nenhuma linha válida da Ericsson recebida para importação.' });
      return;
    }

    const merged = mergeEricssonRowsPreservingVistoria(
      db.ericssonRows || [],
      incomingRows,
      mode
    );

    db.ericssonRows = merged.rows;
    const counters = computeEricssonSiteCounters(db.ericssonRows);
    const now = new Date().toISOString();

    db.ericssonSheetMeta = {
      id: 'ericsson-sheet-main',
      tabName: tabName || db.ericssonSheetMeta?.tabName || 'ERICSSON CLARO TX',
      sourceFileName: sourceFileName || db.ericssonSheetMeta?.sourceFileName || 'Planilha_Ericsson.xlsx',
      liveSyncUrl: db.ericssonSheetMeta?.liveSyncUrl || DEFAULT_ERICSSON_ONEDRIVE_URL,
      lastSyncAt: now,
      totalRows: db.ericssonRows.length,
      totalSites: counters.totalSites,
      columns:
        Array.isArray(columns) && columns.length > 0
          ? columns
          : db.ericssonSheetMeta?.columns || [...ERICSSON_ORIGINAL_COLUMNS],
    };

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: now,
      vendor: 'ERICSSON',
      summary: `Planilha Ericsson carregada (${counters.totalSites} sites em ${db.ericssonRows.length} linhas, ${merged.preservedVistoriasCount} vistoria(s) preservada(s))`,
    });

    res.json({
      ericssonRows: db.ericssonRows,
      ericssonSheetMeta: db.ericssonSheetMeta,
      insertedCount: merged.insertedCount,
      updatedCount: merged.updatedCount,
      preservedVistoriasCount: merged.preservedVistoriasCount,
    });
  });

  // 3. Create a new Ericsson row (pair of sites)
  app.post('/api/ericsson/rows', (req, res) => {
    const {
      chaves,
      registro,
      state,
      meta,
      siteIdA,
      idDetentoraA,
      siteIdB,
      idDetentoraB,
      statusA,
      statusB,
      cidadeA,
      cidadeB,
      equipe,
      servico,
      fields: incomingFields,
    } = req.body as Partial<EricssonRow>;

    const cleanA = (siteIdA || incomingFields?.['01.21.Site ID A'] || '').trim().toUpperCase();
    const cleanB = (siteIdB || incomingFields?.['01.21.Site ID B'] || '').trim().toUpperCase();

    if (!cleanA && !cleanB) {
      res.status(400).json({ error: 'Informe pelo menos um Site ID (Site ID A ou Site ID B).' });
      return;
    }

    const now = new Date().toISOString();
    const cols = db.ericssonSheetMeta?.columns || [...ERICSSON_ORIGINAL_COLUMNS];
    const rowFields: Record<string, string> = {};
    cols.forEach((c) => {
      rowFields[c] = incomingFields?.[c] || '';
    });

    const finalChaves = (chaves || rowFields['01.00. Chaves'] || `ER-${Date.now().toString().slice(-5)}`).trim();
    const finalRegistro = (registro || rowFields['Registro'] || '').trim();
    const finalState = (state || rowFields['00.03.State'] || '').trim().toUpperCase();
    const finalMeta = (meta || rowFields['Meta'] || '').trim();
    const finalDetA = (idDetentoraA || rowFields['ID Detentora A'] || '').trim();
    const finalDetB = (idDetentoraB || rowFields['ID Detentora B'] || '').trim();
    const finalStatusA = (statusA || rowFields['Status A'] || 'Em andamento').trim();
    const finalStatusB = (statusB || rowFields['Status B'] || 'Em andamento').trim();
    const finalCidadeA = (cidadeA || rowFields['CIDADE A'] || '').trim();
    const finalCidadeB = (cidadeB || rowFields['CIDADE B'] || '').trim();
    const finalEquipe = (equipe || rowFields['EQUIPE'] || '').trim();
    const finalServico = (servico || rowFields['Serviço'] || '').trim();
    const finalSiteName =
      rowFields['00.04.Site Name'] ||
      (cleanA && cleanB ? `${cleanA}-${cleanB}` : cleanA || cleanB);

    rowFields['01.00. Chaves'] = finalChaves;
    rowFields['Registro'] = finalRegistro;
    rowFields['00.03.State'] = finalState;
    rowFields['Meta'] = finalMeta;
    rowFields['01.21.Site ID A'] = cleanA;
    rowFields['ID Detentora A'] = finalDetA;
    rowFields['01.21.Site ID B'] = cleanB;
    rowFields['ID Detentora B'] = finalDetB;
    rowFields['00.04.Site Name'] = finalSiteName;
    rowFields['Status A'] = finalStatusA;
    rowFields['Status B'] = finalStatusB;
    rowFields['CIDADE A'] = finalCidadeA;
    rowFields['CIDADE B'] = finalCidadeB;
    rowFields['EQUIPE'] = finalEquipe;
    rowFields['Serviço'] = finalServico;

    const newRow: EricssonRow = {
      id: `eric-row-${Date.now()}`,
      rowKey: buildEricssonRowKey(finalChaves, finalRegistro, cleanA, cleanB),
      chaves: finalChaves,
      registro: finalRegistro,
      state: finalState,
      meta: finalMeta,
      siteIdA: cleanA,
      idDetentoraA: finalDetA,
      siteIdB: cleanB,
      idDetentoraB: finalDetB,
      siteName: finalSiteName,
      statusA: finalStatusA,
      statusB: finalStatusB,
      cidadeA: finalCidadeA,
      cidadeB: finalCidadeB,
      equipe: finalEquipe,
      servico: finalServico,
      fields: rowFields,
      siteAVistoriaStatus: 'Pendente',
      siteBVistoriaStatus: 'Pendente',
      isManualRow: true,
      createdAt: now,
      updatedAt: now,
    };

    if (!Array.isArray(db.ericssonRows)) db.ericssonRows = [];
    db.ericssonRows.unshift(newRow);

    if (db.ericssonSheetMeta) {
      const counters = computeEricssonSiteCounters(db.ericssonRows);
      db.ericssonSheetMeta.totalRows = db.ericssonRows.length;
      db.ericssonSheetMeta.totalSites = counters.totalSites;
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: now,
      vendor: 'ERICSSON',
      summary: `Nova linha Ericsson criada (${cleanA || '—'} ↔ ${cleanB || '—'})`,
    });

    res.status(201).json({
      row: newRow,
      ericssonRows: db.ericssonRows,
      ericssonSheetMeta: db.ericssonSheetMeta,
    });
  });

  // 4. Update an Ericsson row (original spreadsheet columns only; system vistoria columns are automatic)
  app.put('/api/ericsson/rows/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body as Partial<EricssonRow>;

    if (!Array.isArray(db.ericssonRows)) db.ericssonRows = [];
    const target = db.ericssonRows.find((r) => r.id === id);
    if (!target) {
      res.status(404).json({ error: 'Linha da planilha Ericsson não encontrada.' });
      return;
    }

    const now = new Date().toISOString();
    const mergedFields: Record<string, string> = {
      ...(target.fields || {}),
      ...(updates.fields || {}),
    };

    if (typeof updates.chaves === 'string') mergedFields['01.00. Chaves'] = updates.chaves.trim();
    if (typeof updates.state === 'string') mergedFields['00.03.State'] = updates.state.trim();
    if (typeof updates.registro === 'string') mergedFields['Registro'] = updates.registro.trim();
    if (typeof updates.meta === 'string') mergedFields['Meta'] = updates.meta.trim();
    if (typeof updates.siteIdA === 'string')
      mergedFields['01.21.Site ID A'] = updates.siteIdA.trim().toUpperCase();
    if (typeof updates.idDetentoraA === 'string')
      mergedFields['ID Detentora A'] = updates.idDetentoraA.trim();
    if (typeof updates.siteIdB === 'string')
      mergedFields['01.21.Site ID B'] = updates.siteIdB.trim().toUpperCase();
    if (typeof updates.idDetentoraB === 'string')
      mergedFields['ID Detentora B'] = updates.idDetentoraB.trim();
    if (typeof updates.statusA === 'string') mergedFields['Status A'] = updates.statusA.trim();
    if (typeof updates.statusB === 'string') mergedFields['Status B'] = updates.statusB.trim();
    if (typeof updates.cidadeA === 'string') mergedFields['CIDADE A'] = updates.cidadeA.trim();
    if (typeof updates.cidadeB === 'string') mergedFields['CIDADE B'] = updates.cidadeB.trim();
    if (typeof updates.equipe === 'string') mergedFields['EQUIPE'] = updates.equipe.trim();
    if (typeof updates.servico === 'string') mergedFields['Serviço'] = updates.servico.trim();

    const prevEquipe = (target.equipe || '').trim();
    const prevStatusA = (target.statusA || '').trim();
    const prevStatusB = (target.statusB || '').trim();

    target.fields = mergedFields;
    target.chaves = mergedFields['01.00. Chaves'] || target.chaves;
    target.state = mergedFields['00.03.State'] || target.state;
    target.registro = mergedFields['Registro'] || target.registro;
    target.meta = mergedFields['Meta'] || target.meta;
    target.siteIdA = (mergedFields['01.21.Site ID A'] || target.siteIdA).trim().toUpperCase();
    target.idDetentoraA = mergedFields['ID Detentora A'] ?? target.idDetentoraA;
    target.siteIdB = (mergedFields['01.21.Site ID B'] || target.siteIdB).trim().toUpperCase();
    target.idDetentoraB = mergedFields['ID Detentora B'] ?? target.idDetentoraB;
    target.siteName =
      mergedFields['00.04.Site Name'] ||
      (target.siteIdA && target.siteIdB
        ? `${target.siteIdA}-${target.siteIdB}`
        : target.siteIdA || target.siteIdB);
    target.statusA = mergedFields['Status A'] ?? target.statusA;
    target.statusB = mergedFields['Status B'] ?? target.statusB;
    target.cidadeA = mergedFields['CIDADE A'] ?? target.cidadeA;
    target.cidadeB = mergedFields['CIDADE B'] ?? target.cidadeB;
    target.equipe = mergedFields['EQUIPE'] ?? target.equipe;
    target.servico = mergedFields['Serviço'] ?? target.servico;
    target.rowKey = buildEricssonRowKey(
      target.chaves,
      target.registro,
      target.siteIdA,
      target.siteIdB
    );
    target.updatedAt = now;

    const nextEquipe = (target.equipe || '').trim();
    const pairLabel =
      target.siteIdA && target.siteIdB
        ? `${target.siteIdA} ↔ ${target.siteIdB}`
        : target.siteIdA || target.siteIdB || target.chaves;

    if (nextEquipe && nextEquipe.toLowerCase() !== prevEquipe.toLowerCase()) {
      pushNotification(db, {
        type: 'SITE_DEMANDADO_EXECUTOR',
        vendor: 'ERICSSON',
        title: `Site Demandado (Ericsson): ${pairLabel}`,
        message: `O enlace/site ${pairLabel} foi demandado para a equipe "${nextEquipe}" na plataforma Ericsson.`,
        siteId: pairLabel,
        actorName: 'Coordenação Ericsson',
        actorEmail: 'coord.geral.ericsson@ametaservicos.com.br',
        targetRoles: ['Executor', 'Vistoriador'],
        targetEquipes: [nextEquipe],
      });
    }

    if (
      nextEquipe !== prevEquipe ||
      target.statusA !== prevStatusA ||
      target.statusB !== prevStatusB
    ) {
      pushNotification(db, {
        type: 'EXECUTOR_ATUALIZOU_EQUIPE',
        vendor: 'ERICSSON',
        title: `Atualização de Equipe / Enlace: ${pairLabel}`,
        message: `O enlace ${pairLabel} (Equipe: ${nextEquipe || 'Sem equipe'}) teve atualização de equipe/status (${target.statusA} / ${target.statusB}).`,
        siteId: pairLabel,
        actorName: nextEquipe || 'Executor Ericsson',
        actorEmail: 'executor@ametaservicos.com.br',
        targetRoles: ['Coordenador Geral', 'Coordenador Engenharia', 'ADM'],
      });
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: now,
      vendor: 'ERICSSON',
      summary: `Linha Ericsson ${target.siteIdA} ↔ ${target.siteIdB} atualizada`,
    });

    res.json({
      row: target,
      ericssonRows: db.ericssonRows,
    });
  });

  // 5. Delete an Ericsson row
  app.delete('/api/ericsson/rows/:id', (req, res) => {
    const { id } = req.params;
    if (!Array.isArray(db.ericssonRows)) db.ericssonRows = [];
    const target = db.ericssonRows.find((r) => r.id === id);
    if (!target) {
      res.status(404).json({ error: 'Linha não encontrada.' });
      return;
    }

    db.ericssonRows = db.ericssonRows.filter((r) => r.id !== id);
    if (db.ericssonSheetMeta) {
      const counters = computeEricssonSiteCounters(db.ericssonRows);
      db.ericssonSheetMeta.totalRows = db.ericssonRows.length;
      db.ericssonSheetMeta.totalSites = counters.totalSites;
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: new Date().toISOString(),
      vendor: 'ERICSSON',
      summary: `Linha ${target.siteIdA} ↔ ${target.siteIdB} removida`,
    });

    res.json({
      ericssonRows: db.ericssonRows,
      ericssonSheetMeta: db.ericssonSheetMeta,
    });
  });

  // 6. Upload Ericsson Vistoria file linked to a Row (vistoria always goes together for the link/site, just like Nokia)
  app.post('/api/ericsson/vistoria/upload', (req, res) => {
    const {
      rowId,
      targetSide = 'A',
      linkedSiteId,
      folderId,
      assignedTo,
      createNewRow,
      newRowData,
      fileName,
      fileSize,
      base64Data,
      files: incomingFiles,
      notes,
      uploadedByName,
      uploadedByEmail,
      uploadedByRole,
      uploadedFolderName,
    } = req.body as {
      rowId?: string;
      targetSide?: 'A' | 'B' | 'LOS' | 'BOTH' | 'TSSR';
      linkedSiteId?: string;
      folderId?: string;
      assignedTo?: string;
      createNewRow?: boolean;
      newRowData?: {
        chaves?: string;
        state?: string;
        siteIdA?: string;
        siteIdB?: string;
        cidadeA?: string;
        cidadeB?: string;
        equipe?: string;
        servico?: string;
      };
      fileName?: string;
      fileSize?: number;
      base64Data?: string;
      files?: Array<{
        fileName: string;
        fileSize: number;
        base64Data: string;
      }>;
      notes?: string;
      uploadedByName?: string;
      uploadedByEmail?: string;
      uploadedByRole?: string;
      uploadedFolderName?: string;
    };

    const resolvedEricRole =
      uploadedByRole ||
      db.users.find(
        (u) => u.email.toLowerCase() === String(uploadedByEmail || '').trim().toLowerCase()
      )?.role ||
      '';

    if (
      resolvedEricRole === 'Vistoriador' &&
      (targetSide === 'TSSR' || String(notes || '').toUpperCase().includes('[TSSR]'))
    ) {
      res.status(403).json({
        error:
          'O perfil Vistoriador não tem permissão para subir TSSR. Apenas o Executor e Coordenação de Engenharia podem subir TSSR.',
      });
      return;
    }

    const filesToProcess =
      Array.isArray(incomingFiles) && incomingFiles.length > 0
        ? incomingFiles
        : fileName && base64Data
        ? [{ fileName, fileSize: fileSize || 0, base64Data }]
        : [];

    if (filesToProcess.length === 0) {
      res.status(400).json({ error: 'Selecione pelo menos um arquivo da vistoria para enviar.' });
      return;
    }
    if (!uploadedByName || !uploadedByName.trim()) {
      res.status(400).json({ error: 'Nome de quem está enviando é obrigatório.' });
      return;
    }

    if (!Array.isArray(db.ericssonRows)) db.ericssonRows = [];

    let targetRow = rowId ? db.ericssonRows.find((r) => r.id === rowId) : undefined;

    if (!targetRow && createNewRow && newRowData) {
      const cleanA = (newRowData.siteIdA || '').trim().toUpperCase();
      const cleanB = (newRowData.siteIdB || '').trim().toUpperCase();
      if (!cleanA && !cleanB) {
        res.status(400).json({
          error: 'Informe o Site ID para criar a nova linha vinculada na planilha Ericsson.',
        });
        return;
      }

      const nowIso = new Date().toISOString();
      const cols = db.ericssonSheetMeta?.columns || [...ERICSSON_ORIGINAL_COLUMNS];
      const rowFields: Record<string, string> = {};
      cols.forEach((c) => {
        rowFields[c] = '';
      });

      const finalChaves = (newRowData.chaves || `ER-${Date.now().toString().slice(-5)}`).trim();
      const finalState = (newRowData.state || 'SP').trim().toUpperCase();
      const finalSiteName = cleanA && cleanB ? `${cleanA}-${cleanB}` : cleanA || cleanB;

      rowFields['01.00. Chaves'] = finalChaves;
      rowFields['00.03.State'] = finalState;
      rowFields['01.21.Site ID A'] = cleanA;
      rowFields['01.21.Site ID B'] = cleanB;
      rowFields['00.04.Site Name'] = finalSiteName;
      rowFields['Status A'] = 'Em andamento';
      rowFields['Status B'] = 'Em andamento';
      rowFields['CIDADE A'] = (newRowData.cidadeA || '').trim();
      rowFields['CIDADE B'] = (newRowData.cidadeB || '').trim();
      rowFields['EQUIPE'] = (newRowData.equipe || '').trim();
      rowFields['Serviço'] = (newRowData.servico || 'LOS A / LOS e Vistoria B').trim();

      targetRow = {
        id: `eric-row-${Date.now()}`,
        rowKey: buildEricssonRowKey(finalChaves, '', cleanA, cleanB),
        chaves: finalChaves,
        registro: '',
        state: finalState,
        meta: '',
        siteIdA: cleanA,
        idDetentoraA: '',
        siteIdB: cleanB,
        idDetentoraB: '',
        siteName: finalSiteName,
        statusA: 'Em andamento',
        statusB: 'Em andamento',
        cidadeA: rowFields['CIDADE A'],
        cidadeB: rowFields['CIDADE B'],
        equipe: rowFields['EQUIPE'],
        servico: rowFields['Serviço'],
        fields: rowFields,
        siteAVistoriaStatus: 'Pendente',
        siteBVistoriaStatus: 'Pendente',
        losStatus: 'Pendente',
        isManualRow: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      db.ericssonRows.unshift(targetRow);
      if (db.ericssonSheetMeta) {
        const counters = computeEricssonSiteCounters(db.ericssonRows);
        db.ericssonSheetMeta.totalRows = db.ericssonRows.length;
        db.ericssonSheetMeta.totalSites = counters.totalSites;
      }
    }

    if (!targetRow) {
      res.status(400).json({
        error:
          'Envio sem vínculo não permitido. Selecione o site na planilha Ericsson ou crie uma nova linha.',
      });
      return;
    }

    const pairLabel =
      targetRow.siteIdA && targetRow.siteIdB
        ? `${targetRow.siteIdA} ↔ ${targetRow.siteIdB}`
        : targetRow.siteIdA || targetRow.siteIdB || targetRow.chaves;

    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const now = new Date().toISOString();
    const formattedDeliveryDate = new Date(now).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    if (!Array.isArray(db.ericssonFolders)) db.ericssonFolders = [];
    if (!Array.isArray(db.ericssonFiles)) db.ericssonFiles = [];

    const validFolder =
      folderId && db.ericssonFolders.some((f) => f.id === folderId)
        ? folderId
        : 'folder-ericsson-root';
    let targetFolderId = validFolder;

    if (typeof uploadedFolderName === 'string' && uploadedFolderName.trim()) {
      const cleanFolderName = uploadedFolderName.trim();
      const existingUploadedFolder = db.ericssonFolders.find(
        (f) =>
          f.parentId === validFolder &&
          f.name.trim().toLowerCase() === cleanFolderName.toLowerCase()
      );
      if (existingUploadedFolder) {
        targetFolderId = existingUploadedFolder.id;
      } else {
        const newUploadedFolder: EngineeringFolder = {
          id: `eric-folder-up-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          parentId: validFolder,
          name: cleanFolderName,
          vendor: 'ERICSSON',
          description: notes?.trim() || `Pasta enviada por ${uploadedByName.trim()}`,
          createdByName: uploadedByName.trim(),
          createdByEmail: (uploadedByEmail || 'executor@ametaservicos.com.br').trim(),
          createdAt: now,
          isSystem: false,
        };
        db.ericssonFolders.push(newUploadedFolder);
        targetFolderId = newUploadedFolder.id;
      }
    }

    const createdFiles: EngineeringFile[] = [];

    filesToProcess.forEach((rawFile, idx) => {
      const cleanName = path.basename(rawFile.fileName || `vistoria_${idx + 1}.zip`);
      const fileId = `eric-vist-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
      const safeDiskName = `${fileId}_${cleanName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const diskPath = path.join(UPLOADS_DIR, safeDiskName);

      const base64Clean = (rawFile.base64Data || '').includes(',')
        ? rawFile.base64Data.split(',')[1]
        : rawFile.base64Data || '';
      const buffer = Buffer.from(base64Clean, 'base64');
      fs.writeFileSync(diskPath, buffer);

      const { fileType, extension } = detectFileType(cleanName);

      const resolvedSiteTag =
        targetSide === 'TSSR'
          ? `${linkedSiteId || targetRow.siteIdA || pairLabel} [TSSR]`
          : targetSide === 'A'
            ? `${targetRow.siteIdA || pairLabel} [Vistoria A]`
            : targetSide === 'B'
              ? `${targetRow.siteIdB || pairLabel} [Vistoria B]`
              : targetSide === 'LOS'
                ? `${linkedSiteId || targetRow.siteIdA || pairLabel} [LOS]`
                : pairLabel;

      const newFileRecord: EngineeringFile = {
        id: fileId,
        folderId: targetFolderId,
        vendor: 'ERICSSON',
        fileName: cleanName,
        fileType,
        extension,
        fileSize: rawFile.fileSize || buffer.length,
        siteId: resolvedSiteTag,
        ocSitePre: targetRow.chaves,
        tssrRowId: targetRow.id,
        notes:
          notes?.trim() ||
          (targetSide === 'TSSR'
            ? `[TSSR] Pacote TSSR Ericsson (${linkedSiteId || pairLabel})`
            : targetSide === 'LOS'
              ? `LOS Ericsson (${linkedSiteId || pairLabel})`
              : `Vistoria Site ${targetSide} (${pairLabel})`),
        assignedTo: assignedTo?.trim() || undefined,
        uploadedByName: uploadedByName.trim(),
        uploadedByEmail: uploadedByEmail?.trim() || 'vistoria@ametaservicos.com.br',
        uploadedAt: now,
        storageFileName: safeDiskName,
      };

      db.ericssonFiles!.unshift(newFileRecord);
      createdFiles.push(newFileRecord);
    });

    const primaryFile = createdFiles[0];
    const fileViewUrl = `/api/ericsson/files/${encodeURIComponent(primaryFile.id)}/view`;
    const fileDownloadUrl = `/api/ericsson/files/${encodeURIComponent(primaryFile.id)}/download`;

    if (targetSide === 'A') {
      // Delivering Vistoria A marks A as Entregue and B as Dispensado!
      targetRow.siteAVistoriaStatus = 'Entregue';
      targetRow.siteAVistoriaFileId = primaryFile.id;
      targetRow.siteAVistoriaFolderId = targetFolderId;
      targetRow.siteAVistoriaFileName = primaryFile.fileName;
      targetRow.siteAVistoriaFileUrl = fileViewUrl;
      targetRow.siteAVistoriaDownloadUrl = fileDownloadUrl;
      targetRow.siteAVistoriaDeliveredAt = formattedDeliveryDate;
      targetRow.siteAVistoriaUploadedBy = uploadedByName.trim();
      targetRow.siteAVistoriaUploadedByEmail =
        uploadedByEmail?.trim() || 'vistoria@ametaservicos.com.br';

      targetRow.siteBVistoriaStatus = 'Dispensado';
    } else if (targetSide === 'B') {
      // Delivering Vistoria B marks B as Entregue and A as Dispensado!
      targetRow.siteBVistoriaStatus = 'Entregue';
      targetRow.siteBVistoriaFileId = primaryFile.id;
      targetRow.siteBVistoriaFolderId = targetFolderId;
      targetRow.siteBVistoriaFileName = primaryFile.fileName;
      targetRow.siteBVistoriaFileUrl = fileViewUrl;
      targetRow.siteBVistoriaDownloadUrl = fileDownloadUrl;
      targetRow.siteBVistoriaDeliveredAt = formattedDeliveryDate;
      targetRow.siteBVistoriaUploadedBy = uploadedByName.trim();
      targetRow.siteBVistoriaUploadedByEmail =
        uploadedByEmail?.trim() || 'vistoria@ametaservicos.com.br';

      targetRow.siteAVistoriaStatus = 'Dispensado';
    } else if (targetSide === 'BOTH') {
      targetRow.siteAVistoriaStatus = 'Entregue';
      targetRow.siteAVistoriaFileId = primaryFile.id;
      targetRow.siteAVistoriaFolderId = targetFolderId;
      targetRow.siteAVistoriaFileName = primaryFile.fileName;
      targetRow.siteAVistoriaFileUrl = fileViewUrl;
      targetRow.siteAVistoriaDownloadUrl = fileDownloadUrl;
      targetRow.siteAVistoriaDeliveredAt = formattedDeliveryDate;
      targetRow.siteAVistoriaUploadedBy = uploadedByName.trim();
      targetRow.siteAVistoriaUploadedByEmail =
        uploadedByEmail?.trim() || 'vistoria@ametaservicos.com.br';

      targetRow.siteBVistoriaStatus = 'Dispensado';
    } else if (targetSide === 'LOS') {
      targetRow.losStatus = 'Entregue';
      targetRow.losLinkedSiteId =
        linkedSiteId?.trim().toUpperCase() || targetRow.siteIdA || targetRow.siteIdB;
      targetRow.losFileId = primaryFile.id;
      targetRow.losFolderId = targetFolderId;
      targetRow.losFileName = primaryFile.fileName;
      targetRow.losFileUrl = fileViewUrl;
      targetRow.losDownloadUrl = fileDownloadUrl;
      targetRow.losDeliveredAt = formattedDeliveryDate;
      targetRow.losUploadedBy = uploadedByName.trim();
      targetRow.losUploadedByEmail =
        uploadedByEmail?.trim() || 'vistoria@ametaservicos.com.br';
    }
    if (
      resolvedEricRole.toLowerCase().includes('execut') ||
      (targetRow.fields?.['Executor'] || '').trim().toLowerCase() === uploadedByName.trim().toLowerCase() ||
      (primaryFile.fileName || '').toUpperCase().includes('TSSR')
    ) {
      if (!targetRow.fields) targetRow.fields = {};
      targetRow.fields['STATUS Engenharia'] = 'TSSR Aguardando aprovação';
    }
    targetRow.updatedAt = now;

    const folderObj = (db.ericssonFolders || []).find((f) => f.id === targetFolderId);
    const isEricTssr =
      targetSide === 'TSSR' ||
      (primaryFile.fileName || '').toUpperCase().includes('TSSR') ||
      (notes || '').toUpperCase().includes('TSSR') ||
      (folderObj?.name || '').toUpperCase().includes('TSSR');

    if (isEricTssr) {
      pushNotification(db, {
        type: 'TSSR_ENVIADO_EXECUTOR',
        vendor: 'ERICSSON',
        title: `TSSR Enviado na Ericsson (${pairLabel})`,
        message: `${uploadedByName.trim()} subiu o arquivo TSSR "${primaryFile.fileName}" do site/enlace ${pairLabel} para revisão da Coordenação de Engenharia Ericsson.`,
        siteId: pairLabel,
        fileName: primaryFile.fileName,
        actorName: uploadedByName.trim(),
        actorEmail: uploadedByEmail?.trim() || 'executor@ametaservicos.com.br',
        targetRoles: ['Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
      });
    } else {
      pushNotification(db, {
        type: 'VISTORIA_OK_PASTA',
        vendor: 'ERICSSON',
        title: `Vistoria na Pasta Ericsson — Status OK (${pairLabel})`,
        message: `${uploadedByName.trim()} enviou o arquivo "${primaryFile.fileName}" para a pasta "${
          folderObj?.name || 'Vistoria Ericsson'
        }" e o status do site ${pairLabel} mudou para OK (Entregue).`,
        siteId: pairLabel,
        fileName: primaryFile.fileName,
        actorName: uploadedByName.trim(),
        actorEmail: uploadedByEmail?.trim() || 'vistoria@ametaservicos.com.br',
        targetRoles: ['Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
      });
    }

    const ericEquipe = (targetRow.equipe || targetRow.fields?.['EQUIPE'] || assignedTo || '').trim();
    const ericEmailRaw = (targetRow.fields?.['E-MAIL DUPLA'] || '').trim();
    const ericEmails = ericEmailRaw
      ? ericEmailRaw.split(/[,;]/).map((e) => e.trim().toLowerCase()).filter(Boolean)
      : [];

    pushNotification(db, {
      type: 'ARQUIVO_ASSOCIADO_SITE_VISTORIADOR',
      vendor: 'ERICSSON',
      title: `Arquivo Associado ao Site Ericsson (${pairLabel})`,
      message: `Há ${createdFiles.length > 1 ? `${createdFiles.length} arquivos associados` : `um arquivo ("${primaryFile.fileName}") associado`} ao site/enlace ${pairLabel} pelo qual você é responsável.`,
      siteId: pairLabel,
      fileName: primaryFile.fileName,
      actorName: uploadedByName.trim(),
      actorEmail: uploadedByEmail?.trim() || 'engenharia@ametaservicos.com.br',
      targetRoles: ['Vistoriador'],
      ...(ericEquipe ? { targetEquipes: [ericEquipe] } : {}),
      ...(ericEmails.length > 0 ? { targetEmails: ericEmails } : {}),
    });

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: now,
      vendor: 'ERICSSON',
      actorEmail: uploadedByEmail,
      summary: `Vistoria entregue para ${pairLabel} por ${uploadedByName.trim()}`,
    });

    res.status(201).json({
      row: targetRow,
      file: primaryFile,
      createdFiles,
      ericssonRows: db.ericssonRows,
      ericssonSheetMeta: db.ericssonSheetMeta,
      ericssonFolders: db.ericssonFolders,
      ericssonFiles: db.ericssonFiles,
    });
  });

  // 6a. Dedicated Ericsson Folders & Files endpoints (completely isolated from Nokia)
  app.post('/api/ericsson/folders', (req, res) => {
    const {
      name,
      parentId,
      description,
      createdByName,
      createdByEmail,
      createdByRole,
      isUploadedFolder,
    } = req.body as {
      name?: string;
      parentId?: string | null;
      description?: string;
      createdByName?: string;
      createdByEmail?: string;
      createdByRole?: string;
      isUploadedFolder?: boolean;
    };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Informe o nome da pasta Ericsson.' });
      return;
    }

    const effectiveRole = normalizeUserRole(createdByRole || undefined, createdByEmail || undefined);
    if ((effectiveRole === 'Executor' || effectiveRole === 'Vistoriador') && !isUploadedFolder) {
      res.status(403).json({
        error:
          `Permissão negada: O perfil ${effectiveRole} não tem permissão para criar pastas manualmente. Ele pode apenas subir pastas/arquivos para o sistema.`,
      });
      return;
    }

    if (!Array.isArray(db.ericssonFolders)) db.ericssonFolders = [];
    if (!Array.isArray(db.ericssonFiles)) db.ericssonFiles = [];

    const targetParentId =
      parentId && db.ericssonFolders.some((f) => f.id === parentId)
        ? parentId
        : 'folder-ericsson-root';

    const duplicate = db.ericssonFolders.find(
      (f) =>
        f.parentId === targetParentId &&
        f.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (duplicate) {
      res.status(409).json({ error: 'Já existe uma pasta com este nome neste local na Ericsson.' });
      return;
    }

    const now = new Date().toISOString();
    const newFolder: EngineeringFolder = {
      id: `eric-folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      parentId: targetParentId,
      name: name.trim(),
      vendor: 'ERICSSON',
      description: description?.trim() || '',
      createdByName: (createdByName || 'Engenharia Ericsson').trim(),
      createdByEmail: (createdByEmail || 'engenharia@ametaservicos.com.br').trim(),
      createdAt: now,
      isSystem: false,
    };

    db.ericssonFolders.push(newFolder);
    saveDatabase(db);

    broadcastUpdate({
      type: 'ERICSSON_FOLDER_CREATED',
      timestamp: now,
      vendor: 'ERICSSON',
      summary: `Nova pasta Ericsson "${newFolder.name}" criada por ${newFolder.createdByName}`,
    });

    res.status(201).json({
      folder: newFolder,
      ericssonFolders: db.ericssonFolders,
      ericssonFiles: db.ericssonFiles,
    });
  });

  app.put('/api/ericsson/folders/:id', (req, res) => {
    const { id } = req.params;
    const { name, description, actorEmail, actorName, actorRole } = req.body as {
      name?: string;
      description?: string;
      actorEmail?: string;
      actorName?: string;
      actorRole?: string;
    };

    if (!Array.isArray(db.ericssonFolders)) db.ericssonFolders = [];
    const folder = db.ericssonFolders.find((f) => f.id === id);
    if (!folder) {
      res.status(404).json({ error: 'Pasta não encontrada na Ericsson.' });
      return;
    }
    if (folder.id === 'folder-ericsson-root' || folder.isSystem) {
      res.status(403).json({ error: 'As pastas principais da Ericsson não podem ser modificadas.' });
      return;
    }

    const resolvedRole = normalizeUserRole(actorRole || undefined, actorEmail || undefined);
    if (resolvedRole === 'Executor' || resolvedRole === 'Vistoriador') {
      const fEmail = (folder.createdByEmail || '').trim().toLowerCase();
      const fName = (folder.createdByName || '').trim().toLowerCase();
      const aEmail = (actorEmail || '').trim().toLowerCase();
      const aName = (actorName || '').trim().toLowerCase();
      const isOwn = (aEmail && fEmail === aEmail) || (aName && fName === aName);
      if (!isOwn) {
        res.status(403).json({
          error:
            `Permissão negada: O perfil ${resolvedRole} pode modificar apenas as pastas que ele mesmo subiu para o sistema.`,
        });
        return;
      }
    }

    if (typeof name === 'string' && name.trim()) {
      folder.name = name.trim();
    }
    if (typeof description === 'string') {
      folder.description = description.trim();
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: new Date().toISOString(),
      vendor: 'ERICSSON',
      summary: `Pasta Ericsson "${folder.name}" atualizada`,
    });

    res.json({
      folder,
      ericssonFolders: db.ericssonFolders,
      ericssonFiles: db.ericssonFiles || [],
    });
  });

  app.delete('/api/ericsson/folders/:id', (req, res) => {
    const { id } = req.params;
    const actorEmail = String(req.query.actorEmail || req.body?.actorEmail || '').trim().toLowerCase();
    const actorName = String(req.query.actorName || req.body?.actorName || '').trim().toLowerCase();
    const actorRole = String(req.query.actorRole || req.body?.actorRole || '').trim();

    if (!Array.isArray(db.ericssonFolders)) db.ericssonFolders = [];
    if (!Array.isArray(db.ericssonFiles)) db.ericssonFiles = [];

    const target = db.ericssonFolders.find((f) => f.id === id);
    if (!target) {
      res.status(404).json({ error: 'Pasta não encontrada na Ericsson.' });
      return;
    }
    if (target.id === 'folder-ericsson-root' || target.isSystem) {
      res.status(403).json({ error: 'A pasta raiz da Ericsson não pode ser removida.' });
      return;
    }

    const resolvedRole = normalizeUserRole(actorRole || undefined, actorEmail || undefined);
    if (resolvedRole === 'Executor' || resolvedRole === 'Vistoriador') {
      const fEmail = (target.createdByEmail || '').trim().toLowerCase();
      const fName = (target.createdByName || '').trim().toLowerCase();
      const isOwn =
        (actorEmail && fEmail === actorEmail) || (actorName && fName === actorName);
      if (!isOwn) {
        res.status(403).json({
          error:
            `Permissão negada: O perfil ${resolvedRole} pode modificar ou excluir apenas as pastas que ele mesmo subiu para o sistema.`,
        });
        return;
      }
    }

    const toRemoveIds = new Set<string>([id]);
    let added = true;
    while (added) {
      added = false;
      for (const f of db.ericssonFolders) {
        if (f.parentId && toRemoveIds.has(f.parentId) && !toRemoveIds.has(f.id)) {
          toRemoveIds.add(f.id);
          added = true;
        }
      }
    }

    const removedFileIds = new Set<string>();
    db.ericssonFiles.forEach((file) => {
      if (toRemoveIds.has(file.folderId)) {
        removedFileIds.add(file.id);
        if (file.storageFileName) {
          const p = path.join(UPLOADS_DIR, file.storageFileName);
          if (fs.existsSync(p)) {
            try {
              fs.unlinkSync(p);
            } catch {
              // ignore
            }
          }
        }
      }
    });

    db.ericssonFolders = db.ericssonFolders.filter((f) => !toRemoveIds.has(f.id));
    db.ericssonFiles = db.ericssonFiles.filter((fl) => !toRemoveIds.has(fl.folderId));

    if (removedFileIds.size > 0 && Array.isArray(db.ericssonRows)) {
      db.ericssonRows.forEach((row) => {
        if (row.siteAVistoriaFileId && removedFileIds.has(row.siteAVistoriaFileId)) {
          row.siteAVistoriaStatus = 'Pendente';
          row.siteAVistoriaFileId = undefined;
          row.siteAVistoriaFolderId = undefined;
          row.siteAVistoriaFileName = undefined;
          row.siteAVistoriaFileUrl = undefined;
          row.siteAVistoriaDownloadUrl = undefined;
          row.siteAVistoriaDeliveredAt = undefined;
          row.siteAVistoriaUploadedBy = undefined;
          row.siteAVistoriaUploadedByEmail = undefined;
          if (row.siteBVistoriaStatus === 'Dispensado') {
            row.siteBVistoriaStatus = 'Pendente';
          }
        }
        if (row.siteBVistoriaFileId && removedFileIds.has(row.siteBVistoriaFileId)) {
          row.siteBVistoriaStatus = 'Pendente';
          row.siteBVistoriaFileId = undefined;
          row.siteBVistoriaFolderId = undefined;
          row.siteBVistoriaFileName = undefined;
          row.siteBVistoriaFileUrl = undefined;
          row.siteBVistoriaDownloadUrl = undefined;
          row.siteBVistoriaDeliveredAt = undefined;
          row.siteBVistoriaUploadedBy = undefined;
          row.siteBVistoriaUploadedByEmail = undefined;
          if (row.siteAVistoriaStatus === 'Dispensado') {
            row.siteAVistoriaStatus = 'Pendente';
          }
        }
        if (row.losFileId && removedFileIds.has(row.losFileId)) {
          row.losStatus = 'Pendente';
          row.losLinkedSiteId = undefined;
          row.losFileId = undefined;
          row.losFolderId = undefined;
          row.losFileName = undefined;
          row.losFileUrl = undefined;
          row.losDownloadUrl = undefined;
          row.losDeliveredAt = undefined;
          row.losUploadedBy = undefined;
          row.losUploadedByEmail = undefined;
        }
      });
    }

    saveDatabase(db);

    broadcastUpdate({
      type: 'ERICSSON_FOLDER_DELETED',
      timestamp: new Date().toISOString(),
      vendor: 'ERICSSON',
      summary: `Pasta "${target.name}" removida da Ericsson`,
    });

    res.json({
      ericssonFolders: db.ericssonFolders,
      ericssonFiles: db.ericssonFiles,
      ericssonRows: db.ericssonRows || [],
    });
  });

  app.get('/api/ericsson/files/:id/view', (req, res) => {
    const { id } = req.params;
    const fileRecord = (db.ericssonFiles || []).find((f) => f.id === id);
    if (!fileRecord) {
      res.status(404).json({ error: 'Arquivo não encontrado na Ericsson.' });
      return;
    }

    if (fileRecord.storageFileName) {
      const diskPath = path.join(UPLOADS_DIR, fileRecord.storageFileName);
      if (fs.existsSync(diskPath)) {
        const mime = detectMimeType(fileRecord.fileName);
        res.setHeader('Content-Type', mime);
        res.setHeader(
          'Content-Disposition',
          `inline; filename="${encodeURIComponent(fileRecord.fileName)}"`
        );
        res.sendFile(diskPath);
        return;
      }
    }

    res.redirect(`/api/ericsson/files/${encodeURIComponent(id)}/download`);
  });

  app.get('/api/ericsson/files/:id/download', (req, res) => {
    const { id } = req.params;
    const fileRecord = (db.ericssonFiles || []).find((f) => f.id === id);
    if (!fileRecord) {
      res.status(404).json({ error: 'Arquivo não encontrado na Ericsson.' });
      return;
    }

    if (fileRecord.storageFileName) {
      const diskPath = path.join(UPLOADS_DIR, fileRecord.storageFileName);
      if (fs.existsSync(diskPath)) {
        res.download(diskPath, fileRecord.fileName);
        return;
      }
    }

    const fallbackBuffer = Buffer.from(
      `AMETA TELECOM - ARQUIVO ERICSSON\nArquivo: ${fileRecord.fileName}\nCarregado por: ${fileRecord.uploadedByName} (${fileRecord.uploadedByEmail})\nSite ID: ${fileRecord.siteId || 'N/A'}\nData: ${fileRecord.uploadedAt}\n`,
      'utf-8'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileRecord.fileName)}"`
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(fallbackBuffer);
  });

  app.get('/api/ericsson/engenharia/files/:id/download', (req, res) => {
    const { id } = req.params;
    const row = (db.ericsson_engenharia || []).find((r) => r.attachedFileId === id);
    const fileName = row?.attachedFileName || `engenharia-ericsson-${id}.bin`;

    if (fs.existsSync(UPLOADS_DIR)) {
      const files = fs.readdirSync(UPLOADS_DIR);
      const match = files.find((f) => f.startsWith(`${id}__`));
      if (match) {
        res.download(path.join(UPLOADS_DIR, match), fileName);
        return;
      }
    }

    const fallbackBuffer = Buffer.from(
      `AMETA TELECOM - ENGENHARIA ERICSSON\nArquivo: ${fileName}\nLinha/Site: ${row?.intervencaoClaro || 'N/A'}\nData: ${row?.attachedUploadedAt || new Date().toISOString()}\n`,
      'utf-8'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(fallbackBuffer);
  });

  app.put('/api/ericsson/files/:id', (req, res) => {
    const { id } = req.params;
    const {
      fileName,
      notes,
      siteId,
      base64Data,
      fileSize,
      actorEmail,
      actorName,
      actorRole,
    } = req.body as {
      fileName?: string;
      notes?: string;
      siteId?: string;
      base64Data?: string;
      fileSize?: number;
      actorEmail?: string;
      actorName?: string;
      actorRole?: string;
    };

    if (!Array.isArray(db.ericssonFiles)) db.ericssonFiles = [];
    const fileRecord = db.ericssonFiles.find((f) => f.id === id);
    if (!fileRecord) {
      res.status(404).json({ error: 'Arquivo não encontrado na Ericsson.' });
      return;
    }

    const resolvedRole = normalizeUserRole(actorRole || undefined, actorEmail || undefined);
    if (resolvedRole === 'Executor' || resolvedRole === 'Vistoriador') {
      const flEmail = (fileRecord.uploadedByEmail || '').trim().toLowerCase();
      const flName = (fileRecord.uploadedByName || '').trim().toLowerCase();
      const aEmail = (actorEmail || '').trim().toLowerCase();
      const aName = (actorName || '').trim().toLowerCase();
      const isOwn = (aEmail && flEmail === aEmail) || (aName && flName === aName);
      if (!isOwn) {
        res.status(403).json({
          error:
            `Permissão negada: O perfil ${resolvedRole} pode modificar apenas as pastas e arquivos que ele mesmo subiu para o sistema.`,
        });
        return;
      }
    }

    if (typeof fileName === 'string' && fileName.trim()) {
      const cleanName = path.basename(fileName.trim());
      fileRecord.fileName = cleanName;
      const { fileType, extension } = detectFileType(cleanName);
      fileRecord.fileType = fileType;
      fileRecord.extension = extension;
    }

    if (typeof base64Data === 'string' && base64Data.trim()) {
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }
      const cleanName = path.basename(fileRecord.fileName || 'vistoria.zip');
      const safeDiskName = `${fileRecord.id}_${cleanName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const diskPath = path.join(UPLOADS_DIR, safeDiskName);
      const base64Clean = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const buffer = Buffer.from(base64Clean, 'base64');
      fs.writeFileSync(diskPath, buffer);
      fileRecord.storageFileName = safeDiskName;
      fileRecord.fileSize = fileSize || buffer.length;
      fileRecord.uploadedAt = new Date().toISOString();
    }

    if (typeof notes === 'string') {
      fileRecord.notes = notes.trim() || undefined;
    }
    if (typeof siteId === 'string' && siteId.trim()) {
      fileRecord.siteId = siteId.trim();
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: new Date().toISOString(),
      vendor: 'ERICSSON',
      summary: `Arquivo Ericsson "${fileRecord.fileName}" atualizado`,
    });

    res.json({
      file: fileRecord,
      ericssonFolders: db.ericssonFolders || [],
      ericssonFiles: db.ericssonFiles,
      ericssonRows: db.ericssonRows || [],
    });
  });

  app.delete('/api/ericsson/files/:id', (req, res) => {
    const { id } = req.params;
    const actorEmail = String(req.query.actorEmail || req.body?.actorEmail || '').trim().toLowerCase();
    const actorName = String(req.query.actorName || req.body?.actorName || '').trim().toLowerCase();
    const actorRole = String(req.query.actorRole || req.body?.actorRole || '').trim();

    if (!Array.isArray(db.ericssonFiles)) db.ericssonFiles = [];
    const existing = db.ericssonFiles.find((f) => f.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Arquivo não encontrado na Ericsson.' });
      return;
    }

    const resolvedRole = normalizeUserRole(actorRole || undefined, actorEmail || undefined);
    if (resolvedRole === 'Executor' || resolvedRole === 'Vistoriador') {
      const flEmail = (existing.uploadedByEmail || '').trim().toLowerCase();
      const flName = (existing.uploadedByName || '').trim().toLowerCase();
      const isOwn =
        (actorEmail && flEmail === actorEmail) || (actorName && flName === actorName);
      if (!isOwn) {
        res.status(403).json({
          error:
            `Permissão negada: O perfil ${resolvedRole} pode modificar ou excluir apenas as pastas e arquivos que ele mesmo subiu para o sistema.`,
        });
        return;
      }
    }

    if (existing.storageFileName) {
      const diskPath = path.join(UPLOADS_DIR, existing.storageFileName);
      if (fs.existsSync(diskPath)) {
        try {
          fs.unlinkSync(diskPath);
        } catch {
          // ignore
        }
      }
    }

    db.ericssonFiles = db.ericssonFiles.filter((f) => f.id !== id);

    if (Array.isArray(db.ericssonRows)) {
      db.ericssonRows.forEach((row) => {
        if (row.siteAVistoriaFileId === id) {
          row.siteAVistoriaStatus = 'Pendente';
          row.siteAVistoriaFileId = undefined;
          row.siteAVistoriaFolderId = undefined;
          row.siteAVistoriaFileName = undefined;
          row.siteAVistoriaFileUrl = undefined;
          row.siteAVistoriaDownloadUrl = undefined;
          row.siteAVistoriaDeliveredAt = undefined;
          row.siteAVistoriaUploadedBy = undefined;
          row.siteAVistoriaUploadedByEmail = undefined;
          if (row.siteBVistoriaStatus === 'Dispensado') {
            row.siteBVistoriaStatus = 'Pendente';
          }
        }
        if (row.siteBVistoriaFileId === id) {
          row.siteBVistoriaStatus = 'Pendente';
          row.siteBVistoriaFileId = undefined;
          row.siteBVistoriaFolderId = undefined;
          row.siteBVistoriaFileName = undefined;
          row.siteBVistoriaFileUrl = undefined;
          row.siteBVistoriaDownloadUrl = undefined;
          row.siteBVistoriaDeliveredAt = undefined;
          row.siteBVistoriaUploadedBy = undefined;
          row.siteBVistoriaUploadedByEmail = undefined;
          if (row.siteAVistoriaStatus === 'Dispensado') {
            row.siteAVistoriaStatus = 'Pendente';
          }
        }
        if (row.losFileId === id) {
          row.losStatus = 'Pendente';
          row.losLinkedSiteId = undefined;
          row.losFileId = undefined;
          row.losFolderId = undefined;
          row.losFileName = undefined;
          row.losFileUrl = undefined;
          row.losDownloadUrl = undefined;
          row.losDeliveredAt = undefined;
          row.losUploadedBy = undefined;
          row.losUploadedByEmail = undefined;
        }
        if (row.smartFileId === id) {
          row.smartStatus = 'Pendente';
          row.smartLinkedSiteId = undefined;
          row.smartFileId = undefined;
          row.smartFolderId = undefined;
          row.smartFileName = undefined;
          row.smartFileUrl = undefined;
          row.smartDownloadUrl = undefined;
          row.smartDeliveredAt = undefined;
          row.smartUploadedBy = undefined;
          row.smartUploadedByEmail = undefined;
        }
        if (row.sdcFileId === id) {
          row.sdcStatus = 'Pendente';
          row.sdcLinkedSiteId = undefined;
          row.sdcFileId = undefined;
          row.sdcFolderId = undefined;
          row.sdcFileName = undefined;
          row.sdcFileUrl = undefined;
          row.sdcDownloadUrl = undefined;
          row.sdcDeliveredAt = undefined;
          row.sdcUploadedBy = undefined;
          row.sdcUploadedByEmail = undefined;
        }
      });
    }

    saveDatabase(db);

    broadcastUpdate({
      type: 'ERICSSON_FILE_DELETED',
      timestamp: new Date().toISOString(),
      vendor: 'ERICSSON',
      summary: `Arquivo "${existing.fileName}" excluído da Ericsson`,
    });

    res.json({
      ericssonFolders: db.ericssonFolders || [],
      ericssonFiles: db.ericssonFiles || [],
      ericssonRows: db.ericssonRows || [],
    });
  });

  // 6b. Toggle Finalizado / Pendente directly in the normal spreadsheet (A, B, LOS, or BOTH)
  app.post('/api/ericsson/rows/:id/toggle-finalizado', (req, res) => {
    const { id } = req.params;
    const {
      side = 'BOTH',
      finalizado,
      actorName,
      actorEmail,
    } = req.body as {
      side?: 'A' | 'B' | 'LOS' | 'SMART' | 'SDC' | 'BOTH';
      finalizado?: boolean;
      actorName?: string;
      actorEmail?: string;
    };

    if (!Array.isArray(db.ericssonRows)) db.ericssonRows = [];
    const targetRow = db.ericssonRows.find((r) => r.id === id);
    if (!targetRow) {
      res.status(404).json({ error: 'Linha não encontrada na planilha Ericsson.' });
      return;
    }

    const now = new Date().toISOString();
    const formattedDate = new Date(now).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const applyToSide = (s: 'A' | 'B' | 'LOS' | 'SMART' | 'SDC') => {
      const currentIsFinalizado =
        s === 'A'
          ? targetRow.siteAVistoriaStatus === 'Entregue'
          : s === 'B'
          ? targetRow.siteBVistoriaStatus === 'Entregue'
          : s === 'LOS'
          ? targetRow.losStatus === 'Entregue'
          : s === 'SMART'
          ? targetRow.smartStatus === 'Entregue'
          : targetRow.sdcStatus === 'Entregue';
      const nextFinalizado =
        typeof finalizado === 'boolean' ? finalizado : !currentIsFinalizado;

      if (s === 'A') {
        targetRow.siteAVistoriaStatus = nextFinalizado ? 'Entregue' : 'Pendente';
        if (nextFinalizado && !targetRow.siteAVistoriaDeliveredAt) {
          targetRow.siteAVistoriaDeliveredAt = formattedDate;
          targetRow.siteAVistoriaUploadedBy = actorName || 'Sistema';
          targetRow.siteAVistoriaUploadedByEmail = actorEmail || '';
        } else if (!nextFinalizado) {
          targetRow.siteAVistoriaDeliveredAt = undefined;
          targetRow.siteAVistoriaUploadedBy = undefined;
          targetRow.siteAVistoriaUploadedByEmail = undefined;
        }
      } else if (s === 'B') {
        targetRow.siteBVistoriaStatus = nextFinalizado ? 'Entregue' : 'Pendente';
        if (nextFinalizado && !targetRow.siteBVistoriaDeliveredAt) {
          targetRow.siteBVistoriaDeliveredAt = formattedDate;
          targetRow.siteBVistoriaUploadedBy = actorName || 'Sistema';
          targetRow.siteBVistoriaUploadedByEmail = actorEmail || '';
        } else if (!nextFinalizado) {
          targetRow.siteBVistoriaDeliveredAt = undefined;
          targetRow.siteBVistoriaUploadedBy = undefined;
          targetRow.siteBVistoriaUploadedByEmail = undefined;
        }
      } else if (s === 'LOS') {
        targetRow.losStatus = nextFinalizado ? 'Entregue' : 'Pendente';
        if (nextFinalizado && !targetRow.losDeliveredAt) {
          targetRow.losDeliveredAt = formattedDate;
          targetRow.losUploadedBy = actorName || 'Sistema';
          targetRow.losUploadedByEmail = actorEmail || '';
        } else if (!nextFinalizado) {
          targetRow.losDeliveredAt = undefined;
          targetRow.losUploadedBy = undefined;
          targetRow.losUploadedByEmail = undefined;
        }
      } else if (s === 'SMART') {
        targetRow.smartStatus = nextFinalizado ? 'Entregue' : 'Pendente';
        if (nextFinalizado && !targetRow.smartDeliveredAt) {
          targetRow.smartDeliveredAt = formattedDate;
          targetRow.smartUploadedBy = actorName || 'Sistema';
          targetRow.smartUploadedByEmail = actorEmail || '';
        } else if (!nextFinalizado) {
          targetRow.smartDeliveredAt = undefined;
          targetRow.smartUploadedBy = undefined;
          targetRow.smartUploadedByEmail = undefined;
        }
      } else if (s === 'SDC') {
        targetRow.sdcStatus = nextFinalizado ? 'Entregue' : 'Pendente';
        if (nextFinalizado && !targetRow.sdcDeliveredAt) {
          targetRow.sdcDeliveredAt = formattedDate;
          targetRow.sdcUploadedBy = actorName || 'Sistema';
          targetRow.sdcUploadedByEmail = actorEmail || '';
        } else if (!nextFinalizado) {
          targetRow.sdcDeliveredAt = undefined;
          targetRow.sdcUploadedBy = undefined;
          targetRow.sdcUploadedByEmail = undefined;
        }
      }
    };

    if (side === 'A') {
      const nextEntregue =
        typeof finalizado === 'boolean'
          ? finalizado
          : targetRow.siteAVistoriaStatus !== 'Entregue';
      if (nextEntregue) {
        targetRow.siteAVistoriaStatus = 'Entregue';
        if (!targetRow.siteAVistoriaDeliveredAt) {
          targetRow.siteAVistoriaDeliveredAt = formattedDate;
          targetRow.siteAVistoriaUploadedBy = actorName || 'Sistema';
          targetRow.siteAVistoriaUploadedByEmail = actorEmail || '';
        }
        targetRow.siteBVistoriaStatus = 'Dispensado';
      } else {
        targetRow.siteAVistoriaStatus = 'Pendente';
        targetRow.siteAVistoriaDeliveredAt = undefined;
        targetRow.siteAVistoriaUploadedBy = undefined;
        targetRow.siteAVistoriaUploadedByEmail = undefined;
        if (targetRow.siteBVistoriaStatus === 'Dispensado') {
          targetRow.siteBVistoriaStatus = 'Pendente';
        }
      }
    } else if (side === 'B') {
      const nextEntregue =
        typeof finalizado === 'boolean'
          ? finalizado
          : targetRow.siteBVistoriaStatus !== 'Entregue';
      if (nextEntregue) {
        targetRow.siteBVistoriaStatus = 'Entregue';
        if (!targetRow.siteBVistoriaDeliveredAt) {
          targetRow.siteBVistoriaDeliveredAt = formattedDate;
          targetRow.siteBVistoriaUploadedBy = actorName || 'Sistema';
          targetRow.siteBVistoriaUploadedByEmail = actorEmail || '';
        }
        targetRow.siteAVistoriaStatus = 'Dispensado';
      } else {
        targetRow.siteBVistoriaStatus = 'Pendente';
        targetRow.siteBVistoriaDeliveredAt = undefined;
        targetRow.siteBVistoriaUploadedBy = undefined;
        targetRow.siteBVistoriaUploadedByEmail = undefined;
        if (targetRow.siteAVistoriaStatus === 'Dispensado') {
          targetRow.siteAVistoriaStatus = 'Pendente';
        }
      }
    } else if (side === 'LOS') {
      applyToSide('LOS');
    } else if (side === 'SMART') {
      applyToSide('SMART');
    } else if (side === 'SDC') {
      applyToSide('SDC');
    } else {
      const nextEntregue =
        typeof finalizado === 'boolean'
          ? finalizado
          : targetRow.siteAVistoriaStatus !== 'Entregue';
      if (nextEntregue) {
        targetRow.siteAVistoriaStatus = 'Entregue';
        targetRow.siteBVistoriaStatus = 'Dispensado';
      } else {
        targetRow.siteAVistoriaStatus = 'Pendente';
        targetRow.siteBVistoriaStatus = 'Pendente';
      }
    }

    targetRow.updatedAt = now;

    const isNowOk =
      targetRow.siteAVistoriaStatus === 'Entregue' ||
      targetRow.siteBVistoriaStatus === 'Entregue' ||
      targetRow.losStatus === 'Entregue';
    const pairLabelToggle =
      targetRow.siteIdA && targetRow.siteIdB
        ? `${targetRow.siteIdA} ↔ ${targetRow.siteIdB}`
        : targetRow.siteIdA || targetRow.siteIdB || targetRow.chaves;

    if (isNowOk) {
      pushNotification(db, {
        type: 'VISTORIA_OK_PASTA',
        vendor: 'ERICSSON',
        title: `Status OK na Engenharia Ericsson (${pairLabelToggle})`,
        message: `${actorName || 'Equipe'} alterou o status da vistoria de ${pairLabelToggle} para OK (Entregue).`,
        siteId: pairLabelToggle,
        actorName: actorName || 'Equipe Ericsson',
        actorEmail: actorEmail || 'vistoria@ametaservicos.com.br',
        targetRoles: ['Coordenador Engenharia', 'Coordenador Geral', 'ADM'],
      });
    }

    saveDatabase(db);

    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: now,
      vendor: 'ERICSSON',
      summary: `Status do site atualizado na planilha Ericsson (${targetRow.siteIdA} ↔ ${targetRow.siteIdB})`,
    });

    res.json({
      row: targetRow,
      ericssonRows: db.ericssonRows,
      notifications: db.notifications || [],
    });
  });

  // 7. Remove/reset Vistoria or LOS file from an Ericsson row
  app.delete('/api/ericsson/vistoria/:rowId/:side', (req, res) => {
    const { rowId, side } = req.params;
    const upperSide = (side || 'BOTH').toUpperCase();

    if (!Array.isArray(db.ericssonRows)) db.ericssonRows = [];
    const targetRow = db.ericssonRows.find((r) => r.id === rowId);
    if (!targetRow) {
      res.status(404).json({ error: 'Linha não encontrada.' });
      return;
    }

    const fileIdsToRemove = new Set<string>();
    if ((upperSide === 'A' || upperSide === 'BOTH') && targetRow.siteAVistoriaFileId) {
      fileIdsToRemove.add(targetRow.siteAVistoriaFileId);
    }
    if ((upperSide === 'B' || upperSide === 'BOTH') && targetRow.siteBVistoriaFileId) {
      fileIdsToRemove.add(targetRow.siteBVistoriaFileId);
    }
    if ((upperSide === 'LOS' || upperSide === 'BOTH') && targetRow.losFileId) {
      fileIdsToRemove.add(targetRow.losFileId);
    }
    if ((upperSide === 'SMART' || upperSide === 'BOTH') && targetRow.smartFileId) {
      fileIdsToRemove.add(targetRow.smartFileId);
    }
    if ((upperSide === 'SDC' || upperSide === 'BOTH') && targetRow.sdcFileId) {
      fileIdsToRemove.add(targetRow.sdcFileId);
    }

    fileIdsToRemove.forEach((fid) => {
      const existingFile =
        (db.ericssonFiles || []).find((f) => f.id === fid) ||
        db.engineeringFiles.find((f) => f.id === fid);
      if (existingFile?.storageFileName) {
        const diskPath = path.join(UPLOADS_DIR, existingFile.storageFileName);
        if (fs.existsSync(diskPath)) {
          try {
            fs.unlinkSync(diskPath);
          } catch {
            // ignore
          }
        }
      }
      if (Array.isArray(db.ericssonFiles)) {
        db.ericssonFiles = db.ericssonFiles.filter((f) => f.id !== fid);
      }
      db.engineeringFiles = db.engineeringFiles.filter((f) => f.id !== fid);
    });

    if (upperSide === 'A' || upperSide === 'BOTH') {
      targetRow.siteAVistoriaStatus = 'Pendente';
      targetRow.siteAVistoriaFileId = undefined;
      targetRow.siteAVistoriaFolderId = undefined;
      targetRow.siteAVistoriaFileName = undefined;
      targetRow.siteAVistoriaFileUrl = undefined;
      targetRow.siteAVistoriaDownloadUrl = undefined;
      targetRow.siteAVistoriaDeliveredAt = undefined;
      targetRow.siteAVistoriaUploadedBy = undefined;
      targetRow.siteAVistoriaUploadedByEmail = undefined;
      if (targetRow.siteBVistoriaStatus === 'Dispensado') {
        targetRow.siteBVistoriaStatus = 'Pendente';
      }
    }
    if (upperSide === 'B' || upperSide === 'BOTH') {
      targetRow.siteBVistoriaStatus = 'Pendente';
      targetRow.siteBVistoriaFileId = undefined;
      targetRow.siteBVistoriaFolderId = undefined;
      targetRow.siteBVistoriaFileName = undefined;
      targetRow.siteBVistoriaFileUrl = undefined;
      targetRow.siteBVistoriaDownloadUrl = undefined;
      targetRow.siteBVistoriaDeliveredAt = undefined;
      targetRow.siteBVistoriaUploadedBy = undefined;
      targetRow.siteBVistoriaUploadedByEmail = undefined;
      if (targetRow.siteAVistoriaStatus === 'Dispensado') {
        targetRow.siteAVistoriaStatus = 'Pendente';
      }
    }
    if (upperSide === 'LOS' || upperSide === 'BOTH') {
      targetRow.losStatus = 'Pendente';
      targetRow.losLinkedSiteId = undefined;
      targetRow.losFileId = undefined;
      targetRow.losFolderId = undefined;
      targetRow.losFileName = undefined;
      targetRow.losFileUrl = undefined;
      targetRow.losDownloadUrl = undefined;
      targetRow.losDeliveredAt = undefined;
      targetRow.losUploadedBy = undefined;
      targetRow.losUploadedByEmail = undefined;
    }
    if (upperSide === 'SMART' || upperSide === 'BOTH') {
      targetRow.smartStatus = 'Pendente';
      targetRow.smartLinkedSiteId = undefined;
      targetRow.smartFileId = undefined;
      targetRow.smartFolderId = undefined;
      targetRow.smartFileName = undefined;
      targetRow.smartFileUrl = undefined;
      targetRow.smartDownloadUrl = undefined;
      targetRow.smartDeliveredAt = undefined;
      targetRow.smartUploadedBy = undefined;
      targetRow.smartUploadedByEmail = undefined;
    }
    if (upperSide === 'SDC' || upperSide === 'BOTH') {
      targetRow.sdcStatus = 'Pendente';
      targetRow.sdcLinkedSiteId = undefined;
      targetRow.sdcFileId = undefined;
      targetRow.sdcFolderId = undefined;
      targetRow.sdcFileName = undefined;
      targetRow.sdcFileUrl = undefined;
      targetRow.sdcDownloadUrl = undefined;
      targetRow.sdcDeliveredAt = undefined;
      targetRow.sdcUploadedBy = undefined;
      targetRow.sdcUploadedByEmail = undefined;
    }
    targetRow.updatedAt = new Date().toISOString();

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: targetRow.updatedAt,
      vendor: 'ERICSSON',
      summary: `Arquivo excluído e status (${targetRow.siteIdA} ↔ ${targetRow.siteIdB}) redefinido para Pendente`,
    });

    res.json({
      row: targetRow,
      ericssonRows: db.ericssonRows,
      ericssonFolders: db.ericssonFolders || [],
      ericssonFiles: db.ericssonFiles || [],
    });
  });

  // 8. Independent Ericsson Users & Teams Management (separated from Nokia)
  app.post('/api/ericsson/users', async (req, res) => {
    const {
      name,
      email,
      password,
      role,
      equipe,
      telefone,
      cpf,
      rg,
      atividade,
      statusRecurso,
      dispensadoDocumentos,
      documents,
    } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: UserRole;
      equipe?: string;
      telefone?: string;
      cpf?: string;
      rg?: string;
      atividade?: string;
      statusRecurso?: string;
      dispensadoDocumentos?: boolean;
      documents?: Array<UserMandatoryDocument & { fileBase64?: string }>;
    };

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Informe nome do recurso, e-mail e senha.' });
      return;
    }

    if (!Array.isArray(db.ericssonUsers)) db.ericssonUsers = [];
    const normalizedEmail = email.trim().toLowerCase();

    if (db.ericssonUsers.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      res.status(409).json({
        error: 'Já existe um colaborador cadastrado na Ericsson com este e-mail.',
      });
      return;
    }

    const validRole: UserRole =
      role &&
      ['Coordenador Geral', 'Coordenador Engenharia', 'Executor', 'Vistoriador'].includes(role)
        ? role
        : 'Vistoriador';

    const newUserId = `eric-usr-${Date.now()}`;
    const baseDocs = ensureUserMandatoryDocuments(documents);

    if (Array.isArray(documents)) {
      for (const incomingDoc of documents) {
        if (incomingDoc && incomingDoc.type && incomingDoc.fileBase64 && incomingDoc.fileName) {
          const targetDoc = baseDocs.find((d) => d.type === incomingDoc.type);
          if (targetDoc) {
            const cleanBase64 = incomingDoc.fileBase64.includes('base64,')
              ? incomingDoc.fileBase64.split('base64,')[1]
              : incomingDoc.fileBase64;
            const buffer = Buffer.from(cleanBase64, 'base64');
            const ext = path.extname(incomingDoc.fileName) || '.pdf';
            const storageFileName = `ericdoc-${newUserId}-${incomingDoc.type}-${Date.now()}${ext}`;
            fs.writeFileSync(path.join(UPLOADS_DIR, storageFileName), buffer);
            targetDoc.fileName = incomingDoc.fileName;
            targetDoc.fileSize = buffer.length;
            targetDoc.uploadedAt = new Date().toISOString();
            targetDoc.storageFileName = storageFileName;

            if (!targetDoc.expiresAt) {
              const extracted = await extractExpirationFromDocument({
                docType: targetDoc.type,
                fileName: incomingDoc.fileName,
                fileBase64: incomingDoc.fileBase64,
                buffer,
              });
              targetDoc.expiresAt = extracted.expiresAt;
            }
          }
        }
      }
    }

    const isExempt =
      Boolean(dispensadoDocumentos) ||
      (statusRecurso || '').toUpperCase() === 'DISPENSADO';

    const tempUser: AmetaUser = {
      id: newUserId,
      name: name.trim(),
      email: normalizedEmail,
      role: validRole,
      equipe: equipe?.trim() || 'Equipe 1',
      telefone: telefone?.trim() || '',
      cpf: cpf?.trim() || '',
      rg: rg?.trim() || '',
      atividade: atividade?.trim() || 'ACESSO | TX',
      statusRecurso: isExempt ? 'DISPENSADO' : statusRecurso || 'VALIDADO',
      dispensadoDocumentos: isExempt,
      documents: baseDocs,
      emailVerified: true,
      verifiedAt: new Date().toISOString(),
      preferredVendor: 'ERICSSON',
      createdAt: new Date().toISOString(),
    };

    const computedStatus = evaluateUserOverallDocumentStatus(tempUser).overallStatus;

    const newUser: StoredUser = {
      ...tempUser,
      statusRecurso: statusRecurso || computedStatus,
      passwordHash: hashPassword(password),
    };

    db.ericssonUsers.push(newUser);
    saveDatabase(db);

    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: new Date().toISOString(),
      vendor: 'ERICSSON',
      summary: `Colaborador Ericsson ${newUser.name} (${validRole}) cadastrado`,
    });

    res.status(201).json({
      user: sanitizeUser(newUser),
      ericssonUsers: db.ericssonUsers.map(sanitizeUser),
    });
  });

  app.patch('/api/ericsson/users/:id/role', (req, res) => {
    const { id } = req.params;
    const { role, equipe, atividade, telefone } = req.body as {
      role?: UserRole;
      equipe?: string;
      atividade?: string;
      telefone?: string;
    };

    if (!Array.isArray(db.ericssonUsers)) db.ericssonUsers = [];
    const target = db.ericssonUsers.find((u) => u.id === id);
    if (!target) {
      res.status(404).json({ error: 'Usuário Ericsson não encontrado.' });
      return;
    }

    if (
      role &&
      ['ADM', 'Coordenador Geral', 'Coordenador Engenharia', 'Executor', 'Vistoriador'].includes(
        role
      )
    ) {
      target.role =
        role === 'ADM' && !isOwnerAdmUser(target.email) ? 'Coordenador Geral' : role;
    }
    if (typeof equipe === 'string') {
      target.equipe = equipe.trim();
    }
    if (typeof atividade === 'string') {
      target.atividade = atividade.trim();
    }
    if (typeof telefone === 'string') {
      target.telefone = telefone.trim();
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: new Date().toISOString(),
      vendor: 'ERICSSON',
      summary: `Cadastro de ${target.name} atualizado na Ericsson`,
    });

    res.json({
      user: sanitizeUser(target),
      ericssonUsers: db.ericssonUsers.map(sanitizeUser),
    });
  });

  app.delete('/api/ericsson/users/:id', (req, res) => {
    const { id } = req.params;
    if (!Array.isArray(db.ericssonUsers)) db.ericssonUsers = [];
    const target =
      db.ericssonUsers.find((u) => u.id === id) || db.users.find((u) => u.id === id);
    if (!target) {
      res.status(404).json({ error: 'Usuário Ericsson não encontrado.' });
      return;
    }
    if (isOwnerAdmUser(target.email, target.situacao)) {
      res.status(403).json({ error: 'O dono principal não pode ser removido.' });
      return;
    }

    const targetEmail = target.email.toLowerCase();
    db.ericssonUsers = db.ericssonUsers.filter(
      (u) => u.id !== id && u.email.toLowerCase() !== targetEmail
    );
    db.users = db.users.filter(
      (u) => u.id !== id && u.email.toLowerCase() !== targetEmail
    );
    saveDatabase(db);

    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: new Date().toISOString(),
      vendor: 'ERICSSON',
      summary: `Colaborador ${target.name} removido da Ericsson`,
    });

    res.json({
      ericssonUsers: db.ericssonUsers.map(sanitizeUser),
    });
  });

  // Assign an Ericsson team (EQUIPE) to pairs/sites in db.ericssonRows
  app.post('/api/ericsson/equipes/assign', (req, res) => {
    const { equipeName, rowIds, siteTokens } = req.body as {
      equipeName?: string;
      rowIds?: string[];
      siteTokens?: string[];
    };

    if (!equipeName || !equipeName.trim()) {
      res.status(400).json({ error: 'Informe o nome da Equipe da Ericsson.' });
      return;
    }

    if (!Array.isArray(db.ericssonRows)) db.ericssonRows = [];
    const cleanEquipe = equipeName.trim();
    const rowIdSet = new Set(Array.isArray(rowIds) ? rowIds : []);
    const tokenSet = new Set(
      (Array.isArray(siteTokens) ? siteTokens : [])
        .map((t) => String(t || '').trim().toUpperCase())
        .filter(Boolean)
    );

    const now = new Date().toISOString();
    let updatedCount = 0;

    db.ericssonRows.forEach((row) => {
      const matchesRow = rowIdSet.has(row.id);
      const matchesToken =
        tokenSet.size > 0 &&
        (tokenSet.has(row.siteIdA.toUpperCase()) ||
          tokenSet.has(row.siteIdB.toUpperCase()) ||
          tokenSet.has(row.chaves.toUpperCase()));

      if (matchesRow || matchesToken) {
        row.equipe = cleanEquipe;
        if (row.fields) {
          row.fields['EQUIPE'] = cleanEquipe;
        }
        row.updatedAt = now;
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      pushNotification(db, {
        type: 'SITE_DEMANDADO_EXECUTOR',
        vendor: 'ERICSSON',
        title: `${updatedCount} Enlace(s) Demandado(s) para ${cleanEquipe}`,
        message: `A equipe "${cleanEquipe}" recebeu ${updatedCount} enlace(s)/site(s) para execução na plataforma Ericsson.`,
        actorName: 'Coordenação Ericsson',
        actorEmail: 'coord.geral.ericsson@ametaservicos.com.br',
        targetRoles: ['Executor', 'Vistoriador'],
        targetEquipes: [cleanEquipe],
      });

      pushNotification(db, {
        type: 'EXECUTOR_ATUALIZOU_EQUIPE',
        vendor: 'ERICSSON',
        title: `Equipe Ericsson Atualizada: ${cleanEquipe}`,
        message: `${updatedCount} enlace(s) foram atribuídos para a equipe "${cleanEquipe}" na Ericsson.`,
        actorName: 'Coordenação Ericsson',
        actorEmail: 'coord.geral.ericsson@ametaservicos.com.br',
        targetRoles: ['Coordenador Geral', 'Coordenador Engenharia', 'ADM'],
      });
    }

    saveDatabase(db);

    broadcastUpdate({
      type: 'ERICSSON_UPDATED',
      timestamp: now,
      vendor: 'ERICSSON',
      summary: `${updatedCount} linha(s) vinculada(s) à ${cleanEquipe} na Ericsson`,
    });

    res.json({
      updatedCount,
      ericssonRows: db.ericssonRows,
      notifications: db.notifications || [],
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ameta Telecom Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
