import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  Filter,
  Layers,
  MapPin,
  Receipt,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  X,
  Check,
  Edit3,
  Eye,
  AlertCircle,
  Calendar,
  Plus,
} from 'lucide-react';
import {
  AmetaUser,
  UserRole,
  VIVO_DOC_COLUMNS,
  VIVO_SUMMARY_COLUMNS,
  VivoActivityRow,
  VivoSheetMeta,
  hasFullSpreadsheetAccess,
} from '../types/telecom';
import {
  VIVO_DEFAULT_CSV_ASSET_URL,
  VIVO_DEFAULT_CSV_FILENAME,
  VivoStatusGroup,
  classifyVivoStatus,
  computeVivoDashboardMetrics,
  exportVivoRowsToXlsx,
  hasVivoRevision,
  isVivoFaturado,
  parseVivoCsvBuffer,
  parseVivoSpreadsheetFile,
  ParsedVivoImportResult,
} from '../utils/vivoSpreadsheetUtils';
import { dataService } from '../services/dataService';
import { QuickAcionamentoModal } from './QuickAcionamentoModal';
import {
  QuickAcionamentoDraft,
  buildVivoActivityRecord,
} from '../utils/quickAcionamentoUtils';

const VIVO_LOCAL_STORAGE_KEY = 'ameta_ericsson_vivo_rows_v1';

interface VivoActivitiesTabProps {
  user: AmetaUser;
  effectiveRole: UserRole;
  firestoreRows: VivoActivityRow[];
  sheetMeta: VivoSheetMeta | null;
  onShowToast: (msg: string) => void;
}

type AnalyticsSubTab = 'status' | 'executors' | 'weeks' | 'regional';
type TableViewMode = 'resumo' | 'completa';
type DensityMode = 'confortavel' | 'compacto';

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
  onShowToast,
}) => {
  const canManage = hasFullSpreadsheetAccess(effectiveRole);

  // Local fallback / instant seed rows when Firestore is empty or rules not yet deployed
  const [localRows, setLocalRows] = useState<VivoActivityRow[]>(() => {
    try {
      const raw = localStorage.getItem(VIVO_LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore storage read error
    }
    return [];
  });
  const [loadingBase, setLoadingBase] = useState(false);
  const [baseLoadError, setBaseLoadError] = useState<string | null>(null);
  const hasAttemptedSeedRef = useRef(false);

  // Use Firestore rows as source of truth when available, else local parsed dataset
  const rows: VivoActivityRow[] = useMemo(() => {
    if (firestoreRows && firestoreRows.length > 0) {
      return [...firestoreRows].sort(
        (a, b) => (a.rowNumberInFile ?? 999999) - (b.rowNumberInFile ?? 999999)
      );
    }
    return localRows;
  }, [firestoreRows, localRows]);

  // Persist local snapshot cleanly (when small/medium or on updates)
  const saveLocalCache = (nextRows: VivoActivityRow[]) => {
    setLocalRows(nextRows);
    try {
      localStorage.setItem(VIVO_LOCAL_STORAGE_KEY, JSON.stringify(nextRows));
    } catch {
      // Quota exceeded on large localStorage — keep in memory smoothly
    }
  };

  // Auto-load the attached Vivo CSV immediately if Firestore is empty
  useEffect(() => {
    if (firestoreRows.length > 0) return;
    if (localRows.length > 0) return;
    if (hasAttemptedSeedRef.current) return;
    hasAttemptedSeedRef.current = true;

    let cancelled = false;
    const loadAttachedCsv = async () => {
      setLoadingBase(true);
      setBaseLoadError(null);
      try {
        const resp = await fetch(VIVO_DEFAULT_CSV_ASSET_URL);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const buffer = await resp.arrayBuffer();
        const parsed = parseVivoCsvBuffer(buffer, {
          fileName: VIVO_DEFAULT_CSV_FILENAME,
          deterministicPrefix: 'vivo_base',
          updatedBy: user?.name || user?.email || 'Carga Inicial Vivo',
        });
        if (cancelled) return;
        saveLocalCache(parsed.rows);

        // Background idempotent sync to Firestore if collection hasn't been seeded yet
        if (!sheetMeta?.baseLoaded && parsed.rows.length > 0) {
          dataService
            .importarVivoAtividadesEmLote(parsed.rows, {
              fileName: VIVO_DEFAULT_CSV_FILENAME,
              columns: parsed.columns,
              baseLoaded: true,
              skipHistory: true,
            })
            .catch(() => {
              // Silent fallback to local cache when offline or before rules deployment
            });
        }
      } catch (err: any) {
        if (!cancelled) {
          setBaseLoadError(err?.message || 'Não foi possível carregar a planilha Vivo anexada.');
        }
      } finally {
        if (!cancelled) setLoadingBase(false);
      }
    };

    loadAttachedCsv();
    return () => {
      cancelled = true;
    };
  }, [firestoreRows.length, localRows.length, sheetMeta?.baseLoaded, user?.name, user?.email]);

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

  // Detail & Edit Drawer
  const [selectedRow, setSelectedRow] = useState<VivoActivityRow | null>(null);
  const [isEditingRow, setIsEditingRow] = useState(false);
  const [editDraft, setEditDraft] = useState<{
    status: string;
    executor: string;
    prioridade: string;
    planejado: string;
    entregue: string;
    faturamento: string;
    ofensor: string;
    comentarioStatus: string;
  } | null>(null);
  const [savingRow, setSavingRow] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Import Modal (Append-Only)
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState<ParsedVivoImportResult | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ gravados: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);

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

  // Open row drawer
  const handleOpenRow = (row: VivoActivityRow) => {
    setSelectedRow(row);
    setIsEditingRow(false);
    setConfirmDeleteId(null);
    setEditDraft({
      status: row.status || '',
      executor: row.executor || '',
      prioridade: row.prioridade || '',
      planejado: row.planejado || '',
      entregue: row.entregue || '',
      faturamento: row.faturamento || '',
      ofensor: row.ofensor || '',
      comentarioStatus: row.comentarioStatus || '',
    });
  };

  const handleSaveRowEdit = async () => {
    if (!selectedRow || !editDraft) return;
    setSavingRow(true);
    const updated: VivoActivityRow = {
      ...selectedRow,
      status: editDraft.status.trim(),
      executor: editDraft.executor.trim(),
      prioridade: editDraft.prioridade.trim(),
      planejado: editDraft.planejado.trim(),
      entregue: editDraft.entregue.trim(),
      faturamento: editDraft.faturamento.trim(),
      ofensor: editDraft.ofensor.trim(),
      comentarioStatus: editDraft.comentarioStatus.trim(),
      fields: {
        ...(selectedRow.fields || {}),
        Status: editDraft.status.trim(),
        EXECUTOR: editDraft.executor.trim(),
        Prioridade: editDraft.prioridade.trim(),
        Planejado: editDraft.planejado.trim(),
        Entregue: editDraft.entregue.trim(),
        FATURAMENTO: editDraft.faturamento.trim(),
        Ofensor: editDraft.ofensor.trim(),
        'Comentário STATUS': editDraft.comentarioStatus.trim(),
      },
      updatedAt: new Date().toISOString(),
      updatedBy: user?.name || user?.email || 'Usuário',
    };

    try {
      await dataService.salvarVivoAtividade(updated);
      onShowToast(`Atividade ${updated.siteName || updated.id} atualizada com sucesso.`);
    } catch {
      // Fallback local persistence
      onShowToast(`Atividade ${updated.siteName || updated.id} atualizada localmente.`);
    } finally {
      // Update local state immediately so UI reflects edit without delay
      if (firestoreRows.length === 0) {
        saveLocalCache(localRows.map((r) => (r.id === updated.id ? updated : r)));
      }
      setSelectedRow(updated);
      setIsEditingRow(false);
      setSavingRow(false);
    }
  };

  const handleDeleteSingleRow = async (rowId: string) => {
    try {
      await dataService.excluirVivoAtividade(rowId);
      onShowToast('Registro Vivo excluído.');
    } catch {
      onShowToast('Registro Vivo removido localmente.');
    } finally {
      if (firestoreRows.length === 0) {
        saveLocalCache(localRows.filter((r) => r.id !== rowId));
      }
      setSelectedRow(null);
      setConfirmDeleteId(null);
    }
  };

  // File pick for Append-Only Import
  const handleSelectImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportFileName(file.name);
    try {
      const parsed = await parseVivoSpreadsheetFile(file, {
        updatedBy: user?.name || user?.email || 'Importação Manual Vivo',
      });
      if (parsed.rows.length === 0) {
        setImportError('Nenhuma linha com dados foi encontrada neste arquivo.');
        setImportPreview(null);
      } else {
        setImportPreview(parsed);
      }
    } catch (err: any) {
      setImportError(err?.message || 'Erro ao ler o arquivo selecionado.');
      setImportPreview(null);
    }
  };

  const handleConfirmAppendImport = async () => {
    if (!importPreview || importPreview.rows.length === 0) return;
    setImporting(true);
    setImportProgress({ gravados: 0, total: importPreview.rows.length });
    try {
      await dataService.importarVivoAtividadesEmLote(importPreview.rows, {
        fileName: importFileName,
        columns: importPreview.columns,
        onProgress: (info) => setImportProgress({ gravados: info.gravados, total: info.total }),
      });
      onShowToast(
        `${importPreview.rows.length.toLocaleString('pt-BR')} atividades Vivo adicionadas à base com sucesso.`
      );
    } catch {
      // Append locally if Firestore rules are pending
      saveLocalCache([...rows, ...importPreview.rows]);
      onShowToast(
        `${importPreview.rows.length.toLocaleString('pt-BR')} atividades Vivo adicionadas à visualização local.`
      );
    } finally {
      setImporting(false);
      setImportProgress(null);
      setShowImportModal(false);
      setImportPreview(null);
      setImportFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReloadBaseCsv = async () => {
    setLoadingBase(true);
    setBaseLoadError(null);
    try {
      const resp = await fetch(VIVO_DEFAULT_CSV_ASSET_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer = await resp.arrayBuffer();
      const parsed = parseVivoCsvBuffer(buffer, {
        fileName: VIVO_DEFAULT_CSV_FILENAME,
        deterministicPrefix: 'vivo_base',
        updatedBy: user?.name || user?.email || 'Sincronização Vivo',
      });
      saveLocalCache(parsed.rows);
      try {
        await dataService.importarVivoAtividadesEmLote(parsed.rows, {
          fileName: VIVO_DEFAULT_CSV_FILENAME,
          columns: parsed.columns,
          baseLoaded: true,
          skipHistory: true,
        });
      } catch {
        // Firestore fallback already handled
      }
      onShowToast(
        `Planilha Vivo recarregada: ${parsed.rows.length.toLocaleString('pt-BR')} atividades.`
      );
    } catch (err: any) {
      setBaseLoadError(err?.message || 'Falha ao recarregar planilha Vivo.');
    } finally {
      setLoadingBase(false);
    }
  };

  const handleCreateQuickVivoAcionamentos = async (drafts: QuickAcionamentoDraft[]) => {
    const minRowNum = rows.reduce(
      (min, r) => (typeof r.rowNumberInFile === 'number' && r.rowNumberInFile < min ? r.rowNumberInFile : min),
      0
    );
    const updatedBy = (user?.email || user?.name || '').trim() || 'usuario@ametaservicos.com.br';
    const createdRows = drafts.map((draft, idx) =>
      buildVivoActivityRecord(draft, minRowNum - 1 - idx, updatedBy, idx)
    );

    saveLocalCache([...createdRows, ...rows]);

    const persistPromise =
      createdRows.length === 1
        ? dataService.salvarVivoAtividade(createdRows[0])
        : dataService.importarVivoAtividadesEmLote(createdRows, {
            fileName: 'Acionamento Manual',
            columns: sheetMeta?.columns || VIVO_DOC_COLUMNS,
            baseLoaded: true,
            skipHistory: true,
          });

    await Promise.race([
      persistPromise.catch(() => {
        // Local cache already updated; Firestore will sync once rules are deployed
      }),
      new Promise<void>((resolve) => window.setTimeout(resolve, 900)),
    ]);

    onShowToast(
      createdRows.length === 1
        ? `Acionamento ${createdRows[0].siteName} adicionado na planilha Vivo!`
        : `${createdRows.length} acionamentos adicionados na planilha Vivo!`
    );
  };

  return (
    <div className="space-y-4">
      {/* =====================================================================
          1. PAGE HEADER & ACTIONS
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
            Controle executivo das entregas Vivo (RF Sheet, PPI, PDI, War Room, PIRF e BoQ) isolado da base Ericsson Claro.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setShowQuickAddModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#660099] hover:bg-[#52007a] text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Novo Acionamento</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setImportError(null);
                  setImportPreview(null);
                  setImportFileName('');
                  setShowImportModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#223585] hover:bg-[#1a2968] text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Importar Planilha (.CSV / .XLSX)</span>
              </button>
            </>
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

          {rows.length === 0 && !loadingBase && (
            <button
              type="button"
              onClick={handleReloadBaseCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#660099] hover:bg-[#52007a] text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Carregar Planilha Vivo</span>
            </button>
          )}
        </div>
      </div>

      {baseLoadError && (
        <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{baseLoadError}</span>
          </div>
          <button
            type="button"
            onClick={handleReloadBaseCsv}
            className="px-2.5 py-1 rounded-[6px] bg-white border border-rose-200 text-rose-700 font-semibold hover:bg-rose-100 cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

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

            {loadingBase && rows.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 text-[#223585] animate-spin" />
                <span>Carregando planilha Vivo...</span>
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
        </div>

        {/* Table Area */}
        <div className="overflow-x-auto max-h-[560px]">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-xs border-b border-slate-200">
              <tr>
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
              {paginatedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 2}
                    className="px-6 py-12 text-center text-slate-500"
                  >
                    {loadingBase ? (
                      <div className="flex flex-col items-center gap-2">
                        <RefreshCw className="w-5 h-5 text-[#223585] animate-spin" />
                        <span className="text-xs font-medium">Carregando atividades Vivo...</span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-700">
                          Nenhuma atividade encontrada para os filtros selecionados.
                        </p>
                        {hasActiveFilters && (
                          <button
                            type="button"
                            onClick={clearAllFilters}
                            className="mt-2 px-3 py-1.5 rounded-[8px] bg-[#223585] text-white text-xs font-semibold cursor-pointer"
                          >
                            Limpar filtros
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row, idx) => {
                  const rowNum = (safePage - 1) * pageSize + idx + 1;
                  const statusGroup = classifyVivoStatus(row.status);
                  const stStyle = STATUS_BADGE_STYLES[statusGroup];
                  const isSelected = selectedRow?.id === row.id;
                  const cellPad = density === 'compacto' ? 'px-3 py-1.5' : 'px-3 py-2.5';

                  return (
                    <tr
                      key={row.id}
                      onClick={() => handleOpenRow(row)}
                      className={`group transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#EEF2FA]'
                          : idx % 2 === 1
                          ? 'bg-[#F8FAFC] hover:bg-slate-100'
                          : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <td
                        className={`${cellPad} text-[11px] font-mono tabular-nums text-slate-400 text-center border-l-2 ${
                          isSelected ? 'border-l-[#660099]' : 'border-l-transparent'
                        }`}
                      >
                        {rowNum}
                      </td>

                      {visibleColumns.map((col) => {
                        const val = getFieldVal(row, col);

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
                            <td key={col} className={`${cellPad} whitespace-nowrap`}>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-semibold">
                                {val || '—'}
                              </span>
                            </td>
                          );
                        }

                        if (col === 'Status') {
                          return (
                            <td key={col} className={`${cellPad} whitespace-nowrap`}>
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${stStyle.bg} ${stStyle.text} ${stStyle.border}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${stStyle.dot}`} />
                                {val || 'Sem Status'}
                              </span>
                            </td>
                          );
                        }

                        if (
                          col === 'SLA DOC' ||
                          col === 'Entregue Week' ||
                          col === 'Demanda' ||
                          col === 'Planejado' ||
                          col === 'Entregue' ||
                          col === 'FATURAMENTO'
                        ) {
                          return (
                            <td
                              key={col}
                              className={`${cellPad} font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap`}
                            >
                              {col === 'FATURAMENTO' && val ? (
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
                              className={`${cellPad} text-xs text-slate-600 max-w-[280px] truncate`}
                              title={val}
                            >
                              {val ? val.replace(/\s+/g, ' ') : <span className="text-slate-300">—</span>}
                            </td>
                          );
                        }

                        return (
                          <td
                            key={col}
                            className={`${cellPad} text-xs text-slate-700 whitespace-nowrap max-w-[200px] truncate`}
                            title={val}
                          >
                            {val || <span className="text-slate-300">—</span>}
                          </td>
                        );
                      })}

                      <td
                        className={`${cellPad} text-right whitespace-nowrap sticky right-0 z-10 border-l border-slate-200/80 shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.06)] ${
                          isSelected
                            ? 'bg-[#EEF2FA]'
                            : idx % 2 === 1
                            ? 'bg-[#F8FAFC] group-hover:bg-slate-100'
                            : 'bg-white group-hover:bg-slate-50'
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => handleOpenRow(row)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] text-[11px] font-semibold text-[#223585] hover:bg-[#223585]/10 transition-colors cursor-pointer"
                          title="Ver detalhes / editar"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Detalhes</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

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
          5. ROW DETAIL & QUICK-EDIT SLIDE-OVER DRAWER
         ===================================================================== */}
      {selectedRow && editDraft && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex justify-end"
          onClick={() => setSelectedRow(null)}
        >
          <div
            className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
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
                {canManage && !isEditingRow && (
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
                  onClick={() => setSelectedRow(null)}
                  className="p-1.5 rounded-[8px] text-slate-500 hover:bg-slate-200/70 cursor-pointer"
                  aria-label="Fechar detalhes"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {isEditingRow ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                        Status
                      </label>
                      <input
                        type="text"
                        value={editDraft.status}
                        onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value })}
                        className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs focus:outline-none focus:border-[#223585]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                        Executor
                      </label>
                      <input
                        type="text"
                        value={editDraft.executor}
                        onChange={(e) => setEditDraft({ ...editDraft, executor: e.target.value })}
                        className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs focus:outline-none focus:border-[#223585]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                        Planejado
                      </label>
                      <input
                        type="text"
                        value={editDraft.planejado}
                        onChange={(e) => setEditDraft({ ...editDraft, planejado: e.target.value })}
                        className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs font-mono focus:outline-none focus:border-[#223585]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                        Entregue
                      </label>
                      <input
                        type="text"
                        value={editDraft.entregue}
                        onChange={(e) => setEditDraft({ ...editDraft, entregue: e.target.value })}
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
                        onChange={(e) => setEditDraft({ ...editDraft, ofensor: e.target.value })}
                        className="w-full px-3 py-2 rounded-[8px] border border-slate-200 text-xs focus:outline-none focus:border-[#223585]"
                      />
                    </div>
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
                      { label: 'Entregue', value: selectedRow.entregue || '—', mono: true },
                      { label: 'SLA DOC', value: selectedRow.slaDoc || '—', mono: true },
                      { label: 'Entregue Week', value: selectedRow.entregueWeek || '—', mono: true },
                      { label: 'Faturamento', value: selectedRow.faturamento || '—', mono: true },
                      { label: 'Ofensor', value: selectedRow.ofensor || '—' },
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

                  {/* Comentário STATUS (preserving multi-line history) */}
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
                      Todos os Campos da Planilha ({VIVO_DOC_COLUMNS.length} colunas)
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

            {/* Drawer Footer (Single-row delete only for ADM/Coord) */}
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
          6. APPEND-ONLY IMPORT MODAL (.CSV / .XLSX)
         ===================================================================== */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => !importing && setShowImportModal(false)}
        >
          <div
            className="w-full max-w-xl bg-white rounded-[12px] shadow-2xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Importar Planilha Vivo (Somente Acrescentar)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Destino exclusivo: <strong>Ericsson · Vivo</strong>. Nunca apaga nem mistura com Ericsson Claro, Nokia TIM ou Nokia Claro.
                </p>
              </div>
              <button
                type="button"
                disabled={importing}
                onClick={() => setShowImportModal(false)}
                className="p-1.5 rounded-[8px] text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
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

              {importError && (
                <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-700 font-medium">
                  {importError}
                </div>
              )}

              {importPreview && (
                <div className="rounded-[10px] border border-emerald-200 bg-emerald-50/50 p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-800">
                      Prévia Pronta para Importação
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
                    <span>Gravando registros Vivo...</span>
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
                    ? 'Importando...'
                    : `Importar ${
                        importPreview ? importPreview.rows.length.toLocaleString('pt-BR') : ''
                      } Linhas`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified Quick Acionamento Modal (1 ou Vários de uma vez) */}
      <QuickAcionamentoModal
        isOpen={showQuickAddModal}
        target="ERICSSON_VIVO"
        suggestedExecutors={overallMetrics.byExecutor.map((e) => e.executor)}
        suggestedRegionals={overallMetrics.byRegional.map((r) => r.regional)}
        onClose={() => setShowQuickAddModal(false)}
        onSubmitDrafts={handleCreateQuickVivoAcionamentos}
      />
    </div>
  );
};
