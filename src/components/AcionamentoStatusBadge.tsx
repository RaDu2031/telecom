import React, { useState } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Navigation,
  MapPin,
  Wrench,
  Ban,
  ChevronRight,
  Info,
} from 'lucide-react';
import { Acionamento, AcionamentoStatus } from '../types/telecom';

interface AcionamentoStatusBadgeProps {
  acionamento?: Acionamento | null;
  compact?: boolean;
  onReatribuir?: () => void;
  className?: string;
}

export function formatAcionamentoDate(rawDate?: any): string {
  if (!rawDate) return '';

  // Firestore Timestamp ou objeto com toDate() / seconds
  if (typeof rawDate === 'object') {
    if (typeof rawDate.toDate === 'function') {
      try {
        const d = rawDate.toDate();
        if (d instanceof Date && !isNaN(d.getTime())) {
          return d.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        }
      } catch {}
    }
    if (typeof rawDate.seconds === 'number') {
      try {
        const d = new Date(rawDate.seconds * 1000);
        if (!isNaN(d.getTime())) {
          return d.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        }
      } catch {}
    }
    // NUNCA renderizar um objeto no JSX
    return '';
  }

  const str = String(rawDate).trim();
  if (!str) return '';

  // Se já estiver no formato dd/mm/aaaa ou dd/mm/aaaa hh:mm
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
    return str;
  }

  // Texto ISO ou data padrão parseável
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return str;
  } catch {
    return str;
  }
}

export const AcionamentoStatusBadge: React.FC<AcionamentoStatusBadgeProps> = ({
  acionamento,
  compact = false,
  onReatribuir,
  className = '',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!acionamento) return null;

  const status: AcionamentoStatus = acionamento.status || 'Aguardando aceite';

  // Configuração visual de cada status
  const getStatusConfig = () => {
    switch (status) {
      case 'Aguardando aceite':
        return {
          icon: <Clock className="w-3 h-3 text-amber-600" />,
          label: 'Aguardando aceite',
          bg: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
          dot: 'bg-amber-500',
        };
      case 'Aceito':
        return {
          icon: <CheckCircle2 className="w-3 h-3 text-blue-600" />,
          label: 'Aceito',
          bg: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
          dot: 'bg-blue-500',
        };
      case 'Recusado':
        return {
          icon: <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />,
          label: 'Recusado',
          bg: 'bg-rose-50 text-rose-700 border-rose-300 ring-1 ring-rose-200 font-bold hover:bg-rose-100',
          dot: 'bg-rose-500',
        };
      case 'Em deslocamento':
        return {
          icon: <Navigation className="w-3 h-3 text-indigo-600" />,
          label: 'Em deslocamento',
          bg: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
          dot: 'bg-indigo-500',
        };
      case 'No local':
        return {
          icon: <MapPin className="w-3 h-3 text-[#1E8E8D]" />,
          label: 'No local',
          bg: 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100',
          dot: 'bg-[#1E8E8D]',
        };
      case 'Em atendimento':
        return {
          icon: <Wrench className="w-3 h-3 text-sky-600" />,
          label: 'Em atendimento',
          bg: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100',
          dot: 'bg-sky-500',
        };
      case 'Pausado':
        return {
          icon: <Clock className="w-3 h-3 text-amber-600" />,
          label: 'Pausado',
          bg: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
          dot: 'bg-amber-500',
        };
      case 'Concluído':
        return {
          icon: <CheckCircle2 className="w-3 h-3 text-emerald-600" />,
          label: 'Concluído',
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
          dot: 'bg-emerald-500',
        };
      case 'Cancelado':
      default:
        return {
          icon: <Ban className="w-3 h-3 text-slate-500" />,
          label: 'Cancelado',
          bg: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200/70',
          dot: 'bg-slate-400',
        };
    }
  };

  const cfg = getStatusConfig();
  const isRecusado = status === 'Recusado';

  return (
    <div
      className={`relative inline-flex items-center shrink-0 ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-medium transition-all duration-150 cursor-pointer select-none ${cfg.bg}`}
        title={`Acionamento: ${status} (${acionamento.protocolo || acionamento.id})`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} aria-hidden="true" />
        {cfg.icon}
        <span>{cfg.label}</span>
        {acionamento.rowNumberInFile ? (
          <span className="px-1.5 py-0.2 bg-white text-[#223585] border border-slate-200 rounded-full text-[9px] font-mono font-semibold shrink-0 tabular-nums">
            Linha {acionamento.rowNumberInFile}
          </span>
        ) : acionamento.registroId && acionamento.registroId.includes('__') ? (
          <span className="px-1.5 py-0.2 bg-white text-[#223585] border border-slate-200 rounded-full text-[9px] font-mono font-semibold shrink-0 tabular-nums">
            Linha {acionamento.registroId.split('_').pop()}
          </span>
        ) : null}

        {/* Informação adicional de aceite resumida se aceito */}
        {status === 'Aceito' && acionamento.aceitoPorNome && !compact && (
          <span className="text-[10px] text-blue-700/80 font-normal">
            · {acionamento.aceitoPorNome.split(' ')[0]}
          </span>
        )}

        {/* Destaque para Reatribuir se Recusado */}
        {isRecusado && onReatribuir && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReatribuir();
            }}
            className="ml-1 px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full text-[10px] font-semibold uppercase tracking-wider cursor-pointer transition-colors duration-150"
          >
            Reatribuir
          </button>
        )}
      </div>

      {/* Popover / Tooltip informativo em hover */}
      {showTooltip && (
        <div
          className="absolute bottom-full left-0 mb-1.5 w-64 bg-white text-slate-800 rounded-[10px] p-2.5 shadow-xl border border-slate-200 text-[11px] z-50 pointer-events-none space-y-1.5 animate-fadeIn"
          style={{ minWidth: '220px' }}
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-1">
            <span className="font-mono font-bold text-[#223585] tabular-nums">
              {acionamento.protocolo || acionamento.id}
            </span>
            <span className="text-[10px] uppercase font-semibold text-slate-500">
              {acionamento.tipoDestinatario}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Status:</span>
              <span className="font-semibold text-slate-900">{status}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500">Equipe / Destino:</span>
              <span className="font-medium text-slate-800 truncate max-w-[130px]">
                {acionamento.equipe}
              </span>
            </div>

            {acionamento.dataDemanda && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-500">Data Demanda:</span>
                <span className="font-mono text-slate-700 tabular-nums">{formatAcionamentoDate(acionamento.dataDemanda)}</span>
              </div>
            )}

            {/* Aceite detalhes */}
            {acionamento.aceitoEm && (
              <div className="bg-blue-50 p-1.5 rounded border border-blue-200 text-[10px] text-blue-800">
                <span className="font-semibold">Aceito por:</span>{' '}
                {acionamento.aceitoPorNome || acionamento.aceitoPorEmail || 'Membro da equipe'}{' '}
                em {formatAcionamentoDate(acionamento.aceitoEm)}
              </div>
            )}

            {/* Recusa detalhes com destaque */}
            {isRecusado && (
              <div className="bg-rose-50 p-1.5 rounded border border-rose-200 text-[10px] text-rose-800 space-y-0.5">
                <div className="font-bold text-rose-700">
                  Recusado por:{' '}
                  {acionamento.recusadoPorNome || acionamento.recusadoPorEmail || 'Destinatário'}
                </div>
                {acionamento.recusadoEm && (
                  <div className="text-slate-500 text-[9px]">
                    Em {formatAcionamentoDate(acionamento.recusadoEm)}
                  </div>
                )}
                {acionamento.motivoRecusa && (
                  <div className="italic text-rose-900 mt-0.5">
                    "{acionamento.motivoRecusa}"
                  </div>
                )}
              </div>
            )}

            {/* Concluído detalhes */}
            {acionamento.concluidoEm && (
              <div className="bg-emerald-50 p-1.5 rounded border border-emerald-200 text-[10px] text-emerald-800">
                <span className="font-semibold">Concluído em:</span>{' '}
                {formatAcionamentoDate(acionamento.concluidoEm)}
              </div>
            )}

            {/* Planilha atualizada */}
            {acionamento.planilhaAtualizadaEm && (
              <div className="bg-slate-50 p-1.5 rounded border border-slate-200 text-[10px] text-slate-700">
                <span className="font-semibold text-emerald-700">Planilha atualizada em:</span>{' '}
                {formatAcionamentoDate(acionamento.planilhaAtualizadaEm)}
                {acionamento.planilhaResumo ? ` · ${acionamento.planilhaResumo}` : ''}
              </div>
            )}

            {/* Demandado por */}
            <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100 flex items-center justify-between">
              <span>Demandado por:</span>
              <span className="text-slate-700 font-medium">{acionamento.demandadoPorNome}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
