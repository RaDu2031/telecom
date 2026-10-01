import React, { useState, useEffect } from 'react';
import {
  X,
  Save,
  Trash2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Wrench,
  Edit3,
  FolderKanban,
  MapPin,
  Calendar,
  FileText,
  ShieldCheck,
  Receipt,
  Table,
  Lock,
} from 'lucide-react';
import {
  TelecomSite,
  SiteStatus,
  UserRole,
  CONTROLE_GERAL_COLUMNS,
  CONTROLE_CANCELADOS_COLUMNS,
  EQUIPES_COLUMNS,
} from '../types/telecom';
import {
  getExcelColumnLetter,
  getCellValueForColumn,
  syncSiteColumnUpdate,
  STATUS_FINANCEIRO_OPTIONS,
  DEFAULT_EQUIPES_DUPLAS,
} from '../utils/spreadsheetUtils';
import { AmetaLogo } from './AmetaLogo';

interface SiteDetailDrawerProps {
  site: TelecomSite | null;
  isAdmin?: boolean;
  userRole?: UserRole;
  sheetColumns?: string[];
  duplasList?: string[];
  onOpenManageDuplas?: () => void;
  onClose: () => void;
  onSaveSite: (siteId: string, updates: Partial<TelecomSite>) => Promise<void>;
  onDeleteSite: (siteId: string) => Promise<void>;
}

const toIsoDateInput = (raw: string | undefined): string => {
  const v = String(raw || '').trim();
  if (!v || v === '—' || v === '-') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const brMatch = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    const year = brMatch[3].length === 2 ? `20${brMatch[3]}` : brMatch[3];
    return `${year}-${month}-${day}`;
  }
  return '';
};

const toBrDateDisplay = (isoOrRaw: string): string => {
  const v = String(isoOrRaw || '').trim();
  if (!v) return '';
  const isoMatch = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  return v;
};

const DEMANDED_USER_STATUS_OPTIONS: Array<{ value: SiteStatus; label: string }> = [
  { value: 'Vistoria - Finalizada', label: '✅ Vistoria - Finalizada' },
  { value: 'Vistoria - A Executar', label: '⏳ Não Finalizada (Vistoria - A Executar)' },
];

const STATUS_OPTIONS: SiteStatus[] = [
  'Vistoria - Finalizada',
  'Vistoria - A Executar',
  'Vistoria - Em Andamento',
  'Acesso - Solicitado p/ Nokia',
  'Vistoria - Sem Acesso',
  'Vistoria - Sem Chave',
  'Vistoria - Sem Acesso e Chave',
  'Vistoria - Zeladoria',
  'Vistoria - Pendênte',
  'Vistoria - Aguard. Definição',
  'Vistoria Cancelada - Saving TSSR',
  'Site Cancelado',
  'Ativo',
  'Em Comissionamento',
  'Em Implantação',
  'Manutenção',
  'Pendente',
  'Crítico',
];

export const SiteDetailDrawer: React.FC<SiteDetailDrawerProps> = ({
  site,
  isAdmin = false,
  userRole,
  sheetColumns,
  duplasList = DEFAULT_EQUIPES_DUPLAS,
  onOpenManageDuplas,
  onClose,
  onSaveSite,
  onDeleteSite,
}) => {
  const isVistoriadorRole = userRole === 'Vistoriador' || (!isAdmin && !userRole);
  const [formData, setFormData] = useState<TelecomSite | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Accordion open states matching the screenshot style
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    basic: true,
    ndpc: true,
    access: true,
    billing: true,
    allColumns: false,
  });

  useEffect(() => {
    if (site) {
      setFormData({
        ...site,
        customFields: { ...(site.customFields || {}) },
      });
      setSavedFeedback(false);
      setConfirmDelete(false);
      setIsEditing(false);
    } else {
      setFormData(null);
    }
  }, [site]);

  if (!site || !formData) return null;

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const activeOrderedColumns: string[] =
    sheetColumns && sheetColumns.length > 0
      ? sheetColumns
      : formData.sheetName === 'Controle Cancelados'
      ? CONTROLE_CANCELADOS_COLUMNS
      : formData.sheetName === 'Equipes'
      ? EQUIPES_COLUMNS
      : formData.customFields && Object.keys(formData.customFields).length > 5
      ? Object.keys(formData.customFields)
      : CONTROLE_GERAL_COLUMNS;

  const colVal = (colName: string): string => getCellValueForColumn(formData, colName);

  const handleSpreadsheetColChange = (colHeader: string, value: string) => {
    const upper = colHeader.toUpperCase();
    // Non-ADM demanded users can edit STATUS and SI Executed (date)
    if (!isAdmin && upper !== 'STATUS' && upper !== 'SI EXECUTED') {
      return;
    }
    setFormData((prev) => {
      if (!prev) return null;
      const syncedUpdates = syncSiteColumnUpdate(prev, colHeader, value);
      return {
        ...prev,
        ...syncedUpdates,
      };
    });
    setSavedFeedback(false);
  };

  const handleQuickVistoriaStatusChange = async (nextStatus: SiteStatus) => {
    if (!formData) return;
    const syncedUpdates = syncSiteColumnUpdate(formData, 'STATUS', nextStatus);
    const nextData = {
      ...formData,
      ...syncedUpdates,
    };
    setFormData(nextData);
    setSaving(true);
    try {
      await onSaveSite(formData.id, isAdmin ? nextData : syncedUpdates);
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleQuickSiExecutedChange = async (isoOrBrDate: string) => {
    if (!formData) return;
    const formatted = toBrDateDisplay(isoOrBrDate);
    const syncedUpdates = syncSiteColumnUpdate(formData, 'SI Executed', formatted);
    const nextData = {
      ...formData,
      ...syncedUpdates,
    };
    setFormData(nextData);
    setSaving(true);
    try {
      await onSaveSite(formData.id, isAdmin ? nextData : syncedUpdates);
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData) return;
    setSaving(true);
    try {
      if (isAdmin) {
        await onSaveSite(formData.id, formData);
      } else {
        const currentStatus = colVal('STATUS') || formData.status;
        const currentSiExec = colVal('SI Executed') || formData.dataAtivacao || '';
        const combinedUpdates: Partial<TelecomSite> = {
          status: currentStatus as SiteStatus,
          dataAtivacao: currentSiExec,
          customFields: {
            ...(formData.customFields || {}),
            STATUS: String(currentStatus),
            'SI Executed': String(currentSiExec),
          },
        };
        await onSaveSite(formData.id, combinedUpdates);
      }
      setSavedFeedback(true);
      setIsEditing(false);
      setTimeout(() => setSavedFeedback(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const getStatusStyle = (status: SiteStatus) => {
    const s = String(status).toLowerCase();
    if (s.includes('finalizada') || s === 'ativo') {
      return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    }
    if (s.includes('andamento') || s.includes('comissionamento') || s.includes('executar')) {
      return 'text-blue-700 bg-blue-50 border-blue-200';
    }
    if (s.includes('solicitado') || s.includes('implantação') || s.includes('aguard')) {
      return 'text-amber-700 bg-amber-50 border-amber-200';
    }
    if (s.includes('manutenção') || s.includes('zeladoria')) {
      return 'text-purple-700 bg-purple-50 border-purple-200';
    }
    if (
      s.includes('cancelad') ||
      s.includes('sem acesso') ||
      s.includes('sem chave') ||
      s.includes('crítico')
    ) {
      return 'text-red-700 bg-red-50 border-red-200';
    }
    return 'text-slate-700 bg-slate-100 border-slate-200';
  };

  const getStatusIcon = (status: SiteStatus) => {
    const s = String(status).toLowerCase();
    if (s.includes('finalizada') || s === 'ativo')
      return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
    if (s.includes('cancelad') || s.includes('sem acesso') || s.includes('crítico'))
      return <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />;
    if (s.includes('manutenção') || s.includes('zeladoria'))
      return <Wrench className="w-4 h-4 text-purple-600 shrink-0" />;
    return <Clock className="w-4 h-4 text-amber-600 shrink-0" />;
  };

  const renderFluidField = (label: string, colHeader: string, colLetterHint?: string) => {
    const val = colVal(colHeader);
    const upper = colHeader.toUpperCase();
    const isStatusField = upper === 'STATUS';
    const isSiExecField = upper === 'SI EXECUTED';
    const canEditThisField = isAdmin || isStatusField || isSiExecField;

    return (
      <div
        key={colHeader}
        onClick={() => {
          if (canEditThisField && !isEditing) setIsEditing(true);
        }}
        className={`group p-3 rounded-xl border transition-colors ${
          (isStatusField || isSiExecField) && !isAdmin
            ? 'bg-blue-50/60 hover:bg-blue-50 border-blue-300 cursor-pointer'
            : canEditThisField
            ? 'bg-slate-50/80 hover:bg-slate-100/70 border-slate-200/70 cursor-pointer'
            : 'bg-slate-50/60 border-slate-200/60 cursor-default'
        }`}
      >
        <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-slate-500 mb-1">
          <span className="truncate flex items-center gap-1">
            <span>{label}</span>
            {!canEditThisField && <Lock className="w-2.5 h-2.5 text-slate-400 shrink-0" />}
          </span>
          {colLetterHint && (
            <span className="font-mono text-[10px] text-slate-400">Col {colLetterHint}</span>
          )}
        </div>
        {(isEditing && canEditThisField) || ((isStatusField || isSiExecField) && !isAdmin) ? (
          isSiExecField ? (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <input
                type="date"
                value={toIsoDateInput(val || formData.dataAtivacao)}
                onChange={(e) => {
                  const iso = e.target.value;
                  if (!isAdmin) {
                    handleQuickSiExecutedChange(iso);
                  } else {
                    handleSpreadsheetColChange(colHeader, toBrDateDisplay(iso));
                  }
                }}
                className="flex-1 px-2.5 py-1.5 bg-white border border-blue-500 rounded-lg text-xs font-mono font-semibold text-slate-900 focus:outline-none cursor-pointer"
              />
              <button
                type="button"
                onClick={() => {
                  const todayIso = new Date().toISOString().slice(0, 10);
                  if (!isAdmin) {
                    handleQuickSiExecutedChange(todayIso);
                  } else {
                    handleSpreadsheetColChange(colHeader, toBrDateDisplay(todayIso));
                  }
                }}
                className="px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-semibold cursor-pointer whitespace-nowrap"
                title="Preencher com a data de hoje"
              >
                Hoje
              </button>
            </div>
          ) : isStatusField ? (
            <select
              value={val || formData.status}
              onChange={(e) => {
                if (!isAdmin) {
                  handleQuickVistoriaStatusChange(e.target.value as SiteStatus);
                } else {
                  handleSpreadsheetColChange(colHeader, e.target.value);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full px-2.5 py-1.5 bg-white border border-blue-500 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none"
            >
              {isAdmin ? (
                <>
                  {!STATUS_OPTIONS.includes(val || formData.status) &&
                    (val || formData.status) && (
                      <option value={val || formData.status}>{val || formData.status}</option>
                    )}
                  {STATUS_OPTIONS.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </>
              ) : (
                <>
                  {!DEMANDED_USER_STATUS_OPTIONS.some(
                    (opt) => opt.value === (val || formData.status)
                  ) &&
                    (val || formData.status) && (
                      <option value={val || formData.status}>{val || formData.status}</option>
                    )}
                  {DEMANDED_USER_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </>
              )}
            </select>
          ) : colHeader === 'Status Financeiro' ? (
            <select
              value={val || ''}
              onChange={(e) => handleSpreadsheetColChange(colHeader, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="w-full px-2.5 py-1.5 bg-white border border-blue-500 rounded-lg text-xs text-slate-900 focus:outline-none"
            >
              <option value="">— Sem Status Financeiro —</option>
              {val && !STATUS_FINANCEIRO_OPTIONS.includes(val) && (
                <option value={val}>{val}</option>
              )}
              {STATUS_FINANCEIRO_OPTIONS.map((fin) => (
                <option key={fin} value={fin}>
                  {fin}
                </option>
              ))}
            </select>
          ) : colHeader.toUpperCase() === 'EQUIPE EXECUTANTE' ||
            colHeader.toUpperCase() === 'EXECUTOR' ? (
            <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
              <select
                value={val || ''}
                onChange={(e) => {
                  if (e.target.value === '__MANAGE_DUPLAS__') {
                    if (onOpenManageDuplas) onOpenManageDuplas();
                    return;
                  }
                  handleSpreadsheetColChange('EQUIPE EXECUTANTE', e.target.value);
                }}
                className="w-full px-2.5 py-1.5 bg-white border border-blue-500 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none"
              >
                <option value="">— Sem Dupla / Equipe —</option>
                {val && !duplasList.includes(val) && <option value={val}>{val}</option>}
                {duplasList.map((dp) => (
                  <option key={dp} value={dp}>
                    {dp}
                  </option>
                ))}
                {onOpenManageDuplas && (
                  <option value="__MANAGE_DUPLAS__">⚙️ Editar / Gerenciar Duplas...</option>
                )}
              </select>
            </div>
          ) : (
            <input
              type="text"
              value={val}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => handleSpreadsheetColChange(colHeader, e.target.value)}
              placeholder="—"
              className="w-full px-2.5 py-1 bg-white border border-blue-500 rounded-lg text-xs font-mono text-slate-900 focus:outline-none"
            />
          )
        ) : (
          <div
            className={`text-sm font-medium break-words ${
              val ? 'text-slate-900' : 'text-slate-400 italic font-normal'
            }`}
          >
            {val || 'Não informado'}
          </div>
        )}
      </div>
    );
  };

  const prioridadeFolder = colVal('Prioridade') || 'Engenharia';
  const municipioVal = colVal('MUNICÍPIO') || colVal('CIDADE') || formData.municipio || '—';
  const ufVal = colVal('UF') || formData.uf || '—';
  const regVal = colVal('REG.') || formData.regional || '—';
  const obsMotivo = colVal('Observações/Motivo') || colVal('OBSERVAÇÕES') || formData.observacoes;
  const comentariosGerais = colVal('Comentários');
  const comentariosAcesso = colVal('Comentários do Acesso');

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/25 transition-opacity"
      onClick={onClose}
    >
      {/* Right-Side Slide-over Panel (HubSpot / Asana Drawer Pattern — keeps table visible on the left) */}
      <aside
        className="w-full max-w-2xl bg-white border-l border-slate-200 shadow-2xl h-full flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Drawer Header */}
        <div className="px-5 py-3.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AmetaLogo size="sm" theme="light" />
            <div className="h-5 w-px bg-slate-200 hidden sm:block" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="font-semibold text-slate-700">{formData.vendor}</span>
                <span>·</span>
                <span>Pasta {prioridadeFolder}</span>
                <span>·</span>
                <span className="truncate">{formData.sheetName}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                <h2 className="text-lg font-bold font-mono text-slate-900 tracking-tight tabular-nums">
                  {formData.siteId}
                </h2>
                <span className="text-slate-300">/</span>
                <span className="text-sm font-semibold text-slate-700 truncate">
                  {colVal('END ID') || formData.siteName}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${getStatusStyle(
                    formData.status
                  )}`}
                >
                  {getStatusIcon(formData.status)}
                  <span>{formData.status}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Drawer Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {savedFeedback && (
              <span className="text-xs text-emerald-600 font-medium flex items-center gap-1 mr-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Salvo
              </span>
            )}

            {isAdmin ? (
              <button
                type="button"
                onClick={() => setIsEditing((prev) => !prev)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer ${
                  isEditing
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{isEditing ? 'Editando' : 'Editar Dados'}</span>
              </button>
            ) : (
              <span className="px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium rounded-lg flex items-center gap-1">
                <Lock className="w-3 h-3 text-slate-500" />
                <span>SI Executed & Status liberados</span>
              </span>
            )}

            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={saving}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Salvando...' : 'Salvar'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              aria-label="Fechar gaveta lateral"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Drawer Content */}
        <div className="flex-1 overflow-y-auto p-5 bg-slate-50/70 space-y-4">
          {/* Quick Vistoria Status & SI Executed Date Bar for Demanded Users */}
          {!isAdmin && (
            <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3.5 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-blue-600" />
                    <span>Campos Liberados: SI Executed (Data) & Status da Vistoria</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Preencha a data de execução em <strong>SI Executed</strong> e marque o <strong>Status</strong>.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleQuickVistoriaStatusChange('Vistoria - Finalizada')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                      String(formData.status).toLowerCase().includes('finalizada')
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'bg-white hover:bg-emerald-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Vistoria - Finalizada</span>
                  </button>

                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleQuickVistoriaStatusChange('Vistoria - A Executar')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                      !String(formData.status).toLowerCase().includes('finalizada')
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'bg-white hover:bg-amber-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Não Finalizada (A Executar)</span>
                  </button>
                </div>
              </div>

              {/* SI Executed Date Picker Row */}
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Data de Execução (SI Executed)
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Atual: <strong>{colVal('SI Executed') || formData.dataAtivacao || 'Não preenchida'}</strong>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={toIsoDateInput(colVal('SI Executed') || formData.dataAtivacao)}
                    onChange={(e) => handleQuickSiExecutedChange(e.target.value)}
                    className="px-3 py-1.5 bg-slate-50 hover:bg-white border border-blue-400 rounded-lg text-xs font-mono font-semibold text-slate-900 focus:outline-none focus:border-blue-600 cursor-pointer"
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      handleQuickSiExecutedChange(new Date().toISOString().slice(0, 10))
                    }
                    className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    Data de Hoje
                  </button>
                  {(colVal('SI Executed') || formData.dataAtivacao) && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleQuickSiExecutedChange('')}
                      className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-medium cursor-pointer"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {isVistoriadorRole ? (
            /* Restricted Vistoriador View: ONLY SITE ID, END ID, Oc Site Pre, UF, PROJETO, EQUIPE, SI Executed, STATUS */
            <div className="bg-white border border-slate-200/90 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <span className="text-sm font-bold text-slate-900">
                  Dados do Site (Visão Vistoriador)
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  8 colunas essenciais
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {renderFluidField('SITE ID', 'SITE ID')}
                {renderFluidField('END ID', 'END ID')}
                {renderFluidField('Oc Site Pre', 'Oc Site Pre')}
                {renderFluidField('UF', 'UF')}
                {renderFluidField('PROJETO', 'PROJETO')}
                {renderFluidField('EQUIPE', 'EQUIPE EXECUTANTE')}
                {renderFluidField('SI Executed (Data)', 'SI Executed')}
                {renderFluidField('STATUS', 'STATUS')}
              </div>
            </div>
          ) : (
            <>
              {/* Key Highlights Strip (2x2 in Side Drawer) */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-500 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>Localidade & Regional</span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-900 truncate">
                    {municipioVal} — {ufVal}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    Reg: {regVal} · {colVal('Tipo Site') || formData.tipoInfra || '—'}
                  </div>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-500 flex items-center gap-1">
                    <FolderKanban className="w-3.5 h-3.5 text-slate-400" />
                    <span>Projeto & SMP</span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-900 truncate">
                    {colVal('PROJETO') || formData.tecnologias || '—'} ({colVal('Escopo') || 'E2E'})
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate tabular-nums">
                    {colVal('SMP') || 'Sem SMP'} · OC {colVal('Oc Site Pre') || '—'}
                  </div>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <div className="flex items-center justify-between gap-1 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>Equipe Executante (Dupla)</span>
                    </span>
                    {isAdmin && onOpenManageDuplas && (
                      <button
                        type="button"
                        onClick={onOpenManageDuplas}
                        className="text-[10px] font-semibold text-blue-600 hover:underline cursor-pointer"
                      >
                        Editar Duplas
                      </button>
                    )}
                  </div>
                  {isAdmin ? (
                    <select
                      value={colVal('EQUIPE EXECUTANTE') || formData.equipeParceira || ''}
                      onChange={(e) => {
                        if (e.target.value === '__MANAGE_DUPLAS__') {
                          if (onOpenManageDuplas) onOpenManageDuplas();
                          return;
                        }
                        const nextDupla = e.target.value;
                        const synced = syncSiteColumnUpdate(
                          formData,
                          'EQUIPE EXECUTANTE',
                          nextDupla
                        );
                        const nextData = { ...formData, ...synced };
                        setFormData(nextData);
                        onSaveSite(formData.id, nextData);
                      }}
                      className="mt-1 w-full px-2 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 cursor-pointer"
                    >
                      <option value="">— Escolher Dupla / Equipe —</option>
                      {(colVal('EQUIPE EXECUTANTE') || formData.equipeParceira) &&
                        !duplasList.includes(
                          colVal('EQUIPE EXECUTANTE') || formData.equipeParceira
                        ) && (
                          <option value={colVal('EQUIPE EXECUTANTE') || formData.equipeParceira}>
                            {colVal('EQUIPE EXECUTANTE') || formData.equipeParceira}
                          </option>
                        )}
                      {duplasList.map((dp) => (
                        <option key={dp} value={dp}>
                          {dp}
                        </option>
                      ))}
                      {onOpenManageDuplas && (
                        <option value="__MANAGE_DUPLAS__">⚙️ Editar / Gerenciar Duplas...</option>
                      )}
                    </select>
                  ) : (
                    <div className="mt-1 text-xs font-semibold text-slate-900 truncate">
                      {colVal('EQUIPE EXECUTANTE') || formData.equipeParceira || '—'}
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate tabular-nums">
                    SI Exec: {colVal('SI Executed') || '—'}
                  </div>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-500 flex items-center gap-1">
                    <Receipt className="w-3.5 h-3.5 text-slate-400" />
                    <span>Status Financeiro / NF</span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-900 truncate">
                    {colVal('Status Financeiro') || formData.alarmesAtivos || '—'}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate tabular-nums">
                    NF: {colVal('N° da NF') || '—'} · SPO: {colVal('SPO') || '—'}
                  </div>
                </div>
              </div>

              {/* Fluid Highlight Card for Comentários & Observações/Motivo */}
              <div className="bg-white border border-slate-200/90 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                    <FileText className="w-4 h-4 text-blue-600" />
                    <span>Observações, Comentários de Engenharia & Acesso</span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Colunas V, AJ e AT
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div
                    onClick={() => isAdmin && !isEditing && setIsEditing(true)}
                    className={`p-3 rounded-xl bg-slate-50 border border-slate-200/70 ${
                      isAdmin ? 'cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-slate-500 mb-1">
                      Comentários (Col V)
                    </div>
                    {isEditing && isAdmin ? (
                      <textarea
                        rows={2}
                        value={comentariosGerais}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleSpreadsheetColChange('Comentários', e.target.value)}
                        className="w-full p-2 bg-white border border-blue-500 rounded-lg text-xs text-slate-900 focus:outline-none"
                      />
                    ) : (
                      <p className="text-xs text-slate-800 leading-relaxed">
                        {comentariosGerais || 'Sem comentários técnicos registrados.'}
                      </p>
                    )}
                  </div>

                  <div
                    onClick={() => isAdmin && !isEditing && setIsEditing(true)}
                    className={`p-3 rounded-xl bg-slate-50 border border-slate-200/70 ${
                      isAdmin ? 'cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-slate-500 mb-1">
                      Comentários do Acesso (Col AJ)
                    </div>
                    {isEditing && isAdmin ? (
                      <textarea
                        rows={2}
                        value={comentariosAcesso}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          handleSpreadsheetColChange('Comentários do Acesso', e.target.value)
                        }
                        className="w-full p-2 bg-white border border-blue-500 rounded-lg text-xs text-slate-900 focus:outline-none"
                      />
                    ) : (
                      <p className="text-xs text-slate-800 leading-relaxed">
                        {comentariosAcesso || 'Sem restrições ou observações de acesso.'}
                      </p>
                    )}
                  </div>

                  <div
                    onClick={() => isAdmin && !isEditing && setIsEditing(true)}
                    className={`p-3 rounded-xl bg-slate-50 border border-slate-200/70 ${
                      isAdmin ? 'cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-slate-500 mb-1">
                      Observações / Motivo (Col AT)
                    </div>
                    {isEditing && isAdmin ? (
                      <textarea
                        rows={2}
                        value={obsMotivo}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          handleSpreadsheetColChange('Observações/Motivo', e.target.value)
                        }
                        className="w-full p-2 bg-white border border-blue-500 rounded-lg text-xs text-slate-900 focus:outline-none"
                      />
                    ) : (
                      <p className="text-xs text-slate-800 leading-relaxed">
                        {obsMotivo || 'Nenhuma observação financeira/motivo pendente.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* ACCORDION 1: Basic Details & Engenharia (SiteFORGE Style) */}
              <div className="bg-white border border-slate-200/90 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('basic')}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="text-sm font-bold text-slate-900">
                    Basic Details & Pasta Engenharia
                  </span>
                  {openSections.basic ? (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </button>
                {openSections.basic && (
                  <div className="px-5 pb-5 pt-2 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {renderFluidField('Oc Site Pre', 'Oc Site Pre', 'A')}
                    {renderFluidField('SITE ID', 'SITE ID', 'B')}
                    {renderFluidField('END ID', 'END ID', 'C')}
                    {renderFluidField('SMP', 'SMP', 'D')}
                    {renderFluidField('ID. DETENTORA', 'ID. DETENTORA', 'E')}
                    {renderFluidField('Regional (REG.)', 'REG.', 'F')}
                    {renderFluidField('UF', 'UF', 'G')}
                    {renderFluidField('Município', 'MUNICÍPIO', 'H')}
                    {renderFluidField('Projeto', 'PROJETO', 'I')}
                    {renderFluidField('Pasta / Prioridade', 'Prioridade', 'J')}
                    {renderFluidField('Status', 'STATUS', 'K')}
                    {renderFluidField('Escopo', 'Escopo', 'Z')}
                    {renderFluidField('Tipo Site', 'Tipo Site', 'AC')}
                    {renderFluidField('Modelo De Site', 'Modelo De Site', 'AD')}
                    {renderFluidField('Prioridade Engenharia', 'Prioridade Engenharia', 'AE')}
                    {renderFluidField('Swap Cluster', 'Swap Cluster', 'AF')}
                  </div>
                )}
              </div>

              {/* ACCORDION 2: NDPc Configuration & Cronograma SI */}
              <div className="bg-white border border-slate-200/90 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('ndpc')}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="text-sm font-bold text-slate-900">
                    NDPc Configuration & Cronograma de Vistoria (SI)
                  </span>
                  {openSections.ndpc ? (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </button>
                {openSections.ndpc && (
                  <div className="px-5 pb-5 pt-2 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {renderFluidField('Acionamento', 'ACIONAMENTO', 'L')}
                    {renderFluidField('Apoio', 'APOIO', 'M')}
                    {renderFluidField('CallOff Solicitado', 'CallOff Solicitado', 'N')}
                    {renderFluidField('DEC', 'DEC', 'O')}
                    {renderFluidField('Equipe Executante', 'EQUIPE EXECUTANTE', 'P')}
                    {renderFluidField('SI Planned', 'SI Planned', 'Q')}
                    {renderFluidField('SI Executed', 'SI Executed', 'R')}
                    {renderFluidField('Executor', 'Executor', 'S')}
                    {renderFluidField('NDPc TalonView', 'NDPc TalonView', 'T')}
                    {renderFluidField('SI Report GDC Portal', 'SI Report GDC Portal', 'U')}
                    {renderFluidField('SI Replanned', 'SI REPLANNED', 'AA')}
                    {renderFluidField('Motivo Replan', 'MOTIVO REPLAN', 'AB')}
                  </div>
                )}
              </div>

              {/* ACCORDION 3: License to Work & Solicitação de Acesso */}
              <div className="bg-white border border-slate-200/90 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('access')}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-600" />
                    <span>License to Work, Detentora & Controle de Acesso</span>
                  </span>
                  {openSections.access ? (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </button>
                {openSections.access && (
                  <div className="px-5 pb-5 pt-2 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {renderFluidField('IMP Detentora', 'IMP Detentora', 'AG')}
                    {renderFluidField('Status do Acesso', 'Acesso', 'AH')}
                    {renderFluidField('Data Liberação Acesso', 'Data', 'AI')}
                    {renderFluidField('Improdutiva', 'Improdutiva', 'W')}
                    {renderFluidField('Pendência Engenharia', 'Pendência Engenharia', 'X')}
                    {renderFluidField('Data do Abono', 'Data do Abono', 'Y')}
                  </div>
                )}
              </div>

              {/* ACCORDION 4: SAP By Design / Faturamento SPO, SGR & NF */}
              <div className="bg-white border border-slate-200/90 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('billing')}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="text-sm font-bold text-slate-900">
                    SAP By Design — SPO, SGR & Faturamento de Notas Fiscais
                  </span>
                  {openSections.billing ? (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </button>
                {openSections.billing && (
                  <div className="px-5 pb-5 pt-2 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {renderFluidField('Lib. Fat. ASP', 'Lib. Fat. ASP', 'AK')}
                    {renderFluidField('Lib. Fat. TalonView', 'Lib. Fat. TalonView', 'AL')}
                    {renderFluidField('Item', 'ITEM', 'AM')}
                    {renderFluidField('SPO', 'SPO', 'AN')}
                    {renderFluidField('SGR', 'SGR', 'AO')}
                    {renderFluidField('N° da NF', 'N° da NF', 'AP')}
                    {renderFluidField('Data NF', 'DATA NF', 'AQ')}
                    {renderFluidField('Envio Edicom', 'Envio Edcom', 'AR')}
                    {renderFluidField('Status Financeiro', 'Status Financeiro', 'AS')}
                  </div>
                )}
              </div>

              {/* ACCORDION 5: Todas as Colunas da Planilha (Coluna A até Observação) */}
              <div className="bg-white border border-slate-200/90 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('allColumns')}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Table className="w-4 h-4 text-blue-600" />
                    <span>
                      Todas as {activeOrderedColumns.length} Colunas da Planilha (Coluna A até{' '}
                      {activeOrderedColumns[activeOrderedColumns.length - 1] || 'Observação'})
                    </span>
                  </span>
                  {openSections.allColumns ? (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </button>
                {openSections.allColumns && (
                  <div className="px-5 pb-5 pt-2 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {activeOrderedColumns.map((colHeader, idx) =>
                      renderFluidField(colHeader, colHeader, getExcelColumnLetter(idx))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Popup Footer */}
        <div className="px-6 py-3.5 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          {isAdmin ? (
            !confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Excluir Site</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 font-medium">
                  Confirmar exclusão de {formData.siteId}?
                </span>
                <button
                  type="button"
                  onClick={() => onDeleteSite(formData.id)}
                  className="px-3 py-1 bg-red-600 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Excluir
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1 bg-slate-100 text-slate-700 text-xs rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            )
          ) : (
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>Somente o Status da Vistoria (Finalizada / Não Finalizada) pode ser editado pelo responsável.</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Salvando...' : 'Salvar Alterações'}</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
