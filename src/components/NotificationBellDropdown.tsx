import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Bell,
  CheckCheck,
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
  EricssonRow,
  isOwnerAdmUser,
  normalizeUserRole,
  TelecomSite,
  VendorType,
} from '../types/telecom';
import { dataService } from '../services/dataService';

interface NotificationBellDropdownProps {
  notifications: AmetaNotification[];
  effectiveUser: AmetaUser | null;
  realUser: AmetaUser | null;
  activeVendor: VendorType;
  nokiaSites?: TelecomSite[];
  ericssonRows?: EricssonRow[];
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
    'ALL' | 'UNREAD' | 'DEMANDA' | 'EQUIPE'
  >('ALL');
  const [locallyReadIds, setLocallyReadIds] = useState<string[]>([]);
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

  // Filter notifications visible to the current effectiveUser (excluding file-based rules)
  const visibleNotifications = useMemo(() => {
    if (!effectiveUser) return [];
    const role = normalizeUserRole(effectiveUser.role, effectiveUser.email);
    return notifications.filter(
      (n) =>
        n.type !== 'ARQUIVO_ASSOCIADO_SITE_VISTORIADOR' &&
        n.type !== 'VISTORIA_OK_PASTA' &&
        n.type !== 'TSSR_ENVIADO_EXECUTOR' &&
        doesNotificationMatchUser(n, effectiveUser, role)
    );
  }, [notifications, effectiveUser]);

  const unreadCount = useMemo(() => {
    if (!userEmail) return 0;
    return visibleNotifications.filter(
      (n) =>
        !locallyReadIds.includes(n.id) &&
        (!Array.isArray(n.readByEmails) || !n.readByEmails.includes(userEmail))
    ).length;
  }, [visibleNotifications, userEmail, locallyReadIds]);

  const filteredList = useMemo(() => {
    return visibleNotifications.filter((n) => {
      const isUnread =
        !locallyReadIds.includes(n.id) &&
        (!Array.isArray(n.readByEmails) || !n.readByEmails.includes(userEmail));
      if (activeFilter === 'UNREAD') return isUnread;
      if (activeFilter === 'DEMANDA') return n.type === 'SITE_DEMANDADO_EXECUTOR';
      if (activeFilter === 'EQUIPE') return n.type === 'EXECUTOR_ATUALIZOU_EQUIPE';
      return true;
    });
  }, [visibleNotifications, activeFilter, userEmail, locallyReadIds]);

  const handleMarkRead = async (notificationId?: string, markAll = false) => {
    if (!userEmail) return;
    if (markAll) {
      setLocallyReadIds(visibleNotifications.map((n) => n.id));
      onNotificationsUpdated(visibleNotifications.map((n) => ({ ...n, read: true })));
    } else if (notificationId) {
      setLocallyReadIds((prev) =>
        prev.includes(notificationId) ? prev : [...prev, notificationId]
      );
      onNotificationsUpdated(
        visibleNotifications.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    }
    try {
      await dataService.marcarNotificacaoLida(notificationId, markAll, userEmail);
    } catch (err: any) {
      console.error('Erro ao marcar notificacao no Firestore [notificacoes]:', err?.code || err);
    }
  };

  const handleDeleteNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onNotificationsUpdated(visibleNotifications.filter((n) => n.id !== id));
    try {
      await dataService.excluirNotificacao(id);
    } catch (err: any) {
      console.error('Erro ao excluir notificacao no Firestore [notificacoes]:', err?.code || err);
    }
  };

  const getBadgeMeta = (type: AmetaNotification['type']) => {
    switch (type) {
      case 'SITE_DEMANDADO_EXECUTOR':
        return {
          label: 'Site Demandado → Campo',
          icon: Send,
          color: 'bg-blue-50 text-blue-700 border-blue-200',
        };
      case 'EXECUTOR_ATUALIZOU_EQUIPE':
        return {
          label: 'Equipe Atualizada → Coordenador',
          icon: Users,
          color: 'bg-amber-50 text-amber-800 border-amber-200',
        };
      case 'PERMISSAO_LIBERADA_ADM':
      default:
        return {
          label: 'Permissão Liberada (ADM Dono)',
          icon: ShieldCheck,
          color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        };
    }
  };

  const canDelete = isOwnerAdmUser(realUser?.email) || effectiveUser?.role === 'ADM';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border text-xs font-semibold transition-all duration-150 cursor-pointer ${
          unreadCount > 0
            ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100 shadow-2xs'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-2xs'
        }`}
        title="Central de Notificações do Usuário"
      >
        <Bell className={`w-3.5 h-3.5 ${unreadCount > 0 ? 'text-amber-600' : 'text-slate-500'}`} />
        <span className="hidden sm:inline">Notificações</span>
        {unreadCount > 0 && (
          <span className="px-1.5 py-0.2 rounded-full bg-amber-600 text-white font-bold font-mono tabular-nums text-[10px] leading-tight">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-14 sm:inset-x-auto sm:top-auto sm:absolute sm:right-0 sm:mt-2 sm:w-[440px] max-h-[82vh] flex flex-col rounded-[12px] bg-white border border-slate-200 shadow-[0_16px_40px_-10px_rgba(15,23,42,0.18)] z-50 overflow-hidden ameta-modal-panel">
          {/* Header */}
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#223585]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Notificações ({effectiveUser?.role || 'Usuário'})
                </h3>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Visão: <span className="text-slate-800 font-semibold">{effectiveUser?.name}</span> •{' '}
                <span className="text-[#1E8E8D] font-semibold">
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
                  className="flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-[10px] font-semibold transition-colors cursor-pointer"
                  title="Marcar todas como lidas"
                >
                  <CheckCheck className="w-3 h-3" />
                  Ler todas
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-[8px] text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="px-3 py-2 bg-white border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {[
              { id: 'ALL', label: `Todas (${visibleNotifications.length})` },
              { id: 'UNREAD', label: `Não lidas (${unreadCount})` },
              { id: 'DEMANDA', label: 'Sites Demandados' },
              { id: 'EQUIPE', label: 'Atualização Equipe' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFilter(tab.id as typeof activeFilter)}
                className={`px-2.5 py-1 rounded-[8px] text-[10px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  activeFilter === tab.id
                    ? 'bg-[#223585] text-white font-bold shadow-2xs'
                    : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200/70 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Notification Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-[420px]">
            {filteredList.length === 0 ? (
              <div className="py-10 px-6 text-center">
                <div className="w-11 h-11 rounded-[12px] bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-2.5">
                  <Bell className="w-5 h-5 text-slate-400" />
                </div>
                <p className="text-xs font-semibold text-slate-800">
                  Nenhuma notificação neste filtro
                </p>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  {effectiveUser?.role === 'Executor' || effectiveUser?.role === 'Vistoriador'
                    ? 'Você será notificado assim que um novo site for demandado para sua equipe.'
                    : 'Você receberá alertas de demandas de sites e atualização de equipes.'}
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
                        ? 'bg-blue-50/40 hover:bg-blue-50/70'
                        : 'bg-white hover:bg-slate-50 opacity-85'
                    }`}
                  >
                    <div
                      className={`p-2 rounded-[8px] border shrink-0 mt-0.5 ${meta.color}`}
                    >
                      <IconComp className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${meta.color}`}
                        >
                          {meta.label}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`px-1.5 py-0.5 rounded-[6px] text-[9px] font-bold ${
                              notif.vendor === 'ERICSSON'
                                ? 'bg-teal-50 text-teal-700 border border-teal-200'
                                : 'bg-blue-50 text-[#223585] border border-blue-200'
                            }`}
                          >
                            {notif.vendor === 'ERICSSON' ? 'ERICSSON' : 'TIM / NOKIA'}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 tabular-nums">{formattedTime}</span>
                        </div>
                      </div>

                      <h4 className="text-xs font-bold text-slate-900 mt-1.5 flex items-center gap-1.5">
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-[#223585] shrink-0" />
                        )}
                        <span className="truncate">{notif.title}</span>
                      </h4>
                      <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                        {notif.message}
                      </p>

                      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 text-[10px] text-slate-500">
                        <span>
                          Por: <strong className="text-slate-700">{notif.actorName}</strong>
                        </span>
                        <div className="flex items-center gap-2">
                          {isUnread && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkRead(notif.id, false);
                              }}
                              className="text-[#223585] hover:underline font-semibold cursor-pointer"
                            >
                              Marcar lida
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={(e) => handleDeleteNotification(notif.id, e)}
                              className="text-rose-500 hover:text-rose-700 p-0.5 cursor-pointer"
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
