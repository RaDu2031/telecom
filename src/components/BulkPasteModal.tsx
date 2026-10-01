import React, { useState, useRef } from 'react';
import {
  X,
  ClipboardPaste,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Table,
  CloudDownload,
  RefreshCw,
} from 'lucide-react';
import {
  TelecomSite,
  VendorType,
  SpreadsheetMeta,
  CONTROLE_GERAL_COLUMNS,
} from '../types/telecom';
import {
  parseClipboardOrCsvText,
  parseExcelWorkbookFile,
  getExcelColumnLetter,
  getCellValueForColumn,
} from '../utils/spreadsheetUtils';

const DEFAULT_ONEDRIVE_URL =
  'https://onedrive.live.com/:x:/g/personal/d82e752e01e5afdd/IQDcw0HcZ-LlSoZJ2-F639WkAfY227y1eEeinz8BeY6qoHg?rtime=cbEF2o8e30g&redeem=aHR0cHM6Ly8xZHJ2Lm1zL3gvYy9kODJlNzUyZTAxZTVhZmRkL0lRRGN3MEhjWi1MbFNvWkoyLUY2MzlXa0FmWTIyN3kxZUVlaW56OEJlWTZxb0hnP2U9Nk1YT2Rv';

interface BulkPasteModalProps {
  isOpen: boolean;
  inlineTabMode?: boolean;
  initialTab?: 'paste' | 'excel' | 'onedrive';
  activeVendor: VendorType;
  activeSheetName: string;
  sheets: SpreadsheetMeta[];
  initialPastedText?: string;
  onClose: () => void;
  onBulkImport: (params: {
    sites: Partial<TelecomSite>[];
    vendor: VendorType;
    sheetName: string;
    mode: 'upsert' | 'append' | 'replace_sheet';
    sourceFileName?: string;
    liveSyncUrl?: string;
    columns?: string[];
  }) => Promise<void>;
}

export const BulkPasteModal: React.FC<BulkPasteModalProps> = ({
  isOpen,
  inlineTabMode = false,
  initialTab = 'paste',
  activeVendor,
  activeSheetName,
  sheets,
  initialPastedText = '',
  onClose,
  onBulkImport,
}) => {
  const [tab, setTab] = useState<'paste' | 'excel' | 'onedrive'>(initialTab);
  const [vendor, setVendor] = useState<VendorType>(activeVendor);
  const [targetSheet, setTargetSheet] = useState<string>(activeSheetName);
  const [customSheetName, setCustomSheetName] = useState<string>('');
  const [importMode, setImportMode] = useState<'upsert' | 'append' | 'replace_sheet'>(
    'replace_sheet'
  );

  const [rawText, setRawText] = useState<string>(initialPastedText);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [excelSheetsMap, setExcelSheetsMap] = useState<Record<string, Partial<TelecomSite>[]>>({});
  const [excelColumnsMap, setExcelColumnsMap] = useState<Record<string, string[]>>({});
  const [selectedExcelTab, setSelectedExcelTab] = useState<string>('');

  const [oneDriveUrl, setOneDriveUrl] = useState<string>(DEFAULT_ONEDRIVE_URL);
  const [fetchingOneDrive, setFetchingOneDrive] = useState<boolean>(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setVendor(activeVendor);
    setTargetSheet(activeSheetName);
  }, [activeVendor, activeSheetName]);

  React.useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  React.useEffect(() => {
    if (initialPastedText) {
      setRawText(initialPastedText);
      setTab('paste');
    }
  }, [initialPastedText]);

  if (!isOpen) return null;

  const vendorSheets = sheets.filter((s) => s.vendor === vendor);
  const effectiveSheetName =
    targetSheet === '__NEW__'
      ? customSheetName.trim() || selectedExcelTab || `Controle Geral`
      : targetSheet || `Controle Geral`;

  const parsedFromPaste =
    tab === 'paste' && rawText.trim()
      ? parseClipboardOrCsvText(rawText, vendor, effectiveSheetName)
      : { sites: [], detectedColumns: [] };

  const parsedSites: Partial<TelecomSite>[] =
    tab === 'paste'
      ? parsedFromPaste.sites
      : selectedExcelTab && excelSheetsMap[selectedExcelTab]
      ? excelSheetsMap[selectedExcelTab]
      : [];

  const detectedColumns: string[] =
    tab === 'paste'
      ? parsedFromPaste.detectedColumns
      : selectedExcelTab && excelColumnsMap[selectedExcelTab]
      ? excelColumnsMap[selectedExcelTab]
      : CONTROLE_GERAL_COLUMNS;

  const handleLoadSamplePaste = () => {
    const sampleHeader = CONTROLE_GERAL_COLUMNS.join('\t');
    const sampleRow1 = [
      '1360413',
      'SN-OI65J2',
      'DFBSA_1601',
      'SMP-WO-0331813',
      '',
      'TCO',
      'DF',
      'Brasilia',
      'Swap - G3',
      'Engenharia',
      'Vistoria - Finalizada',
      '16/02/2026',
      '',
      '25/02/2026',
      '27/02/2026',
      'Magno/Luchini',
      '05/03/2026',
      '09/03/2026',
      'Magno',
      '11/03/2026',
      '10/03/2026',
      '',
      '',
      '',
      '',
      'E2E',
      '',
      '',
      'Greenfield',
      'CASA EXISTENTE',
      'W12',
      'BSA_TAGUATINGA',
      'TIM',
      'Aprovado',
      '24/02/2026',
      'Apenas retirar a Chave',
      '27/03/2026',
      '',
      '10',
      '51428509',
      '550053497020260001',
      '36389',
      '04/06/2026',
      '12/06/2026',
      'NF Emitida postada Edicom',
      'Vistoria concluída sem pendências',
    ].join('\t');

    setRawText([sampleHeader, sampleRow1].join('\n'));
    setError(null);
  };

  const handleExcelFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadedFileName(file.name);

    try {
      const { sheetNames, sheetsData, sheetsColumns } = await parseExcelWorkbookFile(file, vendor);
      if (sheetNames.length === 0) {
        setError('A planilha selecionada está vazia ou não possui linhas válidas.');
        return;
      }
      setExcelSheetsMap(sheetsData);
      setExcelColumnsMap(sheetsColumns);
      setSelectedExcelTab(sheetNames[0]);
      if (vendorSheets.some((s) => s.name === sheetNames[0])) {
        setTargetSheet(sheetNames[0]);
      }
    } catch {
      setError('Não foi possível ler o arquivo Excel (.xlsx/.csv). Verifique o formato.');
    }
  };

  const handleFetchOneDrive = async () => {
    if (!oneDriveUrl.trim()) {
      setError('Informe o link compartilhado do OneDrive.');
      return;
    }
    setFetchingOneDrive(true);
    setError(null);
    try {
      const res = await fetch('/api/sites/import-onedrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: oneDriveUrl.trim(), vendor }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Falha ao ler a planilha do OneDrive.');
        return;
      }
      setUploadedFileName(data.fileName || 'OneDrive_Workbook.xlsx');
      setExcelSheetsMap(data.sheetsData || {});
      setExcelColumnsMap(data.sheetsColumns || {});
      const names: string[] = data.sheetNames || [];
      if (names.length > 0) {
        const preferred = names.includes('Controle Geral') ? 'Controle Geral' : names[0];
        setSelectedExcelTab(preferred);
        if (vendorSheets.some((s) => s.name === preferred)) {
          setTargetSheet(preferred);
        } else {
          setTargetSheet('__NEW__');
          setCustomSheetName(preferred);
        }
      }
    } catch {
      setError('Erro de conexão ao buscar planilha do OneDrive.');
    } finally {
      setFetchingOneDrive(false);
    }
  };

  const handleConfirmImport = async () => {
    if (parsedSites.length === 0) {
      setError(
        'Carregue a planilha do OneDrive, selecione um arquivo Excel ou cole os dados (Ctrl+V) antes de importar.'
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const destSheetName =
        (tab === 'excel' || tab === 'onedrive') && selectedExcelTab
          ? targetSheet === '__NEW__' && customSheetName.trim()
            ? customSheetName.trim()
            : selectedExcelTab
          : effectiveSheetName;

      await onBulkImport({
        sites: parsedSites,
        vendor,
        sheetName: destSheetName,
        mode: importMode,
        sourceFileName:
          tab === 'onedrive'
            ? uploadedFileName || 'Controle Geral Site Investigation_Nokia_2026.xlsx'
            : tab === 'excel'
            ? uploadedFileName
            : 'Colagem Direta Ctrl+V',
        liveSyncUrl: tab === 'onedrive' ? oneDriveUrl.trim() : undefined,
        columns: detectedColumns,
      });
      setRawText('');
      onClose();
    } catch {
      setError('Erro ao sincronizar dados em massa com o servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={
        inlineTabMode
          ? 'w-full'
          : 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs'
      }
    >
      <div
        className={
          inlineTabMode
            ? 'w-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm'
            : 'w-full max-w-6xl bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[92vh]'
        }
      >
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">
              Importar Planilha (Coluna A até Observação) — OneDrive, Excel (.xlsx) ou Ctrl+C / Ctrl+V
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Extrai automaticamente todas as linhas e preserva o cabeçalho original da Coluna A até a coluna de Observações/Motivo.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs & Target Selector */}
        <div className="px-6 py-3.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setTab('onedrive')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer ${
                tab === 'onedrive'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <CloudDownload className="w-3.5 h-3.5" />
              <span>Sincronizar Link OneDrive</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('paste')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer ${
                tab === 'paste'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span>Colar do Excel (Ctrl+C / Ctrl+V)</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('excel')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer ${
                tab === 'excel'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Arquivo Excel (.xlsx / .csv)</span>
            </button>
          </div>

          {/* Vendor & Sheet Destination */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Fabricante:</span>
              <div className="flex items-center gap-1 p-0.5 bg-slate-950 border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setVendor('NOKIA');
                    const firstNk = sheets.find((s) => s.vendor === 'NOKIA');
                    if (firstNk) setTargetSheet(firstNk.name);
                  }}
                  className={`px-3 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                    vendor === 'NOKIA'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  NOKIA
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVendor('ERICSSON');
                    const firstEr = sheets.find((s) => s.vendor === 'ERICSSON');
                    if (firstEr) setTargetSheet(firstEr.name);
                  }}
                  className={`px-3 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                    vendor === 'ERICSSON'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  ERICSSON
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Planilha Destino:</span>
              <select
                value={targetSheet}
                onChange={(e) => setTargetSheet(e.target.value)}
                className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
              >
                {vendorSheets.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
                <option value="__NEW__">+ Criar Nova Aba de Planilha...</option>
              </select>
            </div>

            {targetSheet === '__NEW__' && (
              <input
                type="text"
                value={customSheetName}
                onChange={(e) => setCustomSheetName(e.target.value)}
                placeholder="Nome da nova planilha..."
                className="px-3 py-1.5 bg-slate-950 border border-blue-500 rounded-lg text-xs text-white focus:outline-none"
              />
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-950/60 border border-red-800 rounded-lg flex items-center gap-2.5 text-xs text-red-200">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {tab === 'onedrive' ? (
            <div className="space-y-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <label className="block text-xs font-semibold text-slate-200">
                  Link Compartilhado do OneDrive (Extração automática da Coluna A até a coluna de Observações/Motivo):
                </label>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={oneDriveUrl}
                    onChange={(e) => setOneDriveUrl(e.target.value)}
                    placeholder="Cole o link https://onedrive.live.com/... ou https://1drv.ms/..."
                    className="flex-1 px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    disabled={fetchingOneDrive}
                    onClick={handleFetchOneDrive}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className={`w-4 h-4 ${fetchingOneDrive ? 'animate-spin' : ''}`} />
                    <span>
                      {fetchingOneDrive
                        ? 'Lendo Planilha do OneDrive...'
                        : 'Carregar Planilha do OneDrive'}
                    </span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Ignora linhas de subtotal no topo (Linha 1), detecta o cabeçalho real (Linha 2) e importa todas as colunas da <strong className="text-slate-200">Coluna A (Oc Site Pre)</strong> até <strong className="text-slate-200">Observações/Motivo (Coluna AT)</strong>.
                </p>
              </div>

              {Object.keys(excelSheetsMap).length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-300">
                    Abas encontradas em <span className="font-mono text-blue-300">{uploadedFileName}</span> (clique para selecionar):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.keys(excelSheetsMap).map((sheetTab) => (
                      <button
                        key={sheetTab}
                        type="button"
                        onClick={() => {
                          setSelectedExcelTab(sheetTab);
                          if (vendorSheets.some((s) => s.name === sheetTab)) {
                            setTargetSheet(sheetTab);
                          } else {
                            setTargetSheet('__NEW__');
                            setCustomSheetName(sheetTab);
                          }
                        }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                          selectedExcelTab === sheetTab
                            ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {sheetTab} ({excelSheetsMap[sheetTab].length} linhas ·{' '}
                        {excelColumnsMap[sheetTab]?.length || 0} colunas)
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : tab === 'paste' ? (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-xs font-medium text-slate-300">
                  Copie as linhas da sua planilha Excel (<span className="font-mono text-white">Ctrl+C</span>) e cole no campo abaixo (<span className="font-mono text-white">Ctrl+V</span>):
                </label>
                <button
                  type="button"
                  onClick={handleLoadSamplePaste}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-blue-300 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 self-start cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Preencher Exemplo Controle Geral (Col A até AT)</span>
                </button>
              </div>

              <textarea
                rows={5}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Cole aqui suas células copiadas do Excel (Ctrl+V) incluindo ou não a linha de cabeçalho..."
                className="w-full p-3.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500 leading-relaxed"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-blue-500 bg-slate-950/60 rounded-xl p-8 text-center cursor-pointer transition-colors space-y-2"
              >
                <Upload className="w-8 h-8 text-blue-400 mx-auto" />
                <div className="text-sm font-semibold text-white">
                  {uploadedFileName
                    ? `Arquivo carregado: ${uploadedFileName}`
                    : 'Clique para selecionar sua planilha Excel (.xlsx, .xls ou .csv)'}
                </div>
                <p className="text-xs text-slate-400">
                  Importa todas as linhas da Coluna A até a coluna de Observação com cabeçalho original
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleExcelFileUpload}
                  className="hidden"
                />
              </div>

              {Object.keys(excelSheetsMap).length > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-300">Selecione a aba do arquivo Excel:</span>
                  {Object.keys(excelSheetsMap).map((sheetTab) => (
                    <button
                      key={sheetTab}
                      type="button"
                      onClick={() => {
                        setSelectedExcelTab(sheetTab);
                        if (vendorSheets.some((s) => s.name === sheetTab)) {
                          setTargetSheet(sheetTab);
                        }
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                        selectedExcelTab === sheetTab
                          ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      {sheetTab} ({excelSheetsMap[sheetTab].length} linhas)
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Import Mode Options */}
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg flex flex-wrap items-center justify-between gap-4">
            <span className="text-xs font-medium text-slate-300">
              Modo de Sincronização na Planilha:
            </span>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer text-amber-300">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'replace_sheet'}
                  onChange={() => setImportMode('replace_sheet')}
                  className="accent-amber-500"
                />
                <span>Substituir todas as linhas e cabeçalhos desta aba</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-200">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'upsert'}
                  onChange={() => setImportMode('upsert')}
                  className="accent-blue-500"
                />
                <span>Atualizar existentes + Adicionar novos</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-200">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'append'}
                  onChange={() => setImportMode('append')}
                  className="accent-blue-500"
                />
                <span>Adicionar todos como novas linhas</span>
              </label>
            </div>
          </div>

          {/* Live Preview Table with Exact Altered Headers (Col A -> Observação) */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Table className="w-4 h-4 text-blue-400" />
                <span>
                  Pré-visualização ({parsedSites.length} linhas · {detectedColumns.length} colunas de{' '}
                  <span className="font-mono text-blue-300">
                    Col A ({detectedColumns[0] || 'A'})
                  </span>{' '}
                  até{' '}
                  <span className="font-mono text-blue-300">
                    Col {getExcelColumnLetter(Math.max(0, detectedColumns.length - 1))} (
                    {detectedColumns[detectedColumns.length - 1] || 'Observação'})
                  </span>
                  )
                </span>
              </div>
              {parsedSites.length > 0 && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Cabeçalhos e linhas prontos para importação
                </span>
              )}
            </div>

            {parsedSites.length > 0 ? (
              <div className="border border-slate-800 rounded-lg overflow-x-auto max-h-60">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950 border-b border-slate-800 text-slate-300 font-semibold whitespace-nowrap">
                      <th className="py-2 px-2.5 border-r border-slate-800 font-mono text-slate-500">
                        #
                      </th>
                      {detectedColumns.map((colName, colIdx) => (
                        <th key={colIdx} className="py-2 px-3 border-r border-slate-800">
                          <span className="font-mono text-[10px] text-blue-400 mr-1.5">
                            {getExcelColumnLetter(colIdx)}
                          </span>
                          <span>{colName}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {parsedSites.slice(0, 25).map((s, i) => (
                      <tr key={i} className="hover:bg-slate-800/40 whitespace-nowrap">
                        <td className="py-1.5 px-2.5 border-r border-slate-800/50 font-mono text-slate-500 tabular-nums">
                          {i + 1}
                        </td>
                        {detectedColumns.map((colName, colIdx) => (
                          <td
                            key={colIdx}
                            className="py-1.5 px-3 border-r border-slate-800/50 text-slate-200 max-w-[220px] truncate"
                          >
                            {s.customFields?.[colName] ||
                              getCellValueForColumn(s as TelecomSite, colName) ||
                              '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 bg-slate-950/50 border border-slate-800/80 rounded-lg text-center text-xs text-slate-400">
                {tab === 'onedrive'
                  ? 'Clique em "Carregar Planilha do OneDrive" acima para visualizar todas as linhas e colunas da sua planilha.'
                  : 'Nenhum dado carregado ainda. Cole as linhas (Ctrl+V) ou selecione um arquivo Excel (.xlsx).'}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={submitting || parsedSites.length === 0}
            onClick={handleConfirmImport}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {submitting
                ? 'Sincronizando Planilha...'
                : `Importar ${parsedSites.length} Linhas (${detectedColumns.length} Colunas) Agora`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
