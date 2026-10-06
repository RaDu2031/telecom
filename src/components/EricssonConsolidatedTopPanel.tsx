import React from 'react';
import {
  FileText,
  CheckCircle2,
  Clock,
  HelpCircle,
  BarChart3,
  Filter,
  X,
  Sparkles,
  Layers,
} from 'lucide-react';
import {
  EricssonConsolidatedStats,
  EricssonDocGroup,
  EricssonDocStatusCategory,
} from '../types/telecom';

interface EricssonConsolidatedTopPanelProps {
  stats: EricssonConsolidatedStats;
  selectedDocGroup: EricssonDocGroup | null;
  selectedStatusCat: EricssonDocStatusCategory | null;
  onSelectFilter: (
    docGroup: EricssonDocGroup | null,
    statusCat: EricssonDocStatusCategory | null
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
  selectedStatusCat,
  onSelectFilter,
  onClearFilter,
}) => {
  const isFilterActive = selectedDocGroup !== null || selectedStatusCat !== null;

  const getDocStats = (key: EricssonDocGroup) => {
    switch (key) {
      case 'WR': return stats.wr || { total: 0, finalizado: 0, emProducao: 0, pendente: 0, duvida: 0, outros: 0 };
      case 'QRF': return stats.qrf || { total: 0, finalizado: 0, emProducao: 0, pendente: 0, duvida: 0, outros: 0 };
      case 'PPI': return stats.ppi || { total: 0, finalizado: 0, emProducao: 0, pendente: 0, duvida: 0, outros: 0 };
      case 'BOQ': return stats.boq || { total: 0, finalizado: 0, emProducao: 0, pendente: 0, duvida: 0, outros: 0 };
      case 'SMART': return stats.smart || { total: 0, finalizado: 0, emProducao: 0, pendente: 0, duvida: 0, outros: 0 };
      case 'SDC': return stats.sdc || { total: 0, finalizado: 0, emProducao: 0, pendente: 0, duvida: 0, outros: 0 };
      default: return { total: 0, finalizado: 0, emProducao: 0, pendente: 0, duvida: 0, outros: 0 };
    }
  };

  // Global totals across WR, QRF, PPI, BOQ, SMART, SDC
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
  const globalEmProducao =
    (stats.wr?.emProducao || 0) +
    (stats.qrf?.emProducao || 0) +
    (stats.ppi?.emProducao || 0) +
    (stats.boq?.emProducao || 0) +
    (stats.smart?.emProducao || 0) +
    (stats.sdc?.emProducao || 0);
  const globalPendente =
    (stats.wr?.pendente || 0) +
    (stats.qrf?.pendente || 0) +
    (stats.ppi?.pendente || 0) +
    (stats.boq?.pendente || 0) +
    (stats.smart?.pendente || 0) +
    (stats.sdc?.pendente || 0);
  const globalDuvida =
    (stats.wr?.duvida || 0) +
    (stats.qrf?.duvida || 0) +
    (stats.ppi?.duvida || 0) +
    (stats.boq?.duvida || 0) +
    (stats.smart?.duvida || 0) +
    (stats.sdc?.duvida || 0);

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
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                Consolidado de Documentação Ericsson
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-teal-50 border border-teal-200 text-teal-800">
                WR · QRF · PPI · BOQ · SMART · SDC
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Total de{' '}
              <strong className="text-slate-800 font-mono">
                {globalTotal.toLocaleString('pt-BR')}
              </strong>{' '}
              documentações monitoradas em tempo real na planilha.
            </p>
          </div>
        </div>

        {/* Filter status / Clear Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          {isFilterActive && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold">
              <Filter className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>
                Filtro ativo:{' '}
                <strong>
                  {selectedDocGroup || 'Todas'}
                  {selectedStatusCat ? ` → ${selectedStatusCat}` : ''}
                </strong>
              </span>
              <button
                type="button"
                onClick={onClearFilter}
                className="ml-1.5 p-0.5 hover:bg-amber-200/70 rounded-md cursor-pointer text-amber-800"
                title="Limpar filtro e ver tudo"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Quick macro numbers pills */}
          <div className="hidden md:flex items-center gap-1.5 text-[11px] font-mono font-bold">
            <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              Finalizados: <strong>{globalFinalizado}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-600" />
              Faltam: <strong>{globalTotal - globalFinalizado}</strong>
            </span>
            <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
              Em prod.: {globalEmProducao}
            </span>
            <span className="px-2 py-1 rounded-lg bg-slate-50 text-slate-700 border border-slate-200">
              Pendentes: {globalPendente}
            </span>
            {globalDuvida > 0 && (
              <span className="px-2 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-200">
                Dúvidas: {globalDuvida}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Global Comparative Side-by-Side Chart (WR, QRF, PPI, BOQ, SMART, SDC) */}
      <div className="bg-slate-50/80 border border-slate-200/70 rounded-xl p-3.5 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-700 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span>Comparativo Geral das 6 Documentações:</span>
          </span>
          <div className="flex items-center gap-3 text-[11px] text-slate-600 font-medium">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Finalizado
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              Em produção
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              Pendente
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
              Dúvida
            </span>
          </div>
        </div>

        {/* Stacked comparison bars side by side */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {DOC_CONFIGS.map(({ key }) => {
            const docStats = getDocStats(key);
            const docTotal = docStats.total || 1;
            const pctFin = Math.round((docStats.finalizado / docTotal) * 100);
            const pctProd = Math.round((docStats.emProducao / docTotal) * 100);
            const pctPend = Math.round((docStats.pendente / docTotal) * 100);
            const pctDuv = Math.round((docStats.duvida / docTotal) * 100);

            const isSelected = selectedDocGroup === key;

            return (
              <div
                key={key}
                onClick={() => {
                  if (selectedDocGroup === key && selectedStatusCat === null) {
                    onClearFilter();
                  } else {
                    onSelectFilter(key, null);
                  }
                }}
                className={`p-2 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-white border-teal-500 shadow-2xs ring-1 ring-teal-500'
                    : 'bg-white/80 hover:bg-white border-slate-200'
                }`}
                title={`Clique para filtrar por ${key}`}
              >
                <div className="flex items-center justify-between text-xs mb-1 font-bold">
                  <span className="text-slate-800">{key}</span>
                  <span className="font-mono text-slate-500 tabular-nums">
                    {docStats.total.toLocaleString('pt-BR')} itens ({pctFin}% fin.)
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                  {pctFin > 0 && (
                    <div
                      style={{ width: `${pctFin}%` }}
                      className="bg-emerald-500 transition-all"
                      title={`Finalizado: ${docStats.finalizado} (${pctFin}%)`}
                    />
                  )}
                  {pctProd > 0 && (
                    <div
                      style={{ width: `${pctProd}%` }}
                      className="bg-blue-500 transition-all"
                      title={`Em produção: ${docStats.emProducao} (${pctProd}%)`}
                    />
                  )}
                  {pctPend > 0 && (
                    <div
                      style={{ width: `${pctPend}%` }}
                      className="bg-amber-500 transition-all"
                      title={`Pendente: ${docStats.pendente} (${pctPend}%)`}
                    />
                  )}
                  {pctDuv > 0 && (
                    <div
                      style={{ width: `${pctDuv}%` }}
                      className="bg-purple-500 transition-all"
                      title={`Dúvida: ${docStats.duvida} (${pctDuv}%)`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 6 Cards: WR, QRF, PPI, BOQ, SMART, SDC */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {DOC_CONFIGS.map((doc) => {
          const docStats = getDocStats(doc.key);

          const isCardSelected = selectedDocGroup === doc.key;
          const docTotal = docStats.total || 1;
          const finPct = ((docStats.finalizado / docTotal) * 100).toFixed(1);

          return (
            <div
              key={doc.key}
              className={`rounded-2xl border transition-all p-4 flex flex-col justify-between gap-3 ${
                isCardSelected
                  ? 'bg-gradient-to-b from-white to-teal-50/40 border-[#1E8E8D] shadow-sm ring-2 ring-[#1E8E8D]/30'
                  : 'bg-white hover:bg-slate-50/80 border-slate-200 shadow-2xs'
              }`}
            >
              {/* Card Top: Title + Subtitle + Total */}
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider border shadow-2xs ${doc.badgeBg}`}
                    >
                      {doc.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (isCardSelected && selectedStatusCat === null) {
                          onClearFilter();
                        } else {
                          onSelectFilter(doc.key, null);
                        }
                      }}
                      className="text-xs text-slate-500 hover:text-slate-900 font-semibold cursor-pointer truncate max-w-[140px]"
                      title="Clique para filtrar apenas esta documentação"
                    >
                      {doc.subtitle}
                    </button>
                  </div>

                  <span className="font-mono text-sm font-black text-slate-900 tabular-nums">
                    {docStats.total.toLocaleString('pt-BR')}
                  </span>
                </div>

                {/* Micro progress indicator */}
                <div className="mt-2.5 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Taxa de Finalização</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {finPct}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden flex">
                    <div
                      style={{ width: `${finPct}%` }}
                      className="bg-emerald-500 transition-all rounded-full"
                    />
                  </div>
                </div>

                {/* Destaque Principal: Finalizado e Quantos Faltam */}
                <div className="grid grid-cols-2 gap-2 mt-3 p-2 rounded-xl bg-slate-50/90 border border-slate-200">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Finalizado
                    </span>
                    <span className="font-mono text-sm font-black text-emerald-700 tabular-nums">
                      {docStats.finalizado}{' '}
                      <span className="text-[10px] font-semibold text-emerald-600">({finPct}%)</span>
                    </span>
                  </div>
                  <div className="flex flex-col border-l border-slate-200/80 pl-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      Faltam
                    </span>
                    <span className="font-mono text-sm font-black text-amber-700 tabular-nums">
                      {Math.max(0, docStats.total - docStats.finalizado)}{' '}
                      <span className="text-[10px] font-semibold text-amber-600">
                        ({(100 - Number(finPct)).toFixed(1)}%)
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Status Buttons Grid: Finalizado, Em produção, Pendente, Dúvida */}
              <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-100">
                {/* 1. Finalizado */}
                <button
                  type="button"
                  onClick={() => {
                    if (isCardSelected && selectedStatusCat === 'Finalizado') {
                      onClearFilter();
                    } else {
                      onSelectFilter(doc.key, 'Finalizado');
                    }
                  }}
                  className={`px-2.5 py-1.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                    isCardSelected && selectedStatusCat === 'Finalizado'
                      ? 'bg-emerald-600 border-emerald-700 text-white shadow-xs font-bold'
                      : 'bg-emerald-50/70 hover:bg-emerald-100/80 border-emerald-200 text-emerald-900'
                  }`}
                  title={`Filtrar ${doc.title} por Finalizado`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-[11px] truncate font-medium">Finalizado</span>
                  </div>
                  <span className="font-mono text-xs font-black tabular-nums">
                    {docStats.finalizado}
                  </span>
                </button>

                {/* 2. Em produção */}
                <button
                  type="button"
                  onClick={() => {
                    if (isCardSelected && selectedStatusCat === 'Em produção') {
                      onClearFilter();
                    } else {
                      onSelectFilter(doc.key, 'Em produção');
                    }
                  }}
                  className={`px-2.5 py-1.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                    isCardSelected && selectedStatusCat === 'Em produção'
                      ? 'bg-blue-600 border-blue-700 text-white shadow-xs font-bold'
                      : 'bg-blue-50/70 hover:bg-blue-100/80 border-blue-200 text-blue-900'
                  }`}
                  title={`Filtrar ${doc.title} por Em produção`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-[11px] truncate font-medium">Em prod.</span>
                  </div>
                  <span className="font-mono text-xs font-black tabular-nums">
                    {docStats.emProducao}
                  </span>
                </button>

                {/* 3. Pendente */}
                <button
                  type="button"
                  onClick={() => {
                    if (isCardSelected && selectedStatusCat === 'Pendente') {
                      onClearFilter();
                    } else {
                      onSelectFilter(doc.key, 'Pendente');
                    }
                  }}
                  className={`px-2.5 py-1.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                    isCardSelected && selectedStatusCat === 'Pendente'
                      ? 'bg-amber-500 border-amber-600 text-slate-950 shadow-xs font-black'
                      : 'bg-amber-50/70 hover:bg-amber-100/80 border-amber-300 text-amber-900'
                  }`}
                  title={`Filtrar ${doc.title} por Pendente`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <span className="text-[11px] truncate font-medium">Pendente</span>
                  </div>
                  <span className="font-mono text-xs font-black tabular-nums">
                    {docStats.pendente}
                  </span>
                </button>

                {/* 4. Dúvida */}
                <button
                  type="button"
                  onClick={() => {
                    if (isCardSelected && selectedStatusCat === 'Dúvida') {
                      onClearFilter();
                    } else {
                      onSelectFilter(doc.key, 'Dúvida');
                    }
                  }}
                  className={`px-2.5 py-1.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                    isCardSelected && selectedStatusCat === 'Dúvida'
                      ? 'bg-purple-600 border-purple-700 text-white shadow-xs font-bold'
                      : 'bg-purple-50/70 hover:bg-purple-100/80 border-purple-200 text-purple-900'
                  }`}
                  title={`Filtrar ${doc.title} por Dúvida`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-[11px] truncate font-medium">Dúvida</span>
                  </div>
                  <span className="font-mono text-xs font-black tabular-nums">
                    {docStats.duvida}
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
