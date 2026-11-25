import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Layers,
  ListPlus,
  UserCheck,
  X,
} from 'lucide-react';
import { AmetaUser } from '../../types/telecom';
import {
  EntradaRapidaParsedLine,
  SheetEntryConfig,
  extractDynamicFieldOptions,
  getInitialStatusFromRows,
  parseEntradaRapidaLines,
} from '../../config/sheetEntryConfig';

export interface EntradaRapidaSubmitPayload {
  items: EntradaRapidaParsedLine[];
  prioridade: string;
  planejado: string;
  executorUser: AmetaUser | null;
  initialStatus: string;
  onProgress: (info: { gravados: number; total: number }) => void;
}

interface EntradaRapidaModalProps<T extends Record<string, any> = Record<string, any>> {
  isOpen: boolean;
  config: SheetEntryConfig;
  existingRows: T[];
  executorUsers: AmetaUser[];
  onClose: () => void;
  onSubmit: (payload: EntradaRapidaSubmitPayload) => Promise<void>;
}

export function EntradaRapidaModal<T extends Record<string, any> = Record<string, any>>({
  isOpen,
  config,
  existingRows,
  executorUsers,
  onClose,
  onSubmit,
}: EntradaRapidaModalProps<T>) {
  const typeField = useMemo(
    () => config.fields.find((f) => f.key === config.typeFieldKey),
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

  const [rawText, setRawText] = useState('');
  const [sharedTipoDoc, setSharedTipoDoc] = useState(tipoDocOptions[0] || '');
  const [prioridade, setPrioridade] = useState('');
  const [planejado, setPlanejado] = useState('');
  const [selectedExecutorKey, setSelectedExecutorKey] = useState('');
  const [includeDuplicates, setIncludeDuplicates] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ gravados: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setRawText('');
    setSharedTipoDoc(tipoDocOptions[0] || '');
    setPrioridade('');
    setPlanejado('');
    setSelectedExecutorKey('');
    setIncludeDuplicates(true);
    setSubmitting(false);
    setProgress(null);
    setErrorMsg(null);
  }, [isOpen, tipoDocOptions]);

  const parsed = useMemo(
    () => parseEntradaRapidaLines(rawText, sharedTipoDoc, existingRows, config),
    [rawText, sharedTipoDoc, existingRows, config]
  );

  const selectedExecutorUser = useMemo(() => {
    if (!selectedExecutorKey) return null;
    return (
      executorUsers.find(
        (u) => (u.email || u.id || u.name).toLowerCase() === selectedExecutorKey.toLowerCase()
      ) || null
    );
  }, [executorUsers, selectedExecutorKey]);

  const itemsToCreate = useMemo(() => {
    return parsed.items.filter((item) => {
      if (item.status === 'erro') return false;
      if (item.status === 'repetido' && !includeDuplicates) return false;
      return true;
    });
  }, [parsed.items, includeDuplicates]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (itemsToCreate.length === 0) {
      setErrorMsg('Nenhuma linha válida para criar.');
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);
    setProgress({ gravados: 0, total: itemsToCreate.length });
    try {
      await onSubmit({
        items: itemsToCreate,
        prioridade: prioridade.trim(),
        planejado,
        executorUser: selectedExecutorUser,
        initialStatus,
        onProgress: (info) => setProgress(info),
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao criar registros em lote no Firestore.');
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="entrada-rapida-modal-title"
    >
      <div
        className="w-full max-w-3xl bg-white rounded-[12px] shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-[#223585]/10 text-[#223585] text-[10px] font-bold uppercase tracking-wider">
                <Layers className="w-3 h-3" />
                {config.title} · Lotes de {config.batchSize}
              </span>
            </div>
            <h2
              id="entrada-rapida-modal-title"
              className="text-base font-bold text-slate-900 mt-1"
            >
              Adicionar vários registros
            </h2>
            <p className="text-xs text-slate-500">
              Cole ou digite um Site Name por linha (ou <span className="font-mono font-semibold text-slate-700">SITE;TIPO</span>). Campos únicos valem para todas as linhas.
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Fechar modal de entrada rápida"
            className="p-1.5 rounded-[8px] text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-medium text-rose-700">
              {errorMsg}
            </div>
          )}

          {/* Shared Fields Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label
                htmlFor="er-tipo-doc"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                Tipo doc padrão
              </label>
              <select
                id="er-tipo-doc"
                value={sharedTipoDoc}
                onChange={(e) => setSharedTipoDoc(e.target.value)}
                className="w-full px-2.5 py-2 rounded-[8px] border border-slate-300 bg-white text-xs font-medium text-slate-800 focus:outline-none focus:border-[#223585]"
              >
                {tipoDocOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="er-prioridade"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                Prioridade
              </label>
              <select
                id="er-prioridade"
                value={prioridade}
                onChange={(e) => setPrioridade(e.target.value)}
                className="w-full px-2.5 py-2 rounded-[8px] border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:border-[#223585]"
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
                htmlFor="er-planejado"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                Planejado
              </label>
              <input
                id="er-planejado"
                type="date"
                value={planejado}
                onChange={(e) => setPlanejado(e.target.value)}
                className="w-full px-2.5 py-2 rounded-[8px] border border-slate-300 text-xs font-mono text-slate-800 focus:outline-none focus:border-[#223585]"
              />
            </div>

            <div>
              <label
                htmlFor="er-executor"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                Executor (opcional)
              </label>
              <select
                id="er-executor"
                value={selectedExecutorKey}
                onChange={(e) => setSelectedExecutorKey(e.target.value)}
                className="w-full px-2.5 py-2 rounded-[8px] border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:border-[#223585]"
              >
                <option value="">Sem executor</option>
                {executorUsers.map((u) => {
                  const key = (u.email || u.id || u.name).toLowerCase();
                  return (
                    <option key={key} value={key}>
                      {u.name}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {selectedExecutorUser && (
            <div className="rounded-[8px] bg-teal-50 border border-teal-200 px-3.5 py-2 text-xs text-teal-800 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[#1E8E8D] shrink-0" />
              <span>
                Executor escolhido: <strong>{selectedExecutorUser.name}</strong>
                {selectedExecutorUser.email ? ` (${selectedExecutorUser.email})` : ''}. As demandas e acionamentos serão criados automaticamente no padrão de <strong>Demandar executor</strong>.
              </span>
            </div>
          )}

          {/* Textarea */}
          <div>
            <label
              htmlFor="er-textarea"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
            >
              Lista de Site Names (um por linha ou SITE;TIPO)
            </label>
            <textarea
              id="er-textarea"
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`SP_CAMPINAS_01\nRJ_BARRA_02;PPI Vivo\nMG_BHZ_03;War Room`}
              className="w-full px-3 py-2.5 rounded-[8px] border border-slate-300 font-mono text-xs text-slate-800 focus:outline-none focus:border-[#223585] focus:ring-2 focus:ring-[#223585]/15"
            />
          </div>

          {/* Live Preview Counters */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-[8px] border border-emerald-200 bg-emerald-50/70 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Novos</span>
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-emerald-800 mt-0.5">
                {parsed.novosCount}
              </div>
            </div>

            <div className="rounded-[8px] border border-amber-200 bg-amber-50/70 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Repetidos</span>
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-amber-800 mt-0.5">
                {parsed.repetidosCount}
              </div>
            </div>

            <div className="rounded-[8px] border border-rose-200 bg-rose-50/70 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-rose-700">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Com erro</span>
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-rose-800 mt-0.5">
                {parsed.errosCount}
              </div>
            </div>
          </div>

          {parsed.repetidosCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeDuplicates}
                onChange={(e) => setIncludeDuplicates(e.target.checked)}
                className="rounded border-slate-300 text-[#223585] focus:ring-[#223585]"
              />
              <span>
                Incluir os <strong>{parsed.repetidosCount}</strong> repetido(s) como registros independentes (ID único)
              </span>
            </label>
          )}

          {/* Detailed Preview List */}
          {parsed.items.length > 0 && (
            <div className="rounded-[8px] border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <span>Prévia ({parsed.items.length} linha(s) lida(s))</span>
                <span className="font-mono text-slate-500">
                  Status inicial: {initialStatus}
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 text-xs">
                {parsed.items.slice(0, 100).map((item) => (
                  <div
                    key={`${item.lineNumber}_${item.rawLine}`}
                    className="px-3 py-1.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-400 w-6 shrink-0">
                        L{item.lineNumber}
                      </span>
                      <span className="font-mono font-semibold text-slate-800 truncate">
                        {item.siteName || '—'}
                      </span>
                      <span className="text-[11px] text-slate-500 truncate">
                        · {item.tipoDoc || 'Sem tipo'}
                      </span>
                      {item.regionalAutofill && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
                          Reg: {item.regionalAutofill}
                        </span>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      {item.status === 'novo' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                          Novo
                        </span>
                      )}
                      {item.status === 'repetido' && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold"
                          title={item.reason}
                        >
                          Repetido
                        </span>
                      )}
                      {item.status === 'erro' && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold"
                          title={item.reason}
                        >
                          Erro: {item.reason}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {parsed.items.length > 100 && (
                  <div className="px-3 py-2 text-[11px] text-slate-500 text-center bg-slate-50">
                    + {parsed.items.length - 100} linha(s) adicionais prontas na fila.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Batch Progress Bar */}
          {progress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-600">
                <span>Gravando em lotes de {config.batchSize}...</span>
                <span>
                  {progress.gravados} / {progress.total}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-[#1E8E8D] transition-all"
                  style={{
                    width: `${Math.round(
                      (progress.gravados / Math.max(1, progress.total)) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            Linhas com erro são ignoradas automaticamente.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="px-3.5 py-2 rounded-[8px] border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={submitting || itemsToCreate.length === 0}
              onClick={handleConfirm}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#223585] hover:bg-[#1a2968] text-white text-xs font-semibold shadow-2xs disabled:opacity-45 cursor-pointer"
            >
              <ListPlus className="w-3.5 h-3.5" />
              <span>
                {submitting
                  ? 'Criando...'
                  : `Criar ${itemsToCreate.length} registro${itemsToCreate.length === 1 ? '' : 's'}`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
