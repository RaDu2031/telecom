import React from 'react';
import {
  FolderKanban,
  FileSpreadsheet,
  Users,
  HardHat,
  ChevronLeft,
  ChevronRight,
  Radio,
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
}

export const AmetaSidebar: React.FC<AmetaSidebarProps> = React.memo(({
  collapsed,
  onToggleCollapse,
  activeTab,
  onSelectTab,
  activeVendor,
  onSelectVendor,
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

  return (
    <aside
      className={`h-screen sticky top-0 bg-[#0B1327] border-r border-slate-800/80 flex flex-col z-40 transition-all duration-300 ease-in-out select-none shrink-0 ${
        collapsed ? 'w-[72px]' : 'w-64'
      }`}
    >
      {/* Top Header with Ameta Logo */}
      <div
        className={`flex items-center border-b border-slate-800/80 transition-all ${
          collapsed
            ? 'justify-center py-4 px-2'
            : 'justify-between py-3.5 px-4'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelectTab('sites')}
          className="cursor-pointer focus:outline-none flex items-center"
          title="Ameta Telecom"
        >
          <AmetaLogo size="sm" theme="dark" iconOnly={collapsed} />
        </button>
      </div>

      {/* Navigation Section */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1">
        {!collapsed && (
          <div className="text-[11px] font-semibold text-slate-400 tracking-wider uppercase px-2.5 pt-1 pb-2">
            Navegação
          </div>
        )}

        {/* 1. Sites (Planilhas) */}
        {canSeeSitesTab && (
          <button
            type="button"
            onClick={() => onSelectTab('sites')}
            title={collapsed ? `Sites (Planilhas) (${sitesCount})` : undefined}
            className={`w-full flex items-center transition-all cursor-pointer rounded-xl group relative ${
              collapsed
                ? 'justify-center p-3'
                : 'justify-between px-3 py-2.5 text-xs font-medium'
            } ${
              isSitesActive
                ? 'bg-[#162746] text-white font-bold border border-blue-900/60 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <FolderKanban
                  className={`w-4 h-4 transition-colors ${
                    isSitesActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />
                {collapsed && novosSitesCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-[#0B1327]" />
                )}
                {collapsed && sitesCount > 0 && novosSitesCount === 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full border border-[#0B1327]" />
                )}
              </div>
              {!collapsed && (
                <span className="truncate">Sites (Planilhas)</span>
              )}
            </div>

            {!collapsed && (
              <div className="flex items-center gap-1 shrink-0 ml-1.5">
                <span
                  className={`text-[11px] font-mono tabular-nums px-2 py-0.5 rounded-full font-bold ${
                    isSitesActive
                      ? 'bg-blue-950/80 text-blue-300 border border-blue-800/60'
                      : 'text-slate-400 bg-slate-800/50'
                  }`}
                >
                  ({sitesCount})
                </span>
                {novosSitesCount > 0 && (
                  <span className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold rounded-full tabular-nums">
                    +{novosSitesCount}
                  </span>
                )}
              </div>
            )}
          </button>
        )}

        {/* 2. Engenharia */}
        {canSeeEngenhariaTab && (
          <button
            type="button"
            onClick={() => onSelectTab('engenharia')}
            title={collapsed ? `Engenharia (${engenhariaCount})` : undefined}
            className={`w-full flex items-center transition-all cursor-pointer rounded-xl group relative ${
              collapsed
                ? 'justify-center p-3'
                : 'justify-between px-3 py-2.5 text-xs font-medium'
            } ${
              isEngenhariaActive
                ? 'bg-[#162746] text-white font-bold border border-blue-900/60 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <FileSpreadsheet
                  className={`w-4 h-4 transition-colors ${
                    isEngenhariaActive ? 'text-teal-400' : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />
                {collapsed && engenhariaCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-teal-500 rounded-full border border-[#0B1327]" />
                )}
              </div>
              {!collapsed && (
                <span className="truncate">Engenharia</span>
              )}
            </div>

            {!collapsed && (
              <span
                className={`text-[11px] font-mono tabular-nums px-2 py-0.5 rounded-full font-bold shrink-0 ml-1.5 ${
                  isEngenhariaActive
                    ? 'bg-teal-950/80 text-teal-300 border border-teal-800/60'
                    : 'text-slate-400 bg-slate-800/50'
                }`}
              >
                ({engenhariaCount})
              </span>
            )}
          </button>
        )}

        {/* 3. Duplas & Demanda */}
        {canSeeDuplasTab && (
          <button
            type="button"
            onClick={() => onSelectTab('duplas')}
            title={collapsed ? `Duplas & Demanda (${duplasCount})` : undefined}
            className={`w-full flex items-center transition-all cursor-pointer rounded-xl group relative ${
              collapsed
                ? 'justify-center p-3'
                : 'justify-between px-3 py-2.5 text-xs font-medium'
            } ${
              isDuplasActive
                ? 'bg-[#162746] text-white font-bold border border-blue-900/60 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <Users
                  className={`w-4 h-4 transition-colors ${
                    isDuplasActive ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />
                {collapsed && duplasCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-indigo-500 rounded-full border border-[#0B1327]" />
                )}
              </div>
              {!collapsed && (
                <span className="truncate">Duplas & Demanda</span>
              )}
            </div>

            {!collapsed && (
              <span
                className={`text-[11px] font-mono tabular-nums px-2 py-0.5 rounded-full font-bold shrink-0 ml-1.5 ${
                  isDuplasActive
                    ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-800/60'
                    : 'text-slate-400 bg-slate-800/50'
                }`}
              >
                ({duplasCount})
              </span>
            )}
          </button>
        )}

        {/* 4. Demandar Executores */}
        {canAccessDemandaExecutores && (
          <button
            type="button"
            onClick={() => onSelectTab('executores')}
            title={collapsed ? `Demandar Executores (${executoresCount})` : undefined}
            className={`w-full flex items-center transition-all cursor-pointer rounded-xl group relative ${
              collapsed
                ? 'justify-center p-3'
                : 'justify-between px-3 py-2.5 text-xs font-medium'
            } ${
              isExecutoresActive
                ? 'bg-[#162746] text-white font-bold border border-amber-600/70 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <HardHat
                  className={`w-4 h-4 transition-colors ${
                    isExecutoresActive ? 'text-amber-400' : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />
                {/* Yellow dot like in image_9d4deadc.png */}
                {collapsed && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full border-2 border-[#0B1327]" />
                )}
              </div>
              {!collapsed && (
                <span className="truncate">Demandar Executores</span>
              )}
            </div>

            {!collapsed && (
              <span
                className={`text-[11px] font-mono tabular-nums px-2 py-0.5 rounded-full font-bold shrink-0 ml-1.5 ${
                  isExecutoresActive
                    ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                    : 'text-slate-400 bg-slate-800/50'
                }`}
              >
                ({executoresCount})
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
            className={`w-full flex items-center transition-all cursor-pointer rounded-xl group relative text-slate-300 hover:text-white hover:bg-slate-800/60 ${
              collapsed
                ? 'justify-center p-3'
                : 'justify-between px-3 py-2.5 text-xs font-medium'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <Wrench className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
              </div>
              {!collapsed && (
                <span className="truncate">Acionamento</span>
              )}
            </div>

            {!collapsed && (
              <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 shrink-0 ml-1.5 transition-colors" />
            )}
          </a>
        )}
      </div>

      {/* Bottom Vendor Quick Switcher (when expanded) */}
      {!collapsed && (
        <div className="px-3 py-2.5 border-t border-slate-800/80 bg-slate-900/40">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Radio className="w-3 h-3 text-blue-400" />
            <span>Operadora / Rede</span>
          </div>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950/70 rounded-lg border border-slate-800 text-[10px] font-bold text-center">
            <button
              type="button"
              onClick={() => onSelectVendor('NOKIA')}
              className={`py-1 rounded cursor-pointer transition-colors ${
                activeVendor === 'NOKIA'
                  ? 'bg-[#223585] text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              TIM
            </button>
            <button
              type="button"
              onClick={() => onSelectVendor('ERICSSON')}
              className={`py-1 rounded cursor-pointer transition-colors ${
                activeVendor === 'ERICSSON'
                  ? 'bg-[#1E8E8D] text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ERICSSON
            </button>
            <button
              type="button"
              onClick={() => onSelectVendor('CLARO_TIM')}
              className={`py-1 rounded cursor-pointer transition-colors relative flex items-center justify-center gap-0.5 ${
                activeVendor === 'CLARO_TIM'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-amber-400 hover:text-amber-300'
              }`}
              title="Claro / TIM (Em manutenção)"
            >
              <span>CLARO</span>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom Toggle Collapse/Expand Button (Exact replication of circular blue button with < / > in image_822743dc.png and image_9d4deadc.png) */}
      <div className="p-3 border-t border-slate-800/80 flex items-center justify-center">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
          className="w-10 h-10 rounded-full bg-[#54A5D5] hover:bg-[#4396C7] active:scale-95 text-slate-950 shadow-md flex items-center justify-center cursor-pointer transition-transform"
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5 text-slate-950 stroke-[2.5]" />
          ) : (
            <ChevronLeft className="w-5 h-5 text-slate-950 stroke-[2.5]" />
          )}
        </button>
      </div>
    </aside>
  );
});

AmetaSidebar.displayName = 'AmetaSidebar';
