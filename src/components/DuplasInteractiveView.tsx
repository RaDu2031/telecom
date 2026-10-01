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
import { TelecomSite, AmetaUser, VendorType } from '../types/telecom';
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
  users: AmetaUser[];
  activeVendor: VendorType;
  equipesDuplas: string[];
  onAddDupla: (name: string) => void;
  onRenameDupla: (oldName: string, newName: string) => void;
  onDeleteDupla: (name: string) => void;
  onAssignSitesToDupla: (
    siteIds: string[],
    duplaName: string,
    linkedEmails: string[]
  ) => Promise<void>;
  onUnassignSitesFromDupla: (siteIds: string[], duplaName: string) => Promise<void>;
  onClearDuplaSites: (duplaName: string, siteIdsToClear: string[]) => Promise<void>;
  onLinkEmailsToDupla: (duplaName: string, emails: string[]) => Promise<void>;
  onSimulateDuplaView: (targetUser: AmetaUser) => void;
  onOpenSiteDrawer: (siteId: string) => void;
}

export const DuplasInteractiveView: React.FC<DuplasInteractiveViewProps> = ({
  sites,
  users,
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
    equipesDuplas[0] || 'Usuário Teste'
  );
  const [duplaSearch, setDuplaSearch] = useState<string>('');
  const [newDuplaName, setNewDuplaName] = useState<string>('');

  // Inline rename state
  const [editingDupla, setEditingDupla] = useState<string | null>(null);
  const [editingDuplaValue, setEditingDuplaValue] = useState<string>('');

  // Local + persisted map of Dupla -> linked profile emails
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

  // Email linking controls
  const [selectedUserEmailToLink, setSelectedUserEmailToLink] = useState<string>('');
  const [customEmailInput, setCustomEmailInput] = useState<string>('');

  // Site picker controls (left column of workspace)
  const [sitePickerSearch, setSitePickerSearch] = useState<string>('');
  const [sitePickerFilter, setSitePickerFilter] = useState<
    'ALL' | 'SEM_DUPLA' | 'PARA_FAZER' | 'FEITOS'
  >('ALL');
  const [sitePickerUf, setSitePickerUf] = useState<string>('ALL');
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [isAssigning, setIsAssigning] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);

  // Assigned sites search (right column of workspace)
  const [assignedSearch, setAssignedSearch] = useState<string>('');

  useEffect(() => {
    if (equipesDuplas.length > 0 && !equipesDuplas.includes(selectedDupla)) {
      setSelectedDupla(equipesDuplas[0]);
    }
  }, [equipesDuplas, selectedDupla]);

  // Compute effective linked profile emails for any Dupla (synced with server users.equipe + explicit custom emails)
  const getLinkedEmailsForDupla = (duplaName: string): string[] => {
    const emailSet = new Set<string>();
    const canonDupla = normalizeAccents(getCanonicalDuplaName(duplaName) || duplaName);

    users.forEach((u) => {
      const uCanonEq = normalizeAccents(getCanonicalDuplaName(u.equipe || '') || u.equipe || '');
      if (uCanonEq && uCanonEq === canonDupla) {
        emailSet.add(u.email.trim().toLowerCase());
      }
    });

    if (duplaName in duplaEmailsMap) {
      const explicit = duplaEmailsMap[duplaName] || [];
      explicit.forEach((e) => {
        if (e && e.trim()) {
          const cleanEmail = e.trim().toLowerCase();
          const regUser = users.find((u) => u.email.trim().toLowerCase() === cleanEmail);
          if (!regUser) {
            emailSet.add(cleanEmail);
          } else {
            const regEq = normalizeAccents(
              getCanonicalDuplaName(regUser.equipe || '') || regUser.equipe || ''
            );
            if (regEq === canonDupla) {
              emailSet.add(cleanEmail);
            }
          }
        }
      });
    }

    return Array.from(emailSet);
  };

  const activeDuplaLinkedEmails = useMemo(
    () => getLinkedEmailsForDupla(selectedDupla),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDupla, duplaEmailsMap, users]
  );

  const saveDuplaEmails = async (duplaName: string, nextEmails: string[]) => {
    const cleanEmails = Array.from(
      new Set(nextEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))
    );
    const nextMap = {
      ...duplaEmailsMap,
      [duplaName]: cleanEmails,
    };
    setDuplaEmailsMap(nextMap);
    try {
      localStorage.setItem(STORAGE_DUPLA_EMAILS_KEY, JSON.stringify(nextMap));
    } catch {
      // ignore storage errors
    }
    await onLinkEmailsToDupla(duplaName, cleanEmails);
  };

  const handleAddEmailLink = async (emailRaw: string) => {
    const clean = emailRaw.trim().toLowerCase();
    if (!clean || !clean.includes('@')) return;
    const current = getLinkedEmailsForDupla(selectedDupla);
    if (!current.includes(clean)) {
      await saveDuplaEmails(selectedDupla, [...current, clean]);
    }
    setSelectedUserEmailToLink('');
    setCustomEmailInput('');
  };

  const handleRemoveEmailLink = async (emailToRemove: string) => {
    const current = getLinkedEmailsForDupla(selectedDupla).filter(
      (e) => e.toLowerCase() !== emailToRemove.toLowerCase()
    );
    await saveDuplaEmails(selectedDupla, current);
  };

  // Active vendor Controle Geral sites
  const controleGeralSites = useMemo(
    () =>
      sites.filter((s) =>
        activeVendor === 'NOKIA' ? s.sheetName === 'Controle Geral' : !isSiteCancelado(s)
      ),
    [sites, activeVendor]
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
  }, [equipesDuplas, duplaSearch, duplaEmailsMap, users]);

  // Unified helper so left sidebar and right panel always compute the exact same sites for a Dupla
  const getSitesForDupla = (duplaName: string): TelecomSite[] => {
    const linkedEmails = getLinkedEmailsForDupla(duplaName);
    const matched = controleGeralSites.filter((s) => {
      if (doesSiteMatchEquipe(s, duplaName)) return true;
      if (doesSiteMatchResponsible(s, duplaName)) return true;
      return linkedEmails.some((em) =>
        doesSiteMatchResponsible(s, { name: duplaName, equipe: duplaName, email: em })
      );
    });
    return sortSitesParaFazerFirst(matched);
  };

  // Sites currently assigned to selectedDupla (sorted: 1º Sites a Fazer -> 2º Sites Feitos)
  const assignedSitesForSelectedDupla = useMemo(
    () => getSitesForDupla(selectedDupla),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controleGeralSites, selectedDupla, activeDuplaLinkedEmails, users]
  );

  const filteredAssignedSites = useMemo(() => {
    const q = assignedSearch.trim().toLowerCase();
    if (!q) return assignedSitesForSelectedDupla;
    return assignedSitesForSelectedDupla.filter((s) => {
      const hay = `${s.siteId} ${s.siteName} ${s.municipio} ${s.uf} ${s.status}`.toLowerCase();
      return hay.includes(q);
    });
  }, [assignedSitesForSelectedDupla, assignedSearch]);

  // Available UFs in Controle Geral
  const availableUfs = useMemo(() => {
    const set = new Set<string>();
    controleGeralSites.forEach((s) => {
      const u = (getCellValueForColumn(s, 'UF') || s.uf || '').trim().toUpperCase();
      if (u && u !== '—') set.add(u);
    });
    return Array.from(set).sort();
  }, [controleGeralSites]);

  // Candidate sites in the left picker panel
  const pickerSites = useMemo(() => {
    const assignedIds = new Set(assignedSitesForSelectedDupla.map((s) => s.id));
    const q = sitePickerSearch.trim().toLowerCase();
    const tokens = q
      ? q
          .split(/[\s,;|\n\r\t]+/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    const matched = controleGeralSites.filter((s) => {
      // Exclude sites already in this Dupla so the picker focuses on sites to send
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
    controleGeralSites,
    assignedSitesForSelectedDupla,
    sitePickerSearch,
    sitePickerUf,
    sitePickerFilter,
  ]);

  const toggleSelectSite = (siteId: string) => {
    setSelectedSiteIds((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId]
    );
  };

  const handleSelectAllVisiblePicker = () => {
    const visibleIds = pickerSites.slice(0, 100).map((s) => s.siteId);
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
      await onAssignSitesToDupla(selectedSiteIds, selectedDupla, activeDuplaLinkedEmails);
      setSelectedSiteIds([]);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleClearAllForSelectedDupla = async () => {
    if (assignedSitesForSelectedDupla.length === 0 || isClearing) return;
    setIsClearing(true);
    try {
      const tokensToClear = assignedSitesForSelectedDupla.flatMap((s) => [s.id, s.siteId]);
      await onClearDuplaSites(selectedDupla, tokensToClear);
      setAssignedSearch('');
      setSelectedSiteIds([]);
    } finally {
      setIsClearing(false);
    }
  };

  const handleSimulateSelectedDupla = () => {
    // Find matching user from users list or construct a realistic simulated user linked to this Dupla
    const matchedUser = users.find((u) =>
      activeDuplaLinkedEmails.includes(u.email.trim().toLowerCase())
    );
    if (matchedUser) {
      onSimulateDuplaView({
        ...matchedUser,
        equipe: selectedDupla,
      });
      return;
    }

    onSimulateDuplaView({
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
      equipe: selectedDupla,
      emailVerified: true,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      {/* =====================================================================
          LEFT COLUMN (4 COLS): LISTA INTERATIVA DE DUPLAS + CRIAR NOVA DUPLA
         ===================================================================== */}
      <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden flex flex-col">
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
        <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto p-2 space-y-1">
          {filteredDuplas.map((dupla) => {
            const isSelected = selectedDupla === dupla;
            const isEditing = editingDupla === dupla;
            const linkedEmails = getLinkedEmailsForDupla(dupla);
            const duplaSites = getSitesForDupla(dupla);
            const feitosCount = duplaSites.filter((s) => isSiteFeito(s)).length;
            const fazerCount = duplaSites.length - feitosCount;
            const notasCount = duplaSites.filter((s) => isSiteNotaPendente(s)).length;

            return (
              <div
                key={dupla}
                onClick={() => {
                  if (!isEditing) {
                    setSelectedDupla(dupla);
                    setSelectedSiteIds([]);
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
                            {duplaSites.length}
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

                    {/* Mini stats row */}
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
      <div className="lg:col-span-8 space-y-4">
        {/* Card A: Selected Dupla Header & Profile Email Linker */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center shadow-2xs">
                {selectedDupla.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    Dupla Selecionada: {selectedDupla}
                  </h3>
                  <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 rounded-md text-[11px] font-mono font-semibold">
                    {assignedSitesForSelectedDupla.length} site(s) na demanda
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Vincule o e-mail de perfil abaixo e selecione quais sites vão aparecer para esta dupla.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSimulateSelectedDupla}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center gap-2 cursor-pointer shadow-2xs"
              title="Ver exatamente como a planilha e os sites aparecem quando esta dupla entra no sistema"
            >
              <Eye className="w-4 h-4 text-blue-400" />
              <span>Ver como aparece para eles ({assignedSitesForSelectedDupla.length} sites)</span>
            </button>
          </div>

          {/* Profile Email Linker Box ("sera vinculado com e-mail deles de perfil") */}
          <div className="p-3.5 bg-[#F3F4F6] border border-slate-200 rounded-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-900">
                  E-mail(s) de Perfil Vinculado(s) à Dupla "{selectedDupla}"
                </span>
              </div>
              <span className="text-[11px] text-slate-500">
                Ao logar com qualquer e-mail vinculado, o usuário verá automaticamente os sites desta dupla
              </span>
            </div>

            {/* Active Linked Emails Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {activeDuplaLinkedEmails.length > 0 ? (
                activeDuplaLinkedEmails.map((email) => {
                  const matchedProfile = users.find(
                    (u) => u.email.toLowerCase() === email.toLowerCase()
                  );
                  return (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-slate-800 text-xs shadow-2xs"
                    >
                      <Mail className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="font-mono font-semibold">{email}</span>
                      {matchedProfile && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                          {matchedProfile.name}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveEmailLink(email)}
                        className="text-slate-400 hover:text-red-600 ml-0.5 cursor-pointer"
                        title="Desvincular este e-mail da dupla"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  );
                })
              ) : (
                <span className="text-xs text-slate-500 italic">
                  Nenhum e-mail vinculado ainda. Selecione um perfil cadastrado abaixo ou digite o e-mail da dupla:
                </span>
              )}
            </div>

            {/* Controls to Link Profile Email from Registered Users or Custom Email */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedUserEmailToLink}
                  onChange={(e) => setSelectedUserEmailToLink(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                >
                  <option value="">Selecionar perfil cadastrado ({users.length})...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.email}>
                      {u.name} — {u.email} ({u.role})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleAddEmailLink(selectedUserEmailToLink)}
                  disabled={!selectedUserEmailToLink}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
                >
                  Vincular Perfil
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="email"
                  value={customEmailInput}
                  onChange={(e) => setCustomEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddEmailLink(customEmailInput);
                    }
                  }}
                  placeholder="Ou digite o e-mail do perfil (ex: nome@ametatelecom.com.br)..."
                  className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                />
                <button
                  type="button"
                  onClick={() => handleAddEmailLink(customEmailInput)}
                  disabled={!customEmailInput.trim()}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
                >
                  + E-mail
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Card B: Interactive Dual-Column Site Assignment ("para quais sites vao e parece para eles") */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* PANEL 1: SELECIONAR SITES DA PLANILHA PARA MANDAR PARA A DUPLA */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden flex flex-col">
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
                  {pickerSites.length} disponíveis
                </span>
              </div>

              {/* Search or Multi-Code Paste */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={sitePickerSearch}
                  onChange={(e) => setSitePickerSearch(e.target.value)}
                  placeholder="Buscar SITE ID, Município ou colar vários códigos (SN-OI65J2 SN-OI65J4)..."
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
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleSelectAllVisiblePicker}
                  className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                  <span>
                    {selectedSiteIds.length > 0
                      ? `Desmarcar (${selectedSiteIds.length})`
                      : `Selecionar visíveis (${Math.min(100, pickerSites.length)})`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={selectedSiteIds.length === 0 || isAssigning}
                  onClick={handleConfirmAssignSelected}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <span>
                    Mandar {selectedSiteIds.length > 0 ? `${selectedSiteIds.length} ` : ''}Site(s)
                    para {selectedDupla}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Scrollable Picker List */}
            <div className="divide-y divide-slate-100 max-h-[450px] overflow-y-auto">
              {pickerSites.slice(0, 120).map((site) => {
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
                          activeDuplaLinkedEmails
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
              })}

              {pickerSites.length === 0 && (
                <div className="p-8 text-center text-xs text-slate-400">
                  Nenhum site disponível com este filtro.
                </div>
              )}
            </div>
          </div>

          {/* PANEL 2: SITES ATUALMENTE VINCULADOS À DUPLA ("O QUE APARECE PARA ELES") */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden flex flex-col">
            <div className="p-3.5 bg-slate-900 text-white space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  <div>
                    <h4 className="text-xs font-bold">
                      3. Sites que Aparecem para "{selectedDupla}" (
                      {assignedSitesForSelectedDupla.length})
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Estes sites aparecem automaticamente no perfil vinculado ({activeDuplaLinkedEmails[0] || 'sem e-mail'})
                    </p>
                  </div>
                </div>

                {assignedSitesForSelectedDupla.length > 0 && (
                  <button
                    type="button"
                    disabled={isClearing}
                    onClick={handleClearAllForSelectedDupla}
                    className="px-2.5 py-1 bg-red-600/90 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold transition-colors cursor-pointer shrink-0 shadow-2xs"
                  >
                    {isClearing ? 'Limpando...' : `Limpar Todos (${assignedSitesForSelectedDupla.length})`}
                  </button>
                )}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={assignedSearch}
                  onChange={(e) => setAssignedSearch(e.target.value)}
                  placeholder={`Filtrar nos ${assignedSitesForSelectedDupla.length} sites desta dupla...`}
                  className="w-full pl-8 pr-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-[515px] overflow-y-auto">
              {filteredAssignedSites.map((site) => {
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
                          onUnassignSitesFromDupla([site.id, site.siteId], selectedDupla)
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

              {filteredAssignedSites.length === 0 && (
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
  );
};
