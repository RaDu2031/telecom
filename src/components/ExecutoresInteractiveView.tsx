import React, { useState, useMemo, useEffect } from 'react';
import {
  Users,
  Plus,
  Search,
  Mail,
  CheckCircle2,
  Clock,
  ArrowRight,
  Trash2,
  Edit3,
  Eye,
  X,
  CheckSquare,
  ExternalLink,
  UserCheck,
  Link2,
  HardHat,
  FileSpreadsheet,
  Calendar,
  AlertCircle,
  MapPin,
  Building,
  Tag,
  ShieldAlert,
} from 'lucide-react';
import { TssrRow, AmetaUser, VendorType } from '../types/telecom';
import { normalizeAccents } from '../utils/spreadsheetUtils';

const STORAGE_EXECUTOR_EMAILS_KEY = 'ameta_executor_emails_map_v1';

interface RowItem {
  id: string;
  vendor: VendorType;
  siteId: string;
  fields: Record<string, string>;
  vistoriaStatus: string;
  vistoriaFileId?: string;
  vistoriaFileName?: string;
  vistoriaFileUrl?: string;
  vistoriaDownloadUrl?: string;
  vistoriaDeliveredAt?: string;
  vistoriaUploadedBy?: string;
  vistoriaUploadedByEmail?: string;
  updatedAt: string;
  // Extra fields for type compatibility
  rowKey: string;
  tabName: string;
  ocSitePre: string;
  enderecoId: string;
  executor?: string;
  intervencaoClaro?: string;
  regional?: string;
  tipoDoc?: string;
  tipoSite?: string;
  status?: string;
  demanda?: string;
}

interface ExecutoresInteractiveViewProps {
  activeVendor?: VendorType;
  tssrRows: RowItem[];
  ericssonRows?: RowItem[];
  users: AmetaUser[];
  ericssonUsers?: AmetaUser[];
  serverExecutorEmailsMap?: Record<string, string[]>;
  executoresList: string[];
  onAddExecutor: (name: string) => void;
  onRenameExecutor: (oldName: string, newName: string) => Promise<void>;
  onDeleteExecutor: (name: string) => void;
  onAssignRowsToExecutor: (
    rowIds: string[],
    executorName: string,
    demandDate?: string
  ) => Promise<void>;
  onUnassignRowsFromExecutor: (
    rowIds: string[],
    executorName: string
  ) => Promise<void>;
  onClearExecutorRows: (executorName: string) => Promise<void>;
  onLinkEmailsToExecutor: (executorName: string, emails: string[]) => Promise<void>;
  onSimulateExecutorView?: (targetUser: AmetaUser) => void;
}

export const ExecutoresInteractiveView: React.FC<ExecutoresInteractiveViewProps> = ({
  activeVendor = 'NOKIA',
  tssrRows,
  ericssonRows = [],
  users,
  ericssonUsers = [],
  serverExecutorEmailsMap,
  executoresList,
  onAddExecutor,
  onRenameExecutor,
  onDeleteExecutor,
  onAssignRowsToExecutor,
  onUnassignRowsFromExecutor,
  onClearExecutorRows,
  onLinkEmailsToExecutor,
  onSimulateExecutorView,
}) => {
  const [selectedExecutor, setSelectedExecutor] = useState<string>(
    executoresList[0] || ''
  );
  const [executorSearch, setExecutorSearch] = useState<string>('');
  const [newExecutorName, setNewExecutorName] = useState<string>('');

  // Inline rename state
  const [editingExecutor, setEditingExecutor] = useState<string | null>(null);
  const [editingExecutorValue, setEditingExecutorValue] = useState<string>('');

  // Selected TSSR Row for Details Drawer
  const [drawerRow, setDrawerRow] = useState<RowItem | null>(null);

  // Registered profiles (vendor isolated)
  const allRegisteredUsers = useMemo<AmetaUser[]>(() => {
    const list = activeVendor === 'ERICSSON' ? ericssonUsers : users;
    const byEmail = new Map<string, AmetaUser>();
    list.forEach((u) => {
      const em = (u.email || '').trim().toLowerCase();
      if (em) byEmail.set(em, u);
    });
    return Array.from(byEmail.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR')
    );
  }, [users, ericssonUsers, activeVendor]);

  // Persisted map of Executor -> linked emails
  const [executorEmailsMap, setExecutorEmailsMap] = useState<Record<string, string[]>>(() => {
    try {
      const storageKey =
        activeVendor === 'ERICSSON'
          ? 'ameta_ericsson_executor_emails_map_v1'
          : STORAGE_EXECUTOR_EMAILS_KEY;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return {};
  });

  useEffect(() => {
    if (serverExecutorEmailsMap && Object.keys(serverExecutorEmailsMap).length > 0) {
      setExecutorEmailsMap((prev) => {
        const merged = { ...prev, ...serverExecutorEmailsMap };
        try {
          localStorage.setItem(STORAGE_EXECUTOR_EMAILS_KEY, JSON.stringify(merged));
        } catch {}
        return merged;
      });
    }
  }, [serverExecutorEmailsMap]);

  // Email linking controls
  const [selectedUserEmailToLink, setSelectedUserEmailToLink] = useState<string>('');
  const [emailSearchQuery, setEmailSearchQuery] = useState<string>('');
  const [isLinkingEmail, setIsLinkingEmail] = useState<boolean>(false);

  const filteredRegisteredUsers = useMemo(() => {
    const q = normalizeAccents(emailSearchQuery.trim().toLowerCase());
    if (!q) return allRegisteredUsers;
    return allRegisteredUsers.filter((u) => {
      const hay = normalizeAccents(
        `${u.name || ''} ${u.email || ''} ${u.role || ''}`.toLowerCase()
      );
      return hay.includes(q);
    });
  }, [allRegisteredUsers, emailSearchQuery]);

  // Site picker controls
  const [sitePickerSearch, setSitePickerSearch] = useState<string>('');
  const [sitePickerFilter, setSitePickerFilter] = useState<
    'ALL' | 'SEM_EXECUTOR' | 'PARA_FAZER' | 'ENTREGUES' | 'AGUARDANDO_APROVACAO'
  >('ALL');
  const [sitePickerUf, setSitePickerUf] = useState<string>('ALL');
  const [sitePickerProjeto, setSitePickerProjeto] = useState<string>('ALL');
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [isAssigning, setIsAssigning] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [mobileSection, setMobileSection] = useState<'ALL' | 'EXECUTORES' | 'DEMANDAR' | 'VINCULADOS'>(
    'ALL'
  );

  // Assigned search
  const [assignedSearch, setAssignedSearch] = useState<string>('');

  useEffect(() => {
    if (executoresList.length > 0 && !executoresList.includes(selectedExecutor)) {
      setSelectedExecutor(executoresList[0]);
    } else if (executoresList.length === 0 && selectedExecutor) {
      setSelectedExecutor('');
    }
  }, [executoresList, selectedExecutor]);

  const getLinkedEmailsForExecutor = (executorName: string): string[] => {
    const clean = executorName.trim();
    const cleanNorm = normalizeAccents(clean.toLowerCase());

    if (clean in executorEmailsMap) {
      return executorEmailsMap[clean] || [];
    }

    // Match with registered users where name or email matches executor
    const emailSet = new Set<string>();
    allRegisteredUsers.forEach((u) => {
      const uNameNorm = normalizeAccents((u.name || '').toLowerCase());
      if (uNameNorm === cleanNorm || (u.role === 'Executor' && uNameNorm.includes(cleanNorm))) {
        emailSet.add(u.email.trim().toLowerCase());
      }
    });

    return Array.from(emailSet);
  };

  const activeExecutorLinkedEmails = useMemo(
    () => getLinkedEmailsForExecutor(selectedExecutor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedExecutor, executorEmailsMap, allRegisteredUsers]
  );

  const saveExecutorEmails = async (executorName: string, nextEmails: string[]) => {
    const cleanEmails = Array.from(
      new Set(nextEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))
    );
    const cleanName = executorName.trim();
    const nextMap = {
      ...executorEmailsMap,
      [cleanName]: cleanEmails,
    };
    setExecutorEmailsMap(nextMap);
    try {
      localStorage.setItem(STORAGE_EXECUTOR_EMAILS_KEY, JSON.stringify(nextMap));
    } catch {}
    setIsLinkingEmail(true);
    try {
      await onLinkEmailsToExecutor(cleanName, cleanEmails);
    } finally {
      setIsLinkingEmail(false);
    }
  };

  const handleAddEmailLink = async (emailRaw: string) => {
    const clean = (emailRaw || '').trim().toLowerCase();
    if (!clean || !clean.includes('@')) return;
    const current = getLinkedEmailsForExecutor(selectedExecutor);
    const nextList = current.includes(clean) ? current : [...current, clean];
    setSelectedUserEmailToLink('');
    await saveExecutorEmails(selectedExecutor, nextList);
  };

  const handleRemoveEmailLink = async (emailToRemove: string) => {
    const current = getLinkedEmailsForExecutor(selectedExecutor).filter(
      (e) => e.toLowerCase() !== emailToRemove.toLowerCase()
    );
    await saveExecutorEmails(selectedExecutor, current);
  };

  // Active source rows: Ericsson Engenharia when ERICSSON, TSSR when NOKIA
  const activeSourceRows = useMemo(() => {
    return activeVendor === 'ERICSSON' ? (ericssonRows || []) : tssrRows;
  }, [activeVendor, ericssonRows, tssrRows]);

  // Helper match for row assigned to executor
  const isRowAssignedToExecutor = (row: RowItem, executorName: string): boolean => {
    const exField = (row.fields?.['Executor'] || row.fields?.['EXECUTOR'] || row.executor || '').trim();
    if (!exField || !executorName) return false;
    return normalizeAccents(exField.toLowerCase()) === normalizeAccents(executorName.trim().toLowerCase());
  };

  // Assigned rows for selected executor
  const assignedRowsForSelectedExecutor = useMemo(() => {
    if (!selectedExecutor) return [];
    return activeSourceRows.filter((r) => isRowAssignedToExecutor(r, selectedExecutor));
  }, [activeSourceRows, selectedExecutor]);

  const filteredAssignedRows = useMemo(() => {
    const q = assignedSearch.trim().toLowerCase();
    if (!q) return assignedRowsForSelectedExecutor;
    return assignedRowsForSelectedExecutor.filter((r) => {
      const hay = `${r.siteId} ${r.intervencaoClaro || ''} ${r.ocSitePre} ${r.enderecoId} ${r.fields?.['UF'] || ''} ${r.fields?.['Regional'] || ''} ${r.regional || ''} ${r.fields?.['Cidade'] || ''} ${r.fields?.['PROJETO'] || ''} ${r.fields?.['Tipo doc'] || ''} ${r.tipoDoc || ''} ${r.fields?.['TIPO SITE'] || ''} ${r.tipoSite || ''} ${r.fields?.['STATUS Engenharia'] || ''} ${r.fields?.['Status'] || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [assignedRowsForSelectedExecutor, assignedSearch]);

  // Dynamic filter options from activeSourceRows
  const availableUfs = useMemo(() => {
    const set = new Set<string>();
    activeSourceRows.forEach((r) => {
      const u = (r.fields?.['Regional'] || r.fields?.['UF'] || r.regional || r.enderecoId || '').trim().toUpperCase();
      if (u && u !== '—' && u !== '-') set.add(u);
    });
    return Array.from(set).sort();
  }, [activeSourceRows]);

  const availableProjetos = useMemo(() => {
    const set = new Set<string>();
    activeSourceRows.forEach((r) => {
      const p = (r.fields?.['Tipo doc'] || r.fields?.['PROJETO'] || r.fields?.['TIPO SITE'] || r.tipoDoc || '').trim();
      if (p && p !== '—' && p !== '-') set.add(p);
    });
    return Array.from(set).sort();
  }, [activeSourceRows]);

  // Candidate engineering sites in picker
  const pickerEngineeringRows = useMemo(() => {
    const assignedIds = new Set(assignedRowsForSelectedExecutor.map((r) => r.id));
    const q = sitePickerSearch.trim().toLowerCase();
    const tokens = q
      ? q
          .split(/[\s,;|\n\r\t]+/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    return activeSourceRows.filter((row) => {
      if (assignedIds.has(row.id)) return false;

      if (sitePickerUf !== 'ALL') {
        const u = (row.fields?.['Regional'] || row.fields?.['UF'] || row.regional || row.enderecoId || '').trim().toUpperCase();
        if (u !== sitePickerUf) return false;
      }

      if (sitePickerProjeto !== 'ALL') {
        const p = (row.fields?.['Tipo doc'] || row.fields?.['PROJETO'] || row.fields?.['TIPO SITE'] || row.tipoDoc || '').trim();
        if (p !== sitePickerProjeto) return false;
      }

      const ex = (row.fields?.['Executor'] || row.fields?.['EXECUTOR'] || row.executor || '').trim();
      const hasExecutor = ex !== '' && ex !== '—' && ex !== '-';
      const statusEng = (row.fields?.['STATUS Engenharia'] || row.fields?.['Status'] || row.vistoriaStatus || row.status || '').trim();
      const statusLower = statusEng.toLowerCase();
      const isEntregue =
        row.vistoriaStatus === 'Entregue' ||
        row.status === 'Finalizado' ||
        statusLower.includes('finalizado') ||
        statusLower.includes('entregue') ||
        statusLower.includes('aprovado');

      if (sitePickerFilter === 'SEM_EXECUTOR' && hasExecutor) return false;
      if (sitePickerFilter === 'PARA_FAZER' && isEntregue) return false;
      if (sitePickerFilter === 'ENTREGUES' && !isEntregue) return false;
      if (
        sitePickerFilter === 'AGUARDANDO_APROVACAO' &&
        !statusLower.includes('aguardando') &&
        !statusLower.includes('análise') &&
        !statusLower.includes('analise')
      ) {
        return false;
      }

      if (tokens.length > 0) {
        const hay = `${row.siteId} ${row.intervencaoClaro || ''} ${row.ocSitePre} ${row.enderecoId} ${row.fields?.['UF'] || ''} ${row.fields?.['Regional'] || ''} ${row.regional || ''} ${row.fields?.['Cidade'] || ''} ${row.fields?.['PROJETO'] || ''} ${row.fields?.['Tipo doc'] || ''} ${row.tipoDoc || ''} ${row.fields?.['TIPO SITE'] || ''} ${row.tipoSite || ''} ${statusEng} ${ex}`.toLowerCase();
        if (tokens.length === 1) {
          return hay.includes(tokens[0]);
        }
        return tokens.some((tk) => hay.includes(tk));
      }

      return true;
    });
  }, [
    activeSourceRows,
    assignedRowsForSelectedExecutor,
    sitePickerSearch,
    sitePickerFilter,
    sitePickerUf,
    sitePickerProjeto,
  ]);

  const toggleSelectRow = (rowId: string) => {
    setSelectedRowIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]
    );
  };

  const handleSelectAllVisiblePicker = () => {
    const visibleIds = pickerEngineeringRows.slice(0, 100).map((r) => r.id);
    const allSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedRowIds.includes(id));
    if (allSelected) {
      setSelectedRowIds([]);
    } else {
      setSelectedRowIds(visibleIds);
    }
  };

  const handleConfirmAssignSelected = async () => {
    if (selectedRowIds.length === 0 || !selectedExecutor) return;
    setIsAssigning(true);
    try {
      await onAssignRowsToExecutor(selectedRowIds, selectedExecutor);
      setSelectedRowIds([]);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleClearAllForSelectedExecutor = async () => {
    if (assignedRowsForSelectedExecutor.length === 0 || isClearing) return;
    if (
      !window.confirm(
        `Desvincular todos os ${assignedRowsForSelectedExecutor.length} sites da Engenharia atribuídos a "${selectedExecutor}"?`
      )
    ) {
      return;
    }
    setIsClearing(true);
    try {
      await onClearExecutorRows(selectedExecutor);
      setAssignedSearch('');
      setSelectedRowIds([]);
    } finally {
      setIsClearing(false);
    }
  };

  const handleSimulateSelectedExecutor = () => {
    if (!onSimulateExecutorView) return;
    const matchedUser = allRegisteredUsers.find((u) =>
      activeExecutorLinkedEmails.includes(u.email.trim().toLowerCase())
    );
    if (matchedUser) {
      onSimulateExecutorView({
        ...matchedUser,
        role: 'Executor',
        assignedPlatform: activeVendor === 'ERICSSON' ? 'ERICSSON' : 'NOKIA',
      });
      return;
    }

    onSimulateExecutorView({
      id: `sim-exec-${selectedExecutor}`,
      name: selectedExecutor,
      email:
        activeExecutorLinkedEmails[0] ||
        `${selectedExecutor
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '.')
          .replace(/\.+/g, '.')
          .replace(/^\.|\.$/g, '')}@ametaservicos.com.br`,
      role: 'Executor',
      assignedPlatform: activeVendor === 'ERICSSON' ? 'ERICSSON' : 'NOKIA',
      equipe: selectedExecutor,
      emailVerified: true,
      createdAt: new Date().toISOString(),
    });
  };

  // Filtered executors in left sidebar
  const filteredExecutores = useMemo(() => {
    const q = executorSearch.trim().toLowerCase();
    return executoresList.filter((ex) => {
      if (!q) return true;
      const emails = getLinkedEmailsForExecutor(ex).join(' ');
      return ex.toLowerCase().includes(q) || emails.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executoresList, executorSearch, executorEmailsMap, allRegisteredUsers]);

  const activeAssignedCount = assignedRowsForSelectedExecutor.length;
  const activePickerCount = pickerEngineeringRows.length;

  return (
    <div className="space-y-3">
      {/* =====================================================================
          MOBILE QUICK BAR (lg:hidden): OPÇÕES BEM APARENTES NO MOBILE
         ===================================================================== */}
      <div className="lg:hidden bg-slate-900 text-white border border-slate-800 rounded-2xl p-3.5 shadow-md space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <HardHat className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              1. Executor Selecionado (
              {activeVendor === 'ERICSSON'
                ? 'Planilha Engenharia Ericsson'
                : 'Planilha Engenharia TIM'}
              )
            </span>
          </span>
          <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-mono font-black">
            {activeAssignedCount} site(s)
          </span>
        </div>

        <select
          value={selectedExecutor}
          onChange={(e) => {
            setSelectedExecutor(e.target.value);
            setSelectedRowIds([]);
          }}
          className="w-full px-3.5 py-3 bg-white text-slate-950 font-black rounded-xl text-sm border-2 border-amber-400 focus:outline-none shadow-sm"
        >
          {executoresList.map((ex) => (
            <option key={ex} value={ex}>
              Executor: {ex}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-2 text-xs font-black">
          {(
            [
              { id: 'ALL', label: 'Ver Tudo na Tela' },
              { id: 'DEMANDAR', label: 'E-mail & Demandar Site' },
              { id: 'EXECUTORES', label: `Lista Executores (${executoresList.length})` },
              { id: 'VINCULADOS', label: `Sites Engenharia (${activeAssignedCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMobileSection(tab.id)}
              className={`py-2.5 px-2.5 rounded-xl text-center truncate transition-all cursor-pointer border ${
                mobileSection === tab.id
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-sm font-black'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* =====================================================================
            LEFT COLUMN (4 COLS): LISTA INTERATIVA DE EXECUTORES + CRIAR NOVO
           ===================================================================== */}
        <div
          className={`lg:col-span-4 bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden flex flex-col ${
            mobileSection !== 'ALL' && mobileSection !== 'EXECUTORES' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="p-4 bg-slate-900 text-white space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardHat className="w-4 h-4 text-amber-400" />
                <div>
                  <h2 className="text-xs font-bold">
                    1. Selecionar Executor ({executoresList.length})
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    {activeVendor === 'ERICSSON'
                      ? 'Apenas sites da planilha da Engenharia Ericsson'
                      : 'Apenas sites da planilha da Engenharia (TSSR TIM Nokia)'}
                  </p>
                </div>
              </div>
            </div>

            {/* Add New Executor Input */}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newExecutorName}
                onChange={(e) => setNewExecutorName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newExecutorName.trim()) {
                    e.preventDefault();
                    const clean = newExecutorName.trim();
                    onAddExecutor(clean);
                    setSelectedExecutor(clean);
                    setNewExecutorName('');
                  }
                }}
                placeholder="Novo executor (ex: Felipe Pimentel)..."
                className="flex-1 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-400"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newExecutorName.trim()) return;
                  const clean = newExecutorName.trim();
                  onAddExecutor(clean);
                  setSelectedExecutor(clean);
                  setNewExecutorName('');
                }}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Criar</span>
              </button>
            </div>

            {/* Search Executor */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                value={executorSearch}
                onChange={(e) => setExecutorSearch(e.target.value)}
                placeholder="Buscar executor ou e-mail vinculado..."
                className="w-full pl-8 pr-2.5 py-1.5 bg-slate-800/80 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>

          {/* Scrollable List of Executores */}
          <div className="divide-y divide-slate-100 max-h-72 lg:max-h-[640px] overflow-y-auto p-2 space-y-1">
            {filteredExecutores.length === 0 && (
              <div className="p-4 text-center space-y-2 text-xs text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <p className="font-bold text-slate-700">Nenhum executor cadastrado ainda</p>
                <p className="text-[11px] leading-relaxed">
                  Adicione um executor acima ou registre usuários com o perfil Executor.
                </p>
              </div>
            )}
              {filteredExecutores.map((executor) => {
                const isSelected = selectedExecutor === executor;
                const isEditing = editingExecutor === executor;
                const linkedEmails = getLinkedEmailsForExecutor(executor);

                const executorRows = [
                  ...tssrRows.filter((r) => isRowAssignedToExecutor(r, executor)),
                  ...ericssonRows.filter((r) => isRowAssignedToExecutor(r, executor)),
                ];
                const totalSitesCount = executorRows.length;
                const entreguesCount = executorRows.filter(
                  (r) => r.vistoriaStatus === 'Entregue'
                ).length;
                const fazerCount = totalSitesCount - entreguesCount;
                const aguardandoCount = executorRows.filter((r) =>
                  (r.fields?.['STATUS Engenharia'] || '').toLowerCase().includes('aguardando')
                ).length;
                
                const nokiaActive = executorRows.some(r => r.vendor === 'NOKIA' && r.vistoriaStatus !== 'Entregue');
                const ericssonActive = executorRows.some(r => r.vendor === 'ERICSSON' && r.vistoriaStatus !== 'Entregue');
                const isDisponivel = totalSitesCount > 0 && entreguesCount === totalSitesCount;

                return (
                  <div
                    key={executor}
                    onClick={() => {
                      setSelectedExecutor(executor);
                      setSelectedRowIds([]);
                    }}
                    className={`p-2.5 rounded-xl cursor-pointer transition-all border ${
                      isSelected
                        ? 'bg-amber-50/80 border-amber-400 shadow-2xs ring-1 ring-amber-400'
                        : 'bg-white hover:bg-slate-50 border-slate-200/80'
                    }`}
                  >
                    {isEditing ? (
                      <div
                        className="flex items-center gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={editingExecutorValue}
                          onChange={(e) => setEditingExecutorValue(e.target.value)}
                          className="flex-1 px-2 py-1 border border-amber-500 rounded text-xs focus:outline-none"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (editingExecutorValue.trim()) {
                              await onRenameExecutor(executor, editingExecutorValue.trim());
                              if (selectedExecutor === executor) {
                                setSelectedExecutor(editingExecutorValue.trim());
                              }
                            }
                            setEditingExecutor(null);
                          }}
                          className="px-2 py-1 bg-emerald-600 text-white rounded text-xs font-semibold cursor-pointer"
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingExecutor(null)}
                          className="px-2 py-1 bg-slate-200 text-slate-700 rounded text-xs cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-slate-900 truncate">
                                {executor}
                              </span>
                              <span className="px-1.5 py-0.2 bg-amber-100 text-amber-900 rounded text-[10px] font-mono font-bold">
                                {totalSitesCount} sites
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-1">
                                {isDisponivel ? <span className="text-emerald-600 font-bold">Disponível</span> : (
                                  <>
                                    {nokiaActive && <span className="text-blue-600 font-bold">Nokia Ativo</span>}
                                    {ericssonActive && <span className="text-teal-600 font-bold">Ericsson Ativo</span>}
                                  </>
                                )}
                            </div>
                            {linkedEmails.length > 0 ? (
                              <p className="text-[10px] text-blue-600 truncate flex items-center gap-1 mt-0.5">
                                <Mail className="w-3 h-3 shrink-0" />
                                <span className="truncate">{linkedEmails[0]}</span>
                                {linkedEmails.length > 1 && (
                                  <span className="text-slate-400">+{linkedEmails.length - 1}</span>
                                )}
                              </p>
                            ) : (
                              <p className="text-[10px] text-slate-400 italic mt-0.5">
                                Sem e-mail vinculado
                              </p>
                            )}
                          </div>
                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setEditingExecutor(executor);
                                setEditingExecutorValue(executor);
                              }}
                              className="p-1 text-slate-400 hover:text-amber-600 rounded hover:bg-white cursor-pointer"
                              title="Renomear executor"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteExecutor(executor)}
                              className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-white cursor-pointer"
                              title="Remover executor"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {/* Mini stats row */}
                        <div className="flex items-center gap-1.5 text-[10px] font-mono pt-1 border-t border-slate-200/60">
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/80">
                            Pendente: {fazerCount}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200/80">
                            Entregue: {entreguesCount}
                          </span>
                          {aguardandoCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200/80">
                              Aguardando: {aguardandoCount}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* =====================================================================
            RIGHT COLUMN (8 COLS): VÍNCULO DE E-MAIL + DISTRIBUIÇÃO DE SITES
           ===================================================================== */}
        <div
          className={`lg:col-span-8 space-y-4 ${
            mobileSection === 'EXECUTORES' ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Card A: Selected Executor Header & Profile Email Linker */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-2xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center shadow-2xs shrink-0">
                  <HardHat className="w-5 h-5 text-slate-950" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 truncate">
                      Executor Selecionado: {selectedExecutor}
                    </h3>
                    <span className="px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-900 rounded-md text-[11px] font-mono font-bold">
                      {activeAssignedCount} site(s) da Engenharia
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Vincule o e-mail de login abaixo e selecione quais sites da Engenharia vão aparecer para ele.
                  </p>
                </div>
              </div>

              {onSimulateExecutorView && (
                <button
                  type="button"
                  onClick={handleSimulateSelectedExecutor}
                  className="w-full sm:w-auto justify-center px-3.5 py-2.5 sm:py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center gap-2 cursor-pointer shadow-2xs"
                  title="Ver exatamente como a planilha e os sites aparecem quando este executor entra no sistema"
                >
                  <Eye className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Ver como aparece para ele ({activeAssignedCount} sites)</span>
                </button>
              )}
            </div>

            {/* Profile Email Linker Box */}
            <div className="p-3.5 sm:p-4 bg-amber-50/60 border-2 border-amber-300 rounded-2xl space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center shrink-0">
                  <Link2 className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs sm:text-sm font-black text-slate-900 block">
                    Escolher E-mail para Demandar — Executor "{selectedExecutor}"
                  </span>
                  <span className="text-[11px] text-slate-600 block">
                    Pesquise abaixo por nome ou e-mail e clique em Vincular
                  </span>
                </div>
              </div>

              {/* Active Linked Emails Chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {activeExecutorLinkedEmails.length > 0 ? (
                  activeExecutorLinkedEmails.map((email) => {
                    const matchedProfile = allRegisteredUsers.find(
                      (u) => u.email.toLowerCase() === email.toLowerCase()
                    );
                    return (
                      <span
                        key={email}
                        className="inline-flex flex-wrap items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border-2 border-amber-400 text-slate-900 text-xs font-bold shadow-2xs max-w-full"
                      >
                        <Mail className="w-4 h-4 text-amber-600 shrink-0" />
                        <span className="font-mono font-bold break-all sm:break-normal">
                          {email}
                        </span>
                        {matchedProfile && (
                          <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-900 font-bold rounded-md">
                            {matchedProfile.name} ({matchedProfile.role})
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveEmailLink(email)}
                          className="text-red-500 hover:text-red-700 ml-1 p-1 bg-red-50 rounded-md cursor-pointer"
                          title="Desvincular este e-mail do executor"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </span>
                    );
                  })
                ) : (
                  <span className="text-xs font-semibold text-amber-900 bg-amber-100/80 border border-amber-300 px-3 py-1.5 rounded-lg">
                    Nenhum e-mail vinculado ainda. Escolha um perfil abaixo:
                  </span>
                )}
              </div>

              {/* Selector / Search Input */}
              <div className="space-y-2.5 pt-1">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 sm:top-2.5" />
                    <input
                      type="text"
                      value={emailSearchQuery}
                      onChange={(e) => setEmailSearchQuery(e.target.value)}
                      placeholder="Buscar por nome, e-mail ou perfil..."
                      className="w-full pl-9 pr-3 py-2.5 sm:py-2 bg-white border-2 border-amber-300 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 shadow-2xs"
                    />
                  </div>

                  <select
                    value={selectedUserEmailToLink}
                    onChange={(e) => setSelectedUserEmailToLink(e.target.value)}
                    className="w-full sm:w-auto px-3 py-2.5 sm:py-2 bg-white border-2 border-amber-300 rounded-xl text-xs sm:text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
                  >
                    <option value="">-- Escolher Usuário Cadastrado --</option>
                    {filteredRegisteredUsers.map((u) => {
                      const alreadyLinked = activeExecutorLinkedEmails.includes(
                        u.email.trim().toLowerCase()
                      );
                      return (
                        <option key={u.email} value={u.email}>
                          {alreadyLinked ? '✓ ' : ''}
                          {u.name} — {u.email} ({u.role})
                        </option>
                      );
                    })}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      handleAddEmailLink(selectedUserEmailToLink);
                      setEmailSearchQuery('');
                    }}
                    disabled={!selectedUserEmailToLink || isLinkingEmail}
                    className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wide rounded-xl whitespace-nowrap cursor-pointer shadow-sm"
                  >
                    {isLinkingEmail ? 'Vinculando...' : '+ Vincular E-mail'}
                  </button>
                </div>

                {emailSearchQuery.trim().length > 0 && (
                  <div className="bg-white border-2 border-amber-300 rounded-xl shadow-md max-h-56 overflow-y-auto divide-y divide-slate-100">
                    {filteredRegisteredUsers.length === 0 ? (
                      <div className="px-3.5 py-3 text-xs font-semibold text-slate-500">
                        Nenhum perfil encontrado para "{emailSearchQuery}".
                      </div>
                    ) : (
                      filteredRegisteredUsers.slice(0, 10).map((u) => {
                        const alreadyLinked = activeExecutorLinkedEmails.includes(
                          u.email.trim().toLowerCase()
                        );
                        return (
                          <div
                            key={u.email}
                            className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-amber-50/50 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 flex flex-wrap items-center gap-1.5">
                                <span>{u.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">
                                  {u.role}
                                </span>
                              </div>
                              <div className="font-mono text-xs font-semibold text-slate-700 break-all mt-0.5">
                                {u.email}
                              </div>
                            </div>
                            {alreadyLinked ? (
                              <span className="text-xs font-bold text-emerald-700 shrink-0">
                                ✓ Já vinculado
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  handleAddEmailLink(u.email);
                                  setEmailSearchQuery('');
                                }}
                                disabled={isLinkingEmail}
                                className="w-full sm:w-auto px-4 py-2 sm:py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-lg shrink-0 cursor-pointer text-center shadow-2xs"
                              >
                                + Vincular Este E-mail
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card B: Dual-Column Workspace (Sites da Planilha da Engenharia) */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* PANEL 1: SELECIONAR SITES DA ENGENHARIA PARA MANDAR PARA O EXECUTOR */}
            <div
              className={`bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden flex flex-col ${
                mobileSection === 'VINCULADOS' ? 'hidden lg:flex' : 'flex'
              }`}
            >
              <div className="p-3.5 bg-white border-b border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      <span>
                        2. Sites da Engenharia{' '}
                        {activeVendor === 'ERICSSON' ? 'Ericsson' : 'TIM Nokia'}{' '}
                        para "{selectedExecutor}"
                      </span>
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {activeVendor === 'ERICSSON'
                        ? 'Somente sites da planilha de Engenharia da Ericsson'
                        : 'Somente sites da planilha TSSR TIM Nokia da Engenharia'}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded text-[11px] font-mono font-bold">
                    {activePickerCount} disponíveis
                  </span>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={sitePickerSearch}
                    onChange={(e) => setSitePickerSearch(e.target.value)}
                    placeholder={
                      activeVendor === 'ERICSSON'
                        ? 'Buscar Intervenção Claro, Site ID, Regional, Tipo Doc...'
                        : 'Buscar Site Id, Oc Site Pre, Enderecoid, Cidade...'
                    }
                    className="w-full pl-8 pr-7 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-amber-500"
                  />
                  {sitePickerSearch && (
                    <button
                      type="button"
                      onClick={() => setSitePickerSearch('')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Filter Pills + Dropdowns */}
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        { id: 'ALL', label: 'Todos' },
                        { id: 'SEM_EXECUTOR', label: 'Sem Executor' },
                        { id: 'PARA_FAZER', label: 'Pendente' },
                        { id: 'ENTREGUES', label: 'Entregues' },
                        { id: 'AGUARDANDO_APROVACAO', label: 'Aguardando' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSitePickerFilter(f.id)}
                        className={`px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer ${
                          sitePickerFilter === f.id
                            ? 'bg-slate-900 text-white font-semibold'
                            : 'bg-[#F3F4F6] hover:bg-slate-200 text-slate-600'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1">
                    <select
                      value={sitePickerUf}
                      onChange={(e) => setSitePickerUf(e.target.value)}
                      className="px-2 py-1 bg-[#F3F4F6] border border-slate-200 rounded-md text-[11px] font-semibold text-slate-700"
                    >
                      <option value="ALL">
                        {activeVendor === 'ERICSSON' ? 'Todas Regionais' : 'Todas UFs'}
                      </option>
                      {availableUfs.map((u) => (
                        <option key={u} value={u}>
                          {activeVendor === 'ERICSSON' ? `Reg: ${u}` : `UF: ${u}`}
                        </option>
                      ))}
                    </select>

                    <select
                      value={sitePickerProjeto}
                      onChange={(e) => setSitePickerProjeto(e.target.value)}
                      className="px-2 py-1 bg-[#F3F4F6] border border-slate-200 rounded-md text-[11px] font-semibold text-slate-700 max-w-[120px] truncate"
                    >
                      <option value="ALL">
                        {activeVendor === 'ERICSSON' ? 'Tipo Doc / Projeto' : 'Projetos'}
                      </option>
                      {availableProjetos.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Bulk Action Bar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleSelectAllVisiblePicker}
                    className="py-2 px-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-800 flex items-center justify-center sm:justify-start gap-1.5 cursor-pointer"
                  >
                    <CheckSquare className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      {selectedRowIds.length > 0
                        ? `Desmarcar (${selectedRowIds.length})`
                        : `Selecionar todos (${Math.min(100, activePickerCount)})`}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={selectedRowIds.length === 0 || isAssigning || !selectedExecutor}
                    onClick={handleConfirmAssignSelected}
                    className="w-full sm:w-auto justify-center px-4 py-3 sm:py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wide rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <span>
                      Demandar {selectedRowIds.length > 0 ? `${selectedRowIds.length} ` : ''}Site(s)
                      para {selectedExecutor}
                    </span>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </button>
                </div>
              </div>

              {/* Scrollable Picker List */}
              <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
                {pickerEngineeringRows.slice(0, 120).map((row) => {
                  const isChecked = selectedRowIds.includes(row.id);
                  const currentEx = (row.fields?.['Executor'] || row.fields?.['EXECUTOR'] || row.executor || '').trim();
                  const statusEng = (row.fields?.['STATUS Engenharia'] || row.fields?.['Status'] || row.vistoriaStatus || row.status || '').trim();
                  const statusLower = statusEng.toLowerCase();
                  const isEntregue =
                    row.vistoriaStatus === 'Entregue' ||
                    row.status === 'Finalizado' ||
                    statusLower.includes('finalizado') ||
                    statusLower.includes('entregue') ||
                    statusLower.includes('aprovado');
                  const uf = (row.fields?.['Regional'] || row.fields?.['UF'] || row.regional || row.enderecoId || '').trim();
                  const cidade = (row.fields?.['Cidade'] || '').trim();
                  const projeto = (row.fields?.['Tipo doc'] || row.fields?.['PROJETO'] || row.fields?.['TIPO SITE'] || row.tipoDoc || '').trim();

                  return (
                    <div
                      key={row.id}
                      onClick={() => toggleSelectRow(row.id)}
                      className={`px-3.5 py-2.5 hover:bg-amber-50/40 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors ${
                        isChecked ? 'bg-amber-50/80 border-l-4 border-amber-500' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300 mt-0.5 shrink-0 pointer-events-none"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-black text-slate-900">
                              {row.siteId}
                            </span>
                            {row.ocSitePre && (
                              <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-mono">
                                OC: {row.ocSitePre}
                              </span>
                            )}
                            {row.enderecoId && (
                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-800 rounded text-[10px] font-mono">
                                {row.enderecoId}
                              </span>
                            )}
                            {uf && (
                              <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold">
                                {uf} {cidade ? `· ${cidade}` : ''}
                              </span>
                            )}
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                isEntregue
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                              }`}
                            >
                              {isEntregue ? 'Entregue' : 'Pendente'}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-500 truncate mt-0.5 flex flex-wrap items-center gap-1.5">
                            {projeto && <span>{projeto} ·</span>}
                            {statusEng && (
                              <span className="font-semibold text-slate-700">
                                {statusEng} ·
                              </span>
                            )}
                            {currentEx ? (
                              <span className="text-amber-800 font-semibold">
                                Atual: {currentEx}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">Sem executor</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawerRow(row);
                          }}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                          title="Ver detalhes da planilha"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (selectedExecutor) {
                              onAssignRowsToExecutor([row.id], selectedExecutor);
                            }
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-emerald-600 hover:text-white text-emerald-700 border border-emerald-300 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs"
                          title={`Mandar ${row.siteId} para ${selectedExecutor}`}
                        >
                          <span>Mandar</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {activePickerCount === 0 && (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Nenhum site da Engenharia encontrado com este filtro.
                  </div>
                )}
              </div>
            </div>

            {/* PANEL 2: SITES DA ENGENHARIA VINCULADOS AO EXECUTOR */}
            <div
              className={`bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden flex flex-col ${
                mobileSection === 'DEMANDAR' ? 'hidden lg:flex' : 'flex'
              }`}
            >
              <div className="p-3.5 bg-slate-900 text-white space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-emerald-400" />
                    <div>
                      <h4 className="text-xs font-bold">
                        3. Sites que Aparecem para "{selectedExecutor}" ({activeAssignedCount})
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Aparecem na Engenharia filtrados para {activeExecutorLinkedEmails[0] || 'este executor'}
                      </p>
                    </div>
                  </div>

                  {activeAssignedCount > 0 && (
                    <button
                      type="button"
                      disabled={isClearing}
                      onClick={handleClearAllForSelectedExecutor}
                      className="px-2.5 py-1 bg-red-600/90 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold transition-colors cursor-pointer shrink-0 shadow-2xs"
                    >
                      {isClearing ? 'Limpando...' : `Desvincular Todos (${activeAssignedCount})`}
                    </button>
                  )}
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={assignedSearch}
                    onChange={(e) => setAssignedSearch(e.target.value)}
                    placeholder={`Filtrar nos ${activeAssignedCount} sites deste executor...`}
                    className="w-full pl-8 pr-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="divide-y divide-slate-100 max-h-[515px] overflow-y-auto">
                {filteredAssignedRows.map((row) => {
                  const statusEng = (row.fields?.['STATUS Engenharia'] || row.fields?.['Status'] || row.vistoriaStatus || row.status || '').trim();
                  const statusLower = statusEng.toLowerCase();
                  const isEntregue =
                    row.vistoriaStatus === 'Entregue' ||
                    row.status === 'Finalizado' ||
                    statusLower.includes('finalizado') ||
                    statusLower.includes('entregue') ||
                    statusLower.includes('aprovado');
                  const demandDate = (row.fields?.['Data de demanda'] || row.fields?.['Data Demanda'] || row.fields?.['Demanda'] || row.demanda || '').trim();
                  const uf = (row.fields?.['Regional'] || row.fields?.['UF'] || row.regional || row.enderecoId || '').trim();
                  const cidade = (row.fields?.['Cidade'] || '').trim();
                  const projeto = (row.fields?.['Tipo doc'] || row.fields?.['PROJETO'] || row.fields?.['TIPO SITE'] || row.tipoDoc || '').trim();

                  return (
                    <div
                      key={row.id}
                      className="px-3.5 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono font-black text-slate-900">
                            {row.siteId}
                          </span>
                          {row.ocSitePre && (
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-mono">
                              OC: {row.ocSitePre}
                            </span>
                          )}
                          {row.enderecoId && (
                            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-800 rounded text-[10px] font-mono">
                              {row.enderecoId}
                            </span>
                          )}
                          {uf && (
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-mono">
                              {uf} {cidade ? `· ${cidade}` : ''}
                            </span>
                          )}
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold inline-flex items-center gap-1 ${
                              isEntregue
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {isEntregue ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <Clock className="w-3 h-3" />
                            )}
                            <span>{isEntregue ? 'Entregue' : 'Pendente'}</span>
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 truncate mt-0.5 flex flex-wrap items-center gap-1.5">
                          {projeto && <span>{projeto} ·</span>}
                          {statusEng && (
                            <span className="font-semibold text-slate-700">
                              {statusEng}
                            </span>
                          )}
                          {demandDate && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                              Demanda: {demandDate}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setDrawerRow(row)}
                          className="px-2 py-1 bg-[#F3F4F6] hover:bg-slate-200 text-slate-700 rounded-md text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                          title="Abrir ficha com todas as colunas da planilha"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Ficha</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onUnassignRowsFromExecutor([row.id], selectedExecutor)}
                          className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-md text-[11px] font-medium cursor-pointer"
                          title={`Desvincular ${row.siteId} deste executor`}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  );
                })}

                {activeAssignedCount === 0 && (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Nenhum site da Engenharia demandado para este executor ainda. Selecione na coluna ao lado para demandar.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          SLIDE-OVER DRAWER: DETALHES COMPLETOS DO SITE DA ENGENHARIA (TSSR ROW)
         ===================================================================== */}
      {drawerRow && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/50 backdrop-blur-2xs animate-fadeIn">
          <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col z-50 overflow-hidden">
            {/* Drawer Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black">
                  <HardHat className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-mono font-black text-sm text-white truncate">
                      {drawerRow.siteId}
                    </h3>
                    <span className="px-2 py-0.5 bg-amber-400 text-slate-950 rounded text-[10px] font-bold">
                      {drawerRow.tabName || (activeVendor === 'ERICSSON' ? 'Engenharia Ericsson' : 'TSSR TIM Nokia')}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {drawerRow.ocSitePre ? `OC: ${drawerRow.ocSitePre} · ` : ''}
                    {drawerRow.enderecoId ? `Endereço: ${drawerRow.enderecoId}` : ''}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDrawerRow(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Body: All Engineering Fields */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {/* Highlight Card: Executor & Demanda Status */}
              <div className="p-3.5 bg-amber-50/80 border-2 border-amber-300 rounded-xl space-y-2">
                <span className="text-[10px] font-black uppercase text-amber-900 tracking-wider">
                  Status de Demanda do Executor
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Executor Atual:</span>
                    <span className="font-bold text-slate-900">
                      {drawerRow.fields?.['Executor'] || 'Nenhum'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Data de Demanda:</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {drawerRow.fields?.['Data de demanda'] || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">STATUS Engenharia:</span>
                    <span className="font-bold text-purple-900 bg-purple-100 px-1.5 py-0.5 rounded inline-block">
                      {drawerRow.fields?.['STATUS Engenharia'] || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Vistoria:</span>
                    <span
                      className={`font-bold px-1.5 py-0.5 rounded inline-block ${
                        drawerRow.vistoriaStatus === 'Entregue'
                          ? 'bg-emerald-100 text-emerald-900'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {drawerRow.vistoriaStatus === 'Entregue' ? 'Entregue' : 'Pendente'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Localização & Identificação */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5 border-b pb-1">
                  <MapPin className="w-4 h-4 text-slate-500" />
                  <span>Identificação & Localização</span>
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">Site Id:</span>
                    <span className="font-mono font-bold text-slate-900">{drawerRow.siteId}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">OC Site Pre:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {drawerRow.ocSitePre || drawerRow.fields?.['Oc Site Pre'] || '—'}
                    </span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">Enderecoid:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {drawerRow.enderecoId || drawerRow.fields?.['Enderecoid'] || '—'}
                    </span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">Regional (Reg):</span>
                    <span className="font-bold text-slate-900">{drawerRow.fields?.['Reg'] || '—'}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">UF:</span>
                    <span className="font-bold text-slate-900">{drawerRow.fields?.['UF'] || '—'}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">Cidade:</span>
                    <span className="font-bold text-slate-900">{drawerRow.fields?.['Cidade'] || '—'}</span>
                  </div>
                </div>
              </div>

              {/* Projeto & Escopo */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5 border-b pb-1">
                  <Tag className="w-4 h-4 text-slate-500" />
                  <span>Projeto & Engenharia</span>
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">PROJETO:</span>
                    <span className="font-bold text-slate-900">{drawerRow.fields?.['PROJETO'] || '—'}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">DETENTORA:</span>
                    <span className="font-bold text-slate-900">{drawerRow.fields?.['DETENTORA'] || '—'}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">DEMANDA RECEBIDA:</span>
                    <span className="font-mono text-slate-800">
                      {drawerRow.fields?.['DEMANDA RECEBIDA'] || '—'}
                    </span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">TIPO DE DOC:</span>
                    <span className="font-bold text-slate-900">{drawerRow.fields?.['TIPO DE DOC'] || '—'}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">Prioridade Homero:</span>
                    <span className="font-bold text-slate-900">
                      {drawerRow.fields?.['Prioridade Homero'] || '—'}
                    </span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-500 block">Plan Entrega:</span>
                    <span className="font-mono text-slate-800">
                      {drawerRow.fields?.['Plan entrega'] || '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Arquivos de Vistoria / TSSR */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5 border-b pb-1">
                  <FileSpreadsheet className="w-4 h-4 text-slate-500" />
                  <span>Documento & Upload</span>
                </h4>
                {drawerRow.vistoriaFileName ? (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1">
                    <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span className="truncate">{drawerRow.vistoriaFileName}</span>
                    </div>
                    {drawerRow.vistoriaDeliveredAt && (
                      <p className="text-[10px] text-emerald-800">
                        Entregue em: {new Date(drawerRow.vistoriaDeliveredAt).toLocaleString('pt-BR')}
                      </p>
                    )}
                    {drawerRow.vistoriaUploadedBy && (
                      <p className="text-[10px] text-emerald-800">
                        Enviado por: {drawerRow.vistoriaUploadedBy} ({drawerRow.vistoriaUploadedByEmail})
                      </p>
                    )}
                    {drawerRow.vistoriaDownloadUrl && (
                      <a
                        href={drawerRow.vistoriaDownloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block mt-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold"
                      >
                        Baixar Arquivo
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-400 italic">Nenhum arquivo de vistoria enviado ainda.</p>
                )}
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setDrawerRow(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Fechar Ficha
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
