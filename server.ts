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
  evaluateUserOverallDocumentStatus,
} from './src/types/telecom.ts';
import { parseExcelWorkbookBuffer } from './src/utils/spreadsheetUtils.ts';

interface StoredUser extends AmetaUser {
  passwordHash: string;
}

interface DatabaseSchema {
  users: StoredUser[];
  sites: TelecomSite[];
  sheets: SpreadsheetMeta[];
  engineeringFolders: EngineeringFolder[];
  engineeringFiles: EngineeringFile[];
  lastUpdated: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'ameta-db.json');

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
  const parts = normalized.split('@');
  if (parts.length !== 2 || !parts[0]) return false;
  const domain = parts[1];
  return (
    domain === 'ameta.com' ||
    domain === 'ameta.com.br' ||
    domain === 'ameta.net' ||
    domain === 'ameta.org' ||
    domain === 'ameta.eng.br' ||
    domain.startsWith('ameta.') ||
    domain.endsWith('.ameta.com') ||
    domain.endsWith('.ameta.com.br')
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

  (['NOKIA', 'ERICSSON'] as VendorType[]).forEach((vendor) => {
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
      createdByEmail: 'rafael.araujo@ameta.com.br',
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
        createdByEmail: 'rafael.araujo@ameta.com.br',
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
            createdByEmail: 'rafael.araujo@ameta.com.br',
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

  // Remove old generic placeholder accounts and previous auto-imported usr-recurso-* accounts (like Magno)
  const placeholderEmails = new Set(['engenharia@ameta.com.br', 'noc@ameta.com.br']);
  const beforeLen = db.users.length;
  db.users = db.users.filter(
    (u) => !placeholderEmails.has(u.email.toLowerCase()) && !u.id.startsWith('usr-recurso-')
  );
  if (db.users.length !== beforeLen) {
    changed = true;
  }

  // Ensure primary ADM Rafael Araújo exists
  const adminEmail = 'rafael.araujo@ameta.com.br';
  let adminUser = db.users.find((u) => u.email.toLowerCase() === adminEmail);
  if (!adminUser) {
    db.users.unshift({
      id: 'usr-ameta-1',
      name: 'Rafael Araújo',
      email: adminEmail,
      role: 'ADM',
      equipe: 'Coordenação / ADM',
      atividade: 'Gestão Geral & Engenharia',
      statusRecurso: 'ATIVO',
      emailVerified: true,
      verifiedAt: '2026-09-29T12:00:00.000Z',
      preferredVendor: 'NOKIA',
      createdAt: '2026-09-01T10:00:00.000Z',
      passwordHash: hashPassword('ameta2026'),
    });
    changed = true;
  } else if (adminUser.role !== 'ADM' || !adminUser.equipe) {
    adminUser.role = 'ADM';
    adminUser.equipe = adminUser.equipe || 'Coordenação / ADM';
    adminUser.atividade = adminUser.atividade || 'Gestão Geral & Engenharia';
    adminUser.statusRecurso = adminUser.statusRecurso || 'ATIVO';
    changed = true;
  }

  // Ensure the dedicated Test Users ("Usuário Teste" as Vistoriador and "Executor Teste" as Executor) exist for testing per-user demand
  const testEmail = 'teste@ameta.com.br';
  const existingTestUser = db.users.find((u) => u.email.toLowerCase() === testEmail);
  if (!existingTestUser) {
    db.users.push({
      id: 'usr-teste-1',
      name: 'Usuário Teste (Vistoriador)',
      email: testEmail,
      role: 'Vistoriador',
      equipe: 'Magno / Gilvan',
      telefone: '11 99999-0000',
      atividade: 'Vistoria de Campo (Sites & Documentos)',
      statusRecurso: 'VALIDADO',
      emailVerified: true,
      verifiedAt: new Date().toISOString(),
      preferredVendor: 'NOKIA',
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword('ameta2026'),
    });
    changed = true;
  } else if (existingTestUser.equipe === 'Equipe de Teste' || !existingTestUser.equipe) {
    existingTestUser.equipe = 'Magno / Gilvan';
    existingTestUser.role = 'Vistoriador';
    changed = true;
  }

  const executorTestEmail = 'executor.teste@ameta.com.br';
  const existingExecutorTest = db.users.find(
    (u) => u.email.toLowerCase() === executorTestEmail
  );
  if (!existingExecutorTest) {
    db.users.push({
      id: 'usr-teste-executor',
      name: 'Executor Teste',
      email: executorTestEmail,
      role: 'Executor',
      equipe: 'Magno / Gilvan',
      telefone: '11 98888-1111',
      atividade: 'Execução & Engenharia (Sites & Documentos)',
      statusRecurso: 'VALIDADO',
      emailVerified: true,
      verifiedAt: new Date().toISOString(),
      preferredVendor: 'NOKIA',
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword('ameta2026'),
    });
    changed = true;
  }

  // Normalize any remaining user roles and ensure mandatory 8-document structure on every profile
  db.users.forEach((u) => {
    const norm =
      u.email.toLowerCase() === adminEmail ? 'ADM' : normalizeUserRole(u.role);
    if (u.role !== norm) {
      u.role = norm;
      changed = true;
    }
    if (!Array.isArray(u.documents) || u.documents.length !== 8) {
      u.documents = ensureUserMandatoryDocuments(u.documents);
      changed = true;
    }
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
        return parsed;
      }
    } catch (err) {
      console.error('Error reading database file, re-initializing default seed:', err);
    }
  }

  const defaultUsers: StoredUser[] = [
    {
      id: 'usr-ameta-1',
      name: 'Rafael Araújo',
      email: 'rafael.araujo@ameta.com.br',
      role: 'ADM',
      equipe: 'Coordenação / ADM',
      atividade: 'Gestão Geral & Engenharia',
      statusRecurso: 'ATIVO',
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
    lastUpdated: new Date().toISOString(),
  };

  syncEquipesResourcesToUsers(initialDb);
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
      users: db.users.map(sanitizeUser),
      lastUpdated: db.lastUpdated,
    });
    for (const client of sseClients) {
      try {
        client.write(`data: ${message}\n\n`);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // ===================== AUTHENTICATION & @AMETA EMAIL VERIFICATION =====================

  app.post('/api/auth/register', (req, res) => {
    const { name, email, password, role } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: AmetaUser['role'];
    };

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Preencha nome completo, e-mail corporativo e senha.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidAmetaDomain(normalizedEmail)) {
      res.status(403).json({
        error:
          'Domínio não autorizado. Apenas e-mails corporativos do domínio @ameta (ex: usuario@ameta.com.br ou usuario@ameta.com) são permitidos.',
      });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'A senha deve possuir no mínimo 6 caracteres.' });
      return;
    }

    const existing = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'Já existe uma conta cadastrada com este e-mail @ameta.' });
      return;
    }

    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    const newUser: StoredUser = {
      id: `usr-${Date.now()}`,
      name: name.trim(),
      email: normalizedEmail,
      role: normalizeUserRole(role || 'Vistoriador'),
      emailVerified: false,
      verificationCode,
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword(password),
    };

    db.users.push(newUser);
    saveDatabase(db);

    res.status(201).json({
      user: sanitizeUser(newUser),
      requiresVerification: true,
      verificationCode,
      message: `Código de verificação enviado para ${normalizedEmail}.`,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: 'Informe seu e-mail @ameta e senha.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);

    if (!user && !isValidAmetaDomain(normalizedEmail)) {
      res.status(403).json({
        error:
          'Acesso bloqueado: Utilize o e-mail de um recurso cadastrado ou domínio corporativo @ameta.',
      });
      return;
    }

    const isTestAccountLogin =
      normalizedEmail === 'teste@ameta.com.br' &&
      (password === 'ameta2026' || password === 'ameta123' || password === '123456');

    if (!user || (!isTestAccountLogin && user.passwordHash !== hashPassword(password))) {
      res.status(401).json({ error: 'Credenciais inválidas. Verifique seu e-mail e senha.' });
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
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
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
        users: db.users.map(sanitizeUser),
        lastUpdated: db.lastUpdated,
      })}\n\n`
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  app.get('/api/state', (_req, res) => {
    res.json({
      sites: db.sites,
      sheets: db.sheets,
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
      users: db.users.map(sanitizeUser),
      lastUpdated: db.lastUpdated,
      activeConnections: sseClients.size,
    });
  });

  // ===================== ADM PANEL: USER & PROFILE ACCESS CONTROL =====================

  app.patch('/api/admin/users/:id/role', (req, res) => {
    const { id } = req.params;
    const { role } = req.body as { role?: UserRole };

    if (!role || !['ADM', 'Executor', 'Vistoriador'].includes(role)) {
      res.status(400).json({ error: 'Perfil inválido. Escolha ADM, Executor ou Vistoriador.' });
      return;
    }

    const target = db.users.find((u) => u.id === id);
    if (!target) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    target.role = role;

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

    if (db.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      res.status(409).json({ error: 'Já existe um recurso cadastrado com este e-mail.' });
      return;
    }

    const validRole: UserRole =
      role && ['ADM', 'Executor', 'Vistoriador'].includes(role) ? role : 'Vistoriador';

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

    const tempUser: AmetaUser = {
      id: newUserId,
      name: name.trim(),
      email: normalizedEmail,
      role: validRole,
      equipe: equipe?.trim() || 'Campo / Engenharia',
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
    saveDatabase(db);

    broadcastUpdate({
      type: 'FULL_STATE',
      timestamp: new Date().toISOString(),
      summary: `Usuário ${newUser.name} (${validRole}) adicionado pelo ADM`,
    });

    res.status(201).json({
      user: sanitizeUser(newUser),
      users: db.users.map(sanitizeUser),
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

    if (typeof dispensadoDocumentos === 'boolean') {
      target.dispensadoDocumentos = dispensadoDocumentos;
      target.statusRecurso = dispensadoDocumentos ? 'DISPENSADO' : 'VALIDADO';
    } else if (statusRecurso) {
      target.statusRecurso = statusRecurso;
      target.dispensadoDocumentos = statusRecurso.toUpperCase() === 'DISPENSADO';
    }

    const evaluated = evaluateUserOverallDocumentStatus(target);
    target.statusRecurso = evaluated.overallStatus;
    saveDatabase(db);

    broadcastUpdate({
      type: 'FULL_STATE',
      timestamp: new Date().toISOString(),
      summary: `Status de ${target.name} alterado para ${target.statusRecurso}`,
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
      docEntry.storageFileName = '';
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
      // When user updates expiration date, let automatic evaluation compute Validado / A Vencer / Vencido
      if (statusOverride === undefined && docEntry.statusOverride !== 'DISPENSADO') {
        docEntry.statusOverride = undefined;
      }
    }
    if (statusOverride !== undefined) {
      docEntry.statusOverride = statusOverride ? statusOverride : undefined;
    }
    if (typeof notes === 'string') {
      docEntry.notes = notes.trim();
    }

    // Re-evaluate user's overall status automatically based on 30-day rule
    const evaluated = evaluateUserOverallDocumentStatus(target);
    target.statusRecurso = evaluated.overallStatus;

    saveDatabase(db);

    broadcastUpdate({
      type: 'FULL_STATE',
      timestamp: new Date().toISOString(),
      summary: `Documento ${docEntry.label} de ${target.name} atualizado`,
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
    const target = db.users.find((u) => u.id === id);
    if (!target) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }
    if (target.email.toLowerCase() === 'rafael.araujo@ameta.com.br') {
      res.status(403).json({ error: 'O administrador principal não pode ser removido.' });
      return;
    }

    db.users = db.users.filter((u) => u.id !== id);
    saveDatabase(db);

    broadcastUpdate({
      type: 'FULL_STATE',
      timestamp: new Date().toISOString(),
      summary: `Usuário ${target.name} removido`,
    });

    res.json({ users: db.users.map(sanitizeUser) });
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
    } = req.body as {
      name?: string;
      parentId?: string | null;
      vendor?: VendorType;
      description?: string;
      assignedTo?: string;
      createdByName?: string;
      createdByEmail?: string;
      createdByRole?: AmetaUser['role'];
    };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Informe o nome da pasta.' });
      return;
    }

    if (!createdByName || !createdByName.trim()) {
      res.status(400).json({ error: 'Informe o nome de quem está criando a pasta.' });
      return;
    }

    const rootFolderId = `folder-${vendor.toLowerCase()}-vistorias`;
    const targetParentId = parentId || rootFolderId;
    const parentFolder = db.engineeringFolders.find((f) => f.id === targetParentId);

    // At the root Vistorias level ("fora"), ONLY Admin has permission to create main folders
    const isCreatingAtRootVistorias =
      targetParentId === rootFolderId || (parentFolder && parentFolder.parentId === null);

    if (isCreatingAtRootVistorias) {
      const matchedUser = createdByEmail
        ? db.users.find((u) => u.email.toLowerCase() === createdByEmail.trim().toLowerCase())
        : undefined;
      const effectiveRole = normalizeUserRole(createdByRole || matchedUser?.role);
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
      createdByEmail: createdByEmail?.trim() || 'engenharia@ameta.com.br',
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

  // Update folder metadata (e.g. assignedTo responsible user)
  app.put('/api/engineering/folders/:id', (req, res) => {
    const { id } = req.params;
    const { assignedTo, description } = req.body as {
      assignedTo?: string;
      description?: string;
    };

    const folder = db.engineeringFolders.find((f) => f.id === id);
    if (!folder) {
      res.status(404).json({ error: 'Pasta não encontrada.' });
      return;
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
      summary: `Pasta "${folder.name}" atribuída para ${folder.assignedTo || 'Todos (ADM)'}`,
    });

    res.json({
      folder,
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
    });
  });

  // Upload one or more files (.zip, .rar WinRAR, .7z, .xlsx, .pdf, etc.) into a folder
  app.post('/api/engineering/files', (req, res) => {
    const {
      folderId,
      vendor = 'NOKIA',
      uploadedByName,
      uploadedByEmail,
      siteId,
      notes,
      assignedTo,
      files,
    } = req.body as {
      folderId?: string;
      vendor?: VendorType;
      uploadedByName?: string;
      uploadedByEmail?: string;
      siteId?: string;
      notes?: string;
      assignedTo?: string;
      files?: Array<{
        fileName: string;
        fileSize: number;
        base64Data: string;
      }>;
    };

    if (!folderId) {
      res.status(400).json({ error: 'Selecione a pasta de destino para o carregamento.' });
      return;
    }

    if (!uploadedByName || !uploadedByName.trim()) {
      res.status(400).json({
        error: 'É obrigatório informar o nome de quem carregou o arquivo para todos os arquivos.',
      });
      return;
    }

    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'Selecione pelo menos um arquivo (.zip, .rar, documento) para enviar.' });
      return;
    }

    const folder = db.engineeringFolders.find((f) => f.id === folderId);
    if (!folder) {
      res.status(404).json({ error: 'Pasta de destino não encontrada.' });
      return;
    }

    if (folder.parentId === null) {
      res.status(400).json({
        error:
          'O carregamento de arquivos é permitido apenas dentro das pastas (ex: Vistorias Executadas, TSSR Entrada, TSSR ou subpastas).',
      });
      return;
    }

    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const now = new Date().toISOString();
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
        folderId,
        vendor,
        fileName: cleanName,
        fileType,
        extension,
        fileSize: rawFile.fileSize || buffer.length,
        siteId: siteId?.trim().toUpperCase() || undefined,
        notes: notes?.trim() || undefined,
        assignedTo: assignedTo?.trim() || undefined,
        uploadedByName: uploadedByName.trim(),
        uploadedByEmail: uploadedByEmail?.trim() || 'engenharia@ameta.com.br',
        uploadedAt: now,
        storageFileName: safeDiskName,
      };

      db.engineeringFiles.unshift(newFileRecord);
      createdFiles.push(newFileRecord);
    });

    saveDatabase(db);

    broadcastUpdate({
      type: 'FILE_UPLOADED',
      timestamp: now,
      actorEmail: uploadedByEmail,
      vendor,
      summary: `${createdFiles.length} arquivo(s) carregado(s) em "${folder.name}" por ${uploadedByName.trim()}`,
    });

    res.status(201).json({
      createdFiles,
      engineeringFolders: db.engineeringFolders,
      engineeringFiles: db.engineeringFiles,
    });
  });

  // Download an engineering file (.zip, .rar, .xlsx, .pdf, etc.)
  app.get('/api/engineering/files/:id/download', (req, res) => {
    const { id } = req.params;
    const fileRecord = db.engineeringFiles.find((f) => f.id === id);
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

  // Update an engineering file (e.g. assign responsible user "assignedTo", siteId, notes)
  app.put('/api/engineering/files/:id', (req, res) => {
    const { id } = req.params;
    const { assignedTo, siteId, notes } = req.body as {
      assignedTo?: string;
      siteId?: string;
      notes?: string;
    };

    const fileRecord = db.engineeringFiles.find((f) => f.id === id);
    if (!fileRecord) {
      res.status(404).json({ error: 'Arquivo não encontrado.' });
      return;
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
      summary: `Documento "${fileRecord.fileName}" atribuído para ${fileRecord.assignedTo || 'Sem responsável'}`,
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
    const existing = db.engineeringFiles.find((f) => f.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Arquivo não encontrado.' });
      return;
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
      updatedBy: actorEmail || site.updatedBy || 'engenharia@ameta.com.br',
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

    // Non-ADM demanded users (Vistoriador & Executor) can edit STATUS and SI Executed (date)
    let allowedUpdates: Partial<TelecomSite> = updates;
    if (effectiveRole !== 'ADM') {
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

    db.sites[index] = updatedSite;

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
    const actorEmail = (req.query.actorEmail as string) || 'engenharia@ameta.com.br';
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
    const { duplaName, emails } = req.body as {
      duplaName?: string;
      emails?: string[];
    };

    if (!duplaName || !duplaName.trim()) {
      res.status(400).json({ error: 'Informe o nome da dupla.' });
      return;
    }

    const cleanDupla = duplaName.trim();
    const cleanDuplaLower = cleanDupla.toLowerCase();
    const emailList = Array.isArray(emails)
      ? Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)))
      : [];
    const emailSet = new Set(emailList);

    // Update user profiles in db.users so their `equipe` reflects the linked Dupla
    db.users.forEach((u) => {
      const uEmail = u.email.trim().toLowerCase();
      if (emailSet.has(uEmail)) {
        u.equipe = cleanDupla;
      } else if ((u.equipe || '').trim().toLowerCase() === cleanDuplaLower) {
        u.equipe = 'Campo / Engenharia';
      }
    });

    // Also stamp E-MAIL DUPLA on all sites currently assigned to this Dupla
    const emailStr = emailList.join(', ');
    db.sites.forEach((s) => {
      const eq = (s.customFields?.['EQUIPE EXECUTANTE'] || s.equipeParceira || '').trim().toLowerCase();
      if (eq === cleanDuplaLower) {
        s.customFields = {
          ...(s.customFields || {}),
          'E-MAIL DUPLA': emailStr,
        };
      }
    });

    saveDatabase(db);
    broadcastUpdate({
      type: 'FULL_STATE',
      timestamp: new Date().toISOString(),
      summary: `Dupla "${cleanDupla}" vinculada a ${emailList.length} e-mail(s) de perfil`,
    });

    res.json({
      users: db.users.map(sanitizeUser),
      sites: db.sites,
    });
  });

  // Bulk assign, unassign, rename, or clear Equipe Executante (Dupla) / Responsible for one or more sites
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
      const fromNorm = renameFrom.trim().toLowerCase();
      const nextDupla = renameTo.trim();
      db.users.forEach((u) => {
        if ((u.equipe || '').trim().toLowerCase() === fromNorm) {
          u.equipe = nextDupla;
        }
      });
      db.sites.forEach((s) => {
        if (vendor && s.vendor !== vendor) return;
        const eq = (
          s.customFields?.['EQUIPE EXECUTANTE'] ||
          s.equipeParceira ||
          ''
        )
          .trim()
          .toLowerCase();
        const exec = (
          s.customFields?.['Executor'] ||
          s.responsavelCampo ||
          ''
        )
          .trim()
          .toLowerCase();
        if (eq === fromNorm || exec === fromNorm) {
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
    } else if (Array.isArray(unassignSiteTokens) && unassignSiteTokens.length > 0) {
      const tokenSet = new Set(unassignSiteTokens.map((t) => t.trim().toUpperCase()).filter(Boolean));
      db.sites.forEach((s) => {
        if (vendor && s.vendor !== vendor) return;
        if (tokenSet.has(s.id.toUpperCase()) || tokenSet.has(s.siteId.trim().toUpperCase())) {
          s.equipeParceira = '';
          s.responsavelCampo = '';
          s.customFields = {
            ...(s.customFields || {}),
            'EQUIPE EXECUTANTE': '',
            Executor: '',
            Responsável: '',
            'E-MAIL DUPLA': '',
          };
          s.updatedAt = now;
          updatedCount++;
        }
      });
    } else if (clearAllForResponsible) {
      const targetNorm = clearAllForResponsible.trim().toLowerCase();
      db.sites.forEach((s) => {
        if (vendor && s.vendor !== vendor) return;
        const eq = (
          s.customFields?.['EQUIPE EXECUTANTE'] ||
          s.equipeParceira ||
          ''
        )
          .trim()
          .toLowerCase();
        const exec = (s.customFields?.['Executor'] || s.responsavelCampo || '').trim().toLowerCase();
        const resp = (s.customFields?.['Responsável'] || '').trim().toLowerCase();
        if (eq.includes(targetNorm) || exec.includes(targetNorm) || resp.includes(targetNorm)) {
          s.equipeParceira = '';
          s.responsavelCampo = '';
          s.customFields = {
            ...(s.customFields || {}),
            'EQUIPE EXECUTANTE': '',
            Executor: '',
            Responsável: '',
            'E-MAIL DUPLA': '',
          };
          s.updatedAt = now;
          updatedCount++;
        }
      });
    } else if (Array.isArray(siteTokens) && siteTokens.length > 0) {
      const tokenSet = new Set(siteTokens.map((t) => t.trim().toUpperCase()).filter(Boolean));
      const nextResp = (responsibleName || '').trim();
      const autoLinkedEmails =
        Array.isArray(linkedEmails) && linkedEmails.length > 0
          ? linkedEmails
          : db.users
              .filter((u) => (u.equipe || '').trim().toLowerCase() === nextResp.toLowerCase())
              .map((u) => u.email.toLowerCase());
      const emailStr = autoLinkedEmails.join(', ');

      db.sites.forEach((s) => {
        if (vendor && s.vendor !== vendor) return;
        if (s.sheetName !== 'Controle Geral') return;
        if (tokenSet.has(s.id.toUpperCase()) || tokenSet.has(s.siteId.trim().toUpperCase())) {
          s.equipeParceira = nextResp;
          s.responsavelCampo = nextResp;
          s.customFields = {
            ...(s.customFields || {}),
            'EQUIPE EXECUTANTE': nextResp,
            Executor: nextResp,
            Responsável: nextResp,
            ...(emailStr ? { 'E-MAIL DUPLA': emailStr } : {}),
          };
          s.updatedAt = now;
          updatedCount++;
        }
      });
    }

    saveDatabase(db);
    broadcastUpdate({
      type: 'FULL_STATE',
      timestamp: now,
      vendor,
      summary: `${updatedCount} site(s) atualizado(s) para Equipe/Dupla ${responsibleName || renameTo || '—'}`,
    });

    res.json({ updatedCount, sites: db.sites, users: db.users.map(sanitizeUser) });
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
    const author = actorEmail || 'engenharia@ameta.com.br';

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
