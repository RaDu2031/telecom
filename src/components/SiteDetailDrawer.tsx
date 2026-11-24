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
  Key,
} from 'lucide-react';
import {
  TelecomSite,
  SiteStatus,
  UserRole,
  CONTROLE_GERAL_COLUMNS,
  CONTROLE_CANCELADOS_COLUMNS,
  EQUIPES_COLUMNS,
  Acionamento,
} from '../types/telecom';
import {
  getExcelColumnLetter,
  getCellValueForColumn,
  syncSiteColumnUpdate,
  STATUS_FINANCEIRO_OPTIONS,
  DEFAULT_EQUIPES_DUPLAS,
} from '../utils/spreadsheetUtils';
import { AmetaLogo } from './AmetaLogo';
import { AcionamentoStatusBadge, formatAcionamentoDate } from './AcionamentoStatusBadge';

interface SiteDetailDrawerProps {
  site: TelecomSite | null;
  isAdmin?: boolean;
  userRole?: UserRole;
  sheetColumns?: string[];
  duplasList?: string[];
  acionamento?: Acionamento | null;
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
  acionamento,
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
      return 'text-amber-800 bg-amber-50 border-amber-200';
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
      return 'text-rose-700 bg-rose-50 border-rose-200';
    }
    return 'text-slate-700 bg-slate-100 border-slate-200';
  };

  const getStatusIcon = (status: SiteStatus) => {
    const s = String(status).toLowerCase();
    if (s.includes('finalizada') || s === 'ativo')
      return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
    if (s.includes('cancelad') || s.includes('sem acesso') || s.includes('crítico'))
      return <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />;
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
        className={`group p-3 rounded-[10px] border transition-colors ${
          (isStatusField || isSiExecField) && !isAdmin
            ? 'bg-teal-50/50 hover:bg-teal-50 border-[#1E8E8D]/40 cursor-pointer'
            : canEditThisField
            ? 'bg-slate-50/70 hover:bg-slate-100/80 border-slate-200 cursor-pointer'
            : 'bg-slate-50/50 border-slate-200/80 cursor-default'
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
                className="flex-1 px-2.5 py-1.5 bg-white border border-[#223585]/40 rounded-[8px] text-xs font-mono font-semibold text-slate-900 focus:outline-none focus:border-[#223585] cursor-pointer"
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
                className="px-2.5 py-1.5 bg-[#223585] hover:bg-[#1B2A6B] text-white rounded-[8px] text-[10px] font-bold cursor-pointer whitespace-nowrap"
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
              className="w-full px-2.5 py-1.5 bg-white border border-[#223585]/40 rounded-[8px] text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#223585]"
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
              className="w-full px-2.5 py-1.5 bg-white border border-[#223585]/40 rounded-[8px] text-xs text-slate-900 focus:outline-none focus:border-[#223585]"
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
                className="w-full px-2.5 py-1.5 bg-white border border-[#223585]/40 rounded-[8px] text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#223585]"
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
              className="w-full px-2.5 py-1 bg-white border border-[#223585]/40 rounded-[8px] text-xs font-mono text-slate-900 focus:outline-none focus:border-[#223585]"
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
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/45 ameta-modal-backdrop transition-opacity"
      onClick={onClose}
    >
      {/* Right-Side Slide-over Panel (keeps table visible on the left) */}
      <aside
        className="w-full max-w-2xl bg-white border-l border-slate-200 shadow-2xl h-full flex flex-col overflow-hidden ameta-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Drawer Header */}
        <div className="px-5 py-3.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AmetaLogo size="sm" theme="light" />
            <div className="h-5 w-px bg-slate-200 hidden sm:block" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="font-semibold text-slate-800">{formData.vendor}</span>
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
                <span className="text-sm font-semibold text-slate-600 truncate">
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
                {acionamento && (
                  <AcionamentoStatusBadge acionamento={acionamento} />
                )}
              </div>
            </div>
          </div>

          {/* Drawer Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {savedFeedback && (
              <span className="text-xs text-emerald-700 font-medium flex items-center gap-1 mr-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Salvo
              </span>
            )}

            {isAdmin ? (
              <button
                type="button"
                onClick={() => setIsEditing((prev) => !prev)}
                className={`px-3 py-1.5 text-xs font-medium rounded-[8px] border transition-colors flex items-center gap-1.5 cursor-pointer ${
                  isEditing
                    ? 'bg-[#223585]/10 border-[#223585]/35 text-[#223585]'
                    : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{isEditing ? 'Editando' : 'Editar Dados'}</span>
              </button>
            ) : (
              <span className="px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium rounded-[8px] flex items-center gap-1">
                <Lock className="w-3 h-3 text-slate-500" />
                <span>SI Executed & Status liberados</span>
              </span>
            )}

            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={saving}
              className="px-3.5 py-1.5 bg-[#223585] hover:bg-[#1B2A6B] disabled:opacity-50 text-white text-xs font-bold rounded-[8px] transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Salvando...' : 'Salvar'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-[8px] transition-colors cursor-pointer"
              aria-label="Fechar gaveta lateral"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Drawer Content */}
        <div className="flex-1 overflow-y-auto p-5 bg-[#F4F6FA] space-y-4">
          {/* Card Acionamento Ameta integrado em tempo real */}
          {acionamento && (
            <div
              className={`p-4 rounded-[12px] border space-y-2.5 shadow-2xs ${
                acionamento.status === 'Recusado'
                  ? 'bg-rose-50/70 border-rose-200 ring-1 ring-rose-200'
                  : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
                    Acionamento Integrado ({acionamento.origem})
                  </span>
                  <span className="font-mono tabular-nums text-xs font-bold text-[#223585]">
                    {acionamento.protocolo}
                  </span>
                  <span className="px-1.5 py-0.5 rounded-[6px] text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-700 font-bold">
                    {acionamento.tipoDestinatario}
                  </span>
                </div>
                <AcionamentoStatusBadge acionamento={acionamento} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500 text-[11px] block">Equipe Destinatária:</span>
                  <span className="font-semibold text-slate-900">{acionamento.equipe}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[11px] block">Demandado por:</span>
                  <span className="font-medium text-slate-800">
                    {acionamento.demandadoPorNome}{' '}
                    {acionamento.demandadoEm && (
                      <span className="text-slate-500 font-mono tabular-nums text-[10px]">
                        ({formatAcionamentoDate(acionamento.demandadoEm)})
                      </span>
                    )}
                  </span>
                </div>

                {acionamento.dataDemanda && (
                  <div>
                    <span className="text-slate-500 text-[11px] block">Data da Demanda:</span>
                    <span className="font-mono tabular-nums font-medium text-slate-800">
                      {formatAcionamentoDate(acionamento.dataDemanda)}
                    </span>
                  </div>
                )}

                {acionamento.aceitoEm && (
                  <div className="sm:col-span-2 p-2 bg-blue-50 rounded-[8px] border border-blue-200 text-blue-900">
                    <span className="font-bold">Aceite Confirmado:</span> por{' '}
                    <strong>{acionamento.aceitoPorNome || acionamento.aceitoPorEmail}</strong> em{' '}
                    {formatAcionamentoDate(acionamento.aceitoEm)}
                  </div>
                )}

                {acionamento.planilhaAtualizadaEm && (
                  <div className="sm:col-span-2 p-2 bg-emerald-50 rounded-[8px] border border-emerald-200 text-emerald-900 text-xs">
                    <span className="font-bold text-emerald-800">Planilha atualizada em:</span>{' '}
                    {formatAcionamentoDate(acionamento.planilhaAtualizadaEm)}
                    {acionamento.planilhaResumo ? ` · ${acionamento.planilhaResumo}` : ''}
                  </div>
                )}

                {acionamento.status === 'Recusado' && (
                  <div className="sm:col-span-2 p-2.5 bg-rose-50 rounded-[8px] border border-rose-200 text-rose-900 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-rose-800">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>Demanda Recusada pelo Destinatário! Reatribuição recomendada.</span>
                    </div>
                    <div className="text-[11px]">
                      Recusado por <strong>{acionamento.recusadoPorNome || acionamento.recusadoPorEmail || 'Destinatário'}</strong>
                      {acionamento.recusadoEm ? ` em ${formatAcionamentoDate(acionamento.recusadoEm)}` : ''}
                    </div>
                    {acionamento.motivoRecusa && (
                      <div className="text-xs bg-white p-1.5 rounded-[6px] italic border border-rose-200 text-rose-900">
                        Motivo: "{acionamento.motivoRecusa}"
                      </div>
                    )}
                  </div>
                )}

                {/* Histórico do Acionamento */}
                {Array.isArray(acionamento.historico) && acionamento.historico.length > 0 && (
                  <div className="sm:col-span-2 pt-2 border-t border-slate-100 space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                      Histórico ({acionamento.historico.length})
                    </span>
                    <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                      {acionamento.historico.map((h: any, idx: number) => {
                        const hData = formatAcionamentoDate(h?.data || h?.timestamp);
                        const hAutor = typeof h?.autor === 'string' ? h.autor : (typeof h?.usuario === 'string' ? h.usuario : '');
                        const hEmail = typeof h?.email === 'string' ? h.email : '';
                        const hAcao = typeof h?.acao === 'string' ? h.acao : (typeof h?.descricao === 'string' ? h.descricao : 'Atualização');
                        const hStatus = typeof h?.status === 'string' ? h.status : '';
                        const hDetalhes = typeof h?.detalhes === 'string' ? h.detalhes : '';

                        return (
                          <div
                            key={idx}
                            className="p-2 rounded-[8px] bg-slate-50 border border-slate-200 text-[11px] space-y-0.5"
                          >
                            <div className="flex items-center justify-between text-slate-500 text-[10px]">
                              <span className="font-mono tabular-nums">{hData || 'Data não informada'}</span>
                              {hStatus && (
                                <span className="font-semibold text-slate-700 bg-white px-1.5 py-0.2 rounded border border-slate-200 text-[9px]">
                                  {hStatus}
                                </span>
                              )}
                            </div>
                            <div className="font-medium text-slate-800">
                              {hAcao}
                              {hAutor ? ` · ${hAutor}` : ''}
                              {hEmail ? ` (${hEmail})` : ''}
                            </div>
                            {hDetalhes && (
                              <div className="text-[10px] text-slate-500 italic">
                                {hDetalhes}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Quick Vistoria Status & SI Executed Date Bar for Demanded Users */}
          {!isAdmin && (
            <div className="p-4 bg-white border border-slate-200 rounded-[12px] space-y-3.5 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-[#1E8E8D]" />
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
                    className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                      String(formData.status).toLowerCase().includes('finalizada')
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                        : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Vistoria - Finalizada</span>
                  </button>

                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleQuickVistoriaStatusChange('Vistoria - A Executar')}
                    className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                      !String(formData.status).toLowerCase().includes('finalizada')
                        ? 'bg-amber-50 border-amber-300 text-amber-800'
                        : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
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
                  <Calendar className="w-4 h-4 text-[#223585] shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Data de Execução (SI Executed)
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      Atual: <strong className="text-slate-800">{colVal('SI Executed') || formData.dataAtivacao || 'Não preenchida'}</strong>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={toIsoDateInput(colVal('SI Executed') || formData.dataAtivacao)}
                    onChange={(e) => handleQuickSiExecutedChange(e.target.value)}
                    className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-[8px] text-xs font-mono tabular-nums font-semibold text-slate-900 focus:outline-none focus:border-[#223585] cursor-pointer"
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      handleQuickSiExecutedChange(new Date().toISOString().slice(0, 10))
                    }
                    className="px-2.5 py-1.5 bg-[#223585] hover:bg-[#1B2A6B] text-white rounded-[8px] text-xs font-bold cursor-pointer whitespace-nowrap"
                  >
                    Data de Hoje
                  </button>
                  {(colVal('SI Executed') || formData.dataAtivacao) && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleQuickSiExecutedChange('')}
                      className="px-2 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-[8px] text-xs font-medium cursor-pointer"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {isVistoriadorRole ? (
            /* Vistoriador View: Dados Essenciais + Informações de Acesso (Coluna Acesso, Data de Acesso, Comentários do Acesso) */
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-[12px] p-5 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <span className="text-sm font-bold text-slate-900">
                    Dados da Demanda (Visão Vistoriador)
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    Informações da Demanda
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

              {/* Informações de Acesso & Chaves liberadas para o Vistoriador */}
              <div className="bg-amber-50/70 border border-amber-200 rounded-[12px] p-4.5 space-y-3.5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-amber-200/80 pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700">
                      <Key className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-amber-900 block">
                        Controle de Acesso & Chaves
                      </span>
                      <span className="text-[10px] text-amber-800 block">
                        Informações necessárias para ida a campo
                      </span>
                    </div>
                  </div>
                  {colVal('Acesso') && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      {colVal('Acesso')}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {renderFluidField('Coluna Acesso (Status)', 'Acesso', 'AH')}
                  {renderFluidField('Data de Acesso (Data Liberação)', 'Data', 'AI')}
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block mb-1">
                    Comentários do Acesso (Col AJ)
                  </label>
                  <div className="p-3 bg-white rounded-[10px] border border-amber-200 text-xs font-medium text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {comentariosAcesso || 'Sem comentários de acesso registrados para este site.'}
                  </div>
                </div>

                {comentariosGerais && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Comentários Gerais de Engenharia (Col V)
                    </label>
                    <div className="p-3 bg-white rounded-[10px] border border-slate-200 text-xs font-medium text-slate-800 whitespace-pre-wrap leading-relaxed">
                      {comentariosGerais}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Key Highlights Strip (2x2 in Side Drawer) */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 bg-white border border-slate-200 rounded-[12px]">
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

                <div className="p-3 bg-white border border-slate-200 rounded-[12px]">
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

                <div className="p-3 bg-white border border-slate-200 rounded-[12px]">
                  <div className="flex items-center justify-between gap-1 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>Equipe Executante (Dupla)</span>
                    </span>
                    {isAdmin && onOpenManageDuplas && (
                      <button
                        type="button"
                        onClick={onOpenManageDuplas}
                        className="text-[10px] font-semibold text-[#223585] hover:underline cursor-pointer"
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
                      className="mt-1 w-full px-2 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-[8px] text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#223585] cursor-pointer"
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

                <div className="p-3 bg-white border border-slate-200 rounded-[12px]">
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
              <div className="bg-white border border-slate-200 rounded-[12px] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <FileText className="w-4 h-4 text-[#223585]" />
                    <span>Observações, Comentários de Engenharia & Acesso</span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono">
                    Colunas V, AJ e AT
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div
                    onClick={() => isAdmin && !isEditing && setIsEditing(true)}
                    className={`p-3 rounded-[10px] bg-slate-50 border border-slate-200 ${
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
                        className="w-full p-2 bg-white border border-[#223585]/40 rounded-[8px] text-xs text-slate-900 focus:outline-none focus:border-[#223585]"
                      />
                    ) : (
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {comentariosGerais || 'Sem comentários técnicos registrados.'}
                      </p>
                    )}
                  </div>

                  <div
                    onClick={() => isAdmin && !isEditing && setIsEditing(true)}
                    className={`p-3 rounded-[10px] bg-slate-50 border border-slate-200 ${
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
                        className="w-full p-2 bg-white border border-[#223585]/40 rounded-[8px] text-xs text-slate-900 focus:outline-none focus:border-[#223585]"
                      />
                    ) : (
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {comentariosAcesso || 'Sem restrições ou observações de acesso.'}
                      </p>
                    )}
                  </div>

                  <div
                    onClick={() => isAdmin && !isEditing && setIsEditing(true)}
                    className={`p-3 rounded-[10px] bg-slate-50 border border-slate-200 ${
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
                        className="w-full p-2 bg-white border border-[#223585]/40 rounded-[8px] text-xs text-slate-900 focus:outline-none focus:border-[#223585]"
                      />
                    ) : (
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {obsMotivo || 'Nenhuma observação financeira/motivo pendente.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* ACCORDION 1: Basic Details & Engenharia */}
              <div className="bg-white border border-slate-200 rounded-[12px] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('basic')}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="text-sm font-bold text-slate-900">
                    Basic Details & Pasta Engenharia
                  </span>
                  {openSections.basic ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>
                {openSections.basic && (
                  <div className="px-5 pb-5 pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              <div className="bg-white border border-slate-200 rounded-[12px] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('ndpc')}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="text-sm font-bold text-slate-900">
                    NDPc Configuration & Cronograma de Vistoria (SI)
                  </span>
                  {openSections.ndpc ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>
                {openSections.ndpc && (
                  <div className="px-5 pb-5 pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              <div className="bg-white border border-slate-200 rounded-[12px] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('access')}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#1E8E8D]" />
                    <span>License to Work, Detentora & Controle de Acesso</span>
                  </span>
                  {openSections.access ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>
                {openSections.access && (
                  <div className="px-5 pb-5 pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              <div className="bg-white border border-slate-200 rounded-[12px] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('billing')}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="text-sm font-bold text-slate-900">
                    SAP By Design — SPO, SGR & Faturamento de Notas Fiscais
                  </span>
                  {openSections.billing ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>
                {openSections.billing && (
                  <div className="px-5 pb-5 pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              <div className="bg-white border border-slate-200 rounded-[12px] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('allColumns')}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Table className="w-4 h-4 text-[#223585]" />
                    <span>
                      Todas as {activeOrderedColumns.length} Colunas da Planilha (Coluna A até{' '}
                      {activeOrderedColumns[activeOrderedColumns.length - 1] || 'Observação'})
                    </span>
                  </span>
                  {openSections.allColumns ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>
                {openSections.allColumns && (
                  <div className="px-5 pb-5 pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          {isAdmin ? (
            !confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded-[8px] transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Excluir Site</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-700 font-medium">
                  Confirmar exclusão de {formData.siteId}?
                </span>
                <button
                  type="button"
                  onClick={() => onDeleteSite(formData.id)}
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-[8px] cursor-pointer"
                >
                  Excluir
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs rounded-[8px] cursor-pointer"
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
              className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-[8px] transition-colors cursor-pointer"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={saving}
              className="px-4 py-2 bg-[#223585] hover:bg-[#1B2A6B] disabled:opacity-50 text-white text-xs font-bold rounded-[8px] transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
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
