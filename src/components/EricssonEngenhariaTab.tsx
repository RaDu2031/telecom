import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Search,
  Filter,
  Download,
  Maximize2,
  Minimize2,
  Table2,
  LayoutList,
  CheckCircle2,
  ExternalLink,
  X,
  Edit3,
  FileSpreadsheet,
  ArrowLeftRight,
  HardHat,
  FolderOpen,
  Trash2,
} from 'lucide-react';
import {
  AmetaUser,
  UserRole,
  EricssonRow,
  EricssonSheetMeta,
  EngineeringFile,
  ERICSSON_ORIGINAL_COLUMNS,
} from '../types/telecom';
import { computeEricssonSiteCounters } from '../utils/ericssonSpreadsheetUtils';
import { cloudFetch } from '../lib/firebaseCloud';

const fetch = cloudFetch;

export interface EricssonEngenhariaTabProps {
  user: AmetaUser;
  effectiveRole: UserRole;
  rows: EricssonRow[];
  sheetMeta: EricssonSheetMeta | null;
  onUpdated: (
    nextRows: EricssonRow[],
    nextMeta?: EricssonSheetMeta | null,
    toastMsg?: string,
    nextFiles?: EngineeringFile[]
  ) => void;
  onOpenFileInVistoriaFolder?: (
    folderId?: string,
    fileId?: string,
    fileName?: string
  ) => void;
}

export const EricssonEngenhariaTab: React.FC<EricssonEngenhariaTabProps> = ({
  user,
  effectiveRole,
  rows,
  sheetMeta,
  onUpdated,
  onOpenFileInVistoriaFolder,
}) => {
  const isExecutor = effectiveRole === 'Executor';
  const [viewMode, setViewMode] = useState<'resumo' | 'planilha'>('resumo');
  const [density, setDensity] = useState<'compact' | 'normal' | 'comfortable'>('normal');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterState, setFilterState] = useState<string>('ALL');
  const [filterEquipe, setFilterEquipe] = useState<string>('ALL');
  const [filterDelivery, setFilterDelivery] = useState<
    'ALL' | 'COM_ARQUIVO' | 'VISTORIA_ENTREGUE' | 'LOS_ENTREGUE' | 'PENDENTE'
  >('ALL');
  const [togglingRowKey, setTogglingRowKey] = useState<string | null>(null);

  // Row edit drawer (updates mother spreadsheet in real time)
  const [selectedRow, setSelectedRow] = useState<EricssonRow | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const originalColumns = useMemo(() => {
    if (sheetMeta?.columns && sheetMeta.columns.length > 0) {
      return sheetMeta.columns;
    }
    return ERICSSON_ORIGINAL_COLUMNS;
  }, [sheetMeta]);

  const distinctStates = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const val = (r.state || r.fields?.['00.03.State'] || '').trim();
      if (val) s.add(val);
    });
    return Array.from(s).sort();
  }, [rows]);

  const distinctEquipes = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const val = (r.equipe || r.fields?.['EQUIPE'] || '').trim();
      if (val) s.add(val);
    });
    return Array.from(s).sort();
  }, [rows]);

  const searchTokens = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw) return [];
    const parts = raw
      .split(/[\s,;|\t\n]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    return parts;
  }, [searchQuery]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const rState = (r.state || r.fields?.['00.03.State'] || '').trim();
      const rEquipe = (r.equipe || r.fields?.['EQUIPE'] || '').trim();

      if (filterState !== 'ALL' && rState !== filterState) return false;
      if (filterEquipe !== 'ALL' && rEquipe !== filterEquipe) return false;

      if (filterDelivery === 'COM_ARQUIVO') {
        const hasAnyFile =
          Boolean(r.siteAVistoriaFileName) ||
          Boolean(r.siteBVistoriaFileName) ||
          Boolean(r.losFileName);
        if (!hasAnyFile) return false;
      } else if (filterDelivery === 'VISTORIA_ENTREGUE') {
        if (r.siteAVistoriaStatus !== 'Entregue' && r.siteBVistoriaStatus !== 'Entregue') {
          return false;
        }
      } else if (filterDelivery === 'LOS_ENTREGUE') {
        if (r.losStatus !== 'Entregue') return false;
      } else if (filterDelivery === 'PENDENTE') {
        const vPendente =
          r.siteAVistoriaStatus === 'Pendente' && r.siteBVistoriaStatus === 'Pendente';
        const lPendente = (r.losStatus || 'Pendente') === 'Pendente';
        if (!vPendente && !lPendente) return false;
      }

      if (searchTokens.length === 0) return true;

      if (searchTokens.length > 1) {
        const codeCandidates = [
          (r.siteIdA || '').toUpperCase(),
          (r.siteIdB || '').toUpperCase(),
          (r.chaves || '').toUpperCase(),
          (r.siteName || '').toUpperCase(),
        ];
        return searchTokens.some((tok) =>
          codeCandidates.some((cand) => cand.includes(tok))
        );
      }

      const q = searchQuery.trim().toLowerCase();
      const hay = [
        r.chaves,
        r.state,
        r.siteIdA,
        r.siteIdB,
        r.siteName,
        r.cidadeA,
        r.cidadeB,
        r.equipe,
        r.servico,
        r.siteAVistoriaFileName,
        r.siteBVistoriaFileName,
        r.losFileName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return hay.includes(q);
    });
  }, [rows, filterState, filterEquipe, filterDelivery, searchTokens, searchQuery]);

  const siteCounters = useMemo(
    () => computeEricssonSiteCounters(filteredRows),
    [filteredRows]
  );

  const losCounters = useMemo(() => {
    let entregues = 0;
    let pendentes = 0;
    filteredRows.forEach((r) => {
      if (r.losStatus === 'Entregue') entregues++;
      else pendentes++;
    });
    return { entregues, pendentes };
  }, [filteredRows]);

  const filesReadyToDownloadCount = useMemo(() => {
    let count = 0;
    filteredRows.forEach((r) => {
      if (r.siteAVistoriaFileName && r.siteAVistoriaDownloadUrl) count++;
      if (r.siteBVistoriaFileName && r.siteBVistoriaDownloadUrl) count++;
      if (r.losFileName && r.losDownloadUrl) count++;
    });
    return count;
  }, [filteredRows]);

  const handleToggleStatus = async (
    row: EricssonRow,
    side: 'A' | 'B' | 'LOS',
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    const key = `${row.id}:${side}`;
    setTogglingRowKey(key);
    try {
      const res = await fetch(
        `/api/ericsson/rows/${encodeURIComponent(row.id)}/toggle-finalizado`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            side,
            actorName: user.name,
            actorEmail: user.email,
          }),
        }
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data.ericssonRows)) {
        const updatedRow = data.row as EricssonRow;
        if (selectedRow && selectedRow.id === row.id && updatedRow) {
          setSelectedRow(updatedRow);
        }
        onUpdated(
          data.ericssonRows,
          sheetMeta,
          'Status atualizado na Planilha Mãe e na Engenharia Ericsson!'
        );
      }
    } catch {
      // ignore
    } finally {
      setTogglingRowKey(null);
    }
  };

  const handleDeleteRowFile = async (
    row: EricssonRow,
    side: 'A' | 'B' | 'LOS',
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(
        `/api/ericsson/vistoria/${encodeURIComponent(row.id)}/${encodeURIComponent(side)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data.ericssonRows)) {
        const updatedRow = data.row as EricssonRow;
        if (selectedRow && selectedRow.id === row.id && updatedRow) {
          setSelectedRow(updatedRow);
        }
        onUpdated(
          data.ericssonRows,
          sheetMeta,
          `Arquivo de ${side === 'LOS' ? 'LOS' : `Vistoria ${side}`} excluído com sucesso!`,
          data.ericssonFiles
        );
      }
    } catch {
      // ignore
    }
  };

  const handleSaveRowEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRow) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/ericsson/rows/${encodeURIComponent(selectedRow.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: editFields,
          chaves: editFields['01.00. Chaves'],
          state: editFields['00.03.State'],
          meta: editFields['Meta'],
          siteIdA: editFields['01.21.Site ID A'],
          idDetentoraA: editFields['ID Detentora A'],
          statusA: editFields['Status A'],
          cidadeA: editFields['CIDADE A'],
          siteIdB: editFields['01.21.Site ID B'],
          idDetentoraB: editFields['ID Detentora B'],
          statusB: editFields['Status B'],
          cidadeB: editFields['CIDADE B'],
          equipe: editFields['EQUIPE'],
          servico: editFields['Serviço'],
        }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.ericssonRows)) {
        onUpdated(
          data.ericssonRows,
          sheetMeta,
          'Planilha Mãe e Engenharia Ericsson atualizadas!'
        );
        setSelectedRow(data.row);
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleExportExcel = () => {
    const exportData = filteredRows.map((r) => {
      const rowObj: Record<string, string> = {};
      originalColumns.forEach((col) => {
        rowObj[col] = r.fields?.[col] ?? '';
      });
      rowObj['Vistoria Site A'] = r.siteAVistoriaStatus || 'Pendente';
      rowObj['Arquivo Vistoria A'] = r.siteAVistoriaFileName || '';
      rowObj['Vistoria Site B'] = r.siteBVistoriaStatus || 'Pendente';
      rowObj['Arquivo Vistoria B'] = r.siteBVistoriaFileName || '';
      rowObj['LOS'] = r.losStatus || 'Pendente';
      rowObj['Arquivo LOS'] = r.losFileName || '';
      return rowObj;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ENGENHARIA ERICSSON');
    XLSX.writeFile(
      wb,
      `Engenharia_Ericsson_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  const renderSheetStatusBadge = (rawStatus: string) => {
    const val = (rawStatus || '').trim();
    if (!val) return <span className="text-slate-400">—</span>;
    const lower = val.toLowerCase();
    if (lower.includes('liberad') || lower.includes('conclu') || lower.includes('finaliz')) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
          {val}
        </span>
      );
    }
    if (lower.includes('bloquead') || lower.includes('improdutiv') || lower.includes('embarg')) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
          {val}
        </span>
      );
    }
    if (lower.includes('cancelad') || lower.includes('desmobiliz')) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 whitespace-nowrap">
          {val}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-[#223585] border border-blue-200 whitespace-nowrap">
        {val}
      </span>
    );
  };

  // Engineering Cell: Includes Direct Download & Open File buttons right inside the spreadsheet!
  const renderEngineeringFileCell = (row: EricssonRow, side: 'A' | 'B' | 'LOS') => {
    const status =
      side === 'A'
        ? row.siteAVistoriaStatus || 'Pendente'
        : side === 'B'
        ? row.siteBVistoriaStatus || 'Pendente'
        : row.losStatus || 'Pendente';

    const fileName =
      side === 'A'
        ? row.siteAVistoriaFileName
        : side === 'B'
        ? row.siteBVistoriaFileName
        : row.losFileName;

    const fileUrl =
      side === 'A'
        ? row.siteAVistoriaFileUrl
        : side === 'B'
        ? row.siteBVistoriaFileUrl
        : row.losFileUrl;

    const downloadUrl =
      side === 'A'
        ? row.siteAVistoriaDownloadUrl
        : side === 'B'
        ? row.siteBVistoriaDownloadUrl
        : row.losDownloadUrl;

    const folderId =
      side === 'A'
        ? row.siteAVistoriaFolderId
        : side === 'B'
        ? row.siteBVistoriaFolderId
        : row.losFolderId;

    const fileId =
      side === 'A'
        ? row.siteAVistoriaFileId
        : side === 'B'
        ? row.siteBVistoriaFileId
        : row.losFileId;

    const uploadedBy =
      side === 'A'
        ? row.siteAVistoriaUploadedBy
        : side === 'B'
        ? row.siteBVistoriaUploadedBy
        : row.losUploadedBy;

    const uploadedByEmail =
      side === 'A'
        ? row.siteAVistoriaUploadedByEmail
        : side === 'B'
        ? row.siteBVistoriaUploadedByEmail
        : row.losUploadedByEmail;

    const canDeleteThisFile = !isExecutor || (
      (Boolean(user.email) && (uploadedByEmail || '').trim().toLowerCase() === user.email.trim().toLowerCase()) ||
      (Boolean(user.name) && (uploadedBy || '').trim().toLowerCase() === user.name.trim().toLowerCase())
    );

    const isToggling = togglingRowKey === `${row.id}:${side}`;

    return (
      <div
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          disabled={isToggling}
          onClick={(e) => handleToggleStatus(row, side, e)}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
            status === 'Entregue'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
              : status === 'Dispensado'
              ? 'bg-sky-50 text-sky-700 border-sky-300 hover:bg-sky-100'
              : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
          }`}
        >
          {status === 'Entregue' ? (
            <>
              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
              <span>
                Entregue
                {side === 'LOS' && row.losLinkedSiteId ? ` (${row.losLinkedSiteId})` : ''}
              </span>
            </>
          ) : status === 'Dispensado' ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
              <span>Dispensado</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <span>Pendente</span>
            </>
          )}
        </button>

        {/* DIRECT DOWNLOAD & OPEN IN SPREADSHEET (EXCLUSIVE FOR ENGENHARIA ERICSSON) */}
        {fileName && downloadUrl && (
          <a
            href={downloadUrl}
            download={fileName}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#223585] hover:bg-[#182661] text-white text-[10px] font-bold shadow-2xs transition-colors"
            title={`Baixar arquivo direto na planilha: ${fileName}`}
          >
            <Download className="w-3 h-3 shrink-0" />
            <span className="max-w-[110px] truncate">Baixar ({fileName})</span>
          </a>
        )}

        {fileName && fileUrl && (
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
            title={`Abrir arquivo: ${fileName}`}
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}

        {fileName && onOpenFileInVistoriaFolder && (
          <button
            type="button"
            onClick={() => onOpenFileInVistoriaFolder(folderId, fileId, fileName)}
            className="p-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 cursor-pointer"
            title="Ver na Pasta de Vistoria"
          >
            <FolderOpen className="w-3 h-3" />
          </button>
        )}

        {fileName && canDeleteThisFile && (
          <button
            type="button"
            onClick={(e) => handleDeleteRowFile(row, side, e)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[10px] font-bold cursor-pointer"
            title={`Excluir arquivo "${fileName}"`}
          >
            <Trash2 className="w-3 h-3 shrink-0" />
            <span>Excluir</span>
          </button>
        )}
      </div>
    );
  };

  const cellPad =
    density === 'compact'
      ? 'px-2.5 py-1.5 text-[11px]'
      : density === 'comfortable'
      ? 'px-4 py-3 text-xs'
      : 'px-3 py-2 text-xs';

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 bg-[#F3F4F6] overflow-y-auto p-4 md:p-6 space-y-4'
          : 'space-y-4'
      }
    >
      {/* =====================================================================
          1. TOP HEADER — ENGENHARIA ERICSSON (SINCRONIZADA COM A PLANILHA MÃE + DOWNLOAD DIRETO)
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#223585] to-[#1E8E8D] flex items-center justify-center text-white shadow-2xs shrink-0">
              <HardHat className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-md bg-teal-50 text-[#1E8E8D] border border-teal-200 text-[11px] font-bold uppercase tracking-wider">
                  ENGENHARIA · ERICSSON
                </span>
                <h1 className="text-base font-bold text-slate-900">
                  Planilha de Engenharia Ericsson (Com Download Direto de Vistoria e LOS)
                </h1>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Sincronizada automaticamente em tempo real com a{' '}
                <strong className="text-slate-700">Planilha Mãe (Sites Ericsson)</strong> •{' '}
                Permite <strong>baixar os arquivos de Vistoria A, Vistoria B e LOS</strong> direto na planilha.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3.5 py-2 bg-[#1E8E8D] hover:bg-[#177372] text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar Planilha Engenharia (.XLSX)</span>
            </button>

            <button
              type="button"
              onClick={() => setIsFullscreen((prev) => !prev)}
              className="p-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg transition-colors shadow-2xs cursor-pointer"
              title={isFullscreen ? 'Sair da tela inteira' : 'Tela inteira'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
          <button
            type="button"
            onClick={() => setFilterDelivery('ALL')}
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterDelivery === 'ALL'
                ? 'bg-blue-50/70 border-[#223585] ring-1 ring-[#223585]/20'
                : 'bg-slate-50/70 hover:bg-slate-100/70 border-slate-200'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Total na Planilha Mãe
            </div>
            <div className="text-2xl font-extrabold font-mono text-slate-900 mt-0.5 tabular-nums">
              {siteCounters.totalSites}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Em {siteCounters.totalPairs} enlaces (A e B)
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setFilterDelivery((prev) => (prev === 'COM_ARQUIVO' ? 'ALL' : 'COM_ARQUIVO'))
            }
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterDelivery === 'COM_ARQUIVO'
                ? 'bg-indigo-50 border-[#223585] ring-1 ring-[#223585]/20'
                : 'bg-indigo-50/40 hover:bg-indigo-50 border-indigo-200'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#223585] flex items-center justify-between">
              <span>Arquivos p/ Download</span>
              <Download className="w-3.5 h-3.5 text-[#223585]" />
            </div>
            <div className="text-2xl font-extrabold font-mono text-[#223585] mt-0.5 tabular-nums">
              {filesReadyToDownloadCount}
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5">
              Prontos para baixar na planilha
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setFilterDelivery((prev) =>
                prev === 'VISTORIA_ENTREGUE' ? 'ALL' : 'VISTORIA_ENTREGUE'
              )
            }
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterDelivery === 'VISTORIA_ENTREGUE'
                ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500/20'
                : 'bg-emerald-50/40 hover:bg-emerald-50 border-emerald-200'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 flex items-center justify-between">
              <span>Vistorias Entregues</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold font-mono text-emerald-700 mt-0.5 tabular-nums">
              {siteCounters.vistoriaEntregueSites}
            </div>
            <div className="text-[10px] text-emerald-700/80 mt-0.5">
              {siteCounters.vistoriaDispensadoSites} dispensados (outra ponta)
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setFilterDelivery((prev) => (prev === 'LOS_ENTREGUE' ? 'ALL' : 'LOS_ENTREGUE'))
            }
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterDelivery === 'LOS_ENTREGUE'
                ? 'bg-amber-50 border-amber-500 ring-1 ring-amber-500/20'
                : 'bg-amber-50/40 hover:bg-amber-50 border-amber-200'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800 flex items-center justify-between">
              <span>LOS Entregues</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div className="text-2xl font-extrabold font-mono text-amber-800 mt-0.5 tabular-nums">
              {losCounters.entregues}
            </div>
            <div className="text-[10px] text-amber-800/80 mt-0.5">
              {losCounters.pendentes} LOS pendentes
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setFilterDelivery((prev) => (prev === 'PENDENTE' ? 'ALL' : 'PENDENTE'))
            }
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterDelivery === 'PENDENTE'
                ? 'bg-red-50 border-red-500 ring-1 ring-red-500/20'
                : 'bg-red-50/40 hover:bg-red-50 border-red-200'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-red-700">
              Sites Pendentes
            </div>
            <div className="text-2xl font-extrabold font-mono text-red-700 mt-0.5 tabular-nums">
              {siteCounters.vistoriaPendenteSites}
            </div>
            <div className="text-[10px] text-red-700/80 mt-0.5">
              Aguardando entrega
            </div>
          </button>
        </div>
      </div>

      {/* =====================================================================
          2. VIEW SWITCHER & SEARCH / FILTERS
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('resumo')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'resumo'
                  ? 'bg-[#223585] text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" />
              <span>Planilha Engenharia — Resumo (Com Download)</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('planilha')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'planilha'
                  ? 'bg-[#223585] text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Planilha Completa ({originalColumns.length} col + Download A, B e LOS)</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500">Densidade:</span>
            <div className="inline-flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px]">
              {(
                [
                  { id: 'compact', label: 'Compacta' },
                  { id: 'normal', label: 'Padrão' },
                  { id: 'comfortable', label: 'Confortável' },
                ] as const
              ).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDensity(d.id)}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                    density === d.id
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 pt-1">
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar na Engenharia por Site ID A, Site ID B, Chave, arquivo..."
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#223585]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="md:col-span-2">
            <select
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
              className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium"
            >
              <option value="ALL">00.03.State: Todos ({distinctStates.length})</option>
              {distinctStates.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={filterEquipe}
              onChange={(e) => setFilterEquipe(e.target.value)}
              className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium"
            >
              <option value="ALL">EQUIPE: Todas ({distinctEquipes.length})</option>
              {distinctEquipes.map((eq) => (
                <option key={eq} value={eq}>
                  {eq}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={filterDelivery}
              onChange={(e) =>
                setFilterDelivery(
                  e.target.value as
                    | 'ALL'
                    | 'COM_ARQUIVO'
                    | 'VISTORIA_ENTREGUE'
                    | 'LOS_ENTREGUE'
                    | 'PENDENTE'
                )
              }
              className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium"
            >
              <option value="ALL">Filtro Engenharia: Todos</option>
              <option value="COM_ARQUIVO">Com Arquivo para Baixar ({filesReadyToDownloadCount})</option>
              <option value="VISTORIA_ENTREGUE">Vistoria Entregue</option>
              <option value="LOS_ENTREGUE">LOS Entregue</option>
              <option value="PENDENTE">Pendentes</option>
            </select>
          </div>
        </div>
      </div>

      {/* =====================================================================
          3A. RESUMO TABLE WITH DIRECT FILE DOWNLOADS
         ===================================================================== */}
      {viewMode === 'resumo' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-[#223585]" />
              <span>
                Planilha de Engenharia sincronizada com a Planilha Mãe • Clique em{' '}
                <strong className="text-[#223585]">Baixar</strong> em{' '}
                <strong>Vistoria A</strong>, <strong>Vistoria B</strong> ou{' '}
                <strong>LOS</strong> para fazer o download direto do arquivo.
              </span>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[680px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-wider text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3 font-bold">01.00. Chaves</th>
                  <th className="py-2.5 px-2.5 font-bold">00.03.State</th>
                  <th className="py-2.5 px-3 font-bold bg-blue-50/70 text-[#223585] border-l border-slate-200">
                    01.21.Site ID A
                  </th>
                  <th className="py-2.5 px-2.5 font-bold bg-blue-50/70 text-[#223585]">
                    Status A
                  </th>
                  <th className="py-2.5 px-2.5 font-bold bg-blue-50/70 text-[#223585]">
                    CIDADE A
                  </th>
                  <th className="py-2.5 px-3 font-bold bg-teal-50/70 text-[#1E8E8D] border-l border-slate-200">
                    01.21.Site ID B
                  </th>
                  <th className="py-2.5 px-2.5 font-bold bg-teal-50/70 text-[#1E8E8D]">
                    Status B
                  </th>
                  <th className="py-2.5 px-2.5 font-bold bg-teal-50/70 text-[#1E8E8D]">
                    CIDADE B
                  </th>
                  <th className="py-2.5 px-2.5 font-bold border-l border-slate-200">EQUIPE</th>
                  <th className="py-2.5 px-3 font-bold bg-blue-50 text-[#223585] border-l border-slate-200">
                    Vistoria A (Download)
                  </th>
                  <th className="py-2.5 px-3 font-bold bg-teal-50 text-[#1E8E8D] border-l border-slate-200">
                    Vistoria B (Download)
                  </th>
                  <th className="py-2.5 px-3 font-bold bg-amber-50 text-amber-800 border-l border-slate-200">
                    LOS (Download)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredRows.map((row) => {
                  const sA = row.statusA || row.fields?.['Status A'] || '';
                  const sB = row.statusB || row.fields?.['Status B'] || '';

                  return (
                    <tr
                      key={row.id}
                      onClick={() => {
                        setSelectedRow(row);
                        setEditFields({ ...(row.fields || {}) });
                      }}
                      className="hover:bg-blue-50/40 transition-colors cursor-pointer"
                    >
                      <td className={`${cellPad} font-mono font-bold text-slate-800 whitespace-nowrap`}>
                        {row.chaves || row.fields?.['01.00. Chaves'] || '—'}
                      </td>
                      <td className={`${cellPad} font-mono font-semibold text-slate-700`}>
                        {row.state || row.fields?.['00.03.State'] || '—'}
                      </td>
                      <td className={`${cellPad} font-mono font-bold text-[#223585] bg-blue-50/20 border-l border-slate-200 whitespace-nowrap`}>
                        {row.siteIdA || '—'}
                      </td>
                      <td className={`${cellPad} bg-blue-50/20`}>
                        {renderSheetStatusBadge(sA)}
                      </td>
                      <td className={`${cellPad} text-slate-700 bg-blue-50/20 max-w-[140px] truncate`}>
                        {row.cidadeA || row.fields?.['CIDADE A'] || '—'}
                      </td>
                      <td className={`${cellPad} font-mono font-bold text-[#1E8E8D] bg-teal-50/20 border-l border-slate-200 whitespace-nowrap`}>
                        {row.siteIdB || '—'}
                      </td>
                      <td className={`${cellPad} bg-teal-50/20`}>
                        {renderSheetStatusBadge(sB)}
                      </td>
                      <td className={`${cellPad} text-slate-700 bg-teal-50/20 max-w-[140px] truncate`}>
                        {row.cidadeB || row.fields?.['CIDADE B'] || '—'}
                      </td>
                      <td className={`${cellPad} font-semibold text-slate-800 border-l border-slate-200 whitespace-nowrap`}>
                        {row.equipe || row.fields?.['EQUIPE'] || '—'}
                      </td>
                      <td className={`${cellPad} bg-blue-50/15 border-l border-slate-200`}>
                        {renderEngineeringFileCell(row, 'A')}
                      </td>
                      <td className={`${cellPad} bg-teal-50/15 border-l border-slate-200`}>
                        {renderEngineeringFileCell(row, 'B')}
                      </td>
                      <td className={`${cellPad} bg-amber-50/20 border-l border-slate-200`}>
                        {renderEngineeringFileCell(row, 'LOS')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          3B. FULL SPREADSHEET VIEW WITH DIRECT FILE DOWNLOADS
         ===================================================================== */}
      {viewMode === 'planilha' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#1E8E8D]" />
              <span>
                Planilha Completa de Engenharia ({originalColumns.length} colunas + Download de{' '}
                <strong>Vistoria A</strong>, <strong>Vistoria B</strong> e <strong>LOS</strong>)
              </span>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[680px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-wider text-slate-700 border-b border-slate-200">
                <tr>
                  {originalColumns.map((col, idx) => (
                    <th
                      key={`${col}-${idx}`}
                      className="py-2.5 px-3 font-bold whitespace-nowrap border-r border-slate-200"
                    >
                      {col}
                    </th>
                  ))}
                  <th className="py-2.5 px-3 font-bold whitespace-nowrap bg-blue-50 text-[#223585] border-r border-slate-200">
                    Vistoria A (Download)
                  </th>
                  <th className="py-2.5 px-3 font-bold whitespace-nowrap bg-teal-50 text-[#1E8E8D] border-r border-slate-200">
                    Vistoria B (Download)
                  </th>
                  <th className="py-2.5 px-3 font-bold whitespace-nowrap bg-amber-50 text-amber-800 border-r border-slate-200">
                    LOS (Download)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredRows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => {
                      setSelectedRow(row);
                      setEditFields({ ...(row.fields || {}) });
                    }}
                    className="hover:bg-blue-50/40 transition-colors cursor-pointer"
                  >
                    {originalColumns.map((col, idx) => {
                      const val = row.fields?.[col] ?? '';
                      return (
                        <td
                          key={`${col}-${idx}`}
                          className={`${cellPad} whitespace-nowrap border-r border-slate-200/70 text-slate-700`}
                        >
                          {val || '—'}
                        </td>
                      );
                    })}
                    <td className={`${cellPad} whitespace-nowrap bg-blue-50/15 border-r border-slate-200`}>
                      {renderEngineeringFileCell(row, 'A')}
                    </td>
                    <td className={`${cellPad} whitespace-nowrap bg-teal-50/15 border-r border-slate-200`}>
                      {renderEngineeringFileCell(row, 'B')}
                    </td>
                    <td className={`${cellPad} whitespace-nowrap bg-amber-50/20 border-r border-slate-200`}>
                      {renderEngineeringFileCell(row, 'LOS')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          ROW DETAILS & EDIT DRAWER
         ===================================================================== */}
      {selectedRow && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
          onClick={() => setSelectedRow(null)}
        >
          <div
            className="w-full max-w-2xl bg-white border-l border-slate-200 h-full overflow-y-auto p-6 space-y-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-[#223585] border border-blue-200 font-mono text-xs font-bold">
                    {selectedRow.chaves || 'Par Ericsson'}
                  </span>
                  <span className="font-mono font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <span className="text-[#223585]">{selectedRow.siteIdA || '—'}</span>
                    <ArrowLeftRight className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[#1E8E8D]">{selectedRow.siteIdB || '—'}</span>
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Engenharia Ericsson — Download direto de arquivos e edição sincronizada com a Planilha Mãe
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="p-2 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <div className="font-bold text-slate-900">
                Arquivos para Download na Engenharia (Vistoria A, Vistoria B e LOS)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-white rounded-lg border border-blue-200 space-y-2">
                  <div className="text-[10px] font-bold uppercase text-[#223585]">
                    Vistoria Site A ({selectedRow.siteIdA || '—'})
                  </div>
                  {renderEngineeringFileCell(selectedRow, 'A')}
                </div>
                <div className="p-3 bg-white rounded-lg border border-teal-200 space-y-2">
                  <div className="text-[10px] font-bold uppercase text-[#1E8E8D]">
                    Vistoria Site B ({selectedRow.siteIdB || '—'})
                  </div>
                  {renderEngineeringFileCell(selectedRow, 'B')}
                </div>
                <div className="p-3 bg-white rounded-lg border border-amber-200 space-y-2">
                  <div className="text-[10px] font-bold uppercase text-amber-800">
                    Relatório LOS
                  </div>
                  {renderEngineeringFileCell(selectedRow, 'LOS')}
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveRowEdit} className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5 text-[#1E8E8D]" />
                  <span>Colunas da Planilha Mãe ({originalColumns.length} colunas)</span>
                </h4>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-1.5 bg-[#223585] hover:bg-[#192869] text-white font-bold rounded-lg cursor-pointer"
                >
                  {savingEdit ? 'Salvando...' : 'Salvar na Planilha Mãe'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {originalColumns.map((col, idx) => (
                  <div key={`${col}-${idx}`}>
                    <label className="block text-[11px] text-slate-500 font-medium mb-1">
                      {col}
                    </label>
                    <input
                      type="text"
                      value={editFields[col] ?? ''}
                      onChange={(e) =>
                        setEditFields((prev) => ({
                          ...prev,
                          [col]: e.target.value,
                        }))
                      }
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-[#223585]"
                    />
                  </div>
                ))}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
