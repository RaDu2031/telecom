import React, { useMemo, useState, useEffect } from 'react';
import {
  CheckCircle2,
  Clock,
  Receipt,
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
  ExternalLink,
  AlertTriangle,
  FileWarning,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  TelecomSite,
  VendorType,
  AmetaUser,
  MandatoryDocType,
  UserMandatoryDocument,
  evaluateUserOverallDocumentStatus,
} from '../types/telecom';
import {
  getCellValueForColumn,
  getCanonicalDuplaName,
  getCanonicalExecutorName,
  doesSiteMatchEquipe,
  doesSiteMatchExecutor,
  getEquipeSite,
  temEquipeDemandadaSite,
} from '../utils/spreadsheetUtils';

export type ChartCategoryFilter = 'ALL' | 'PARA_FAZER' | 'FEITOS' | 'NOTAS_PENDENTES';

interface InteractiveSpreadsheetChartProps {
  sites: TelecomSite[];
  users?: AmetaUser[];
  activeVendor: VendorType;
  activeChartFilter: ChartCategoryFilter;
  onSelectChartFilter: (filter: ChartCategoryFilter) => void;
  activeEquipeFilter: string;
  onSelectEquipeFilter: (dupla: string) => void;
  activeExecutorFilter?: string;
  onSelectExecutorFilter?: (executor: string) => void;
  activeUfFilter: string;
  onSelectUfFilter: (uf: string) => void;
  onOpenSite?: (siteId: string) => void;
  onOpenCollaboratorDocs?: (userId: string) => void;
  onRemoveExpiredDoc?: (
    userId: string,
    docType: MandatoryDocType,
    docLabel: string,
    userName: string
  ) => void;
}

function formatDateBrShort(isoDate?: string): string {
  if (!isoDate || !isoDate.trim()) return 'Sem data';
  const parts = isoDate.trim().split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function isSiteFeito(site: TelecomSite): boolean {
  const st = (getCellValueForColumn(site, 'STATUS') || site.status || '').toLowerCase();
  const siExec = (getCellValueForColumn(site, 'SI Executed') || '').trim().toLowerCase();
  return (
    st.includes('finaliz') ||
    st.includes('conclu') ||
    st.includes('executad') ||
    st.includes('vistoriad') ||
    (siExec !== '' &&
      siExec !== '—' &&
      siExec !== 'nao' &&
      siExec !== 'não' &&
      siExec !== 'pendente')
  );
}

export function isSiteCancelado(site: TelecomSite): boolean {
  const st = (getCellValueForColumn(site, 'STATUS') || site.status || '').toLowerCase();
  const pr = (getCellValueForColumn(site, 'Prioridade') || site.versaoSw || '').toLowerCase();
  return (
    site.sheetName === 'Controle Cancelados' ||
    st.includes('cancel') ||
    pr.includes('cancel')
  );
}

export function isSiteParaFazer(site: TelecomSite): boolean {
  if (isSiteCancelado(site)) return false;
  return !isSiteFeito(site);
}

/**
 * Execution priority bucket so "Sites a Fazer" ALWAYS appear first (0),
 * followed by "Sites Feitos" (1), and "Cancelados" last (2).
 */
export function getSiteExecutionSortBucket(site: TelecomSite): number {
  if (isSiteParaFazer(site)) return 0; // 1º: Sites A Fazer
  if (isSiteFeito(site)) return 1; // 2º: Sites Feitos
  return 2; // 3º: Cancelados
}

export function sortSitesParaFazerFirst(sitesList: TelecomSite[]): TelecomSite[] {
  return [...sitesList].sort((a, b) => {
    const bucketA = getSiteExecutionSortBucket(a);
    const bucketB = getSiteExecutionSortBucket(b);
    if (bucketA !== bucketB) return bucketA - bucketB;
    return 0;
  });
}

export function isSiteNotaPendente(site: TelecomSite): boolean {
  if (isSiteCancelado(site)) return false;
  const fin = (
    getCellValueForColumn(site, 'Status Financeiro') ||
    site.alarmesAtivos ||
    ''
  )
    .trim()
    .toLowerCase();
  const spo = (getCellValueForColumn(site, 'SPO') || site.ipGerencia || '')
    .trim()
    .toLowerCase();
  const nf = (
    getCellValueForColumn(site, 'N° da NF') ||
    getCellValueForColumn(site, 'N° NF') ||
    ''
  )
    .trim()
    .toLowerCase();
  const obs = (
    getCellValueForColumn(site, 'Observações/Motivo') ||
    getCellValueForColumn(site, 'OBS') ||
    site.observacoes ||
    ''
  )
    .trim()
    .toLowerCase();

  const hasNfNumber =
    nf !== '' && nf !== '—' && nf !== '-' && nf !== 's/n' && nf !== 'pendente';

  // Explicitly emitted / ready / paid -> not pending
  if (
    fin.includes('nf emitida') ||
    fin.includes('nf pronta') ||
    fin.includes('pago') ||
    fin.includes('faturado') ||
    fin.includes('concluído') ||
    fin.includes('concluido')
  ) {
    return false;
  }

  // Explicitly marked pending to emit NF, awaiting SPO/SGR/PO
  if (
    fin.includes('emitir nf') ||
    fin.includes('aguardando') ||
    fin.includes('pendente') ||
    fin.includes('valida') ||
    fin.includes('sem ') ||
    spo.includes('pendente') ||
    spo.includes('aguardando') ||
    obs.includes('nota pendente') ||
    obs.includes('aguardando nf') ||
    obs.includes('aguardando po') ||
    obs.includes('aguardando spo')
  ) {
    return true;
  }

  // If site is already done (Feito) but has no NF number yet, it has a pending note
  if (isSiteFeito(site) && !hasNfNumber) {
    return true;
  }

  return false;
}

export interface CollaboratorExpiredDocSummary {
  user: AmetaUser;
  canonicalEquipe: string;
  vencidos: Array<
    UserMandatoryDocument & {
      eval: {
        status: string;
        daysRemaining: number | null;
        statusLabel: string;
      };
    }
  >;
  aVencer: Array<
    UserMandatoryDocument & {
      eval: {
        status: string;
        daysRemaining: number | null;
        statusLabel: string;
      };
    }
  >;
  validadosCount: number;
  totalDocsCount: number;
  overallStatus: 'VALIDADO' | 'A VENCER' | 'VENCIDO' | 'DISPENSADO';
}

export const InteractiveSpreadsheetChart: React.FC<InteractiveSpreadsheetChartProps> = React.memo(({
  sites,
  users = [],
  activeVendor,
  activeChartFilter,
  onSelectChartFilter,
  activeEquipeFilter,
  onSelectEquipeFilter,
  activeExecutorFilter = 'ALL',
  onSelectExecutorFilter,
  activeUfFilter,
  onSelectUfFilter,
  onOpenSite,
  onOpenCollaboratorDocs,
  onRemoveExpiredDoc,
}) => {
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isBarsMinimized, setIsBarsMinimized] = useState<boolean>(false);
  const [breakdownMode, setBreakdownMode] = useState<
    'DUPLAS' | 'EXECUTOR' | 'UF' | 'DOC_VENCIDO'
  >('DUPLAS');

  // Evaluate collaborators with expired ("VENCIDO") or expiring ("A VENCER") documents
  const collaboratorDocStats = useMemo(() => {
    const expiredCollaborators: CollaboratorExpiredDocSummary[] = [];
    const expiringCollaborators: CollaboratorExpiredDocSummary[] = [];
    let totalExpiredDocsCount = 0;
    let totalExpiringDocsCount = 0;

    users.forEach((u) => {
      const summary = evaluateUserOverallDocumentStatus(u);
      if (summary.isUserDispensado) return;

      const canonEq = u.equipe ? getCanonicalDuplaName(u.equipe) || u.equipe.trim() : 'Sem Equipe';
      const item: CollaboratorExpiredDocSummary = {
        user: u,
        canonicalEquipe: canonEq,
        vencidos: summary.vencidos,
        aVencer: summary.aVencer,
        validadosCount: summary.validados.length + summary.dispensados.length,
        totalDocsCount: summary.evaluated.length || 8,
        overallStatus: summary.overallStatus,
      };

      if (summary.vencidos.length > 0) {
        expiredCollaborators.push(item);
        totalExpiredDocsCount += summary.vencidos.length;
      } else if (summary.aVencer.length > 0) {
        expiringCollaborators.push(item);
        totalExpiringDocsCount += summary.aVencer.length;
      }
    });

    return {
      expiredCollaborators,
      expiringCollaborators,
      allAlertCollaborators: [...expiredCollaborators, ...expiringCollaborators],
      totalExpiredDocsCount,
      totalExpiringDocsCount,
    };
  }, [users]);

  const stats = useMemo(() => {
    const activePool = sites.filter((s) => !isSiteCancelado(s));
    const total = activePool.length || 1;

    let paraFazerCount = 0;
    let paraFazerSemAcesso = 0;
    let feitosCount = 0;
    let notasPendentesCount = 0;
    let notasEmitidasCount = 0;

    const byDupla = new Map<
      string,
      {
        dupla: string;
        rawVariants: Set<string>;
        paraFazer: number;
        feitos: number;
        notasPendentes: number;
        total: number;
      }
    >();

    const byExecutor = new Map<
      string,
      {
        executor: string;
        rawVariants: Set<string>;
        duplasSet: Set<string>;
        paraFazer: number;
        feitos: number;
        notasPendentes: number;
        total: number;
      }
    >();

    const byUf = new Map<
      string,
      {
        uf: string;
        paraFazer: number;
        feitos: number;
        notasPendentes: number;
        total: number;
      }
    >();

    activePool.forEach((s) => {
      const feito = isSiteFeito(s);
      const paraFazer = !feito;
      const notaPend = isSiteNotaPendente(s);

      const st = (getCellValueForColumn(s, 'STATUS') || s.status || '').toLowerCase();
      const ac = (
        getCellValueForColumn(s, 'Acesso') ||
        getCellValueForColumn(s, 'Comentários do Acesso') ||
        s.transporteTx ||
        ''
      ).toLowerCase();

      if (feito) {
        feitosCount++;
      } else {
        paraFazerCount++;
        if (
          st.includes('sem acesso') ||
          st.includes('sem chave') ||
          st.includes('paralisad') ||
          ac.includes('sem chave') ||
          ac.includes('sem acesso') ||
          ac.includes('negado')
        ) {
          paraFazerSemAcesso++;
        }
      }

      if (notaPend) {
        notasPendentesCount++;
      } else if (feito) {
        notasEmitidasCount++;
      }

      // 1. Canonical Dupla / Equipe Executante
      const hasDupla = temEquipeDemandadaSite(s);
      const rawDupla = getEquipeSite(s);
      const canonDupla = hasDupla ? (getCanonicalDuplaName(rawDupla) || rawDupla) : 'Sem Dupla';
      const curD = byDupla.get(canonDupla) || {
        dupla: canonDupla,
        rawVariants: new Set<string>(),
        paraFazer: 0,
        feitos: 0,
        notasPendentes: 0,
        total: 0,
      };
      if (rawDupla) curD.rawVariants.add(rawDupla);
      curD.total++;
      if (feito) curD.feitos++;
      if (paraFazer) curD.paraFazer++;
      if (notaPend) curD.notasPendentes++;
      byDupla.set(canonDupla, curD);

      // 2. Canonical Executor
      const rawExec = (
        getCellValueForColumn(s, 'Executor') ||
        s.responsavelCampo ||
        ''
      ).trim();
      const canonExec = getCanonicalExecutorName(rawExec);
      const curE = byExecutor.get(canonExec) || {
        executor: canonExec,
        rawVariants: new Set<string>(),
        duplasSet: new Set<string>(),
        paraFazer: 0,
        feitos: 0,
        notasPendentes: 0,
        total: 0,
      };
      if (rawExec) curE.rawVariants.add(rawExec);
      if (canonDupla !== 'Sem Dupla') curE.duplasSet.add(canonDupla);
      curE.total++;
      if (feito) curE.feitos++;
      if (paraFazer) curE.paraFazer++;
      if (notaPend) curE.notasPendentes++;
      byExecutor.set(canonExec, curE);

      // 3. UF
      const rawUf = (getCellValueForColumn(s, 'UF') || s.uf || 'N/I')
        .trim()
        .toUpperCase();
      const ufKey = rawUf && rawUf !== '—' ? rawUf : 'N/I';
      const curU = byUf.get(ufKey) || {
        uf: ufKey,
        paraFazer: 0,
        feitos: 0,
        notasPendentes: 0,
        total: 0,
      };
      curU.total++;
      if (feito) curU.feitos++;
      if (paraFazer) curU.paraFazer++;
      if (notaPend) curU.notasPendentes++;
      byUf.set(ufKey, curU);
    });

    const allDuplasRaw = Array.from(byDupla.values());
    const allExecutorsRaw = Array.from(byExecutor.values());
    const allUfsRaw = Array.from(byUf.values());

    const allDuplas = allDuplasRaw
      .filter((item) => item.paraFazer > 0)
      .sort((a, b) => b.paraFazer - a.paraFazer || b.total - a.total);
    const allExecutors = allExecutorsRaw
      .filter((item) => item.paraFazer > 0)
      .sort((a, b) => b.paraFazer - a.paraFazer || b.total - a.total);
    const allUfs = allUfsRaw
      .filter((item) => item.paraFazer > 0)
      .sort((a, b) => b.paraFazer - a.paraFazer || b.total - a.total);

    return {
      total: activePool.length,
      paraFazerCount,
      paraFazerEmCampo: Math.max(0, paraFazerCount - paraFazerSemAcesso),
      paraFazerSemAcesso,
      feitosCount,
      notasPendentesCount,
      notasEmitidasCount,
      paraFazerPct: Math.round((paraFazerCount / total) * 100),
      feitosPct: Math.round((feitosCount / total) * 100),
      notasPendentesPct: Math.round((notasPendentesCount / total) * 100),
      allDuplas,
      allExecutors,
      allUfs,
      completedDuplasCount: allDuplasRaw.length - allDuplas.length,
      completedExecutorsCount: allExecutorsRaw.length - allExecutors.length,
      completedUfsCount: allUfsRaw.length - allUfs.length,
    };
  }, [sites]);

  // Helper to find expired collaborators linked to a given Dupla name
  const getExpiredCollaboratorsForDupla = (
    duplaName: string
  ): CollaboratorExpiredDocSummary[] => {
    const dNorm = duplaName.trim().toLowerCase();
    return collaboratorDocStats.expiredCollaborators.filter((item) => {
      const eqNorm = item.canonicalEquipe.trim().toLowerCase();
      const rawEqNorm = (item.user.equipe || '').trim().toLowerCase();
      const nameNorm = item.user.name.trim().toLowerCase();
      if (eqNorm === dNorm || rawEqNorm === dNorm || nameNorm === dNorm) return true;
      const tokens = dNorm
        .split(/[\s/,&-]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 4);
      return tokens.some(
        (tk) => eqNorm.includes(tk) || rawEqNorm.includes(tk) || nameNorm.includes(tk)
      );
    });
  };

  // Helper to find expired collaborators linked to an Executor
  const getExpiredCollaboratorsForExecutor = (
    executorName: string,
    duplasOfExec: string[]
  ): CollaboratorExpiredDocSummary[] => {
    const exNorm = executorName.trim().toLowerCase();
    return collaboratorDocStats.expiredCollaborators.filter((item) => {
      const nameNorm = item.user.name.trim().toLowerCase();
      if (nameNorm.includes(exNorm) || exNorm.includes(nameNorm)) return true;
      return duplasOfExec.some((d) =>
        getExpiredCollaboratorsForDupla(d).some((c) => c.user.id === item.user.id)
      );
    });
  };

  // Automatically clear the active chart filter if a Dupla, Executor, or UF finishes all its pending sites
  useEffect(() => {
    if (
      activeEquipeFilter !== 'ALL' &&
      !stats.allDuplas.some((d) => d.dupla === activeEquipeFilter)
    ) {
      onSelectEquipeFilter('ALL');
    }
    if (
      activeExecutorFilter !== 'ALL' &&
      onSelectExecutorFilter &&
      !stats.allExecutors.some((e) => e.executor === activeExecutorFilter)
    ) {
      onSelectExecutorFilter('ALL');
    }
    if (
      activeUfFilter !== 'ALL' &&
      !stats.allUfs.some((u) => u.uf === activeUfFilter)
    ) {
      onSelectUfFilter('ALL');
    }
  }, [
    stats.allDuplas,
    stats.allExecutors,
    stats.allUfs,
    activeEquipeFilter,
    activeExecutorFilter,
    activeUfFilter,
    onSelectEquipeFilter,
    onSelectExecutorFilter,
    onSelectUfFilter,
  ]);

  const hasAnyChartFilter =
    activeChartFilter !== 'ALL' ||
    activeEquipeFilter !== 'ALL' ||
    activeExecutorFilter !== 'ALL' ||
    activeUfFilter !== 'ALL';

  // Sites matching the currently clicked chart filter(s), strictly ordered: 1º Sites a Fazer -> 2º Sites Feitos
  const chartSelectedSitesBreakdown = useMemo(() => {
    if (!hasAnyChartFilter) {
      return { paraFazerSites: [] as TelecomSite[], feitosSites: [] as TelecomSite[], total: 0 };
    }

    const matching = sites.filter((site) => {
      if (isSiteCancelado(site)) return false;
      if (activeChartFilter === 'PARA_FAZER' && !isSiteParaFazer(site)) return false;
      if (activeChartFilter === 'FEITOS' && !isSiteFeito(site)) return false;
      if (activeChartFilter === 'NOTAS_PENDENTES' && !isSiteNotaPendente(site)) return false;
      if (activeEquipeFilter !== 'ALL' && !doesSiteMatchEquipe(site, activeEquipeFilter)) {
        return false;
      }
      if (
        activeExecutorFilter !== 'ALL' &&
        !doesSiteMatchExecutor(site, activeExecutorFilter)
      ) {
        return false;
      }
      if (activeUfFilter !== 'ALL') {
        const uf = (getCellValueForColumn(site, 'UF') || site.uf || '')
          .trim()
          .toUpperCase();
        if (uf !== activeUfFilter) return false;
      }
      return true;
    });

    const paraFazerSites: TelecomSite[] = [];
    const feitosSites: TelecomSite[] = [];

    matching.forEach((s) => {
      if (isSiteParaFazer(s)) {
        paraFazerSites.push(s);
      } else {
        feitosSites.push(s);
      }
    });

    return {
      paraFazerSites,
      feitosSites,
      total: paraFazerSites.length + feitosSites.length,
    };
  }, [
    sites,
    hasAnyChartFilter,
    activeChartFilter,
    activeEquipeFilter,
    activeExecutorFilter,
    activeUfFilter,
  ]);

  const clearAllChartFilters = () => {
    onSelectChartFilter('ALL');
    onSelectEquipeFilter('ALL');
    if (onSelectExecutorFilter) onSelectExecutorFilter('ALL');
    onSelectUfFilter('ALL');
  };

  return (
    <div className="space-y-3">
      {/* =====================================================================
          COMPACT MINIMIZED BAR OR FULL 2-COLUMN ANALYTICS SPLIT
         ===================================================================== */}
      {isMinimized ? (
        <div className="bg-white border border-slate-200 rounded-[12px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsMinimized(false)}
              className="flex items-center gap-2 text-left cursor-pointer group"
              title="Clique para expandir a aba de gráficos"
            >
              <div className="w-7 h-7 rounded-[8px] bg-[#223585]/10 group-hover:bg-[#223585]/15 transition-colors flex items-center justify-center shrink-0">
                <BarChart3 className="w-4 h-4 text-[#223585]" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-900">
                  Aba de Gráficos da Planilha ({activeVendor})
                </span>
                <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-full text-[11px] text-slate-600 font-mono font-semibold tabular-nums">
                  {stats.total} sites
                </span>
              </div>
            </button>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
              <button
                type="button"
                onClick={() =>
                  onSelectChartFilter(
                    activeChartFilter === 'PARA_FAZER' ? 'ALL' : 'PARA_FAZER'
                  )
                }
                className={`px-2 py-0.5 rounded-md border cursor-pointer transition-colors ${
                  activeChartFilter === 'PARA_FAZER'
                    ? 'bg-amber-600 text-white border-amber-600 font-bold'
                    : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                }`}
              >
                1º A Fazer: {stats.paraFazerCount}
              </button>
              <button
                type="button"
                onClick={() =>
                  onSelectChartFilter(activeChartFilter === 'FEITOS' ? 'ALL' : 'FEITOS')
                }
                className={`px-2 py-0.5 rounded-md border cursor-pointer transition-colors ${
                  activeChartFilter === 'FEITOS'
                    ? 'bg-emerald-600 text-white border-emerald-600 font-bold'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                2º Feitos: {stats.feitosCount}
              </button>
              <button
                type="button"
                onClick={() =>
                  onSelectChartFilter(
                    activeChartFilter === 'NOTAS_PENDENTES' ? 'ALL' : 'NOTAS_PENDENTES'
                  )
                }
                className={`px-2 py-0.5 rounded-md border cursor-pointer transition-colors ${
                  activeChartFilter === 'NOTAS_PENDENTES'
                    ? 'bg-[#223585] text-white border-[#223585] font-bold'
                    : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                }`}
              >
                Notas Pend.: {stats.notasPendentesCount}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="px-3 py-1.5 rounded-[8px] text-xs font-semibold flex items-center gap-1.5 bg-[#223585] hover:bg-[#1B2A6B] text-white transition-colors cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Abrir Gráficos</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Active filters / Expired docs alert strip */}
          {(hasAnyChartFilter || collaboratorDocStats.expiredCollaborators.length > 0) && (
            <div className="bg-white border border-slate-200 rounded-[12px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {collaboratorDocStats.expiredCollaborators.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsBarsMinimized(false);
                      setBreakdownMode('DOC_VENCIDO');
                    }}
                    className="px-2.5 py-1 rounded-[8px] bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                    title="Clique para ver no gráfico os colaboradores com documento vencido"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>
                      {collaboratorDocStats.expiredCollaborators.length} Colaborador(es) c/ Doc Vencido:{' '}
                      <strong className="text-rose-900">
                        {collaboratorDocStats.expiredCollaborators
                          .map(
                            (c) =>
                              `${c.user.name} (${
                                c.vencidos.map((d) => d.label).join(', ') || 'Doc Vencido'
                              })`
                          )
                          .join(' · ')}
                      </strong>
                    </span>
                  </button>
                )}

                {hasAnyChartFilter && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2.5 py-0.5 bg-[#223585]/10 text-[#223585] border border-[#223585]/20 rounded-[6px] text-[11px] font-semibold flex items-center gap-1">
                      <Filter className="w-3 h-3" />
                      <span>
                        Filtro ativo
                        {activeChartFilter === 'PARA_FAZER'
                          ? ': Para Fazer'
                          : activeChartFilter === 'FEITOS'
                          ? ': Feitos'
                          : activeChartFilter === 'NOTAS_PENDENTES'
                          ? ': Notas Pendentes'
                          : ''}
                        {activeEquipeFilter !== 'ALL' ? ` · Equipe: ${activeEquipeFilter}` : ''}
                        {activeExecutorFilter !== 'ALL'
                          ? ` · Executor: ${activeExecutorFilter}`
                          : ''}
                        {activeUfFilter !== 'ALL' ? ` · UF ${activeUfFilter}` : ''}
                      </span>
                    </span>
                    <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-[6px] text-[11px] font-mono font-semibold tabular-nums">
                      1º A Fazer: {chartSelectedSitesBreakdown.paraFazerSites.length} · 2º Feitos:{' '}
                      {chartSelectedSitesBreakdown.feitosSites.length}
                    </span>
                    <button
                      type="button"
                      onClick={clearAllChartFilters}
                      className="px-2.5 py-0.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-[6px] text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Limpar filtro do gráfico</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsBarsMinimized((prev) => !prev)}
                  className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-[8px] text-[11px] font-medium text-slate-600 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <span>{isBarsMinimized ? 'Mostrar Barras' : 'Ocultar Barras'}</span>
                  {isBarsMinimized ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsMinimized(true)}
                  className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-[8px] text-[11px] font-medium text-slate-600 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Minimize2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>Minimizar</span>
                </button>
              </div>
            </div>
          )}

          {/* 2-Column Clean Corporate Analytics Split */}
          <div className={`grid grid-cols-1 ${!isBarsMinimized ? 'xl:grid-cols-12' : ''} gap-3.5`}>
            {/* LEFT PANEL: Aba de Gráficos da Planilha (4 Progress Metric Rows) */}
            <div className={`${!isBarsMinimized ? 'xl:col-span-5' : ''} bg-white border border-slate-200 rounded-[12px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4 sm:p-5 flex flex-col justify-between gap-4`}>
              <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsMinimized(true)}
                  className="text-left group cursor-pointer flex items-center gap-2"
                  title="Clique para minimizar a aba de gráficos"
                >
                  <BarChart3 className="w-4 h-4 text-[#223585] shrink-0" />
                  <h2 className="text-[13px] font-bold text-slate-900 group-hover:text-[#223585] transition-colors">
                    Aba de Gráficos da Planilha ({activeVendor})
                  </h2>
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="px-2.5 py-0.5 bg-slate-100 border border-slate-200 rounded-full text-[11px] text-slate-600 font-mono font-semibold tabular-nums">
                    {stats.total} sites
                  </span>
                  {!(hasAnyChartFilter || collaboratorDocStats.expiredCollaborators.length > 0) && (
                    <button
                      type="button"
                      onClick={() => setIsMinimized(true)}
                      className="p-1 rounded-[6px] text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
                      title="Minimizar gráficos"
                    >
                      <Minimize2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {/* 1. SITES PARA FAZER */}
                <button
                  type="button"
                  onClick={() =>
                    onSelectChartFilter(
                      activeChartFilter === 'PARA_FAZER' ? 'ALL' : 'PARA_FAZER'
                    )
                  }
                  className={`w-full text-left rounded-[8px] p-2 -mx-2 transition-colors cursor-pointer ${
                    activeChartFilter === 'PARA_FAZER'
                      ? 'bg-amber-50 ring-1 ring-amber-300'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                    <span className="font-semibold text-slate-800">
                      1º Sites Para Fazer (A Executar)
                    </span>
                    <span className="font-mono text-xs tabular-nums shrink-0">
                      <strong className="text-amber-600">{stats.paraFazerCount}</strong>
                      <span className="text-slate-300 mx-1">·</span>
                      <span className="text-slate-500">{stats.paraFazerPct}%</span>
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-1">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, stats.paraFazerPct)}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {stats.paraFazerEmCampo} liberados · {stats.paraFazerSemAcesso} s/ acesso
                  </div>
                </button>

                {/* 2. SITES FEITOS */}
                <button
                  type="button"
                  onClick={() =>
                    onSelectChartFilter(activeChartFilter === 'FEITOS' ? 'ALL' : 'FEITOS')
                  }
                  className={`w-full text-left rounded-[8px] p-2 -mx-2 transition-colors cursor-pointer ${
                    activeChartFilter === 'FEITOS'
                      ? 'bg-emerald-50 ring-1 ring-emerald-300'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                    <span className="font-semibold text-slate-800">
                      2º Sites Feitos (Finalizados)
                    </span>
                    <span className="font-mono text-xs tabular-nums shrink-0">
                      <strong className="text-emerald-600">{stats.feitosCount}</strong>
                      <span className="text-slate-300 mx-1">·</span>
                      <span className="text-slate-500">{stats.feitosPct}%</span>
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-1">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, stats.feitosPct)}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    de {stats.total} sites da planilha
                  </div>
                </button>

                {/* 3. NOTAS PENDENTES */}
                <button
                  type="button"
                  onClick={() =>
                    onSelectChartFilter(
                      activeChartFilter === 'NOTAS_PENDENTES' ? 'ALL' : 'NOTAS_PENDENTES'
                    )
                  }
                  className={`w-full text-left rounded-[8px] p-2 -mx-2 transition-colors cursor-pointer ${
                    activeChartFilter === 'NOTAS_PENDENTES'
                      ? 'bg-blue-50 ring-1 ring-blue-300'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                    <span className="font-semibold text-slate-800">
                      Notas Pendentes (SPO / Emitir NF)
                    </span>
                    <span className="font-mono text-xs tabular-nums shrink-0">
                      <strong className="text-[#223585]">{stats.notasPendentesCount}</strong>
                      <span className="text-slate-300 mx-1">·</span>
                      <span className="text-slate-500">{stats.notasPendentesPct}%</span>
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-1">
                    <div
                      className="h-full bg-[#223585] rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, stats.notasPendentesPct)}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {stats.notasEmitidasCount} com NF emitida/pronta
                  </div>
                </button>

                {/* 4. COLABORADORES COM DOCUMENTO VENCIDO */}
                <button
                  type="button"
                  onClick={() => {
                    setIsBarsMinimized(false);
                    setBreakdownMode((prev) =>
                      prev === 'DOC_VENCIDO' ? 'DUPLAS' : 'DOC_VENCIDO'
                    );
                  }}
                  className={`w-full text-left rounded-[8px] p-2 -mx-2 transition-colors cursor-pointer ${
                    breakdownMode === 'DOC_VENCIDO'
                      ? 'bg-rose-50 ring-1 ring-rose-300'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                    <span className="font-semibold text-slate-800">
                      Colaboradores c/ Doc Vencido
                    </span>
                    <span className="font-mono text-xs tabular-nums shrink-0">
                      <strong
                        className={
                          collaboratorDocStats.expiredCollaborators.length > 0
                            ? 'text-rose-600'
                            : 'text-[#1E8E8D]'
                        }
                      >
                        {collaboratorDocStats.expiredCollaborators.length}
                      </strong>
                      <span className="text-slate-300 mx-1">·</span>
                      <span className="text-slate-500">
                        {collaboratorDocStats.expiredCollaborators.length > 0
                          ? `${collaboratorDocStats.totalExpiredDocsCount} doc(s)`
                          : '100%'}
                      </span>
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-1">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        collaboratorDocStats.expiredCollaborators.length > 0
                          ? 'bg-rose-500'
                          : 'bg-[#1E8E8D]'
                      }`}
                      style={{
                        width:
                          collaboratorDocStats.expiredCollaborators.length > 0
                            ? `${Math.min(
                                100,
                                Math.max(15, collaboratorDocStats.expiredCollaborators.length * 20)
                              )}%`
                            : '100%',
                      }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {collaboratorDocStats.expiredCollaborators.length > 0
                      ? collaboratorDocStats.expiredCollaborators
                          .slice(0, 2)
                          .map((c) => `${c.user.name} (${c.vencidos.map((d) => d.label).join(', ')})`)
                          .join(' · ')
                      : 'NR10 · NR35 · ASO · PCMSO · PGR em dia'}
                  </div>
                </button>
              </div>
            </div>

            {/* RIGHT PANEL: Equipes / Duplas com Sites Pendentes (Segmented Bars) */}
            {!isBarsMinimized && (
              <div className="xl:col-span-7 bg-white border border-slate-200 rounded-[12px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4 sm:p-5 flex flex-col justify-between gap-3.5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                    <h2 className="text-[13px] font-bold text-slate-900">
                      {breakdownMode === 'DUPLAS' &&
                        'Equipes / Duplas com Sites Pendentes'}
                      {breakdownMode === 'EXECUTOR' &&
                        'Executores / Gestores com Sites Pendentes'}
                      {breakdownMode === 'UF' && 'UFs com Sites Pendentes'}
                      {breakdownMode === 'DOC_VENCIDO' &&
                        'Colaboradores com Documento Vencido / Alerta'}
                    </h2>

                    {breakdownMode !== 'DOC_VENCIDO' && (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold">
                        {breakdownMode === 'DUPLAS' &&
                          `100% Feitos saem automático (${stats.completedDuplasCount} ocultas)`}
                        {breakdownMode === 'EXECUTOR' &&
                          `100% Feitos saem automático (${stats.completedExecutorsCount} ocultos)`}
                        {breakdownMode === 'UF' &&
                          `100% Feitos saem automático (${stats.completedUfsCount} ocultas)`}
                      </span>
                    )}
                  </div>

                  {/* Clean Light Segmented Control Tabs */}
                  <div className="inline-flex flex-wrap items-center p-1 bg-slate-100 border border-slate-200/80 rounded-[8px] text-[11px] gap-0.5">
                    <button
                      type="button"
                      onClick={() => setBreakdownMode('DUPLAS')}
                      className={`px-2.5 py-1 rounded-[6px] font-medium flex items-center gap-1 cursor-pointer tabular-nums transition-all ${
                        breakdownMode === 'DUPLAS'
                          ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Users className="w-3 h-3" />
                      <span>Por Equipe / Dupla ({stats.allDuplas.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBreakdownMode('EXECUTOR')}
                      className={`px-2.5 py-1 rounded-[6px] font-medium flex items-center gap-1 cursor-pointer tabular-nums transition-all ${
                        breakdownMode === 'EXECUTOR'
                          ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <UserCheck className="w-3 h-3" />
                      <span>Por Executor ({stats.allExecutors.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBreakdownMode('UF')}
                      className={`px-2.5 py-1 rounded-[6px] font-medium flex items-center gap-1 cursor-pointer tabular-nums transition-all ${
                        breakdownMode === 'UF'
                          ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <MapPin className="w-3 h-3" />
                      <span>Por UF ({stats.allUfs.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBreakdownMode('DOC_VENCIDO')}
                      className={`px-2.5 py-1 rounded-[6px] font-medium flex items-center gap-1 cursor-pointer tabular-nums transition-all ${
                        breakdownMode === 'DOC_VENCIDO'
                          ? 'bg-rose-600 text-white font-semibold shadow-2xs'
                          : collaboratorDocStats.expiredCollaborators.length > 0
                          ? 'text-rose-600 hover:bg-rose-50 font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <ShieldAlert className="w-3 h-3" />
                      <span>
                        Doc. Vencido ({collaboratorDocStats.expiredCollaborators.length})
                      </span>
                    </button>
                  </div>
                </div>

                {/* Horizontal Stacked Bar List */}
                {breakdownMode === 'DUPLAS' && (
                  <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                    {stats.allDuplas.length === 0 ? (
                      <div className="py-10 text-center text-xs text-slate-500">
                        Nenhuma equipe com sites pendentes no momento.
                      </div>
                    ) : (
                      stats.allDuplas.map((item) => {
                        const isSelected = activeEquipeFilter === item.dupla;
                        const totalVal = item.total || 1;
                        const fazerW = Math.round((item.paraFazer / totalVal) * 100);
                        const feitoW = Math.round((item.feitos / totalVal) * 100);
                        const notaW = Math.max(
                          0,
                          Math.min(100 - fazerW - feitoW, Math.round((item.notasPendentes / totalVal) * 100))
                        );
                        const expiredInDupla = getExpiredCollaboratorsForDupla(item.dupla);

                        return (
                          <button
                            key={item.dupla}
                            type="button"
                            onClick={() =>
                              onSelectEquipeFilter(isSelected ? 'ALL' : item.dupla)
                            }
                            title={`Filtrar ${item.dupla}: ${item.paraFazer} pendente(s), ${item.feitos} feito(s), ${item.notasPendentes} nota(s)`}
                            className={`w-full flex items-center gap-3 px-2.5 py-1.5 rounded-[8px] transition-colors cursor-pointer text-left ${
                              isSelected
                                ? 'bg-[#223585]/8 ring-1 ring-[#223585]/35'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="w-32 sm:w-40 shrink-0 flex items-center gap-1.5 min-w-0">
                              {expiredInDupla.length > 0 && (
                                <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                              )}
                              <span
                                className={`text-xs font-semibold truncate ${
                                  isSelected ? 'text-[#223585]' : 'text-slate-700'
                                }`}
                              >
                                {item.dupla}
                              </span>
                            </div>

                            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden flex gap-0.5">
                              {fazerW > 0 && (
                                <div
                                  className="h-full bg-amber-500 rounded-l-full transition-all duration-300"
                                  style={{ width: `${fazerW}%` }}
                                />
                              )}
                              {feitoW > 0 && (
                                <div
                                  className="h-full bg-[#1E8E8D] transition-all duration-300"
                                  style={{ width: `${feitoW}%` }}
                                />
                              )}
                              {notaW > 0 && (
                                <div
                                  className="h-full bg-[#223585] rounded-r-full transition-all duration-300"
                                  style={{ width: `${notaW}%` }}
                                />
                              )}
                            </div>

                            <span className="w-9 text-right font-mono text-xs font-semibold text-slate-700 tabular-nums shrink-0">
                              {item.paraFazer}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {breakdownMode === 'EXECUTOR' && (
                  <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                    {stats.allExecutors.length === 0 ? (
                      <div className="py-10 text-center text-xs text-slate-500">
                        Nenhum executor com sites pendentes.
                      </div>
                    ) : (
                      stats.allExecutors.map((item) => {
                        const isSelected = activeExecutorFilter === item.executor;
                        const totalVal = item.total || 1;
                        const fazerW = Math.round((item.paraFazer / totalVal) * 100);
                        const feitoW = Math.round((item.feitos / totalVal) * 100);
                        const notaW = Math.max(
                          0,
                          Math.min(100 - fazerW - feitoW, Math.round((item.notasPendentes / totalVal) * 100))
                        );

                        return (
                          <button
                            key={item.executor}
                            type="button"
                            onClick={() => {
                              if (onSelectExecutorFilter) {
                                onSelectExecutorFilter(isSelected ? 'ALL' : item.executor);
                              }
                            }}
                            className={`w-full flex items-center gap-3 px-2.5 py-1.5 rounded-[8px] transition-colors cursor-pointer text-left ${
                              isSelected
                                ? 'bg-[#223585]/8 ring-1 ring-[#223585]/35'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="w-32 sm:w-40 shrink-0 truncate text-xs font-semibold text-slate-700">
                              {item.executor}
                            </div>
                            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden flex gap-0.5">
                              {fazerW > 0 && (
                                <div className="h-full bg-amber-500" style={{ width: `${fazerW}%` }} />
                              )}
                              {feitoW > 0 && (
                                <div className="h-full bg-[#1E8E8D]" style={{ width: `${feitoW}%` }} />
                              )}
                              {notaW > 0 && (
                                <div className="h-full bg-[#223585]" style={{ width: `${notaW}%` }} />
                              )}
                            </div>
                            <span className="w-9 text-right font-mono text-xs font-semibold text-slate-700 tabular-nums shrink-0">
                              {item.paraFazer}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {breakdownMode === 'UF' && (
                  <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                    {stats.allUfs.length === 0 ? (
                      <div className="py-10 text-center text-xs text-slate-500">
                        Nenhuma UF com sites pendentes.
                      </div>
                    ) : (
                      stats.allUfs.map((item) => {
                        const isSelected = activeUfFilter === item.uf;
                        const totalVal = item.total || 1;
                        const fazerW = Math.round((item.paraFazer / totalVal) * 100);
                        const feitoW = Math.round((item.feitos / totalVal) * 100);
                        const notaW = Math.max(
                          0,
                          Math.min(100 - fazerW - feitoW, Math.round((item.notasPendentes / totalVal) * 100))
                        );

                        return (
                          <button
                            key={item.uf}
                            type="button"
                            onClick={() => onSelectUfFilter(isSelected ? 'ALL' : item.uf)}
                            className={`w-full flex items-center gap-3 px-2.5 py-1.5 rounded-[8px] transition-colors cursor-pointer text-left ${
                              isSelected
                                ? 'bg-[#223585]/8 ring-1 ring-[#223585]/35'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="w-24 shrink-0 font-mono text-xs font-bold text-slate-700">
                              UF {item.uf}
                            </div>
                            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden flex gap-0.5">
                              {fazerW > 0 && (
                                <div className="h-full bg-amber-500" style={{ width: `${fazerW}%` }} />
                              )}
                              {feitoW > 0 && (
                                <div className="h-full bg-[#1E8E8D]" style={{ width: `${feitoW}%` }} />
                              )}
                              {notaW > 0 && (
                                <div className="h-full bg-[#223585]" style={{ width: `${notaW}%` }} />
                              )}
                            </div>
                            <span className="w-9 text-right font-mono text-xs font-semibold text-slate-700 tabular-nums shrink-0">
                              {item.paraFazer}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {breakdownMode === 'DOC_VENCIDO' && (
                  <div className="max-h-[250px] overflow-y-auto pr-1 space-y-2.5">
                    {collaboratorDocStats.allAlertCollaborators.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {collaboratorDocStats.allAlertCollaborators.map((item) => {
                          const isVencido =
                            item.vencidos.length > 0 || item.overallStatus === 'VENCIDO';
                          const isDuplaFiltered =
                            item.canonicalEquipe !== 'Sem Equipe' &&
                            activeEquipeFilter === item.canonicalEquipe;

                          return (
                            <div
                              key={item.user.id}
                              className={`p-3 rounded-[10px] border flex flex-col justify-between gap-2 ${
                                isVencido
                                  ? 'bg-rose-50/70 border-rose-200'
                                  : 'bg-amber-50/70 border-amber-200'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <AlertTriangle
                                      className={`w-3.5 h-3.5 shrink-0 ${
                                        isVencido ? 'text-rose-600' : 'text-amber-600'
                                      }`}
                                    />
                                    <span className="text-xs font-bold text-slate-900 truncate">
                                      {item.user.name}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                                    <span className="font-mono font-semibold text-[#223585]">
                                      {item.user.role}
                                    </span>
                                    <span>·</span>
                                    <span>{item.canonicalEquipe}</span>
                                  </div>
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shrink-0 ${
                                    isVencido
                                      ? 'bg-rose-100 text-rose-700 border border-rose-200'
                                      : 'bg-amber-100 text-amber-800 border border-amber-200'
                                  }`}
                                >
                                  {isVencido
                                    ? `${Math.max(1, item.vencidos.length)} VENCIDO(S)`
                                    : `${item.aVencer.length} A VENCER`}
                                </span>
                              </div>

                              <div className="flex flex-wrap gap-1">
                                {item.vencidos.map((doc) => (
                                  <span
                                    key={doc.type}
                                    className="px-2 py-0.5 rounded bg-white border border-rose-200 text-rose-700 text-[10px] font-medium inline-flex items-center gap-1"
                                  >
                                    <strong>{doc.label}:</strong>
                                    <span className="font-mono">
                                      {formatDateBrShort(doc.expiresAt)}
                                    </span>
                                    {onRemoveExpiredDoc && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onRemoveExpiredDoc(
                                            item.user.id,
                                            doc.type,
                                            doc.label,
                                            item.user.name
                                          )
                                        }
                                        className="ml-0.5 text-rose-500 hover:text-rose-700 cursor-pointer"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    )}
                                  </span>
                                ))}
                                {item.aVencer.map((doc) => (
                                  <span
                                    key={doc.type}
                                    className="px-2 py-0.5 rounded bg-white border border-amber-200 text-amber-800 text-[10px] font-medium inline-flex items-center gap-1"
                                  >
                                    <strong>{doc.label}:</strong>
                                    <span className="font-mono">
                                      {formatDateBrShort(doc.expiresAt)} ({doc.eval.daysRemaining}d)
                                    </span>
                                    {onRemoveExpiredDoc && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onRemoveExpiredDoc(
                                            item.user.id,
                                            doc.type,
                                            doc.label,
                                            item.user.name
                                          )
                                        }
                                        className="ml-0.5 text-amber-600 hover:text-amber-800 cursor-pointer"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    )}
                                  </span>
                                ))}
                              </div>

                              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200/70">
                                {item.canonicalEquipe !== 'Sem Equipe' ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onSelectEquipeFilter(
                                        isDuplaFiltered ? 'ALL' : item.canonicalEquipe
                                      )
                                    }
                                    className={`px-2 py-0.5 rounded-[6px] text-[10px] font-semibold cursor-pointer ${
                                      isDuplaFiltered
                                        ? 'bg-[#223585] text-white'
                                        : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                                    }`}
                                  >
                                    {isDuplaFiltered ? 'Limpar' : `Filtrar ${item.canonicalEquipe}`}
                                  </button>
                                ) : (
                                  <span />
                                )}
                                {onOpenCollaboratorDocs && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenCollaboratorDocs(item.user.id)}
                                    className="px-2 py-0.5 rounded-[6px] bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                                  >
                                    <span>Ver Docs</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-5 text-center bg-emerald-50 border border-emerald-200 rounded-[10px] text-xs text-emerald-700 font-medium">
                        Nenhum colaborador está com documento vencido ou a vencer no momento.
                      </div>
                    )}
                  </div>
                )}

                {/* Bottom Compact Legend */}
                <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                    <span>Pendentes</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#1E8E8D] inline-block" />
                    <span>Feitos</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#223585] inline-block" />
                    <span>Notas pendentes</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                    <span>Doc. vencido ({collaboratorDocStats.expiredCollaborators.length})</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Drilldown Selected Sites Breakdown */}
          {hasAnyChartFilter && (
            <div className="bg-white border border-slate-200 rounded-[12px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-slate-900">
                    Sites Selecionados no Gráfico ({chartSelectedSitesBreakdown.total}):
                  </span>
                  <span className="text-slate-500">
                    Exibindo sempre em <strong className="text-slate-700">1º os Sites a Fazer</strong> e depois os{' '}
                    <strong className="text-slate-700">Sites Feitos</strong>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* 1º SITES A FAZER */}
                <div className="rounded-[10px] border border-amber-200 bg-white overflow-hidden flex flex-col">
                  <div className="px-3.5 py-2 bg-amber-50 border-b border-amber-200/80 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-800">
                      <Clock className="w-3.5 h-3.5 text-amber-600" />
                      <span>1º Sites a Fazer (Pendentes / A Executar)</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 font-mono text-[11px] font-bold">
                      {chartSelectedSitesBreakdown.paraFazerSites.length}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-52 overflow-y-auto">
                    {chartSelectedSitesBreakdown.paraFazerSites.length > 0 ? (
                      chartSelectedSitesBreakdown.paraFazerSites.map((s, idx) => {
                        const rawEq =
                          getCellValueForColumn(s, 'EQUIPE EXECUTANTE') ||
                          s.equipeParceira ||
                          '';
                        const dupla = getCanonicalDuplaName(rawEq) || rawEq || 'Sem Dupla';
                        return (
                          <div
                            key={s.id}
                            onClick={() => onOpenSite && onOpenSite(s.id)}
                            className="px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors"
                          >
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                              <span className="font-mono text-[10px] text-slate-400 w-5">
                                #{idx + 1}
                              </span>
                              <span className="font-mono font-bold text-[#223585]">
                                {s.siteId}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                                {s.uf} · {s.municipio}
                              </span>
                              <span className="text-[11px] text-slate-500 truncate">
                                {dupla}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold">
                                {s.status || 'A Fazer'}
                              </span>
                              {onOpenSite && (
                                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-4 text-center text-xs text-slate-500">
                        Nenhum site pendente / a fazer para este filtro.
                      </div>
                    )}
                  </div>
                </div>

                {/* 2º SITES FEITOS */}
                <div className="rounded-[10px] border border-emerald-200 bg-white overflow-hidden flex flex-col">
                  <div className="px-3.5 py-2 bg-emerald-50 border-b border-emerald-200/80 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>2º Sites Feitos (Finalizados)</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 font-mono text-[11px] font-bold">
                      {chartSelectedSitesBreakdown.feitosSites.length}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-52 overflow-y-auto">
                    {chartSelectedSitesBreakdown.feitosSites.length > 0 ? (
                      chartSelectedSitesBreakdown.feitosSites.map((s, idx) => {
                        const rawEq =
                          getCellValueForColumn(s, 'EQUIPE EXECUTANTE') ||
                          s.equipeParceira ||
                          '';
                        const dupla = getCanonicalDuplaName(rawEq) || rawEq || 'Sem Dupla';
                        return (
                          <div
                            key={s.id}
                            onClick={() => onOpenSite && onOpenSite(s.id)}
                            className="px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors"
                          >
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                              <span className="font-mono text-[10px] text-slate-400 w-5">
                                #{idx + 1}
                              </span>
                              <span className="font-mono font-bold text-[#223585]">
                                {s.siteId}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                                {s.uf} · {s.municipio}
                              </span>
                              <span className="text-[11px] text-slate-500 truncate">
                                {dupla}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">
                                {s.status || 'Finalizada'}
                              </span>
                              {onOpenSite && (
                                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-4 text-center text-xs text-slate-500">
                        Nenhum site finalizado para este filtro.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

InteractiveSpreadsheetChart.displayName = 'InteractiveSpreadsheetChart';
