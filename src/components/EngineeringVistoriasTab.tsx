import React, { useState, useMemo, useRef } from 'react';
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
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  X,
  Plus,
  ExternalLink,
  Users,
  ShieldCheck,
  Lock,
  ChevronDown,
  ChevronUp,
  Eye,
  Pencil,
  Bell,
  FolderCheck,
} from 'lucide-react';
import {
  EngineeringFolder,
  EngineeringFile,
  AmetaUser,
  UserRole,
  normalizeUserRole,
  VendorType,
  TelecomSite,
  TssrRow,
  TssrSheetMeta,
} from '../types/telecom';
import {
  doesDocumentMatchResponsible,
  doesFileMatchUserResponsibleSites,
  doesSiteMatchResponsible,
} from '../utils/spreadsheetUtils';
import { dataService } from '../services/dataService';
import { cloudFetch } from '../lib/firebaseCloud';

const fetch = cloudFetch;

interface EngineeringVistoriasTabProps {
  user: AmetaUser;
  effectiveRole?: UserRole;
  simulatedTargetUser?: AmetaUser | null;
  onToggleSimulateUser?: (targetUser: AmetaUser | null) => void;
  users?: AmetaUser[];
  activeVendor: VendorType;
  folders: EngineeringFolder[];
  files: EngineeringFile[];
  sites: TelecomSite[];
  tssrRows?: TssrRow[];
  preselectedSiteId?: string | null;
  onClearPreselectedSiteId?: () => void;
  onFoldersAndFilesUpdated: (
    nextFolders: EngineeringFolder[],
    nextFiles: EngineeringFile[],
    toastMsg?: string,
    nextTssrRows?: TssrRow[],
    nextTssrSheets?: TssrSheetMeta[],
    nextSites?: TelecomSite[]
  ) => void;
  onSelectSiteId: (siteId: string) => void;
  onOpenTssrTab?: () => void;
  mode?: 'vistoria' | 'tssr-projects';
  initialFolderId?: string | null;
  onBackToEngineeringControl?: () => void;
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

export const EngineeringVistoriasTab: React.FC<EngineeringVistoriasTabProps> = ({
  user,
  effectiveRole,
  simulatedTargetUser = null,
  onToggleSimulateUser,
  users = [],
  activeVendor,
  folders,
  files,
  sites,
  tssrRows = [],
  preselectedSiteId = null,
  onClearPreselectedSiteId,
  onFoldersAndFilesUpdated,
  onSelectSiteId,
  onOpenTssrTab,
  mode = 'vistoria',
  initialFolderId = null,
  onBackToEngineeringControl,
}) => {
  const activeTargetUser = simulatedTargetUser || user;
  const currentRole: UserRole = simulatedTargetUser
    ? normalizeUserRole(simulatedTargetUser.role)
    : effectiveRole || normalizeUserRole(user.role);
  const isAdmRole = currentRole === 'ADM';
  const isCoordenadorGeral = currentRole === 'Coordenador Geral';
  const isCoordenadorEngenharia = currentRole === 'Coordenador Engenharia';
  const isAdmin =
    (isAdmRole || isCoordenadorGeral || isCoordenadorEngenharia) &&
    !simulatedTargetUser;
  const isGestorEngenharia =
    isCoordenadorEngenharia ||
    isCoordenadorGeral ||
    isAdmRole ||
    isAdmin ||
    effectiveRole === 'Coordenador Engenharia' ||
    effectiveRole === 'ADM';
  const isVistoriador = currentRole === 'Vistoriador';
  const isExecutor = currentRole === 'Executor';
  const canCreateFolders = !isExecutor && !isVistoriador;
  const canUploadTssr =
    isExecutor ||
    isCoordenadorEngenharia ||
    isCoordenadorGeral ||
    isAdmRole;
  const canUploadVistoria =
    !isExecutor &&
    (isVistoriador ||
      isCoordenadorEngenharia ||
      isCoordenadorGeral ||
      isAdmRole);
  const isTssrProjectsMode = mode === 'tssr-projects';

  // TSSR TIM Nokia rows for searchable site selector and executor linking
  const tssrNokiaRows = useMemo(
    () => tssrRows.filter((r) => r.tabName === 'TSSR TIM Nokia'),
    [tssrRows]
  );

  // Hidden/collapsible tab state for "Demanda por Responsável" inside Documentos ("em uma aba escondida so abre se eu clicar")
  const [isDocDemandaTabOpen, setIsDocDemandaTabOpen] = useState<boolean>(false);
  const [docResponsavelFilter, setDocResponsavelFilter] = useState<string>('ALL');

  const assignableUsers = useMemo(() => {
    // Na pasta de Vistoria, listar estritamente Vistoriadores liberados da plataforma ativa (Executor NÃO pode aparecer na lista do Vistoriador)
    return users.filter((u) => {
      const role = normalizeUserRole(u.role);
      const isVist = role === 'Vistoriador';
      const plat = (u.assignedPlatform || u.plataforma || '').toUpperCase();
      const matchPlat = !plat || plat === 'AMBAS' || plat === 'BOTH' || plat === activeVendor;
      return isVist && matchPlat;
    });
  }, [users, activeVendor]);

  const allVendorFolders = useMemo(
    () => folders.filter((f) => f.vendor === activeVendor),
    [folders, activeVendor]
  );

  const allVendorFiles = useMemo(
    () => files.filter((fl) => fl.vendor === activeVendor),
    [files, activeVendor]
  );

  const vendorFolders = useMemo(() => {
    // Se for Executor: NÃO vê pasta vistoria, APENAS de TSSR
    if (isExecutor) {
      const allowedIds = new Set<string>();
      for (const f of allVendorFolders) {
        if (
          f.name === 'TSSR' ||
          f.name === 'TSSR Entrada' ||
          f.id.endsWith('-tssr-final') ||
          f.id.endsWith('-tssr-entrada')
        ) {
          allowedIds.add(f.id);
        }
      }
      let added = true;
      while (added) {
        added = false;
        for (const f of allVendorFolders) {
          if (
            f.parentId &&
            allowedIds.has(f.parentId) &&
            !allowedIds.has(f.id) &&
            f.name !== 'Vistorias' &&
            f.name !== 'Vistorias Executadas' &&
            !f.id.includes('vistorias-executadas')
          ) {
            allowedIds.add(f.id);
            added = true;
          }
        }
      }
      return allVendorFolders.filter((f) => allowedIds.has(f.id));
    }

    if (isTssrProjectsMode) {
      // In TSSR Projects mode ("TSSR Entrada" & "TSSR"), show the root container + TSSR Entrada + TSSR and all their subfolders
      const allowedIds = new Set<string>();
      for (const f of allVendorFolders) {
        if (f.parentId === null || f.name === 'TSSR Entrada' || f.name === 'TSSR') {
          allowedIds.add(f.id);
        }
      }
      let added = true;
      while (added) {
        added = false;
        for (const f of allVendorFolders) {
          if (f.parentId && allowedIds.has(f.parentId) && f.name !== 'Vistorias Executadas' && !allowedIds.has(f.id)) {
            allowedIds.add(f.id);
            added = true;
          }
        }
      }
      return allVendorFolders.filter((f) => allowedIds.has(f.id));
    }

    // In Vistoria mode (and always for Vistoriador), show ONLY Vistorias / Vistorias Executadas (exclude TSSR Entrada and TSSR Engineering folders)
    const blockedRootIds = new Set(
      allVendorFolders
        .filter((f) => f.name === 'TSSR Entrada' || f.name === 'TSSR')
        .map((f) => f.id)
    );
    let added = true;
    while (added) {
      added = false;
      for (const f of allVendorFolders) {
        if (f.parentId && blockedRootIds.has(f.parentId) && !blockedRootIds.has(f.id)) {
          blockedRootIds.add(f.id);
          added = true;
        }
      }
    }
    return allVendorFolders.filter((f) => !blockedRootIds.has(f.id));
  }, [allVendorFolders, isTssrProjectsMode, isExecutor]);

  const allowedFolderIds = useMemo(
    () => new Set(vendorFolders.map((f) => f.id)),
    [vendorFolders]
  );

  // Sites that the current user (Vistoriador / Executor) is responsible for doing
  const responsibleSites = useMemo(
    () =>
      sites.filter(
        (s) =>
          s.vendor === activeVendor &&
          s.sheetName !== 'Equipes' &&
          s.sheetName !== 'Controle Cancelados' &&
          doesSiteMatchResponsible(s, activeTargetUser)
      ),
    [sites, activeVendor, activeTargetUser]
  );

  // Files visible to the current user:
  // - Vistoriador ONLY sees files associated with the sites they are responsible for doing
  // - Executor sees files associated with their responsible sites or uploaded/assigned to them
  const vendorFiles = useMemo(() => {
    if (isVistoriador) {
      return allVendorFiles.filter((fl) =>
        doesFileMatchUserResponsibleSites(fl, activeTargetUser, sites)
      );
    }
    const folderScopedFiles = allVendorFiles.filter((fl) => allowedFolderIds.has(fl.folderId));
    if (!isAdmin) {
      return folderScopedFiles.filter((fl) => {
        const folder = allVendorFolders.find((f) => f.id === fl.folderId);
        return (
          doesFileMatchUserResponsibleSites(fl, activeTargetUser, sites) ||
          doesDocumentMatchResponsible(fl, folder, activeTargetUser)
        );
      });
    }
    if (docResponsavelFilter === 'ALL') {
      return folderScopedFiles;
    }
    if (docResponsavelFilter === '__NONE__') {
      return folderScopedFiles.filter((fl) => !fl.assignedTo?.trim());
    }
    return folderScopedFiles.filter((fl) => {
      const folder = allVendorFolders.find((f) => f.id === fl.folderId);
      return (
        doesFileMatchUserResponsibleSites(fl, docResponsavelFilter, sites) ||
        doesDocumentMatchResponsible(fl, folder, docResponsavelFilter)
      );
    });
  }, [
    allVendorFiles,
    allowedFolderIds,
    allVendorFolders,
    isAdmin,
    isVistoriador,
    activeTargetUser,
    sites,
    docResponsavelFilter,
  ]);

  // Helper para localizar a pasta liberada do executor dentro de TSSR / TSSR Entrada
  const findLiberatedFolderForExecutor = (
    folders: EngineeringFolder[],
    vendor: VendorType,
    execName: string
  ): EngineeringFolder | undefined => {
    if (!execName || !execName.trim()) return undefined;
    const clean = execName.trim().toLowerCase();
    const tssrParents = folders.filter(
      (f) =>
        f.vendor === vendor &&
        (f.name === 'TSSR' ||
          f.name === 'TSSR Entrada' ||
          f.id.endsWith('-tssr-final') ||
          f.id.endsWith('-tssr-entrada'))
    );
    const parentIds = new Set(tssrParents.map((p) => p.id));
    return folders.find(
      (f) =>
        f.vendor === vendor &&
        (parentIds.has(f.parentId || '') || f.id.includes('tssr-exec')) &&
        ((f.assignedTo && f.assignedTo.trim().toLowerCase() === clean) ||
          f.name.trim().toLowerCase() === clean)
    );
  };

  const rootTssrFolder = useMemo(
    () =>
      allVendorFolders.find(
        (f) =>
          (f.name === 'TSSR' || f.id.endsWith('-tssr-final')) &&
          f.vendor === activeVendor
      ) ||
      allVendorFolders.find(
        (f) =>
          (f.name === 'TSSR Entrada' || f.id.endsWith('-tssr-entrada')) &&
          f.vendor === activeVendor
      ) ||
      null,
    [allVendorFolders, activeVendor]
  );

  const rootVistoriasFolder = useMemo(() => {
    if (isExecutor) {
      return rootTssrFolder || vendorFolders[0] || null;
    }
    return (
      vendorFolders.find((f) => f.parentId === null && f.name === 'Vistorias') ||
      vendorFolders[0] ||
      null
    );
  }, [vendorFolders, isExecutor, rootTssrFolder]);

  const [currentFolderId, setCurrentFolderId] = useState<string>(() => {
    if (initialFolderId) return initialFolderId;
    if (isExecutor) {
      const execName = (activeTargetUser.name || user.name || '').trim();
      const myLiberated = findLiberatedFolderForExecutor(allVendorFolders, activeVendor, execName);
      if (myLiberated) return myLiberated.id;
      if (rootTssrFolder) return rootTssrFolder.id;
    }
    return rootVistoriasFolder?.id || `folder-${activeVendor.toLowerCase()}-vistorias`;
  });

  // Sync currentFolderId when initialFolderId prop changes (e.g. clicking TSSR Entrada vs TSSR in corner)
  React.useEffect(() => {
    if (initialFolderId) {
      setCurrentFolderId(initialFolderId);
    }
  }, [initialFolderId]);

  // Ensure currentFolderId belongs to activeVendor when switching vendor
  const activeFolder = useMemo(() => {
    const found = vendorFolders.find((f) => f.id === currentFolderId);
    if (found) return found;
    return rootVistoriasFolder;
  }, [vendorFolders, currentFolderId, rootVistoriasFolder]);

  const effectiveFolderId = activeFolder?.id || `folder-${activeVendor.toLowerCase()}-vistorias`;

  // True when viewing the outer "Vistorias" folder or "Vistorias Executadas" folder index
  const isAtRootVistorias = useMemo(
    () => !activeFolder || activeFolder.parentId === null,
    [activeFolder]
  );

  const isAtVistoriasExecutadasIndex = useMemo(
    () => activeFolder?.name === 'Vistorias Executadas',
    [activeFolder]
  );

  // Folder only shows folders (no direct file uploads at this level unless Vistoriador has site-associated files)
  const isFolderOnlyLevel =
    (isAtRootVistorias && !isVistoriador) ||
    (isAtVistoriasExecutadasIndex && !isVistoriador);

  // Only folders inside Vistorias (excluding root Vistorias and Vistorias Executadas index) can receive file uploads
  const uploadableFolders = useMemo(
    () =>
      vendorFolders.filter(
        (f) => f.parentId !== null && f.name !== 'Vistorias Executadas'
      ),
    [vendorFolders]
  );

  // Folders where the current user is allowed to create subfolders
  const creatableParentFolders = useMemo(
    () =>
      isExecutor || isVistoriador
        ? []
        : isAdmin
        ? vendorFolders
        : vendorFolders.filter((f) => f.parentId !== null),
    [vendorFolders, isAdmin, isExecutor, isVistoriador]
  );

  // Ownership helpers: Executor and Vistoriador can ONLY modify/delete folders and files they uploaded to the system
  const isFolderUploadedByCurrentUser = (folder: EngineeringFolder): boolean => {
    if (folder.isSystem) return false;
    const myEmail = (activeTargetUser.email || user.email || '').trim().toLowerCase();
    const myName = (activeTargetUser.name || user.name || '').trim().toLowerCase();
    const fEmail = (folder.createdByEmail || '').trim().toLowerCase();
    const fName = (folder.createdByName || '').trim().toLowerCase();
    if (myEmail && fEmail && myEmail === fEmail) return true;
    if (myName && fName && myName === fName) return true;
    return false;
  };

  const canModifyFolder = (folder: EngineeringFolder): boolean => {
    if (folder.isSystem) return false;
    // O executor NÃO pode apagar pastas ("menos as pastas")
    if (isExecutor || isVistoriador) return false;
    // Gestor da Engenharia (Coordenador Engenharia, ADM, Dono, Coordenador Geral) pode gerenciar/apagar pastas
    if (isGestorEngenharia) return true;
    return false;
  };

  const isFileLinkedToCurrentUser = (file: EngineeringFile): boolean => {
    const myEmail = (activeTargetUser.email || user.email || '').trim().toLowerCase();
    const myName = (activeTargetUser.name || user.name || '').trim().toLowerCase();
    const flEmail = (file.uploadedByEmail || '').trim().toLowerCase();
    const flName = (file.uploadedByName || '').trim().toLowerCase();
    const flAssigned = (file.assignedTo || '').trim().toLowerCase();
    if (myEmail && flEmail && myEmail === flEmail) return true;
    if (myName && flName && myName === flName) return true;
    if (myName && flAssigned && myName === flAssigned) return true;
    if (myName && file.fileName.toLowerCase().includes(myName)) return true;
    // Também verificar se o arquivo pertence a um site atribuído a este executor na planilha TSSR TIM Nokia
    if (file.siteId) {
      const cleanSite = file.siteId.trim().toUpperCase();
      const matchedRow = tssrNokiaRows.find(
        (r) => r.siteId && r.siteId.trim().toUpperCase() === cleanSite
      );
      const rowExec = (matchedRow?.fields?.['Executor'] || '').trim().toLowerCase();
      if (myName && rowExec && myName === rowExec) return true;
    }
    return false;
  };

  const canModifyFile = (file: EngineeringFile): boolean => {
    // Gestor da Engenharia (e ADM) tem a opção de apagar QUALQUER arquivo
    if (isGestorEngenharia) return true;
    // O executor pode apagar APENAS os documentos vinculados com o seu nome ("menos as pastas")
    if (isExecutor || isVistoriador) {
      return isFileLinkedToCurrentUser(file);
    }
    return false;
  };

  // Search filter inside Vistorias
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [uploaderFilter, setUploaderFilter] = useState<string>('ALL');

  // Deletion Confirmation Modal state (safe in-app modal)
  const [filePendingDelete, setFilePendingDelete] = useState<EngineeringFile | null>(null);
  const [folderPendingDelete, setFolderPendingDelete] = useState<EngineeringFolder | null>(null);
  const [deletingItem, setDeletingItem] = useState<boolean>(false);

  // Auto-detected executor state for upload routing
  const [autoDetectedExecutor, setAutoDetectedExecutor] = useState<string | null>(null);

  // Create Folder Modal state
  const [newFolderModalOpen, setNewFolderModalOpen] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [newFolderParentId, setNewFolderParentId] = useState<string>('');
  const [newFolderCreatorName, setNewFolderCreatorName] = useState<string>(user.name || '');
  const [newFolderDescription, setNewFolderDescription] = useState<string>('');
  const [newFolderAssignedTo, setNewFolderAssignedTo] = useState<string>('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState<boolean>(false);

  // Liberar Pasta para Executor dentro de TSSR state
  const [liberarPastaModalOpen, setLiberarPastaModalOpen] = useState<boolean>(false);
  const [selectedExecutorForPasta, setSelectedExecutorForPasta] = useState<string>('');
  const [liberandoPasta, setLiberandoPasta] = useState<boolean>(false);
  const [liberandoTodasPastas, setLiberandoTodasPastas] = useState<boolean>(false);

  // All available executors list
  const allAvailableExecutors = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => {
      if (normalizeUserRole(u.role) === 'Executor' && u.name) {
        set.add(u.name.trim());
      }
    });
    tssrNokiaRows.forEach((r) => {
      const ex = (r.fields?.['Executor'] || '').trim();
      if (ex) set.add(ex);
    });
    sites.forEach((s) => {
      const ex = (s.customFields?.['Executor'] || s.responsavelCampo || s.equipeParceira || '').trim();
      if (ex) set.add(ex);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [users, tssrNokiaRows, sites]);

  const handleLiberarPastaExecutor = async () => {
    if (!selectedExecutorForPasta.trim()) return;
    setLiberandoPasta(true);
    try {
      const res = await fetch('/api/engineering/liberar-pasta-executor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor: activeVendor,
          executorName: selectedExecutorForPasta.trim(),
          folderType: activeFolder?.name === 'TSSR Entrada' ? 'TSSR Entrada' : 'TSSR',
          actorName: user.name,
          actorEmail: user.email,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onFoldersAndFilesUpdated(
          data.engineeringFolders,
          data.engineeringFiles,
          `Pasta de TSSR liberada com sucesso para o executor ${selectedExecutorForPasta.trim()}!`
        );
        setLiberarPastaModalOpen(false);
      }
    } finally {
      setLiberandoPasta(false);
    }
  };

  const handleLiberarTodasPastasExecutores = async () => {
    setLiberandoTodasPastas(true);
    try {
      const res = await fetch('/api/engineering/liberar-todas-pastas-executores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor: activeVendor,
          folderType: 'TSSR',
          actorName: user.name,
          actorEmail: user.email,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onFoldersAndFilesUpdated(
          data.engineeringFolders,
          data.engineeringFiles,
          data.message || 'Pastas de TSSR liberadas para todos os executores!'
        );
        setLiberarPastaModalOpen(false);
      }
    } finally {
      setLiberandoTodasPastas(false);
    }
  };

  // Upload File (.zip / .rar / docs) Modal state with mandatory link to TSSR TIM Nokia site
  const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string>('');
  const [uploadedByName, setUploadedByName] = useState<string>(user.name || '');
  const [uploadSiteId, setUploadSiteId] = useState<string>('');
  const [uploadTssrRowId, setUploadTssrRowId] = useState<string>('');
  const [uploadOcSitePre, setUploadOcSitePre] = useState<string>('');
  const [siteSearchQuery, setSiteSearchQuery] = useState<string>('');
  const [siteDropdownOpen, setSiteDropdownOpen] = useState<boolean>(false);
  const [createNewTssrRow, setCreateNewTssrRow] = useState<boolean>(false);
  const [newTssrUf, setNewTssrUf] = useState<string>('');
  const [newTssrCidade, setNewTssrCidade] = useState<string>('');
  const [newTssrEnderecoId, setNewTssrEnderecoId] = useState<string>('');
  const [uploadNotes, setUploadNotes] = useState<string>('');
  const [uploadAssignedTo, setUploadAssignedTo] = useState<string>('');
  const [uploadedFolderName, setUploadedFolderName] = useState<string>('');
  const [pendingFiles, setPendingFiles] = useState<
    Array<{
      fileName: string;
      fileSize: number;
      base64Data: string;
    }>
  >([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Edit Folder Modal state (only for folders the user is allowed to modify)
  const [editingFolder, setEditingFolder] = useState<EngineeringFolder | null>(null);
  const [editFolderName, setEditFolderName] = useState<string>('');
  const [editFolderDescription, setEditFolderDescription] = useState<string>('');
  const [editFolderError, setEditFolderError] = useState<string | null>(null);
  const [savingFolderEdit, setSavingFolderEdit] = useState<boolean>(false);

  // Edit / Modify File Modal state (only for files/packages the user is allowed to modify)
  const [editingFile, setEditingFile] = useState<EngineeringFile | null>(null);
  const [editFileName, setEditFileName] = useState<string>('');
  const [editFileNotes, setEditFileNotes] = useState<string>('');
  const [editFileSiteId, setEditFileSiteId] = useState<string>('');
  const [editFileReplacement, setEditFileReplacement] = useState<{
    fileName: string;
    fileSize: number;
    base64Data: string;
  } | null>(null);
  const [editFileError, setEditFileError] = useState<string | null>(null);
  const [savingFileEdit, setSavingFileEdit] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);

  // Searchable TSSR sites matching siteSearchQuery
  const matchingTssrRows = useMemo(() => {
    const q = siteSearchQuery.trim().toUpperCase();
    if (!q) return tssrNokiaRows.slice(0, 60);
    return tssrNokiaRows
      .filter(
        (r) =>
          r.siteId.toUpperCase().includes(q) ||
          (r.ocSitePre || '').toUpperCase().includes(q) ||
          (r.enderecoId || '').toUpperCase().includes(q) ||
          (r.fields?.['Cidade'] || '').toUpperCase().includes(q)
      )
      .slice(0, 60);
  }, [tssrNokiaRows, siteSearchQuery]);

  const exactTssrMatchExists = useMemo(() => {
    const clean = (uploadSiteId || siteSearchQuery).trim().toUpperCase();
    if (!clean) return false;
    return tssrNokiaRows.some((r) => r.siteId.trim().toUpperCase() === clean);
  }, [tssrNokiaRows, uploadSiteId, siteSearchQuery]);

  // If navigated from TSSR TIM Nokia with a preselectedSiteId, open the upload modal for that site automatically
  React.useEffect(() => {
    if (preselectedSiteId) {
      const clean = preselectedSiteId.trim().toUpperCase();
      const matchedRow = tssrNokiaRows.find((r) => r.siteId.trim().toUpperCase() === clean);
      const siteExec = (matchedRow?.fields?.['Executor'] || '').trim();
      const targetExec = isExecutor
        ? (activeTargetUser.name || user.name || '').trim()
        : siteExec;
      const execFolder = targetExec
        ? findLiberatedFolderForExecutor(allVendorFolders, activeVendor, targetExec)
        : undefined;
      const safeTargetId = execFolder?.id || uploadableFolders[0]?.id || '';

      setAutoDetectedExecutor(targetExec || null);
      setUploadTargetFolderId(safeTargetId);
      setUploadedByName(user.name || '');
      setUploadSiteId(clean);
      setSiteSearchQuery(clean);
      setUploadTssrRowId(matchedRow?.id || '');
      setUploadOcSitePre(matchedRow?.ocSitePre || '');
      setCreateNewTssrRow(!matchedRow);
      setUploadError(null);
      setUploadModalOpen(true);
      onClearPreselectedSiteId?.();
    }
  }, [
    preselectedSiteId,
    tssrNokiaRows,
    uploadableFolders,
    allVendorFolders,
    activeVendor,
    user.name,
    isExecutor,
    activeTargetUser.name,
    onClearPreselectedSiteId,
  ]);

  // Breadcrumb trail from root down to activeFolder
  const breadcrumbs = useMemo(() => {
    const trail: EngineeringFolder[] = [];
    let curr: EngineeringFolder | undefined = activeFolder || undefined;
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      if (isExecutor && (curr.name === 'Vistorias' || curr.id.includes('vistorias'))) {
        break;
      }
      visited.add(curr.id);
      trail.unshift(curr);
      curr = curr.parentId ? vendorFolders.find((f) => f.id === curr!.parentId) : undefined;
    }
    return trail;
  }, [activeFolder, vendorFolders, isExecutor]);

  // Direct child folders of the current folder
  const childFolders = useMemo(() => {
    let list = vendorFolders.filter((f) => f.parentId === effectiveFolderId);

    // If Executor, they ONLY see their liberated folder
    if (isExecutor) {
      const myName = (activeTargetUser.name || user.name || '').trim().toLowerCase();
      list = list.filter((f) => {
        const assigned = (f.assignedTo || '').trim().toLowerCase();
        const fName = f.name.trim().toLowerCase();
        return (assigned && assigned === myName) || fName === myName;
      });
    }

    if (!searchQuery.trim()) return list;
    const q = searchQuery.trim().toLowerCase();
    return list.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.description || '').toLowerCase().includes(q) ||
        (f.assignedTo || '').toLowerCase().includes(q) ||
        f.createdByName.toLowerCase().includes(q)
    );
  }, [
    vendorFolders,
    effectiveFolderId,
    isExecutor,
    activeTargetUser.name,
    user.name,
    searchQuery,
  ]);

  // Direct files in the current folder (only inside subfolders, or when searching, or at root/index for Vistoriador to show all files associated with their responsible sites)
  const displayedFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (isAtRootVistorias && !q && !isVistoriador) {
      return [];
    }
    const base =
      q || (isVistoriador && (isAtRootVistorias || isAtVistoriasExecutadasIndex))
        ? vendorFiles
        : vendorFiles.filter((fl) => fl.folderId === effectiveFolderId);

    return base.filter((fl) => {
      if (uploaderFilter !== 'ALL' && fl.uploadedByName !== uploaderFilter) {
        return false;
      }
      if (!q) return true;
      return (
        fl.fileName.toLowerCase().includes(q) ||
        fl.uploadedByName.toLowerCase().includes(q) ||
        (fl.siteId || '').toLowerCase().includes(q) ||
        (fl.notes || '').toLowerCase().includes(q) ||
        fl.extension.toLowerCase().includes(q)
      );
    });
  }, [
    vendorFiles,
    effectiveFolderId,
    searchQuery,
    uploaderFilter,
    isAtRootVistorias,
    isAtVistoriasExecutadasIndex,
    isVistoriador,
  ]);

  // All unique uploader names for quick filtering
  const uniqueUploaders = useMemo(() => {
    const set = new Set<string>();
    vendorFiles.forEach((f) => {
      if (f.uploadedByName) set.add(f.uploadedByName);
    });
    return Array.from(set).sort();
  }, [vendorFiles]);

  // Recursive count of files and subfolders inside any folder
  const getFolderStats = (folderId: string) => {
    const descendantIds = new Set<string>([folderId]);
    let added = true;
    while (added) {
      added = false;
      for (const f of vendorFolders) {
        if (f.parentId && descendantIds.has(f.parentId) && !descendantIds.has(f.id)) {
          descendantIds.add(f.id);
          added = true;
        }
      }
    }
    const directSubfolders = vendorFolders.filter((f) => f.parentId === folderId).length;
    const totalFiles = vendorFiles.filter((fl) => descendantIds.has(fl.folderId)).length;
    return { directSubfolders, totalFiles };
  };

  // Core main folders inside Vistorias / TSSR for quick access pills
  const mainVistoriasSubfolders = useMemo(() => {
    if (!rootVistoriasFolder) return [];
    if (isExecutor) {
      const myName = (activeTargetUser.name || user.name || '').trim().toLowerCase();
      return vendorFolders.filter(
        (f) =>
          f.parentId === rootVistoriasFolder.id &&
          ((f.assignedTo && f.assignedTo.toLowerCase() === myName) ||
            f.name.toLowerCase() === myName)
      );
    }
    return vendorFolders.filter((f) => f.parentId === rootVistoriasFolder.id);
  }, [vendorFolders, rootVistoriasFolder, isExecutor, activeTargetUser.name, user.name]);

  const openCreateFolderModal = (parentId?: string) => {
    if (isExecutor || isVistoriador) return;
    const targetParent = parentId || effectiveFolderId;
    const parentObj = vendorFolders.find((f) => f.id === targetParent);
    if ((!parentObj || parentObj.parentId === null) && !isAdmin) {
      return;
    }
    setNewFolderParentId(targetParent);
    setNewFolderName('');
    setNewFolderCreatorName(user.name || '');
    setNewFolderDescription('');
    setNewFolderAssignedTo(docResponsavelFilter !== 'ALL' && docResponsavelFilter !== '__NONE__' ? docResponsavelFilter : '');
    setFolderError(null);
    setNewFolderModalOpen(true);
  };

  const openUploadModal = (targetFolderId?: string, preselectedFiles?: FileList | null) => {
    const candidateId = targetFolderId || effectiveFolderId;
    const candidateFolder = vendorFolders.find((f) => f.id === candidateId);

    // If current user is an Executor, auto-route destination directly to their liberated TSSR folder
    let detectedExec = '';
    let safeTargetId =
      candidateFolder && candidateFolder.parentId !== null
        ? candidateFolder.id
        : uploadableFolders[0]?.id || '';

    if (isExecutor) {
      detectedExec = (activeTargetUser.name || user.name || '').trim();
      const myExecFolder = findLiberatedFolderForExecutor(allVendorFolders, activeVendor, detectedExec);
      if (myExecFolder) {
        safeTargetId = myExecFolder.id;
      }
    }

    setAutoDetectedExecutor(detectedExec || null);
    setUploadTargetFolderId(safeTargetId);
    setUploadedByName(user.name || '');
    setUploadSiteId('');
    setUploadTssrRowId('');
    setUploadOcSitePre('');
    setSiteSearchQuery('');
    setCreateNewTssrRow(false);
    setNewTssrUf('');
    setNewTssrCidade('');
    setNewTssrEnderecoId('');
    setUploadedFolderName('');
    setUploadNotes(
      isExecutor
        ? '[TSSR] Enviado pelo Executor para Coordenação de Engenharia'
        : isCoordenadorEngenharia
        ? '[TSSR] Enviado pela Coordenação de Engenharia'
        : ''
    );
    setUploadAssignedTo(
      !isAdmin
        ? activeTargetUser.name
        : docResponsavelFilter !== 'ALL' && docResponsavelFilter !== '__NONE__'
        ? docResponsavelFilter
        : ''
    );
    setUploadError(null);
    setUploadModalOpen(true);
    if (preselectedFiles && preselectedFiles.length > 0) {
      handleReadSelectedFiles(preselectedFiles);
    } else {
      setPendingFiles([]);
    }
  };

  const handleReadSelectedFiles = (fileList: FileList | null, fromDirectoryPicker = false) => {
    if (!fileList || fileList.length === 0) return;
    setUploadError(null);

    const fileArray = Array.from(fileList);
    if (fromDirectoryPicker && fileArray.length > 0) {
      const firstRel = String((fileArray[0] as unknown as { webkitRelativePath?: string }).webkitRelativePath || '');
      const topFolder = firstRel.includes('/') ? firstRel.split('/')[0].trim() : '';
      if (topFolder) {
        setUploadedFolderName(topFolder);
      }
    }

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

  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFolderError(null);

    if (!newFolderName.trim()) {
      setFolderError('Digite o nome da nova pasta.');
      return;
    }

    setCreatingFolder(true);
    try {
      const folderId = `nokia_folder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newFolder: EngineeringFolder = {
        id: folderId,
        name: newFolderName.trim(),
        parentId: newFolderParentId || effectiveFolderId,
        vendor: 'NOKIA',
        description: newFolderDescription.trim(),
        assignedTo: newFolderAssignedTo.trim() || undefined,
        createdByName: user.name,
        createdByEmail: user.email,
        createdByRole: user.role,
        createdAt: new Date().toISOString(),
      };
      await dataService.salvarPastaNokia(newFolder);
      onFoldersAndFilesUpdated(
        [...allVendorFolders, newFolder],
        allVendorFiles,
        `Pasta "${newFolder.name}" criada com sucesso no Firestore (nokia_pastas)`
      );
      setNewFolderModalOpen(false);
      setNewFolderName('');
      setNewFolderDescription('');
    } catch (err: any) {
      console.error(err);
      setFolderError(`Falha ao criar pasta no Firestore [nokia_pastas]: ${err?.message || err}`);
    } finally {
      setCreatingFolder(false);
    }
  };

  // Helper to check if a folder is inside "TSSR Entrada" or "TSSR"
  const isFolderInsideTssrProjects = (folderId: string): boolean => {
    if (isTssrProjectsMode) return true;
    let curr = allVendorFolders.find((f) => f.id === folderId);
    const seen = new Set<string>();
    while (curr && !seen.has(curr.id)) {
      seen.add(curr.id);
      if (curr.name === 'TSSR Entrada' || curr.name === 'TSSR') return true;
      curr = curr.parentId ? allVendorFolders.find((f) => f.id === curr!.parentId) : undefined;
    }
    return false;
  };

  const isUploadTargetTssrProject = useMemo(
    () => isFolderInsideTssrProjects(uploadTargetFolderId || effectiveFolderId),
    [uploadTargetFolderId, effectiveFolderId, allVendorFolders, isTssrProjectsMode]
  );

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);

    if (isVistoriador && isUploadTargetTssrProject) {
      setUploadError(
        'O perfil Vistoriador não tem permissão para subir TSSR. Apenas o Executor e Coordenação de Engenharia podem subir TSSR.'
      );
      return;
    }

    const finalSiteId = (uploadSiteId || '').trim().toUpperCase();
    const requireSiteForThisUpload = !isUploadTargetTssrProject;

    if (requireSiteForThisUpload && !finalSiteId) {
      setUploadError(
        'É obrigatório vincular um site da aba TSSR TIM Nokia (ou confirmar a criação de uma nova linha) antes de enviar o arquivo.'
      );
      return;
    }

    const existsInTssr = finalSiteId
      ? tssrNokiaRows.some((r) => r.siteId.trim().toUpperCase() === finalSiteId)
      : false;
    if (requireSiteForThisUpload && finalSiteId && !existsInTssr && !createNewTssrRow) {
      setUploadError(
        `O site "${finalSiteId}" não existe na aba TSSR TIM Nokia. Clique em "+ Criar nova linha para ${finalSiteId}" abaixo para vinculá-lo.`
      );
      return;
    }

    if (!uploadTargetFolderId) {
      setUploadError('Selecione uma pasta válida para carregar os arquivos.');
      return;
    }
    if (pendingFiles.length === 0) {
      setUploadError('Selecione pelo menos um arquivo (.ZIP, WinRAR .RAR ou documento).');
      return;
    }

    setUploading(true);
    try {
      const res = await fetch('/api/engineering/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: uploadTargetFolderId,
          vendor: activeVendor,
          uploadedByName: (user?.name || user?.email || 'Usuário').trim(),
          uploadedByEmail: (user?.email || '').trim(),
          uploadedByRole: currentRole,
          siteId: finalSiteId || undefined,
          ocSitePre: uploadOcSitePre.trim() || undefined,
          tssrRowId: uploadTssrRowId || undefined,
          createNewTssrRow,
          requireSiteLink: requireSiteForThisUpload,
          updateTssrVistoria: requireSiteForThisUpload,
          newTssrFields: createNewTssrRow
            ? {
                'Site Id': finalSiteId,
                'Oc Site Pre': uploadOcSitePre.trim(),
                Enderecoid: newTssrEnderecoId.trim(),
                UF: newTssrUf.trim().toUpperCase(),
                Cidade: newTssrCidade.trim(),
              }
            : undefined,
          notes: uploadNotes.trim() || undefined,
          assignedTo: uploadAssignedTo.trim() || undefined,
          uploadedFolderName: uploadedFolderName.trim() || undefined,
          files: pendingFiles,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || 'Erro ao carregar arquivos.');
        return;
      }

      if (Array.isArray(data.engineeringFolders) && Array.isArray(data.engineeringFiles)) {
        const targetFolderName =
          uploadedFolderName.trim() ||
          allVendorFolders.find((f) => f.id === uploadTargetFolderId)?.name ||
          'Pasta';
        onFoldersAndFilesUpdated(
          data.engineeringFolders,
          data.engineeringFiles,
          requireSiteForThisUpload
            ? isExecutor
              ? `Vistoria do site ${finalSiteId} entregue pelo Executor! STATUS Engenharia atualizado para "TSSR Aguardando aprovação".`
              : `Vistoria do site ${finalSiteId} entregue por ${user.name}! Status atualizado para "Entregue" na aba TSSR TIM Nokia.`
            : `${pendingFiles.length} arquivo(s) carregado(s) com sucesso em "${targetFolderName}" por ${user.name}!`,
          data.tssrRows,
          data.tssrSheets,
          data.sites
        );
      }
      setCurrentFolderId(data.targetFolderId || uploadTargetFolderId);
      setUploadModalOpen(false);
      setPendingFiles([]);
      setUploadedFolderName('');
    } catch {
      setUploadError('Erro de rede ao transferir arquivos.');
    } finally {
      setUploading(false);
    }
  };

  const openEditFolderModal = (folder: EngineeringFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canModifyFolder(folder)) return;
    setEditingFolder(folder);
    setEditFolderName(folder.name);
    setEditFolderDescription(folder.description || '');
    setEditFolderError(null);
  };

  const handleEditFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFolder) return;
    setEditFolderError(null);
    if (!editFolderName.trim()) {
      setEditFolderError('Informe o nome da pasta.');
      return;
    }
    setSavingFolderEdit(true);
    try {
      const res = await fetch(`/api/engineering/folders/${encodeURIComponent(editingFolder.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editFolderName.trim(),
          description: editFolderDescription.trim(),
          actorName: activeTargetUser.name,
          actorEmail: activeTargetUser.email,
          actorRole: currentRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditFolderError(data.error || 'Não foi possível modificar a pasta.');
        return;
      }
      if (Array.isArray(data.engineeringFolders)) {
        onFoldersAndFilesUpdated(
          data.engineeringFolders,
          data.engineeringFiles || files,
          `Pasta "${editFolderName.trim()}" modificada com sucesso!`
        );
      }
      setEditingFolder(null);
    } catch {
      setEditFolderError('Falha de conexão ao modificar pasta.');
    } finally {
      setSavingFolderEdit(false);
    }
  };

  const openEditFileModal = (file: EngineeringFile) => {
    if (!canModifyFile(file)) return;
    setEditingFile(file);
    setEditFileName(file.fileName);
    setEditFileNotes(file.notes || '');
    setEditFileSiteId(file.siteId || '');
    setEditFileReplacement(null);
    setEditFileError(null);
  };

  const handleEditFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFile) return;
    setEditFileError(null);
    if (!editFileName.trim() && !editFileReplacement) {
      setEditFileError('Informe o nome do arquivo ou selecione um novo arquivo.');
      return;
    }
    setSavingFileEdit(true);
    try {
      const res = await fetch(`/api/engineering/files/${encodeURIComponent(editingFile.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: editFileReplacement ? editFileReplacement.fileName : editFileName.trim(),
          fileSize: editFileReplacement ? editFileReplacement.fileSize : undefined,
          base64Data: editFileReplacement ? editFileReplacement.base64Data : undefined,
          notes: editFileNotes.trim(),
          siteId: editFileSiteId.trim().toUpperCase(),
          actorName: activeTargetUser.name,
          actorEmail: activeTargetUser.email,
          actorRole: currentRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditFileError(data.error || 'Não foi possível modificar o arquivo.');
        return;
      }
      if (Array.isArray(data.engineeringFiles)) {
        onFoldersAndFilesUpdated(
          data.engineeringFolders || folders,
          data.engineeringFiles,
          `Arquivo "${data.file?.fileName || editFileName.trim()}" modificado com sucesso!`
        );
      }
      setEditingFile(null);
      setEditFileReplacement(null);
    } catch {
      setEditFileError('Falha de conexão ao modificar arquivo.');
    } finally {
      setSavingFileEdit(false);
    }
  };

  const handleDeleteFolder = (folder: EngineeringFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canModifyFolder(folder)) return;
    setFolderPendingDelete(folder);
  };

  const confirmDeleteFolder = async () => {
    if (!folderPendingDelete) return;
    setDeletingItem(true);
    try {
      await dataService.excluirPastaNokia(folderPendingDelete.id);
      onFoldersAndFilesUpdated(
        allVendorFolders.filter((f) => f.id !== folderPendingDelete.id),
        allVendorFiles,
        `Pasta "${folderPendingDelete.name}" removida com sucesso do Firestore (nokia_pastas)`
      );
      if (currentFolderId === folderPendingDelete.id && folderPendingDelete.parentId) {
        setCurrentFolderId(folderPendingDelete.parentId);
      }
      setFolderPendingDelete(null);
    } catch (err: any) {
      console.error(err);
      setFolderError(`Falha ao excluir pasta do Firestore [nokia_pastas]: ${err?.message || err}`);
    } finally {
      setDeletingItem(false);
    }
  };

  const handleDeleteFile = (file: EngineeringFile) => {
    if (!canModifyFile(file)) return;
    setFilePendingDelete(file);
  };

  const confirmDeleteFile = async () => {
    if (!filePendingDelete) return;
    setDeletingItem(true);
    try {
      const q = new URLSearchParams({
        actorEmail: activeTargetUser.email || '',
        actorName: activeTargetUser.name || '',
        actorRole: currentRole,
      });
      const res = await fetch(
        `/api/engineering/files/${encodeURIComponent(filePendingDelete.id)}?${q.toString()}`,
        {
          method: 'DELETE',
        }
      );
      if (res.ok) {
        const data = await res.json();
        onFoldersAndFilesUpdated(
          data.engineeringFolders,
          data.engineeringFiles,
          `Arquivo "${filePendingDelete.fileName}" removido com sucesso`,
          data.tssrRows
        );
        setFilePendingDelete(null);
      }
    } catch {
      // ignore error
    } finally {
      setDeletingItem(false);
    }
  };

  const handleAssignFileResponsible = async (file: EngineeringFile, nextResponsible: string) => {
    try {
      const res = await fetch(`/api/engineering/files/${encodeURIComponent(file.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: nextResponsible }),
      });
      if (res.ok) {
        const data = await res.json();
        onFoldersAndFilesUpdated(
          data.engineeringFolders,
          data.engineeringFiles,
          nextResponsible
            ? `Documento "${file.fileName}" atribuído para ${nextResponsible}`
            : `Documento "${file.fileName}" removido da demanda individual`
        );
      }
    } catch {
      // ignore error
    }
  };

  const renderFileTypeIcon = (file: EngineeringFile) => {
    if (file.fileType === 'zip') {
      return (
        <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
          <FileArchive className="w-4 h-4" />
        </div>
      );
    }
    if (file.fileType === 'rar' || file.fileType === '7z') {
      return (
        <div className="w-9 h-9 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 shrink-0">
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

  const renderFormatBadge = (file: EngineeringFile) => {
    const extUpper = file.extension.replace('.', '').toUpperCase() || 'DOC';
    if (file.fileType === 'zip') {
      return (
        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-mono text-[10px] font-bold">
          ZIP
        </span>
      );
    }
    if (file.fileType === 'rar') {
      return (
        <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-mono text-[10px] font-bold">
          WinRAR (.RAR)
        </span>
      );
    }
    if (file.fileType === '7z') {
      return (
        <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-mono text-[10px] font-bold">
          {extUpper}
        </span>
      );
    }
    if (file.fileType === 'excel') {
      return (
        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono text-[10px] font-bold">
          {extUpper}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px] font-bold">
        {extUpper}
      </span>
    );
  };

  const getFolderPathLabel = (folderId: string): string => {
    const parts: string[] = [];
    let curr = vendorFolders.find((f) => f.id === folderId);
    const seen = new Set<string>();
    while (curr && !seen.has(curr.id)) {
      seen.add(curr.id);
      parts.unshift(curr.name);
      curr = curr.parentId ? vendorFolders.find((f) => f.id === curr!.parentId) : undefined;
    }
    return parts.join(' / ');
  };

  return (
    <div className="space-y-4">
      {/* =====================================================================
          VISTORIADOR SITE-ASSOCIATED FILES NOTIFICATION BANNER
         ===================================================================== */}
      {isVistoriador && (
        <div
          className={`rounded-xl p-4 border shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs ${
            vendorFiles.length > 0
              ? 'bg-teal-50/90 border-teal-300 text-teal-950'
              : 'bg-slate-50 border-slate-200 text-slate-700'
          }`}
        >
          <div className="flex items-start sm:items-center gap-3">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                vendorFiles.length > 0
                  ? 'bg-teal-600 text-white border-teal-700'
                  : 'bg-white text-slate-500 border-slate-200'
              }`}
            >
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <div className="font-bold text-xs flex items-center gap-2 flex-wrap">
                <span>
                  {vendorFiles.length > 0
                    ? `Notificação de Vistoria: Você possui ${vendorFiles.length} arquivo(s) associado(s) ao(s) site(s) sob sua responsabilidade!`
                    : 'Filtro de Vistoriador Ativo: Exibindo apenas arquivos associados aos sites sob sua responsabilidade'}
                </span>
                <span className="px-2 py-0.5 rounded bg-white/80 border border-teal-200 text-[10px] font-mono font-bold text-teal-900">
                  {responsibleSites.length} site(s) sob sua responsabilidade
                </span>
              </div>
              <p className="text-[11px] opacity-85 mt-0.5">
                {vendorFiles.length > 0 ? (
                  <>
                    Sites com arquivos associados:{' '}
                    <strong className="font-mono">
                      {Array.from(
                        new Set(
                          vendorFiles
                            .map((f) => (f.siteId || '').trim().toUpperCase())
                            .filter(Boolean)
                        )
                      ).join(', ') || 'Seus sites'}
                    </strong>
                    . Você pode visualizar, baixar ou subir novos pacotes, e só pode excluir pastas/arquivos enviados por você.
                  </>
                ) : (
                  <>
                    No momento não há arquivos carregados para os{' '}
                    <strong>{responsibleSites.length}</strong> site(s) atribuídos a{' '}
                    <strong>{activeTargetUser.equipe || activeTargetUser.name}</strong>. Você só verá arquivos que estiverem associados aos sites que você está responsável por fazer.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TOP HEADER CARD: PASTA VISTORIAS (ENGENHARIA) + QUICK CATEGORY TABS
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-500 shrink-0">
              <FolderOpen className="w-6 h-6 fill-amber-400/80 text-amber-600" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
                  {isExecutor
                    ? `TSSR · ${activeVendor}`
                    : isTssrProjectsMode
                    ? `Engenharia · Pastas de Projetos · ${activeVendor}`
                    : `Vistoria · ${activeVendor}`}
                </span>
                <span className="text-slate-300">•</span>
                <h1 className="text-base font-bold text-slate-900">
                  {isExecutor
                    ? `Repositório de TSSR da Engenharia — ${
                        activeFolder?.name === 'TSSR' || isAtRootVistorias
                          ? 'Pastas de TSSR'
                          : activeFolder?.name
                      }`
                    : isTssrProjectsMode
                    ? isAtRootVistorias
                      ? 'Pastas de Projetos TSSR & TSSR de Entrada'
                      : `Pasta ${activeFolder?.name}`
                    : `Envio de Vistoria (Vínculo com TSSR TIM Nokia) — ${
                        isAtRootVistorias ? 'Pastas de Vistoria' : activeFolder?.name
                      }`}
                </h1>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isExecutor ? (
                  <>
                    Acesse sua pasta de TSSR liberada e suba os pacotes e documentos TSSR diretamente para a Engenharia.
                  </>
                ) : isTssrProjectsMode ? (
                  <>
                    Carregamento e organização de pacotes de projetos <strong>TSSR Entrada</strong> e{' '}
                    <strong>TSSR</strong> (.ZIP, WinRAR .RAR, planilhas, PDFs, croquis e documentos).
                  </>
                ) : (
                  <>
                    Suba o arquivo da vistoria direto no site e vincule a um site da aba{' '}
                    <strong>TSSR TIM Nokia</strong>. O status muda sozinho para{' '}
                    <strong className="text-emerald-700">Entregue</strong> com link, data/hora e vistoriador.
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="w-full sm:w-auto flex flex-wrap items-center gap-2">
            {onBackToEngineeringControl && (
              <button
                type="button"
                onClick={onBackToEngineeringControl}
                className="w-full sm:w-auto justify-center px-3.5 py-2.5 sm:py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 shrink-0" />
                <span>Voltar para Controle de Engenharia (Planilha)</span>
              </button>
            )}

            {!isTssrProjectsMode && !isVistoriador && onOpenTssrTab && (
              <button
                type="button"
                onClick={onOpenTssrTab}
                className="w-full sm:w-auto justify-center px-3.5 py-2.5 sm:py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-[#223585] shrink-0" />
                <span>Ver Planilha TSSR TIM Nokia</span>
              </button>
            )}

            {!isAtRootVistorias && canCreateFolders && (
              <button
                type="button"
                onClick={() => openCreateFolderModal(effectiveFolderId)}
                className="w-full sm:w-auto justify-center px-3.5 py-2.5 sm:py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <FolderPlus className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Nova Subpasta</span>
              </button>
            )}

            {(isAdmin || isCoordenadorEngenharia) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedExecutorForPasta('');
                  setLiberarPastaModalOpen(true);
                }}
                className="w-full sm:w-auto justify-center px-3.5 py-2.5 sm:py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                title="Criar e liberar uma pasta dedicada para um Executor dentro de TSSR"
              >
                <UserCheck className="w-4 h-4 text-emerald-200 shrink-0" />
                <span>+ Liberar Pasta para Executor</span>
              </button>
            )}

            {canUploadTssr && (
              <button
                type="button"
                onClick={() => {
                  const tssrFolder =
                    allVendorFolders.find((f) => f.name === 'TSSR') ||
                    allVendorFolders.find((f) => f.name === 'TSSR Entrada') ||
                    uploadableFolders[0];
                  let targetFolder = tssrFolder?.id;
                  if (isExecutor) {
                    const myName = (activeTargetUser.name || user.name || '').trim().toLowerCase();
                    const myFolder = allVendorFolders.find(
                      (f) =>
                        (f.parentId === tssrFolder?.id || f.parentId?.includes('tssr')) &&
                        ((f.assignedTo && f.assignedTo.toLowerCase() === myName) ||
                          f.name.toLowerCase() === myName)
                    );
                    if (myFolder) targetFolder = myFolder.id;
                  }
                  openUploadModal(targetFolder || effectiveFolderId);
                  setUploadNotes(
                    isExecutor
                      ? '[TSSR] Enviado pelo Executor para Coordenação de Engenharia'
                      : '[TSSR] Enviado pela Coordenação de Engenharia'
                  );
                }}
                className="w-full sm:w-auto justify-center px-4 py-3.5 sm:py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-black uppercase tracking-wide rounded-xl sm:rounded-lg transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>Subir TSSR (Engenharia)</span>
              </button>
            )}

            {canUploadVistoria && (
              <button
                type="button"
                onClick={() => openUploadModal(effectiveFolderId)}
                className="w-full sm:w-auto justify-center px-4 py-3.5 sm:py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-wide rounded-xl sm:rounded-lg transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>
                  {isTssrProjectsMode
                    ? 'Carregar Arquivo TSSR (.ZIP / .RAR / Docs)'
                    : 'Subir Arquivo de Vistoria (Vincular ao Site)'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Quick Navigation Bar for Main Folders */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {rootVistoriasFolder && (
              <button
                type="button"
                onClick={() => setCurrentFolderId(rootVistoriasFolder.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 border transition-all cursor-pointer ${
                  effectiveFolderId === rootVistoriasFolder.id
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                <Folder className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                <span>
                  {isExecutor
                    ? 'Pasta TSSR'
                    : isTssrProjectsMode
                    ? 'Todas as Pastas TSSR'
                    : 'Pasta Vistorias'}
                </span>
              </button>
            )}

            {mainVistoriasSubfolders.map((mainSub) => {
              const stats = getFolderStats(mainSub.id);
              const isInsideThisMain =
                effectiveFolderId === mainSub.id ||
                breadcrumbs.some((b) => b.id === mainSub.id);
              return (
                <button
                  key={mainSub.id}
                  type="button"
                  onClick={() => setCurrentFolderId(mainSub.id)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 border transition-all cursor-pointer ${
                    isInsideThisMain
                      ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                      : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  <Folder
                    className={`w-3.5 h-3.5 ${
                      isInsideThisMain
                        ? 'text-amber-300 fill-amber-300'
                        : 'text-amber-500 fill-amber-400'
                    }`}
                  />
                  <span>{mainSub.name}</span>
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      isInsideThisMain ? 'text-blue-100' : 'text-slate-400'
                    }`}
                  >
                    ({stats.directSubfolders} pastas · {stats.totalFiles} arq)
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search & Uploader Filter + Hidden Tab Button for ADM */}
          <div className="w-full sm:w-auto flex flex-wrap items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsDocDemandaTabOpen((prev) => !prev)}
                className={`w-full sm:w-auto justify-center px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  isDocDemandaTabOpen || docResponsavelFilter !== 'ALL'
                    ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800'
                }`}
                title="Clique para abrir ou fechar a aba escondida de Demanda por Responsável (Documentos)"
              >
                <UserCheck className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  Demanda por Responsável
                  {docResponsavelFilter !== 'ALL'
                    ? `: ${docResponsavelFilter === '__NONE__' ? 'Sem Responsável' : docResponsavelFilter}`
                    : ''}
                </span>
                {isDocDemandaTabOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                )}
              </button>
            )}

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar pasta, arquivo .zip/.rar, Site ID..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600"
              />
            </div>

            {!isAtRootVistorias && (
              <select
                value={uploaderFilter}
                onChange={(e) => setUploaderFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-blue-600"
              >
                <option value="ALL">Carregado por: Todos ({uniqueUploaders.length})</option>
                {uniqueUploaders.map((uName) => (
                  <option key={uName} value={uName}>
                    {uName}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* ===================================================================
            HIDDEN TAB (ABA ESCONDIDA - SÓ ABRE SE CLICAR):
            DEMANDA POR RESPONSÁVEL EM DOCUMENTOS
           =================================================================== */}
        {isAdmin && isDocDemandaTabOpen && (
          <div className="mt-3 p-4 bg-slate-50 border border-blue-200 rounded-xl space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-blue-600" />
                <div>
                  <h3 className="text-xs font-bold text-slate-900">
                    Aba de Demanda por Responsável — Documentos ({activeVendor})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Escolha um usuário abaixo para filtrar ou atribua documentos para que apareçam somente para ele.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {onToggleSimulateUser && (
                  <button
                    type="button"
                    onClick={() => {
                      const testUsr =
                        assignableUsers.find((u) => u.name.toLowerCase().includes('teste')) ||
                        assignableUsers[0];
                      if (testUsr) {
                        onToggleSimulateUser(testUsr);
                      }
                    }}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Ver Tela como Usuário Teste</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsDocDemandaTabOpen(false)}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Fechar Aba</span>
                </button>
              </div>
            </div>

            {/* Filter by User Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-600 mr-1">
                Filtrar documentos por responsável:
              </span>
              <button
                type="button"
                onClick={() => setDocResponsavelFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  docResponsavelFilter === 'ALL'
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                Todos ({allVendorFiles.length})
              </button>

              {assignableUsers.map((u) => {
                const count = allVendorFiles.filter((fl) => {
                  const folder = allVendorFolders.find((f) => f.id === fl.folderId);
                  return doesDocumentMatchResponsible(fl, folder, u);
                }).length;
                const active = docResponsavelFilter === u.name;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() =>
                      setDocResponsavelFilter((prev) => (prev === u.name ? 'ALL' : u.name))
                    }
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                        : 'bg-white hover:bg-blue-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <span>{u.name}</span>
                    <span
                      className={`ml-1.5 font-mono text-[10px] tabular-nums ${
                        active ? 'text-blue-100' : 'text-slate-400'
                      }`}
                    >
                      ({count} doc{count !== 1 ? 's' : ''})
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() =>
                  setDocResponsavelFilter((prev) => (prev === '__NONE__' ? 'ALL' : '__NONE__'))
                }
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  docResponsavelFilter === '__NONE__'
                    ? 'bg-slate-700 border-slate-700 text-white'
                    : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-600'
                }`}
              >
                Sem Responsável ({allVendorFiles.filter((fl) => !fl.assignedTo?.trim()).length})
              </button>
            </div>

            {/* Direct Document Assignment List inside the Hidden Tab */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-[11px] font-bold text-slate-700">
                <span>
                  Documentos Cadastrados em {activeVendor} — Selecione para qual usuário o documento vai aparecer:
                </span>
                <span className="font-mono text-slate-500">
                  {allVendorFiles.length} documento(s)
                </span>
              </div>
              {allVendorFiles.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  Nenhum documento carregado neste fabricante ainda. Entre em uma pasta abaixo e clique em "Carregar Arquivo".
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                  {allVendorFiles.map((file) => (
                    <div
                      key={file.id}
                      className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {renderFormatBadge(file)}
                        <span className="font-semibold text-slate-900 truncate">
                          {file.fileName}
                        </span>
                        {file.siteId && (
                          <span className="font-mono text-[11px] text-blue-600 font-bold">
                            [{file.siteId}]
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400 truncate">
                          ({getFolderPathLabel(file.folderId)})
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-slate-500">Aparecer para:</span>
                        <select
                          value={file.assignedTo || ''}
                          onChange={(e) => handleAssignFileResponsible(file, e.target.value)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer focus:outline-none ${
                            file.assignedTo
                              ? 'bg-blue-50 border-blue-300 text-blue-800'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          <option value="">— Apenas ADM (Nenhum usuário) —</option>
                          {assignableUsers.map((u) => (
                            <option key={u.id} value={u.name}>
                              {u.name} ({u.email})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* =====================================================================
          EXPLORER CONTAINER:
          - AT ROOT VISTORIAS ("FORA"): ONLY SHOWS THE FOLDERS (NO UPLOAD AREA)
          - INSIDE ANY FOLDER ("DENTRO"): SHOWS SUBFOLDERS + UPLOAD AREA & FILES
         ===================================================================== */}
      <div
        onDragOver={(e) => {
          if (isAtRootVistorias) return;
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={(e) => {
          if (isAtRootVistorias) return;
          e.preventDefault();
          setIsDraggingOver(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            openUploadModal(effectiveFolderId, e.dataTransfer.files);
          }
        }}
        className={`bg-white border rounded-xl shadow-2xs overflow-hidden transition-colors ${
          isDraggingOver && !isAtRootVistorias
            ? 'border-blue-600 bg-blue-50/20'
            : 'border-slate-200'
        }`}
      >
        {/* Breadcrumb Bar */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            {activeFolder && activeFolder.parentId && (
              <button
                type="button"
                onClick={() => setCurrentFolderId(activeFolder.parentId!)}
                className="mr-1.5 px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-md text-slate-700 font-medium flex items-center gap-1 cursor-pointer"
                title="Voltar para pasta anterior"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar</span>
              </button>
            )}

            <span className="text-slate-400 font-medium">
              {isExecutor || isTssrProjectsMode ? 'Engenharia · TSSR' : 'Pasta Vistoria'}
            </span>
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.id}>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => setCurrentFolderId(crumb.id)}
                    className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                      isLast
                        ? 'bg-blue-50 text-blue-700 font-bold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 font-medium'
                    }`}
                  >
                    <Folder className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                    <span>{crumb.name}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          <div className="text-[11px] text-slate-500 flex items-center gap-3">
            <span>
              <strong>{childFolders.length}</strong> pastas neste nível
            </span>
            {!isAtRootVistorias && (
              <>
                <span>•</span>
                <span>
                  <strong>{displayedFiles.length}</strong> arquivos nesta pasta
                </span>
              </>
            )}
          </div>
        </div>

        {/* Subfolders List */}
        {childFolders.length > 0 && (
          <div
            className={`divide-y divide-slate-200/80 ${
              displayedFiles.length > 0 ? 'border-b border-slate-200' : ''
            }`}
          >
            <div className="px-5 py-2 bg-slate-100/70 text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
              <span>
                {isExecutor
                  ? `Pastas de TSSR (${activeFolder?.name || 'TSSR'})`
                  : isAtRootVistorias
                  ? 'Pastas Principais em Vistorias'
                  : `Pastas em ${activeFolder?.name}`}
              </span>

              {(!isAtRootVistorias || isAdmin) && canCreateFolders && (
                <button
                  type="button"
                  onClick={() => openCreateFolderModal(effectiveFolderId)}
                  className="text-blue-600 hover:text-blue-700 font-semibold normal-case flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {isAtRootVistorias ? 'Nova Pasta Principal (ADM)' : 'Criar pasta aqui'}
                  </span>
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-100">
              {childFolders.map((sub) => {
                const stats = getFolderStats(sub.id);
                const canModifySub = canModifyFolder(sub);
                const isOwnSub = isFolderUploadedByCurrentUser(sub);

                return (
                  <div
                    key={sub.id}
                    onClick={() => setCurrentFolderId(sub.id)}
                    className="px-5 py-3.5 bg-white hover:bg-blue-50/50 transition-colors flex items-center justify-between gap-4 cursor-pointer group"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      {/* Yellow Shared Folder Icon matching Screenshot 2 */}
                      <div className="relative w-8 h-8 flex items-center justify-center shrink-0">
                        <Folder className="w-7 h-7 text-amber-500 fill-amber-400 group-hover:scale-105 transition-transform" />
                        <Users className="w-3 h-3 text-slate-800 absolute bottom-1.5 right-1.5" />
                      </div>

                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors flex items-center gap-2 flex-wrap">
                          <span>{sub.name}</span>
                          {sub.isSystem && (
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-blue-50 text-blue-700 rounded border border-blue-200">
                              Pasta Principal
                            </span>
                          )}
                          {sub.assignedTo && (
                            <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-800 rounded border border-emerald-300 inline-flex items-center gap-1">
                              <UserCheck className="w-3 h-3 text-emerald-600" />
                              <span>Liberada para: {sub.assignedTo}</span>
                            </span>
                          )}
                          {isExecutor && (
                            <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 rounded border border-slate-200 inline-flex items-center gap-1" title="O executor não pode excluir pastas do sistema">
                              <Lock className="w-2.5 h-2.5" />
                              <span>Pasta Fixa</span>
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-3 mt-0.5">
                          {sub.description && <span className="truncate">{sub.description}</span>}
                          <span>
                            Enviada/Criada por: <strong className="text-slate-700">{sub.createdByName}</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right hidden sm:block mr-1">
                        <div className="text-xs font-mono font-semibold text-slate-700 tabular-nums">
                          {stats.totalFiles} arquivo(s)
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                          {stats.directSubfolders} subpasta(s)
                        </div>
                      </div>

                      {canModifySub && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => openEditFolderModal(sub, e)}
                            className="px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer"
                            title="Modificar pasta enviada"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Modificar</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteFolder(sub, e)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Excluir pasta"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}

                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 group-hover:translate-x-0.5 transition-transform">
                        <span className="hidden md:inline">Abrir Pasta</span>
                        <ChevronRight className="w-4 h-4" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty State / Direct Upload Area inside Uploadable Folders (e.g. TSSR Entrada, TSSR, or Subfolders) when 0 files */}
        {!isFolderOnlyLevel && displayedFiles.length === 0 && (
          <div className="p-8 bg-white text-center space-y-4">
            <div
              onClick={() => openUploadModal(effectiveFolderId)}
              className="max-w-xl mx-auto border-2 border-dashed border-slate-300 hover:border-blue-600 bg-slate-50/70 hover:bg-blue-50/30 rounded-2xl p-7 transition-all cursor-pointer space-y-3"
            >
              <div className="w-12 h-12 rounded-2xl bg-blue-100/80 border border-blue-200 text-blue-600 flex items-center justify-center mx-auto">
                <Upload className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">
                  Pasta "{activeFolder?.name}" pronta para receber documentos e projetos
                </h3>
                <p className="text-xs text-slate-500">
                  Arraste pacotes <strong>.ZIP</strong>, <strong>WinRAR (.RAR)</strong>, planilhas{' '}
                  <strong>.XLSX</strong>, <strong>.PDF</strong> ou documentos para cá, ou clique nos botões abaixo.
                </p>
              </div>
              <div
                className="pt-2 flex flex-wrap items-center justify-center gap-2.5"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => openUploadModal(effectiveFolderId)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-2xs flex items-center gap-2 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {isExecutor
                      ? 'Subir Pasta / TSSR (.ZIP / .RAR / Docs)'
                      : 'Carregar Arquivo (.ZIP / .RAR / Docs)'}
                  </span>
                </button>
                {canCreateFolders && (
                  <button
                    type="button"
                    onClick={() => openCreateFolderModal(effectiveFolderId)}
                    className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <FolderPlus className="w-4 h-4 text-amber-500" />
                    <span>+ Criar Subpasta em {activeFolder?.name}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Files Table: ONLY rendered when there are actual uploaded files in this folder */}
        {!isFolderOnlyLevel && displayedFiles.length > 0 && (
          <div>
            <div className="px-5 py-2.5 bg-slate-100/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <span>
                Documentos e Projetos Carregados em {activeFolder?.name} ({displayedFiles.length})
              </span>
              <div className="flex items-center gap-3 normal-case">
                {canCreateFolders && (
                  <button
                    type="button"
                    onClick={() => openCreateFolderModal(effectiveFolderId)}
                    className="text-slate-700 hover:text-blue-600 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-amber-600" />
                    <span>+ Nova Subpasta</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openUploadModal(effectiveFolderId)}
                  className="text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isExecutor ? '+ Subir Pasta / TSSR Aqui' : '+ Carregar Arquivo Aqui'}</span>
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                    <tr className="whitespace-nowrap">
                      <th className="py-2.5 px-5">Arquivo / Pacote</th>
                      <th className="py-2.5 px-4">Formato</th>
                      <th className="py-2.5 px-4">Pasta</th>
                      <th className="py-2.5 px-4">Site ID Vinculado</th>
                      <th className="py-2.5 px-4">Responsável (Demanda)</th>
                      <th className="py-2.5 px-4">Carregado Por</th>
                      <th className="py-2.5 px-4">Data / Hora</th>
                      <th className="py-2.5 px-4">Tamanho</th>
                      <th className="py-2.5 px-5 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {displayedFiles.map((file) => {
                      const matchedSite = file.siteId
                        ? sites.find(
                            (s) => s.siteId.toUpperCase() === file.siteId!.toUpperCase()
                          )
                        : null;

                      return (
                        <tr
                          key={file.id}
                          className="hover:bg-blue-50/40 transition-colors whitespace-nowrap"
                        >
                          <td className="py-3 px-5">
                            <div className="flex items-center gap-3">
                              {renderFileTypeIcon(file)}
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-900 truncate max-w-[340px]">
                                  {file.fileName}
                                </div>
                                {file.notes && (
                                  <div className="text-[11px] text-slate-500 truncate max-w-[340px]">
                                    {file.notes}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4">{renderFormatBadge(file)}</td>

                          <td className="py-3 px-4 text-slate-600">
                            <button
                              type="button"
                              onClick={() => setCurrentFolderId(file.folderId)}
                              className="hover:text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <Folder className="w-3.5 h-3.5 text-amber-500 fill-amber-400 shrink-0" />
                              <span className="truncate max-w-[200px]">
                                {getFolderPathLabel(file.folderId)}
                              </span>
                            </button>
                          </td>

                          <td className="py-3 px-4">
                            {file.siteId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  if (matchedSite) {
                                    onSelectSiteId(matchedSite.id);
                                  }
                                }}
                                className="inline-flex items-center gap-1 font-mono font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                                title={
                                  matchedSite
                                    ? 'Clique para abrir a ficha popup deste Site'
                                    : file.siteId
                                }
                              >
                                <span>{file.siteId}</span>
                                {matchedSite && <ExternalLink className="w-3 h-3" />}
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            {isAdmin ? (
                              <select
                                value={file.assignedTo || ''}
                                onChange={(e) => handleAssignFileResponsible(file, e.target.value)}
                                className={`px-2.5 py-1 rounded-md text-xs font-semibold border cursor-pointer focus:outline-none ${
                                  file.assignedTo
                                    ? 'bg-blue-50 border-blue-300 text-blue-800'
                                    : 'bg-slate-50 border-slate-200 text-slate-500'
                                }`}
                              >
                                <option value="">— Apenas ADM —</option>
                                {assignableUsers.map((u) => (
                                  <option key={u.id} value={u.name}>
                                    {u.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 font-semibold text-[11px]">
                                <UserCheck className="w-3 h-3" />
                                <span>{file.assignedTo || activeTargetUser.name}</span>
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200/70">
                              <UserCheck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              <div>
                                <div className="font-bold text-slate-900 leading-tight">
                                  {file.uploadedByName}
                                </div>
                                <div className="text-[10px] text-slate-500 leading-tight">
                                  {file.uploadedByEmail}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4 font-mono text-slate-600 tabular-nums">
                            <span className="inline-flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              <span>{formatDateTime(file.uploadedAt)}</span>
                            </span>
                          </td>

                          <td className="py-3 px-4 font-mono text-slate-600 tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                              <span>{formatBytes(file.fileSize)}</span>
                            </span>
                          </td>

                          <td className="py-3 px-5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <a
                                href={`/api/engineering/files/${encodeURIComponent(file.id)}/view`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg transition-colors inline-flex items-center gap-1"
                                title="Abrir arquivo em nova guia"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>Abrir</span>
                              </a>

                              <a
                                href={`/api/engineering/files/${encodeURIComponent(file.id)}/download`}
                                download={file.fileName}
                                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Baixar</span>
                              </a>

                              {canModifyFile(file) ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEditFileModal(file)}
                                    className="px-2.5 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 font-semibold rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer"
                                    title="Modificar arquivo / pacote enviado por você"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                    <span>Modificar</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleDeleteFile(file)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                    title="Remover arquivo"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </>
                              ) : (
                                <span
                                  className="px-2 py-1 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold inline-flex items-center gap-1"
                                  title="Você só pode modificar pastas e arquivos que você mesmo subiu para o sistema"
                                >
                                  <Lock className="w-3 h-3" />
                                  <span>Somente Leitura</span>
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
          </div>
        )}
      </div>

      {/* =====================================================================
          MODAL 1: CRIAR NOVA PASTA
         ===================================================================== */}
      {newFolderModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setNewFolderModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FolderPlus className="w-5 h-5 text-amber-500" />
                <h3 className="text-sm font-bold text-slate-900">
                  Criar Nova Pasta
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setNewFolderModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFolderSubmit} className="p-5 space-y-4">
              {folderError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{folderError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pasta Pai (Local onde será criada)
                </label>
                <select
                  value={newFolderParentId}
                  onChange={(e) => setNewFolderParentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                >
                  {creatableParentFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {getFolderPathLabel(f.id)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome da Nova Pasta *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Ex: PR - Paraná, Lote 5G W22, SN-OI65J2..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                  <span>Criado por (Perfil Autenticado)</span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-normal">
                    <Lock className="w-3 h-3" />
                    <span>Fixo do perfil</span>
                  </span>
                </label>
                <div className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 flex items-center justify-between select-none cursor-not-allowed">
                  <span>{user.name}</span>
                  <span className="text-[11px] font-normal text-slate-400">{user.email}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Descrição / Observação (Opcional)
                </label>
                <input
                  type="text"
                  value={newFolderDescription}
                  onChange={(e) => setNewFolderDescription(e.target.value)}
                  placeholder="Ex: Pacotes de vistoria e TSSR da regional..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewFolderModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingFolder}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {creatingFolder ? 'Criando...' : 'Criar Pasta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: CARREGAR ARQUIVOS (.ZIP, WINRAR .RAR, DOCUMENTOS) — SOMENTE DENTRO DAS PASTAS
         ===================================================================== */}
      {uploadModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setUploadModalOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <Upload className="w-5 h-5 text-blue-600 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {isExecutor
                      ? 'Subir TSSR (.ZIP / WinRAR .RAR & Documentos)'
                      : isVistoriador
                        ? 'Subir Vistoria (.ZIP / WinRAR .RAR & Documentos)'
                        : 'Carregar Pacotes .ZIP / WinRAR (.RAR) & Documentos'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Obrigatório informar o nome de quem carregou para todos os arquivos
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
              {uploadError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Auto-detected Executor Banner for TSSR uploads */}
              {autoDetectedExecutor && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-950 flex items-center justify-between shadow-2xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <div className="font-bold text-emerald-900">
                        Vínculo Automático TSSR: Executor {autoDetectedExecutor}
                      </div>
                      <div className="text-[11px] text-emerald-700">
                        O arquivo subirá direto para a pasta destinada deste executor dentro de TSSR.
                      </div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 text-[10px] font-bold uppercase tracking-wider">
                    Direto para Pasta
                  </span>
                </div>
              )}

              {/* Destination Folder Selector (excludes outer Vistorias root) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                  <span>
                    {isTssrProjectsMode
                      ? 'Pasta de Destino (TSSR Entrada, TSSR ou Subpastas) *'
                      : 'Pasta de Destino (Vistorias Executadas / Subpastas de Vistoria) *'}
                  </span>
                  {isExecutor && (
                    <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      Sua Pasta Liberada
                    </span>
                  )}
                </label>
                <select
                  value={uploadTargetFolderId}
                  onChange={(e) => setUploadTargetFolderId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600 font-medium"
                >
                  {uploadableFolders.map((f) => {
                    const isExecLiberated =
                      (f.id.includes('tssr-exec') ||
                        f.parentId?.endsWith('-tssr-final') ||
                        f.parentId?.endsWith('-tssr-entrada')) &&
                      f.assignedTo;
                    return (
                      <option key={f.id} value={f.id}>
                        {isExecLiberated ? `📁 [Executor: ${f.assignedTo}] ${getFolderPathLabel(f.id)}` : getFolderPathLabel(f.id)}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Locked Profile Uploader Name (Non-editable) */}
              <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-1.5">
                <div className="text-xs font-bold text-blue-950 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-blue-600" />
                    <span>Responsável pelo Carregamento (Perfil Logado)</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded">
                    <Lock className="w-3 h-3" />
                    <span>Bloqueado</span>
                  </span>
                </div>
                <div className="w-full px-3 py-2 bg-slate-100/90 border border-blue-200 rounded-lg text-xs font-bold text-slate-800 flex items-center justify-between select-none cursor-not-allowed">
                  <span>{user.name}</span>
                  <span className="text-[11px] font-normal text-slate-500">{user.email}</span>
                </div>
                <p className="text-[11px] text-blue-700">
                  O nome do seu perfil será vinculado automaticamente a todos os arquivos enviados.
                </p>
              </div>

              {/* Responsible User for Document Demand ("a mesma coisa para documentos ta") */}
              {isAdmin && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                    <span>Responsável pela Demanda (Para qual usuário este documento vai aparecer)</span>
                  </label>
                  <select
                    value={uploadAssignedTo}
                    onChange={(e) => setUploadAssignedTo(e.target.value)}
                    className="w-full px-3 py-2 bg-blue-50/50 border border-blue-200 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    <option value="">— Apenas ADM (Não atribuir a usuário específico) —</option>
                    {assignableUsers.map((u) => (
                      <option key={u.id} value={u.name}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Site Link to TSSR TIM Nokia (Mandatory in Vistoria, Optional in TSSR Entrada / TSSR) */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-900">
                    {isUploadTargetTssrProject
                      ? 'Site ID Vinculado (Opcional — busque pela sigla ou deixe em branco)'
                      : 'Vincular ao Site na aba TSSR TIM Nokia (Obrigatório) *'}
                  </label>
                  {uploadSiteId && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono text-[11px] font-bold">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Site vinculado: {uploadSiteId}</span>
                    </span>
                  )}
                </div>

                <div className="relative">
                  <div className="flex items-center bg-white border border-slate-300 rounded-lg px-3 py-2 focus-within:border-blue-600">
                    <Search className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
                    <input
                      type="text"
                      value={siteSearchQuery}
                      onFocus={() => setSiteDropdownOpen(true)}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        setSiteSearchQuery(val);
                        setSiteDropdownOpen(true);
                        const exact = tssrNokiaRows.find(
                          (r) => r.siteId.trim().toUpperCase() === val.trim()
                        );
                        if (exact) {
                          setUploadSiteId(exact.siteId);
                          setUploadTssrRowId(exact.id);
                          setUploadOcSitePre(exact.ocSitePre || '');
                          setCreateNewTssrRow(false);

                          const siteExec = (exact.fields?.['Executor'] || '').trim();
                          const targetExec = isExecutor
                            ? (activeTargetUser.name || user.name || '').trim()
                            : siteExec;
                          if (targetExec) {
                            setAutoDetectedExecutor(targetExec);
                            const execFolder = findLiberatedFolderForExecutor(
                              allVendorFolders,
                              activeVendor,
                              targetExec
                            );
                            if (execFolder) {
                              setUploadTargetFolderId(execFolder.id);
                            }
                          }
                        } else {
                          setUploadSiteId(val.trim());
                          setUploadTssrRowId('');
                        }
                      }}
                      placeholder="Digite a sigla do Site (ex: SN-OI65J2) para buscar na aba TSSR TIM Nokia..."
                      className="w-full text-xs font-mono font-bold text-slate-900 placeholder-slate-400 focus:outline-none"
                    />
                    {siteSearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSiteSearchQuery('');
                          setUploadSiteId('');
                          setUploadTssrRowId('');
                          setUploadOcSitePre('');
                          setCreateNewTssrRow(false);
                        }}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {siteDropdownOpen && matchingTssrRows.length > 0 && (
                    <div className="mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg divide-y divide-slate-100 z-50">
                      {matchingTssrRows.map((r) => {
                        const isSelected =
                          uploadTssrRowId === r.id ||
                          (uploadSiteId === r.siteId && !uploadTssrRowId);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setUploadSiteId(r.siteId);
                              setSiteSearchQuery(r.siteId);
                              setUploadTssrRowId(r.id);
                              setUploadOcSitePre(r.ocSitePre || '');
                              setCreateNewTssrRow(false);
                              setSiteDropdownOpen(false);

                              const siteExec = (r.fields?.['Executor'] || '').trim();
                              const targetExec = isExecutor
                                ? (activeTargetUser.name || user.name || '').trim()
                                : siteExec;
                              if (targetExec) {
                                setAutoDetectedExecutor(targetExec);
                                const execFolder = findLiberatedFolderForExecutor(
                                  allVendorFolders,
                                  activeVendor,
                                  targetExec
                                );
                                if (execFolder) {
                                  setUploadTargetFolderId(execFolder.id);
                                }
                              }
                            }}
                            className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 cursor-pointer ${
                              isSelected ? 'bg-blue-50 font-bold text-blue-900' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-mono font-bold text-slate-900">
                                {r.siteId}{' '}
                                {r.ocSitePre && (
                                  <span className="font-normal text-slate-500">
                                    · OC: {r.ocSitePre}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {r.enderecoId || '—'} · {r.fields?.['Cidade'] || '—'}/
                                {r.fields?.['UF'] || '—'} · {r.fields?.['STATUS Engenharia'] || '—'}
                              </div>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                r.vistoriaStatus === 'Entregue'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {r.vistoriaStatus === 'Entregue' ? 'Entregue' : 'Pendente'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Offer to create a new row if site does not exist in TSSR TIM Nokia */}
                {siteSearchQuery.trim() && !exactTssrMatchExists && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-amber-900">
                        O site <strong className="font-mono">{siteSearchQuery.trim()}</strong> não
                        existe na aba <strong>TSSR TIM Nokia</strong>.
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCreateNewTssrRow(true);
                          setUploadSiteId(siteSearchQuery.trim().toUpperCase());
                          setSiteDropdownOpen(false);
                        }}
                        className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition-colors ${
                          createNewTssrRow
                            ? 'bg-emerald-600 text-white'
                            : 'bg-amber-600 hover:bg-amber-700 text-white'
                        }`}
                      >
                        {createNewTssrRow
                          ? '✓ Nova linha será criada'
                          : `+ Criar nova linha para ${siteSearchQuery.trim().toUpperCase()}`}
                      </button>
                    </div>

                    {createNewTssrRow && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                        <input
                          type="text"
                          value={uploadOcSitePre}
                          onChange={(e) => setUploadOcSitePre(e.target.value)}
                          placeholder="Oc Site Pre (Opcional)"
                          className="px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-mono"
                        />
                        <input
                          type="text"
                          value={newTssrEnderecoId}
                          onChange={(e) => setNewTssrEnderecoId(e.target.value)}
                          placeholder="Enderecoid (Opcional)"
                          className="px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs"
                        />
                        <input
                          type="text"
                          maxLength={2}
                          value={newTssrUf}
                          onChange={(e) => setNewTssrUf(e.target.value.toUpperCase())}
                          placeholder="UF (Ex: DF)"
                          className="px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-mono"
                        />
                        <input
                          type="text"
                          value={newTssrCidade}
                          onChange={(e) => setNewTssrCidade(e.target.value)}
                          placeholder="Cidade"
                          className="px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Observação / Revisão (Opcional)
                  </label>
                  <input
                    type="text"
                    value={uploadNotes}
                    onChange={(e) => setUploadNotes(e.target.value)}
                    placeholder="Ex: Relatório TSSR + Fotos .RAR"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              {/* File Picker Dropzone (.zip, .rar WinRAR, .7z, .xlsx, .pdf, or Entire Folder) */}
              <div className="space-y-2.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".zip,.rar,.7z,.tar,.gz,.xlsx,.xls,.csv,.pdf,.doc,.docx,.ppt,.pptx,.dwg,.kmz,.kml,image/*,*/*"
                  onChange={(e) => handleReadSelectedFiles(e.target.files, false)}
                  className="hidden"
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
                  onChange={(e) => handleReadSelectedFiles(e.target.files, true)}
                  className="hidden"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 hover:border-blue-600 bg-slate-50 hover:bg-blue-50/40 rounded-xl p-4 text-center cursor-pointer transition-colors space-y-1"
                  >
                    <FileArchive className="w-6 h-6 text-blue-600 mx-auto" />
                    <div className="text-xs font-bold text-slate-800">
                      Selecionar Pacote (.ZIP / .RAR) ou Arquivos
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Arquivos compactados, planilhas, PDFs e croquis
                    </div>
                  </div>

                  <div
                    onClick={() => folderInputRef.current?.click()}
                    className="border-2 border-dashed border-amber-300 hover:border-amber-600 bg-amber-50/40 hover:bg-amber-50/80 rounded-xl p-4 text-center cursor-pointer transition-colors space-y-1"
                  >
                    <FolderOpen className="w-6 h-6 text-amber-600 mx-auto" />
                    <div className="text-xs font-bold text-slate-800">
                      Subir Pasta Inteira do Computador
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Envia a pasta com todos os arquivos (você poderá modificá-la depois)
                    </div>
                  </div>
                </div>

                {uploadedFolderName && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <Folder className="w-4 h-4 text-amber-600 fill-amber-400 shrink-0" />
                      <span className="text-amber-900 truncate">
                        Pasta que será enviada: <strong>{uploadedFolderName}</strong>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUploadedFolderName('')}
                      className="text-amber-700 hover:text-amber-950 text-[11px] font-semibold cursor-pointer"
                    >
                      Limpar pasta
                    </button>
                  </div>
                )}
              </div>

              {/* Selected Files List */}
              {pendingFiles.length > 0 && (
                <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-slate-50">
                  {pendingFiles.map((pf, idx) => (
                    <div
                      key={`${pf.fileName}-${idx}`}
                      className="px-3.5 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="font-semibold text-slate-800 truncate">
                          {pf.fileName}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400 shrink-0">
                          ({formatBytes(pf.fileSize)})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingFiles((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {uploading
                      ? 'Carregando Arquivos...'
                      : `Confirmar Carregamento (${pendingFiles.length})`}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: MODIFICAR PASTA ENVIADA (SOMENTE PASTAS QUE O USUÁRIO SUBIU)
         ===================================================================== */}
      {editingFolder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setEditingFolder(null)}
        >
          <div
            className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Pencil className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Modificar Pasta Enviada
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingFolder(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditFolderSubmit} className="p-5 space-y-4">
              {editFolderError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editFolderError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome da Pasta *
                </label>
                <input
                  type="text"
                  required
                  value={editFolderName}
                  onChange={(e) => setEditFolderName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Descrição / Observação
                </label>
                <input
                  type="text"
                  value={editFolderDescription}
                  onChange={(e) => setEditFolderDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl flex items-center justify-between gap-2">
                <span className="text-xs text-blue-900 font-medium">
                  Deseja subir novos arquivos dentro desta pasta?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const targetId = editingFolder.id;
                    setEditingFolder(null);
                    openUploadModal(targetId);
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shrink-0 cursor-pointer flex items-center gap-1"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Subir Arquivos</span>
                </button>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingFolder(null)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingFolderEdit}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {savingFolderEdit ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 4: MODIFICAR ARQUIVO / PACOTE ENVIADO
         ===================================================================== */}
      {editingFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setEditingFile(null)}
        >
          <div
            className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Pencil className="w-4 h-4 text-purple-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Modificar Pasta / Pacote Enviado
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingFile(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditFileSubmit} className="p-5 space-y-4">
              {editFileError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editFileError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome do Arquivo / Pacote *
                </label>
                <input
                  type="text"
                  required
                  value={editFileName}
                  onChange={(e) => setEditFileName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Site ID Vinculado
                </label>
                <input
                  type="text"
                  value={editFileSiteId}
                  onChange={(e) => setEditFileSiteId(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Observações / Revisão
                </label>
                <input
                  type="text"
                  value={editFileNotes}
                  onChange={(e) => setEditFileNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Substituir Arquivo / Pacote (Opcional)
                </label>
                <input
                  ref={replaceFileInputRef}
                  type="file"
                  accept=".zip,.rar,.7z,.tar,.gz,.xlsx,.xls,.csv,.pdf,.doc,.docx,.ppt,.pptx,.dwg,.kmz,.kml,image/*,*/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      setEditFileReplacement({
                        fileName: f.name,
                        fileSize: f.size,
                        base64Data: String(reader.result || ''),
                      });
                      setEditFileName(f.name);
                    };
                    reader.readAsDataURL(f);
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => replaceFileInputRef.current?.click()}
                  className="w-full py-2.5 px-3 border border-dashed border-purple-300 hover:border-purple-600 bg-purple-50/40 rounded-xl text-xs font-semibold text-purple-800 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {editFileReplacement
                      ? `Novo arquivo: ${editFileReplacement.fileName}`
                      : 'Selecionar novo arquivo para substituir'}
                  </span>
                </button>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingFile(null)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingFileEdit}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {savingFileEdit ? 'Salvando...' : 'Salvar Modificações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* =====================================================================
          MODAL 5: CONFIRMAÇÃO DE EXCLUSÃO DE ARQUIVO
         ===================================================================== */}
      {filePendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px] animate-in fade-in duration-150"
          onClick={() => !deletingItem && setFilePendingDelete(null)}
        >
          <div
            className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-red-50/80 border-b border-red-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-red-950">
                    Apagar Arquivo do Sistema
                  </h3>
                  <p className="text-[11px] text-red-700">
                    {isGestorEngenharia
                      ? 'Opção de exclusão para Gestor da Engenharia'
                      : 'Exclusão permitida para documento vinculado ao seu nome'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={deletingItem}
                onClick={() => setFilePendingDelete(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <div className="text-xs font-bold text-slate-900 truncate">
                  {filePendingDelete.fileName}
                </div>
                <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                  <span>Enviado por: {filePendingDelete.uploadedByName}</span>
                  {filePendingDelete.siteId && <span>Site: {filePendingDelete.siteId}</span>}
                  {filePendingDelete.assignedTo && <span>Atribuído: {filePendingDelete.assignedTo}</span>}
                </div>
              </div>

              <p className="text-xs text-slate-600">
                Tem certeza que deseja apagar este arquivo permanentemente? Se houver sites vinculados a esta vistoria/TSSR, o status será atualizado automaticamente.
              </p>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={deletingItem}
                  onClick={() => setFilePendingDelete(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deletingItem}
                  onClick={confirmDeleteFile}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{deletingItem ? 'Apagando...' : 'Sim, Apagar Arquivo'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 6: CONFIRMAÇÃO DE EXCLUSÃO DE PASTA (APENAS GESTOR)
         ===================================================================== */}
      {folderPendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px] animate-in fade-in duration-150"
          onClick={() => !deletingItem && setFolderPendingDelete(null)}
        >
          <div
            className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-red-50/80 border-b border-red-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-red-950">
                    Apagar Pasta e Conteúdo
                  </h3>
                  <p className="text-[11px] text-red-700">
                    Apenas Gestor da Engenharia pode apagar pastas
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={deletingItem}
                onClick={() => setFolderPendingDelete(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <div className="text-xs font-bold text-slate-900">
                  📁 {folderPendingDelete.name}
                </div>
                {folderPendingDelete.assignedTo && (
                  <div className="text-[11px] text-slate-500">
                    Liberada para: {folderPendingDelete.assignedTo}
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-600">
                Tem certeza que deseja apagar a pasta <strong>"{folderPendingDelete.name}"</strong>? Todos os arquivos contidos nela também serão excluídos do sistema.
              </p>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={deletingItem}
                  onClick={() => setFolderPendingDelete(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deletingItem}
                  onClick={confirmDeleteFolder}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{deletingItem ? 'Apagando...' : 'Sim, Apagar Pasta'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 7: LIBERAR PASTA PARA EXECUTOR DENTRO DE TSSR (GESTOR)
         ===================================================================== */}
      {liberarPastaModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px] animate-in fade-in duration-150"
          onClick={() => !liberandoPasta && !liberandoTodasPastas && setLiberarPastaModalOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 bg-gradient-to-r from-emerald-700 to-teal-800 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                  <UserCheck className="w-5 h-5 text-emerald-200" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">
                    Liberar Pasta de TSSR para Executor
                  </h3>
                  <p className="text-[11px] text-emerald-100">
                    O executor terá sua pasta dentro de TSSR e o sistema enviará direto para ela
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLiberarPastaModalOpen(false)}
                className="p-1 text-emerald-200 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 space-y-1">
                <div className="font-bold">Regra de Vínculo Automático:</div>
                <div className="text-[11px] text-emerald-800">
                  Cada executor terá sua pasta liberada na raiz de TSSR. Ao subir um TSSR (seja pelo executor ou vinculado a um site), o sistema entende o vínculo e salva diretamente na pasta destinada.
                </div>
              </div>

              {/* Botão de Liberar para Todos com 1 clique */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Liberar Pastas para TODOS os Executores
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Cria e libera automaticamente a pasta de cada um dos {allAvailableExecutors.length} executores cadastrados.
                  </div>
                </div>
                <button
                  type="button"
                  disabled={liberandoTodasPastas}
                  onClick={handleLiberarTodasPastasExecutores}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shrink-0 cursor-pointer shadow-sm flex items-center gap-1.5"
                >
                  <FolderCheck className="w-3.5 h-3.5" />
                  <span>{liberandoTodasPastas ? 'Liberando...' : 'Liberar para Todos'}</span>
                </button>
              </div>

              {/* Liberar para um executor específico */}
              <div className="space-y-3 pt-1">
                <label className="block text-xs font-bold text-slate-800">
                  Ou selecione um executor específico:
                </label>
                <div className="flex gap-2">
                  <select
                    value={selectedExecutorForPasta}
                    onChange={(e) => setSelectedExecutorForPasta(e.target.value)}
                    className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:border-emerald-600"
                  >
                    <option value="">— Selecione um Executor —</option>
                    {allAvailableExecutors.map((ex) => (
                      <option key={ex} value={ex}>
                        {ex}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedExecutorForPasta || liberandoPasta}
                    onClick={handleLiberarPastaExecutor}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer shrink-0 shadow-sm"
                  >
                    {liberandoPasta ? 'Liberando...' : 'Liberar Pasta'}
                  </button>
                </div>
              </div>

              {/* Lista dos executores e status da pasta */}
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <div className="text-xs font-bold text-slate-700">
                  Status das Pastas TSSR dos Executores ({allAvailableExecutors.length}):
                </div>
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {allAvailableExecutors.map((ex) => {
                    const liberatedFolder = findLiberatedFolderForExecutor(
                      allVendorFolders,
                      activeVendor,
                      ex
                    );
                    const isLiberated = Boolean(liberatedFolder);
                    return (
                      <div
                        key={ex}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800">{ex}</span>
                          {liberatedFolder && (
                            <span className="text-[10px] text-slate-500 font-mono">
                              (TSSR / {liberatedFolder.name})
                            </span>
                          )}
                        </div>
                        {isLiberated ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Pasta Liberada</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedExecutorForPasta(ex);
                              handleLiberarPastaExecutor();
                            }}
                            className="px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-bold cursor-pointer transition-colors"
                          >
                            + Liberar Agora
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setLiberarPastaModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
