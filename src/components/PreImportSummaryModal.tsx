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
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/45 p-4 ameta-modal-backdrop"
    >
      <div className="bg-white rounded-[12px] shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] ameta-modal-panel">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 text-slate-900 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#223585]/10 border border-[#223585]/20 rounded-[8px]">
              <FileSpreadsheet className="w-5 h-5 text-[#223585]" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight text-slate-900">{title}</h3>
              <p className="text-xs text-slate-500 truncate max-w-xs sm:max-w-sm mt-0.5">
                {fileName} · Destino: <strong className="text-slate-800">{sheetName || 'Controle Geral'}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto bg-white">
          {/* Aba de destino highlight */}
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-[10px] flex items-center justify-between text-xs text-slate-600">
            <span className="font-medium">Destino:</span>
            <span className="font-mono font-bold text-[#223585] bg-[#223585]/10 border border-[#223585]/20 px-2.5 py-0.5 rounded-md">
              {sheetName || 'Controle Geral'}
            </span>
          </div>

          {/* Multi-sheet selector when workbook has multiple sheets */}
          {availableSheets.length > 1 && onSelectSheetName && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-[10px] space-y-1.5">
              <div className="text-[11px] font-bold text-slate-700">
                Abas encontradas no arquivo (escolha a aba para importar):
              </div>
              <div className="flex flex-wrap gap-1.5">
                {availableSheets.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => onSelectSheetName(s.name)}
                    className={`px-2.5 py-1 rounded-[8px] text-xs font-bold transition-colors cursor-pointer ${
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
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-[10px] flex items-start gap-3 text-amber-900">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-amber-900 text-sm">
                  Arquivo já importado anteriormente
                </h4>
                <p className="text-xs text-amber-800 mt-1 font-medium leading-relaxed">
                  Este arquivo já foi importado em <strong>{previousImportDate || 'data anterior'}</strong>.
                  Importar de novo vai adicionar as linhas novamente.
                </p>
              </div>
            </div>
          )}

          {/* Resumo Stats Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-[10px] p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Resumo da Leitura
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              {/* Linhas Lidas */}
              <div className="p-3 bg-white rounded-[8px] border border-slate-200 shadow-2xs">
                <div className="text-xs text-slate-500 font-medium">Linhas encontradas</div>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">{linhasLidas}</div>
              </div>

              {/* Serão Adicionadas */}
              <div className="p-3 bg-emerald-50 rounded-[8px] border border-emerald-200 shadow-2xs">
                <div className="text-xs text-emerald-700 font-medium">Serão adicionadas</div>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1">+{linhasAdicionadas}</div>
              </div>

              {/* Ignoradas */}
              <div className="p-3 bg-white rounded-[8px] border border-slate-200 shadow-2xs">
                <div className="text-xs text-slate-500 font-medium">Ignoradas</div>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-700 mt-1">{linhasIgnoradas}</div>
              </div>
            </div>

            {typeof uniqueSitesCount === 'number' && typeof repeatedSitesCount === 'number' && (
              <div className="grid grid-cols-2 gap-3 text-center mt-2.5">
                <div className="p-2.5 bg-blue-50 rounded-[8px] border border-blue-200 shadow-2xs">
                  <div className="text-[11px] text-blue-700 font-medium">Sites únicos (SITE ID)</div>
                  <div className="text-base font-bold font-mono tabular-nums text-blue-800 mt-0.5">{uniqueSitesCount}</div>
                </div>
                <div className="p-2.5 bg-amber-50 rounded-[8px] border border-amber-200 shadow-2xs">
                  <div className="text-[11px] text-amber-800 font-medium">Linhas de sites repetidos (independentes)</div>
                  <div className="text-base font-bold font-mono tabular-nums text-amber-900 mt-0.5">{repeatedSitesCount}</div>
                </div>
              </div>
            )}

            {/* Formula verification */}
            <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600 gap-2">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                Linhas lidas: {linhasLidas}; serão adicionadas: {linhasAdicionadas}; ignoradas {motivoIgnoradas}: {linhasIgnoradas}
              </span>
              <span className="font-mono text-[11px] font-semibold text-slate-500 shrink-0">
                ({linhasLidas} = {linhasAdicionadas} + {linhasIgnoradas})
              </span>
            </div>
          </div>

          {/* Detected Columns Preview */}
          {detectedColumns.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-[10px] p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 uppercase tracking-wider">
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
          <div className="p-3.5 bg-teal-50 border border-teal-200 rounded-[10px] flex items-start gap-2.5 text-teal-900">
            <ShieldCheck className="w-5 h-5 text-[#1E8E8D] shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <strong className="text-[#1E8E8D]">Regra de Proteção de Dados:</strong> O sistema nunca apaga, substitui ou
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
            className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-[8px] transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving || linhasAdicionadas === 0}
            className="px-5 py-2 text-sm font-bold text-white bg-[#223585] hover:bg-[#1B2A6B] rounded-[8px] transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
