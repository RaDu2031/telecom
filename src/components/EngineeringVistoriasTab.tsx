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
import { doesDocumentMatchResponsible } from '../utils/spreadsheetUtils';

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
    nextTssrSheets?: TssrSheetMeta[]
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
  const isAdmin = currentRole === 'ADM' && !simulatedTargetUser;
  const isVistoriador = currentRole === 'Vistoriador';
  const isTssrProjectsMode = mode === 'tssr-projects' && !isVistoriador;

  // Hidden/collapsible tab state for "Demanda por Responsável" inside Documentos ("em uma aba escondida so abre se eu clicar")
  const [isDocDemandaTabOpen, setIsDocDemandaTabOpen] = useState<boolean>(false);
  const [docResponsavelFilter, setDocResponsavelFilter] = useState<string>('ALL');

  const assignableUsers = useMemo(() => {
    const nonAdm = users.filter((u) => normalizeUserRole(u.role) !== 'ADM');
    if (nonAdm.some((u) => u.name.toLowerCase().includes('teste'))) {
      return nonAdm;
    }
    return [
      {
        id: 'usr-teste-1',
        name: 'Usuário Teste',
        email: 'teste@ameta.com.br',
        role: 'Executor' as UserRole,
        emailVerified: true,
        createdAt: '',
      },
      ...nonAdm,
    ];
  }, [users]);

  const allVendorFolders = useMemo(
    () => folders.filter((f) => f.vendor === activeVendor),
    [folders, activeVendor]
  );

  const allVendorFiles = useMemo(
    () => files.filter((fl) => fl.vendor === activeVendor),
    [files, activeVendor]
  );

  const vendorFolders = useMemo(() => {
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
  }, [allVendorFolders, isTssrProjectsMode]);

  const allowedFolderIds = useMemo(
    () => new Set(vendorFolders.map((f) => f.id)),
    [vendorFolders]
  );

  // Files visible to the current user (filtered to allowed folders so Vistoriador only sees Vistoria files)
  const vendorFiles = useMemo(() => {
    const folderScopedFiles = allVendorFiles.filter((fl) => allowedFolderIds.has(fl.folderId));
    if (!isAdmin) {
      return folderScopedFiles.filter((fl) => {
        const folder = allVendorFolders.find((f) => f.id === fl.folderId);
        return doesDocumentMatchResponsible(fl, folder, activeTargetUser);
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
      return doesDocumentMatchResponsible(fl, folder, docResponsavelFilter);
    });
  }, [allVendorFiles, allowedFolderIds, allVendorFolders, isAdmin, activeTargetUser, docResponsavelFilter]);

  const rootVistoriasFolder = useMemo(
    () =>
      vendorFolders.find((f) => f.parentId === null && f.name === 'Vistorias') ||
      vendorFolders[0] ||
      null,
    [vendorFolders]
  );

  const [currentFolderId, setCurrentFolderId] = useState<string>(() => {
    if (initialFolderId) return initialFolderId;
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

  // Folder only shows folders (no direct file uploads at this level)
  const isFolderOnlyLevel = isAtRootVistorias || isAtVistoriasExecutadasIndex;

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
      isAdmin
        ? vendorFolders
        : vendorFolders.filter((f) => f.parentId !== null),
    [vendorFolders, isAdmin]
  );

  // Search filter inside Vistorias
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [uploaderFilter, setUploaderFilter] = useState<string>('ALL');

  // Create Folder Modal state
  const [newFolderModalOpen, setNewFolderModalOpen] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [newFolderParentId, setNewFolderParentId] = useState<string>('');
  const [newFolderCreatorName, setNewFolderCreatorName] = useState<string>(user.name || '');
  const [newFolderDescription, setNewFolderDescription] = useState<string>('');
  const [newFolderAssignedTo, setNewFolderAssignedTo] = useState<string>('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState<boolean>(false);

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

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // TSSR TIM Nokia rows for searchable site selector
  const tssrNokiaRows = useMemo(
    () => tssrRows.filter((r) => r.tabName === 'TSSR TIM Nokia'),
    [tssrRows]
  );

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
      const safeTargetId = uploadableFolders[0]?.id || '';
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
  }, [preselectedSiteId, tssrNokiaRows, uploadableFolders, user.name, onClearPreselectedSiteId]);

  // Breadcrumb trail from root "Vistorias" down to activeFolder
  const breadcrumbs = useMemo(() => {
    const trail: EngineeringFolder[] = [];
    let curr: EngineeringFolder | undefined = activeFolder || undefined;
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      trail.unshift(curr);
      curr = curr.parentId ? vendorFolders.find((f) => f.id === curr!.parentId) : undefined;
    }
    return trail;
  }, [activeFolder, vendorFolders]);

  // Direct child folders of the current folder
  const childFolders = useMemo(() => {
    const list = vendorFolders.filter((f) => f.parentId === effectiveFolderId);
    if (!searchQuery.trim()) return list;
    const q = searchQuery.trim().toLowerCase();
    return list.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.description || '').toLowerCase().includes(q) ||
        f.createdByName.toLowerCase().includes(q)
    );
  }, [vendorFolders, effectiveFolderId, searchQuery]);

  // Direct files in the current folder (only inside subfolders, or when searching)
  const displayedFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (isAtRootVistorias && !q) {
      return [];
    }
    const base = q
      ? vendorFiles.filter((fl) => {
          const folder = vendorFolders.find((f) => f.id === fl.folderId);
          return folder ? folder.parentId !== null : true;
        })
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
  }, [vendorFiles, vendorFolders, effectiveFolderId, searchQuery, uploaderFilter, isAtRootVistorias]);

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

  // Core main folders inside Vistorias for quick access pills
  const mainVistoriasSubfolders = useMemo(() => {
    if (!rootVistoriasFolder) return [];
    return vendorFolders.filter((f) => f.parentId === rootVistoriasFolder.id);
  }, [vendorFolders, rootVistoriasFolder]);

  const openCreateFolderModal = (parentId?: string) => {
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

    // Never allow selecting root Vistorias as upload destination
    const safeTargetId =
      candidateFolder && candidateFolder.parentId !== null
        ? candidateFolder.id
        : uploadableFolders[0]?.id || '';

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
    setUploadNotes('');
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

  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFolderError(null);

    if (!newFolderName.trim()) {
      setFolderError('Digite o nome da nova pasta.');
      return;
    }

    setCreatingFolder(true);
    try {
      const res = await fetch('/api/engineering/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFolderName.trim(),
          parentId: newFolderParentId || effectiveFolderId,
          vendor: activeVendor,
          description: newFolderDescription.trim(),
          assignedTo: newFolderAssignedTo.trim() || undefined,
          createdByName: user.name,
          createdByEmail: user.email,
          createdByRole: user.role,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFolderError(data.error || 'Não foi possível criar a pasta.');
        return;
      }
      if (Array.isArray(data.engineeringFolders) && Array.isArray(data.engineeringFiles)) {
        onFoldersAndFilesUpdated(
          data.engineeringFolders,
          data.engineeringFiles,
          `Pasta "${data.folder.name}" criada com sucesso`
        );
      }
      setNewFolderModalOpen(false);
    } catch {
      setFolderError('Falha de conexão ao criar pasta.');
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
          uploadedByName: user.name,
          uploadedByEmail: user.email,
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
          allVendorFolders.find((f) => f.id === uploadTargetFolderId)?.name || 'Pasta';
        onFoldersAndFilesUpdated(
          data.engineeringFolders,
          data.engineeringFiles,
          requireSiteForThisUpload
            ? `Vistoria do site ${finalSiteId} entregue por ${user.name}! Status atualizado para "Entregue" na aba TSSR TIM Nokia.`
            : `${pendingFiles.length} arquivo(s) carregado(s) com sucesso em "${targetFolderName}" por ${user.name}!`,
          data.tssrRows,
          data.tssrSheets
        );
      }
      setCurrentFolderId(uploadTargetFolderId);
      setUploadModalOpen(false);
      setPendingFiles([]);
    } catch {
      setUploadError('Erro de rede ao transferir arquivos.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFolder = async (folder: EngineeringFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    if (folder.isSystem) return;
    // Root-level main folders can only be deleted by Admin
    const isMainUnderRoot = folder.parentId === rootVistoriasFolder?.id;
    if (isMainUnderRoot && !isAdmin) return;

    try {
      const res = await fetch(`/api/engineering/folders/${encodeURIComponent(folder.id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        onFoldersAndFilesUpdated(
          data.engineeringFolders,
          data.engineeringFiles,
          `Pasta "${folder.name}" removida`
        );
        if (currentFolderId === folder.id && folder.parentId) {
          setCurrentFolderId(folder.parentId);
        }
      }
    } catch {
      // ignore error
    }
  };

  const handleDeleteFile = async (file: EngineeringFile) => {
    try {
      const res = await fetch(`/api/engineering/files/${encodeURIComponent(file.id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        onFoldersAndFilesUpdated(
          data.engineeringFolders,
          data.engineeringFiles,
          `Arquivo "${file.fileName}" removido`,
          data.tssrRows
        );
      }
    } catch {
      // ignore error
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
                  {isTssrProjectsMode
                    ? `Engenharia · Pastas de Projetos · ${activeVendor}`
                    : `Vistoria · ${activeVendor}`}
                </span>
                <span className="text-slate-300">•</span>
                <h1 className="text-base font-bold text-slate-900">
                  {isTssrProjectsMode
                    ? isAtRootVistorias
                      ? 'Pastas de Projetos TSSR & TSSR de Entrada'
                      : `Pasta ${activeFolder?.name}`
                    : `Envio de Vistoria (Vínculo com TSSR TIM Nokia) — ${
                        isAtRootVistorias ? 'Pastas de Vistoria' : activeFolder?.name
                      }`}
                </h1>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isTssrProjectsMode ? (
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
          <div className="flex flex-wrap items-center gap-2.5">
            {onBackToEngineeringControl && (
              <button
                type="button"
                onClick={onBackToEngineeringControl}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Voltar para Controle de Engenharia (Planilha)</span>
              </button>
            )}

            {!isTssrProjectsMode && !isVistoriador && onOpenTssrTab && (
              <button
                type="button"
                onClick={onOpenTssrTab}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-[#223585]" />
                <span>Ver Planilha TSSR TIM Nokia</span>
              </button>
            )}

            {!isAtRootVistorias && (
              <button
                type="button"
                onClick={() => openCreateFolderModal(effectiveFolderId)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <FolderPlus className="w-4 h-4 text-amber-600" />
                <span>Nova Subpasta</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => openUploadModal(effectiveFolderId)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 shadow-2xs cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>
                {isTssrProjectsMode
                  ? 'Carregar Arquivo (.ZIP / .RAR / Docs)'
                  : 'Subir Arquivo de Vistoria (Vincular ao Site)'}
              </span>
            </button>
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
                <span>{isTssrProjectsMode ? 'Todas as Pastas TSSR' : 'Pasta Vistorias'}</span>
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
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsDocDemandaTabOpen((prev) => !prev)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  isDocDemandaTabOpen || docResponsavelFilter !== 'ALL'
                    ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800'
                }`}
                title="Clique para abrir ou fechar a aba escondida de Demanda por Responsável (Documentos)"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>
                  Demanda por Responsável
                  {docResponsavelFilter !== 'ALL'
                    ? `: ${docResponsavelFilter === '__NONE__' ? 'Sem Responsável' : docResponsavelFilter}`
                    : ''}
                </span>
                {isDocDemandaTabOpen ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            )}

            <div className="relative w-64">
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
              {isTssrProjectsMode ? 'Engenharia' : 'Pasta Vistoria'}
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
                {isAtRootVistorias
                  ? 'Pastas Principais em Vistorias'
                  : `Pastas em ${activeFolder?.name}`}
              </span>

              {(!isAtRootVistorias || isAdmin) && (
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
                const isMainUnderRoot = sub.parentId === rootVistoriasFolder?.id;
                const canDeleteSub = !sub.isSystem && (!isMainUnderRoot || isAdmin);

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
                        <div className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors flex items-center gap-2">
                          <span>{sub.name}</span>
                          {sub.isSystem && (
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-blue-50 text-blue-700 rounded border border-blue-200">
                              Pasta Principal
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-3 mt-0.5">
                          {sub.description && <span className="truncate">{sub.description}</span>}
                          <span>
                            Criada por: <strong className="text-slate-700">{sub.createdByName}</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right hidden sm:block">
                        <div className="text-xs font-mono font-semibold text-slate-700 tabular-nums">
                          {stats.totalFiles} arquivo(s)
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                          {stats.directSubfolders} subpasta(s)
                        </div>
                      </div>

                      {canDeleteSub && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteFolder(sub, e)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          title="Excluir pasta"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
                  <span>Carregar Arquivo (.ZIP / .RAR / Docs)</span>
                </button>
                <button
                  type="button"
                  onClick={() => openCreateFolderModal(effectiveFolderId)}
                  className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4 text-amber-500" />
                  <span>+ Criar Subpasta em {activeFolder?.name}</span>
                </button>
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
                <button
                  type="button"
                  onClick={() => openCreateFolderModal(effectiveFolderId)}
                  className="text-slate-700 hover:text-blue-600 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-amber-600" />
                  <span>+ Nova Subpasta</span>
                </button>
                <button
                  type="button"
                  onClick={() => openUploadModal(effectiveFolderId)}
                  className="text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>+ Carregar Arquivo Aqui</span>
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

                              <button
                                type="button"
                                onClick={() => handleDeleteFile(file)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                title="Remover arquivo"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
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
            className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Upload className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Carregar Pacotes .ZIP / WinRAR (.RAR) & Documentos
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

            <form onSubmit={handleUploadSubmit} className="p-5 space-y-4">
              {uploadError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Destination Folder Selector (excludes outer Vistorias root) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isTssrProjectsMode
                    ? 'Pasta de Destino (TSSR Entrada, TSSR ou Subpastas) *'
                    : 'Pasta de Destino (Vistorias Executadas / Subpastas de Vistoria) *'}
                </label>
                <select
                  value={uploadTargetFolderId}
                  onChange={(e) => setUploadTargetFolderId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600 font-medium"
                >
                  {uploadableFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {getFolderPathLabel(f.id)}
                    </option>
                  ))}
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

              {/* File Picker Dropzone (.zip, .rar WinRAR, .7z, .xlsx, .pdf, etc.) */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".zip,.rar,.7z,.tar,.gz,.xlsx,.xls,.csv,.pdf,.doc,.docx,.ppt,.pptx,.dwg,.kmz,.kml,image/*,*/*"
                  onChange={(e) => handleReadSelectedFiles(e.target.files)}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-blue-600 bg-slate-50 hover:bg-blue-50/40 rounded-xl p-5 text-center cursor-pointer transition-colors space-y-1.5"
                >
                  <FileArchive className="w-7 h-7 text-blue-600 mx-auto" />
                  <div className="text-xs font-bold text-slate-800">
                    Clique para selecionar arquivos .ZIP, WinRAR (.RAR) ou Documentos
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Suporta pacotes compactados (.zip, .rar, .7z), planilhas (.xlsx), PDFs, fotos e croquis
                  </div>
                </div>
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
    </div>
  );
};
