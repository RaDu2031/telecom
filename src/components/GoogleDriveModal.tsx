import React, { useState } from 'react';
import {
  X,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  Database,
  HardDrive,
  Cloud,
  ShieldCheck,
} from 'lucide-react';
import { TssrRow, TssrSheetMeta, VendorType } from '../types/telecom';
import { exportTssrRowsToXlsx } from '../utils/tssrSpreadsheetUtils';

interface GoogleDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportTssr?: (
    rows: TssrRow[],
    sheets: TssrSheetMeta[],
    toastMsg: string
  ) => void;
  currentTssrRows?: TssrRow[];
  currentVendor?: VendorType;
}

export const GoogleDriveModal: React.FC<GoogleDriveModalProps> = ({
  isOpen,
  onClose,
  currentTssrRows = [],
}) => {
  const [syncing, setSyncing] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleForceFirebaseSync = async () => {
    setSyncing(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/sync/firebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Erro ao sincronizar com o Firebase.');
        return;
      }
      setSuccessMsg(`Sincronizado com sucesso na Nuvem Firebase em ${new Date().toLocaleTimeString('pt-BR')}!`);
    } catch {
      setErrorMsg('Falha de conexão ao sincronizar com o Firebase.');
    } finally {
      setSyncing(false);
    }
  };

  const handleExportCurrentTssr = () => {
    exportTssrRowsToXlsx(
      currentTssrRows,
      `TSSR_TIM_Nokia_Firebase_${new Date().toISOString().slice(0, 10)}.xlsx`,
      'TSSR TIM Nokia'
    );
    setSuccessMsg('Planilha exportada com sucesso em formato Excel (.XLSX)!');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-xs">
              <Cloud className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>Nuvem Firebase</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white/20 text-white border border-white/30">
                  100% Ativo
                </span>
              </h2>
              <p className="text-xs text-amber-100">
                Projeto: ameta-sistema-teste (Storage & Firestore Integrados)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-amber-200 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback Messages */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span className="flex-1">{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span className="flex-1 font-semibold">{successMsg}</span>
          </div>
        )}

        {/* Body Content */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <Database className="w-4 h-4 text-amber-600" />
                <span>Banco de Dados Firestore</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Todas as alterações em sites, usuários, permissões e planilhas TSSR/Ericsson são salvas e persistidas de forma redundante.
              </p>
              <div className="text-[10px] font-mono text-emerald-700 font-semibold pt-1 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> Sincronização em Tempo Real
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <HardDrive className="w-4 h-4 text-amber-600" />
                <span>Firebase Storage (Arquivos)</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Todos os pacotes .ZIP, WinRAR (.RAR) e relatórios de vistorias são mantidos com cópia de segurança na nuvem.
              </p>
              <div className="text-[10px] font-mono text-emerald-700 font-semibold pt-1 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> Downloads Protegidos
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <h4 className="text-xs font-bold text-amber-950">Sincronização Manual de Emergência</h4>
                <p className="text-[11px] text-amber-800">
                  Caso deseje forçar um backup completo de todos os dados agora para a Nuvem Firebase:
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleForceFirebaseSync}
              disabled={syncing}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Sincronizando com o Firebase...' : 'Sincronizar Banco e Arquivos Agora'}</span>
            </button>
          </div>

          {currentTssrRows.length > 0 && (
            <div className="pt-2 flex items-center justify-between border-t border-slate-100 text-xs">
              <span className="text-slate-600">
                Planilha atual em memória: <strong>{currentTssrRows.length} registros</strong>
              </span>
              <button
                type="button"
                onClick={handleExportCurrentTssr}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Exportar Excel (.XLSX)</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
