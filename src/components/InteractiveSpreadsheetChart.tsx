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

export const InteractiveSpreadsheetChart: React.FC<InteractiveSpreadsheetChartProps> = ({
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
      const rawDupla = (
        getCellValueForColumn(s, 'EQUIPE EXECUTANTE') ||
        s.equipeParceira ||
        ''
      ).trim();
      const canonDupla = getCanonicalDuplaName(rawDupla) || 'Sem Dupla';
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
    <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
      {/* =====================================================================
          ABA DE CONTROLE / MINIMIZAÇÃO DOS GRÁFICOS
         ===================================================================== */}
      <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsMinimized((prev) => !prev)}
            className="flex items-center gap-2 text-left cursor-pointer group"
            title={
              isMinimized
                ? 'Clique para expandir a aba de gráficos'
                : 'Clique para minimizar a aba de gráficos'
            }
          >
            <div className="w-7 h-7 rounded-lg bg-[#223585] group-hover:bg-[#1E8E8D] transition-colors text-white flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">
                Aba de Gráficos da Planilha ({activeVendor})
              </span>
              <span className="px-2 py-0.5 bg-[#F3F4F6] border border-slate-200 rounded-md text-[11px] text-slate-700 font-mono font-semibold tabular-nums">
                {stats.total} sites
              </span>
            </div>
          </button>

          {/* Compact inline badge for Collaborators with Expired Documents (always visible in header bar) */}
          {collaboratorDocStats.expiredCollaborators.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setIsMinimized(false);
                setIsBarsMinimized(false);
                setBreakdownMode('DOC_VENCIDO');
              }}
              className="px-2.5 py-0.5 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Clique para ver no gráfico os colaboradores com documento vencido"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
              <span>
                {collaboratorDocStats.expiredCollaborators.length} Colaborador(es) c/ Doc Vencido:{' '}
                <strong>
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

          {/* Compact inline summary pills when minimized so admin still sees KPIs in 1 line */}
          {isMinimized && (
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
                    ? 'bg-amber-500 text-white border-amber-600 font-bold'
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
                    ? 'bg-emerald-600 text-white border-emerald-700 font-bold'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
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
                    ? 'bg-blue-600 text-white border-blue-700 font-bold'
                    : 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                }`}
              >
                Notas Pend.: {stats.notasPendentesCount}
              </button>
            </div>
          )}

          {hasAnyChartFilter && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md text-[11px] font-semibold flex items-center gap-1">
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
              <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-md text-[11px] font-mono font-semibold">
                1º A Fazer: {chartSelectedSitesBreakdown.paraFazerSites.length} · 2º Feitos:{' '}
                {chartSelectedSitesBreakdown.feitosSites.length}
              </span>
              <button
                type="button"
                onClick={clearAllChartFilters}
                className="px-2 py-0.5 bg-[#F3F4F6] hover:bg-slate-200 text-slate-700 rounded-md text-[11px] font-medium flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Limpar filtro do gráfico</span>
              </button>
            </div>
          )}
        </div>

        {/* Right: Minimize / Expand Chart Tab Controls */}
        <div className="flex items-center gap-1.5">
          {!isMinimized && (
            <button
              type="button"
              onClick={() => setIsBarsMinimized((prev) => !prev)}
              className="px-2.5 py-1 bg-[#F3F4F6] hover:bg-slate-200/80 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-700 flex items-center gap-1 cursor-pointer"
              title="Minimizar ou expandir apenas o gráfico de barras por Dupla/Executor/UF/Doc Vencido"
            >
              <span>{isBarsMinimized ? 'Mostrar Barras' : 'Ocultar Barras'}</span>
              {isBarsMinimized ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsMinimized((prev) => !prev)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
              isMinimized
                ? 'bg-[#223585] hover:bg-[#1b2a6b] text-white border-[#223585]'
                : 'bg-[#F3F4F6] hover:bg-slate-200 text-slate-800 border-slate-200'
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
                <span>Minimizar Gráficos</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="p-4 space-y-4 bg-[#F3F4F6]/50">
          {/* 4 Main Interactive Cards: 1º PARA FAZER | 2º FEITOS | 3º NOTAS PENDENTES | 4º COLABORADORES C/ DOC VENCIDO */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {/* 1. SITES PARA FAZER (SEMPRE EM PRIMEIRO) */}
            <button
              type="button"
              onClick={() =>
                onSelectChartFilter(
                  activeChartFilter === 'PARA_FAZER' ? 'ALL' : 'PARA_FAZER'
                )
              }
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                activeChartFilter === 'PARA_FAZER'
                  ? 'bg-amber-50/90 border-amber-400 ring-2 ring-amber-400/40 shadow-sm'
                  : 'bg-white hover:bg-slate-50/80 border-slate-200 shadow-2xs'
              }`}
            >
              <div className="flex items-start justify-between gap-2 w-full">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 border border-amber-200 flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      1º Sites Para Fazer (A Executar)
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Aparecem sempre em primeiro ao clicar
                    </div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-200">
                  {stats.paraFazerPct}%
                </span>
              </div>

              <div className="space-y-2 w-full">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
                    {stats.paraFazerCount}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {stats.paraFazerEmCampo} liberados · {stats.paraFazerSemAcesso} s/ acesso
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, stats.paraFazerPct)}%` }}
                  />
                </div>
              </div>
            </button>

            {/* 2. SITES FEITOS (EM SEGUNDO - AMETA TEAL) */}
            <button
              type="button"
              onClick={() =>
                onSelectChartFilter(activeChartFilter === 'FEITOS' ? 'ALL' : 'FEITOS')
              }
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                activeChartFilter === 'FEITOS'
                  ? 'bg-emerald-50/90 border-emerald-500 ring-2 ring-emerald-500/30 shadow-sm'
                  : 'bg-white hover:bg-slate-50/80 border-slate-200 shadow-2xs'
              }`}
            >
              <div className="flex items-start justify-between gap-2 w-full">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      2º Sites Feitos (Finalizados)
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Vistorias e atividades concluídas
                    </div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-100 text-emerald-900 border border-emerald-200">
                  {stats.feitosPct}%
                </span>
              </div>

              <div className="space-y-2 w-full">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
                    {stats.feitosCount}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    de {stats.total} sites da planilha
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, stats.feitosPct)}%` }}
                  />
                </div>
              </div>
            </button>

            {/* 3. NOTAS PENDENTES (FINANCEIRO / SPO / NF - AMETA NAVY) */}
            <button
              type="button"
              onClick={() =>
                onSelectChartFilter(
                  activeChartFilter === 'NOTAS_PENDENTES' ? 'ALL' : 'NOTAS_PENDENTES'
                )
              }
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                activeChartFilter === 'NOTAS_PENDENTES'
                  ? 'bg-blue-50/90 border-blue-500 ring-2 ring-blue-500/30 shadow-sm'
                  : 'bg-white hover:bg-slate-50/80 border-slate-200 shadow-2xs'
              }`}
            >
              <div className="flex items-start justify-between gap-2 w-full">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-800 border border-blue-200 flex items-center justify-center shrink-0">
                    <Receipt className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Notas Pendentes (SPO / Emitir NF)
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Aguardando NF, SPO, SGR ou sem N° NF
                    </div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-blue-100 text-blue-900 border border-blue-200">
                  {stats.notasPendentesPct}%
                </span>
              </div>

              <div className="space-y-2 w-full">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
                    {stats.notasPendentesCount}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {stats.notasEmitidasCount} com NF emitida/pronta
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, stats.notasPendentesPct)}%` }}
                  />
                </div>
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
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2.5 ${
                breakdownMode === 'DOC_VENCIDO'
                  ? 'bg-red-50/90 border-red-400 ring-2 ring-red-400/40 shadow-sm'
                  : collaboratorDocStats.expiredCollaborators.length > 0
                  ? 'bg-red-50/40 hover:bg-red-50/80 border-red-200 shadow-2xs'
                  : 'bg-white hover:bg-slate-50/80 border-slate-200 shadow-2xs'
              }`}
            >
              <div className="flex items-start justify-between gap-2 w-full">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                      collaboratorDocStats.expiredCollaborators.length > 0
                        ? 'bg-red-100 text-red-700 border-red-200'
                        : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                    }`}
                  >
                    <FileWarning className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Colaboradores c/ Doc Vencido
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {collaboratorDocStats.expiredCollaborators.length > 0
                        ? 'Clique para ver quem está com doc vencido'
                        : 'Todos os documentos obrigatórios em dia'}
                    </div>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-bold border shrink-0 ${
                    collaboratorDocStats.expiredCollaborators.length > 0
                      ? 'bg-red-600 text-white border-red-700'
                      : 'bg-emerald-100 text-emerald-900 border-emerald-200'
                  }`}
                >
                  {collaboratorDocStats.expiredCollaborators.length > 0
                    ? `${collaboratorDocStats.totalExpiredDocsCount} doc(s)`
                    : 'OK'}
                </span>
              </div>

              <div className="space-y-1.5 w-full">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-2xl font-bold font-mono tabular-nums ${
                      collaboratorDocStats.expiredCollaborators.length > 0
                        ? 'text-red-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {collaboratorDocStats.expiredCollaborators.length}
                  </span>
                  <span className="text-[11px] text-slate-500 truncate">
                    {collaboratorDocStats.expiringCollaborators.length > 0
                      ? `+ ${collaboratorDocStats.expiringCollaborators.length} a vencer (30d)`
                      : 'NR10 · NR35 · ASO · PCMSO · PGR'}
                  </span>
                </div>

                {/* Inline list of collaborators with expired docs right on the card */}
                {collaboratorDocStats.expiredCollaborators.length > 0 ? (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {collaboratorDocStats.expiredCollaborators.slice(0, 2).map((c) => (
                      <span
                        key={c.user.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100/90 text-red-900 border border-red-200 text-[10px] font-semibold truncate max-w-full"
                      >
                        <AlertTriangle className="w-2.5 h-2.5 text-red-600 shrink-0" />
                        <span className="truncate">
                          {c.user.name}:{' '}
                          {c.vencidos.map((d) => d.label).join(', ') || 'Vencido'}
                        </span>
                      </span>
                    ))}
                    {collaboratorDocStats.expiredCollaborators.length > 2 && (
                      <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-[10px] font-mono font-bold">
                        +{collaboratorDocStats.expiredCollaborators.length - 2}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600 rounded-full w-full" />
                  </div>
                )}
              </div>
            </button>
          </div>

          {/* Interactive Comparative Bar Chart (Por Dupla Executante | Por Executor | Por UF | Colab. Doc Vencido) */}
          {!isBarsMinimized && (
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-bold text-slate-800">
                    {breakdownMode === 'DUPLAS' &&
                      'Equipes / Duplas com Sites Pendentes:'}
                    {breakdownMode === 'EXECUTOR' &&
                      'Executores / Gestores com Sites Pendentes:'}
                    {breakdownMode === 'UF' && 'UFs com Sites Pendentes:'}
                    {breakdownMode === 'DOC_VENCIDO' &&
                      'Gráfico de Colaboradores com Documento Vencido / Alerta:'}
                  </span>
                  {breakdownMode !== 'DOC_VENCIDO' && (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-medium">
                      {breakdownMode === 'DUPLAS' &&
                        `100% Feitos saem automático (${stats.completedDuplasCount} concluídas ocultas)`}
                      {breakdownMode === 'EXECUTOR' &&
                        `100% Feitos saem automático (${stats.completedExecutorsCount} concluídos ocultos)`}
                      {breakdownMode === 'UF' &&
                        `100% Feitos saem automático (${stats.completedUfsCount} UFs concluídas ocultas)`}
                    </span>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                    <span className="inline-flex items-center gap-1 font-medium text-amber-800">
                      <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                      1º Pendentes (A Fazer)
                    </span>
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-800">
                      <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
                      2º Feitos
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" />
                      Notas Pendentes
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                      <span className="w-2.5 h-2.5 rounded-xs bg-red-600 inline-block" />
                      Doc. Vencido ({collaboratorDocStats.expiredCollaborators.length})
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center p-0.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-[11px]">
                  <button
                    type="button"
                    onClick={() => setBreakdownMode('DUPLAS')}
                    className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1 cursor-pointer ${
                      breakdownMode === 'DUPLAS'
                        ? 'bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/70'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Users className="w-3 h-3" />
                    <span>Por Equipe / Dupla ({stats.allDuplas.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBreakdownMode('EXECUTOR')}
                    className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1 cursor-pointer ${
                      breakdownMode === 'EXECUTOR'
                        ? 'bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/70'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <UserCheck className="w-3 h-3" />
                    <span>Por Executor ({stats.allExecutors.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBreakdownMode('UF')}
                    className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1 cursor-pointer ${
                      breakdownMode === 'UF'
                        ? 'bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/70'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <MapPin className="w-3 h-3" />
                    <span>Por UF ({stats.allUfs.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBreakdownMode('DOC_VENCIDO')}
                    className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1 cursor-pointer ${
                      breakdownMode === 'DOC_VENCIDO'
                        ? 'bg-red-600 text-white font-semibold shadow-2xs'
                        : collaboratorDocStats.expiredCollaborators.length > 0
                        ? 'text-red-700 hover:bg-red-50 font-semibold'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <ShieldAlert className="w-3 h-3" />
                    <span>
                      Doc. Vencido ({collaboratorDocStats.expiredCollaborators.length})
                    </span>
                  </button>
                </div>
              </div>

              {breakdownMode === 'DUPLAS' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {stats.allDuplas.map((item) => {
                    const isSelected = activeEquipeFilter === item.dupla;
                    const fazerW =
                      item.total > 0 ? Math.round((item.paraFazer / item.total) * 100) : 0;
                    const feitoW =
                      item.total > 0 ? Math.round((item.feitos / item.total) * 100) : 0;
                    const variantsList = Array.from(item.rawVariants);
                    const expiredInDupla = getExpiredCollaboratorsForDupla(item.dupla);

                    return (
                      <button
                        key={item.dupla}
                        type="button"
                        onClick={() => {
                          onSelectEquipeFilter(isSelected ? 'ALL' : item.dupla);
                        }}
                        title={
                          variantsList.length > 1
                            ? `Agrupa variações na planilha: ${variantsList.join(', ')}`
                            : `Filtrar exclusivamente a equipe ${item.dupla} (1º A Fazer, 2º Feitos)`
                        }
                        className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#223585] text-white border-[#223585] ring-2 ring-[#1E8E8D]/50'
                            : expiredInDupla.length > 0
                            ? 'bg-red-50/40 hover:bg-red-50/80 border-red-200 text-slate-800'
                            : 'bg-[#F3F4F6]/60 hover:bg-[#F3F4F6] border-slate-200/80 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs mb-1">
                          <span className="font-semibold truncate">{item.dupla}</span>
                          <span
                            className={`font-mono text-[11px] font-bold shrink-0 ${
                              isSelected ? 'text-amber-300' : 'text-amber-700'
                            }`}
                          >
                            {item.paraFazer} pendente{item.paraFazer !== 1 ? 's' : ''}
                          </span>
                        </div>

                        {variantsList.length > 1 && (
                          <div
                            className={`text-[10px] truncate mb-1.5 ${
                              isSelected ? 'text-slate-300' : 'text-slate-400'
                            }`}
                          >
                            Unifica: {variantsList.join(' + ')}
                          </div>
                        )}

                        {/* Alert Badge if a collaborator in this Dupla has an expired document */}
                        {expiredInDupla.length > 0 && (
                          <div
                            className={`mb-1.5 px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1 ${
                              isSelected
                                ? 'bg-red-500/90 text-white'
                                : 'bg-red-100 text-red-800 border border-red-200'
                            }`}
                          >
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span className="truncate">
                              Doc Vencido:{' '}
                              {expiredInDupla
                                .map(
                                  (c) =>
                                    `${c.user.name} (${
                                      c.vencidos.map((d) => d.label).join(', ') || 'Vencido'
                                    })`
                                )
                                .join(', ')}
                            </span>
                          </div>
                        )}

                        {/* Bar: 1º Para Fazer (Amber) on the left, 2º Feitos (Teal) on the right */}
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex mb-1.5">
                          <div
                            className="h-full bg-amber-500"
                            style={{ width: `${fazerW}%` }}
                            title={`1º A Fazer: ${item.paraFazer}`}
                          />
                          <div
                            className="h-full bg-emerald-600"
                            style={{ width: `${feitoW}%` }}
                            title={`2º Feitos: ${item.feitos}`}
                          />
                        </div>

                        <div
                          className={`flex items-center justify-between text-[10px] font-mono ${
                            isSelected ? 'text-slate-200' : 'text-slate-500'
                          }`}
                        >
                          <span
                            className={
                              item.paraFazer > 0
                                ? isSelected
                                  ? 'text-amber-300 font-bold'
                                  : 'text-amber-700 font-bold'
                                : ''
                            }
                          >
                            A Fazer: {item.paraFazer}
                          </span>
                          <span>Feitos: {item.feitos}</span>
                          <span>Notas Pend.: {item.notasPendentes}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {breakdownMode === 'EXECUTOR' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {stats.allExecutors.map((item) => {
                    const isSelected = activeExecutorFilter === item.executor;
                    const fazerW =
                      item.total > 0 ? Math.round((item.paraFazer / item.total) * 100) : 0;
                    const feitoW =
                      item.total > 0 ? Math.round((item.feitos / item.total) * 100) : 0;
                    const variantsList = Array.from(item.rawVariants);
                    const duplasOfExec = Array.from(item.duplasSet);
                    const expiredInExec = getExpiredCollaboratorsForExecutor(
                      item.executor,
                      duplasOfExec
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
                        className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#223585] text-white border-[#223585] ring-2 ring-[#1E8E8D]/50'
                            : expiredInExec.length > 0
                            ? 'bg-red-50/40 hover:bg-red-50/80 border-red-200 text-slate-800'
                            : 'bg-[#F3F4F6]/60 hover:bg-[#F3F4F6] border-slate-200/80 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs mb-1">
                          <span className="font-bold truncate">
                            Executor: {item.executor}
                          </span>
                          <span
                            className={`font-mono text-[11px] font-bold shrink-0 ${
                              isSelected ? 'text-amber-300' : 'text-amber-700'
                            }`}
                          >
                            {item.paraFazer} pendente{item.paraFazer !== 1 ? 's' : ''}
                          </span>
                        </div>

                        {variantsList.length > 1 && (
                          <div
                            className={`text-[10px] truncate mb-1 ${
                              isSelected ? 'text-slate-300' : 'text-slate-400'
                            }`}
                          >
                            Unifica grafias: {variantsList.join(', ')}
                          </div>
                        )}

                        {duplasOfExec.length > 0 && (
                          <div
                            className={`text-[10px] truncate mb-1.5 ${
                              isSelected ? 'text-blue-200' : 'text-slate-500'
                            }`}
                            title={duplasOfExec.join(', ')}
                          >
                            Equipes: {duplasOfExec.join(' · ')}
                          </div>
                        )}

                        {expiredInExec.length > 0 && (
                          <div
                            className={`mb-1.5 px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1 ${
                              isSelected
                                ? 'bg-red-500/90 text-white'
                                : 'bg-red-100 text-red-800 border border-red-200'
                            }`}
                          >
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span className="truncate">
                              Doc Vencido:{' '}
                              {expiredInExec
                                .map(
                                  (c) =>
                                    `${c.user.name} (${
                                      c.vencidos.map((d) => d.label).join(', ') || 'Vencido'
                                    })`
                                )
                                .join(', ')}
                            </span>
                          </div>
                        )}

                        {/* Bar: 1º Para Fazer (Amber) first, 2º Feitos (Teal) second */}
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex mb-1.5">
                          <div
                            className="h-full bg-amber-500"
                            style={{ width: `${fazerW}%` }}
                          />
                          <div
                            className="h-full bg-emerald-600"
                            style={{ width: `${feitoW}%` }}
                          />
                        </div>

                        <div
                          className={`flex items-center justify-between text-[10px] font-mono ${
                            isSelected ? 'text-slate-200' : 'text-slate-500'
                          }`}
                        >
                          <span
                            className={
                              item.paraFazer > 0
                                ? isSelected
                                  ? 'text-amber-300 font-bold'
                                  : 'text-amber-700 font-bold'
                                : ''
                            }
                          >
                            A Fazer: {item.paraFazer}
                          </span>
                          <span>Feitos: {item.feitos}</span>
                          <span>Notas Pend.: {item.notasPendentes}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {breakdownMode === 'UF' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                  {stats.allUfs.map((item) => {
                    const isSelected = activeUfFilter === item.uf;
                    const fazerW =
                      item.total > 0 ? Math.round((item.paraFazer / item.total) * 100) : 0;
                    const feitoW =
                      item.total > 0 ? Math.round((item.feitos / item.total) * 100) : 0;

                    return (
                      <button
                        key={item.uf}
                        type="button"
                        onClick={() => onSelectUfFilter(isSelected ? 'ALL' : item.uf)}
                        className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#223585] text-white border-[#223585]'
                            : 'bg-[#F3F4F6]/60 hover:bg-[#F3F4F6] border-slate-200/80 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 text-xs mb-1.5">
                          <span className="font-bold font-mono">UF {item.uf}</span>
                          <span
                            className={`font-mono text-[11px] font-bold ${
                              isSelected ? 'text-amber-300' : 'text-amber-700'
                            }`}
                          >
                            {item.paraFazer} pend.
                          </span>
                        </div>

                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex mb-1.5">
                          <div
                            className="h-full bg-amber-500"
                            style={{ width: `${fazerW}%` }}
                          />
                          <div
                            className="h-full bg-emerald-600"
                            style={{ width: `${feitoW}%` }}
                          />
                        </div>

                        <div
                          className={`flex flex-col gap-0.5 text-[10px] font-mono ${
                            isSelected ? 'text-slate-200' : 'text-slate-500'
                          }`}
                        >
                          <span>
                            A Fazer: {item.paraFazer} · Feitos: {item.feitos}
                          </span>
                          <span>Notas Pend.: {item.notasPendentes}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 4th Mode: COLABORADORES COM DOCUMENTO VENCIDO / A VENCER */}
              {breakdownMode === 'DOC_VENCIDO' && (
                <div className="space-y-2.5">
                  {collaboratorDocStats.allAlertCollaborators.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {collaboratorDocStats.allAlertCollaborators.map((item) => {
                        const isVencido =
                          item.vencidos.length > 0 || item.overallStatus === 'VENCIDO';
                        const vencW = Math.round(
                          (Math.max(1, item.vencidos.length) / item.totalDocsCount) * 100
                        );
                        const validW = Math.round(
                          (item.validadosCount / item.totalDocsCount) * 100
                        );
                        const isDuplaFiltered =
                          item.canonicalEquipe !== 'Sem Equipe' &&
                          activeEquipeFilter === item.canonicalEquipe;

                        return (
                          <div
                            key={item.user.id}
                            className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 ${
                              isVencido
                                ? 'bg-red-50/50 border-red-200'
                                : 'bg-amber-50/50 border-amber-200'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <AlertTriangle
                                    className={`w-4 h-4 shrink-0 ${
                                      isVencido ? 'text-red-600' : 'text-amber-600'
                                    }`}
                                  />
                                  <span className="text-xs font-bold text-slate-900 truncate">
                                    {item.user.name}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-600 mt-0.5 flex flex-wrap items-center gap-1.5">
                                  <span className="font-mono font-semibold text-[#223585]">
                                    {item.user.role}
                                  </span>
                                  <span>·</span>
                                  <span>Equipe: {item.canonicalEquipe}</span>
                                </div>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shrink-0 ${
                                  isVencido
                                    ? 'bg-red-600 text-white'
                                    : 'bg-amber-500 text-white'
                                }`}
                              >
                                {isVencido
                                  ? `${Math.max(1, item.vencidos.length)} VENCIDO(S)`
                                  : `${item.aVencer.length} A VENCER`}
                              </span>
                            </div>

                            {/* Visual Document Status Bar */}
                            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex">
                              <div
                                className="h-full bg-red-600"
                                style={{ width: `${vencW}%` }}
                                title={`Documentos Vencidos: ${item.vencidos.length}`}
                              />
                              <div
                                className="h-full bg-emerald-600"
                                style={{ width: `${validW}%` }}
                                title={`Documentos Validados: ${item.validadosCount}`}
                              />
                            </div>

                            {/* Specific Expired Documents Badges */}
                            <div className="flex flex-wrap gap-1.5">
                              {item.vencidos.map((doc) => (
                                <span
                                  key={doc.type}
                                  className="px-2 py-1 rounded-md bg-white border border-red-200 text-red-800 text-[11px] font-medium inline-flex items-center gap-1.5 shadow-2xs"
                                >
                                  <strong className="font-bold">{doc.label}:</strong>
                                  <span className="font-mono text-[10px]">
                                    Venc. {formatDateBrShort(doc.expiresAt)}
                                    {doc.eval.daysRemaining !== null
                                      ? ` (${Math.abs(doc.eval.daysRemaining)}d atrás)`
                                      : ''}
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
                                      title={`Remover documento vencido ${doc.label} de ${item.user.name}`}
                                      className="ml-0.5 p-0.5 rounded hover:bg-red-100 text-red-600 hover:text-red-800 cursor-pointer"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </span>
                              ))}
                              {item.aVencer.map((doc) => (
                                <span
                                  key={doc.type}
                                  className="px-2 py-1 rounded-md bg-white border border-amber-200 text-amber-800 text-[11px] font-medium inline-flex items-center gap-1.5 shadow-2xs"
                                >
                                  <strong className="font-bold">{doc.label}:</strong>
                                  <span className="font-mono text-[10px]">
                                    Vence em {formatDateBrShort(doc.expiresAt)} (
                                    {doc.eval.daysRemaining}d)
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
                                      title={`Remover documento ${doc.label} de ${item.user.name}`}
                                      className="ml-0.5 p-0.5 rounded hover:bg-amber-100 text-amber-700 hover:text-amber-900 cursor-pointer"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </span>
                              ))}
                            </div>

                            {/* Quick Action Buttons */}
                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-red-200/60">
                              {item.canonicalEquipe !== 'Sem Equipe' ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onSelectEquipeFilter(
                                      isDuplaFiltered ? 'ALL' : item.canonicalEquipe
                                    )
                                  }
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                                    isDuplaFiltered
                                      ? 'bg-[#223585] text-white'
                                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                                  }`}
                                >
                                  {isDuplaFiltered
                                    ? 'Limpar Filtro da Equipe'
                                    : `Filtrar Sites (${item.canonicalEquipe})`}
                                </button>
                              ) : (
                                <span />
                              )}

                              {onOpenCollaboratorDocs && (
                                <button
                                  type="button"
                                  onClick={() => onOpenCollaboratorDocs(item.user.id)}
                                  className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                                >
                                  <span>Ver Documentos</span>
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-5 text-center bg-emerald-50/50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
                      Nenhum colaborador está com documento vencido ou a vencer no momento.
                    </div>
                  )}
                </div>
              )}

              {/* ===============================================================
                  PAINEL DE SITES AO CLICAR NO GRÁFICO:
                  SEMPRE EM 1º OS SITES A FAZER E DEPOIS OS SITES FEITOS
                 =============================================================== */}
              {hasAnyChartFilter && (
                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-bold text-slate-900">
                        Sites Selecionados no Gráfico ({chartSelectedSitesBreakdown.total}):
                      </span>
                      <span className="text-slate-500">
                        Exibindo sempre em <strong>1º os Sites a Fazer</strong> e depois os{' '}
                        <strong>Sites Feitos</strong> (também ordenados na planilha abaixo)
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {/* 1º SITES A FAZER (SEMPRE EM PRIMEIRO) */}
                    <div className="rounded-xl border border-amber-200 bg-amber-50/40 overflow-hidden flex flex-col">
                      <div className="px-3.5 py-2 bg-amber-100/80 border-b border-amber-200 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
                          <Clock className="w-3.5 h-3.5 text-amber-700" />
                          <span>1º Sites a Fazer (Pendentes / A Executar)</span>
                        </div>
                        <span className="px-2 py-0.5 rounded-full bg-amber-600 text-white font-mono text-[11px] font-bold">
                          {chartSelectedSitesBreakdown.paraFazerSites.length}
                        </span>
                      </div>
                      <div className="divide-y divide-amber-200/60 max-h-52 overflow-y-auto bg-white">
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
                                className="px-3 py-2 hover:bg-amber-50/60 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors"
                              >
                                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                  <span className="font-mono text-[10px] text-slate-400 w-5">
                                    #{idx + 1}
                                  </span>
                                  <span className="font-mono font-bold text-blue-600">
                                    {s.siteId}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                                    {s.uf} · {s.municipio}
                                  </span>
                                  <span className="text-[11px] text-slate-600 truncate">
                                    {dupla}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200 text-[10px] font-semibold">
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
                          <div className="p-4 text-center text-xs text-slate-400">
                            Nenhum site pendente / a fazer para este filtro.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 2º SITES FEITOS (EM SEGUNDO) */}
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 overflow-hidden flex flex-col">
                      <div className="px-3.5 py-2 bg-emerald-100/80 border-b border-emerald-200 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-emerald-950">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                          <span>2º Sites Feitos (Finalizados)</span>
                        </div>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-mono text-[11px] font-bold">
                          {chartSelectedSitesBreakdown.feitosSites.length}
                        </span>
                      </div>
                      <div className="divide-y divide-emerald-200/60 max-h-52 overflow-y-auto bg-white">
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
                                className="px-3 py-2 hover:bg-emerald-50/50 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors"
                              >
                                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                  <span className="font-mono text-[10px] text-slate-400 w-5">
                                    #{idx + 1}
                                  </span>
                                  <span className="font-mono font-bold text-blue-600">
                                    {s.siteId}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                                    {s.uf} · {s.municipio}
                                  </span>
                                  <span className="text-[11px] text-slate-600 truncate">
                                    {dupla}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-200 text-[10px] font-semibold">
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
                          <div className="p-4 text-center text-xs text-slate-400">
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
      )}
    </div>
  );
};
