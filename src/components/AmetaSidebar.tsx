import React from 'react';
import {
  FolderKanban,
  FileSpreadsheet,
  Users,
  HardHat,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Wrench,
} from 'lucide-react';
import { AmetaLogo } from './AmetaLogo';
import { VendorType } from '../types/telecom';
import { ACIONAMENTO_URL } from '../config/links';

export type SidebarTabId = 'sites' | 'engenharia' | 'duplas' | 'executores';

interface AmetaSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeTab: string;
  onSelectTab: (tab: SidebarTabId) => void;
  activeVendor: VendorType;
  onSelectVendor: (vendor: VendorType) => void;
  sitesCount: number;
  novosSitesCount: number;
  engenhariaCount: number;
  duplasCount: number;
  executoresCount: number;
  canSeeSitesTab: boolean;
  canSeeEngenhariaTab: boolean;
  canSeeDuplasTab: boolean;
  canAccessDemandaExecutores: boolean;
  canSeeAcionamento?: boolean;
  canAccessNokia?: boolean;
  canAccessEricsson?: boolean;
}

export const AmetaSidebar: React.FC<AmetaSidebarProps> = React.memo(({
  collapsed,
  onToggleCollapse,
  activeTab,
  onSelectTab,
  activeVendor,
  sitesCount,
  novosSitesCount,
  engenhariaCount,
  duplasCount,
  executoresCount,
  canSeeSitesTab,
  canSeeEngenhariaTab,
  canSeeDuplasTab,
  canAccessDemandaExecutores,
  canSeeAcionamento,
}) => {
  const isSitesActive = activeTab === 'sites';
  const isEngenhariaActive = activeTab === 'engenharia' || activeTab === 'vistoria';
  const isDuplasActive = activeTab === 'duplas';
  const isExecutoresActive = activeTab === 'executores';
  const isClaroActive = activeVendor === 'CLARO_TIM';
  const isVivoActive = activeVendor === 'ERICSSON_VIVO';

  return (
    <aside
      className={`hidden md:flex h-screen sticky top-0 bg-[#0B1530] border-r border-white/10 flex-col z-40 transition-all duration-200 ease-out select-none shrink-0 ${
        collapsed ? 'w-[72px]' : 'w-60'
      }`}
    >
      {/* Top Header with Preserved Ameta Logo */}
      <div
        className={`flex items-center border-b border-white/10 transition-all duration-200 ${
          collapsed
            ? 'justify-center py-4 px-2'
            : 'justify-between py-3.5 px-4'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelectTab('sites')}
          className="cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E8E8D] rounded-[8px] flex items-center transition-opacity hover:opacity-90"
          title="Ameta Telecom"
        >
          <AmetaLogo size="sm" theme="dark" iconOnly={collapsed} />
        </button>
      </div>

      {/* Navigation Section */}
      <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-1">
        {!collapsed && (
          <div className="text-[10px] font-semibold text-slate-400/80 tracking-[0.08em] uppercase px-3 pb-2">
            Navegação
          </div>
        )}

        {/* 1. Sites (Planilhas) */}
        {canSeeSitesTab && (
          <button
            type="button"
            onClick={() => onSelectTab('sites')}
            title={collapsed ? `Sites (Planilhas) (${sitesCount})` : undefined}
            className={`w-full flex items-center transition-all duration-150 cursor-pointer rounded-[8px] group relative ${
              collapsed
                ? 'justify-center p-2.5'
                : 'justify-between px-3 py-2 text-[13px] font-medium'
            } ${
              isSitesActive
                ? 'bg-white/10 text-white font-semibold'
                : 'text-slate-300/80 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            {isSitesActive && !collapsed && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[#2DD4BF]"
              />
            )}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0 flex items-center justify-center w-5 h-5">
                <FolderKanban
                  className={`w-4 h-4 transition-colors duration-150 ${
                    isSitesActive ? 'text-[#2DD4BF]' : 'text-slate-400 group-hover:text-white'
                  }`}
                />
              </div>
              {!collapsed && (
                <span className="truncate">{isVivoActive ? 'Atividades Vivo' : 'Sites (Planilhas)'}</span>
              )}
            </div>

            {!collapsed && (
              <div className="flex items-center gap-1 shrink-0 ml-1.5">
                {(!isVivoActive || sitesCount > 0) && (
                  <span
                    className={`text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-[6px] font-semibold ${
                      isSitesActive
                        ? 'bg-white/15 text-white'
                        : 'text-slate-300/80 bg-white/[0.06]'
                    }`}
                  >
                    {sitesCount}
                  </span>
                )}
                {novosSitesCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold rounded-[6px] tabular-nums">
                    +{novosSitesCount}
                  </span>
                )}
              </div>
            )}
          </button>
        )}

        {/* 2. Engenharia (oculto quando Ericsson Vivo está ativo) */}
        {canSeeEngenhariaTab && !isVivoActive && (
          <button
            type="button"
            onClick={() => onSelectTab('engenharia')}
            title={collapsed ? `Engenharia (${engenhariaCount})` : undefined}
            className={`w-full flex items-center transition-all duration-150 cursor-pointer rounded-[8px] group relative ${
              collapsed
                ? 'justify-center p-2.5'
                : 'justify-between px-3 py-2 text-[13px] font-medium'
            } ${
              isEngenhariaActive
                ? 'bg-white/10 text-white font-semibold'
                : 'text-slate-300/80 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            {isEngenhariaActive && !collapsed && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[#2DD4BF]"
              />
            )}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0 flex items-center justify-center w-5 h-5">
                <FileSpreadsheet
                  className={`w-4 h-4 transition-colors duration-150 ${
                    isEngenhariaActive ? 'text-[#2DD4BF]' : 'text-slate-400 group-hover:text-white'
                  }`}
                />
              </div>
              {!collapsed && (
                <span className="truncate">Engenharia</span>
              )}
            </div>

            {!collapsed && (
              <span
                className={`text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-[6px] font-semibold shrink-0 ml-1.5 ${
                  isEngenhariaActive
                    ? 'bg-white/15 text-white'
                    : 'text-slate-300/80 bg-white/[0.06]'
                }`}
              >
                {engenhariaCount}
              </span>
            )}
          </button>
        )}

        {!collapsed && ((!isVivoActive && (canSeeDuplasTab || canAccessDemandaExecutores)) || canSeeAcionamento) && (
          <div className="text-[10px] font-semibold text-slate-400/80 tracking-[0.08em] uppercase px-3 pt-4 pb-1.5">
            Operação & Campo
          </div>
        )}

        {/* 3. Duplas & Demanda */}
        {canSeeDuplasTab && !isVivoActive && (
          <button
            type="button"
            onClick={() => onSelectTab('duplas')}
            title={collapsed ? `Duplas & Demanda (${duplasCount})` : undefined}
            className={`w-full flex items-center transition-all duration-150 rounded-[8px] group relative cursor-pointer ${
              collapsed
                ? 'justify-center p-2.5'
                : 'justify-between px-3 py-2 text-[13px] font-medium'
            } ${
              isDuplasActive
                ? 'bg-white/10 text-white font-semibold'
                : 'text-slate-300/80 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            {isDuplasActive && !collapsed && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[#2DD4BF]"
              />
            )}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0 flex items-center justify-center w-5 h-5">
                <Users
                  className={`w-4 h-4 transition-colors duration-150 ${
                    isDuplasActive ? 'text-[#2DD4BF]' : 'text-slate-400 group-hover:text-white'
                  }`}
                />
              </div>
              {!collapsed && (
                <span className="truncate">Duplas & Demanda</span>
              )}
            </div>

            {!collapsed && (
              <span
                className={`text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-[6px] font-semibold shrink-0 ml-1.5 ${
                  isDuplasActive
                    ? 'bg-white/15 text-white'
                    : 'text-slate-300/80 bg-white/[0.06]'
                }`}
              >
                {duplasCount}
              </span>
            )}
          </button>
        )}

        {/* 4. Demandar Executores (Desativado se CLARO ou VIVO) */}
        {canAccessDemandaExecutores && !isVivoActive && (
          <button
            type="button"
            disabled={isClaroActive}
            onClick={() => !isClaroActive && onSelectTab('executores')}
            title={isClaroActive ? 'Demandar Executores (Indisponível na Claro — em construção)' : (collapsed ? `Demandar Executores (${executoresCount})` : undefined)}
            className={`w-full flex items-center transition-all duration-150 rounded-[8px] group relative ${
              isClaroActive
                ? 'opacity-40 cursor-not-allowed pointer-events-none'
                : 'cursor-pointer'
            } ${
              collapsed
                ? 'justify-center p-2.5'
                : 'justify-between px-3 py-2 text-[13px] font-medium'
            } ${
              isExecutoresActive && !isClaroActive
                ? 'bg-white/10 text-white font-semibold'
                : 'text-slate-300/80 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            {isExecutoresActive && !isClaroActive && !collapsed && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-amber-400"
              />
            )}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0 flex items-center justify-center w-5 h-5">
                <HardHat
                  className={`w-4 h-4 transition-colors duration-150 ${
                    isExecutoresActive && !isClaroActive ? 'text-amber-400' : 'text-slate-400 group-hover:text-white'
                  }`}
                />
              </div>
              {!collapsed && (
                <span className="truncate">Demandar Executores</span>
              )}
            </div>

            {!collapsed && (
              <span
                className={`text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-[6px] font-semibold shrink-0 ml-1.5 ${
                  isExecutoresActive && !isClaroActive
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-slate-300/80 bg-white/[0.06]'
                }`}
              >
                {executoresCount}
              </span>
            )}
          </button>
        )}

        {/* 5. Acionamento */}
        {canSeeAcionamento && (
          <a
            href={ACIONAMENTO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={collapsed ? 'Acionamento' : undefined}
            className={`w-full flex items-center transition-all duration-150 cursor-pointer rounded-[8px] group relative text-slate-300/80 hover:text-white hover:bg-white/[0.06] ${
              collapsed
                ? 'justify-center p-2.5'
                : 'justify-between px-3 py-2 text-[13px] font-medium'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0 flex items-center justify-center w-5 h-5">
                <Wrench className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors duration-150" />
              </div>
              {!collapsed && (
                <span className="truncate">Acionamento</span>
              )}
            </div>

            {!collapsed && (
              <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-white shrink-0 ml-1.5 transition-colors duration-150" />
            )}
          </a>
        )}
      </div>

      {/* Bottom Toggle Collapse/Expand Button */}
      <div className="px-3 py-3 border-t border-white/10 flex items-center justify-center bg-[#091229]">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
          className={`h-8 rounded-[8px] bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-slate-300 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer transition-all duration-150 active:scale-[0.98] ${
            collapsed ? 'w-10' : 'w-full px-3 text-xs font-medium'
          }`}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Recolher menu</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
});

AmetaSidebar.displayName = 'AmetaSidebar';
