import React, { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Search,
  Filter,
  Download,
  RefreshCw,
  Upload,
  Maximize2,
  Minimize2,
  Table2,
  LayoutList,
  BarChart3,
  Users,
  Radio,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  X,
  Trash2,
  Edit3,
  FileSpreadsheet,
  ArrowLeftRight,
  AlertCircle,
  CloudDownload,
  UserPlus,
  FolderOpen,
} from 'lucide-react';
import {
  AmetaUser,
  UserRole,
  EricssonRow,
  EricssonSheetMeta,
  EngineeringFile,
  ERICSSON_ORIGINAL_COLUMNS,
} from '../types/telecom';
import {
  parseEricssonWorkbookBuffer,
  computeEricssonSiteCounters,
} from '../utils/ericssonSpreadsheetUtils';
import { getCanonicalDuplaName, normalizeAccents, doesEricssonRowMatchResponsible } from '../utils/spreadsheetUtils';
import { dataService } from '../services/dataService';

export interface EricssonSitesTabProps {
  user: AmetaUser;
  effectiveRole: UserRole;
  rows: EricssonRow[];
  sheetMeta: EricssonSheetMeta | null;
  ericssonUsers: AmetaUser[];
  onUpdated: (
    nextRows: EricssonRow[],
    nextMeta?: EricssonSheetMeta | null,
    toastMsg?: string,
    nextFiles?: EngineeringFile[]
  ) => void;
  onEricssonUsersUpdated: (nextUsers: AmetaUser[], toastMsg?: string) => void;
  onOpenFileInVistoriaFolder?: (
    folderId?: string,
    fileId?: string,
    fileName?: string
  ) => void;
  onOpenDuplasDemanda?: () => void;
}

const CHART_COLORS = [
  '#223585',
  '#1E8E8D',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#6366f1',
  '#ec4899',
  '#14b8a6',
];

export const EricssonSitesTab: React.FC<EricssonSitesTabProps> = ({
  user,
  effectiveRole,
  rows,
  sheetMeta,
  ericssonUsers,
  onUpdated,
  onEricssonUsersUpdated,
  onOpenFileInVistoriaFolder,
  onOpenDuplasDemanda,
}) => {
  const [viewMode, setViewMode] = useState<'resumo' | 'planilha' | 'graficos' | 'equipes'>(
    'resumo'
  );
  const [density, setDensity] = useState<'compact' | 'normal' | 'comfortable'>('normal');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Smart search & filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterState, setFilterState] = useState<string>('ALL');
  const [filterMeta, setFilterMeta] = useState<string>('ALL');
  const [filterEquipe, setFilterEquipe] = useState<string>('ALL');
  const [filterSheetStatus, setFilterSheetStatus] = useState<string>('ALL');
  const [filterVistoriaStatus, setFilterVistoriaStatus] = useState<
    | 'ALL'
    | 'FINALIZADO'
    | 'PENDENTE'
    | 'LOS_FINALIZADO'
    | 'LOS_PENDENTE'
    | 'SMART_FINALIZADO'
    | 'SMART_PENDENTE'
    | 'SDC_FINALIZADO'
    | 'SDC_PENDENTE'
  >('ALL');
  const [togglingRowKey, setTogglingRowKey] = useState<string | null>(null);

  // Sync / Excel Modal
  const [syncModalOpen, setSyncModalOpen] = useState<boolean>(false);
  const [syncLoading, setSyncLoading] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<{
    totalAnalisados: number;
    novas: number;
    jaExistiam: number;
    totalGravados: number;
    lotesExecutados: number;
  } | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  // Create Row Modal
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [newChaves, setNewChaves] = useState<string>('');
  const [newState, setNewState] = useState<string>('SP');
  const [newMeta, setNewMeta] = useState<string>('');
  const [newSiteIdA, setNewSiteIdA] = useState<string>('');
  const [newDetentoraA, setNewDetentoraA] = useState<string>('');
  const [newStatusA, setNewStatusA] = useState<string>('Em andamento');
  const [newCidadeA, setNewCidadeA] = useState<string>('');
  const [newSiteIdB, setNewSiteIdB] = useState<string>('');
  const [newDetentoraB, setNewDetentoraB] = useState<string>('');
  const [newStatusB, setNewStatusB] = useState<string>('Em andamento');
  const [newCidadeB, setNewCidadeB] = useState<string>('');
  const [newEquipe, setNewEquipe] = useState<string>('');
  const [newServico, setNewServico] = useState<string>('LOS A / LOS e Vistoria B');
  const [creatingRow, setCreatingRow] = useState<boolean>(false);

  // Row Detail / Edit Drawer
  const [selectedRow, setSelectedRow] = useState<EricssonRow | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  // Ericsson Independent Users & Teams state
  const [newUserName, setNewUserName] = useState<string>('');
  const [newUserEmail, setNewUserEmail] = useState<string>('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('Vistoriador');
  const [newUserEquipe, setNewUserEquipe] = useState<string>('');
  const [newUserTelefone, setNewUserTelefone] = useState<string>('');
  const [newUserAtividade, setNewUserAtividade] = useState<string>('Vistoria / LOS Ericsson');
  const [userFormError, setUserFormError] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState<boolean>(false);

  const originalColumns = useMemo(() => {
    if (sheetMeta?.columns && sheetMeta.columns.length > 0) {
      return sheetMeta.columns;
    }
    return [...ERICSSON_ORIGINAL_COLUMNS];
  }, [sheetMeta]);

  const searchTokens = useMemo(() => {
    const raw = searchQuery.trim().toUpperCase();
    if (!raw) return [];
    return raw
      .split(/[\n\r,;|\t\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [searchQuery]);

  const hasFullAccess =
    effectiveRole === 'ADM' || effectiveRole === 'Coordenador Geral';

  // Executors and Vistoriadores only see rows demanded/assigned to their Equipe, Name, or Linked Email
  const roleScopedRows = useMemo(() => {
    if (
      hasFullAccess ||
      effectiveRole === 'Coordenador Engenharia'
    ) {
      return rows;
    }
    return rows.filter((r) => doesEricssonRowMatchResponsible(r, user));
  }, [rows, hasFullAccess, effectiveRole, user]);

  const distinctStates = useMemo(() => {
    const set = new Set<string>();
    roleScopedRows.forEach((r) => {
      const val = (r.state || r.fields?.['00.03.State'] || '').trim();
      if (val) set.add(val);
    });
    return Array.from(set).sort();
  }, [roleScopedRows]);

  const distinctEquipes = useMemo(() => {
    const set = new Set<string>();
    // Exclusively Ericsson teams from rows
    roleScopedRows.forEach((r) => {
      const val = (r.equipe || r.fields?.['EQUIPE'] || '').trim();
      if (val && val !== '—' && val !== '-' && val !== 'Cancelado') set.add(val);
    });
    // Plus registered Ericsson users' teams
    ericssonUsers.forEach((u) => {
      const val = (u.equipe || '').trim();
      if (val && !val.startsWith('Coordenação') && val !== 'Ameta Telecom') set.add(val);
    });
    return Array.from(set).sort();
  }, [roleScopedRows, ericssonUsers]);

  const distinctSheetStatuses = useMemo(() => {
    const set = new Set<string>();
    roleScopedRows.forEach((r) => {
      const sA = (r.statusA || r.fields?.['Status A'] || '').trim();
      const sB = (r.statusB || r.fields?.['Status B'] || '').trim();
      if (sA) set.add(sA);
      if (sB) set.add(sB);
    });
    return Array.from(set).sort();
  }, [roleScopedRows]);

  const filteredRows = useMemo(() => {
    return roleScopedRows.filter((r) => {
      const rState = (r.state || r.fields?.['00.03.State'] || '').trim();
      const rMeta = (r.meta || r.fields?.['Meta'] || '').trim();
      const rEquipe = (r.equipe || r.fields?.['EQUIPE'] || '').trim();
      const rStatusA = (r.statusA || r.fields?.['Status A'] || '').trim();
      const rStatusB = (r.statusB || r.fields?.['Status B'] || '').trim();

      if (filterState !== 'ALL' && rState !== filterState) return false;
      if (filterMeta !== 'ALL' && rMeta !== filterMeta) return false;
      if (filterEquipe !== 'ALL' && rEquipe !== filterEquipe) return false;
      if (
        filterSheetStatus !== 'ALL' &&
        rStatusA !== filterSheetStatus &&
        rStatusB !== filterSheetStatus
      ) {
        return false;
      }

      const isAFinalizado = r.siteAVistoriaStatus === 'Entregue';
      const isBFinalizado = r.siteBVistoriaStatus === 'Entregue';
      const isLosFinalizado = r.losStatus === 'Entregue';
      const isSmartFinalizado = r.smartStatus === 'Entregue';
      const isSdcFinalizado = r.sdcStatus === 'Entregue';

      if (filterVistoriaStatus === 'FINALIZADO') {
        if (!isAFinalizado && !isBFinalizado) return false;
      } else if (filterVistoriaStatus === 'PENDENTE') {
        if (isAFinalizado && isBFinalizado) return false;
      } else if (filterVistoriaStatus === 'LOS_FINALIZADO') {
        if (!isLosFinalizado) return false;
      } else if (filterVistoriaStatus === 'LOS_PENDENTE') {
        if (isLosFinalizado) return false;
      } else if (filterVistoriaStatus === 'SMART_FINALIZADO') {
        if (!isSmartFinalizado) return false;
      } else if (filterVistoriaStatus === 'SMART_PENDENTE') {
        if (isSmartFinalizado) return false;
      } else if (filterVistoriaStatus === 'SDC_FINALIZADO') {
        if (!isSdcFinalizado) return false;
      } else if (filterVistoriaStatus === 'SDC_PENDENTE') {
        if (isSdcFinalizado) return false;
      }

      if (searchTokens.length === 0) return true;

      if (searchTokens.length > 1) {
        const sA = (r.siteIdA || '').toUpperCase();
        const sB = (r.siteIdB || '').toUpperCase();
        const ch = (r.chaves || '').toUpperCase();
        const reg = (r.registro || '').toUpperCase();
        return searchTokens.some(
          (tok) =>
            sA.includes(tok) ||
            sB.includes(tok) ||
            ch.includes(tok) ||
            reg.includes(tok)
        );
      }

      const q = searchTokens[0];
      if (
        (r.siteIdA || '').toUpperCase().includes(q) ||
        (r.siteIdB || '').toUpperCase().includes(q) ||
        (r.chaves || '').toUpperCase().includes(q) ||
        (r.registro || '').toUpperCase().includes(q) ||
        (r.cidadeA || '').toUpperCase().includes(q) ||
        (r.cidadeB || '').toUpperCase().includes(q) ||
        rEquipe.toUpperCase().includes(q) ||
        rState.toUpperCase().includes(q)
      ) {
        return true;
      }

      for (const val of Object.values(r.fields || {})) {
        if (String(val || '').toUpperCase().includes(q)) return true;
      }
      return false;
    });
  }, [
    roleScopedRows,
    filterState,
    filterMeta,
    filterEquipe,
    filterSheetStatus,
    filterVistoriaStatus,
    searchTokens,
  ]);

  // Top Counters: COUNTED BY SITE (plus LOS, SMART, SDC counters)
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

  const smartCounters = useMemo(() => {
    let entregues = 0;
    let pendentes = 0;
    filteredRows.forEach((r) => {
      if (r.smartStatus === 'Entregue') entregues++;
      else pendentes++;
    });
    return { entregues, pendentes };
  }, [filteredRows]);

  const sdcCounters = useMemo(() => {
    let entregues = 0;
    let pendentes = 0;
    filteredRows.forEach((r) => {
      if (r.sdcStatus === 'Entregue') entregues++;
      else pendentes++;
    });
    return { entregues, pendentes };
  }, [filteredRows]);

  // Charts Data (all counted by Site!)
  const chartDataByState = useMemo(() => {
    const map = new Map<
      string,
      { state: string; totalSites: number; finalizado: number; pendente: number }
    >();
    filteredRows.forEach((r) => {
      const st = (r.state || r.fields?.['00.03.State'] || 'N/I').trim() || 'N/I';
      const entry = map.get(st) || { state: st, totalSites: 0, finalizado: 0, pendente: 0 };
      if ((r.siteIdA || '').trim()) {
        entry.totalSites++;
        if (r.siteAVistoriaStatus === 'Entregue') entry.finalizado++;
        else entry.pendente++;
      }
      if ((r.siteIdB || '').trim()) {
        entry.totalSites++;
        if (r.siteBVistoriaStatus === 'Entregue') entry.finalizado++;
        else entry.pendente++;
      }
      map.set(st, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.totalSites - a.totalSites);
  }, [filteredRows]);

  const chartDataBySheetStatus = useMemo(() => {
    const map = new Map<string, number>();
    filteredRows.forEach((r) => {
      if ((r.siteIdA || '').trim()) {
        const sA = (r.statusA || r.fields?.['Status A'] || 'Sem Status').trim();
        map.set(sA, (map.get(sA) || 0) + 1);
      }
      if ((r.siteIdB || '').trim()) {
        const sB = (r.statusB || r.fields?.['Status B'] || 'Sem Status').trim();
        map.set(sB, (map.get(sB) || 0) + 1);
      }
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredRows]);

  const chartDataByEquipe = useMemo(() => {
    const map = new Map<
      string,
      { equipe: string; sites: number; finalizados: number; pendentes: number }
    >();
    filteredRows.forEach((r) => {
      const eq = (r.equipe || r.fields?.['EQUIPE'] || 'Sem Equipe').trim() || 'Sem Equipe';
      const item = map.get(eq) || { equipe: eq, sites: 0, finalizados: 0, pendentes: 0 };
      if ((r.siteIdA || '').trim()) {
        item.sites++;
        if (r.siteAVistoriaStatus === 'Entregue') item.finalizados++;
        else item.pendentes++;
      }
      if ((r.siteIdB || '').trim()) {
        item.sites++;
        if (r.siteBVistoriaStatus === 'Entregue') item.finalizados++;
        else item.pendentes++;
      }
      map.set(eq, item);
    });
    return Array.from(map.values())
      .sort((a, b) => b.sites - a.sites)
      .slice(0, 15);
  }, [filteredRows]);

  // Toggle Finalizado / Pendente directly on A, B, LOS, SMART, or SDC in the normal spreadsheet
  const handleToggleFinalizado = async (
    row: EricssonRow,
    side: 'A' | 'B' | 'LOS' | 'SMART' | 'SDC' | 'BOTH',
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    const key = `${row.id}:${side}`;
    setTogglingRowKey(key);
    try {
      const updatedRow: EricssonRow = { ...row, updatedAt: new Date().toISOString() };
      if (side === 'A') {
        updatedRow.siteAVistoriaStatus = row.siteAVistoriaStatus === 'Entregue' ? 'Pendente' : 'Entregue';
      } else if (side === 'B') {
        updatedRow.siteBVistoriaStatus = row.siteBVistoriaStatus === 'Entregue' ? 'Pendente' : 'Entregue';
      } else if (side === 'LOS') {
        updatedRow.losStatus = row.losStatus === 'Entregue' ? 'Pendente' : 'Entregue';
      } else if (side === 'SMART') {
        updatedRow.smartStatus = row.smartStatus === 'Entregue' ? 'Pendente' : 'Entregue';
      } else if (side === 'SDC') {
        updatedRow.sdcStatus = row.sdcStatus === 'Entregue' ? 'Pendente' : 'Entregue';
      }
      await dataService.salvarSiteEricsson(updatedRow);
      if (selectedRow && selectedRow.id === row.id) {
        setSelectedRow(updatedRow);
      }
      onUpdated(
        rows.map((r) => (r.id === row.id ? updatedRow : r)),
        sheetMeta,
        'Status atualizado no Firestore!'
      );
    } catch (err: any) {
      console.error('Erro ao atualizar status no Firestore [ericsson_sites]:', err);
    } finally {
      setTogglingRowKey(null);
    }
  };

  // Delete Vistoria A, Vistoria B, LOS, SMART, or SDC file from an Ericsson row
  const handleDeleteRowFile = async (
    row: EricssonRow,
    side: 'A' | 'B' | 'LOS' | 'SMART' | 'SDC',
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    try {
      const updatedRow: any = { ...row, updatedAt: new Date().toISOString() };
      if (side === 'A') {
        delete updatedRow.siteAFile;
        delete updatedRow.siteAFileId;
      } else if (side === 'B') {
        delete updatedRow.siteBFile;
        delete updatedRow.siteBFileId;
      } else if (side === 'LOS') {
        delete updatedRow.losFile;
        delete updatedRow.losFileId;
      }
      await dataService.salvarSiteEricsson(updatedRow);
      if (selectedRow && selectedRow.id === row.id) {
        setSelectedRow(updatedRow);
      }
      onUpdated(
        rows.map((r) => (r.id === row.id ? updatedRow : r)),
        sheetMeta,
        'Arquivo desvinculado no Firestore!'
      );
    } catch (err: any) {
      console.error('Erro ao desvincular anexo no Firestore [ericsson_sites]:', err);
    }
  };

  // Upload new version of .xlsx spreadsheet from computer (append-only protection)
  const handleUploadLocalExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSyncError(null);
    setSyncLoading(true);
    setImportSummary(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const parsed = parseEricssonWorkbookBuffer(arrayBuffer);
      if (parsed.rows.length === 0) {
        setSyncError('Nenhuma linha válida encontrada na planilha selecionada.');
        setSyncLoading(false);
        return;
      }

      const res = await dataService.importarSitesEricssonEmLote(parsed.rows as any, ericssonUsers, undefined, {
        mode: 'append_only',
      });

      setImportSummary(res);
      if (res.errorMessage) {
        setSyncError(res.errorMessage);
      } else {
        onUpdated(
          parsed.rows as any,
          sheetMeta,
          `Planilha "${file.name}" importada com sucesso (+${res.novas} novos registros gravados, ${res.jaExistiam} já existiam mantidos).`
        );
      }
    } catch (err: any) {
      console.error('Erro ao ler ou importar planilha Ericsson:', err);
      setSyncError(`Falha ao ler o arquivo Excel (.xlsx) ou gravar no Firestore: ${err?.message || String(err)}`);
    } finally {
      setSyncLoading(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  // Export Ericsson spreadsheet to .xlsx (original columns + Vistoria A, Vistoria B, and LOS)
  const handleExportExcel = () => {
    const exportData = filteredRows.map((r) => {
      const rowObj: Record<string, string> = {};
      originalColumns.forEach((col) => {
        rowObj[col] = r.fields?.[col] ?? '';
      });
      rowObj['Vistoria Site A'] = r.siteAVistoriaStatus || 'Pendente';
      rowObj['Vistoria Site B'] = r.siteBVistoriaStatus || 'Pendente';
      rowObj['LOS'] = r.losStatus || 'Pendente';
      rowObj['SMART'] = r.smartStatus || 'Pendente';
      rowObj['SDC'] = r.sdcStatus || 'Pendente';
      return rowObj;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ERICSSON CLARO TX');
    XLSX.writeFile(
      wb,
      `Ericsson_Claro_TX_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  // Create new row
  const handleCreateRow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSiteIdA.trim() && !newSiteIdB.trim()) return;
    setCreatingRow(true);
    try {
      const newId = `eric_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newRow: EricssonRow = {
        id: newId,
        rowKey: `${newChaves.trim()}_${newSiteIdA.trim()}_${newSiteIdB.trim()}`,
        registro: '',
        siteName: `${newSiteIdA.trim()} / ${newSiteIdB.trim()}`,
        chaves: newChaves.trim(),
        state: newState.trim(),
        meta: newMeta.trim(),
        siteIdA: newSiteIdA.trim().toUpperCase(),
        idDetentoraA: newDetentoraA.trim(),
        statusA: newStatusA.trim(),
        cidadeA: newCidadeA.trim(),
        siteIdB: newSiteIdB.trim().toUpperCase(),
        idDetentoraB: newDetentoraB.trim(),
        statusB: newStatusB.trim(),
        cidadeB: newCidadeB.trim(),
        equipe: newEquipe.trim(),
        servico: newServico.trim(),
        siteAVistoriaStatus: 'Pendente',
        siteBVistoriaStatus: 'Pendente',
        updatedAt: new Date().toISOString(),
        fields: {
          '01.00. Chaves': newChaves.trim(),
          '00.03.State': newState.trim(),
          Meta: newMeta.trim(),
          '01.21.Site ID A': newSiteIdA.trim().toUpperCase(),
          'ID Detentora A': newDetentoraA.trim(),
          'Status A': newStatusA.trim(),
          'CIDADE A': newCidadeA.trim(),
          '01.21.Site ID B': newSiteIdB.trim().toUpperCase(),
          'ID Detentora B': newDetentoraB.trim(),
          'Status B': newStatusB.trim(),
          'CIDADE B': newCidadeB.trim(),
          EQUIPE: newEquipe.trim(),
          Serviço: newServico.trim(),
        },
      };
      await dataService.salvarSiteEricsson(newRow);
      onUpdated(
        [newRow, ...rows],
        sheetMeta,
        `Nova linha Ericsson criada no Firestore (${newSiteIdA.toUpperCase()} ↔ ${newSiteIdB.toUpperCase()})`
      );
      setCreateModalOpen(false);
      setNewChaves('');
      setNewSiteIdA('');
      setNewSiteIdB('');
    } catch (err: any) {
      console.error('Erro ao criar linha no Firestore [ericsson_sites]:', err);
    } finally {
      setCreatingRow(false);
    }
  };

  // Save edited row fields
  const handleSaveRowEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRow) return;
    setSavingEdit(true);
    try {
      const updatedRow: EricssonRow = {
        ...selectedRow,
        fields: editFields,
        chaves: editFields['01.00. Chaves'] || selectedRow.chaves,
        state: editFields['00.03.State'] || selectedRow.state,
        meta: editFields['Meta'] || selectedRow.meta,
        siteIdA: editFields['01.21.Site ID A'] || selectedRow.siteIdA,
        idDetentoraA: editFields['ID Detentora A'] || selectedRow.idDetentoraA,
        statusA: editFields['Status A'] || selectedRow.statusA,
        cidadeA: editFields['CIDADE A'] || selectedRow.cidadeA,
        siteIdB: editFields['01.21.Site ID B'] || selectedRow.siteIdB,
        idDetentoraB: editFields['ID Detentora B'] || selectedRow.idDetentoraB,
        statusB: editFields['Status B'] || selectedRow.statusB,
        cidadeB: editFields['CIDADE B'] || selectedRow.cidadeB,
        equipe: editFields['EQUIPE'] || selectedRow.equipe,
        servico: editFields['Serviço'] || selectedRow.servico,
        updatedAt: new Date().toISOString(),
      };
      await dataService.salvarSiteEricsson(updatedRow);
      onUpdated(
        rows.map((r) => (r.id === updatedRow.id ? updatedRow : r)),
        sheetMeta,
        'Linha da planilha Ericsson atualizada no Firestore!'
      );
      setSelectedRow(updatedRow);
    } catch (err: any) {
      console.error('Erro ao atualizar no Firestore [ericsson_sites]:', err);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteRow = async (row: EricssonRow) => {
    try {
      await dataService.excluirSiteEricsson(row.id);
      onUpdated(
        rows.filter((r) => r.id !== row.id),
        sheetMeta,
        'Linha removida do Firestore.'
      );
      if (selectedRow?.id === row.id) setSelectedRow(null);
    } catch (err: any) {
      console.error('Erro ao excluir no Firestore [ericsson_sites]:', err);
    }
  };

  const handleCreateEricssonUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserFormError(null);
    if (!newUserName.trim() || !newUserEmail.trim()) {
      setUserFormError('Informe nome e e-mail do colaborador Ericsson.');
      return;
    }
    setSavingUser(true);
    try {
      const newUser = await dataService.registrarNovoUsuarioCorporativo({
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        password: 'ameta' + Math.floor(1000 + Math.random() * 9000),
        role: newUserRole,
        equipe: newUserEquipe.trim(),
        telefone: newUserTelefone.trim(),
        plataforma: 'ERICSSON',
      });
      onEricssonUsersUpdated(
        [...ericssonUsers, newUser],
        `Colaborador "${newUserName.trim()}" cadastrado no Firestore!`
      );
      setNewUserName('');
      setNewUserEmail('');
      setNewUserEquipe('');
      setNewUserTelefone('');
    } catch (err: any) {
      console.error('Erro ao cadastrar colaborador no Firestore [usuarios]:', err);
      setUserFormError(err?.message || 'Erro ao cadastrar colaborador no Firestore.');
    } finally {
      setSavingUser(false);
    }
  };

  const handleDeleteEricssonUser = async (u: AmetaUser) => {
    try {
      await dataService.bloquearUsuario(u.uid || u.id, 'Bloqueado no módulo Ericsson');
      onEricssonUsersUpdated(
        ericssonUsers.map((usr) =>
          usr.id === u.id ? { ...usr, situacao: 'bloqueado' as const, accessReleased: false } : usr
        ),
        `Colaborador "${u.name}" bloqueado no Firestore.`
      );
    } catch (err: any) {
      console.error('Erro ao bloquear colaborador no Firestore [usuarios]:', err);
    }
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

  // Control for Vistoria A, Vistoria B, and LOS in the Mother Spreadsheet (Sites):
  // Displays Entregue / Dispensado / Pendente and ONLY ONE shortcut that navigates to the file in the Vistoria folder
  const renderVistoriaOrLosCell = (row: EricssonRow, side: 'A' | 'B' | 'LOS' | 'SMART' | 'SDC') => {
    const status =
      side === 'A'
        ? row.siteAVistoriaStatus || 'Pendente'
        : side === 'B'
        ? row.siteBVistoriaStatus || 'Pendente'
        : side === 'LOS'
        ? row.losStatus || 'Pendente'
        : side === 'SMART'
        ? row.smartStatus || 'Pendente'
        : row.sdcStatus || 'Pendente';

    const fileId =
      side === 'A'
        ? row.siteAVistoriaFileId
        : side === 'B'
        ? row.siteBVistoriaFileId
        : side === 'LOS'
        ? row.losFileId
        : side === 'SMART'
        ? row.smartFileId
        : row.sdcFileId;

    const folderId =
      side === 'A'
        ? row.siteAVistoriaFolderId
        : side === 'B'
        ? row.siteBVistoriaFolderId
        : side === 'LOS'
        ? row.losFolderId
        : side === 'SMART'
        ? row.smartFolderId
        : row.sdcFolderId;

    const fileName =
      side === 'A'
        ? row.siteAVistoriaFileName
        : side === 'B'
        ? row.siteBVistoriaFileName
        : side === 'LOS'
        ? row.losFileName
        : side === 'SMART'
        ? row.smartFileName
        : row.sdcFileName;

    const isToggling = togglingRowKey === `${row.id}:${side}`;

    return (
      <div
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          disabled={isToggling}
          onClick={(e) => handleToggleFinalizado(row, side, e)}
          title={
            status === 'Entregue'
              ? `${side}: Entregue (clique para alternar status)`
              : status === 'Dispensado'
              ? `${side}: Dispensado (a outra ponta foi entregue — clique se desejar marcar este lado como Entregue)`
              : `${side}: Pendente (clique para marcar como Entregue)`
          }
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
            status === 'Entregue'
              ? side === 'SMART'
                ? 'bg-violet-50 text-violet-700 border-violet-300 hover:bg-violet-100'
                : side === 'SDC'
                ? 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100'
                : side === 'LOS'
                ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                : 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
              : status === 'Dispensado'
              ? 'bg-sky-50 text-sky-700 border-sky-300 hover:bg-sky-100'
              : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
          }`}
        >
          {status === 'Entregue' ? (
            <>
              <CheckCircle2
                className={`w-3 h-3 shrink-0 ${
                  side === 'SMART'
                    ? 'text-violet-600'
                    : side === 'SDC'
                    ? 'text-rose-600'
                    : side === 'LOS'
                    ? 'text-amber-600'
                    : 'text-emerald-600'
                }`}
              />
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

        {/* SHORTCUT: Takes user directly to the file inside the Vistoria folder + Delete option */}
        {status === 'Entregue' && fileName && onOpenFileInVistoriaFolder && (
          <button
            type="button"
            onClick={() => onOpenFileInVistoriaFolder(folderId, fileId, fileName)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-[10px] font-semibold max-w-[135px] truncate cursor-pointer"
            title={`Ir para o arquivo "${fileName}" na Pasta de Vistoria`}
          >
            <FolderOpen className="w-3 h-3 text-amber-600 shrink-0" />
            <span className="truncate">Ver na Vistoria</span>
          </button>
        )}

        {fileName && (
          <button
            type="button"
            onClick={(e) => handleDeleteRowFile(row, side, e)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[10px] font-bold cursor-pointer"
            title={`Excluir arquivo "${fileName}"`}
          >
            <Trash2 className="w-2.5 h-2.5 shrink-0" />
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
          1. TOP HEADER & COUNTERS BY INDIVIDUAL SITE + LOS
         ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-[#223585] flex items-center justify-center text-white shadow-2xs shrink-0">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-md bg-blue-50 text-[#223585] border border-blue-200 text-[11px] font-bold uppercase tracking-wider">
                  ERICSSON · {sheetMeta?.tabName || 'ERICSSON CLARO TX'}
                </span>
                <h1 className="text-base font-bold text-slate-900">
                  Controle de Sites, Vistorias (A e B) e LOS — Ericsson
                </h1>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Planilha Online:{' '}
                <strong className="text-slate-700">
                  {sheetMeta?.sourceFileName || 'PLAN. AMETA_Controle EDB.xlsx'}
                </strong>{' '}
                • Contagem por <strong>Site Individual</strong> (Site A, Site B) e coluna dedicada de{' '}
                <strong>LOS</strong>.
              </p>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="w-full sm:w-auto grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2">
            {hasFullAccess && (
              <>
                {onOpenDuplasDemanda && (
                  <button
                    type="button"
                    onClick={onOpenDuplasDemanda}
                    className="w-full sm:w-auto justify-center px-4 py-3 sm:py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wide rounded-xl sm:rounded-lg transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
                  >
                    <Users className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Demandar Sites / Duplas (Ericsson)</span>
                  </button>
                )}

                <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setSyncModalOpen(true)}
                    className="justify-center px-3 py-2.5 sm:py-2 bg-[#1E8E8D] hover:bg-[#177372] text-white text-xs font-bold rounded-xl sm:rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Atualizar Planilha</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCreateModalOpen(true)}
                    className="justify-center px-3 py-2.5 sm:py-2 bg-[#223585] hover:bg-[#192869] text-white text-xs font-bold rounded-xl sm:rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">+ Nova Linha</span>
                  </button>
                </div>
              </>
            )}

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleExportExcel}
                className="flex-1 sm:flex-initial justify-center px-3.5 py-2.5 sm:py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold rounded-xl sm:rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#1E8E8D] shrink-0" />
                <span>Exportar .XLSX</span>
              </button>

              <button
                type="button"
                onClick={() => setIsFullscreen((prev) => !prev)}
                className="p-2.5 sm:p-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl sm:rounded-lg transition-colors shadow-2xs cursor-pointer"
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
        </div>

        {/* SITE COUNTERS BAR (COUNTED BY SITE + LOS) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-1">
          <button
            type="button"
            onClick={() => {
              setFilterVistoriaStatus('ALL');
              setFilterSheetStatus('ALL');
            }}
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterVistoriaStatus === 'ALL' && filterSheetStatus === 'ALL'
                ? 'bg-blue-50/70 border-[#223585] ring-1 ring-[#223585]/20'
                : 'bg-slate-50/70 hover:bg-slate-100/70 border-slate-200'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Total de Sites (A + B)
            </div>
            <div className="text-2xl font-extrabold font-mono text-slate-900 mt-0.5 tabular-nums">
              {siteCounters.totalSites}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Em {siteCounters.totalPairs} linhas (enlaces)
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setFilterVistoriaStatus((prev) =>
                prev === 'FINALIZADO' ? 'ALL' : 'FINALIZADO'
              )
            }
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterVistoriaStatus === 'FINALIZADO'
                ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500/20'
                : 'bg-emerald-50/40 hover:bg-emerald-50 border-emerald-200'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 flex items-center justify-between">
              <span>Vistorias Finalizadas (A+B)</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold font-mono text-emerald-700 mt-0.5 tabular-nums">
              {siteCounters.vistoriaEntregueSites}
            </div>
            <div className="text-[10px] text-emerald-700/80 mt-0.5">
              Sites A/B entregues
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setFilterVistoriaStatus((prev) =>
                prev === 'PENDENTE' ? 'ALL' : 'PENDENTE'
              )
            }
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterVistoriaStatus === 'PENDENTE'
                ? 'bg-red-50 border-red-500 ring-1 ring-red-500/20'
                : 'bg-red-50/40 hover:bg-red-50 border-red-200'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-red-700 flex items-center justify-between">
              <span>Vistorias Pendentes (A+B)</span>
              <Clock className="w-3.5 h-3.5 text-red-600" />
            </div>
            <div className="text-2xl font-extrabold font-mono text-red-700 mt-0.5 tabular-nums">
              {siteCounters.vistoriaPendenteSites}
            </div>
            <div className="text-[10px] text-red-700/80 mt-0.5">
              Sites A/B pendentes
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setFilterVistoriaStatus((prev) =>
                prev === 'LOS_FINALIZADO' ? 'ALL' : 'LOS_FINALIZADO'
              )
            }
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterVistoriaStatus === 'LOS_FINALIZADO'
                ? 'bg-amber-50 border-amber-500 ring-1 ring-amber-500/20'
                : 'bg-amber-50/40 hover:bg-amber-50 border-amber-200'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800 flex items-center justify-between">
              <span>LOS Finalizados</span>
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
              setFilterVistoriaStatus((prev) =>
                prev === 'SMART_FINALIZADO' ? 'ALL' : 'SMART_FINALIZADO'
              )
            }
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterVistoriaStatus === 'SMART_FINALIZADO'
                ? 'bg-violet-50 border-violet-500 ring-1 ring-violet-500/20'
                : 'bg-violet-50/40 hover:bg-violet-50 border-violet-200'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-violet-800 flex items-center justify-between">
              <span>SMART Entregues</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-violet-600" />
            </div>
            <div className="text-2xl font-extrabold font-mono text-violet-800 mt-0.5 tabular-nums">
              {smartCounters.entregues}
            </div>
            <div className="text-[10px] text-violet-800/80 mt-0.5">
              {smartCounters.pendentes} SMART pendentes
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setFilterVistoriaStatus((prev) =>
                prev === 'SDC_FINALIZADO' ? 'ALL' : 'SDC_FINALIZADO'
              )
            }
            className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              filterVistoriaStatus === 'SDC_FINALIZADO'
                ? 'bg-rose-50 border-rose-500 ring-1 ring-rose-500/20'
                : 'bg-rose-50/40 hover:bg-rose-50 border-rose-200'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-rose-800 flex items-center justify-between">
              <span>SDC Entregues</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-rose-600" />
            </div>
            <div className="text-2xl font-extrabold font-mono text-rose-800 mt-0.5 tabular-nums">
              {sdcCounters.entregues}
            </div>
            <div className="text-[10px] text-rose-800/80 mt-0.5">
              {sdcCounters.pendentes} SDC pendentes
            </div>
          </button>

          <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200">
            <div className="text-[10px] font-bold uppercase tracking-wider text-teal-700">
              Status Planilha: Liberado
            </div>
            <div className="text-2xl font-extrabold font-mono text-teal-700 mt-0.5 tabular-nums">
              {siteCounters.statusConcluidoSites}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Sites liberados (A + B)
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#223585]">
              Em Andamento / Campo
            </div>
            <div className="text-2xl font-extrabold font-mono text-[#223585] mt-0.5 tabular-nums">
              {siteCounters.statusEmAndamentoSites}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Sites em execução (A + B)
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          2. VIEW SWITCHER, SMART SEARCH & FILTERS BAR
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
              <span>Visão Resumo (Site A, Site B e LOS)</span>
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
              <span>Planilha Completa ({originalColumns.length} col + A, B e LOS)</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('graficos')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'graficos'
                  ? 'bg-[#223585] text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Gráficos (Por Site)</span>
            </button>

            {hasFullAccess && (
              <button
                type="button"
                onClick={() => {
                  if (onOpenDuplasDemanda) {
                    onOpenDuplasDemanda();
                  } else {
                    setViewMode('equipes');
                  }
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'equipes'
                    ? 'bg-[#223585] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Duplas & Demanda ({ericssonUsers.length})</span>
              </button>
            )}
          </div>

          {(viewMode === 'resumo' || viewMode === 'planilha') && (
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
          )}
        </div>

        {/* Smart Search & Filters */}
        {viewMode !== 'equipes' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 pt-1">
            <div className="md:col-span-4 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Busca inteligente ou cole vários Site IDs (A ou B), Chaves, Cidade..."
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
              {searchTokens.length > 1 && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#223585] font-semibold">
                  <span>
                    Multi-busca ativa: {searchTokens.length} códigos colados ({filteredRows.length}{' '}
                    linhas / {siteCounters.totalSites} sites encontrados)
                  </span>
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <select
                value={filterState}
                onChange={(e) => setFilterState(e.target.value)}
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium focus:outline-none focus:border-[#223585]"
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
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium focus:outline-none focus:border-[#223585]"
              >
                <option value="ALL">EQUIPE: Todas ({distinctEquipes.length})</option>
                {distinctEquipes.map((eq) => (
                  <option key={eq} value={eq}>
                    {eq}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <select
                value={filterSheetStatus}
                onChange={(e) => setFilterSheetStatus(e.target.value)}
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium focus:outline-none focus:border-[#223585]"
              >
                <option value="ALL">Status Site (A/B): Todos</option>
                {distinctSheetStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <select
                value={filterVistoriaStatus}
                onChange={(e) =>
                  setFilterVistoriaStatus(
                    e.target.value as
                      | 'ALL'
                      | 'FINALIZADO'
                      | 'PENDENTE'
                      | 'LOS_FINALIZADO'
                      | 'LOS_PENDENTE'
                      | 'SMART_FINALIZADO'
                      | 'SMART_PENDENTE'
                      | 'SDC_FINALIZADO'
                      | 'SDC_PENDENTE'
                  )
                }
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium focus:outline-none focus:border-[#223585]"
              >
                <option value="ALL">Filtro Documentos / Vistorias: Todos</option>
                <option value="FINALIZADO">Vistoria A/B Finalizado</option>
                <option value="PENDENTE">Vistoria A/B Pendente</option>
                <option value="LOS_FINALIZADO">LOS Finalizado ({losCounters.entregues})</option>
                <option value="LOS_PENDENTE">LOS Pendente ({losCounters.pendentes})</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* =====================================================================
          3A. VIEW MODE: RESUMO (SITE A, SITE B, AND NEW LOS COLUMN)
         ===================================================================== */}
      {viewMode === 'resumo' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-[#223585]" />
              <span>
                Exibindo <strong>{siteCounters.totalSites}</strong> sites em{' '}
                <strong>{filteredRows.length}</strong> linhas. Colunas de controle:{' '}
                <strong className="text-[#223585]">Vistoria A</strong>,{' '}
                <strong className="text-[#1E8E8D]">Vistoria B</strong> e{' '}
                <strong className="text-amber-700">LOS</strong>.
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> Entregue
              </span>
              <span className="inline-flex items-center gap-1 text-sky-700 font-semibold">
                <span className="w-2 h-2 rounded-full bg-sky-500" /> Dispensado
              </span>
              <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                <span className="w-2 h-2 rounded-full bg-red-500" /> Pendente
              </span>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[680px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-wider text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3 font-bold">01.00. Chaves</th>
                  <th className="py-2.5 px-2.5 font-bold">00.03.State</th>
                  <th className="py-2.5 px-2.5 font-bold">Meta</th>
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
                  <th className="py-2.5 px-2.5 font-bold">Serviço</th>
                  <th className="py-2.5 px-3 font-bold bg-blue-50 text-[#223585] border-l border-slate-200">
                    Vistoria A
                  </th>
                  <th className="py-2.5 px-3 font-bold bg-teal-50 text-[#1E8E8D] border-l border-slate-200">
                    Vistoria B
                  </th>
                  <th className="py-2.5 px-3 font-bold bg-amber-50 text-amber-800 border-l border-slate-200">
                    LOS
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-6 py-12 text-center text-slate-500">
                      <div className="max-w-md mx-auto space-y-3">
                        <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                          <FileSpreadsheet className="w-6 h-6" />
                        </div>
                        <div className="font-bold text-slate-800 text-sm">
                          {!hasFullAccess
                            ? 'Nenhum site demandado para você no momento'
                            : rows.length === 0
                            ? 'Nenhum site encontrado no Firestore (ericsson_sites)'
                            : 'Nenhum site corresponde aos filtros selecionados'}
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          {!hasFullAccess
                            ? 'Aguarde a atribuição de demandas pela coordenação da Ameta Telecom.'
                            : rows.length === 0
                            ? 'A coleção ericsson_sites está vazia no banco ameta-sistema-teste. Utilize o botão abaixo para importar a planilha oficial (.xlsx) ou importe os dados iniciais no Painel de Admin.'
                            : 'Tente alterar ou limpar os filtros de busca para visualizar os sites cadastrados.'}
                        </p>
                        {rows.length === 0 && hasFullAccess && (
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => setSyncModalOpen(true)}
                              className="px-4 py-2 bg-[#1E8E8D] hover:bg-[#177372] text-white font-bold text-xs rounded-lg inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                            >
                              <Upload className="w-4 h-4" />
                              <span>Importar Planilha Ericsson (.xlsx)</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
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
                      <td className={`${cellPad} text-slate-600 whitespace-nowrap`}>
                        {row.meta || row.fields?.['Meta'] || '—'}
                      </td>

                      {/* SITE A */}
                      <td
                        className={`${cellPad} font-mono font-bold text-[#223585] bg-blue-50/20 border-l border-slate-200 whitespace-nowrap`}
                      >
                        {row.siteIdA || '—'}
                      </td>
                      <td className={`${cellPad} bg-blue-50/20`}>
                        {renderSheetStatusBadge(sA)}
                      </td>
                      <td className={`${cellPad} text-slate-700 bg-blue-50/20 max-w-[140px] truncate`}>
                        {row.cidadeA || row.fields?.['CIDADE A'] || '—'}
                      </td>

                      {/* SITE B */}
                      <td
                        className={`${cellPad} font-mono font-bold text-[#1E8E8D] bg-teal-50/20 border-l border-slate-200 whitespace-nowrap`}
                      >
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
                      <td className={`${cellPad} text-slate-600 whitespace-nowrap`}>
                        {row.servico || row.fields?.['Serviço'] || '—'}
                      </td>

                      {/* VISTORIA A */}
                      <td className={`${cellPad} bg-blue-50/15 border-l border-slate-200`}>
                        {renderVistoriaOrLosCell(row, 'A')}
                      </td>

                      {/* VISTORIA B */}
                      <td className={`${cellPad} bg-teal-50/15 border-l border-slate-200`}>
                        {renderVistoriaOrLosCell(row, 'B')}
                      </td>

                      {/* NOVA COLUNA: LOS */}
                      <td className={`${cellPad} bg-amber-50/20 border-l border-slate-200`}>
                        {renderVistoriaOrLosCell(row, 'LOS')}
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          3B. VIEW MODE: PLANILHA COMPLETA (106 ORIGINAL COLUMNS + VISTORIA A, VISTORIA B & LOS)
         ===================================================================== */}
      {viewMode === 'planilha' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#1E8E8D]" />
              <span>
                Aba: <strong className="text-slate-900">{sheetMeta?.tabName || 'ERICSSON CLARO TX'}</strong> •{' '}
                {originalColumns.length} colunas originais do Excel + colunas{' '}
                <strong className="text-[#223585]">Vistoria A</strong>,{' '}
                <strong className="text-[#1E8E8D]">Vistoria B</strong> e{' '}
                <strong className="text-amber-700">LOS</strong>
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              Role horizontalmente para visualizar todas as colunas da planilha
            </span>
          </div>

          <div className="overflow-x-auto max-h-[680px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-wider text-slate-700 border-b border-slate-200">
                <tr>
                  {originalColumns.map((col, idx) => {
                    const isSiteA = col === '01.21.Site ID A' || col === 'Status A';
                    const isSiteB = col === '01.21.Site ID B' || col === 'Status B';
                    return (
                      <th
                        key={`${col}-${idx}`}
                        className={`py-2.5 px-3 font-bold whitespace-nowrap border-r border-slate-200 ${
                          isSiteA
                            ? 'bg-blue-50 text-[#223585]'
                            : isSiteB
                            ? 'bg-teal-50 text-[#1E8E8D]'
                            : ''
                        }`}
                      >
                        {col}
                      </th>
                    );
                  })}
                  <th className="py-2.5 px-3 font-bold whitespace-nowrap bg-blue-50 text-[#223585] border-r border-slate-200">
                    Vistoria A
                  </th>
                  <th className="py-2.5 px-3 font-bold whitespace-nowrap bg-teal-50 text-[#1E8E8D] border-r border-slate-200">
                    Vistoria B
                  </th>
                  <th className="py-2.5 px-3 font-bold whitespace-nowrap bg-amber-50 text-amber-800 border-r border-slate-200">
                    LOS
                  </th>
                  <th className="py-2.5 px-3 font-bold whitespace-nowrap bg-violet-50 text-violet-800 border-r border-slate-200">
                    SMART
                  </th>
                  <th className="py-2.5 px-3 font-bold whitespace-nowrap bg-rose-50 text-rose-800 border-r border-slate-200">
                    SDC
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={originalColumns.length + 6}
                      className="px-6 py-12 text-center text-slate-500"
                    >
                      <div className="max-w-md mx-auto space-y-3">
                        <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                          <FileSpreadsheet className="w-6 h-6" />
                        </div>
                        <div className="font-bold text-slate-800 text-sm">
                          {rows.length === 0
                            ? 'Nenhum site encontrado no Firestore (ericsson_sites)'
                            : 'Nenhum site corresponde aos filtros selecionados'}
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          {rows.length === 0
                            ? 'A coleção ericsson_sites está vazia no banco ameta-sistema-teste. Utilize o botão abaixo para importar a planilha oficial (.xlsx) ou importe os dados iniciais no Painel de Admin.'
                            : 'Tente alterar ou limpar os filtros de busca para visualizar os sites cadastrados.'}
                        </p>
                        {rows.length === 0 && (
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => setSyncModalOpen(true)}
                              className="px-4 py-2 bg-[#1E8E8D] hover:bg-[#177372] text-white font-bold text-xs rounded-lg inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                            >
                              <Upload className="w-4 h-4" />
                              <span>Importar Planilha Ericsson (.xlsx)</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
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
                      const isSiteIdA = col === '01.21.Site ID A';
                      const isSiteIdB = col === '01.21.Site ID B';
                      const isStatusA = col === 'Status A';
                      const isStatusB = col === 'Status B';

                      return (
                        <td
                          key={`${col}-${idx}`}
                          className={`${cellPad} whitespace-nowrap border-r border-slate-200/70 ${
                            isSiteIdA
                              ? 'font-mono font-bold text-[#223585] bg-blue-50/20'
                              : isSiteIdB
                              ? 'font-mono font-bold text-[#1E8E8D] bg-teal-50/20'
                              : 'text-slate-700'
                          }`}
                        >
                          {isSiteIdA ? (
                            <div className="flex items-center justify-between gap-2">
                              <span>{val || '—'}</span>
                              {val && renderVistoriaOrLosCell(row, 'A')}
                            </div>
                          ) : isSiteIdB ? (
                            <div className="flex items-center justify-between gap-2">
                              <span>{val || '—'}</span>
                              {val && renderVistoriaOrLosCell(row, 'B')}
                            </div>
                          ) : isStatusA || isStatusB ? (
                            renderSheetStatusBadge(val)
                          ) : (
                            val || '—'
                          )}
                        </td>
                      );
                    })}

                    {/* VISTORIA A */}
                    <td className={`${cellPad} whitespace-nowrap bg-blue-50/15 border-r border-slate-200`}>
                      {renderVistoriaOrLosCell(row, 'A')}
                    </td>

                    {/* VISTORIA B */}
                    <td className={`${cellPad} whitespace-nowrap bg-teal-50/15 border-r border-slate-200`}>
                      {renderVistoriaOrLosCell(row, 'B')}
                    </td>

                    {/* NOVA COLUNA: LOS */}
                    <td className={`${cellPad} whitespace-nowrap bg-amber-50/20 border-r border-slate-200`}>
                      {renderVistoriaOrLosCell(row, 'LOS')}
                    </td>

                    {/* NOVA COLUNA: SMART */}
                    <td className={`${cellPad} whitespace-nowrap bg-violet-50/20 border-r border-slate-200`}>
                      {renderVistoriaOrLosCell(row, 'SMART')}
                    </td>

                    {/* NOVA COLUNA: SDC */}
                    <td className={`${cellPad} whitespace-nowrap bg-rose-50/20 border-r border-slate-200`}>
                      {renderVistoriaOrLosCell(row, 'SDC')}
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          3C. VIEW MODE: GRÁFICOS (COUNTED BY INDIVIDUAL SITE)
         ===================================================================== */}
      {viewMode === 'graficos' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Sites por Estado (00.03.State) — Finalizados vs Pendentes
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Contagem individual por site ({siteCounters.totalSites} sites no filtro atual) — clique em um estado para filtrar
              </p>
            </div>
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {chartDataByState.map((item) => {
                const maxSites = Math.max(...chartDataByState.map((d) => d.totalSites), 1);
                const totalWidthPct = Math.max((item.totalSites / maxSites) * 100, 4);
                const finPct =
                  item.totalSites > 0 ? Math.round((item.finalizado / item.totalSites) * 100) : 0;
                const isSelected = filterState === item.state;
                return (
                  <button
                    key={item.state}
                    type="button"
                    onClick={() =>
                      setFilterState((prev) => (prev === item.state ? 'ALL' : item.state))
                    }
                    className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50/70 border-[#223585]'
                        : 'bg-slate-50/70 hover:bg-slate-100 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-mono font-bold text-slate-900">{item.state}</span>
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="text-emerald-700 font-bold">
                          {item.finalizado} finalizados
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="text-red-600 font-bold">{item.pendente} pendentes</span>
                        <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-800 font-bold">
                          {item.totalSites} sites
                        </span>
                      </div>
                    </div>
                    <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full flex overflow-hidden bg-red-500"
                        style={{ width: `${totalWidthPct}%` }}
                      >
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${finPct}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Distribuição por Status na Planilha (Status A + Status B)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Proporção dos status operacionais de cada site individualmente
              </p>
            </div>
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {chartDataBySheetStatus.map((item, index) => {
                const pct =
                  siteCounters.totalSites > 0
                    ? ((item.value / siteCounters.totalSites) * 100).toFixed(1)
                    : '0.0';
                const color = CHART_COLORS[index % CHART_COLORS.length];
                const isSelected = filterSheetStatus === item.name;
                return (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() =>
                      setFilterSheetStatus((prev) => (prev === item.name ? 'ALL' : item.name))
                    }
                    className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50/70 border-[#223585]'
                        : 'bg-slate-50/70 hover:bg-slate-100 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-bold text-slate-800">{item.name}</span>
                      <span className="font-mono text-[11px] font-bold text-slate-700">
                        {item.value} sites ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(Number(pct), 2)}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs lg:col-span-2 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Volume de Sites por Equipe Ericsson (Top 15 Equipes)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Quantidade de sites individuais atribuídos a cada equipe — clique em uma equipe para filtrar
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {chartDataByEquipe.map((item) => {
                const isSelected = filterEquipe === item.equipe;
                const pctFin =
                  item.sites > 0 ? Math.round((item.finalizados / item.sites) * 100) : 0;
                return (
                  <button
                    key={item.equipe}
                    type="button"
                    onClick={() =>
                      setFilterEquipe((prev) => (prev === item.equipe ? 'ALL' : item.equipe))
                    }
                    className={`text-left p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50/80 border-[#223585]'
                        : 'bg-slate-50/70 hover:bg-slate-100 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                      <span className="font-bold text-slate-900 truncate">{item.equipe}</span>
                      <span className="font-mono text-[11px] font-bold text-[#223585] shrink-0">
                        {item.sites} sites
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mb-1.5">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${pctFin}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                      <span className="text-emerald-700 font-semibold">
                        Finalizados: {item.finalizados}
                      </span>
                      <span className="text-red-600 font-semibold">
                        Pendentes: {item.pendentes}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          3D. VIEW MODE: EQUIPES & USUÁRIOS INDEPENDENTES ERICSSON
         ===================================================================== */}
      {viewMode === 'equipes' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4 h-fit">
            <div className="flex items-center gap-2.5 border-b border-slate-200 pb-3">
              <UserPlus className="w-5 h-5 text-[#223585]" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Novo Usuário / Equipe (Ericsson)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Cadastro exclusivo da Ericsson (não compartilha dados com a Nokia)
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateEricssonUser} className="space-y-3 text-xs">
              {userFormError && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{userFormError}</span>
                </div>
              )}

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Ex: Carlos Mendes"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-[#223585]"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">E-mail *</label>
                <input
                  type="email"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="carlos.mendes@ametaservicos.com.br"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-[#223585]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Perfil</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  >
                    <option value="Vistoriador">Vistoriador</option>
                    <option value="Executor">Executor</option>
                    <option value="ADM">ADM</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Equipe Ericsson</label>
                  <input
                    type="text"
                    value={newUserEquipe}
                    onChange={(e) => setNewUserEquipe(e.target.value)}
                    placeholder="Ex: Equipe 1"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Telefone</label>
                  <input
                    type="text"
                    value={newUserTelefone}
                    onChange={(e) => setNewUserTelefone(e.target.value)}
                    placeholder="(11) 99999-0000"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Atividade</label>
                  <input
                    type="text"
                    value={newUserAtividade}
                    onChange={(e) => setNewUserAtividade(e.target.value)}
                    placeholder="LOS / Vistoria"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingUser}
                className="w-full py-2.5 bg-[#223585] hover:bg-[#192869] disabled:opacity-50 text-white font-bold rounded-lg transition-colors cursor-pointer"
              >
                {savingUser ? 'Salvando...' : 'Cadastrar na Ericsson'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Usuários e Equipes Cadastrados na Ericsson ({ericssonUsers.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Base exclusiva da operação Ericsson (sincronizada com a aba EQUIPES da planilha Ericsson)
                </p>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 text-[10px] uppercase tracking-wider text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4">Nome</th>
                    <th className="py-2.5 px-3">Equipe</th>
                    <th className="py-2.5 px-3">Perfil</th>
                    <th className="py-2.5 px-3">Atividade</th>
                    <th className="py-2.5 px-3">Telefone</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {ericssonUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-slate-900">{u.name}</div>
                        <div className="text-[11px] text-slate-500">{u.email}</div>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#1E8E8D]">
                        {u.equipe || '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-semibold text-[11px]">
                          {u.role}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{u.atividade || '—'}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {u.telefone || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {effectiveRole === 'ADM' &&
                          u.email.toLowerCase() !== 'rafael.araujo@ametaservicos.com.br' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteEricssonUser(u)}
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                              title="Remover usuário Ericsson"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: EXCEL ONLINE / ATUALIZAR PLANILHA ERICSSON
         ===================================================================== */}
      {syncModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setSyncModalOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <CloudDownload className="w-5 h-5 text-[#1E8E8D]" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Excel Online / Atualizar Planilha Ericsson
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Atualiza os dados mantendo Vistoria A, Vistoria B e LOS já registrados
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSyncModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {syncError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-mono">{syncError}</span>
                </div>
              )}

              {importSummary && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Resultado da Importação no Firestore:</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1">
                    <div className="bg-white p-2 rounded border border-emerald-100">
                      <span className="text-slate-500 block text-[10px]">TOTAL ANALISADO</span>
                      <strong>{importSummary.totalAnalisados}</strong>
                    </div>
                    <div className="bg-white p-2 rounded border border-emerald-100">
                      <span className="text-emerald-600 block text-[10px]">NOVOS GRAVADOS</span>
                      <strong className="text-emerald-700">+{importSummary.novas}</strong>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="block font-semibold text-slate-700">
                  Selecionar Arquivo Excel (.XLSX / .CSV) do Computador
                </label>
                <p className="text-[11px] text-slate-500">
                  A importação apenas acrescenta novos sites. Os dados e vínculos existentes nunca são apagados ou substituídos.
                </p>
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleUploadLocalExcel}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={syncLoading}
                  onClick={() => excelInputRef.current?.click()}
                  className="w-full py-4 border-2 border-dashed border-slate-300 hover:border-[#223585] rounded-xl bg-slate-50 hover:bg-blue-50/30 text-slate-800 font-bold flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-6 h-6 text-[#223585]" />
                  <span>{syncLoading ? 'Gravando em lotes de 20 no Firestore...' : 'Clique para Selecionar a Planilha (.xlsx)'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: CREATE NEW ERICSSON ROW (PAIR OF SITES)
         ===================================================================== */}
      {createModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setCreateModalOpen(false)}
        >
          <div
            className="w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-[#223585]" />
                <h3 className="text-sm font-bold text-slate-900">
                  Nova Linha na Planilha Ericsson (Par de Torres A ↔ B)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRow} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">01.00. Chaves</label>
                  <input
                    type="text"
                    value={newChaves}
                    onChange={(e) => setNewChaves(e.target.value)}
                    placeholder="Ex: RRJ-5997238"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">00.03.State</label>
                  <input
                    type="text"
                    value={newState}
                    onChange={(e) => setNewState(e.target.value.toUpperCase())}
                    placeholder="SP"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Meta</label>
                  <input
                    type="text"
                    value={newMeta}
                    onChange={(e) => setNewMeta(e.target.value)}
                    placeholder="Ex: Em andamento"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-blue-50/50 border border-blue-200 space-y-2.5">
                  <div className="font-bold text-[#223585] uppercase text-[11px]">
                    Torre 1 — Site A
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">01.21.Site ID A *</label>
                    <input
                      type="text"
                      required={!newSiteIdB.trim()}
                      value={newSiteIdA}
                      onChange={(e) => setNewSiteIdA(e.target.value.toUpperCase())}
                      placeholder="Ex: ESCIT33"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">ID Detentora A</label>
                    <input
                      type="text"
                      value={newDetentoraA}
                      onChange={(e) => setNewDetentoraA(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Status A</label>
                    <input
                      type="text"
                      value={newStatusA}
                      onChange={(e) => setNewStatusA(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">CIDADE A</label>
                    <input
                      type="text"
                      value={newCidadeA}
                      onChange={(e) => setNewCidadeA(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-teal-50/50 border border-teal-200 space-y-2.5">
                  <div className="font-bold text-[#1E8E8D] uppercase text-[11px]">
                    Torre 2 — Site B
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">01.21.Site ID B *</label>
                    <input
                      type="text"
                      required={!newSiteIdA.trim()}
                      value={newSiteIdB}
                      onChange={(e) => setNewSiteIdB(e.target.value.toUpperCase())}
                      placeholder="Ex: ESCIT81"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">ID Detentora B</label>
                    <input
                      type="text"
                      value={newDetentoraB}
                      onChange={(e) => setNewDetentoraB(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Status B</label>
                    <input
                      type="text"
                      value={newStatusB}
                      onChange={(e) => setNewStatusB(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">CIDADE B</label>
                    <input
                      type="text"
                      value={newCidadeB}
                      onChange={(e) => setNewCidadeB(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">EQUIPE</label>
                  <input
                    type="text"
                    value={newEquipe}
                    onChange={(e) => setNewEquipe(e.target.value)}
                    placeholder="Ex: Equipe 6"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Serviço</label>
                  <input
                    type="text"
                    value={newServico}
                    onChange={(e) => setNewServico(e.target.value)}
                    placeholder="LOS A / LOS e Vistoria B"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingRow}
                  className="px-4 py-2 bg-[#223585] hover:bg-[#192869] text-white font-bold rounded-lg cursor-pointer"
                >
                  {creatingRow ? 'Criando...' : 'Criar Linha na Planilha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          ROW DETAILS & EDIT DRAWER (SLIDE-OVER)
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
                  Ficha completa das {originalColumns.length} colunas da planilha Ericsson
                </p>
              </div>

              <div className="flex items-center gap-2">
                {effectiveRole === 'ADM' && (
                  <button
                    type="button"
                    onClick={() => handleDeleteRow(selectedRow)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                    title="Excluir linha"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedRow(null)}
                  className="p-2 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* VISTORIA A, VISTORIA B, LOS, SMART AND SDC BOX */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <div className="font-bold text-slate-900">
                Controle de Entregas do Enlace (Vistoria A, Vistoria B, LOS)
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="p-3 bg-white rounded-lg border border-blue-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase text-[#223585]">
                      Vistoria Site A
                    </span>
                    <span className="font-mono font-bold text-[#223585]">
                      {selectedRow.siteIdA || '—'}
                    </span>
                  </div>
                  {renderVistoriaOrLosCell(selectedRow, 'A')}
                </div>

                <div className="p-3 bg-white rounded-lg border border-teal-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase text-[#1E8E8D]">
                      Vistoria Site B
                    </span>
                    <span className="font-mono font-bold text-[#1E8E8D]">
                      {selectedRow.siteIdB || '—'}
                    </span>
                  </div>
                  {renderVistoriaOrLosCell(selectedRow, 'B')}
                </div>

                <div className="p-3 bg-white rounded-lg border border-amber-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase text-amber-800">
                      Relatório LOS
                    </span>
                    <span className="font-mono font-bold text-amber-800">A ↔ B</span>
                  </div>
                  {renderVistoriaOrLosCell(selectedRow, 'LOS')}
                </div>

                <div className="p-3 bg-white rounded-lg border border-violet-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase text-violet-800">
                      Documento SMART
                    </span>
                    <span className="font-mono font-bold text-violet-800">SMART</span>
                  </div>
                  {renderVistoriaOrLosCell(selectedRow, 'SMART')}
                </div>

                <div className="p-3 bg-white rounded-lg border border-rose-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase text-rose-800">
                      Documento SDC
                    </span>
                    <span className="font-mono font-bold text-rose-800">SDC</span>
                  </div>
                  {renderVistoriaOrLosCell(selectedRow, 'SDC')}
                </div>
              </div>
            </div>

            {/* Editable Original Spreadsheet Columns */}
            <form onSubmit={handleSaveRowEdit} className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5 text-[#1E8E8D]" />
                  <span>Colunas Originais da Planilha ({originalColumns.length} colunas)</span>
                </h4>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-1.5 bg-[#223585] hover:bg-[#192869] text-white font-bold rounded-lg cursor-pointer"
                >
                  {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
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
