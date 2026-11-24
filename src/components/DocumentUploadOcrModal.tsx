import React, { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Calendar,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Clock,
  ShieldCheck,
  RefreshCw,
  Edit3,
} from 'lucide-react';
import { MandatoryDocType, UserMandatoryDocument } from '../types/telecom';
import {
  analyzeDocumentValidity,
  ExtractedDateResult,
  evaluateDocStatus,
} from '../utils/documentOcrUtils';

interface DocumentUploadOcrModalProps {
  isOpen: boolean;
  file: File | null;
  docType: MandatoryDocType;
  docLabel: string;
  userName: string;
  durationsConfig?: Record<MandatoryDocType, number>;
  onClose: () => void;
  onConfirm: (data: {
    expiresAt: string;
    fileName: string;
    origin: string;
    fileBase64?: string;
  }) => Promise<void>;
}

export const DocumentUploadOcrModal: React.FC<DocumentUploadOcrModalProps> = ({
  isOpen,
  file,
  docType,
  docLabel,
  userName,
  durationsConfig,
  onClose,
  onConfirm,
}) => {
  const [analyzing, setAnalyzing] = useState<boolean>(true);
  const [extractedResult, setExtractedResult] = useState<ExtractedDateResult | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [manualNote, setManualNote] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [fileBase64, setFileBase64] = useState<string>('');

  useEffect(() => {
    if (!isOpen || !file) return;

    let isMounted = true;
    setAnalyzing(true);
    setErrorMsg(null);
    setExtractedResult(null);
    setSelectedDate('');

    const runAnalysis = async () => {
      try {
        // Read file base64 for metadata
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result && isMounted) {
            setFileBase64(e.target.result as string);
          }
        };
        reader.readAsDataURL(file);

        // Perform text extraction / OCR
        const { result } = await analyzeDocumentValidity(file, docType, durationsConfig);

        if (!isMounted) return;

        if (result && result.suggestedDate) {
          setExtractedResult(result);
          setSelectedDate(result.suggestedDate);
        } else {
          setErrorMsg(
            'Não foi possível encontrar uma data de validade ou emissão automaticamente no documento. Por favor, digite a data de validade abaixo.'
          );
        }
      } catch (err: any) {
        console.error('Error during OCR analysis:', err);
        if (isMounted) {
          setErrorMsg(
            'Não foi possível processar o texto do arquivo automaticamente. Por favor, informe a data manualmente.'
          );
        }
      } finally {
        if (isMounted) {
          setAnalyzing(false);
        }
      }
    };

    runAnalysis();

    return () => {
      isMounted = false;
    };
  }, [isOpen, file, docType, durationsConfig]);

  if (!isOpen || !file) return null;

  const evaluation = selectedDate ? evaluateDocStatus(selectedDate) : null;

  const handleConfirmSave = async () => {
    if (!selectedDate || !selectedDate.trim()) {
      setErrorMsg('Por favor, informe uma data de validade antes de salvar.');
      return;
    }

    setIsSubmitting(true);
    try {
      const originStr = extractedResult
        ? extractedResult.originDescription
        : 'Data inserida manualmente pelo usuário';

      await onConfirm({
        expiresAt: selectedDate,
        fileName: file.name,
        origin: originStr,
        fileBase64,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao gravar os dados do documento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 ameta-modal-backdrop p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-[12px] shadow-2xl border border-slate-200 overflow-hidden flex flex-col ameta-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 text-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[8px] bg-[#223585]/10 border border-[#223585]/20 flex items-center justify-center">
              <FileText className="w-5 h-5 text-[#223585]" />
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2 text-slate-900">
                <span>Leitura Automática de Documento</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-[6px] bg-blue-50 text-blue-700 border border-blue-200">
                  OCR / PDF
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                {docLabel} · {userName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-[8px] hover:bg-slate-200/70 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 bg-white">
          {/* File details */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-[10px] flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 truncate">
              <FileText className="w-4 h-4 text-[#223585] shrink-0" />
              <span className="font-semibold text-slate-900 truncate">{file.name}</span>
              <span className="text-[10px] text-slate-500 font-mono tabular-nums">
                ({(file.size / 1024).toFixed(1)} KB)
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-[6px] bg-white border border-slate-200 text-slate-700 text-[10px] font-bold shrink-0">
              {docType}
            </span>
          </div>

          {/* Analysis loading state */}
          {analyzing && (
            <div className="p-6 bg-blue-50 border border-blue-200 rounded-[10px] flex flex-col items-center justify-center gap-3 text-center">
              <RefreshCw className="w-8 h-8 text-[#223585] animate-spin" />
              <div>
                <p className="text-sm font-bold text-slate-900">
                  Analisando documento no navegador...
                </p>
                <p className="text-xs text-blue-700 mt-0.5">
                  Extraindo texto e realizando reconhecimento OCR para identificar datas de validade e emissão.
                </p>
              </div>
            </div>
          )}

          {/* Analysis Completed */}
          {!analyzing && (
            <div className="space-y-4">
              {extractedResult ? (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-[10px] space-y-2">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                    <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Data Sugerida com Sucesso</span>
                  </div>
                  <div className="text-xs text-emerald-900">
                    <p className="font-semibold">{extractedResult.originDescription}</p>
                    {extractedResult.extractedTextPreview && (
                      <p className="text-[11px] font-mono text-emerald-800 bg-white p-1.5 rounded-[6px] mt-1 border border-emerald-200">
                        Trecho: "{extractedResult.extractedTextPreview}"
                      </p>
                    )}
                  </div>
                </div>
              ) : errorMsg ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-[10px] flex items-start gap-2.5 text-xs text-amber-900">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Aviso de Leitura</p>
                    <p className="text-amber-800 mt-0.5">{errorMsg}</p>
                  </div>
                </div>
              ) : null}

              {/* Date Input with Verification */}
              <div className="space-y-2 p-4 bg-slate-50 border border-slate-200 rounded-[10px]">
                <label className="block text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-[#223585]" />
                    <span>Data de Validade (Vencimento)</span>
                  </span>
                  {extractedResult && (
                    <span className="text-[10px] text-[#1E8E8D] font-normal flex items-center gap-1">
                      <Edit3 className="w-3 h-3" /> Você pode alterar antes de confirmar
                    </span>
                  )}
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-[8px] text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:border-[#223585] focus:ring-2 focus:ring-[#223585]/15"
                />

                {/* Status Indicator */}
                {evaluation && (
                  <div className="pt-2 flex items-center justify-between text-xs border-t border-slate-200">
                    <span className="text-slate-500">Status resultante:</span>
                    <span
                      className={`px-2.5 py-1 rounded-[6px] text-xs font-bold font-mono tabular-nums ${
                        evaluation.status === 'VALIDADO'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : evaluation.status === 'A_VENCER'
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {evaluation.status === 'VALIDADO' && `✓ Válido (${evaluation.daysRemaining} dias)`}
                      {evaluation.status === 'A_VENCER' && `⚠️ Vence em breve (${evaluation.daysRemaining} dias)`}
                      {evaluation.status === 'VENCIDO' && `✕ Vencido (${Math.abs(evaluation.daysRemaining || 0)} dias atrás)`}
                    </span>
                  </div>
                )}
              </div>

              {/* Storage explanation */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-[10px] flex items-start gap-2 text-[11px] text-blue-900">
                <ShieldCheck className="w-4 h-4 text-[#223585] shrink-0 mt-0.5" />
                <p>
                  O arquivo foi processado localmente no seu navegador. Os metadados, o nome do arquivo e a data de validade confirmada serão registrados com segurança no perfil do usuário no Firestore.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-[8px] transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmSave}
            disabled={analyzing || isSubmitting || !selectedDate}
            className="px-5 py-2 bg-[#223585] hover:bg-[#1B2A6B] disabled:opacity-50 text-white font-bold text-xs rounded-[8px] shadow-xs transition-colors cursor-pointer flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Gravando...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Confirmar e Gravar Validade</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
