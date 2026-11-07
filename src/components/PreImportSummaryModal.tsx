import React from 'react';
import {
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Upload,
  RefreshCw,
  X,
  ShieldCheck,
} from 'lucide-react';

export interface PreImportSummaryModalProps {
  isOpen: boolean;
  title: string;
  fileName: string;
  sheetName?: string;
  linhasLidas: number;
  linhasAdicionadas: number;
  linhasIgnoradas: number;
  motivoIgnoradas?: string;
  uniqueSitesCount?: number;
  repeatedSitesCount?: number;
  isPreviouslyImported: boolean;
  previousImportDate?: string;
  isSaving?: boolean;
  detectedColumns?: string[];
  availableSheets?: Array<{ name: string; count: number }>;
  selectedSheetName?: string;
  onSelectSheetName?: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export const PreImportSummaryModal: React.FC<PreImportSummaryModalProps> = ({
  isOpen,
  title,
  fileName,
  sheetName,
  linhasLidas,
  linhasAdicionadas,
  linhasIgnoradas,
  motivoIgnoradas = 'por estarem vazias',
  uniqueSitesCount,
  repeatedSitesCount,
  isPreviouslyImported,
  previousImportDate,
  isSaving = false,
  detectedColumns = [],
  availableSheets = [],
  selectedSheetName,
  onSelectSheetName,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-[#223585] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-lg">
              <FileSpreadsheet className="w-5 h-5 text-teal-300" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight">{title}</h3>
              <p className="text-xs text-slate-300 truncate max-w-xs sm:max-w-sm mt-0.5">
                {fileName} · Destino: <strong className="text-white">{sheetName || 'Controle Geral'}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Aba de destino highlight */}
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs text-slate-700">
            <span className="font-medium">Destino:</span>
            <span className="font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 px-2.5 py-0.5 rounded-md">
              {sheetName || 'Controle Geral'}
            </span>
          </div>

          {/* Multi-sheet selector when workbook has multiple sheets */}
          {availableSheets.length > 1 && onSelectSheetName && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
              <div className="text-[11px] font-bold text-slate-600">
                Abas encontradas no arquivo (escolha a aba para importar):
              </div>
              <div className="flex flex-wrap gap-1.5">
                {availableSheets.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => onSelectSheetName(s.name)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      selectedSheetName === s.name
                        ? 'bg-[#223585] text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {s.name} ({s.count} linhas)
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Warning Banner if previously imported */}
          {isPreviouslyImported && (
            <div className="p-4 bg-amber-500/10 border-2 border-amber-500/30 rounded-xl flex items-start gap-3 text-amber-950">
              <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-amber-950 text-sm">
                  Arquivo já importado anteriormente
                </h4>
                <p className="text-xs text-amber-900 mt-1 font-medium leading-relaxed">
                  Este arquivo já foi importado em <strong>{previousImportDate || 'data anterior'}</strong>.
                  Importar de novo vai adicionar as linhas novamente.
                </p>
              </div>
            </div>
          )}

          {/* Resumo Stats Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Resumo da Leitura
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              {/* Linhas Lidas */}
              <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs">
                <div className="text-xs text-slate-500 font-medium">Linhas encontradas</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{linhasLidas}</div>
              </div>

              {/* Serão Adicionadas */}
              <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 shadow-xs">
                <div className="text-xs text-emerald-700 font-medium">Serão adicionadas</div>
                <div className="text-xl font-bold text-emerald-700 mt-1">+{linhasAdicionadas}</div>
              </div>

              {/* Ignoradas */}
              <div className="p-3 bg-slate-100 rounded-lg border border-slate-200 shadow-xs">
                <div className="text-xs text-slate-600 font-medium">Ignoradas</div>
                <div className="text-xl font-bold text-slate-700 mt-1">{linhasIgnoradas}</div>
              </div>
            </div>

            {typeof uniqueSitesCount === 'number' && typeof repeatedSitesCount === 'number' && (
              <div className="grid grid-cols-2 gap-3 text-center mt-2.5">
                <div className="p-2.5 bg-blue-50 rounded-lg border border-blue-200 shadow-xs">
                  <div className="text-[11px] text-blue-700 font-medium">Sites únicos (SITE ID)</div>
                  <div className="text-base font-bold text-blue-900 mt-0.5">{uniqueSitesCount}</div>
                </div>
                <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 shadow-xs">
                  <div className="text-[11px] text-amber-800 font-medium">Linhas de sites repetidos (independentes)</div>
                  <div className="text-base font-bold text-amber-900 mt-0.5">{repeatedSitesCount}</div>
                </div>
              </div>
            )}

            {/* Formula verification */}
            <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                Linhas lidas: {linhasLidas}; serão adicionadas: {linhasAdicionadas}; ignoradas {motivoIgnoradas}: {linhasIgnoradas}
              </span>
              <span className="font-mono text-[11px] font-semibold text-slate-500">
                ({linhasLidas} = {linhasAdicionadas} + {linhasIgnoradas})
              </span>
            </div>
          </div>

          {/* Detected Columns Preview */}
          {detectedColumns.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-600 uppercase tracking-wider">
                  Colunas Identificadas ({detectedColumns.length})
                </span>
                <span className="text-[11px] text-slate-500">Ordem preservada</span>
              </div>
              <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto pr-1">
                {detectedColumns.map((col, idx) => (
                  <span
                    key={`${col}_${idx}`}
                    className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] font-mono text-slate-700"
                  >
                    {idx + 1}. {col}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Rules Confirmation Box */}
          <div className="p-3.5 bg-teal-50 border border-teal-200 rounded-xl flex items-start gap-2.5 text-teal-900">
            <ShieldCheck className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <strong>Regra de Proteção de Dados:</strong> O sistema nunca apaga, substitui ou
              modifica registros existentes. Somente acrescenta novos registros. Textos das células
              são gravados exatamente como estão na planilha.
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving || linhasAdicionadas === 0}
            className="px-5 py-2 text-sm font-bold text-white bg-[#223585] hover:bg-[#1a2968] active:bg-[#131f4f] rounded-lg transition-all shadow-sm hover:shadow flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Gravando no Firestore...</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>Confirmar e Gravar ({linhasAdicionadas})</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
