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

  const isClaroDestination =
    (isFixedDestination &&
      (fixedDestinationVendor === 'CLARO_TIM' ||
        fixedDestinationType === 'CLARO_SITES' ||
        fixedDestinationType === 'CLARO_ENGENHARIA')) ||
    (!isFixedDestination && vendor === 'CLARO_TIM');

  const isClaroSites =
    isClaroDestination &&
    (!isFixedDestination || fixedDestinationType !== 'CLARO_ENGENHARIA');

  const isNokiaSites =
    !isClaroDestination &&
    ((isFixedDestination &&
      (fixedDestinationType === 'NOKIA_SITES' ||
        fixedDestinationVendor === 'NOKIA' ||
        fixedDestinationTitle?.includes('Nokia'))) ||
      (!isFixedDestination && vendor === 'NOKIA'));

  const vendorSheets = sheets.filter((s) => s.vendor === vendor);
  const effectiveSheetName = isNokiaSites || isClaroSites
    ? 'Controle Geral'
    : isClaroDestination
    ? selectedExcelTab || fixedDestinationTitle || 'Claro'
    : targetSheet === '__NEW__'
    ? customSheetName.trim() || selectedExcelTab || `Controle Geral`
    : targetSheet || `Controle Geral`;

  const parsedFromPaste =
    tab === 'paste' && rawText.trim()
      ? parseClipboardOrCsvText(
          rawText,
          isFixedDestination ? fixedDestinationVendor : vendor,
          effectiveSheetName
        )
      : { sites: [], detectedColumns: [] };

  const rawParsedSites: Partial<TelecomSite>[] =
    tab === 'paste'
      ? parsedFromPaste.sites
      : selectedExcelTab && excelSheetsMap[selectedExcelTab]
      ? excelSheetsMap[selectedExcelTab]
      : [];

  const destSheetName = isClaroSites
    ? 'Controle Geral'
    : isNokiaSites
    ? normalizeNokiaSitesSheetName(tab === 'paste' ? 'Controle Geral' : selectedExcelTab || 'Controle Geral')
    : isFixedDestination
    ? fixedDestinationTitle
    : tab === 'excel' && selectedExcelTab
    ? targetSheet === '__NEW__' && customSheetName.trim()
      ? customSheetName.trim()
      : selectedExcelTab
    : effectiveSheetName;

  const parsedSites: Partial<TelecomSite>[] = useMemo(() => {
    if (isClaroSites) {
      return rawParsedSites.map((s) => ({
        ...s,
        vendor: 'CLARO_TIM',
        sheetName: 'Controle Geral',
      }));
    }
    if (isNokiaSites) {
      return rawParsedSites.map((s) => ({
        ...s,
        sheetName: destSheetName,
      }));
    }
    if (isClaroDestination) {
      const sheetLabel = tab === 'excel' && selectedExcelTab ? selectedExcelTab : destSheetName;
      return rawParsedSites.map((s) => ({
        ...s,
        sheetName: sheetLabel,
      }));
    }
    return rawParsedSites;
  }, [rawParsedSites, isClaroSites, isNokiaSites, isClaroDestination, destSheetName, tab, selectedExcelTab]);

  const detectedColumns: string[] =
    tab === 'paste'
      ? parsedFromPaste.detectedColumns
      : selectedExcelTab && excelColumnsMap[selectedExcelTab]
      ? excelColumnsMap[selectedExcelTab]
      : isClaroDestination
      ? []
      : CONTROLE_GERAL_COLUMNS;

  // Pre-calculate preview summary: novas, já existiam, com erro, uniqueSitesCount, repeatedSitesCount
  const previewStats = useMemo(() => {
    const existingKeys = new Set(
      existingSites.map((s) => (s.siteId || s.id || '').toString().trim().toUpperCase()).filter(Boolean)
    );

    let novas = 0;
    let jaExistiam = 0;
    let comErro = 0;
    const seenInBatch = new Set<string>();
    let uniqueSitesCount = 0;
    let repeatedSitesCount = 0;

    for (const s of parsedSites) {
      const key = (s.siteId || s.id || '').toString().trim().toUpperCase();
      if (!key) {
        comErro++;
      } else {
        if (seenInBatch.has(key)) {
          repeatedSitesCount++;
        } else {
          seenInBatch.add(key);
          uniqueSitesCount++;
        }
        if (existingKeys.has(key)) {
          jaExistiam++;
        } else {
          novas++;
        }
      }
    }

    return {
      total: parsedSites.length,
      novas,
      jaExistiam,
      comErro,
      uniqueSitesCount,
      repeatedSitesCount,
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
      const targetType = isFixedDestination ? fixedDestinationType : (vendor === 'ERICSSON' ? 'ERICSSON_SITES' : vendor === 'CLARO_TIM' ? 'CLARO_SITES' : 'NOKIA_SITES');
      if (!isClaroDestination) {
        const check = validarCompatibilidadePlanilha(buffer, targetType, file.name);
        if (isFixedDestination && check.shouldBlock) {
          setError(check.blockMessage || 'Planilha incompatível!');
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }
        if (check.warningMessage) {
          showToast(check.warningMessage);
        }
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

    const targetType = isFixedDestination ? fixedDestinationType : (vendor === 'ERICSSON' ? 'ERICSSON_SITES' : vendor === 'CLARO_TIM' ? 'CLARO_SITES' : 'NOKIA_SITES');
    if (!isClaroDestination) {
      const check = validarCompatibilidadePlanilha(detectedColumns, targetType, tab === 'excel' ? uploadedFileName : undefined);
      if (isFixedDestination && check.shouldBlock) {
        setError(check.blockMessage || 'Planilha incompatível!');
        return;
      }
      if (check.warningMessage) {
        showToast(check.warningMessage);
      }
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
          : 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 ameta-modal-backdrop overflow-y-auto'
      }
    >
      <div
        className={
          inlineTabMode
            ? 'w-full bg-white border border-slate-200 rounded-[12px] overflow-hidden flex flex-col shadow-xs'
            : 'w-full max-w-5xl bg-white border border-slate-200 rounded-[12px] shadow-2xl overflow-hidden flex flex-col max-h-[92vh] ameta-modal-panel'
        }
      >
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-[#223585]" />
              <span>
                Importar Planilha ({isFixedDestination ? fixedDestinationVendor : vendor}) — Apenas Acrescentar Novos
              </span>
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {isFixedDestination && (
                <span className="px-2.5 py-0.5 rounded-[6px] bg-[#223585]/10 border border-[#223585]/20 text-[#223585] text-xs font-bold font-mono">
                  Destino: {fixedDestinationTitle}
                </span>
              )}
              <p className="text-xs text-slate-500">
                Toda importação nunca substitui nem apaga a base existente. Dados anteriores são 100% preservados.
              </p>
            </div>
          </div>
          {!inlineTabMode && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-[8px] text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Tab Switcher: Only Excel and Ctrl+V */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-2.5 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setTab('excel');
              setError(null);
            }}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-[8px] transition-colors flex items-center gap-2 cursor-pointer border-x border-t ${
              tab === 'excel'
                ? 'bg-white text-[#223585] border-slate-200 border-b-white -mb-px shadow-2xs'
                : 'text-slate-500 hover:text-slate-800 border-transparent hover:bg-slate-100'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-[#1E8E8D]" />
            <span>1. Selecionar Arquivo Excel (.XLSX / .CSV)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTab('paste');
              setError(null);
            }}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-[8px] transition-colors flex items-center gap-2 cursor-pointer border-x border-t ${
              tab === 'paste'
                ? 'bg-white text-[#223585] border-slate-200 border-b-white -mb-px shadow-2xs'
                : 'text-slate-500 hover:text-slate-800 border-transparent hover:bg-slate-100'
            }`}
          >
            <ClipboardPaste className="w-4 h-4 text-[#223585]" />
            <span>2. Colar Tabela (Ctrl+V)</span>
          </button>
        </div>

        {/* Feedback Messages */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-[10px] text-rose-800 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="flex-1 font-mono">{error}</span>
          </div>
        )}

        {/* Post-Import Result Summary */}
        {importSummaryResult && (
          <div className="mx-6 mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-[10px] text-emerald-900 text-xs space-y-2 shrink-0">
            <div className="flex items-center gap-2 font-bold text-sm text-emerald-800">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>Resultado da Importação no Firestore:</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono tabular-nums text-[11px]">
              <div className="bg-white p-2.5 rounded-[8px] border border-slate-200">
                <span className="text-slate-500 block text-[10px] font-sans font-semibold">TOTAL ANALISADO</span>
                <strong className="text-slate-900 text-sm">{importSummaryResult.totalAnalisados}</strong>
              </div>
              <div className="bg-white p-2.5 rounded-[8px] border border-emerald-200">
                <span className="text-emerald-700 block text-[10px] font-sans font-semibold">NOVAS GRAVADAS</span>
                <strong className="text-emerald-700 text-sm">+{importSummaryResult.novas}</strong>
              </div>
              <div className="bg-white p-2.5 rounded-[8px] border border-amber-200">
                <span className="text-amber-700 block text-[10px] font-sans font-semibold">JÁ EXISTIAM (MANTIDAS)</span>
                <strong className="text-amber-800 text-sm">{importSummaryResult.jaExistiam}</strong>
              </div>
              <div className="bg-white p-2.5 rounded-[8px] border border-slate-200">
                <span className="text-slate-500 block text-[10px] font-sans font-semibold">LOTES EXECUTADOS</span>
                <strong className="text-slate-900 text-sm">{importSummaryResult.lotesExecutados} (20 docs/lote)</strong>
              </div>
            </div>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-slate-700 text-xs bg-white">
          {tab === 'excel' && (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="p-8 border-2 border-dashed border-slate-300 hover:border-[#223585] rounded-[12px] bg-slate-50 hover:bg-blue-50/40 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-3"
              >
                <div className="w-12 h-12 rounded-[10px] bg-[#223585]/10 border border-[#223585]/20 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-[#223585]" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {uploadedFileName ? `Arquivo: ${uploadedFileName}` : 'Clique aqui para selecionar a planilha (.xlsx ou .csv)'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
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
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-[10px] space-y-2">
                  <label className="block text-[11px] font-bold text-slate-700">
                    Selecione a Aba da Planilha Excel:
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(excelSheetsMap).map((sName) => (
                      <button
                        key={sName}
                        type="button"
                        onClick={() => setSelectedExcelTab(sName)}
                        className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors cursor-pointer border ${
                          selectedExcelTab === sName
                            ? 'bg-[#223585] border-[#223585] text-white font-bold shadow-2xs'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
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
              <label className="block text-xs font-bold text-slate-800 flex items-center justify-between">
                <span>Cole os dados da tabela (Ctrl+C no Excel → Ctrl+V aqui):</span>
                <span className="text-[11px] font-mono tabular-nums text-slate-500">
                  {parsedSites.length} linhas detectadas
                </span>
              </label>
              <textarea
                rows={6}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Cole aqui as linhas copiadas da sua planilha (Ctrl+V)..."
                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-[8px] font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#223585] focus:ring-2 focus:ring-[#223585]/15"
              />
            </div>
          )}

          {/* Single Import Rule Banner */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-[10px] space-y-2">
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#1E8E8D]" />
              <span>Regra de Proteção (Somente Acrescentar):</span>
            </h4>
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-[8px] text-emerald-900 text-xs leading-relaxed">
              <strong className="text-emerald-800 block font-semibold mb-0.5">Modo Único: Somente Acrescentar Novos Registros</strong>
              Importar uma planilha nunca apaga, substitui ou modifica registros que já existem no Firestore. Cada linha do arquivo com algum conteúdo é gravada como novo registro, preservando 100% dos dados anteriores.
            </div>
          </div>

          {/* Pre-Save Summary Preview */}
          {parsedSites.length > 0 && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-[10px] space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span>Resumo Pré-Gravação:</span>
                </span>
                <span className="text-slate-600 font-mono tabular-nums">
                  {previewStats.total} linhas lidas
                </span>
              </div>

              {/* Requirement: "Mostre no resumo antes de gravar: 'Aba de destino: ...'" */}
              <div className="p-2.5 bg-white border border-slate-200 rounded-[8px] flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">Destino:</span>
                <span className="font-bold font-mono text-[#223585]">
                  {destSheetName}
                  {tab === 'excel' && selectedExcelTab && isClaroDestination
                    ? ` (Aba: ${selectedExcelTab})`
                    : ''}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5 font-mono tabular-nums text-[11px]">
                <div className="p-2.5 bg-white border border-emerald-200 rounded-[8px] text-center shadow-2xs">
                  <span className="text-[10px] text-emerald-700 block font-sans font-semibold">LINHAS ENCONTRADAS</span>
                  <strong className="text-emerald-700 text-base">+{previewStats.total}</strong>
                </div>
                <div className="p-2.5 bg-white border border-blue-200 rounded-[8px] text-center shadow-2xs">
                  <span className="text-[10px] text-blue-700 block font-sans font-semibold">COLUNAS</span>
                  <strong className="text-blue-700 text-base">{detectedColumns.length}</strong>
                </div>
                <div className="p-2.5 bg-white border border-indigo-200 rounded-[8px] text-center shadow-2xs">
                  <span className="text-[10px] text-indigo-700 block font-sans font-semibold">SITES ÚNICOS</span>
                  <strong className="text-indigo-700 text-base">{previewStats.uniqueSitesCount}</strong>
                </div>
                <div className="p-2.5 bg-white border border-amber-200 rounded-[8px] text-center shadow-2xs">
                  <span className="text-[10px] text-amber-800 block font-sans font-semibold">REPETIDOS (INDEPENDENTES)</span>
                  <strong className="text-amber-800 text-base">{previewStats.repeatedSitesCount}</strong>
                </div>
              </div>

              {detectedColumns.length > 0 && (
                <div className="p-3 bg-white border border-slate-200 rounded-[8px] space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Colunas na ordem original ({detectedColumns.length}):
                  </span>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {detectedColumns.map((col, idx) => (
                      <span
                        key={`${col}_${idx}`}
                        className="px-2 py-0.5 rounded-[6px] bg-slate-50 border border-slate-200 text-[10px] font-mono text-slate-700"
                      >
                        {idx + 1}. {col}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold text-xs rounded-[8px] transition-colors cursor-pointer"
          >
            Fechar
          </button>

          <button
            type="button"
            onClick={handleOpenPreImportSummary}
            disabled={submitting || parsedSites.length === 0}
            className="px-6 py-2.5 bg-[#223585] hover:bg-[#1B2A6B] disabled:opacity-50 text-white font-bold text-xs rounded-[8px] shadow-xs transition-colors cursor-pointer flex items-center gap-2"
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
        sheetName={
          isClaroSites
            ? `Claro – Sites (Controle Geral)`
            : tab === 'excel' && selectedExcelTab && isClaroDestination
            ? `${destSheetName} (Aba: ${selectedExcelTab})`
            : destSheetName
        }
        linhasLidas={parsedSites.length}
        linhasAdicionadas={parsedSites.length}
        linhasIgnoradas={0}
        uniqueSitesCount={previewStats.uniqueSitesCount}
        repeatedSitesCount={previewStats.repeatedSitesCount}
        isPreviouslyImported={historyCheckResult.isPreviouslyImported}
        previousImportDate={dataService.formatImportDate(historyCheckResult.lastImportedAt)}
        isSaving={submitting}
        detectedColumns={detectedColumns}
        availableSheets={
          tab === 'excel' && Object.keys(excelSheetsMap).length > 1
            ? Object.keys(excelSheetsMap).map((k) => ({
                name: k,
                count: excelSheetsMap[k]?.length || 0,
              }))
            : []
        }
        selectedSheetName={selectedExcelTab}
        onSelectSheetName={(sName) => setSelectedExcelTab(sName)}
        onConfirm={handleConfirmImport}
        onCancel={() => setPreImportModalOpen(false)}
      />
    </div>
  );
};
