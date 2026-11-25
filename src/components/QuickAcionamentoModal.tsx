import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Layers,
  Plus,
  Zap,
  X,
} from 'lucide-react';
import {
  ACIONAMENTO_TARGET_CONFIGS,
  AcionamentoTarget,
  QuickAcionamentoDraft,
  expandBatchToDrafts,
  getTodayIsoDate,
  parseQuickBatchLines,
} from '../utils/quickAcionamentoUtils';

export interface QuickAcionamentoModalProps {
  isOpen: boolean;
  target: AcionamentoTarget;
  /** Optional subtitle override (e.g. active TSSR tab name) */
  subtitle?: string;
  /** Autocomplete suggestions for teams/executors from the active spreadsheet */
  suggestedExecutors?: string[];
  /** Autocomplete suggestions for regionals/UFs */
  suggestedRegionals?: string[];
  onClose: () => void;
  /** Called with 1 or N normalized drafts to save into the active spreadsheet */
  onSubmitDrafts: (drafts: QuickAcionamentoDraft[]) => Promise<void>;
}

type ModalMode = 'single' | 'batch';

export const QuickAcionamentoModal: React.FC<QuickAcionamentoModalProps> = ({
  isOpen,
  target,
  subtitle,
  suggestedExecutors = [],
  suggestedRegionals = [],
  onClose,
  onSubmitDrafts,
}) => {
  const config = ACIONAMENTO_TARGET_CONFIGS[target];

  const [mode, setMode] = useState<ModalMode>('single');
  const [showMoreFields, setShowMoreFields] = useState(false);

  // Single mode fields
  const [siteId, setSiteId] = useState('');
  const [siteIdB, setSiteIdB] = useState('');
  const [dataAcionamento, setDataAcionamento] = useState(() => getTodayIsoDate());
  const [planejado, setPlanejado] = useState('');
  const [status, setStatus] = useState(config.defaultStatus);
  const [tipoDoc, setTipoDoc] = useState(config.defaultTipoDoc);
  const [uf, setUf] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [regional, setRegional] = useState('');
  const [executorOrEquipe, setExecutorOrEquipe] = useState('');
  const [projetoOrServico, setProjetoOrServico] = useState('');
  const [prioridade, setPrioridade] = useState('');
  const [ocOrChaves, setOcOrChaves] = useState('');
  const [extraSiteName, setExtraSiteName] = useState('');
  const [idDetentora, setIdDetentora] = useState('');
  const [observacoes, setObservacoes] = useState('');

  // Batch mode text
  const [batchText, setBatchText] = useState('');

  // UI feedback
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addedCountSession, setAddedCountSession] = useState(0);
  const [lastAddedLabel, setLastAddedLabel] = useState<string | null>(null);

  const siteInputRef = useRef<HTMLInputElement>(null);
  const batchTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset form cleanly whenever modal opens or target changes
  useEffect(() => {
    if (!isOpen) return;
    setMode('single');
    setShowMoreFields(false);
    setSiteId('');
    setSiteIdB('');
    setDataAcionamento(getTodayIsoDate());
    setPlanejado('');
    setStatus(config.defaultStatus);
    setTipoDoc(config.defaultTipoDoc);
    setUf('');
    setMunicipio('');
    setRegional('');
    setExecutorOrEquipe('');
    setProjetoOrServico('');
    setPrioridade('');
    setOcOrChaves('');
    setExtraSiteName('');
    setIdDetentora('');
    setObservacoes('');
    setBatchText('');
    setErrorMsg(null);
    setAddedCountSession(0);
    setLastAddedLabel(null);

    const timer = window.setTimeout(() => {
      siteInputRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [isOpen, target, config.defaultStatus, config.defaultTipoDoc]);

  // Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, submitting, onClose]);

  const parsedBatchItems = useMemo(() => parseQuickBatchLines(batchText), [batchText]);

  const uniqueExecutors = useMemo(() => {
    const set = new Set<string>();
    for (const raw of suggestedExecutors) {
      const clean = (raw || '').trim();
      if (clean && clean !== '-' && clean.toLowerCase() !== 'sem equipe' && clean.toLowerCase() !== 'sem executor') {
        set.add(clean);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, 60);
  }, [suggestedExecutors]);

  const uniqueRegionals = useMemo(() => {
    const set = new Set<string>();
    for (const raw of suggestedRegionals) {
      const clean = (raw || '').trim();
      if (clean && clean !== '-') set.add(clean);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, 30);
  }, [suggestedRegionals]);

  if (!isOpen) return null;

  const isEquipeTarget =
    target === 'NOKIA_SITES' || target === 'CLARO_SITES' || target === 'ERICSSON_SITES';
  const isDocTarget = target === 'ERICSSON_VIVO' || target === 'ERICSSON_ENGENHARIA';

  const buildCurrentDraft = (): QuickAcionamentoDraft => ({
    siteId: siteId.trim().toUpperCase(),
    siteIdB: siteIdB.trim().toUpperCase(),
    siteName: extraSiteName.trim(),
    uf: uf.trim().toUpperCase(),
    municipio: municipio.trim(),
    regional: (regional || uf).trim().toUpperCase(),
    tipoDoc: config.hasTipoDoc ? tipoDoc : '',
    projeto: projetoOrServico.trim(),
    servico: projetoOrServico.trim(),
    status: status || config.defaultStatus,
    executor: isEquipeTarget ? '' : executorOrEquipe.trim(),
    equipe: isEquipeTarget ? executorOrEquipe.trim() : '',
    dataAcionamento,
    planejado,
    prioridade: prioridade.trim(),
    ocSitePre: target === 'ERICSSON_SITES' ? '' : ocOrChaves.trim(),
    chaves: target === 'ERICSSON_SITES' ? ocOrChaves.trim() : '',
    idDetentora: idDetentora.trim(),
    observacoes: observacoes.trim(),
  });

  const handleSaveSingle = async (keepOpen: boolean) => {
    setErrorMsg(null);
    const cleanMain = siteId.trim();
    const cleanB = siteIdB.trim();
    if (!cleanMain && !(config.hasSiteB && cleanB)) {
      setErrorMsg(`Informe o campo "${config.siteLabel}" para adicionar o acionamento.`);
      siteInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const draft = buildCurrentDraft();
      await onSubmitDrafts([draft]);

      if (keepOpen) {
        const label = draft.siteIdB ? `${draft.siteId} / ${draft.siteIdB}` : draft.siteId;
        setAddedCountSession((prev) => prev + 1);
        setLastAddedLabel(label);
        setSiteId('');
        setSiteIdB('');
        setExtraSiteName('');
        setOcOrChaves('');
        setIdDetentora('');
        setObservacoes('');
        window.setTimeout(() => siteInputRef.current?.focus(), 40);
      } else {
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível salvar o acionamento.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (parsedBatchItems.length === 0) {
      setErrorMsg('Cole ao menos 1 Site ID na caixa de texto para adicionar em lote.');
      batchTextareaRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const drafts = expandBatchToDrafts(parsedBatchItems, target, {
        uf: uf.trim().toUpperCase(),
        municipio: municipio.trim(),
        regional: (regional || uf).trim().toUpperCase(),
        tipoDoc: config.hasTipoDoc ? tipoDoc : '',
        projeto: projetoOrServico.trim(),
        servico: projetoOrServico.trim(),
        status: status || config.defaultStatus,
        executor: isEquipeTarget ? '' : executorOrEquipe.trim(),
        equipe: isEquipeTarget ? executorOrEquipe.trim() : '',
        dataAcionamento,
        planejado,
        prioridade: prioridade.trim(),
        observacoes: observacoes.trim(),
      });

      await onSubmitDrafts(drafts);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível adicionar os acionamentos em lote.');
    } finally {
      setSubmitting(false);
    }
  };

  const datalistExecId = `quick-ac-exec-${target}`;
  const datalistRegId = `quick-ac-reg-${target}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1530]/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-acionamento-title"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white border border-slate-200 rounded-[12px] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-xs font-semibold truncate"
              style={{ color: config.accentColor }}
            >
              {config.destinationBadge}
              {subtitle ? ` · ${subtitle}` : ''}
            </div>
            <h2
              id="quick-acionamento-title"
              className="text-base font-bold text-slate-900 mt-0.5 tracking-tight"
            >
              {config.title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Fechar modal de novo acionamento"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 rounded-[8px] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher: 1 Acionamento vs Vários de uma vez */}
        <div className="px-5 pt-3.5 pb-2 bg-white border-b border-slate-100 flex items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Modo de cadastro de acionamento"
            className="inline-flex items-center p-1 bg-slate-100 border border-slate-200 rounded-[8px] gap-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'single'}
              onClick={() => {
                setMode('single');
                setErrorMsg(null);
                window.setTimeout(() => siteInputRef.current?.focus(), 40);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-[6px] transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                mode === 'single'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-[#1E8E8D]" />
              <span>1 Acionamento</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'batch'}
              onClick={() => {
                setMode('batch');
                setErrorMsg(null);
                window.setTimeout(() => batchTextareaRef.current?.focus(), 40);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-[6px] transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                mode === 'batch'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-[#223585]" />
              <span>Vários de uma vez</span>
            </button>
          </div>

          <span className="text-[11px] text-slate-500 hidden sm:inline whitespace-nowrap">
            Apenas acrescenta — nunca apaga
          </span>
        </div>

        {/* Shared Datalists */}
        <datalist id={datalistExecId}>
          {uniqueExecutors.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <datalist id={datalistRegId}>
          {uniqueRegionals.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>

        {/* Form Body */}
        {mode === 'single' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveSingle(false);
            }}
            className="flex-1 overflow-y-auto p-5 space-y-4 text-xs"
          >
            {lastAddedLabel && (
              <div className="px-3.5 py-2.5 rounded-[8px] bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="truncate">
                    <strong className="font-mono">{lastAddedLabel}</strong> adicionado na planilha!
                    Pronto para o próximo.
                  </span>
                </div>
                <span className="font-mono tabular-nums font-bold text-emerald-700 shrink-0">
                  +{addedCountSession}
                </span>
              </div>
            )}

            {errorMsg && (
              <div className="px-3.5 py-2.5 rounded-[8px] bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Row 1: Primary Site ID (+ Site B when Ericsson) */}
            <div className={config.hasSiteB ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'grid grid-cols-1 sm:grid-cols-12 gap-3'}>
              <div className={config.hasSiteB ? '' : 'sm:col-span-7'}>
                <label
                  htmlFor="qa-site-id"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  {config.siteLabel} <span className="text-rose-600">*</span>
                </label>
                <input
                  id="qa-site-id"
                  ref={siteInputRef}
                  type="text"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value.toUpperCase())}
                  placeholder={config.sitePlaceholder}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-[8px] text-sm font-mono font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-[#223585] focus:ring-2 focus:ring-[#223585]/15"
                />
              </div>

              {config.hasSiteB ? (
                <div>
                  <label
                    htmlFor="qa-site-id-b"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Site ID B <span className="text-slate-400 font-normal">(opcional / par)</span>
                  </label>
                  <input
                    id="qa-site-id-b"
                    type="text"
                    value={siteIdB}
                    onChange={(e) => setSiteIdB(e.target.value.toUpperCase())}
                    placeholder="Ex: ESCIT81"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-[8px] text-sm font-mono font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-[#1E8E8D] focus:ring-2 focus:ring-[#1E8E8D]/15"
                  />
                </div>
              ) : (
                <div className="sm:col-span-5">
                  <label
                    htmlFor="qa-data-acionamento"
                    className="block font-semibold text-slate-700 mb-1 flex items-center gap-1"
                  >
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>{isDocTarget ? 'Data Demanda' : 'Data Acionamento'}</span>
                  </label>
                  <input
                    id="qa-data-acionamento"
                    type="date"
                    value={dataAcionamento}
                    onChange={(e) => setDataAcionamento(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-[8px] text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:border-[#223585] focus:ring-2 focus:ring-[#223585]/15"
                  />
                </div>
              )}
            </div>

            {/* Row 2: Tipo Doc (when applicable) + Status + Data (if Site B took row 1) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {config.hasTipoDoc ? (
                <div>
                  <label
                    htmlFor="qa-tipo-doc"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Tipo de Documento / Atividade
                  </label>
                  <select
                    id="qa-tipo-doc"
                    value={tipoDoc}
                    onChange={(e) => setTipoDoc(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-[8px] text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#223585] focus:ring-2 focus:ring-[#223585]/15"
                  >
                    {config.tipoDocOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              ) : config.hasSiteB ? (
                <div>
                  <label
                    htmlFor="qa-data-acionamento-b"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Data Acionamento
                  </label>
                  <input
                    id="qa-data-acionamento-b"
                    type="date"
                    value={dataAcionamento}
                    onChange={(e) => setDataAcionamento(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-[8px] text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:border-[#223585]"
                  />
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="qa-projeto"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Projeto / Escopo
                  </label>
                  <input
                    id="qa-projeto"
                    type="text"
                    value={projetoOrServico}
                    onChange={(e) => setProjetoOrServico(e.target.value)}
                    placeholder="Ex: Swap - G3, 5G, Expansão..."
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-[8px] text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#223585]"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="qa-status"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  Status Inicial
                </label>
                <select
                  id="qa-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-[8px] text-xs font-medium text-slate-900 focus:outline-none focus:border-[#223585] focus:ring-2 focus:ring-[#223585]/15"
                >
                  {config.statusOptions.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 3: Regional/UF + Município + Equipe/Executor */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className={isDocTarget ? 'sm:col-span-5' : 'sm:col-span-3'}>
                <label
                  htmlFor="qa-uf-reg"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  {isDocTarget ? 'Regional' : 'UF'}
                </label>
                <input
                  id="qa-uf-reg"
                  type="text"
                  list={datalistRegId}
                  maxLength={isDocTarget ? 12 : 2}
                  value={isDocTarget ? regional : uf}
                  onChange={(e) =>
                    isDocTarget
                      ? setRegional(e.target.value.toUpperCase())
                      : setUf(e.target.value.toUpperCase())
                  }
                  placeholder={isDocTarget ? 'Ex: SP, MG, RJ, SPM' : 'SP'}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-[8px] text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#223585]"
                />
              </div>

              {!isDocTarget && (
                <div className="sm:col-span-4">
                  <label
                    htmlFor="qa-municipio"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Município / Cidade
                  </label>
                  <input
                    id="qa-municipio"
                    type="text"
                    value={municipio}
                    onChange={(e) => setMunicipio(e.target.value)}
                    placeholder="Ex: São Paulo"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-[8px] text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#223585]"
                  />
                </div>
              )}

              <div className={isDocTarget ? 'sm:col-span-7' : 'sm:col-span-5'}>
                <label
                  htmlFor="qa-executor"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  {isEquipeTarget ? 'Equipe / Dupla' : 'Executor / Responsável'}
                </label>
                <input
                  id="qa-executor"
                  type="text"
                  list={datalistExecId}
                  value={executorOrEquipe}
                  onChange={(e) => setExecutorOrEquipe(e.target.value)}
                  placeholder={
                    isEquipeTarget ? 'Ex: Magno/Luchini (opcional)' : 'Ex: Rafael (opcional)'
                  }
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-[8px] text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#223585]"
                />
              </div>
            </div>

            {/* Collapsible Optional Fields */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowMoreFields((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#223585] hover:text-[#172560] cursor-pointer"
              >
                {showMoreFields ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span>
                  {showMoreFields
                    ? 'Ocultar detalhes opcionais'
                    : 'Mais detalhes opcionais (Prioridade, Observações...)'}
                </span>
              </button>

              {showMoreFields && (
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {target === 'ERICSSON_ENGENHARIA' && (
                    <div>
                      <label htmlFor="qa-data-eng" className="block font-semibold text-slate-700 mb-1">
                        Data Demanda
                      </label>
                      <input
                        id="qa-data-eng"
                        type="date"
                        value={dataAcionamento}
                        onChange={(e) => setDataAcionamento(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs font-mono tabular-nums"
                      />
                    </div>
                  )}

                  {isDocTarget && (
                    <div>
                      <label htmlFor="qa-planejado" className="block font-semibold text-slate-700 mb-1">
                        Data Planejada
                      </label>
                      <input
                        id="qa-planejado"
                        type="date"
                        value={planejado}
                        onChange={(e) => setPlanejado(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs font-mono tabular-nums"
                      />
                    </div>
                  )}

                  {!isDocTarget && (
                    <div>
                      <label htmlFor="qa-oc" className="block font-semibold text-slate-700 mb-1">
                        {target === 'ERICSSON_SITES' ? '01.00. Chaves' : 'Oc Site Pre'}
                      </label>
                      <input
                        id="qa-oc"
                        type="text"
                        value={ocOrChaves}
                        onChange={(e) => setOcOrChaves(e.target.value)}
                        placeholder={target === 'ERICSSON_SITES' ? 'Ex: RRJ-5997238' : 'Ex: 1450211'}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs font-mono"
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor="qa-extra-id" className="block font-semibold text-slate-700 mb-1">
                      {target === 'ERICSSON_VIVO'
                        ? 'ID Register'
                        : target === 'ERICSSON_SITES'
                        ? 'Serviço'
                        : 'END ID / Nome Estação'}
                    </label>
                    <input
                      id="qa-extra-id"
                      type="text"
                      value={target === 'ERICSSON_SITES' ? projetoOrServico : extraSiteName}
                      onChange={(e) =>
                        target === 'ERICSSON_SITES'
                          ? setProjetoOrServico(e.target.value)
                          : setExtraSiteName(e.target.value)
                      }
                      placeholder={
                        target === 'ERICSSON_VIVO'
                          ? 'Ex: REG-2026-01'
                          : target === 'ERICSSON_SITES'
                          ? 'Ex: LOS A / Vistoria B'
                          : 'Ex: SP_CENTRO_01'
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs"
                    />
                  </div>

                  {!isDocTarget && (
                    <div>
                      <label htmlFor="qa-detentora" className="block font-semibold text-slate-700 mb-1">
                        ID Detentora
                      </label>
                      <input
                        id="qa-detentora"
                        type="text"
                        value={idDetentora}
                        onChange={(e) => setIdDetentora(e.target.value)}
                        placeholder="Opcional"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs"
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor="qa-prioridade" className="block font-semibold text-slate-700 mb-1">
                      Prioridade
                    </label>
                    <input
                      id="qa-prioridade"
                      type="text"
                      value={prioridade}
                      onChange={(e) => setPrioridade(e.target.value)}
                      placeholder="Ex: P1, Alta, Normal"
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor="qa-obs" className="block font-semibold text-slate-700 mb-1">
                      Observações / Comentário
                    </label>
                    <input
                      id="qa-obs"
                      type="text"
                      value={observacoes}
                      onChange={(e) => setObservacoes(e.target.value)}
                      placeholder="Informações adicionais do acionamento..."
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-[8px] transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveSingle(true)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-[8px] transition-colors cursor-pointer disabled:opacity-50"
                >
                  Salvar e Adicionar Outro
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ backgroundColor: config.accentColor }}
                  className="px-4 py-2 hover:opacity-95 disabled:opacity-50 text-white text-xs font-bold rounded-[8px] transition-opacity flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>{submitting ? 'Salvando...' : 'Adicionar Acionamento'}</span>
                </button>
              </div>
            </div>
          </form>
        ) : (
          /* BATCH MODE: Paste multiple Site IDs or Excel lines */
          <form
            onSubmit={handleSaveBatch}
            className="flex-1 overflow-y-auto p-5 space-y-4 text-xs"
          >
            {errorMsg && (
              <div className="px-3.5 py-2.5 rounded-[8px] bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label htmlFor="qa-batch-input" className="font-semibold text-slate-800">
                  Lista de Acionamentos (1 por linha)
                </label>
                <span className="font-mono tabular-nums font-bold text-[#223585]">
                  {parsedBatchItems.length}{' '}
                  {parsedBatchItems.length === 1 ? 'acionamento' : 'acionamentos'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mb-2">{config.batchHint}</p>
              <textarea
                id="qa-batch-input"
                ref={batchTextareaRef}
                rows={5}
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder={config.batchPlaceholder}
                className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-[8px] text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#223585] focus:ring-2 focus:ring-[#223585]/15"
              />
            </div>

            {/* Shared Defaults applied to all lines in batch */}
            <div className="p-3.5 rounded-[10px] bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                Padrão aplicado às linhas sem preenchimento
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label htmlFor="qa-batch-date" className="block font-semibold text-slate-700 mb-1">
                    {isDocTarget ? 'Data Demanda' : 'Data Acionamento'}
                  </label>
                  <input
                    id="qa-batch-date"
                    type="date"
                    value={dataAcionamento}
                    onChange={(e) => setDataAcionamento(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs font-mono tabular-nums"
                  />
                </div>

                {config.hasTipoDoc ? (
                  <div>
                    <label htmlFor="qa-batch-doc" className="block font-semibold text-slate-700 mb-1">
                      Tipo Doc
                    </label>
                    <select
                      id="qa-batch-doc"
                      value={tipoDoc}
                      onChange={(e) => setTipoDoc(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs font-semibold"
                    >
                      {config.tipoDocOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label htmlFor="qa-batch-uf" className="block font-semibold text-slate-700 mb-1">
                      UF / Regional
                    </label>
                    <input
                      id="qa-batch-uf"
                      type="text"
                      list={datalistRegId}
                      value={uf}
                      onChange={(e) => setUf(e.target.value.toUpperCase())}
                      placeholder="Ex: SP"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs font-mono"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="qa-batch-status" className="block font-semibold text-slate-700 mb-1">
                    Status
                  </label>
                  <select
                    id="qa-batch-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs"
                  >
                    {config.statusOptions.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label htmlFor="qa-batch-exec" className="block font-semibold text-slate-700 mb-1">
                    {isEquipeTarget ? 'Equipe / Dupla padrão (opcional)' : 'Executor padrão (opcional)'}
                  </label>
                  <input
                    id="qa-batch-exec"
                    type="text"
                    list={datalistExecId}
                    value={executorOrEquipe}
                    onChange={(e) => setExecutorOrEquipe(e.target.value)}
                    placeholder="Deixe vazio se cada linha já trouxer ou se ainda não tiver equipe"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-[8px] text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Preview of first 5 lines */}
            {parsedBatchItems.length > 0 && (
              <div className="rounded-[8px] border border-slate-200 bg-white overflow-hidden">
                <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 flex items-center justify-between">
                  <span>Prévia dos acionamentos</span>
                  <span className="font-mono tabular-nums">
                    Mostrando {Math.min(5, parsedBatchItems.length)} de {parsedBatchItems.length}
                  </span>
                </div>
                <div className="divide-y divide-slate-100 text-[11px] font-mono">
                  {parsedBatchItems.slice(0, 5).map((item, idx) => (
                    <div key={`${item.siteId}-${idx}`} className="px-3 py-1.5 flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 truncate">
                        {idx + 1}. {item.siteId}
                        {config.hasSiteB && item.col2 ? ` ↔ ${item.col2.toUpperCase()}` : ''}
                      </span>
                      <span className="text-slate-500 truncate">
                        {[item.col2, item.col3, item.col4].filter(Boolean).join(' · ') || status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-[8px] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting || parsedBatchItems.length === 0}
                style={{ backgroundColor: config.accentColor }}
                className="px-4 py-2 hover:opacity-95 disabled:opacity-50 text-white text-xs font-bold rounded-[8px] transition-opacity flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>
                  {submitting
                    ? 'Adicionando...'
                    : `Adicionar ${parsedBatchItems.length || ''} ${
                        parsedBatchItems.length === 1 ? 'Acionamento' : 'Acionamentos'
                      }`}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
