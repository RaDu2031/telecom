import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Layers,
  Building,
  MapPin,
  Tag,
  X,
} from 'lucide-react';
import {
  AmetaUser,
  UserRole,
  EricssonRow,
  EricssonSheetMeta,
  EricssonEngineeringRow,
  EricssonDocGroup,
  ERICSSON_REAL_STATUSES_BY_DOC,
} from '../types/telecom';
import { doesEricssonRowMatchResponsible } from '../utils/spreadsheetUtils';
import { isEricssonRowAssignedToResponsible } from '../services/demandaSharedService';
import {
  rowMatchesEricssonDocGroup,
  normalizeEricssonRealStatus,
} from '../utils/ericssonSpreadsheetUtils';
import { EricssonEngineeringDrawer } from './EricssonEngineeringDrawer';

export interface EricssonVistoriaTabProps {
  user: AmetaUser;
  effectiveRole: UserRole;
  rows?: EricssonRow[];
  sheetMeta?: EricssonSheetMeta | null;
  engineeringRows?: EricssonEngineeringRow[];
  onOpenSitesTab?: () => void;
  onOpenEngenhariaTab?: () => void;
}

export const EricssonVistoriaTab: React.FC<EricssonVistoriaTabProps> = ({
  user,
  effectiveRole,
  engineeringRows = [],
  onOpenSitesTab,
}) => {
  const isExecutor = effectiveRole === 'Executor';

  // Executor Assigned Engineering Rows for Ericsson
  const executorAssignedEngRows = useMemo(() => {
    if (!isExecutor) return [];
    return (engineeringRows || []).filter((r) =>
      isEricssonRowAssignedToResponsible(r, user)
    );
  }, [isExecutor, engineeringRows, user]);

  // Executor Mirrored Table Filter States
  const [executorDocTypeFilter, setExecutorDocTypeFilter] = useState<string>('ALL');
  const [executorStatusFilter, setExecutorStatusFilter] = useState<string>('ALL');
  const [executorRegionalFilter, setExecutorRegionalFilter] = useState<string>('ALL');
  const [executorTipoSiteFilter, setExecutorTipoSiteFilter] = useState<string>('ALL');
  const [executorIntervencaoSearch, setExecutorIntervencaoSearch] = useState<string>('');
  const [selectedDrawerRow, setSelectedDrawerRow] = useState<EricssonEngineeringRow | null>(null);

  // Real Statuses for selected Doc Type
  const realStatusesForDoc = useMemo(() => {
    if (
      executorDocTypeFilter !== 'ALL' &&
      ERICSSON_REAL_STATUSES_BY_DOC[executorDocTypeFilter as EricssonDocGroup]
    ) {
      return ERICSSON_REAL_STATUSES_BY_DOC[executorDocTypeFilter as EricssonDocGroup];
    }
    const set = new Set<string>();
    Object.values(ERICSSON_REAL_STATUSES_BY_DOC).forEach((arr) => {
      arr.forEach((st) => set.add(st));
    });
    return Array.from(set).sort();
  }, [executorDocTypeFilter]);

  const distinctRegionals = useMemo(() => {
    const set = new Set<string>();
    executorAssignedEngRows.forEach((r) => {
      const reg = r.regional || r.fields?.['Regional'] || '';
      if (reg) set.add(reg);
    });
    return Array.from(set).sort();
  }, [executorAssignedEngRows]);

  const distinctTipoSites = useMemo(() => {
    const set = new Set<string>();
    executorAssignedEngRows.forEach((r) => {
      const ts = r.tipoSite || r.fields?.['TIPO SITE'] || r.fields?.['Tipo site'] || '';
      if (ts) set.add(ts);
    });
    return Array.from(set).sort();
  }, [executorAssignedEngRows]);

  const filteredExecutorEngRows = useMemo(() => {
    const q = executorIntervencaoSearch.trim().toLowerCase();
    return executorAssignedEngRows.filter((r) => {
      if (executorDocTypeFilter !== 'ALL') {
        const rawDoc = String(r.tipoDoc || r.fields?.['Tipo doc'] || '');
        if (!rowMatchesEricssonDocGroup(rawDoc, executorDocTypeFilter as EricssonDocGroup)) {
          return false;
        }
      }

      const rawStatus = r.status || r.fields?.['Status'] || '';
      const realStatus = normalizeEricssonRealStatus(
        rawStatus,
        executorDocTypeFilter !== 'ALL' ? (executorDocTypeFilter as EricssonDocGroup) : undefined
      );
      const isFinalized =
        realStatus.toLowerCase() === 'finalizado' || rawStatus.toLowerCase().includes('finaliz');

      if (executorStatusFilter === 'ALL') {
        // By default, hide demands that the executor has ALREADY finalized
        if (isFinalized) return false;
      } else if (executorStatusFilter !== 'TODOS_INCLUINDO_FINALIZADOS') {
        if (realStatus.toLowerCase() !== executorStatusFilter.toLowerCase()) {
          return false;
        }
      }

      if (executorRegionalFilter !== 'ALL') {
        const reg = r.regional || r.fields?.['Regional'] || '';
        if (reg !== executorRegionalFilter) return false;
      }

      if (executorTipoSiteFilter !== 'ALL') {
        const ts = r.tipoSite || r.fields?.['TIPO SITE'] || r.fields?.['Tipo site'] || '';
        if (ts !== executorTipoSiteFilter) return false;
      }

      if (q) {
        const interv = (
          r.intervencaoClaro ||
          r.siteIdA ||
          r.fields?.['Intervencao Claro'] ||
          ''
        ).toLowerCase();
        const siteA = (r.siteIdA || '').toLowerCase();
        const siteB = (r.siteIdB || '').toLowerCase();
        if (!interv.includes(q) && !siteA.includes(q) && !siteB.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [
    executorAssignedEngRows,
    executorDocTypeFilter,
    executorStatusFilter,
    executorRegionalFilter,
    executorTipoSiteFilter,
    executorIntervencaoSearch,
  ]);

  const stats = useMemo(() => {
    let finalizados = 0;
    let pendentes = 0;
    executorAssignedEngRows.forEach((r) => {
      const rawStatus = r.status || r.fields?.['Status'] || '';
      const realStatus = normalizeEricssonRealStatus(rawStatus, (r.tipoDoc || undefined) as EricssonDocGroup);
      if (realStatus.toLowerCase() === 'finalizado' || rawStatus.toLowerCase().includes('finaliz')) {
        finalizados++;
      } else {
        pendentes++;
      }
    });
    return {
      total: executorAssignedEngRows.length,
      pendentes,
      finalizados,
    };
  }, [executorAssignedEngRows]);

  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
      {/* =====================================================================
          1. HEADER BAR: Title, Subtitle & Counters
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-teal-50 border border-teal-200/80 flex items-center justify-center text-teal-700 shadow-2xs shrink-0">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
                  ERICSSON · CLARO
                </span>
                <span className="text-slate-300">•</span>
                <h1 className="text-base font-black text-slate-900">
                  Demandas Engenharia Ericsson Claro
                </h1>
              </div>
              <p className="text-xs text-slate-500">
                Acompanhamento e controle de intervenções e demandas atribuídas para execução.
              </p>
            </div>
          </div>

          {/* Quick Counter Pills */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold flex items-center gap-2">
              <span className="text-slate-500">Total Atribuído:</span>
              <span className="font-mono font-bold text-slate-900 px-1.5 py-0.5 rounded bg-slate-200/70">
                {stats.total}
              </span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold flex items-center gap-2 text-amber-900">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <span>Pendentes:</span>
              <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-amber-200/70">
                {stats.pendentes}
              </span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold flex items-center gap-2 text-emerald-900">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Finalizados:</span>
              <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-200/70">
                {stats.finalizados}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          2. BODY: Empty State or Mirrored Table
         ===================================================================== */}
      {executorAssignedEngRows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-4 shadow-2xs">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
            <FileSpreadsheet className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-base font-black text-slate-900">
              Nenhuma demanda de Engenharia atribuída a você no momento
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Quando a coordenação demandar intervenções ou sites para a sua equipe no controle de Engenharia Ericsson, elas aparecerão automaticamente nesta lista em tempo real.
            </p>
            {onOpenSitesTab && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onOpenSitesTab}
                  className="px-4 py-2 bg-teal-700 text-white rounded-xl font-bold text-xs shadow-xs hover:bg-teal-800 transition-colors cursor-pointer"
                >
                  Ver Meus Sites Demandados
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* =====================================================================
            DEMANDAS TABLE & FILTERS VIEW
           ===================================================================== */
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4 w-full min-w-0 max-w-full overflow-hidden">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
              {/* Tipo de Doc Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">Tipo de Doc:</span>
                <select
                  value={executorDocTypeFilter}
                  onChange={(e) => {
                    setExecutorDocTypeFilter(e.target.value);
                    setExecutorStatusFilter('ALL');
                  }}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-600 cursor-pointer"
                >
                  <option value="ALL">Todos os Tipos</option>
                  <option value="WR">WR</option>
                  <option value="QRF">QRF</option>
                  <option value="PPI">PPI</option>
                  <option value="SDC">SDC</option>
                  <option value="SMART">SMART</option>
                  <option value="BOQ">BOQ</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">Status:</span>
                <select
                  value={executorStatusFilter}
                  onChange={(e) => setExecutorStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-600 cursor-pointer max-w-[240px]"
                >
                  <option value="ALL">Pendentes / Em Aberto (Oculta Finalizados)</option>
                  <option value="TODOS_INCLUINDO_FINALIZADOS">Todos os Status (Inclui Finalizados)</option>
                  {realStatusesForDoc.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* Regional Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">Regional:</span>
                <select
                  value={executorRegionalFilter}
                  onChange={(e) => setExecutorRegionalFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-600 cursor-pointer"
                >
                  <option value="ALL">Todas ({distinctRegionals.length})</option>
                  {distinctRegionals.map((reg) => (
                    <option key={reg} value={reg}>
                      {reg}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tipo Site Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">Tipo Site:</span>
                <select
                  value={executorTipoSiteFilter}
                  onChange={(e) => setExecutorTipoSiteFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-600 cursor-pointer"
                >
                  <option value="ALL">Todos ({distinctTipoSites.length})</option>
                  {distinctTipoSites.map((ts) => (
                    <option key={ts} value={ts}>
                      {ts}
                    </option>
                  ))}
                </select>
              </div>

              {(executorDocTypeFilter !== 'ALL' ||
                executorStatusFilter !== 'ALL' ||
                executorRegionalFilter !== 'ALL' ||
                executorTipoSiteFilter !== 'ALL' ||
                executorIntervencaoSearch) && (
                <button
                  type="button"
                  onClick={() => {
                    setExecutorDocTypeFilter('ALL');
                    setExecutorStatusFilter('ALL');
                    setExecutorRegionalFilter('ALL');
                    setExecutorTipoSiteFilter('ALL');
                    setExecutorIntervencaoSearch('');
                  }}
                  className="px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                >
                  Limpar Filtros
                </button>
              )}
            </div>

            {/* Busca por Intervenção */}
            <div className="relative min-w-[200px] flex-1 sm:flex-initial">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={executorIntervencaoSearch}
                onChange={(e) => setExecutorIntervencaoSearch(e.target.value)}
                placeholder="Buscar por Intervenção..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-teal-600"
              />
              {executorIntervencaoSearch && (
                <button
                  type="button"
                  onClick={() => setExecutorIntervencaoSearch('')}
                  className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Table (9 COLUMNS IN EXACT ORDER) */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs w-full min-w-0 max-w-full">
            <div className="overflow-x-auto w-full min-w-0 max-w-full max-h-[70vh] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-slate-900 text-white font-bold text-[11px] uppercase tracking-wider divide-x divide-slate-800">
                    <th className="py-3 px-3">Intervenção</th>
                    <th className="py-3 px-3">Tipo de site</th>
                    <th className="py-3 px-3">Regional</th>
                    <th className="py-3 px-3">Tipo de doc</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Comentário</th>
                    <th className="py-3 px-3">Planejado</th>
                    <th className="py-3 px-3">Entregue</th>
                    <th className="py-3 px-3">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredExecutorEngRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400 font-semibold">
                        Nenhuma demanda de Engenharia encontrada para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredExecutorEngRows.map((r) => {
                      const interv =
                        r.intervencaoClaro ||
                        r.siteIdA ||
                        r.fields?.['Intervencao Claro'] ||
                        '—';
                      const tipoSite =
                        r.tipoSite ||
                        r.fields?.['TIPO SITE'] ||
                        r.fields?.['Tipo site'] ||
                        '—';
                      const regional = r.regional || r.fields?.['Regional'] || '—';
                      const tipoDoc = r.tipoDoc || r.fields?.['Tipo doc'] || '—';
                      const rawStatus = r.status || r.fields?.['Status'] || '—';
                      const statusReal = normalizeEricssonRealStatus(
                        rawStatus,
                        (r.tipoDoc || undefined) as EricssonDocGroup
                      );
                      const comentario =
                        r.fields?.['Comentário'] ||
                        r.fields?.['COMENTÁRIO'] ||
                        r.fields?.['Comentario'] ||
                        r.fields?.['Comentários'] ||
                        '—';
                      const planejado =
                        r.fields?.['Planejado'] ||
                        r.fields?.['PLANEJADO'] ||
                        r.fields?.['Data Planejada'] ||
                        r.fields?.['Planejada'] ||
                        '—';
                      const entregue =
                        r.fields?.['Entregue'] ||
                        r.fields?.['ENTREGUE'] ||
                        r.fields?.['Data Entregue'] ||
                        r.fields?.['Data de Envio'] ||
                        '—';
                      const observacao =
                        r.fields?.['Observação'] ||
                        r.fields?.['OBSERVAÇÃO'] ||
                        r.fields?.['Observacao'] ||
                        r.fields?.['Observações'] ||
                        '—';

                      const isDone =
                        statusReal.toLowerCase() === 'finalizado' ||
                        rawStatus.toLowerCase().includes('finaliz');

                      return (
                        <tr
                          key={r.id}
                          onClick={() => setSelectedDrawerRow(r)}
                          className="hover:bg-teal-50/50 cursor-pointer transition-colors divide-x divide-slate-100"
                        >
                          <td className="py-2.5 px-3 font-bold text-slate-900 font-mono">
                            {interv}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">{tipoSite}</td>
                          <td className="py-2.5 px-3 text-slate-700 font-semibold">{regional}</td>
                          <td className="py-2.5 px-3 font-bold text-teal-700">{tipoDoc}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                                isDone
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}
                            >
                              {statusReal}
                            </span>
                          </td>
                          <td
                            className="py-2.5 px-3 text-slate-600 max-w-[180px] truncate"
                            title={comentario}
                          >
                            {comentario}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 font-mono">{planejado}</td>
                          <td className="py-2.5 px-3 text-slate-600 font-mono">{entregue}</td>
                          <td
                            className="py-2.5 px-3 text-slate-600 max-w-[180px] truncate"
                            title={observacao}
                          >
                            {observacao}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Drawer for Mirrored Row Details */}
      {selectedDrawerRow && (
        <EricssonEngineeringDrawer
          row={selectedDrawerRow}
          isOpen={Boolean(selectedDrawerRow)}
          user={user}
          effectiveRole={effectiveRole}
          onClose={() => setSelectedDrawerRow(null)}
          onSaveRow={async (updated) => {
            setSelectedDrawerRow(updated);
          }}
          showToast={() => {}}
        />
      )}
    </div>
  );
};
