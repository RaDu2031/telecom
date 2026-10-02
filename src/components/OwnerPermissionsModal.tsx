import React, { useState, useMemo } from 'react';
import {
  ShieldCheck,
  UserCheck,
  Lock,
  Unlock,
  CheckCircle2,
  Search,
  Eye,
  Plus,
  Layers,
  Building2,
  Users,
  Trash2,
  X,
} from 'lucide-react';
import {
  AmetaUser,
  AmetaNotification,
  AssignedPlatformScope,
  UserRole,
  UserSituacao,
  isOwnerAdmUser,
  isUserDono,
} from '../types/telecom';
import { dataService } from '../services/dataService';
import { cloudFetch } from '../lib/firebaseCloud';

const fetch = cloudFetch;

interface OwnerPermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  ownerUser: AmetaUser | null;
  nokiaUsers: AmetaUser[];
  ericssonUsers: AmetaUser[];
  availableNokiaEquipes: string[];
  availableEricssonEquipes: string[];
  onPermissionsUpdated: (
    nextNokiaUsers: AmetaUser[],
    nextEricssonUsers: AmetaUser[],
    nextNotifications: AmetaNotification[],
    toastMessage: string,
    duplaEmailsMap?: Record<string, string[]>
  ) => void;
  onSimulateUser?: (user: AmetaUser) => void;
}

const ASSIGNABLE_ROLES: Array<{
  role: UserRole;
  label: string;
  description: string;
  badgeColor: string;
}> = [
  {
    role: 'Coordenador Geral',
    label: 'Coordenador Geral',
    description: 'Vê todas as planilhas, Engenharia, Vistoria e Equipes da sua plataforma.',
    badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  },
  {
    role: 'Coordenador Engenharia',
    label: 'Coordenador Engenharia',
    description: 'Vê APENAS Engenharia (TSSR) e Vistoria da sua plataforma (sobe TSSR e Vistoria).',
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  },
  {
    role: 'Executor',
    label: 'Executor',
    description: 'Vê APENAS os sites demandados para ele e Vistoria (envia Vistoria e sobe TSSR).',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
  {
    role: 'Vistoriador',
    label: 'Vistoriador',
    description: 'Vê APENAS os sites demandados para ele e a aba Vistoria.',
    badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  },
];

export const OwnerPermissionsModal: React.FC<OwnerPermissionsModalProps> = ({
  isOpen,
  onClose,
  ownerUser,
  nokiaUsers,
  ericssonUsers,
  availableNokiaEquipes,
  availableEricssonEquipes,
  onPermissionsUpdated,
  onSimulateUser,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'ALL' | 'NOKIA' | 'ERICSSON'>('ALL');
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');

  // Form state for new or selected user permission release
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('ameta2026');
  const [formRole, setFormRole] = useState<UserRole>('Coordenador Geral');
  const [formPlatform, setFormPlatform] = useState<AssignedPlatformScope>('NOKIA');
  const [formEquipe, setFormEquipe] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Merge unique users across TIM/Nokia and Ericsson by email
  const unifiedUsers = useMemo(() => {
    const map = new Map<string, AmetaUser>();
    nokiaUsers.forEach((u) => {
      const key = u.email.trim().toLowerCase();
      map.set(key, {
        ...u,
        assignedPlatform:
          u.assignedPlatform || (isOwnerAdmUser(u.email) ? 'BOTH' : 'NOKIA'),
      });
    });
    ericssonUsers.forEach((u) => {
      const key = u.email.trim().toLowerCase();
      const existing = map.get(key);
      if (existing) {
        if (existing.assignedPlatform === 'NOKIA' && u.assignedPlatform === 'ERICSSON') {
          existing.assignedPlatform = 'BOTH';
        } else if (u.assignedPlatform) {
          existing.assignedPlatform = u.assignedPlatform;
        }
      } else {
        map.set(key, {
          ...u,
          assignedPlatform:
            u.assignedPlatform || (isOwnerAdmUser(u.email) ? 'BOTH' : 'ERICSSON'),
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      if (isOwnerAdmUser(a.email)) return -1;
      if (isOwnerAdmUser(b.email)) return 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
  }, [nokiaUsers, ericssonUsers]);

  // Local draft edits per user email
  const [rowDrafts, setRowDrafts] = useState<
    Record<
      string,
      {
        role: UserRole;
        assignedPlatform: AssignedPlatformScope;
        equipe: string;
        accessReleased: boolean;
      }
    >
  >({});

  const getDraftForUser = (u: AmetaUser) => {
    const key = u.email.toLowerCase();
    return (
      rowDrafts[key] || {
        role: isOwnerAdmUser(u.email) ? 'ADM' : u.role,
        assignedPlatform:
          u.assignedPlatform ||
          (isOwnerAdmUser(u.email)
            ? 'BOTH'
            : u.preferredVendor === 'ERICSSON'
            ? 'ERICSSON'
            : 'NOKIA'),
        equipe: u.equipe || u.name || '',
        accessReleased: u.accessReleased !== false && u.situacao !== 'aguardando' && u.situacao !== 'bloqueado',
      }
    );
  };

  const pendingRequestUsers = useMemo(() => {
    return unifiedUsers.filter(
      (u) =>
        !isOwnerAdmUser(u.email) &&
        (u.situacao === 'aguardando' || u.situacao === 'bloqueado' || u.accessReleased === false)
    );
  }, [unifiedUsers]);

  const updateDraftForUser = (
    u: AmetaUser,
    patch: Partial<{
      role: UserRole;
      assignedPlatform: AssignedPlatformScope;
      equipe: string;
      accessReleased: boolean;
    }>
  ) => {
    const key = u.email.toLowerCase();
    const current = getDraftForUser(u);
    setRowDrafts((prev) => ({
      ...prev,
      [key]: { ...current, ...patch },
    }));
  };

  const filteredUsers = useMemo(() => {
    return unifiedUsers.filter((u) => {
      const draft = getDraftForUser(u);
      if (platformFilter === 'NOKIA' && draft.assignedPlatform === 'ERICSSON') return false;
      if (platformFilter === 'ERICSSON' && draft.assignedPlatform === 'NOKIA') return false;
      if (roleFilter !== 'ALL' && draft.role !== roleFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const match =
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (draft.equipe || '').toLowerCase().includes(q) ||
          draft.role.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [unifiedUsers, platformFilter, roleFilter, searchQuery, rowDrafts]);

  if (!isOpen) return null;

  if (!isUserDono(ownerUser) && !isOwnerAdmUser(ownerUser?.email, ownerUser?.situacao)) {
    return null;
  }

  const handleReleaseUser = async (params: {
    userId?: string;
    uid?: string;
    email: string;
    name: string;
    password?: string;
    role: UserRole;
    assignedPlatform: AssignedPlatformScope;
    equipe: string;
    accessReleased: boolean;
    situacao?: UserSituacao;
  }) => {
    setSavingId(params.email.toLowerCase());
    setStatusBanner(null);
    try {
      const nextSituacao: UserSituacao =
        params.situacao || (params.accessReleased ? 'ativo' : 'bloqueado');
      const platForFirestore: 'NOKIA' | 'ERICSSON' | 'AMBAS' =
        params.assignedPlatform === 'BOTH' ? 'AMBAS' : params.assignedPlatform;

      if (dataService.isConfigured()) {
        await dataService.atualizarPermissaoUsuarioPeloDono({
          uid: params.uid || params.userId || params.email.trim().toLowerCase(),
          email: params.email,
          name: params.name,
          role: params.role,
          plataforma: platForFirestore,
          situacao: nextSituacao,
          equipe: params.equipe,
          ownerEmail: ownerUser?.email,
        });
      }

      const res = await fetch('/api/owner/permissions/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerEmail: ownerUser?.email || 'rafael.araujo@ametaservicos.com.br',
          ...params,
          situacao: nextSituacao,
          plataforma: platForFirestore,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusBanner({
          type: 'error',
          text: data.error || 'Erro ao atualizar permissão do usuário.',
        });
        setSavingId(null);
        return;
      }
      const platformLabel =
        params.assignedPlatform === 'NOKIA'
          ? 'TIM / Nokia'
          : params.assignedPlatform === 'ERICSSON'
          ? 'Ericsson'
          : 'TIM/Nokia & Ericsson';
      const msg = params.accessReleased
        ? `Permissão liberada: ${params.name} agora está ATIVO como ${params.role} (${platformLabel})!`
        : `Acesso bloqueado: ${params.name} foi marcado como BLOQUEADO / AGUARDANDO.`;
      setStatusBanner({ type: 'success', text: msg });
      onPermissionsUpdated(
        data.users || nokiaUsers,
        data.ericssonUsers || ericssonUsers,
        data.notifications || [],
        msg,
        data.duplaEmailsMap
      );
    } catch {
      setStatusBanner({
        type: 'error',
        text: 'Erro de conexão ao salvar permissão.',
      });
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteUser = async (targetUser: AmetaUser) => {
    if (isOwnerAdmUser(targetUser.email, targetUser.situacao)) return;
    setSavingId(targetUser.email.toLowerCase());
    setStatusBanner(null);
    try {
      if (dataService.isConfigured()) {
        await dataService.excluirUsuario(targetUser.uid || targetUser.id, targetUser.email);
      }
      const res = await fetch(`/api/admin/users/${encodeURIComponent(targetUser.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusBanner({
          type: 'error',
          text: data.error || 'Erro ao excluir usuário.',
        });
        return;
      }
      const msg = `Usuário ${targetUser.name} (${targetUser.email}) removido com sucesso.`;
      setStatusBanner({ type: 'success', text: msg });
      const nextNokia = Array.isArray(data.users)
        ? data.users
        : nokiaUsers.filter((u) => u.email.toLowerCase() !== targetUser.email.toLowerCase());
      const nextEricsson = Array.isArray(data.ericssonUsers)
        ? data.ericssonUsers
        : ericssonUsers.filter((u) => u.email.toLowerCase() !== targetUser.email.toLowerCase());
      onPermissionsUpdated(nextNokia, nextEricsson, notificationsFallback(), msg);
    } catch {
      setStatusBanner({
        type: 'error',
        text: 'Erro de conexão ao excluir usuário.',
      });
    } finally {
      setSavingId(null);
    }
  };

  function notificationsFallback(): AmetaNotification[] {
    return [];
  }

  const handleCreateOrReleaseFromTopForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = formEmail.trim().toLowerCase();
    if (!formName.trim() || !cleanEmail) {
      setStatusBanner({
        type: 'error',
        text: 'Preencha o nome e o e-mail corporativo (@ametaservicos.com.br) do usuário para liberar.',
      });
      return;
    }
    if (!cleanEmail.endsWith('@ametaservicos.com.br') && !isOwnerAdmUser(cleanEmail)) {
      setStatusBanner({
        type: 'error',
        text: 'Domínio inválido: Utilize exclusivamente e-mails @ametaservicos.com.br.',
      });
      return;
    }
    await handleReleaseUser({
      email: cleanEmail,
      name: formName.trim(),
      password: formPassword.trim() || 'ameta2026',
      role: formRole,
      assignedPlatform: formPlatform,
      equipe:
        formEquipe.trim() ||
        (formRole.includes('Coordenador')
          ? `Coordenação ${formPlatform === 'ERICSSON' ? 'Ericsson' : 'TIM/Nokia'}`
          : formName.trim()),
      accessReleased: true,
    });
    setFormName('');
    setFormEmail('');
    setFormEquipe('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-6xl bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black uppercase tracking-wide text-white">
                  Painel Exclusivo ADM Dono — Liberação de Permissões e Cargos
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold">
                  Apenas Rafael Araújo (ADM Dono)
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Selecione o que cada usuário será (<strong>Coordenador Geral</strong>,{' '}
                <strong>Coordenador Engenharia</strong>, <strong>Executor</strong> ou{' '}
                <strong>Vistoriador</strong>), defina a plataforma (<strong>TIM/Nokia</strong> ou{' '}
                <strong>Ericsson</strong>) e faça a liberação.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Rules & Visibility Matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {ASSIGNABLE_ROLES.map((r) => (
              <div
                key={r.role}
                className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between"
              >
                <div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${r.badgeColor}`}
                  >
                    {r.label}
                  </span>
                  <p className="text-[11px] text-slate-300 mt-2 leading-relaxed">
                    {r.description}
                  </p>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 flex items-center justify-between">
                  <span>Isolado por Plataforma</span>
                  <span className="text-sky-400 font-semibold">TIM/Nokia ou Ericsson</span>
                </div>
              </div>
            ))}
          </div>

          {statusBanner && (
            <div
              className={`px-4 py-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${
                statusBanner.type === 'success'
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{statusBanner.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setStatusBanner(null)}
                className="text-xs underline opacity-80 hover:opacity-100"
              >
                Fechar
              </button>
            </div>
          )}

          {/* Pending New User Requests Section */}
          <div className="p-4 rounded-xl bg-amber-500/10 border-2 border-amber-500/50 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950 font-black text-xs">
                  {pendingRequestUsers.length}
                </span>
                <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-amber-300">
                  Solicitações de Novos Usuários para Liberação (@ametaservicos.com.br)
                </h3>
              </div>
              <span className="text-[11px] text-amber-200/80">
                Ao aprovar um Vistoriador/Executor, a Dupla/Equipe dele alimenta automaticamente a aba Duplas & Demanda
              </span>
            </div>

            {pendingRequestUsers.length === 0 ? (
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-400">
                Nenhuma solicitação pendente no momento. Quando novos usuários criarem conta com{' '}
                <strong className="text-slate-200">@ametaservicos.com.br</strong>, eles aparecerão aqui imediatamente para você liberar.
              </div>
            ) : (
              <div className="space-y-2.5">
                {pendingRequestUsers.map((u) => {
                  const draft = getDraftForUser(u);
                  const isSaving = savingId === u.email.toLowerCase();
                  return (
                    <div
                      key={u.email}
                      className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/40 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">{u.name}</span>
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold uppercase">
                            Solicitou Acesso
                          </span>
                        </div>
                        <div className="text-xs font-mono text-amber-200 mt-0.5">{u.email}</div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1 max-w-2xl">
                        <div>
                          <label className="block text-[10px] uppercase text-slate-400 font-bold mb-0.5">
                            Cargo / Função
                          </label>
                          <select
                            value={draft.role}
                            onChange={(e) =>
                              updateDraftForUser(u, { role: e.target.value as UserRole })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-bold text-white"
                          >
                            <option value="Vistoriador">Vistoriador</option>
                            <option value="Executor">Executor</option>
                            <option value="Coordenador Geral">Coordenador Geral</option>
                            <option value="Coordenador Engenharia">Coordenador Engenharia</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] uppercase text-slate-400 font-bold mb-0.5">
                            Plataforma
                          </label>
                          <select
                            value={draft.assignedPlatform}
                            onChange={(e) =>
                              updateDraftForUser(u, {
                                assignedPlatform: e.target.value as AssignedPlatformScope,
                              })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-bold text-sky-300"
                          >
                            <option value="NOKIA">TIM / Nokia</option>
                            <option value="ERICSSON">Ericsson</option>
                            <option value="BOTH">Ambas (TIM + Ericsson)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] uppercase text-slate-400 font-bold mb-0.5">
                            Dupla / Equipe (Alimenta Duplas)
                          </label>
                          <input
                            type="text"
                            list="owner-equipes-list"
                            value={draft.equipe}
                            onChange={(e) => updateDraftForUser(u, { equipe: e.target.value })}
                            placeholder="Ex: Nome 1 / Nome 2"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() =>
                            handleReleaseUser({
                              userId: u.id,
                              uid: u.uid || u.id,
                              email: u.email,
                              name: u.name,
                              role: draft.role,
                              assignedPlatform: draft.assignedPlatform,
                              equipe: draft.equipe || u.name,
                              accessReleased: true,
                              situacao: 'ativo',
                            })
                          }
                          className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wide flex items-center gap-1.5 cursor-pointer shadow-md"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{isSaving ? 'Liberando...' : 'Aprovar e Liberar'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleDeleteUser(u)}
                          className="px-2.5 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-1 cursor-pointer"
                          title="Recusar e excluir solicitação"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Recusar</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Form: Cadastrar ou Liberar Novo Coordenador / Executor */}
          <form
            onSubmit={handleCreateOrReleaseFromTopForm}
            className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Cadastrar ou Liberar Novo Usuário (@ametaservicos.com.br)
              </h3>
              <span className="text-[11px] text-slate-400">
                Você é o único <strong>ADM</strong>. Todos os demais terão o perfil selecionado abaixo.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Nome Completo
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Carlos Mendes"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  E-mail (@ametaservicos.com.br)
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="usuario@ametaservicos.com.br"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  O que ele será (Perfil)
                </label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-amber-500/50 text-xs font-bold text-amber-200 focus:border-amber-400 focus:outline-none"
                >
                  <option value="Coordenador Geral">Coordenador Geral (Todas Planilhas)</option>
                  <option value="Coordenador Engenharia">Coordenador Engenharia (Engenharia + Vistoria + Subir TSSR)</option>
                  <option value="Executor">Executor (Sites Demandados + Vistoria/TSSR)</option>
                  <option value="Vistoriador">Vistoriador (Sites Demandados + Vistoria)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Plataforma Liberada
                </label>
                <select
                  value={formPlatform}
                  onChange={(e) => setFormPlatform(e.target.value as AssignedPlatformScope)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-sky-500/50 text-xs font-bold text-sky-200 focus:border-sky-400 focus:outline-none"
                >
                  <option value="NOKIA">TIM / Nokia</option>
                  <option value="ERICSSON">Ericsson</option>
                  <option value="BOTH">Ambas (TIM/Nokia + Ericsson)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Equipe / Dupla (Opcional)
                </label>
                <input
                  type="text"
                  list="owner-equipes-list"
                  value={formEquipe}
                  onChange={(e) => setFormEquipe(e.target.value)}
                  placeholder="Ex: Nome 1 / Nome 2"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:border-amber-500 focus:outline-none"
                />
                <datalist id="owner-equipes-list">
                  {Array.from(new Set([...availableNokiaEquipes, ...availableEricssonEquipes])).map(
                    (eq) => (
                      <option key={eq} value={eq} />
                    )
                  )}
                </datalist>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={savingId !== null}
                  className="w-full py-2 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20"
                >
                  <UserCheck className="w-4 h-4" />
                  Liberar Acesso
                </button>
              </div>
            </div>
          </form>

          {/* Filter Bar for Existing Users */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar usuário por nome, e-mail, cargo ou equipe..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                {[
                  { id: 'ALL', label: 'Todas Plataformas' },
                  { id: 'NOKIA', label: 'TIM / Nokia' },
                  { id: 'ERICSSON', label: 'Ericsson' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatformFilter(p.id as typeof platformFilter)}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors ${
                      platformFilter === p.id
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200"
              >
                <option value="ALL">Todos os Perfis ({unifiedUsers.length})</option>
                <option value="ADM">ADM Dono (1)</option>
                <option value="Coordenador Geral">Coordenador Geral</option>
                <option value="Coordenador Engenharia">Coordenador Engenharia</option>
                <option value="Executor">Executor</option>
                <option value="Vistoriador">Vistoriador</option>
              </select>
            </div>
          </div>

          {/* Users Table */}
          <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/60">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950 border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-4">Usuário / E-mail</th>
                    <th className="py-3 px-3">O que ele será (Cargo)</th>
                    <th className="py-3 px-3">Plataforma (Sistema)</th>
                    <th className="py-3 px-3">Equipe / Dupla Demandada</th>
                    <th className="py-3 px-3">Visibilidade Liberada</th>
                    <th className="py-3 px-4 text-right">Ação ADM Dono</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {filteredUsers.map((u) => {
                    const isOwner = isOwnerAdmUser(u.email);
                    const draft = getDraftForUser(u);
                    const isSaving = savingId === u.email.toLowerCase();

                    const visibilitySummary = isOwner
                      ? 'Acesso Total (ADM Dono)'
                      : draft.role === 'Coordenador Geral'
                      ? 'Todas as Planilhas + Engenharia + Vistoria + Equipes'
                      : draft.role === 'Coordenador Engenharia'
                      ? 'Apenas Engenharia (TSSR) e Vistoria'
                      : 'Apenas Sites Demandados à Equipe + Vistoria / TSSR';

                    return (
                      <tr
                        key={u.email}
                        className={`hover:bg-slate-900/70 transition-colors ${
                          isOwner ? 'bg-amber-500/5' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{u.name}</span>
                            {isOwner && (
                              <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-black text-[9px] uppercase">
                                VOCÊ (ADM DONO)
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400">{u.email}</div>
                        </td>

                        <td className="py-3 px-3">
                          {isOwner ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-xs">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              ADM (Único Dono)
                            </span>
                          ) : (
                            <select
                              value={draft.role}
                              onChange={(e) =>
                                updateDraftForUser(u, { role: e.target.value as UserRole })
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-bold text-white focus:border-amber-500 focus:outline-none"
                            >
                              <option value="Coordenador Geral">Coordenador Geral</option>
                              <option value="Coordenador Engenharia">
                                Coordenador Engenharia
                              </option>
                              <option value="Executor">Executor</option>
                              <option value="Vistoriador">Vistoriador</option>
                            </select>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          {isOwner ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 font-bold text-xs">
                              <Layers className="w-3.5 h-3.5" />
                              TIM/Nokia + Ericsson
                            </span>
                          ) : (
                            <select
                              value={draft.assignedPlatform}
                              onChange={(e) =>
                                updateDraftForUser(u, {
                                  assignedPlatform: e.target.value as AssignedPlatformScope,
                                })
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-bold text-sky-300 focus:border-sky-500 focus:outline-none"
                            >
                              <option value="NOKIA">TIM / Nokia</option>
                              <option value="ERICSSON">Ericsson</option>
                              <option value="BOTH">Ambas (TIM + Ericsson)</option>
                            </select>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          {isOwner ? (
                            <span className="text-slate-400 text-[11px]">Todas as Equipes</span>
                          ) : (
                            <input
                              type="text"
                              list="owner-equipes-list"
                              value={draft.equipe}
                              onChange={(e) =>
                                updateDraftForUser(u, { equipe: e.target.value })
                              }
                              placeholder="Equipe / Dupla..."
                              className="w-40 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                            />
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <div className="text-[11px] text-slate-300 font-medium">
                            {visibilitySummary}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            {isOwner ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400">
                                <ShieldCheck className="w-3 h-3" /> Situação: DONO (Acesso Total)
                              </span>
                            ) : draft.accessReleased && u.situacao !== 'aguardando' && u.situacao !== 'bloqueado' ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                                <Unlock className="w-3 h-3" /> Situação: ATIVO (Liberado pelo Dono)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400">
                                <Lock className="w-3 h-3" /> Situação: {u.situacao === 'bloqueado' ? 'BLOQUEADO' : 'AGUARDANDO LIBERAÇÃO'}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {!isOwner && (
                              <>
                                <button
                                  type="button"
                                  disabled={isSaving}
                                  onClick={() =>
                                    handleReleaseUser({
                                      userId: u.id,
                                      uid: u.uid || u.id,
                                      email: u.email,
                                      name: u.name,
                                      role: draft.role,
                                      assignedPlatform: draft.assignedPlatform,
                                      equipe: draft.equipe,
                                      accessReleased: true,
                                      situacao: 'ativo',
                                    })
                                  }
                                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[11px] uppercase tracking-wide transition-colors flex items-center gap-1 shadow-sm"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {isSaving ? 'Salvando...' : 'Liberar / Salvar'}
                                </button>
                                {draft.accessReleased && (
                                  <button
                                    type="button"
                                    disabled={isSaving}
                                    onClick={() =>
                                      handleReleaseUser({
                                        userId: u.id,
                                        uid: u.uid || u.id,
                                        email: u.email,
                                        name: u.name,
                                        role: draft.role,
                                        assignedPlatform: draft.assignedPlatform,
                                        equipe: draft.equipe,
                                        accessReleased: false,
                                        situacao: 'aguardando',
                                      })
                                    }
                                    className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-[11px] font-bold flex items-center gap-1 transition-colors"
                                    title="Voltar para Aguardando / Bloquear acesso"
                                  >
                                    <Lock className="w-3.5 h-3.5" />
                                    Bloquear
                                  </button>
                                )}
                              </>
                            )}
                            {onSimulateUser && !isOwner && (
                              <button
                                type="button"
                                onClick={() => {
                                  onSimulateUser({
                                    ...u,
                                    role: draft.role,
                                    assignedPlatform: draft.assignedPlatform,
                                    equipe: draft.equipe,
                                  });
                                  onClose();
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                                title="Testar como este usuário enxerga o sistema"
                              >
                                <Eye className="w-3.5 h-3.5 text-sky-400" />
                                Simular
                              </button>
                            )}
                            {!isOwner && (
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => handleDeleteUser(u)}
                                className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 transition-colors cursor-pointer"
                                title="Excluir este usuário permanentemente"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
