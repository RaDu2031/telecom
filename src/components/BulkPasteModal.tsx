import React, { useState, useRef, useMemo } from 'react';
import {
  X,
  ClipboardPaste,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Table,
  RefreshCw,
  PlusCircle,
  ShieldCheck,
  Check,
} from 'lucide-react';
import {
  TelecomSite,
  VendorType,
  SpreadsheetMeta,
  CONTROLE_GERAL_COLUMNS,
} from '../types/telecom';
import { PreImportSummaryModal } from './PreImportSummaryModal';
import { dataService } from '../services/dataService';
import { showToast } from '../utils/toast';
import {
  parseClipboardOrCsvText,
  parseExcelWorkbookFile,
  getExcelColumnLetter,
  getCellValueForColumn,
  detectarTipoPlanilha,
  getNomeTipoPlanilha,
  validarCompatibilidadePlanilha,
  SpreadsheetDestinationType,
  normalizeNokiaSitesSheetName,
} from '../utils/spreadsheetUtils';

interface BulkPasteModalProps {
  isOpen: boolean;
  inlineTabMode?: boolean;
  initialTab?: 'paste' | 'excel';
  activeVendor: VendorType;
  activeSheetName: string;
  sheets: SpreadsheetMeta[];
  initialPastedText?: string;
  existingSites?: TelecomSite[];
  isFixedDestination?: boolean;
  fixedDestinationTitle?: string;
  fixedDestinationVendor?: VendorType;
  fixedDestinationType?: SpreadsheetDestinationType;
  onClose: () => void;
  onBulkImport: (params: {
    sites: Partial<TelecomSite>[];
    vendor: VendorType;
    sheetName: string;
    mode: 'append_only';
    sourceFileName?: string;
    columns?: string[];
  }) => Promise<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    errorMessage?: string;
  } | void>;
}

export const BulkPasteModal: React.FC<BulkPasteModalProps> = ({
  isOpen,
  inlineTabMode = false,
  initialTab = 'excel',
  activeVendor,
  activeSheetName,
  sheets,
  initialPastedText = '',
  existingSites = [],
  isFixedDestination = false,
  fixedDestinationTitle = 'Nokia – Sites (Vistoria)',
  fixedDestinationVendor = 'NOKIA',
  fixedDestinationType = 'NOKIA_SITES',
  onClose,
  onBulkImport,
}) => {
  const [tab, setTab] = useState<'paste' | 'excel'>(initialTab === 'paste' ? 'paste' : 'excel');
  const [vendor, setVendor] = useState<VendorType>(activeVendor);
  const [targetSheet, setTargetSheet] = useState<string>(activeSheetName);
  const [customSheetName, setCustomSheetName] = useState<string>('');
  const [importMode, setImportMode] = useState<'append_only' | 'fill_empty'>('append_only');

  const [rawText, setRawText] = useState<string>(initialPastedText);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [excelSheetsMap, setExcelSheetsMap] = useState<Record<string, Partial<TelecomSite>[]>>({});
  const [excelColumnsMap, setExcelColumnsMap] = useState<Record<string, string[]>>({});
  const [selectedExcelTab, setSelectedExcelTab] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [progressInfo, setProgressInfo] = useState<{ current: number; total: number; lote: number; totalLotes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importSummaryResult, setImportSummaryResult] = useState<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    comErro: number;
    totalGravados: number;
    lotesExecutados: number;
    errorMessage?: string;
  } | null>(null);

  const [preImportModalOpen, setPreImportModalOpen] = useState(false);
  const [historyCheckResult, setHistoryCheckResult] = useState<{ isPreviouslyImported: boolean; lastImportedAt?: string }>({ isPreviouslyImported: false });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setVendor(activeVendor);
    setTargetSheet(activeSheetName);
  }, [activeVendor, activeSheetName]);

  React.useEffect(() => {
    if (initialTab === 'paste') {
      setTab('paste');
    }
  }, [initialTab]);

  React.useEffect(() => {
    if (initialPastedText) {
      setRawText(initialPastedText);
      setTab('paste');
    }
  }, [initialPastedText]);

  const isNokiaSites =
    (isFixedDestination &&
      (fixedDestinationType === 'NOKIA_SITES' ||
       fixedDestinationVendor === 'NOKIA' ||
       fixedDestinationTitle?.includes('Nokia') ||
       fixedDestinationTitle?.includes('Sites'))) ||
    (!isFixedDestination && vendor === 'NOKIA');

  const vendorSheets = sheets.filter((s) => s.vendor === vendor);
  const effectiveSheetName = isNokiaSites
    ? 'Controle Geral'
    : targetSheet === '__NEW__'
    ? customSheetName.trim() || selectedExcelTab || `Controle Geral`
    : targetSheet || `Controle Geral`;

  const parsedFromPaste =
    tab === 'paste' && rawText.trim()
      ? parseClipboardOrCsvText(rawText, vendor, effectiveSheetName)
      : { sites: [], detectedColumns: [] };

  const rawParsedSites: Partial<TelecomSite>[] =
    tab === 'paste'
      ? parsedFromPaste.sites
      : selectedExcelTab && excelSheetsMap[selectedExcelTab]
      ? excelSheetsMap[selectedExcelTab]
      : [];

  const destSheetName = isNokiaSites
    ? normalizeNokiaSitesSheetName(tab === 'paste' ? 'Controle Geral' : selectedExcelTab || 'Controle Geral')
    : isFixedDestination
    ? fixedDestinationTitle
    : tab === 'excel' && selectedExcelTab
    ? targetSheet === '__NEW__' && customSheetName.trim()
      ? customSheetName.trim()
      : selectedExcelTab
    : effectiveSheetName;

  const parsedSites: Partial<TelecomSite>[] = useMemo(() => {
    if (isNokiaSites) {
      return rawParsedSites.map((s) => ({
        ...s,
        sheetName: destSheetName,
      }));
    }
    return rawParsedSites;
  }, [rawParsedSites, isNokiaSites, destSheetName]);

  const detectedColumns: string[] =
    tab === 'paste'
      ? parsedFromPaste.detectedColumns
      : selectedExcelTab && excelColumnsMap[selectedExcelTab]
      ? excelColumnsMap[selectedExcelTab]
      : CONTROLE_GERAL_COLUMNS;

  // Pre-calculate preview summary: novas, já existiam, com erro
  const previewStats = useMemo(() => {
    const existingKeys = new Set(
      existingSites.map((s) => (s.siteId || s.id || '').toString().trim().toUpperCase()).filter(Boolean)
    );

    let novas = 0;
    let jaExistiam = 0;
    let comErro = 0;

    for (const s of parsedSites) {
      const key = (s.siteId || s.id || '').toString().trim().toUpperCase();
      if (!key) {
        comErro++;
      } else if (existingKeys.has(key)) {
        jaExistiam++;
      } else {
        novas++;
      }
    }

    return {
      total: parsedSites.length,
      novas,
      jaExistiam,
      comErro,
    };
  }, [parsedSites, existingSites]);

  if (!isOpen) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadedFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const targetType = isFixedDestination ? fixedDestinationType : (vendor === 'ERICSSON' ? 'ERICSSON_SITES' : 'NOKIA_SITES');
      const check = validarCompatibilidadePlanilha(buffer, targetType, file.name);
      if (isFixedDestination && check.shouldBlock) {
        setError(check.blockMessage || 'Planilha incompatível!');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      if (check.warningMessage) {
        showToast(check.warningMessage);
      }

      const { sheetNames, sheetsData, sheetsColumns } = await parseExcelWorkbookFile(file, isFixedDestination ? fixedDestinationVendor : vendor);
      if (sheetNames.length === 0) {
        setError('O arquivo selecionado não contém abas válidas ou está vazio.');
        return;
      }

      if (isNokiaSites) {
        // Regra 1: se o arquivo tiver abas chamadas exatamente "Controle Geral", "Controle Cancelados" ou "Equipes",
        // mantenha esse nome para cada aba; QUALQUER outro nome vira "Controle Geral". Não ofereça "nova aba".
        const normalizedSheetsData: Record<string, Partial<TelecomSite>[]> = {};
        const normalizedColumnsMap: Record<string, string[]> = {};

        for (const rawSheet of sheetNames) {
          const targetName = normalizeNokiaSitesSheetName(rawSheet);
          const rows = (sheetsData[rawSheet] || []).map((row) => ({
            ...row,
            sheetName: targetName,
          }));
          if (!normalizedSheetsData[targetName]) {
            normalizedSheetsData[targetName] = [];
            normalizedColumnsMap[targetName] = sheetsColumns[rawSheet] || CONTROLE_GERAL_COLUMNS;
          }
          normalizedSheetsData[targetName].push(...rows);
        }

        setExcelSheetsMap(normalizedSheetsData);
        setExcelColumnsMap(normalizedColumnsMap);

        const normalizedKeys = Object.keys(normalizedSheetsData);
        const preferred = normalizedKeys.includes('Controle Geral')
          ? 'Controle Geral'
          : normalizedKeys[0] || 'Controle Geral';
        setSelectedExcelTab(preferred);
        setTargetSheet(preferred);
        setCustomSheetName('');
      } else {
        setExcelSheetsMap(sheetsData);
        setExcelColumnsMap(sheetsColumns);
        const preferred = sheetNames.includes('Controle Geral') ? 'Controle Geral' : sheetNames[0];
        setSelectedExcelTab(preferred);
        if (vendorSheets.some((s) => s.name === preferred)) {
          setTargetSheet(preferred);
        } else {
          setTargetSheet('__NEW__');
          setCustomSheetName(preferred);
        }
      }
    } catch {
      setError('Erro ao ler arquivo Excel. Certifique-se de que é um arquivo .xlsx ou .csv válido.');
    }
  };

  const handleOpenPreImportSummary = async () => {
    if (parsedSites.length === 0) {
      setError('Selecione um arquivo Excel ou cole os dados (Ctrl+V) antes de importar.');
      return;
    }

    const targetType = isFixedDestination ? fixedDestinationType : (vendor === 'ERICSSON' ? 'ERICSSON_SITES' : 'NOKIA_SITES');
    const check = validarCompatibilidadePlanilha(detectedColumns, targetType, tab === 'excel' ? uploadedFileName : undefined);
    if (isFixedDestination && check.shouldBlock) {
      setError(check.blockMessage || 'Planilha incompatível!');
      return;
    }
    if (check.warningMessage) {
      showToast(check.warningMessage);
    }

    setError(null);
    const fileName = tab === 'excel' && uploadedFileName ? uploadedFileName : 'Colagem Direta Ctrl+V';
    try {
      const hist = await dataService.verificarHistoricoArquivo(fileName, targetType as any);
      setHistoryCheckResult(hist);
    } catch {
      setHistoryCheckResult({ isPreviouslyImported: false });
    }
    setPreImportModalOpen(true);
  };

  const handleConfirmImport = async () => {
    setPreImportModalOpen(false);
    setSubmitting(true);
    setError(null);
    setImportSummaryResult(null);

    try {
      const result = await onBulkImport({
        sites: parsedSites,
        vendor: isFixedDestination ? fixedDestinationVendor : vendor,
        sheetName: destSheetName,
        mode: 'append_only',
        sourceFileName: tab === 'excel' ? uploadedFileName : 'Colagem Direta Ctrl+V',
        columns: detectedColumns,
      });

      if (result) {
        setImportSummaryResult(result);
        if (result.errorMessage) {
          setError(result.errorMessage);
        }
      } else {
        setRawText('');
        onClose();
      }
    } catch (err: any) {
      setError(`Erro na importação: ${err?.message || String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={
        inlineTabMode
          ? 'w-full'
          : 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs overflow-y-auto'
      }
    >
      <div
        className={
          inlineTabMode
            ? 'w-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm'
            : 'w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[92vh]'
        }
      >
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-emerald-400" />
              <span>
                Importar Planilha ({isFixedDestination ? fixedDestinationVendor : vendor}) — Apenas Acrescentar Novos
              </span>
            </h2>
            <div className="flex items-center gap-2 mt-1">
              {isFixedDestination && (
                <span className="px-2.5 py-0.5 rounded-full bg-blue-900/80 border border-blue-500/50 text-blue-200 text-xs font-bold font-mono">
                  Destino: {fixedDestinationTitle}
                </span>
              )}
              <p className="text-xs text-slate-400">
                Toda importação nunca substitui nem apaga a base existente. Dados anteriores são 100% preservados.
              </p>
            </div>
          </div>
          {!inlineTabMode && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Tab Switcher: Only Excel and Ctrl+V */}
        <div className="flex border-b border-slate-800 bg-slate-950/70 px-6 pt-2 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setTab('excel');
              setError(null);
            }}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-lg transition-colors flex items-center gap-2 cursor-pointer ${
              tab === 'excel'
                ? 'bg-slate-900 text-emerald-400 border-t-2 border-emerald-500'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>1. Selecionar Arquivo Excel (.XLSX / .CSV)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTab('paste');
              setError(null);
            }}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-lg transition-colors flex items-center gap-2 cursor-pointer ${
              tab === 'paste'
                ? 'bg-slate-900 text-blue-400 border-t-2 border-blue-500'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <ClipboardPaste className="w-4 h-4" />
            <span>2. Colar Tabela (Ctrl+V)</span>
          </button>
        </div>

        {/* Feedback Messages */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-red-200 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="flex-1 font-mono">{error}</span>
          </div>
        )}

        {/* Post-Import Result Summary */}
        {importSummaryResult && (
          <div className="mx-6 mt-4 p-4 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-emerald-100 text-xs space-y-2 shrink-0">
            <div className="flex items-center gap-2 font-bold text-sm text-emerald-300">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>Resultado da Importação no Firestore:</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
              <div className="bg-slate-900/80 p-2 rounded border border-slate-700">
                <span className="text-slate-400 block text-[10px]">TOTAL ANALISADO</span>
                <strong className="text-white text-sm">{importSummaryResult.totalAnalisados}</strong>
              </div>
              <div className="bg-emerald-900/40 p-2 rounded border border-emerald-700">
                <span className="text-emerald-400 block text-[10px]">NOVAS GRAVADAS</span>
                <strong className="text-emerald-300 text-sm">+{importSummaryResult.novas}</strong>
              </div>
              <div className="bg-amber-900/40 p-2 rounded border border-amber-700">
                <span className="text-amber-400 block text-[10px]">JÁ EXISTIAM (MANTIDAS)</span>
                <strong className="text-amber-300 text-sm">{importSummaryResult.jaExistiam}</strong>
              </div>
              <div className="bg-slate-900/80 p-2 rounded border border-slate-700">
                <span className="text-slate-400 block text-[10px]">LOTES EXECUTADOS</span>
                <strong className="text-white text-sm">{importSummaryResult.lotesExecutados} (20 docs/lote)</strong>
              </div>
            </div>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-slate-300 text-xs">
          {tab === 'excel' && (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="p-8 border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-2xl bg-slate-950/50 hover:bg-slate-950 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-3"
              >
                <Upload className="w-8 h-8 text-emerald-400" />
                <div>
                  <p className="text-sm font-bold text-white">
                    {uploadedFileName ? `Arquivo: ${uploadedFileName}` : 'Clique aqui para selecionar a planilha (.xlsx ou .csv)'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Suporta planilhas padrão TIM / Claro com 46 ou 51 colunas (Coluna A até Observação).
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>

              {Object.keys(excelSheetsMap).length > 1 && (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5">
                  <label className="block text-[11px] font-bold text-slate-300">
                    Selecione a Aba da Planilha Excel:
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(excelSheetsMap).map((sName) => (
                      <button
                        key={sName}
                        type="button"
                        onClick={() => setSelectedExcelTab(sName)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          selectedExcelTab === sName
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {sName} ({excelSheetsMap[sName]?.length || 0} linhas)
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'paste' && (
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-300 flex items-center justify-between">
                <span>Cole os dados da tabela (Ctrl+C no Excel → Ctrl+V aqui):</span>
                <span className="text-[10px] text-slate-500">
                  {parsedSites.length} linhas detectadas
                </span>
              </label>
              <textarea
                rows={6}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Cole aqui as linhas copiadas da sua planilha (Ctrl+V)..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* Single Import Rule Banner */}
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Regra de Proteção (Somente Acrescentar):</span>
            </h4>
            <div className="p-3 bg-emerald-950/30 border border-emerald-800/50 rounded-xl text-emerald-200 text-xs leading-relaxed">
              <strong className="text-white block font-semibold mb-0.5">Modo Único: Somente Acrescentar Novos Registros</strong>
              Importar uma planilha nunca apaga, substitui ou modifica registros que já existem no Firestore. Cada linha do arquivo com algum conteúdo é gravada como novo registro, preservando 100% dos dados anteriores.
            </div>
          </div>

          {/* Pre-Save Summary Preview */}
          {parsedSites.length > 0 && (
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>Resumo Pré-Gravação:</span>
                </span>
                <span className="text-slate-400 font-mono">
                  {previewStats.total} linhas lidas
                </span>
              </div>

              {/* Requirement: "Mostre no resumo antes de gravar: 'Aba de destino: Controle Geral'" */}
              <div className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Aba de destino:</span>
                <span className="font-bold font-mono text-emerald-400">
                  {destSheetName}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-0.5 font-mono text-[11px]">
                <div className="p-2 bg-emerald-950/40 border border-emerald-800/60 rounded text-center">
                  <span className="text-[10px] text-emerald-400 block font-sans">LINHAS PARA ADICIONAR</span>
                  <strong className="text-emerald-300 text-base">+{previewStats.total}</strong>
                </div>
                <div className="p-2 bg-slate-900 border border-slate-800 rounded text-center">
                  <span className="text-[10px] text-slate-400 block font-sans">REGRA</span>
                  <strong className="text-slate-300 text-xs">Somente Acrescentar</strong>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
          >
            Fechar
          </button>

          <button
            type="button"
            onClick={handleOpenPreImportSummary}
            disabled={submitting || parsedSites.length === 0}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-2"
          >
            {submitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Gravando no Firestore...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  Ver Resumo e Confirmar ({parsedSites.length} Linhas)
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Confirmation Modal before Firestore write */}
      <PreImportSummaryModal
        isOpen={preImportModalOpen}
        title="Confirmar Importação de Planilha"
        fileName={tab === 'excel' && uploadedFileName ? uploadedFileName : 'Colagem Direta Ctrl+V'}
        sheetName={destSheetName}
        linhasLidas={parsedSites.length}
        linhasAdicionadas={parsedSites.length}
        linhasIgnoradas={0}
        isPreviouslyImported={historyCheckResult.isPreviouslyImported}
        previousImportDate={dataService.formatImportDate(historyCheckResult.lastImportedAt)}
        isSaving={submitting}
        onConfirm={handleConfirmImport}
        onCancel={() => setPreImportModalOpen(false)}
      />
    </div>
  );
};
