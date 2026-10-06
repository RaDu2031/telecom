import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FolderKanban,
  Search,
  Plus,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  X,
  LayoutList,
  Table,
  Maximize2,
  Minimize2,
  Download,
  FileSpreadsheet,
  Upload,
  Cloud,
  CloudDownload,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Calendar,
  UserCheck,
  FileArchive,
  BarChart3,
  RefreshCw,
  Filter,
  Trash2,
  Folder,
  FolderOpen,
  ArrowLeft,
  Users,
} from 'lucide-react';
import {
  AmetaUser,
  UserRole,
  VendorType,
  TelecomSite,
  EngineeringFolder,
  EngineeringFile,
  TssrRow,
  TssrSheetMeta,
  TSSR_TIM_NOKIA_ORIGINAL_COLUMNS,
  TSSR_SYSTEM_COLUMNS,
  TSSR_ALL_COLUMNS,
  DEFAULT_ONEDRIVE_TSSR_URL,
  DEFAULT_ERICSSON_ENG_ONEDRIVE_URL,
} from '../types/telecom';
import { cloudFetch } from '../lib/firebaseCloud';

const fetch = cloudFetch;
import {
  parseTssrWorkbookBuffer,
  getTssrColumnValue,
  exportTssrRowsToXlsx,
  exportTssrRowsToCsv,
} from '../utils/tssrSpreadsheetUtils';
import {
  EngineeringInteractiveChart,
  EngineeringChartCategory,
  getEngenhariaCategory,
} from './EngineeringInteractiveChart';
import { GoogleDriveModal } from './GoogleDriveModal';
import { EngineeringVistoriasTab } from './EngineeringVistoriasTab';

interface EngineeringControlTabProps {
  user: AmetaUser;
  effectiveRole: UserRole;
  spreadsheetUrl?: string;
  simulatedTargetUser?: AmetaUser | null;
  onToggleSimulateUser?: (targetUser: AmetaUser | null) => void;
  users?: AmetaUser[];
  activeVendor: VendorType;
  onSwitchVendor: (v: VendorType) => void;
  folders: EngineeringFolder[];
  files: EngineeringFile[];
  sites: TelecomSite[];
  onFoldersAndFilesUpdated: (
    nextFolders: EngineeringFolder[],
    nextFiles: EngineeringFile[],
    toastMsg?: string,
    nextTssrRows?: TssrRow[],
    nextTssrSheets?: TssrSheetMeta[]
  ) => void;
  onSelectSiteId: (siteId: string) => void;
  tssrRows: TssrRow[];
  tssrSheets: TssrSheetMeta[];
  onTssrUpdated: (nextRows: TssrRow[], nextSheets?: TssrSheetMeta[], toastMsg?: string) => void;
  onNavigateToVistoria?: (preselectedSiteId?: string) => void;
}

// Columns shown in "Resumo" mode (grouped by section) + the 4 system columns
const RESUMO_ORIGINAL_COLUMNS: string[] = [
  'Oc Site Pre',
  'Enderecoid',
  'Site Id',
  'Reg',
  'UF',
  'Cidade',
  'PROJETO',
  'DETENTORA',
  'STATUS Engenharia',
  'TIPO DE DOC',
  'Prioridade Homero',
  'Executor',
  'Plan entrega',
  'RECEBIDO',
  'Status Financeiro',
];

// Columns shown exclusively for Executor:
// oc site pre, endereco id, site id, reg, uf, cidade, projeto, detentora, status engenharia, demanda recebida, tipo de doc, prioridade, pan entrega
const EXECUTOR_ORIGINAL_COLUMNS: string[] = [
  'Oc Site Pre',
  'Enderecoid',
  'Site Id',
  'Reg',
  'UF',
  'Cidade',
  'PROJETO',
  'DETENTORA',
  'STATUS Engenharia',
  'DEMANDA RECEBIDA',
  'TIPO DE DOC',
  'Prioridade Homero',
  'Plan entrega',
];

export const EngineeringControlTab: React.FC<EngineeringControlTabProps> = ({
  user,
  effectiveRole,
  spreadsheetUrl,
  simulatedTargetUser = null,
  onToggleSimulateUser,
  users = [],
  activeVendor,
  onSwitchVendor,
  folders = [],
  files = [],
  sites = [],
  onFoldersAndFilesUpdated,
  onSelectSiteId,
  tssrRows,
  tssrSheets,
  onTssrUpdated,
  onNavigateToVistoria,
}) => {
  const isAdmRole = effectiveRole === 'ADM';
  const isCoordenadorGeral = effectiveRole === 'Coordenador Geral';
  const isCoordenadorEngenharia = effectiveRole === 'Coordenador Engenharia';
  const isAdmin = isAdmRole || isCoordenadorGeral || isCoordenadorEngenharia;
  const isGestorEngenharia = isCoordenadorEngenharia || isCoordenadorGeral || isAdmRole || isAdmin;
  const isExecutor = effectiveRole === 'Executor';
  
  const engineeringUrl = spreadsheetUrl || (activeVendor === 'ERICSSON' 
    ? DEFAULT_ERICSSON_ENG_ONEDRIVE_URL 
    : DEFAULT_ONEDRIVE_TSSR_URL);
    
  const canUploadTssr =
    isExecutor ||
    isCoordenadorEngenharia ||
    isCoordenadorGeral ||
    isAdmRole;

  // Active Engineering Tab (starts on "TSSR TIM Nokia")
  const [activeSubTab, setActiveSubTab] = useState<'TSSR TIM Nokia'>('TSSR TIM Nokia');

  // State for opening "TSSR Entrada" or "TSSR" project folders in a dedicated full-page view
  const [openProjectFolderType, setOpenProjectFolderType] = useState<'TSSR Entrada' | 'TSSR' | null>(null);

  const vendorFolders = useMemo(
    () => folders.filter((f) => f.vendor === activeVendor),
    [folders, activeVendor]
  );

  const vendorFiles = useMemo(
    () => files.filter((fl) => fl.vendor === activeVendor),
    [files, activeVendor]
  );

  const tssrEntradaFolder = useMemo(
    () =>
      vendorFolders.find((f) => f.name === 'TSSR Entrada') || {
        id: `folder-${activeVendor.toLowerCase()}-tssr-entrada`,
        name: 'TSSR Entrada',
      },
    [vendorFolders, activeVendor]
  );

  const tssrFinalFolder = useMemo(
    () =>
      vendorFolders.find((f) => f.name === 'TSSR') || {
        id: `folder-${activeVendor.toLowerCase()}-tssr-final`,
        name: 'TSSR',
      },
    [vendorFolders, activeVendor]
  );

  const getProjectFolderStats = (folderId: string) => {
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

  const tssrEntradaStats = useMemo(
    () => getProjectFolderStats(tssrEntradaFolder.id),
    [tssrEntradaFolder.id, vendorFolders, vendorFiles]
  );

  const tssrFinalStats = useMemo(
    () => getProjectFolderStats(tssrFinalFolder.id),
    [tssrFinalFolder.id, vendorFolders, vendorFiles]
  );

  // Table Density & View Mode ("Resumo" vs "Planilha (41 col)") & Fullscreen
  const [tableDensity, setTableDensity] = useState<'comfortable' | 'compact' | 'ultra'>('compact');
  const [viewMode, setViewMode] = useState<'fluid' | 'grid'>('grid');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isFolderOpen, setIsFolderOpen] = useState<boolean>(true);
  const [showCharts, setShowCharts] = useState<boolean>(false);

  // Smart Search & Filter states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isAddFilterOpen, setIsAddFilterOpen] = useState<boolean>(false);
  const [vistoriaStatusFilter, setVistoriaStatusFilter] = useState<'ALL' | 'Entregue' | 'NAO_DISPONIVEL'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<EngineeringChartCategory>('ALL');
  const [engStatusFilter, setEngStatusFilter] = useState<string>('ALL');
  const [ufFilter, setUfFilter] = useState<string>('ALL');
  const [regFilter, setRegFilter] = useState<string>('ALL');
  const [executorFilter, setExecutorFilter] = useState<string>('ALL');
  const [projetoFilter, setProjetoFilter] = useState<string>('ALL');
  const [financeiroFilter, setFinanceiroFilter] = useState<string>('ALL');

  // Per-column checklist filter menu
  const [columnValueFilters, setColumnValueFilters] = useState<Record<string, string[]>>({});
  const [openColFilterMenu, setOpenColFilterMenu] = useState<{
    colName: string;
    top: number;
    left: number;
  } | null>(null);
  const [colMenuSearchText, setColMenuSearchText] = useState<string>('');

  // Excel Online / Upload TSSR Modal state
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [importTabMode, setImportTabMode] = useState<'file' | 'onedrive'>('file');
  const [oneDriveUrl, setOneDriveUrl] = useState<string>(engineeringUrl);
  const [importingTssr, setImportingTssr] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isGoogleDriveOpen, setIsGoogleDriveOpen] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // New Row Modal state
  const [isNewRowModalOpen, setIsNewRowModalOpen] = useState<boolean>(false);
  const [newRowSiteId, setNewRowSiteId] = useState<string>('');
  const [newRowOcSitePre, setNewRowOcSitePre] = useState<string>('');
  const [newRowEnderecoId, setNewRowEnderecoId] = useState<string>('');
  const [newRowUf, setNewRowUf] = useState<string>('');
  const [newRowCidade, setNewRowCidade] = useState<string>('');
  const [newRowReg, setNewRowReg] = useState<string>('');
  const [newRowProjeto, setNewRowProjeto] = useState<string>('');
  const [newRowStatusEng, setNewRowStatusEng] = useState<string>('TSSR Em Execução');
  const [newRowExecutor, setNewRowExecutor] = useState<string>('');
  const [creatingRow, setCreatingRow] = useState<boolean>(false);
  const [newRowError, setNewRowError] = useState<string | null>(null);

  // Selected Row Drawer for viewing/editing the 37 original columns
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [drawerDraftFields, setDrawerDraftFields] = useState<Record<string, string>>({});
  const [savingDrawer, setSavingDrawer] = useState<boolean>(false);

  // Vistoria File Deletion state (Gestor da Engenharia pode apagar, executor apenas os seus)
  const [vistoriaToDelete, setVistoriaToDelete] = useState<TssrRow | null>(null);
  const [deletingVistoria, setDeletingVistoria] = useState<boolean>(false);

  const canDeleteRowVistoria = (row: TssrRow): boolean => {
    if (isGestorEngenharia) return true;
    if (isExecutor) {
      const myName = (user.name || '').trim().toLowerCase();
      const myEmail = (user.email || '').trim().toLowerCase();
      const rowExec = (row.fields?.['Executor'] || '').trim().toLowerCase();
      const rowUploader = (row.vistoriaUploadedBy || '').trim().toLowerCase();
      const rowEmail = (row.vistoriaUploadedByEmail || '').trim().toLowerCase();
      return Boolean(
        (rowExec && rowExec === myName) ||
          (rowUploader && rowUploader === myName) ||
          (rowEmail && rowEmail === myEmail)
      );
    }
    return false;
  };

  const handleConfirmDeleteVistoria = async () => {
    if (!vistoriaToDelete || !vistoriaToDelete.vistoriaFileId) return;
    setDeletingVistoria(true);
    try {
      const q = new URLSearchParams({
        actorEmail: user.email || '',
        actorName: user.name || '',
        actorRole: effectiveRole,
      });
      const res = await fetch(
        `/api/engineering/files/${encodeURIComponent(vistoriaToDelete.vistoriaFileId)}?${q.toString()}`,
        {
          method: 'DELETE',
        }
      );
      if (res.ok) {
        const data = await res.json();
        onTssrUpdated(
          data.tssrRows || tssrRows,
          data.tssrSheets || tssrSheets,
          `Arquivo de vistoria do site ${vistoriaToDelete.siteId} apagado com sucesso!`
        );
        if (selectedRowId === vistoriaToDelete.id) {
          const updatedSelected = (data.tssrRows || tssrRows).find(
            (r: TssrRow) => r.id === vistoriaToDelete.id
          );
          if (updatedSelected) {
            setSelectedRowId(updatedSelected.id);
          }
        }
        setVistoriaToDelete(null);
      }
    } catch {
      // ignore
    } finally {
      setDeletingVistoria(false);
    }
  };

  // Escape key exits Fullscreen
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  // Rows belonging to the active tab ("TSSR TIM Nokia")
  const tabRows = useMemo(() => {
    return tssrRows.filter((r) => r.tabName === activeSubTab);
  }, [tssrRows, activeSubTab]);

  const activeSheetMeta = useMemo(() => {
    return tssrSheets.find((m) => m.tabName === activeSubTab) || tssrSheets[0];
  }, [tssrSheets, activeSubTab]);

  // Automatic status counters: STATUS Engenharia (A Fazer, Aguardando Aprovação, Concluídos, Cancelados)
  const engStats = useMemo(() => {
    let aFazer = 0;
    let aguardando = 0;
    let concluidos = 0;
    let cancelados = 0;
    tabRows.forEach((r) => {
      const cat = getEngenhariaCategory(r);
      if (cat === 'CANCELADO') cancelados++;
      else if (cat === 'AGUARDANDO') aguardando++;
      else if (cat === 'FEITO') concluidos++;
      else aFazer++;
    });
    return { aFazer, aguardando, concluidos, cancelados };
  }, [tabRows]);

  const totalCount = tabRows.length;
  const entreguesCount = useMemo(
    () => tabRows.filter((r) => r.vistoriaStatus === 'Entregue').length,
    [tabRows]
  );
  const naoDisponivelCount = useMemo(
    () => tabRows.filter((r) => r.vistoriaStatus !== 'Entregue').length,
    [tabRows]
  );
  const pendentesCount = naoDisponivelCount;

  // Filter options extracted dynamically from the TSSR rows
  const filterOptions = useMemo(() => {
    const engStatuses = new Set<string>();
    const ufs = new Set<string>();
    const regs = new Set<string>();
    const executores = new Set<string>();
    const projetos = new Set<string>();
    const financeiros = new Set<string>();

    tabRows.forEach((r) => {
      const st = (r.fields?.['STATUS Engenharia'] || '').trim();
      const uf = (r.fields?.['UF'] || '').trim().toUpperCase();
      const rg = (r.fields?.['Reg'] || '').trim().toUpperCase();
      const ex = (r.fields?.['Executor'] || '').trim();
      const pj = (r.fields?.['PROJETO'] || '').trim();
      const fn = (r.fields?.['Status Financeiro'] || '').trim();
      if (st) engStatuses.add(st);
      if (uf) ufs.add(uf);
      if (rg) regs.add(rg);
      if (ex) executores.add(ex);
      if (pj) projetos.add(pj);
      if (fn) financeiros.add(fn);
    });

    return {
      engStatuses: Array.from(engStatuses).sort(),
      ufs: Array.from(ufs).sort(),
      regs: Array.from(regs).sort(),
      executores: Array.from(executores).sort(),
      projetos: Array.from(projetos).sort(),
      financeiros: Array.from(financeiros).sort(),
    };
  }, [tabRows]);

  const searchTokens = useMemo(() => {
    const raw = searchTerm.trim();
    if (!raw) return [];
    return raw
      .split(/[\s,;|\n\r\t]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }, [searchTerm]);

  const hasActiveFilter =
    categoryFilter !== 'ALL' ||
    vistoriaStatusFilter !== 'ALL' ||
    engStatusFilter !== 'ALL' ||
    ufFilter !== 'ALL' ||
    regFilter !== 'ALL' ||
    executorFilter !== 'ALL' ||
    projetoFilter !== 'ALL' ||
    financeiroFilter !== 'ALL' ||
    Object.values(columnValueFilters).some((arr) => arr && arr.length > 0);

  const clearAllFilters = () => {
    setSearchTerm('');
    setCategoryFilter('ALL');
    setVistoriaStatusFilter('ALL');
    setEngStatusFilter('ALL');
    setUfFilter('ALL');
    setRegFilter('ALL');
    setExecutorFilter('ALL');
    setProjetoFilter('ALL');
    setFinanceiroFilter('ALL');
    setColumnValueFilters({});
  };

  // Filtered rows
  const filteredRows = useMemo(() => {
    const list = tabRows.filter((row) => {
      if (categoryFilter !== 'ALL') {
        const cat = getEngenhariaCategory(row);
        if (categoryFilter === 'A_FAZER' && cat !== 'A_FAZER') return false;
        if (categoryFilter === 'AGUARDANDO' && cat !== 'AGUARDANDO') return false;
        if (categoryFilter === 'FEITOS' && cat !== 'FEITO') return false;
        if (categoryFilter === 'CANCELADOS' && cat !== 'CANCELADO') return false;
      }
      const statusVist = row.vistoriaStatus === 'Entregue' ? 'Entregue' : 'NAO_DISPONIVEL';
      if (vistoriaStatusFilter !== 'ALL' && statusVist !== vistoriaStatusFilter) {
        return false;
      }
      if (
        engStatusFilter !== 'ALL' &&
        (row.fields?.['STATUS Engenharia'] || '').trim() !== engStatusFilter
      ) {
        return false;
      }
      if (
        ufFilter !== 'ALL' &&
        (row.fields?.['UF'] || '').trim().toUpperCase() !== ufFilter
      ) {
        return false;
      }
      if (
        regFilter !== 'ALL' &&
        (row.fields?.['Reg'] || '').trim().toUpperCase() !== regFilter
      ) {
        return false;
      }
      if (
        executorFilter !== 'ALL' &&
        (row.fields?.['Executor'] || '').trim() !== executorFilter
      ) {
        return false;
      }
      if (
        projetoFilter !== 'ALL' &&
        (row.fields?.['PROJETO'] || '').trim() !== projetoFilter
      ) {
        return false;
      }
      if (
        financeiroFilter !== 'ALL' &&
        (row.fields?.['Status Financeiro'] || '').trim() !== financeiroFilter
      ) {
        return false;
      }

      // Per-column filters
      for (const [colName, allowedVals] of Object.entries(columnValueFilters)) {
        if (!allowedVals || allowedVals.length === 0) continue;
        const val = getTssrColumnValue(row, colName) || '—';
        if (!allowedVals.includes(val)) return false;
      }

      // Smart search (single keyword or multiple pasted Site IDs)
      if (searchTokens.length > 0) {
        const haystack = [
          row.siteId,
          row.ocSitePre,
          row.enderecoId,
          row.vistoriaStatus,
          row.vistoriaFileName || '',
          row.vistoriaUploadedBy || '',
          ...Object.values(row.fields || {}),
        ]
          .join(' ')
          .toLowerCase();

        if (searchTokens.length === 1) {
          if (!haystack.includes(searchTokens[0])) return false;
        } else {
          // Multi-code search: match if ANY pasted code matches Site Id, Oc Site Pre, or Enderecoid
          const matchesAnyToken = searchTokens.some((tk) => haystack.includes(tk));
          if (!matchesAnyToken) return false;
        }
      }

      return true;
    });

    return [...list].sort((a, b) => {
      const order = { A_FAZER: 0, AGUARDANDO: 1, FEITO: 2, CANCELADO: 3 };
      const ordA = order[getEngenhariaCategory(a)];
      const ordB = order[getEngenhariaCategory(b)];
      if (ordA !== ordB) return ordA - ordB;
      return a.siteId.localeCompare(b.siteId);
    });
  }, [
    tabRows,
    categoryFilter,
    vistoriaStatusFilter,
    engStatusFilter,
    ufFilter,
    regFilter,
    executorFilter,
    projetoFilter,
    financeiroFilter,
    columnValueFilters,
    searchTokens,
  ]);

  const selectedRow = useMemo(
    () => (selectedRowId ? tssrRows.find((r) => r.id === selectedRowId) || null : null),
    [selectedRowId, tssrRows]
  );

  useEffect(() => {
    if (selectedRow) {
      setDrawerDraftFields({ ...(selectedRow.fields || {}) });
    }
  }, [selectedRow]);

  const toggleColumnFilterValue = (colName: string, val: string) => {
    setColumnValueFilters((prev) => {
      const current = prev[colName] || [];
      const exists = current.includes(val);
      const next = exists ? current.filter((v) => v !== val) : [...current, val];
      const copy = { ...prev };
      if (next.length === 0) {
        delete copy[colName];
      } else {
        copy[colName] = next;
      }
      return copy;
    });
  };

  const clearSingleColumnFilter = (colName: string) => {
    setColumnValueFilters((prev) => {
      const copy = { ...prev };
      delete copy[colName];
      return copy;
    });
  };

  // Handle local .xlsx TSSR file upload
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportingTssr(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const parsed = parseTssrWorkbookBuffer(arrayBuffer, activeVendor, activeSubTab);
      if (parsed.rows.length === 0) {
        setImportError('Nenhuma linha válida encontrada na planilha TSSR selecionada.');
        setImportingTssr(false);
        return;
      }

      const res = await fetch('/api/tssr/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: parsed.rows,
          vendor: activeVendor,
          tabName: activeSubTab,
          sourceFileName: file.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error || 'Erro ao atualizar planilha TSSR.');
        return;
      }

      onTssrUpdated(
        data.tssrRows,
        data.tssrSheets,
        `Planilha TSSR atualizada (${data.updatedCount} atualizadas, ${data.insertedCount} novas — status e arquivos preservados)`
      );
      setIsImportModalOpen(false);
    } catch {
      setImportError('Falha ao ler o arquivo Excel (.xlsx).');
    } finally {
      setImportingTssr(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle OneDrive TSSR sync
  const handleOneDriveSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oneDriveUrl.trim()) {
      setImportError('Informe o link compartilhado da planilha TSSR no OneDrive.');
      return;
    }
    setImportError(null);
    setImportingTssr(true);

    try {
      const parseRes = await fetch('/api/tssr/import-onedrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: oneDriveUrl.trim(),
          vendor: activeVendor,
          tabName: activeSubTab,
        }),
      });
      const parseData = await parseRes.json();
      if (!parseRes.ok) {
        setImportError(parseData.error || 'Não foi possível ler a planilha do OneDrive.');
        return;
      }

      const bulkRes = await fetch('/api/tssr/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: parseData.rows,
          vendor: activeVendor,
          tabName: activeSubTab,
          sourceFileName: parseData.fileName || 'CONTROLE TSSR (OneDrive)',
          liveSyncUrl: oneDriveUrl.trim(),
        }),
      });
      const bulkData = await bulkRes.json();
      if (!bulkRes.ok) {
        setImportError(bulkData.error || 'Erro ao salvar dados da planilha TSSR.');
        return;
      }

      onTssrUpdated(
        bulkData.tssrRows,
        bulkData.tssrSheets,
        `Planilha TSSR sincronizada via OneDrive (${bulkData.updatedCount} atualizadas, ${bulkData.insertedCount} novas — entregas preservadas)`
      );
      setIsImportModalOpen(false);
    } catch {
      setImportError('Erro de conexão ao sincronizar planilha TSSR do OneDrive.');
    } finally {
      setImportingTssr(false);
    }
  };

  // Handle creating a new row manually
  const handleCreateRowSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewRowError(null);
    if (!newRowSiteId.trim()) {
      setNewRowError('Informe a sigla do Site (Site Id).');
      return;
    }

    setCreatingRow(true);
    try {
      const res = await fetch('/api/tssr/rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor: activeVendor,
          tabName: activeSubTab,
          siteId: newRowSiteId.trim().toUpperCase(),
          ocSitePre: newRowOcSitePre.trim(),
          enderecoId: newRowEnderecoId.trim(),
          fields: {
            'Oc Site Pre': newRowOcSitePre.trim(),
            Enderecoid: newRowEnderecoId.trim(),
            'Site Id': newRowSiteId.trim().toUpperCase(),
            Reg: newRowReg.trim().toUpperCase(),
            UF: newRowUf.trim().toUpperCase(),
            Cidade: newRowCidade.trim(),
            PROJETO: newRowProjeto.trim(),
            'STATUS Engenharia': newRowStatusEng.trim(),
            Executor: newRowExecutor.trim(),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNewRowError(data.error || 'Erro ao criar nova linha.');
        return;
      }
      onTssrUpdated(
        data.tssrRows,
        data.tssrSheets,
        `Site ${newRowSiteId.trim().toUpperCase()} adicionado na aba ${activeSubTab}`
      );
      setIsNewRowModalOpen(false);
      setNewRowSiteId('');
      setNewRowOcSitePre('');
      setNewRowEnderecoId('');
      setNewRowUf('');
      setNewRowCidade('');
      setNewRowReg('');
      setNewRowProjeto('');
      setNewRowExecutor('');
    } catch {
      setNewRowError('Erro de conexão ao criar nova linha.');
    } finally {
      setCreatingRow(false);
    }
  };

  // Handle saving original columns in the slide-over drawer
  const handleSaveDrawerRow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRow) return;
    setSavingDrawer(true);
    try {
      const res = await fetch(`/api/tssr/rows/${encodeURIComponent(selectedRow.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: drawerDraftFields }),
      });
      if (res.ok) {
        const data = await res.json();
        onTssrUpdated(
          data.tssrRows,
          undefined,
          `Dados do site ${selectedRow.siteId} atualizados em ${activeSubTab}`
        );
        setSelectedRowId(null);
      }
    } finally {
      setSavingDrawer(false);
    }
  };

  const handleDeleteRow = async (row: TssrRow) => {
    try {
      const res = await fetch(`/api/tssr/rows/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        onTssrUpdated(
          data.tssrRows,
          undefined,
          `Linha do site ${row.siteId} removida de ${activeSubTab}`
        );
        if (selectedRowId === row.id) setSelectedRowId(null);
      }
    } catch {
      // ignore
    }
  };

  // Render automatic Vistoria Status Badge (Green = Entregue, Slate = Vistoria Não Disponível)
  const renderVistoriaStatusBadge = (status?: string | null) => {
    if (status === 'Entregue') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
          <span>Entregue</span>
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-300 whitespace-nowrap"
        title="Vistoria ainda não disponível / não enviada"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
        <span>Vistoria Não Disponível</span>
      </span>
    );
  };

  // Render colored badge for "STATUS Engenharia" (original spreadsheet status)
  const renderEngenhariaStatusBadge = (rawStatus: string) => {
    const val = (rawStatus || '').trim();
    if (!val) return <span className="text-slate-400">—</span>;
    const lower = val.toLowerCase();
    if (lower.includes('aguardando')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200 whitespace-nowrap">
          {val}
        </span>
      );
    }
    if (lower.includes('aprovado') || lower.includes('conclu') || lower.includes('entregue')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap">
          {val}
        </span>
      );
    }
    if (lower.includes('cancelado')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200 whitespace-nowrap">
          {val}
        </span>
      );
    }
    if (lower.includes('execução') || lower.includes('revisão')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
          {val}
        </span>
      );
    }
    if (lower.includes('pendencia') || lower.includes('pendência')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
          {val}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
        {val}
      </span>
    );
  };

  // Render the system column "Arquivo da vistoria" with direct Open & Download links
  const renderArquivoVistoriaCell = (row: TssrRow) => {
    if (row.vistoriaStatus === 'Entregue' && (row.vistoriaFileId || row.vistoriaFileUrl)) {
      const viewHref =
        row.vistoriaFileUrl ||
        `/api/engineering/files/${encodeURIComponent(row.vistoriaFileId!)}/view`;
      const downloadHref =
        row.vistoriaDownloadUrl ||
        `/api/engineering/files/${encodeURIComponent(row.vistoriaFileId!)}/download`;

      return (
        <div
          className="inline-flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <a
            href={viewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-semibold text-[11px] transition-colors max-w-[190px] truncate"
            title={`Abrir arquivo: ${row.vistoriaFileName || 'Arquivo da vistoria'}`}
          >
            <ExternalLink className="w-3 h-3 shrink-0" />
            <span className="truncate">{row.vistoriaFileName || 'Abrir Arquivo'}</span>
          </a>
          <a
            href={downloadHref}
            download={row.vistoriaFileName || true}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold text-[11px] transition-colors"
            title={`Baixar arquivo: ${row.vistoriaFileName || ''}`}
          >
            <Download className="w-3 h-3 shrink-0" />
            <span>Baixar</span>
          </a>
          {canDeleteRowVistoria(row) && (
            <button
              type="button"
              onClick={() => setVistoriaToDelete(row)}
              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
              title={
                isGestorEngenharia
                  ? 'Apagar arquivo de vistoria (Gestor da Engenharia)'
                  : 'Apagar seu arquivo de vistoria'
              }
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      );
    }

    return (
      <div
        className="inline-flex items-center gap-2 text-slate-400 text-[11px]"
        onClick={(e) => e.stopPropagation()}
      >
        <span>Nenhum arquivo</span>
        {!isExecutor && onNavigateToVistoria && (
          <button
            type="button"
            onClick={() => onNavigateToVistoria(row.siteId)}
            className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 border border-slate-200 text-[10px] font-semibold cursor-pointer transition-colors"
            title="Enviar arquivo de vistoria para este site"
          >
            Enviar
          </button>
        )}
      </div>
    );
  };

  const densityPad =
    tableDensity === 'comfortable'
      ? 'py-2.5 px-3 text-xs'
      : tableDensity === 'compact'
      ? 'py-1.5 px-2.5 text-[11px]'
      : 'py-1 px-2 text-[11px]';

  // Columns to display depending on Executor role or Resumo vs Planilha mode
  const activeOriginalColumns = isExecutor
    ? EXECUTOR_ORIGINAL_COLUMNS
    : viewMode === 'grid'
    ? TSSR_TIM_NOKIA_ORIGINAL_COLUMNS
    : RESUMO_ORIGINAL_COLUMNS;

  const activeSystemColumns = isExecutor ? [] : TSSR_SYSTEM_COLUMNS;

  // Group rows by section when in "Resumo" mode (Entregues vs Pendentes)
  const groupedSections = useMemo(() => {
    if (viewMode === 'grid') {
      return [{ id: 'ALL', title: 'Planilha Completa — TSSR TIM Nokia', rows: filteredRows }];
    }
    const entregues = filteredRows.filter((r) => r.vistoriaStatus === 'Entregue');
    const pendentes = filteredRows.filter((r) => r.vistoriaStatus !== 'Entregue');
    const sections: Array<{ id: string; title: string; badgeClass: string; rows: TssrRow[] }> = [];
    if (entregues.length > 0 || vistoriaStatusFilter === 'Entregue') {
      sections.push({
        id: 'ENTREGUES',
        title: `Vistorias Entregues (${entregues.length})`,
        badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        rows: entregues,
      });
    }
    if (pendentes.length > 0 || vistoriaStatusFilter === 'NAO_DISPONIVEL') {
      sections.push({
        id: 'NAO_DISPONIVEL',
        title: `Vistoria Não Disponível (${pendentes.length})`,
        badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
        rows: pendentes,
      });
    }
    return sections;
  }, [filteredRows, viewMode, vistoriaStatusFilter]);

  return (
    <div className="space-y-3">
      {/* =====================================================================
          FULL-PAGE VIEW FOR "TSSR ENTRADA" & "TSSR" PROJECT FOLDERS
          ("quando abrir ela quero que abra em uma nova pagina inteira dentro delas o mesmo sistema de antes carregar documentos etc")
         ===================================================================== */}
      {openProjectFolderType && (
        <div className="fixed inset-0 z-50 bg-[#F8FAFC] flex flex-col w-screen h-screen overflow-y-auto">
          {/* Top Full-Page Navigation Bar */}
          <div className="sticky top-0 z-30 bg-[#0F172A] text-white border-b border-slate-800 px-6 py-3 flex flex-wrap items-center justify-between gap-4 shadow-md shrink-0">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setOpenProjectFolderType(null)}
                className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg text-xs font-bold text-white flex items-center gap-2 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Voltar para Planilha Controle de Engenharia</span>
              </button>

              <div className="h-5 w-px bg-slate-700 hidden sm:block" />

              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-amber-400 fill-amber-400/80" />
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <span>Pastas de Projetos de Engenharia ({activeVendor})</span>
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/30 text-amber-300 font-mono text-[10px]">
                      PÁGINA INTEIRA
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Carregamento de pacotes .ZIP, WinRAR (.RAR), planilhas e documentos de projetos TSSR
                  </div>
                </div>
              </div>
            </div>

            {/* Center/Right Switcher between TSSR Entrada and TSSR + Vendor Switcher */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center bg-slate-800/90 p-1 rounded-xl border border-slate-700 gap-1">
                <button
                  type="button"
                  onClick={() => setOpenProjectFolderType('TSSR Entrada')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                    openProjectFolderType === 'TSSR Entrada'
                      ? 'bg-amber-500 text-slate-950 shadow-2xs'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                  }`}
                >
                  <Folder
                    className={`w-3.5 h-3.5 ${
                      openProjectFolderType === 'TSSR Entrada'
                        ? 'text-slate-950 fill-slate-950'
                        : 'text-amber-400 fill-amber-400'
                    }`}
                  />
                  <span>TSSR Entrada</span>
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                      openProjectFolderType === 'TSSR Entrada'
                        ? 'bg-slate-950/15 text-slate-950'
                        : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {tssrEntradaStats.directSubfolders}p · {tssrEntradaStats.totalFiles} arq
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setOpenProjectFolderType('TSSR')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                    openProjectFolderType === 'TSSR'
                      ? 'bg-amber-500 text-slate-950 shadow-2xs'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                  }`}
                >
                  <Folder
                    className={`w-3.5 h-3.5 ${
                      openProjectFolderType === 'TSSR'
                        ? 'text-slate-950 fill-slate-950'
                        : 'text-amber-400 fill-amber-400'
                    }`}
                  />
                  <span>TSSR</span>
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                      openProjectFolderType === 'TSSR'
                        ? 'bg-slate-950/15 text-slate-950'
                        : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {tssrFinalStats.directSubfolders}p · {tssrFinalStats.totalFiles} arq
                  </span>
                </button>
              </div>

              {/* NOKIA / ERICSSON Switcher */}
              <div className="flex items-center p-0.5 bg-slate-800 border border-slate-700 rounded-lg">
                {(['NOKIA', 'ERICSSON'] as VendorType[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onSwitchVendor(v)}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors cursor-pointer ${
                      activeVendor === v
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setOpenProjectFolderType(null)}
                className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 text-red-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                title="Fechar página de pastas e voltar para planilha"
              >
                <X className="w-3.5 h-3.5" />
                <span>Fechar Página</span>
              </button>
            </div>
          </div>

          {/* Full-Page Body with the exact same Folder & Document Upload System as before */}
          <div className="flex-1 max-w-[1600px] w-full mx-auto p-6">
            <EngineeringVistoriasTab
              user={user}
              effectiveRole={effectiveRole}
              simulatedTargetUser={simulatedTargetUser}
              onToggleSimulateUser={onToggleSimulateUser}
              users={users}
              activeVendor={activeVendor}
              folders={folders}
              files={files}
              sites={sites}
              tssrRows={tssrRows}
              onFoldersAndFilesUpdated={onFoldersAndFilesUpdated}
              onSelectSiteId={onSelectSiteId}
              mode="tssr-projects"
              initialFolderId={
                openProjectFolderType === 'TSSR Entrada'
                  ? tssrEntradaFolder.id
                  : tssrFinalFolder.id
              }
              onBackToEngineeringControl={() => setOpenProjectFolderType(null)}
            />
          </div>
        </div>
      )}

      {/* =====================================================================
          MAIN LAYOUT WITH LEFT LATERAL FOLDER PANEL ("NA LATERAL ONDE ESTÁ A PRINT")
          + RIGHT MAIN CONTROLE DE ENGENHARIA SPREADSHEET
         ===================================================================== */}
      <div className="flex flex-col lg:flex-row items-start gap-4 w-full">
        {/* LEFT LATERAL SIDEBAR: PASTAS DE PROJETOS (TSSR ENTRADA & TSSR) */}
        <aside className="w-full lg:w-56 xl:w-60 shrink-0 lg:sticky lg:top-20">
          <div className="p-3.5 bg-amber-50/90 border border-amber-200/90 rounded-2xl shadow-2xs space-y-2.5">
            <div className="px-1 flex items-center gap-1.5 text-xs font-bold text-amber-900">
              <FolderOpen className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Pastas de Projetos:</span>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setOpenProjectFolderType('TSSR Entrada')}
                className="w-full px-3 py-2.5 bg-white hover:bg-amber-100/70 border border-amber-300 rounded-xl text-xs font-bold text-slate-900 flex items-center justify-between gap-2 shadow-2xs transition-all cursor-pointer group"
                title="Abrir pasta TSSR Entrada em uma nova página inteira para carregar projetos e documentos"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="relative flex items-center justify-center shrink-0">
                    <Folder className="w-4 h-4 text-amber-500 fill-amber-400 group-hover:scale-105 transition-transform" />
                    <Users className="w-2.5 h-2.5 text-slate-800 absolute -bottom-0.5 -right-0.5" />
                  </div>
                  <span className="truncate">TSSR Entrada</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-mono text-[10px] font-bold tabular-nums">
                    {tssrEntradaStats.totalFiles} arq
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-amber-700 opacity-75 group-hover:opacity-100" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setOpenProjectFolderType('TSSR')}
                className="w-full px-3 py-2.5 bg-white hover:bg-amber-100/70 border border-amber-300 rounded-xl text-xs font-bold text-slate-900 flex items-center justify-between gap-2 shadow-2xs transition-all cursor-pointer group"
                title="Abrir pasta TSSR em uma nova página inteira para carregar projetos e documentos"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="relative flex items-center justify-center shrink-0">
                    <Folder className="w-4 h-4 text-amber-500 fill-amber-400 group-hover:scale-105 transition-transform" />
                    <Users className="w-2.5 h-2.5 text-slate-800 absolute -bottom-0.5 -right-0.5" />
                  </div>
                  <span className="truncate">TSSR</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-mono text-[10px] font-bold tabular-nums">
                    {tssrFinalStats.totalFiles} arq
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-amber-700 opacity-75 group-hover:opacity-100" />
                </div>
              </button>
            </div>
          </div>
        </aside>

        {/* RIGHT MAIN WORKSPACE: CONTROLE DE ENGENHARIA HEADER + SPREADSHEET */}
        <div className="flex-1 min-w-0 w-full space-y-3">
      {/* =====================================================================
          1. TOP HEADER & COUNTERS BAR (MESMO ESTILO DOS CONTADORES DA TELA DE SITES)
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3.5">
        <div
          className={`flex flex-wrap items-center ${
            isCoordenadorEngenharia ? 'justify-end' : 'justify-between'
          } gap-3`}
        >
          {!isCoordenadorEngenharia && (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#223585]/10 border border-[#223585]/20 flex items-center justify-center text-[#223585] shrink-0">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#1E8E8D]">
                    Controle de Engenharia · {activeVendor}
                  </span>
                  <span className="text-slate-300">•</span>
                  <h1 className="text-sm font-bold text-slate-900">
                    Planilha Controle de Engenharia
                  </h1>
                </div>
                <p className="text-xs text-slate-500">
                  Aba <strong>{activeSubTab}</strong> — alimentada pela planilha TSSR online e pelos arquivos enviados na área de Vistoria.
                </p>
              </div>
            </div>
          )}

          {/* Right Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCharts((prev) => !prev)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                showCharts
                  ? 'bg-[#223585] text-white border-[#223585]'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Gráficos</span>
            </button>

            <button
              type="button"
              onClick={() => setIsNewRowModalOpen(true)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-blue-600" />
              <span>+ Nova Linha</span>
            </button>

            {canUploadTssr && (
              <button
                type="button"
                onClick={() => {
                  setOpenProjectFolderType('TSSR');
                }}
                className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                title="Abrir pasta TSSR da Engenharia para carregar projetos e pacotes"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Subir TSSR (Engenharia)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setImportError(null);
                setIsImportModalOpen(true);
              }}
              className="px-3.5 py-1.5 bg-[#223585] hover:bg-[#1b2a6b] text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Carregar Planilha TSSR (.XLSX / OneDrive)</span>
            </button>

            {/* Firebase Cloud Status Button */}
            <button
              type="button"
              onClick={() => setIsGoogleDriveOpen(true)}
              className="px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Status de Sincronização em Tempo Real na Nuvem Firebase (Storage e Firestore)"
            >
              <Cloud className="w-3.5 h-3.5 text-white" />
              <span>Nuvem Firebase</span>
            </button>

            <button
              type="button"
              onClick={() =>
                exportTssrRowsToXlsx(
                  filteredRows,
                  `TSSR_TIM_Nokia_${new Date().toISOString().slice(0, 10)}.xlsx`,
                  activeSubTab
                )
              }
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Exportar planilha TSSR TIM Nokia (.XLSX)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar (.XLSX)</span>
            </button>
          </div>
        </div>

        {/* Engineering Sheet Tabs Bar + Automatic Counters (Total, Entregues, Pendentes) */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          {/* Sheet Tabs */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveSubTab('TSSR TIM Nokia')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 border transition-all cursor-pointer ${
                activeSubTab === 'TSSR TIM Nokia'
                  ? 'bg-[#223585] border-[#223585] text-white shadow-2xs'
                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-300" />
              <span>TSSR TIM Nokia</span>
              <span className="font-mono text-[11px] text-blue-100 tabular-nums">
                ({totalCount})
              </span>
            </button>

            {activeSheetMeta?.lastSyncAt && (
              <span className="text-[11px] text-slate-400 font-mono">
                Última carga: {new Date(activeSheetMeta.lastSyncAt).toLocaleString('pt-BR')}
              </span>
            )}
          </div>

          {/* Top Counters: STATUS Engenharia (A Fazer, Aguardando Aprovação, Concluídos, Cancelados) + Vistorias */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setCategoryFilter('ALL');
                setVistoriaStatusFilter('ALL');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-2 cursor-pointer ${
                categoryFilter === 'ALL' && vistoriaStatusFilter === 'ALL'
                  ? 'bg-slate-900 border-slate-900 text-white shadow-2xs'
                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
              }`}
              title="Mostrar todos os sites da planilha da engenharia"
            >
              <span>Total de Sites</span>
              <span className="font-mono font-bold text-xs tabular-nums px-1.5 py-0.5 rounded bg-white/15">
                {totalCount}
              </span>
            </button>

            {/* 1º A Fazer / Pendentes de Engenharia (Âmbar) */}
            <button
              type="button"
              onClick={() =>
                setCategoryFilter((prev) => (prev === 'A_FAZER' ? 'ALL' : 'A_FAZER'))
              }
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                categoryFilter === 'A_FAZER'
                  ? 'bg-amber-500 border-amber-500 text-slate-950 shadow-2xs'
                  : 'bg-amber-50 hover:bg-amber-100/80 border-amber-300 text-amber-900'
              }`}
              title="Filtrar sites com STATUS Engenharia pendente (A Fazer)"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  categoryFilter === 'A_FAZER' ? 'bg-slate-950' : 'bg-amber-500'
                }`}
              />
              <span>1º A Fazer (Pendentes)</span>
              <span
                className={`font-mono font-bold text-xs tabular-nums px-1.5 py-0.5 rounded ${
                  categoryFilter === 'A_FAZER'
                    ? 'bg-amber-600 text-slate-950'
                    : 'bg-white text-amber-900 border border-amber-200'
                }`}
              >
                {engStats.aFazer}
              </span>
            </button>

            {/* Aguardando Aprovação (Azul) */}
            <button
              type="button"
              onClick={() =>
                setCategoryFilter((prev) => (prev === 'AGUARDANDO' ? 'ALL' : 'AGUARDANDO'))
              }
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                categoryFilter === 'AGUARDANDO'
                  ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                  : 'bg-blue-50 hover:bg-blue-100/80 border-blue-200 text-blue-900'
              }`}
              title="Filtrar sites com TSSR Aguardando Aprovação"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  categoryFilter === 'AGUARDANDO' ? 'bg-white' : 'bg-blue-600'
                }`}
              />
              <span>Aguardando Aprovação</span>
              <span
                className={`font-mono font-bold text-xs tabular-nums px-1.5 py-0.5 rounded ${
                  categoryFilter === 'AGUARDANDO'
                    ? 'bg-blue-700 text-white'
                    : 'bg-white text-blue-800 border border-blue-200'
                }`}
              >
                {engStats.aguardando}
              </span>
            </button>

            {/* 2º Concluídos / Aprovados (Verde) */}
            <button
              type="button"
              onClick={() =>
                setCategoryFilter((prev) => (prev === 'FEITOS' ? 'ALL' : 'FEITOS'))
              }
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                categoryFilter === 'FEITOS'
                  ? 'bg-emerald-600 border-emerald-600 text-white shadow-2xs'
                  : 'bg-emerald-50 hover:bg-emerald-100/80 border-emerald-200 text-emerald-800'
              }`}
              title="Filtrar sites aprovados / concluídos"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  categoryFilter === 'FEITOS' ? 'bg-white' : 'bg-emerald-600'
                }`}
              />
              <span>2º Aprovados / Feitos</span>
              <span
                className={`font-mono font-bold text-xs tabular-nums px-1.5 py-0.5 rounded ${
                  categoryFilter === 'FEITOS'
                    ? 'bg-emerald-700 text-white'
                    : 'bg-white text-emerald-800 border border-emerald-200'
                }`}
              >
                {engStats.concluidos}
              </span>
            </button>

            {/* Cancelados (Cinza) */}
            {engStats.cancelados > 0 && (
              <button
                type="button"
                onClick={() =>
                  setCategoryFilter((prev) => (prev === 'CANCELADOS' ? 'ALL' : 'CANCELADOS'))
                }
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  categoryFilter === 'CANCELADOS'
                    ? 'bg-slate-700 border-slate-700 text-white shadow-2xs'
                    : 'bg-slate-100 hover:bg-slate-200/80 border-slate-200 text-slate-700'
                }`}
                title="Filtrar sites cancelados"
              >
                <span>Cancelados</span>
                <span className="font-mono text-xs tabular-nums">{engStats.cancelados}</span>
              </button>
            )}

            {/* Separator */}
            <div className="h-5 w-px bg-slate-200 mx-0.5" />

            {/* Vistorias Entregues */}
            <button
              type="button"
              onClick={() =>
                setVistoriaStatusFilter((prev) => (prev === 'Entregue' ? 'ALL' : 'Entregue'))
              }
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                vistoriaStatusFilter === 'Entregue'
                  ? 'bg-emerald-700 border-emerald-700 text-white shadow-2xs'
                  : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
              }`}
              title="Vistorias com arquivo entregue"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Vistoria Entregue</span>
              <span className="font-mono font-bold text-xs tabular-nums">{entreguesCount}</span>
            </button>

            {/* Vistoria Não Disponível */}
            <button
              type="button"
              onClick={() =>
                setVistoriaStatusFilter((prev) => (prev === 'NAO_DISPONIVEL' ? 'ALL' : 'NAO_DISPONIVEL'))
              }
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                vistoriaStatusFilter === 'NAO_DISPONIVEL'
                  ? 'bg-slate-800 border-slate-800 text-white shadow-2xs'
                  : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
              }`}
              title="Vistorias sem arquivo carregado"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span>Vistoria Não Disponível</span>
              <span className="font-mono font-bold text-xs tabular-nums">{naoDisponivelCount}</span>
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================================
          1.5. INTERACTIVE CHART DA ENGENHARIA (MESMO SISTEMA COM DADOS DOS EXECUTORES)
          ("quero esse mesmo sistema na engenharia porem apenas com informaçoes dos executores")
         ===================================================================== */}
      <EngineeringInteractiveChart
        rows={tabRows}
        activeExecutorFilter={executorFilter}
        onSelectExecutorFilter={(ex) => setExecutorFilter(ex)}
        activeUfFilter={ufFilter}
        onSelectUfFilter={(uf) => setUfFilter(uf)}
        activeEngStatusFilter={engStatusFilter}
        onSelectEngStatusFilter={(st) => setEngStatusFilter(st)}
        activeCategoryFilter={categoryFilter}
        onSelectCategoryFilter={(cat) => setCategoryFilter(cat)}
      />

      {/* =====================================================================
          2. MAIN SPREADSHEET CONTAINER (MESMO PADRÃO DA PASTA CONTROLE GERAL)
         ===================================================================== */}
      <div
        className={
          isFullscreen
            ? 'fixed inset-0 z-40 bg-white flex flex-col w-screen h-screen overflow-hidden'
            : 'bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden'
        }
      >
        {/* Folder Header + Density & View Controls + Fullscreen Toggle */}
        <div className="px-5 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!isFullscreen) setIsFolderOpen((prev) => !prev);
              }}
              className="flex items-center gap-2.5 text-left cursor-pointer"
            >
              <FolderKanban className="w-4 h-4 text-[#223585]" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-900">
                  {activeSubTab}
                </span>
                <span className="px-2 py-0.5 bg-[#F3F4F6] border border-slate-200 rounded-md text-xs font-mono text-slate-700 font-semibold tabular-nums">
                  {filteredRows.length} registro{filteredRows.length !== 1 ? 's' : ''}
                </span>
                <span className="px-2 py-0.5 bg-amber-50 border border-amber-300 rounded-md text-xs font-mono text-amber-900 font-bold tabular-nums" title="STATUS Engenharia: 1º A Fazer">
                  {engStats.aFazer} a fazer
                </span>
                <span className="px-2 py-0.5 bg-blue-50 border border-blue-200 rounded-md text-xs font-mono text-blue-900 font-bold tabular-nums" title="STATUS Engenharia: Aguardando Aprovação">
                  {engStats.aguardando} aguardando
                </span>
                <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs font-mono text-emerald-800 font-bold tabular-nums" title="STATUS Engenharia: Concluídos / Aprovados">
                  {engStats.concluidos} aprovados
                </span>
                <span className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded-md text-xs font-mono text-slate-700 font-semibold tabular-nums" title="Vistorias com arquivo entregue">
                  {entreguesCount} vistorias
                </span>
                {isFullscreen && (
                  <span className="px-2 py-0.5 bg-blue-600 text-white rounded-md text-[11px] font-bold">
                    TELA INTEIRA
                  </span>
                )}
              </div>
              {!isFullscreen &&
                (isFolderOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-400 ml-1" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400 ml-1" />
                ))}
            </button>

            {isFullscreen && (
              <div className="flex items-center p-0.5 bg-[#F3F4F6] border border-slate-200 rounded-lg">
                {(['NOKIA', 'ERICSSON'] as VendorType[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onSwitchVendor(v)}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors cursor-pointer ${
                      activeVendor === v
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right Controls: Density Control, View Mode Switcher & Fullscreen Spreadsheet Button */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Density Control (Confortável, Compacto, Muito Compacto) */}
            <div
              className="flex items-center p-0.5 bg-[#F3F4F6] border border-slate-200 rounded-lg"
              title="Alternância de Densidade da Tabela"
            >
              {(
                [
                  { id: 'comfortable', label: 'Confortável' },
                  { id: 'compact', label: 'Compacto' },
                  { id: 'ultra', label: 'Muito Compacto' },
                ] as const
              ).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setTableDensity(d.id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                    tableDensity === d.id
                      ? 'bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/70'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {/* View Mode Switcher (Resumo / Planilha) */}
            <div className="flex items-center p-0.5 bg-[#F3F4F6] border border-slate-200 rounded-lg">
              <button
                type="button"
                onClick={() => setViewMode('fluid')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                  viewMode === 'fluid'
                    ? 'bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/70'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
                <span>Resumo</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/70'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Table className="w-3.5 h-3.5" />
                <span>Planilha ({TSSR_ALL_COLUMNS.length} col)</span>
              </button>
            </div>

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={() => {
                const next = !isFullscreen;
                setIsFullscreen(next);
                if (next) setIsFolderOpen(true);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                isFullscreen
                  ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 shadow-2xs'
                  : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900 shadow-2xs'
              }`}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Sair da Tela Inteira (ESC)</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Planilha em Tela Inteira</span>
                </>
              )}
            </button>
          </div>
        </div>

        {(isFolderOpen || isFullscreen) && (
          <div className={isFullscreen ? 'flex-1 flex flex-col min-h-0 overflow-hidden' : ''}>
            {/* Smart Search Bar + "+ Adicionar Filtro" */}
            <div className="px-5 py-3 bg-[#F3F4F6]/80 border-b border-slate-200 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[280px]">
                  <div className="flex items-center bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus-within:border-blue-600 transition-colors shadow-2xs">
                    <Search className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Busca inteligente em TSSR TIM Nokia: digite sigla do Site (ex: SN-OI65J2), Oc Site Pre, Cidade, Executor ou cole múltiplos sites..."
                      className="w-full bg-transparent text-xs text-slate-900 placeholder-slate-400 focus:outline-none"
                    />
                    {searchTokens.length > 1 && (
                      <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded text-[10px] font-mono font-semibold whitespace-nowrap mr-1.5">
                        {searchTokens.length} códigos
                      </span>
                    )}
                    {searchTerm.trim() && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm('')}
                        className="text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer"
                        title="Limpar busca"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* "+ Adicionar Filtro" Popover */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsAddFilterOpen((prev) => !prev)}
                    className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5 text-slate-500" />
                    <span>Adicionar Filtro</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>

                  {isAddFilterOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsAddFilterOpen(false)}
                      />
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute left-0 top-full mt-1.5 w-80 bg-white border border-slate-200 rounded-xl shadow-xl p-3.5 z-50 space-y-3 text-xs"
                      >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <span className="font-bold text-slate-800">
                            Adicionar Filtro (TSSR TIM Nokia)
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsAddFilterOpen(false)}
                            className="text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="space-y-2.5">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                              Status da vistoria [SISTEMA]
                            </label>
                            <select
                              value={vistoriaStatusFilter}
                              onChange={(e) => {
                                setVistoriaStatusFilter(
                                  e.target.value as 'ALL' | 'Entregue' | 'NAO_DISPONIVEL'
                                );
                                setIsAddFilterOpen(false);
                              }}
                              className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800"
                            >
                              <option value="ALL">Todos ({totalCount})</option>
                              <option value="Entregue">Vistoria Entregue ({entreguesCount})</option>
                              <option value="NAO_DISPONIVEL">Vistoria Não Disponível ({naoDisponivelCount})</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                              STATUS Engenharia
                            </label>
                            <select
                              value={engStatusFilter}
                              onChange={(e) => {
                                setEngStatusFilter(e.target.value);
                                setIsAddFilterOpen(false);
                              }}
                              className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800"
                            >
                              <option value="ALL">Todos ({filterOptions.engStatuses.length})</option>
                              {filterOptions.engStatuses.map((st) => (
                                <option key={st} value={st}>
                                  {st}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                UF
                              </label>
                              <select
                                value={ufFilter}
                                onChange={(e) => {
                                  setUfFilter(e.target.value);
                                  setIsAddFilterOpen(false);
                                }}
                                className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800"
                              >
                                <option value="ALL">Todas ({filterOptions.ufs.length})</option>
                                {filterOptions.ufs.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                Regional (Reg)
                              </label>
                              <select
                                value={regFilter}
                                onChange={(e) => {
                                  setRegFilter(e.target.value);
                                  setIsAddFilterOpen(false);
                                }}
                                className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800"
                              >
                                <option value="ALL">Todas ({filterOptions.regs.length})</option>
                                {filterOptions.regs.map((rg) => (
                                  <option key={rg} value={rg}>
                                    {rg}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                              Executor
                            </label>
                            <select
                              value={executorFilter}
                              onChange={(e) => {
                                setExecutorFilter(e.target.value);
                                setIsAddFilterOpen(false);
                              }}
                              className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800"
                            >
                              <option value="ALL">Todos ({filterOptions.executores.length})</option>
                              {filterOptions.executores.map((ex) => (
                                <option key={ex} value={ex}>
                                  {ex}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                PROJETO
                              </label>
                              <select
                                value={projetoFilter}
                                onChange={(e) => {
                                  setProjetoFilter(e.target.value);
                                  setIsAddFilterOpen(false);
                                }}
                                className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800"
                              >
                                <option value="ALL">Todos</option>
                                {filterOptions.projetos.map((pj) => (
                                  <option key={pj} value={pj}>
                                    {pj}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                Status Financeiro
                              </label>
                              <select
                                value={financeiroFilter}
                                onChange={(e) => {
                                  setFinanceiroFilter(e.target.value);
                                  setIsAddFilterOpen(false);
                                }}
                                className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800"
                              >
                                <option value="ALL">Todos</option>
                                {filterOptions.financeiros.map((fn) => (
                                  <option key={fn} value={fn}>
                                    {fn}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* CSV Export quick button */}
                <button
                  type="button"
                  onClick={() =>
                    exportTssrRowsToCsv(
                      filteredRows,
                      `TSSR_TIM_Nokia_${new Date().toISOString().slice(0, 10)}.csv`
                    )
                  }
                  className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>CSV</span>
                </button>
              </div>

              {/* Active Filter Chips Row */}
              {(hasActiveFilter || searchTokens.length > 1) && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[11px] font-medium text-slate-500 mr-1">
                    Filtros ativos:
                  </span>

                  {categoryFilter !== 'ALL' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-xs shadow-2xs font-semibold">
                      <span className="text-amber-600">STATUS Engenharia:</span>
                      <span>
                        {categoryFilter === 'A_FAZER' && '1º Pendentes (A Fazer)'}
                        {categoryFilter === 'AGUARDANDO' && 'Aguardando Aprovação'}
                        {categoryFilter === 'FEITOS' && '2º Aprovados / Feitos'}
                        {categoryFilter === 'CANCELADOS' && 'Cancelados'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCategoryFilter('ALL')}
                        className="text-amber-700 hover:text-amber-950 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}

                  {vistoriaStatusFilter !== 'ALL' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                      <span className="text-slate-400">Status da vistoria:</span>
                      <span className="font-semibold">
                        {vistoriaStatusFilter === 'Entregue'
                          ? 'Vistoria Entregue'
                          : 'Vistoria Não Disponível'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setVistoriaStatusFilter('ALL')}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}

                  {engStatusFilter !== 'ALL' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                      <span className="text-slate-400">STATUS Engenharia:</span>
                      <span className="font-semibold">{engStatusFilter}</span>
                      <button
                        type="button"
                        onClick={() => setEngStatusFilter('ALL')}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}

                  {ufFilter !== 'ALL' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                      <span className="text-slate-400">UF:</span>
                      <span className="font-semibold">{ufFilter}</span>
                      <button
                        type="button"
                        onClick={() => setUfFilter('ALL')}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}

                  {regFilter !== 'ALL' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                      <span className="text-slate-400">Reg:</span>
                      <span className="font-semibold">{regFilter}</span>
                      <button
                        type="button"
                        onClick={() => setRegFilter('ALL')}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}

                  {executorFilter !== 'ALL' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                      <span className="text-slate-400">Executor:</span>
                      <span className="font-semibold">{executorFilter}</span>
                      <button
                        type="button"
                        onClick={() => setExecutorFilter('ALL')}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}

                  {projetoFilter !== 'ALL' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                      <span className="text-slate-400">PROJETO:</span>
                      <span className="font-semibold">{projetoFilter}</span>
                      <button
                        type="button"
                        onClick={() => setProjetoFilter('ALL')}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}

                  {financeiroFilter !== 'ALL' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                      <span className="text-slate-400">Status Financeiro:</span>
                      <span className="font-semibold">{financeiroFilter}</span>
                      <button
                        type="button"
                        onClick={() => setFinanceiroFilter('ALL')}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}

                  {Object.entries(columnValueFilters).map(([colName, vals]) => {
                    if (!vals || vals.length === 0) return null;
                    return (
                      <span
                        key={colName}
                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs"
                      >
                        <span className="text-slate-400">{colName}:</span>
                        <span className="font-mono text-[11px] max-w-[180px] truncate">
                          {vals.join(', ')}
                        </span>
                        <button
                          type="button"
                          onClick={() => clearSingleColumnFilter(colName)}
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}

                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="px-2.5 py-0.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                  >
                    Limpar todos
                  </button>
                </div>
              )}
            </div>

            {/* ===============================================================
                3. SPREADSHEET TABLE:
                - 37 Original Columns from TSSR in exact order (or Resumo subset)
                - 4 System Columns clearly badged with [SISTEMA]
               =============================================================== */}
            <div
              className={
                isFullscreen
                  ? 'flex-1 overflow-auto'
                  : 'overflow-x-auto max-h-[72vh] overflow-y-auto'
              }
            >
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-20 bg-slate-100 border-b border-slate-200 text-[11px] font-bold text-slate-700">
                  <tr className="whitespace-nowrap">
                    {/* Original TSSR Columns */}
                    {activeOriginalColumns.map((colName) => {
                      const hasColFilter = Boolean(columnValueFilters[colName]?.length);
                      const isStickySiteId = colName === 'Site Id';
                      return (
                        <th
                          key={colName}
                          className={`${densityPad} border-r border-slate-200/70 select-none ${
                            isStickySiteId
                              ? 'sticky left-0 z-30 bg-slate-100 shadow-[1px_0_0_0_#e2e8f0]'
                              : 'bg-slate-100'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span>{colName}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setColMenuSearchText('');
                                setOpenColFilterMenu({
                                  colName,
                                  top: Math.min(window.innerHeight - 380, rect.bottom + 6),
                                  left: Math.min(window.innerWidth - 300, Math.max(12, rect.left)),
                                });
                              }}
                              className={`p-0.5 rounded hover:bg-slate-200 cursor-pointer ${
                                hasColFilter ? 'text-blue-600 bg-blue-50' : 'text-slate-400'
                              }`}
                              title={`Filtrar valores da coluna ${colName}`}
                            >
                              <Filter className="w-3 h-3" />
                            </button>
                          </div>
                        </th>
                      );
                    })}

                    {/* System Columns (Identified as [SISTEMA]) */}
                    {activeSystemColumns.map((sysCol) => {
                      const hasColFilter = Boolean(columnValueFilters[sysCol]?.length);
                      return (
                        <th
                          key={sysCol}
                          className={`${densityPad} bg-[#223585]/10 text-[#223585] border-r border-blue-200/80 select-none`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <span>{sysCol}</span>
                              <span className="px-1.5 py-0.2 rounded bg-[#223585] text-white text-[9px] font-mono uppercase tracking-wider">
                                SISTEMA
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setColMenuSearchText('');
                                setOpenColFilterMenu({
                                  colName: sysCol,
                                  top: Math.min(window.innerHeight - 380, rect.bottom + 6),
                                  left: Math.min(window.innerWidth - 300, Math.max(12, rect.left)),
                                });
                              }}
                              className={`p-0.5 rounded hover:bg-blue-200/60 cursor-pointer ${
                                hasColFilter ? 'text-blue-700 bg-blue-100' : 'text-[#223585]/60'
                              }`}
                              title={`Filtrar valores da coluna ${sysCol}`}
                            >
                              <Filter className="w-3 h-3" />
                            </button>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white">
                  {groupedSections.map((section) => (
                    <React.Fragment key={section.id}>
                      {viewMode === 'fluid' && (
                        <tr className="bg-slate-50/90 border-y border-slate-200">
                          <td
                            colSpan={activeOriginalColumns.length + activeSystemColumns.length}
                            className="px-4 py-1.5 text-xs font-bold text-slate-700"
                          >
                            {section.title}
                          </td>
                        </tr>
                      )}

                      {section.rows.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => setSelectedRowId(row.id)}
                          className="group hover:bg-blue-50/40 transition-colors whitespace-nowrap cursor-pointer"
                        >
                          {activeOriginalColumns.map((colName) => {
                            const val = getTssrColumnValue(row, colName);
                            const isStickySiteId = colName === 'Site Id';

                            if (isStickySiteId) {
                              return (
                                <td
                                  key={colName}
                                  className={`${densityPad} sticky left-0 z-10 bg-white group-hover:bg-blue-50/60 font-mono font-bold text-[#223585] border-r border-slate-100 shadow-[1px_0_0_0_#f1f5f9]`}
                                >
                                  {val || '—'}
                                </td>
                              );
                            }

                            if (colName === 'STATUS Engenharia') {
                              return (
                                <td
                                  key={colName}
                                  className={`${densityPad} border-r border-slate-100`}
                                >
                                  {renderEngenhariaStatusBadge(val)}
                                </td>
                              );
                            }

                            return (
                              <td
                                key={colName}
                                className={`${densityPad} text-slate-700 border-r border-slate-100 max-w-[240px] truncate`}
                                title={val}
                              >
                                {val || '—'}
                              </td>
                            );
                          })}

                          {/* 4 System Columns (hidden for Executor as Executor only visualizes specified columns) */}
                          {!isExecutor && (
                            <>
                              {/* System Col 1: Status da vistoria (automático) */}
                              <td
                                className={`${densityPad} bg-slate-50/50 group-hover:bg-blue-50/40 border-r border-slate-100`}
                              >
                                {renderVistoriaStatusBadge(
                                  row.vistoriaStatus === 'Entregue' ? 'Entregue' : 'NAO_DISPONIVEL'
                                )}
                              </td>

                              {/* System Col 2: Arquivo da vistoria (link para abrir/baixar) */}
                              <td
                                className={`${densityPad} bg-slate-50/50 group-hover:bg-blue-50/40 border-r border-slate-100`}
                              >
                                {renderArquivoVistoriaCell(row)}
                              </td>

                              {/* System Col 3: Data/hora da entrega */}
                              <td
                                className={`${densityPad} bg-slate-50/50 group-hover:bg-blue-50/40 font-mono text-slate-700 border-r border-slate-100`}
                              >
                                {row.vistoriaDeliveredAt ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-800 font-semibold">
                                    <Calendar className="w-3 h-3 text-emerald-600" />
                                    <span>{row.vistoriaDeliveredAt}</span>
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>

                              {/* System Col 4: Vistoriador que enviou */}
                              <td
                                className={`${densityPad} bg-slate-50/50 group-hover:bg-blue-50/40 text-slate-800 border-r border-slate-100`}
                              >
                                {row.vistoriaUploadedBy ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                                    <UserCheck className="w-3 h-3 text-blue-600" />
                                    <span>{row.vistoriaUploadedBy}</span>
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}

                  {filteredRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={activeOriginalColumns.length + activeSystemColumns.length}
                        className="py-12 text-center text-xs text-slate-500"
                      >
                        Nenhum site encontrado com os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
        </div>
      </div>

      {/* =====================================================================
          PER-COLUMN FILTER POPOVER MENU
         ===================================================================== */}
      {openColFilterMenu &&
        (() => {
          const { colName, top, left } = openColFilterMenu;
          const selectedVals = columnValueFilters[colName] || [];
          const counts = new Map<string, number>();
          tabRows.forEach((r) => {
            const v = getTssrColumnValue(r, colName) || '—';
            counts.set(v, (counts.get(v) || 0) + 1);
          });
          const q = colMenuSearchText.trim().toLowerCase();
          const entries = Array.from(counts.entries())
            .filter(([val]) => !q || val.toLowerCase().includes(q))
            .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));

          return (
            <div
              className="fixed inset-0 z-50"
              onClick={() => setOpenColFilterMenu(null)}
            >
              <div
                style={{ top: `${top}px`, left: `${left}px` }}
                onClick={(e) => e.stopPropagation()}
                className="fixed w-72 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[360px]"
              >
                <div className="px-3.5 py-2.5 bg-slate-900 text-white flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                      Filtrar Coluna
                    </div>
                    <div className="text-xs font-bold truncate">{colName}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {selectedVals.length > 0 && (
                      <button
                        type="button"
                        onClick={() => clearSingleColumnFilter(colName)}
                        className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-semibold cursor-pointer"
                      >
                        Limpar ({selectedVals.length})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenColFilterMenu(null)}
                      className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-50 border-b border-slate-200">
                  <input
                    type="text"
                    autoFocus
                    value={colMenuSearchText}
                    onChange={(e) => setColMenuSearchText(e.target.value)}
                    placeholder={`Buscar em ${colName}...`}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div className="overflow-y-auto flex-1 divide-y divide-slate-100 p-1">
                  {entries.map(([val, count]) => {
                    const checked = selectedVals.includes(val);
                    return (
                      <label
                        key={val}
                        className={`px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-xs cursor-pointer ${
                          checked
                            ? 'bg-blue-50 text-blue-900 font-semibold'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleColumnFilterValue(colName, val)}
                            className="rounded border-slate-300 text-blue-600 cursor-pointer"
                          />
                          <span className="truncate">{val}</span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">
                          ({count})
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

      {/* =====================================================================
          MODAL: CARREGAR NOVA VERSÃO DA PLANILHA TSSR (.XLSX OU ONEDRIVE)
          (Atualiza as 37 colunas originais sem apagar Status, Arquivo, Data/hora e Vistoriador)
         ===================================================================== */}
      {isImportModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setIsImportModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
          >
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold">
                    Carregar Planilha TSSR — {activeSubTab}
                  </h3>
                  <p className="text-[11px] text-slate-300">
                    Atualiza as 37 colunas originais preservando Status da vistoria, Arquivo e Data de entrega
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {importError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              <div className="flex items-center p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setImportTabMode('file')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    importTabMode === 'file'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Subir Arquivo Excel (.XLSX)
                </button>
                <button
                  type="button"
                  onClick={() => setImportTabMode('onedrive')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    importTabMode === 'onedrive'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sincronizar Link OneDrive
                </button>
              </div>

              {importTabMode === 'file' ? (
                <div className="space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div
                    onClick={() => !importingTssr && fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 hover:border-blue-600 bg-slate-50 hover:bg-blue-50/40 rounded-xl p-6 text-center cursor-pointer transition-colors space-y-2"
                  >
                    <Upload className="w-7 h-7 text-blue-600 mx-auto" />
                    <div className="text-xs font-bold text-slate-800">
                      {importingTssr
                        ? 'Processando planilha TSSR...'
                        : 'Clique para selecionar a planilha TSSR (.xlsx)'}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      O sistema casa as linhas por <strong>Site Id + Oc Site Pre</strong> (ou{' '}
                      <strong>Site Id</strong>) e mantém todas as entregas já registradas pelos vistoriadores.
                    </p>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleOneDriveSync} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Link Compartilhado do Excel Online (OneDrive)
                    </label>
                    <input
                      type="url"
                      required
                      value={oneDriveUrl}
                      onChange={(e) => setOneDriveUrl(e.target.value)}
                      placeholder="https://onedrive.live.com/..."
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsImportModalOpen(false)}
                      className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={importingTssr}
                      className="px-4 py-2 bg-[#223585] hover:bg-[#1b2a6b] disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      {importingTssr ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Sincronizando...</span>
                        </>
                      ) : (
                        <>
                          <CloudDownload className="w-3.5 h-3.5" />
                          <span>Sincronizar Planilha TSSR</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: + NOVA LINHA NA ABA TSSR TIM NOKIA
         ===================================================================== */}
      {isNewRowModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setIsNewRowModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Nova Linha em {activeSubTab}
              </h3>
              <button
                type="button"
                onClick={() => setIsNewRowModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRowSubmit} className="p-5 space-y-3 text-xs">
              {newRowError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{newRowError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Site Id (Sigla) *
                  </label>
                  <input
                    type="text"
                    required
                    value={newRowSiteId}
                    onChange={(e) => setNewRowSiteId(e.target.value.toUpperCase())}
                    placeholder="Ex: SN-OI65J2"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Oc Site Pre
                  </label>
                  <input
                    type="text"
                    value={newRowOcSitePre}
                    onChange={(e) => setNewRowOcSitePre(e.target.value)}
                    placeholder="Ex: 1360413"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Enderecoid
                  </label>
                  <input
                    type="text"
                    value={newRowEnderecoId}
                    onChange={(e) => setNewRowEnderecoId(e.target.value)}
                    placeholder="DFBSA_1601"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">UF</label>
                  <input
                    type="text"
                    maxLength={2}
                    value={newRowUf}
                    onChange={(e) => setNewRowUf(e.target.value.toUpperCase())}
                    placeholder="DF"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Reg</label>
                  <input
                    type="text"
                    value={newRowReg}
                    onChange={(e) => setNewRowReg(e.target.value.toUpperCase())}
                    placeholder="TCO"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Cidade</label>
                  <input
                    type="text"
                    value={newRowCidade}
                    onChange={(e) => setNewRowCidade(e.target.value)}
                    placeholder="Brasília"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">PROJETO</label>
                  <input
                    type="text"
                    value={newRowProjeto}
                    onChange={(e) => setNewRowProjeto(e.target.value)}
                    placeholder="Swap - G3"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    STATUS Engenharia
                  </label>
                  <input
                    type="text"
                    value={newRowStatusEng}
                    onChange={(e) => setNewRowStatusEng(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Executor
                  </label>
                  <input
                    type="text"
                    value={newRowExecutor}
                    onChange={(e) => setNewRowExecutor(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewRowModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingRow}
                  className="px-4 py-2 bg-[#223585] hover:bg-[#1b2a6b] text-white font-semibold rounded-lg cursor-pointer"
                >
                  {creatingRow ? 'Criando...' : 'Criar Linha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          SLIDE-OVER DRAWER FOR TSSR ROW DETAILS
         ===================================================================== */}
      {selectedRow && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex justify-end"
          onClick={() => setSelectedRowId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-emerald-400">
                    {selectedRow.siteId}
                  </span>
                  {renderVistoriaStatusBadge(selectedRow.vistoriaStatus)}
                </div>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Aba {activeSubTab} · Oc Site Pre: {selectedRow.ocSitePre || '—'} · Enderecoid:{' '}
                  {selectedRow.enderecoId || '—'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleDeleteRow(selectedRow)}
                    className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg cursor-pointer"
                    title="Excluir linha"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedRowId(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <form
              onSubmit={handleSaveDrawerRow}
              className="flex-1 overflow-y-auto p-5 space-y-4 text-xs"
            >
              {/* Automatic System Columns Box */}
              <div className="p-4 rounded-xl bg-slate-50 border border-blue-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#223585]">
                    Colunas Automáticas do Sistema (Vistoria)
                  </span>
                  <div className="flex items-center gap-2">
                    {canUploadTssr && (
                      <button
                        type="button"
                        onClick={() => {
                          const sid = selectedRow.siteId;
                          setSelectedRowId(null);
                          if (onNavigateToVistoria) {
                            onNavigateToVistoria(sid);
                          } else {
                            setOpenProjectFolderType('TSSR');
                          }
                        }}
                        className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        title="Subir TSSR vinculado a este site/projeto (vai direto para a pasta do executor)"
                      >
                        <Upload className="w-3 h-3" />
                        <span>Subir TSSR</span>
                      </button>
                    )}
                    {onNavigateToVistoria && (
                      <button
                        type="button"
                        onClick={() => {
                          const sid = selectedRow.siteId;
                          setSelectedRowId(null);
                          onNavigateToVistoria(sid);
                        }}
                        className="px-2.5 py-1 bg-[#223585] hover:bg-[#1b2a6b] text-white rounded-md text-[11px] font-semibold cursor-pointer"
                      >
                        Vistoria do Site
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <div className="text-[10px] text-slate-500 font-semibold">
                      Status da vistoria (automático)
                    </div>
                    <div className="mt-0.5">
                      {renderVistoriaStatusBadge(selectedRow.vistoriaStatus)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 font-semibold">
                      Arquivo da vistoria
                    </div>
                    <div className="mt-0.5">{renderArquivoVistoriaCell(selectedRow)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 font-semibold">
                      Data/hora da entrega
                    </div>
                    <div className="font-mono font-semibold text-slate-800 mt-0.5">
                      {selectedRow.vistoriaDeliveredAt || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 font-semibold">
                      Vistoriador que enviou
                    </div>
                    <div className="font-semibold text-slate-800 mt-0.5">
                      {selectedRow.vistoriaUploadedBy || '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Original Columns (filtered for Executor) */}
              <div className="space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {isExecutor
                    ? `Colunas da Planilha TSSR (${activeOriginalColumns.length} colunas)`
                    : `Colunas Originais da Planilha TSSR (${TSSR_TIM_NOKIA_ORIGINAL_COLUMNS.length} colunas)`}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {activeOriginalColumns.map((colName) => (
                    <div key={colName}>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {colName}
                      </label>
                      <input
                        type="text"
                        value={drawerDraftFields[colName] ?? ''}
                        onChange={(e) =>
                          setDrawerDraftFields((prev) => ({
                            ...prev,
                            [colName]: e.target.value,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="sticky bottom-0 pt-3 pb-1 bg-white border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedRowId(null)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  disabled={savingDrawer}
                  className="px-4 py-2 bg-[#223585] hover:bg-[#1b2a6b] text-white font-semibold rounded-lg cursor-pointer"
                >
                  {savingDrawer ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão de Arquivo de Vistoria */}
      {vistoriaToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px] animate-in fade-in duration-150"
          onClick={() => !deletingVistoria && setVistoriaToDelete(null)}
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
                    Apagar Arquivo de Vistoria
                  </h3>
                  <p className="text-[11px] text-red-700">
                    Site: {vistoriaToDelete.siteId} · {vistoriaToDelete.vistoriaFileName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={deletingVistoria}
                onClick={() => setVistoriaToDelete(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
                <div className="font-semibold text-slate-800">
                  Arquivo: {vistoriaToDelete.vistoriaFileName}
                </div>
                <div className="text-[11px] text-slate-500">
                  Enviado por: {vistoriaToDelete.vistoriaUploadedBy || '—'} · Em: {vistoriaToDelete.vistoriaDeliveredAt || '—'}
                </div>
              </div>

              <p className="text-xs text-slate-600">
                Tem certeza que deseja apagar o arquivo de vistoria deste site? O status da vistoria voltará para <strong>"Vistoria Não Disponível"</strong> e o arquivo será removido do repositório.
              </p>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={deletingVistoria}
                  onClick={() => setVistoriaToDelete(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deletingVistoria}
                  onClick={handleConfirmDeleteVistoria}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{deletingVistoria ? 'Apagando...' : 'Sim, Apagar Arquivo'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Google Drive Integration Modal */}
      <GoogleDriveModal
        isOpen={isGoogleDriveOpen}
        onClose={() => setIsGoogleDriveOpen(false)}
        onImportTssr={(rows, sheets, msg) => {
          onTssrUpdated(rows, sheets, msg);
          setIsGoogleDriveOpen(false);
        }}
        currentTssrRows={tabRows}
        currentVendor={activeVendor}
      />
    </div>
  );
};
