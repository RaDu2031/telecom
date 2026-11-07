import React from 'react';
import { FileSpreadsheet, FolderKanban } from 'lucide-react';
import { AmetaUser, UserRole, VendorType, ClaroSiteRow, ClaroEngenhariaRow, ClaroSheetMeta } from '../types/telecom';

export interface ClaroTimMaintenanceViewProps {
  activeArea?: 'sites' | 'engenharia';
  onSelectArea?: (area: 'sites' | 'engenharia') => void;
  user?: (AmetaUser & { linkedTeams?: string[] }) | null;
  effectiveRole?: UserRole;
  claroSites?: ClaroSiteRow[];
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
    <div className="bg-white border border-slate-200 rounded-2xl p-10 sm:p-14 text-center shadow-xs max-w-2xl mx-auto my-6 space-y-4">
      <div className="w-14 h-14 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center mx-auto text-[#1E8E8D]">
        <FileSpreadsheet className="w-7 h-7" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
          Planilha de Engenharia da Claro em breve
        </h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          A área de Sites (Vistoria) da Claro já está ativa e disponível na aba Sites.
        </p>
      </div>
      {canSeeSites && onSelectArea && (
        <div className="pt-2 flex items-center justify-center">
          <button
            type="button"
            onClick={() => onSelectArea('sites')}
            className="px-4 py-2 rounded-xl bg-[#223585] hover:bg-[#1a2968] text-white font-bold text-xs inline-flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <FolderKanban className="w-4 h-4" />
            <span>Ir para Claro – Sites (Controle Geral)</span>
          </button>
        </div>
      )}
    </div>
  );
};
