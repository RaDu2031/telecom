import React, { useState, useMemo, useEffect } from 'react';
import {
  Users,
  Plus,
  Search,
  Mail,
  CheckCircle2,
  Clock,
  Receipt,
  ArrowRight,
  Trash2,
  Edit3,
  Eye,
  X,
  CheckSquare,
  Square,
  ExternalLink,
  UserCheck,
  Link2,
} from 'lucide-react';
import { TelecomSite, AmetaUser, VendorType, EricssonRow } from '../types/telecom';
import {
  getCellValueForColumn,
  doesSiteMatchEquipe,
  doesSiteMatchResponsible,
  getCanonicalDuplaName,
  normalizeAccents,
} from '../utils/spreadsheetUtils';
import {
  isSiteFeito,
  isSiteNotaPendente,
  isSiteCancelado,
  sortSitesParaFazerFirst,
} from './InteractiveSpreadsheetChart';

const STORAGE_DUPLA_EMAILS_KEY = 'ameta_dupla_emails_map_v1';

interface DuplasInteractiveViewProps {
  sites: TelecomSite[];
  ericssonRows?: EricssonRow[];
  users: AmetaUser[];
  ericssonUsers?: AmetaUser[];
  serverDuplaEmailsMap?: Record<string, string[]>;
  activeVendor: VendorType;
  equipesDuplas: string[];
  onAddDupla: (name: string) => void;
  onRenameDupla: (oldName: string, newName: string) => void;
  onDeleteDupla: (name: string) => void;
  onAssignSitesToDupla: (
    siteIds: string[],
    duplaName: string,
    linkedEmails: string[],
    targetVendor: VendorType
  ) => Promise<void>;
  onUnassignSitesFromDupla: (
    siteIds: string[],
    duplaName: string,
    targetVendor: VendorType
  ) => Promise<void>;
  onClearDuplaSites: (
    duplaName: string,
    siteIdsToClear: string[],
    targetVendor: VendorType
  ) => Promise<void>;
  onLinkEmailsToDupla: (duplaName: string, emails: string[]) => Promise<void>;
  onSimulateDuplaView?: (targetUser: AmetaUser, targetVendor: VendorType) => void;
  onOpenSiteDrawer: (siteId: string) => void;
}

function doesEricssonRowMatchDupla(
  row: EricssonRow,
  duplaName: string,
  linkedEmails: string[]
): boolean {
  const rawEq = (row.equipe || row.fields?.['EQUIPE'] || '').trim();
  if (!rawEq || rawEq === '—' || rawEq === '-') return false;

  const canonRowEq = normalizeAccents(getCanonicalDuplaName(rawEq) || rawEq);
  const canonTarget = normalizeAccents(getCanonicalDuplaName(duplaName) || duplaName);
  if (canonRowEq && canonTarget && canonRowEq === canonTarget) {
    return true;
  }
  if (normalizeAccents(rawEq) === normalizeAccents(duplaName)) {
    return true;
  }

  const rowEmails = (row.fields?.['E-MAIL DUPLA'] || '').toLowerCase();
  if (rowEmails && linkedEmails.some((em) => rowEmails.includes(em.toLowerCase()))) {
    return true;
  }
  return false;
}

function isEricssonRowFeito(row: EricssonRow): boolean {
  if (row.siteAVistoriaStatus === 'Entregue' || row.siteBVistoriaStatus === 'Entregue') {
    return true;
  }
  const stA = (row.statusA || row.fields?.['Status A'] || '').toUpperCase();
  const stB = (row.statusB || row.fields?.['Status B'] || '').toUpperCase();
  return (
    stA.includes('CONCLU') ||
    stA.includes('INSTALAD') ||
    stA.includes('ENTREGUE') ||
    stB.includes('CONCLU') ||
    stB.includes('INSTALAD')
  );
}

function isEricssonRowNotaPendente(row: EricssonRow): boolean {
  const fatLos = (row.fields?.['Liberação de Faturamento LoS'] || '').trim().toUpperCase();
  const fatTssr = (row.fields?.['Liberação de Faturamento TSSR'] || '').trim().toUpperCase();
  if (isEricssonRowFeito(row) && (!fatLos || fatLos.includes('PEND'))) {
    return true;
  }
  return fatLos.includes('PEND') || fatTssr.includes('PEND');
}

export const DuplasInteractiveView: React.FC<DuplasInteractiveViewProps> = ({
  sites,
  ericssonRows = [],
  users,
  ericssonUsers = [],
  serverDuplaEmailsMap,
  activeVendor,
  equipesDuplas,
  onAddDupla,
  onRenameDupla,
  onDeleteDupla,
  onAssignSitesToDupla,
  onUnassignSitesFromDupla,
  onClearDuplaSites,
  onLinkEmailsToDupla,
  onSimulateDuplaView,
  onOpenSiteDrawer,
}) => {
  const [selectedDupla, setSelectedDupla] = useState<string>(
    equipesDuplas[0] || 'Magno / Gilvan'
  );
  const [duplaSearch, setDuplaSearch] = useState<string>('');
  const [newDuplaName, setNewDuplaName] = useState<string>('');

  // Inline rename state
  const [editingDupla, setEditingDupla] = useState<string | null>(null);
  const [editingDuplaValue, setEditingDuplaValue] = useState<string>('');

  // Combined unique registered profiles across TIM/Nokia and Ericsson
  const allRegisteredUsers = useMemo<AmetaUser[]>(() => {
    const byEmail = new Map<string, AmetaUser>();
    users.forEach((u) => {
      const em = (u.email || '').trim().toLowerCase();
      if (em) byEmail.set(em, u);
    });
    ericssonUsers.forEach((u) => {
      const em = (u.email || '').trim().toLowerCase();
      if (em && !byEmail.has(em)) {
        byEmail.set(em, u);
      }
    });
    return Array.from(byEmail.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR')
    );
  }, [users, ericssonUsers]);

  // Local + server persisted map of Dupla -> linked profile emails
  const [duplaEmailsMap, setDuplaEmailsMap] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DUPLA_EMAILS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return {};
  });

  // Merge serverDuplaEmailsMap whenever received from backend
  useEffect(() => {
    if (serverDuplaEmailsMap && Object.keys(serverDuplaEmailsMap).length > 0) {
      setDuplaEmailsMap((prev) => {
        const merged = { ...prev, ...serverDuplaEmailsMap };
        try {
          localStorage.setItem(STORAGE_DUPLA_EMAILS_KEY, JSON.stringify(merged));
        } catch {
          // ignore
        }
        return merged;
      });
    }
  }, [serverDuplaEmailsMap]);

  // Email linking controls (only from registered profiles, with search filter)
  const [selectedUserEmailToLink, setSelectedUserEmailToLink] = useState<string>('');
  const [emailSearchQuery, setEmailSearchQuery] = useState<string>('');
  const [isLinkingEmail, setIsLinkingEmail] = useState<boolean>(false);

  const filteredRegisteredUsers = useMemo(() => {
    const q = normalizeAccents(emailSearchQuery.trim().toLowerCase());
    if (!q) return allRegisteredUsers;
    return allRegisteredUsers.filter((u) => {
      const hay = normalizeAccents(
        `${u.name || ''} ${u.email || ''} ${u.role || ''} ${u.equipe || ''}`.toLowerCase()
      );
      return hay.includes(q);
    });
  }, [allRegisteredUsers, emailSearchQuery]);

  // Site picker controls (left column of workspace)
  const [sitePickerSearch, setSitePickerSearch] = useState<string>('');
  const [sitePickerFilter, setSitePickerFilter] = useState<
    'ALL' | 'SEM_DUPLA' | 'PARA_FAZER' | 'FEITOS'
  >('ALL');
  const [sitePickerUf, setSitePickerUf] = useState<string>('ALL');
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [isAssigning, setIsAssigning] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [mobileSection, setMobileSection] = useState<'ALL' | 'DUPLAS' | 'DEMANDAR' | 'VINCULADOS'>(
    'ALL'
  );

  // Assigned sites search (right column of workspace)
  const [assignedSearch, setAssignedSearch] = useState<string>('');

  useEffect(() => {
    if (equipesDuplas.length > 0 && !equipesDuplas.includes(selectedDupla)) {
      setSelectedDupla(equipesDuplas[0]);
    }
  }, [equipesDuplas, selectedDupla]);

  // Reset selected checkboxes and UF filter when switching platform in the top header
  useEffect(() => {
    setSelectedSiteIds([]);
    setSitePickerUf('ALL');
  }, [activeVendor]);

  // Compute effective linked profile emails for any Dupla
  const getLinkedEmailsForDupla = (duplaName: string): string[] => {
    const canonRaw = getCanonicalDuplaName(duplaName) || duplaName.trim();
    const canonDupla = normalizeAccents(canonRaw);

    const hasExplicitKey = duplaName in duplaEmailsMap || canonRaw in duplaEmailsMap;
    const emailSet = new Set<string>();

    if (hasExplicitKey) {
      const explicitList =
        duplaEmailsMap[duplaName] ?? duplaEmailsMap[canonRaw] ?? [];
      explicitList.forEach((e) => {
        if (e && e.trim()) {
          emailSet.add(e.trim().toLowerCase());
        }
      });
      return Array.from(emailSet);
    }

    allRegisteredUsers.forEach((u) => {
      const uCanonEq = normalizeAccents(
        getCanonicalDuplaName(u.equipe || '') || u.equipe || ''
      );
      if (uCanonEq && uCanonEq === canonDupla) {
        emailSet.add(u.email.trim().toLowerCase());
      }
    });

    return Array.from(emailSet);
  };

  const activeDuplaLinkedEmails = useMemo(
    () => getLinkedEmailsForDupla(selectedDupla),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDupla, duplaEmailsMap, allRegisteredUsers]
  );

  const saveDuplaEmails = async (duplaName: string, nextEmails: string[]) => {
    const cleanEmails = Array.from(
      new Set(nextEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))
    );
    const canonRaw = getCanonicalDuplaName(duplaName) || duplaName.trim();
    const nextMap = {
      ...duplaEmailsMap,
      [duplaName]: cleanEmails,
      [canonRaw]: cleanEmails,
    };
    setDuplaEmailsMap(nextMap);
    try {
      localStorage.setItem(STORAGE_DUPLA_EMAILS_KEY, JSON.stringify(nextMap));
    } catch {
      // ignore storage errors
    }
    setIsLinkingEmail(true);
    try {
      await onLinkEmailsToDupla(duplaName, cleanEmails);
    } finally {
      setIsLinkingEmail(false);
    }
  };

  const handleAddEmailLink = async (emailRaw: string) => {
    const clean = (emailRaw || '').trim().toLowerCase();
    if (!clean || !clean.includes('@')) return;
    const current = getLinkedEmailsForDupla(selectedDupla);
    const nextList = current.includes(clean) ? current : [...current, clean];
    setSelectedUserEmailToLink('');
    await saveDuplaEmails(selectedDupla, nextList);
  };

  const handleRemoveEmailLink = async (emailToRemove: string) => {
    const current = getLinkedEmailsForDupla(selectedDupla).filter(
      (e) => e.toLowerCase() !== emailToRemove.toLowerCase()
    );
    await saveDuplaEmails(selectedDupla, current);
  };

  // Nokia Controle Geral sites
  const nokiaControleGeralSites = useMemo(
    () =>
      sites.filter(
        (s) =>
          s.vendor === 'NOKIA' &&
          s.sheetName === 'Controle Geral' &&
          !isSiteCancelado(s)
      ),
    [sites]
  );

  // Filtered Duplas in the left sidebar
  const filteredDuplas = useMemo(() => {
    const q = duplaSearch.trim().toLowerCase();
    return equipesDuplas.filter((d) => {
      if (!q) return true;
      const emails = getLinkedEmailsForDupla(d).join(' ');
      return d.toLowerCase().includes(q) || emails.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipesDuplas, duplaSearch, duplaEmailsMap, allRegisteredUsers]);

  // Nokia sites for a given Dupla
  const getNokiaSitesForDupla = (duplaName: string): TelecomSite[] => {
    const linkedEmails = getLinkedEmailsForDupla(duplaName);
    const matched = nokiaControleGeralSites.filter((s) => {
      if (doesSiteMatchEquipe(s, duplaName)) return true;
      if (doesSiteMatchResponsible(s, duplaName)) return true;
      return linkedEmails.some((em) =>
        doesSiteMatchResponsible(s, { name: duplaName, equipe: duplaName, email: em })
      );
    });
    return sortSitesParaFazerFirst(matched);
  };

  // Ericsson rows for a given Dupla
  const getEricssonRowsForDupla = (duplaName: string): EricssonRow[] => {
    const linkedEmails = getLinkedEmailsForDupla(duplaName);
    return ericssonRows.filter((row) =>
      doesEricssonRowMatchDupla(row, duplaName, linkedEmails)
    );
  };

  const assignedNokiaSitesForSelectedDupla = useMemo(
    () => getNokiaSitesForDupla(selectedDupla),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nokiaControleGeralSites, selectedDupla, activeDuplaLinkedEmails, allRegisteredUsers]
  );

  const assignedEricssonRowsForSelectedDupla = useMemo(
    () => getEricssonRowsForDupla(selectedDupla),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ericssonRows, selectedDupla, activeDuplaLinkedEmails]
  );

  const filteredAssignedNokiaSites = useMemo(() => {
    const q = assignedSearch.trim().toLowerCase();
    if (!q) return assignedNokiaSitesForSelectedDupla;
    return assignedNokiaSitesForSelectedDupla.filter((s) => {
      const hay = `${s.siteId} ${s.siteName} ${s.municipio} ${s.uf} ${s.status}`.toLowerCase();
      return hay.includes(q);
    });
  }, [assignedNokiaSitesForSelectedDupla, assignedSearch]);

  const filteredAssignedEricssonRows = useMemo(() => {
    const q = assignedSearch.trim().toLowerCase();
    if (!q) return assignedEricssonRowsForSelectedDupla;
    return assignedEricssonRowsForSelectedDupla.filter((r) => {
      const hay = `${r.siteIdA} ${r.siteIdB} ${r.siteName} ${r.chaves} ${r.cidadeA} ${r.cidadeB} ${r.state} ${r.servico}`.toLowerCase();
      return hay.includes(q);
    });
  }, [assignedEricssonRowsForSelectedDupla, assignedSearch]);

  // Available UFs for activeVendor
  const availableUfs = useMemo(() => {
    const set = new Set<string>();
    if (activeVendor === 'NOKIA') {
      nokiaControleGeralSites.forEach((s) => {
        const u = (getCellValueForColumn(s, 'UF') || s.uf || '').trim().toUpperCase();
        if (u && u !== '—') set.add(u);
      });
    } else {
      ericssonRows.forEach((r) => {
        const u = (r.state || r.fields?.['00.03.State'] || '').trim().toUpperCase();
        if (u && u !== '—') set.add(u);
      });
    }
    return Array.from(set).sort();
  }, [activeVendor, nokiaControleGeralSites, ericssonRows]);

  // Candidate TIM/Nokia sites in the left picker panel
  const pickerNokiaSites = useMemo(() => {
    const assignedIds = new Set(assignedNokiaSitesForSelectedDupla.map((s) => s.id));
    const q = sitePickerSearch.trim().toLowerCase();
    const tokens = q
      ? q
          .split(/[\s,;|\n\r\t]+/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    const matched = nokiaControleGeralSites.filter((s) => {
      if (assignedIds.has(s.id)) return false;

      if (sitePickerUf !== 'ALL') {
        const uf = (getCellValueForColumn(s, 'UF') || s.uf || '').trim().toUpperCase();
        if (uf !== sitePickerUf) return false;
      }

      const eq = (getCellValueForColumn(s, 'EQUIPE EXECUTANTE') || s.equipeParceira || '').trim();
      const hasDupla = eq !== '' && eq !== '—' && eq.toLowerCase() !== 'a definir';

      if (sitePickerFilter === 'SEM_DUPLA' && hasDupla) return false;
      if (sitePickerFilter === 'PARA_FAZER' && isSiteFeito(s)) return false;
      if (sitePickerFilter === 'FEITOS' && !isSiteFeito(s)) return false;

      if (tokens.length > 0) {
        const hay = `${s.siteId} ${getCellValueForColumn(s, 'END ID') || s.siteName} ${
          s.municipio
        } ${s.uf} ${eq} ${getCellValueForColumn(s, 'Escopo') || s.setores}`.toLowerCase();
        if (tokens.length === 1) {
          return hay.includes(tokens[0]);
        }
        return tokens.some((tk) => hay.includes(tk));
      }

      return true;
    });
    return sortSitesParaFazerFirst(matched);
  }, [
    nokiaControleGeralSites,
    assignedNokiaSitesForSelectedDupla,
    sitePickerSearch,
    sitePickerUf,
    sitePickerFilter,
  ]);

  // Candidate Ericsson rows in the left picker panel
  const pickerEricssonRows = useMemo(() => {
    const assignedIds = new Set(assignedEricssonRowsForSelectedDupla.map((r) => r.id));
    const q = sitePickerSearch.trim().toLowerCase();
    const tokens = q
      ? q
          .split(/[\s,;|\n\r\t]+/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    return ericssonRows.filter((r) => {
      if (assignedIds.has(r.id)) return false;

      if (sitePickerUf !== 'ALL') {
        const uf = (r.state || r.fields?.['00.03.State'] || '').trim().toUpperCase();
        if (uf !== sitePickerUf) return false;
      }

      const eq = (r.equipe || r.fields?.['EQUIPE'] || '').trim();
      const hasDupla = eq !== '' && eq !== '—' && eq.toLowerCase() !== 'a definir';
      const feito = isEricssonRowFeito(r);

      if (sitePickerFilter === 'SEM_DUPLA' && hasDupla) return false;
      if (sitePickerFilter === 'PARA_FAZER' && feito) return false;
      if (sitePickerFilter === 'FEITOS' && !feito) return false;

      if (tokens.length > 0) {
        const hay = `${r.siteIdA} ${r.siteIdB} ${r.siteName} ${r.chaves} ${r.cidadeA} ${r.cidadeB} ${r.state} ${eq} ${r.servico}`.toLowerCase();
        if (tokens.length === 1) {
          return hay.includes(tokens[0]);
        }
        return tokens.some((tk) => hay.includes(tk));
      }

      return true;
    });
  }, [
    ericssonRows,
    assignedEricssonRowsForSelectedDupla,
    sitePickerSearch,
    sitePickerUf,
    sitePickerFilter,
  ]);

  const activePickerCount =
    activeVendor === 'NOKIA' ? pickerNokiaSites.length : pickerEricssonRows.length;
  const activeAssignedCount =
    activeVendor === 'NOKIA'
      ? assignedNokiaSitesForSelectedDupla.length
      : assignedEricssonRowsForSelectedDupla.length;

  const toggleSelectSite = (token: string) => {
    setSelectedSiteIds((prev) =>
      prev.includes(token) ? prev.filter((id) => id !== token) : [...prev, token]
    );
  };

  const handleSelectAllVisiblePicker = () => {
    const visibleIds =
      activeVendor === 'NOKIA'
        ? pickerNokiaSites.slice(0, 100).map((s) => s.siteId)
        : pickerEricssonRows.slice(0, 100).map((r) => r.id);
    const allSelected =
      visibleIds.length > 0 && visibleIds.every((code) => selectedSiteIds.includes(code));
    if (allSelected) {
      setSelectedSiteIds([]);
    } else {
      setSelectedSiteIds(visibleIds);
    }
  };

  const handleConfirmAssignSelected = async () => {
    if (selectedSiteIds.length === 0) return;
    setIsAssigning(true);
    try {
      await onAssignSitesToDupla(
        selectedSiteIds,
        selectedDupla,
        activeDuplaLinkedEmails,
        activeVendor
      );
      setSelectedSiteIds([]);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleClearAllForSelectedDupla = async () => {
    if (activeAssignedCount === 0 || isClearing) return;
    setIsClearing(true);
    try {
      const tokensToClear =
        activeVendor === 'NOKIA'
          ? assignedNokiaSitesForSelectedDupla.flatMap((s) => [s.id, s.siteId])
          : assignedEricssonRowsForSelectedDupla.map((r) => r.id);
      await onClearDuplaSites(selectedDupla, tokensToClear, activeVendor);
      setAssignedSearch('');
      setSelectedSiteIds([]);
    } finally {
      setIsClearing(false);
    }
  };

  const handleSimulateSelectedDupla = () => {
    if (!onSimulateDuplaView) return;
    const matchedUser = allRegisteredUsers.find((u) =>
      activeDuplaLinkedEmails.includes(u.email.trim().toLowerCase())
    );
    if (matchedUser) {
      onSimulateDuplaView(
        {
          ...matchedUser,
          equipe: selectedDupla,
          assignedPlatform: activeVendor,
        },
        activeVendor
      );
      return;
    }

    onSimulateDuplaView(
      {
        id: `sim-${selectedDupla}`,
        name: selectedDupla,
        email:
          activeDuplaLinkedEmails[0] ||
          `${selectedDupla
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '.')
            .replace(/\.+/g, '.')
            .replace(/^\.|\.$/g, '')}@ametatelecom.com.br`,
        role: 'Executor',
        assignedPlatform: activeVendor,
        equipe: selectedDupla,
        emailVerified: true,
        createdAt: new Date().toISOString(),
      },
      activeVendor
    );
  };

  return (
    <div className="space-y-3">
      {/* =====================================================================
          MOBILE QUICK BAR (lg:hidden): OPÇÕES BEM APARENTES NO MOBILE
         ===================================================================== */}
      <div className="lg:hidden bg-slate-900 text-white border border-slate-800 rounded-2xl p-3.5 shadow-md space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              1. Dupla Selecionada ({activeVendor === 'ERICSSON' ? 'Ericsson' : 'TIM / Nokia'})
            </span>
          </span>
          <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-mono font-black">
            {activeAssignedCount} site(s)
          </span>
        </div>

        <select
          value={selectedDupla}
          onChange={(e) => {
            setSelectedDupla(e.target.value);
            setSelectedSiteIds([]);
          }}
          className="w-full px-3.5 py-3 bg-white text-slate-950 font-black rounded-xl text-sm border-2 border-amber-400 focus:outline-none shadow-sm"
        >
          {equipesDuplas.map((d) => (
            <option key={d} value={d}>
              Dupla: {d}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-2 text-xs font-black">
          {(
            [
              { id: 'ALL', label: 'Ver Tudo na Tela' },
              { id: 'DEMANDAR', label: 'E-mail & Demandar Site' },
              { id: 'DUPLAS', label: `Lista de Duplas (${equipesDuplas.length})` },
              { id: 'VINCULADOS', label: `Sites Demandados (${activeAssignedCount})` },
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
          LEFT COLUMN (4 COLS): LISTA INTERATIVA DE DUPLAS + CRIAR NOVA DUPLA
         ===================================================================== */}
      <div
        className={`lg:col-span-4 bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden flex flex-col ${
          mobileSection !== 'ALL' && mobileSection !== 'DUPLAS' ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <div className="p-4 bg-slate-900 text-white space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-400" />
              <div>
                <h2 className="text-xs font-bold">
                  1. Selecionar Dupla Executante ({equipesDuplas.length})
                </h2>
                <p className="text-[11px] text-slate-400">
                  Escolha a dupla para vincular e-mail e distribuir sites
                </p>
              </div>
            </div>
          </div>

          {/* Add New Dupla Input */}
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newDuplaName}
              onChange={(e) => setNewDuplaName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newDuplaName.trim()) {
                  e.preventDefault();
                  const clean = newDuplaName.trim();
                  onAddDupla(clean);
                  setSelectedDupla(clean);
                  setNewDuplaName('');
                }
              }}
              placeholder="Nova dupla (ex: Carlos / Eduardo)..."
              className="flex-1 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-400"
            />
            <button
              type="button"
              onClick={() => {
                if (!newDuplaName.trim()) return;
                const clean = newDuplaName.trim();
                onAddDupla(clean);
                setSelectedDupla(clean);
                setNewDuplaName('');
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Criar</span>
            </button>
          </div>

          {/* Search Dupla */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={duplaSearch}
              onChange={(e) => setDuplaSearch(e.target.value)}
              placeholder="Buscar dupla ou e-mail vinculado..."
              className="w-full pl-8 pr-2.5 py-1.5 bg-slate-800/80 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>

        {/* Scrollable List of Duplas */}
        <div className="divide-y divide-slate-100 max-h-72 lg:max-h-[640px] overflow-y-auto p-2 space-y-1">
          {filteredDuplas.map((dupla) => {
            const isSelected = selectedDupla === dupla;
            const isEditing = editingDupla === dupla;
            const linkedEmails = getLinkedEmailsForDupla(dupla);

            let totalSitesCount = 0;
            let feitosCount = 0;
            let fazerCount = 0;
            let notasCount = 0;

            if (activeVendor === 'NOKIA') {
              const duplaSites = getNokiaSitesForDupla(dupla);
              totalSitesCount = duplaSites.length;
              feitosCount = duplaSites.filter((s) => isSiteFeito(s)).length;
              fazerCount = totalSitesCount - feitosCount;
              notasCount = duplaSites.filter((s) => isSiteNotaPendente(s)).length;
            } else {
              const duplaRows = getEricssonRowsForDupla(dupla);
              totalSitesCount = duplaRows.length;
              feitosCount = duplaRows.filter((r) => isEricssonRowFeito(r)).length;
              fazerCount = totalSitesCount - feitosCount;
              notasCount = duplaRows.filter((r) => isEricssonRowNotaPendente(r)).length;
            }

            return (
              <div
                key={dupla}
                onClick={() => {
                  if (!isEditing) {
                    setSelectedDupla(dupla);
                    setSelectedSiteIds([]);
                    if (mobileSection === 'DUPLAS') {
                      setMobileSection('DEMANDAR');
                    }
                  }
                }}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-blue-50/90 border-blue-500 ring-1 ring-blue-500/30 shadow-2xs'
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
                      autoFocus
                      value={editingDuplaValue}
                      onChange={(e) => setEditingDuplaValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && editingDuplaValue.trim()) {
                          onRenameDupla(dupla, editingDuplaValue.trim());
                          setSelectedDupla(editingDuplaValue.trim());
                          setEditingDupla(null);
                        } else if (e.key === 'Escape') {
                          setEditingDupla(null);
                        }
                      }}
                      className="flex-1 px-2 py-1 bg-white border border-blue-600 rounded text-xs font-semibold text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (editingDuplaValue.trim()) {
                          onRenameDupla(dupla, editingDuplaValue.trim());
                          setSelectedDupla(editingDuplaValue.trim());
                        }
                        setEditingDupla(null);
                      }}
                      className="px-2 py-1 bg-blue-600 text-white text-[11px] font-semibold rounded cursor-pointer"
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingDupla(null)}
                      className="px-2 py-1 bg-slate-100 text-slate-600 text-[11px] rounded cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-xs font-bold truncate ${
                              isSelected ? 'text-blue-950' : 'text-slate-900'
                            }`}
                          >
                            {dupla}
                          </span>
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-900 text-white">
                            {totalSitesCount}
                          </span>
                        </div>

                        {/* Linked Profile Emails Preview */}
                        <div className="flex items-center gap-1 mt-1 text-[11px] text-slate-500 truncate">
                          <Mail className="w-3 h-3 text-blue-600 shrink-0" />
                          {linkedEmails.length > 0 ? (
                            <span className="font-mono truncate text-slate-700">
                              {linkedEmails.join(', ')}
                            </span>
                          ) : (
                            <span className="italic text-slate-400">
                              Sem e-mail de perfil vinculado
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDupla(dupla);
                            setEditingDuplaValue(dupla);
                          }}
                          className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-white cursor-pointer"
                          title="Renomear dupla"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteDupla(dupla)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-white cursor-pointer"
                          title="Remover dupla"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Mini stats row (identical rules for TIM/Nokia and Ericsson) */}
                    <div className="flex items-center gap-2 text-[10px] font-mono pt-1 border-t border-slate-200/60">
                      <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/80">
                        Para Fazer: {fazerCount}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200/80">
                        Feitos: {feitosCount}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200/80">
                        Notas Pend.: {notasCount}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* =====================================================================
          RIGHT COLUMN (8 COLS): VÍNCULO DE E-MAIL DE PERFIL + DISTRIBUIÇÃO DE SITES
         ===================================================================== */}
      <div
        className={`lg:col-span-8 space-y-4 ${
          mobileSection === 'DUPLAS' ? 'hidden lg:block' : 'block'
        }`}
      >
        {/* Card A: Selected Dupla Header & Profile Email Linker */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center shadow-2xs shrink-0">
                {selectedDupla.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 truncate">
                    Dupla Selecionada: {selectedDupla}
                  </h3>
                  <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 rounded-md text-[11px] font-mono font-semibold">
                    {activeAssignedCount} site(s) na demanda
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Vincule o e-mail de perfil abaixo e selecione quais sites vão aparecer para esta dupla.
                </p>
              </div>
            </div>

            {onSimulateDuplaView && (
              <button
                type="button"
                onClick={handleSimulateSelectedDupla}
                className="w-full sm:w-auto justify-center px-3.5 py-2.5 sm:py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center gap-2 cursor-pointer shadow-2xs"
                title="Ver exatamente como a planilha e os sites aparecem quando esta dupla entra no sistema"
              >
                <Eye className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Ver como aparece para eles ({activeAssignedCount} sites)</span>
              </button>
            )}
          </div>

          {/* Profile Email Linker Box (High-visibility on mobile & desktop) */}
          <div className="p-3.5 sm:p-4 bg-blue-50/70 border-2 border-blue-300 rounded-2xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#223585] text-white flex items-center justify-center shrink-0">
                  <Link2 className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs sm:text-sm font-black text-slate-900 block">
                    Escolher E-mail para Demandar — Dupla "{selectedDupla}"
                  </span>
                  <span className="text-[11px] text-slate-600 block">
                    Pesquise abaixo por nome ou e-mail e toque em Vincular
                  </span>
                </div>
              </div>
            </div>

            {/* Active Linked Emails Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {activeDuplaLinkedEmails.length > 0 ? (
                activeDuplaLinkedEmails.map((email) => {
                  const matchedProfile = allRegisteredUsers.find(
                    (u) => u.email.toLowerCase() === email.toLowerCase()
                  );
                  return (
                    <span
                      key={email}
                      className="inline-flex flex-wrap items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border-2 border-blue-400 text-slate-900 text-xs font-bold shadow-2xs max-w-full"
                    >
                      <Mail className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="font-mono font-bold break-all sm:break-normal">
                        {email}
                      </span>
                      {matchedProfile && (
                        <span className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-900 font-bold rounded-md">
                          {matchedProfile.name} ({matchedProfile.role})
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveEmailLink(email)}
                        className="text-red-500 hover:text-red-700 ml-1 p-1 bg-red-50 rounded-md cursor-pointer"
                        title="Desvincular este e-mail da dupla"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </span>
                  );
                })
              ) : (
                <span className="text-xs font-semibold text-amber-900 bg-amber-100/80 border border-amber-300 px-3 py-1.5 rounded-lg">
                  Nenhum e-mail vinculado ainda. Pesquise ou escolha um e-mail abaixo:
                </span>
              )}
            </div>

            {/* Searchable Selector for Registered Profiles — LARGE & APPARENT */}
            <div className="space-y-2.5 pt-1">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                {/* Search Input to Filter Emails/Names */}
                <div className="relative w-full sm:w-72 shrink-0">
                  <Search className="w-4 h-4 text-blue-600 absolute left-3 top-3 sm:top-2.5" />
                  <input
                    type="text"
                    value={emailSearchQuery}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEmailSearchQuery(val);
                      const qNorm = normalizeAccents(val.trim().toLowerCase());
                      if (qNorm) {
                        const firstMatch = allRegisteredUsers.find((u) =>
                          normalizeAccents(
                            `${u.name || ''} ${u.email || ''} ${u.role || ''}`.toLowerCase()
                          ).includes(qNorm)
                        );
                        if (firstMatch) {
                          setSelectedUserEmailToLink(firstMatch.email);
                        }
                      }
                    }}
                    placeholder="🔍 Pesquisar e-mail ou nome..."
                    className="w-full pl-9 pr-8 py-2.5 sm:py-2 bg-white border-2 border-blue-400 rounded-xl text-xs sm:text-xs font-bold text-slate-900 placeholder-slate-500 focus:outline-none focus:border-[#223585] shadow-2xs"
                  />
                  {emailSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setEmailSearchQuery('')}
                      className="absolute right-2.5 top-2.5 sm:top-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      title="Limpar pesquisa de e-mail"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <select
                  value={selectedUserEmailToLink}
                  onChange={(e) => setSelectedUserEmailToLink(e.target.value)}
                  className="w-full sm:flex-1 px-3 py-2.5 sm:py-2 bg-white border-2 border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-[#223585]"
                >
                  <option value="">
                    {emailSearchQuery.trim()
                      ? `Encontrados (${filteredRegisteredUsers.length}) — toque para escolher...`
                      : `Escolher na lista de e-mails (${allRegisteredUsers.length})...`}
                  </option>
                  {filteredRegisteredUsers.map((u) => {
                    const alreadyLinked = activeDuplaLinkedEmails.includes(
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
                  className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-[#223585] hover:bg-[#192868] disabled:opacity-50 text-white text-xs font-black uppercase tracking-wide rounded-xl whitespace-nowrap cursor-pointer shadow-sm"
                >
                  {isLinkingEmail ? 'Vinculando...' : '+ Vincular E-mail'}
                </button>
              </div>

              {/* Instant Clickable Results when typing in the Email Search box */}
              {emailSearchQuery.trim().length > 0 && (
                <div className="bg-white border-2 border-blue-300 rounded-xl shadow-md max-h-56 overflow-y-auto divide-y divide-slate-100">
                  {filteredRegisteredUsers.length === 0 ? (
                    <div className="px-3.5 py-3 text-xs font-semibold text-slate-500">
                      Nenhum perfil encontrado para "{emailSearchQuery}".
                    </div>
                  ) : (
                    filteredRegisteredUsers.slice(0, 12).map((u) => {
                      const alreadyLinked = activeDuplaLinkedEmails.includes(
                        u.email.trim().toLowerCase()
                      );
                      return (
                        <div
                          key={u.email}
                          className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-blue-50/50 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 flex flex-wrap items-center gap-1.5">
                              <span>{u.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-900 font-bold">
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

        {/* Card B: Interactive Dual-Column Site Assignment ("para quais sites vao e parece para eles") */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* PANEL 1: SELECIONAR SITES DA PLANILHA PARA MANDAR PARA A DUPLA */}
          <div
            className={`bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden flex flex-col ${
              mobileSection === 'VINCULADOS' ? 'hidden lg:flex' : 'flex'
            }`}
          >
            <div className="p-3.5 bg-white border-b border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">
                    2. Selecionar Sites para Mandar para "{selectedDupla}"
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Marque os sites ou cole vários códigos para enviar para a dupla
                  </p>
                </div>
                <span className="px-2 py-0.5 bg-[#F3F4F6] border border-slate-200 rounded text-[11px] font-mono text-slate-600">
                  {activePickerCount} disponíveis
                </span>
              </div>

              {/* Search or Multi-Code Paste */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={sitePickerSearch}
                  onChange={(e) => setSitePickerSearch(e.target.value)}
                  placeholder="Buscar SITE ID, Município ou colar vários códigos..."
                  className="w-full pl-8 pr-7 py-1.5 bg-[#F3F4F6] border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-blue-600"
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

              {/* Filter Pills + UF Selector */}
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      { id: 'ALL', label: 'Todos' },
                      { id: 'SEM_DUPLA', label: 'Sem Dupla' },
                      { id: 'PARA_FAZER', label: 'Para Fazer' },
                      { id: 'FEITOS', label: 'Feitos' },
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

                <select
                  value={sitePickerUf}
                  onChange={(e) => setSitePickerUf(e.target.value)}
                  className="px-2 py-1 bg-[#F3F4F6] border border-slate-200 rounded-md text-[11px] font-semibold text-slate-700"
                >
                  <option value="ALL">Todas UFs</option>
                  {availableUfs.map((u) => (
                    <option key={u} value={u}>
                      UF: {u}
                    </option>
                  ))}
                </select>
              </div>

              {/* Bulk Action Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleSelectAllVisiblePicker}
                  className="py-2 px-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-800 flex items-center justify-center sm:justify-start gap-1.5 cursor-pointer"
                >
                  <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>
                    {selectedSiteIds.length > 0
                      ? `Desmarcar (${selectedSiteIds.length})`
                      : `Selecionar todos visíveis (${Math.min(100, activePickerCount)})`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={selectedSiteIds.length === 0 || isAssigning}
                  onClick={handleConfirmAssignSelected}
                  className="w-full sm:w-auto justify-center px-4 py-3 sm:py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wide rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <span>
                    Demandar {selectedSiteIds.length > 0 ? `${selectedSiteIds.length} ` : ''}Site(s)
                    para {selectedDupla}
                  </span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>
              </div>
            </div>

            {/* Scrollable Picker List */}
            <div className="divide-y divide-slate-100 max-h-[450px] overflow-y-auto">
              {activeVendor === 'NOKIA'
                ? pickerNokiaSites.slice(0, 120).map((site) => {
                    const isChecked = selectedSiteIds.includes(site.siteId);
                    const currentEq = (
                      getCellValueForColumn(site, 'EQUIPE EXECUTANTE') ||
                      site.equipeParceira ||
                      ''
                    ).trim();
                    const feito = isSiteFeito(site);

                    return (
                      <div
                        key={site.id}
                        onClick={() => toggleSelectSite(site.siteId)}
                        className={`px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors ${
                          isChecked ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-slate-900">
                                {site.siteId}
                              </span>
                              <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-mono">
                                {site.uf} · {site.municipio}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  feito
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}
                              >
                                {feito ? 'Feito' : 'Para Fazer'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">
                              {getCellValueForColumn(site, 'END ID') || site.siteName} ·{' '}
                              {currentEq && currentEq !== '—' ? (
                                <span className="text-slate-600">Atual: {currentEq}</span>
                              ) : (
                                <span className="text-slate-400 italic">Sem dupla</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAssignSitesToDupla(
                              [site.siteId],
                              selectedDupla,
                              activeDuplaLinkedEmails,
                              'NOKIA'
                            );
                          }}
                          className="px-2.5 py-1 bg-[#F3F4F6] hover:bg-blue-600 hover:text-white text-slate-700 border border-slate-200 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                          title={`Mandar ${site.siteId} imediatamente para ${selectedDupla}`}
                        >
                          <span>Mandar</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                : pickerEricssonRows.slice(0, 120).map((row) => {
                    const isChecked = selectedSiteIds.includes(row.id);
                    const currentEq = (row.equipe || row.fields?.['EQUIPE'] || '').trim();
                    const feito = isEricssonRowFeito(row);
                    const displayCode =
                      row.siteIdA && row.siteIdB
                        ? `${row.siteIdA} ↔ ${row.siteIdB}`
                        : row.siteIdA || row.siteIdB || row.siteName || row.chaves;
                    const uf = row.state || row.fields?.['00.03.State'] || '—';
                    const mun = row.cidadeA || row.cidadeB || '—';

                    return (
                      <div
                        key={row.id}
                        onClick={() => toggleSelectSite(row.id)}
                        className={`px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors ${
                          isChecked ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono font-bold text-slate-900">
                                {displayCode}
                              </span>
                              <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-mono">
                                {uf} · {mun}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  feito
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}
                              >
                                {feito ? 'Feito' : 'Para Fazer'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">
                              {row.chaves ? `Chave: ${row.chaves} · ` : ''}
                              {row.servico || 'Ericsson TX'} ·{' '}
                              {currentEq && currentEq !== '—' ? (
                                <span className="text-slate-600">Atual: {currentEq}</span>
                              ) : (
                                <span className="text-slate-400 italic">Sem dupla</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAssignSitesToDupla(
                              [row.id],
                              selectedDupla,
                              activeDuplaLinkedEmails,
                              'ERICSSON'
                            );
                          }}
                          className="px-2.5 py-1 bg-[#F3F4F6] hover:bg-blue-600 hover:text-white text-slate-700 border border-slate-200 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                          title={`Mandar ${displayCode} imediatamente para ${selectedDupla}`}
                        >
                          <span>Mandar</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}

              {activePickerCount === 0 && (
                <div className="p-8 text-center text-xs text-slate-400">
                  Nenhum site disponível com este filtro.
                </div>
              )}
            </div>
          </div>

          {/* PANEL 2: SITES ATUALMENTE VINCULADOS À DUPLA ("O QUE APARECE PARA ELES") */}
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
                      3. Sites que Aparecem para "{selectedDupla}" ({activeAssignedCount})
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Estes sites aparecem automaticamente no perfil vinculado ({activeDuplaLinkedEmails[0] || 'sem e-mail'})
                    </p>
                  </div>
                </div>

                {activeAssignedCount > 0 && (
                  <button
                    type="button"
                    disabled={isClearing}
                    onClick={handleClearAllForSelectedDupla}
                    className="px-2.5 py-1 bg-red-600/90 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold transition-colors cursor-pointer shrink-0 shadow-2xs"
                  >
                    {isClearing ? 'Limpando...' : `Limpar Todos (${activeAssignedCount})`}
                  </button>
                )}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={assignedSearch}
                  onChange={(e) => setAssignedSearch(e.target.value)}
                  placeholder={`Filtrar nos ${activeAssignedCount} sites desta dupla...`}
                  className="w-full pl-8 pr-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-[515px] overflow-y-auto">
              {activeVendor === 'NOKIA'
                ? filteredAssignedNokiaSites.map((site) => {
                    const feito = isSiteFeito(site);
                    const notaPend = isSiteNotaPendente(site);

                    return (
                      <div
                        key={site.id}
                        className="px-3.5 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-bold text-slate-900">
                              {site.siteId}
                            </span>
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-mono">
                              {site.uf} · {site.municipio}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold inline-flex items-center gap-1 ${
                                feito
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                              }`}
                            >
                              {feito ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : (
                                <Clock className="w-3 h-3" />
                              )}
                              <span>{site.status}</span>
                            </span>
                            {notaPend && (
                              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-medium inline-flex items-center gap-1">
                                <Receipt className="w-3 h-3" />
                                <span>Nota Pend.</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {getCellValueForColumn(site, 'END ID') || site.siteName} · Escopo:{' '}
                            {getCellValueForColumn(site, 'Escopo') || site.setores || '—'}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => onOpenSiteDrawer(site.id)}
                            className="px-2 py-1 bg-[#F3F4F6] hover:bg-slate-200 text-slate-700 rounded-md text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                            title="Abrir ficha lateral do site"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>Ficha</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onUnassignSitesFromDupla(
                                [site.id, site.siteId],
                                selectedDupla,
                                'NOKIA'
                              )
                            }
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                            title="Remover este site da dupla"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                : filteredAssignedEricssonRows.map((row) => {
                    const feito = isEricssonRowFeito(row);
                    const notaPend = isEricssonRowNotaPendente(row);
                    const displayCode =
                      row.siteIdA && row.siteIdB
                        ? `${row.siteIdA} ↔ ${row.siteIdB}`
                        : row.siteIdA || row.siteIdB || row.siteName || row.chaves;
                    const uf = row.state || row.fields?.['00.03.State'] || '—';
                    const mun = row.cidadeA || row.cidadeB || '—';

                    return (
                      <div
                        key={row.id}
                        className="px-3.5 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-bold text-slate-900">
                              {displayCode}
                            </span>
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-mono">
                              {uf} · {mun}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold inline-flex items-center gap-1 ${
                                feito
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                              }`}
                            >
                              {feito ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : (
                                <Clock className="w-3 h-3" />
                              )}
                              <span>
                                Vistoria A: {row.siteAVistoriaStatus}
                                {row.siteIdB ? ` · B: ${row.siteBVistoriaStatus}` : ''}
                              </span>
                            </span>
                            {notaPend && (
                              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-medium inline-flex items-center gap-1">
                                <Receipt className="w-3 h-3" />
                                <span>Nota Pend.</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {row.chaves ? `Chave: ${row.chaves} · ` : ''}
                            Serviço: {row.servico || '—'}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              onUnassignSitesFromDupla([row.id], selectedDupla, 'ERICSSON')
                            }
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                            title="Remover este site da dupla"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

              {((activeVendor === 'NOKIA' && filteredAssignedNokiaSites.length === 0) ||
                (activeVendor === 'ERICSSON' && filteredAssignedEricssonRows.length === 0)) && (
                <div className="p-8 text-center space-y-2">
                  <div className="text-xs font-semibold text-slate-600">
                    Nenhum site vinculado a "{selectedDupla}" ainda.
                  </div>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    Use a coluna ao lado para marcar os sites da planilha e clicar em "Mandar para {selectedDupla}".
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};
