import React from 'react';
import { FileSpreadsheet, FolderKanban } from 'lucide-react';
import { AmetaUser, UserRole, VendorType, TelecomSite, ClaroSiteRow, ClaroEngenhariaRow, ClaroSheetMeta } from '../types/telecom';

export interface ClaroTimMaintenanceViewProps {
  activeArea?: 'sites' | 'engenharia';
  onSelectArea?: (area: 'sites' | 'engenharia') => void;
  user?: (AmetaUser & { linkedTeams?: string[] }) | null;
  effectiveRole?: UserRole;
  claroSites?: (ClaroSiteRow | TelecomSite)[];
  claroEngenharia?: ClaroEngenhariaRow[];
  claroMeta?: { sites?: ClaroSheetMeta; engenharia?: ClaroSheetMeta };
  onShowToast?: (msg: string) => void;
  onSwitchVendor?: (vendor: VendorType) => void;
}

export const ClaroTimMaintenanceView: React.FC<ClaroTimMaintenanceViewProps> = ({
  onSelectArea,
  effectiveRole = 'ADM',
}) => {
  const canSeeSites = effectiveRole !== 'Executor';

  return (
    <div className="bg-white border border-slate-200 rounded-[12px] p-10 sm:p-14 text-center max-w-2xl mx-auto my-6 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="w-12 h-12 rounded-[12px] bg-[#223585]/10 border border-[#223585]/20 flex items-center justify-center mx-auto text-[#223585]">
        <FileSpreadsheet className="w-6 h-6" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-lg font-bold text-slate-900 tracking-tight">
          Planilha de Engenharia da Claro em breve
        </h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
          A área de Sites (Vistoria) da Claro já está ativa e disponível na aba Sites.
        </p>
      </div>
      {canSeeSites && onSelectArea && (
        <div className="pt-2 flex items-center justify-center">
          <button
            type="button"
            onClick={() => onSelectArea('sites')}
            className="px-4 py-2 rounded-[8px] bg-[#223585] hover:bg-[#1B2A6B] text-white font-semibold text-xs inline-flex items-center gap-2 transition-colors cursor-pointer shadow-xs"
          >
            <FolderKanban className="w-4 h-4" />
            <span>Ir para Claro – Sites (Controle Geral)</span>
          </button>
        </div>
      )}
    </div>
  );
};
