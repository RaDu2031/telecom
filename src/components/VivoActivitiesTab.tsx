import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  History,
  Layers,
  ListPlus,
  Loader2,
  MapPin,
  Receipt,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  X,
  Check,
  Edit3,
  Eye,
  Calendar,
  Plus,
} from 'lucide-react';
import {
  AmetaUser,
  UserRole,
  VIVO_DOC_COLUMNS,
  VIVO_SUMMARY_COLUMNS,
  VivoActivityRow,
  VivoHistoryEntry,
  VivoSheetMeta,
  hasFullSpreadsheetAccess,
  isOwnerAdmUser,
  isUserDono,
} from '../types/telecom';
import {
  VivoStatusGroup,
  buildVivoRowsFromMatrix,
  classifyVivoStatus,
  computeVivoDashboardMetrics,
  exportVivoRowsToXlsx,
  hasVivoRevision,
  isVivoFaturado,
  parseCsvMatrix,
  parseVivoSpreadsheetFile,
  ParsedVivoImportResult,
} from '../utils/vivoSpreadsheetUtils';
import { dataService } from '../services/dataService';
import {
  VIVO_SHEET_ENTRY_CONFIG,
  VIVO_TIPO_DOC_OPTIONS,
  appendHistoryEntries,
  brDateToIsoInput,
  buildNewVivoActivityRow,
  buildSingleFieldUpdatePatch,
  extractDynamicFieldOptions,
  filterEligibleExecutorUsers,
  findSiteAutofillData,
  isExecutorOwnerOfRow,
  normalizeDateValueToBr,
} from '../config/sheetEntryConfig';
import {
  NovoRegistroModal,
  NovoRegistroPayload,
} from './entry/NovoRegistroModal';
import {
  EntradaRapidaModal,
  EntradaRapidaSubmitPayload,
} from './entry/EntradaRapidaModal';
import {
  AlterarCampoModal,
  AlterarCampoSubmitPayload,
} from './entry/AlterarCampoModal';

interface VivoActivitiesTabProps {
  user: AmetaUser;
  effectiveRole: UserRole;
  firestoreRows: VivoActivityRow[];
  sheetMeta: VivoSheetMeta | null;
  users?: AmetaUser[];
  onShowToast: (msg: string) => void;
}

type AnalyticsSubTab = 'status' | 'executors' | 'weeks' | 'regional';
type TableViewMode = 'resumo' | 'completa';
type DensityMode = 'confortavel' | 'compacto';
type DrawerTab = 'detalhes' | 'historico';
type CargaInicialTab = 'arquivo' | 'colar';

const STATUS_BADGE_STYLES: Record<
  VivoStatusGroup,
  { bg: string; text: string; dot: string; border: string }
> = {
  finalizado: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200',
  },
  aguardando_aprovacao: {
    bg: 'bg-violet-50',
    text: 'text-violet-700',
    dot: 'bg-violet-500',
    border: 'border-violet-200',
  },
  em_producao: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    dot: 'bg-blue-500',
    border: 'border-blue-200',
  },
  pendente: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    border: 'border-amber-200',
  },
  cancelada: {
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    dot: 'bg-rose-500',
    border: 'border-rose-200',
  },
  outros: {
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    dot: 'bg-slate-400',
    border: 'border-slate-200',
  },
};

const INLINE_COLUMN_TO_FIELD_KEY: Record<string, string> = {
  Status: 'status',
  'Tipo doc': 'tipoDoc',
  Regional: 'regional',
  Prioridade: 'prioridade',
  Planejado: 'planejado',
  Entregue: 'entregue',
  REPLAN: 'replan',
  'DATA REPLAN': 'dataReplan',
  'Comentário STATUS': 'comentarioStatus',
  EXECUTOR: 'executor',
};

const DATE_INLINE_COLUMNS = new Set(['Planejado', 'Entregue', 'REPLAN', 'DATA REPLAN']);
const LIST_INLINE_COLUMNS = new Set(['Status', 'Tipo doc', 'Regional', 'Prioridade']);

function formatErrorReason(err: any): string {
  if (!err) return 'erro desconhecido';
  const code = err?.code ? `[${err.code}] ` : '';
  const msg = err?.message || String(err);
  return `${code}${msg}`;
}

function formatHistoryDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
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

function getFieldVal(row: VivoActivityRow, col: string): string {
  if (col === '00.02.Site Name') return row.siteName || row.fields?.[col] || '';
  if (col === 'ID Register') return row.idRegister || row.fields?.[col] || '';
  if (col === 'Regional') return row.regional || row.fields?.[col] || '';
  if (col === 'Tipo doc') return row.tipoDoc || row.fields?.[col] || '';
  if (col === 'Status') return row.status || row.fields?.[col] || '';
  if (col === 'Comentário STATUS') return row.comentarioStatus || row.fields?.[col] || '';
  if (col === 'Prioridade') return row.prioridade || row.fields?.[col] || '';
  if (col === 'Demanda') return row.demanda || row.fields?.[col] || '';
  if (col === 'Planejado') return row.planejado || row.fields?.[col] || '';
  if (col === 'REPLAN') return row.replan || row.fields?.[col] || '';
  if (col === 'DATA REPLAN') return row.dataReplan || row.fields?.[col] || '';
  if (col === 'Entregue') return row.entregue || row.fields?.[col] || '';
  if (col === 'EXECUTOR') return row.executor || row.fields?.[col] || '';
  if (col === 'SLA DOC') return row.slaDoc || row.fields?.[col] || '';
  if (col === 'Entregue Week') return row.entregueWeek || row.fields?.[col] || '';
  if (col === 'Ofensor') return row.ofensor || row.fields?.[col] || '';
  if (col === 'FATURAMENTO') return row.faturamento || row.fields?.[col] || '';
  return row.fields?.[col] || '';
}

export const VivoActivitiesTab: React.FC<VivoActivitiesTabProps> = ({
  user,
  effectiveRole,
  firestoreRows,
  sheetMeta,
  users = [],
  onShowToast,
}) => {
  // Permissions:
  // - ADM and Dono: full access + "Carga inicial" (file import & paste)
  // - Coordenadores: create (+ Novo registro, Adicionar vários), inline edit all fields, bulk Alterar campo, delete single row
  // - Executor: inline edit ONLY Status and Comentário STATUS on their own rows
  const isAdminOrOwner =
    isOwnerAdmUser(user?.email, user?.situacao) ||
    isUserDono(user) ||
    effectiveRole === 'ADM';
  const canManage = hasFullSpreadsheetAccess(effectiveRole);
  const isExecutorRole = effectiveRole === 'Executor';

  const actorName = (user?.name || user?.email || 'Usuário').trim();
  const actorEmail = (user?.email || '').trim().toLowerCase();

  // Single source of truth: Firestore rows only (no browser-only storage)
  const rows: VivoActivityRow[] = useMemo(() => {
    return [...(firestoreRows || [])].sort(
      (a, b) => (a.rowNumberInFile ?? 999999) - (b.rowNumberInFile ?? 999999)
    );
  }, [firestoreRows]);

  const executorUsers = useMemo(() => filterEligibleExecutorUsers(users), [users]);

  // Dynamic options extracted from existing rows for inline cell dropdowns
  const statusOptions = useMemo(
    () =>
      extractDynamicFieldOptions(
        rows,
        'status',
        'Status',
        VIVO_SHEET_ENTRY_CONFIG.fields.find((f) => f.key === 'status')?.defaultOptions || []
      ),
    [rows]
  );

  const regionalOptions = useMemo(
    () => extractDynamicFieldOptions(rows, 'regional', 'Regional', []),
    [rows]
  );

  const prioridadeOptions = useMemo(
    () =>
      extractDynamicFieldOptions(
        rows,
        'prioridade',
        'Prioridade',
        VIVO_SHEET_ENTRY_CONFIG.fields.find((f) => f.key === 'prioridade')?.defaultOptions || []
      ),
    [rows]
  );

  // Dashboard & Table interactive filter state
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsSubTab>('status');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDocType, setSelectedDocType] = useState<string>('ALL');
  const [selectedStatusGroup, setSelectedStatusGroup] = useState<VivoStatusGroup | 'ALL'>('ALL');
  const [selectedStatusExact, setSelectedStatusExact] = useState<string>('ALL');
  const [selectedExecutor, setSelectedExecutor] = useState<string>('ALL');
  const [selectedRegional, setSelectedRegional] = useState<string>('ALL');
  const [selectedWeek, setSelectedWeek] = useState<string>('ALL');
  const [selectedOffender, setSelectedOffender] = useState<string>('ALL');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyFaturadas, setOnlyFaturadas] = useState(false);
  const [onlyComRevisao, setOnlyComRevisao] = useState(false);

  const [viewMode, setViewMode] = useState<TableViewMode>('resumo');
  const [density, setDensity] = useState<DensityMode>('compacto');
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Multi-row selection for bulk "Alterar campo"
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  // Inline cell editing state
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    col: string;
    value: string;
  } | null>(null);
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);

  // Detail & Edit Drawer + Histórico tab
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('detalhes');
  const [isEditingRow, setIsEditingRow] = useState(false);
  const [editDraft, setEditDraft] = useState<{
    status: string;
    tipoDoc: string;
    regional: string;
    executor: string;
    prioridade: string;
    planejado: string;
    replan: string;
    dataReplan: string;
    entregue: string;
    faturamento: string;
    ofensor: string;
    comentarioStatus: string;
  } | null>(null);
  const [savingRow, setSavingRow] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Generic Entry Modals
  const [showNovoRegistroModal, setShowNovoRegistroModal] = useState(false);
  const [showEntradaRapidaModal, setShowEntradaRapidaModal] = useState(false);
  const [showAlterarCampoModal, setShowAlterarCampoModal] = useState(false);

  // Carga inicial (ADM & Dono only): dropdown + modal with File and Paste tabs
  const [showCargaMenu, setShowCargaMenu] = useState(false);
  const cargaMenuRef = useRef<HTMLDivElement>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [cargaTab, setCargaTab] = useState<CargaInicialTab>('arquivo');
  const [pastedTableText, setPastedTableText] = useState('');
  const [importPreview, setImportPreview] = useState<ParsedVivoImportResult | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ gravados: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close Carga inicial dropdown when clicking outside
  useEffect(() => {
    if (!showCargaMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (cargaMenuRef.current && !cargaMenuRef.current.contains(e.target as Node)) {
        setShowCargaMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showCargaMenu]);

  // Keep selectedRow reactive to real-time Firestore snapshot updates
  const selectedRow = useMemo(() => {
    if (!selectedRowId) return null;
    return rows.find((r) => r.id === selectedRowId) || null;
  }, [rows, selectedRowId]);

  // Prune selectedRowIds if rows were deleted externally
  useEffect(() => {
    setSelectedRowIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(rows.map((r) => r.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [rows]);

  // Full dataset metrics (for overall KPIs & filter dropdown options)
  const overallMetrics = useMemo(() => computeVivoDashboardMetrics(rows), [rows]);

  // Filtered rows for the table
  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return rows.filter((row) => {
      if (selectedDocType !== 'ALL' && row.tipoDoc !== selectedDocType) return false;
      if (selectedStatusGroup !== 'ALL' && classifyVivoStatus(row.status) !== selectedStatusGroup) {
        return false;
      }
      if (selectedStatusExact !== 'ALL' && ((row.status || '').trim() || 'Sem Status') !== selectedStatusExact) {
        return false;
      }
      if (selectedExecutor !== 'ALL' && ((row.executor || '').trim() || 'Sem Executor') !== selectedExecutor) {
        return false;
      }
      if (selectedRegional !== 'ALL' && ((row.regional || '').trim() || 'N/I') !== selectedRegional) {
        return false;
      }
      if (selectedWeek !== 'ALL') {
        const wNum = parseInt((row.entregueWeek || '').trim(), 10);
        const wLabel = Number.isFinite(wNum) && wNum > 0 ? `W${String(wNum).padStart(2, '0')}` : '';
        if (wLabel !== selectedWeek) return false;
      }
      if (selectedOffender !== 'ALL' && (row.ofensor || '').trim() !== selectedOffender) {
        return false;
      }
      if (onlyOpen) {
        const g = classifyVivoStatus(row.status);
        if (g === 'finalizado' || g === 'cancelada') return false;
      }
      if (onlyFaturadas && !isVivoFaturado(row)) return false;
      if (onlyComRevisao && !hasVivoRevision(row)) return false;

      if (q) {
        const haystack = [
          row.siteName,
          row.idRegister,
          row.regional,
          row.tipoDoc,
          row.status,
          row.executor,
          row.comentarioStatus,
          row.ofensor,
          row.faturamento,
          row.demanda,
          row.entregue,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [
    rows,
    searchTerm,
    selectedDocType,
    selectedStatusGroup,
    selectedStatusExact,
    selectedExecutor,
    selectedRegional,
    selectedWeek,
    selectedOffender,
    onlyOpen,
    onlyFaturadas,
    onlyComRevisao,
  ]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    selectedDocType,
    selectedStatusGroup,
    selectedStatusExact,
    selectedExecutor,
    selectedRegional,
    selectedWeek,
    selectedOffender,
    onlyOpen,
    onlyFaturadas,
    onlyComRevisao,
    pageSize,
  ]);

  const hasActiveFilters =
    searchTerm.trim() !== '' ||
    selectedDocType !== 'ALL' ||
    selectedStatusGroup !== 'ALL' ||
    selectedStatusExact !== 'ALL' ||
    selectedExecutor !== 'ALL' ||
    selectedRegional !== 'ALL' ||
    selectedWeek !== 'ALL' ||
    selectedOffender !== 'ALL' ||
    onlyOpen ||
    onlyFaturadas ||
    onlyComRevisao;

  const clearAllFilters = () => {
    setSearchTerm('');
    setSelectedDocType('ALL');
    setSelectedStatusGroup('ALL');
    setSelectedStatusExact('ALL');
    setSelectedExecutor('ALL');
    setSelectedRegional('ALL');
    setSelectedWeek('ALL');
    setSelectedOffender('ALL');
    setOnlyOpen(false);
    setOnlyFaturadas(false);
    setOnlyComRevisao(false);
  };

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  const visibleColumns = useMemo(
    () => (viewMode === 'resumo' ? VIVO_SUMMARY_COLUMNS : VIVO_DOC_COLUMNS),
    [viewMode]
  );

  // Top weeks for clean vertical bar chart (last 16 active weeks)
  const displayWeeks = useMemo(() => {
    const sorted = [...overallMetrics.byWeek].sort((a, b) => a.weekNum - b.weekNum);
    return sorted.slice(-16);
  }, [overallMetrics.byWeek]);

  const maxWeekCount = useMemo(
    () => Math.max(1, ...displayWeeks.map((w) => w.count)),
    [displayWeeks]
  );

  const selectedRowsList = useMemo(
    () => rows.filter((r) => selectedRowIds.has(r.id)),
    [rows, selectedRowIds]
  );

  const allOnPageSelected =
    paginatedRows.length > 0 && paginatedRows.every((r) => selectedRowIds.has(r.id));

  const toggleSelectRow = (rowId: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        paginatedRows.forEach((r) => next.delete(r.id));
      } else {
        paginatedRows.forEach((r) => next.add(r.id));
      }
      return next;
    });
  };

  // Can current user edit a given column inline on a given row?
  const canEditCell = (row: VivoActivityRow, col: string): boolean => {
    const fieldKey = INLINE_COLUMN_TO_FIELD_KEY[col];
    if (!fieldKey) return false;
    if (canManage) return true;
    if (isExecutorRole) {
      return (
        (fieldKey === 'status' || fieldKey === 'comentarioStatus') &&
        isExecutorOwnerOfRow(row, user)
      );
    }
    return false;
  };

  // Open row drawer
  const handleOpenRow = (row: VivoActivityRow, initialTab: DrawerTab = 'detalhes') => {
    setSelectedRowId(row.id);
    setDrawerTab(initialTab);
    setIsEditingRow(false);
    setConfirmDeleteId(null);
    setEditDraft({
      status: row.status || '',
      tipoDoc: row.tipoDoc || '',
      regional: row.regional || '',
      executor: row.executor || '',
      prioridade: row.prioridade || '',
      planejado: brDateToIsoInput(row.planejado),
      replan: brDateToIsoInput(row.replan),
      dataReplan: brDateToIsoInput(row.dataReplan),
      entregue: brDateToIsoInput(row.entregue),
      faturamento: row.faturamento || '',
      ofensor: row.ofensor || '',
      comentarioStatus: row.comentarioStatus || '',
    });
  };

  // Commit a single inline cell change to Firestore (writes ONLY that field + history + metadata)
  const commitInlineCellEdit = async (
    row: VivoActivityRow,
    col: string,
    rawNewValue: string
  ) => {
    const fieldKey = INLINE_COLUMN_TO_FIELD_KEY[col];
    if (!fieldKey) {
      setEditingCell(null);
      return;
    }

    const matchedExecUser =
      fieldKey === 'executor' && rawNewValue.trim()
        ? executorUsers.find(
            (u) =>
              u.name.trim().toLowerCase() === rawNewValue.trim().toLowerCase() ||
              (u.email || '').trim().toLowerCase() === rawNewValue.trim().toLowerCase()
          ) || null
        : null;

    const patchResult = buildSingleFieldUpdatePatch({
      row,
      fieldKey,
      rawNewValue,
      actorName,
      config: VIVO_SHEET_ENTRY_CONFIG,
      executorUser: matchedExecUser,
    });

    setEditingCell(null);
    if (!patchResult.changed) return;

    const cellKey = `${row.id}::${col}`;
    setSavingCellKey(cellKey);
    try {
      let demandSync:
        | {
            action: 'assign' | 'remove';
            siteName: string;
            tipoDoc?: string;
            dataDemanda?: string;
            executorName?: string;
            executorEmail?: string;
            actorName?: string;
            actorEmail?: string;
          }
        | undefined;

      if (fieldKey === 'executor') {
        if (patchResult.afterValue) {
          demandSync = {
            action: 'assign',
            siteName: row.siteName || row.id,
            tipoDoc: row.tipoDoc,
            dataDemanda: row.demanda,
            executorName: patchResult.afterValue,
            executorEmail: matchedExecUser?.email || '',
            actorName,
            actorEmail,
          };
        } else {
          demandSync = {
            action: 'remove',
            siteName: row.siteName || row.id,
            tipoDoc: row.tipoDoc,
            actorName,
            actorEmail,
          };
        }
      }

      await dataService.atualizarCamposVivoAtividade(row.id, patchResult.patch, demandSync);

      const fieldLabel =
        VIVO_SHEET_ENTRY_CONFIG.fields.find((f) => f.key === fieldKey)?.label || col;
      onShowToast(
        `${row.siteName || 'Atividade'}: ${fieldLabel} atualizado para "${
          patchResult.afterValue || 'vazio'
        }".`
      );
    } catch (err: any) {
      onShowToast(`Erro ao salvar ${col}: ${formatErrorReason(err)}`);
    } finally {
      setSavingCellKey(null);
    }
  };

  // Drawer full/executor save (writes targeted changed fields + history entries, never silent)
  const handleSaveRowEdit = async () => {
    if (!selectedRow || !editDraft) return;
    const isOwnExecutor = isExecutorRole && isExecutorOwnerOfRow(selectedRow, user);
    if (!canManage && !isOwnExecutor) {
      onShowToast('Sem permissão para editar este registro.');
      return;
    }

    setSavingRow(true);
    const nowIso = new Date().toISOString();
    const todayBr = new Date().toLocaleDateString('pt-BR');

    try {
      const patch: Record<string, any> = {};
      const nextFields: Record<string, string> = { ...(selectedRow.fields || {}) };
      const newHistoryEntries: VivoHistoryEntry[] = [];

      const checkAndStage = (
        key: keyof VivoActivityRow,
        colName: string,
        label: string,
        nextValRaw: string,
        isDate = false
      ) => {
        const beforeVal = String((selectedRow as any)[key] || selectedRow.fields?.[colName] || '').trim();
        const afterVal = isDate ? normalizeDateValueToBr(nextValRaw) : String(nextValRaw || '').trim();
        if (beforeVal === afterVal) return false;
        patch[key] = afterVal;
        nextFields[colName] = afterVal;
        newHistoryEntries.push({
          campo: label,
          antes: beforeVal,
          depois: afterVal,
          quem: actorName,
          quando: nowIso,
          acao:
            key === 'executor'
              ? afterVal
                ? 'demanda'
                : 'remocao_demanda'
              : 'edicao',
        });
        return true;
      };

      // Executor can ONLY edit Status and Comentário STATUS
      checkAndStage('status', 'Status', 'Status', editDraft.status);
      checkAndStage('comentarioStatus', 'Comentário STATUS', 'Comentário STATUS', editDraft.comentarioStatus);

      let executorChanged = false;
      if (canManage) {
        checkAndStage('tipoDoc', 'Tipo doc', 'Tipo doc', editDraft.tipoDoc);
        checkAndStage('regional', 'Regional', 'Regional', editDraft.regional);
        checkAndStage('prioridade', 'Prioridade', 'Prioridade', editDraft.prioridade);
        checkAndStage('planejado', 'Planejado', 'Planejado', editDraft.planejado, true);
        checkAndStage('replan', 'REPLAN', 'REPLAN', editDraft.replan, true);
        checkAndStage('dataReplan', 'DATA REPLAN', 'DATA REPLAN', editDraft.dataReplan, true);
        checkAndStage('entregue', 'Entregue', 'Entregue', editDraft.entregue, true);
        checkAndStage('faturamento', 'FATURAMENTO', 'Faturamento', editDraft.faturamento);
        checkAndStage('ofensor', 'Ofensor', 'Ofensor', editDraft.ofensor);
        executorChanged = checkAndStage('executor', 'EXECUTOR', 'Executor', editDraft.executor);
      }

      if (newHistoryEntries.length === 0) {
        setIsEditingRow(false);
        return;
      }

      let demandSync:
        | {
            action: 'assign' | 'remove';
            siteName: string;
            tipoDoc?: string;
            dataDemanda?: string;
            executorName?: string;
            executorEmail?: string;
            actorName?: string;
            actorEmail?: string;
          }
        | undefined;

      if (executorChanged) {
        const nextExecName = editDraft.executor.trim();
        if (nextExecName) {
          const matchedExec = executorUsers.find(
            (u) => u.name.trim().toLowerCase() === nextExecName.toLowerCase()
          );
          const execEmail = (matchedExec?.email || '').trim().toLowerCase();
          patch.responsavelDemand = nextExecName;
          patch.responsaveisEmails = execEmail ? [execEmail] : [];
          patch.responsaveisUids = matchedExec?.id ? [matchedExec.id] : [];
          nextFields['Data Demanda'] = selectedRow.demanda || todayBr;
          nextFields['E-MAIL DUPLA'] = execEmail;
          demandSync = {
            action: 'assign',
            siteName: selectedRow.siteName || selectedRow.id,
            tipoDoc: patch.tipoDoc || selectedRow.tipoDoc,
            dataDemanda: selectedRow.demanda || todayBr,
            executorName: nextExecName,
            executorEmail: execEmail,
            actorName,
            actorEmail,
          };
        } else {
          patch.responsavelDemand = '';
          patch.responsaveisEmails = [];
          patch.responsaveisUids = [];
          nextFields['E-MAIL DUPLA'] = '';
          nextFields['Data Demanda'] = '';
          demandSync = {
            action: 'remove',
            siteName: selectedRow.siteName || selectedRow.id,
            tipoDoc: selectedRow.tipoDoc,
            actorName,
            actorEmail,
          };
        }
      }

      patch.fields = nextFields;
      patch.history = appendHistoryEntries(
        selectedRow.history,
        newHistoryEntries,
        VIVO_SHEET_ENTRY_CONFIG.maxHistoryEntries
      );
      patch.updatedAt = nowIso;
      patch.updatedBy = actorName;

      await dataService.atualizarCamposVivoAtividade(selectedRow.id, patch, demandSync);
      onShowToast(`Atividade ${selectedRow.siteName || selectedRow.id} atualizada com sucesso.`);
      setIsEditingRow(false);
    } catch (err: any) {
      onShowToast(`Erro ao atualizar atividade: ${formatErrorReason(err)}`);
    } finally {
      setSavingRow(false);
    }
  };

  // Single-row delete (strictly ADM, Dono, Coordenadores — never silent)
  const handleDeleteSingleRow = async (rowId: string) => {
    if (!canManage) {
      onShowToast('Apenas coordenação e ADM podem excluir registros.');
      return;
    }
    try {
      await dataService.excluirVivoAtividade(rowId);
      onShowToast('Registro Vivo excluído do banco de dados.');
      setSelectedRowId(null);
      setConfirmDeleteId(null);
    } catch (err: any) {
      onShowToast(`Erro ao excluir registro: ${formatErrorReason(err)}`);
    }
  };

  // 1) Novo registro handler (NovoRegistroModal)
  const handleCreateSingleRegistro = async (payload: NovoRegistroPayload) => {
    const minRowNum = rows.reduce(
      (min, r) =>
        typeof r.rowNumberInFile === 'number' && r.rowNumberInFile < min
          ? r.rowNumberInFile
          : min,
      0
    );

    const newRow = buildNewVivoActivityRow({
      siteName: payload.siteName,
      tipoDoc: payload.tipoDoc,
      regional: payload.regional,
      prioridade: payload.prioridade,
      planejado: payload.planejado,
      executorUser: payload.executorUser,
      executorName: payload.executorName,
      comentarioStatus: payload.comentarioStatus,
      initialStatus: payload.initialStatus,
      autofillFixedFields: payload.autofillFixedFields,
      idRegister: payload.idRegister,
      actorName,
      actorEmail,
      rowNumberInFile: minRowNum - 1,
      index: 0,
    });

    try {
      const res = await dataService.criarVivoRegistrosEmLote([newRow], {
        executorUser: payload.executorUser
          ? {
              id: payload.executorUser.id,
              name: payload.executorUser.name,
              email: payload.executorUser.email,
            }
          : null,
        actorName,
        actorEmail,
      });

      onShowToast(
        res.acionamentosCriados > 0
          ? `Registro ${newRow.siteName} criado e demandado para ${payload.executorUser?.name}.`
          : `Registro ${newRow.siteName} (${newRow.tipoDoc}) criado com sucesso.`
      );
    } catch (err: any) {
      const reason = formatErrorReason(err);
      onShowToast(`Erro ao criar registro: ${reason}`);
      throw new Error(reason);
    }
  };

  // 2) Entrada rápida handler (EntradaRapidaModal — batches of 250 + demands/acionamentos)
  const handleCreateEntradaRapida = async (payload: EntradaRapidaSubmitPayload) => {
    const minRowNum = rows.reduce(
      (min, r) =>
        typeof r.rowNumberInFile === 'number' && r.rowNumberInFile < min
          ? r.rowNumberInFile
          : min,
      0
    );

    const now = new Date();
    const newRows: VivoActivityRow[] = payload.items.map((item, idx) => {
      const autofill = findSiteAutofillData(rows, item.siteName, VIVO_SHEET_ENTRY_CONFIG);
      return buildNewVivoActivityRow({
        siteName: item.siteName,
        tipoDoc: item.tipoDoc,
        regional: autofill.values.regional || item.regionalAutofill || '',
        prioridade: payload.prioridade,
        planejado: payload.planejado,
        executorUser: payload.executorUser,
        executorName: payload.executorUser?.name || '',
        comentarioStatus: '',
        initialStatus: payload.initialStatus,
        autofillFixedFields: autofill.fixedFields,
        idRegister: autofill.values.idRegister || '',
        actorName,
        actorEmail,
        rowNumberInFile: minRowNum - 1 - idx,
        index: idx,
        now,
      });
    });

    try {
      const res = await dataService.criarVivoRegistrosEmLote(newRows, {
        executorUser: payload.executorUser
          ? {
              id: payload.executorUser.id,
              name: payload.executorUser.name,
              email: payload.executorUser.email,
            }
          : null,
        actorName,
        actorEmail,
        onProgress: (info) =>
          payload.onProgress({ gravados: info.gravados, total: info.total }),
      });

      onShowToast(
        res.acionamentosCriados > 0
          ? `${res.totalGravados} registro(s) criado(s) e ${res.acionamentosCriados} demanda(s)/acionamento(s) enviados para ${payload.executorUser?.name}.`
          : `${res.totalGravados} registro(s) criado(s) com sucesso em Atividades Vivo.`
      );
    } catch (err: any) {
      const reason = formatErrorReason(err);
      onShowToast(`Erro na entrada rápida: ${reason}`);
      throw new Error(reason);
    }
  };

  // 4) Bulk "Alterar campo" handler (AlterarCampoModal — batches of 250, writes ONLY chosen field)
  const handleBulkAlterarCampo = async (payload: AlterarCampoSubmitPayload) => {
    const now = new Date();
    const updates: Array<{
      id: string;
      patch: Record<string, any>;
      siteName?: string;
      tipoDoc?: string;
      dataDemanda?: string;
    }> = [];

    for (const row of selectedRowsList) {
      const res = buildSingleFieldUpdatePatch({
        row,
        fieldKey: payload.fieldKey,
        rawNewValue: payload.rawValue,
        actorName,
        config: VIVO_SHEET_ENTRY_CONFIG,
        executorUser: payload.executorUser,
        now,
      });
      if (res.changed) {
        updates.push({
          id: row.id,
          patch: res.patch,
          siteName: row.siteName,
          tipoDoc: row.tipoDoc,
          dataDemanda: row.demanda,
        });
      }
    }

    if (updates.length === 0) {
      onShowToast('Nenhuma linha precisou ser alterada (valor já era igual).');
      return;
    }

    try {
      const demandSync =
        payload.fieldKey === 'executor'
          ? payload.executorUser
            ? {
                action: 'assign' as const,
                executorName: payload.executorUser.name,
                executorEmail: payload.executorUser.email || '',
                actorName,
                actorEmail,
              }
            : {
                action: 'remove' as const,
                actorName,
                actorEmail,
              }
          : undefined;

      const res = await dataService.atualizarCampoVivoEmLote(updates, {
        demandSync,
        onProgress: payload.onProgress,
      });

      setSelectedRowIds(new Set());
      onShowToast(
        `Campo "${payload.fieldLabel}" atualizado em ${res.totalAtualizados} linha(s).`
      );
    } catch (err: any) {
      const reason = formatErrorReason(err);
      onShowToast(`Erro ao alterar campo em lote: ${reason}`);
      throw new Error(reason);
    }
  };

  // 6) Carga inicial (ADM & Dono only): file upload & paste
  const openCargaInicialModal = (tab: CargaInicialTab) => {
    setShowCargaMenu(false);
    setCargaTab(tab);
    setImportError(null);
    setImportPreview(null);
    setImportFileName('');
    setPastedTableText('');
    setShowImportModal(true);
  };

  const handleSelectImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportFileName(file.name);
    try {
      const parsed = await parseVivoSpreadsheetFile(file, {
        updatedBy: actorName,
      });
      if (parsed.rows.length === 0) {
        setImportError('Nenhuma linha com dados foi encontrada neste arquivo.');
        setImportPreview(null);
      } else {
        setImportPreview(parsed);
      }
    } catch (err: any) {
      setImportError(`Erro ao ler arquivo: ${formatErrorReason(err)}`);
      setImportPreview(null);
    }
  };

  const handleParsePastedTable = (rawText: string) => {
    setPastedTableText(rawText);
    setImportError(null);
    if (!rawText.trim()) {
      setImportPreview(null);
      return;
    }
    try {
      const matrix = parseCsvMatrix(rawText);
      const parsed = buildVivoRowsFromMatrix(matrix, {
        fileName: 'Carga Inicial (Colado)',
        updatedBy: actorName,
      });
      if (parsed.rows.length === 0) {
        setImportError(
          'Nenhuma linha válida identificada. Inclua o cabeçalho na primeira linha (ex.: 00.02.Site Name, Tipo doc, Regional, Status).'
        );
        setImportPreview(null);
      } else {
        setImportFileName('Tabela colada (Ctrl+V)');
        setImportPreview(parsed);
      }
    } catch (err: any) {
      setImportError(`Erro ao ler tabela colada: ${formatErrorReason(err)}`);
      setImportPreview(null);
    }
  };

  const handleConfirmAppendImport = async () => {
    if (!isAdminOrOwner) {
      onShowToast('Carga inicial está disponível somente para ADM e Dono.');
      return;
    }
    if (!importPreview || importPreview.rows.length === 0) return;

    setImporting(true);
    setImportError(null);
    setImportProgress({ gravados: 0, total: importPreview.rows.length });
    try {
      await dataService.importarVivoAtividadesEmLote(importPreview.rows, {
        fileName: importFileName || 'Carga Inicial Vivo',
        columns: importPreview.columns,
        onProgress: (info) =>
          setImportProgress({ gravados: info.gravados, total: info.total }),
      });
      onShowToast(
        `${importPreview.rows.length.toLocaleString('pt-BR')} atividades Vivo gravadas no Firestore.`
      );
      setShowImportModal(false);
      setImportPreview(null);
      setImportFileName('');
      setPastedTableText('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      const reason = formatErrorReason(err);
      setImportError(`Falha ao gravar no Firestore: ${reason}`);
      onShowToast(`Erro na carga inicial: ${reason}`);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* =====================================================================
          1. PAGE HEADER & ACTIONS (AUTOSSUFICIENTE)
         ===================================================================== */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] bg-[#660099]/10 border border-[#660099]/20 text-[#660099] text-[11px] font-bold uppercase tracking-wider">
              <Sparkles className="w-3 h-3" />
              Ericsson · Vivo
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-slate-100 border border-slate-200 text-slate-600 text-[11px] font-mono tabular-nums font-semibold">
              {overallMetrics.totalAtividades.toLocaleString('pt-BR')} atividades
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-slate-100 border border-slate-200 text-slate-600 text-[11px] font-mono tabular-nums font-semibold">
              {overallMetrics.uniqueSites.toLocaleString('pt-BR')} sites
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight leading-tight mt-1">
            Ericsson Vivo — Dashboard de Atividades & Documentação
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Gestão direta no sistema (RF Sheet, PPI, PDI, War Room, PIRF e BoQ) sincronizada em tempo real no banco de dados.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setShowNovoRegistroModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#660099] hover:bg-[#52007a] text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>+ Novo registro</span>
              </button>

              <button
                type="button"
                onClick={() => setShowEntradaRapidaModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#223585] hover:bg-[#1a2968] text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              >
                <ListPlus className="w-3.5 h-3.5" />
                <span>Adicionar vários</span>
              </button>
            </>
          )}

          {/* Carga inicial menu — ONLY ADM & Dono */}
          {isAdminOrOwner && (
            <div className="relative" ref={cargaMenuRef}>
              <button
                type="button"
                onClick={() => setShowCargaMenu((prev) => !prev)}
                aria-expanded={showCargaMenu}
                aria-haspopup="menu"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              >
                <Database className="w-3.5 h-3.5 text-slate-500" />
                <span>Carga inicial</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {showCargaMenu && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1.5 w-60 rounded-[10px] bg-white border border-slate-200 shadow-lg py-1.5 z-30"
                >
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Somente ADM / Dono
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openCargaInicialModal('arquivo')}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#223585]" />
                    <span>Importar arquivo (.CSV / .XLSX)</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openCargaInicialModal('colar')}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5 text-[#660099]" />
                    <span>Colar tabela (Ctrl+V)</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              exportVivoRowsToXlsx(filteredRows);
              onShowToast(
                `Exportadas ${filteredRows.length.toLocaleString('pt-BR')} atividades Vivo para Excel.`
              );
            }}
            disabled={filteredRows.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-[#1E8E8D]" />
            <span>Exportar Excel</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          2. DASHBOARD DAS ATIVIDADES — KPI STRIP (6 CARDS BEM VISÍVEIS)
         ===================================================================== */}
      <section aria-label="Indicadores principais das atividades Vivo" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {/* KPI 1: Total de Atividades */}
        <button
          type="button"
          onClick={() => {
            setSelectedStatusGroup('ALL');
            setSelectedStatusExact('ALL');
            setOnlyOpen(false);
            setOnlyFaturadas(false);
          }}
          className={`text-left bg-white rounded-[12px] p-4 border transition-all cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-sm ${
            selectedStatusGroup === 'ALL' && !onlyFaturadas && !onlyOpen
              ? 'border-[#223585] ring-1 ring-[#223585]/20'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Total Atividades
            </span>
            <div className="w-7 h-7 rounded-[8px] bg-[#223585]/10 text-[#223585] flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums tracking-tight">
              {overallMetrics.totalAtividades.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 flex items-center justify-between">
            <span>{overallMetrics.uniqueSites.toLocaleString('pt-BR')} sites únicos</span>
            <span className="font-mono tabular-nums font-semibold text-[#223585]">
              {overallMetrics.byDocType.length} tipos
            </span>
          </div>
        </button>

        {/* KPI 2: Finalizadas */}
        <button
          type="button"
          onClick={() => {
            setSelectedStatusExact('ALL');
            setOnlyOpen(false);
            setSelectedStatusGroup((prev) => (prev === 'finalizado' ? 'ALL' : 'finalizado'));
          }}
          className={`text-left bg-white rounded-[12px] p-4 border transition-all cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-sm ${
            selectedStatusGroup === 'finalizado'
              ? 'border-emerald-500 ring-1 ring-emerald-500/25 bg-emerald-50/30'
              : 'border-slate-200 hover:border-emerald-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Finalizadas
            </span>
            <div className="w-7 h-7 rounded-[8px] bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-700 font-mono tabular-nums tracking-tight">
              {overallMetrics.finalizadas.toLocaleString('pt-BR')}
            </span>
            <span className="text-xs font-bold text-emerald-600 font-mono tabular-nums">
              {overallMetrics.percentFinalizadas.toFixed(1).replace('.', ',')}%
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${Math.min(100, overallMetrics.percentFinalizadas)}%` }}
            />
          </div>
        </button>

        {/* KPI 3: Em Produção / A Produzir */}
        <button
          type="button"
          onClick={() => {
            setSelectedStatusExact('ALL');
            setOnlyOpen(false);
            setSelectedStatusGroup((prev) => (prev === 'em_producao' ? 'ALL' : 'em_producao'));
          }}
          className={`text-left bg-white rounded-[12px] p-4 border transition-all cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-sm ${
            selectedStatusGroup === 'em_producao'
              ? 'border-blue-500 ring-1 ring-blue-500/25 bg-blue-50/30'
              : 'border-slate-200 hover:border-blue-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Em Produção
            </span>
            <div className="w-7 h-7 rounded-[8px] bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-blue-700 font-mono tabular-nums tracking-tight">
              {overallMetrics.emProducao.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 truncate">
            Em produção, a produzir e correção
          </div>
        </button>

        {/* KPI 4: WR Aguardando Aprovação */}
        <button
          type="button"
          onClick={() => {
            setSelectedStatusExact('ALL');
            setOnlyOpen(false);
            setSelectedStatusGroup((prev) =>
              prev === 'aguardando_aprovacao' ? 'ALL' : 'aguardando_aprovacao'
            );
          }}
          className={`text-left bg-white rounded-[12px] p-4 border transition-all cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-sm ${
            selectedStatusGroup === 'aguardando_aprovacao'
              ? 'border-[#660099] ring-1 ring-[#660099]/25 bg-violet-50/40'
              : 'border-slate-200 hover:border-violet-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
              WR Aguardando
            </span>
            <div className="w-7 h-7 rounded-[8px] bg-violet-50 text-[#660099] flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#660099] font-mono tabular-nums tracking-tight">
              {overallMetrics.aguardandoAprovacao.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 truncate">
            War Room aguardando aprovação
          </div>
        </button>

        {/* KPI 5: Pendências */}
        <button
          type="button"
          onClick={() => {
            setSelectedStatusExact('ALL');
            setOnlyOpen(false);
            setSelectedStatusGroup((prev) => (prev === 'pendente' ? 'ALL' : 'pendente'));
          }}
          className={`text-left bg-white rounded-[12px] p-4 border transition-all cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-sm ${
            selectedStatusGroup === 'pendente'
              ? 'border-amber-500 ring-1 ring-amber-500/25 bg-amber-50/40'
              : 'border-slate-200 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Pendências
            </span>
            <div className="w-7 h-7 rounded-[8px] bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-700 font-mono tabular-nums tracking-tight">
              {overallMetrics.pendentes.toLocaleString('pt-BR')}
            </span>
            {overallMetrics.canceladas > 0 && (
              <span className="text-[11px] font-semibold text-rose-600 font-mono tabular-nums">
                +{overallMetrics.canceladas} canc.
              </span>
            )}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 truncate">
            Cliente, dúvida, vistoria e BoQ
          </div>
        </button>

        {/* KPI 6: Faturadas & SLA Médio */}
        <button
          type="button"
          onClick={() => setOnlyFaturadas((prev) => !prev)}
          className={`text-left bg-white rounded-[12px] p-4 border transition-all cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-sm ${
            onlyFaturadas
              ? 'border-[#1E8E8D] ring-1 ring-[#1E8E8D]/25 bg-teal-50/30'
              : 'border-slate-200 hover:border-teal-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Faturadas / SLA
            </span>
            <div className="w-7 h-7 rounded-[8px] bg-[#1E8E8D]/10 text-[#1E8E8D] flex items-center justify-center shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1E8E8D] font-mono tabular-nums tracking-tight">
              {overallMetrics.faturadas.toLocaleString('pt-BR')}
            </span>
            <span className="text-xs font-semibold text-slate-500 font-mono tabular-nums">
              ({overallMetrics.percentFaturadas.toFixed(1).replace('.', ',')}%)
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 flex items-center justify-between">
            <span>SLA Médio DOC</span>
            <span className="font-mono tabular-nums font-semibold text-slate-700">
              {overallMetrics.avgSlaDoc !== null
                ? `${overallMetrics.avgSlaDoc.toFixed(1).replace('.', ',')} d`
                : '—'}
            </span>
          </div>
        </button>
      </section>

      {/* =====================================================================
          3. DASHBOARD VISUAL ANALÍTICO (2 COLUNAS INTERATIVAS BEM VISÍVEIS)
         ===================================================================== */}
      <section aria-label="Gráficos e distribuição das atividades Vivo" className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* LEFT PANEL: Progresso por Tipo de Atividade (Tipo doc) */}
        <div className="xl:col-span-7 bg-white rounded-[12px] border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4 sm:p-5 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#223585]" />
                  <span>Atividades por Tipo de Documento</span>
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Clique em qualquer tipo de documento para filtrar a planilha abaixo.
                </p>
              </div>
              {selectedDocType !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setSelectedDocType('ALL')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-[#660099]/10 text-[#660099] text-[11px] font-semibold hover:bg-[#660099]/15 cursor-pointer"
                >
                  <span>Filtro: {selectedDocType}</span>
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-slate-400" />
                <span>Nenhuma atividade Vivo cadastrada ainda. Use &quot;+ Novo registro&quot; ou &quot;Adicionar vários&quot;.</span>
              </div>
            ) : (
              <div className="space-y-3">
                {overallMetrics.byDocType.map((item) => {
                  const isSelected = selectedDocType === item.tipoDoc;
                  const pFin = (item.finalizadas / Math.max(1, item.total)) * 100;
                  const pWr = (item.aguardandoAprovacao / Math.max(1, item.total)) * 100;
                  const pProd = (item.emProducao / Math.max(1, item.total)) * 100;
                  const pPend = (item.pendentes / Math.max(1, item.total)) * 100;
                  const pCanc = (item.canceladas / Math.max(1, item.total)) * 100;
                  const emAberto =
                    item.aguardandoAprovacao + item.emProducao + item.pendentes + item.outros;

                  return (
                    <button
                      key={item.tipoDoc}
                      type="button"
                      onClick={() =>
                        setSelectedDocType((prev) => (prev === item.tipoDoc ? 'ALL' : item.tipoDoc))
                      }
                      className={`w-full text-left p-3 rounded-[10px] border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#223585]/[0.04] border-[#223585] ring-1 ring-[#223585]/15'
                          : 'bg-slate-50/60 border-slate-200/80 hover:bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[13px] font-bold text-slate-900 truncate">
                            {item.tipoDoc}
                          </span>
                          <span className="text-[11px] font-mono tabular-nums font-semibold px-2 py-0.5 rounded-[6px] bg-white border border-slate-200 text-slate-700">
                            {item.total.toLocaleString('pt-BR')}
                          </span>
                          {item.faturadas > 0 && (
                            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-[6px] bg-teal-50 text-teal-700 border border-teal-200/70 font-mono tabular-nums">
                              {item.faturadas} fat.
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
                          <span className="text-emerald-700 font-semibold">
                            {item.finalizadas.toLocaleString('pt-BR')} fin.
                          </span>
                          {emAberto > 0 && (
                            <span className="text-blue-700 font-semibold">
                              {emAberto.toLocaleString('pt-BR')} abertas
                            </span>
                          )}
                          {item.pendentes > 0 && (
                            <span className="text-amber-700 font-semibold">
                              {item.pendentes} pend.
                            </span>
                          )}
                          <span className="font-bold text-slate-900 min-w-[44px] text-right">
                            {item.percentConcluido.toFixed(1).replace('.', ',')}%
                          </span>
                        </div>
                      </div>

                      {/* Stacked progress bar */}
                      <div className="h-2.5 w-full rounded-full bg-slate-200/70 overflow-hidden flex">
                        {pFin > 0 && (
                          <div
                            className="h-full bg-emerald-500 transition-all duration-300"
                            style={{ width: `${pFin}%` }}
                            title={`Finalizadas: ${item.finalizadas}`}
                          />
                        )}
                        {pWr > 0 && (
                          <div
                            className="h-full bg-[#660099] transition-all duration-300"
                            style={{ width: `${pWr}%` }}
                            title={`WR Aguardando Aprovação: ${item.aguardandoAprovacao}`}
                          />
                        )}
                        {pProd > 0 && (
                          <div
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${pProd}%` }}
                            title={`Em Produção / A Produzir: ${item.emProducao}`}
                          />
                        )}
                        {pPend > 0 && (
                          <div
                            className="h-full bg-amber-500 transition-all duration-300"
                            style={{ width: `${pPend}%` }}
                            title={`Pendências: ${item.pendentes}`}
                          />
                        )}
                        {pCanc > 0 && (
                          <div
                            className="h-full bg-rose-400 transition-all duration-300"
                            style={{ width: `${pCanc}%` }}
                            title={`Canceladas: ${item.canceladas}`}
                          />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Finalizadas
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#660099]" />
              WR Aguard. Aprovação
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              Em Produção / A Produzir
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              Pendências
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
              Canceladas
            </span>
          </div>
        </div>

        {/* RIGHT PANEL: Visão Analítica Interativa (Status / Executores / Semanas / Regionais & Revisões) */}
        <div className="xl:col-span-5 bg-white rounded-[12px] border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4 sm:p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
            <h2 className="text-sm font-bold text-slate-900">Detalhamento Operacional</h2>
            <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-[8px] gap-0.5">
              {(
                [
                  { id: 'status', label: 'Status' },
                  { id: 'executors', label: 'Executores' },
                  { id: 'weeks', label: 'Semanas' },
                  { id: 'regional', label: 'Regional/Rev.' },
                ] as Array<{ id: AnalyticsSubTab; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setAnalyticsTab(tab.id)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-[6px] transition-all cursor-pointer ${
                    analyticsTab === tab.id
                      ? 'bg-[#223585] text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[435px] pr-1">
            {rows.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-1.5">
                <BarChart3 className="w-5 h-5 text-slate-300" />
                <span>Os indicadores aparecerão aqui assim que houver registros cadastrados.</span>
              </div>
            ) : (
              <>
            {/* SUB-TAB 1: POR STATUS */}
            {analyticsTab === 'status' && (
              <div className="space-y-2">
                {overallMetrics.byStatus.map((st) => {
                  const style = STATUS_BADGE_STYLES[st.group];
                  const isSel = selectedStatusExact === st.status;
                  return (
                    <button
                      key={st.status}
                      type="button"
                      onClick={() => {
                        setSelectedStatusGroup('ALL');
                        setSelectedStatusExact((prev) => (prev === st.status ? 'ALL' : st.status));
                      }}
                      className={`w-full text-left px-3 py-2 rounded-[8px] border transition-all cursor-pointer ${
                        isSel
                          ? 'bg-[#223585]/[0.05] border-[#223585]'
                          : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-2 font-medium text-slate-800 truncate">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                          <span className="truncate">{st.status}</span>
                        </span>
                        <span className="font-mono tabular-nums font-bold text-slate-900 shrink-0">
                          {st.count.toLocaleString('pt-BR')}
                          <span className="text-[10px] font-normal text-slate-500 ml-1.5">
                            ({st.percent.toFixed(1).replace('.', ',')}%)
                          </span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${style.dot}`}
                          style={{ width: `${Math.max(2, st.percent)}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* SUB-TAB 2: POR EXECUTOR */}
            {analyticsTab === 'executors' && (
              <div className="space-y-2">
                {overallMetrics.byExecutor.slice(0, 12).map((ex) => {
                  const isSel = selectedExecutor === ex.executor;
                  return (
                    <button
                      key={ex.executor}
                      type="button"
                      onClick={() =>
                        setSelectedExecutor((prev) => (prev === ex.executor ? 'ALL' : ex.executor))
                      }
                      className={`w-full text-left px-3 py-2 rounded-[8px] border transition-all cursor-pointer ${
                        isSel
                          ? 'bg-[#223585]/[0.05] border-[#223585]'
                          : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 truncate">
                          <UserCheck className="w-3.5 h-3.5 text-[#1E8E8D] shrink-0" />
                          <span className="truncate">{ex.executor}</span>
                        </span>
                        <div className="flex items-center gap-2 font-mono tabular-nums text-[11px] shrink-0">
                          <span className="text-emerald-700 font-semibold">
                            {ex.finalizadas}/{ex.total}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-bold">
                            {ex.percentConcluido.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.min(100, ex.percentConcluido)}%` }}
                          />
                        </div>
                        {ex.avgSla !== null && (
                          <span className="text-[10px] text-slate-500 font-mono tabular-nums">
                            SLA {ex.avgSla.toFixed(1).replace('.', ',')}d
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* SUB-TAB 3: ENTREGAS POR SEMANA */}
            {analyticsTab === 'weeks' && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#223585]" />
                    Entregas por Semana (Entregue Week)
                  </span>
                  {selectedWeek !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => setSelectedWeek('ALL')}
                      className="text-[#223585] font-semibold hover:underline cursor-pointer"
                    >
                      Limpar {selectedWeek}
                    </button>
                  )}
                </div>

                {displayWeeks.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-8">
                    Nenhuma semana de entrega registrada.
                  </p>
                ) : (
                  <div className="h-[240px] flex items-end gap-1.5 pt-6 pb-1 px-1 border-b border-slate-200">
                    {displayWeeks.map((w) => {
                      const heightPct = Math.max(8, Math.round((w.count / maxWeekCount) * 100));
                      const isSel = selectedWeek === w.week;
                      return (
                        <button
                          key={w.week}
                          type="button"
                          onClick={() =>
                            setSelectedWeek((prev) => (prev === w.week ? 'ALL' : w.week))
                          }
                          title={`${w.week}: ${w.count} entregas`}
                          className="flex-1 h-full flex flex-col items-center justify-end gap-1 group cursor-pointer"
                        >
                          <span className="text-[9px] font-mono tabular-nums font-semibold text-slate-500 group-hover:text-[#223585]">
                            {w.count}
                          </span>
                          <div
                            className={`w-full max-w-[26px] rounded-t-[5px] transition-all ${
                              isSel
                                ? 'bg-[#660099]'
                                : 'bg-[#223585]/80 group-hover:bg-[#1E8E8D]'
                            }`}
                            style={{ height: `${heightPct}%` }}
                          />
                          <span
                            className={`text-[9px] font-mono tabular-nums ${
                              isSel ? 'font-bold text-[#660099]' : 'text-slate-500'
                            }`}
                          >
                            {w.week}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* SUB-TAB 4: REGIONAIS & REVISÕES / OFENSORES */}
            {analyticsTab === 'regional' && (
              <div className="space-y-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#223585]" />
                    <span>Por Regional</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {overallMetrics.byRegional.map((reg) => {
                      const isSel = selectedRegional === reg.regional;
                      return (
                        <button
                          key={reg.regional}
                          type="button"
                          onClick={() =>
                            setSelectedRegional((prev) =>
                              prev === reg.regional ? 'ALL' : reg.regional
                            )
                          }
                          className={`p-2.5 rounded-[8px] border text-left transition-all cursor-pointer ${
                            isSel
                              ? 'bg-[#223585]/[0.05] border-[#223585]'
                              : 'bg-slate-50/70 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900">{reg.regional}</span>
                            <span className="text-xs font-mono tabular-nums font-bold text-[#223585]">
                              {reg.total.toLocaleString('pt-BR')}
                            </span>
                          </div>
                          <div className="mt-1 text-[10px] text-emerald-700 font-mono tabular-nums">
                            {reg.percentConcluido.toFixed(0)}% fin. ({reg.finalizadas})
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center justify-between">
                    <span>Revisões & Ofensores ({overallMetrics.comRevisao} registros)</span>
                    <button
                      type="button"
                      onClick={() => setOnlyComRevisao((prev) => !prev)}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-[6px] cursor-pointer ${
                        onlyComRevisao
                          ? 'bg-amber-600 text-white'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {onlyComRevisao ? 'Filtro Revisão Ativo' : 'Filtrar Revisões'}
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 mb-2.5">
                    {[
                      { label: 'WR', val: overallMetrics.revisoesPorTipo.wr },
                      { label: 'PIRF', val: overallMetrics.revisoesPorTipo.pirf },
                      { label: 'PPI', val: overallMetrics.revisoesPorTipo.ppi },
                      { label: 'RF Sheet', val: overallMetrics.revisoesPorTipo.rfSheet },
                    ].map((rev) => (
                      <div
                        key={rev.label}
                        className="rounded-[8px] bg-slate-50 border border-slate-200 px-2 py-1.5 text-center"
                      >
                        <div className="text-[10px] font-semibold text-slate-500">{rev.label}</div>
                        <div className="text-sm font-bold font-mono tabular-nums text-slate-900">
                          {rev.val}
                        </div>
                      </div>
                    ))}
                  </div>
                  {overallMetrics.byOffender.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {overallMetrics.byOffender.map((off) => {
                        const isSel = selectedOffender === off.ofensor;
                        return (
                          <button
                            key={off.ofensor}
                            type="button"
                            onClick={() =>
                              setSelectedOffender((prev) =>
                                prev === off.ofensor ? 'ALL' : off.ofensor
                              )
                            }
                            className={`px-2.5 py-1 rounded-[6px] text-[11px] font-semibold border cursor-pointer transition-colors ${
                              isSel
                                ? 'bg-rose-600 text-white border-rose-600'
                                : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                            }`}
                          >
                            {off.ofensor}: <span className="font-mono tabular-nums">{off.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* =====================================================================
          4. PLANILHA VIVO INTERATIVA — BARRA DE FILTROS + TABELA
         ===================================================================== */}
      <section className="bg-white rounded-[12px] border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        {/* Table Header & Controls */}
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#223585]" />
              <h3 className="text-sm font-bold text-slate-900">Planilha Vivo — Controle Geral</h3>
              <span className="px-2 py-0.5 rounded-[6px] bg-white border border-slate-200 text-xs font-mono tabular-nums font-semibold text-slate-700">
                {filteredRows.length.toLocaleString('pt-BR')}
                {hasActiveFilters ? ` / ${rows.length.toLocaleString('pt-BR')}` : ''} registros
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Density Toggle */}
              <div className="inline-flex items-center p-0.5 bg-white border border-slate-200 rounded-[8px] text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setDensity('confortavel')}
                  className={`px-2.5 py-1 rounded-[6px] cursor-pointer ${
                    density === 'confortavel'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Confortável
                </button>
                <button
                  type="button"
                  onClick={() => setDensity('compacto')}
                  className={`px-2.5 py-1 rounded-[6px] cursor-pointer ${
                    density === 'compacto'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Compacto
                </button>
              </div>

              {/* View Mode Toggle */}
              <div className="inline-flex items-center p-0.5 bg-white border border-slate-200 rounded-[8px] text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setViewMode('resumo')}
                  className={`px-2.5 py-1 rounded-[6px] cursor-pointer ${
                    viewMode === 'resumo'
                      ? 'bg-[#223585] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Resumo ({VIVO_SUMMARY_COLUMNS.length} col)
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('completa')}
                  className={`px-2.5 py-1 rounded-[6px] cursor-pointer ${
                    viewMode === 'completa'
                      ? 'bg-[#223585] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Completa ({VIVO_DOC_COLUMNS.length} col)
                </button>
              </div>
            </div>
          </div>

          {/* Search + Dropdown Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por Site Name, Executor, Tipo doc, Status, ID Register ou Comentário..."
                className="w-full pl-8 pr-8 py-1.5 rounded-[8px] bg-white border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#223585] focus:ring-2 focus:ring-[#223585]/10"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={selectedDocType}
              onChange={(e) => setSelectedDocType(e.target.value)}
              aria-label="Filtrar por Tipo de Documento"
              className="px-2.5 py-1.5 rounded-[8px] bg-white border border-slate-200 text-xs font-medium text-slate-700 focus:outline-none focus:border-[#223585]"
            >
              <option value="ALL">Tipo doc: Todos</option>
              {overallMetrics.byDocType.map((d) => (
                <option key={d.tipoDoc} value={d.tipoDoc}>
                  {d.tipoDoc} ({d.total})
                </option>
              ))}
            </select>

            <select
              value={selectedStatusExact}
              onChange={(e) => {
                setSelectedStatusGroup('ALL');
                setSelectedStatusExact(e.target.value);
              }}
              aria-label="Filtrar por Status"
              className="px-2.5 py-1.5 rounded-[8px] bg-white border border-slate-200 text-xs font-medium text-slate-700 focus:outline-none focus:border-[#223585]"
            >
              <option value="ALL">Status: Todos</option>
              {overallMetrics.byStatus.map((s) => (
                <option key={s.status} value={s.status}>
                  {s.status} ({s.count})
                </option>
              ))}
            </select>

            <select
              value={selectedExecutor}
              onChange={(e) => setSelectedExecutor(e.target.value)}
              aria-label="Filtrar por Executor"
              className="px-2.5 py-1.5 rounded-[8px] bg-white border border-slate-200 text-xs font-medium text-slate-700 focus:outline-none focus:border-[#223585] max-w-[180px]"
            >
              <option value="ALL">Executor: Todos</option>
              {overallMetrics.byExecutor.map((ex) => (
                <option key={ex.executor} value={ex.executor}>
                  {ex.executor} ({ex.total})
                </option>
              ))}
            </select>

            <select
              value={selectedRegional}
              onChange={(e) => setSelectedRegional(e.target.value)}
              aria-label="Filtrar por Regional"
              className="px-2.5 py-1.5 rounded-[8px] bg-white border border-slate-200 text-xs font-medium text-slate-700 focus:outline-none focus:border-[#223585]"
            >
              <option value="ALL">Regional: Todas</option>
              {overallMetrics.byRegional.map((r) => (
                <option key={r.regional} value={r.regional}>
                  {r.regional} ({r.total})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setOnlyOpen((p) => !p)}
              className={`px-2.5 py-1.5 rounded-[8px] text-xs font-semibold border transition-colors cursor-pointer ${
                onlyOpen
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Em Aberto
            </button>

            <button
              type="button"
              onClick={() => setOnlyComRevisao((p) => !p)}
              className={`px-2.5 py-1.5 rounded-[8px] text-xs font-semibold border transition-colors cursor-pointer ${
                onlyComRevisao
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Com Revisão
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-semibold cursor-pointer"
              >
                <Filter className="w-3 h-3" />
                <span>Limpar filtros</span>
              </button>
            )}
          </div>
          {/* Bulk Selection Action Bar (ADM, Dono & Coordenadores) */}
          {canManage && selectedRowIds.size > 0 && (
            <div className="rounded-[8px] bg-[#223585]/8 border border-[#223585]/25 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-[#223585] font-semibold">
                <span className="px-2 py-0.5 rounded bg-[#223585] text-white font-mono text-[11px]">
                  {selectedRowIds.size}
                </span>
                <span>
                  {selectedRowIds.size === 1
                    ? 'linha marcada'
                    : 'linhas marcadas'}
                </span>
                {selectedRowIds.size < filteredRows.length && (
                  <button
                    type="button"
                    onClick={() => setSelectedRowIds(new Set(filteredRows.map((r) => r.id)))}
                    className="text-[11px] underline text-[#223585] hover:text-[#16235c] cursor-pointer ml-1"
                  >
                    Selecionar todas as {filteredRows.length} filtradas
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAlterarCampoModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#223585] hover:bg-[#1a2968] text-white text-xs font-semibold cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Alterar campo</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRowIds(new Set())}
                  className="px-2.5 py-1.5 rounded-[8px] bg-white border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600 cursor-pointer"
                >
                  Limpar seleção
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Table Area */}
        <div className="overflow-x-auto max-h-[560px]">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-xs border-b border-slate-200">
              <tr>
                {canManage && (
                  <th className="px-2.5 py-2.5 w-9 text-center">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todas as linhas da página"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAllOnPage}
                      className="rounded border-slate-300 text-[#223585] focus:ring-[#223585] cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap w-10 text-center">
                  #
                </th>
                {visibleColumns.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap text-right sticky right-0 z-20 bg-slate-100 border-l border-slate-200 shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.08)]">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[13px]">
              {paginatedRows.map((row, idx) => {
                  const rowNum = (safePage - 1) * pageSize + idx + 1;
                  const statusGroup = classifyVivoStatus(row.status);
                  const stStyle = STATUS_BADGE_STYLES[statusGroup];
                  const isDrawerOpen = selectedRow?.id === row.id;
                  const isChecked = selectedRowIds.has(row.id);
                  const cellPad = density === 'compacto' ? 'px-3 py-1.5' : 'px-3 py-2.5';

                  return (
                    <tr
                      key={row.id}
                      onClick={() => handleOpenRow(row)}
                      className={`group transition-colors cursor-pointer ${
                        isChecked
                          ? 'bg-[#EEF2FA]'
                          : isDrawerOpen
                          ? 'bg-[#F5F0FA]'
                          : idx % 2 === 1
                          ? 'bg-[#F8FAFC] hover:bg-slate-100'
                          : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      {canManage && (
                        <td
                          className="px-2.5 py-1.5 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${row.siteName || row.id}`}
                            checked={isChecked}
                            onChange={() => toggleSelectRow(row.id)}
                            className="rounded border-slate-300 text-[#223585] focus:ring-[#223585] cursor-pointer"
                          />
                        </td>
                      )}

                      <td
                        className={`${cellPad} text-[11px] font-mono tabular-nums text-slate-400 text-center border-l-2 ${
                          isDrawerOpen ? 'border-l-[#660099]' : 'border-l-transparent'
                        }`}
                      >
                        {rowNum}
                      </td>

                      {visibleColumns.map((col) => {
                        const val = getFieldVal(row, col);
                        const editable = canEditCell(row, col);
                        const isEditingThis =
                          editingCell?.rowId === row.id && editingCell?.col === col;
                        const isSavingThis = savingCellKey === `${row.id}::${col}`;

                        // Render active inline editor for this cell
                        if (isEditingThis && editable) {
                          return (
                            <td
                              key={col}
                              className="px-2 py-1 whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {col === 'EXECUTOR' ? (
                                <select
                                  autoFocus
                                  aria-label={`Editar Executor de ${row.siteName}`}
                                  value={editingCell.value}
                                  onChange={(e) =>
                                    commitInlineCellEdit(row, col, e.target.value)
                                  }
                                  onBlur={() => setEditingCell(null)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') setEditingCell(null);
                                  }}
                                  className="px-2 py-1 rounded-[6px] border border-[#660099] bg-white text-xs text-slate-900 focus:outline-none min-w-[160px]"
                                >
                                  <option value="">— Sem executor (remover)</option>
                                  {editingCell.value &&
                                    !executorUsers.some(
                                      (u) =>
                                        u.name.toLowerCase() ===
                                        editingCell.value.toLowerCase()
                                    ) && (
                                      <option value={editingCell.value}>
                                        {editingCell.value}
                                      </option>
                                    )}
                                  {executorUsers.map((u) => (
                                    <option key={u.id || u.email || u.name} value={u.name}>
                                      {u.name}
                                    </option>
                                  ))}
                                </select>
                              ) : DATE_INLINE_COLUMNS.has(col) ? (
                                <input
                                  autoFocus
                                  type="date"
                                  aria-label={`Editar ${col} de ${row.siteName}`}
                                  value={editingCell.value}
                                  onChange={(e) => {
                                    setEditingCell({ ...editingCell, value: e.target.value });
                                    commitInlineCellEdit(row, col, e.target.value);
                                  }}
                                  onBlur={() => setEditingCell(null)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') setEditingCell(null);
                                  }}
                                  className="px-2 py-1 rounded-[6px] border border-[#660099] bg-white text-xs font-mono text-slate-900 focus:outline-none"
                                />
                              ) : LIST_INLINE_COLUMNS.has(col) ? (
                                <select
                                  autoFocus
                                  aria-label={`Editar ${col} de ${row.siteName}`}
                                  value={editingCell.value}
                                  onChange={(e) =>
                                    commitInlineCellEdit(row, col, e.target.value)
                                  }
                                  onBlur={() => setEditingCell(null)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') setEditingCell(null);
                                  }}
                                  className="px-2 py-1 rounded-[6px] border border-[#660099] bg-white text-xs text-slate-900 focus:outline-none min-w-[130px]"
                                >
                                  {col !== 'Tipo doc' && (
                                    <option value="">— Vazio —</option>
                                  )}
                                  {(() => {
                                    const baseOpts =
                                      col === 'Tipo doc'
                                        ? [...VIVO_TIPO_DOC_OPTIONS]
                                        : col === 'Status'
                                        ? statusOptions
                                        : col === 'Regional'
                                        ? regionalOptions
                                        : prioridadeOptions;
                                    const withCurrent =
                                      editingCell.value &&
                                      !baseOpts.some(
                                        (o) =>
                                          o.toLowerCase() ===
                                          editingCell.value.toLowerCase()
                                      )
                                        ? [editingCell.value, ...baseOpts]
                                        : baseOpts;
                                    return withCurrent.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ));
                                  })()}
                                </select>
                              ) : (
                                <input
                                  autoFocus
                                  type="text"
                                  aria-label={`Editar ${col} de ${row.siteName}`}
                                  value={editingCell.value}
                                  onChange={(e) =>
                                    setEditingCell({ ...editingCell, value: e.target.value })
                                  }
                                  onBlur={() =>
                                    commitInlineCellEdit(row, col, editingCell.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      commitInlineCellEdit(row, col, editingCell.value);
                                    } else if (e.key === 'Escape') {
                                      setEditingCell(null);
                                    }
                                  }}
                                  className="px-2 py-1 rounded-[6px] border border-[#660099] bg-white text-xs text-slate-900 focus:outline-none min-w-[220px]"
                                />
                              )}
                            </td>
                          );
                        }

                        const startInlineEdit = (e: React.MouseEvent) => {
                          if (!editable || isSavingThis) return;
                          e.stopPropagation();
                          setEditingCell({
                            rowId: row.id,
                            col,
                            value: DATE_INLINE_COLUMNS.has(col)
                              ? brDateToIsoInput(val)
                              : val,
                          });
                        };

                        const editableCellClass = editable
                          ? 'hover:bg-[#660099]/5 hover:outline hover:outline-1 hover:outline-[#660099]/30 rounded-[4px] cursor-text'
                          : '';

                        if (col === '00.02.Site Name') {
                          return (
                            <td
                              key={col}
                              className={`${cellPad} font-mono tabular-nums font-bold text-[#223585] whitespace-nowrap`}
                            >
                              {val || '—'}
                            </td>
                          );
                        }

                        if (col === 'Tipo doc') {
                          return (
                            <td
                              key={col}
                              onClick={startInlineEdit}
                              title={editable ? 'Clique para editar Tipo doc' : val}
                              className={`${cellPad} whitespace-nowrap ${editableCellClass}`}
                            >
                              {isSavingThis ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#660099]" />
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-semibold">
                                  {val || '—'}
                                </span>
                              )}
                            </td>
                          );
                        }

                        if (col === 'Status') {
                          return (
                            <td
                              key={col}
                              onClick={startInlineEdit}
                              title={editable ? 'Clique para editar Status' : val}
                              className={`${cellPad} whitespace-nowrap ${editableCellClass}`}
                            >
                              {isSavingThis ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#660099]" />
                              ) : (
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${stStyle.bg} ${stStyle.text} ${stStyle.border}`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${stStyle.dot}`} />
                                  {val || 'Sem Status'}
                                </span>
                              )}
                            </td>
                          );
                        }

                        if (
                          col === 'SLA DOC' ||
                          col === 'Entregue Week' ||
                          col === 'Demanda' ||
                          col === 'Planejado' ||
                          col === 'REPLAN' ||
                          col === 'DATA REPLAN' ||
                          col === 'Entregue' ||
                          col === 'FATURAMENTO'
                        ) {
                          return (
                            <td
                              key={col}
                              onClick={startInlineEdit}
                              title={editable ? `Clique para editar ${col}` : val}
                              className={`${cellPad} font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap ${editableCellClass}`}
                            >
                              {isSavingThis ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#660099]" />
                              ) : col === 'FATURAMENTO' && val ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] bg-teal-50 text-teal-700 border border-teal-200 font-semibold text-[11px]">
                                  {val}
                                </span>
                              ) : (
                                val || <span className="text-slate-300">—</span>
                              )}
                            </td>
                          );
                        }

                        if (col === 'Comentário STATUS' || col === 'Descrição') {
                          return (
                            <td
                              key={col}
                              onClick={startInlineEdit}
                              className={`${cellPad} text-xs text-slate-600 max-w-[280px] truncate ${editableCellClass}`}
                              title={
                                editable
                                  ? `${val ? `${val}\n` : ''}(Clique para editar)`
                                  : val
                              }
                            >
                              {isSavingThis ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#660099]" />
                              ) : val ? (
                                val.replace(/\s+/g, ' ')
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          );
                        }

                        return (
                          <td
                            key={col}
                            onClick={startInlineEdit}
                            className={`${cellPad} text-xs text-slate-700 whitespace-nowrap max-w-[200px] truncate ${editableCellClass}`}
                            title={editable ? `Clique para editar ${col}` : val}
                          >
                            {isSavingThis ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#660099]" />
                            ) : (
                              val || <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}

                      <td
                        className={`${cellPad} text-right whitespace-nowrap sticky right-0 z-10 border-l border-slate-200/80 shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.06)] ${
                          isChecked
                            ? 'bg-[#EEF2FA]'
                            : isDrawerOpen
                            ? 'bg-[#F5F0FA]'
                            : idx % 2 === 1
                            ? 'bg-[#F8FAFC] group-hover:bg-slate-100'
                            : 'bg-white group-hover:bg-slate-50'
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => handleOpenRow(row, 'detalhes')}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] text-[11px] font-semibold text-[#223585] hover:bg-[#223585]/10 transition-colors cursor-pointer"
                          title="Ver detalhes, editar ou consultar histórico"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Detalhes</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {paginatedRows.length === 0 && (
          <div className="px-6 py-12 text-center text-slate-500 border-t border-slate-100">
            <div className="space-y-2.5">
              <p className="text-sm font-semibold text-slate-700">
                {rows.length === 0
                  ? 'Nenhuma atividade cadastrada ainda em Atividades Vivo.'
                  : 'Nenhuma atividade encontrada para os filtros selecionados.'}
              </p>
              {rows.length === 0 && canManage ? (
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowNovoRegistroModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] bg-[#660099] hover:bg-[#52007a] text-white text-xs font-semibold cursor-pointer"
                  >
                    <span>+ Novo registro</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEntradaRapidaModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] bg-[#223585] hover:bg-[#1a2968] text-white text-xs font-semibold cursor-pointer"
                  >
                    <ListPlus className="w-3.5 h-3.5" />
                    <span>Adicionar vários</span>
                  </button>
                </div>
              ) : (
                hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="mt-2 px-3 py-1.5 rounded-[8px] bg-[#223585] text-white text-xs font-semibold cursor-pointer"
                  >
                    Limpar filtros
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* Pagination Bar */}
        <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span>
              Mostrando{' '}
              <strong className="font-mono tabular-nums text-slate-900">
                {filteredRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1}
              </strong>{' '}
              a{' '}
              <strong className="font-mono tabular-nums text-slate-900">
                {Math.min(safePage * pageSize, filteredRows.length)}
              </strong>{' '}
              de{' '}
              <strong className="font-mono tabular-nums text-slate-900">
                {filteredRows.length.toLocaleString('pt-BR')}
              </strong>
            </span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              aria-label="Linhas por página"
              className="px-2 py-1 rounded-[6px] bg-white border border-slate-200 text-xs font-mono tabular-nums"
            >
              <option value={50}>50 / pág</option>
              <option value={100}>100 / pág</option>
              <option value={200}>200 / pág</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 font-semibold cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Anterior</span>
            </button>
            <span className="px-2 font-mono tabular-nums font-semibold text-slate-800">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 font-semibold cursor-pointer"
            >
              <span>Próxima</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* =====================================================================
          5. ROW DETAIL, EDIT & HISTÓRICO SLIDE-OVER DRAWER
         ===================================================================== */}
      {selectedRow && editDraft && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex justify-end"
          onClick={() => setSelectedRowId(null)}
        >
          <div
            className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-[6px] bg-[#660099]/10 text-[#660099] text-[10px] font-bold uppercase">
                      Ericsson · Vivo
                    </span>
                    <span className="px-2 py-0.5 rounded-[6px] bg-slate-200/70 text-slate-700 text-[10px] font-semibold">
                      {selectedRow.tipoDoc}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 font-mono tabular-nums mt-1 truncate">
                    {selectedRow.siteName || 'Sem Site Name'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Regional: <strong>{selectedRow.regional || '—'}</strong> · Executor:{' '}
                    <strong>{selectedRow.executor || 'Sem Executor'}</strong>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(canManage || (isExecutorRole && isExecutorOwnerOfRow(selectedRow, user))) &&
                    drawerTab === 'detalhes' &&
                    !isEditingRow && (
                      <button
                        type="button"
                        onClick={() => setIsEditingRow(true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-[#223585] text-white text-xs font-semibold hover:bg-[#1a2968] cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Editar</span>
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() => setSelectedRowId(null)}
                    className="p-1.5 rounded-[8px] text-slate-500 hover:bg-slate-200/70 cursor-pointer"
                    aria-label="Fechar detalhes"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Drawer Sub-Nav: Detalhes | Histórico */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setDrawerTab('detalhes')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors cursor-pointer ${
                    drawerTab === 'detalhes'
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Detalhes</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingRow(false);
                    setDrawerTab('historico');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors cursor-pointer ${
                    drawerTab === 'historico'
                      ? 'bg-[#660099] text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>
                    Histórico ({(selectedRow.history || []).length})
                  </span>
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {drawerTab === 'historico' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Últimas alterações da linha (máximo 20 registros)</span>
                    {selectedRow.createdBy && (
                      <span>
                        Criado por <strong className="text-slate-700">{selectedRow.createdBy}</strong>
                      </span>
                    )}
                  </div>

                  {!selectedRow.history || selectedRow.history.length === 0 ? (
                    <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                      Nenhuma alteração registrada ainda para esta linha.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {selectedRow.history.slice(0, 20).map((entry, idx) => {
                        const badgeMeta =
                          entry.acao === 'criacao'
                            ? { label: 'Criação', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
                            : entry.acao === 'demanda'
                            ? { label: 'Demanda', cls: 'bg-violet-50 text-violet-700 border-violet-200' }
                            : entry.acao === 'remocao_demanda'
                            ? { label: 'Remoção de demanda', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
                            : { label: 'Edição', cls: 'bg-blue-50 text-blue-700 border-blue-200' };

                        return (
                          <div
                            key={`${entry.quando}_${entry.campo}_${idx}`}
                            className="rounded-[10px] border border-slate-200 bg-white p-3 space-y-1.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-2 py-0.5 rounded border text-[10px] font-bold ${badgeMeta.cls}`}
                                >
                                  {badgeMeta.label}
                                </span>
                                <span className="text-xs font-bold text-slate-800">
                                  {entry.campo}
                                </span>
                              </div>
                              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                                {formatHistoryDateTime(entry.quando)}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 line-through">
                                {entry.antes || '(vazio)'}
                              </span>
                              <span className="text-slate-400">→</span>
                              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-semibold">
                                {entry.depois || '(vazio)'}
                              </span>
                            </div>

                            <div className="text-[11px] text-slate-500">
                              Por: <strong className="text-slate-700">{entry.quem}</strong>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : isEditingRow ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                        Status
                      </label>
                      <select
                        value={editDraft.status}
                        onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value })}
                        className="w-full px-3 py-2 rounded-[8px] border border-slate-200 bg-white text-xs focus:outline-none focus:border-[#223585]"
                      >
                        <option value="">Sem status</option>
                        {statusOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>

                    {canManage && (
                      <>
                        <div>
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            Tipo doc
                          </label>
                          <select
                            value={editDraft.tipoDoc}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, tipoDoc: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-[8px] border border-slate-200 bg-white text-xs focus:outline-none focus:border-[#223585]"
                          >
                            {VIVO_TIPO_DOC_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            Regional
                          </label>
                          <input
                            type="text"
                            list="drawer-regional-opts"
                            value={editDraft.regional}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, regional: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs focus:outline-none focus:border-[#223585]"
                          />
                          <datalist id="drawer-regional-opts">
                            {regionalOptions.map((opt) => (
                              <option key={opt} value={opt} />
                            ))}
                          </datalist>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            Prioridade
                          </label>
                          <select
                            value={editDraft.prioridade}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, prioridade: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-[8px] border border-slate-200 bg-white text-xs focus:outline-none focus:border-[#223585]"
                          >
                            <option value="">Sem prioridade</option>
                            {prioridadeOptions.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            Executor
                          </label>
                          <select
                            value={editDraft.executor}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, executor: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-[8px] border border-slate-200 bg-white text-xs focus:outline-none focus:border-[#223585]"
                          >
                            <option value="">— Sem executor (remover demanda)</option>
                            {editDraft.executor &&
                              !executorUsers.some(
                                (u) =>
                                  u.name.toLowerCase() === editDraft.executor.toLowerCase()
                              ) && (
                                <option value={editDraft.executor}>{editDraft.executor}</option>
                              )}
                            {executorUsers.map((u) => (
                              <option key={u.id || u.email || u.name} value={u.name}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            Planejado
                          </label>
                          <input
                            type="date"
                            value={editDraft.planejado}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, planejado: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs font-mono focus:outline-none focus:border-[#223585]"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            Entregue
                          </label>
                          <input
                            type="date"
                            value={editDraft.entregue}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, entregue: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs font-mono focus:outline-none focus:border-[#223585]"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            REPLAN
                          </label>
                          <input
                            type="date"
                            value={editDraft.replan}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, replan: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs font-mono focus:outline-none focus:border-[#223585]"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            DATA REPLAN
                          </label>
                          <input
                            type="date"
                            value={editDraft.dataReplan}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, dataReplan: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs font-mono focus:outline-none focus:border-[#223585]"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            Faturamento
                          </label>
                          <input
                            type="text"
                            value={editDraft.faturamento}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, faturamento: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs font-mono focus:outline-none focus:border-[#223585]"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            Ofensor
                          </label>
                          <input
                            type="text"
                            value={editDraft.ofensor}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, ofensor: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs focus:outline-none focus:border-[#223585]"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                      Comentário STATUS
                    </label>
                    <textarea
                      rows={5}
                      value={editDraft.comentarioStatus}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, comentarioStatus: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs focus:outline-none focus:border-[#223585]"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingRow(false)}
                      className="px-3 py-1.5 rounded-[8px] border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={savingRow}
                      onClick={handleSaveRowEdit}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] bg-[#1E8E8D] hover:bg-[#177372] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{savingRow ? 'Salvando...' : 'Salvar Alterações'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Main status & dates summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {[
                      { label: 'Status', value: selectedRow.status || '—' },
                      { label: 'Prioridade', value: selectedRow.prioridade || '—' },
                      { label: 'Demanda', value: selectedRow.demanda || '—', mono: true },
                      { label: 'Planejado', value: selectedRow.planejado || '—', mono: true },
                      { label: 'REPLAN', value: selectedRow.replan || '—', mono: true },
                      { label: 'DATA REPLAN', value: selectedRow.dataReplan || '—', mono: true },
                      { label: 'Entregue', value: selectedRow.entregue || '—', mono: true },
                      { label: 'SLA DOC', value: selectedRow.slaDoc || '—', mono: true },
                      { label: 'Faturamento', value: selectedRow.faturamento || '—', mono: true },
                    ].map((f) => (
                      <div
                        key={f.label}
                        className="rounded-[8px] bg-slate-50 border border-slate-200/80 p-2.5"
                      >
                        <div className="text-[10px] font-bold uppercase text-slate-400">
                          {f.label}
                        </div>
                        <div
                          className={`text-xs font-semibold text-slate-800 mt-0.5 break-words ${
                            f.mono ? 'font-mono tabular-nums' : ''
                          }`}
                        >
                          {f.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Comentário STATUS */}
                  <div className="rounded-[10px] border border-slate-200 bg-white p-3.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                      Comentário STATUS
                    </div>
                    {selectedRow.comentarioStatus ? (
                      <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                        {selectedRow.comentarioStatus}
                      </pre>
                    ) : (
                      <p className="text-xs text-slate-400 italic">Sem comentários registrados.</p>
                    )}
                  </div>

                  {/* All 46 Columns Inspection */}
                  <div className="rounded-[10px] border border-slate-200 bg-white overflow-hidden">
                    <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                      Todos os Campos ({VIVO_DOC_COLUMNS.length} colunas)
                    </div>
                    <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                      {VIVO_DOC_COLUMNS.map((col) => {
                        const val = getFieldVal(selectedRow, col);
                        if (!val) return null;
                        return (
                          <div
                            key={col}
                            className="px-3.5 py-2 flex items-start justify-between gap-4 text-xs"
                          >
                            <span className="font-semibold text-slate-500 shrink-0">{col}</span>
                            <span className="text-slate-800 text-right whitespace-pre-wrap break-words">
                              {val}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Drawer Footer (Single-row delete strictly for Coordenação & ADM) */}
            {canManage && !isEditingRow && (
              <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                {confirmDeleteId === selectedRow.id ? (
                  <div className="flex items-center gap-2 w-full justify-between">
                    <span className="text-xs font-semibold text-rose-700">
                      Confirmar exclusão desta única linha?
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-1 rounded-[6px] bg-white border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSingleRow(selectedRow.id)}
                        className="px-2.5 py-1 rounded-[6px] bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 cursor-pointer"
                      >
                        Excluir Linha
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(selectedRow.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-rose-600 hover:bg-rose-50 text-xs font-semibold cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Excluir esta linha</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          6. CARGA INICIAL MODAL (ONLY ADM & DONO — FILE IMPORT + PASTE)
         ===================================================================== */}
      {isAdminOrOwner && showImportModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => !importing && setShowImportModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="carga-inicial-modal-title"
        >
          <div
            className="w-full max-w-xl bg-white rounded-[12px] shadow-2xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 id="carga-inicial-modal-title" className="text-base font-bold text-slate-900">
                  Carga inicial — Atividades Vivo (Somente Acrescentar)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Disponível apenas para ADM e Dono. Nunca apaga dados existentes; grava exclusivamente em <strong>ericsson_vivo</strong>.
                </p>
              </div>
              <button
                type="button"
                disabled={importing}
                onClick={() => setShowImportModal(false)}
                aria-label="Fechar modal de carga inicial"
                className="p-1.5 rounded-[8px] text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs: Arquivo | Colar */}
            <div className="px-5 pt-3 border-b border-slate-200 flex items-center gap-2 bg-slate-50/70">
              <button
                type="button"
                onClick={() => {
                  setCargaTab('arquivo');
                  setImportError(null);
                  setImportPreview(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  cargaTab === 'arquivo'
                    ? 'border-[#223585] text-[#223585]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>1. Importar arquivo (.CSV / .XLSX)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCargaTab('colar');
                  setImportError(null);
                  setImportPreview(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  cargaTab === 'colar'
                    ? 'border-[#660099] text-[#660099]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>2. Colar tabela (Ctrl+V)</span>
              </button>
            </div>

            <div className="p-5 space-y-4">
              {cargaTab === 'arquivo' ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-[#223585] rounded-[10px] p-6 text-center cursor-pointer transition-colors bg-slate-50/60"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleSelectImportFile}
                    className="hidden"
                  />
                  <Upload className="w-7 h-7 text-[#223585] mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-800">
                    {importFileName || 'Clique para selecionar arquivo .CSV ou .XLSX da Vivo'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Detecção automática de cabeçalho (linha 1 ou 2), separador (;) e acentuação CP850/UTF-8.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label
                    htmlFor="carga-inicial-paste"
                    className="block text-[11px] font-bold uppercase tracking-wider text-slate-600"
                  >
                    Cole linhas copiadas do Excel ou CSV (com cabeçalho)
                  </label>
                  <textarea
                    id="carga-inicial-paste"
                    rows={7}
                    value={pastedTableText}
                    onChange={(e) => handleParsePastedTable(e.target.value)}
                    placeholder="Cole aqui usando Ctrl+V..."
                    className="w-full px-3 py-2 rounded-[8px] border border-slate-300 font-mono text-xs text-slate-800 focus:outline-none focus:border-[#660099]"
                  />
                </div>
              )}

              {importError && (
                <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-700 font-medium">
                  {importError}
                </div>
              )}

              {importPreview && (
                <div className="rounded-[10px] border border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-800">
                      Prévia Pronta para Carga Inicial
                    </span>
                    <span className="font-mono tabular-nums font-bold text-emerald-700">
                      +{importPreview.rows.length.toLocaleString('pt-BR')} atividades
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    Colunas detectadas: <strong>{importPreview.columns.length}</strong> · Cabeçalho na linha{' '}
                    <strong>{importPreview.headerRowIndex + 1}</strong>
                  </div>
                </div>
              )}

              {importProgress && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-600">
                    <span>Gravando registros Vivo no Firestore...</span>
                    <span>
                      {importProgress.gravados} / {importProgress.total}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-[#1E8E8D] transition-all"
                      style={{
                        width: `${Math.round(
                          (importProgress.gravados / Math.max(1, importProgress.total)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={importing}
                onClick={() => setShowImportModal(false)}
                className="px-3.5 py-2 rounded-[8px] border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={importing || !importPreview}
                onClick={handleConfirmAppendImport}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#223585] hover:bg-[#1a2968] text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>
                  {importing
                    ? 'Gravando...'
                    : `Gravar ${
                        importPreview ? importPreview.rows.length.toLocaleString('pt-BR') : ''
                      } Linhas`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          7. GENERIC REUSABLE ENTRY MODALS (src/components/entry/)
         ===================================================================== */}
      {canManage && (
        <>
          <NovoRegistroModal
            isOpen={showNovoRegistroModal}
            config={VIVO_SHEET_ENTRY_CONFIG}
            existingRows={rows}
            executorUsers={executorUsers}
            actorName={actorName}
            onClose={() => setShowNovoRegistroModal(false)}
            onOpenExisting={(existingRow) =>
              handleOpenRow(existingRow as VivoActivityRow, 'detalhes')
            }
            onSubmit={handleCreateSingleRegistro}
          />

          <EntradaRapidaModal
            isOpen={showEntradaRapidaModal}
            config={VIVO_SHEET_ENTRY_CONFIG}
            existingRows={rows}
            executorUsers={executorUsers}
            onClose={() => setShowEntradaRapidaModal(false)}
            onSubmit={handleCreateEntradaRapida}
          />

          <AlterarCampoModal
            isOpen={showAlterarCampoModal}
            config={VIVO_SHEET_ENTRY_CONFIG}
            selectedRows={selectedRowsList}
            existingRows={rows}
            executorUsers={executorUsers}
            onClose={() => setShowAlterarCampoModal(false)}
            onSubmit={handleBulkAlterarCampo}
          />
        </>
      )}
    </div>
  );
};
