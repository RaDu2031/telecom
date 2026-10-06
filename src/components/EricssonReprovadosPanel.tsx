import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  Calendar,
  Filter,
  Plus,
  X,
  Sparkles,
  User,
  Layers,
  ChevronDown,
  BarChart2,
  Table as TableIcon,
  CheckCircle,
  TrendingDown,
} from 'lucide-react';
import {
  EricssonEngineeringRow,
  EricssonDocGroup,
  EricssonReprovacaoRecord,
} from '../types/telecom';
import {
  classifyEricssonDocGroup,
  isEricssonRowReproved,
} from '../utils/ericssonSpreadsheetUtils';
import {
  ALL_DOC_GROUPS,
  DOC_COLOR_MAP,
  parseEricssonDeliveryDate,
  getSaoPauloDate,
} from './EricssonWeeklyDeliveriesPanel';

export interface EricssonReprovadosPanelProps {
  rows: EricssonEngineeringRow[];
  reprovacoes: EricssonReprovacaoRecord[];
  onRegisterReprovacao?: (record: Omit<EricssonReprovacaoRecord, 'id' | 'createdAt'>) => Promise<void>;
  selectedReprovadoExecutor: string | null;
  selectedReprovadoDocGroup: EricssonDocGroup | null;
  onSelectReprovadoFilter: (executor: string | null, docGroup: EricssonDocGroup | null) => void;
}

export const EricssonReprovadosPanel: React.FC<EricssonReprovadosPanelProps> = ({
  rows,
  reprovacoes,
  onRegisterReprovacao,
  selectedReprovadoExecutor,
  selectedReprovadoDocGroup,
  onSelectReprovadoFilter,
}) => {
  // Mode toggle: 'chart' (Gráfico Compacto - default) vs 'table' (Tabela)
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

  // Filters: Default to 'ALL' (Todos) so all reprovations in spreadsheet are immediately visible
  const [periodFilter, setPeriodFilter] = useState<'ALL' | '30d' | '7d' | '60d'>('ALL');
  const [regionalFilter, setRegionalFilter] = useState<string>('ALL');

  // Modal for new reprovação
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalIntervencao, setModalIntervencao] = useState<string>('');
  const [modalTipoDoc, setModalTipoDoc] = useState<EricssonDocGroup>('WR');
  const [modalExecutor, setModalExecutor] = useState<string>('');
  const [modalMotivo, setModalMotivo] = useState<string>('');
  const [modalData, setModalData] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  });
  const [modalRegional, setModalRegional] = useState<string>('SPM');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Derive all distinct regionais
  const distinctRegionais = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const reg = r.regional || r.fields?.['Regional'];
      if (reg && reg.trim()) set.add(reg.trim());
    });
    reprovacoes.forEach((rep) => {
      if (rep.regional && rep.regional.trim()) set.add(rep.regional.trim());
    });
    return Array.from(set).sort();
  }, [rows, reprovacoes]);

  // Derive all distinct executors
  const distinctExecutors = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const ex =
        r.executor ||
        r.fields?.['EXECUTOR'] ||
        r.fields?.['EXECUTOR WR'] ||
        r.fields?.['EXECUTOR QRF'] ||
        r.fields?.['EXECUTOR PPI'] ||
        r.fields?.['Executor'];
      if (ex && ex.trim() && ex.trim() !== '—' && ex.trim() !== '-') {
        set.add(ex.trim());
      }
    });
    reprovacoes.forEach((rep) => {
      if (rep.executor && rep.executor.trim()) set.add(rep.executor.trim());
    });
    return Array.from(set).sort();
  }, [rows, reprovacoes]);

  // Combine explicit reprovações and spreadsheet rows identified as reproved
  const combinedReprovacoes = useMemo(() => {
    const list: EricssonReprovacaoRecord[] = [...reprovacoes];

    rows.forEach((row) => {
      const isRep = isEricssonRowReproved(row, reprovacoes);

      if (isRep) {
        const rawDoc = row.tipoDoc || row.fields?.['Tipo doc'] || '';
        const docGroup = classifyEricssonDocGroup(rawDoc) || 'WR';
        const ex =
          row.executor ||
          row.fields?.['EXECUTOR'] ||
          row.fields?.['EXECUTOR WR'] ||
          row.fields?.['EXECUTOR QRF'] ||
          row.fields?.['EXECUTOR PPI'] ||
          row.fields?.['Executor'] ||
          'Sem Executor';

        const rowDateStr =
          row.fields?.['WR REV. PLAN'] ||
          row.fields?.['QRF REV. PLAN'] ||
          row.fields?.['PPI REV. PLAN'] ||
          row.fields?.['DATA REPLAN'] ||
          row.fields?.['Data Reprovação'] ||
          row.fields?.['Demanda'] ||
          row.fields?.['Entregue'] ||
          row.updatedAt?.slice(0, 10) ||
          '';

        const interv =
          row.intervencaoClaro ||
          row.fields?.['Intervencao Claro'] ||
          row.siteIdA ||
          row.id;

        // Check if row already has explicit reproval entry
        const alreadyExists = list.some(
          (r) =>
            r.rowId === row.id ||
            (r.intervencaoClaro === interv && r.tipoDoc === docGroup)
        );

        if (!alreadyExists) {
          list.push({
            id: `auto-rep-${row.id}`,
            rowId: row.id,
            intervencaoClaro: interv,
            tipoDoc: docGroup,
            executor: ex.trim(),
            motivo:
              row.fields?.['MOTIVO DE REVISÃO DO QRF'] ||
              row.fields?.['MOTIVO DE REVISÃO DO PPI'] ||
              row.fields?.['MOTIVO'] ||
              row.fields?.['MOTIVO REPROVAÇÃO'] ||
              row.fields?.['Comentário STATUS'] ||
              `Status: ${row.status || 'Em correção'}`,
            dataReprovacao: rowDateStr,
            regional: row.regional || row.fields?.['Regional'] || 'SPM',
            tipoSite: row.tipoSite || row.fields?.['TIPO SITE'],
            statusOriginal: row.status,
          });
        }
      }
    });

    return list;
  }, [reprovacoes, rows]);

  // Find most recent reference date in dataset for windowing
  const referenceLatestDate = useMemo(() => {
    let latest: Date | null = null;
    combinedReprovacoes.forEach((r) => {
      if (r.dataReprovacao) {
        const d = parseEricssonDeliveryDate(r.dataReprovacao);
        if (d && (!latest || d > latest)) {
          latest = d;
        }
      }
    });
    return latest || getSaoPauloDate();
  }, [combinedReprovacoes]);

  // Date boundary calculation based on periodFilter
  const startDate = useMemo(() => {
    if (periodFilter === 'ALL') return null;
    const refDate = new Date(referenceLatestDate);
    const days = periodFilter === '7d' ? 7 : periodFilter === '60d' ? 60 : 30;
    const start = new Date(refDate);
    start.setDate(refDate.getDate() - (days - 1));
    return start;
  }, [periodFilter, referenceLatestDate]);

  // Filter reprovações based on date and regional
  const filteredReprovacoes = useMemo(() => {
    return combinedReprovacoes.filter((rep) => {
      // Regional filter
      if (regionalFilter !== 'ALL' && rep.regional) {
        if (rep.regional !== regionalFilter) return false;
      }

      // Date filter
      if (startDate && rep.dataReprovacao) {
        const d = parseEricssonDeliveryDate(rep.dataReprovacao);
        if (d && d < startDate) return false;
      }

      return true;
    });
  }, [combinedReprovacoes, regionalFilter, startDate]);

  // Compute Matrix & Ranking Stats
  const { executorStats, docTotals, grandTotal, maxExecutorTotal, topExecutor, topDoc } = useMemo(() => {
    const statsMap: Record<string, Record<EricssonDocGroup, number> & { total: number }> = {};
    const dTotals: Record<EricssonDocGroup, number> = {
      WR: 0,
      QRF: 0,
      PPI: 0,
      SDC: 0,
      SMART: 0,
      BOQ: 0,
    };
    let gTotal = 0;

    filteredReprovacoes.forEach((rep) => {
      const ex = rep.executor?.trim() || 'Sem Executor';
      const doc = (classifyEricssonDocGroup(rep.tipoDoc) || 'WR') as EricssonDocGroup;

      if (!statsMap[ex]) {
        statsMap[ex] = {
          WR: 0,
          QRF: 0,
          PPI: 0,
          SDC: 0,
          SMART: 0,
          BOQ: 0,
          total: 0,
        };
      }

      statsMap[ex][doc]++;
      statsMap[ex].total++;
      dTotals[doc]++;
      gTotal++;
    });

    const list = Object.entries(statsMap).map(([executor, data]) => ({
      executor,
      ...data,
    }));

    list.sort((a, b) => b.total - a.total);

    const maxTotal = list.length > 0 ? list[0].total : 1;
    const topEx = list.length > 0 ? list[0] : null;

    let topD: { doc: EricssonDocGroup; count: number } = { doc: 'WR', count: 0 };
    Object.entries(dTotals).forEach(([d, count]) => {
      if (count > topD.count) {
        topD = { doc: d as EricssonDocGroup, count };
      }
    });

    return {
      executorStats: list,
      docTotals: dTotals,
      grandTotal: gTotal,
      maxExecutorTotal: maxTotal,
      topExecutor: topEx,
      topDoc: topD.count > 0 ? topD : null,
    };
  }, [filteredReprovacoes]);

  // Handle saving new reprovação
  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalIntervencao.trim() || !modalExecutor.trim() || !modalMotivo.trim()) {
      alert('Por favor preencha a Intervenção, Executor e Motivo da reprovação.');
      return;
    }

    try {
      setIsSaving(true);
      if (onRegisterReprovacao) {
        await onRegisterReprovacao({
          intervencaoClaro: modalIntervencao.trim(),
          tipoDoc: modalTipoDoc,
          executor: modalExecutor.trim(),
          motivo: modalMotivo.trim(),
          dataReprovacao: modalData,
          regional: modalRegional,
        });
      }
      setIsModalOpen(false);
      setModalIntervencao('');
      setModalMotivo('');
      setModalExecutor('');
    } catch (err) {
      console.error('Erro ao registrar reprovação:', err);
      alert('Erro ao registrar reprovação.');
    } finally {
      setIsSaving(false);
    }
  };

  const isFilterActive = selectedReprovadoExecutor !== null || selectedReprovadoDocGroup !== null;

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-3 sm:p-4 shadow-xs space-y-2.5">
      {/* Compact Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
            <AlertTriangle className="w-4 h-4 stroke-[2.2]" />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">
              REPROVAÇÕES POR EXECUTOR
            </h3>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-black uppercase font-mono bg-rose-50 text-rose-700 border border-rose-200">
              {grandTotal} {grandTotal === 1 ? 'reprovação' : 'reprovações'}
            </span>
          </div>
        </div>

        {/* Compact Controls: View Toggle + Period + Regional + Add */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setViewMode('chart')}
              className={`px-2 py-0.5 rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                viewMode === 'chart'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart2 className="w-3 h-3 text-rose-600" />
              <span>Gráfico</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-2 py-0.5 rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TableIcon className="w-3 h-3 text-slate-500" />
              <span>Tabela</span>
            </button>
          </div>

          {/* Period Filter */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setPeriodFilter('ALL')}
              className={`px-1.5 py-0.5 rounded-md transition-all cursor-pointer ${
                periodFilter === 'ALL'
                  ? 'bg-white text-slate-900 shadow-2xs font-black text-rose-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setPeriodFilter('30d')}
              className={`px-1.5 py-0.5 rounded-md transition-all cursor-pointer ${
                periodFilter === '30d'
                  ? 'bg-white text-slate-900 shadow-2xs font-black text-rose-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              30d
            </button>
            <button
              type="button"
              onClick={() => setPeriodFilter('60d')}
              className={`px-1.5 py-0.5 rounded-md transition-all cursor-pointer ${
                periodFilter === '60d'
                  ? 'bg-white text-slate-900 shadow-2xs font-black text-rose-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              60d
            </button>
            <button
              type="button"
              onClick={() => setPeriodFilter('7d')}
              className={`px-1.5 py-0.5 rounded-md transition-all cursor-pointer ${
                periodFilter === '7d'
                  ? 'bg-white text-slate-900 shadow-2xs font-black text-rose-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              7d
            </button>
          </div>

          {/* Regional Selector */}
          <select
            value={regionalFilter}
            onChange={(e) => setRegionalFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 text-[11px] font-bold px-2 py-0.8 rounded-lg focus:outline-none cursor-pointer"
          >
            <option value="ALL">Regional: Todas</option>
            {distinctRegionais.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          {/* + Registrar Reprovação */}
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold transition-all shadow-2xs flex items-center gap-1 cursor-pointer shrink-0"
          >
            <Plus className="w-3 h-3" />
            <span>+ Registrar</span>
          </button>
        </div>
      </div>

      {/* Slim Inline Summary Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/90 border border-slate-200/80 px-2.5 py-1 rounded-xl text-xs">
        <div className="flex items-center gap-2.5 flex-wrap text-[11px]">
          <span className="text-slate-500">
            Total:{' '}
            <strong className="text-rose-700 font-mono font-black">{grandTotal}</strong>
          </span>
          <span className="text-slate-300">•</span>
          <span className="text-slate-500">
            Executores:{' '}
            <strong className="text-slate-800 font-mono font-bold">{executorStats.length}</strong>
          </span>
          {topExecutor && (
            <>
              <span className="text-slate-300">•</span>
              <span className="text-slate-500 truncate max-w-[240px]">
                Maior volume:{' '}
                <button
                  type="button"
                  onClick={() => onSelectReprovadoFilter(topExecutor.executor, null)}
                  className="font-bold text-slate-900 hover:text-rose-600 cursor-pointer underline decoration-dotted"
                  title={`Filtrar reprovações de ${topExecutor.executor}`}
                >
                  {topExecutor.executor} ({topExecutor.total})
                </button>
              </span>
            </>
          )}
          {topDoc && (
            <>
              <span className="text-slate-300">•</span>
              <span className="text-slate-500">
                Doc mais afetado:{' '}
                <button
                  type="button"
                  onClick={() => onSelectReprovadoFilter(null, topDoc.doc)}
                  className="font-bold text-slate-900 hover:text-rose-600 cursor-pointer underline decoration-dotted"
                  title={`Filtrar reprovações de ${topDoc.doc}`}
                >
                  {topDoc.doc} ({topDoc.count})
                </button>
              </span>
            </>
          )}
        </div>

        {/* Active Filter Clear button if active */}
        {isFilterActive && (
          <div className="flex items-center gap-1.5 bg-rose-100 text-rose-950 px-2 py-0.5 rounded-md font-bold text-[11px] shadow-2xs">
            <span>
              Filtrando:{' '}
              {selectedReprovadoExecutor && <strong>{selectedReprovadoExecutor}</strong>}
              {selectedReprovadoExecutor && selectedReprovadoDocGroup && ' • '}
              {selectedReprovadoDocGroup && <strong>{selectedReprovadoDocGroup}</strong>}
            </span>
            <button
              type="button"
              onClick={() => onSelectReprovadoFilter(null, null)}
              className="hover:text-rose-800 cursor-pointer p-0.5 font-black"
              title="Limpar filtro"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* =====================================================================
          1. GRÁFICO RESUMIDO E COMPACTO (SLIM HORIZONTAL BARS)
         ===================================================================== */}
      {viewMode === 'chart' && (
        <div className="space-y-2">
          {executorStats.length === 0 ? (
            <div className="py-4 text-center text-slate-400 text-xs italic bg-slate-50/50 rounded-xl border border-slate-200/80">
              Nenhuma reprovação encontrada para os filtros selecionados.
            </div>
          ) : (
            <div className="max-h-[160px] overflow-y-auto pr-1 space-y-1 divide-y divide-slate-100/80">
              {executorStats.map((item, index) => {
                const isSelected =
                  selectedReprovadoExecutor?.toLowerCase() === item.executor.toLowerCase() &&
                  selectedReprovadoDocGroup === null;
                const barWidthPct = Math.max((item.total / maxExecutorTotal) * 100, 6);

                return (
                  <div
                    key={item.executor}
                    className={`pt-1 first:pt-0 flex items-center justify-between gap-2 transition-all text-xs ${
                      isSelected
                        ? 'bg-rose-50/90 px-2 py-0.8 rounded-lg font-bold border border-rose-200 shadow-2xs'
                        : 'hover:bg-slate-50 px-1 py-0.5 rounded'
                    }`}
                  >
                    {/* Position # + Executor Name */}
                    <div className="w-[170px] sm:w-[210px] shrink-0 flex items-center gap-1.5 min-w-0">
                      <span className="w-4 h-4 rounded-full bg-slate-200/80 text-slate-700 text-[9px] font-black flex items-center justify-center shrink-0">
                        {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onSelectReprovadoFilter(
                            isSelected ? null : item.executor,
                            null
                          )
                        }
                        className="font-bold text-[11px] text-slate-800 hover:text-rose-600 truncate text-left cursor-pointer transition-colors"
                        title={`Clique para filtrar demandas de ${item.executor}`}
                      >
                        {item.executor}
                      </button>
                    </div>

                    {/* Compact Horizontal Stacked Bar */}
                    <div className="flex-1 max-w-sm hidden sm:block">
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden flex">
                        <div
                          style={{ width: `${barWidthPct}%` }}
                          className="h-full flex rounded-full overflow-hidden transition-all duration-300"
                        >
                          {ALL_DOC_GROUPS.map((doc) => {
                            const count = item[doc] || 0;
                            if (count <= 0) return null;
                            const pctInBar = (count / item.total) * 100;
                            const cfg = DOC_COLOR_MAP[doc];
                            const isDocSegSelected =
                              selectedReprovadoExecutor?.toLowerCase() === item.executor.toLowerCase() &&
                              selectedReprovadoDocGroup === doc;

                            return (
                              <div
                                key={doc}
                                style={{ width: `${pctInBar}%` }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectReprovadoFilter(
                                    isDocSegSelected ? null : item.executor,
                                    isDocSegSelected ? null : doc
                                  );
                                }}
                                className={`${cfg.bg} h-full transition-all cursor-pointer hover:opacity-85 ${
                                  isDocSegSelected ? 'ring-2 ring-slate-900 z-10' : ''
                                }`}
                                title={`${item.executor} • ${doc}: ${count}`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Mini Doc Pills + Total Badge */}
                    <div className="flex items-center gap-1 shrink-0">
                      <div className="flex items-center gap-0.5">
                        {ALL_DOC_GROUPS.map((doc) => {
                          const count = item[doc] || 0;
                          if (count <= 0) return null;
                          const cfg = DOC_COLOR_MAP[doc];
                          const isDocSegSelected =
                            selectedReprovadoExecutor?.toLowerCase() === item.executor.toLowerCase() &&
                            selectedReprovadoDocGroup === doc;

                          return (
                            <button
                              key={doc}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectReprovadoFilter(
                                  isDocSegSelected ? null : item.executor,
                                  isDocSegSelected ? null : doc
                                );
                              }}
                              className={`px-1 py-0.2 rounded text-[9px] font-mono font-bold transition-all cursor-pointer ${
                                isDocSegSelected
                                  ? `${cfg.bg} text-white ring-1 ring-slate-900 shadow-2xs`
                                  : `${cfg.lightBg} ${cfg.text} hover:opacity-80`
                              }`}
                              title={`${doc}: ${count} reprovações (clique para filtrar)`}
                            >
                              {doc}:{count}
                            </button>
                          );
                        })}
                      </div>

                      {/* Total Badge */}
                      <button
                        type="button"
                        onClick={() =>
                          onSelectReprovadoFilter(
                            isSelected ? null : item.executor,
                            null
                          )
                        }
                        className={`px-1.5 py-0.2 rounded text-[10.5px] font-mono font-black transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-rose-600 text-white shadow-2xs'
                            : 'bg-rose-100/90 text-rose-900 hover:bg-rose-200'
                        }`}
                        title={`Filtrar todas as ${item.total} reprovações de ${item.executor}`}
                      >
                        {item.total}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Compact Legend & Filter by Doc Type */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100 text-xs">
            <span className="text-slate-400 font-bold text-[9.5px] uppercase tracking-wider">
              Filtrar por Documento:
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {ALL_DOC_GROUPS.map((doc) => {
                const cfg = DOC_COLOR_MAP[doc];
                const count = docTotals[doc] || 0;
                const isSelected =
                  selectedReprovadoDocGroup === doc && selectedReprovadoExecutor === null;

                return (
                  <button
                    key={doc}
                    type="button"
                    onClick={() =>
                      onSelectReprovadoFilter(
                        null,
                        isSelected ? null : doc
                      )
                    }
                    className={`flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 text-white font-bold shadow-2xs'
                        : `${cfg.lightBg} ${cfg.text} hover:opacity-85 font-semibold`
                    }`}
                    title={`Filtrar apenas reprovações de ${doc} (${count})`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.bg}`} />
                    <span>{doc}</span>
                    <span className="font-mono text-[9px] opacity-75">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          2. TABELA COMPLETA (SELECIONADA NO BOTÃO TABELA)
         ===================================================================== */}
      {viewMode === 'table' && (
        <div className="overflow-x-auto border border-slate-200/90 rounded-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/90 text-slate-700 border-b border-slate-200 font-bold">
                <th className="px-2 py-1.5">Executor</th>
                {ALL_DOC_GROUPS.map((doc) => {
                  const cfg = DOC_COLOR_MAP[doc];
                  return (
                    <th key={doc} className="px-2 py-1.5 text-center">
                      <span className="inline-flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.bg}`} />
                        {doc}
                      </span>
                    </th>
                  );
                })}
                <th className="px-2 py-1.5 text-center bg-rose-50 text-rose-900">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {executorStats.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-3 text-center text-slate-400 italic">
                    Nenhum registro de reprovação encontrado.
                  </td>
                </tr>
              ) : (
                executorStats.map((item) => {
                  const isRowSelected =
                    selectedReprovadoExecutor?.toLowerCase() === item.executor.toLowerCase() &&
                    selectedReprovadoDocGroup === null;

                  return (
                    <tr
                      key={item.executor}
                      className={`hover:bg-slate-50 transition-colors ${
                        isRowSelected ? 'bg-rose-50/60 font-bold' : ''
                      }`}
                    >
                      <td className="px-2 py-1 text-slate-800 font-semibold whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            onSelectReprovadoFilter(
                              isRowSelected ? null : item.executor,
                              null
                            )
                          }
                          className="hover:text-rose-600 flex items-center gap-1 cursor-pointer text-left"
                          title={`Filtrar reprovações de ${item.executor}`}
                        >
                          <User className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[160px]">{item.executor}</span>
                        </button>
                      </td>

                      {ALL_DOC_GROUPS.map((doc) => {
                        const count = item[doc] || 0;
                        const isCellSelected =
                          selectedReprovadoExecutor?.toLowerCase() === item.executor.toLowerCase() &&
                          selectedReprovadoDocGroup === doc;

                        return (
                          <td key={doc} className="px-2 py-1 text-center">
                            {count > 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectReprovadoFilter(
                                    isCellSelected ? null : item.executor,
                                    isCellSelected ? null : doc
                                  )
                                }
                                className={`px-1 py-0.2 rounded font-mono text-[9.5px] font-bold transition-all cursor-pointer ${
                                  isCellSelected
                                    ? 'bg-rose-600 text-white shadow-2xs ring-1 ring-rose-400'
                                    : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                                }`}
                                title={`Filtrar ${count} reprovações de ${doc} para ${item.executor}`}
                              >
                                {count}
                              </button>
                            ) : (
                              <span className="text-slate-300 font-mono text-[9.5px]">0</span>
                            )}
                          </td>
                        );
                      })}

                      <td className="px-2 py-1 text-center bg-rose-50/40">
                        <button
                          type="button"
                          onClick={() =>
                            onSelectReprovadoFilter(
                              isRowSelected ? null : item.executor,
                              null
                            )
                          }
                          className="font-mono font-black text-rose-700 hover:underline cursor-pointer text-[10.5px]"
                        >
                          {item.total}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {executorStats.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 font-black text-slate-900 border-t border-slate-200">
                  <td className="px-2 py-1.5">Total</td>
                  {ALL_DOC_GROUPS.map((doc) => (
                    <td key={doc} className="px-2 py-1.5 text-center font-mono text-[10.5px]">
                      <button
                        type="button"
                        onClick={() =>
                          onSelectReprovadoFilter(
                            null,
                            selectedReprovadoDocGroup === doc ? null : doc
                          )
                        }
                        className="hover:text-rose-600 cursor-pointer font-black"
                      >
                        {docTotals[doc]}
                      </button>
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-center font-mono text-rose-700 bg-rose-100/80 text-[10.5px]">
                    {grandTotal}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Modal: Registrar Reprovação */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-black text-slate-900 text-sm">
                    Registrar Nova Reprovação
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Gera registro de auditoria e vincula ao executor.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Intervenção / Site Claro:
                </label>
                <input
                  type="text"
                  required
                  value={modalIntervencao}
                  onChange={(e) => setModalIntervencao(e.target.value)}
                  placeholder="Ex: SP_CLI_0123 ou Site ID"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Tipo de Documento:
                  </label>
                  <select
                    value={modalTipoDoc}
                    onChange={(e) => setModalTipoDoc(e.target.value as EricssonDocGroup)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-rose-500"
                  >
                    {ALL_DOC_GROUPS.map((doc) => (
                      <option key={doc} value={doc}>
                        {doc}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Regional:</label>
                  <select
                    value={modalRegional}
                    onChange={(e) => setModalRegional(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-rose-500"
                  >
                    {distinctRegionais.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    {distinctRegionais.length === 0 && <option value="SPM">SPM</option>}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Executor / Reprovador Responsável:
                </label>
                <input
                  type="text"
                  required
                  list="executors-list"
                  value={modalExecutor}
                  onChange={(e) => setModalExecutor(e.target.value)}
                  placeholder="Nome do executor"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-rose-500"
                />
                <datalist id="executors-list">
                  {distinctExecutors.map((ex) => (
                    <option key={ex} value={ex} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Data da Reprovação:
                </label>
                <input
                  type="date"
                  required
                  value={modalData}
                  onChange={(e) => setModalData(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Motivo da Reprovação:
                </label>
                <textarea
                  required
                  rows={3}
                  value={modalMotivo}
                  onChange={(e) => setModalMotivo(e.target.value)}
                  placeholder="Descreva o motivo detalhado da reprovação..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-rose-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSaving ? 'Salvando...' : 'Salvar Reprovação'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
