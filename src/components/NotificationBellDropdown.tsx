import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Bell,
  CheckCheck,
  FolderCheck,
  FileUp,
  Users,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  AmetaNotification,
  AmetaUser,
  doesNotificationMatchUser,
  isOwnerAdmUser,
  normalizeUserRole,
  VendorType,
} from '../types/telecom';

interface NotificationBellDropdownProps {
  notifications: AmetaNotification[];
  effectiveUser: AmetaUser | null;
  realUser: AmetaUser | null;
  activeVendor: VendorType;
  onNotificationsUpdated: (next: AmetaNotification[]) => void;
  onNavigateToContext?: (notif: AmetaNotification) => void;
}

export const NotificationBellDropdown: React.FC<NotificationBellDropdownProps> = ({
  notifications,
  effectiveUser,
  realUser,
  onNotificationsUpdated,
  onNavigateToContext,
}) => {
  const [open, setOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<
    'ALL' | 'UNREAD' | 'DEMANDA' | 'EQUIPE' | 'VISTORIA_OK' | 'TSSR'
  >('ALL');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const userEmail = (effectiveUser?.email || realUser?.email || '').trim().toLowerCase();

  // Filter notifications visible to the current effectiveUser (respecting role, platform, and equipe)
  const visibleNotifications = useMemo(() => {
    if (!effectiveUser) return [];
    const role = normalizeUserRole(effectiveUser.role, effectiveUser.email);
    return notifications.filter((n) => doesNotificationMatchUser(n, effectiveUser, role));
  }, [notifications, effectiveUser]);

  const unreadCount = useMemo(() => {
    if (!userEmail) return 0;
    return visibleNotifications.filter(
      (n) => !Array.isArray(n.readByEmails) || !n.readByEmails.includes(userEmail)
    ).length;
  }, [visibleNotifications, userEmail]);

  const filteredList = useMemo(() => {
    return visibleNotifications.filter((n) => {
      const isUnread = !Array.isArray(n.readByEmails) || !n.readByEmails.includes(userEmail);
      if (activeFilter === 'UNREAD') return isUnread;
      if (activeFilter === 'DEMANDA') return n.type === 'SITE_DEMANDADO_EXECUTOR';
      if (activeFilter === 'EQUIPE') return n.type === 'EXECUTOR_ATUALIZOU_EQUIPE';
      if (activeFilter === 'VISTORIA_OK') return n.type === 'VISTORIA_OK_PASTA';
      if (activeFilter === 'TSSR') return n.type === 'TSSR_ENVIADO_EXECUTOR';
      return true;
    });
  }, [visibleNotifications, activeFilter, userEmail]);

  const handleMarkRead = async (notificationId?: string, markAll = false) => {
    if (!userEmail) return;
    try {
      const res = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          notificationId,
          markAll,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.notifications)) {
          onNotificationsUpdated(data.notifications);
        }
      }
    } catch {
      // ignore
    }
  };

  const handleDeleteNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.notifications)) {
          onNotificationsUpdated(data.notifications);
        }
      }
    } catch {
      // ignore
    }
  };

  const getBadgeMeta = (type: AmetaNotification['type']) => {
    switch (type) {
      case 'SITE_DEMANDADO_EXECUTOR':
        return {
          label: 'Site Demandado → Executor',
          icon: Send,
          color: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
        };
      case 'EXECUTOR_ATUALIZOU_EQUIPE':
        return {
          label: 'Equipe Atualizada → Coordenador',
          icon: Users,
          color: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        };
      case 'VISTORIA_OK_PASTA':
        return {
          label: 'Vistoria na Pasta (OK) → Coord. Engenharia',
          icon: FolderCheck,
          color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        };
      case 'TSSR_ENVIADO_EXECUTOR':
        return {
          label: 'TSSR Subido → Coord. Engenharia',
          icon: FileUp,
          color: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
        };
      case 'PERMISSAO_LIBERADA_ADM':
      default:
        return {
          label: 'Permissão Liberada (ADM Dono)',
          icon: ShieldCheck,
          color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
        };
    }
  };

  const canDelete = isOwnerAdmUser(realUser?.email) || effectiveUser?.role === 'ADM';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
          unreadCount > 0
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25 shadow-sm shadow-amber-500/10'
            : 'bg-slate-900/90 border-slate-700/80 text-slate-300 hover:text-white hover:border-slate-600'
        }`}
        title="Central de Notificações do Usuário"
      >
        <Bell className={`w-3.5 h-3.5 ${unreadCount > 0 ? 'text-amber-400 animate-pulse' : 'text-slate-400'}`} />
        <span className="hidden sm:inline">Notificações</span>
        {unreadCount > 0 && (
          <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 font-black text-[10px] leading-tight">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-14 sm:inset-x-auto sm:top-auto sm:absolute sm:right-0 sm:mt-2 sm:w-[440px] max-h-[82vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700/90 shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Notificações ({effectiveUser?.role || 'Usuário'})
                </h3>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Visão: <span className="text-slate-200 font-semibold">{effectiveUser?.name}</span> •{' '}
                <span className="text-sky-400 font-semibold">
                  {effectiveUser?.assignedPlatform === 'ERICSSON'
                    ? 'Ericsson'
                    : effectiveUser?.assignedPlatform === 'BOTH'
                    ? 'TIM/Nokia & Ericsson'
                    : 'TIM / Nokia'}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => handleMarkRead(undefined, true)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold transition-colors"
                  title="Marcar todas como lidas"
                >
                  <CheckCheck className="w-3 h-3" />
                  Ler todas
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="px-3 py-2 bg-slate-900/95 border-b border-slate-800 flex items-center gap-1 overflow-x-auto no-scrollbar">
            {[
              { id: 'ALL', label: `Todas (${visibleNotifications.length})` },
              { id: 'UNREAD', label: `Não lidas (${unreadCount})` },
              { id: 'DEMANDA', label: 'Sites Demandados' },
              { id: 'EQUIPE', label: 'Atualização Equipe' },
              { id: 'VISTORIA_OK', label: 'Vistoria OK' },
              { id: 'TSSR', label: 'TSSR Engenharia' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFilter(tab.id as typeof activeFilter)}
                className={`px-2 py-1 rounded text-[10px] font-semibold whitespace-nowrap transition-colors ${
                  activeFilter === tab.id
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Notification Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80 max-h-[420px]">
            {filteredList.length === 0 ? (
              <div className="py-10 px-6 text-center">
                <Bell className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-60" />
                <p className="text-xs font-semibold text-slate-300">
                  Nenhuma notificação neste filtro
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {effectiveUser?.role === 'Executor' || effectiveUser?.role === 'Vistoriador'
                    ? 'Você será notificado assim que um novo site for demandado para sua equipe.'
                    : effectiveUser?.role === 'Coordenador Engenharia'
                    ? 'Você receberá alertas quando uma Vistoria entrar na pasta com status OK ou quando subirem um TSSR.'
                    : 'Você receberá alertas de atualização de equipes, vistorias OK e envios de TSSR.'}
                </p>
              </div>
            ) : (
              filteredList.map((notif) => {
                const isUnread =
                  !Array.isArray(notif.readByEmails) || !notif.readByEmails.includes(userEmail);
                const meta = getBadgeMeta(notif.type);
                const IconComp = meta.icon;
                const formattedTime = new Date(notif.createdAt).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={notif.id}
                    onClick={() => {
                      if (isUnread) handleMarkRead(notif.id, false);
                      if (onNavigateToContext) {
                        onNavigateToContext(notif);
                        setOpen(false);
                      }
                    }}
                    className={`p-3.5 transition-colors cursor-pointer flex items-start gap-3 ${
                      isUnread
                        ? 'bg-slate-800/60 hover:bg-slate-800/90'
                        : 'bg-slate-900/40 hover:bg-slate-800/40 opacity-80'
                    }`}
                  >
                    <div
                      className={`p-2 rounded-lg border shrink-0 mt-0.5 ${meta.color}`}
                    >
                      <IconComp className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${meta.color}`}
                        >
                          {meta.label}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              notif.vendor === 'ERICSSON'
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            }`}
                          >
                            {notif.vendor === 'ERICSSON' ? 'ERICSSON' : 'TIM / NOKIA'}
                          </span>
                          <span className="text-[10px] text-slate-500">{formattedTime}</span>
                        </div>
                      </div>

                      <h4 className="text-xs font-bold text-white mt-1.5 flex items-center gap-1.5">
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                        )}
                        <span className="truncate">{notif.title}</span>
                      </h4>
                      <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                        {notif.message}
                      </p>

                      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-800/60 text-[10px] text-slate-400">
                        <span>
                          Por: <strong className="text-slate-300">{notif.actorName}</strong>
                        </span>
                        <div className="flex items-center gap-2">
                          {isUnread && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkRead(notif.id, false);
                              }}
                              className="text-sky-400 hover:text-sky-300 font-semibold"
                            >
                              Marcar lida
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={(e) => handleDeleteNotification(notif.id, e)}
                              className="text-rose-400 hover:text-rose-300 p-0.5"
                              title="Excluir notificação"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
