import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Plus,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import { AmetaUser } from '../../types/telecom';
import {
  SheetEntryConfig,
  extractDynamicFieldOptions,
  findDuplicateRecord,
  findSiteAutofillData,
  formatTodayBr,
  getInitialStatusFromRows,
} from '../../config/sheetEntryConfig';

export interface NovoRegistroPayload {
  siteName: string;
  tipoDoc: string;
  regional: string;
  prioridade: string;
  planejado: string;
  executorUser: AmetaUser | null;
  executorName: string;
  comentarioStatus: string;
  initialStatus: string;
  autofillFixedFields: Record<string, string>;
  idRegister: string;
}

interface NovoRegistroModalProps<T extends Record<string, any> = Record<string, any>> {
  isOpen: boolean;
  config: SheetEntryConfig;
  existingRows: T[];
  executorUsers: AmetaUser[];
  actorName: string;
  onClose: () => void;
  onOpenExisting: (existingRow: T) => void;
  onSubmit: (payload: NovoRegistroPayload) => Promise<void>;
}

export function NovoRegistroModal<T extends Record<string, any> = Record<string, any>>({
  isOpen,
  config,
  existingRows,
  executorUsers,
  actorName,
  onClose,
  onOpenExisting,
  onSubmit,
}: NovoRegistroModalProps<T>) {
  const typeField = useMemo(
    () => config.fields.find((f) => f.key === config.typeFieldKey),
    [config]
  );
  const regionalField = useMemo(
    () => config.fields.find((f) => f.key === 'regional'),
    [config]
  );
  const prioridadeField = useMemo(
    () => config.fields.find((f) => f.key === 'prioridade'),
    [config]
  );

  const tipoDocOptions = useMemo(
    () => [...(typeField?.fixedOptions || [])],
    [typeField]
  );

  const regionalOptions = useMemo(
    () =>
      extractDynamicFieldOptions(
        existingRows,
        'regional',
        regionalField?.columnName || 'Regional',
        regionalField?.defaultOptions || []
      ),
    [existingRows, regionalField]
  );

  const prioridadeOptions = useMemo(
    () =>
      extractDynamicFieldOptions(
        existingRows,
        'prioridade',
        prioridadeField?.columnName || 'Prioridade',
        prioridadeField?.defaultOptions || []
      ),
    [existingRows, prioridadeField]
  );

  const initialStatus = useMemo(
    () => getInitialStatusFromRows(existingRows, config),
    [existingRows, config]
  );

  const [siteName, setSiteName] = useState('');
  const [tipoDoc, setTipoDoc] = useState(tipoDocOptions[0] || '');
  const [regional, setRegional] = useState('');
  const [regionalTouched, setRegionalTouched] = useState(false);
  const [prioridade, setPrioridade] = useState('');
  const [planejado, setPlanejado] = useState('');
  const [selectedExecutorKey, setSelectedExecutorKey] = useState('');
  const [comentarioStatus, setComentarioStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSiteName('');
    setTipoDoc(tipoDocOptions[0] || '');
    setRegional('');
    setRegionalTouched(false);
    setPrioridade('');
    setPlanejado('');
    setSelectedExecutorKey('');
    setComentarioStatus('');
    setErrorMsg(null);
    setSubmitting(false);
  }, [isOpen, tipoDocOptions]);

  // Autofill Regional and fixed fields when typing a Site Name that already exists in the sheet
  const autofillResult = useMemo(
    () => findSiteAutofillData(existingRows, siteName, config),
    [existingRows, siteName, config]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (autofillResult.matchedRow && !regionalTouched && autofillResult.values.regional) {
      setRegional(autofillResult.values.regional);
    }
  }, [isOpen, autofillResult, regionalTouched]);

  // Live duplicate check on (Site Name + Tipo doc)
  const duplicateRow = useMemo(
    () => findDuplicateRecord(existingRows, siteName, tipoDoc, config),
    [existingRows, siteName, tipoDoc, config]
  );

  const selectedExecutorUser = useMemo(() => {
    if (!selectedExecutorKey) return null;
    return (
      executorUsers.find(
        (u) => (u.email || u.id || u.name).toLowerCase() === selectedExecutorKey.toLowerCase()
      ) || null
    );
  }, [executorUsers, selectedExecutorKey]);

  const autofilledFieldsCount = useMemo(
    () => Object.keys(autofillResult.fixedFields || {}).length,
    [autofillResult]
  );

  if (!isOpen) return null;

  const executeCreate = async () => {
    const cleanSite = siteName.trim();
    if (!cleanSite) {
      setErrorMsg('Informe o Site Name (campo obrigatório).');
      return;
    }
    if (!tipoDoc.trim()) {
      setErrorMsg('Selecione o Tipo doc.');
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);
    try {
      await onSubmit({
        siteName: cleanSite,
        tipoDoc: tipoDoc.trim(),
        regional: regional.trim(),
        prioridade: prioridade.trim(),
        planejado,
        executorUser: selectedExecutorUser,
        executorName: selectedExecutorUser?.name || '',
        comentarioStatus: comentarioStatus.trim(),
        initialStatus,
        autofillFixedFields: autofillResult.fixedFields,
        idRegister: autofillResult.values.idRegister || '',
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível criar o registro no Firestore.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (duplicateRow) {
      // Force user to explicitly choose between "Abrir existente" or "Criar mesmo assim"
      return;
    }
    await executeCreate();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="novo-registro-modal-title"
    >
      <div
        className="w-full max-w-xl bg-white rounded-[12px] shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-[#660099]/10 text-[#660099] text-[10px] font-bold uppercase tracking-wider">
                <Sparkles className="w-3 h-3" />
                {config.title}
              </span>
            </div>
            <h2
              id="novo-registro-modal-title"
              className="text-base font-bold text-slate-900 mt-1"
            >
              Novo registro
            </h2>
            <p className="text-xs text-slate-500">
              Criação direta no sistema, sem depender de planilha.
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Fechar modal de novo registro"
            className="p-1.5 rounded-[8px] text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-medium text-rose-700">
              {errorMsg}
            </div>
          )}

          {/* Row 1: Site Name + Tipo doc */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label
                htmlFor="novo-reg-site-name"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                Site Name <span className="text-rose-600">*</span>
              </label>
              <input
                id="novo-reg-site-name"
                type="text"
                required
                autoFocus
                value={siteName}
                onChange={(e) => {
                  setSiteName(e.target.value);
                  setRegionalTouched(false);
                }}
                placeholder="Ex.: SP_CAMPINAS_01"
                className="w-full px-3 py-2 rounded-[8px] border border-slate-300 text-xs font-mono font-semibold text-slate-900 focus:outline-none focus:border-[#660099] focus:ring-2 focus:ring-[#660099]/15"
              />
            </div>

            <div>
              <label
                htmlFor="novo-reg-tipo-doc"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                Tipo doc <span className="text-rose-600">*</span>
              </label>
              <select
                id="novo-reg-tipo-doc"
                required
                value={tipoDoc}
                onChange={(e) => setTipoDoc(e.target.value)}
                className="w-full px-3 py-2 rounded-[8px] border border-slate-300 bg-white text-xs font-medium text-slate-800 focus:outline-none focus:border-[#660099] focus:ring-2 focus:ring-[#660099]/15"
              >
                {tipoDocOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Autofill notice */}
          {autofillResult.matchedRow && (
            <div className="rounded-[8px] bg-blue-50/80 border border-blue-200 px-3 py-2 text-[11px] text-blue-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                Site encontrado na base: autopreenchido{' '}
                <strong>Regional ({autofillResult.values.regional || '—'})</strong>
                {autofilledFieldsCount > 1
                  ? ` e mais ${autofilledFieldsCount - 1} dado(s) fixo(s).`
                  : '.'}
              </span>
            </div>
          )}

          {/* Duplicate warning ("Já existe") */}
          {duplicateRow && (
            <div className="rounded-[10px] bg-amber-50 border border-amber-300 p-3.5 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900">
                  <p className="font-bold">Já existe</p>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Já existe um registro para{' '}
                    <strong className="font-mono">{duplicateRow.siteName || siteName.trim()}</strong>{' '}
                    com Tipo doc <strong>{duplicateRow.tipoDoc || tipoDoc}</strong>
                    {duplicateRow.status ? ` (Status atual: ${duplicateRow.status})` : ''}.
                    Escolha abrir o registro existente ou criar mesmo assim como registro independente.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    onClose();
                    onOpenExisting(duplicateRow);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 text-xs font-semibold cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Abrir existente</span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={executeCreate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#660099] hover:bg-[#52007a] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Criando...' : 'Criar mesmo assim'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Row 2: Regional + Prioridade + Planejado */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label
                htmlFor="novo-reg-regional"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                Regional
              </label>
              <input
                id="novo-reg-regional"
                type="text"
                list="novo-reg-regional-list"
                value={regional}
                onChange={(e) => {
                  setRegional(e.target.value);
                  setRegionalTouched(true);
                }}
                placeholder="Ex.: SP, RJ, MG"
                className="w-full px-3 py-2 rounded-[8px] border border-slate-300 text-xs text-slate-800 focus:outline-none focus:border-[#660099] focus:ring-2 focus:ring-[#660099]/15"
              />
              <datalist id="novo-reg-regional-list">
                {regionalOptions.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
            </div>

            <div>
              <label
                htmlFor="novo-reg-prioridade"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                Prioridade
              </label>
              <select
                id="novo-reg-prioridade"
                value={prioridade}
                onChange={(e) => setPrioridade(e.target.value)}
                className="w-full px-3 py-2 rounded-[8px] border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:border-[#660099] focus:ring-2 focus:ring-[#660099]/15"
              >
                <option value="">Sem prioridade</option>
                {prioridadeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="novo-reg-planejado"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                Planejado
              </label>
              <input
                id="novo-reg-planejado"
                type="date"
                value={planejado}
                onChange={(e) => setPlanejado(e.target.value)}
                className="w-full px-3 py-2 rounded-[8px] border border-slate-300 text-xs font-mono text-slate-800 focus:outline-none focus:border-[#660099] focus:ring-2 focus:ring-[#660099]/15"
              />
            </div>
          </div>

          {/* Row 3: Executor (optional list of Executor users) */}
          <div>
            <label
              htmlFor="novo-reg-executor"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
            >
              Executor <span className="font-normal text-slate-400 normal-case">(opcional)</span>
            </label>
            <select
              id="novo-reg-executor"
              value={selectedExecutorKey}
              onChange={(e) => setSelectedExecutorKey(e.target.value)}
              className="w-full px-3 py-2 rounded-[8px] border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:border-[#660099] focus:ring-2 focus:ring-[#660099]/15"
            >
              <option value="">Sem executor no momento</option>
              {executorUsers.map((u) => {
                const key = (u.email || u.id || u.name).toLowerCase();
                return (
                  <option key={key} value={key}>
                    {u.name} {u.email ? `(${u.email})` : ''}
                  </option>
                );
              })}
            </select>
            {selectedExecutorUser && (
              <p className="mt-1.5 text-[11px] text-[#1E8E8D] font-medium flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Ao criar, a demanda e o acionamento serão enviados automaticamente para{' '}
                  <strong>{selectedExecutorUser.name}</strong>.
                </span>
              </p>
            )}
          </div>

          {/* Row 4: Comentário */}
          <div>
            <label
              htmlFor="novo-reg-comentario"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
            >
              Comentário
            </label>
            <textarea
              id="novo-reg-comentario"
              rows={3}
              value={comentarioStatus}
              onChange={(e) => setComentarioStatus(e.target.value)}
              placeholder="Detalhes ou observação inicial para o acompanhamento..."
              className="w-full px-3 py-2 rounded-[8px] border border-slate-300 text-xs text-slate-800 focus:outline-none focus:border-[#660099] focus:ring-2 focus:ring-[#660099]/15"
            />
          </div>

          {/* Automatic Metadata Strip */}
          <div className="rounded-[8px] bg-slate-50 border border-slate-200 px-3.5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
            <span>
              Status inicial: <strong className="text-slate-900">{initialStatus}</strong>
            </span>
            <span>
              Demanda: <strong className="font-mono text-slate-900">{formatTodayBr()}</strong>
            </span>
            <span>
              Criado por: <strong className="text-slate-900">{actorName}</strong>
            </span>
          </div>

          {/* Footer Buttons */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="px-3.5 py-2 rounded-[8px] border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Cancelar
            </button>
            {!duplicateRow && (
              <button
                type="submit"
                disabled={submitting || !siteName.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#660099] hover:bg-[#52007a] text-white text-xs font-semibold shadow-2xs disabled:opacity-45 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{submitting ? 'Salvando...' : 'Criar registro'}</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
