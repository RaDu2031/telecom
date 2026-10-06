import React from 'react';
import {
  BarChart3,
  Filter,
  X,
  Sparkles,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import {
  EricssonConsolidatedStats,
  EricssonDocGroup,
  ERICSSON_REAL_STATUSES_BY_DOC,
} from '../types/telecom';
import { getEricssonRealStatusStyle } from '../utils/ericssonSpreadsheetUtils';

interface EricssonConsolidatedTopPanelProps {
  stats: EricssonConsolidatedStats;
  selectedDocGroup: EricssonDocGroup | null;
  selectedRealStatus: string | null;
  onSelectFilter: (
    docGroup: EricssonDocGroup | null,
    realStatus: string | null
  ) => void;
  onClearFilter: () => void;
}

interface DocCardConfig {
  key: EricssonDocGroup;
  title: string;
  subtitle: string;
  badgeBg: string;
  badgeText: string;
}

const DOC_CONFIGS: DocCardConfig[] = [
  {
    key: 'WR',
    title: 'WR',
    subtitle: 'Work Report / Relatório Técnico',
    badgeBg: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    badgeText: 'text-indigo-700',
  },
  {
    key: 'QRF',
    title: 'QRF',
    subtitle: 'Qualificação Radiofrequência',
    badgeBg: 'bg-cyan-50 border-cyan-200 text-cyan-700',
    badgeText: 'text-cyan-700',
  },
  {
    key: 'PPI',
    title: 'PPI',
    subtitle: 'Projeto Padrão de Instalação',
    badgeBg: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    badgeText: 'text-emerald-700',
  },
  {
    key: 'BOQ',
    title: 'BOQ',
    subtitle: 'Bill of Quantities / Materiais',
    badgeBg: 'bg-amber-50 border-amber-200 text-amber-800',
    badgeText: 'text-amber-800',
  },
  {
    key: 'SMART',
    title: 'SMART',
    subtitle: 'SmartPlan / Planejamento',
    badgeBg: 'bg-violet-50 border-violet-200 text-violet-700',
    badgeText: 'text-violet-700',
  },
  {
    key: 'SDC',
    title: 'SDC',
    subtitle: 'Site Design Criteria / Projeto',
    badgeBg: 'bg-rose-50 border-rose-200 text-rose-700',
    badgeText: 'text-rose-700',
  },
];

export const EricssonConsolidatedTopPanel: React.FC<EricssonConsolidatedTopPanelProps> = ({
  stats,
  selectedDocGroup,
  selectedRealStatus,
  onSelectFilter,
  onClearFilter,
}) => {
  const isFilterActive = selectedDocGroup !== null || selectedRealStatus !== null;

  const getDocStats = (key: EricssonDocGroup) => {
    switch (key) {
      case 'WR': return stats.wr;
      case 'QRF': return stats.qrf;
      case 'PPI': return stats.ppi;
      case 'BOQ': return stats.boq;
      case 'SMART': return stats.smart;
      case 'SDC': return stats.sdc;
      default: return stats.wr;
    }
  };

  // Global totals
  const globalTotal =
    (stats.wr?.total || 0) +
    (stats.qrf?.total || 0) +
    (stats.ppi?.total || 0) +
    (stats.boq?.total || 0) +
    (stats.smart?.total || 0) +
    (stats.sdc?.total || 0);

  const globalFinalizado =
    (stats.wr?.finalizado || 0) +
    (stats.qrf?.finalizado || 0) +
    (stats.ppi?.finalizado || 0) +
    (stats.boq?.finalizado || 0) +
    (stats.smart?.finalizado || 0) +
    (stats.sdc?.finalizado || 0);

  const globalTaxa = globalTotal > 0 ? ((globalFinalizado / globalTotal) * 100).toFixed(1) : '0.0';

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
      {/* Top Header: Title + Active Filter Tag + Global Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1E8E8D] to-[#125c5b] text-white flex items-center justify-center shadow-xs shrink-0">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base font-black text-slate-900 tracking-tight">
                COMPARATIVO GERAL DAS 6 DOCUMENTAÇÕES
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-teal-50 text-teal-800 border border-teal-200">
                STATUS REAIS DA PLANILHA
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              WR, QRF, PPI, BOQ, SMART e SDC com contagem e segmentos por cada status real.
            </p>
          </div>
        </div>

        {/* Global summary KPI badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-2">
            <Layers className="w-4 h-4 text-slate-500" />
            <span className="text-xs text-slate-600 font-medium">
              Total Demandas: <strong className="text-slate-900 font-mono">{globalTotal}</strong>
            </span>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="text-xs text-emerald-800 font-medium">
              Finalizados: <strong className="text-emerald-950 font-mono">{globalFinalizado}</strong> ({globalTaxa}%)
            </span>
          </div>

          {isFilterActive && (
            <button
              type="button"
              onClick={onClearFilter}
              className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              title="Limpar filtros aplicados pelo comparativo"
            >
              <Filter className="w-3.5 h-3.5" />
              <span>
                Filtro: {selectedDocGroup || 'Todos'} {selectedRealStatus ? `• ${selectedRealStatus}` : ''}
              </span>
              <X className="w-3.5 h-3.5 ml-1" />
            </button>
          )}
        </div>
      </div>

      {/* Global Comparative Multi-segment Bar */}
      <div className="space-y-2 p-3 bg-slate-50/70 rounded-xl border border-slate-200/80">
        <div className="flex items-center justify-between text-xs font-bold text-slate-700">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-teal-600" />
            <span>Volume Consolidado por Documentação</span>
          </span>
          <span className="text-slate-500 font-mono text-[11px]">
            {globalTotal} total registrado
          </span>
        </div>

        {/* Multi-doc progress bar */}
        <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden flex">
          {DOC_CONFIGS.map((doc) => {
            const item = getDocStats(doc.key);
            const pct = globalTotal > 0 ? (item.total / globalTotal) * 100 : 0;
            if (pct <= 0) return null;

            const isSelected = selectedDocGroup === doc.key;
            let barColor = 'bg-slate-400';
            if (doc.key === 'WR') barColor = 'bg-indigo-600';
            else if (doc.key === 'QRF') barColor = 'bg-cyan-500';
            else if (doc.key === 'PPI') barColor = 'bg-emerald-600';
            else if (doc.key === 'BOQ') barColor = 'bg-amber-500';
            else if (doc.key === 'SMART') barColor = 'bg-violet-600';
            else if (doc.key === 'SDC') barColor = 'bg-rose-500';

            return (
              <div
                key={doc.key}
                style={{ width: `${pct}%` }}
                onClick={() => onSelectFilter(isSelected ? null : doc.key, null)}
                className={`${barColor} h-full transition-all cursor-pointer hover:opacity-90 relative group ${
                  isSelected ? 'ring-2 ring-slate-900 ring-offset-1 z-10' : ''
                }`}
                title={`${doc.title}: ${item.total} (${pct.toFixed(1)}%) - Finalizados: ${item.finalizado}`}
              />
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1">
          {DOC_CONFIGS.map((doc) => {
            const item = getDocStats(doc.key);
            const isSelected = selectedDocGroup === doc.key;
            return (
              <button
                key={doc.key}
                type="button"
                onClick={() => onSelectFilter(isSelected ? null : doc.key, null)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-slate-900 text-white font-bold shadow-2xs'
                    : 'hover:bg-slate-200/80 text-slate-700'
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    doc.key === 'WR'
                      ? 'bg-indigo-600'
                      : doc.key === 'QRF'
                      ? 'bg-cyan-500'
                      : doc.key === 'PPI'
                      ? 'bg-emerald-600'
                      : doc.key === 'BOQ'
                      ? 'bg-amber-500'
                      : doc.key === 'SMART'
                      ? 'bg-violet-600'
                      : 'bg-rose-500'
                  }`}
                />
                <span className="font-bold">{doc.title}</span>
                <span className="font-mono text-slate-400">({item.total})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 6 Individual Cards (1 for each doc type) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {DOC_CONFIGS.map((doc) => {
          const item = getDocStats(doc.key);
          const isDocSelected = selectedDocGroup === doc.key && selectedRealStatus === null;
          const realStatuses = ERICSSON_REAL_STATUSES_BY_DOC[doc.key] || [];

          return (
            <div
              key={doc.key}
              className={`rounded-2xl border p-3.5 transition-all flex flex-col justify-between space-y-3 relative ${
                selectedDocGroup === doc.key
                  ? 'bg-teal-50/50 border-[#1E8E8D] shadow-sm ring-1 ring-[#1E8E8D]/30'
                  : 'bg-white hover:bg-slate-50/70 border-slate-200/90 shadow-2xs'
              }`}
            >
              {/* Card Header */}
              <div>
                <div className="flex items-center justify-between gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSelectFilter(isDocSelected ? null : doc.key, null)}
                    className="flex items-center gap-1.5 text-left cursor-pointer group"
                    title={`Filtrar tabela por ${doc.title}`}
                  >
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-black tracking-wider uppercase border transition-colors ${
                        doc.badgeBg
                      } group-hover:shadow-2xs`}
                    >
                      {doc.title}
                    </span>
                  </button>

                  <span className="text-[11px] font-mono text-slate-400 font-bold">
                    {item.total} total
                  </span>
                </div>

                <p className="text-[10px] text-slate-500 line-clamp-1 mt-1 font-medium" title={doc.subtitle}>
                  {doc.subtitle}
                </p>

                {/* Taxa de Finalização */}
                <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-slate-400">
                    Taxa Finalização
                  </span>
                  <span className="text-xs font-black font-mono text-emerald-700">
                    {item.taxaFinalizacao.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Real Status Multi-segment Progress Bar */}
              <div className="space-y-1">
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden flex border border-slate-200/60">
                  {realStatuses.map((st) => {
                    const count = item.statusCounts[st] || 0;
                    const pct = item.total > 0 ? (count / item.total) * 100 : 0;
                    if (pct <= 0) return null;
                    const style = getEricssonRealStatusStyle(st);
                    const isStatusActive = selectedDocGroup === doc.key && selectedRealStatus === st;

                    return (
                      <div
                        key={st}
                        style={{ width: `${pct}%` }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectFilter(doc.key, isStatusActive ? null : st);
                        }}
                        className={`${style.bgClass} h-full transition-all cursor-pointer hover:opacity-90 relative ${
                          isStatusActive ? 'ring-2 ring-slate-900 z-10' : ''
                        }`}
                        title={`${st}: ${count} (${pct.toFixed(1)}%)`}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Status Buttons List with Real Names and Counts */}
              <div className="space-y-1 pt-1 border-t border-slate-100/90 max-h-[190px] overflow-y-auto pr-0.5">
                {realStatuses.map((st) => {
                  const count = item.statusCounts[st] || 0;
                  const isStatusActive = selectedDocGroup === doc.key && selectedRealStatus === st;
                  const style = getEricssonRealStatusStyle(st);

                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => onSelectFilter(doc.key, isStatusActive ? null : st)}
                      className={`w-full px-2 py-1 rounded-lg text-[10.5px] font-semibold flex items-center justify-between gap-1 transition-all cursor-pointer ${
                        isStatusActive
                          ? `${style.badgeClass} ring-1.5 ring-current font-black shadow-2xs`
                          : count > 0
                          ? 'bg-slate-50 hover:bg-slate-100 text-slate-700'
                          : 'bg-transparent text-slate-400 hover:bg-slate-50'
                      }`}
                      title={`Filtrar por ${doc.title} com status "${st}" (${count})`}
                    >
                      <span className="truncate text-left flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.bgClass}`} />
                        <span className="truncate">{st}</span>
                      </span>
                      <span
                        className={`font-mono text-[10px] font-bold shrink-0 ${
                          count > 0 ? (isStatusActive ? 'font-black' : 'text-slate-900') : 'text-slate-300'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
