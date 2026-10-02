/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search,
  ClipboardPaste,
  FileSpreadsheet,
  Download,
  Plus,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FolderKanban,
  RefreshCw,
  CloudDownload,
  ArrowLeftToLine,
  ArrowRightToLine,
  Columns3,
  LayoutList,
  Table,
  Filter,
  RotateCcw,
  FolderOpen,
  ShieldCheck,
  Maximize2,
  Minimize2,
  X,
  Sparkles,
  UserCheck,
  Receipt,
  Eye,
  Edit3,
  Trash2,
  Users,
  Cloud,
} from 'lucide-react';
import {
  TelecomSite,
  SpreadsheetMeta,
  AmetaUser,
  UserRole,
  normalizeUserRole,
  VendorType,
  SiteStatus,
  EngineeringFolder,
  EngineeringFile,
  MandatoryDocType,
  ensureUserMandatoryDocuments,
  evaluateUserOverallDocumentStatus,
  TssrRow,
  TssrSheetMeta,
  EricssonRow,
  EricssonSheetMeta,
  CONTROLE_GERAL_COLUMNS,
  CONTROLE_CANCELADOS_COLUMNS,
  EQUIPES_COLUMNS,
  AmetaNotification,
  isOwnerAdmUser,
  isUserDono,
  isUserAguardando,
  hasFullSpreadsheetAccess,
  isEngineeringCoordinatorRole,
  canUserAccessVendor,
} from './types/telecom';
import { signOut } from 'firebase/auth';
import { auth, isFirebaseEnvConfigured } from './lib/firebase';
import { dataService } from './services/dataService';
import { INITIAL_SITES, INITIAL_SHEETS } from './data/initialSites';
import { AuthGate } from './components/AuthGate';
import { AmetaLogo } from './components/AmetaLogo';
import { SiteDetailDrawer } from './components/SiteDetailDrawer';
import { BulkPasteModal } from './components/BulkPasteModal';
import { NewSiteModal } from './components/NewSiteModal';
import { EngineeringVistoriasTab } from './components/EngineeringVistoriasTab';
import { EngineeringControlTab } from './components/EngineeringControlTab';
import { EricssonSitesTab } from './components/EricssonSitesTab';
import { EricssonVistoriaTab } from './components/EricssonVistoriaTab';
import { EricssonEngenhariaTab } from './components/EricssonEngenhariaTab';
import { computeEricssonSiteCounters } from './utils/ericssonSpreadsheetUtils';
import { AdminAccessPanel } from './components/AdminAccessPanel';
import { NotificationBellDropdown } from './components/NotificationBellDropdown';
import { OwnerPermissionsModal } from './components/OwnerPermissionsModal';
import {
  InteractiveSpreadsheetChart,
  ChartCategoryFilter,
  isSiteParaFazer,
  isSiteFeito,
  isSiteNotaPendente,
  sortSitesParaFazerFirst,
  getSiteExecutionSortBucket,
} from './components/InteractiveSpreadsheetChart';
import { DuplasInteractiveView } from './components/DuplasInteractiveView';
import {
  subscribeToCloudWorkspaceUpdates,
  connectAndSyncFirebaseCloud,
  subscribeToFirebaseAuthStatus,
  updateCachedClientState,
  cloudFetch,
} from './lib/firebaseCloud';

const fetch = cloudFetch;
import {
  exportSitesToCsv,
  exportSitesToXlsx,
  getExcelColumnLetter,
  getCellValueForColumn,
  syncSiteColumnUpdate,
  STATUS_FINANCEIRO_OPTIONS,
  doesSiteMatchResponsible,
  doesSiteMatchEquipe,
  doesSiteMatchExecutor,
  getCanonicalDuplaName,
  getCanonicalExecutorName,
  getShortResponsibleLabel,
  doesDocumentMatchResponsible,
  doesFileMatchUserResponsibleSites,
  DEFAULT_EQUIPES_DUPLAS,
} from './utils/spreadsheetUtils';

const STORAGE_USER_KEY = 'ameta_authenticated_user_v1';
const STORAGE_DUPLAS_KEY = 'ameta_custom_duplas_v1';

type TableDensity = 'comfortable' | 'compact' | 'ultra';

type WorkspaceTopTab =
  | 'sites'
  | 'engenharia'
  | 'vistoria'
  | 'duplas'
  | 'perfis'
  | 'novo_site'
  | 'importar'
  | 'colar'
  | 'exportar'
  | 'simular';

type ControleGeralFunctionFilter =
  | 'TODOS_GERAL'
  | 'NOVOS'
  | 'ENGENHARIA'
  | 'FINALIZADAS'
  | 'ABONO'
  | 'SEM_CHAVES_ACESSO'
  | 'CANCELADOS'
  | 'LIDERANCA_5G_ANF'
  | 'FINANCEIRO'
  | 'EQUIPES';

export default function App() {
  const [user, setUser] = useState<AmetaUser | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_USER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as AmetaUser;
        if (parsed && parsed.emailVerified) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return null;
  });

  const [sites, setSites] = useState<TelecomSite[]>(INITIAL_SITES);
  const [sheets, setSheets] = useState<SpreadsheetMeta[]>(INITIAL_SHEETS);
  const [engineeringFolders, setEngineeringFolders] = useState<EngineeringFolder[]>([]);
  const [engineeringFiles, setEngineeringFiles] = useState<EngineeringFile[]>([]);
  const [tssrRows, setTssrRows] = useState<TssrRow[]>([]);
  const [tssrSheets, setTssrSheets] = useState<TssrSheetMeta[]>([]);
  const [vistoriaPreselectedSiteId, setVistoriaPreselectedSiteId] = useState<string | null>(null);
  const [ericssonRows, setEricssonRows] = useState<EricssonRow[]>([]);
  const [ericssonSheetMeta, setEricssonSheetMeta] = useState<EricssonSheetMeta | undefined>(
    undefined
  );
  const [ericssonFolders, setEricssonFolders] = useState<EngineeringFolder[]>([]);
  const [ericssonFiles, setEricssonFiles] = useState<EngineeringFile[]>([]);
  const [ericssonUsers, setEricssonUsers] = useState<AmetaUser[]>([]);
  const [notifications, setNotifications] = useState<AmetaNotification[]>([]);
  const [serverDuplaEmailsMap, setServerDuplaEmailsMap] = useState<Record<string, string[]>>({});
  const [ownerPermissionsModalOpen, setOwnerPermissionsModalOpen] = useState<boolean>(false);
  const [ericssonVistoriaFocus, setEricssonVistoriaFocus] = useState<{
    folderId?: string;
    fileId?: string;
    fileName?: string;
  } | null>(null);
  const [users, setUsers] = useState<AmetaUser[]>([]);
  const [activeVendor, setActiveVendor] = useState<VendorType>('NOKIA');

  // Top navigation tab ('sites', 'engenharia', or 'perfis' for ADM)
  const [activeTopTab, setActiveTopTab] = useState<WorkspaceTopTab>('sites');
  const [activeSheetName, setActiveSheetName] = useState<string>('Controle Geral');

  // Unified "Pasta Controle Geral" open state + expanded full list state + fullscreen state + internal function/status filters
  const [controleGeralOpen, setControleGeralOpen] = useState<boolean>(true);
  const [isSitesListExpanded, setIsSitesListExpanded] = useState<boolean>(false);
  const [isSpreadsheetFullscreen, setIsSpreadsheetFullscreen] = useState<boolean>(false);
  const [functionFilter, setFunctionFilter] =
    useState<ControleGeralFunctionFilter>('TODOS_GERAL');

  // Granular dropdown filters inside Pasta Controle Geral
  const [prioridadeFilter, setPrioridadeFilter] = useState<string>('ALL');
  const [projetoFilter, setProjetoFilter] = useState<string>('ALL');
  const [regionalFilter, setRegionalFilter] = useState<string>('ALL');
  const [ufFilter, setUfFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [acessoFilter, setAcessoFilter] = useState<string>('ALL');
  const [financeiroFilter, setFinanceiroFilter] = useState<string>('ALL');
  const [equipeFilter, setEquipeFilter] = useState<string>('ALL');
  const [executorFilter, setExecutorFilter] = useState<string>('ALL');
  const [chartQuickFilter, setChartQuickFilter] = useState<ChartCategoryFilter>('ALL');
  const [responsavelDemandFilter, setResponsavelDemandFilter] = useState<string>('ALL');
  const [isDemandaPorResponsavelOpen, setIsDemandaPorResponsavelOpen] = useState<boolean>(false);
  const [quickAssignSitesInput, setQuickAssignSitesInput] = useState<string>('');
  const [quickAssignTargetName, setQuickAssignTargetName] = useState<string>('Usuário Teste');
  const [simulatedTargetUser, setSimulatedTargetUser] = useState<AmetaUser | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [columnSearchTerm, setColumnSearchTerm] = useState<string>('');

  // Per-column header dropdown filters (colKey -> array of selected values)
  const [columnValueFilters, setColumnValueFilters] = useState<Record<string, string[]>>({});
  const [openColFilterMenu, setOpenColFilterMenu] = useState<{
    colKey: string;
    colLabel: string;
    top: number;
    left: number;
  } | null>(null);
  const [colMenuSearchText, setColMenuSearchText] = useState<string>('');

  // View mode inside Pasta Controle Geral ('fluid' list vs 'grid' all columns Col A -> Observação)
  const [folderViewMode, setFolderViewMode] = useState<'fluid' | 'grid'>('fluid');
  const [tableDensity, setTableDensity] = useState<TableDensity>('compact');

  // Dynamic Filter Chip System ("+ Adicionar Filtro") state
  const [isAddFilterMenuOpen, setIsAddFilterMenuOpen] = useState<boolean>(false);
  const [activeFilterPickerCategory, setActiveFilterPickerCategory] = useState<string>('VISAO');

  // Editable Duplas (Equipe Executante) state
  const [customDuplas, setCustomDuplas] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DUPLAS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_EQUIPES_DUPLAS;
  });
  const [isEditDuplasModalOpen, setIsEditDuplasModalOpen] = useState<boolean>(false);
  const [newDuplaInput, setNewDuplaInput] = useState<string>('');
  const [editingDuplaTarget, setEditingDuplaTarget] = useState<string | null>(null);
  const [editingDuplaValue, setEditingDuplaValue] = useState<string>('');
  const [isRaMenuOpen, setIsRaMenuOpen] = useState<boolean>(false);
  const [firebaseCloudStatus, setFirebaseCloudStatus] = useState<{
    connected: boolean;
    email: string | null;
  }>({ connected: false, email: null });
  const [isSyncingFirebase, setIsSyncingFirebase] = useState<boolean>(false);

  // Top bar quick search state
  const [quickSiteQuery, setQuickSiteQuery] = useState<string>('');
  const [quickDropdownOpen, setQuickDropdownOpen] = useState<boolean>(false);

  // Selected site for Fluid Popup Modal
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  // Inline cell editing state for spreadsheet mode
  const [editingCell, setEditingCell] = useState<{
    siteId: string;
    colHeader: string;
    value: string;
  } | null>(null);

  // Modals
  const [bulkModalOpen, setBulkModalOpen] = useState<boolean>(false);
  const [bulkInitialTab, setBulkInitialTab] = useState<'paste' | 'excel' | 'onedrive'>('onedrive');
  const [pastedShortcutText, setPastedShortcutText] = useState<string>('');
  const [newSiteModalOpen, setNewSiteModalOpen] = useState<boolean>(false);

  // Real-time notification toast
  const [liveToast, setLiveToast] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toISOString());

  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setLiveToast(msg);
    setTimeout(() => {
      setLiveToast((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  // Connect to Real-Time SSE stream (/api/stream) + auto-reconnect + fast real-time poll fallback
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isUnmounted = false;

    const applyIncomingState = (payload: Record<string, unknown>, isStreamEvent = false) => {
      if (Array.isArray(payload.sites)) {
        setSites(payload.sites as TelecomSite[]);
      }
      if (Array.isArray(payload.sheets)) {
        setSheets(payload.sheets as SpreadsheetMeta[]);
      }
      if (Array.isArray(payload.engineeringFolders)) {
        setEngineeringFolders(payload.engineeringFolders as EngineeringFolder[]);
      }
      if (Array.isArray(payload.engineeringFiles)) {
        setEngineeringFiles(payload.engineeringFiles as EngineeringFile[]);
      }
      if (Array.isArray(payload.tssrRows)) {
        setTssrRows(payload.tssrRows as TssrRow[]);
      }
      if (Array.isArray(payload.tssrSheets)) {
        setTssrSheets(payload.tssrSheets as TssrSheetMeta[]);
      }
      if (Array.isArray(payload.ericssonRows)) {
        setEricssonRows(payload.ericssonRows as EricssonRow[]);
      }
      if (payload.ericssonSheetMeta) {
        setEricssonSheetMeta(payload.ericssonSheetMeta as EricssonSheetMeta);
      }
      if (Array.isArray(payload.ericssonFolders)) {
        setEricssonFolders(payload.ericssonFolders as EngineeringFolder[]);
      }
      if (Array.isArray(payload.ericssonFiles)) {
        setEricssonFiles(payload.ericssonFiles as EngineeringFile[]);
      }
      if (Array.isArray(payload.ericssonUsers)) {
        setEricssonUsers(payload.ericssonUsers as AmetaUser[]);
      }
      if (Array.isArray(payload.notifications)) {
        setNotifications(payload.notifications as AmetaNotification[]);
      }
      if (payload.duplaEmailsMap && typeof payload.duplaEmailsMap === 'object') {
        setServerDuplaEmailsMap(payload.duplaEmailsMap as Record<string, string[]>);
      }
      if (Array.isArray(payload.users)) {
        const nextUsers = payload.users as AmetaUser[];
        setUsers(nextUsers);
        setSimulatedTargetUser((prevSim) => {
          if (!prevSim) return null;
          return nextUsers.find((u) => u.id === prevSim.id) || prevSim;
        });
        setUser((prevUser) => {
          if (!prevUser) return null;
          const updatedSelf = nextUsers.find(
            (u) =>
              u.id === prevUser.id ||
              u.email.toLowerCase() === prevUser.email.toLowerCase()
          );
          if (updatedSelf) {
            try {
              localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(updatedSelf));
            } catch {
              // ignore storage errors
            }
            return updatedSelf;
          }
          return prevUser;
        });
      }
      if (typeof payload.lastUpdated === 'string') {
        setLastSyncTime(payload.lastUpdated);
      }
      if (
        isStreamEvent &&
        typeof payload.summary === 'string' &&
        payload.summary &&
        payload.type !== 'FULL_STATE'
      ) {
        showToast(payload.summary);
      }
    };

    const fetchLatestState = async () => {
      try {
        const res = await fetch('/api/state', { cache: 'no-store' });
        if (res.ok && !isUnmounted) {
          const data = await res.json();
          applyIncomingState(data, false);
        }
      } catch {
        // Fallback to current state if offline
      }
    };

    const connectStream = () => {
      if (isUnmounted) return;
      try {
        eventSource?.close();
        eventSource = new EventSource('/api/stream');
        eventSource.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            applyIncomingState(payload, true);
          } catch {
            // ignore malformed SSE packet
          }
        };
        eventSource.onerror = () => {
          eventSource?.close();
          if (!isUnmounted) {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connectStream, 2000);
          }
        };
      } catch {
        if (!isUnmounted) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectStream, 2500);
        }
      }
    };

    fetchLatestState();
    connectStream();
    subscribeToCloudWorkspaceUpdates(() => {
      fetchLatestState();
    });
    const unsubFirebaseAuth = subscribeToFirebaseAuthStatus((status) => {
      setFirebaseCloudStatus(status);
    });

    // Real-time background sync every 2.5s + immediate sync on tab focus/visibility so no change is ever missed
    const pollInterval = setInterval(fetchLatestState, 2500);
    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchLatestState();
      }
    };
    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(pollInterval);
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      eventSource?.close();
      unsubFirebaseAuth();
    };
  }, [showToast]);

  const handleConnectFirebaseCloud = async () => {
    if (isSyncingFirebase) return;
    setIsSyncingFirebase(true);
    try {
      const result = await connectAndSyncFirebaseCloud({
        sites,
        users,
        ericssonUsers,
        duplaEmailsMap: serverDuplaEmailsMap,
        notifications,
        engineeringFolders,
        engineeringFiles,
        ericssonRows,
        ericssonFolders,
        ericssonFiles,
        tssrRows,
      });
      if (result.state) {
        if (Array.isArray(result.state.sites) && result.state.sites.length > 0) {
          setSites(result.state.sites);
        }
        if (Array.isArray(result.state.users) && result.state.users.length > 0) {
          setUsers(result.state.users);
        }
        if (Array.isArray(result.state.ericssonUsers)) {
          setEricssonUsers(result.state.ericssonUsers);
        }
        if (result.state.duplaEmailsMap) {
          setServerDuplaEmailsMap(result.state.duplaEmailsMap);
        }
        if (Array.isArray(result.state.notifications)) {
          setNotifications(result.state.notifications);
        }
        if (Array.isArray(result.state.engineeringFolders)) {
          setEngineeringFolders(result.state.engineeringFolders);
        }
        if (Array.isArray(result.state.engineeringFiles)) {
          setEngineeringFiles(result.state.engineeringFiles);
        }
        if (Array.isArray(result.state.ericssonRows)) {
          setEricssonRows(result.state.ericssonRows);
        }
        if (Array.isArray(result.state.ericssonFolders)) {
          setEricssonFolders(result.state.ericssonFolders);
        }
        if (Array.isArray(result.state.ericssonFiles)) {
          setEricssonFiles(result.state.ericssonFiles);
        }
        if (Array.isArray(result.state.tssrRows)) {
          setTssrRows(result.state.tssrRows);
        }
      }
      setLastSyncTime(new Date().toISOString());
      showToast(
        `Firebase Cloud ligado e sincronizado (${result.firebaseEmail || 'Nuvem Ativa'})!`
      );
    } catch (err) {
      showToast(
        err instanceof Error
          ? `Atenção ao conectar Firebase: ${err.message}`
          : 'Não foi possível abrir o login do Firebase Cloud.'
      );
    } finally {
      setIsSyncingFirebase(false);
    }
  };

  // Listen for direct Ctrl+V anywhere on the workspace (Nokia only)
  useEffect(() => {
    if (!user || activeVendor !== 'NOKIA') return;

    const handleGlobalPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const text = e.clipboardData?.getData('text/plain');
      if (text && text.trim().length > 0) {
        e.preventDefault();
        setPastedShortcutText(text);
        setBulkInitialTab('paste');
        setBulkModalOpen(true);
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [user, activeVendor]);

  // Allow exiting Fullscreen Spreadsheet mode with Escape key
  useEffect(() => {
    if (!isSpreadsheetFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selectedSiteId && !openColFilterMenu) {
        setIsSpreadsheetFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSpreadsheetFullscreen, selectedSiteId, openColFilterMenu]);

  const resetAllInternalFilters = () => {
    setFunctionFilter('TODOS_GERAL');
    setChartQuickFilter('ALL');
    setPrioridadeFilter('ALL');
    setProjetoFilter('ALL');
    setRegionalFilter('ALL');
    setUfFilter('ALL');
    setStatusFilter('ALL');
    setAcessoFilter('ALL');
    setFinanceiroFilter('ALL');
    setEquipeFilter('ALL');
    setExecutorFilter('ALL');
    setResponsavelDemandFilter('ALL');
    setSearchTerm('');
    setQuickSiteQuery('');
    setColumnValueFilters({});
    setOpenColFilterMenu(null);
  };

  const handleAuthenticated = (authenticatedUser: AmetaUser, initialVendor?: VendorType) => {
    const normalizedRole = normalizeUserRole(authenticatedUser.role);
    const updatedUser: AmetaUser = { ...authenticatedUser, role: normalizedRole };
    setUser(updatedUser);
    localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(updatedUser));
    const chosenVendor = initialVendor || authenticatedUser.preferredVendor || 'NOKIA';
    setActiveVendor(chosenVendor);
    setActiveSheetName(chosenVendor === 'NOKIA' ? 'Controle Geral' : 'ALL');
    setActiveTopTab('sites');
  };

  const handleLogout = async () => {
    if (isFirebaseEnvConfigured && auth) {
      try {
        await signOut(auth);
      } catch {
        // ignore signOut errors
      }
    }
    setUser(null);
    setSimulatedTargetUser(null);
    localStorage.removeItem(STORAGE_USER_KEY);
    setSelectedSiteId(null);
  };

  // Real-time Firestore subscriptions via decoupled dataService layer
  useEffect(() => {
    if (!user || !user.emailVerified || !isFirebaseEnvConfigured) return;

    const unsubs: Array<() => void> = [];
    const uid = user.uid || auth?.currentUser?.uid || user.id;

    // 1. Escuta em tempo real o documento do próprio usuário em usuarios/{uid}
    if (uid) {
      unsubs.push(
        dataService.observarPerfilUsuario(uid, (remoteProfile) => {
          if (!remoteProfile) return;
          setUser((prev) => {
            if (!prev) return prev;
            const merged: AmetaUser = {
              ...prev,
              ...remoteProfile,
              emailVerified: true,
            };
            try {
              localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(merged));
            } catch {
              // ignore storage error
            }
            return merged;
          });
        })
      );
    }

    // Se o usuário estiver em situação "aguardando" ou "bloqueado", não abre leituras de dados
    if (isUserAguardando(user) || user.situacao === 'bloqueado') {
      return () => {
        unsubs.forEach((u) => u());
      };
    }

    // 2. Escuta coleções isoladas por plataforma (TIM/Nokia ou Ericsson) e perfis de usuários
    unsubs.push(
      dataService.observarColecoesPlataforma(user, {
        onUsuarios: (remoteUsers) => {
          if (remoteUsers.length > 0) {
            setUsers((prev) => {
              const byEmail = new Map<string, AmetaUser>();
              for (const p of prev) {
                byEmail.set(p.email.trim().toLowerCase(), p);
              }
              for (const r of remoteUsers) {
                const em = r.email.trim().toLowerCase();
                const existing = byEmail.get(em);
                byEmail.set(em, existing ? { ...existing, ...r } : r);
              }
              const mergedList = Array.from(byEmail.values());
              updateCachedClientState({ users: mergedList });
              return mergedList;
            });
          }
        },
        onNokiaSites: (remoteSites) => {
          if (remoteSites.length > 0) {
            setSites(remoteSites);
            updateCachedClientState({ sites: remoteSites });
            setLastSyncTime(new Date().toISOString());
          }
        },
        onNokiaTssr: (remoteTssr) => {
          if (remoteTssr.length > 0) {
            setTssrRows(remoteTssr);
            updateCachedClientState({ tssrRows: remoteTssr });
          }
        },
        onNokiaFolders: (remoteFolders) => {
          if (remoteFolders.length > 0) {
            setEngineeringFolders(remoteFolders);
            updateCachedClientState({ engineeringFolders: remoteFolders });
          }
        },
        onNokiaFiles: (remoteFiles) => {
          if (remoteFiles.length > 0) {
            setEngineeringFiles(remoteFiles);
            updateCachedClientState({ engineeringFiles: remoteFiles });
          }
        },
        onEricssonSites: (remoteEricRows) => {
          if (remoteEricRows.length > 0) {
            setEricssonRows(remoteEricRows);
            updateCachedClientState({ ericssonRows: remoteEricRows });
            setLastSyncTime(new Date().toISOString());
          }
        },
        onEricssonFolders: (remoteEricFolders) => {
          if (remoteEricFolders.length > 0) {
            setEricssonFolders(remoteEricFolders);
            updateCachedClientState({ ericssonFolders: remoteEricFolders });
          }
        },
        onEricssonFiles: (remoteEricFiles) => {
          if (remoteEricFiles.length > 0) {
            setEricssonFiles(remoteEricFiles);
            updateCachedClientState({ ericssonFiles: remoteEricFiles });
          }
        },
      })
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [
    user?.id,
    user?.uid,
    user?.email,
    user?.emailVerified,
    user?.situacao,
    user?.role,
    user?.plataforma,
    user?.assignedPlatform,
  ]);

  const handleSwitchVendor = async (vendor: VendorType) => {
    setActiveVendor(vendor);
    setActiveSheetName(vendor === 'NOKIA' ? 'Controle Geral' : 'ALL');
    if (
      vendor === 'ERICSSON' &&
      (activeTopTab === 'novo_site' ||
        activeTopTab === 'importar' ||
        activeTopTab === 'colar' ||
        activeTopTab === 'exportar')
    ) {
      setActiveTopTab('sites');
    }
    resetAllInternalFilters();
    if (user) {
      try {
        await fetch('/api/auth/preference', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email, preferredVendor: vendor }),
        });
      } catch {
        // non-blocking
      }
    }
  };

  const ericssonSiteCounters = useMemo(
    () => computeEricssonSiteCounters(ericssonRows),
    [ericssonRows]
  );

  // Sync logged-in user's role if updated in the users list (only Rafael Araújo is ADM Dono)
  const isOwnerAdm = isOwnerAdmUser(user?.email);

  const realUserRole: UserRole = useMemo(() => {
    if (!user) return 'Vistoriador';
    if (isOwnerAdmUser(user.email)) return 'ADM';
    const fromNokia = users.find((u) => u.email.toLowerCase() === user.email.toLowerCase());
    const fromEric = ericssonUsers.find(
      (u) => u.email.toLowerCase() === user.email.toLowerCase()
    );
    const fromServer = fromNokia || fromEric;
    if (fromServer) {
      return normalizeUserRole(fromServer.role, user.email);
    }
    return normalizeUserRole(user.role, user.email);
  }, [user, users, ericssonUsers]);

  const isRealAdmin = isOwnerAdm || realUserRole === 'ADM';
  const activeTargetUser: AmetaUser | null = simulatedTargetUser || user;
  const effectiveRole: UserRole = simulatedTargetUser
    ? normalizeUserRole(simulatedTargetUser.role, simulatedTargetUser.email)
    : realUserRole;

  const canSeeFullSpreadsheets = hasFullSpreadsheetAccess(effectiveRole);
  const isEngCoordinator = isEngineeringCoordinatorRole(effectiveRole);
  const canSeeSitesTab = !isEngCoordinator;
  const canSeeEngenhariaTab =
    effectiveRole === 'ADM' ||
    effectiveRole === 'Coordenador Geral' ||
    effectiveRole === 'Coordenador Engenharia';

  const canAccessNokia = canUserAccessVendor(activeTargetUser, 'NOKIA');
  const canAccessEricsson = canUserAccessVendor(activeTargetUser, 'ERICSSON');

  // Automatically enforce platform scope when user/simulated user is bound to NOKIA or ERICSSON
  useEffect(() => {
    if (!activeTargetUser) return;
    if (!canAccessNokia && canAccessEricsson && activeVendor !== 'ERICSSON') {
      setActiveVendor('ERICSSON');
    } else if (!canAccessEricsson && canAccessNokia && activeVendor !== 'NOKIA') {
      setActiveVendor('NOKIA');
    }
  }, [activeTargetUser, canAccessNokia, canAccessEricsson, activeVendor]);

  const testUserAccount = useMemo<AmetaUser>(() => {
    const found = users.find(
      (u) =>
        u.email.toLowerCase() === 'teste@ameta.com.br' ||
        u.name.toLowerCase().includes('teste')
    );
    if (found) return found;
    return {
      id: 'usr-teste-1',
      name: 'Usuário Teste',
      email: 'teste@ameta.com.br',
      role: 'Executor',
      equipe: 'Equipe de Teste',
      emailVerified: true,
      createdAt: '',
    };
  }, [users]);

  const assignableUsersList = useMemo<AmetaUser[]>(() => {
    const nonAdm = users.filter((u) => normalizeUserRole(u.role) !== 'ADM');
    if (nonAdm.some((u) => u.email.toLowerCase() === testUserAccount.email.toLowerCase())) {
      return nonAdm;
    }
    return [testUserAccount, ...nonAdm];
  }, [users, testUserAccount]);

  // Unified list of Duplas / Equipes Executantes shared between TIM/Nokia and Ericsson
  const equipesDuplas = useMemo<string[]>(() => {
    const set = new Set<string>();
    customDuplas.forEach((d) => {
      const c = getCanonicalDuplaName(d) || d.trim();
      if (c) set.add(c);
    });
    const addFromUserList = (list: AmetaUser[]) => {
      list.forEach((u) => {
        if (
          u.equipe &&
          u.equipe.trim() &&
          u.equipe !== 'Ameta Telecom' &&
          u.equipe !== 'Campo / Engenharia' &&
          u.equipe !== 'Coordenação / ADM' &&
          !u.equipe.startsWith('Coordenação') &&
          u.equipe !== 'Equipe de Teste'
        ) {
          const c = getCanonicalDuplaName(u.equipe) || u.equipe.trim();
          if (c) set.add(c);
        }
      });
    };
    addFromUserList(assignableUsersList);
    addFromUserList(ericssonUsers);

    sites.forEach((s) => {
      const eq = (getCellValueForColumn(s, 'EQUIPE EXECUTANTE') || s.equipeParceira || '').trim();
      const canon = getCanonicalDuplaName(eq);
      if (canon) set.add(canon);
    });

    ericssonRows.forEach((r) => {
      const eq = (r.equipe || r.fields?.['EQUIPE'] || '').trim();
      if (eq && eq !== '—' && eq !== '-') {
        const canon = getCanonicalDuplaName(eq) || eq;
        if (canon) set.add(canon);
      }
    });

    return Array.from(set);
  }, [customDuplas, assignableUsersList, ericssonUsers, sites, ericssonRows]);

  const saveCustomDuplas = (nextList: string[]) => {
    setCustomDuplas(nextList);
    try {
      localStorage.setItem(STORAGE_DUPLAS_KEY, JSON.stringify(nextList));
    } catch {
      // ignore storage error
    }
  };

  const handleAddDupla = () => {
    const clean = newDuplaInput.trim();
    if (!clean) return;
    if (customDuplas.some((d) => d.toLowerCase() === clean.toLowerCase())) {
      showToast(`A dupla/equipe "${clean}" já está cadastrada.`);
      return;
    }
    const next = [clean, ...customDuplas];
    saveCustomDuplas(next);
    setNewDuplaInput('');
    showToast(`Dupla "${clean}" adicionada em Equipe Executante.`);
  };

  const handleSaveEditDupla = async (oldName: string) => {
    const clean = editingDuplaValue.trim();
    if (!clean || clean === oldName) {
      setEditingDuplaTarget(null);
      return;
    }
    const nextList = customDuplas.map((d) => (d === oldName ? clean : d));
    if (!nextList.includes(clean)) nextList.unshift(clean);
    saveCustomDuplas(nextList);
    setEditingDuplaTarget(null);

    try {
      const res = await fetch('/api/sites/assign-responsible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          renameFrom: oldName,
          renameTo: clean,
          vendor: activeVendor,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.sites)) setSites(data.sites);
      }
    } catch {
      // ignore offline error
    }
    showToast(`Dupla atualizada de "${oldName}" para "${clean}".`);
  };

  const handleDeleteDupla = async (targetName: string) => {
    const canonTarget = getCanonicalDuplaName(targetName) || targetName;
    const next = customDuplas.filter((d) => {
      const canonD = getCanonicalDuplaName(d) || d;
      return d !== targetName && canonD.toLowerCase() !== canonTarget.toLowerCase();
    });
    saveCustomDuplas(next);
    await handleBulkAssignSitesResponsible('', '', targetName);
    showToast(`Dupla "${targetName}" removida e sites desvinculados.`);
  };

  const [initialExpandedUserId, setInitialExpandedUserId] = useState<string | null>(null);

  // Enforce tab access based on effectiveRole (RA function tabs are exclusive to ADM; Vistoriador cannot access Engenharia, only Sites and Vistoria)
  const isRaFunctionTab =
    activeTopTab !== 'sites' &&
    activeTopTab !== 'engenharia' &&
    activeTopTab !== 'vistoria';

  const resolvedTopTab: WorkspaceTopTab = useMemo(() => {
    if (isRaFunctionTab && (!isRealAdmin || simulatedTargetUser)) {
      return isEngCoordinator ? 'engenharia' : 'sites';
    }
    // Coordenador Engenharia sees ONLY Engenharia and Vistoria
    if (isEngCoordinator && activeTopTab === 'sites') {
      return 'engenharia';
    }
    // Executor and Vistoriador see ONLY Sites (demanded to them) and Vistoria
    if (
      activeTopTab === 'engenharia' &&
      (effectiveRole === 'Vistoriador' || effectiveRole === 'Executor')
    ) {
      return 'vistoria';
    }
    return activeTopTab;
  }, [
    isRealAdmin,
    simulatedTargetUser,
    activeTopTab,
    isRaFunctionTab,
    effectiveRole,
    isEngCoordinator,
  ]);

  // Vendor-specific sheets and sites
  const vendorSheets = useMemo(
    () => sheets.filter((s) => s.vendor === activeVendor),
    [sheets, activeVendor]
  );

  // Full vendor sites before per-user demand filtering (used by ADM to see counts per responsible)
  const allVendorSites = useMemo(
    () => sites.filter((s) => s.vendor === activeVendor),
    [sites, activeVendor]
  );

  const allVendorControleGeralSites = useMemo(
    () =>
      allVendorSites.filter((s) =>
        activeVendor === 'NOKIA' ? s.sheetName === 'Controle Geral' : true
      ),
    [allVendorSites, activeVendor]
  );

  // Per-User Responsible Demand Filtering:
  // - Executors and Vistoriadores ONLY see sites explicitly demanded/assigned to them
  // - ADM and Coordenador Geral see all sites by default
  const vendorSites = useMemo(() => {
    if (!activeTargetUser) return allVendorSites;
    if (!canSeeFullSpreadsheets && !isEngCoordinator) {
      return allVendorSites.filter(
        (s) => s.sheetName === 'Equipes' || doesSiteMatchResponsible(s, activeTargetUser)
      );
    }
    if (responsavelDemandFilter !== 'ALL') {
      return allVendorSites.filter(
        (s) => s.sheetName === 'Equipes' || doesSiteMatchResponsible(s, responsavelDemandFilter)
      );
    }
    return allVendorSites;
  }, [
    allVendorSites,
    activeTargetUser,
    canSeeFullSpreadsheets,
    isEngCoordinator,
    responsavelDemandFilter,
  ]);

  // Base pools by sheet for quick counts on the filter buttons
  const rawControleGeralPool = useMemo(
    () =>
      vendorSites.filter((s) =>
        activeVendor === 'NOKIA' ? s.sheetName === 'Controle Geral' : true
      ),
    [vendorSites, activeVendor]
  );

  const rawCanceladosPool = useMemo(
    () => vendorSites.filter((s) => s.sheetName === 'Controle Cancelados'),
    [vendorSites]
  );

  const rawEquipesPool = useMemo(
    () => vendorSites.filter((s) => s.sheetName === 'Equipes'),
    [vendorSites]
  );

  // Helper predicates for each filter button in Pasta Controle Geral
  const isEngenhariaSite = useCallback((s: TelecomSite) => {
    const prio = (getCellValueForColumn(s, 'Prioridade') || '').toLowerCase();
    return prio === 'engenharia' || prio === '';
  }, []);

  const isFinalizadaSite = useCallback((s: TelecomSite) => {
    const st = (getCellValueForColumn(s, 'STATUS') || s.status || '').toLowerCase();
    return st.includes('finalizada') || st === 'ativo';
  }, []);

  const isAbonoSite = useCallback((s: TelecomSite) => {
    const prio = (getCellValueForColumn(s, 'Prioridade') || '').toLowerCase();
    const dataAbono = (getCellValueForColumn(s, 'Data do Abono') || '').trim();
    const imp = (getCellValueForColumn(s, 'Improdutiva') || '').trim();
    const pend = (getCellValueForColumn(s, 'Pendência Engenharia') || '').trim();
    return (
      prio.includes('abono') ||
      prio.includes('verificar') ||
      prio.includes('gsd') ||
      dataAbono !== '' ||
      imp !== '' ||
      pend !== ''
    );
  }, []);

  const isSemChavesOuAcessoSite = useCallback((s: TelecomSite) => {
    const st = (getCellValueForColumn(s, 'STATUS') || s.status || '').toLowerCase();
    const ac = (getCellValueForColumn(s, 'Acesso') || '').toLowerCase();
    const comAc = (getCellValueForColumn(s, 'Comentários do Acesso') || '').toLowerCase();
    return (
      st.includes('sem chave') ||
      st.includes('sem acesso') ||
      st.includes('solicitado') ||
      st.includes('aguard') ||
      st.includes('executar') ||
      st.includes('zeladoria') ||
      ac.includes('solicitar') ||
      ac.includes('solicitado') ||
      comAc.includes('chave') ||
      comAc.includes('sem acesso')
    );
  }, []);

  const isLideranca5GSite = useCallback((s: TelecomSite) => {
    const prio = (getCellValueForColumn(s, 'Prioridade') || '').toUpperCase();
    const proj = (getCellValueForColumn(s, 'PROJETO') || '').toLowerCase();
    return prio.startsWith('ANF') || proj.includes('lideran');
  }, []);

  const isFinanceiroSite = useCallback((s: TelecomSite) => {
    const fin = (getCellValueForColumn(s, 'Status Financeiro') || '').trim();
    const nf = (getCellValueForColumn(s, 'N° da NF') || '').trim();
    const spo = (getCellValueForColumn(s, 'SPO') || '').trim();
    return fin !== '' || nf !== '' || spo !== '';
  }, []);

  const isNovoSite = useCallback((s: TelecomSite) => {
    return Boolean(s.isNew);
  }, []);

  // Determine the active base pool inside "Pasta Controle Geral" depending on the selected filter button
  const basePoolForFunction = useMemo(() => {
    if (activeVendor === 'ERICSSON') {
      return functionFilter === 'NOVOS' ? vendorSites.filter(isNovoSite) : vendorSites;
    }

    switch (functionFilter) {
      case 'NOVOS':
        return rawControleGeralPool.filter(isNovoSite);
      case 'CANCELADOS':
        return rawCanceladosPool;
      case 'EQUIPES':
        return rawEquipesPool;
      case 'ENGENHARIA':
        return rawControleGeralPool.filter(isEngenhariaSite);
      case 'FINALIZADAS':
        return rawControleGeralPool.filter(isFinalizadaSite);
      case 'ABONO':
        return rawControleGeralPool.filter(isAbonoSite);
      case 'SEM_CHAVES_ACESSO':
        return rawControleGeralPool.filter(isSemChavesOuAcessoSite);
      case 'LIDERANCA_5G_ANF':
        return rawControleGeralPool.filter(isLideranca5GSite);
      case 'FINANCEIRO':
        return rawControleGeralPool.filter(isFinanceiroSite);
      case 'TODOS_GERAL':
      default:
        return rawControleGeralPool;
    }
  }, [
    activeVendor,
    vendorSites,
    functionFilter,
    rawControleGeralPool,
    rawCanceladosPool,
    rawEquipesPool,
    isNovoSite,
    isEngenhariaSite,
    isFinalizadaSite,
    isAbonoSite,
    isSemChavesOuAcessoSite,
    isLideranca5GSite,
    isFinanceiroSite,
  ]);

  // Dynamic options for the dropdown filters inside Pasta Controle Geral
  const filterOptions = useMemo(() => {
    const source =
      functionFilter === 'CANCELADOS'
        ? rawCanceladosPool
        : functionFilter === 'EQUIPES'
        ? rawEquipesPool
        : rawControleGeralPool;

    const prioridades = new Set<string>();
    const projetos = new Set<string>();
    const regionais = new Set<string>();
    const ufs = new Set<string>();
    const statuses = new Set<string>();
    const acessos = new Set<string>();
    const financeiros = new Set<string>();
    const equipes = new Set<string>();

    source.forEach((s) => {
      const prio = (getCellValueForColumn(s, 'Prioridade') || '').trim();
      if (prio) prioridades.add(prio);

      const proj = (
        getCellValueForColumn(s, 'PROJETO') ||
        getCellValueForColumn(s, 'ATIVIDADE') ||
        s.tecnologias ||
        ''
      ).trim();
      if (proj) projetos.add(proj);

      const reg = (getCellValueForColumn(s, 'REG.') || s.regional || '').trim();
      if (reg) regionais.add(reg);

      const uf = (getCellValueForColumn(s, 'UF') || s.uf || '').trim().toUpperCase();
      if (uf && uf.length <= 3) ufs.add(uf);

      const st = (getCellValueForColumn(s, 'STATUS') || s.status || '').trim();
      if (st) statuses.add(st);

      const ac = (getCellValueForColumn(s, 'Acesso') || '').trim();
      if (ac) acessos.add(ac);

      const fin = (getCellValueForColumn(s, 'Status Financeiro') || '').trim();
      if (fin) financeiros.add(fin);

      const eq = (
        getCellValueForColumn(s, 'EQUIPE EXECUTANTE') ||
        getCellValueForColumn(s, 'EQUIPE') ||
        s.equipeParceira ||
        ''
      ).trim();
      const canonEq = getCanonicalDuplaName(eq);
      if (canonEq) equipes.add(canonEq);
    });

    return {
      prioridades: Array.from(prioridades).sort(),
      projetos: Array.from(projetos).sort(),
      regionais: Array.from(regionais).sort(),
      ufs: Array.from(ufs).sort(),
      statuses: Array.from(statuses).sort(),
      acessos: Array.from(acessos).sort(),
      financeiros: Array.from(financeiros).sort(),
      equipes: Array.from(equipes).sort(),
    };
  }, [functionFilter, rawControleGeralPool, rawCanceladosPool, rawEquipesPool]);

  // Parse space/comma/newline separated site queries (e.g. "SN-OI65J2 SN-OI65J4")
  const searchTokens = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return searchTerm
      .trim()
      .split(/[\s,;|\n\r\t]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }, [searchTerm]);

  const matchesSiteSingleTerm = useCallback((site: TelecomSite, qLower: string): boolean => {
    const matchStandard =
      site.siteId.toLowerCase().includes(qLower) ||
      site.siteName.toLowerCase().includes(qLower) ||
      site.municipio.toLowerCase().includes(qLower) ||
      site.uf.toLowerCase().includes(qLower) ||
      site.gabineteBbu.toLowerCase().includes(qLower) ||
      site.tecnologias.toLowerCase().includes(qLower) ||
      site.responsavelCampo.toLowerCase().includes(qLower) ||
      site.equipeParceira.toLowerCase().includes(qLower) ||
      site.ordemServico.toLowerCase().includes(qLower) ||
      site.observacoes.toLowerCase().includes(qLower);

    if (matchStandard) return true;

    return site.customFields
      ? Object.values(site.customFields).some((v) => String(v).toLowerCase().includes(qLower))
      : false;
  }, []);

  // Extract cell display value for any column (both Fluid View columns and Grid View columns)
  const getSiteDisplayValueForColKey = useCallback((site: TelecomSite, colKey: string): string => {
    switch (colKey) {
      case 'FLUID_SITE_ID':
        return (site.siteId || '—').trim();
      case 'FLUID_END_ID':
        return (getCellValueForColumn(site, 'END ID') || site.siteName || '—').trim();
      case 'FLUID_PRIORIDADE':
        return (
          getCellValueForColumn(site, 'Prioridade') ||
          (site.sheetName === 'Equipes' ? 'Equipes' : 'Engenharia')
        ).trim();
      case 'FLUID_OC_SITE_PRE':
        return (getCellValueForColumn(site, 'Oc Site Pre') || site.ordemServico || '—').trim();
      case 'FLUID_SMP':
        return (getCellValueForColumn(site, 'SMP') || site.gabineteBbu || '—').trim();
      case 'FLUID_UF_MUNICIPIO': {
        const uf = (getCellValueForColumn(site, 'UF') || site.uf || '').trim();
        const mun = (
          getCellValueForColumn(site, 'MUNICÍPIO') ||
          getCellValueForColumn(site, 'CIDADE') ||
          site.municipio ||
          ''
        ).trim();
        if (uf && mun) return `${uf} · ${mun}`;
        return uf || mun || '—';
      }
      case 'FLUID_PROJETO_ESCOPO': {
        const proj = (getCellValueForColumn(site, 'PROJETO') || site.tecnologias || '').trim();
        const esc = (getCellValueForColumn(site, 'Escopo') || site.setores || '').trim();
        if (proj && esc) return `${proj} · ${esc}`;
        return proj || esc || '—';
      }
      case 'FLUID_EQUIPE': {
        const rawEq = (
          getCellValueForColumn(site, 'EQUIPE EXECUTANTE') ||
          site.equipeParceira ||
          ''
        ).trim();
        return getCanonicalDuplaName(rawEq) || rawEq || '—';
      }
      case 'FLUID_RESPONSAVEL': {
        const rawEx = (
          getCellValueForColumn(site, 'Executor') ||
          site.responsavelCampo ||
          ''
        ).trim();
        return getCanonicalExecutorName(rawEx);
      }
      case 'FLUID_STATUS_FINANCEIRO':
        return (
          getCellValueForColumn(site, 'Status Financeiro') ||
          site.alarmesAtivos ||
          '—'
        ).trim();
      case 'FLUID_SI_EXECUTED':
        return (getCellValueForColumn(site, 'SI Executed') || site.dataAtivacao || '—').trim();
      case 'FLUID_STATUS':
        return (getCellValueForColumn(site, 'STATUS') || site.status || '—').trim();
      case 'FLUID_ACESSO':
        return (
          getCellValueForColumn(site, 'Comentários do Acesso') ||
          getCellValueForColumn(site, 'Acesso') ||
          '—'
        ).trim();
      case 'FLUID_OBS':
        return (
          getCellValueForColumn(site, 'Observações/Motivo') ||
          getCellValueForColumn(site, 'Comentários') ||
          site.observacoes ||
          '—'
        ).trim();
      default: {
        const raw = (getCellValueForColumn(site, colKey) || '').trim();
        return raw || '—';
      }
    }
  }, []);

  // Apply all granular filters + per-column header filters + Multi-Site space-separated search inside Pasta Controle Geral
  const filteredControleGeralSites = useMemo(() => {
    const activeColFilterEntries = Object.entries(columnValueFilters).filter(
      ([, selectedVals]) => Array.isArray(selectedVals) && selectedVals.length > 0
    );

    const matched = basePoolForFunction.filter((site) => {
      if (chartQuickFilter === 'PARA_FAZER' && !isSiteParaFazer(site)) return false;
      if (chartQuickFilter === 'FEITOS' && !isSiteFeito(site)) return false;
      if (chartQuickFilter === 'NOTAS_PENDENTES' && !isSiteNotaPendente(site)) return false;

      if (prioridadeFilter !== 'ALL') {
        const val = (getCellValueForColumn(site, 'Prioridade') || '').trim();
        if (val !== prioridadeFilter) return false;
      }
      if (projetoFilter !== 'ALL') {
        const val = (
          getCellValueForColumn(site, 'PROJETO') ||
          getCellValueForColumn(site, 'ATIVIDADE') ||
          site.tecnologias ||
          ''
        ).trim();
        if (val !== projetoFilter) return false;
      }
      if (regionalFilter !== 'ALL') {
        const val = (getCellValueForColumn(site, 'REG.') || site.regional || '').trim();
        if (val !== regionalFilter) return false;
      }
      if (ufFilter !== 'ALL') {
        const val = (getCellValueForColumn(site, 'UF') || site.uf || '').trim().toUpperCase();
        if (val !== ufFilter) return false;
      }
      if (statusFilter !== 'ALL') {
        const val = (getCellValueForColumn(site, 'STATUS') || site.status || '').trim();
        if (val !== statusFilter) return false;
      }
      if (acessoFilter !== 'ALL') {
        const val = (getCellValueForColumn(site, 'Acesso') || '').trim();
        if (val !== acessoFilter) return false;
      }
      if (financeiroFilter !== 'ALL') {
        const val = (getCellValueForColumn(site, 'Status Financeiro') || '').trim();
        if (val !== financeiroFilter) return false;
      }
      if (equipeFilter !== 'ALL') {
        if (!doesSiteMatchEquipe(site, equipeFilter)) return false;
      }
      if (executorFilter !== 'ALL') {
        if (!doesSiteMatchExecutor(site, executorFilter)) return false;
      }

      // Per-column header dropdown filters (ChevronDown on each column)
      for (const [colKey, allowedValues] of activeColFilterEntries) {
        const siteVal = getSiteDisplayValueForColKey(site, colKey);
        const siteUf = (getCellValueForColumn(site, 'UF') || site.uf || '').trim().toUpperCase();
        const matchesExactOrUf =
          allowedValues.includes(siteVal) ||
          (colKey === 'FLUID_UF_MUNICIPIO' && allowedValues.includes(`UF:${siteUf}`));
        if (!matchesExactOrUf) return false;
      }

      if (searchTerm.trim()) {
        const fullQueryLower = searchTerm.trim().toLowerCase();
        // 1. Check if full phrase matches (e.g. "Mato Grosso" or "Sem Chave")
        if (matchesSiteSingleTerm(site, fullQueryLower)) {
          return true;
        }
        // 2. Multi-site space-separated search (e.g. "SN-OI65J2 SN-OI65J4"): match ANY of the space-separated tokens
        if (searchTokens.length > 1) {
          return searchTokens.some((tok) => matchesSiteSingleTerm(site, tok.toLowerCase()));
        }
        return false;
      }
      return true;
    });

    // Always place "Sites a Fazer" FIRST and "Sites Feitos" SECOND
    return sortSitesParaFazerFirst(matched);
  }, [
    basePoolForFunction,
    chartQuickFilter,
    prioridadeFilter,
    projetoFilter,
    regionalFilter,
    ufFilter,
    statusFilter,
    acessoFilter,
    financeiroFilter,
    equipeFilter,
    executorFilter,
    columnValueFilters,
    getSiteDisplayValueForColKey,
    searchTerm,
    searchTokens,
    matchesSiteSingleTerm,
  ]);

  const activeColumnFilterCount = useMemo(
    () =>
      Object.values(columnValueFilters).filter((arr) => Array.isArray(arr) && arr.length > 0)
        .length,
    [columnValueFilters]
  );

  const hasActiveFilter =
    functionFilter !== 'TODOS_GERAL' ||
    chartQuickFilter !== 'ALL' ||
    prioridadeFilter !== 'ALL' ||
    projetoFilter !== 'ALL' ||
    regionalFilter !== 'ALL' ||
    ufFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    acessoFilter !== 'ALL' ||
    financeiroFilter !== 'ALL' ||
    equipeFilter !== 'ALL' ||
    executorFilter !== 'ALL' ||
    responsavelDemandFilter !== 'ALL' ||
    activeColumnFilterCount > 0 ||
    searchTerm.trim() !== '';

  // Determine exact ordered columns from Column A to Observação
  const activeSheetMeta = useMemo(
    () => vendorSheets.find((s) => s.name === activeSheetName) || null,
    [vendorSheets, activeSheetName]
  );

  const orderedSheetColumns = useMemo(() => {
    if (effectiveRole === 'Vistoriador') {
      return [
        'SITE ID',
        'END ID',
        'Oc Site Pre',
        'UF',
        'PROJETO',
        'EQUIPE EXECUTANTE',
        'SI Executed',
        'STATUS',
      ];
    }
    if (functionFilter === 'CANCELADOS') {
      return CONTROLE_CANCELADOS_COLUMNS;
    }
    if (functionFilter === 'EQUIPES') {
      return EQUIPES_COLUMNS;
    }
    if (activeSheetMeta?.columns && activeSheetMeta.columns.length > 0) {
      return activeSheetMeta.columns;
    }
    return CONTROLE_GERAL_COLUMNS;
  }, [effectiveRole, functionFilter, activeSheetMeta]);

  const displayedColumnsWithIndex = useMemo(() => {
    const all = orderedSheetColumns.map((colHeader, colIdx) => ({
      colHeader,
      colIdx,
      colLetter: getExcelColumnLetter(colIdx),
    }));
    if (!columnSearchTerm.trim()) return all;
    const q = columnSearchTerm.trim().toLowerCase();
    return all.filter(
      (c) =>
        c.colHeader.toLowerCase().includes(q) ||
        c.colLetter.toLowerCase() === q ||
        c.colIdx === 0 ||
        c.colIdx === 1
    );
  }, [orderedSheetColumns, columnSearchTerm]);

  // Top bar quick search matches (also supports multiple space-separated sites like "SN-OI65J2 SN-OI65J4")
  const quickSiteMatches = useMemo(() => {
    const raw = quickSiteQuery.trim();
    if (!raw) return vendorSites.slice(0, 8);
    const tokens = raw
      .split(/[\s,;|\n\r\t]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const fullLower = raw.toLowerCase();

    return sites
      .filter((s) => {
        if (matchesSiteSingleTerm(s, fullLower)) return true;
        if (tokens.length > 1) {
          return tokens.some((tk) => matchesSiteSingleTerm(s, tk));
        }
        return false;
      })
      .slice(0, 20);
  }, [sites, vendorSites, quickSiteQuery, matchesSiteSingleTerm]);

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId) || null,
    [sites, selectedSiteId]
  );

  const toIsoDateInput = (raw: string | undefined): string => {
    const v = String(raw || '').trim();
    if (!v || v === '—' || v === '-') return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const brMatch = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (brMatch) {
      const day = brMatch[1].padStart(2, '0');
      const month = brMatch[2].padStart(2, '0');
      const year = brMatch[3].length === 2 ? `20${brMatch[3]}` : brMatch[3];
      return `${year}-${month}-${day}`;
    }
    return '';
  };

  const toBrDateDisplay = (isoOrRaw: string): string => {
    const v = String(isoOrRaw || '').trim();
    if (!v) return '';
    const isoMatch = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    }
    return v;
  };

  // API Handlers
  const handleSaveSite = async (id: string, updates: Partial<TelecomSite>) => {
    const targetSite = sites.find((s) => s.id === id);
    const safeUpdates: Partial<TelecomSite> =
      effectiveRole === 'ADM'
        ? updates
        : targetSite
        ? (() => {
            const nextStatus = String(
              updates.status ||
                (updates.customFields && updates.customFields['STATUS']) ||
                targetSite.status
            );
            const hasSiExecuted =
              typeof updates.dataAtivacao === 'string' ||
              Boolean(updates.customFields && typeof updates.customFields['SI Executed'] === 'string');
            const nextSiExec = hasSiExecuted
              ? String(updates.customFields?.['SI Executed'] ?? updates.dataAtivacao ?? '')
              : String(
                  targetSite.customFields?.['SI Executed'] ?? targetSite.dataAtivacao ?? ''
                );
            return {
              status: nextStatus as SiteStatus,
              dataAtivacao: nextSiExec,
              customFields: {
                ...(targetSite.customFields || {}),
                STATUS: nextStatus,
                'SI Executed': nextSiExec,
              },
            };
          })()
        : updates;

    setSites((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, ...safeUpdates, updatedAt: new Date().toISOString() } : s
      )
    );

    const res = await fetch(`/api/sites/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: safeUpdates,
        actorEmail: activeTargetUser?.email || user?.email,
        actorRole: effectiveRole,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.sites)) setSites(data.sites);
      if (Array.isArray(data.sheets)) setSheets(data.sheets);
    }
  };

  const handleDeleteSite = async (id: string) => {
    setSites((prev) => prev.filter((s) => s.id !== id));
    setSelectedSiteId(null);

    const res = await fetch(
      `/api/sites/${encodeURIComponent(id)}?actorEmail=${encodeURIComponent(user?.email || '')}`,
      { method: 'DELETE' }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.sites)) setSites(data.sites);
    }
  };

  const handleCreateSite = async (siteData: Omit<TelecomSite, 'id' | 'updatedAt'>) => {
    const res = await fetch('/api/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site: siteData,
        actorEmail: user?.email,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.sites)) setSites(data.sites);
      if (Array.isArray(data.sheets)) setSheets(data.sheets);
      setActiveVendor(siteData.vendor);
      showToast(`Site ${siteData.siteId} adicionado com sucesso`);
    }
  };

  const handleBulkAssignSitesResponsible = async (
    rawInput: string,
    targetResponsible: string,
    clearAllForResponsible?: string,
    unassignSiteTokens?: string[]
  ) => {
    const tokens = rawInput
      .split(/[\s,;|\n\r\t]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    if (!clearAllForResponsible && tokens.length === 0) {
      showToast('Digite pelo menos um SITE ID (ex: SN-OI65J2) para atribuir ao responsável.');
      return;
    }

    // Immediate optimistic state update when clearing all sites for a Dupla / Responsible
    if (clearAllForResponsible) {
      const unassignSet = new Set(
        (unassignSiteTokens || [])
          .map((t) => String(t || '').trim().toUpperCase())
          .filter(Boolean)
      );
      setSites((prev) =>
        prev.map((s) => {
          if (s.vendor !== activeVendor) return s;
          if (s.sheetName === 'Equipes' || s.sheetName === 'Controle Cancelados') return s;
          const matchesToken =
            unassignSet.size > 0 &&
            (unassignSet.has(s.id.toUpperCase()) ||
              unassignSet.has(s.siteId.trim().toUpperCase()));
          const matchesTarget =
            doesSiteMatchEquipe(s, clearAllForResponsible) ||
            doesSiteMatchResponsible(s, clearAllForResponsible);
          if (!matchesToken && !matchesTarget) return s;
          return {
            ...s,
            equipeParceira: '',
            responsavelCampo: '',
            customFields: {
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
            },
          };
        })
      );
    }

    const res = await fetch('/api/sites/assign-responsible', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteTokens: tokens,
        unassignSiteTokens,
        responsibleName: targetResponsible,
        vendor: activeVendor,
        clearAllForResponsible,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.sites)) {
        setSites(data.sites);
      }
      if (Array.isArray(data.users)) {
        setUsers(data.users);
      }
      setQuickAssignSitesInput('');
      if (clearAllForResponsible) {
        showToast(
          `Demanda de "${clearAllForResponsible}" foi limpa (${data.updatedCount || 0} site(s) removido(s)).`
        );
      } else {
        showToast(
          `${data.updatedCount || tokens.length} site(s) colocado(s) na demanda de "${targetResponsible}"!`
        );
      }
    }
  };

  const handleBulkImport = async (params: {
    sites: Partial<TelecomSite>[];
    vendor: VendorType;
    sheetName: string;
    mode: 'upsert' | 'append' | 'replace_sheet';
    sourceFileName?: string;
    liveSyncUrl?: string;
    columns?: string[];
  }) => {
    const res = await fetch('/api/sites/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...params,
        actorEmail: user?.email,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.sites)) setSites(data.sites);
      if (Array.isArray(data.sheets)) setSheets(data.sheets);
      if (Array.isArray(data.users)) setUsers(data.users);
      setActiveVendor(params.vendor);
      setActiveSheetName(params.sheetName);
      showToast(
        `Planilha "${params.sheetName}" sincronizada (${data.insertedCount} novos, ${data.updatedCount} atualizados)`
      );
    }
  };

  const commitInlineEdit = async () => {
    if (!editingCell) return;
    const { siteId, colHeader, value } = editingCell;
    setEditingCell(null);
    if (effectiveRole !== 'ADM' && colHeader.toUpperCase() !== 'STATUS') {
      return;
    }
    const targetSite = sites.find((s) => s.id === siteId);
    if (!targetSite) return;
    const syncedUpdates = syncSiteColumnUpdate(targetSite, colHeader, value);
    await handleSaveSite(siteId, syncedUpdates);
  };

  const scrollTableHorizontal = (direction: 'start' | 'end') => {
    if (!tableScrollRef.current) return;
    tableScrollRef.current.scrollTo({
      left: direction === 'start' ? 0 : tableScrollRef.current.scrollWidth,
      behavior: 'smooth',
    });
  };

  const handleMarkNewSitesSeen = async () => {
    setSites((prev) =>
      prev.map((s) => (s.vendor === activeVendor && s.isNew ? { ...s, isNew: false } : s))
    );
    if (functionFilter === 'NOVOS') {
      setFunctionFilter('TODOS_GERAL');
    }
    try {
      const res = await fetch('/api/sites/mark-seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor: activeVendor }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.sites)) setSites(data.sites);
        showToast('Sites novos marcados como visualizados');
      }
    } catch {
      // non-blocking
    }
  };

  const renderStatusText = (status: SiteStatus, showHoverChevron = false) => {
    const s = String(status || '').toLowerCase();
    let badgeClass = 'bg-slate-100 text-slate-600 border-slate-200';
    if (s.includes('finalizada') || s === 'ativo') {
      badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    } else if (
      s.includes('executar') ||
      s.includes('andamento') ||
      s.includes('solicitado') ||
      s.includes('aguard') ||
      s.includes('comissionamento')
    ) {
      badgeClass = 'bg-amber-50 text-amber-700 border-amber-200';
    } else if (
      s.includes('cancelad') ||
      s.includes('sem acesso') ||
      s.includes('sem chave') ||
      s.includes('crítico')
    ) {
      badgeClass = 'bg-slate-100 text-slate-600 border-slate-200';
    }

    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${badgeClass}`}
      >
        <span className="truncate max-w-[155px]">{status || '—'}</span>
        {showHoverChevron && (
          <ChevronDown className="w-3 h-3 opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0" />
        )}
      </span>
    );
  };

  const renderStatusFinanceiroBadge = (finValue: string, showHoverChevron = false) => {
    const f = String(finValue || '').trim();
    if (!f || f === '—') {
      return (
        <span className="inline-flex items-center gap-1 text-slate-400 text-[11px]">
          <span>—</span>
          {showHoverChevron && (
            <ChevronDown className="w-3 h-3 opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0" />
          )}
        </span>
      );
    }
    const lower = f.toLowerCase();
    let cls = 'bg-slate-100 border-slate-200 text-slate-700';
    if (lower.includes('emitida') || lower.includes('faturado') || lower.includes('pago')) {
      cls = 'bg-emerald-50 border-emerald-200 text-emerald-700';
    } else if (lower.includes('pronta') || lower.includes('liberado') || lower.includes('emitir')) {
      cls = 'bg-slate-100 border-slate-300 text-slate-800';
    } else if (lower.includes('aguard') || lower.includes('spo') || lower.includes('sgr')) {
      cls = 'bg-amber-50 border-amber-200 text-amber-700';
    }

    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${cls}`}
      >
        <span className="truncate max-w-[165px]">{f}</span>
        {showHoverChevron && (
          <ChevronDown className="w-3 h-3 opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0" />
        )}
      </span>
    );
  };

  // Helper to open/toggle the per-column filter dropdown ("tracinho para baixo")
  const handleToggleColumnFilterMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    colKey: string,
    colLabel: string
  ) => {
    e.stopPropagation();
    if (openColFilterMenu?.colKey === colKey) {
      setOpenColFilterMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 280;
    const maxLeft = Math.max(12, window.innerWidth - menuWidth - 16);
    const left = Math.min(Math.max(12, rect.left), maxLeft);
    const top = Math.min(rect.bottom + 6, window.innerHeight - 360);
    setColMenuSearchText('');
    setOpenColFilterMenu({
      colKey,
      colLabel,
      top,
      left,
    });
  };

  const toggleColumnFilterValue = (colKey: string, val: string) => {
    setColumnValueFilters((prev) => {
      const current = prev[colKey] || [];
      const exists = current.includes(val);
      const next = exists ? current.filter((v) => v !== val) : [...current, val];
      if (next.length === 0) {
        const copy = { ...prev };
        delete copy[colKey];
        return copy;
      }
      return { ...prev, [colKey]: next };
    });
  };

  const clearSingleColumnFilter = (colKey: string) => {
    setColumnValueFilters((prev) => {
      const copy = { ...prev };
      delete copy[colKey];
      return copy;
    });
  };

  const renderColumnHeaderWithFilter = (
    colKey: string,
    label: React.ReactNode,
    plainLabel: string
  ) => {
    const selectedForCol = columnValueFilters[colKey] || [];
    const isFiltered = selectedForCol.length > 0;
    const isOpen = openColFilterMenu?.colKey === colKey;

    return (
      <div className="flex items-center justify-between gap-1.5 w-full">
        <div className="truncate">{label}</div>
        <button
          type="button"
          onClick={(e) => handleToggleColumnFilterMenu(e, colKey, plainLabel)}
          title={`Filtrar coluna ${plainLabel}`}
          className={`px-1 py-0.5 rounded flex items-center gap-0.5 transition-colors shrink-0 cursor-pointer ${
            isFiltered
              ? 'bg-slate-900 text-white font-mono text-[10px] font-bold'
              : isOpen
              ? 'bg-slate-200 text-slate-900'
              : 'hover:bg-slate-200/80 text-slate-400 hover:text-slate-700'
          }`}
        >
          {isFiltered && <span>{selectedForCol.length}</span>}
          <ChevronDown className="w-3 h-3 stroke-[2.5]" />
        </button>
      </div>
    );
  };

  // Renders the table inside Pasta Controle Geral (Fluid View OR Full 46-Column Grid with Sticky # & SITE ID)
  const renderFluidSitesTable = (folderSites: TelecomSite[]) => {
    const densityPad =
      tableDensity === 'comfortable'
        ? 'py-2.5 px-3 text-xs'
        : tableDensity === 'ultra'
        ? 'py-1 px-2 text-[11px] leading-tight'
        : 'py-1.5 px-2.5 text-xs';

    const densityHeaderPad =
      tableDensity === 'comfortable'
        ? 'py-2.5 px-3'
        : tableDensity === 'ultra'
        ? 'py-1.5 px-2'
        : 'py-2 px-2.5';

    if (folderSites.length === 0) {
      return (
        <div className="p-10 text-center space-y-2">
          <div className="text-sm font-semibold text-slate-700">
            Nenhum registro encontrado para o filtro selecionado
          </div>
          <p className="text-xs text-slate-500">
            Experimente limpar ou ajustar os filtros acima.
          </p>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={resetAllInternalFilters}
              className="mt-2 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpar Todos os Filtros</span>
            </button>
          )}
        </div>
      );
    }

    // FULL SPREADSHEET MODE (Coluna A -> Observação) WITH OPAQUE STICKY COLUMNS (#, Col A, Col B)
    if (folderViewMode === 'grid') {
      const hasColA = displayedColumnsWithIndex.some((c) => c.colIdx === 0);

      return (
        <div className={isSpreadsheetFullscreen ? 'flex-1 flex flex-col min-h-0' : ''}>
          {/* Toolbar for Column Jump & Column Search in Grid Mode */}
          <div className="px-4 py-2 bg-slate-100/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">
                Planilha Completa ({displayedColumnsWithIndex.length} colunas)
              </span>
              <span className="text-slate-400">·</span>
              <span>
                {effectiveRole === 'ADM'
                  ? 'Duplo-clique para editar ou clique em Equipe / SI Executed / Status'
                  : 'Edição habilitada nas colunas SI Executed (Data) e STATUS'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-52">
                <Columns3 className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1.5" />
                <input
                  type="text"
                  value={columnSearchTerm}
                  onChange={(e) => setColumnSearchTerm(e.target.value)}
                  placeholder={`Filtrar ${orderedSheetColumns.length} colunas...`}
                  className="w-full pl-8 pr-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>
              <button
                type="button"
                onClick={() => scrollTableHorizontal('start')}
                className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-mono rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeftToLine className="w-3.5 h-3.5 text-slate-500" />
                <span>Col A</span>
              </button>
              <button
                type="button"
                onClick={() => scrollTableHorizontal('end')}
                className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-mono rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <span>
                  Col {getExcelColumnLetter(Math.max(0, orderedSheetColumns.length - 1))}
                </span>
                <ArrowRightToLine className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <button
                type="button"
                onClick={() => setIsSpreadsheetFullscreen((prev) => !prev)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                  isSpreadsheetFullscreen
                    ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600'
                    : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200'
                }`}
              >
                {isSpreadsheetFullscreen ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>Sair da Tela Inteira</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Tela Inteira</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div
            ref={tableScrollRef}
            className={`overflow-x-auto overflow-y-auto ${
              isSpreadsheetFullscreen
                ? 'flex-1 h-full max-h-none'
                : isSitesListExpanded
                ? 'max-h-none'
                : 'max-h-[72vh]'
            }`}
          >
            <table className="w-full text-left border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-30 bg-slate-100 text-slate-600 font-semibold">
                <tr>
                  <th className={`sticky left-0 z-40 w-[44px] min-w-[44px] max-w-[44px] bg-slate-100 ${densityHeaderPad} border-b border-r border-slate-200 font-mono text-center text-slate-500`}>
                    #
                  </th>

                  {displayedColumnsWithIndex.map(({ colHeader, colIdx, colLetter }) => {
                    const isColA = colIdx === 0;
                    const isColB = colIdx === 1 || colHeader.toUpperCase() === 'SITE ID';

                    let stickyHeaderClass = `${densityHeaderPad} border-b border-r border-slate-200 whitespace-nowrap bg-slate-100 min-w-[135px]`;

                    if (isColA) {
                      stickyHeaderClass = `sticky left-[44px] z-40 w-[120px] min-w-[120px] max-w-[120px] ${densityHeaderPad} border-b border-r border-slate-200 whitespace-nowrap bg-slate-100 overflow-hidden text-ellipsis`;
                    } else if (isColB) {
                      stickyHeaderClass = `${
                        hasColA ? 'sticky left-[164px]' : 'sticky left-[44px]'
                      } z-40 w-[150px] min-w-[150px] max-w-[150px] ${densityHeaderPad} border-b border-r border-slate-300 whitespace-nowrap bg-slate-100 font-bold text-slate-900 overflow-hidden text-ellipsis shadow-[4px_0_6px_-2px_rgba(15,23,42,0.10)]`;
                    }

                    return (
                      <th key={`${colLetter}-${colHeader}`} className={stickyHeaderClass}>
                        {renderColumnHeaderWithFilter(
                          colHeader,
                          <>
                            <span className="px-1 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] font-mono font-bold mr-1">
                              {colLetter}
                            </span>
                            <span>{colHeader}</span>
                          </>,
                          colHeader
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="bg-white">
                {folderSites.map((site, idx) => (
                  <tr
                    key={site.id}
                    onClick={() => setSelectedSiteId(site.id)}
                    className="group cursor-pointer"
                  >
                    <td className={`sticky left-0 z-20 w-[44px] min-w-[44px] max-w-[44px] bg-white group-hover:bg-slate-50 ${densityPad} border-b border-r border-slate-100 text-center font-mono text-slate-400 tabular-nums`}>
                      {idx + 1}
                    </td>

                    {displayedColumnsWithIndex.map(({ colHeader, colIdx, colLetter }) => {
                      const cellValue = getCellValueForColumn(site, colHeader);
                      const isColA = colIdx === 0;
                      const isColB = colIdx === 1 || colHeader.toUpperCase() === 'SITE ID';
                      const isStatusCol = colHeader.toUpperCase() === 'STATUS';
                      const isSiExecCol = colHeader.toUpperCase() === 'SI EXECUTED';
                      const isEquipeCol = colHeader.toUpperCase() === 'EQUIPE EXECUTANTE';
                      const isEditing =
                        editingCell?.siteId === site.id &&
                        editingCell.colHeader === colHeader;

                      let cellClass = `group/cell relative ${densityPad} border-b border-r border-slate-100 whitespace-nowrap max-w-[240px] truncate bg-white group-hover:bg-slate-50 text-slate-700`;

                      if (isColA) {
                        cellClass = `sticky left-[44px] z-20 w-[120px] min-w-[120px] max-w-[120px] ${densityPad} border-b border-r border-slate-100 whitespace-nowrap overflow-hidden text-ellipsis bg-white group-hover:bg-slate-50 font-mono text-slate-700 tabular-nums`;
                      } else if (isColB) {
                        cellClass = `${
                          hasColA ? 'sticky left-[164px]' : 'sticky left-[44px]'
                        } z-20 w-[150px] min-w-[150px] max-w-[150px] ${densityPad} border-b border-r border-slate-300 whitespace-nowrap overflow-hidden text-ellipsis bg-white group-hover:bg-slate-50 font-mono font-semibold text-blue-600 tabular-nums shadow-[4px_0_6px_-2px_rgba(15,23,42,0.08)]`;
                      }

                      return (
                        <td
                          key={`${colLetter}-${colHeader}`}
                          onClick={(e) => {
                            if (
                              isStatusCol ||
                              isSiExecCol ||
                              (effectiveRole === 'ADM' && isEquipeCol)
                            ) {
                              e.stopPropagation();
                            }
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (effectiveRole !== 'ADM' && !isStatusCol && !isSiExecCol) {
                              showToast(
                                'Você tem permissão para editar as colunas SI Executed (Data) e STATUS.'
                              );
                              return;
                            }
                            setEditingCell({
                              siteId: site.id,
                              colHeader,
                              value: cellValue,
                            });
                          }}
                          className={cellClass}
                        >
                          {isEditing && effectiveRole === 'ADM' ? (
                            <input
                              type="text"
                              autoFocus
                              value={editingCell.value}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setEditingCell({ ...editingCell, value: e.target.value })
                              }
                              onBlur={commitInlineEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitInlineEdit();
                                if (e.key === 'Escape') setEditingCell(null);
                              }}
                              className="w-full px-2 py-0.5 bg-white border border-blue-600 rounded text-xs text-slate-900 focus:outline-none"
                            />
                          ) : isColB ? (
                            <div className="flex items-center gap-1.5">
                              <span>{cellValue || site.siteId}</span>
                              {site.isNew && (
                                <span className="px-1.5 py-0.5 bg-emerald-600 text-white text-[9px] font-sans font-bold rounded uppercase tracking-wide shrink-0">
                                  NOVO
                                </span>
                              )}
                            </div>
                          ) : isSiExecCol ? (
                            <input
                              type="date"
                              value={toIsoDateInput(cellValue || site.dataAtivacao)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const iso = e.target.value;
                                const formatted = iso ? toBrDateDisplay(iso) : '';
                                const updates = syncSiteColumnUpdate(
                                  site,
                                  'SI Executed',
                                  formatted
                                );
                                handleSaveSite(site.id, updates);
                                showToast(
                                  `SI Executed de ${site.siteId} atualizado para "${formatted || '—'}"`
                                );
                              }}
                              title="Clique para selecionar a data de execução (SI Executed)"
                              className="px-1.5 py-0.5 bg-slate-50 hover:bg-blue-50/70 border border-slate-200 hover:border-blue-400 rounded text-[11px] font-mono font-semibold text-slate-800 focus:outline-none focus:border-blue-600 cursor-pointer"
                            />
                          ) : isEquipeCol && effectiveRole === 'ADM' ? (
                            <div className="relative flex items-center justify-between gap-1">
                              <span className="truncate font-medium text-slate-800">
                                {cellValue || site.equipeParceira || site.responsavelCampo || '—'}
                              </span>
                              <ChevronDown className="w-3 h-3 text-slate-400 opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0" />
                              <select
                                value={cellValue || site.equipeParceira || site.responsavelCampo || ''}
                                onChange={(e) => {
                                  if (e.target.value === '__MANAGE_DUPLAS__') {
                                    setIsEditDuplasModalOpen(true);
                                    return;
                                  }
                                  const nextDupla = e.target.value;
                                  const updates = syncSiteColumnUpdate(
                                    site,
                                    'EQUIPE EXECUTANTE',
                                    nextDupla
                                  );
                                  handleSaveSite(site.id, updates);
                                  showToast(
                                    `Dupla / Equipe do site ${site.siteId} definida para "${nextDupla || '—'}"`
                                  );
                                }}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              >
                                <option value="">— Sem Dupla / Equipe —</option>
                                {equipesDuplas.map((dp) => (
                                  <option key={dp} value={dp}>
                                    {dp}
                                  </option>
                                ))}
                                <option value="__MANAGE_DUPLAS__">
                                  ⚙️ Editar / Gerenciar Duplas...
                                </option>
                              </select>
                            </div>
                          ) : isStatusCol ? (
                            <div className="relative inline-flex items-center">
                              {renderStatusText((cellValue || site.status) as SiteStatus, true)}
                              <select
                                value={
                                  effectiveRole !== 'ADM'
                                    ? String(cellValue || site.status || '')
                                        .toLowerCase()
                                        .includes('finalizada')
                                      ? 'Vistoria - Finalizada'
                                      : 'Vistoria - A Executar'
                                    : cellValue || site.status || 'Vistoria - A Executar'
                                }
                                onChange={(e) => {
                                  const nextSt = e.target.value as SiteStatus;
                                  const updates = syncSiteColumnUpdate(site, 'STATUS', nextSt);
                                  handleSaveSite(site.id, updates);
                                  showToast(
                                    `Status da vistoria de ${site.siteId} atualizado para "${nextSt}"`
                                  );
                                }}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              >
                                <option value="Vistoria - Finalizada">
                                  ✅ Vistoria - Finalizada
                                </option>
                                <option value="Vistoria - A Executar">
                                  ⏳ Não Finalizada (A Executar)
                                </option>
                                {effectiveRole === 'ADM' && (
                                  <>
                                    <option value="Vistoria - Em Andamento">
                                      Vistoria - Em Andamento
                                    </option>
                                    <option value="Acesso - Solicitado p/ Nokia">
                                      Acesso - Solicitado p/ Nokia
                                    </option>
                                    <option value="Vistoria - Sem Acesso">Vistoria - Sem Acesso</option>
                                    <option value="Vistoria - Sem Chave">Vistoria - Sem Chave</option>
                                    <option value="Site Cancelado">Site Cancelado</option>
                                  </>
                                )}
                              </select>
                            </div>
                          ) : colHeader === 'Status Financeiro' ? (
                            renderStatusFinanceiroBadge(cellValue || site.alarmesAtivos)
                          ) : (
                            cellValue || '—'
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    const isVistoriadorView = effectiveRole === 'Vistoriador';

    // Fluid Clean Compact Data Grid (Sticky # & SITE ID, Hover-to-Edit Cells, Subtle Status Badges, Unified Equipe Executante Duplas)
    return (
      <div
        className={`overflow-x-auto overflow-y-auto ${
          isSpreadsheetFullscreen
            ? 'flex-1 h-full max-h-none'
            : isSitesListExpanded
            ? 'max-h-none'
            : 'max-h-[72vh]'
        }`}
      >
        <table className="w-full text-left border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20 bg-slate-100/90 text-slate-600 font-semibold">
            <tr className="whitespace-nowrap">
              <th className={`sticky left-0 z-30 w-[44px] min-w-[44px] max-w-[44px] bg-slate-100 ${densityHeaderPad} border-b border-r border-slate-200 font-mono text-center`}>
                #
              </th>
              <th className={`sticky left-[44px] z-30 w-[150px] min-w-[150px] max-w-[150px] bg-slate-100 ${densityHeaderPad} border-b border-r border-slate-200 shadow-[4px_0_6px_-2px_rgba(15,23,42,0.06)]`}>
                {renderColumnHeaderWithFilter('FLUID_SITE_ID', 'SITE ID', 'SITE ID')}
              </th>
              <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                {renderColumnHeaderWithFilter('FLUID_END_ID', 'END ID', 'END ID')}
              </th>
              {!isVistoriadorView && (
                <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                  {renderColumnHeaderWithFilter(
                    'FLUID_PRIORIDADE',
                    'Função / Prioridade',
                    'Função / Prioridade'
                  )}
                </th>
              )}
              <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                {renderColumnHeaderWithFilter('FLUID_OC_SITE_PRE', 'Oc Site Pre', 'Oc Site Pre')}
              </th>
              {!isVistoriadorView && (
                <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                  {renderColumnHeaderWithFilter('FLUID_SMP', 'SMP', 'SMP')}
                </th>
              )}
              <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                {renderColumnHeaderWithFilter(
                  'FLUID_UF_MUNICIPIO',
                  isVistoriadorView ? 'UF' : 'UF / Município',
                  isVistoriadorView ? 'UF' : 'UF / Município'
                )}
              </th>
              <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                {renderColumnHeaderWithFilter(
                  'FLUID_PROJETO_ESCOPO',
                  isVistoriadorView ? 'PROJETO' : 'Projeto / Escopo',
                  isVistoriadorView ? 'PROJETO' : 'Projeto / Escopo'
                )}
              </th>
              <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                {renderColumnHeaderWithFilter(
                  'FLUID_EQUIPE',
                  isVistoriadorView ? 'EQUIPE' : 'Equipe Executante (Dupla)',
                  isVistoriadorView ? 'EQUIPE' : 'Equipe Executante'
                )}
              </th>
              <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                {renderColumnHeaderWithFilter('FLUID_SI_EXECUTED', 'SI Executed', 'SI Executed')}
              </th>
              <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                {renderColumnHeaderWithFilter('FLUID_STATUS', 'STATUS', 'Status')}
              </th>
              {!isVistoriadorView && (
                <>
                  <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                    {renderColumnHeaderWithFilter(
                      'FLUID_STATUS_FINANCEIRO',
                      'Status Financeiro',
                      'Status Financeiro'
                    )}
                  </th>
                  <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                    {renderColumnHeaderWithFilter(
                      'FLUID_ACESSO',
                      'Acesso / Chaves',
                      'Acesso / Chaves'
                    )}
                  </th>
                  <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100`}>
                    {renderColumnHeaderWithFilter(
                      'FLUID_OBS',
                      'Observações / Comentários',
                      'Observações / Comentários'
                    )}
                  </th>
                </>
              )}
              <th className={`${densityHeaderPad} border-b border-slate-200 bg-slate-100 text-right`}>
                Ficha
              </th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {(() => {
              const totalFazerInFolder = folderSites.filter(
                (s) => getSiteExecutionSortBucket(s) === 0
              ).length;
              const totalFeitosInFolder = folderSites.filter(
                (s) => getSiteExecutionSortBucket(s) === 1
              ).length;

              return folderSites.map((site, idx) => {
                const currentBucket = getSiteExecutionSortBucket(site);
                const prevBucket =
                  idx > 0 ? getSiteExecutionSortBucket(folderSites[idx - 1]) : -1;
                const showGroupBanner = currentBucket !== prevBucket && currentBucket <= 1;

                const endId = getCellValueForColumn(site, 'END ID') || site.siteName;
                const prio =
                  getCellValueForColumn(site, 'Prioridade') ||
                  (site.sheetName === 'Equipes' ? 'Equipes' : 'Engenharia');
                const ocPre = getCellValueForColumn(site, 'Oc Site Pre') || site.ordemServico;
                const smp = getCellValueForColumn(site, 'SMP') || site.gabineteBbu;
                const municipio =
                  getCellValueForColumn(site, 'MUNICÍPIO') ||
                  getCellValueForColumn(site, 'CIDADE') ||
                  site.municipio;
                const projeto = getCellValueForColumn(site, 'PROJETO') || site.tecnologias;
                const escopo = getCellValueForColumn(site, 'Escopo') || site.setores;
                const rawEqCell =
                  getCellValueForColumn(site, 'EQUIPE EXECUTANTE') || site.equipeParceira || '';
                const equipeDupla =
                  getCanonicalDuplaName(rawEqCell) ||
                  rawEqCell ||
                  getCellValueForColumn(site, 'Executor') ||
                  site.responsavelCampo;
                const siExec = getCellValueForColumn(site, 'SI Executed') || site.dataAtivacao;
                const statusFin =
                  getCellValueForColumn(site, 'Status Financeiro') || site.alarmesAtivos || '';
                const acessoInfo =
                  getCellValueForColumn(site, 'Comentários do Acesso') ||
                  getCellValueForColumn(site, 'Acesso') ||
                  '—';
                const obs =
                  getCellValueForColumn(site, 'Observações/Motivo') ||
                  getCellValueForColumn(site, 'Comentários') ||
                  site.observacoes;

                return (
                  <React.Fragment key={site.id}>
                    {showGroupBanner && (
                      <tr
                        className={
                          currentBucket === 0
                            ? 'bg-amber-50/90 border-y border-amber-200'
                            : 'bg-emerald-50/90 border-y border-emerald-200'
                        }
                      >
                        <td
                          colSpan={isVistoriadorView ? 10 : 15}
                          className="px-4 py-1.5 text-[11px] font-bold tracking-wide"
                        >
                          {currentBucket === 0 ? (
                            <span className="inline-flex items-center gap-2 text-amber-900">
                              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                              <span>
                                1º SITES A FAZER (PENDENTES / A EXECUTAR) — {totalFazerInFolder}{' '}
                                site(s)
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2 text-emerald-900">
                              <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
                              <span>
                                2º SITES FEITOS (FINALIZADOS) — {totalFeitosInFolder} site(s)
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                    <tr
                      onClick={() => setSelectedSiteId(site.id)}
                      className="group cursor-pointer whitespace-nowrap"
                    >
                  <td className={`sticky left-0 z-20 w-[44px] min-w-[44px] max-w-[44px] bg-white group-hover:bg-slate-50 ${densityPad} border-b border-r border-slate-100 font-mono text-slate-400 text-center tabular-nums`}>
                    {idx + 1}
                  </td>
                  <td className={`sticky left-[44px] z-20 w-[150px] min-w-[150px] max-w-[150px] bg-white group-hover:bg-slate-50 ${densityPad} border-b border-r border-slate-200 font-mono font-semibold text-blue-600 group-hover:text-blue-700 tabular-nums overflow-hidden text-ellipsis shadow-[4px_0_6px_-2px_rgba(15,23,42,0.06)]`}>
                    <div className="flex items-center gap-1.5">
                      <span>{site.siteId}</span>
                      {site.isNew && (
                        <span className="px-1.5 py-0.5 bg-emerald-600 text-white text-[9px] font-sans font-bold rounded uppercase tracking-wide shrink-0">
                          NOVO
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50 font-mono font-medium text-slate-800 tabular-nums`}>
                    {endId || '—'}
                  </td>
                  {!isVistoriadorView && (
                    <td className={`${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50 text-slate-700`}>
                      {prio}
                    </td>
                  )}
                  <td className={`${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50 font-mono text-slate-600 tabular-nums`}>
                    {ocPre || '—'}
                  </td>
                  {!isVistoriadorView && (
                    <td className={`${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50 font-mono text-slate-600 tabular-nums`}>
                      {smp || '—'}
                    </td>
                  )}
                  <td className={`${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50 text-slate-700`}>
                    <span className="font-semibold text-slate-900">{site.uf || '—'}</span>
                    {!isVistoriadorView && municipio ? ` · ${municipio}` : ''}
                  </td>
                  <td className={`${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50 text-slate-700`}>
                    {projeto || '—'}
                    {!isVistoriadorView && escopo ? (
                      <span className="text-slate-400"> · {escopo}</span>
                    ) : null}
                  </td>

                  {/* Equipe Executante (Dupla) — Hover-to-Edit Dropdown + Duplas Management */}
                  <td
                    onClick={(e) => e.stopPropagation()}
                    className={`group/cell relative z-0 ${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50 text-slate-800`}
                  >
                    {effectiveRole === 'ADM' ? (
                      <div className="relative inline-flex items-center gap-1 max-w-[180px] py-0.5 px-1.5 -mx-1.5 rounded hover:bg-slate-100 transition-colors">
                        <span className="truncate font-medium text-slate-800">
                          {equipeDupla || '— Escolher Dupla —'}
                        </span>
                        <ChevronDown className="w-3 h-3 text-slate-400 opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0" />
                        <select
                          value={equipeDupla || ''}
                          onChange={(e) => {
                            if (e.target.value === '__MANAGE_DUPLAS__') {
                              setIsEditDuplasModalOpen(true);
                              return;
                            }
                            const nextDupla = e.target.value;
                            const updates = syncSiteColumnUpdate(
                              site,
                              'EQUIPE EXECUTANTE',
                              nextDupla
                            );
                            handleSaveSite(site.id, updates);
                            showToast(
                              `Site ${site.siteId} enviado para a dupla/equipe "${nextDupla || '—'}"`
                            );
                          }}
                          title="Escolher para qual Dupla / Equipe Executante enviar a demanda deste site"
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        >
                          <option value="">— Sem Dupla / Equipe —</option>
                          {equipeDupla && !equipesDuplas.includes(equipeDupla) && (
                            <option value={equipeDupla}>{equipeDupla}</option>
                          )}
                          {equipesDuplas.map((dp) => (
                            <option key={dp} value={dp}>
                              {dp}
                            </option>
                          ))}
                          <option value="__MANAGE_DUPLAS__">
                            ⚙️ Editar / Gerenciar Duplas...
                          </option>
                        </select>
                      </div>
                    ) : (
                      <span className="text-slate-700 font-medium">{equipeDupla || '—'}</span>
                    )}
                  </td>

                  {/* SI Executed — Unlocked interactive Date Input for Vistoriador, Executor & ADM */}
                  <td
                    onClick={(e) => e.stopPropagation()}
                    className={`${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50 font-mono text-slate-700 tabular-nums`}
                  >
                    <input
                      type="date"
                      value={toIsoDateInput(siExec)}
                      onChange={(e) => {
                        const iso = e.target.value;
                        const formatted = iso ? toBrDateDisplay(iso) : '';
                        const updates = syncSiteColumnUpdate(site, 'SI Executed', formatted);
                        handleSaveSite(site.id, updates);
                        showToast(
                          `SI Executed de ${site.siteId} atualizado para "${formatted || '—'}"`
                        );
                      }}
                      title="Clique para colocar a data de SI Executed"
                      className="px-2 py-0.5 bg-slate-50 hover:bg-blue-50/70 border border-slate-200 hover:border-blue-400 rounded-md text-[11px] font-mono font-semibold text-slate-800 focus:outline-none focus:border-blue-600 cursor-pointer"
                    />
                  </td>

                  {/* Status — Subtle Status Badge + Hover Chevron + Click Dropdown */}
                  <td
                    onClick={(e) => e.stopPropagation()}
                    className={`group/cell relative z-0 ${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50`}
                  >
                    <div className="relative inline-flex items-center">
                      {renderStatusText(site.status, true)}
                      <select
                        value={
                          effectiveRole !== 'ADM'
                            ? String(site.status || '').toLowerCase().includes('finalizada')
                              ? 'Vistoria - Finalizada'
                              : 'Vistoria - A Executar'
                            : site.status || 'Vistoria - A Executar'
                        }
                        onChange={(e) => {
                          const nextStatus = e.target.value as SiteStatus;
                          const updates = syncSiteColumnUpdate(site, 'STATUS', nextStatus);
                          handleSaveSite(site.id, updates);
                          showToast(
                            `Status da vistoria de ${site.siteId} alterado para "${nextStatus}"`
                          );
                        }}
                        title="Clique para alterar o Status da Vistoria"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      >
                        <option value="Vistoria - Finalizada">✅ Vistoria - Finalizada</option>
                        <option value="Vistoria - A Executar">
                          ⏳ Não Finalizada (Vistoria - A Executar)
                        </option>
                        {effectiveRole === 'ADM' && (
                          <>
                            {site.status &&
                              site.status !== 'Vistoria - Finalizada' &&
                              site.status !== 'Vistoria - A Executar' && (
                                <option value={site.status}>{site.status}</option>
                              )}
                            <option value="Vistoria - Em Andamento">Vistoria - Em Andamento</option>
                            <option value="Acesso - Solicitado p/ Nokia">
                              Acesso - Solicitado p/ Nokia
                            </option>
                            <option value="Vistoria - Sem Acesso">Vistoria - Sem Acesso</option>
                            <option value="Vistoria - Sem Chave">Vistoria - Sem Chave</option>
                            <option value="Vistoria - Sem Acesso e Chave">
                              Vistoria - Sem Acesso e Chave
                            </option>
                            <option value="Vistoria - Zeladoria">Vistoria - Zeladoria</option>
                            <option value="Vistoria - Pendênte">Vistoria - Pendênte</option>
                            <option value="Site Cancelado">Site Cancelado</option>
                          </>
                        )}
                      </select>
                    </div>
                  </td>

                  {!isVistoriadorView && (
                    <>
                      {/* Status Financeiro — Compact Hover-to-Edit Cell */}
                      <td
                        onClick={(e) => e.stopPropagation()}
                        className={`group/cell relative z-0 ${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50`}
                      >
                        {effectiveRole === 'ADM' ? (
                          <div className="relative inline-flex items-center">
                            {renderStatusFinanceiroBadge(statusFin, true)}
                            <select
                              value={statusFin}
                              onChange={(e) => {
                                const nextFin = e.target.value;
                                const updates = syncSiteColumnUpdate(
                                  site,
                                  'Status Financeiro',
                                  nextFin
                                );
                                handleSaveSite(site.id, updates);
                                showToast(
                                  `Status Financeiro de ${site.siteId} atualizado para "${nextFin || 'Sem status'}"`
                                );
                              }}
                              title="Clique para alterar Status Financeiro"
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            >
                              <option value="">— Sem Status Financeiro —</option>
                              {statusFin && !STATUS_FINANCEIRO_OPTIONS.includes(statusFin) && (
                                <option value={statusFin}>{statusFin}</option>
                              )}
                              {STATUS_FINANCEIRO_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          renderStatusFinanceiroBadge(statusFin, false)
                        )}
                      </td>

                      <td className={`${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50 text-slate-600 max-w-[180px] truncate`}>
                        {acessoInfo}
                      </td>
                      <td className={`${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50 text-slate-500 max-w-[210px] truncate`}>
                        {obs || '—'}
                      </td>
                    </>
                  )}
                  <td className={`${densityPad} border-b border-slate-100 bg-white group-hover:bg-slate-50 text-right`}>
                    <span className="inline-flex items-center gap-1 text-blue-600 font-medium group-hover:translate-x-0.5 transition-transform">
                      <span>Abrir</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </td>
                    </tr>
                  </React.Fragment>
                );
              });
            })()}
          </tbody>
        </table>
      </div>
    );
  };

  // Counts for each filter button inside Pasta Controle Geral
  const countEngenharia = useMemo(
    () => rawControleGeralPool.filter(isEngenhariaSite).length,
    [rawControleGeralPool, isEngenhariaSite]
  );

  const countFinalizadas = useMemo(
    () => rawControleGeralPool.filter(isFinalizadaSite).length,
    [rawControleGeralPool, isFinalizadaSite]
  );

  const countAbono = useMemo(
    () => rawControleGeralPool.filter(isAbonoSite).length,
    [rawControleGeralPool, isAbonoSite]
  );

  const countSemChaves = useMemo(
    () => rawControleGeralPool.filter(isSemChavesOuAcessoSite).length,
    [rawControleGeralPool, isSemChavesOuAcessoSite]
  );

  const countLideranca5G = useMemo(
    () => rawControleGeralPool.filter(isLideranca5GSite).length,
    [rawControleGeralPool, isLideranca5GSite]
  );

  const countFinanceiro = useMemo(
    () => rawControleGeralPool.filter(isFinanceiroSite).length,
    [rawControleGeralPool, isFinanceiroSite]
  );

  const countNovos = useMemo(
    () => rawControleGeralPool.filter(isNovoSite).length,
    [rawControleGeralPool, isNovoSite]
  );

  const novosSitesList = useMemo(
    () => rawControleGeralPool.filter(isNovoSite),
    [rawControleGeralPool, isNovoSite]
  );

  const vendorEngineeringFilesCount = useMemo(() => {
    if (activeVendor === 'ERICSSON') {
      if (effectiveRole === 'Vistoriador' && activeTargetUser) {
        return ericssonFiles.filter((fl) =>
          doesFileMatchUserResponsibleSites(fl, activeTargetUser, sites, ericssonRows)
        ).length;
      }
      if (
        effectiveRole !== 'ADM' &&
        effectiveRole !== 'Coordenador Geral' &&
        effectiveRole !== 'Coordenador Engenharia' &&
        activeTargetUser
      ) {
        return ericssonFiles.filter(
          (fl) =>
            doesFileMatchUserResponsibleSites(fl, activeTargetUser, sites, ericssonRows) ||
            doesDocumentMatchResponsible(fl, undefined, activeTargetUser)
        ).length;
      }
      return ericssonFiles.length;
    }

    const allFolders = engineeringFolders.filter((fd) => fd.vendor === activeVendor);
    const allVendor = engineeringFiles.filter((f) => f.vendor === activeVendor);

    if (effectiveRole === 'Vistoriador' && activeTargetUser) {
      return allVendor.filter((fl) =>
        doesFileMatchUserResponsibleSites(fl, activeTargetUser, sites, ericssonRows)
      ).length;
    }

    // Exclude TSSR Entrada and TSSR project folders from Vistoria folder count for other roles
    const blockedFolderIds = new Set(
      allFolders
        .filter((fd) => fd.name === 'TSSR Entrada' || fd.name === 'TSSR')
        .map((fd) => fd.id)
    );
    let added = true;
    while (added) {
      added = false;
      for (const fd of allFolders) {
        if (fd.parentId && blockedFolderIds.has(fd.parentId) && !blockedFolderIds.has(fd.id)) {
          blockedFolderIds.add(fd.id);
          added = true;
        }
      }
    }

    const vistoriaScoped = allVendor.filter((f) => !blockedFolderIds.has(f.folderId));
    if (
      effectiveRole !== 'ADM' &&
      effectiveRole !== 'Coordenador Geral' &&
      effectiveRole !== 'Coordenador Engenharia' &&
      activeTargetUser
    ) {
      return vistoriaScoped.filter((fl) => {
        const folder = allFolders.find((fd) => fd.id === fl.folderId);
        return (
          doesFileMatchUserResponsibleSites(fl, activeTargetUser, sites, ericssonRows) ||
          doesDocumentMatchResponsible(fl, folder, activeTargetUser)
        );
      }).length;
    }
    return vistoriaScoped.length;
  }, [
    engineeringFiles,
    engineeringFolders,
    ericssonFiles,
    sites,
    ericssonRows,
    activeVendor,
    effectiveRole,
    activeTargetUser,
  ]);

  // Minimalist AuthGate when not logged in (must be after all React hooks)
  if (!user || !user.emailVerified) {
    return <AuthGate onAuthenticated={handleAuthenticated} />;
  }

  // Tela de bloqueio/espera quando a situação do usuário é "aguardando" ou "bloqueado"
  if (
    !isUserDono(activeTargetUser) &&
    (isUserAguardando(activeTargetUser) || activeTargetUser?.situacao === 'bloqueado')
  ) {
    const isBlocked = activeTargetUser?.situacao === 'bloqueado';
    return (
      <div className="min-h-screen bg-[#0D1538] text-white flex flex-col justify-between p-6">
        <div className="h-1.5 w-full bg-gradient-to-r from-[#223585] via-[#1E8E8D] to-emerald-400 fixed top-0 left-0 right-0" />
        <div className="max-w-lg w-full mx-auto my-auto bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 p-7 space-y-5">
          <div className="flex items-center justify-between">
            <AmetaLogo size="sm" theme="light" />
            <span
              className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider border ${
                isBlocked
                  ? 'bg-red-50 text-red-800 border-red-300'
                  : 'bg-amber-50 text-amber-800 border-amber-300'
              }`}
            >
              {isBlocked ? 'Acesso Bloqueado' : 'Situação: Aguardando Liberação'}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-amber-50/90 border border-amber-200 flex items-start gap-3">
            <Clock className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <h2 className="text-base font-extrabold text-slate-900">
                {isBlocked
                  ? 'Seu acesso a este sistema está bloqueado'
                  : 'Seu acesso precisa ser liberado pelo dono do sistema'}
              </h2>
              <p className="text-xs text-slate-700 leading-relaxed">
                Olá, <strong>{activeTargetUser?.name}</strong> (
                <span className="font-mono">{activeTargetUser?.email}</span>). Sua conta com e-mail
                verificado foi criada com sucesso na situação <strong>&quot;aguardando&quot;</strong>.
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                Por segurança, nenhum dado das plataformas <strong>TIM / Nokia</strong> ou{' '}
                <strong>Ericsson</strong> é exibido até que o <strong>dono</strong> atribua seu{' '}
                <strong>Perfil</strong> (Coordenador Geral, Coordenador Engenharia, Executor ou
                Vistoriador) e sua <strong>Plataforma</strong> na gestão de usuários.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {simulatedTargetUser ? (
              <button
                type="button"
                onClick={() => setSimulatedTargetUser(null)}
                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs cursor-pointer"
              >
                Sair da Simulação (Voltar para Dono)
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const uid = user.uid || auth?.currentUser?.uid || user.id;
                  if (uid && isFirebaseEnvConfigured) {
                    const refreshed = await dataService.obterPerfilUsuario(uid);
                    if (refreshed) {
                      setUser({ ...user, ...refreshed, emailVerified: true });
                      if (!isUserAguardando(refreshed) && refreshed.situacao !== 'bloqueado') {
                        showToast('Acesso liberado! Bem-vindo ao sistema Ameta.');
                      } else {
                        showToast('Seu cadastro ainda aguarda liberação pelo dono.');
                      }
                    }
                  } else {
                    const res = await fetch('/api/state', { cache: 'no-store' });
                    if (res.ok) {
                      const st = await res.json();
                      const match = (st.users || []).find(
                        (u: AmetaUser) => u.email.toLowerCase() === user.email.toLowerCase()
                      );
                      if (match) {
                        setUser({ ...user, ...match, emailVerified: true });
                        if (!isUserAguardando(match) && match.situacao !== 'bloqueado') {
                          showToast('Acesso liberado! Bem-vindo ao sistema Ameta.');
                        } else {
                          showToast('Seu cadastro ainda aguarda liberação pelo dono.');
                        }
                      }
                    }
                  }
                }}
                className="px-4 py-2.5 rounded-xl bg-[#223585] hover:bg-[#192868] text-white font-bold text-xs inline-flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Verificar se meu acesso foi liberado</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleLogout}
              className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 border border-slate-200 font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sair da Conta</span>
            </button>
          </div>
        </div>
        <div />
      </div>
    );
  }

  const userInitials = user.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'AM';

  return (
    <div className="min-h-screen bg-[#F0F3FB] text-slate-900 flex flex-col">
      {/* Top Official Brand Accent Bar (Ameta Navy #223585 -> Ameta Teal #1E8E8D) */}
      <div className="h-1 w-full bg-gradient-to-r from-[#223585] via-[#206289] to-[#1E8E8D] shrink-0" />

      {/* =====================================================================
          1. HIERARQUIA VISUAL E LIMPEZA DO CABEÇALHO (HEADER SEM SOBREPOSIÇÃO)
          - Navegação enxuta à esquerda (Logo + Vendor + Sites / Engenharia)
          - Barra de Ações Secundária agrupada à direita + Menu completo no RA
         ===================================================================== */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-3 sm:px-5 py-2.5 shadow-xs space-y-2.5">
        {/* Top Row: Logo + Desktop Vendor Switcher + Desktop Nav + Right Action Buttons */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
            <button
              type="button"
              onClick={() => setActiveTopTab('sites')}
              className="cursor-pointer text-left shrink-0"
            >
              <AmetaLogo size="sm" theme="light" />
            </button>

            {/* Desktop Vendor Pill Switcher */}
            <div className="hidden lg:flex items-center p-0.5 bg-[#F0F3FB] border border-blue-200/70 rounded-lg shrink-0">
              {canAccessNokia && (
                <button
                  type="button"
                  onClick={() => handleSwitchVendor('NOKIA')}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors cursor-pointer ${
                    activeVendor === 'NOKIA'
                      ? 'bg-[#223585] text-white shadow-2xs'
                      : 'text-slate-600 hover:text-[#223585]'
                  }`}
                >
                  TIM / NOKIA
                </button>
              )}
              {canAccessEricsson && (
                <button
                  type="button"
                  onClick={() => handleSwitchVendor('ERICSSON')}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors cursor-pointer ${
                    activeVendor === 'ERICSSON'
                      ? 'bg-[#1E8E8D] text-white shadow-2xs'
                      : 'text-slate-600 hover:text-[#1E8E8D]'
                  }`}
                >
                  ERICSSON
                </button>
              )}
            </div>

            {/* Desktop Horizontal Navigation Tabs */}
            <nav className="hidden lg:flex items-center gap-1 text-xs font-medium shrink-0">
              {canSeeSitesTab && (
                <button
                  type="button"
                  onClick={() => setActiveTopTab('sites')}
                  className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                    resolvedTopTab === 'sites'
                      ? 'bg-[#223585]/10 text-[#223585] font-bold border border-[#223585]/25'
                      : 'text-slate-600 hover:text-[#223585] hover:bg-slate-50'
                  }`}
                >
                  <FolderKanban className="w-3.5 h-3.5 text-[#223585] shrink-0" />
                  <span>
                    {activeVendor === 'ERICSSON'
                      ? canSeeFullSpreadsheets
                        ? 'Sites'
                        : 'Meus Sites Demandados'
                      : canSeeFullSpreadsheets
                      ? 'Sites (Planilhas)'
                      : 'Meus Sites Demandados'}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    (
                    {activeVendor === 'ERICSSON'
                      ? ericssonSiteCounters.totalSites
                      : filteredControleGeralSites.length}
                    )
                  </span>
                  {activeVendor === 'NOKIA' && countNovos > 0 && (
                    <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold rounded-full tabular-nums">
                      +{countNovos}
                    </span>
                  )}
                </button>
              )}

              {canSeeEngenhariaTab && (
                <button
                  type="button"
                  onClick={() => setActiveTopTab('engenharia')}
                  className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                    resolvedTopTab === 'engenharia'
                      ? 'bg-[#1E8E8D]/10 text-[#1E8E8D] font-bold border border-[#1E8E8D]/30'
                      : 'text-slate-600 hover:text-[#1E8E8D] hover:bg-slate-50'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#1E8E8D] shrink-0" />
                  <span>Engenharia</span>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    ({activeVendor === 'ERICSSON' ? ericssonRows.length : tssrRows.length})
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveTopTab('vistoria')}
                className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  resolvedTopTab === 'vistoria'
                    ? 'bg-blue-600/10 text-blue-700 font-bold border border-blue-600/30'
                    : 'text-slate-600 hover:text-blue-700 hover:bg-slate-50'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>{effectiveRole === 'Executor' ? 'Subir TSSR' : 'Vistoria'}</span>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  ({vendorEngineeringFilesCount})
                </span>
              </button>

              {isRealAdmin && !simulatedTargetUser && (
                <button
                  type="button"
                  onClick={() => setActiveTopTab('duplas')}
                  className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                    resolvedTopTab === 'duplas'
                      ? 'bg-slate-900 text-white font-bold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Users
                    className={`w-3.5 h-3.5 shrink-0 ${
                      resolvedTopTab === 'duplas' ? 'text-blue-400' : 'text-[#223585]'
                    }`}
                  />
                  <span>Duplas & Demanda</span>
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      resolvedTopTab === 'duplas' ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    ({equipesDuplas.length})
                  </span>
                </button>
              )}

              {isRealAdmin &&
                resolvedTopTab !== 'sites' &&
                resolvedTopTab !== 'engenharia' &&
                resolvedTopTab !== 'vistoria' && (
                <div className="flex items-center gap-1 pl-1 ml-1 border-l border-slate-200">
                  <span className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white font-semibold flex items-center gap-2 text-xs shadow-2xs">
                    <span>
                      {resolvedTopTab === 'duplas' && 'Aba: Duplas & Demanda'}
                      {resolvedTopTab === 'perfis' && 'Aba: Perfis & Acessos'}
                      {resolvedTopTab === 'novo_site' && 'Aba: + Novo Site'}
                      {resolvedTopTab === 'importar' && 'Aba: Importar / OneDrive'}
                      {resolvedTopTab === 'colar' && 'Aba: Colar Ctrl+V'}
                      {resolvedTopTab === 'exportar' && 'Aba: Exportar Planilha'}
                      {resolvedTopTab === 'simular' && 'Aba: Simular Visão'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTopTab('sites')}
                      className="p-0.5 rounded hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
                      title="Fechar aba e voltar para Sites"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                </div>
              )}
            </nav>
          </div>

          {/* Right: Role Badge + Notification Bell + ADM Dono Button + RA Menu */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-[10px] sm:text-[11px] font-bold text-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-[#223585] shrink-0" />
              <span className="truncate max-w-[95px] sm:max-w-none">{effectiveRole}</span>
            </span>

            <NotificationBellDropdown
              notifications={notifications}
              effectiveUser={activeTargetUser}
              realUser={user}
              activeVendor={activeVendor}
              nokiaSites={sites}
              ericssonRows={ericssonRows}
              engineeringFiles={engineeringFiles}
              ericssonFiles={ericssonFiles}
              onNotificationsUpdated={(next) => setNotifications(next)}
              onNavigateToContext={(notif) => {
                if (notif.vendor && canUserAccessVendor(activeTargetUser, notif.vendor)) {
                  setActiveVendor(notif.vendor);
                }
                if (notif.type === 'ARQUIVO_ASSOCIADO_SITE_VISTORIADOR') {
                  setActiveTopTab('vistoria');
                } else if (
                  notif.type === 'VISTORIA_OK_PASTA' ||
                  notif.type === 'TSSR_ENVIADO_EXECUTOR'
                ) {
                  setActiveTopTab(canSeeEngenhariaTab ? 'engenharia' : 'vistoria');
                } else if (
                  notif.type === 'SITE_DEMANDADO_EXECUTOR' ||
                  notif.type === 'EXECUTOR_ATUALIZOU_EQUIPE'
                ) {
                  setActiveTopTab(canSeeSitesTab ? 'sites' : 'vistoria');
                }
              }}
            />

            {isOwnerAdm && !simulatedTargetUser && (
              <>
                <button
                  type="button"
                  onClick={handleConnectFirebaseCloud}
                  disabled={isSyncingFirebase}
                  className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs shadow-sm transition-colors cursor-pointer ${
                    firebaseCloudStatus.connected
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 text-white'
                  }`}
                  title={
                    firebaseCloudStatus.connected
                      ? `Firebase Cloud conectado (${firebaseCloudStatus.email}) — Clique para sincronizar agora`
                      : 'Clique para ligar e sincronizar com o banco Firebase Cloud'
                  }
                >
                  <Cloud
                    className={`w-3.5 h-3.5 ${
                      isSyncingFirebase
                        ? 'animate-bounce text-amber-300'
                        : firebaseCloudStatus.connected
                        ? 'text-emerald-200'
                        : 'text-emerald-400'
                    }`}
                  />
                  <span>
                    {isSyncingFirebase
                      ? 'Sincronizando...'
                      : firebaseCloudStatus.connected
                      ? 'Firebase Ligado'
                      : 'Ligar Firebase'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setOwnerPermissionsModalOpen(true)}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-sm transition-colors cursor-pointer"
                  title="Painel Exclusivo ADM Dono — Escolher cargos e liberar permissões"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Liberar Permissões (ADM Dono)</span>
                </button>
              </>
            )}

            {isRealAdmin && !simulatedTargetUser ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsRaMenuOpen((prev) => !prev)}
                  className={`flex items-center gap-1.5 p-1 pr-2 rounded-full border transition-colors cursor-pointer ${
                    isRaMenuOpen || (resolvedTopTab !== 'sites' && resolvedTopTab !== 'engenharia')
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                  title="Menu Exclusivo RA — Administração, Firebase e Testes"
                >
                  <div className="w-7 h-7 rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center select-none ring-1 ring-white/20">
                    {userInitials}
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                </button>

                {isRaMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40 bg-slate-900/20 sm:bg-transparent"
                      onClick={() => setIsRaMenuOpen(false)}
                    />
                    <div className="fixed inset-x-3 top-14 sm:inset-x-auto sm:top-auto sm:absolute sm:right-0 sm:mt-1.5 sm:w-64 bg-white border border-slate-200 rounded-2xl sm:rounded-xl shadow-2xl py-2 z-50 text-xs max-h-[82vh] overflow-y-auto">
                      <div className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 flex items-center justify-between">
                        <span>Menu Exclusivo RA (Admin)</span>
                        <button
                          type="button"
                          onClick={() => setIsRaMenuOpen(false)}
                          className="sm:hidden p-1 text-slate-400 hover:text-slate-700"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {isOwnerAdm && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setIsRaMenuOpen(false);
                              handleConnectFirebaseCloud();
                            }}
                            className={`w-full px-3.5 py-2.5 sm:py-2 text-left flex items-center justify-between font-bold border-b cursor-pointer ${
                              firebaseCloudStatus.connected
                                ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-950 border-emerald-200/70'
                                : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-800'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <Cloud
                                className={`w-4 h-4 ${
                                  firebaseCloudStatus.connected
                                    ? 'text-emerald-600'
                                    : 'text-emerald-400'
                                }`}
                              />
                              <span>
                                {firebaseCloudStatus.connected
                                  ? 'Firebase Cloud (Sincronizar)'
                                  : 'Ligar no Firebase Agora'}
                              </span>
                            </span>
                            <span
                              className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                                firebaseCloudStatus.connected
                                  ? 'bg-emerald-200/80 text-emerald-950'
                                  : 'bg-emerald-500 text-slate-950'
                              }`}
                            >
                              {firebaseCloudStatus.connected ? 'LIGADO' : 'LIGAR'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setIsRaMenuOpen(false);
                              setOwnerPermissionsModalOpen(true);
                            }}
                            className="w-full px-3.5 py-2.5 sm:py-2 text-left flex items-center justify-between bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold border-b border-amber-200/70 cursor-pointer"
                          >
                            <span className="flex items-center gap-2">
                              <ShieldCheck className="w-4 h-4 text-amber-600" />
                              <span>Painel ADM Dono (Liberar)</span>
                            </span>
                            <span className="text-[9px] font-black uppercase bg-amber-200/80 px-1.5 py-0.5 rounded">
                              DONO
                            </span>
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setIsRaMenuOpen(false);
                          setActiveTopTab('duplas');
                        }}
                        className={`w-full px-3.5 py-2.5 sm:py-1.5 text-left flex items-center justify-between hover:bg-slate-50 cursor-pointer ${
                          resolvedTopTab === 'duplas' ? 'bg-blue-50/70 text-blue-700 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-blue-600" />
                          <span>Duplas & Demanda</span>
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{equipesDuplas.length}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsRaMenuOpen(false);
                          setActiveTopTab('perfis');
                        }}
                        className={`w-full px-3.5 py-2.5 sm:py-1.5 text-left flex items-center justify-between hover:bg-slate-50 cursor-pointer ${
                          resolvedTopTab === 'perfis' ? 'bg-blue-50/70 text-blue-700 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-slate-600" />
                          <span>Perfis & Acessos</span>
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{users.length}</span>
                      </button>

                      <div className="my-1 border-t border-slate-100" />

                      <button
                        type="button"
                        onClick={() => {
                          setIsRaMenuOpen(false);
                          setActiveTopTab('novo_site');
                        }}
                        className={`w-full px-3.5 py-2.5 sm:py-1.5 text-left flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                          resolvedTopTab === 'novo_site' ? 'bg-blue-50/70 text-blue-700 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        <Plus className="w-4 h-4 text-blue-600" />
                        <span>+ Novo Site</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsRaMenuOpen(false);
                          setBulkInitialTab('onedrive');
                          setActiveTopTab('importar');
                        }}
                        className={`w-full px-3.5 py-2.5 sm:py-1.5 text-left flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                          resolvedTopTab === 'importar' ? 'bg-blue-50/70 text-blue-700 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        <CloudDownload className="w-4 h-4 text-blue-600" />
                        <span>Importar / OneDrive</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsRaMenuOpen(false);
                          setPastedShortcutText('');
                          setBulkInitialTab('paste');
                          setActiveTopTab('colar');
                        }}
                        className={`w-full px-3.5 py-2.5 sm:py-1.5 text-left flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                          resolvedTopTab === 'colar' ? 'bg-blue-50/70 text-blue-700 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        <ClipboardPaste className="w-4 h-4 text-slate-600" />
                        <span>Colar Ctrl+V</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsRaMenuOpen(false);
                          setActiveTopTab('exportar');
                        }}
                        className={`w-full px-3.5 py-2.5 sm:py-1.5 text-left flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                          resolvedTopTab === 'exportar' ? 'bg-blue-50/70 text-blue-700 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        <Download className="w-4 h-4 text-emerald-600" />
                        <span>Exportar Planilha</span>
                      </button>

                      {isOwnerAdm && (
                        <>
                          <div className="my-1 border-t border-slate-100" />
                          <div className="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50/60 flex items-center justify-between">
                            <span>Opções de Teste (Só para Mim)</span>
                            <span className="text-[9px] font-mono px-1 rounded bg-amber-200/70 text-amber-900">
                              RA
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setIsRaMenuOpen(false);
                              setActiveTopTab('simular');
                            }}
                            className={`w-full px-3.5 py-2.5 sm:py-1.5 text-left flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                              resolvedTopTab === 'simular' ? 'bg-blue-50/70 text-blue-700 font-semibold' : 'text-slate-700'
                            }`}
                          >
                            <Eye className="w-4 h-4 text-slate-600" />
                            <span>Escolher Dupla / Usuário p/ Testar</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const coordGeral =
                                (activeVendor === 'ERICSSON'
                                  ? ericssonUsers.find((u) => u.role === 'Coordenador Geral')
                                  : users.find((u) => u.role === 'Coordenador Geral')) || {
                                  id: 'sim-coord-geral',
                                  name: `Coordenador Geral (${activeVendor})`,
                                  email:
                                    activeVendor === 'ERICSSON'
                                      ? 'coord.geral.ericsson@ameta.com.br'
                                      : 'coord.geral.tim@ameta.com.br',
                                  role: 'Coordenador Geral' as UserRole,
                                  assignedPlatform: activeVendor,
                                  equipe: `Coordenação Geral ${activeVendor}`,
                                  emailVerified: true,
                                  createdAt: '',
                                };
                              setIsRaMenuOpen(false);
                              setSimulatedTargetUser(coordGeral);
                              setActiveTopTab('sites');
                              showToast(`Simulando Coordenador Geral (${activeVendor}): vê todas as planilhas`);
                            }}
                            className="w-full px-3.5 py-2 sm:py-1.5 text-left flex items-center justify-between hover:bg-indigo-50 text-indigo-800 font-medium cursor-pointer"
                          >
                            <span>Testar Coordenador Geral</span>
                            <span className="text-[10px] font-mono bg-indigo-100 px-1.5 py-0.5 rounded">
                              Todas Plan.
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const coordEng =
                                (activeVendor === 'ERICSSON'
                                  ? ericssonUsers.find((u) => u.role === 'Coordenador Engenharia')
                                  : users.find((u) => u.role === 'Coordenador Engenharia')) || {
                                  id: 'sim-coord-eng',
                                  name: `Coordenador Engenharia (${activeVendor})`,
                                  email:
                                    activeVendor === 'ERICSSON'
                                      ? 'coord.engenharia.ericsson@ameta.com.br'
                                      : 'coord.engenharia.tim@ameta.com.br',
                                  role: 'Coordenador Engenharia' as UserRole,
                                  assignedPlatform: activeVendor,
                                  equipe: `Coordenação Engenharia ${activeVendor}`,
                                  emailVerified: true,
                                  createdAt: '',
                                };
                              setIsRaMenuOpen(false);
                              setSimulatedTargetUser(coordEng);
                              setActiveTopTab('engenharia');
                              showToast(
                                `Simulando Coordenador Engenharia (${activeVendor}): vê apenas Engenharia e Vistoria`
                              );
                            }}
                            className="w-full px-3.5 py-2 sm:py-1.5 text-left flex items-center justify-between hover:bg-purple-50 text-purple-800 font-medium cursor-pointer"
                          >
                            <span>Testar Coord. Engenharia</span>
                            <span className="text-[10px] font-mono bg-purple-100 px-1.5 py-0.5 rounded">
                              Eng + Vist
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const vist =
                                users.find((u) => u.email.toLowerCase() === 'teste@ameta.com.br') ||
                                users.find((u) => u.role === 'Vistoriador');
                              setIsRaMenuOpen(false);
                              if (vist) {
                                setSimulatedTargetUser(vist);
                                setActiveTopTab('sites');
                                showToast(`Testando perfil Vistoriador: ${vist.name}`);
                              }
                            }}
                            className="w-full px-3.5 py-2 sm:py-1.5 text-left flex items-center justify-between hover:bg-amber-50 text-amber-800 font-medium cursor-pointer"
                          >
                            <span>Testar Vistoriador</span>
                            <span className="text-[10px] font-mono bg-amber-100 px-1.5 py-0.5 rounded">
                              Vistoria
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const exec =
                                users.find(
                                  (u) => u.email.toLowerCase() === 'executor.teste@ameta.com.br'
                                ) || users.find((u) => u.role === 'Executor');
                              setIsRaMenuOpen(false);
                              if (exec) {
                                setSimulatedTargetUser(exec);
                                setActiveTopTab('sites');
                                showToast(`Testando perfil Executor: ${exec.name}`);
                              }
                            }}
                            className="w-full px-3.5 py-2 sm:py-1.5 text-left flex items-center justify-between hover:bg-blue-50 text-blue-700 font-medium cursor-pointer"
                          >
                            <span>Testar Executor</span>
                            <span className="text-[10px] font-mono bg-blue-100 px-1.5 py-0.5 rounded">
                              Só TSSR
                            </span>
                          </button>
                        </>
                      )}

                      <div className="my-1 border-t border-slate-100" />

                      <button
                        type="button"
                        onClick={() => {
                          setIsRaMenuOpen(false);
                          handleLogout();
                        }}
                        className="w-full px-3.5 py-2.5 sm:py-1.5 text-left flex items-center gap-2 text-red-600 hover:bg-red-50 cursor-pointer font-medium"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Sair</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F3F4F6] hover:bg-red-50 text-slate-700 hover:text-red-600 text-xs font-medium transition-colors cursor-pointer"
                title="Sair da Conta"
              >
                <div className="w-7 h-7 rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">
                  {userInitials}
                </div>
                <span className="hidden sm:inline">Sair</span>
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ===================================================================
            PAINEL DE OPÇÕES BEM APARENTES NO MOBILE / TABLET (lg:hidden)
            - Botões grandes, legíveis e em grade 100% visível sem precisar esconder
           =================================================================== */}
        <div className="lg:hidden space-y-2 pt-1.5 border-t border-slate-100">
          {/* 1. Seletor Grande de Sistema (TIM / NOKIA vs ERICSSON) */}
          {(canAccessNokia && canAccessEricsson) && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleSwitchVendor('NOKIA')}
                className={`py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-wide flex items-center justify-center gap-2 border-2 transition-all cursor-pointer ${
                  activeVendor === 'NOKIA'
                    ? 'bg-[#223585] border-[#223585] text-white shadow-sm'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-[#223585]'
                }`}
              >
                <span>TIM / NOKIA</span>
                {activeVendor === 'NOKIA' && (
                  <span className="px-1.5 py-0.5 rounded bg-white/20 text-[10px]">ATIVO</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSwitchVendor('ERICSSON')}
                className={`py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-wide flex items-center justify-center gap-2 border-2 transition-all cursor-pointer ${
                  activeVendor === 'ERICSSON'
                    ? 'bg-[#1E8E8D] border-[#1E8E8D] text-white shadow-sm'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-[#1E8E8D]'
                }`}
              >
                <span>ERICSSON</span>
                {activeVendor === 'ERICSSON' && (
                  <span className="px-1.5 py-0.5 rounded bg-white/20 text-[10px]">ATIVO</span>
                )}
              </button>
            </div>
          )}

          {/* 2. Grade de Opções Principais Bem Aparentes (2 colunas, botões grandes) */}
          <div className="grid grid-cols-2 gap-2">
            {canSeeSitesTab && (
              <button
                type="button"
                onClick={() => setActiveTopTab('sites')}
                className={`p-2.5 rounded-xl border-2 text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                  resolvedTopTab === 'sites'
                    ? 'bg-[#223585] border-[#223585] text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-800 hover:border-[#223585]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FolderKanban
                    className={`w-4 h-4 shrink-0 ${
                      resolvedTopTab === 'sites' ? 'text-white' : 'text-[#223585]'
                    }`}
                  />
                  <span className="text-xs font-extrabold truncate">
                    {canSeeFullSpreadsheets ? 'Sites (Planilha)' : 'Meus Sites'}
                  </span>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] font-bold shrink-0 ${
                    resolvedTopTab === 'sites'
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {activeVendor === 'ERICSSON'
                    ? ericssonSiteCounters.totalSites
                    : filteredControleGeralSites.length}
                </span>
              </button>
            )}

            {canSeeEngenhariaTab && (
              <button
                type="button"
                onClick={() => setActiveTopTab('engenharia')}
                className={`p-2.5 rounded-xl border-2 text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                  resolvedTopTab === 'engenharia'
                    ? 'bg-[#1E8E8D] border-[#1E8E8D] text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-800 hover:border-[#1E8E8D]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileSpreadsheet
                    className={`w-4 h-4 shrink-0 ${
                      resolvedTopTab === 'engenharia' ? 'text-white' : 'text-[#1E8E8D]'
                    }`}
                  />
                  <span className="text-xs font-extrabold truncate">Engenharia</span>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] font-bold shrink-0 ${
                    resolvedTopTab === 'engenharia'
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {activeVendor === 'ERICSSON' ? ericssonRows.length : tssrRows.length}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveTopTab('vistoria')}
              className={`p-2.5 rounded-xl border-2 text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                resolvedTopTab === 'vistoria'
                  ? effectiveRole === 'Executor'
                    ? 'bg-purple-700 border-purple-700 text-white shadow-sm'
                    : 'bg-blue-600 border-blue-600 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-800 hover:border-blue-600'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <FolderOpen
                  className={`w-4 h-4 shrink-0 ${
                    resolvedTopTab === 'vistoria'
                      ? 'text-white'
                      : effectiveRole === 'Executor'
                      ? 'text-purple-600'
                      : 'text-blue-600'
                  }`}
                />
                <span className="text-xs font-extrabold truncate">
                  {effectiveRole === 'Executor' ? 'Subir TSSR' : 'Subir Vistoria'}
                </span>
              </div>
              <span
                className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] font-bold shrink-0 ${
                  resolvedTopTab === 'vistoria'
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {vendorEngineeringFilesCount}
              </span>
            </button>

            {isRealAdmin && !simulatedTargetUser && (
              <button
                type="button"
                onClick={() => setActiveTopTab('duplas')}
                className={`p-2.5 rounded-xl border-2 text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                  resolvedTopTab === 'duplas'
                    ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                    : 'bg-amber-50/80 border-amber-300 text-slate-900 hover:border-slate-900'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Users
                    className={`w-4 h-4 shrink-0 ${
                      resolvedTopTab === 'duplas' ? 'text-amber-400' : 'text-amber-600'
                    }`}
                  />
                  <span className="text-xs font-extrabold truncate">Demandar / Duplas</span>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] font-bold shrink-0 ${
                    resolvedTopTab === 'duplas'
                      ? 'bg-white/20 text-white'
                      : 'bg-amber-200/70 text-amber-950'
                  }`}
                >
                  {equipesDuplas.length}
                </span>
              </button>
            )}
          </div>

          {/* 3. Barra Adicional de Opções ADM Bem Aparentes no Mobile */}
          {isRealAdmin && !simulatedTargetUser && (
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTopTab('perfis')}
                className={`py-2 px-2 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                  resolvedTopTab === 'perfis'
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="truncate">Perfis ({users.length})</span>
              </button>

              {isOwnerAdm ? (
                <button
                  type="button"
                  onClick={() => setOwnerPermissionsModalOpen(true)}
                  className="py-2 px-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-black flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                >
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Permissões</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTopTab('novo_site')}
                  className="py-2 px-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span className="truncate">+ Novo Site</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsRaMenuOpen(true)}
                className="py-2 px-2 rounded-lg bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>+ Mais Opções</span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Active User Simulation Banner (Clean Neutral Slate Banner) */}
      {simulatedTargetUser && (
        <div className="bg-slate-900 text-white px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Eye className="w-3.5 h-3.5 text-slate-300 shrink-0" />
            <span>
              <strong>Modo de visualização ({simulatedTargetUser.name})</strong> — Exibindo apenas a demanda vinculada a esta dupla/usuário:{' '}
              <strong className="underline">{rawControleGeralPool.length} Site(s)</strong> e{' '}
              <strong className="underline">{vendorEngineeringFilesCount} Documento(s)</strong>.
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canSeeSitesTab && (
              <button
                type="button"
                onClick={() => setActiveTopTab('sites')}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                  resolvedTopTab === 'sites'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
              >
                Sites ({rawControleGeralPool.length})
              </button>
            )}
            {canSeeEngenhariaTab && (
              <button
                type="button"
                onClick={() => setActiveTopTab('engenharia')}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                  resolvedTopTab === 'engenharia'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
              >
                Engenharia ({activeVendor === 'ERICSSON' ? ericssonRows.length : tssrRows.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTopTab('vistoria')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                resolvedTopTab === 'vistoria'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
              }`}
            >
              Pasta Vistoria ({vendorEngineeringFilesCount})
            </button>
            <button
              type="button"
              onClick={() => setSimulatedTargetUser(null)}
              className="px-2.5 py-1 bg-white text-slate-900 font-semibold rounded text-[11px] hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Voltar ao ADM
            </button>
          </div>
        </div>
      )}

      {/* Live Toast */}
      {liveToast && (
        <div className="fixed bottom-16 sm:bottom-5 right-3 left-3 sm:left-auto sm:right-5 z-40 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2.5 text-xs">
          <RefreshCw className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
          <span>{liveToast}</span>
        </div>
      )}

      {/* =====================================================================
          MAIN WORKSPACE CONTENT
         ===================================================================== */}
      <main
        className={`flex-1 w-full mx-auto px-2.5 sm:px-6 py-3 sm:py-5 pb-20 sm:pb-5 space-y-3 ${
          resolvedTopTab === 'engenharia' ? 'max-w-full' : 'max-w-[1800px]'
        }`}
      >
        {/* ===================================================================
            SISTEMA INDEPENDENTE DA ERICSSON (SITES, ENGENHARIA, VISTORIA)
           =================================================================== */}
        {activeVendor === 'ERICSSON' && (
          <>
            {canSeeSitesTab && resolvedTopTab === 'sites' && (
              <EricssonSitesTab
                user={activeTargetUser || user}
                effectiveRole={effectiveRole}
                rows={ericssonRows}
                sheetMeta={ericssonSheetMeta || null}
                ericssonUsers={ericssonUsers}
                onUpdated={(nextRows, nextMeta, toastMsg, nextFiles) => {
                  setEricssonRows(nextRows);
                  if (nextMeta) setEricssonSheetMeta(nextMeta);
                  if (Array.isArray(nextFiles)) setEricssonFiles(nextFiles);
                  if (toastMsg) showToast(toastMsg);
                }}
                onEricssonUsersUpdated={(nextUsers, toastMsg) => {
                  setEricssonUsers(nextUsers);
                  if (toastMsg) showToast(toastMsg);
                }}
                onOpenFileInVistoriaFolder={(folderId, fileId, fileName) => {
                  setEricssonVistoriaFocus({ folderId, fileId, fileName });
                  setActiveTopTab('vistoria');
                }}
                onOpenDuplasDemanda={
                  isRealAdmin ? () => setActiveTopTab('duplas') : undefined
                }
              />
            )}

            {resolvedTopTab === 'engenharia' && canSeeEngenhariaTab && (
              <EricssonEngenhariaTab
                user={activeTargetUser || user}
                effectiveRole={effectiveRole}
                rows={ericssonRows}
                sheetMeta={ericssonSheetMeta || null}
                onUpdated={(nextRows, nextMeta, toastMsg, nextFiles) => {
                  setEricssonRows(nextRows);
                  if (nextMeta) setEricssonSheetMeta(nextMeta);
                  if (Array.isArray(nextFiles)) setEricssonFiles(nextFiles);
                  if (toastMsg) showToast(toastMsg);
                }}
                onOpenFileInVistoriaFolder={(folderId, fileId, fileName) => {
                  setEricssonVistoriaFocus({ folderId, fileId, fileName });
                  setActiveTopTab('vistoria');
                }}
              />
            )}

            {resolvedTopTab === 'vistoria' && (
              <EricssonVistoriaTab
                user={activeTargetUser || user}
                effectiveRole={effectiveRole}
                rows={ericssonRows}
                sheetMeta={ericssonSheetMeta || null}
                folders={ericssonFolders}
                files={ericssonFiles}
                focusedFolderId={ericssonVistoriaFocus?.folderId || null}
                focusedFileId={ericssonVistoriaFocus?.fileId || null}
                focusedFileName={ericssonVistoriaFocus?.fileName || null}
                onClearFocus={() => setEricssonVistoriaFocus(null)}
                onUpdated={(nextRows, nextMeta, toastMsg, nextFolders, nextFiles) => {
                  setEricssonRows(nextRows);
                  if (nextMeta) setEricssonSheetMeta(nextMeta);
                  if (Array.isArray(nextFolders)) setEricssonFolders(nextFolders);
                  if (Array.isArray(nextFiles)) setEricssonFiles(nextFiles);
                  if (toastMsg) showToast(toastMsg);
                }}
                onOpenSitesTab={
                  canSeeSitesTab ? () => setActiveTopTab('sites') : undefined
                }
              />
            )}
          </>
        )}

        {/* -------------------------------------------------------------------
            SISTEMA DA NOKIA (INALTERADO) — TAB 1: SITES
           ------------------------------------------------------------------- */}
        {activeVendor === 'NOKIA' && resolvedTopTab === 'sites' && canSeeSitesTab && (
          <>
            {canSeeFullSpreadsheets && (
              <InteractiveSpreadsheetChart
                sites={rawControleGeralPool}
                users={users}
                activeVendor={activeVendor}
                activeChartFilter={chartQuickFilter}
                onSelectChartFilter={(f) => setChartQuickFilter(f)}
                activeEquipeFilter={equipeFilter}
                onSelectEquipeFilter={(eq) => setEquipeFilter(eq)}
                activeExecutorFilter={executorFilter}
                onSelectExecutorFilter={(ex) => setExecutorFilter(ex)}
                activeUfFilter={ufFilter}
                onSelectUfFilter={(uf) => setUfFilter(uf)}
                onOpenSite={(siteId) => setSelectedSiteId(siteId)}
                onOpenCollaboratorDocs={(targetUserId) => {
                  setInitialExpandedUserId(targetUserId);
                  setActiveTopTab('perfis');
                }}
                onRemoveExpiredDoc={async (targetUserId, docType, docLabel, targetUserName) => {
                  // Immediate optimistic update
                  setUsers((prev) =>
                    prev.map((u) => {
                      if (u.id !== targetUserId) return u;
                      const nextDocs = ensureUserMandatoryDocuments(u.documents).map((d) =>
                        d.type === docType
                          ? {
                              ...d,
                              fileName: '',
                              fileSize: 0,
                              uploadedAt: '',
                              uploadedBy: '',
                              storageFileName: '',
                              expiresAt: '',
                              statusOverride: undefined,
                              notes: '',
                            }
                          : d
                      );
                      const nextUser: AmetaUser = { ...u, documents: nextDocs };
                      nextUser.statusRecurso =
                        evaluateUserOverallDocumentStatus(nextUser).overallStatus;
                      return nextUser;
                    })
                  );
                  showToast(`Documento ${docLabel} (${targetUserName}) removido em tempo real`);

                  try {
                    const res = await fetch(
                      `/api/admin/users/${encodeURIComponent(targetUserId)}/documents`,
                      {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          docType,
                          clearFile: true,
                          expiresAt: '',
                          statusOverride: '',
                          uploadedBy: user?.name || 'ADM',
                        }),
                      }
                    );
                    if (res.ok) {
                      const data = await res.json();
                      if (Array.isArray(data.users)) {
                        setUsers(data.users);
                      }
                    }
                  } catch {
                    // ignore network error
                  }
                }}
              />
            )}

            <div
              className={
                isSpreadsheetFullscreen
                  ? 'fixed inset-0 z-40 bg-white flex flex-col w-screen h-screen overflow-hidden'
                  : 'bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden'
              }
            >
            {/* Newly Entered Sites Alert Strip ("QUANDO ENTRAR SITE NOVO ELE MOSTRE OS NOVOS") */}
            {countNovos > 0 && (
              <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-emerald-900">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-600 text-white font-bold text-[11px]">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{countNovos} SITE(S) NOVO(S)</span>
                  </span>
                  <span className="font-medium">
                    Entraram novos sites na planilha:
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {novosSitesList.slice(0, 6).map((ns) => (
                      <button
                        key={ns.id}
                        type="button"
                        onClick={() => setSelectedSiteId(ns.id)}
                        className="px-2 py-0.5 bg-white hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-mono font-bold rounded text-[11px] cursor-pointer"
                      >
                        {ns.siteId}
                      </button>
                    ))}
                    {novosSitesList.length > 6 && (
                      <span className="text-emerald-700 font-mono text-[11px]">
                        +{novosSitesList.length - 6} mais
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setFunctionFilter((prev) => (prev === 'NOVOS' ? 'TODOS_GERAL' : 'NOVOS'))
                    }
                    className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                      functionFilter === 'NOVOS'
                        ? 'bg-emerald-700 text-white'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                  >
                    {functionFilter === 'NOVOS'
                      ? 'Mostrar Todos os Sites'
                      : `Filtrar Apenas Novos (${countNovos})`}
                  </button>
                  {effectiveRole === 'ADM' && (
                    <button
                      type="button"
                      onClick={handleMarkNewSitesSeen}
                      className="px-2.5 py-1 bg-white hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-medium rounded-lg transition-colors cursor-pointer"
                    >
                      Marcar Novos como Vistos
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Folder Header + Density & View Controls + Fullscreen Toggle */}
            <div className="px-5 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!isSpreadsheetFullscreen) {
                      setControleGeralOpen((prev) => !prev);
                    }
                  }}
                  className="flex items-center gap-2.5 text-left cursor-pointer"
                >
                  <FolderKanban className="w-4 h-4 text-slate-600" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        Pasta Controle Geral
                      </span>
                      <span className="px-2 py-0.5 bg-[#F3F4F6] border border-slate-200 rounded-md text-xs font-mono text-slate-700 font-semibold tabular-nums">
                        {filteredControleGeralSites.length} registro
                        {filteredControleGeralSites.length !== 1 ? 's' : ''}
                      </span>
                      {isSpreadsheetFullscreen && (
                        <span className="px-2 py-0.5 bg-blue-600 text-white rounded-md text-[11px] font-bold">
                          TELA INTEIRA
                        </span>
                      )}
                    </div>
                  </div>
                  {!isSpreadsheetFullscreen &&
                    (controleGeralOpen ? (
                      <ChevronUp className="w-4 h-4 text-slate-400 ml-1" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400 ml-1" />
                    ))}
                </button>

                {isSpreadsheetFullscreen && (
                  <div className="flex items-center p-0.5 bg-[#F3F4F6] border border-slate-200 rounded-lg">
                    {(['NOKIA', 'ERICSSON'] as VendorType[]).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          setActiveVendor(v);
                          setActiveSheetName(v === 'NOKIA' ? 'Controle Geral' : 'ALL');
                        }}
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
                  title="Alternância de Layout (Controle de Densidade da Tabela)"
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

                {/* View Mode Switcher */}
                <div className="flex items-center p-0.5 bg-[#F3F4F6] border border-slate-200 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setFolderViewMode('fluid')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                      folderViewMode === 'fluid'
                        ? 'bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/70'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <LayoutList className="w-3.5 h-3.5" />
                    <span>Resumo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFolderViewMode('grid')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                      folderViewMode === 'grid'
                        ? 'bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/70'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Table className="w-3.5 h-3.5" />
                    <span>Planilha ({orderedSheetColumns.length} col)</span>
                  </button>
                </div>

                {/* Fullscreen Spreadsheet View Toggle ("visualizar a planilha em tela inteira") */}
                <button
                  type="button"
                  onClick={() => {
                    const nextFullscreen = !isSpreadsheetFullscreen;
                    setIsSpreadsheetFullscreen(nextFullscreen);
                    if (nextFullscreen) {
                      setControleGeralOpen(true);
                    }
                  }}
                  title={
                    isSpreadsheetFullscreen
                      ? 'Sair do modo Tela Inteira (ou pressione ESC)'
                      : 'Expandir a planilha para Tela Inteira'
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                    isSpreadsheetFullscreen
                      ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 shadow-2xs'
                      : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900 shadow-2xs'
                  }`}
                >
                  {isSpreadsheetFullscreen ? (
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

            {(controleGeralOpen || isSpreadsheetFullscreen) && (
              <div
                className={
                  isSpreadsheetFullscreen ? 'flex-1 flex flex-col min-h-0 overflow-hidden' : ''
                }
              >
                {/* ===============================================================
                    2. FILTROS E PESQUISA EM PADRÃO "CONTROL BAR"
                    - Barra de Busca Unificada (aceita palavras-chave ou múltiplos códigos colados: SN-OI65J2 SN-OI65J4)
                    - Botão "+ Adicionar Filtro" com sistema de Chips editáveis ([ Status: Finalizada ✕ ] [ UF: DF ✕ ])
                    - Aba escondida "Demanda por Equipe / Dupla"
                   =============================================================== */}
                <div className="px-5 py-3 bg-[#F3F4F6]/80 border-b border-slate-200 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Unified Smart Search Bar */}
                    <div className="relative flex-1 min-w-full sm:min-w-[280px]">
                      <div className="flex items-center bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus-within:border-blue-600 transition-colors shadow-2xs">
                        <Search className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
                        <input
                          type="text"
                          value={searchTerm}
                          onFocus={() => setQuickDropdownOpen(true)}
                          onBlur={() => setTimeout(() => setQuickDropdownOpen(false), 180)}
                          onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setQuickSiteQuery(e.target.value);
                            setQuickDropdownOpen(true);
                          }}
                          placeholder="Busca inteligente: digite palavras-chave, Município, Dupla ou cole múltiplos códigos (ex: SN-OI65J2 SN-OI65J4)..."
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
                            onClick={() => {
                              setSearchTerm('');
                              setQuickSiteQuery('');
                            }}
                            className="text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer"
                            title="Limpar busca"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Instant Site Slide-over Launcher when typing 1 code */}
                      {quickDropdownOpen &&
                        searchTokens.length === 1 &&
                        quickSiteQuery.trim().length >= 2 &&
                        quickSiteMatches.length > 0 && (
                          <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50">
                            <div className="px-3.5 py-1.5 bg-[#F3F4F6] border-b border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
                              <span>Abrir Ficha Lateral (Drawer)</span>
                              <span className="font-mono">{quickSiteMatches.length} encontrados</span>
                            </div>
                            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                              {quickSiteMatches.map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  onMouseDown={() => {
                                    setSelectedSiteId(item.id);
                                    setQuickDropdownOpen(false);
                                  }}
                                  className="w-full px-3.5 py-2 text-left hover:bg-slate-50 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                                >
                                  <div className="min-w-0">
                                    <div className="text-xs font-mono font-bold text-slate-900 tabular-nums">
                                      {item.siteId}{' '}
                                      <span className="font-sans font-normal text-slate-500">
                                        · {getCellValueForColumn(item, 'END ID') || item.siteName}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-500 truncate">
                                      {item.municipio}/{item.uf} · Equipe:{' '}
                                      {getCellValueForColumn(item, 'EQUIPE EXECUTANTE') ||
                                        item.equipeParceira ||
                                        'Sem dupla'}{' '}
                                      · {item.status}
                                    </div>
                                  </div>
                                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>

                    {/* "+ Adicionar Filtro" Popover Trigger */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setIsAddFilterMenuOpen((prev) => !prev)}
                        className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      >
                        <Plus className="w-3.5 h-3.5 text-slate-500" />
                        <span>Adicionar Filtro</span>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      </button>

                      {isAddFilterMenuOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setIsAddFilterMenuOpen(false)}
                          />
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute left-0 top-full mt-1.5 w-[calc(100vw-2rem)] max-w-xs sm:w-80 bg-white border border-slate-200 rounded-xl shadow-xl p-3.5 z-50 space-y-3"
                          >
                            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                              <span className="text-xs font-bold text-slate-800">
                                Adicionar Filtro por Tag (Chip)
                              </span>
                              <button
                                type="button"
                                onClick={() => setIsAddFilterMenuOpen(false)}
                                className="text-slate-400 hover:text-slate-700 cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="space-y-2.5 text-xs">
                              <div>
                                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                  Visão / Categoria da Planilha
                                </label>
                                <select
                                  value={functionFilter}
                                  onChange={(e) => {
                                    setFunctionFilter(e.target.value as ControleGeralFunctionFilter);
                                    setIsAddFilterMenuOpen(false);
                                  }}
                                  className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                                >
                                  <option value="TODOS_GERAL">Todos Controle Geral ({rawControleGeralPool.length})</option>
                                  <option value="NOVOS">Sites Novos ({countNovos})</option>
                                  {effectiveRole !== 'Vistoriador' && (
                                    <option value="ENGENHARIA">Engenharia ({countEngenharia})</option>
                                  )}
                                  <option value="ABONO">Abono ({countAbono})</option>
                                  <option value="CANCELADOS">Cancelados ({rawCanceladosPool.length})</option>
                                  <option value="SEM_CHAVES_ACESSO">Sem Chaves / Sem Acesso ({countSemChaves})</option>
                                  <option value="FINALIZADAS">Vistorias Finalizadas ({countFinalizadas})</option>
                                  <option value="LIDERANCA_5G_ANF">Liderança 5G / ANF ({countLideranca5G})</option>
                                  {effectiveRole !== 'Vistoriador' && (
                                    <>
                                      <option value="FINANCEIRO">Financeiro / SPO / NF ({countFinanceiro})</option>
                                      <option value="EQUIPES">Equipes ({rawEquipesPool.length})</option>
                                    </>
                                  )}
                                </select>
                              </div>

                              <div>
                                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                  Status da Vistoria
                                </label>
                                <select
                                  value={statusFilter}
                                  onChange={(e) => {
                                    setStatusFilter(e.target.value);
                                    setIsAddFilterMenuOpen(false);
                                  }}
                                  className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                                >
                                  <option value="ALL">Todos os Status ({filterOptions.statuses.length})</option>
                                  {filterOptions.statuses.map((st) => (
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
                                      setIsAddFilterMenuOpen(false);
                                    }}
                                    className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                                  >
                                    <option value="ALL">Todas ({filterOptions.ufs.length})</option>
                                    {filterOptions.ufs.map((uf) => (
                                      <option key={uf} value={uf}>
                                        {uf}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                    Prioridade
                                  </label>
                                  <select
                                    value={prioridadeFilter}
                                    onChange={(e) => {
                                      setPrioridadeFilter(e.target.value);
                                      setIsAddFilterMenuOpen(false);
                                    }}
                                    className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                                  >
                                    <option value="ALL">Todas ({filterOptions.prioridades.length})</option>
                                    {filterOptions.prioridades.map((p) => (
                                      <option key={p} value={p}>
                                        {p}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              <div>
                                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                  Equipe Executante (Dupla)
                                </label>
                                <select
                                  value={equipeFilter}
                                  onChange={(e) => {
                                    setEquipeFilter(e.target.value);
                                    setIsAddFilterMenuOpen(false);
                                  }}
                                  className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                                >
                                  <option value="ALL">Todas as Duplas ({equipesDuplas.length})</option>
                                  {equipesDuplas.map((eq) => (
                                    <option key={eq} value={eq}>
                                      {eq}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                    Status Financeiro
                                  </label>
                                  <select
                                    value={financeiroFilter}
                                    onChange={(e) => {
                                      setFinanceiroFilter(e.target.value);
                                      setIsAddFilterMenuOpen(false);
                                    }}
                                    className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                                  >
                                    <option value="ALL">Todos</option>
                                    {filterOptions.financeiros.map((fin) => (
                                      <option key={fin} value={fin}>
                                        {fin}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                    Acesso / Chaves
                                  </label>
                                  <select
                                    value={acessoFilter}
                                    onChange={(e) => {
                                      setAcessoFilter(e.target.value);
                                      setIsAddFilterMenuOpen(false);
                                    }}
                                    className="w-full px-2.5 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                                  >
                                    <option value="ALL">Todos</option>
                                    {filterOptions.acessos.map((ac) => (
                                      <option key={ac} value={ac}>
                                        {ac}
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
                  </div>

                  {/* Dynamic Editable Filter Chips Row ([ Status: Finalizada ✕ ] [ UF: DF ✕ ]) */}
                  {(hasActiveFilter || searchTokens.length > 1) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-[11px] font-medium text-slate-500 mr-1">
                        Filtros ativos:
                      </span>

                      {functionFilter !== 'TODOS_GERAL' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                          <span className="text-slate-400">Visão:</span>
                          <span className="font-semibold">{functionFilter}</span>
                          <button
                            type="button"
                            onClick={() => setFunctionFilter('TODOS_GERAL')}
                            className="text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      )}

                      {statusFilter !== 'ALL' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                          <span className="text-slate-400">Status:</span>
                          <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="font-semibold bg-transparent focus:outline-none cursor-pointer"
                          >
                            {filterOptions.statuses.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setStatusFilter('ALL')}
                            className="text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      )}

                      {ufFilter !== 'ALL' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                          <span className="text-slate-400">UF:</span>
                          <select
                            value={ufFilter}
                            onChange={(e) => setUfFilter(e.target.value)}
                            className="font-semibold bg-transparent focus:outline-none cursor-pointer"
                          >
                            {filterOptions.ufs.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setUfFilter('ALL')}
                            className="text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      )}

                      {prioridadeFilter !== 'ALL' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                          <span className="text-slate-400">Prioridade:</span>
                          <span className="font-semibold">{prioridadeFilter}</span>
                          <button
                            type="button"
                            onClick={() => setPrioridadeFilter('ALL')}
                            className="text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      )}

                      {projetoFilter !== 'ALL' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                          <span className="text-slate-400">Projeto:</span>
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

                      {equipeFilter !== 'ALL' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                          <span className="text-slate-400">Equipe / Dupla:</span>
                          <select
                            value={equipeFilter}
                            onChange={(e) => setEquipeFilter(e.target.value)}
                            className="font-semibold bg-transparent focus:outline-none cursor-pointer"
                          >
                            {equipesDuplas.map((eq) => (
                              <option key={eq} value={eq}>
                                {eq}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setEquipeFilter('ALL')}
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

                      {responsavelDemandFilter !== 'ALL' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                          <span className="text-slate-400">Demanda:</span>
                          <span className="font-semibold">{responsavelDemandFilter}</span>
                          <button
                            type="button"
                            onClick={() => setResponsavelDemandFilter('ALL')}
                            className="text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      )}

                      {financeiroFilter !== 'ALL' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                          <span className="text-slate-400">Financeiro:</span>
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

                      {acessoFilter !== 'ALL' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-xs shadow-2xs">
                          <span className="text-slate-400">Acesso:</span>
                          <span className="font-semibold">{acessoFilter}</span>
                          <button
                            type="button"
                            onClick={() => setAcessoFilter('ALL')}
                            className="text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      )}

                      {/* Multi-code search tokens as removable chips */}
                      {searchTokens.length > 1 &&
                        searchTokens.slice(0, 15).map((token, idx) => (
                          <span
                            key={`${token}-${idx}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-[11px] font-mono shadow-2xs"
                          >
                            <span>{token}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const nextTokens = searchTokens.filter((_, i) => i !== idx);
                                const nextStr = nextTokens.join(' ');
                                setSearchTerm(nextStr);
                                setQuickSiteQuery(nextStr);
                              }}
                              className="text-slate-400 hover:text-red-600 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}

                      <button
                        type="button"
                        onClick={resetAllInternalFilters}
                        className="px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-900 underline cursor-pointer ml-1"
                      >
                        Limpar todos
                      </button>
                    </div>
                  )}
                </div>

                {/* Active Column Header Filters Strip */}
                {activeColumnFilterCount > 0 && (
                  <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-700">
                        Filtros de coluna:
                      </span>
                      {Object.entries(columnValueFilters).map(([colKey, vals]) => {
                        if (!vals || vals.length === 0) return null;
                        const labelMap: Record<string, string> = {
                          FLUID_SITE_ID: 'SITE ID',
                          FLUID_END_ID: 'END ID',
                          FLUID_PRIORIDADE: 'Função / Prioridade',
                          FLUID_OC_SITE_PRE: 'Oc Site Pre',
                          FLUID_SMP: 'SMP',
                          FLUID_UF_MUNICIPIO: 'UF / Município',
                          FLUID_PROJETO_ESCOPO: 'Projeto / Escopo',
                          FLUID_EQUIPE: 'Equipe Executante (Dupla)',
                          FLUID_SI_EXECUTED: 'SI Executed',
                          FLUID_STATUS: 'Status',
                          FLUID_STATUS_FINANCEIRO: 'Status Financeiro',
                          FLUID_ACESSO: 'Acesso / Chaves',
                          FLUID_OBS: 'Observações',
                        };
                        const friendlyCol = labelMap[colKey] || colKey;
                        return (
                          <span
                            key={colKey}
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-medium shadow-2xs"
                          >
                            <span className="text-slate-400">{friendlyCol}:</span>
                            <span className="font-mono text-[11px] max-w-[220px] truncate">
                              {vals.map((v) => v.replace(/^UF:/, 'UF ')).join(', ')}
                            </span>
                            <button
                              type="button"
                              onClick={() => clearSingleColumnFilter(colKey)}
                              className="text-slate-400 hover:text-red-600 cursor-pointer"
                              title={`Limpar filtro de ${friendlyCol}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => setColumnValueFilters({})}
                      className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-medium rounded-md transition-colors cursor-pointer"
                    >
                      Limpar colunas
                    </button>
                  </div>
                )}

                {/* Unified Data Table inside Pasta Controle Geral */}
                {functionFilter === 'EQUIPES' && folderViewMode === 'fluid' ? (
                  <div className="p-4 bg-slate-50/40">
                    <AdminAccessPanel
                      currentUser={user}
                      users={users}
                      onUsersUpdated={(nextUsers, toastMsg) => {
                        setUsers(nextUsers);
                        const updatedSelf = nextUsers.find(
                          (u) => u.email.toLowerCase() === user.email.toLowerCase()
                        );
                        if (updatedSelf) {
                          setUser(updatedSelf);
                          localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(updatedSelf));
                        }
                        if (toastMsg) showToast(toastMsg);
                      }}
                    />
                  </div>
                ) : (
                  renderFluidSitesTable(filteredControleGeralSites)
                )}
              </div>
            )}
            </div>
          </>
        )}

        {/* Floating Per-Column Filter Dropdown Menu ("tracinho para baixo" on every column) */}
        {openColFilterMenu &&
          (() => {
            const { colKey, colLabel, top, left } = openColFilterMenu;
            const selectedVals = columnValueFilters[colKey] || [];
            const valueCounts = new Map<string, number>();
            const ufCounts = new Map<string, number>();

            basePoolForFunction.forEach((s) => {
              const v = getSiteDisplayValueForColKey(s, colKey);
              valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
              if (colKey === 'FLUID_UF_MUNICIPIO') {
                const uf = (getCellValueForColumn(s, 'UF') || s.uf || '').trim().toUpperCase();
                if (uf) ufCounts.set(uf, (ufCounts.get(uf) || 0) + 1);
              }
            });

            const qCol = colMenuSearchText.trim().toLowerCase();
            const qColTokens = qCol
              ? qCol
                  .split(/[\s,;|\n\r\t]+/)
                  .map((t) => t.trim())
                  .filter(Boolean)
              : [];

            const sortedEntries = Array.from(valueCounts.entries())
              .filter(([val]) => {
                if (!qCol) return true;
                const vLower = val.toLowerCase();
                if (vLower.includes(qCol)) return true;
                if (qColTokens.length > 1) {
                  return qColTokens.some((tk) => vLower.includes(tk));
                }
                return false;
              })
              .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));

            const sortedUfs = Array.from(ufCounts.entries()).sort((a, b) =>
              a[0].localeCompare(b[0])
            );

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
                  {/* Popover Header */}
                  <div className="px-3.5 py-2.5 bg-slate-900 text-white flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                        Filtrar Coluna
                      </div>
                      <div className="text-xs font-bold truncate">{colLabel}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {selectedVals.length > 0 && (
                        <button
                          type="button"
                          onClick={() => clearSingleColumnFilter(colKey)}
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

                  {/* Search inside Column Values */}
                  <div className="p-2.5 bg-slate-50 border-b border-slate-200 space-y-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                      <input
                        type="text"
                        autoFocus
                        value={colMenuSearchText}
                        onChange={(e) => setColMenuSearchText(e.target.value)}
                        placeholder={`Buscar em ${colLabel}...`}
                        className="w-full pl-8 pr-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          const visibleValues = sortedEntries.map(([v]) => v);
                          setColumnValueFilters((prev) => ({
                            ...prev,
                            [colKey]: visibleValues,
                          }));
                        }}
                        className="text-blue-600 hover:underline font-semibold cursor-pointer"
                      >
                        Marcar visíveis ({sortedEntries.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => clearSingleColumnFilter(colKey)}
                        className="text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                      >
                        Mostrar Todos
                      </button>
                    </div>

                    {/* Quick UF chips when filtering UF / Município */}
                    {colKey === 'FLUID_UF_MUNICIPIO' && sortedUfs.length > 0 && (
                      <div className="pt-1 border-t border-slate-200/80">
                        <div className="text-[10px] font-semibold text-slate-500 mb-1">
                          Filtrar rápido por UF:
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {sortedUfs.map(([ufCode, count]) => {
                            const ufToken = `UF:${ufCode}`;
                            const active = selectedVals.includes(ufToken);
                            return (
                              <button
                                key={ufCode}
                                type="button"
                                onClick={() => toggleColumnFilterValue(colKey, ufToken)}
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                                  active
                                    ? 'bg-blue-600 border-blue-600 text-white'
                                    : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                                }`}
                              >
                                {ufCode} ({count})
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Scrollable Checklist of Column Values */}
                  <div className="overflow-y-auto flex-1 divide-y divide-slate-100 p-1">
                    {sortedEntries.map(([val, count]) => {
                      const isChecked = selectedVals.includes(val);
                      return (
                        <label
                          key={val}
                          className={`px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors ${
                            isChecked ? 'bg-blue-50/90 text-blue-900 font-semibold' : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleColumnFilterValue(colKey, val)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                            <span className="truncate" title={val}>
                              {val}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400 shrink-0 tabular-nums">
                            ({count})
                          </span>
                        </label>
                      );
                    })}

                    {sortedEntries.length === 0 && (
                      <div className="py-6 text-center text-xs text-slate-400">
                        Nenhum valor encontrado nesta coluna.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

        {/* -------------------------------------------------------------------
            TAB 2: ENGENHARIA — PLANILHA CONTROLE DE ENGENHARIA (ABA TSSR TIM NOKIA)
            (Exclusivo para ADM e Executor — Vistoriador NÃO tem acesso à pasta de Engenharia)
           ------------------------------------------------------------------- */}
        {activeVendor === 'NOKIA' &&
          resolvedTopTab === 'engenharia' &&
          canSeeEngenhariaTab && (
          <EngineeringControlTab
            user={user}
            effectiveRole={effectiveRole}
            simulatedTargetUser={simulatedTargetUser}
            onToggleSimulateUser={(target) => setSimulatedTargetUser(target)}
            users={users}
            activeVendor={activeVendor}
            onSwitchVendor={handleSwitchVendor}
            folders={engineeringFolders}
            files={engineeringFiles}
            sites={vendorSites}
            onFoldersAndFilesUpdated={(nextFolders, nextFiles, toastMsg, nextTssrRows, nextTssrSheets) => {
              setEngineeringFolders(nextFolders);
              setEngineeringFiles(nextFiles);
              if (Array.isArray(nextTssrRows)) setTssrRows(nextTssrRows);
              if (Array.isArray(nextTssrSheets)) setTssrSheets(nextTssrSheets);
              if (toastMsg) showToast(toastMsg);
            }}
            onSelectSiteId={(id) => setSelectedSiteId(id)}
            tssrRows={tssrRows}
            tssrSheets={tssrSheets}
            onTssrUpdated={(nextRows, nextSheets, toastMsg) => {
              setTssrRows(nextRows);
              if (Array.isArray(nextSheets)) setTssrSheets(nextSheets);
              if (toastMsg) showToast(toastMsg);
            }}
            onNavigateToVistoria={(siteId) => {
              if (siteId) setVistoriaPreselectedSiteId(siteId);
              setActiveTopTab('vistoria');
            }}
          />
        )}

        {/* -------------------------------------------------------------------
            TAB 3: VISTORIA (ITEM SEPARADO NA BARRA SUPERIOR — ENVIO COM VÍNCULO AO SITE TSSR)
           ------------------------------------------------------------------- */}
        {activeVendor === 'NOKIA' && resolvedTopTab === 'vistoria' && (
          <EngineeringVistoriasTab
            user={user}
            effectiveRole={effectiveRole}
            simulatedTargetUser={simulatedTargetUser}
            onToggleSimulateUser={(target) => setSimulatedTargetUser(target)}
            users={users}
            activeVendor={activeVendor}
            folders={engineeringFolders}
            files={engineeringFiles}
            sites={vendorSites}
            tssrRows={tssrRows}
            preselectedSiteId={vistoriaPreselectedSiteId}
            onClearPreselectedSiteId={() => setVistoriaPreselectedSiteId(null)}
            onFoldersAndFilesUpdated={(nextFolders, nextFiles, toastMsg, nextTssrRows, nextTssrSheets) => {
              setEngineeringFolders(nextFolders);
              setEngineeringFiles(nextFiles);
              if (Array.isArray(nextTssrRows)) setTssrRows(nextTssrRows);
              if (Array.isArray(nextTssrSheets)) setTssrSheets(nextTssrSheets);
              if (toastMsg) showToast(toastMsg);
            }}
            onSelectSiteId={(id) => setSelectedSiteId(id)}
            onOpenTssrTab={
              canSeeEngenhariaTab ? () => setActiveTopTab('engenharia') : undefined
            }
          />
        )}

        {/* -------------------------------------------------------------------
            ABAS INDIVIDUAIS DO MENU RA (MESMAS REGRAS EM NOKIA E ERICSSON)
           ------------------------------------------------------------------- */}
        {isRealAdmin &&
          resolvedTopTab !== 'sites' &&
          resolvedTopTab !== 'engenharia' &&
          resolvedTopTab !== 'vistoria' && (
            <div className="space-y-4">
              {/* Compact Tab Bar for the Opened RA Function */}
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">
                    Abas do RA ({activeVendor === 'ERICSSON' ? 'Ericsson' : 'TIM / Nokia'}):
                  </span>
                  {(
                    [
                      { id: 'duplas', label: 'Duplas & Demanda' },
                      { id: 'perfis', label: 'Perfis & Acessos' },
                      ...(activeVendor === 'NOKIA'
                        ? [
                            { id: 'novo_site' as const, label: '+ Novo Site' },
                            { id: 'importar' as const, label: 'Importar / OneDrive' },
                            { id: 'colar' as const, label: 'Colar Ctrl+V' },
                            { id: 'exportar' as const, label: 'Exportar Planilha' },
                          ]
                        : []),
                      ...(isOwnerAdm
                        ? ([{ id: 'simular' as const, label: 'Ver como (Simular)' }] as const)
                        : []),
                    ] as const
                  ).map((tabItem) => (
                    <button
                      key={tabItem.id}
                      type="button"
                      onClick={() => {
                        if (tabItem.id === 'importar') setBulkInitialTab('onedrive');
                        if (tabItem.id === 'colar') {
                          setPastedShortcutText('');
                          setBulkInitialTab('paste');
                        }
                        setActiveTopTab(tabItem.id);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        resolvedTopTab === tabItem.id
                          ? 'bg-slate-900 text-white font-semibold'
                          : 'bg-[#F3F4F6] hover:bg-slate-200 text-slate-600'
                      }`}
                    >
                      {tabItem.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTopTab('sites')}
                  className="px-3 py-1 bg-[#F3F4F6] hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Fechar Aba</span>
                </button>
              </div>

              {/* ABA 0 DO RA: DUPLAS & DEMANDA (SISTEMA IGUAL EM NOKIA E EM ERICSSON, MUDANDO APENAS AS INFORMAÇÕES DA PLATAFORMA ATIVA) */}
              {resolvedTopTab === 'duplas' && (
                <DuplasInteractiveView
                  sites={sites}
                  ericssonRows={ericssonRows}
                  users={users}
                  ericssonUsers={ericssonUsers}
                  serverDuplaEmailsMap={serverDuplaEmailsMap}
                  activeVendor={activeVendor}
                  equipesDuplas={equipesDuplas}
                  onAddDupla={(name) => {
                    const clean = name.trim();
                    if (!clean) return;
                    if (!customDuplas.some((d) => d.toLowerCase() === clean.toLowerCase())) {
                      saveCustomDuplas([clean, ...customDuplas]);
                    }
                    showToast(
                      `Dupla "${clean}" criada no sistema ${
                        activeVendor === 'ERICSSON' ? 'Ericsson' : 'TIM / Nokia'
                      }!`
                    );
                  }}
                  onRenameDupla={async (oldName, newName) => {
                    const clean = newName.trim();
                    if (!clean || clean === oldName) return;
                    const nextList = customDuplas.map((d) => (d === oldName ? clean : d));
                    if (!nextList.includes(clean)) nextList.unshift(clean);
                    saveCustomDuplas(nextList);
                    try {
                      const res = await fetch('/api/sites/assign-responsible', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          renameFrom: oldName,
                          renameTo: clean,
                        }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        if (Array.isArray(data.sites)) setSites(data.sites);
                        if (Array.isArray(data.ericssonRows)) setEricssonRows(data.ericssonRows);
                        if (Array.isArray(data.users)) setUsers(data.users);
                        if (Array.isArray(data.ericssonUsers)) setEricssonUsers(data.ericssonUsers);
                      }
                    } catch {
                      // ignore offline error
                    }
                    showToast(`Dupla renomeada de "${oldName}" para "${clean}".`);
                  }}
                  onDeleteDupla={(name) => handleDeleteDupla(name)}
                  onAssignSitesToDupla={async (siteIds, duplaName, linkedEmails, targetVendor) => {
                    const res = await fetch('/api/sites/assign-responsible', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        siteTokens: siteIds,
                        responsibleName: duplaName,
                        linkedEmails,
                        vendor: targetVendor,
                      }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      if (Array.isArray(data.sites)) setSites(data.sites);
                      if (Array.isArray(data.ericssonRows)) setEricssonRows(data.ericssonRows);
                      if (Array.isArray(data.users)) setUsers(data.users);
                      if (Array.isArray(data.ericssonUsers)) setEricssonUsers(data.ericssonUsers);
                      if (Array.isArray(data.notifications)) setNotifications(data.notifications);
                      showToast(
                        `${data.updatedCount || siteIds.length} site(s) ${
                          targetVendor === 'ERICSSON' ? 'Ericsson' : 'TIM/Nokia'
                        } enviados para a dupla "${duplaName}"!`
                      );
                    }
                  }}
                  onUnassignSitesFromDupla={async (siteIds, duplaName, targetVendor) => {
                    const tokenSet = new Set(
                      siteIds.map((t) => String(t || '').trim().toUpperCase()).filter(Boolean)
                    );
                    if (targetVendor === 'ERICSSON') {
                      setEricssonRows((prev) =>
                        prev.map((r) => {
                          if (!tokenSet.has(r.id.toUpperCase())) return r;
                          return {
                            ...r,
                            equipe: '',
                            fields: {
                              ...(r.fields || {}),
                              EQUIPE: '',
                              'E-MAIL DUPLA': '',
                            },
                          };
                        })
                      );
                    } else {
                      setSites((prev) =>
                        prev.map((s) => {
                          if (s.vendor !== targetVendor) return s;
                          if (
                            !tokenSet.has(s.id.toUpperCase()) &&
                            !tokenSet.has(s.siteId.trim().toUpperCase())
                          ) {
                            return s;
                          }
                          return {
                            ...s,
                            equipeParceira: '',
                            responsavelCampo: '',
                            customFields: {
                              ...(s.customFields || {}),
                              'EQUIPE EXECUTANTE': '',
                              Executor: '',
                              Responsável: '',
                              'E-MAIL DUPLA': '',
                            },
                          };
                        })
                      );
                    }
                    const res = await fetch('/api/sites/assign-responsible', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        unassignSiteTokens: siteIds,
                        vendor: targetVendor,
                      }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      if (Array.isArray(data.sites)) setSites(data.sites);
                      if (Array.isArray(data.ericssonRows)) setEricssonRows(data.ericssonRows);
                      showToast(
                        `Site ${
                          targetVendor === 'ERICSSON' ? 'Ericsson' : 'TIM/Nokia'
                        } removido da demanda de "${duplaName}".`
                      );
                    }
                  }}
                  onClearDuplaSites={async (duplaName, siteIdsToClear, targetVendor) => {
                    const res = await fetch('/api/sites/assign-responsible', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        clearAllForResponsible: duplaName,
                        unassignSiteTokens: siteIdsToClear,
                        vendor: targetVendor,
                      }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      if (Array.isArray(data.sites)) setSites(data.sites);
                      if (Array.isArray(data.ericssonRows)) setEricssonRows(data.ericssonRows);
                      showToast(
                        `Todos os sites ${
                          targetVendor === 'ERICSSON' ? 'Ericsson' : 'TIM/Nokia'
                        } de "${duplaName}" foram desvinculados.`
                      );
                    }
                  }}
                  onLinkEmailsToDupla={async (duplaName, emails) => {
                    try {
                      const res = await fetch('/api/admin/duplas/link-email', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          duplaName,
                          emails,
                        }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        if (Array.isArray(data.users)) setUsers(data.users);
                        if (Array.isArray(data.ericssonUsers)) setEricssonUsers(data.ericssonUsers);
                        if (data.duplaEmailsMap && typeof data.duplaEmailsMap === 'object') {
                          setServerDuplaEmailsMap(data.duplaEmailsMap);
                        }
                        if (Array.isArray(data.sites)) setSites(data.sites);
                        if (Array.isArray(data.ericssonRows)) setEricssonRows(data.ericssonRows);
                        showToast(
                          `E-mail(s) de perfil vinculado(s) à dupla "${duplaName}" com sucesso!`
                        );
                      }
                    } catch {
                      // ignore offline error
                    }
                  }}
                  onSimulateDuplaView={
                    isOwnerAdm
                      ? (targetUser, targetVendor) => {
                          setActiveVendor(targetVendor);
                          setSimulatedTargetUser(targetUser);
                          setActiveTopTab('sites');
                          showToast(
                            `Visualizando ${
                              targetVendor === 'ERICSSON' ? 'Ericsson' : 'TIM/Nokia'
                            } como "${targetUser.name}" (${targetUser.email})`
                          );
                        }
                      : undefined
                  }
                  onOpenSiteDrawer={(id) => setSelectedSiteId(id)}
                />
              )}

              {/* ABA 1 DO RA: PERFIS & ACESSOS */}
              {resolvedTopTab === 'perfis' && (
                <AdminAccessPanel
                  currentUser={user}
                  users={users}
                  initialExpandedUserId={initialExpandedUserId}
                  onTestUserView={
                    isOwnerAdm
                      ? (targetUser) => {
                          setSimulatedTargetUser(targetUser);
                          setActiveTopTab('sites');
                          showToast(`Visualizando sistema como "${targetUser.name}"`);
                        }
                      : undefined
                  }
                  onUsersUpdated={(nextUsers, toastMsg) => {
                    setUsers(nextUsers);
                    const updatedSelf = nextUsers.find(
                      (u) => u.email.toLowerCase() === user.email.toLowerCase()
                    );
                    if (updatedSelf) {
                      setUser(updatedSelf);
                      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(updatedSelf));
                    }
                    if (toastMsg) showToast(toastMsg);
                  }}
                />
              )}

              {/* ABA 2 DO RA: + NOVO SITE */}
              {resolvedTopTab === 'novo_site' && (
                <NewSiteModal
                  isOpen={true}
                  inlineTabMode={true}
                  activeVendor={activeVendor}
                  activeSheetName={activeSheetName === 'ALL' ? 'Controle Geral' : activeSheetName}
                  sheets={sheets}
                  users={users}
                  onClose={() => setActiveTopTab('sites')}
                  onCreateSite={async (siteData) => {
                    await handleCreateSite(siteData);
                    setActiveTopTab('sites');
                  }}
                />
              )}

              {/* ABA 3 DO RA: IMPORTAR / ONEDRIVE */}
              {resolvedTopTab === 'importar' && (
                <BulkPasteModal
                  isOpen={true}
                  inlineTabMode={true}
                  initialTab="onedrive"
                  activeVendor={activeVendor}
                  activeSheetName={activeSheetName === 'ALL' ? 'Controle Geral' : activeSheetName}
                  sheets={sheets}
                  initialPastedText=""
                  onClose={() => setActiveTopTab('sites')}
                  onBulkImport={async (params) => {
                    await handleBulkImport(params);
                    setActiveTopTab('sites');
                  }}
                />
              )}

              {/* ABA 4 DO RA: COLAR CTRL+V */}
              {resolvedTopTab === 'colar' && (
                <BulkPasteModal
                  isOpen={true}
                  inlineTabMode={true}
                  initialTab="paste"
                  activeVendor={activeVendor}
                  activeSheetName={activeSheetName === 'ALL' ? 'Controle Geral' : activeSheetName}
                  sheets={sheets}
                  initialPastedText={pastedShortcutText}
                  onClose={() => setActiveTopTab('sites')}
                  onBulkImport={async (params) => {
                    await handleBulkImport(params);
                    setActiveTopTab('sites');
                  }}
                />
              )}

              {/* ABA 5 DO RA: EXPORTAR PLANILHA (.XLSX / .CSV) */}
              {resolvedTopTab === 'exportar' && (
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Exportar Planilha ({activeVendor})
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Escolha o formato para baixar os dados da planilha Controle Geral ({orderedSheetColumns.length} colunas).
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        exportSitesToXlsx(
                          filteredControleGeralSites,
                          `${activeVendor}_Controle_Geral_${new Date().toISOString().slice(0, 10)}.xlsx`,
                          'Controle Geral',
                          orderedSheetColumns
                        )
                      }
                      className="p-4 rounded-xl bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 text-left flex items-center justify-between cursor-pointer transition-colors"
                    >
                      <div>
                        <div className="text-xs font-bold text-emerald-950">
                          Baixar Planilha Excel (.XLSX)
                        </div>
                        <div className="text-[11px] text-emerald-700 mt-0.5">
                          {filteredControleGeralSites.length} site(s) · Formato Excel original
                        </div>
                      </div>
                      <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        exportSitesToCsv(
                          filteredControleGeralSites,
                          `${activeVendor}_Controle_Geral_${new Date().toISOString().slice(0, 10)}.csv`,
                          orderedSheetColumns
                        )
                      }
                      className="p-4 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left flex items-center justify-between cursor-pointer transition-colors"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900">
                          Baixar Arquivo CSV (.CSV)
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {filteredControleGeralSites.length} site(s) · Separado por ponto e vírgula
                        </div>
                      </div>
                      <Download className="w-5 h-5 text-slate-600 shrink-0" />
                    </button>
                  </div>
                </div>
              )}

              {/* ABA 6 DO RA: SIMULAR VISÃO DE PERFIL / DUPLA ("VER COMO APARECE PARA ELES") */}
              {resolvedTopTab === 'simular' && (
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Simular Visão de Perfil / Dupla (Ver como aparece para eles)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Selecione um usuário ou dupla abaixo para visualizar exatamente a planilha e documentos que aparecem no perfil dele.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {assignableUsersList.map((u) => {
                      const countSites = allVendorControleGeralSites.filter((s) =>
                        doesSiteMatchResponsible(s, u)
                      ).length;
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setSimulatedTargetUser(u);
                            setActiveTopTab('sites');
                            showToast(`Visualizando como "${u.name}" (${u.email})`);
                          }}
                          className="p-3.5 rounded-xl bg-[#F3F4F6] hover:bg-blue-50 border border-slate-200 hover:border-blue-300 text-left flex items-center justify-between gap-2 cursor-pointer transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 truncate">
                              {u.name}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono truncate">
                              {u.email}
                            </div>
                            {u.equipe && (
                              <div className="text-[10px] text-blue-700 font-semibold mt-0.5 truncate">
                                Dupla: {u.equipe}
                              </div>
                            )}
                          </div>
                          <span className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-mono font-bold text-slate-700 shrink-0">
                            {countSites} sites
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
      </main>

      {/* Subtle Footer */}
      <footer className="py-3 px-6 text-center text-[11px] text-slate-400 border-t border-slate-200/80 bg-white">
        Ameta Telecom · Portal de Engenharia e Controle de Sites ({activeVendor}) · Sincronizado às{' '}
        {new Date(lastSyncTime).toLocaleTimeString('pt-BR')}
      </footer>

      {/* =====================================================================
          4. DRAWER LATERAL (SLIDE-OVER PANEL) EM VEZ DE MODAL CENTRO
         ===================================================================== */}
      <SiteDetailDrawer
        site={selectedSite}
        isAdmin={effectiveRole === 'ADM'}
        userRole={effectiveRole}
        duplasList={equipesDuplas}
        onOpenManageDuplas={() => setIsEditDuplasModalOpen(true)}
        sheetColumns={
          selectedSite?.sheetName === 'Controle Cancelados'
            ? CONTROLE_CANCELADOS_COLUMNS
            : selectedSite?.sheetName === 'Equipes'
            ? EQUIPES_COLUMNS
            : orderedSheetColumns
        }
        onClose={() => setSelectedSiteId(null)}
        onSaveSite={handleSaveSite}
        onDeleteSite={handleDeleteSite}
      />

      {/* Modal para Sempre Editar as Duplas da Equipe Executante */}
      {isEditDuplasModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => {
            setIsEditDuplasModalOpen(false);
            setEditingDuplaTarget(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" />
                <div>
                  <h3 className="text-xs font-bold">
                    Gerenciar e Editar Duplas (Equipe Executante)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Adicione novas duplas, edite os nomes das duplas ou remova duplas da lista
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditDuplasModalOpen(false);
                  setEditingDuplaTarget(null);
                }}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-[#F3F4F6] border-b border-slate-200 flex items-center gap-2">
              <input
                type="text"
                value={newDuplaInput}
                onChange={(e) => setNewDuplaInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddDupla();
                  }
                }}
                placeholder="Nova dupla (ex: Carlos / Eduardo ou Magno / Mateus)..."
                className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
              />
              <button
                type="button"
                onClick={handleAddDupla}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Adicionar Dupla</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-3 space-y-1">
              {equipesDuplas.map((dupla) => {
                const countSites = allVendorControleGeralSites.filter((s) =>
                  doesSiteMatchResponsible(s, dupla)
                ).length;
                const isEditingThis = editingDuplaTarget === dupla;

                return (
                  <div
                    key={dupla}
                    className="px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-2"
                  >
                    {isEditingThis ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="text"
                          autoFocus
                          value={editingDuplaValue}
                          onChange={(e) => setEditingDuplaValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSaveEditDupla(dupla);
                            } else if (e.key === 'Escape') {
                              setEditingDuplaTarget(null);
                            }
                          }}
                          className="flex-1 px-2.5 py-1 bg-white border border-blue-600 rounded-md text-xs font-semibold text-slate-900 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveEditDupla(dupla)}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md cursor-pointer"
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingDuplaTarget(null)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-md cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 min-w-0">
                          <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="text-xs font-medium text-slate-800 truncate">
                            {dupla}
                          </span>
                          <span className="px-1.5 py-0.5 bg-[#F3F4F6] border border-slate-200 rounded text-[10px] font-mono text-slate-500">
                            {countSites} site{countSites !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDuplaTarget(dupla);
                              setEditingDuplaValue(dupla);
                            }}
                            className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-md flex items-center gap-1 cursor-pointer"
                            title="Editar nome da dupla"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDupla(dupla)}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                            title="Remover dupla da lista"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="px-5 py-3 bg-[#F3F4F6] border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-500">
                Total: <strong>{equipesDuplas.length} duplas</strong> disponíveis
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsEditDuplasModalOpen(false);
                  setEditingDuplaTarget(null);
                }}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg cursor-pointer"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Paste (Ctrl+C / Ctrl+V), OneDrive & Excel Import Modal */}
      <BulkPasteModal
        isOpen={bulkModalOpen}
        initialTab={bulkInitialTab}
        activeVendor={activeVendor}
        activeSheetName={activeSheetName === 'ALL' ? 'Controle Geral' : activeSheetName}
        sheets={sheets}
        initialPastedText={pastedShortcutText}
        onClose={() => {
          setBulkModalOpen(false);
          setPastedShortcutText('');
        }}
        onBulkImport={handleBulkImport}
      />

      {/* Single New Site Modal */}
      <NewSiteModal
        isOpen={newSiteModalOpen}
        activeVendor={activeVendor}
        activeSheetName={activeSheetName === 'ALL' ? 'Controle Geral' : activeSheetName}
        sheets={sheets}
        users={users}
        onClose={() => setNewSiteModalOpen(false)}
        onCreateSite={handleCreateSite}
      />

      {/* Exclusive ADM Dono Permissions & Role Release Modal */}
      <OwnerPermissionsModal
        isOpen={ownerPermissionsModalOpen}
        onClose={() => setOwnerPermissionsModalOpen(false)}
        ownerUser={user}
        nokiaUsers={users}
        ericssonUsers={ericssonUsers}
        availableNokiaEquipes={equipesDuplas}
        availableEricssonEquipes={Array.from(
          new Set(
            ericssonRows
              .map((r) => (r.equipe || r.fields?.['EQUIPE'] || '').trim())
              .filter(Boolean)
          )
        )}
        onPermissionsUpdated={(nextNokia, nextEricsson, nextNotifs, toastMsg) => {
          setUsers(nextNokia);
          setEricssonUsers(nextEricsson);
          setNotifications(nextNotifs);
          if (toastMsg) showToast(toastMsg);
        }}
        onSimulateUser={(simUser) => {
          setSimulatedTargetUser(simUser);
          if (simUser.assignedPlatform === 'ERICSSON') {
            setActiveVendor('ERICSSON');
          } else if (simUser.assignedPlatform === 'NOKIA') {
            setActiveVendor('NOKIA');
          }
          if (simUser.role === 'Coordenador Engenharia') {
            setActiveTopTab('engenharia');
          } else {
            setActiveTopTab('sites');
          }
          showToast(`Simulando visão de ${simUser.name} (${simUser.role})`);
        }}
      />

      {/* Mobile Bottom Quick Navigation Bar */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-1.5 py-1.5 flex items-center justify-around shadow-lg">
        {canSeeSitesTab && (
          <button
            type="button"
            onClick={() => setActiveTopTab('sites')}
            className={`flex-1 py-1 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors cursor-pointer ${
              resolvedTopTab === 'sites'
                ? 'text-[#223585] bg-[#223585]/10'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <FolderKanban className="w-4 h-4" />
            <span className="truncate max-w-[72px]">Sites</span>
          </button>
        )}

        {canSeeEngenhariaTab && (
          <button
            type="button"
            onClick={() => setActiveTopTab('engenharia')}
            className={`flex-1 py-1 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors cursor-pointer ${
              resolvedTopTab === 'engenharia'
                ? 'text-[#1E8E8D] bg-[#1E8E8D]/10'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span className="truncate max-w-[72px]">Engenharia</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTopTab('vistoria')}
          className={`flex-1 py-1 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors cursor-pointer ${
            resolvedTopTab === 'vistoria'
              ? 'text-blue-700 bg-blue-600/10'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <FolderOpen className="w-4 h-4" />
          <span className="truncate max-w-[80px]">
            {effectiveRole === 'Executor' ? 'Subir TSSR' : 'Vistoria'}
          </span>
        </button>

        {isRealAdmin && !simulatedTargetUser && (
          <button
            type="button"
            onClick={() => setActiveTopTab('duplas')}
            className={`flex-1 py-1 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors cursor-pointer ${
              resolvedTopTab === 'duplas'
                ? 'text-white bg-slate-900'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span className="truncate max-w-[72px]">Duplas</span>
          </button>
        )}

        {isRealAdmin && (
          <button
            type="button"
            onClick={() => setIsRaMenuOpen((prev) => !prev)}
            className={`flex-1 py-1 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors cursor-pointer ${
              isRaMenuOpen
                ? 'text-amber-700 bg-amber-100'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span className="truncate max-w-[72px]">Menu RA</span>
          </button>
        )}
      </nav>
    </div>
  );
}
