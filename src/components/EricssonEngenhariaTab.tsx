import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Search,
  Filter,
  Download,
  Maximize2,
  Minimize2,
  Table2,
  LayoutList,
  CheckCircle2,
  X,
  Edit3,
  FileSpreadsheet,
  ArrowLeftRight,
  HardHat,
  Clock,
  Layers,
} from 'lucide-react';
import { KpiCard, StatusBadge, EmptyStateCard } from './ui';
import {
  AmetaUser,
  UserRole,
  EricssonRow,
  EricssonSheetMeta,
  ERICSSON_ORIGINAL_COLUMNS,
} from '../types/telecom';
import { computeEricssonSiteCounters } from '../utils/ericssonSpreadsheetUtils';
import { doesEricssonRowMatchResponsible } from '../utils/spreadsheetUtils';
import { dataService } from '../services/dataService';
import { cloudFetch } from '../lib/firebaseCloud';

const fetch = cloudFetch;

export interface EricssonEngenhariaTabProps {
  user: AmetaUser;
  effectiveRole: UserRole;
  rows: EricssonRow[];
  sheetMeta: EricssonSheetMeta | null;
  onUpdated: (
    nextRows: EricssonRow[],
    nextMeta?: EricssonSheetMeta | null,
    toastMsg?: string
  ) => void;
}

export const EricssonEngenhariaTab: React.FC<EricssonEngenhariaTabProps> = ({
  user,
  effectiveRole,
  rows,
  sheetMeta,
  onUpdated,
}) => {
  const [viewMode, setViewMode] = useState<'resumo' | 'planilha'>('resumo');
  const [density, setDensity] = useState<'compact' | 'normal' | 'comfortable'>('normal');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterState, setFilterState] = useState<string>('ALL');
  const [filterEquipe, setFilterEquipe] = useState<string>('ALL');
  const [filterDelivery, setFilterDelivery] = useState<
    'ALL' | 'VISTORIA_ENTREGUE' | 'LOS_ENTREGUE' | 'PENDENTE'
  >('ALL');
  const [togglingRowKey, setTogglingRowKey] = useState<string | null>(null);

  // Row edit drawer (updates mother spreadsheet in real time)
  const [selectedRow, setSelectedRow] = useState<EricssonRow | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const originalColumns = useMemo(() => {
    if (sheetMeta?.columns && sheetMeta.columns.length > 0) {
      return sheetMeta.columns;
    }
    return ERICSSON_ORIGINAL_COLUMNS;
  }, [sheetMeta]);

  const distinctStates = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const val = (r.state || r.fields?.['00.03.State'] || '').trim();
      if (val) s.add(val);
    });
    return Array.from(s).sort();
  }, [rows]);

  const distinctEquipes = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const val = (r.equipe || r.fields?.['EQUIPE'] || '').trim();
      if (val) s.add(val);
    });
    return Array.from(s).sort();
  }, [rows]);

  const searchTokens = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw) return [];
    const parts = raw
      .split(/[\s,;|\t\n]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    return parts;
  }, [searchQuery]);

  const hasFullAccess =
    effectiveRole === 'ADM' ||
    effectiveRole === 'Coordenador Geral' ||
    effectiveRole === 'Coordenador Engenharia';

  const roleScopedRows = useMemo(() => {
    if (hasFullAccess) return rows;
    return rows.filter((r) => doesEricssonRowMatchResponsible(r, user));
  }, [rows, hasFullAccess, user]);

  const filteredRows = useMemo(() => {
    return roleScopedRows.filter((r) => {
      const rState = (r.state || r.fields?.['00.03.State'] || '').trim();
      const rEquipe = (r.equipe || r.fields?.['EQUIPE'] || '').trim();

      if (filterState !== 'ALL' && rState !== filterState) return false;
      if (filterEquipe !== 'ALL' && rEquipe !== filterEquipe) return false;

      if (filterDelivery === 'VISTORIA_ENTREGUE') {
        if (r.siteAVistoriaStatus !== 'Entregue' && r.siteBVistoriaStatus !== 'Entregue') {
          return false;
        }
      } else if (filterDelivery === 'LOS_ENTREGUE') {
        if (r.losStatus !== 'Entregue') return false;
      } else if (filterDelivery === 'PENDENTE') {
        const vPendente =
          r.siteAVistoriaStatus === 'Pendente' && r.siteBVistoriaStatus === 'Pendente';
        const lPendente = (r.losStatus || 'Pendente') === 'Pendente';
        if (!vPendente && !lPendente) return false;
      }

      if (searchTokens.length === 0) return true;

      if (searchTokens.length > 1) {
        const codeCandidates = [
          (r.siteIdA || '').toUpperCase(),
          (r.siteIdB || '').toUpperCase(),
          (r.chaves || '').toUpperCase(),
          (r.siteName || '').toUpperCase(),
        ];
        return searchTokens.some((tok) =>
          codeCandidates.some((cand) => cand.includes(tok))
        );
      }

      const q = searchQuery.trim().toLowerCase();
      const hay = [
        r.chaves,
        r.state,
        r.siteIdA,
        r.siteIdB,
        r.siteName,
        r.cidadeA,
        r.cidadeB,
        r.equipe,
        r.servico,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return hay.includes(q);
    });
  }, [roleScopedRows, filterState, filterEquipe, filterDelivery, searchTokens, searchQuery]);

  const siteCounters = useMemo(
    () => computeEricssonSiteCounters(filteredRows),
    [filteredRows]
  );

  const losCounters = useMemo(() => {
    let entregues = 0;
    let pendentes = 0;
    filteredRows.forEach((r) => {
      if (r.losStatus === 'Entregue') entregues++;
      else pendentes++;
    });
    return { entregues, pendentes };
  }, [filteredRows]);

  const canEditManualStatus =
    effectiveRole === 'Vistoriador' ||
    effectiveRole === 'Executor' ||
    effectiveRole === 'Coordenador Engenharia' ||
    effectiveRole === 'Coordenador Geral' ||
    effectiveRole === 'ADM';

  const handleSetManualStatus = async (
    row: EricssonRow,
    side: 'A' | 'B' | 'LOS',
    nextStatus: 'Entregue' | 'Pendente' | 'Dispensado',
    e?: React.SyntheticEvent
  ) => {
    if (e) e.stopPropagation();
    if (!canEditManualStatus) return;
    const key = `${row.id}:${side}`;
    setTogglingRowKey(key);
    try {
      const updatedRow: EricssonRow = {
        ...row,
        updatedAt: new Date().toISOString(),
      };
      if (side === 'A') {
        updatedRow.siteAVistoriaStatus = nextStatus;
        if (nextStatus === 'Entregue' && (!row.siteBVistoriaStatus || row.siteBVistoriaStatus === 'Pendente')) {
          updatedRow.siteBVistoriaStatus = 'Dispensado';
        } else if (nextStatus === 'Pendente' && row.siteBVistoriaStatus === 'Dispensado') {
          updatedRow.siteBVistoriaStatus = 'Pendente';
        }
      } else if (side === 'B') {
        updatedRow.siteBVistoriaStatus = nextStatus;
        if (nextStatus === 'Entregue' && (!row.siteAVistoriaStatus || row.siteAVistoriaStatus === 'Pendente')) {
          updatedRow.siteAVistoriaStatus = 'Dispensado';
        } else if (nextStatus === 'Pendente' && row.siteAVistoriaStatus === 'Dispensado') {
          updatedRow.siteAVistoriaStatus = 'Pendente';
        }
      } else {
        updatedRow.losStatus = nextStatus;
      }

      await dataService.salvarSiteEricsson(updatedRow);
      if (selectedRow && selectedRow.id === row.id) {
        setSelectedRow(updatedRow);
      }
      onUpdated(
        rows.map((r) => (r.id === row.id ? updatedRow : r)),
        sheetMeta,
        'Status atualizado na Planilha Mãe e na Engenharia Ericsson!'
      );
    } catch {
      // ignore
    } finally {
      setTogglingRowKey(null);
    }
  };

  const handleSaveRowEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRow) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/ericsson/rows/${encodeURIComponent(selectedRow.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: editFields,
          chaves: editFields['01.00. Chaves'],
          state: editFields['00.03.State'],
          meta: editFields['Meta'],
          siteIdA: editFields['01.21.Site ID A'],
          idDetentoraA: editFields['ID Detentora A'],
          statusA: editFields['Status A'],
          cidadeA: editFields['CIDADE A'],
          siteIdB: editFields['01.21.Site ID B'],
          idDetentoraB: editFields['ID Detentora B'],
          statusB: editFields['Status B'],
          cidadeB: editFields['CIDADE B'],
          equipe: editFields['EQUIPE'],
          servico: editFields['Serviço'],
        }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.ericssonRows)) {
        onUpdated(
          data.ericssonRows,
          sheetMeta,
          'Planilha Mãe e Engenharia Ericsson atualizadas!'
        );
        setSelectedRow(data.row);
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleExportExcel = () => {
    const exportData = filteredRows.map((r) => {
      const rowObj: Record<string, string> = {};
      originalColumns.forEach((col) => {
        rowObj[col] = r.fields?.[col] ?? '';
      });
      rowObj['Vistoria Site A'] = r.siteAVistoriaStatus || 'Pendente';
      rowObj['Vistoria Site B'] = r.siteBVistoriaStatus || 'Pendente';
      rowObj['LOS'] = r.losStatus || 'Pendente';
      return rowObj;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ENGENHARIA ERICSSON');
    XLSX.writeFile(
      wb,
      `Engenharia_Ericsson_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  const renderSheetStatusBadge = (rawStatus: string) => {
    const val = (rawStatus || '').trim();
    if (!val) return <span className="text-slate-400">—</span>;
    return <StatusBadge label={val} maxWidthClass="max-w-[140px]" />;
  };

  const renderVistoriaOrLosStatusCell = (row: EricssonRow, side: 'A' | 'B' | 'LOS') => {
    const status =
      side === 'A'
        ? row.siteAVistoriaStatus || 'Pendente'
        : side === 'B'
        ? row.siteBVistoriaStatus || 'Pendente'
        : row.losStatus || 'Pendente';

    const isToggling = togglingRowKey === `${row.id}:${side}`;

    return (
      <div
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
        onClick={(e) => e.stopPropagation()}
      >
        <select
          disabled={isToggling || !canEditManualStatus}
          value={status}
          onChange={(e) =>
            handleSetManualStatus(
              row,
              side,
              e.target.value as 'Entregue' | 'Pendente' | 'Dispensado',
              e
            )
          }
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer focus:outline-none ${
            status === 'Entregue'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
              : status === 'Dispensado'
              ? 'bg-sky-50 text-sky-700 border-sky-300'
              : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}
        >
          <option value="Pendente">Pendente</option>
          <option value="Entregue">Entregue</option>
          <option value="Dispensado">Dispensado</option>
        </select>
      </div>
    );
  };

  const cellPad =
    density === 'compact'
      ? 'px-2.5 py-1.5 text-[11px]'
      : density === 'comfortable'
      ? 'px-4 py-3 text-xs'
      : 'px-3 py-2 text-xs';

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 bg-[#F4F6FA] overflow-y-auto p-4 md:p-6 space-y-4'
          : 'space-y-4'
      }
    >
      {/* =====================================================================
          1. TOP HEADER — ENGENHARIA ERICSSON (SINCRONIZADA COM A PLANILHA MÃE + DOWNLOAD DIRETO)
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-[12px] p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-[10px] bg-gradient-to-br from-[#223585] to-[#1E8E8D] flex items-center justify-center text-white shadow-2xs shrink-0">
              <HardHat className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-[6px] bg-teal-50 text-[#1E8E8D] border border-teal-200 text-[11px] font-bold uppercase tracking-wider">
                  ENGENHARIA · ERICSSON
                </span>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                  Planilha de Engenharia Ericsson
                </h1>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Sincronizada automaticamente em tempo real com a{' '}
                <strong className="text-slate-700">Planilha Mãe (Sites Ericsson)</strong> •{' '}
                Permite atualizar os status de <strong>Vistoria Site A, Vistoria Site B e LOS</strong> direto na planilha.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3.5 py-2 bg-[#1E8E8D] hover:bg-[#177372] text-white text-xs font-semibold rounded-[8px] transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar Planilha Engenharia (.XLSX)</span>
            </button>

            <button
              type="button"
              onClick={() => setIsFullscreen((prev) => !prev)}
              className="p-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-[8px] transition-colors shadow-2xs cursor-pointer"
              title={isFullscreen ? 'Sair da tela inteira' : 'Tela inteira'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          <KpiCard
            label="Total na Planilha Mãe"
            value={siteCounters.totalSites}
            sublabel={`Em ${siteCounters.totalPairs} enlaces (A e B)`}
            icon={<Layers className="w-4 h-4" />}
            tone="navy"
            active={filterDelivery === 'ALL'}
            onClick={() => setFilterDelivery('ALL')}
          />
          <KpiCard
            label="Vistorias Entregues"
            value={siteCounters.vistoriaEntregueSites}
            sublabel={`${siteCounters.vistoriaDispensadoSites} dispensados (outra ponta)`}
            icon={<CheckCircle2 className="w-4 h-4" />}
            tone="success"
            active={filterDelivery === 'VISTORIA_ENTREGUE'}
            onClick={() =>
              setFilterDelivery((prev) =>
                prev === 'VISTORIA_ENTREGUE' ? 'ALL' : 'VISTORIA_ENTREGUE'
              )
            }
          />
          <KpiCard
            label="LOS Entregues"
            value={losCounters.entregues}
            sublabel={`${losCounters.pendentes} LOS pendentes`}
            icon={<CheckCircle2 className="w-4 h-4" />}
            tone="warning"
            active={filterDelivery === 'LOS_ENTREGUE'}
            onClick={() =>
              setFilterDelivery((prev) => (prev === 'LOS_ENTREGUE' ? 'ALL' : 'LOS_ENTREGUE'))
            }
          />
          <KpiCard
            label="Sites Pendentes"
            value={siteCounters.vistoriaPendenteSites}
            sublabel="Aguardando entrega"
            icon={<Clock className="w-4 h-4" />}
            tone="danger"
            active={filterDelivery === 'PENDENTE'}
            onClick={() =>
              setFilterDelivery((prev) => (prev === 'PENDENTE' ? 'ALL' : 'PENDENTE'))
            }
          />
        </div>
      </div>

      {/* =====================================================================
          2. VIEW SWITCHER & SEARCH / FILTERS
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-[12px] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center bg-slate-100 p-1 rounded-[8px] border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('resumo')}
              className={`px-3.5 py-1.5 rounded-[6px] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'resumo'
                  ? 'bg-[#223585] text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" />
              <span>Planilha Engenharia — Resumo</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('planilha')}
              className={`px-3.5 py-1.5 rounded-[6px] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'planilha'
                  ? 'bg-[#223585] text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Planilha Completa ({originalColumns.length} col + Status A, B e LOS)</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500">Densidade:</span>
            <div className="inline-flex bg-slate-100 p-0.5 rounded-[8px] border border-slate-200 text-[11px]">
              {(
                [
                  { id: 'compact', label: 'Compacta' },
                  { id: 'normal', label: 'Padrão' },
                  { id: 'comfortable', label: 'Confortável' },
                ] as const
              ).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDensity(d.id)}
                  className={`px-2.5 py-1 rounded-[6px] font-semibold transition-colors cursor-pointer ${
                    density === d.id
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 pt-1">
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar na Engenharia por Site ID A, Site ID B, Chave, arquivo..."
              className="w-full pl-9 pr-8 py-2 bg-[#F8FAFC] border border-slate-200 rounded-[8px] text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#223585] focus:ring-2 focus:ring-[#223585]/15 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="md:col-span-2">
            <select
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
              className="w-full px-2.5 py-2 bg-[#F8FAFC] border border-slate-200 rounded-[8px] text-xs text-slate-700 font-medium focus:outline-none focus:border-[#223585]"
            >
              <option value="ALL">00.03.State: Todos ({distinctStates.length})</option>
              {distinctStates.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={filterEquipe}
              onChange={(e) => setFilterEquipe(e.target.value)}
              className="w-full px-2.5 py-2 bg-[#F8FAFC] border border-slate-200 rounded-[8px] text-xs text-slate-700 font-medium focus:outline-none focus:border-[#223585]"
            >
              <option value="ALL">EQUIPE: Todas ({distinctEquipes.length})</option>
              {distinctEquipes.map((eq) => (
                <option key={eq} value={eq}>
                  {eq}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={filterDelivery}
              onChange={(e) =>
                setFilterDelivery(
                  e.target.value as
                    | 'ALL'
                    | 'VISTORIA_ENTREGUE'
                    | 'LOS_ENTREGUE'
                    | 'PENDENTE'
                )
              }
              className="w-full px-2.5 py-2 bg-[#F8FAFC] border border-slate-200 rounded-[8px] text-xs text-slate-700 font-medium focus:outline-none focus:border-[#223585]"
            >
              <option value="ALL">Filtro Engenharia: Todos</option>
              <option value="VISTORIA_ENTREGUE">Vistoria Entregue</option>
              <option value="LOS_ENTREGUE">LOS Entregue</option>
              <option value="PENDENTE">Pendentes</option>
            </select>
          </div>
        </div>
      </div>

      {/* =====================================================================
          3A. RESUMO TABLE
         ===================================================================== */}
      {viewMode === 'resumo' && (
        <div className="bg-white border border-slate-200 rounded-[12px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
          <div className="px-4 py-2.5 bg-[#F8FAFC] border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-[#223585]" />
              <span>
                Planilha de Engenharia sincronizada com a Planilha Mãe • Status editáveis para{' '}
                <strong>Vistoria A</strong>, <strong>Vistoria B</strong> e{' '}
                <strong>LOS</strong>.
              </span>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[680px]">
            <table className="w-full text-left border-collapse ameta-table-zebra text-[13px]">
              <thead className="sticky top-0 z-10 bg-[#F4F6FA] text-[10px] uppercase tracking-wider text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3 font-bold ameta-col-resizable">01.00. Chaves</th>
                  <th className="py-2.5 px-2.5 font-bold ameta-col-resizable">00.03.State</th>
                  <th className="py-2.5 px-3 font-bold bg-[#EEF2FF] text-[#223585] border-l border-slate-200 ameta-col-resizable">
                    01.21.Site ID A
                  </th>
                  <th className="py-2.5 px-2.5 font-bold bg-[#EEF2FF] text-[#223585] ameta-col-resizable">
                    Status A
                  </th>
                  <th className="py-2.5 px-2.5 font-bold bg-[#EEF2FF] text-[#223585] ameta-col-resizable">
                    CIDADE A
                  </th>
                  <th className="py-2.5 px-3 font-bold bg-[#EEFAFA] text-[#1E8E8D] border-l border-slate-200 ameta-col-resizable">
                    01.21.Site ID B
                  </th>
                  <th className="py-2.5 px-2.5 font-bold bg-[#EEFAFA] text-[#1E8E8D] ameta-col-resizable">
                    Status B
                  </th>
                  <th className="py-2.5 px-2.5 font-bold bg-[#EEFAFA] text-[#1E8E8D] ameta-col-resizable">
                    CIDADE B
                  </th>
                  <th className="py-2.5 px-2.5 font-bold border-l border-slate-200 ameta-col-resizable">EQUIPE</th>
                  <th className="py-2.5 px-3 font-bold bg-[#EEF2FF] text-[#223585] border-l border-slate-200 ameta-col-resizable">
                    Vistoria Site A
                  </th>
                  <th className="py-2.5 px-3 font-bold bg-[#EEFAFA] text-[#1E8E8D] border-l border-slate-200 ameta-col-resizable">
                    Vistoria Site B
                  </th>
                  <th className="py-2.5 px-3 font-bold bg-amber-50 text-amber-800 border-l border-slate-200">
                    LOS
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-0">
                      <EmptyStateCard
                        icon={<FileSpreadsheet className="w-6 h-6" />}
                        title={
                          rows.length === 0
                            ? 'Nenhum registro de Engenharia Ericsson'
                            : 'Nenhum registro corresponde aos filtros aplicados'
                        }
                        description={
                          rows.length === 0
                            ? 'Quando a Planilha Mãe Ericsson possuir sites cadastrados, eles aparecerão aqui automaticamente.'
                            : 'Ajuste os filtros de busca ou selecione outro estado/equipe para visualizar os registros.'
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const sA = row.statusA || row.fields?.['Status A'] || '';
                    const sB = row.statusB || row.fields?.['Status B'] || '';
                    const cidadeAVal = row.cidadeA || row.fields?.['CIDADE A'] || '';
                    const cidadeBVal = row.cidadeB || row.fields?.['CIDADE B'] || '';
                    const chavesVal = row.chaves || row.fields?.['01.00. Chaves'] || '';
                    const equipeVal = row.equipe || row.fields?.['EQUIPE'] || '';
                    const isRowSelected = selectedRow?.id === row.id;

                    return (
                      <tr
                        key={row.id}
                        onClick={() => {
                          setSelectedRow(row);
                          setEditFields({ ...(row.fields || {}) });
                        }}
                        className={`transition-colors cursor-pointer ${
                          isRowSelected ? 'ameta-table-row-selected' : ''
                        }`}
                      >
                        <td
                          title={chavesVal || undefined}
                          className={`${cellPad} font-mono tabular-nums font-bold text-slate-800 whitespace-nowrap`}
                        >
                          {chavesVal || '—'}
                        </td>
                        <td className={`${cellPad} font-mono tabular-nums font-semibold text-slate-700`}>
                          {row.state || row.fields?.['00.03.State'] || '—'}
                        </td>
                        <td className={`${cellPad} font-mono tabular-nums font-bold text-[#223585] bg-blue-50/20 border-l border-slate-200 whitespace-nowrap`}>
                          {row.siteIdA || '—'}
                        </td>
                        <td className={`${cellPad} bg-blue-50/20`}>
                          {renderSheetStatusBadge(sA)}
                        </td>
                        <td
                          title={cidadeAVal || undefined}
                          className={`${cellPad} text-slate-700 bg-blue-50/20 max-w-[140px] truncate`}
                        >
                          {cidadeAVal || '—'}
                        </td>
                        <td className={`${cellPad} font-mono tabular-nums font-bold text-[#1E8E8D] bg-teal-50/20 border-l border-slate-200 whitespace-nowrap`}>
                          {row.siteIdB || '—'}
                        </td>
                        <td className={`${cellPad} bg-teal-50/20`}>
                          {renderSheetStatusBadge(sB)}
                        </td>
                        <td
                          title={cidadeBVal || undefined}
                          className={`${cellPad} text-slate-700 bg-teal-50/20 max-w-[140px] truncate`}
                        >
                          {cidadeBVal || '—'}
                        </td>
                        <td
                          title={equipeVal || undefined}
                          className={`${cellPad} font-semibold text-slate-800 border-l border-slate-200 whitespace-nowrap max-w-[180px] truncate`}
                        >
                          {equipeVal || '—'}
                        </td>
                        <td className={`${cellPad} bg-blue-50/15 border-l border-slate-200`}>
                          {renderVistoriaOrLosStatusCell(row, 'A')}
                        </td>
                        <td className={`${cellPad} bg-teal-50/15 border-l border-slate-200`}>
                          {renderVistoriaOrLosStatusCell(row, 'B')}
                        </td>
                        <td className={`${cellPad} bg-amber-50/20 border-l border-slate-200`}>
                          {renderVistoriaOrLosStatusCell(row, 'LOS')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          3B. FULL SPREADSHEET VIEW
         ===================================================================== */}
      {viewMode === 'planilha' && (
        <div className="bg-white border border-slate-200 rounded-[12px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
          <div className="px-4 py-2.5 bg-[#F8FAFC] border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#1E8E8D]" />
              <span>
                Planilha Completa de Engenharia (<span className="font-mono tabular-nums font-semibold">{originalColumns.length}</span> colunas + Status de{' '}
                <strong>Vistoria A</strong>, <strong>Vistoria B</strong> e <strong>LOS</strong>)
              </span>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[680px]">
            <table className="w-full text-left border-collapse ameta-table-zebra text-[13px]">
              <thead className="sticky top-0 z-10 bg-[#F4F6FA] text-[10px] uppercase tracking-wider text-slate-700 border-b border-slate-200">
                <tr>
                  {originalColumns.map((col, idx) => {
                    const isSiteA = col === '01.21.Site ID A' || col === 'Status A';
                    const isSiteB = col === '01.21.Site ID B' || col === 'Status B';
                    return (
                      <th
                        key={`${col}-${idx}`}
                        className={`py-2.5 px-3 font-bold whitespace-nowrap border-r border-slate-200 ameta-col-resizable ${
                          isSiteA
                            ? 'bg-[#EEF2FF] text-[#223585]'
                            : isSiteB
                            ? 'bg-[#EEFAFA] text-[#1E8E8D]'
                            : ''
                        }`}
                      >
                        {col}
                      </th>
                    );
                  })}
                  <th className="py-2.5 px-3 font-bold whitespace-nowrap bg-[#EEF2FF] text-[#223585] border-r border-slate-200 ameta-col-resizable">
                    Vistoria Site A
                  </th>
                  <th className="py-2.5 px-3 font-bold whitespace-nowrap bg-[#EEFAFA] text-[#1E8E8D] border-r border-slate-200 ameta-col-resizable">
                    Vistoria Site B
                  </th>
                  <th className="py-2.5 px-3 font-bold whitespace-nowrap bg-amber-50 text-amber-800 border-r border-slate-200">
                    LOS
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={originalColumns.length + 3} className="p-0">
                      <EmptyStateCard
                        icon={<FileSpreadsheet className="w-6 h-6" />}
                        title={
                          rows.length === 0
                            ? 'Nenhum registro de Engenharia Ericsson'
                            : 'Nenhum registro corresponde aos filtros aplicados'
                        }
                        description={
                          rows.length === 0
                            ? 'Quando a Planilha Mãe Ericsson possuir sites cadastrados, eles aparecerão aqui automaticamente.'
                            : 'Ajuste os filtros de busca ou selecione outro estado/equipe para visualizar os registros.'
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const isRowSelected = selectedRow?.id === row.id;
                    return (
                      <tr
                        key={row.id}
                        onClick={() => {
                          setSelectedRow(row);
                          setEditFields({ ...(row.fields || {}) });
                        }}
                        className={`transition-colors cursor-pointer ${
                          isRowSelected ? 'ameta-table-row-selected' : ''
                        }`}
                      >
                        {originalColumns.map((col, idx) => {
                          const val = row.fields?.[col] ?? '';
                          const isSiteA = col === '01.21.Site ID A';
                          const isSiteB = col === '01.21.Site ID B';
                          const isStatus = col === 'Status A' || col === 'Status B';
                          return (
                            <td
                              key={`${col}-${idx}`}
                              title={val ? String(val) : undefined}
                              className={`${cellPad} whitespace-nowrap border-r border-slate-200/70 max-w-[240px] truncate tabular-nums ${
                                isSiteA
                                  ? 'font-mono font-bold text-[#223585] bg-blue-50/20'
                                  : isSiteB
                                  ? 'font-mono font-bold text-[#1E8E8D] bg-teal-50/20'
                                  : 'text-slate-700'
                              }`}
                            >
                              {isStatus ? renderSheetStatusBadge(String(val)) : val || '—'}
                            </td>
                          );
                        })}
                        <td className={`${cellPad} whitespace-nowrap bg-blue-50/15 border-r border-slate-200`}>
                          {renderVistoriaOrLosStatusCell(row, 'A')}
                        </td>
                        <td className={`${cellPad} whitespace-nowrap bg-teal-50/15 border-r border-slate-200`}>
                          {renderVistoriaOrLosStatusCell(row, 'B')}
                        </td>
                        <td className={`${cellPad} whitespace-nowrap bg-amber-50/20 border-r border-slate-200`}>
                          {renderVistoriaOrLosStatusCell(row, 'LOS')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          ROW DETAILS & EDIT DRAWER
         ===================================================================== */}
      {selectedRow && (
        <div
          className="ameta-modal-backdrop fixed inset-0 z-50 flex justify-end bg-[#0B1530]/45 backdrop-blur-[2px]"
          onClick={() => setSelectedRow(null)}
        >
          <div
            className="ameta-modal-panel w-full max-w-2xl bg-white border-l border-slate-200 h-full overflow-y-auto p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-[6px] bg-[#EEF2FF] text-[#223585] border border-[#DDE4F6] font-mono tabular-nums text-xs font-bold">
                    {selectedRow.chaves || 'Par Ericsson'}
                  </span>
                  <span className="font-mono font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <span className="text-[#223585]">{selectedRow.siteIdA || '—'}</span>
                    <ArrowLeftRight className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[#1E8E8D]">{selectedRow.siteIdB || '—'}</span>
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Engenharia Ericsson — Status e edição sincronizada com a Planilha Mãe
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-[8px] cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-[12px] bg-[#F4F6FA] border border-slate-200 space-y-3 text-xs">
              <div className="font-bold text-slate-900">
                Status na Engenharia (Vistoria A, Vistoria B e LOS)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-white rounded-[8px] border border-[#DDE4F6] space-y-2">
                  <div className="text-[10px] font-bold uppercase text-[#223585]">
                    Vistoria Site A ({selectedRow.siteIdA || '—'})
                  </div>
                  {renderVistoriaOrLosStatusCell(selectedRow, 'A')}
                </div>
                <div className="p-3 bg-white rounded-[8px] border border-[#AAE5E5] space-y-2">
                  <div className="text-[10px] font-bold uppercase text-[#1E8E8D]">
                    Vistoria Site B ({selectedRow.siteIdB || '—'})
                  </div>
                  {renderVistoriaOrLosStatusCell(selectedRow, 'B')}
                </div>
                <div className="p-3 bg-white rounded-[8px] border border-amber-200 space-y-2">
                  <div className="text-[10px] font-bold uppercase text-amber-800">
                    Relatório LOS
                  </div>
                  {renderVistoriaOrLosStatusCell(selectedRow, 'LOS')}
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveRowEdit} className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5 text-[#1E8E8D]" />
                  <span>Colunas da Planilha Mãe ({originalColumns.length} colunas)</span>
                </h4>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-1.5 bg-[#223585] hover:bg-[#1B2A6B] text-white font-bold rounded-[8px] cursor-pointer shadow-xs transition-colors"
                >
                  {savingEdit ? 'Salvando...' : 'Salvar na Planilha Mãe'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {originalColumns.map((col, idx) => (
                  <div key={`${col}-${idx}`}>
                    <label className="block text-[11px] text-slate-500 font-medium mb-1">
                      {col}
                    </label>
                    <input
                      type="text"
                      value={editFields[col] ?? ''}
                      onChange={(e) =>
                        setEditFields((prev) => ({
                          ...prev,
                          [col]: e.target.value,
                        }))
                      }
                      className="w-full px-2.5 py-1.5 bg-[#F8FAFC] border border-slate-200 rounded-[8px] text-slate-900 focus:outline-none focus:bg-white focus:border-[#223585] focus:ring-2 focus:ring-[#223585]/15"
                    />
                  </div>
                ))}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
