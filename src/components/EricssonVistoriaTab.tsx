import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  Upload,
  FileArchive,
  FileSpreadsheet,
  FileText,
  File,
  Download,
  Trash2,
  ChevronRight,
  Search,
  UserCheck,
  Calendar,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  X,
  Plus,
  ExternalLink,
  Lock,
  ArrowLeftRight,
  Radio,
  Pencil,
  Bell,
  Layers,
  Sparkles,
  Filter,
  Check,
  Building,
  MapPin,
  HardHat,
  Tag,
} from 'lucide-react';
import {
  AmetaUser,
  UserRole,
  EricssonRow,
  EricssonSheetMeta,
  EricssonEngineeringRow,
  EngineeringFolder,
  EngineeringFile,
  EricssonDocGroup,
  ERICSSON_REAL_STATUSES_BY_DOC,
} from '../types/telecom';
import {
  doesEricssonRowMatchResponsible,
  doesFileMatchUserResponsibleSites,
} from '../utils/spreadsheetUtils';
import {
  rowMatchesEricssonDocGroup,
  normalizeEricssonRealStatus,
  classifyEricssonStatus,
} from '../utils/ericssonSpreadsheetUtils';
import { EricssonEngineeringDrawer } from './EricssonEngineeringDrawer';
import { cloudFetch } from '../lib/firebaseCloud';

const fetch = cloudFetch;

export interface EricssonVistoriaTabProps {
  user: AmetaUser;
  effectiveRole: UserRole;
  rows: EricssonRow[];
  sheetMeta: EricssonSheetMeta | null;
  engineeringRows?: EricssonEngineeringRow[];
  folders: EngineeringFolder[];
  files: EngineeringFile[];
  focusedFolderId?: string | null;
  focusedFileId?: string | null;
  focusedFileName?: string | null;
  onClearFocus?: () => void;
  onUpdated: (
    nextRows: EricssonRow[],
    nextMeta?: EricssonSheetMeta | null,
    toastMsg?: string,
    nextFolders?: EngineeringFolder[],
    nextFiles?: EngineeringFile[]
  ) => void;
  onOpenSitesTab?: () => void;
  onOpenEngenhariaTab?: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  const k = 1024;
  if (bytes < k) return `${bytes} B`;
  if (bytes < k * k) return `${(bytes / k).toFixed(1)} KB`;
  return `${(bytes / (k * k)).toFixed(2)} MB`;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const EricssonVistoriaTab: React.FC<EricssonVistoriaTabProps> = ({
  user,
  effectiveRole,
  rows,
  sheetMeta,
  engineeringRows = [],
  folders,
  files,
  focusedFolderId = null,
  focusedFileId = null,
  focusedFileName = null,
  onClearFocus,
  onUpdated,
  onOpenSitesTab,
  onOpenEngenhariaTab,
}) => {
  const isAdmRole = effectiveRole === 'ADM';
  const isCoordenadorGeral = effectiveRole === 'Coordenador Geral';
  const isCoordenadorEngenharia = effectiveRole === 'Coordenador Engenharia';
  const isAdmin = isAdmRole || isCoordenadorGeral || isCoordenadorEngenharia;
  const isVistoriador = effectiveRole === 'Vistoriador';
  const isExecutor = effectiveRole === 'Executor';
  const canCreateFolders = !isExecutor && !isVistoriador;

  // Dedicated Ericsson folders hierarchy:
  // Root: PROJETO CLARO ('folder-ericsson-root')
  // ├── VISTORIA ('folder-ericsson-vistoria')
  // └── PROJETO CLARO ('folder-ericsson-projetos')
  //     ├── WR ('folder-ericsson-proj-wr')
  //     ├── QRF ('folder-ericsson-proj-qrf')
  //     ├── PPI ('folder-ericsson-proj-ppi')
  //     ├── SDC ('folder-ericsson-proj-sdc')
  //     ├── SMART ('folder-ericsson-proj-smart')
  //     └── BOQ ('folder-ericsson-proj-boq')
  const ericssonFolders = useMemo(() => {
    const list = folders.filter((f) => f.vendor === 'ERICSSON');
    if (list.length === 0) {
      return [
        {
          id: 'folder-ericsson-root',
          parentId: null,
          name: 'PROJETO CLARO',
          vendor: 'ERICSSON' as const,
          description: 'Área principal do Projeto Claro Ericsson',
          createdByName: 'Rafael Araújo',
          createdByEmail: 'rafael.araujo@ametaservicos.com.br',
          createdAt: '',
          isSystem: true,
        },
        {
          id: 'folder-ericsson-vistoria',
          parentId: 'folder-ericsson-root',
          name: 'VISTORIA',
          vendor: 'ERICSSON' as const,
          description: 'Arquivos de Vistoria e LOS vinculados à planilha Sites Ericsson',
          createdByName: 'Rafael Araújo',
          createdByEmail: 'rafael.araujo@ametaservicos.com.br',
          createdAt: '',
          isSystem: true,
        },
        {
          id: 'folder-ericsson-projetos',
          parentId: 'folder-ericsson-root',
          name: 'PROJETO CLARO',
          vendor: 'ERICSSON' as const,
          description: 'Pastas de documentação técnica por projeto',
          createdByName: 'Rafael Araújo',
          createdByEmail: 'rafael.araujo@ametaservicos.com.br',
          createdAt: '',
          isSystem: true,
        },
        {
          id: 'folder-ericsson-proj-wr',
          parentId: 'folder-ericsson-projetos',
          name: 'WR',
          vendor: 'ERICSSON' as const,
          description: 'Documentos do projeto WR vinculados à Engenharia Ericsson',
          createdByName: 'Rafael Araújo',
          createdByEmail: 'rafael.araujo@ametaservicos.com.br',
          createdAt: '',
          isSystem: true,
        },
        {
          id: 'folder-ericsson-proj-qrf',
          parentId: 'folder-ericsson-projetos',
          name: 'QRF',
          vendor: 'ERICSSON' as const,
          description: 'Documentos do projeto QRF vinculados à Engenharia Ericsson',
          createdByName: 'Rafael Araújo',
          createdByEmail: 'rafael.araujo@ametaservicos.com.br',
          createdAt: '',
          isSystem: true,
        },
        {
          id: 'folder-ericsson-proj-ppi',
          parentId: 'folder-ericsson-projetos',
          name: 'PPI',
          vendor: 'ERICSSON' as const,
          description: 'Documentos do projeto PPI vinculados à Engenharia Ericsson',
          createdByName: 'Rafael Araújo',
          createdByEmail: 'rafael.araujo@ametaservicos.com.br',
          createdAt: '',
          isSystem: true,
        },
        {
          id: 'folder-ericsson-proj-sdc',
          parentId: 'folder-ericsson-projetos',
          name: 'SDC',
          vendor: 'ERICSSON' as const,
          description: 'Documentos do projeto SDC vinculados à Engenharia Ericsson',
          createdByName: 'Rafael Araújo',
          createdByEmail: 'rafael.araujo@ametaservicos.com.br',
          createdAt: '',
          isSystem: true,
        },
        {
          id: 'folder-ericsson-proj-smart',
          parentId: 'folder-ericsson-projetos',
          name: 'SMART',
          vendor: 'ERICSSON' as const,
          description: 'Documentos do projeto SMART vinculados à Engenharia Ericsson',
          createdByName: 'Rafael Araújo',
          createdByEmail: 'rafael.araujo@ametaservicos.com.br',
          createdAt: '',
          isSystem: true,
        },
        {
          id: 'folder-ericsson-proj-boq',
          parentId: 'folder-ericsson-projetos',
          name: 'BOQ',
          vendor: 'ERICSSON' as const,
          description: 'Documentos do projeto BOQ vinculados à Engenharia Ericsson',
          createdByName: 'Rafael Araújo',
          createdByEmail: 'rafael.araujo@ametaservicos.com.br',
          createdAt: '',
          isSystem: true,
        },
      ];
    }
    return list;
  }, [folders]);

  const allowedFolderIds = useMemo(
    () => new Set(ericssonFolders.map((f) => f.id)),
    [ericssonFolders]
  );

  // Ericsson rows that current Vistoriador / Executor is responsible for doing
  const responsibleRows = useMemo(
    () => rows.filter((r) => doesEricssonRowMatchResponsible(r, user)),
    [rows, user]
  );

  // Executor Assigned Engineering Rows for Ericsson
  const executorAssignedEngRows = useMemo(() => {
    if (!isExecutor) return [];
    const myEmail = (user.email || '').trim().toLowerCase();
    const myName = (user.name || '').trim().toLowerCase();
    const myEquipe = (user.equipe || '').trim().toLowerCase();

    return (engineeringRows || []).filter((r) => {
      // If user is Executor, do not show finalized sites/rows
      const rawStatus = r.status || r.fields?.['Status'] || '';
      const isFinalizado =
        classifyEricssonStatus(rawStatus) === 'Finalizado' ||
        rawStatus.toLowerCase().includes('finaliz') ||
        rawStatus.toLowerCase().trim() === 'finalizado';
      if (isFinalizado) return false;

      const rowEx = (
        r.executor ||
        r.fields?.['EXECUTOR'] ||
        r.fields?.['EXECUTOR WR'] ||
        r.fields?.['EXECUTOR QRF'] ||
        r.fields?.['EXECUTOR PPI'] ||
        r.fields?.['Executor'] ||
        ''
      )
        .trim()
        .toLowerCase();

      const rowEq = (r.fields?.['EQUIPE'] || '').trim().toLowerCase();

      return (
        (myEmail && rowEx.includes(myEmail)) ||
        (myName && (rowEx.includes(myName) || myName.includes(rowEx))) ||
        (myEquipe && (rowEx.includes(myEquipe) || rowEq.includes(myEquipe))) ||
        doesEricssonRowMatchResponsible(r as any, user)
      );
    });
  }, [isExecutor, engineeringRows, user]);

  const hasExecutorEricssonDemands = isExecutor && executorAssignedEngRows.length > 0;

  // Sub-tab inside PROJETO CLARO for Executor
  const [activeProjetoClaroSubTab, setActiveProjetoClaroSubTab] = useState<'pastas' | 'planilha'>(
    () => (isExecutor ? 'planilha' : 'pastas')
  );

  // Executor Mirrored Table Filter States
  const [executorDocTypeFilter, setExecutorDocTypeFilter] = useState<string>('ALL');
  const [executorStatusFilter, setExecutorStatusFilter] = useState<string>('ALL');
  const [executorRegionalFilter, setExecutorRegionalFilter] = useState<string>('ALL');
  const [executorTipoSiteFilter, setExecutorTipoSiteFilter] = useState<string>('ALL');
  const [executorIntervencaoSearch, setExecutorIntervencaoSearch] = useState<string>('');
  const [selectedDrawerRow, setSelectedDrawerRow] = useState<EricssonEngineeringRow | null>(null);

  // Real Statuses for selected Doc Type
  const realStatusesForDoc = useMemo(() => {
    if (executorDocTypeFilter !== 'ALL' && ERICSSON_REAL_STATUSES_BY_DOC[executorDocTypeFilter as EricssonDocGroup]) {
      return ERICSSON_REAL_STATUSES_BY_DOC[executorDocTypeFilter as EricssonDocGroup];
    }
    const set = new Set<string>();
    Object.values(ERICSSON_REAL_STATUSES_BY_DOC).forEach((arr) => {
      arr.forEach((st) => set.add(st));
    });
    return Array.from(set).sort();
  }, [executorDocTypeFilter]);

  const distinctRegionals = useMemo(() => {
    const set = new Set<string>();
    executorAssignedEngRows.forEach((r) => {
      const reg = r.regional || r.fields?.['Regional'] || '';
      if (reg) set.add(reg);
    });
    return Array.from(set).sort();
  }, [executorAssignedEngRows]);

  const distinctTipoSites = useMemo(() => {
    const set = new Set<string>();
    executorAssignedEngRows.forEach((r) => {
      const ts = r.tipoSite || r.fields?.['TIPO SITE'] || r.fields?.['Tipo site'] || '';
      if (ts) set.add(ts);
    });
    return Array.from(set).sort();
  }, [executorAssignedEngRows]);

  const filteredExecutorEngRows = useMemo(() => {
    const q = executorIntervencaoSearch.trim().toLowerCase();
    return executorAssignedEngRows.filter((r) => {
      if (executorDocTypeFilter !== 'ALL') {
        const rawDoc = String(r.tipoDoc || r.fields?.['Tipo doc'] || '');
        if (!rowMatchesEricssonDocGroup(rawDoc, executorDocTypeFilter as EricssonDocGroup)) {
          return false;
        }
      }

      const rawStatus = r.status || r.fields?.['Status'] || '';
      const realStatus = normalizeEricssonRealStatus(
        rawStatus,
        executorDocTypeFilter !== 'ALL' ? (executorDocTypeFilter as EricssonDocGroup) : undefined
      );
      const isFinalized = realStatus.toLowerCase() === 'finalizado' || rawStatus.toLowerCase().includes('finaliz');

      if (executorStatusFilter === 'ALL') {
        // By default, hide demands that the executor has ALREADY finalized
        if (isFinalized) return false;
      } else if (executorStatusFilter !== 'TODOS_INCLUINDO_FINALIZADOS') {
        if (realStatus.toLowerCase() !== executorStatusFilter.toLowerCase()) {
          return false;
        }
      }

      if (executorRegionalFilter !== 'ALL') {
        const reg = r.regional || r.fields?.['Regional'] || '';
        if (reg !== executorRegionalFilter) return false;
      }

      if (executorTipoSiteFilter !== 'ALL') {
        const ts = r.tipoSite || r.fields?.['TIPO SITE'] || r.fields?.['Tipo site'] || '';
        if (ts !== executorTipoSiteFilter) return false;
      }

      if (q) {
        const interv = (r.intervencaoClaro || r.siteIdA || r.fields?.['Intervencao Claro'] || '').toLowerCase();
        const siteA = (r.siteIdA || '').toLowerCase();
        const siteB = (r.siteIdB || '').toLowerCase();
        if (!interv.includes(q) && !siteA.includes(q) && !siteB.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [
    executorAssignedEngRows,
    executorDocTypeFilter,
    executorStatusFilter,
    executorRegionalFilter,
    executorTipoSiteFilter,
    executorIntervencaoSearch,
  ]);

  // Vistoriador / Executor ONLY sees files associated with their sites OR uploaded by them
  const ericssonFiles = useMemo(() => {
    const base = files.filter((fl) => fl.vendor === 'ERICSSON' || !fl.vendor);
    if (isVistoriador || isExecutor) {
      const myEmail = (user.email || '').trim().toLowerCase();
      const myName = (user.name || '').trim().toLowerCase();
      return base.filter((fl) => {
        const isOwn =
          (myEmail && (fl.uploadedByEmail || '').trim().toLowerCase() === myEmail) ||
          (myName && (fl.uploadedByName || '').trim().toLowerCase() === myName);
        return isOwn || doesFileMatchUserResponsibleSites(fl, user, [], rows);
      });
    }
    return base;
  }, [files, isVistoriador, isExecutor, user, rows]);

  const rootFolder = useMemo(
    () =>
      ericssonFolders.find((f) => f.id === 'folder-ericsson-root' || f.parentId === null) ||
      ericssonFolders[0] ||
      null,
    [ericssonFolders]
  );

  const [currentFolderId, setCurrentFolderId] = useState<string>(
    () => rootFolder?.id || 'folder-ericsson-root'
  );
  const [highlightedFileId, setHighlightedFileId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [deletingBulk, setDeletingBulk] = useState<boolean>(false);

  const activeFolder = useMemo(() => {
    const found = ericssonFolders.find((f) => f.id === currentFolderId);
    return found || rootFolder;
  }, [ericssonFolders, currentFolderId, rootFolder]);

  const effectiveFolderId = activeFolder?.id || 'folder-ericsson-root';
  const isAtRoot = !activeFolder || activeFolder.parentId === null;

  // Determine if active folder is inside Vistoria or Projeto Claro
  const isVistoriaBranch = useMemo(() => {
    if (!activeFolder) return false;
    if (activeFolder.id === 'folder-ericsson-vistoria') return true;
    let curr: EngineeringFolder | undefined = activeFolder;
    while (curr) {
      if (curr.id === 'folder-ericsson-vistoria') return true;
      curr = curr.parentId ? ericssonFolders.find((f) => f.id === curr!.parentId) : undefined;
    }
    return false;
  }, [activeFolder, ericssonFolders]);

  const isProjetoClaroBranch = useMemo(() => {
    if (!activeFolder) return false;
    if (activeFolder.id === 'folder-ericsson-projetos') return true;
    let curr: EngineeringFolder | undefined = activeFolder;
    while (curr) {
      if (curr.id === 'folder-ericsson-projetos') return true;
      curr = curr.parentId ? ericssonFolders.find((f) => f.id === curr!.parentId) : undefined;
    }
    return false;
  }, [activeFolder, ericssonFolders]);

  // Detected project doc type for current folder if inside WR, QRF, PPI, SDC, SMART, BOQ
  const currentProjectDocType = useMemo(() => {
    if (!activeFolder) return null;
    const nameUpper = activeFolder.name.toUpperCase().trim();
    if (['WR', 'QRF', 'PPI', 'SDC', 'SMART', 'BOQ'].includes(nameUpper)) {
      return nameUpper;
    }
    return null;
  }, [activeFolder]);

  // Ownership helpers
  const isFolderUploadedByCurrentUser = (folder: EngineeringFolder): boolean => {
    if (folder.isSystem) return false;
    const myEmail = (user.email || '').trim().toLowerCase();
    const myName = (user.name || '').trim().toLowerCase();
    const fEmail = (folder.createdByEmail || '').trim().toLowerCase();
    const fName = (folder.createdByName || '').trim().toLowerCase();
    if (myEmail && fEmail && myEmail === fEmail) return true;
    if (myName && fName && myName === fName) return true;
    return false;
  };

  const canModifyFolder = (folder: EngineeringFolder): boolean => {
    if (folder.isSystem) return false;
    if (isExecutor || isVistoriador) {
      return isFolderUploadedByCurrentUser(folder);
    }
    return true;
  };

  const isFileUploadedByCurrentUser = (file: EngineeringFile): boolean => {
    const myEmail = (user.email || '').trim().toLowerCase();
    const myName = (user.name || '').trim().toLowerCase();
    const flEmail = (file.uploadedByEmail || '').trim().toLowerCase();
    const flName = (file.uploadedByName || '').trim().toLowerCase();
    if (myEmail && flEmail && myEmail === flEmail) return true;
    if (myName && flName && myName === flName) return true;
    const parentFolder = ericssonFolders.find((f) => f.id === file.folderId);
    if (parentFolder && isFolderUploadedByCurrentUser(parentFolder)) return true;
    return false;
  };

  const canModifyFile = (file: EngineeringFile): boolean => {
    if (isExecutor || isVistoriador) {
      return isFileUploadedByCurrentUser(file);
    }
    return true;
  };

  // Search & Uploader filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [uploaderFilter, setUploaderFilter] = useState<string>('ALL');

  // Create Folder Modal state
  const [newFolderModalOpen, setNewFolderModalOpen] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [newFolderParentId, setNewFolderParentId] = useState<string>('');
  const [newFolderDescription, setNewFolderDescription] = useState<string>('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState<boolean>(false);

  // Upload Modal State (Vistoria vs Projeto Claro)
  const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);
  const [uploadMode, setUploadMode] = useState<'VISTORIA' | 'PROJETO' | 'LOS'>('VISTORIA');
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string>('');
  const [uploadProjectDocType, setUploadProjectDocType] = useState<string>('WR');

  // Vistoria Site Selection (linked to Sites spreadsheet)
  const [selectedSiteRowId, setSelectedSiteRowId] = useState<string>('');
  const [siteSearchQuery, setSiteSearchQuery] = useState<string>('');

  // Engineering Line Selection (linked to Engenharia spreadsheet)
  const [selectedEngRowId, setSelectedEngRowId] = useState<string>('');
  const [engSearchQuery, setEngSearchQuery] = useState<string>('');
  const [engRegionalFilter, setEngRegionalFilter] = useState<string>('ALL');
  const [engStatusFilter, setEngStatusFilter] = useState<string>('ALL');

  const [uploadNotes, setUploadNotes] = useState<string>('');
  const [pendingFiles, setPendingFiles] = useState<
    Array<{
      fileName: string;
      fileSize: number;
      base64Data: string;
    }>
  >([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);

  // Edit File Modal state
  const [editingFile, setEditingFile] = useState<EngineeringFile | null>(null);
  const [editFileName, setEditFileName] = useState<string>('');
  const [editFileNotes, setEditFileNotes] = useState<string>('');
  const [editFileSiteId, setEditFileSiteId] = useState<string>('');
  const [editFileError, setEditFileError] = useState<string | null>(null);
  const [savingFileEdit, setSavingFileEdit] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Focus jump handler
  useEffect(() => {
    if (focusedFileId || focusedFolderId || focusedFileName) {
      const targetFile = focusedFileId
        ? ericssonFiles.find((f) => f.id === focusedFileId)
        : focusedFileName
        ? ericssonFiles.find((f) => f.fileName === focusedFileName)
        : undefined;

      const resolvedFolderId =
        targetFile?.folderId ||
        focusedFolderId ||
        'folder-ericsson-root';

      setCurrentFolderId(resolvedFolderId);
      if (targetFile) {
        setHighlightedFileId(targetFile.id);
        setSearchQuery('');
      } else if (focusedFileName) {
        setSearchQuery(focusedFileName);
      }
      onClearFocus?.();
    }
  }, [focusedFileId, focusedFolderId, focusedFileName, ericssonFiles, onClearFocus]);

  // Selected site row from Sites spreadsheet
  const selectedSiteRow = useMemo(
    () => rows.find((r) => r.id === selectedSiteRowId) || null,
    [rows, selectedSiteRowId]
  );

  // Searchable site rows matching siteSearchQuery
  const matchingSiteRows = useMemo(() => {
    const q = siteSearchQuery.trim().toUpperCase();
    const pool = (isVistoriador || isExecutor) && responsibleRows.length > 0 ? responsibleRows : rows;
    if (!q) return pool.slice(0, 50);
    return pool
      .filter(
        (r) =>
          (r.siteIdA || '').toUpperCase().includes(q) ||
          (r.siteIdB || '').toUpperCase().includes(q) ||
          (r.chaves || '').toUpperCase().includes(q) ||
          (r.cidadeA || '').toUpperCase().includes(q) ||
          (r.cidadeB || '').toUpperCase().includes(q)
      )
      .slice(0, 50);
  }, [rows, responsibleRows, isVistoriador, isExecutor, siteSearchQuery]);

  // Searchable Engineering rows for Project upload
  const availableEngRows = useMemo(() => {
    const targetDoc = uploadProjectDocType.toUpperCase().trim();
    return engineeringRows.filter((r) => {
      const doc = (r.tipoDoc || r.fields?.['Tipo doc'] || '').toUpperCase().trim();
      return doc.includes(targetDoc) || targetDoc.includes(doc);
    });
  }, [engineeringRows, uploadProjectDocType]);

  const engRegionalOptions = useMemo(() => {
    const set = new Set<string>();
    availableEngRows.forEach((r) => {
      const reg = (r.regional || r.fields?.['Regional'] || '').trim();
      if (reg) set.add(reg);
    });
    return Array.from(set).sort();
  }, [availableEngRows]);

  const engStatusOptions = useMemo(() => {
    const set = new Set<string>();
    availableEngRows.forEach((r) => {
      const st = (r.status || r.fields?.['Status'] || '').trim();
      if (st) set.add(st);
    });
    return Array.from(set).sort();
  }, [availableEngRows]);

  const filteredEngRows = useMemo(() => {
    let list = availableEngRows;
    if (engRegionalFilter !== 'ALL') {
      list = list.filter((r) => (r.regional || r.fields?.['Regional'] || '').trim() === engRegionalFilter);
    }
    if (engStatusFilter !== 'ALL') {
      list = list.filter((r) => (r.status || r.fields?.['Status'] || '').trim() === engStatusFilter);
    }
    if (engSearchQuery.trim()) {
      const q = engSearchQuery.trim().toLowerCase();
      list = list.filter(
        (r) =>
          (r.intervencaoClaro || '').toLowerCase().includes(q) ||
          (r.siteIdA || '').toLowerCase().includes(q) ||
          (r.siteIdB || '').toLowerCase().includes(q) ||
          (r.executor || '').toLowerCase().includes(q) ||
          (r.id || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 60);
  }, [availableEngRows, engRegionalFilter, engStatusFilter, engSearchQuery]);

  const selectedEngRow = useMemo(
    () => engineeringRows.find((r) => r.id === selectedEngRowId) || null,
    [engineeringRows, selectedEngRowId]
  );

  // Breadcrumbs trail
  const breadcrumbs = useMemo(() => {
    const trail: EngineeringFolder[] = [];
    let curr: EngineeringFolder | undefined = activeFolder || undefined;
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      trail.unshift(curr);
      curr = curr.parentId
        ? ericssonFolders.find((f) => f.id === curr!.parentId)
        : undefined;
    }
    return trail;
  }, [activeFolder, ericssonFolders]);

  // Subfolders in current folder
  const childFolders = useMemo(() => {
    const list = ericssonFolders.filter(
      (f) => f.parentId === effectiveFolderId && f.id !== effectiveFolderId
    );

    // When at root, strictly show only canonical VISTORIA ('folder-ericsson-vistoria') and PROJETO CLARO ('folder-ericsson-projetos'), plus any custom folders
    const deduped: EngineeringFolder[] = [];
    const seen = new Set<string>();
    for (const f of list) {
      if (isExecutor || isVistoriador) {
        if (f.id === 'folder-ericsson-vistoria' || f.name.toUpperCase().trim() === 'VISTORIA') {
          continue;
        }
      }
      if (effectiveFolderId === 'folder-ericsson-root') {
        if (f.name.toUpperCase().trim() === 'PROJETO CLARO' && f.id !== 'folder-ericsson-projetos') {
          continue;
        }
        if (f.name.toUpperCase().trim() === 'VISTORIA' && f.id !== 'folder-ericsson-vistoria') {
          continue;
        }
      }
      const key = `${f.name.toUpperCase().trim()}_${f.parentId || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(f);
      }
    }

    if (!searchQuery.trim()) return deduped;
    const q = searchQuery.trim().toLowerCase();
    return deduped.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.description || '').toLowerCase().includes(q)
    );
  }, [ericssonFolders, effectiveFolderId, searchQuery]);

  // Files in current folder or matching global search
  const displayedFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base =
      isAtRoot || q
        ? ericssonFiles
        : ericssonFiles.filter((fl) => fl.folderId === effectiveFolderId);

    return base.filter((fl) => {
      if (uploaderFilter !== 'ALL' && fl.uploadedByName !== uploaderFilter) {
        return false;
      }
      if (!q) return true;
      return (
        fl.fileName.toLowerCase().includes(q) ||
        fl.uploadedByName.toLowerCase().includes(q) ||
        (fl.siteId || '').toLowerCase().includes(q) ||
        (fl.intervencaoClaro || '').toLowerCase().includes(q) ||
        (fl.tipoDoc || '').toLowerCase().includes(q) ||
        (fl.status || '').toLowerCase().includes(q) ||
        (fl.regional || '').toLowerCase().includes(q) ||
        (fl.notes || '').toLowerCase().includes(q)
      );
    });
  }, [
    ericssonFiles,
    effectiveFolderId,
    searchQuery,
    uploaderFilter,
    isAtRoot,
  ]);

  const uniqueUploaders = useMemo(() => {
    const set = new Set<string>();
    ericssonFiles.forEach((f) => {
      if (f.uploadedByName) set.add(f.uploadedByName);
    });
    return Array.from(set).sort();
  }, [ericssonFiles]);

  // Folder file count calculation (recursive for folder stats)
  const getFolderFileCount = (folderId: string): number => {
    const descendantIds = new Set<string>([folderId]);
    let added = true;
    while (added) {
      added = false;
      for (const f of ericssonFolders) {
        if (f.parentId && descendantIds.has(f.parentId) && !descendantIds.has(f.id)) {
          descendantIds.add(f.id);
          added = true;
        }
      }
    }
    return ericssonFiles.filter((fl) => descendantIds.has(fl.folderId)).length;
  };

  // Open Create Folder Modal
  const openCreateFolderModal = (parentId?: string) => {
    if (isExecutor || isVistoriador) return;
    const targetParent = parentId || effectiveFolderId || 'folder-ericsson-root';
    setNewFolderParentId(targetParent);
    setNewFolderName('');
    setNewFolderDescription('');
    setFolderError(null);
    setNewFolderModalOpen(true);
  };

  // Open Upload Modal based on context
  const openUploadModal = (
    mode: 'VISTORIA' | 'PROJETO' | 'LOS',
    targetFolderId?: string,
    forcedDocType?: string
  ) => {
    const resolvedFolderId = targetFolderId || effectiveFolderId;
    const folderObj = ericssonFolders.find((f) => f.id === resolvedFolderId);
    const docType =
      forcedDocType ||
      (folderObj && ['WR', 'QRF', 'PPI', 'SDC', 'SMART', 'BOQ'].includes(folderObj.name.toUpperCase())
        ? folderObj.name.toUpperCase()
        : 'WR');

    setUploadMode(mode);
    setUploadTargetFolderId(resolvedFolderId);
    setUploadProjectDocType(docType);
    setSelectedSiteRowId('');
    setSelectedEngRowId('');
    setSiteSearchQuery('');
    setEngSearchQuery('');
    setEngRegionalFilter('ALL');
    setEngStatusFilter('ALL');
    setUploadNotes('');
    setPendingFiles([]);
    setUploadError(null);
    setUploadModalOpen(true);
  };

  const handleReadSelectedFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploadError(null);
    const fileArray = Array.from(fileList);
    Promise.all(
      fileArray.map(
        (file) =>
          new Promise<{ fileName: string; fileSize: number; base64Data: string }>(
            (resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                resolve({
                  fileName: file.name,
                  fileSize: file.size,
                  base64Data: String(reader.result || ''),
                });
              };
              reader.onerror = () => reject(new Error(`Falha ao ler ${file.name}`));
              reader.readAsDataURL(file);
            }
          )
      )
    )
      .then((loaded) => {
        setPendingFiles((prev) => [...prev, ...loaded]);
      })
      .catch(() => {
        setUploadError('Erro ao ler um dos arquivos selecionados.');
      });
  };

  // Submit Upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);

    if (pendingFiles.length === 0) {
      setUploadError('Selecione pelo menos um arquivo (.zip, .rar, pdf, etc.).');
      return;
    }

    setUploading(true);

    if (uploadMode === 'PROJETO') {
      // LINKED TO ERICSSON ENGINEERING ROW
      if (!selectedEngRowId) {
        setUploadError('Vínculo obrigatório: Selecione uma linha da Engenharia Ericsson.');
        setUploading(false);
        return;
      }

      try {
        const res = await fetch('/api/ericsson/projetos/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engineeringRowId: selectedEngRowId,
            folderId: uploadTargetFolderId || 'folder-ericsson-projetos',
            tipoDoc: uploadProjectDocType,
            files: pendingFiles,
            notes: uploadNotes.trim() || undefined,
            uploadedByName: (user?.name || user?.email || 'Usuário').trim(),
            uploadedByEmail: (user?.email || '').trim(),
            uploadedByRole: effectiveRole,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setUploadError(data.error || 'Erro ao enviar arquivo para o projeto.');
          setUploading(false);
          return;
        }

        onUpdated(
          rows,
          sheetMeta,
          `${pendingFiles.length} arquivo(s) vinculado(s) à Intervenção ${selectedEngRow?.intervencaoClaro || ''} enviado(s) com sucesso!`,
          data.ericssonFolders,
          data.ericssonFiles
        );

        setUploadModalOpen(false);
        setPendingFiles([]);
      } catch {
        setUploadError('Erro de conexão ao enviar arquivos do projeto.');
      } finally {
        setUploading(false);
      }
    } else {
      // LINKED TO SITES ROW (VISTORIA OR LOS)
      if (!selectedSiteRowId) {
        setUploadError('Vínculo obrigatório: Selecione o Site da planilha Ericsson.');
        setUploading(false);
        return;
      }

      try {
        const res = await fetch('/api/ericsson/vistoria/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rowId: selectedSiteRowId,
            targetSide: uploadMode === 'LOS' ? 'LOS' : 'A',
            linkedSiteId: selectedSiteRow?.siteIdA || selectedSiteRow?.siteIdB || selectedSiteRow?.chaves,
            folderId: uploadTargetFolderId || 'folder-ericsson-vistoria',
            files: pendingFiles,
            notes: uploadNotes.trim() || undefined,
            uploadedByName: (user?.name || user?.email || 'Usuário').trim(),
            uploadedByEmail: (user?.email || '').trim(),
            uploadedByRole: effectiveRole,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setUploadError(data.error || 'Erro ao enviar arquivo de vistoria.');
          setUploading(false);
          return;
        }

        const siteLabel = selectedSiteRow?.siteIdA || selectedSiteRow?.chaves || 'Site';
        onUpdated(
          data.ericssonRows || rows,
          data.ericssonSheetMeta || sheetMeta,
          `${uploadMode === 'LOS' ? 'LOS' : 'Vistoria'} vinculada ao site ${siteLabel} enviada com sucesso!`,
          data.ericssonFolders,
          data.ericssonFiles
        );

        setUploadModalOpen(false);
        setPendingFiles([]);
      } catch {
        setUploadError('Erro de conexão ao enviar arquivos.');
      } finally {
        setUploading(false);
      }
    }
  };

  // Create Folder Submit
  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFolderError(null);
    if (!newFolderName.trim()) {
      setFolderError('Digite o nome da nova pasta.');
      return;
    }
    setCreatingFolder(true);
    try {
      const res = await fetch('/api/ericsson/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFolderName.trim(),
          parentId: newFolderParentId || effectiveFolderId || 'folder-ericsson-root',
          description: newFolderDescription.trim(),
          createdByName: user.name,
          createdByEmail: user.email,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFolderError(data.error || 'Não foi possível criar a pasta.');
        return;
      }
      onUpdated(
        rows,
        sheetMeta,
        `Pasta "${data.folder.name}" criada com sucesso!`,
        data.ericssonFolders,
        data.ericssonFiles
      );
      setNewFolderModalOpen(false);
    } catch {
      setFolderError('Falha de conexão ao criar pasta.');
    } finally {
      setCreatingFolder(false);
    }
  };

  // Delete File
  const handleDeleteFile = async (file: EngineeringFile) => {
    if (!canModifyFile(file)) return;
    try {
      const q = new URLSearchParams({
        actorEmail: user.email || '',
        actorName: user.name || '',
        actorRole: effectiveRole,
      });
      const res = await fetch(
        `/api/ericsson/files/${encodeURIComponent(file.id)}?${q.toString()}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        const data = await res.json();
        setSelectedFileIds((prev) => prev.filter((id) => id !== file.id));
        onUpdated(
          data.ericssonRows || rows,
          sheetMeta,
          `Arquivo "${file.fileName}" excluído com sucesso!`,
          data.ericssonFolders,
          data.ericssonFiles
        );
      }
    } catch {
      // ignore
    }
  };

  // Render File Icon
  const renderFileIcon = (file: EngineeringFile) => {
    if (file.fileType === 'zip' || file.fileType === 'rar' || file.fileType === '7z') {
      return (
        <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
          <FileArchive className="w-4 h-4" />
        </div>
      );
    }
    if (file.fileType === 'excel') {
      return (
        <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
          <FileSpreadsheet className="w-4 h-4" />
        </div>
      );
    }
    if (file.fileType === 'pdf' || file.fileType === 'word') {
      return (
        <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
          <FileText className="w-4 h-4" />
        </div>
      );
    }
    return (
      <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
        <File className="w-4 h-4" />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* =====================================================================
          1. HEADER CARD: PROJETO CLARO (ERICSSON)
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-400/40 flex items-center justify-center text-amber-600 shrink-0 shadow-2xs">
              <FolderOpen className="w-6 h-6 fill-amber-400/70 text-amber-700" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  {isExecutor || isVistoriador
                    ? 'DEMANDAS ENGENHARIA ERICSSON CLARO'
                    : 'PROJETO CLARO · ERICSSON'}
                </span>
                <span className="text-slate-300">•</span>
                <h1 className="text-lg font-black text-slate-900 tracking-tight">
                  {isAtRoot ? 'Pastas Principais' : activeFolder?.name}
                </h1>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isExecutor || isVistoriador
                  ? 'Demandas de projetos vinculadas à Engenharia Ericsson (WR, QRF, PPI, SDC, SMART e BOQ).'
                  : 'Repositório oficial de arquivos: VISTORIA (vinculado aos Sites) e PROJETO CLARO (WR, QRF, PPI, SDC, SMART e BOQ vinculados à Engenharia).'}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {onOpenSitesTab && !isExecutor && !isVistoriador && (
              <button
                type="button"
                onClick={onOpenSitesTab}
                className="flex-1 sm:flex-initial justify-center px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>Planilha Mãe (Sites)</span>
              </button>
            )}

            {onOpenEngenhariaTab && (
              <button
                type="button"
                onClick={onOpenEngenhariaTab}
                className="flex-1 sm:flex-initial justify-center px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Layers className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                <span>
                  {isExecutor || isVistoriador
                    ? 'Planilha Demandas Engenharia'
                    : 'Planilha Engenharia'}
                </span>
              </button>
            )}

            {canCreateFolders && (
              <button
                type="button"
                onClick={() => openCreateFolderModal(effectiveFolderId)}
                className="flex-1 sm:flex-initial justify-center px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <FolderPlus className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Nova Pasta Ericsson</span>
              </button>
            )}

            {/* Subir Arquivo de LOS (oculto para Executor/Vistoriador em Demandas Ericsson) */}
            {!isExecutor && !isVistoriador && (
              <button
                type="button"
                onClick={() => openUploadModal('LOS', 'folder-ericsson-vistoria')}
                className="flex-1 sm:flex-initial justify-center px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span>Subir arquivo de LOS</span>
              </button>
            )}

            {/* Contextual Upload Button */}
            {isVistoriaBranch && (
              <button
                type="button"
                onClick={() => openUploadModal('VISTORIA', effectiveFolderId)}
                className="w-full sm:w-auto justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-xl transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>Subir Arquivo de Vistoria</span>
              </button>
            )}

            {(isProjetoClaroBranch || currentProjectDocType) && (
              <button
                type="button"
                onClick={() =>
                  openUploadModal(
                    'PROJETO',
                    effectiveFolderId,
                    currentProjectDocType || 'WR'
                  )
                }
                className="w-full sm:w-auto justify-center px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-black rounded-xl transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>
                  {currentProjectDocType
                    ? `Subir Arquivos para ${currentProjectDocType}`
                    : 'Subir Arquivos do Projeto'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Breadcrumb Navigation Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCurrentFolderId('folder-ericsson-root')}
              className={`font-black hover:text-amber-700 cursor-pointer flex items-center gap-1.5 ${
                isAtRoot ? 'text-amber-700' : 'text-slate-700'
              }`}
            >
              <Folder className="w-4 h-4 text-amber-500" />
              <span>PROJETO CLARO</span>
            </button>

            {breadcrumbs.map((f, idx) => {
              if (f.id === 'folder-ericsson-root') return null;
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={f.id}>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  <button
                    type="button"
                    onClick={() => setCurrentFolderId(f.id)}
                    className={`font-bold hover:text-amber-700 cursor-pointer ${
                      isLast ? 'text-amber-700 font-black' : 'text-slate-600'
                    }`}
                  >
                    {f.name}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {/* Sub-tab switcher for Executor with demands */}
          {hasExecutorEricssonDemands && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveProjetoClaroSubTab('pastas')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeProjetoClaroSubTab === 'pastas'
                    ? 'bg-white text-slate-900 shadow-2xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Folder className="w-3.5 h-3.5 text-amber-500" />
                <span>Pastas</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveProjetoClaroSubTab('planilha')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeProjetoClaroSubTab === 'planilha'
                    ? 'bg-[#1E8E8D] text-white shadow-2xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Planilha Engenharia ({executorAssignedEngRows.length})</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {activeProjetoClaroSubTab === 'planilha' && hasExecutorEricssonDemands ? (
        /* =====================================================================
            MIRRORED ERICSSON ENGINEERING VIEW FOR EXECUTOR (READ-ONLY)
           ===================================================================== */
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
              {/* Tipo de Doc Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">Tipo de Doc:</span>
                <select
                  value={executorDocTypeFilter}
                  onChange={(e) => {
                    setExecutorDocTypeFilter(e.target.value);
                    setExecutorStatusFilter('ALL');
                  }}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="ALL">Todos os Tipos</option>
                  <option value="WR">WR</option>
                  <option value="QRF">QRF</option>
                  <option value="PPI">PPI</option>
                  <option value="SDC">SDC</option>
                  <option value="SMART">SMART</option>
                  <option value="BOQ">BOQ</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">Status:</span>
                <select
                  value={executorStatusFilter}
                  onChange={(e) => setExecutorStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500 cursor-pointer max-w-[240px]"
                >
                  <option value="ALL">Pendentes / Em Aberto (Oculta Finalizados)</option>
                  <option value="TODOS_INCLUINDO_FINALIZADOS">Todos os Status (Inclui Finalizados)</option>
                  {realStatusesForDoc.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* Regional Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">Regional:</span>
                <select
                  value={executorRegionalFilter}
                  onChange={(e) => setExecutorRegionalFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="ALL">Todas ({distinctRegionals.length})</option>
                  {distinctRegionals.map((reg) => (
                    <option key={reg} value={reg}>
                      {reg}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tipo Site Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">Tipo Site:</span>
                <select
                  value={executorTipoSiteFilter}
                  onChange={(e) => setExecutorTipoSiteFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="ALL">Todos ({distinctTipoSites.length})</option>
                  {distinctTipoSites.map((ts) => (
                    <option key={ts} value={ts}>
                      {ts}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Busca por Intervenção */}
            <div className="relative min-w-[200px] flex-1 sm:flex-initial">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={executorIntervencaoSearch}
                onChange={(e) => setExecutorIntervencaoSearch(e.target.value)}
                placeholder="Buscar por Intervenção..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Table (9 COLUMNS IN EXACT ORDER) */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white font-bold text-[11px] uppercase tracking-wider divide-x divide-slate-800">
                    <th className="py-3 px-3">Intervenção</th>
                    <th className="py-3 px-3">Tipo de site</th>
                    <th className="py-3 px-3">Regional</th>
                    <th className="py-3 px-3">Tipo de doc</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Comentário</th>
                    <th className="py-3 px-3">Planejado</th>
                    <th className="py-3 px-3">Entregue</th>
                    <th className="py-3 px-3">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredExecutorEngRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400 font-semibold">
                        Nenhuma demanda de Engenharia encontrada.
                      </td>
                    </tr>
                  ) : (
                    filteredExecutorEngRows.map((r) => {
                      const interv = r.intervencaoClaro || r.siteIdA || r.fields?.['Intervencao Claro'] || '—';
                      const tipoSite = r.tipoSite || r.fields?.['TIPO SITE'] || r.fields?.['Tipo site'] || '—';
                      const regional = r.regional || r.fields?.['Regional'] || '—';
                      const tipoDoc = r.tipoDoc || r.fields?.['Tipo doc'] || '—';
                      const rawStatus = r.status || r.fields?.['Status'] || '—';
                      const statusReal = normalizeEricssonRealStatus(rawStatus, (r.tipoDoc || undefined) as EricssonDocGroup);
                      const comentario =
                        r.fields?.['Comentário'] ||
                        r.fields?.['COMENTÁRIO'] ||
                        r.fields?.['Comentario'] ||
                        r.fields?.['Comentários'] ||
                        '—';
                      const planejado =
                        r.fields?.['Planejado'] ||
                        r.fields?.['PLANEJADO'] ||
                        r.fields?.['Data Planejada'] ||
                        r.fields?.['Planejada'] ||
                        '—';
                      const entregue =
                        r.fields?.['Entregue'] ||
                        r.fields?.['ENTREGUE'] ||
                        r.fields?.['Data Entregue'] ||
                        r.fields?.['Data de Envio'] ||
                        '—';
                      const observacao =
                        r.fields?.['Observação'] ||
                        r.fields?.['OBSERVAÇÃO'] ||
                        r.fields?.['Observacao'] ||
                        r.fields?.['Observações'] ||
                        '—';

                      return (
                        <tr
                          key={r.id}
                          onClick={() => setSelectedDrawerRow(r)}
                          className="hover:bg-amber-50/50 cursor-pointer transition-colors divide-x divide-slate-100"
                        >
                          <td className="py-2.5 px-3 font-bold text-slate-900 font-mono">
                            {interv}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">{tipoSite}</td>
                          <td className="py-2.5 px-3 text-slate-700 font-semibold">{regional}</td>
                          <td className="py-2.5 px-3 font-bold text-teal-700">{tipoDoc}</td>
                          <td className="py-2.5 px-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-800">
                              {statusReal}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 max-w-[180px] truncate" title={comentario}>
                            {comentario}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 font-mono">{planejado}</td>
                          <td className="py-2.5 px-3 text-slate-600 font-mono">{entregue}</td>
                          <td className="py-2.5 px-3 text-slate-600 max-w-[180px] truncate" title={observacao}>
                            {observacao}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Folder Cards & Files View */
        <>

      {/* =====================================================================
          2. FOLDER CARDS GRID
         ===================================================================== */}
      {childFolders.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-amber-500" />
              <span>Pastas ({childFolders.length})</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {childFolders.map((f) => {
              const fileCount = getFolderFileCount(f.id);
              const isProject = ['WR', 'QRF', 'PPI', 'SDC', 'SMART', 'BOQ'].includes(f.name.toUpperCase());
              return (
                <div
                  key={f.id}
                  onClick={() => setCurrentFolderId(f.id)}
                  className="p-4 bg-white border border-slate-200/90 rounded-2xl shadow-xs hover:shadow-md hover:border-amber-400 transition-all cursor-pointer group flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isProject
                            ? 'bg-teal-50 text-teal-600 border border-teal-200'
                            : f.name === 'VISTORIA'
                            ? 'bg-blue-50 text-blue-600 border border-blue-200'
                            : 'bg-amber-50 text-amber-600 border border-amber-200'
                        }`}
                      >
                        <Folder className="w-5 h-5 group-hover:scale-110 transition-transform" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-black text-sm text-slate-900 truncate group-hover:text-amber-700 transition-colors">
                          {f.name}
                        </h3>
                        <p className="text-[11px] text-slate-400 truncate">
                          {f.description || (isProject ? `Projeto ${f.name}` : 'Pasta')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
                    <span className="font-bold text-slate-700 flex items-center gap-1 font-mono text-[11px]">
                      {fileCount} {fileCount === 1 ? 'arquivo' : 'arquivos'}
                    </span>
                    <span className="text-amber-600 font-bold text-[11px] flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                      <span>Abrir</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          3. FILES TOOLBAR (Search & Filters)
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome do arquivo, Site ID, Intervenção, remetente..."
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-amber-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Uploader filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-500 flex items-center gap-1 shrink-0">
            <Filter className="w-3.5 h-3.5" />
            <span>Remetente:</span>
          </label>
          <select
            value={uploaderFilter}
            onChange={(e) => setUploaderFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:border-amber-500 cursor-pointer"
          >
            <option value="ALL">Todos ({uniqueUploaders.length})</option>
            {uniqueUploaders.map((up) => (
              <option key={up} value={up}>
                {up}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* =====================================================================
          4. FILES LIST
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-slate-500" />
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Arquivos ({displayedFiles.length})
            </h3>
          </div>
          {searchQuery && (
            <span className="text-xs text-slate-500">
              Exibindo resultados da busca em todas as pastas
            </span>
          )}
        </div>

        {displayedFiles.length === 0 ? (
          <div className="text-center py-16 px-4 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6" />
            </div>
            <p className="font-bold text-slate-700 text-sm">Nenhum arquivo nesta pasta</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Suba arquivos vinculando-os à planilha de Sites ou à planilha de Engenharia Ericsson.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {displayedFiles.map((file) => {
              const hasLink = Boolean(file.siteId || file.intervencaoClaro || file.engineeringRowId);
              const isHighlighted = highlightedFileId === file.id;
              return (
                <div
                  key={file.id}
                  className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                    isHighlighted
                      ? 'bg-amber-50/60 border-l-4 border-amber-500'
                      : 'hover:bg-slate-50/80'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {renderFileIcon(file)}
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-xs truncate">
                          {file.fileName}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          ({formatBytes(file.fileSize)})
                        </span>

                        {/* Link Badge */}
                        {file.intervencaoClaro || file.engineeringRowId ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 border border-teal-200 text-teal-800 text-[10px] font-bold">
                            <Tag className="w-3 h-3 text-teal-600" />
                            <span>
                              {file.tipoDoc ? `[${file.tipoDoc}] ` : ''}Intervenção:{' '}
                              <strong className="font-mono">{file.intervencaoClaro || file.siteId}</strong>
                            </span>
                            {file.status && (
                              <span className="text-teal-600 font-semibold">• {file.status}</span>
                            )}
                            {file.regional && (
                              <span className="text-teal-600">• {file.regional}</span>
                            )}
                          </span>
                        ) : file.siteId ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-[10px] font-bold">
                            <Building className="w-3 h-3 text-blue-600" />
                            <span>
                              Site:{' '}
                              <strong className="font-mono">{file.siteId}</strong>
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-semibold">
                            <AlertCircle className="w-3 h-3 text-amber-600" />
                            <span>Sem vínculo</span>
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap">
                        <span>Enviado por {file.uploadedByName}</span>
                        <span>•</span>
                        <span>{formatDateTime(file.uploadedAt)}</span>
                        {file.notes && (
                          <>
                            <span>•</span>
                            <span className="italic text-slate-500">"{file.notes}"</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    <a
                      href={`/api/ericsson/files/${encodeURIComponent(file.id)}/download`}
                      download={file.fileName}
                      className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                      title="Baixar arquivo"
                    >
                      <Download className="w-4 h-4" />
                    </a>

                    {canModifyFile(file) && (
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(file)}
                        className="p-2 text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors cursor-pointer"
                        title="Excluir arquivo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>
      )}

      {/* =====================================================================
          5. UPLOAD MODAL (Vistoria vs Projeto Claro)
         ===================================================================== */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  {uploadMode === 'PROJETO'
                    ? `PROJETO ${uploadProjectDocType} · ENGENHARIA`
                    : uploadMode === 'LOS'
                    ? 'ENVIAR ARQUIVO DE LOS'
                    : 'ENVIAR VISTORIA'}
                </span>
                <h2 className="text-lg font-black text-slate-900 mt-1">
                  {uploadMode === 'PROJETO'
                    ? `Subir Arquivos para ${uploadProjectDocType}`
                    : uploadMode === 'LOS'
                    ? 'Subir Arquivo de LOS (Sites)'
                    : 'Subir Arquivo de Vistoria (Sites)'}
                </h2>
                <p className="text-xs text-slate-500">
                  {uploadMode === 'PROJETO'
                    ? 'Vínculo obrigatório com uma linha da planilha de Engenharia Ericsson.'
                    : 'Vínculo obrigatório com um site da planilha mãe de Sites Ericsson.'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {uploadError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* SECTION A: PROJETO CLARO (ENGINEERING LINK) */}
              {uploadMode === 'PROJETO' && (
                <div className="space-y-3 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-700">
                      1. Vincular à Linha de Engenharia ({uploadProjectDocType}) *
                    </label>
                    <span className="text-[11px] font-bold text-teal-700">
                      {availableEngRows.length} linhas {uploadProjectDocType} disponíveis
                    </span>
                  </div>

                  {/* Filters: Search, Regional, Status */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="relative sm:col-span-1">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        value={engSearchQuery}
                        onChange={(e) => setEngSearchQuery(e.target.value)}
                        placeholder="Intervenção / ID..."
                        className="w-full pl-8 pr-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                    </div>

                    <select
                      value={engRegionalFilter}
                      onChange={(e) => setEngRegionalFilter(e.target.value)}
                      className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold"
                    >
                      <option value="ALL">Todas Regionais</option>
                      {engRegionalOptions.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>

                    <select
                      value={engStatusFilter}
                      onChange={(e) => setEngStatusFilter(e.target.value)}
                      className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold"
                    >
                      <option value="ALL">Todos Status</option>
                      {engStatusOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Searchable Radio List of Rows */}
                  <div className="max-h-48 overflow-y-auto space-y-1.5 bg-white p-2 border border-slate-200 rounded-xl">
                    {filteredEngRows.length === 0 ? (
                      <p className="text-center py-4 text-xs text-slate-400 italic">
                        Nenhuma linha encontrada para {uploadProjectDocType}.
                      </p>
                    ) : (
                      filteredEngRows.map((r) => {
                        const isSelected = selectedEngRowId === r.id;
                        return (
                          <div
                            key={r.id}
                            onClick={() => setSelectedEngRowId(r.id)}
                            className={`p-2.5 rounded-xl border text-xs cursor-pointer flex items-center justify-between gap-2 transition-all ${
                              isSelected
                                ? 'bg-teal-50 border-teal-500 text-teal-950 font-bold shadow-2xs'
                                : 'bg-slate-50/60 border-slate-200/80 hover:bg-slate-100 text-slate-800'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="font-mono font-bold text-xs truncate">
                                Intervenção: {r.intervencaoClaro || r.siteIdA || '—'}
                              </p>
                              <p className="text-[10px] text-slate-500 truncate">
                                Regional: {r.regional || '—'} • Status: {r.status || '—'} • Doc: {r.tipoDoc || uploadProjectDocType}
                              </p>
                            </div>
                            <div
                              className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                isSelected
                                  ? 'border-teal-600 bg-teal-600 text-white'
                                  : 'border-slate-300 bg-white'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3" />}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* SECTION B: VISTORIA / LOS (SITES SPREADSHEET LINK) */}
              {(uploadMode === 'VISTORIA' || uploadMode === 'LOS') && (
                <div className="space-y-3 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-700">
                      1. Vincular ao Site da Planilha Ericsson *
                    </label>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={siteSearchQuery}
                      onChange={(e) => setSiteSearchQuery(e.target.value)}
                      placeholder="Pesquisar por Site ID (A ou B), Chaves, Cidade..."
                      className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1.5 bg-white p-2 border border-slate-200 rounded-xl">
                    {matchingSiteRows.length === 0 ? (
                      <p className="text-center py-4 text-xs text-slate-400 italic">
                        Nenhum site encontrado.
                      </p>
                    ) : (
                      matchingSiteRows.map((r) => {
                        const isSelected = selectedSiteRowId === r.id;
                        const label = r.siteIdA && r.siteIdB ? `${r.siteIdA} ↔ ${r.siteIdB}` : r.siteIdA || r.siteIdB || r.chaves;
                        return (
                          <div
                            key={r.id}
                            onClick={() => setSelectedSiteRowId(r.id)}
                            className={`p-2.5 rounded-xl border text-xs cursor-pointer flex items-center justify-between gap-2 transition-all ${
                              isSelected
                                ? 'bg-blue-50 border-blue-500 text-blue-950 font-bold shadow-2xs'
                                : 'bg-slate-50/60 border-slate-200/80 hover:bg-slate-100 text-slate-800'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="font-mono font-bold text-xs truncate">{label}</p>
                              <p className="text-[10px] text-slate-500 truncate">
                                Chaves: {r.chaves || '—'} • Cidade: {r.cidadeA || r.cidadeB || '—'} • UF: {r.state || '—'}
                              </p>
                            </div>
                            <div
                              className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                isSelected
                                  ? 'border-blue-600 bg-blue-600 text-white'
                                  : 'border-slate-300 bg-white'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3" />}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* FILE PICKER (multiple files, .zip, .rar, .pdf, etc.) */}
              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700">
                  2. Selecionar Arquivos (.zip, .rar, .pdf, fotos, relatórios) *
                </label>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 hover:border-amber-500 rounded-2xl p-6 text-center bg-slate-50/50 hover:bg-amber-50/30 transition-all cursor-pointer space-y-2"
                >
                  <Upload className="w-6 h-6 text-amber-600 mx-auto" />
                  <p className="text-xs font-bold text-slate-700">
                    Clique aqui para selecionar os arquivos
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Aceita múltiplos arquivos simultâneos (incluindo .ZIP e WinRAR .RAR)
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={(e) => handleReadSelectedFiles(e.target.files)}
                    className="hidden"
                  />
                </div>

                {/* Selected Files List */}
                {pendingFiles.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <p className="text-[11px] font-bold text-slate-600">
                      {pendingFiles.length} arquivo(s) selecionado(s):
                    </p>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {pendingFiles.map((f, idx) => (
                        <div
                          key={idx}
                          className="p-2 bg-slate-100 rounded-lg text-xs flex items-center justify-between gap-2"
                        >
                          <span className="font-mono truncate">{f.fileName}</span>
                          <span className="text-[10px] text-slate-500 shrink-0">
                            {formatBytes(f.fileSize)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Observações (Opcional):
                </label>
                <input
                  type="text"
                  value={uploadNotes}
                  onChange={(e) => setUploadNotes(e.target.value)}
                  placeholder="Ex: Pacote de documentação enviado..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {uploading ? 'Enviando...' : 'Confirmar Envio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          6. CREATE FOLDER MODAL
         ===================================================================== */}
      {newFolderModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-black text-slate-900">Nova Pasta Ericsson</h2>
                <p className="text-xs text-slate-500">Crie uma nova subpasta no repositório.</p>
              </div>
              <button
                type="button"
                onClick={() => setNewFolderModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFolderSubmit} className="space-y-3">
              {folderError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700">
                  {folderError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nome da Pasta *
                </label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Ex: Documentos Regionais..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Descrição (Opcional)
                </label>
                <input
                  type="text"
                  value={newFolderDescription}
                  onChange={(e) => setNewFolderDescription(e.target.value)}
                  placeholder="Finalidade da pasta..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setNewFolderModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingFolder}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black rounded-xl cursor-pointer"
                >
                  {creatingFolder ? 'Criando...' : 'Criar Pasta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Drawer for Mirrored Row Details */}
      {selectedDrawerRow && (
        <EricssonEngineeringDrawer
          row={selectedDrawerRow}
          isOpen={Boolean(selectedDrawerRow)}
          user={user}
          effectiveRole={effectiveRole}
          files={files}
          readOnly={true}
          onClose={() => setSelectedDrawerRow(null)}
          onSaveRow={async () => {}}
          showToast={() => {}}
        />
      )}
    </div>
  );
};
