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
} from 'lucide-react';
import {
  AmetaUser,
  UserRole,
  EricssonRow,
  EricssonSheetMeta,
  EngineeringFolder,
  EngineeringFile,
} from '../types/telecom';
import {
  doesEricssonRowMatchResponsible,
  doesFileMatchUserResponsibleSites,
} from '../utils/spreadsheetUtils';
import { cloudFetch } from '../lib/firebaseCloud';

const fetch = cloudFetch;

export interface EricssonVistoriaTabProps {
  user: AmetaUser;
  effectiveRole: UserRole;
  rows: EricssonRow[];
  sheetMeta: EricssonSheetMeta | null;
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

export const EricssonVistoriaTab: React.FC<EricssonVistoriaTabProps> = ({
  user,
  effectiveRole,
  rows,
  sheetMeta,
  folders,
  files,
  focusedFolderId = null,
  focusedFileId = null,
  focusedFileName = null,
  onClearFocus,
  onUpdated,
  onOpenSitesTab,
}) => {
  const isAdmin =
    effectiveRole === 'ADM' ||
    effectiveRole === 'Coordenador Geral' ||
    effectiveRole === 'Coordenador Engenharia';
  const isVistoriador = effectiveRole === 'Vistoriador';
  const isExecutor = effectiveRole === 'Executor';
  const canCreateFolders = !isExecutor && !isVistoriador;
  const canUploadTssr = isExecutor || isAdmin;
  const canUploadVistoria = isVistoriador || isAdmin;

  // Dedicated Ericsson folders (completely isolated from Nokia)
  const ericssonFolders = useMemo(() => {
    const list = folders.filter((f) => f.vendor === 'ERICSSON');
    if (list.length === 0) {
      return [
        {
          id: 'folder-ericsson-root',
          parentId: null,
          name: 'Vistoria Ericsson',
          vendor: 'ERICSSON' as const,
          description: 'Repositório exclusivo de Vistoria e LOS do sistema Ericsson',
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

  // Ericsson rows that the current Vistoriador / Executor is responsible for doing
  const responsibleRows = useMemo(
    () => rows.filter((r) => doesEricssonRowMatchResponsible(r, user)),
    [rows, user]
  );

  // Vistoriador ONLY sees files associated with the sites they are responsible for doing
  const ericssonFiles = useMemo(() => {
    const base = files.filter(
      (fl) =>
        fl.vendor === 'ERICSSON' &&
        (!fl.folderId || allowedFolderIds.has(fl.folderId) || fl.folderId === 'folder-ericsson-root')
    );
    if (isVistoriador) {
      return base.filter((fl) => doesFileMatchUserResponsibleSites(fl, user, [], rows));
    }
    if (isExecutor) {
      return base.filter((fl) => {
        const myEmail = (user.email || '').trim().toLowerCase();
        const myName = (user.name || '').trim().toLowerCase();
        const isOwn =
          (myEmail && (fl.uploadedByEmail || '').trim().toLowerCase() === myEmail) ||
          (myName && (fl.uploadedByName || '').trim().toLowerCase() === myName);
        return isOwn || doesFileMatchUserResponsibleSites(fl, user, [], rows);
      });
    }
    return base;
  }, [files, allowedFolderIds, isVistoriador, isExecutor, user, rows]);

  const rootVistoriasFolder = useMemo(
    () =>
      ericssonFolders.find((f) => f.id === 'folder-ericsson-root' || f.parentId === null) ||
      ericssonFolders[0] ||
      null,
    [ericssonFolders]
  );

  const [currentFolderId, setCurrentFolderId] = useState<string>(
    () => rootVistoriasFolder?.id || 'folder-ericsson-root'
  );
  const [highlightedFileId, setHighlightedFileId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [deletingBulk, setDeletingBulk] = useState<boolean>(false);

  const activeFolder = useMemo(() => {
    const found = ericssonFolders.find((f) => f.id === currentFolderId);
    return found || rootVistoriasFolder;
  }, [ericssonFolders, currentFolderId, rootVistoriasFolder]);

  const effectiveFolderId = activeFolder?.id || 'folder-ericsson-root';
  const isAtRootVistorias = !activeFolder || activeFolder.parentId === null;

  const uploadableFolders = useMemo(() => ericssonFolders, [ericssonFolders]);

  const creatableParentFolders = useMemo(
    () => (isExecutor || isVistoriador ? [] : ericssonFolders),
    [ericssonFolders, isExecutor, isVistoriador]
  );

  // Ownership helpers: Executor and Vistoriador can ONLY modify/delete folders and files they uploaded to the system
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

  // Upload Modal:
  // - uploadCategory: 'VISTORIA' (links to Site A or Site B; marks chosen side Entregue & other side Dispensado)
  //                   'LOS' (links to Site ID A or B and marks LOS as Entregue)
  //                   'TSSR' (Executor/Admin only: links to Site ID A or B and uploads TSSR package)
  const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string>('');
  const [uploadCategory, setUploadCategory] = useState<'VISTORIA' | 'LOS' | 'TSSR'>(
    effectiveRole === 'Executor' ? 'TSSR' : 'VISTORIA'
  );
  const [selectedSiteSide, setSelectedSiteSide] = useState<'A' | 'B'>('A');
  const [selectedRowId, setSelectedRowId] = useState<string>('');
  const [siteSearchQuery, setSiteSearchQuery] = useState<string>('');
  const [siteDropdownOpen, setSiteDropdownOpen] = useState<boolean>(false);

  // Create new Ericsson row inline if site does not exist in spreadsheet
  const [createNewRowMode, setCreateNewRowMode] = useState<boolean>(false);
  const [newRowChaves, setNewRowChaves] = useState<string>('');
  const [newRowState, setNewRowState] = useState<string>('SP');
  const [newRowSiteIdA, setNewRowSiteIdA] = useState<string>('');
  const [newRowSiteIdB, setNewRowSiteIdB] = useState<string>('');
  const [newRowCidadeA, setNewRowCidadeA] = useState<string>('');
  const [newRowCidadeB, setNewRowCidadeB] = useState<string>('');
  const [newRowEquipe, setNewRowEquipe] = useState<string>('');

  const [uploadNotes, setUploadNotes] = useState<string>('');
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

  // Edit Folder Modal state
  const [editingFolder, setEditingFolder] = useState<EngineeringFolder | null>(null);
  const [editFolderName, setEditFolderName] = useState<string>('');
  const [editFolderDescription, setEditFolderDescription] = useState<string>('');
  const [editFolderError, setEditFolderError] = useState<string | null>(null);
  const [savingFolderEdit, setSavingFolderEdit] = useState<boolean>(false);

  // Edit File Modal state
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

  // When user clicks "Ver arquivo na pasta de Vistoria" in the Sites spreadsheet, jump directly to the folder and highlight the file!
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

  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedRowId) || null,
    [rows, selectedRowId]
  );

  // Searchable Ericsson rows matching siteSearchQuery (scoped to responsible rows for Vistoriador/Executor when available)
  const rowPoolForUpload = useMemo(
    () => ((isVistoriador || isExecutor) && responsibleRows.length > 0 ? responsibleRows : rows),
    [isVistoriador, isExecutor, responsibleRows, rows]
  );

  const matchingRows = useMemo(() => {
    const q = siteSearchQuery.trim().toUpperCase();
    if (!q) return rowPoolForUpload.slice(0, 60);
    return rowPoolForUpload
      .filter(
        (r) =>
          (r.siteIdA || '').toUpperCase().includes(q) ||
          (r.siteIdB || '').toUpperCase().includes(q) ||
          (r.chaves || '').toUpperCase().includes(q) ||
          (r.cidadeA || '').toUpperCase().includes(q) ||
          (r.cidadeB || '').toUpperCase().includes(q)
      )
      .slice(0, 60);
  }, [rowPoolForUpload, siteSearchQuery]);

  const exactMatchExists = useMemo(() => {
    const q = siteSearchQuery.trim().toUpperCase();
    if (!q) return false;
    return rows.some(
      (r) =>
        (r.siteIdA || '').trim().toUpperCase() === q ||
        (r.siteIdB || '').trim().toUpperCase() === q ||
        (r.chaves || '').trim().toUpperCase() === q
    );
  }, [rows, siteSearchQuery]);

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

  const childFolders = useMemo(() => {
    const list = ericssonFolders.filter((f) => f.parentId === effectiveFolderId);
    if (!searchQuery.trim()) return list;
    const q = searchQuery.trim().toLowerCase();
    return list.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.description || '').toLowerCase().includes(q) ||
        f.createdByName.toLowerCase().includes(q)
    );
  }, [ericssonFolders, effectiveFolderId, searchQuery]);

  const displayedFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base =
      isAtRootVistorias || q
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
        (fl.ocSitePre || '').toLowerCase().includes(q) ||
        (fl.notes || '').toLowerCase().includes(q)
      );
    });
  }, [
    ericssonFiles,
    ericssonFolders,
    effectiveFolderId,
    searchQuery,
    uploaderFilter,
    isAtRootVistorias,
  ]);

  const uniqueUploaders = useMemo(() => {
    const set = new Set<string>();
    ericssonFiles.forEach((f) => {
      if (f.uploadedByName) set.add(f.uploadedByName);
    });
    return Array.from(set).sort();
  }, [ericssonFiles]);

  const getFolderStats = (folderId: string) => {
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
    const directSubfolders = ericssonFolders.filter((f) => f.parentId === folderId).length;
    const totalFiles = ericssonFiles.filter((fl) => descendantIds.has(fl.folderId)).length;
    return { directSubfolders, totalFiles };
  };

  const mainVistoriasSubfolders = useMemo(() => {
    if (!rootVistoriasFolder) return [];
    return ericssonFolders.filter((f) => f.parentId === rootVistoriasFolder.id);
  }, [ericssonFolders, rootVistoriasFolder]);

  const getFolderPathLabel = (folderId: string): string => {
    const parts: string[] = [];
    let curr = ericssonFolders.find((f) => f.id === folderId);
    const seen = new Set<string>();
    while (curr && !seen.has(curr.id)) {
      seen.add(curr.id);
      parts.unshift(curr.name);
      curr = curr.parentId ? ericssonFolders.find((f) => f.id === curr!.parentId) : undefined;
    }
    return parts.join(' / ');
  };

  const openCreateFolderModal = (parentId?: string) => {
    if (isExecutor || isVistoriador) return;
    const targetParent = parentId || effectiveFolderId || 'folder-ericsson-root';
    setNewFolderParentId(targetParent);
    setNewFolderName('');
    setNewFolderDescription('');
    setFolderError(null);
    setNewFolderModalOpen(true);
  };

  const openUploadModal = (
    targetFolderId?: string,
    defaultCategory: 'VISTORIA' | 'LOS' | 'TSSR' = 'VISTORIA'
  ) => {
    const candidateId = targetFolderId || effectiveFolderId;
    const candidateFolder = ericssonFolders.find((f) => f.id === candidateId);
    const safeTargetId = candidateFolder
      ? candidateFolder.id
      : uploadableFolders[0]?.id || 'folder-ericsson-root';

    const resolvedCategory: 'VISTORIA' | 'LOS' | 'TSSR' = isExecutor
      ? 'TSSR'
      : isVistoriador && defaultCategory === 'TSSR'
        ? 'VISTORIA'
        : defaultCategory;

    setUploadTargetFolderId(safeTargetId);
    setUploadCategory(resolvedCategory);
    setSelectedSiteSide('A');
    setSelectedRowId('');
    setSiteSearchQuery('');
    setCreateNewRowMode(false);
    setNewRowChaves('');
    setNewRowSiteIdA('');
    setNewRowSiteIdB('');
    setNewRowCidadeA('');
    setNewRowCidadeB('');
    setNewRowEquipe(user.equipe || '');
    setUploadedFolderName('');
    setUploadNotes(
      resolvedCategory === 'TSSR'
        ? '[TSSR] Enviado pelo Executor para Coordenação de Engenharia Ericsson'
        : ''
    );
    setPendingFiles([]);
    setUploadError(null);
    setUploadModalOpen(true);
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
        `Pasta Ericsson "${data.folder.name}" criada com sucesso!`,
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

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);

    if (isVistoriador && uploadCategory === 'TSSR') {
      setUploadError(
        'O perfil Vistoriador não tem permissão para subir TSSR. Apenas o Executor pode subir TSSR.'
      );
      return;
    }
    if (isExecutor && uploadCategory !== 'TSSR') {
      setUploadError(
        'O perfil Executor não tem permissão para subir Vistoria ou LOS. O Executor pode subir apenas TSSR.'
      );
      return;
    }

    if (!selectedRowId && !createNewRowMode) {
      setUploadError(
        'É obrigatório vincular um Site ID (A ou B) da planilha Ericsson antes de enviar o arquivo.'
      );
      return;
    }

    if (createNewRowMode && !newRowSiteIdA.trim() && !newRowSiteIdB.trim()) {
      setUploadError('Informe o Site ID para criar a nova linha na planilha Ericsson.');
      return;
    }

    if (pendingFiles.length === 0) {
      setUploadError('Selecione pelo menos um arquivo (.ZIP, WinRAR .RAR ou documento).');
      return;
    }

    // Determine targetSide ('A', 'B', 'LOS', or 'TSSR') and linkedSiteId
    const effectiveTargetSide: 'A' | 'B' | 'LOS' | 'TSSR' =
      uploadCategory === 'TSSR'
        ? 'TSSR'
        : uploadCategory === 'LOS'
          ? 'LOS'
          : selectedSiteSide;

    const linkedSiteId = createNewRowMode
      ? selectedSiteSide === 'B' && newRowSiteIdB.trim()
        ? newRowSiteIdB.trim().toUpperCase()
        : newRowSiteIdA.trim().toUpperCase()
      : selectedRow
      ? selectedSiteSide === 'B' && selectedRow.siteIdB
        ? selectedRow.siteIdB
        : selectedRow.siteIdA || selectedRow.siteIdB
      : '';

    setUploading(true);
    try {
      const res = await fetch('/api/ericsson/vistoria/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId: createNewRowMode ? undefined : selectedRowId,
          targetSide: effectiveTargetSide,
          linkedSiteId,
          folderId: uploadTargetFolderId || 'folder-ericsson-root',
          createNewRow: createNewRowMode,
          newRowData: createNewRowMode
            ? {
                chaves: newRowChaves.trim(),
                state: newRowState.trim().toUpperCase(),
                siteIdA: newRowSiteIdA.trim().toUpperCase(),
                siteIdB: newRowSiteIdB.trim().toUpperCase(),
                cidadeA: newRowCidadeA.trim(),
                cidadeB: newRowCidadeB.trim(),
                equipe: newRowEquipe.trim(),
              }
            : undefined,
          files: pendingFiles,
          notes: uploadNotes.trim() || undefined,
          uploadedFolderName: uploadedFolderName.trim() || undefined,
          uploadedByName: user.name,
          uploadedByEmail: user.email,
          uploadedByRole: effectiveRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || 'Erro ao carregar arquivo.');
        return;
      }

      const updatedRow = data.row as EricssonRow;
      let toastMessage = '';
      if (effectiveTargetSide === 'TSSR') {
        toastMessage = `TSSR vinculado ao site ${linkedSiteId} enviado por ${user.name} na pasta Ericsson!`;
      } else if (effectiveTargetSide === 'A') {
        toastMessage = `Vistoria A (${updatedRow?.siteIdA || linkedSiteId}) marcada como Entregue e Vistoria B (${updatedRow?.siteIdB || '—'}) marcada como Dispensado!`;
      } else if (effectiveTargetSide === 'B') {
        toastMessage = `Vistoria B (${updatedRow?.siteIdB || linkedSiteId}) marcada como Entregue e Vistoria A (${updatedRow?.siteIdA || '—'}) marcada como Dispensado!`;
      } else {
        toastMessage = `LOS vinculado ao site ${linkedSiteId} marcado como Entregue na planilha Ericsson!`;
      }

      onUpdated(
        data.ericssonRows || rows,
        data.ericssonSheetMeta || sheetMeta,
        toastMessage,
        data.ericssonFolders,
        data.ericssonFiles
      );

      setCurrentFolderId(data.file?.folderId || uploadTargetFolderId || 'folder-ericsson-root');
      if (data.file?.id) {
        setHighlightedFileId(data.file.id);
      }
      setUploadModalOpen(false);
      setPendingFiles([]);
      setUploadedFolderName('');
    } catch {
      setUploadError('Erro de conexão ao enviar arquivo.');
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
      const res = await fetch(`/api/ericsson/folders/${encodeURIComponent(editingFolder.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editFolderName.trim(),
          description: editFolderDescription.trim(),
          actorName: user.name,
          actorEmail: user.email,
          actorRole: effectiveRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditFolderError(data.error || 'Não foi possível modificar a pasta.');
        return;
      }
      onUpdated(
        rows,
        sheetMeta,
        `Pasta "${editFolderName.trim()}" modificada com sucesso!`,
        data.ericssonFolders,
        data.ericssonFiles
      );
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
      const res = await fetch(`/api/ericsson/files/${encodeURIComponent(editingFile.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: editFileReplacement ? editFileReplacement.fileName : editFileName.trim(),
          fileSize: editFileReplacement ? editFileReplacement.fileSize : undefined,
          base64Data: editFileReplacement ? editFileReplacement.base64Data : undefined,
          notes: editFileNotes.trim(),
          siteId: editFileSiteId.trim().toUpperCase(),
          actorName: user.name,
          actorEmail: user.email,
          actorRole: effectiveRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditFileError(data.error || 'Não foi possível modificar o arquivo.');
        return;
      }
      onUpdated(
        rows,
        sheetMeta,
        `Arquivo "${data.file?.fileName || editFileName.trim()}" modificado com sucesso!`,
        data.ericssonFolders,
        data.ericssonFiles
      );
      setEditingFile(null);
      setEditFileReplacement(null);
    } catch {
      setEditFileError('Falha de conexão ao modificar arquivo.');
    } finally {
      setSavingFileEdit(false);
    }
  };

  const handleDeleteFolder = async (folder: EngineeringFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canModifyFolder(folder)) return;
    try {
      const q = new URLSearchParams({
        actorEmail: user.email || '',
        actorName: user.name || '',
        actorRole: effectiveRole,
      });
      const res = await fetch(
        `/api/ericsson/folders/${encodeURIComponent(folder.id)}?${q.toString()}`,
        {
          method: 'DELETE',
        }
      );
      if (res.ok) {
        const data = await res.json();
        onUpdated(
          data.ericssonRows || rows,
          sheetMeta,
          `Pasta "${folder.name}" removida da Ericsson.`,
          data.ericssonFolders,
          data.ericssonFiles
        );
        if (currentFolderId === folder.id && folder.parentId) {
          setCurrentFolderId(folder.parentId);
        }
      }
    } catch {
      // ignore
    }
  };

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
        {
          method: 'DELETE',
        }
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

  const handleBulkDeleteFiles = async () => {
    if (selectedFileIds.length === 0) return;
    setDeletingBulk(true);
    try {
      let latestRows = rows;
      let latestFolders = folders;
      let latestFiles = files;
      const q = new URLSearchParams({
        actorEmail: user.email || '',
        actorName: user.name || '',
        actorRole: effectiveRole,
      });
      for (const fid of selectedFileIds) {
        const res = await fetch(
          `/api/ericsson/files/${encodeURIComponent(fid)}?${q.toString()}`,
          {
            method: 'DELETE',
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.ericssonRows)) latestRows = data.ericssonRows;
          if (Array.isArray(data.ericssonFolders)) latestFolders = data.ericssonFolders;
          if (Array.isArray(data.ericssonFiles)) latestFiles = data.ericssonFiles;
        }
      }
      const count = selectedFileIds.length;
      setSelectedFileIds([]);
      onUpdated(
        latestRows,
        sheetMeta,
        `${count} arquivo(s) excluído(s) com sucesso da Ericsson!`,
        latestFolders,
        latestFiles
      );
    } finally {
      setDeletingBulk(false);
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

  return (
    <div className="space-y-4">
      {/* =====================================================================
          VISTORIADOR SITE-ASSOCIATED FILES NOTIFICATION BANNER (ERICSSON)
         ===================================================================== */}
      {isVistoriador && (
        <div
          className={`rounded-xl p-4 border shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs ${
            ericssonFiles.length > 0
              ? 'bg-teal-50/90 border-teal-300 text-teal-950'
              : 'bg-slate-50 border-slate-200 text-slate-700'
          }`}
        >
          <div className="flex items-start sm:items-center gap-3">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                ericssonFiles.length > 0
                  ? 'bg-teal-600 text-white border-teal-700'
                  : 'bg-white text-slate-500 border-slate-200'
              }`}
            >
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <div className="font-bold text-xs flex items-center gap-2 flex-wrap">
                <span>
                  {ericssonFiles.length > 0
                    ? `Notificação de Vistoria Ericsson: Você possui ${ericssonFiles.length} arquivo(s) associado(s) ao(s) site(s) sob sua responsabilidade!`
                    : 'Filtro de Vistoriador Ativo: Exibindo apenas arquivos associados aos sites sob sua responsabilidade'}
                </span>
                <span className="px-2 py-0.5 rounded bg-white/80 border border-teal-200 text-[10px] font-mono font-bold text-teal-900">
                  {responsibleRows.length} enlace(s)/site(s) sob sua responsabilidade
                </span>
              </div>
              <p className="text-[11px] opacity-85 mt-0.5">
                {ericssonFiles.length > 0 ? (
                  <>
                    Sites com arquivos associados:{' '}
                    <strong className="font-mono">
                      {Array.from(
                        new Set(
                          ericssonFiles
                            .map((f) => (f.siteId || '').trim().toUpperCase())
                            .filter(Boolean)
                        )
                      ).join(', ') || 'Seus sites'}
                    </strong>
                    . Você só pode excluir pastas e arquivos enviados por você.
                  </>
                ) : (
                  <>
                    No momento não há arquivos carregados para os{' '}
                    <strong>{responsibleRows.length}</strong> site(s) atribuídos a{' '}
                    <strong>{user.equipe || user.name}</strong>. Você só verá arquivos que estiverem associados aos sites que você está responsável por fazer.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TOP HEADER CARD: PASTA VISTORIAS & LOS (ERICSSON)
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-500 shrink-0">
              <FolderOpen className="w-6 h-6 fill-amber-400/80 text-amber-600" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-[#223585]">
                  {isExecutor ? 'TSSR (Engenharia) · ERICSSON' : 'Vistoria & LOS · ERICSSON'}
                </span>
                <span className="text-slate-300">•</span>
                <h1 className="text-base font-bold text-slate-900">
                  {isExecutor
                    ? `Envio de TSSR (Engenharia) — ${isAtRootVistorias ? 'Pastas Ericsson' : activeFolder?.name}`
                    : `Envio de Vistoria (Site A ou B) e LOS — ${
                        isAtRootVistorias ? 'Pastas de Vistoria' : activeFolder?.name
                      }`}
                </h1>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isExecutor ? (
                  <>
                    Suba o pacote de <strong>TSSR (Engenharia)</strong> vinculando ao{' '}
                    <strong>Site ID A</strong> ou <strong>Site ID B</strong> da planilha Ericsson.
                    (Apenas o Executor tem acesso para subir TSSR).
                  </>
                ) : (
                  <>
                    Suba o arquivo em Vistoria vinculando ao <strong>Site ID A</strong> ou{' '}
                    <strong>Site ID B</strong>: ao entregar <strong>Vistoria A</strong>, o{' '}
                    <strong>B</strong> fica automaticamente como{' '}
                    <strong className="text-sky-700">Dispensado</strong> (e vice-versa). No{' '}
                    <strong>LOS</strong>, vincule ao Site ID para marcar o LOS como{' '}
                    <strong className="text-emerald-700">Entregue</strong>.
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="w-full sm:w-auto flex flex-wrap items-center gap-2">
            {!isVistoriador && onOpenSitesTab && (
              <button
                type="button"
                onClick={onOpenSitesTab}
                className="flex-1 sm:flex-initial justify-center px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-[#223585] shrink-0" />
                <span>Ver Planilha Mãe (Sites)</span>
              </button>
            )}

            {canCreateFolders && (
              <button
                type="button"
                onClick={() => openCreateFolderModal(effectiveFolderId)}
                className="flex-1 sm:flex-initial justify-center px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <FolderPlus className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Nova Pasta Ericsson</span>
              </button>
            )}

            {canUploadTssr && (
              <button
                type="button"
                onClick={() => {
                  openUploadModal(effectiveFolderId, 'TSSR');
                }}
                className="w-full sm:w-auto justify-center px-4 py-3.5 sm:py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-black uppercase tracking-wide rounded-xl sm:rounded-lg transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>Subir TSSR (Engenharia)</span>
              </button>
            )}

            {canUploadVistoria && (
              <>
                <button
                  type="button"
                  onClick={() => openUploadModal(effectiveFolderId, 'VISTORIA')}
                  className="w-full sm:w-auto justify-center px-4 py-3.5 sm:py-2 bg-[#223585] hover:bg-[#1a2865] text-white text-xs font-black uppercase tracking-wide rounded-xl sm:rounded-lg transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  <span>Subir Vistoria (Vincular Site A ou B)</span>
                </button>

                <button
                  type="button"
                  onClick={() => openUploadModal(effectiveFolderId, 'LOS')}
                  className="w-full sm:w-auto justify-center px-4 py-3.5 sm:py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-wide rounded-xl sm:rounded-lg transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
                >
                  <Radio className="w-4 h-4 shrink-0" />
                  <span>Subir Arquivo de LOS (Vincular Site ID)</span>
                </button>
              </>
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
                <span>Pasta Vistorias</span>
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

          {/* Search & Uploader Filter */}
          <div className="w-full sm:w-auto flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar pasta, arquivo .zip/.rar, Site ID..."
                className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
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
      </div>

      {/* =====================================================================
          EXPLORER CARD: BREADCRUMBS + SUBFOLDERS + FILES TABLE
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
        {/* Breadcrumb Path Header */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs flex-wrap">
            <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider mr-1">
              Local:
            </span>
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.id}>
                  <button
                    type="button"
                    onClick={() => setCurrentFolderId(crumb.id)}
                    className={`px-2 py-1 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                      isLast
                        ? 'bg-blue-50 text-blue-800 font-bold border border-blue-200/70'
                        : 'text-slate-600 hover:bg-slate-200/70 font-medium'
                    }`}
                  >
                    <Folder className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                    <span>{crumb.name}</span>
                  </button>
                  {!isLast && <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                </React.Fragment>
              );
            })}
          </div>

          <div className="text-[11px] text-slate-500 font-mono">
            {childFolders.length} pasta(s) • {displayedFiles.length} arquivo(s)
          </div>
        </div>

        {/* Subfolders Grid */}
        {childFolders.length > 0 && (
          <div className="p-5 border-b border-slate-100">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">
              Pastas ({childFolders.length})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {childFolders.map((folder) => {
                const stats = getFolderStats(folder.id);
                const canModifyThisFolder = canModifyFolder(folder);
                const isOwnFolder = isFolderUploadedByCurrentUser(folder);
                return (
                  <div
                    key={folder.id}
                    onClick={() => setCurrentFolderId(folder.id)}
                    className="group p-3.5 rounded-xl border border-slate-200 hover:border-blue-400 bg-white hover:bg-blue-50/30 transition-all cursor-pointer flex items-start justify-between gap-2 shadow-2xs"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <Folder className="w-5 h-5 text-amber-500 fill-amber-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-slate-900 truncate group-hover:text-blue-700 flex items-center gap-1.5 flex-wrap">
                          <span className="truncate">{folder.name}</span>
                          {(isExecutor || isVistoriador) && isOwnFolder && (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                              Sua pasta
                            </span>
                          )}
                          {(isExecutor || isVistoriador) && !isOwnFolder && (
                            <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-slate-100 text-slate-500 rounded border border-slate-200 inline-flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" />
                              <span>Leitura</span>
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {stats.directSubfolders} subpasta(s) · {stats.totalFiles} arq
                        </div>
                        {folder.description && (
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">
                            {folder.description}
                          </div>
                        )}
                      </div>
                    </div>

                    {canModifyThisFolder && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => openEditFolderModal(folder, e)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
                          title="Modificar pasta enviada"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteFolder(folder, e)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                          title="Remover pasta"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Files Table inside current folder or across all Ericsson Vistoria folders */}
        <div>
          <div className="px-5 py-3 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-700">
                {isAtRootVistorias
                  ? `Todos os Arquivos Carregados na Ericsson (${displayedFiles.length})`
                  : `Arquivos Carregados na Pasta (${displayedFiles.length})`}
              </span>
              {highlightedFileId && (
                <button
                  type="button"
                  onClick={() => setHighlightedFileId(null)}
                  className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold cursor-pointer"
                >
                  Destaque ativo (limpar)
                </button>
              )}
              {selectedFileIds.length > 0 && (
                <button
                  type="button"
                  disabled={deletingBulk}
                  onClick={handleBulkDeleteFiles}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    {deletingBulk
                      ? 'Excluindo...'
                      : `Excluir Selecionados (${selectedFileIds.length})`}
                  </span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canUploadTssr && (
                <button
                  type="button"
                  onClick={() => openUploadModal(effectiveFolderId, 'TSSR')}
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Subir TSSR</span>
                </button>
              )}
              {canUploadVistoria && (
                <>
                  <button
                    type="button"
                    onClick={() => openUploadModal(effectiveFolderId, 'VISTORIA')}
                    className="px-3 py-1.5 bg-[#223585] hover:bg-[#1a2865] text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Subir Vistoria (Site A ou B)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openUploadModal(effectiveFolderId, 'LOS')}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>Subir LOS</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {displayedFiles.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <FileArchive className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="text-xs font-semibold text-slate-600">
                Nenhum arquivo carregado ainda.
              </div>
              <p className="text-[11px] text-slate-400">
                Use os botões acima para enviar um arquivo de Vistoria (Site A ou B) ou de LOS.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-3 px-4 w-9">
                      <input
                        type="checkbox"
                        checked={
                          displayedFiles.filter((f) => canModifyFile(f)).length > 0 &&
                          selectedFileIds.length ===
                            displayedFiles.filter((f) => canModifyFile(f)).length
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedFileIds(
                              displayedFiles.filter((f) => canModifyFile(f)).map((f) => f.id)
                            );
                          } else {
                            setSelectedFileIds([]);
                          }
                        }}
                        className="rounded border-slate-300 cursor-pointer"
                        title="Selecionar todos os arquivos editáveis"
                      />
                    </th>
                    <th className="py-3 px-4">Arquivo / Pacote</th>
                    <th className="py-3 px-3">Formato</th>
                    <th className="py-3 px-4">Site ID Vinculado (Ericsson)</th>
                    <th className="py-3 px-4">Enviado por (Perfil)</th>
                    <th className="py-3 px-4">Data / Hora</th>
                    <th className="py-3 px-4">Tamanho</th>
                    <th className="py-3 px-5 text-right">Ações no Arquivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {displayedFiles.map((file) => {
                    const isHighlighted = highlightedFileId === file.id;
                    const isChecked = selectedFileIds.includes(file.id);
                    const isLosFile =
                      (file.siteId || '').includes('[LOS]') ||
                      (file.notes || '').toUpperCase().includes('LOS');
                    return (
                      <tr
                        key={file.id}
                        className={`transition-colors ${
                          isHighlighted
                            ? 'bg-emerald-50/90 ring-2 ring-inset ring-emerald-500'
                            : isChecked
                            ? 'bg-red-50/30'
                            : 'hover:bg-slate-50/90'
                        }`}
                      >
                        <td className="py-3 px-4">
                          {canModifyFile(file) ? (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedFileIds((prev) => [...prev, file.id]);
                                } else {
                                  setSelectedFileIds((prev) =>
                                    prev.filter((id) => id !== file.id)
                                  );
                                }
                              }}
                              className="rounded border-slate-300 cursor-pointer"
                            />
                          ) : (
                            <Lock className="w-3.5 h-3.5 text-slate-300" />
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            {renderFileTypeIcon(file)}
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 truncate max-w-xs flex items-center gap-2">
                                <span>{file.fileName}</span>
                                {isHighlighted && (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold shrink-0">
                                    Arquivo selecionado da Planilha
                                  </span>
                                )}
                              </div>
                              {file.notes && (
                                <div className="text-[11px] text-slate-500 truncate max-w-xs">
                                  {file.notes}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3">{renderFormatBadge(file)}</td>
                        <td className="py-3 px-4">
                          {file.siteId ? (
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-xs font-bold ${
                                isLosFile
                                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              }`}
                            >
                              <CheckCircle2
                                className={`w-3.5 h-3.5 ${
                                  isLosFile ? 'text-amber-600' : 'text-emerald-600'
                                }`}
                              />
                              <span>{file.siteId}</span>
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
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
                              href={`/api/ericsson/files/${encodeURIComponent(file.id)}/view`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg transition-colors inline-flex items-center gap-1"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Abrir</span>
                            </a>
                            <a
                              href={`/api/ericsson/files/${encodeURIComponent(file.id)}/download`}
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
                                  className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer"
                                  title="Excluir arquivo"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Excluir</span>
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
          )}
        </div>
      </div>

      {/* =====================================================================
          MODAL 1: CRIAR NOVA SUBPASTA
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
                <h3 className="text-sm font-bold text-slate-900">Criar Nova Pasta</h3>
              </div>
              <button
                type="button"
                onClick={() => setNewFolderModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFolderSubmit} className="p-5 space-y-4 text-xs">
              {folderError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{folderError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Pasta Pai (Local onde será criada)
                </label>
                <select
                  value={newFolderParentId}
                  onChange={(e) => setNewFolderParentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                >
                  {creatableParentFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {getFolderPathLabel(f.id)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nome da Nova Pasta *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Ex: SP - São Paulo, Lote Ericsson..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Descrição / Observação (Opcional)
                </label>
                <input
                  type="text"
                  value={newFolderDescription}
                  onChange={(e) => setNewFolderDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewFolderModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingFolder}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg cursor-pointer"
                >
                  {creatingFolder ? 'Criando...' : 'Criar Pasta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: SUBIR VISTORIA (SITE ID A OU B -> OUTRO FICA DISPENSADO) OU SUBIR LOS
         ===================================================================== */}
      {uploadModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setUploadModalOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <Upload className="w-5 h-5 text-[#223585]" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {uploadCategory === 'TSSR'
                      ? 'Subir TSSR (Engenharia — Vincular ao Site ID)'
                      : uploadCategory === 'LOS'
                        ? 'Subir Arquivo de LOS (Vincular ao Site ID)'
                        : 'Subir Arquivo de Vistoria (Vincular ao Site ID A ou B)'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {uploadCategory === 'TSSR'
                      ? 'Exclusivo para Executor: vincula o pacote TSSR ao Site ID da planilha Ericsson'
                      : uploadCategory === 'LOS'
                        ? 'Liga o LOS com o ID do site e marca a coluna LOS como Entregue na planilha'
                        : 'Se entregar Vistoria A, o B fica como Dispensado. Se entregar Vistoria B, o A fica como Dispensado.'}
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

            <form onSubmit={handleUploadSubmit} className="p-5 space-y-4 overflow-y-auto text-xs">
              {uploadError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* 1. Category Selector: Vistoria vs LOS vs TSSR (role-gated) */}
              <div>
                <label className="block font-bold text-slate-800 mb-1.5">
                  1. Qual tipo de arquivo você está enviando? *
                </label>
                <div
                  className={`grid gap-2.5 ${
                    canUploadVistoria && canUploadTssr
                      ? 'grid-cols-1 sm:grid-cols-3'
                      : canUploadVistoria
                        ? 'grid-cols-1 sm:grid-cols-2'
                        : 'grid-cols-1'
                  }`}
                >
                  {canUploadVistoria && (
                    <>
                      <button
                        type="button"
                        onClick={() => setUploadCategory('VISTORIA')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          uploadCategory === 'VISTORIA'
                            ? 'bg-blue-50 border-[#223585] text-[#223585] ring-1 ring-[#223585]/20'
                            : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <div className="font-bold text-xs flex items-center justify-between">
                          <span>Vistoria (Site A ou B)</span>
                          {uploadCategory === 'VISTORIA' && (
                            <CheckCircle2 className="w-4 h-4 text-[#223585]" />
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Marca o site escolhido como <strong>Entregue</strong> e o outro como{' '}
                          <strong>Dispensado</strong>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setUploadCategory('LOS')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          uploadCategory === 'LOS'
                            ? 'bg-amber-50 border-amber-600 text-amber-900 ring-1 ring-amber-500/20'
                            : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <div className="font-bold text-xs flex items-center justify-between">
                          <span>Arquivo de LOS</span>
                          {uploadCategory === 'LOS' && (
                            <CheckCircle2 className="w-4 h-4 text-amber-600" />
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Liga o LOS com o ID do site e coloca a coluna LOS como{' '}
                          <strong>Entregue</strong>
                        </div>
                      </button>
                    </>
                  )}

                  {canUploadTssr && (
                    <button
                      type="button"
                      onClick={() => {
                        setUploadCategory('TSSR');
                        if (!uploadNotes.trim()) {
                          setUploadNotes(
                            '[TSSR] Enviado pelo Executor para Coordenação de Engenharia Ericsson'
                          );
                        }
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        uploadCategory === 'TSSR'
                          ? 'bg-purple-50 border-purple-600 text-purple-950 ring-1 ring-purple-500/20'
                          : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center justify-between">
                        <span>TSSR (Engenharia)</span>
                        {uploadCategory === 'TSSR' && (
                          <CheckCircle2 className="w-4 h-4 text-purple-600" />
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Exclusivo para <strong>Executor</strong>: envia pacote de TSSR vinculado ao
                        Site ID
                      </div>
                    </button>
                  )}
                </div>
              </div>

              {/* Destination Folder Selector */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Pasta de Destino (Exclusiva Ericsson) *
                </label>
                <select
                  value={uploadTargetFolderId}
                  onChange={(e) => setUploadTargetFolderId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-medium"
                >
                  {uploadableFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {getFolderPathLabel(f.id)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Locked Profile Uploader Name */}
              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl space-y-1">
                <div className="font-bold text-blue-950 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-blue-600" />
                    <span>Responsável pelo Carregamento</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded">
                    <Lock className="w-3 h-3" />
                    <span>Automático</span>
                  </span>
                </div>
                <div className="w-full px-3 py-1.5 bg-slate-100/90 border border-blue-200 rounded-lg font-bold text-slate-800 flex items-center justify-between select-none">
                  <span>{user.name}</span>
                  <span className="text-[11px] font-normal text-slate-500">{user.email}</span>
                </div>
              </div>

              {/* 2. Link Site ID A or Site ID B */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block font-bold text-slate-900">
                    2. Buscar e Linkar Site ID A ou Site ID B *
                  </label>
                  {selectedRow && !createNewRowMode && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono text-[11px] font-bold">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>
                        {selectedRow.siteIdA} ↔ {selectedRow.siteIdB}
                      </span>
                    </span>
                  )}
                </div>

                {!createNewRowMode ? (
                  <>
                    <div className="relative">
                      <div className="flex items-center bg-white border border-slate-300 rounded-lg px-3 py-2 focus-within:border-[#223585]">
                        <Search className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
                        <input
                          type="text"
                          value={siteSearchQuery}
                          onFocus={() => setSiteDropdownOpen(true)}
                          onChange={(e) => {
                            const val = e.target.value.toUpperCase();
                            setSiteSearchQuery(val);
                            setSiteDropdownOpen(true);
                            const cleanVal = val.trim();
                            const exactRowA = rows.find(
                              (r) => r.siteIdA.trim().toUpperCase() === cleanVal
                            );
                            const exactRowB = rows.find(
                              (r) => r.siteIdB.trim().toUpperCase() === cleanVal
                            );
                            const exactChave = rows.find(
                              (r) => r.chaves.trim().toUpperCase() === cleanVal
                            );

                            if (exactRowA) {
                              setSelectedRowId(exactRowA.id);
                              setSelectedSiteSide('A');
                            } else if (exactRowB) {
                              setSelectedRowId(exactRowB.id);
                              setSelectedSiteSide('B');
                            } else if (exactChave) {
                              setSelectedRowId(exactChave.id);
                            } else {
                              setSelectedRowId('');
                            }
                          }}
                          placeholder="Digite o Site ID A, Site ID B ou Chave da planilha Ericsson..."
                          className="w-full text-xs font-mono font-bold text-slate-900 placeholder-slate-400 focus:outline-none"
                        />
                        {siteSearchQuery && (
                          <button
                            type="button"
                            onClick={() => {
                              setSiteSearchQuery('');
                              setSelectedRowId('');
                            }}
                            className="text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {siteDropdownOpen && matchingRows.length > 0 && (
                        <div className="mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg divide-y divide-slate-100 z-50">
                          {matchingRows.map((r) => {
                            const isSelected = selectedRowId === r.id;
                            const qUpper = siteSearchQuery.trim().toUpperCase();
                            const matchedB =
                              qUpper &&
                              r.siteIdB.toUpperCase().includes(qUpper) &&
                              !r.siteIdA.toUpperCase().includes(qUpper);

                            return (
                              <div
                                key={r.id}
                                className={`px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2 ${
                                  isSelected ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="font-mono font-bold text-slate-900 flex items-center gap-1.5">
                                    <span className="text-[#223585]">{r.siteIdA || '—'}</span>
                                    <ArrowLeftRight className="w-3 h-3 text-slate-400" />
                                    <span className="text-[#1E8E8D]">{r.siteIdB || '—'}</span>
                                    {r.chaves && (
                                      <span className="font-normal text-slate-500">
                                        · {r.chaves}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500 truncate">
                                    {r.state || '—'} · {r.cidadeA || '—'} / {r.cidadeB || '—'} ·{' '}
                                    {r.equipe || 'Sem equipe'}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {r.siteIdA && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedRowId(r.id);
                                        setSelectedSiteSide('A');
                                        setSiteSearchQuery(r.siteIdA);
                                        setSiteDropdownOpen(false);
                                      }}
                                      className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-[#223585] text-[#223585] hover:text-white border border-blue-200 font-mono text-[11px] font-bold transition-colors cursor-pointer"
                                    >
                                      Linkar A ({r.siteIdA})
                                    </button>
                                  )}
                                  {r.siteIdB && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedRowId(r.id);
                                        setSelectedSiteSide('B');
                                        setSiteSearchQuery(r.siteIdB);
                                        setSiteDropdownOpen(false);
                                      }}
                                      className={`px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-[#1E8E8D] text-[#1E8E8D] hover:text-white border border-teal-200 font-mono text-[11px] font-bold transition-colors cursor-pointer ${
                                        matchedB ? 'ring-2 ring-[#1E8E8D]' : ''
                                      }`}
                                    >
                                      Linkar B ({r.siteIdB})
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Choose Site ID A vs Site ID B once a row is selected */}
                    {selectedRow && (
                      <div className="pt-1 space-y-2">
                        <div className="text-[11px] font-bold text-slate-700">
                          {uploadCategory === 'VISTORIA'
                            ? 'Selecione qual Site está entregando a Vistoria (o outro ficará como Dispensado):'
                            : 'Selecione o Site ID vinculado a este arquivo de LOS:'}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedSiteSide('A')}
                            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                              selectedSiteSide === 'A'
                                ? 'bg-emerald-50 border-emerald-600 text-emerald-950 ring-1 ring-emerald-500/30'
                                : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between font-mono font-bold text-xs">
                              <span>Site A: {selectedRow.siteIdA || '—'}</span>
                              {selectedSiteSide === 'A' && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              )}
                            </div>
                            <div className="text-[10px] mt-1">
                              {uploadCategory === 'VISTORIA' ? (
                                <>
                                  <span className="font-bold text-emerald-700">
                                    Vistoria A = Entregue
                                  </span>{' '}
                                  ·{' '}
                                  <span className="font-bold text-sky-700">
                                    B = Dispensado
                                  </span>
                                </>
                              ) : (
                                <span className="font-bold text-amber-800">
                                  LOS vinculado a {selectedRow.siteIdA} = Entregue
                                </span>
                              )}
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setSelectedSiteSide('B')}
                            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                              selectedSiteSide === 'B'
                                ? 'bg-emerald-50 border-emerald-600 text-emerald-950 ring-1 ring-emerald-500/30'
                                : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between font-mono font-bold text-xs">
                              <span>Site B: {selectedRow.siteIdB || '—'}</span>
                              {selectedSiteSide === 'B' && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              )}
                            </div>
                            <div className="text-[10px] mt-1">
                              {uploadCategory === 'VISTORIA' ? (
                                <>
                                  <span className="font-bold text-emerald-700">
                                    Vistoria B = Entregue
                                  </span>{' '}
                                  ·{' '}
                                  <span className="font-bold text-sky-700">
                                    A = Dispensado
                                  </span>
                                </>
                              ) : (
                                <span className="font-bold text-amber-800">
                                  LOS vinculado a {selectedRow.siteIdB} = Entregue
                                </span>
                              )}
                            </div>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Offer to create new row if site doesn't exist */}
                    {siteSearchQuery.trim() && !exactMatchExists && !selectedRow && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-2">
                        <span className="text-amber-900">
                          O site <strong className="font-mono">{siteSearchQuery.trim()}</strong> não
                          foi encontrado na planilha.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setNewRowSiteIdA(siteSearchQuery.trim().toUpperCase());
                            setCreateNewRowMode(true);
                          }}
                          className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shrink-0 cursor-pointer flex items-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Criar Nova Linha</span>
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="p-3 bg-white border border-amber-300 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-800">
                        Nova Linha na Planilha Ericsson
                      </span>
                      <button
                        type="button"
                        onClick={() => setCreateNewRowMode(false)}
                        className="text-[11px] text-slate-500 hover:text-slate-800 underline cursor-pointer"
                      >
                        Voltar para busca
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">
                          01.21.Site ID A *
                        </label>
                        <input
                          type="text"
                          value={newRowSiteIdA}
                          onChange={(e) => setNewRowSiteIdA(e.target.value.toUpperCase())}
                          placeholder="Ex: SPABC01"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">
                          01.21.Site ID B
                        </label>
                        <input
                          type="text"
                          value={newRowSiteIdB}
                          onChange={(e) => setNewRowSiteIdB(e.target.value.toUpperCase())}
                          placeholder="Ex: SPABC02"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">
                          00.03.State (UF)
                        </label>
                        <input
                          type="text"
                          value={newRowState}
                          onChange={(e) => setNewRowState(e.target.value.toUpperCase())}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">EQUIPE</label>
                        <input
                          type="text"
                          value={newRowEquipe}
                          onChange={(e) => setNewRowEquipe(e.target.value)}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* File Picker */}
              <div className="space-y-2.5">
                <label className="block font-semibold text-slate-700 mb-1">
                  3. Selecione o Arquivo ou Pasta (
                  {uploadCategory === 'TSSR'
                    ? 'TSSR'
                    : uploadCategory === 'LOS'
                      ? 'LOS'
                      : 'Vistoria'}
                  ) *
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
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
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="py-4 px-3 border-2 border-dashed border-slate-300 hover:border-blue-600 rounded-xl bg-slate-50 hover:bg-blue-50/40 transition-colors flex flex-col items-center justify-center gap-1 cursor-pointer text-center"
                  >
                    <FileArchive className="w-6 h-6 text-blue-600" />
                    <span className="font-bold text-slate-800">
                      Selecionar Pacote (.ZIP / .RAR) ou Arquivos
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Pacotes .ZIP, WinRAR (.RAR), planilhas e PDFs
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="py-4 px-3 border-2 border-dashed border-amber-300 hover:border-amber-600 rounded-xl bg-amber-50/40 hover:bg-amber-50/80 transition-colors flex flex-col items-center justify-center gap-1 cursor-pointer text-center"
                  >
                    <FolderOpen className="w-6 h-6 text-amber-600" />
                    <span className="font-bold text-slate-800">
                      Subir Pasta Inteira do Computador
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Envia a pasta com todos os arquivos (editável por você)
                    </span>
                  </button>
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

                {pendingFiles.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {pendingFiles.map((pf, i) => (
                      <div
                        key={`${pf.fileName}-${i}`}
                        className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-emerald-900"
                      >
                        <span className="font-semibold truncate">{pf.fileName}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-[11px]">{formatBytes(pf.fileSize)}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))
                            }
                            className="text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Observações (Opcional)
                </label>
                <input
                  type="text"
                  value={uploadNotes}
                  onChange={(e) => setUploadNotes(e.target.value)}
                  placeholder="Ex: Relatório fotográfico e checklist completos..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className={`px-4 py-2 disabled:opacity-50 text-white font-bold rounded-lg flex items-center gap-1.5 cursor-pointer ${
                    uploadCategory === 'TSSR'
                      ? 'bg-purple-600 hover:bg-purple-700'
                      : uploadCategory === 'LOS'
                        ? 'bg-amber-600 hover:bg-amber-700'
                        : 'bg-[#223585] hover:bg-[#192868]'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {uploading
                      ? 'Enviando...'
                      : uploadCategory === 'TSSR'
                        ? `Enviar TSSR (Site ${selectedSiteSide})`
                        : uploadCategory === 'LOS'
                          ? 'Enviar LOS (Marcar Entregue)'
                          : `Enviar Vistoria Site ${selectedSiteSide} (Outro Dispensado)`}
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
                <h3 className="text-sm font-bold text-slate-900">Modificar Pasta Enviada</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingFolder(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditFolderSubmit} className="p-5 space-y-4 text-xs">
              {editFolderError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editFolderError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nome da Pasta *</label>
                <input
                  type="text"
                  required
                  value={editFolderName}
                  onChange={(e) => setEditFolderName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Descrição / Observação
                </label>
                <input
                  type="text"
                  value={editFolderDescription}
                  onChange={(e) => setEditFolderDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl flex items-center justify-between gap-2">
                <span className="text-blue-900 font-medium">
                  Deseja subir novos arquivos nesta pasta?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const targetId = editingFolder.id;
                    setEditingFolder(null);
                    openUploadModal(targetId, isExecutor ? 'TSSR' : 'VISTORIA');
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shrink-0 cursor-pointer flex items-center gap-1"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Subir Arquivos</span>
                </button>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingFolder(null)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingFolderEdit}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg cursor-pointer"
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

            <form onSubmit={handleEditFileSubmit} className="p-5 space-y-4 text-xs">
              {editFileError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editFileError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nome do Arquivo / Pacote *
                </label>
                <input
                  type="text"
                  required
                  value={editFileName}
                  onChange={(e) => setEditFileName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Site ID Vinculado
                </label>
                <input
                  type="text"
                  value={editFileSiteId}
                  onChange={(e) => setEditFileSiteId(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg font-mono font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Observações / Revisão
                </label>
                <input
                  type="text"
                  value={editFileNotes}
                  onChange={(e) => setEditFileNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Substituir Arquivo / Pacote (Opcional)
                </label>
                <input
                  ref={replaceFileInputRef}
                  type="file"
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
                  className="w-full py-2.5 px-3 border border-dashed border-purple-300 hover:border-purple-600 bg-purple-50/40 rounded-xl font-semibold text-purple-800 flex items-center justify-center gap-2 cursor-pointer"
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
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingFileEdit}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold rounded-lg cursor-pointer"
                >
                  {savingFileEdit ? 'Salvando...' : 'Salvar Modificações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
