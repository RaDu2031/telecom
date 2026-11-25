import React, { useEffect, useMemo, useState } from 'react';
import { Check, Edit3, ShieldAlert, X } from 'lucide-react';
import { AmetaUser } from '../../types/telecom';
import {
  SheetEntryConfig,
  extractDynamicFieldOptions,
  normalizeDateValueToBr,
} from '../../config/sheetEntryConfig';

export interface AlterarCampoSubmitPayload {
  fieldKey: string;
  fieldLabel: string;
  rawValue: string;
  executorUser: AmetaUser | null;
  onProgress: (info: { gravados: number; total: number }) => void;
}

interface AlterarCampoModalProps<T extends Record<string, any> = Record<string, any>> {
  isOpen: boolean;
  config: SheetEntryConfig;
  selectedRows: T[];
  existingRows: T[];
  executorUsers: AmetaUser[];
  onClose: () => void;
  onSubmit: (payload: AlterarCampoSubmitPayload) => Promise<void>;
}

export function AlterarCampoModal<T extends Record<string, any> = Record<string, any>>({
  isOpen,
  config,
  selectedRows,
  existingRows,
  executorUsers,
  onClose,
  onSubmit,
}: AlterarCampoModalProps<T>) {
  const bulkEditableFields = useMemo(
    () => config.fields.filter((f) => f.inBulkEdit),
    [config]
  );

  const [selectedFieldKey, setSelectedFieldKey] = useState(
    bulkEditableFields[0]?.key || ''
  );
  const [rawValue, setRawValue] = useState('');
  const [selectedExecutorKey, setSelectedExecutorKey] = useState('');
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ gravados: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedFieldKey(bulkEditableFields[0]?.key || '');
    setRawValue('');
    setSelectedExecutorKey('');
    setStep('select');
    setSubmitting(false);
    setProgress(null);
    setErrorMsg(null);
  }, [isOpen, bulkEditableFields]);

  const activeField = useMemo(
    () => bulkEditableFields.find((f) => f.key === selectedFieldKey) || bulkEditableFields[0],
    [bulkEditableFields, selectedFieldKey]
  );

  const fieldOptions = useMemo(() => {
    if (!activeField) return [];
    if (activeField.fixedOptions && activeField.fixedOptions.length > 0) {
      return [...activeField.fixedOptions];
    }
    if (activeField.useDynamicOptions) {
      return extractDynamicFieldOptions(
        existingRows,
        activeField.key,
        activeField.columnName,
        activeField.defaultOptions || []
      );
    }
    return [...(activeField.defaultOptions || [])];
  }, [activeField, existingRows]);

  const selectedExecutorUser = useMemo(() => {
    if (!selectedExecutorKey) return null;
    return (
      executorUsers.find(
        (u) => (u.email || u.id || u.name).toLowerCase() === selectedExecutorKey.toLowerCase()
      ) || null
    );
  }, [executorUsers, selectedExecutorKey]);

  const displayNewValue = useMemo(() => {
    if (!activeField) return '';
    if (activeField.kind === 'executor') {
      return selectedExecutorUser ? selectedExecutorUser.name : '(Remover executor / limpar)';
    }
    if (activeField.kind === 'date') {
      return rawValue ? normalizeDateValueToBr(rawValue) : '(Limpar data)';
    }
    return rawValue.trim() || '(Limpar valor)';
  }, [activeField, rawValue, selectedExecutorUser]);

  if (!isOpen || !activeField) return null;

  const handleConfirmApply = async () => {
    setErrorMsg(null);
    setSubmitting(true);
    setProgress({ gravados: 0, total: selectedRows.length });
    try {
      await onSubmit({
        fieldKey: activeField.key,
        fieldLabel: activeField.label,
        rawValue:
          activeField.kind === 'executor'
            ? selectedExecutorUser?.name || ''
            : rawValue,
        executorUser: activeField.kind === 'executor' ? selectedExecutorUser : null,
        onProgress: (info) => setProgress(info),
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao aplicar alteração em lote no Firestore.');
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
      aria-labelledby="alterar-campo-modal-title"
    >
      <div
        className="w-full max-w-lg bg-white rounded-[12px] shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-3">
          <div>
            <h2
              id="alterar-campo-modal-title"
              className="text-base font-bold text-slate-900 flex items-center gap-2"
            >
              <Edit3 className="w-4 h-4 text-[#223585]" />
              <span>Alterar campo em lote</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Grava <strong>somente o campo escolhido</strong> em{' '}
              <strong className="font-mono text-slate-800">{selectedRows.length}</strong> linha(s) marcada(s).
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Fechar modal de alterar campo"
            className="p-1.5 rounded-[8px] text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {errorMsg && (
            <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-medium text-rose-700">
              {errorMsg}
            </div>
          )}

          {step === 'select' ? (
            <>
              <div>
                <label
                  htmlFor="bulk-field-select"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
                >
                  Campo a alterar
                </label>
                <select
                  id="bulk-field-select"
                  value={selectedFieldKey}
                  onChange={(e) => {
                    setSelectedFieldKey(e.target.value);
                    setRawValue('');
                    setSelectedExecutorKey('');
                  }}
                  className="w-full px-3 py-2 rounded-[8px] border border-slate-300 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:border-[#223585]"
                >
                  {bulkEditableFields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="bulk-field-value"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1"
                >
                  Novo valor para {activeField.label}
                </label>

                {activeField.kind === 'executor' ? (
                  <select
                    id="bulk-field-value"
                    value={selectedExecutorKey}
                    onChange={(e) => setSelectedExecutorKey(e.target.value)}
                    className="w-full px-3 py-2 rounded-[8px] border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:border-[#223585]"
                  >
                    <option value="">— Sem executor (remover demanda)</option>
                    {executorUsers.map((u) => {
                      const key = (u.email || u.id || u.name).toLowerCase();
                      return (
                        <option key={key} value={key}>
                          {u.name} {u.email ? `(${u.email})` : ''}
                        </option>
                      );
                    })}
                  </select>
                ) : activeField.kind === 'date' ? (
                  <input
                    id="bulk-field-value"
                    type="date"
                    value={rawValue}
                    onChange={(e) => setRawValue(e.target.value)}
                    className="w-full px-3 py-2 rounded-[8px] border border-slate-300 text-xs font-mono text-slate-800 focus:outline-none focus:border-[#223585]"
                  />
                ) : activeField.kind === 'select' ? (
                  <select
                    id="bulk-field-value"
                    value={rawValue}
                    onChange={(e) => setRawValue(e.target.value)}
                    className="w-full px-3 py-2 rounded-[8px] border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:border-[#223585]"
                  >
                    <option value="">Selecione um valor...</option>
                    {fieldOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : activeField.kind === 'combobox' ? (
                  <>
                    <input
                      id="bulk-field-value"
                      type="text"
                      list="bulk-field-datalist"
                      value={rawValue}
                      onChange={(e) => setRawValue(e.target.value)}
                      placeholder={activeField.placeholder || 'Selecione ou digite o novo valor'}
                      className="w-full px-3 py-2 rounded-[8px] border border-slate-300 text-xs text-slate-800 focus:outline-none focus:border-[#223585]"
                    />
                    <datalist id="bulk-field-datalist">
                      {fieldOptions.map((opt) => (
                        <option key={opt} value={opt} />
                      ))}
                    </datalist>
                  </>
                ) : (
                  <textarea
                    id="bulk-field-value"
                    rows={3}
                    value={rawValue}
                    onChange={(e) => setRawValue(e.target.value)}
                    placeholder="Digite o novo texto..."
                    className="w-full px-3 py-2 rounded-[8px] border border-slate-300 text-xs text-slate-800 focus:outline-none focus:border-[#223585]"
                  />
                )}
              </div>
            </>
          ) : (
            <div className="rounded-[10px] border border-amber-200 bg-amber-50/70 p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-950 space-y-1">
                  <p className="font-bold">Confirme a alteração em lote</p>
                  <p>
                    Campo: <strong>{activeField.label}</strong>
                  </p>
                  <p>
                    Novo valor: <strong className="font-mono">{displayNewValue}</strong>
                  </p>
                  <p>
                    Linhas afetadas:{' '}
                    <strong className="font-mono">{selectedRows.length}</strong> registro(s)
                  </p>
                </div>
              </div>

              <div className="rounded-[8px] bg-white/80 border border-amber-200/80 p-2.5 text-[11px] text-slate-700">
                <div className="font-bold text-slate-600 mb-1">Amostra de registros:</div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedRows.slice(0, 6).map((r) => (
                    <span
                      key={r.id}
                      className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px] text-slate-800"
                    >
                      {r.siteName || r.id}
                    </span>
                  ))}
                  {selectedRows.length > 6 && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      +{selectedRows.length - 6} linha(s)
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {progress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-600">
                <span>Gravando lote...</span>
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
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          {step === 'select' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-[8px] border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={activeField.kind === 'select' && !rawValue.trim()}
                onClick={() => setStep('confirm')}
                className="px-4 py-2 rounded-[8px] bg-[#223585] hover:bg-[#1a2968] text-white text-xs font-semibold disabled:opacity-45 cursor-pointer"
              >
                Revisar e confirmar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setStep('select')}
                className="px-3.5 py-2 rounded-[8px] border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmApply}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#1E8E8D] hover:bg-[#177372] text-white text-xs font-semibold disabled:opacity-45 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{submitting ? 'Aplicando...' : 'Confirmar alteração'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
