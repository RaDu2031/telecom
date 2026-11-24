import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  BarChart3,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Users,
  MapPin,
  Filter,
  UserCheck,
  Minimize2,
  Maximize2,
  FileSpreadsheet,
  HardHat,
  X,
} from 'lucide-react';
import { TssrRow } from '../types/telecom';
import { normalizeAccents } from '../utils/spreadsheetUtils';

export type EngineeringChartCategory =
  | 'ALL'
  | 'A_FAZER'
  | 'AGUARDANDO'
  | 'FEITOS'
  | 'CANCELADOS';

export type EngineeringBreakdownMode = 'EXECUTOR' | 'UF' | 'STATUS';

export function getEngenhariaCategory(
  row: TssrRow
): 'CANCELADO' | 'AGUARDANDO' | 'FEITO' | 'A_FAZER' {
  const st = (row.fields?.['STATUS Engenharia'] || '').trim().toLowerCase();
  if (st.includes('cancelad')) {
    return 'CANCELADO';
  }
  if (st.includes('aprovad') && !st.includes('aguardando')) {
    return 'FEITO';
  }
  if (st.includes('conclu') || st.includes('finaliz') || st.includes('entregue')) {
    return 'FEITO';
  }
  if (st.includes('aguardando aprova') || st.includes('aguardando aprovação')) {
    return 'AGUARDANDO';
  }
  // All other statuses are active pending engineering work
  return 'A_FAZER';
}

interface EngineeringInteractiveChartProps {
  rows: TssrRow[];
  activeExecutorFilter: string;
  onSelectExecutorFilter: (executor: string) => void;
  activeUfFilter: string;
  onSelectUfFilter: (uf: string) => void;
  activeEngStatusFilter: string;
  onSelectEngStatusFilter: (status: string) => void;
  activeCategoryFilter: EngineeringChartCategory;
  onSelectCategoryFilter: (cat: EngineeringChartCategory) => void;
}

export const EngineeringInteractiveChart: React.FC<EngineeringInteractiveChartProps> = ({
  rows,
  activeExecutorFilter,
  onSelectExecutorFilter,
  activeUfFilter,
  onSelectUfFilter,
  activeEngStatusFilter,
  onSelectEngStatusFilter,
  activeCategoryFilter,
  onSelectCategoryFilter,
}) => {
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isBarsMinimized, setIsBarsMinimized] = useState<boolean>(false);
  const [breakdownMode, setBreakdownMode] =
    useState<EngineeringBreakdownMode>('EXECUTOR');
  const [showCompletedExecutors, setShowCompletedExecutors] =
    useState<boolean>(false);

  // Compute breakdown stats based on STATUS Engenharia
  const stats = useMemo(() => {
    let total = 0;
    let aFazerTotal = 0;
    let aguardandoTotal = 0;
    let concluidosTotal = 0;
    let canceladosTotal = 0;

    const executorMap = new Map<
      string,
      {
        executor: string;
        total: number;
        aFazer: number;
        aguardando: number;
        concluidos: number;
        cancelados: number;
      }
    >();

    const ufMap = new Map<
      string,
      {
        uf: string;
        total: number;
        aFazer: number;
        aguardando: number;
        concluidos: number;
        cancelados: number;
      }
    >();

    const statusMap = new Map<
      string,
      {
        status: string;
        count: number;
        category: 'CANCELADO' | 'AGUARDANDO' | 'FEITO' | 'A_FAZER';
      }
    >();

    rows.forEach((r) => {
      total++;
      const cat = getEngenhariaCategory(r);
      if (cat === 'CANCELADO') canceladosTotal++;
      else if (cat === 'AGUARDANDO') aguardandoTotal++;
      else if (cat === 'FEITO') concluidosTotal++;
      else aFazerTotal++;

      // Executor aggregation
      const exRaw = (r.fields?.['Executor'] || 'Sem Executor').trim() || 'Sem Executor';
      if (!executorMap.has(exRaw)) {
        executorMap.set(exRaw, {
          executor: exRaw,
          total: 0,
          aFazer: 0,
          aguardando: 0,
          concluidos: 0,
          cancelados: 0,
        });
      }
      const exEntry = executorMap.get(exRaw)!;
      exEntry.total++;
      if (cat === 'CANCELADO') exEntry.cancelados++;
      else if (cat === 'AGUARDANDO') exEntry.aguardando++;
      else if (cat === 'FEITO') exEntry.concluidos++;
      else exEntry.aFazer++;

      // UF aggregation
      const ufRaw = (r.fields?.['UF'] || 'Sem UF').trim().toUpperCase() || 'Sem UF';
      if (!ufMap.has(ufRaw)) {
        ufMap.set(ufRaw, {
          uf: ufRaw,
          total: 0,
          aFazer: 0,
          aguardando: 0,
          concluidos: 0,
          cancelados: 0,
        });
      }
      const ufEntry = ufMap.get(ufRaw)!;
      ufEntry.total++;
      if (cat === 'CANCELADO') ufEntry.cancelados++;
      else if (cat === 'AGUARDANDO') ufEntry.aguardando++;
      else if (cat === 'FEITO') ufEntry.concluidos++;
      else ufEntry.aFazer++;

      // Status aggregation
      const rawSt = (r.fields?.['STATUS Engenharia'] || 'Não Informado').trim() || 'Não Informado';
      if (!statusMap.has(rawSt)) {
        statusMap.set(rawSt, {
          status: rawSt,
          count: 0,
          category: cat,
        });
      }
      statusMap.get(rawSt)!.count++;
    });

    // Sort executors: 1º Executors with highest A Fazer / Pendentes, completed at the end
    const allExecutors = Array.from(executorMap.values()).sort((a, b) => {
      if (b.aFazer !== a.aFazer) return b.aFazer - a.aFazer;
      if (b.aguardando !== a.aguardando) return b.aguardando - a.aguardando;
      return b.total - a.total;
    });

    const completedExecutorsCount = allExecutors.filter(
      (e) => e.aFazer === 0 && e.total > 0
    ).length;

    // Sort UFs: highest A Fazer first
    const allUfs = Array.from(ufMap.values()).sort((a, b) => {
      if (b.aFazer !== a.aFazer) return b.aFazer - a.aFazer;
      return b.total - a.total;
    });

    // Sort Statuses by count descending
    const allStatuses = Array.from(statusMap.values()).sort(
      (a, b) => b.count - a.count
    );

    return {
      total,
      aFazerTotal,
      aguardandoTotal,
      concluidosTotal,
      canceladosTotal,
      allExecutors,
      completedExecutorsCount,
      allUfs,
      allStatuses,
    };
  }, [rows]);

  const hasAnyFilter =
    activeCategoryFilter !== 'ALL' ||
    activeExecutorFilter !== 'ALL' ||
    activeUfFilter !== 'ALL' ||
    activeEngStatusFilter !== 'ALL';

  const clearAllChartFilters = () => {
    onSelectCategoryFilter('ALL');
    onSelectExecutorFilter('ALL');
    onSelectUfFilter('ALL');
    onSelectEngStatusFilter('ALL');
  };

  // Filtered executors for display: 100% completed are hidden by default unless toggled or selected
  const displayedExecutors = useMemo(() => {
    return stats.allExecutors.filter((ex) => {
      if (showCompletedExecutors) return true;
      if (activeExecutorFilter === ex.executor) return true;
      return ex.aFazer > 0;
    });
  }, [stats.allExecutors, showCompletedExecutors, activeExecutorFilter]);

  return (
    <div className="bg-white border border-slate-200 rounded-[12px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
      {/* =====================================================================
          HEADER BAR: CONTROLE / MINIMIZAÇÃO / TÍTULO DA ABA DE GRÁFICOS
         ===================================================================== */}
      <div className="px-4 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsMinimized((prev) => !prev)}
            className="flex items-center gap-2 text-left cursor-pointer group"
            title={
              isMinimized
                ? 'Clique para expandir a visão dos executores da engenharia'
                : 'Clique para minimizar'
            }
          >
            <div className="w-7 h-7 rounded-[8px] bg-[#223585]/10 group-hover:bg-[#223585]/15 transition-colors flex items-center justify-center shrink-0">
              <HardHat className="w-4 h-4 text-[#223585]" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">
                Executores & STATUS Engenharia (TSSR TIM Nokia)
              </span>
              <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-full text-[11px] text-slate-600 font-mono font-semibold tabular-nums">
                {stats.total} sites
              </span>
            </div>
          </button>

          {/* Minimized inline summary pills */}
          {isMinimized && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
              <button
                type="button"
                onClick={() =>
                  onSelectCategoryFilter(
                    activeCategoryFilter === 'A_FAZER' ? 'ALL' : 'A_FAZER'
                  )
                }
                className={`px-2 py-0.5 rounded-md border cursor-pointer transition-colors ${
                  activeCategoryFilter === 'A_FAZER'
                    ? 'bg-amber-600 text-white border-amber-600 font-bold'
                    : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                }`}
              >
                1º A Fazer: {stats.aFazerTotal}
              </button>
              <button
                type="button"
                onClick={() =>
                  onSelectCategoryFilter(
                    activeCategoryFilter === 'AGUARDANDO' ? 'ALL' : 'AGUARDANDO'
                  )
                }
                className={`px-2 py-0.5 rounded-md border cursor-pointer transition-colors ${
                  activeCategoryFilter === 'AGUARDANDO'
                    ? 'bg-[#223585] text-white border-[#223585] font-bold'
                    : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                }`}
              >
                Aguardando Aprovação: {stats.aguardandoTotal}
              </button>
              <button
                type="button"
                onClick={() =>
                  onSelectCategoryFilter(
                    activeCategoryFilter === 'FEITOS' ? 'ALL' : 'FEITOS'
                  )
                }
                className={`px-2 py-0.5 rounded-md border cursor-pointer transition-colors ${
                  activeCategoryFilter === 'FEITOS'
                    ? 'bg-emerald-600 text-white border-emerald-600 font-bold'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                Feitos/Aprovados: {stats.concluidosTotal}
              </button>
            </div>
          )}

          {/* Active Filter Indicator */}
          {hasAnyFilter && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-[6px] text-[11px] font-semibold flex items-center gap-1">
                <Filter className="w-3 h-3 text-amber-600" />
                <span>
                  Filtro ativo
                  {activeCategoryFilter === 'A_FAZER'
                    ? ': Pendentes (A Fazer)'
                    : activeCategoryFilter === 'AGUARDANDO'
                    ? ': Aguardando Aprovação'
                    : activeCategoryFilter === 'FEITOS'
                    ? ': Aprovados / Feitos'
                    : activeCategoryFilter === 'CANCELADOS'
                    ? ': Cancelados'
                    : ''}
                  {activeExecutorFilter !== 'ALL'
                    ? ` · Executor: ${activeExecutorFilter}`
                    : ''}
                  {activeUfFilter !== 'ALL' ? ` · UF: ${activeUfFilter}` : ''}
                  {activeEngStatusFilter !== 'ALL'
                    ? ` · Status: ${activeEngStatusFilter}`
                    : ''}
                </span>
              </span>
              <button
                type="button"
                onClick={clearAllChartFilters}
                className="px-2 py-0.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-[6px] text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Limpar filtro</span>
              </button>
            </div>
          )}
        </div>

        {/* Right: Expand / Minimize */}
        <div className="flex items-center gap-1.5">
          {!isMinimized && (
            <button
              type="button"
              onClick={() => setIsBarsMinimized((prev) => !prev)}
              className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-[8px] text-[11px] font-medium text-slate-600 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span>{isBarsMinimized ? 'Mostrar Cards' : 'Ocultar Cards'}</span>
              {isBarsMinimized ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsMinimized((prev) => !prev)}
            className={`px-3 py-1 rounded-[8px] text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
              isMinimized
                ? 'bg-[#223585] hover:bg-[#1B2A6B] text-white border-transparent'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
            }`}
          >
            {isMinimized ? (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Abrir Gráficos</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Minimizar</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* =====================================================================
          EXPANDED BANNER: COMPARATIVO HORIZONTAL CORPORATE
         ===================================================================== */}
      {!isMinimized && !isBarsMinimized && (
        <div className="p-4 bg-slate-50/60 space-y-3">
          {/* Top Bar of the Chart */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span className="font-bold text-slate-900">
                {breakdownMode === 'EXECUTOR' &&
                  'Executores com Sites da Engenharia Pendentes:'}
                {breakdownMode === 'UF' &&
                  'UFs / Regionais com Sites Pendentes:'}
                {breakdownMode === 'STATUS' &&
                  'Distribuição por STATUS Engenharia:'}
              </span>

              {breakdownMode === 'EXECUTOR' && (
                <button
                  type="button"
                  onClick={() => setShowCompletedExecutors((prev) => !prev)}
                  className="px-2.5 py-0.5 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[11px] font-semibold cursor-pointer transition-colors tabular-nums"
                  title="Clique para alternar a exibição de executores com 100% concluídos"
                >
                  {showCompletedExecutors
                    ? `Mostrando todos (${stats.allExecutors.length})`
                    : `100% Feitos saem automático (${stats.completedExecutorsCount} concluídos ocultos)`}
                </button>
              )}

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                <button
                  type="button"
                  onClick={() =>
                    onSelectCategoryFilter(
                      activeCategoryFilter === 'A_FAZER' ? 'ALL' : 'A_FAZER'
                    )
                  }
                  className={`inline-flex items-center gap-1.5 font-semibold cursor-pointer transition-all ${
                    activeCategoryFilter === 'A_FAZER'
                      ? 'text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-300'
                      : 'text-amber-700 hover:text-amber-900'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                  <span>1º Pendentes (A Fazer): {stats.aFazerTotal}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onSelectCategoryFilter(
                      activeCategoryFilter === 'AGUARDANDO' ? 'ALL' : 'AGUARDANDO'
                    )
                  }
                  className={`inline-flex items-center gap-1.5 font-semibold cursor-pointer transition-all ${
                    activeCategoryFilter === 'AGUARDANDO'
                      ? 'text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-300'
                      : 'text-blue-700 hover:text-blue-900'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-[#223585] inline-block" />
                  <span>Aguardando Aprovação: {stats.aguardandoTotal}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onSelectCategoryFilter(
                      activeCategoryFilter === 'FEITOS' ? 'ALL' : 'FEITOS'
                    )
                  }
                  className={`inline-flex items-center gap-1.5 font-semibold cursor-pointer transition-all ${
                    activeCategoryFilter === 'FEITOS'
                      ? 'text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300'
                      : 'text-emerald-700 hover:text-emerald-900'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-[#1E8E8D] inline-block" />
                  <span>2º Aprovados / Feitos: {stats.concluidosTotal}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onSelectCategoryFilter(
                      activeCategoryFilter === 'CANCELADOS' ? 'ALL' : 'CANCELADOS'
                    )
                  }
                  className={`inline-flex items-center gap-1.5 font-semibold cursor-pointer transition-all ${
                    activeCategoryFilter === 'CANCELADOS'
                      ? 'text-slate-900 bg-slate-200/80 px-2 py-0.5 rounded border border-slate-300'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
                  <span>Cancelados: {stats.canceladosTotal}</span>
                </button>
              </div>
            </div>

            {/* Right Toggle Buttons */}
            <div className="flex flex-wrap items-center p-1 bg-slate-100 border border-slate-200 rounded-[8px] text-[11px] gap-0.5">
              <button
                type="button"
                onClick={() => setBreakdownMode('EXECUTOR')}
                className={`px-2.5 py-1 rounded-[6px] font-medium flex items-center gap-1 cursor-pointer transition-all tabular-nums ${
                  breakdownMode === 'EXECUTOR'
                    ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <HardHat className="w-3.5 h-3.5" />
                <span>Por Executor ({stats.allExecutors.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setBreakdownMode('UF')}
                className={`px-2.5 py-1 rounded-[6px] font-medium flex items-center gap-1 cursor-pointer transition-all tabular-nums ${
                  breakdownMode === 'UF'
                    ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>Por UF ({stats.allUfs.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setBreakdownMode('STATUS')}
                className={`px-2.5 py-1 rounded-[6px] font-medium flex items-center gap-1 cursor-pointer transition-all tabular-nums ${
                  breakdownMode === 'STATUS'
                    ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Por Status ({stats.allStatuses.length})</span>
              </button>
            </div>
          </div>

          {/* MODE 1: POR EXECUTOR */}
          {breakdownMode === 'EXECUTOR' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {displayedExecutors.map((item) => {
                const isSelected = activeExecutorFilter === item.executor;
                const activeTotal = item.total > 0 ? item.total : 1;
                const aFazerW = Math.round((item.aFazer / activeTotal) * 100);
                const aguardandoW = Math.round((item.aguardando / activeTotal) * 100);
                const feitoW = Math.round((item.concluidos / activeTotal) * 100);
                const canceladoW = Math.round((item.cancelados / activeTotal) * 100);

                return (
                  <button
                    key={item.executor}
                    type="button"
                    onClick={() => {
                      onSelectExecutorFilter(isSelected ? 'ALL' : item.executor);
                    }}
                    className={`p-3 rounded-[10px] border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#223585]/5 text-slate-900 border-[#223585] ring-2 ring-[#223585]/15'
                        : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                      <span className="font-bold truncate">{item.executor}</span>
                      <span className="font-mono text-[11px] font-bold shrink-0 text-amber-600">
                        {item.aFazer} pendente{item.aFazer !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-100 mb-1.5">
                      {aFazerW > 0 && (
                        <div
                          style={{ width: `${aFazerW}%` }}
                          className="bg-amber-500 h-full"
                          title={`A Fazer: ${item.aFazer}`}
                        />
                      )}
                      {aguardandoW > 0 && (
                        <div
                          style={{ width: `${aguardandoW}%` }}
                          className="bg-[#223585] h-full"
                          title={`Aguardando Aprovação: ${item.aguardando}`}
                        />
                      )}
                      {feitoW > 0 && (
                        <div
                          style={{ width: `${feitoW}%` }}
                          className="bg-[#1E8E8D] h-full"
                          title={`Feitos / Aprovados: ${item.concluidos}`}
                        />
                      )}
                      {canceladoW > 0 && (
                        <div
                          style={{ width: `${canceladoW}%` }}
                          className="bg-slate-400 h-full"
                          title={`Cancelados: ${item.cancelados}`}
                        />
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono text-slate-500">
                      <span className="font-semibold text-amber-700">
                        A Fazer: {item.aFazer}
                      </span>
                      <span className="font-semibold text-blue-700">
                        Aguardando: {item.aguardando}
                      </span>
                      {item.concluidos > 0 && (
                        <span className="text-emerald-700">Feitos: {item.concluidos}</span>
                      )}
                      {item.cancelados > 0 && (
                        <span className="text-slate-400">Canc: {item.cancelados}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* MODE 2: POR REGIONAL / UF */}
          {breakdownMode === 'UF' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {stats.allUfs.map((item) => {
                const isSelected = activeUfFilter === item.uf;
                const activeTotal = item.total > 0 ? item.total : 1;
                const aFazerW = Math.round((item.aFazer / activeTotal) * 100);
                const aguardandoW = Math.round((item.aguardando / activeTotal) * 100);
                const feitoW = Math.round((item.concluidos / activeTotal) * 100);

                return (
                  <button
                    key={item.uf}
                    type="button"
                    onClick={() => {
                      onSelectUfFilter(isSelected ? 'ALL' : item.uf);
                    }}
                    className={`p-3 rounded-[10px] border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#223585]/5 text-slate-900 border-[#223585] ring-2 ring-[#223585]/15'
                        : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                      <span className="font-bold truncate">UF: {item.uf}</span>
                      <span className="font-mono text-[11px] font-bold shrink-0 text-amber-600">
                        {item.aFazer} pendente{item.aFazer !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-100 mb-1.5">
                      {aFazerW > 0 && (
                        <div style={{ width: `${aFazerW}%` }} className="bg-amber-500 h-full" />
                      )}
                      {aguardandoW > 0 && (
                        <div style={{ width: `${aguardandoW}%` }} className="bg-[#223585] h-full" />
                      )}
                      {feitoW > 0 && (
                        <div style={{ width: `${feitoW}%` }} className="bg-[#1E8E8D] h-full" />
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono text-slate-500">
                      <span className="font-semibold text-amber-700">A Fazer: {item.aFazer}</span>
                      <span>Aguardando: {item.aguardando}</span>
                      <span>Total: {item.total}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* MODE 3: POR STATUS ENGENHARIA */}
          {breakdownMode === 'STATUS' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {stats.allStatuses.map((item) => {
                const isSelected = activeEngStatusFilter === item.status;
                const isAguardando = item.category === 'AGUARDANDO';
                const isCancelado = item.category === 'CANCELADO';
                const isFeito = item.category === 'FEITO';

                return (
                  <button
                    key={item.status}
                    type="button"
                    onClick={() => {
                      onSelectEngStatusFilter(isSelected ? 'ALL' : item.status);
                    }}
                    className={`p-3 rounded-[10px] border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#223585]/5 text-slate-900 border-[#223585] ring-2 ring-[#223585]/15'
                        : isAguardando
                        ? 'bg-blue-50/70 hover:bg-blue-50 border-blue-200 text-blue-900'
                        : isCancelado
                        ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                        : isFeito
                        ? 'bg-emerald-50/70 hover:bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-amber-50/70 hover:bg-amber-50 border-amber-200 text-amber-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs mb-1">
                      <span className="font-bold truncate">{item.status}</span>
                      <span className="font-mono text-xs font-bold tabular-nums">
                        {item.count}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {isAguardando && 'Aguardando aprovação da engenharia'}
                      {isCancelado && 'Demanda cancelada'}
                      {isFeito && 'Concluído / Aprovado'}
                      {item.category === 'A_FAZER' && 'Em andamento / A fazer'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
