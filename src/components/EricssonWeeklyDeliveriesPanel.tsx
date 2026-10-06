import React, { useState, useMemo } from 'react';
import {
  Calendar,
  TrendingUp,
  BarChart3,
  CheckCircle2,
  AlertCircle,
  X,
  Sparkles,
  Layers,
  ChevronRight,
} from 'lucide-react';
import {
  EricssonEngineeringRow,
  EricssonDocGroup,
} from '../types/telecom';
import { classifyEricssonStatus, classifyEricssonDocGroup } from '../utils/ericssonSpreadsheetUtils';

export interface DeliveryWeekBucket {
  key: string;
  weekIndex: number;
  startDate: Date;
  endDate: Date;
  startStr: string;
  endStr: string;
  label: string;
  tag: 'Em andamento' | 'Parcial' | '';
  isPartial: boolean;
  isInProgress: boolean;
  count: number;
  rowIds: string[];
  docCounts: Record<EricssonDocGroup, number>;
  docRowIds: Record<EricssonDocGroup, string[]>;
}

export interface WeeklyDeliveriesData {
  today: Date;
  startDate: Date;
  windowLabel: string;
  totalDeliveries30Days: number;
  averageDeliveriesPerWeek: number;
  docTotals30Days: Record<EricssonDocGroup, number>;
  docAveragesPerWeek: Record<EricssonDocGroup, number>;
  finalizedWithoutDateCount: number;
  weeks: DeliveryWeekBucket[];
}

export interface EricssonWeeklyDeliveriesPanelProps {
  rows: EricssonEngineeringRow[];
  selectedWeekKey: string | null;
  selectedDocGroupFilter: EricssonDocGroup | null;
  onSelectWeekAndDoc: (week: DeliveryWeekBucket | null, docGroup: EricssonDocGroup | null) => void;
}

export const DOC_COLOR_MAP: Record<
  EricssonDocGroup,
  { bg: string; text: string; border: string; hex: string; lightBg: string; name: string }
> = {
  WR: {
    bg: 'bg-indigo-600',
    text: 'text-indigo-700',
    border: 'border-indigo-200',
    hex: '#4f46e5',
    lightBg: 'bg-indigo-50',
    name: 'WR',
  },
  QRF: {
    bg: 'bg-cyan-500',
    text: 'text-cyan-700',
    border: 'border-cyan-200',
    hex: '#06b6d4',
    lightBg: 'bg-cyan-50',
    name: 'QRF',
  },
  PPI: {
    bg: 'bg-emerald-600',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    hex: '#059669',
    lightBg: 'bg-emerald-50',
    name: 'PPI',
  },
  SDC: {
    bg: 'bg-rose-500',
    text: 'text-rose-700',
    border: 'border-rose-200',
    hex: '#f43f5e',
    lightBg: 'bg-rose-50',
    name: 'SDC',
  },
  SMART: {
    bg: 'bg-violet-600',
    text: 'text-violet-700',
    border: 'border-violet-200',
    hex: '#7c3aed',
    lightBg: 'bg-violet-50',
    name: 'SMART',
  },
  BOQ: {
    bg: 'bg-amber-500',
    text: 'text-amber-800',
    border: 'border-amber-200',
    hex: '#f59e0b',
    lightBg: 'bg-amber-50',
    name: 'BOQ',
  },
};

export const ALL_DOC_GROUPS: EricssonDocGroup[] = ['WR', 'QRF', 'PPI', 'SDC', 'SMART', 'BOQ'];

/**
 * Returns a date object at midnight in São Paulo timezone (America/Sao_Paulo).
 */
export function getSaoPauloDate(d = new Date()): Date {
  const spString = d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
  const spDate = new Date(spString);
  return new Date(spDate.getFullYear(), spDate.getMonth(), spDate.getDate());
}

/**
 * Parses flexible date strings from the Ericsson spreadsheet (DD/MM/YYYY, M/D/YY, ISO, etc.)
 */
export function parseEricssonDeliveryDate(val: string | undefined | null): Date | null {
  if (!val) return null;
  const clean = String(val).trim();
  if (!clean || clean === '—' || clean === '-' || clean === 'N/A' || clean === 'null') {
    return null;
  }

  // ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }

  // Split by slash, dash, or dot
  const parts = clean.split(/[\/\-\.]/);
  if (parts.length === 3) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);

    if (isNaN(p0) || isNaN(p1) || isNaN(p2)) return null;

    const year = p2 < 100 ? 2000 + p2 : p2;
    let month: number;
    let day: number;

    // Disambiguate day and month
    if (p0 > 12 && p1 <= 12) {
      // DD/MM/YYYY
      day = p0;
      month = p1 - 1;
    } else if (p1 > 12 && p0 <= 12) {
      // MM/DD/YYYY
      month = p0 - 1;
      day = p1;
    } else {
      // Default to Brazilian standard DD/MM/YYYY
      day = p0;
      month = p1 - 1;
    }

    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  const fallback = new Date(clean);
  if (!isNaN(fallback.getTime())) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }

  return null;
}

/**
 * Extracts delivery date from an Ericsson engineering row.
 * Primary column: 'Entregue' (fields['Entregue']).
 * Fallbacks: 'WR ENTREGUE', 'QRF ENTREGUE', 'PPI ENTREGUE', 'Finalizado WR'.
 */
export function getRowDeliveryDate(row: EricssonEngineeringRow): Date | null {
  const primary = row.fields?.['Entregue'];
  const parsedPrimary = parseEricssonDeliveryDate(primary);
  if (parsedPrimary) return parsedPrimary;

  const fallbacks = [
    row.fields?.['WR ENTREGUE'],
    row.fields?.['QRF ENTREGUE'],
    row.fields?.['PPI ENTREGUE'],
    row.fields?.['Finalizado WR'],
  ];

  for (const fb of fallbacks) {
    const parsed = parseEricssonDeliveryDate(fb);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Computes weekly delivery statistics for the rolling 30-day window (grouped Monday to Sunday)
 * broken down by document type.
 */
export function computeWeeklyDeliveries(rows: EricssonEngineeringRow[]): WeeklyDeliveriesData {
  const today = getSaoPauloDate();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 29); // 30-day window

  // Build calendar week buckets (Monday to Sunday)
  const weeks: DeliveryWeekBucket[] = [];
  let currStart = new Date(startDate);
  let weekIndex = 1;

  while (currStart <= today) {
    const dayOfWeek = currStart.getDay(); // 0 is Sunday, 1 is Monday...
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;

    let currEnd = new Date(currStart);
    currEnd.setDate(currStart.getDate() + daysUntilSunday);

    const isCurrentWeek = currEnd >= today;
    if (currEnd > today) {
      currEnd = new Date(today);
    }

    const isStartPartial = weekIndex === 1 && currStart.getDay() !== 1; // Not starting on Monday
    const isInProgress = isCurrentWeek;

    const startStr = `${String(currStart.getDate()).padStart(2, '0')}/${String(
      currStart.getMonth() + 1
    ).padStart(2, '0')}`;
    const endStr = `${String(currEnd.getDate()).padStart(2, '0')}/${String(
      currEnd.getMonth() + 1
    ).padStart(2, '0')}`;

    const label = `Semana ${weekIndex}: ${startStr} a ${endStr}`;
    let tag: 'Em andamento' | 'Parcial' | '' = '';
    if (isInProgress) {
      tag = 'Em andamento';
    } else if (isStartPartial) {
      tag = 'Parcial';
    }

    const docCounts: Record<EricssonDocGroup, number> = {
      WR: 0,
      QRF: 0,
      PPI: 0,
      SDC: 0,
      SMART: 0,
      BOQ: 0,
    };

    const docRowIds: Record<EricssonDocGroup, string[]> = {
      WR: [],
      QRF: [],
      PPI: [],
      SDC: [],
      SMART: [],
      BOQ: [],
    };

    weeks.push({
      key: `week-${weekIndex}-${startStr}-${endStr}`,
      weekIndex,
      startDate: new Date(currStart),
      endDate: new Date(currEnd),
      startStr,
      endStr,
      label,
      tag,
      isPartial: isStartPartial,
      isInProgress,
      count: 0,
      rowIds: [],
      docCounts,
      docRowIds,
    });

    const nextStart = new Date(currStart);
    nextStart.setDate(currStart.getDate() + daysUntilSunday + 1);
    currStart = nextStart;
    weekIndex++;
  }

  let totalDeliveries30Days = 0;
  let finalizedWithoutDateCount = 0;

  const docTotals30Days: Record<EricssonDocGroup, number> = {
    WR: 0,
    QRF: 0,
    PPI: 0,
    SDC: 0,
    SMART: 0,
    BOQ: 0,
  };

  // Process rows
  rows.forEach((row) => {
    const rawStatus = row.status || row.fields?.['Status'] || '';
    const isFinalizado =
      classifyEricssonStatus(rawStatus) === 'Finalizado' ||
      String(rawStatus).toLowerCase().includes('finaliz');

    if (!isFinalizado) return;

    const deliveryDate = getRowDeliveryDate(row);
    if (!deliveryDate) {
      finalizedWithoutDateCount++;
      return;
    }

    // Check if within 30-day window
    if (deliveryDate >= startDate && deliveryDate <= today) {
      totalDeliveries30Days++;

      const rawDoc = row.tipoDoc || row.fields?.['Tipo doc'] || '';
      const docGroup = classifyEricssonDocGroup(rawDoc) || 'WR';
      docTotals30Days[docGroup] = (docTotals30Days[docGroup] || 0) + 1;

      // Find matching week bucket
      for (const bucket of weeks) {
        if (deliveryDate >= bucket.startDate && deliveryDate <= bucket.endDate) {
          bucket.count++;
          bucket.rowIds.push(row.id);
          bucket.docCounts[docGroup] = (bucket.docCounts[docGroup] || 0) + 1;
          bucket.docRowIds[docGroup].push(row.id);
          break;
        }
      }
    }
  });

  const weekCount = Math.max(weeks.length, 1);
  const averageDeliveriesPerWeek = Number((totalDeliveries30Days / weekCount).toFixed(1));

  const docAveragesPerWeek: Record<EricssonDocGroup, number> = {
    WR: Number(((docTotals30Days.WR || 0) / weekCount).toFixed(1)),
    QRF: Number(((docTotals30Days.QRF || 0) / weekCount).toFixed(1)),
    PPI: Number(((docTotals30Days.PPI || 0) / weekCount).toFixed(1)),
    SDC: Number(((docTotals30Days.SDC || 0) / weekCount).toFixed(1)),
    SMART: Number(((docTotals30Days.SMART || 0) / weekCount).toFixed(1)),
    BOQ: Number(((docTotals30Days.BOQ || 0) / weekCount).toFixed(1)),
  };

  const startFormatted = `${String(startDate.getDate()).padStart(2, '0')}/${String(
    startDate.getMonth() + 1
  ).padStart(2, '0')}/${startDate.getFullYear()}`;
  const todayFormatted = `${String(today.getDate()).padStart(2, '0')}/${String(
    today.getMonth() + 1
  ).padStart(2, '0')}/${today.getFullYear()}`;

  return {
    today,
    startDate,
    windowLabel: `${startFormatted} a ${todayFormatted}`,
    totalDeliveries30Days,
    averageDeliveriesPerWeek,
    docTotals30Days,
    docAveragesPerWeek,
    finalizedWithoutDateCount,
    weeks,
  };
}

export const EricssonWeeklyDeliveriesPanel: React.FC<EricssonWeeklyDeliveriesPanelProps> = ({
  rows,
  selectedWeekKey,
  selectedDocGroupFilter,
  onSelectWeekAndDoc,
}) => {
  const [viewDocGroup, setViewDocGroup] = useState<EricssonDocGroup | 'ALL'>('ALL');

  const data = useMemo(() => computeWeeklyDeliveries(rows), [rows]);

  // Compute maximum height for bars
  const maxCount = useMemo(() => {
    let max = 0;
    data.weeks.forEach((w) => {
      const count = viewDocGroup === 'ALL' ? w.count : w.docCounts[viewDocGroup] || 0;
      if (count > max) max = count;
    });
    return Math.max(max, 1);
  }, [data.weeks, viewDocGroup]);

  const activeWeekBucket = useMemo(() => {
    if (!selectedWeekKey) return null;
    return data.weeks.find((w) => w.key === selectedWeekKey) || null;
  }, [data.weeks, selectedWeekKey]);

  // Active display totals based on viewDocGroup
  const displayTotal =
    viewDocGroup === 'ALL'
      ? data.totalDeliveries30Days
      : data.docTotals30Days[viewDocGroup] || 0;

  const displayAverage =
    viewDocGroup === 'ALL'
      ? data.averageDeliveriesPerWeek
      : data.docAveragesPerWeek[viewDocGroup] || 0;

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200/80 flex items-center justify-center text-[#1E8E8D] shrink-0 shadow-2xs">
            <BarChart3 className="w-5 h-5 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-black text-slate-900 tracking-tight">
                ENTREGAS POR SEMANA POR TIPO DE DOCUMENTO
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-teal-50 text-teal-800 border border-teal-200">
                Últimos 30 Dias (Móvel)
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>
                Janela: <strong>{data.windowLabel}</strong> (Coluna <code>Entregue</code> • Fuso SP)
              </span>
            </p>
          </div>
        </div>

        {/* Right Stats Quick Badges & Doc Selector */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Doc Type Selector (ALL or Isolated) */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setViewDocGroup('ALL')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                viewDocGroup === 'ALL'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todos (Empilhado)
            </button>
            {ALL_DOC_GROUPS.map((doc) => {
              const cfg = DOC_COLOR_MAP[doc];
              const isSelected = viewDocGroup === doc;
              return (
                <button
                  key={doc}
                  type="button"
                  onClick={() => setViewDocGroup(doc)}
                  className={`px-2 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                    isSelected
                      ? `${cfg.lightBg} ${cfg.text} ring-1 ${cfg.border} shadow-2xs`
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title={`Ver apenas entregas de ${doc}`}
                >
                  <span className={`w-2 h-2 rounded-full ${cfg.bg}`} />
                  <span>{doc}</span>
                </button>
              );
            })}
          </div>

          {/* KPI Total 30 Days */}
          <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-2 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-none">
                {viewDocGroup === 'ALL' ? 'Total 30 Dias' : `Total ${viewDocGroup}`}
              </span>
              <span className="text-base font-black text-slate-900 font-mono leading-tight">
                {displayTotal}
              </span>
            </div>
          </div>

          {/* KPI Average / Week */}
          <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-2 shrink-0">
            <TrendingUp className="w-4 h-4 text-[#1E8E8D] shrink-0" />
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-none">
                Média / Semana
              </span>
              <span className="text-base font-black text-slate-900 font-mono leading-tight">
                {displayAverage}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards per Document Type (WR, QRF, PPI, SDC, SMART, BOQ) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1">
        {ALL_DOC_GROUPS.map((doc) => {
          const cfg = DOC_COLOR_MAP[doc];
          const total = data.docTotals30Days[doc] || 0;
          const avg = data.docAveragesPerWeek[doc] || 0;
          const isViewSelected = viewDocGroup === doc;

          return (
            <div
              key={doc}
              onClick={() => setViewDocGroup(isViewSelected ? 'ALL' : doc)}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                isViewSelected
                  ? `${cfg.lightBg} ${cfg.border} ring-1.5 ring-current shadow-2xs`
                  : 'bg-slate-50/70 hover:bg-slate-100/80 border-slate-200/80'
              }`}
              title={`Clique para isolar ${doc} no gráfico`}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                  <span className={`w-2 h-2 rounded-full ${cfg.bg}`} />
                  {doc}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">30d</span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-sm font-black font-mono text-slate-900">{total}</span>
                <span className="text-[10px] text-slate-500 font-medium">
                  {avg}/sem
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Discrete Warning for Finalized rows without delivery date */}
      {data.finalizedWithoutDateCount > 0 && (
        <div className="px-3 py-2 bg-amber-50/70 border border-amber-200/80 rounded-xl flex items-center justify-between gap-2 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>{data.finalizedWithoutDateCount}</strong>{' '}
              {data.finalizedWithoutDateCount === 1
                ? 'linha Finalizada não possui data preenchida'
                : 'linhas Finalizadas não possuem data preenchida'}{' '}
              na coluna <code>Entregue</code> e não{' '}
              {data.finalizedWithoutDateCount === 1 ? 'entrou' : 'entraram'} na contagem dos 30 dias.
            </span>
          </div>
          <span className="text-[10px] font-mono text-amber-700 bg-amber-100/60 px-2 py-0.5 rounded-md font-semibold shrink-0">
            Aviso
          </span>
        </div>
      )}

      {/* Active Filter Banner */}
      {(activeWeekBucket || selectedDocGroupFilter) && (
        <div className="px-3 py-2 bg-teal-50 border border-teal-200 rounded-xl flex items-center justify-between gap-2 text-xs text-teal-950 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#1E8E8D] shrink-0" />
            <span>
              Filtro ativo:{' '}
              {activeWeekBucket && (
                <strong>
                  {activeWeekBucket.label} (
                  {selectedDocGroupFilter
                    ? `${activeWeekBucket.docCounts[selectedDocGroupFilter] || 0} entregas de ${selectedDocGroupFilter}`
                    : `${activeWeekBucket.count} entregas`}
                  )
                </strong>
              )}
              {selectedDocGroupFilter && !activeWeekBucket && (
                <strong>Tipo de Documento: {selectedDocGroupFilter}</strong>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSelectWeekAndDoc(null, null)}
            className="px-2.5 py-1 rounded-lg bg-white hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
            title="Remover filtro"
          >
            <X className="w-3.5 h-3.5" />
            <span>Limpar Filtro</span>
          </button>
        </div>
      )}

      {/* Stacked Bar Chart */}
      <div className="pt-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {data.weeks.map((bucket) => {
            const isWeekSelected = selectedWeekKey === bucket.key;
            const weekTotalForView =
              viewDocGroup === 'ALL' ? bucket.count : bucket.docCounts[viewDocGroup] || 0;

            const heightPercent = maxCount > 0 ? Math.max((weekTotalForView / maxCount) * 100, 8) : 8;

            return (
              <div
                key={bucket.key}
                className={`group relative flex flex-col justify-between p-3 rounded-2xl border transition-all select-none ${
                  isWeekSelected
                    ? 'bg-teal-50/90 border-[#1E8E8D] shadow-sm ring-2 ring-[#1E8E8D]/30'
                    : 'bg-slate-50/70 hover:bg-teal-50/40 border-slate-200/90 hover:border-teal-300 shadow-2xs'
                }`}
              >
                {/* Top Tag & Week Title */}
                <div
                  className="space-y-1 cursor-pointer"
                  onClick={() =>
                    onSelectWeekAndDoc(
                      isWeekSelected && selectedDocGroupFilter === null ? null : bucket,
                      viewDocGroup === 'ALL' ? null : viewDocGroup
                    )
                  }
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-xs font-black tracking-tight ${
                        isWeekSelected ? 'text-teal-900' : 'text-slate-800'
                      }`}
                    >
                      Semana {bucket.weekIndex}
                    </span>
                    {bucket.tag ? (
                      <span
                        className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          bucket.isInProgress
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : 'bg-amber-100 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {bucket.tag}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {bucket.startStr} a {bucket.endStr}
                  </p>
                </div>

                {/* Bar Graphic (Stacked if viewDocGroup === 'ALL') */}
                <div className="py-3 flex flex-col items-center">
                  <div className="w-full h-32 flex items-end justify-center">
                    <div className="w-full max-w-[56px] flex flex-col items-center gap-1.5">
                      {/* Total Count Above Bar */}
                      <span
                        className={`font-mono text-xs font-black transition-colors ${
                          weekTotalForView > 0
                            ? isWeekSelected
                              ? 'text-teal-800'
                              : 'text-slate-900'
                            : 'text-slate-400'
                        }`}
                      >
                        {weekTotalForView}
                      </span>

                      {/* Bar Pillar with Stacked Segments */}
                      <div className="w-full bg-slate-200/80 rounded-t-xl overflow-hidden h-26 flex flex-col justify-end">
                        <div
                          style={{ height: `${heightPercent}%` }}
                          className="w-full flex flex-col-reverse rounded-t-xl overflow-hidden transition-all duration-300"
                        >
                          {weekTotalForView === 0 ? (
                            <div className="w-full h-full bg-slate-300/60" />
                          ) : viewDocGroup !== 'ALL' ? (
                            // Single Doc View
                            <div
                              onClick={() =>
                                onSelectWeekAndDoc(
                                  isWeekSelected && selectedDocGroupFilter === viewDocGroup
                                    ? null
                                    : bucket,
                                  viewDocGroup
                                )
                              }
                              className={`w-full h-full ${DOC_COLOR_MAP[viewDocGroup].bg} transition-all cursor-pointer hover:opacity-90`}
                              title={`${viewDocGroup}: ${weekTotalForView}`}
                            />
                          ) : (
                            // Stacked View (ALL 6 doc types)
                            ALL_DOC_GROUPS.map((doc) => {
                              const cnt = bucket.docCounts[doc] || 0;
                              if (cnt <= 0) return null;
                              const segHeight = (cnt / bucket.count) * 100;
                              const cfg = DOC_COLOR_MAP[doc];
                              const isSegSelected =
                                isWeekSelected && selectedDocGroupFilter === doc;

                              return (
                                <div
                                  key={doc}
                                  style={{ height: `${segHeight}%` }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectWeekAndDoc(
                                      isSegSelected ? null : bucket,
                                      isSegSelected ? null : doc
                                    );
                                  }}
                                  className={`${cfg.bg} w-full transition-all cursor-pointer hover:opacity-85 relative group/seg ${
                                    isSegSelected ? 'ring-2 ring-slate-900 z-10' : ''
                                  }`}
                                  title={`Semana ${bucket.weekIndex} • ${doc}: ${cnt} entregas (Clique para filtrar)`}
                                >
                                  {cnt >= 2 && (
                                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white/90 drop-shadow-xs pointer-events-none">
                                      {cnt}
                                    </span>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Footer Details */}
                <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-500 font-medium">
                  <span className="font-mono font-bold">
                    {weekTotalForView === 1 ? '1 entrega' : `${weekTotalForView} entregas`}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectWeekAndDoc(
                        isWeekSelected ? null : bucket,
                        viewDocGroup === 'ALL' ? null : viewDocGroup
                      )
                    }
                    className="text-[#1E8E8D] font-bold hover:underline cursor-pointer"
                  >
                    {isWeekSelected ? 'Filtrando' : 'Filtrar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Stacked Chart Legend */}
        {viewDocGroup === 'ALL' && (
          <div className="flex flex-wrap items-center justify-center gap-3 pt-3 border-t border-slate-100 text-xs">
            <span className="text-slate-400 font-semibold text-[11px]">Legenda de Cores:</span>
            {ALL_DOC_GROUPS.map((doc) => {
              const cfg = DOC_COLOR_MAP[doc];
              const isSelected = selectedDocGroupFilter === doc;
              return (
                <button
                  key={doc}
                  type="button"
                  onClick={() =>
                    onSelectWeekAndDoc(
                      activeWeekBucket,
                      isSelected ? null : doc
                    )
                  }
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 text-white font-bold shadow-2xs'
                      : 'hover:bg-slate-100 text-slate-700'
                  }`}
                  title={`Filtrar apenas ${doc}`}
                >
                  <span className={`w-2.5 h-2.5 rounded-sm ${cfg.bg}`} />
                  <span className="font-bold">{doc}</span>
                  <span className="font-mono text-[10px] text-slate-400">
                    ({data.docTotals30Days[doc] || 0})
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
