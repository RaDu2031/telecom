import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  FileSpreadsheet,
  Search,
  Upload,
  Download,
  Plus,
  RefreshCw,
  Filter,
  X,
  ExternalLink,
  Edit3,
  Trash2,
  Paperclip,
  CheckCircle2,
  Clock,
  Layers,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Columns,
  Table as TableIcon,
  HardHat,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileCheck,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  AmetaUser,
  UserRole,
  VendorType,
  EricssonEngineeringRow,
  EricssonConsolidatedStats,
  EricssonDocGroup,
  EricssonReprovacaoRecord,
  EngineeringFile,
  ERICSSON_SITE_LIST_COLUMNS,
  ERICSSON_REAL_STATUSES_BY_DOC,
  DEFAULT_ERICSSON_ENG_ONEDRIVE_URL,
} from '../types/telecom';
import {
  computeEricssonConsolidatedStats,
  exportEricssonEngineeringToXlsx,
  exportEricssonEngineeringToCsv,
  classifyEricssonDocGroup,
  rowMatchesEricssonDocGroup,
  classifyEricssonStatus,
  normalizeEricssonRealStatus,
  isEricssonRowReproved,
} from '../utils/ericssonSpreadsheetUtils';
import { EricssonConsolidatedTopPanel } from './EricssonConsolidatedTopPanel';
import { EricssonEngineeringDrawer } from './EricssonEngineeringDrawer';
import {
  EricssonWeeklyDeliveriesPanel,
  DeliveryWeekBucket,
  getRowDeliveryDate,
} from './EricssonWeeklyDeliveriesPanel';
import { EricssonReprovadosPanel } from './EricssonReprovadosPanel';

interface EricssonEngineeringTabProps {
  user: AmetaUser;
  effectiveRole: UserRole;
  activeVendor: VendorType;
  onNavigateToVistoria?: (siteId?: string) => void;
  showToast: (msg: string) => void;
}

export const EricssonEngineeringTab: React.FC<EricssonEngineeringTabProps> = ({
  user,
  effectiveRole,
  activeVendor,
  onNavigateToVistoria,
  showToast,
}) => {
  // Main data state
  const [rows, setRows] = useState<EricssonEngineeringRow[]>([]);
  const [reprovacoes, setReprovacoes] = useState<EricssonReprovacaoRecord[]>([]);
  const [columns, setColumns] = useState<string[]>([...ERICSSON_SITE_LIST_COLUMNS]);
  const [meta, setMeta] = useState<{
    id?: string;
    tabName?: string;
    sourceFileName?: string;
    liveSyncUrl?: string;
    lastSyncAt?: string;
    totalRows?: number;
  }>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncingOneDrive, setIsSyncingOneDrive] = useState<boolean>(false);

  // Filters state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDocGroup, setSelectedDocGroup] = useState<EricssonDocGroup | null>(null);
  const [selectedRealStatus, setSelectedRealStatus] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [regionalFilter, setRegionalFilter] = useState<string>('ALL');
  const [tipoSiteFilter, setTipoSiteFilter] = useState<string>('ALL');
  const [executorFilter, setExecutorFilter] = useState<string>('ALL');

  // Reprovados filter state
  const [selectedReprovadoExecutor, setSelectedReprovadoExecutor] = useState<string | null>(null);
  const [selectedReprovadoDocGroup, setSelectedReprovadoDocGroup] = useState<EricssonDocGroup | null>(null);

  // View mode: 'all' (all 51 columns) vs 'essential' (clean primary columns + double site IDs)
  const [viewMode, setViewMode] = useState<'essential' | 'all'>('all');

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(100);

  // Weekly deliveries filter state (rolling 30-day window)
  const [selectedDeliveryWeek, setSelectedDeliveryWeek] = useState<DeliveryWeekBucket | null>(null);
  const [selectedDeliveryDocGroup, setSelectedDeliveryDocGroup] = useState<EricssonDocGroup | null>(null);

  // Modals
  const [isOneDriveModalOpen, setIsOneDriveModalOpen] = useState<boolean>(false);
  const [oneDriveInputUrl, setOneDriveInputUrl] = useState<string>(DEFAULT_ERICSSON_ENG_ONEDRIVE_URL);
  const [isNewRowModalOpen, setIsNewRowModalOpen] = useState<boolean>(false);
  const [editingRow, setEditingRow] = useState<EricssonEngineeringRow | null>(null);
  const [attachingFileRow, setAttachingFileRow] = useState<EricssonEngineeringRow | null>(null);
  const [selectedDrawerRow, setSelectedDrawerRow] = useState<EricssonEngineeringRow | null>(null);
  const [ericssonFiles, setEricssonFiles] = useState<EngineeringFile[]>([]);

  // Form states for new/edit row
  const [formIntervencao, setFormIntervencao] = useState<string>('');
  const [formSiteIdA, setFormSiteIdA] = useState<string>('');
  const [formSiteIdB, setFormSiteIdB] = useState<string>('');
  const [formStatusA, setFormStatusA] = useState<string>('Pendente');
  const [formStatusB, setFormStatusB] = useState<string>('Pendente');
  const [formTipoDoc, setFormTipoDoc] = useState<string>('WR');
  const [formStatus, setFormStatus] = useState<string>('Finalizado');
  const [formRegional, setFormRegional] = useState<string>('SPM');
  const [formTipoSite, setFormTipoSite] = useState<string>('REUSO');
  const [formExecutor, setFormExecutor] = useState<string>('');
  const [formFields, setFormFields] = useState<Record<string, string>>({});

  // File upload state for row attachment
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState<boolean>(false);

  // Fetch initial data
  const loadData = async () => {
    try {
      setIsLoading(true);
      const [resData, resRep, resInit] = await Promise.all([
        fetch('/api/ericsson/engenharia/data'),
        fetch('/api/ericsson/engenharia/reprovacoes'),
        fetch('/api/initial-data'),
      ]);

      if (resData.ok) {
        const data = await resData.json();
        if (Array.isArray(data.rows)) setRows(data.rows);
        if (data.meta) setMeta(data.meta);
        if (Array.isArray(data.columns) && data.columns.length > 0) setColumns(data.columns);
      }

      if (resRep.ok) {
        const repData = await resRep.json();
        if (Array.isArray(repData.reprovacoes)) {
          setReprovacoes(repData.reprovacoes);
        }
      }

      if (resInit.ok) {
        const initData = await resInit.json();
        if (Array.isArray(initData.ericssonFiles)) {
          setEricssonFiles(initData.ericssonFiles);
        }
      }
    } catch (e) {
      console.error('Failed to load Ericsson engineering data:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Register Reprovação handler
  const handleRegisterReprovacao = async (record: Omit<EricssonReprovacaoRecord, 'id' | 'createdAt'>) => {
    try {
      const res = await fetch('/api/ericsson/engenharia/reprovacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.reprovacoes) setReprovacoes(data.reprovacoes);
        showToast(`Reprovação registrada para o site ${record.intervencaoClaro}.`);
        loadData();
      }
    } catch (err) {
      console.error('Erro ao registrar reprovação:', err);
      showToast('Erro ao salvar reprovação.');
    }
  };

  // Compute live stats for WR, QRF, PPI, BOQ, SMART, SDC
  const consolidatedStats: EricssonConsolidatedStats = useMemo(() => {
    return computeEricssonConsolidatedStats(rows);
  }, [rows]);

  // Distinct filter options
  const distinctRegionais = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const reg = r.regional || r.fields?.['Regional'];
      if (reg) s.add(reg);
    });
    return Array.from(s).sort();
  }, [rows]);

  const distinctTipoSites = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const ts = r.tipoSite || r.fields?.['TIPO SITE'];
      if (ts) s.add(ts);
    });
    return Array.from(s).sort();
  }, [rows]);

  const distinctExecutores = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const ex =
        r.executor ||
        r.fields?.['EXECUTOR'] ||
        r.fields?.['EXECUTOR WR'] ||
        r.fields?.['EXECUTOR QRF'] ||
        r.fields?.['EXECUTOR PPI'] ||
        r.fields?.['Executor'];
      if (ex && ex.trim() && ex.trim() !== '—' && ex.trim() !== '-') {
        s.add(ex.trim());
      }
    });
    return Array.from(s).sort();
  }, [rows]);

  // Real statuses available based on currently selected doc group
  const availableRealStatuses = useMemo(() => {
    if (selectedDocGroup && ERICSSON_REAL_STATUSES_BY_DOC[selectedDocGroup]) {
      return ERICSSON_REAL_STATUSES_BY_DOC[selectedDocGroup];
    }
    // All real statuses across all 6 document types
    const all = new Set<string>();
    Object.values(ERICSSON_REAL_STATUSES_BY_DOC).forEach((list) => {
      list.forEach((st) => all.add(st));
    });
    return Array.from(all).sort();
  }, [selectedDocGroup]);

  // Column sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSortColumn = (colName: string) => {
    if (sortColumn === colName) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumn(null);
        setSortDirection('asc');
      }
    } else {
      setSortColumn(colName);
      setSortDirection('asc');
    }
  };

  // Filtered rows
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      // 0. Weekly Deliveries filter (sites delivered in the selected week, optionally matching selectedDeliveryDocGroup)
      if (selectedDeliveryWeek) {
        const rawStatus = r.status || r.fields?.['Status'] || '';
        const isFinalizado =
          classifyEricssonStatus(rawStatus) === 'Finalizado' ||
          rawStatus.toLowerCase().includes('finaliz');
        if (!isFinalizado) return false;

        const deliveryDate = getRowDeliveryDate(r);
        if (!deliveryDate) return false;
        if (
          deliveryDate < selectedDeliveryWeek.startDate ||
          deliveryDate > selectedDeliveryWeek.endDate
        ) {
          return false;
        }

        if (selectedDeliveryDocGroup) {
          const rawDoc = String(r.tipoDoc || r.fields?.['Tipo doc'] || '');
          if (!rowMatchesEricssonDocGroup(rawDoc, selectedDeliveryDocGroup)) {
            return false;
          }
        }
      }

      // 1. Doc Group filter
      if (selectedDocGroup) {
        const rawDoc = String(r.tipoDoc || r.fields?.['Tipo doc'] || '');
        if (!rowMatchesEricssonDocGroup(rawDoc, selectedDocGroup)) return false;
      }

      // 2. Real Status filter from Top Panel
      if (selectedRealStatus) {
        const rawStatus = r.status || r.fields?.['Status'] || '';
        const real = normalizeEricssonRealStatus(rawStatus, selectedDocGroup || undefined);
        if (real.toLowerCase() !== selectedRealStatus.toLowerCase()) {
          return false;
        }
      }

      // 2.1 Table Toolbar Status Filter
      if (statusFilter !== 'ALL') {
        const rawStatus = r.status || r.fields?.['Status'] || '';
        const real = normalizeEricssonRealStatus(rawStatus, selectedDocGroup || undefined);
        if (real.toLowerCase() !== statusFilter.toLowerCase()) {
          return false;
        }
      }

      // 2.2 Reprovados Filter from Reprovados Panel
      if (selectedReprovadoExecutor || selectedReprovadoDocGroup) {
        const isReproved = isEricssonRowReproved(r, reprovacoes);
        if (!isReproved) return false;

        if (selectedReprovadoExecutor) {
          const target = selectedReprovadoExecutor.trim().toLowerCase();
          const rowEx = (
            r.executor ||
            r.fields?.['EXECUTOR'] ||
            r.fields?.['EXECUTOR WR'] ||
            r.fields?.['EXECUTOR QRF'] ||
            r.fields?.['EXECUTOR PPI'] ||
            r.fields?.['Executor'] ||
            ''
          )
            .trim()
            .toLowerCase();

          const directMatch =
            rowEx === target || rowEx.includes(target) || target.includes(rowEx);

          const linkedReproval =
            Array.isArray(reprovacoes) &&
            reprovacoes.some(
              (rep) =>
                (rep.rowId === r.id ||
                  (rep.intervencaoClaro &&
                    (r.intervencaoClaro || r.siteIdA || '')
                      .trim()
                      .toLowerCase() === rep.intervencaoClaro.trim().toLowerCase())) &&
                ((rep.executor || '').trim().toLowerCase() === target ||
                  (rep.executor || '').trim().toLowerCase().includes(target) ||
                  target.includes((rep.executor || '').trim().toLowerCase()))
            );

          if (!directMatch && !linkedReproval) {
            return false;
          }
        }

        if (selectedReprovadoDocGroup) {
          const rawDoc = String(r.tipoDoc || r.fields?.['Tipo doc'] || '');
          if (!rowMatchesEricssonDocGroup(rawDoc, selectedReprovadoDocGroup)) {
            return false;
          }
        }
      }

      // 3. Dropdowns
      if (regionalFilter !== 'ALL') {
        const reg = r.regional || r.fields?.['Regional'] || '';
        if (reg !== regionalFilter) return false;
      }
      if (tipoSiteFilter !== 'ALL') {
        const ts = r.tipoSite || r.fields?.['TIPO SITE'] || '';
        if (ts !== tipoSiteFilter) return false;
      }
      if (executorFilter !== 'ALL') {
        const ex =
          r.executor ||
          r.fields?.['EXECUTOR'] ||
          r.fields?.['EXECUTOR WR'] ||
          r.fields?.['EXECUTOR QRF'] ||
          r.fields?.['EXECUTOR PPI'] ||
          r.fields?.['Executor'] ||
          '';
        if (ex !== executorFilter) return false;
      }

      // 4. Text search in all fields
      if (q) {
        const matchIntervencao = (r.intervencaoClaro || '').toLowerCase().includes(q);
        const matchSiteA = (r.siteIdA || '').toLowerCase().includes(q);
        const matchSiteB = (r.siteIdB || '').toLowerCase().includes(q);
        const matchStatus = (r.status || '').toLowerCase().includes(q);
        const matchDoc = (r.tipoDoc || '').toLowerCase().includes(q);
        const matchExec = (
          r.executor ||
          r.fields?.['EXECUTOR'] ||
          r.fields?.['EXECUTOR WR'] ||
          r.fields?.['EXECUTOR QRF'] ||
          r.fields?.['EXECUTOR PPI'] ||
          r.fields?.['Executor'] ||
          ''
        ).toLowerCase().includes(q);
        if (matchIntervencao || matchSiteA || matchSiteB || matchStatus || matchDoc || matchExec) {
          return true;
        }
        // Check other fields
        const anyField = Object.values(r.fields || {}).some((v) =>
          String(v).toLowerCase().includes(q)
        );
        return anyField;
      }

      return true;
    });
  }, [
    rows,
    selectedDeliveryWeek,
    selectedDeliveryDocGroup,
    selectedDocGroup,
    selectedRealStatus,
    statusFilter,
    selectedReprovadoExecutor,
    selectedReprovadoDocGroup,
    regionalFilter,
    tipoSiteFilter,
    executorFilter,
    searchQuery,
  ]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    if (!sortColumn) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      let valA = String(a.fields?.[sortColumn] ?? (a as any)[sortColumn] ?? '').trim();
      let valB = String(b.fields?.[sortColumn] ?? (b as any)[sortColumn] ?? '').trim();

      // Special fallback for EXECUTOR column
      if (sortColumn === 'EXECUTOR') {
        valA =
          valA ||
          a.executor ||
          a.fields?.['EXECUTOR WR'] ||
          a.fields?.['EXECUTOR QRF'] ||
          a.fields?.['EXECUTOR PPI'] ||
          '';
        valB =
          valB ||
          b.executor ||
          b.fields?.['EXECUTOR WR'] ||
          b.fields?.['EXECUTOR QRF'] ||
          b.fields?.['EXECUTOR PPI'] ||
          '';
      }

      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB) && valA !== '' && valB !== '') {
        return sortDirection === 'asc' ? numA - numB : numB - numA;
      }
      const cmp = valA.localeCompare(valB, 'pt-BR', { numeric: true, sensitivity: 'base' });
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [filteredRows, sortColumn, sortDirection]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  // Reset page on filter changes
  useEffect(() => {
    setPage(1);
  }, [
    selectedDeliveryWeek,
    selectedDeliveryDocGroup,
    searchQuery,
    selectedDocGroup,
    selectedRealStatus,
    statusFilter,
    selectedReprovadoExecutor,
    selectedReprovadoDocGroup,
    regionalFilter,
    tipoSiteFilter,
    executorFilter,
    pageSize,
  ]);

  // Sync OneDrive
  const handleSyncOneDrive = async (targetUrl: string) => {
    try {
      setIsSyncingOneDrive(true);
      const res = await fetch('/api/ericsson/engenharia/import-onedrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
        if (data.meta) setMeta(data.meta);
        setIsOneDriveModalOpen(false);
        showToast(
          `Planilha Ericsson sincronizada com sucesso! (${data.count} linhas carregadas)`
        );
      } else {
        const err = await res.json();
        showToast(`Erro na sincronização: ${err.error || 'Falha ao acessar o OneDrive'}`);
      }
    } catch (e) {
      showToast('Erro de conexão ao sincronizar com o OneDrive.');
    } finally {
      setIsSyncingOneDrive(false);
    }
  };

  // Local Excel file upload
  const handleUploadLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      showToast('Lendo arquivo Excel da Ericsson...');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheetName =
        workbook.SheetNames.find((n) => n.trim().toLowerCase() === 'site list') ||
        workbook.SheetNames[0];

      if (!sheetName) {
        showToast('Nenhuma aba válida encontrada no arquivo.');
        return;
      }

      const sheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: '',
        raw: false,
      });

      // Find header row
      let headerRowIndex = 0;
      for (let i = 0; i < Math.min(10, rawRows.length); i++) {
        const rowCells = (rawRows[i] || []).map((c) => String(c || '').toLowerCase());
        if (rowCells.some((c) => c === 'asp' || c.includes('intervencao') || c.includes('tipo doc'))) {
          headerRowIndex = i;
          break;
        }
      }

      const rawHeaders = (rawRows[headerRowIndex] || []).map((c) => String(c || '').trim());
      const cols = rawHeaders.length >= 10 ? rawHeaders : [...ERICSSON_SITE_LIST_COLUMNS];

      const parsed: EricssonEngineeringRow[] = [];
      const now = new Date().toISOString();

      for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
        const row = rawRows[r] as unknown[];
        if (!Array.isArray(row) || !row.some((c) => String(c).trim().length > 0)) continue;

        const fields: Record<string, string> = {};
        cols.forEach((colName, cIdx) => {
          fields[colName] = String(row[cIdx] !== undefined && row[cIdx] !== null ? row[cIdx] : '').trim();
        });

        const intervencao = fields['Intervencao Claro'] || '';
        let siteA = intervencao;
        let siteB = '';
        if (intervencao.includes('-')) {
          const parts = intervencao.split('-');
          siteA = parts[0].trim();
          siteB = parts[1] ? parts[1].trim() : '';
        } else if (intervencao.includes('/')) {
          const parts = intervencao.split('/');
          siteA = parts[0].trim();
          siteB = parts[1] ? parts[1].trim() : '';
        }

        parsed.push({
          id: `eric-eng-up-${r}`,
          rowKey: `${intervencao}__${fields['Tipo doc'] || ''}__${r}`,
          intervencaoClaro: intervencao,
          siteIdA: siteA || `SITE_${r}`,
          siteIdB: siteB,
          statusA: fields['Status'] || 'Pendente',
          statusB: siteB ? fields['Status'] || 'Pendente' : '',
          tipoDoc: fields['Tipo doc'] || '',
          status: fields['Status'] || '',
          regional: fields['Regional'] || '',
          tipoSite: fields['TIPO SITE'] || '',
          executor: fields['EXECUTOR'] || '',
          fields,
          siteAVistoriaStatus: 'Pendente',
          siteBVistoriaStatus: siteB ? 'Pendente' : undefined,
          updatedAt: now,
        });
      }

      // Send to backend
      const res = await fetch('/api/ericsson/engenharia/import-rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: parsed,
          columns: cols,
          tabName: sheetName,
          sourceFileName: file.name,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || parsed);
        setColumns(cols);
        showToast(`Planilha importada com sucesso! (${parsed.length} linhas carregadas)`);
      } else {
        showToast('Erro ao gravar planilha importada no servidor.');
      }
    } catch (err) {
      console.error(err);
      showToast('Falha ao processar arquivo .xlsx.');
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  // Add / Edit Row handlers
  const handleOpenNewRowModal = () => {
    setFormIntervencao('');
    setFormSiteIdA('');
    setFormSiteIdB('');
    setFormStatusA('Pendente');
    setFormStatusB('Pendente');
    setFormTipoDoc('WR');
    setFormStatus('Finalizado');
    setFormRegional('SPM');
    setFormTipoSite('REUSO');
    setFormExecutor('');
    setFormFields({});
    setIsNewRowModalOpen(true);
  };

  const handleOpenEditRowModal = (row: EricssonEngineeringRow) => {
    setEditingRow(row);
    setFormIntervencao(row.intervencaoClaro || '');
    setFormSiteIdA(row.siteIdA || '');
    setFormSiteIdB(row.siteIdB || '');
    setFormStatusA(row.statusA || 'Pendente');
    setFormStatusB(row.statusB || 'Pendente');
    setFormTipoDoc(row.tipoDoc || 'WR');
    setFormStatus(row.status || 'Finalizado');
    setFormRegional(row.regional || 'SPM');
    setFormTipoSite(row.tipoSite || 'REUSO');
    setFormExecutor(row.executor || '');
    setFormFields(row.fields || {});
  };

  const handleSaveRow = async () => {
    if (!formIntervencao.trim() && !formSiteIdA.trim()) {
      showToast('Informe a Intervenção Claro ou o Site ID A.');
      return;
    }

    const payload: Partial<EricssonEngineeringRow> = {
      intervencaoClaro: formIntervencao.trim(),
      siteIdA: formSiteIdA.trim() || formIntervencao.trim(),
      siteIdB: formSiteIdB.trim(),
      statusA: formStatusA,
      statusB: formSiteIdB.trim() ? formStatusB : '',
      tipoDoc: formTipoDoc,
      status: formStatus,
      regional: formRegional,
      tipoSite: formTipoSite,
      executor: formExecutor.trim(),
      fields: {
        ...formFields,
        'Intervencao Claro': formIntervencao.trim(),
        'Tipo doc': formTipoDoc,
        Status: formStatus,
        Regional: formRegional,
        'TIPO SITE': formTipoSite,
        EXECUTOR: formExecutor.trim(),
      },
    };

    try {
      if (editingRow) {
        const res = await fetch(`/api/ericsson/engenharia/rows/${editingRow.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json();
          setRows((prev) =>
            prev.map((r) => (r.id === editingRow.id ? data.row : r))
          );
          setEditingRow(null);
          showToast('Linha atualizada com sucesso!');
        }
      } else {
        const res = await fetch('/api/ericsson/engenharia/rows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json();
          setRows((prev) => [data.row, ...prev]);
          setIsNewRowModalOpen(false);
          showToast('Nova linha adicionada com sucesso!');
        }
      }
    } catch (e) {
      showToast('Erro ao salvar dados no servidor.');
    }
  };

  const handleDeleteRow = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta linha da Engenharia Ericsson?')) {
      return;
    }
    try {
      const res = await fetch(`/api/ericsson/engenharia/rows/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== id));
        showToast('Linha excluída com sucesso.');
      }
    } catch {
      showToast('Erro ao excluir linha.');
    }
  };

  // Upload attachment directly to site/row (no subfolders)
  const handleUploadRowAttachment = async () => {
    if (!attachingFileRow || !selectedFile) {
      showToast('Selecione um arquivo para anexar.');
      return;
    }

    try {
      setIsUploadingFile(true);
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        const res = await fetch('/api/ericsson/engenharia/upload-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rowId: attachingFileRow.id,
            fileName: selectedFile.name,
            fileDataUrl: base64Data,
            uploaderName: user.name,
            uploaderEmail: user.email,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setRows((prev) =>
            prev.map((r) => (r.id === attachingFileRow.id ? data.row : r))
          );
          showToast(`Arquivo "${selectedFile.name}" anexado com sucesso!`);
          setAttachingFileRow(null);
          setSelectedFile(null);
        } else {
          showToast('Erro ao enviar anexo.');
        }
        setIsUploadingFile(false);
      };
      reader.readAsDataURL(selectedFile);
    } catch (e) {
      setIsUploadingFile(false);
      showToast('Falha no upload do arquivo.');
    }
  };

  return (
    <div className="space-y-4">
      {/* =====================================================================
          1. TOP ACTION & METADATA BAR (PADRÃO VISUAL NOKIA / EXCEL ONLINE)
         ===================================================================== */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Platform Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1E8E8D]/15 border border-[#1E8E8D]/30 flex items-center justify-center text-[#1E8E8D] shadow-2xs shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-teal-100 text-teal-900 border border-teal-300">
                  ERICSSON · ENGENHARIA EXCLUSIVA
                </span>
                <span className="text-slate-300">•</span>
                <h1 className="text-sm font-bold text-slate-900">
                  Planilha de Documentação & Planejamento Ericsson
                </h1>
              </div>
              <p className="text-xs text-slate-500">
                Aba <strong>{meta.tabName || 'Site list'}</strong> — 51 colunas originais da planilha.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Sync OneDrive */}
            <button
              type="button"
              onClick={() => setIsOneDriveModalOpen(true)}
              disabled={isSyncingOneDrive}
              className="px-3.5 py-2 bg-[#1E8E8D] hover:bg-[#177271] text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Sincronizar planilha com o OneDrive do Excel Online"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isSyncingOneDrive ? 'animate-spin' : ''}`}
              />
              <span>{isSyncingOneDrive ? 'Sincronizando...' : 'Sincronizar OneDrive'}</span>
            </button>

            {/* Upload Local .XLSX */}
            <label className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-amber-400" />
              <span>Carregar .XLSX</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleUploadLocalFile}
                className="hidden"
              />
            </label>

            {/* + Nova Linha */}
            <button
              type="button"
              onClick={handleOpenNewRowModal}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-slate-200"
            >
              <Plus className="w-3.5 h-3.5 text-teal-700" />
              <span>+ Nova Linha</span>
            </button>

            {/* Export XLSX */}
            <button
              type="button"
              onClick={() =>
                exportEricssonEngineeringToXlsx(
                  filteredRows,
                  columns,
                  `Engenharia_Ericsson_${new Date().toISOString().slice(0, 10)}.xlsx`
                )
              }
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              title="Exportar dados filtrados para Excel"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar (.XLSX)</span>
            </button>

            {/* Export CSV */}
            <button
              type="button"
              onClick={() =>
                exportEricssonEngineeringToCsv(
                  filteredRows,
                  columns,
                  `Engenharia_Ericsson_${new Date().toISOString().slice(0, 10)}.csv`
                )
              }
              className="px-2.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl transition-all border border-slate-200 cursor-pointer"
              title="Exportar dados para CSV"
            >
              <span>CSV</span>
            </button>
          </div>
        </div>

        {/* Sync Info / Last Update */}
        {meta.lastSyncAt && (
          <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-mono border-t border-slate-100 pt-2">
            <span>
              Arquivo de origem: <strong>{meta.sourceFileName || 'AMETA_REPORT DOCUMENTACAO_PLANEJAMENTO_WXX.xlsx'}</strong>
            </span>
            <span>
              Última sincronização: {new Date(meta.lastSyncAt).toLocaleString('pt-BR')}
            </span>
          </div>
        )}
      </div>

      {/* =====================================================================
          2. CONSOLIDATED TOP PANEL (WR, QRF, PPI, BOQ, SMART, SDC - STATUS REAIS)
         ===================================================================== */}
      <EricssonConsolidatedTopPanel
        stats={consolidatedStats}
        selectedDocGroup={selectedDocGroup}
        selectedRealStatus={selectedRealStatus}
        onSelectFilter={(docGroup, realStatus) => {
          setSelectedDocGroup(docGroup);
          setSelectedRealStatus(realStatus);
        }}
        onClearFilter={() => {
          setSelectedDocGroup(null);
          setSelectedRealStatus(null);
        }}
      />

      {/* =====================================================================
          2.5. PAINEL DE ENTREGAS POR SEMANA (ÚLTIMOS 30 DIAS EMPILHADO POR TIPO)
         ===================================================================== */}
      <EricssonWeeklyDeliveriesPanel
        rows={rows}
        selectedWeekKey={selectedDeliveryWeek ? selectedDeliveryWeek.key : null}
        selectedDocGroupFilter={selectedDeliveryDocGroup}
        onSelectWeekAndDoc={(week, docGroup) => {
          setSelectedDeliveryWeek(week);
          setSelectedDeliveryDocGroup(docGroup);
        }}
      />

      {/* =====================================================================
          2.6. PAINEL DE DOCUMENTOS REPROVADOS POR EXECUTOR
         ===================================================================== */}
      <EricssonReprovadosPanel
        rows={rows}
        reprovacoes={reprovacoes}
        onRegisterReprovacao={handleRegisterReprovacao}
        selectedReprovadoExecutor={selectedReprovadoExecutor}
        selectedReprovadoDocGroup={selectedReprovadoDocGroup}
        onSelectReprovadoFilter={(executor, docGroup) => {
          setSelectedReprovadoExecutor(executor);
          setSelectedReprovadoDocGroup(docGroup);
        }}
      />

      {/* =====================================================================
          3. SEARCH, FILTERS & TABLE CONTROLS BAR
         ===================================================================== */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por Intervenção, Site A, Site B, Tipo doc, Status, Executor..."
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all shadow-inner"
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

          {/* Quick Dropdown Filters */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Regional Filter */}
            <select
              value={regionalFilter}
              onChange={(e) => setRegionalFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:border-teal-500 cursor-pointer"
            >
              <option value="ALL">Regional: Todas ({distinctRegionais.length})</option>
              {distinctRegionais.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            {/* Tipo Site Filter */}
            <select
              value={tipoSiteFilter}
              onChange={(e) => setTipoSiteFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:border-teal-500 cursor-pointer"
            >
              <option value="ALL">Tipo Site: Todos</option>
              {distinctTipoSites.map((ts) => (
                <option key={ts} value={ts}>
                  {ts}
                </option>
              ))}
            </select>

            {/* Status Real Filter (Dynamic based on selectedDocGroup) */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:border-teal-500 cursor-pointer max-w-[170px]"
            >
              <option value="ALL">
                Status: Todos {selectedDocGroup ? `(${selectedDocGroup})` : ''}
              </option>
              {availableRealStatuses.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>

            {/* Executor Filter */}
            <select
              value={executorFilter}
              onChange={(e) => setExecutorFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:border-teal-500 max-w-[160px] cursor-pointer"
            >
              <option value="ALL">Executor: Todos</option>
              {distinctExecutores.map((ex) => (
                <option key={ex} value={ex}>
                  {ex}
                </option>
              ))}
            </select>

            {/* View Mode Toggle: All 51 Columns vs Essential */}
            <div className="flex items-center p-0.5 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setViewMode('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === 'all'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Exibir todas as 51 colunas exatas da planilha"
              >
                Todas 51 Colunas
              </button>
              <button
                type="button"
                onClick={() => setViewMode('essential')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === 'essential'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Visualização simplificada das principais colunas"
              >
                Essencial
              </button>
            </div>
          </div>
        </div>

        {/* Active Filters Badges & Summary */}
        {(selectedDocGroup ||
          selectedRealStatus ||
          statusFilter !== 'ALL' ||
          regionalFilter !== 'ALL' ||
          tipoSiteFilter !== 'ALL' ||
          executorFilter !== 'ALL' ||
          selectedDeliveryWeek ||
          selectedReprovadoExecutor ||
          selectedReprovadoDocGroup ||
          searchQuery) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 text-xs">
            <span className="text-[11px] font-bold text-slate-400 mr-1">Filtros ativos:</span>

            {selectedDocGroup && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 text-[11px] font-bold">
                Tipo: {selectedDocGroup}
                <button
                  type="button"
                  onClick={() => setSelectedDocGroup(null)}
                  className="hover:text-indigo-950 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {selectedRealStatus && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200 text-[11px] font-bold">
                Status: {selectedRealStatus}
                <button
                  type="button"
                  onClick={() => setSelectedRealStatus(null)}
                  className="hover:text-teal-950 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {statusFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 text-[11px] font-bold">
                Filtro Status: {statusFilter}
                <button
                  type="button"
                  onClick={() => setStatusFilter('ALL')}
                  className="hover:text-blue-950 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {regionalFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-300 text-[11px] font-bold">
                Regional: {regionalFilter}
                <button
                  type="button"
                  onClick={() => setRegionalFilter('ALL')}
                  className="hover:text-slate-950 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {tipoSiteFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-300 text-[11px] font-bold">
                Tipo Site: {tipoSiteFilter}
                <button
                  type="button"
                  onClick={() => setTipoSiteFilter('ALL')}
                  className="hover:text-slate-950 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {executorFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold">
                Executor: {executorFilter}
                <button
                  type="button"
                  onClick={() => setExecutorFilter('ALL')}
                  className="hover:text-amber-950 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {selectedDeliveryWeek && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                Semana: {selectedDeliveryWeek.label}
                {selectedDeliveryDocGroup && ` (${selectedDeliveryDocGroup})`}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDeliveryWeek(null);
                    setSelectedDeliveryDocGroup(null);
                  }}
                  className="hover:text-emerald-950 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {selectedReprovadoExecutor && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-bold">
                Reprovado Executor: {selectedReprovadoExecutor}
                {selectedReprovadoDocGroup && ` • ${selectedReprovadoDocGroup}`}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedReprovadoExecutor(null);
                    setSelectedReprovadoDocGroup(null);
                  }}
                  className="hover:text-rose-950 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-300 text-[11px] font-bold">
                Busca: "{searchQuery}"
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="hover:text-slate-950 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            <button
              type="button"
              onClick={() => {
                setSelectedDocGroup(null);
                setSelectedRealStatus(null);
                setStatusFilter('ALL');
                setRegionalFilter('ALL');
                setTipoSiteFilter('ALL');
                setExecutorFilter('ALL');
                setSelectedDeliveryWeek(null);
                setSelectedDeliveryDocGroup(null);
                setSelectedReprovadoExecutor(null);
                setSelectedReprovadoDocGroup(null);
                setSearchQuery('');
              }}
              className="text-[11px] font-bold text-rose-600 hover:text-rose-800 underline ml-1 cursor-pointer"
            >
              Limpar todos os filtros
            </button>
          </div>
        )}

        {/* Counter indicator */}
        <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
          <span>
            Exibindo <strong>{filteredRows.length.toLocaleString('pt-BR')}</strong> de{' '}
            <strong className="text-slate-900 font-mono">
              {rows.length.toLocaleString('pt-BR')}
            </strong>{' '}
            linhas da planilha Ericsson.
          </span>
          <div className="flex items-center gap-2">
            <span>Linhas por página:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-md font-mono text-xs"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
            </select>
          </div>
        </div>
      </div>

      {/* =====================================================================
          4. INTERACTIVE SPREADSHEET TABLE
         ===================================================================== */}
      <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto max-h-[640px]">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-900 text-white sticky top-0 z-20 select-none">
              <tr>
                {/* Columns from the spreadsheet in exact order */}
                {columns.map((colName) => {
                  if (
                    viewMode === 'essential' &&
                    ![
                      'Intervencao Claro',
                      'Tipo doc',
                      'Status',
                      'Regional',
                      'TIPO SITE',
                      'EXECUTOR',
                      'Demanda',
                      'Planejado',
                      'Entregue',
                    ].includes(colName)
                  ) {
                    return null;
                  }
                  const isSorted = sortColumn === colName;
                  return (
                    <th
                      key={colName}
                      onClick={() => handleSortColumn(colName)}
                      className="px-3 py-2.5 text-left font-bold border-b border-slate-800 whitespace-nowrap min-w-[110px] cursor-pointer hover:bg-slate-800 transition-colors select-none group"
                      title={`Clique para ordenar por ${colName}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{colName}</span>
                        <span className="text-slate-400 group-hover:text-white shrink-0">
                          {isSorted ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp className="w-3.5 h-3.5 text-teal-400" />
                            ) : (
                              <ArrowDown className="w-3.5 h-3.5 text-teal-400" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30 group-hover:opacity-100" />
                          )}
                        </span>
                      </div>
                    </th>
                  );
                })}

                {/* Actions */}
                <th className="px-3 py-2.5 text-center font-bold border-b border-slate-800 sticky right-0 bg-slate-900 z-30 min-w-[90px]">
                  Ações
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={columns.length + 1} className="p-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-teal-600" />
                    <p className="font-semibold text-slate-700">Carregando dados da Engenharia Ericsson...</p>
                  </td>
                </tr>
              ) : paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} className="p-12 text-center text-slate-400">
                    <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="font-bold text-slate-700 text-sm">Nenhuma linha encontrada</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Ajuste os filtros de busca ou sincronize com o OneDrive.
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row) => {
                  const docGroup = classifyEricssonDocGroup(row.tipoDoc || row.fields?.['Tipo doc'] || '');
                  const statusCat = classifyEricssonStatus(row.status || row.fields?.['Status'] || '');

                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedDrawerRow(row)}
                      className="hover:bg-teal-50/60 hover:shadow-2xs transition-all group cursor-pointer"
                      title="Clique para abrir detalhes completos do site"
                    >
                      {/* 51 Exact Columns in Order */}
                      {columns.map((colName) => {
                        if (
                          viewMode === 'essential' &&
                          ![
                            'Intervencao Claro',
                            'Tipo doc',
                            'Status',
                            'Regional',
                            'TIPO SITE',
                            'EXECUTOR',
                            'Demanda',
                            'Planejado',
                            'Entregue',
                          ].includes(colName)
                        ) {
                          return null;
                        }

                        const cellVal = row.fields?.[colName] ?? '';

                        // Special badge styling for Tipo doc
                        if (colName === 'Tipo doc' && cellVal) {
                          return (
                            <td key={colName} className="px-3 py-2 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  docGroup === 'WR'
                                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                    : docGroup === 'QRF'
                                    ? 'bg-cyan-50 text-cyan-700 border border-cyan-200'
                                    : docGroup === 'PPI'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : docGroup === 'BOQ'
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                    : docGroup === 'SMART'
                                    ? 'bg-violet-50 text-violet-700 border border-violet-200'
                                    : docGroup === 'SDC'
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {cellVal}
                              </span>
                            </td>
                          );
                        }

                        // Special badge styling for Status
                        if (colName === 'Status' && cellVal) {
                          return (
                            <td key={colName} className="px-3 py-2 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  statusCat === 'Finalizado'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : statusCat === 'Em produção'
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : statusCat === 'Dúvida'
                                    ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                                }`}
                              >
                                {cellVal}
                              </span>
                            </td>
                          );
                        }

                        if (colName === 'EXECUTOR') {
                          const exVal =
                            cellVal ||
                            row.executor ||
                            row.fields?.['EXECUTOR WR'] ||
                            row.fields?.['EXECUTOR QRF'] ||
                            row.fields?.['EXECUTOR PPI'] ||
                            row.fields?.['Executor'] ||
                            '';
                          return (
                            <td
                              key={colName}
                              className="px-3 py-2 whitespace-nowrap text-slate-700 max-w-[200px] truncate"
                              title={String(exVal || '')}
                            >
                              {exVal ? (
                                <span className="font-semibold text-slate-900">{exVal}</span>
                              ) : (
                                <span className="text-slate-400 italic">—</span>
                              )}
                            </td>
                          );
                        }

                        return (
                          <td
                            key={colName}
                            className="px-3 py-2 whitespace-nowrap text-slate-700 max-w-[200px] truncate"
                            title={String(cellVal)}
                          >
                            {cellVal || '—'}
                          </td>
                        );
                      })}

                      {/* Row Actions */}
                      <td className="px-3 py-2 text-center whitespace-nowrap sticky right-0 bg-white group-hover:bg-slate-50 transition-colors shadow-l">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditRowModal(row);
                            }}
                            className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-slate-100 cursor-pointer"
                            title="Editar linha"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRow(row.id);
                            }}
                            className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100 cursor-pointer"
                            title="Excluir linha"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div>
            Página <strong className="font-mono">{page}</strong> de{' '}
            <strong className="font-mono">{totalPages}</strong>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold disabled:opacity-40 cursor-pointer hover:bg-slate-100 flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Anterior</span>
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold disabled:opacity-40 cursor-pointer hover:bg-slate-100 flex items-center gap-1"
            >
              <span>Próxima</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================================
          5. MODAL: SINCRONIZAR ONEDRIVE
         ===================================================================== */}
      {isOneDriveModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-teal-500 text-white flex items-center justify-center">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  Sincronizar com o OneDrive (Excel Online)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOneDriveModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600 leading-relaxed">
                Insira o link compartilhado da planilha da Ericsson no OneDrive.
                O sistema carrega todas as 51 colunas exatas da aba{' '}
                <strong>Site list</strong> e atualiza o consolidado em tempo real.
              </p>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Link do OneDrive (.XLSX):
                </label>
                <input
                  type="text"
                  value={oneDriveInputUrl}
                  onChange={(e) => setOneDriveInputUrl(e.target.value)}
                  placeholder="https://onedrive.live.com/:x:/g/personal/..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:outline-none focus:border-teal-500 focus:bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsOneDriveModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSyncingOneDrive || !oneDriveInputUrl.trim()}
                onClick={() => handleSyncOneDrive(oneDriveInputUrl.trim())}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[#1E8E8D] hover:bg-[#177271] text-white shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isSyncingOneDrive ? 'animate-spin' : ''}`}
                />
                <span>{isSyncingOneDrive ? 'Baixando...' : 'Carregar e Atualizar'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          6. MODAL: NOVA LINHA / EDITAR LINHA
         ===================================================================== */}
      {(isNewRowModalOpen || editingRow) && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-xl border border-slate-200 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {editingRow ? 'Editar Linha da Engenharia Ericsson' : '+ Nova Linha (Engenharia Ericsson)'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsNewRowModalOpen(false);
                  setEditingRow(null);
                }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs max-h-[60vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Intervencao Claro */}
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">
                    Intervenção Claro (ou Site):
                  </label>
                  <input
                    type="text"
                    value={formIntervencao}
                    onChange={(e) => {
                      setFormIntervencao(e.target.value);
                      if (!formSiteIdA) setFormSiteIdA(e.target.value);
                    }}
                    placeholder="Ex: SMPINB6_5A ou SISML02_5A"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-teal-500"
                  />
                </div>

                {/* Torre A (Site ID A) */}
                <div>
                  <label className="block font-bold text-amber-900 mb-1">
                    Torre A (Site ID A):
                  </label>
                  <input
                    type="text"
                    value={formSiteIdA}
                    onChange={(e) => setFormSiteIdA(e.target.value)}
                    placeholder="Ex: SMPINB6"
                    className="w-full px-3 py-2 bg-amber-50/50 border border-amber-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-amber-500"
                  />
                </div>

                {/* Status Site A */}
                <div>
                  <label className="block font-bold text-amber-900 mb-1">
                    Status Site A:
                  </label>
                  <select
                    value={formStatusA}
                    onChange={(e) => setFormStatusA(e.target.value)}
                    className="w-full px-3 py-2 bg-amber-50/50 border border-amber-300 rounded-xl text-xs focus:outline-none"
                  >
                    <option value="Finalizado">Finalizado</option>
                    <option value="Em produção">Em produção</option>
                    <option value="Pendente">Pendente</option>
                    <option value="Pendente - Dúvida">Pendente - Dúvida</option>
                    <option value="Documentação paralisada">Documentação paralisada</option>
                    <option value="Demanda cancelada">Demanda cancelada</option>
                  </select>
                </div>

                {/* Torre B (Site ID B) */}
                <div>
                  <label className="block font-bold text-cyan-900 mb-1">
                    Torre B (Site ID B) — Opcional / Par:
                  </label>
                  <input
                    type="text"
                    value={formSiteIdB}
                    onChange={(e) => setFormSiteIdB(e.target.value)}
                    placeholder="Ex: ESCIT81 (deixe vazio se único)"
                    className="w-full px-3 py-2 bg-cyan-50/50 border border-cyan-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {/* Status Site B */}
                <div>
                  <label className="block font-bold text-cyan-900 mb-1">
                    Status Site B:
                  </label>
                  <select
                    value={formStatusB}
                    onChange={(e) => setFormStatusB(e.target.value)}
                    className="w-full px-3 py-2 bg-cyan-50/50 border border-cyan-300 rounded-xl text-xs focus:outline-none"
                  >
                    <option value="Finalizado">Finalizado</option>
                    <option value="Em produção">Em produção</option>
                    <option value="Pendente">Pendente</option>
                    <option value="Pendente - Dúvida">Pendente - Dúvida</option>
                    <option value="Documentação paralisada">Documentação paralisada</option>
                    <option value="Demanda cancelada">Demanda cancelada</option>
                  </select>
                </div>

                {/* Tipo Doc */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Tipo doc (Documentação):
                  </label>
                  <select
                    value={formTipoDoc}
                    onChange={(e) => setFormTipoDoc(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500 font-bold"
                  >
                    <option value="WR">WR</option>
                    <option value="QRF">QRF</option>
                    <option value="PPI">PPI</option>
                    <option value="PPI/SDC">PPI/SDC</option>
                    <option value="BOQ">BOQ</option>
                    <option value="SMART">SMART</option>
                    <option value="SmartPlan - Revision">SmartPlan - Revision</option>
                    <option value="SDC">SDC</option>
                    <option value="REVISÃO WR">REVISÃO WR</option>
                    <option value="REVISÃO QRF">REVISÃO QRF</option>
                    <option value="REVISÃO PPI">REVISÃO PPI</option>
                  </select>
                </div>

                {/* Status Geral */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Status Geral:
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500"
                  >
                    <option value="Finalizado">Finalizado</option>
                    <option value="Em produção">Em produção</option>
                    <option value="Pendente">Pendente</option>
                    <option value="Pendente - Dúvida">Pendente - Dúvida</option>
                    <option value="Documentação paralisada">Documentação paralisada</option>
                    <option value="Demanda cancelada">Demanda cancelada</option>
                  </select>
                </div>

                {/* Regional */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Regional:
                  </label>
                  <input
                    type="text"
                    value={formRegional}
                    onChange={(e) => setFormRegional(e.target.value)}
                    placeholder="Ex: SPM, RJ, RS, SP2"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500"
                  />
                </div>

                {/* Tipo Site */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Tipo Site:
                  </label>
                  <input
                    type="text"
                    value={formTipoSite}
                    onChange={(e) => setFormTipoSite(e.target.value)}
                    placeholder="Ex: REUSO, NOVO"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500"
                  />
                </div>

                {/* Executor */}
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">
                    Executor:
                  </label>
                  <input
                    type="text"
                    value={formExecutor}
                    onChange={(e) => setFormExecutor(e.target.value)}
                    placeholder="Ex: Rafael Souza"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsNewRowModalOpen(false);
                  setEditingRow(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveRow}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-[#1E8E8D] hover:bg-[#177271] text-white shadow-xs cursor-pointer"
              >
                Salvar Linha
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          7. MODAL: ANEXAR ARQUIVO DIRETAMENTE AO SITE (SEM SUBPASTAS)
         ===================================================================== */}
      {attachingFileRow && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-teal-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Anexar Arquivo ao Site
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAttachingFileRow(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600">
                Anexe um relatório, documento técnico ou foto diretamente para o site{' '}
                <strong>{attachingFileRow.intervencaoClaro}</strong>. O arquivo fica salvo no
                próprio site, sem necessidade de subpastas.
              </p>

              <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl text-center space-y-2 bg-slate-50/70">
                <Paperclip className="w-6 h-6 text-slate-400 mx-auto" />
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="text-xs text-slate-700"
                />
                {selectedFile && (
                  <p className="font-mono text-[11px] text-teal-800 font-bold">
                    Selecionado: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAttachingFileRow(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!selectedFile || isUploadingFile}
                onClick={handleUploadRowAttachment}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[#1E8E8D] hover:bg-[#177271] text-white shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {isUploadingFile ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>{isUploadingFile ? 'Enviando...' : 'Anexar Arquivo'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          8. SIDE DRAWER: INFORMAÇÕES COMPLETAS DO SITE (ENGENHARIA ERICSSON)
         ===================================================================== */}
      {selectedDrawerRow && (
        <EricssonEngineeringDrawer
          row={selectedDrawerRow}
          isOpen={Boolean(selectedDrawerRow)}
          user={user}
          effectiveRole={effectiveRole}
          isOwner={user?.situacao === 'dono' || (Boolean(user?.email) && Boolean(user?.email?.includes('rafael.araujo')))}
          files={ericssonFiles}
          onClose={() => setSelectedDrawerRow(null)}
          onSaveRow={async (updatedRow) => {
            setRows((prev) =>
              prev.map((r) => (r.id === updatedRow.id ? updatedRow : r))
            );
            setSelectedDrawerRow(updatedRow);
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
};
