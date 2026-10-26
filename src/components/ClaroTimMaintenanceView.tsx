import React from 'react';
import { Wrench, Radio, Clock, ShieldCheck, ArrowRight, Sparkles, AlertCircle } from 'lucide-react';
import { VendorType } from '../types/telecom';

interface ClaroTimMaintenanceViewProps {
  onSwitchVendor: (vendor: VendorType) => void;
}

export const ClaroTimMaintenanceView: React.FC<ClaroTimMaintenanceViewProps> = ({
  onSwitchVendor,
}) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 min-h-[600px] bg-gradient-to-b from-slate-50 to-slate-100/70 text-slate-800">
      <div className="max-w-xl w-full bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 text-center">
        {/* Top Badges & Animated Icon */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-inner">
              <Radio className="w-8 h-8 animate-pulse" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-500 border-2 border-white flex items-center justify-center text-white">
              <Wrench className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            <span>Módulo em Manutenção</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Plataforma Claro / TIM
          </h2>

          <p className="text-sm text-slate-600 leading-relaxed max-w-md">
            A integração da plataforma <strong>Claro / TIM</strong> está sendo estruturada e encontra-se temporariamente em manutenção técnica.
          </p>
        </div>

        {/* Informative Roadmap Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>Sincronização</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Conexão com os repositórios e planilhas oficiais Claro/TIM.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>Rotas & Vistorias</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Despacho de acionamentos e relatórios de campo.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <Sparkles className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <span>Em Breve</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Liberação para toda a equipe técnica e coordenadores.
            </p>
          </div>
        </div>

        {/* Warning note */}
        <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl flex items-start gap-2.5 text-left text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>
            Nenhuma planilha ou dado de campo será impactado durante a manutenção. Para continuar operando, selecione <strong>TIM / Nokia</strong> ou <strong>Ericsson</strong>.
          </span>
        </div>

        {/* Quick Actions to Switch Back */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onSwitchVendor('NOKIA')}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#223585] hover:bg-[#1b2b6d] text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <span>Ir para TIM / NOKIA</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onSwitchVendor('ERICSSON')}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#1E8E8D] hover:bg-[#177776] text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <span>Ir para ERICSSON</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
