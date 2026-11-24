import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  X,
  Loader2,
  Inbox,
} from 'lucide-react';

/* ============================================================================
   1. Button Component (8px radius, Ameta Navy & Teal light corporate palette)
   ============================================================================ */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'teal';

export type ButtonSize = 'xs' | 'sm' | 'md';

export interface UiButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const UiButton: React.FC<UiButtonProps> = ({
  variant = 'primary',
  size = 'sm',
  isLoading = false,
  leftIcon,
  rightIcon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}) => {
  const variantClasses: Record<ButtonVariant, string> = {
    primary:
      'bg-[#223585] hover:bg-[#1B2A6B] active:bg-[#162256] text-white font-semibold border border-transparent shadow-2xs',
    teal:
      'bg-[#1E8E8D] hover:bg-[#177070] active:bg-[#115E59] text-white font-semibold border border-transparent shadow-2xs',
    secondary:
      'bg-slate-100 hover:bg-slate-200/80 active:bg-slate-200 text-slate-800 border border-slate-200',
    outline:
      'bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs',
    ghost:
      'bg-transparent hover:bg-slate-100 active:bg-slate-200/70 text-slate-600 hover:text-slate-900 border border-transparent',
    danger:
      'bg-rose-50 hover:bg-rose-100 active:bg-rose-200/70 text-rose-700 border border-rose-200',
  };

  const sizeClasses: Record<ButtonSize, string> = {
    xs: 'px-2.5 py-1 text-[11px] gap-1.5',
    sm: 'px-3.5 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-xs gap-2',
  };

  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center font-semibold rounded-[8px] transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#223585] ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {isLoading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
      ) : (
        leftIcon && <span className="shrink-0 inline-flex">{leftIcon}</span>
      )}
      <span>{children}</span>
      {!isLoading && rightIcon && (
        <span className="shrink-0 inline-flex">{rightIcon}</span>
      )}
    </button>
  );
};

/* ============================================================================
   2. Semantic StatusBadge (Clean dot + high-contrast light corporate pill)
   ============================================================================ */
export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export function resolveStatusTone(rawStatus?: string | null): StatusTone {
  const s = String(rawStatus || '').trim().toLowerCase();
  if (!s || s === '—' || s === '-' || s === 'sem informação') return 'neutral';
  if (
    s.includes('finalizad') ||
    s.includes('conclu') ||
    s.includes('entregue') ||
    s.includes('aprovad') ||
    s.includes('liberado') ||
    s.includes('emitida') ||
    s.includes('pago') ||
    s.includes('faturado') ||
    s === 'ativo' ||
    s === 'ok'
  ) {
    return 'success';
  }
  if (
    s.includes('recusad') ||
    s.includes('reprovad') ||
    s.includes('cancelad') ||
    s.includes('sem acesso') ||
    s.includes('sem chave') ||
    s.includes('bloquead') ||
    s.includes('crítico') ||
    s.includes('critico') ||
    s.includes('atrasad')
  ) {
    return 'danger';
  }
  if (
    s.includes('andamento') ||
    s.includes('deslocamento') ||
    s.includes('atendimento') ||
    s.includes('no local') ||
    s.includes('aceito') ||
    s.includes('execução') ||
    s.includes('execucao') ||
    s.includes('iniciad')
  ) {
    return 'info';
  }
  if (
    s.includes('pendent') ||
    s.includes('aguard') ||
    s.includes('executar') ||
    s.includes('solicitado') ||
    s.includes('replan') ||
    s.includes('pausado') ||
    s.includes('comissionamento') ||
    s.includes('zeladoria')
  ) {
    return 'warning';
  }
  return 'neutral';
}

export const STATUS_TONE_STYLES: Record<
  StatusTone,
  { badge: string; dot: string }
> = {
  success: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  info: {
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    dot: 'bg-blue-500',
  },
  warning: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
  },
  danger: {
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    dot: 'bg-rose-500',
  },
  neutral: {
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
  },
};

export interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
  maxWidthClass?: string;
  trailing?: React.ReactNode;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  tone,
  maxWidthClass = 'max-w-[165px]',
  trailing,
  className = '',
}) => {
  const resolved = tone || resolveStatusTone(label);
  const styles = STATUS_TONE_STYLES[resolved];

  return (
    <span
      title={label}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors duration-150 ${styles.badge} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${styles.dot}`} aria-hidden="true" />
      <span className={`truncate ${maxWidthClass}`}>{label || '—'}</span>
      {trailing}
    </span>
  );
};

/* ============================================================================
   3. Card & Clean Corporate KPI Card Components (White surface, semantic icon)
   ============================================================================ */
export interface UiCardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const UiCard: React.FC<UiCardProps> = ({
  children,
  className = '',
  padding = 'md',
}) => {
  const padClass =
    padding === 'none'
      ? ''
      : padding === 'sm'
      ? 'p-3'
      : padding === 'lg'
      ? 'p-6'
      : 'p-4 sm:p-5';

  return (
    <div
      className={`bg-white border border-slate-200 rounded-[12px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${padClass} ${className}`}
    >
      {children}
    </div>
  );
};

export interface KpiCardProps {
  label: string;
  value: number | string;
  sublabel?: string;
  icon: React.ReactNode;
  tone?: StatusTone | 'navy' | 'teal';
  onClick?: () => void;
  active?: boolean;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  sublabel,
  icon,
  tone = 'navy',
  onClick,
  active = false,
}) => {
  const toneMap: Record<
    NonNullable<KpiCardProps['tone']>,
    {
      valueText: string;
      iconWrap: string;
      activeRing: string;
    }
  > = {
    navy: {
      valueText: 'text-slate-900',
      iconWrap: 'bg-[#223585]/10 text-[#223585]',
      activeRing: 'border-[#223585] ring-2 ring-[#223585]/15 bg-[#223585]/[0.02]',
    },
    teal: {
      valueText: 'text-[#177070]',
      iconWrap: 'bg-[#1E8E8D]/12 text-[#1E8E8D]',
      activeRing: 'border-[#1E8E8D] ring-2 ring-[#1E8E8D]/15 bg-[#1E8E8D]/[0.02]',
    },
    success: {
      valueText: 'text-emerald-700',
      iconWrap: 'bg-emerald-50 text-emerald-600',
      activeRing: 'border-emerald-500 ring-2 ring-emerald-500/15 bg-emerald-50/40',
    },
    info: {
      valueText: 'text-blue-700',
      iconWrap: 'bg-blue-50 text-blue-600',
      activeRing: 'border-blue-500 ring-2 ring-blue-500/15 bg-blue-50/40',
    },
    warning: {
      valueText: 'text-amber-700',
      iconWrap: 'bg-amber-50 text-amber-600',
      activeRing: 'border-amber-500 ring-2 ring-amber-500/15 bg-amber-50/40',
    },
    danger: {
      valueText: 'text-rose-700',
      iconWrap: 'bg-rose-50 text-rose-600',
      activeRing: 'border-rose-500 ring-2 ring-rose-500/15 bg-rose-50/40',
    },
    neutral: {
      valueText: 'text-slate-800',
      iconWrap: 'bg-slate-100 text-slate-600',
      activeRing: 'border-slate-400 ring-2 ring-slate-300/40 bg-slate-50',
    },
  };

  const t = toneMap[tone];
  const interactiveCls = onClick
    ? 'cursor-pointer hover:border-slate-300 hover:shadow-[0_2px_6px_rgba(15,23,42,0.06)] active:scale-[0.99]'
    : '';

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`text-left bg-white border rounded-[12px] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-150 flex flex-col justify-between gap-2.5 ${
        active ? t.activeRing : 'border-slate-200'
      } ${interactiveCls}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="text-[11px] font-semibold text-slate-500 truncate">
            {label}
          </div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums tracking-tight leading-none ${t.valueText}`}
          >
            {value}
          </div>
        </div>
        <div
          className={`w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 ${t.iconWrap}`}
          aria-hidden="true"
        >
          {icon}
        </div>
      </div>

      {sublabel && (
        <div className="text-[11px] text-slate-500 truncate leading-tight pt-1 border-t border-slate-100">
          {sublabel}
        </div>
      )}
    </Wrapper>
  );
};

/* ============================================================================
   4. Input Component (Clean light corporate input, Ameta Navy focus ring)
   ============================================================================ */
export interface UiInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  helperText?: string;
  leftIcon?: React.ReactNode;
}

export const UiInput: React.FC<UiInputProps> = ({
  label,
  error,
  helperText,
  leftIcon,
  className = '',
  id,
  ...rest
}) => {
  const inputId = id || (label ? `ui-input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  return (
    <div className="space-y-1.5 w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs font-semibold text-slate-700"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            {leftIcon}
          </span>
        )}
        <input
          id={inputId}
          className={`w-full ${
            leftIcon ? 'pl-9 pr-3' : 'px-3'
          } py-2 bg-white border rounded-[8px] text-xs text-slate-900 placeholder:text-slate-400 transition-all duration-150 focus:outline-none focus:ring-2 ${
            error
              ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/15'
              : 'border-slate-200 focus:border-[#223585] focus:ring-[#223585]/15'
          } ${className}`}
          {...rest}
        />
      </div>
      {error ? (
        <p className="text-[11px] font-medium text-rose-600">{error}</p>
      ) : helperText ? (
        <p className="text-[11px] text-slate-500">{helperText}</p>
      ) : null}
    </div>
  );
};

/* ============================================================================
   5. Toast Notification (Clean light floating corporate toast)
   ============================================================================ */
export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export function inferToastKind(message: string): ToastKind {
  const m = message.toLowerCase();
  if (
    m.includes('erro') ||
    m.includes('falha') ||
    m.includes('bloquead') ||
    m.includes('inválid') ||
    m.includes('invalid') ||
    m.includes('negado')
  ) {
    return 'error';
  }
  if (
    m.includes('atenção') ||
    m.includes('aviso') ||
    m.includes('limite') ||
    m.includes('aguarda') ||
    m.includes('já está') ||
    m.includes('não encontrad') ||
    m.includes('vazia')
  ) {
    return 'warning';
  }
  if (
    m.includes('sucesso') ||
    m.includes('salvo') ||
    m.includes('salva') ||
    m.includes('atualizad') ||
    m.includes('adicionad') ||
    m.includes('conclu') ||
    m.includes('liberado') ||
    m.includes('zerada') ||
    m.includes('excluíd') ||
    m.includes('removido') ||
    m.includes('importad')
  ) {
    return 'success';
  }
  return 'info';
}

export const ToastNotification: React.FC<{
  message: string;
  onDismiss?: () => void;
}> = ({ message, onDismiss }) => {
  const kind = inferToastKind(message);

  const meta: Record<
    ToastKind,
    { icon: React.ReactNode; border: string; iconWrap: string }
  > = {
    success: {
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />,
      border: 'border-emerald-200',
      iconWrap: 'bg-emerald-50',
    },
    error: {
      icon: <XCircle className="w-4 h-4 text-rose-600 shrink-0" />,
      border: 'border-rose-200',
      iconWrap: 'bg-rose-50',
    },
    warning: {
      icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />,
      border: 'border-amber-200',
      iconWrap: 'bg-amber-50',
    },
    info: {
      icon: <Info className="w-4 h-4 text-[#223585] shrink-0" />,
      border: 'border-slate-200',
      iconWrap: 'bg-[#223585]/10',
    },
  };

  const cfg = meta[kind];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`ameta-toast-enter fixed top-16 right-4 left-4 sm:left-auto sm:max-w-md z-50 bg-white border ${cfg.border} rounded-[12px] shadow-[0_12px_32px_-8px_rgba(15,23,42,0.16)] px-3.5 py-2.5 flex items-center gap-3 text-xs text-slate-800`}
    >
      <div className={`w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0 ${cfg.iconWrap}`}>
        {cfg.icon}
      </div>
      <span className="flex-1 font-medium leading-snug">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-[6px] transition-colors cursor-pointer shrink-0"
          aria-label="Fechar aviso"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

/* ============================================================================
   6. Table Loading Skeleton & Friendly Empty State (High-contrast light UI)
   ============================================================================ */
export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({
  rows = 8,
  cols = 6,
}) => (
  <div className="p-4 space-y-2.5 bg-white">
    <div className="grid grid-cols-6 gap-3 pb-2 border-b border-slate-200">
      {Array.from({ length: cols }).map((_, idx) => (
        <div key={idx} className="ameta-skeleton-bar h-3.5 w-3/4" />
      ))}
    </div>
    {Array.from({ length: rows }).map((_, rIdx) => (
      <div
        key={rIdx}
        className="grid grid-cols-6 gap-3 py-2 border-b border-slate-100"
      >
        {Array.from({ length: cols }).map((_, cIdx) => (
          <div
            key={cIdx}
            className={`ameta-skeleton-bar h-3 ${
              cIdx === 0 ? 'w-16' : cIdx === 1 ? 'w-24' : 'w-full'
            }`}
          />
        ))}
      </div>
    ))}
  </div>
);

export const EmptyStateCard: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="py-12 px-6 text-center max-w-md mx-auto space-y-3">
    <div className="w-12 h-12 mx-auto rounded-[12px] bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400">
      {icon || <Inbox className="w-6 h-6" />}
    </div>
    <div className="space-y-1">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      {description && (
        <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
      )}
    </div>
    {action && <div className="pt-1">{action}</div>}
  </div>
);
