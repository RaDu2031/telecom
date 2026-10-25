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

export function formatAcionamentoDate(rawDate?: string): string {
  if (!rawDate) return '';
  try {
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return rawDate;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return rawDate;
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
          icon: <Clock className="w-3 h-3 text-amber-600 animate-pulse" />,
          label: 'Aguardando aceite',
          bg: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
          dot: 'bg-amber-500',
        };
      case 'Aceito':
        return {
          icon: <CheckCircle2 className="w-3 h-3 text-blue-600" />,
          label: 'Aceito',
          bg: 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100',
          dot: 'bg-blue-600',
        };
      case 'Recusado':
        return {
          icon: <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />,
          label: 'Recusado',
          bg: 'bg-rose-100 text-rose-900 border-rose-300 ring-1 ring-rose-400 font-bold hover:bg-rose-200',
          dot: 'bg-rose-600',
        };
      case 'Em deslocamento':
        return {
          icon: <Navigation className="w-3 h-3 text-indigo-600" />,
          label: 'Em deslocamento',
          bg: 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100',
          dot: 'bg-indigo-600',
        };
      case 'No local':
        return {
          icon: <MapPin className="w-3 h-3 text-teal-600" />,
          label: 'No local',
          bg: 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100',
          dot: 'bg-teal-600',
        };
      case 'Em atendimento':
        return {
          icon: <Wrench className="w-3 h-3 text-sky-600" />,
          label: 'Em atendimento',
          bg: 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
          dot: 'bg-sky-600',
        };
      case 'Concluído':
        return {
          icon: <CheckCircle2 className="w-3 h-3 text-emerald-600" />,
          label: 'Concluído',
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
          dot: 'bg-emerald-600',
        };
      case 'Cancelado':
      default:
        return {
          icon: <Ban className="w-3 h-3 text-slate-400" />,
          label: 'Cancelado',
          bg: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200',
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
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium transition-all shadow-2xs cursor-pointer select-none ${cfg.bg}`}
        title={`Acionamento: ${status} (${acionamento.protocolo || acionamento.id})`}
      >
        {cfg.icon}
        <span>{cfg.label}</span>

        {/* Informação adicional de aceite resumida se aceito */}
        {status === 'Aceito' && acionamento.aceitoPorNome && !compact && (
          <span className="text-[10px] text-blue-700 font-normal">
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
            className="ml-1 px-1.5 py-0.2 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors"
          >
            Reatribuir
          </button>
        )}
      </div>

      {/* Popover / Tooltip informativo em hover */}
      {showTooltip && (
        <div
          className="absolute bottom-full left-0 mb-1.5 w-64 bg-slate-900 text-white rounded-lg p-2.5 shadow-xl border border-slate-800 text-[11px] z-50 pointer-events-none space-y-1.5 animate-in fade-in zoom-in-95 duration-100"
          style={{ minWidth: '220px' }}
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-1">
            <span className="font-mono font-bold text-blue-400">
              {acionamento.protocolo || acionamento.id}
            </span>
            <span className="text-[10px] uppercase font-semibold text-slate-400">
              {acionamento.tipoDestinatario}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Status:</span>
              <span className="font-semibold text-white">{status}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Equipe / Destino:</span>
              <span className="font-medium text-slate-200 truncate max-w-[130px]">
                {acionamento.equipe}
              </span>
            </div>

            {/* Aceite detalhes */}
            {acionamento.aceitoEm && (
              <div className="bg-blue-950/60 p-1.5 rounded border border-blue-900 text-[10px] text-blue-200">
                <span className="font-semibold">Aceito por:</span>{' '}
                {acionamento.aceitoPorNome || acionamento.aceitoPorEmail || 'Membro da equipe'}{' '}
                em {formatAcionamentoDate(acionamento.aceitoEm)}
              </div>
            )}

            {/* Recusa detalhes com destaque */}
            {isRecusado && (
              <div className="bg-rose-950/80 p-1.5 rounded border border-rose-800 text-[10px] text-rose-200 space-y-0.5">
                <div className="font-bold text-rose-300">
                  Recusado por:{' '}
                  {acionamento.recusadoPorNome || acionamento.recusadoPorEmail || 'Destinatário'}
                </div>
                {acionamento.recusadoEm && (
                  <div className="text-slate-400 text-[9px]">
                    Em {formatAcionamentoDate(acionamento.recusadoEm)}
                  </div>
                )}
                {acionamento.motivoRecusa && (
                  <div className="italic text-rose-100 mt-0.5">
                    "{acionamento.motivoRecusa}"
                  </div>
                )}
              </div>
            )}

            {/* Concluído detalhes */}
            {acionamento.concluidoEm && (
              <div className="bg-emerald-950/60 p-1.5 rounded border border-emerald-900 text-[10px] text-emerald-200">
                <span className="font-semibold">Concluído em:</span>{' '}
                {formatAcionamentoDate(acionamento.concluidoEm)}
              </div>
            )}

            {/* Demandado por */}
            <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800/80 flex items-center justify-between">
              <span>Demandado por:</span>
              <span className="text-slate-300">{acionamento.demandadoPorNome}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
