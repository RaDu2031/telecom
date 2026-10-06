import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  RefreshCw,
  FileSpreadsheet,
  Download,
  Upload,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  FileText,
  Clock,
  LogOut,
} from 'lucide-react';
import {
  initGoogleDriveAuth,
  googleDriveSignIn,
  googleDriveSignOut,
  listDriveSpreadsheets,
  downloadDriveSpreadsheet,
  uploadFileToGoogleDrive,
  getGoogleDriveAccessToken,
  DriveFileItem,
} from '../lib/googleDriveAuth';
import { User } from 'firebase/auth';
import { parseTssrWorkbookBuffer } from '../utils/tssrSpreadsheetUtils';
import { TssrRow, TssrSheetMeta, VendorType } from '../types/telecom';

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
  onImportTssr,
  currentTssrRows = [],
  currentVendor = 'NOKIA',
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [importingFileId, setImportingFileId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirmExportOpen, setConfirmExportOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;

    const unsubscribe = initGoogleDriveAuth(
      (currentUser, currentToken) => {
        setUser(currentUser);
        setToken(currentToken);
        setLoadingAuth(false);
      },
      () => {
        setUser(null);
        setToken(null);
        setLoadingAuth(false);
      }
    );

    const existingToken = getGoogleDriveAccessToken();
    if (existingToken) {
      setToken(existingToken);
      setLoadingAuth(false);
    }

    return () => unsubscribe();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && token) {
      loadFiles(token);
    }
  }, [isOpen, token]);

  const loadFiles = async (currentToken: string, query?: string) => {
    setLoadingFiles(true);
    setError(null);
    try {
      const items = await listDriveSpreadsheets(currentToken, query);
      setFiles(items);
    } catch (err: any) {
      setError(err.message || 'Falha ao carregar arquivos do Google Drive');
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleSignIn = async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      const result = await googleDriveSignIn();
      if (result) {
        setUser(result.user);
        setToken(result.accessToken);
        await loadFiles(result.accessToken);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao conectar ao Google Drive.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await googleDriveSignOut();
    setUser(null);
    setToken(null);
    setFiles([]);
    setSuccessMsg('Desconectado do Google Drive com sucesso.');
  };

  const handleImportFile = async (file: DriveFileItem) => {
    if (!token) return;
    setImportingFileId(file.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const { buffer } = await downloadDriveSpreadsheet(token, file.id, file.mimeType);
      const parsed = await parseTssrWorkbookBuffer(buffer, currentVendor);

      if (parsed.rows.length === 0) {
        throw new Error('Nenhum dado válido encontrado na planilha importada.');
      }

      const importedSheets: TssrSheetMeta[] = [
        {
          id: `sheet-${currentVendor.toLowerCase()}-${Date.now()}`,
          vendor: currentVendor,
          tabName: parsed.sheetNameUsed || 'TSSR TIM Nokia',
          sourceFileName: file.name,
          liveSyncUrl: `gdrive://${file.id}`,
          lastSyncAt: new Date().toISOString(),
          totalRows: parsed.rows.length,
        },
      ];

      // Persist to server
      const res = await fetch('/api/tssr/sync-onedrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor: currentVendor,
          syncUrl: `gdrive://${file.id}`,
          fileName: file.name,
          mode: 'replace',
          sheets: importedSheets,
          rows: parsed.rows,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao salvar planilha no servidor.');
      }

      const data = await res.json();
      if (onImportTssr) {
        onImportTssr(
          data.tssrRows || parsed.rows,
          data.tssrSheets || importedSheets,
          `Planilha "${file.name}" importada com sucesso do Google Drive (${parsed.rows.length} registros)!`
        );
      }
      setSuccessMsg(`Planilha "${file.name}" sincronizada com sucesso!`);
    } catch (err: any) {
      setError(err.message || 'Erro ao importar arquivo do Google Drive.');
    } finally {
      setImportingFileId(null);
    }
  };

  const handleExportCurrentSpreadsheet = async () => {
    if (!token) return;
    setExporting(true);
    setError(null);
    setSuccessMsg(null);
    setConfirmExportOpen(false);

    try {
      // Dynamic import XLSX to generate file
      const XLSX = await import('xlsx');
      const wsData: any[] = [];

      // Collect rows
      currentTssrRows.forEach((r) => {
        const rowObj: Record<string, any> = {
          'Site Id': r.siteId,
          'Oc Site Pre': r.ocSitePre,
          ...r.fields,
          'Status da Vistoria': r.vistoriaStatus,
          'Data da Vistoria': r.vistoriaDeliveredAt || '',
          'Vistoriador': r.vistoriaUploadedBy || '',
        };
        wsData.push(rowObj);
      });

      const ws = XLSX.utils.json_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'TSSR TIM Nokia');

      const outBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const nowStr = new Date().toISOString().slice(0, 10);
      const exportName = `Controle_Engenharia_TSSR_${nowStr}.xlsx`;

      const uploaded = await uploadFileToGoogleDrive(
        token,
        exportName,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        outBuffer
      );

      setSuccessMsg(
        `Planilha exportada para o seu Google Drive como "${uploaded.name}"!`
      );
      await loadFiles(token);
    } catch (err: any) {
      setError(err.message || 'Erro ao exportar planilha para o Google Drive.');
    } finally {
      setExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-blue-700 via-blue-800 to-indigo-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-xs">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4.5 19.5L8.5 12.5H19.5L15.5 19.5H4.5Z"
                  fill="#4285F4"
                />
                <path
                  d="M15.5 19.5L19.5 12.5L15.5 5.5H7.5L3.5 12.5L15.5 19.5Z"
                  fill="#0F9D58"
                  fillOpacity="0.85"
                />
                <path
                  d="M8.5 12.5L12.5 5.5H19.5L15.5 12.5H8.5Z"
                  fill="#FFBB00"
                />
                <path
                  d="M4.5 19.5L8.5 12.5L12.5 5.5L8.5 5.5L0.5 19.5H4.5Z"
                  fill="#EA4335"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>Google Drive</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-200 border border-blue-400/30">
                  Integração Oficial
                </span>
              </h2>
              <p className="text-xs text-blue-100">
                Acesse planilhas, arquivos de engenharia e vistorias diretamente do Google Drive
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-blue-200 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback Messages */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span className="flex-1 font-semibold">{successMsg}</span>
          </div>
        )}

        {/* Confirmation Modal for Exporting to User's Google Drive */}
        {confirmExportOpen && (
          <div className="mx-6 mt-4 p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-2">
            <div className="font-bold flex items-center gap-1.5 text-sm">
              <Upload className="w-4 h-4 text-amber-700" />
              <span>Confirmar exportação para o Google Drive</span>
            </div>
            <p className="text-slate-700 leading-relaxed">
              Será criado um novo arquivo de planilha Excel no seu Google Drive com todos os <strong>{currentTssrRows.length} registros</strong> da planilha de Engenharia TSSR TIM Nokia. Deseja continuar?
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmExportOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExportCurrentSpreadsheet}
                disabled={exporting}
                className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer transition-colors shadow-2xs"
              >
                {exporting ? 'Exportando...' : 'Confirmar e Exportar'}
              </button>
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {!token ? (
            /* Not Connected: Official Sign in with Google Button */
            <div className="text-center py-10 px-4 space-y-5">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center shadow-xs">
                <FolderOpen className="w-8 h-8 text-blue-600" />
              </div>
              <div className="max-w-md mx-auto space-y-1.5">
                <h3 className="text-base font-bold text-slate-900">
                  Conecte sua conta do Google Drive
                </h3>
                <p className="text-xs text-slate-600">
                  Com a sua permissão, você poderá sincronizar e importar planilhas TSSR, fotos de vistorias e exportar relatórios de engenharia diretamente para o seu Drive.
                </p>
              </div>

              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={isLoggingIn}
                  className="inline-flex items-center gap-3 px-5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs transition-all shadow-xs cursor-pointer hover:shadow-md disabled:opacity-50"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
                    />
                  </svg>
                  <span>{isLoggingIn ? 'Conectando...' : 'Fazer login com o Google'}</span>
                </button>
              </div>
            </div>
          ) : (
            /* Connected: File Browser and Export */
            <div className="space-y-4">
              {/* Account Card & Quick Actions */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {user?.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'Google User'}
                      className="w-9 h-9 rounded-full border border-slate-300 object-cover"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-xs">
                      {user?.displayName?.[0] || 'G'}
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <span>{user?.displayName || 'Conta Google Conectada'}</span>
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {user?.email || 'Autenticado'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmExportOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                    title="Exportar planilha atual para seu Google Drive"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Exportar TSSR para o Drive</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="p-1.5 rounded-lg border border-slate-300 text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer transition-colors"
                    title="Desconectar do Google Drive"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Search Bar & Refresh */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Buscar planilhas e arquivos no seu Google Drive..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') loadFiles(token, searchQuery);
                    }}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-600 shadow-2xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => loadFiles(token, searchQuery)}
                  disabled={loadingFiles}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                  title="Atualizar lista de arquivos"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingFiles ? 'animate-spin' : ''}`} />
                  <span>Atualizar</span>
                </button>
              </div>

              {/* Files List */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-700 flex items-center justify-between">
                  <span>Arquivos do Google Drive ({files.length})</span>
                  <span className="text-[10px] text-slate-500 font-normal">
                    Planilhas Google Sheets, XLSX, CSV e documentos
                  </span>
                </div>

                {loadingFiles ? (
                  <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                    <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />
                    <span>Carregando arquivos do Google Drive...</span>
                  </div>
                ) : files.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-500 space-y-1">
                    <FolderOpen className="w-6 h-6 text-slate-400 mx-auto" />
                    <p className="font-semibold text-slate-700">Nenhum arquivo encontrado</p>
                    <p className="text-[11px]">Crie uma planilha no Google Drive ou utilize a busca acima.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                    {files.map((file) => {
                      const isSpreadsheet =
                        file.mimeType.includes('spreadsheet') ||
                        file.mimeType.includes('sheet') ||
                        file.mimeType.includes('csv');
                      const isImporting = importingFileId === file.id;

                      return (
                        <div
                          key={file.id}
                          className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-blue-50/40 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                              {isSpreadsheet ? (
                                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                              ) : (
                                <FileText className="w-4 h-4 text-slate-600" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-900 truncate">
                                {file.name}
                              </div>
                              <div className="text-[10px] text-slate-400 flex items-center gap-2 font-mono">
                                <span>{file.mimeType.split('.').pop() || 'Arquivo'}</span>
                                {file.modifiedTime && (
                                  <>
                                    <span>·</span>
                                    <span>
                                      Modificado em{' '}
                                      {new Date(file.modifiedTime).toLocaleDateString('pt-BR')}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {file.webViewLink && (
                              <a
                                href={file.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                                title="Abrir no Google Drive"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}

                            {isSpreadsheet && (
                              <button
                                type="button"
                                onClick={() => handleImportFile(file)}
                                disabled={isImporting}
                                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 shadow-2xs"
                                title="Importar e sincronizar esta planilha na aba TSSR TIM Nokia"
                              >
                                {isImporting ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    <span>Importando...</span>
                                  </>
                                ) : (
                                  <>
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Importar para TSSR</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Integração Segura Google Workspace Drive</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-semibold cursor-pointer transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
