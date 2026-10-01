import React, { useState, useMemo, useEffect } from 'react';
import {
  ShieldCheck,
  Users,
  Plus,
  Trash2,
  Search,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  X,
  Phone,
  Mail,
  Eye,
  FileText,
  Upload,
  Download,
  ChevronDown,
  ChevronUp,
  UserCheck,
} from 'lucide-react';
import {
  AmetaUser,
  UserRole,
  normalizeUserRole,
  MandatoryDocType,
  UserMandatoryDocument,
  MANDATORY_USER_DOCUMENTS,
  ensureUserMandatoryDocuments,
  evaluateDocumentExpiration,
  evaluateUserOverallDocumentStatus,
} from '../types/telecom';

interface AdminAccessPanelProps {
  currentUser: AmetaUser;
  users: AmetaUser[];
  onUsersUpdated: (nextUsers: AmetaUser[], toastMsg?: string) => void;
  onTestUserView?: (targetUser: AmetaUser) => void;
  initialExpandedUserId?: string | null;
}

const ROLE_OPTIONS: Array<{
  role: UserRole;
  label: string;
  description: string;
}> = [
  {
    role: 'Coordenador Geral',
    label: 'Coord. Geral',
    description: 'Vê todas as planilhas, Engenharia e Vistoria da sua plataforma',
  },
  {
    role: 'Coordenador Engenharia',
    label: 'Coord. Eng.',
    description: 'Visibilidade apenas de Engenharia e Vistoria',
  },
  {
    role: 'Executor',
    label: 'Executor',
    description: 'Acesso apenas aos sites demandados para ele e Vistoria',
  },
  {
    role: 'Vistoriador',
    label: 'Vistoriador',
    description: 'Acesso apenas aos sites demandados e Pasta de Vistoria',
  },
];

function formatDateBr(isoDate?: string): string {
  if (!isoDate || !isoDate.trim()) return '—';
  const parts = isoDate.trim().split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export const AdminAccessPanel: React.FC<AdminAccessPanelProps> = ({
  currentUser,
  users,
  onUsersUpdated,
  onTestUserView,
  initialExpandedUserId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'VALIDADO' | 'A VENCER' | 'VENCIDO' | 'DISPENSADO'
  >('ALL');
  const [equipeFilter, setEquipeFilter] = useState<string>('ALL');

  // Expanded hidden panel ("tela oculta") per user ID
  const [expandedUserId, setExpandedUserId] = useState<string | null>(
    initialExpandedUserId || null
  );

  useEffect(() => {
    if (initialExpandedUserId) {
      setExpandedUserId(initialExpandedUserId);
    }
  }, [initialExpandedUserId]);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  // New User Modal State
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cpf, setCpf] = useState('');
  const [rg, setRg] = useState('');
  const [equipe, setEquipe] = useState('');
  const [atividade, setAtividade] = useState('ACESSO | TX');
  const [password, setPassword] = useState('ameta2026');
  const [newRole, setNewRole] = useState<UserRole>('Vistoriador');
  const [newDispensado, setNewDispensado] = useState<boolean>(false);
  const [showNewDocsSection, setShowNewDocsSection] = useState<boolean>(false);
  const [newProfileDocs, setNewProfileDocs] = useState<
    Record<
      MandatoryDocType,
      {
        expiresAt: string;
        fileName: string;
        fileBase64: string;
        dispensado: boolean;
      }
    >
  >(() => {
    const init = {} as Record<
      MandatoryDocType,
      { expiresAt: string; fileName: string; fileBase64: string; dispensado: boolean }
    >;
    MANDATORY_USER_DOCUMENTS.forEach((m) => {
      init[m.type] = { expiresAt: '', fileName: '', fileBase64: '', dispensado: false };
    });
    return init;
  });

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const uniqueEquipes = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => {
      if (u.equipe && u.equipe.trim()) set.add(u.equipe.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  }, [users]);

  // Evaluate all users' document statuses and 30-day expiration alerts
  const usersWithDocEval = useMemo(() => {
    return users.map((u) => ({
      user: u,
      docSummary: evaluateUserOverallDocumentStatus(u),
    }));
  }, [users]);

  // All documents across non-exempt users that are Vencidos (< 0 days) or A Vencer (0..30 days)
  const expirationAlerts = useMemo(() => {
    const alerts: Array<{
      user: AmetaUser;
      doc: UserMandatoryDocument;
      status: 'VENCIDO' | 'A_VENCER';
      daysRemaining: number | null;
    }> = [];

    usersWithDocEval.forEach(({ user, docSummary }) => {
      if (docSummary.isUserDispensado) return;
      docSummary.evaluated.forEach((d) => {
        if (d.eval.status === 'VENCIDO' || d.eval.status === 'A_VENCER') {
          alerts.push({
            user,
            doc: d,
            status: d.eval.status,
            daysRemaining: d.eval.daysRemaining,
          });
        }
      });
    });

    return alerts.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'VENCIDO' ? -1 : 1;
      return (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999);
    });
  }, [usersWithDocEval]);

  const countsByRole = useMemo(() => {
    let adm = 0;
    let coordGeral = 0;
    let coordEng = 0;
    let executor = 0;
    let vistoriador = 0;
    let validado = 0;
    let aVencer = 0;
    let vencido = 0;
    let dispensado = 0;

    usersWithDocEval.forEach(({ user, docSummary }) => {
      const r = normalizeUserRole(user.role, user.email);
      if (r === 'ADM') adm++;
      else if (r === 'Coordenador Geral') coordGeral++;
      else if (r === 'Coordenador Engenharia') coordEng++;
      else if (r === 'Executor') executor++;
      else vistoriador++;

      if (docSummary.overallStatus === 'DISPENSADO') dispensado++;
      else if (docSummary.overallStatus === 'VENCIDO') vencido++;
      else if (docSummary.overallStatus === 'A VENCER') aVencer++;
      else validado++;
    });

    return {
      total: users.length,
      adm,
      coordGeral,
      coordEng,
      executor,
      vistoriador,
      validado,
      aVencer,
      vencido,
      dispensado,
    };
  }, [users.length, usersWithDocEval]);

  const filteredResources = useMemo(() => {
    return usersWithDocEval.filter(({ user: u, docSummary }) => {
      const r = normalizeUserRole(u.role);
      if (roleFilter !== 'ALL' && r !== roleFilter) return false;
      if (statusFilter !== 'ALL' && docSummary.overallStatus !== statusFilter) return false;
      if (equipeFilter !== 'ALL' && (u.equipe || '') !== equipeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchName = u.name.toLowerCase().includes(q);
        const matchEmail = u.email.toLowerCase().includes(q);
        const matchEquipe = (u.equipe || '').toLowerCase().includes(q);
        const matchTel = (u.telefone || '').toLowerCase().includes(q);
        const matchCpf = (u.cpf || '').toLowerCase().includes(q);
        return matchName || matchEmail || matchEquipe || matchTel || matchCpf;
      }
      return true;
    });
  }, [usersWithDocEval, roleFilter, statusFilter, equipeFilter, searchQuery]);

  const handleRoleChange = async (userId: string, role: UserRole, resourceName: string) => {
    setUpdatingUserId(userId);
    onUsersUpdated(
      users.map((u) => (u.id === userId ? { ...u, role } : u)),
      `Perfil de ${resourceName} alterado para ${role}`
    );
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          onUsersUpdated(data.users);
        }
      }
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleToggleUserDispensado = async (
    user: AmetaUser,
    nextDispensado: boolean
  ) => {
    setUpdatingUserId(user.id);
    const optimisticUsers = users.map((u) => {
      if (u.id !== user.id) return u;
      const cleanedDocs = ensureUserMandatoryDocuments(u.documents).map((d) =>
        nextDispensado && (d.statusOverride === 'VENCIDO' || d.statusOverride === 'A_VENCER')
          ? { ...d, statusOverride: undefined }
          : d
      );
      const nextUser: AmetaUser = {
        ...u,
        dispensadoDocumentos: nextDispensado,
        documents: cleanedDocs,
        statusRecurso: nextDispensado ? 'DISPENSADO' : 'VALIDADO',
      };
      nextUser.statusRecurso = evaluateUserOverallDocumentStatus(nextUser).overallStatus;
      return nextUser;
    });
    onUsersUpdated(
      optimisticUsers,
      nextDispensado
        ? `${user.name} marcado como Dispensado de Documentos`
        : `Exigência de documentos reativada para ${user.name}`
    );
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispensadoDocumentos: nextDispensado,
          statusRecurso: nextDispensado ? 'DISPENSADO' : 'VALIDADO',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          onUsersUpdated(data.users);
        }
      }
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleStatusChange = async (
    userId: string,
    statusRecurso: 'VALIDADO' | 'A VENCER' | 'VENCIDO' | 'DISPENSADO',
    resourceName: string
  ) => {
    setUpdatingUserId(userId);
    const isNextDispensado = statusRecurso === 'DISPENSADO';
    const optimisticUsers = users.map((u) => {
      if (u.id !== userId) return u;
      const cleanedDocs = ensureUserMandatoryDocuments(u.documents).map((d) => {
        if (statusRecurso === 'VALIDADO' || isNextDispensado) {
          const nextOverride =
            d.statusOverride === 'VENCIDO' || d.statusOverride === 'A_VENCER'
              ? undefined
              : d.statusOverride;
          let nextExpires = d.expiresAt || '';
          if (statusRecurso === 'VALIDADO' && nextExpires) {
            const evalCheck = evaluateDocumentExpiration(
              { ...d, statusOverride: nextOverride },
              false
            );
            if (evalCheck.status === 'VENCIDO' || evalCheck.status === 'A_VENCER') {
              nextExpires = '';
            }
          }
          return { ...d, statusOverride: nextOverride, expiresAt: nextExpires };
        }
        return d;
      });
      const nextUser: AmetaUser = {
        ...u,
        dispensadoDocumentos: isNextDispensado,
        documents: cleanedDocs,
        statusRecurso,
      };
      nextUser.statusRecurso = evaluateUserOverallDocumentStatus(nextUser).overallStatus;
      return nextUser;
    });
    onUsersUpdated(optimisticUsers, `Status de ${resourceName} alterado para ${statusRecurso}`);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusRecurso,
          dispensadoDocumentos: isNextDispensado,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          onUsersUpdated(data.users);
        }
      }
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleUpdateUserDocument = async (
    userId: string,
    docType: MandatoryDocType,
    payload: {
      fileName?: string;
      fileBase64?: string;
      expiresAt?: string;
      statusOverride?: 'VALIDADO' | 'A_VENCER' | 'VENCIDO' | 'DISPENSADO' | '';
      clearFile?: boolean;
      reExtractFromStoredFile?: boolean;
    },
    toastMessage?: string
  ) => {
    const key = `${userId}-${docType}`;
    setUploadingKey(key);

    // Immediate optimistic update in UI so removing or updating an expired document reflects in 0ms
    if (!payload.fileBase64 && !payload.reExtractFromStoredFile) {
      const optimisticUsers = users.map((u) => {
        if (u.id !== userId) return u;
        const nextDocs = ensureUserMandatoryDocuments(u.documents).map((d) => {
          if (d.type !== docType) return d;
          const copy = { ...d };
          if (payload.clearFile) {
            copy.fileName = '';
            copy.fileSize = 0;
            copy.uploadedAt = '';
            copy.uploadedBy = '';
            copy.storageFileName = '';
            copy.expiresAt = '';
            copy.statusOverride = undefined;
            copy.notes = '';
          }
          if (typeof payload.expiresAt === 'string') {
            copy.expiresAt = payload.expiresAt.trim();
            if (payload.statusOverride === undefined && copy.statusOverride !== 'DISPENSADO') {
              copy.statusOverride = undefined;
            }
          }
          if (payload.statusOverride !== undefined) {
            copy.statusOverride = payload.statusOverride ? payload.statusOverride : undefined;
            if (
              payload.statusOverride !== 'VENCIDO' &&
              typeof payload.expiresAt !== 'string' &&
              copy.expiresAt
            ) {
              const evalCheck = evaluateDocumentExpiration(
                { ...copy, statusOverride: undefined },
                false
              );
              if (evalCheck.status === 'VENCIDO') {
                copy.expiresAt = '';
              }
            }
          }
          return copy;
        });
        const nextUser: AmetaUser = {
          ...u,
          documents: nextDocs,
        };
        nextUser.statusRecurso = evaluateUserOverallDocumentStatus(nextUser).overallStatus;
        return nextUser;
      });
      onUsersUpdated(optimisticUsers, toastMessage);
    }

    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/documents`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType,
          ...payload,
          uploadedBy: currentUser.name,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          const autoMsg =
            data.autoExtracted?.expiresAt
              ? `📎 ${docType}: Data de vencimento preenchida automaticamente (${formatDateBr(
                  data.autoExtracted.expiresAt
                )})`
              : payload.fileBase64 || payload.reExtractFromStoredFile
              ? toastMessage
              : undefined;
          onUsersUpdated(data.users, autoMsg);
        }
      }
    } finally {
      setUploadingKey(null);
    }
  };

  const resetNewResourceForm = () => {
    setName('');
    setEmail('');
    setTelefone('');
    setCpf('');
    setRg('');
    setEquipe('');
    setPassword('ameta2026');
    setNewRole('Vistoriador');
    setNewDispensado(false);
    setShowNewDocsSection(false);
    const cleanDocs = {} as Record<
      MandatoryDocType,
      { expiresAt: string; fileName: string; fileBase64: string; dispensado: boolean }
    >;
    MANDATORY_USER_DOCUMENTS.forEach((m) => {
      cleanDocs[m.type] = { expiresAt: '', fileName: '', fileBase64: '', dispensado: false };
    });
    setNewProfileDocs(cleanDocs);
  };

  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const documentsPayload = MANDATORY_USER_DOCUMENTS.map((meta) => {
        const entry = newProfileDocs[meta.type];
        return {
          type: meta.type,
          label: meta.label,
          expiresAt: entry?.expiresAt || '',
          fileName: entry?.fileName || '',
          fileBase64: entry?.fileBase64 || '',
          statusOverride: entry?.dispensado ? 'DISPENSADO' : undefined,
        };
      });

      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          telefone: telefone.trim(),
          cpf: cpf.trim(),
          rg: rg.trim(),
          equipe: equipe.trim() || 'Campo',
          atividade: atividade.trim() || 'ACESSO | TX',
          password,
          role: newRole,
          dispensadoDocumentos: newDispensado,
          statusRecurso: newDispensado ? 'DISPENSADO' : 'VALIDADO',
          documents: documentsPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Erro ao cadastrar recurso.');
        return;
      }
      if (Array.isArray(data.users)) {
        onUsersUpdated(data.users, `Perfil ${name.trim()} cadastrado com sucesso`);
      }
      resetNewResourceForm();
      setAddModalOpen(false);
    } catch {
      setError('Falha de conexão com o servidor.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteResource = async (u: AmetaUser) => {
    if (u.email.toLowerCase() === 'rafael.araujo@ameta.com.br') return;
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(u.id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          onUsersUpdated(data.users, `Recurso ${u.name} removido`);
        }
      }
    } catch {
      // ignore error
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Minimalist Top Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">
              Recursos Cadastrados, Perfis & Controle de Documentos
            </h2>
            <p className="text-xs text-slate-500">
              Clique em <strong>Abrir Documentos</strong> em qualquer linha para abrir a tela oculta em colunas (NR 10, NR 35, ASO, PCMSO, PGR, 1º Socorros, Contrato, RG) ou marcar como <strong>Dispensado</strong>.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onTestUserView && (
            <>
              <button
                type="button"
                onClick={() => {
                  const vist =
                    users.find((u) => u.email.toLowerCase() === 'teste@ameta.com.br') ||
                    users.find((u) => normalizeUserRole(u.role) === 'Vistoriador');
                  if (vist) onTestUserView(vist);
                }}
                className="px-3 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                title="Simular tela de Vistoriador (8 colunas + SI Executed liberado)"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Testar Vistoriador</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const exec =
                    users.find((u) => u.email.toLowerCase() === 'executor.teste@ameta.com.br') ||
                    users.find((u) => normalizeUserRole(u.role) === 'Executor');
                  if (exec) onTestUserView(exec);
                }}
                className="px-3 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-800 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                title="Simular tela de Executor de Teste"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Testar Executor</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setError(null);
              resetNewResourceForm();
              setAddModalOpen(true);
            }}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Cadastrar Recurso</span>
          </button>
        </div>
      </div>

      {/* 30-Day Advance Expiration Alert Banner (only shows if any non-exempt document is expiring in <= 30 days or expired) */}
      {expirationAlerts.length > 0 && (
        <div className="bg-amber-50/90 border border-amber-300 rounded-xl p-3.5 space-y-2 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-bold text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Aviso de Vencimento (30 dias antes): {expirationAlerts.length} documento(s) a vencer ou vencidos
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono">
              <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200 font-bold">
                Vencidos: {expirationAlerts.filter((a) => a.status === 'VENCIDO').length}
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                A Vencer (≤ 30d): {expirationAlerts.filter((a) => a.status === 'A_VENCER').length}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {expirationAlerts.map((alert, i) => {
              const isExpired = alert.status === 'VENCIDO';
              return (
                <div
                  key={`${alert.user.id}-${alert.doc.type}-${i}`}
                  className={`px-2.5 py-1 rounded-lg border text-xs inline-flex items-center gap-2 transition-colors ${
                    isExpired
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-white border-amber-200 text-slate-900'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedUserId(alert.user.id)}
                    className="inline-flex items-center gap-1.5 cursor-pointer hover:underline text-left"
                  >
                    <span className="font-bold">{alert.user.name}:</span>
                    <span className="font-semibold">{alert.doc.label}</span>
                    <span className="font-mono text-[11px] opacity-80">
                      {alert.daysRemaining !== null
                        ? alert.daysRemaining < 0
                          ? `(Vencido há ${Math.abs(alert.daysRemaining)}d)`
                          : `(Vence em ${alert.daysRemaining}d)`
                        : `(${isExpired ? 'Vencido' : 'A Vencer'})`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateUserDocument(
                        alert.user.id,
                        alert.doc.type,
                        { clearFile: true, expiresAt: '', statusOverride: '' },
                        `Documento ${alert.doc.label} de ${alert.user.name} removido`
                      )
                    }
                    title={`Remover / limpar documento ${alert.doc.label} de ${alert.user.name}`}
                    className="p-0.5 rounded hover:bg-red-200/70 text-red-700 hover:text-red-950 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter Bar + Clean Resources Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Role Filter Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'ALL' as const, label: 'Todos os Recursos', count: countsByRole.total },
                { id: 'ADM' as const, label: 'ADM Dono', count: countsByRole.adm },
                {
                  id: 'Coordenador Geral' as const,
                  label: 'Coordenador Geral',
                  count: countsByRole.coordGeral,
                },
                {
                  id: 'Coordenador Engenharia' as const,
                  label: 'Coordenador Engenharia',
                  count: countsByRole.coordEng,
                },
                {
                  id: 'Executor' as const,
                  label: 'Executores',
                  count: countsByRole.executor,
                },
                {
                  id: 'Vistoriador' as const,
                  label: 'Vistoriadores',
                  count: countsByRole.vistoriador,
                },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRoleFilter(item.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                    roleFilter === item.id
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                  }`}
                >
                  <span>{item.label}</span>
                  <span
                    className={`ml-1.5 font-mono text-[11px] tabular-nums ${
                      roleFilter === item.id ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    ({item.count})
                  </span>
                </button>
              ))}
            </div>

            {/* Search & Equipe Filter */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-64 sm:w-72">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar recurso por nome, e-mail, equipe..."
                  className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                />
              </div>

              <select
                value={equipeFilter}
                onChange={(e) => setEquipeFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:border-blue-600"
              >
                <option value="ALL">Equipe: Todas ({uniqueEquipes.length})</option>
                {uniqueEquipes.map((eq) => (
                  <option key={eq} value={eq}>
                    {eq}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Status Filter Pills: Todos | Validado | A Vencer | Vencido | Dispensado */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-200/70 text-xs">
            <span className="text-[11px] font-semibold text-slate-500 mr-1">Status:</span>
            {[
              { id: 'ALL' as const, label: 'Todos', count: countsByRole.total },
              { id: 'VALIDADO' as const, label: 'Validado', count: countsByRole.validado },
              { id: 'A VENCER' as const, label: 'A Vencer (≤30d)', count: countsByRole.aVencer },
              { id: 'VENCIDO' as const, label: 'Vencido', count: countsByRole.vencido },
              { id: 'DISPENSADO' as const, label: 'Dispensado', count: countsByRole.dispensado },
            ].map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setStatusFilter(st.id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border cursor-pointer transition-colors whitespace-nowrap ${
                  statusFilter === st.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {st.label} ({st.count})
              </button>
            ))}
          </div>
        </div>

        {/* Clean Resources Table — Full Width with Zero Cutoff */}
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-white border-b border-slate-200 text-slate-500 font-semibold">
                <th className="py-2.5 pl-4 pr-2 w-10 text-center font-mono">#</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Recurso Cadastrado</th>
                <th className="py-2.5 px-3 whitespace-nowrap">E-mail / Contato</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Equipe / Atividade</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Controle de Documentos</th>
                <th className="py-2.5 pl-3 pr-5 text-right whitespace-nowrap">
                  Definir Perfil de Acesso
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredResources.map(({ user: u, docSummary }, idx) => {
                const uRole = normalizeUserRole(u.role);
                const isPrimaryAdmin = u.email.toLowerCase() === 'rafael.araujo@ameta.com.br';
                const isSelf = u.id === currentUser.id;
                const isUpdating = updatingUserId === u.id;
                const isExpanded = expandedUserId === u.id;
                const overallStatus = docSummary.overallStatus;

                return (
                  <React.Fragment key={u.id}>
                    {/* MAIN CLEAN ROW */}
                    <tr
                      className={`transition-colors ${
                        isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-3 pl-4 pr-2 text-center font-mono text-slate-400 tabular-nums">
                        {idx + 1}
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span className="font-bold text-slate-900">{u.name}</span>
                          {isSelf && (
                            <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">
                              Você
                            </span>
                          )}
                        </div>
                        {u.cpf && (
                          <div className="text-[11px] text-slate-400 font-mono whitespace-nowrap">
                            CPF: {u.cpf}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 text-slate-700 font-mono whitespace-nowrap">
                          <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{u.email}</span>
                        </div>
                        {u.telefone && (
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono mt-0.5 whitespace-nowrap">
                            <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{u.telefone}</span>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-800">{u.equipe || 'Campo'}</div>
                        {u.atividade && (
                          <div className="text-[11px] text-slate-500">{u.atividade}</div>
                        )}
                      </td>

                      {/* CLEAN INITIAL STATUS BADGE: Validado | A Vencer | Vencido | Dispensado */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {overallStatus === 'DISPENSADO' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300 whitespace-nowrap">
                            <UserCheck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span>Dispensado</span>
                          </span>
                        )}
                        {overallStatus === 'VALIDADO' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>Validado</span>
                          </span>
                        )}
                        {overallStatus === 'A VENCER' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-300 whitespace-nowrap">
                            <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>A Vencer ({docSummary.aVencer.length})</span>
                          </span>
                        )}
                        {overallStatus === 'VENCIDO' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 whitespace-nowrap">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                            <span>Vencido ({docSummary.vencidos.length})</span>
                          </span>
                        )}
                      </td>

                      {/* BUTTON TO OPEN HIDDEN COLUMN SCREEN ("tela oculta") */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedUserId((prev) => (prev === u.id ? null : u.id))
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                            isExpanded
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-[#F3F4F6] hover:bg-slate-200/80 text-slate-700 border-slate-200'
                          }`}
                        >
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {isExpanded ? 'Ocultar Documentos' : 'Abrir Documentos'}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                          )}
                        </button>
                      </td>

                      <td className="py-3 pl-3 pr-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-2 flex-nowrap">
                          {/* Direct Profile Selector for this Resource (ADM Dono exclusive to Rafael Araújo) */}
                          {isPrimaryAdmin ? (
                            <span className="px-3 py-1 bg-amber-500 text-slate-950 font-black text-xs rounded-lg shadow-2xs">
                              ADM Dono (Único)
                            </span>
                          ) : (
                            <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg shrink-0">
                              {ROLE_OPTIONS.map((opt) => {
                                const active = uRole === opt.role;
                                return (
                                  <button
                                    key={opt.role}
                                    type="button"
                                    disabled={isUpdating}
                                    onClick={() => handleRoleChange(u.id, opt.role, u.name)}
                                    title={opt.description}
                                    className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                                      active
                                        ? opt.role === 'Coordenador Geral'
                                          ? 'bg-indigo-600 text-white'
                                          : opt.role === 'Coordenador Engenharia'
                                          ? 'bg-teal-600 text-white'
                                          : opt.role === 'Executor'
                                          ? 'bg-blue-600 text-white'
                                          : 'bg-amber-500 text-white'
                                        : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {!isPrimaryAdmin && onTestUserView && (
                            <button
                              type="button"
                              onClick={() => onTestUserView(u)}
                              className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                              title="Ver tela exatamente como este usuário (Sites e Documentos)"
                            >
                              <Eye className="w-3.5 h-3.5 shrink-0" />
                              <span>Ver Tela Dele</span>
                            </button>
                          )}

                          {!isPrimaryAdmin && (
                            <button
                              type="button"
                              onClick={() => handleDeleteResource(u)}
                              className="p-1.5 text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-lg transition-colors inline-flex items-center justify-center text-xs font-semibold cursor-pointer shrink-0"
                              title="Excluir este usuário"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* =========================================================
                        TELA OCULTA EM COLUNAS (ABRE AO APERTAR "ABRIR DOCUMENTOS")
                        SEM CORTAR NADA — CABE 100% NA LARGURA DA TELA
                       ========================================================= */}
                    {isExpanded && (
                      <tr className="bg-[#F3F4F6]/80 border-b border-slate-200">
                        <td colSpan={7} className="p-3 sm:p-4">
                          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                            {/* Top Control Bar inside the Hidden Screen */}
                            <div className="px-4 py-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
                              <div className="flex flex-wrap items-center gap-3">
                                <span className="text-xs font-bold">
                                  Documentos de {u.name}
                                </span>
                                <span className="text-[11px] text-slate-300">
                                  Aviso automático 30 dias antes do vencimento
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {/* Option for People Exempt from Documents ("opção para pessoas que estão dispensadas desses documentos") */}
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() =>
                                    handleToggleUserDispensado(
                                      u,
                                      !docSummary.isUserDispensado
                                    )
                                  }
                                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                                    docSummary.isUserDispensado
                                      ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500'
                                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                                  }`}
                                >
                                  <UserCheck className="w-3.5 h-3.5" />
                                  <span>
                                    {docSummary.isUserDispensado
                                      ? '✓ Pessoa Dispensada de Documentos (Clique p/ Exigir)'
                                      : 'Dispensar Pessoa de Todos os Documentos'}
                                  </span>
                                </button>

                                {/* Manual Overall Status Selector */}
                                <select
                                  value={overallStatus}
                                  disabled={isUpdating}
                                  onChange={(e) =>
                                    handleStatusChange(
                                      u.id,
                                      e.target.value as
                                        | 'VALIDADO'
                                        | 'A VENCER'
                                        | 'VENCIDO'
                                        | 'DISPENSADO',
                                      u.name
                                    )
                                  }
                                  className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-white focus:outline-none cursor-pointer"
                                >
                                  <option value="VALIDADO">Status: Validado</option>
                                  <option value="A VENCER">Status: A Vencer</option>
                                  <option value="VENCIDO">Status: Vencido</option>
                                  <option value="DISPENSADO">Status: Dispensado</option>
                                </select>
                              </div>
                            </div>

                            {/* 8 DOCUMENTS DISPLAYED IN COLUMNS WITHOUT CUTTING OFF */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-white">
                              {docSummary.evaluated.map((doc) => {
                                const isUploadingThis =
                                  uploadingKey === `${u.id}-${doc.type}`;
                                const days = doc.eval.daysRemaining;
                                const isDocDispensado =
                                  docSummary.isUserDispensado ||
                                  doc.statusOverride === 'DISPENSADO';
                                const shortTitle =
                                  MANDATORY_USER_DOCUMENTS.find((m) => m.type === doc.type)
                                    ?.shortLabel || doc.label;

                                return (
                                  <div
                                    key={doc.type}
                                    className={`flex flex-col min-w-0 ${
                                      isDocDispensado ? 'bg-slate-50/70' : 'bg-white'
                                    }`}
                                  >
                                    {/* Column Header */}
                                    <div className="px-2.5 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between gap-1">
                                      <span
                                        className="font-bold text-slate-800 text-[11px] truncate"
                                        title={doc.label}
                                      >
                                        {shortTitle}
                                      </span>
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold shrink-0 ${
                                          doc.eval.status === 'DISPENSADO'
                                            ? 'bg-slate-200 text-slate-700'
                                            : doc.eval.status === 'VENCIDO'
                                            ? 'bg-red-100 text-red-800'
                                            : doc.eval.status === 'A_VENCER'
                                            ? 'bg-amber-100 text-amber-900'
                                            : doc.eval.status === 'VALIDADO'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : 'bg-slate-200/70 text-slate-500'
                                        }`}
                                      >
                                        {doc.eval.statusLabel}
                                      </span>
                                    </div>

                                    {/* Column Body */}
                                    <div className="p-2.5 space-y-2 flex-1 flex flex-col justify-between">
                                      <div className="space-y-2">
                                        {/* 1. Status / Dispensar este documento específico */}
                                        <div>
                                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">
                                            Situação
                                          </label>
                                          <select
                                            disabled={docSummary.isUserDispensado}
                                            value={
                                              isDocDispensado
                                                ? 'DISPENSADO'
                                                : doc.statusOverride ||
                                                  (doc.eval.status === 'PENDENTE'
                                                    ? ''
                                                    : doc.eval.status)
                                            }
                                            onChange={(e) =>
                                              handleUpdateUserDocument(
                                                u.id,
                                                doc.type,
                                                {
                                                  statusOverride: e.target.value as
                                                    | 'VALIDADO'
                                                    | 'A_VENCER'
                                                    | 'VENCIDO'
                                                    | 'DISPENSADO'
                                                    | '',
                                                },
                                                `Situação de ${doc.label} (${u.name}) atualizada`
                                              )
                                            }
                                            className="w-full px-1.5 py-1 bg-[#F3F4F6] border border-slate-200 rounded text-[11px] font-semibold text-slate-800 focus:outline-none focus:border-blue-600"
                                          >
                                            <option value="">Automático</option>
                                            <option value="VALIDADO">Validado</option>
                                            <option value="A_VENCER">A Vencer</option>
                                            <option value="VENCIDO">Vencido</option>
                                            <option value="DISPENSADO">Dispensado</option>
                                          </select>
                                        </div>

                                        {/* 2. Data de Vencimento (Preenchida Automaticamente ao fazer Upload) */}
                                        <div>
                                          <div className="flex items-center justify-between gap-1 mb-0.5">
                                            <label className="block text-[10px] font-semibold text-slate-400 uppercase">
                                              Vencimento
                                            </label>
                                            {doc.storageFileName && !isDocDispensado && (
                                              <button
                                                type="button"
                                                disabled={isUploadingThis}
                                                onClick={() =>
                                                  handleUpdateUserDocument(
                                                    u.id,
                                                    doc.type,
                                                    { reExtractFromStoredFile: true },
                                                    `Vencimento lido do documento ${doc.label}`
                                                  )
                                                }
                                                className="text-[9px] font-semibold text-blue-600 hover:underline cursor-pointer"
                                                title="Ler novamente a data de vencimento do arquivo anexado"
                                              >
                                                Auto-ler
                                              </button>
                                            )}
                                          </div>
                                          <input
                                            type="date"
                                            disabled={isDocDispensado}
                                            value={doc.expiresAt || ''}
                                            onChange={(e) =>
                                              handleUpdateUserDocument(
                                                u.id,
                                                doc.type,
                                                { expiresAt: e.target.value },
                                                `Vencimento de ${doc.label} (${u.name}) atualizado`
                                              )
                                            }
                                            className="w-full px-1.5 py-1 bg-[#F3F4F6] border border-slate-200 rounded text-[11px] font-mono text-slate-800 disabled:opacity-50 focus:bg-white focus:outline-none focus:border-blue-600"
                                          />
                                          {!isDocDispensado && days !== null && (
                                            <div
                                              className={`mt-1 text-[10px] font-mono font-semibold ${
                                                days < 0
                                                  ? 'text-red-600'
                                                  : days <= 30
                                                  ? 'text-amber-700'
                                                  : 'text-emerald-700'
                                              }`}
                                            >
                                              {days < 0
                                                ? `Vencido há ${Math.abs(days)}d`
                                                : days === 0
                                                ? 'Vence HOJE!'
                                                : days <= 30
                                                ? `⚠️ Vence em ${days}d`
                                                : `Válido (${days}d)`}
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* 3. Arquivo / Upload (Lê e preenche o vencimento automaticamente) */}
                                      <div className="pt-2 border-t border-slate-100 space-y-1.5">
                                        {doc.fileName ? (
                                          <div
                                            className="text-[10px] font-mono text-blue-700 truncate"
                                            title={doc.notes ? `${doc.fileName} — ${doc.notes}` : doc.fileName}
                                          >
                                            📎 {doc.fileName}
                                          </div>
                                        ) : (
                                          <div className="text-[10px] text-slate-400 italic">
                                            Upload lê vencimento
                                          </div>
                                        )}

                                        <div className="flex items-center gap-1">
                                          <label
                                            className={`flex-1 py-1 px-2 rounded text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                                              isUploadingThis
                                                ? 'bg-blue-100 text-blue-800'
                                                : 'bg-slate-900 hover:bg-slate-800 text-white'
                                            }`}
                                          >
                                            <Upload className="w-3 h-3 shrink-0" />
                                            <span className="truncate">
                                              {isUploadingThis
                                                ? 'Lendo...'
                                                : doc.fileName
                                                ? 'Trocar'
                                                : 'Upload'}
                                            </span>
                                            <input
                                              type="file"
                                              className="hidden"
                                              disabled={isUploadingThis}
                                              onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                const b64 = await readFileAsBase64(file);
                                                await handleUpdateUserDocument(
                                                  u.id,
                                                  doc.type,
                                                  {
                                                    fileName: file.name,
                                                    fileBase64: b64,
                                                  },
                                                  `Arquivo ${file.name} enviado em ${doc.label} (${u.name})`
                                                );
                                                e.target.value = '';
                                              }}
                                            />
                                          </label>

                                          {doc.storageFileName && (
                                            <a
                                              href={`/api/admin/users/${encodeURIComponent(
                                                u.id
                                              )}/documents/${encodeURIComponent(
                                                doc.type
                                              )}/download`}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="p-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded shrink-0"
                                              title={`Baixar ${doc.fileName}`}
                                            >
                                              <Download className="w-3.5 h-3.5" />
                                            </a>
                                          )}

                                          {(Boolean(doc.fileName) ||
                                            Boolean(doc.expiresAt) ||
                                            Boolean(doc.statusOverride) ||
                                            doc.eval.status === 'VENCIDO' ||
                                            doc.eval.status === 'A_VENCER') && (
                                            <button
                                              type="button"
                                              disabled={isUploadingThis}
                                              onClick={() =>
                                                handleUpdateUserDocument(
                                                  u.id,
                                                  doc.type,
                                                  {
                                                    clearFile: true,
                                                    expiresAt: '',
                                                    statusOverride: '',
                                                  },
                                                  `Documento ${doc.label} (${u.name}) removido`
                                                )
                                              }
                                              className="p-1 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-800 border border-red-200 rounded shrink-0 cursor-pointer"
                                              title={`Remover / limpar ${doc.label}`}
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {filteredResources.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Nenhum recurso encontrado para o filtro selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Cadastrar Novo Recurso (com opção de Dispensado e Tela Oculta de Documentos) */}
      {addModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]"
          onClick={() => setAddModalOpen(false)}
        >
          <div
            className="w-full max-w-4xl bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">Cadastrar Novo Recurso</h3>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleCreateResource}
              className="p-5 space-y-4 overflow-y-auto flex-1"
            >
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nome Completo do Recurso *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Magno Rodolfo dos Santos Ribeiro"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    E-mail *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="recurso@ametaservicos.com.br"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 font-mono focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Telefone
                  </label>
                  <input
                    type="text"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="11 99999-0000"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 font-mono focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    CPF
                  </label>
                  <input
                    type="text"
                    value={cpf}
                    onChange={(e) => setCpf(e.target.value)}
                    placeholder="000.000.000-00"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 font-mono focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Equipe / Dupla
                  </label>
                  <input
                    type="text"
                    value={equipe}
                    onChange={(e) => setEquipe(e.target.value)}
                    placeholder="Ex: Magno / Mateus"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Senha Inicial *
                  </label>
                  <input
                    type="text"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 font-mono focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Perfil de Acesso *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {ROLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.role}
                      type="button"
                      onClick={() => setNewRole(opt.role)}
                      className={`py-2 px-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                        newRole === opt.role
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <div>{opt.label}</div>
                      <div className="text-[10px] font-normal opacity-80">
                        {opt.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Exemption + Collapsible Columnar Document Section */}
              <div className="pt-2 border-t border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={newDispensado}
                      onChange={(e) => setNewDispensado(e.target.checked)}
                      className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span>
                      Esta pessoa está <strong>Dispensada</strong> desses documentos (NR 10, NR 35, ASO, PCMSO, PGR, 1º Socorros, Contrato, RG)
                    </span>
                  </label>

                  {!newDispensado && (
                    <button
                      type="button"
                      onClick={() => setShowNewDocsSection((prev) => !prev)}
                      className="px-3 py-1.5 bg-[#F3F4F6] hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>
                        {showNewDocsSection
                          ? 'Ocultar Colunas de Documentos'
                          : 'Abrir Colunas de Documentos (8 Obrigatórios)'}
                      </span>
                      {showNewDocsSection ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {!newDispensado && showNewDocsSection && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                    {MANDATORY_USER_DOCUMENTS.map((meta) => {
                      const docState = newProfileDocs[meta.type];
                      return (
                        <div key={meta.type} className="flex flex-col min-w-0 border-b border-slate-200">
                          <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 font-bold text-slate-700 text-xs flex items-center justify-between">
                            <span>{meta.label}</span>
                            <label className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(docState?.dispensado)}
                                onChange={(e) =>
                                  setNewProfileDocs((prev) => ({
                                    ...prev,
                                    [meta.type]: {
                                      ...prev[meta.type],
                                      dispensado: e.target.checked,
                                    },
                                  }))
                                }
                              />
                              <span>Dispensado</span>
                            </label>
                          </div>

                          <div className="p-2.5 space-y-2 flex-1">
                            {docState?.dispensado ? (
                              <div className="text-[11px] text-slate-400 italic py-2">
                                Documento dispensado
                              </div>
                            ) : (
                              <>
                                <div>
                                  <label className="block text-[10px] text-slate-400 mb-0.5">
                                    Vencimento
                                  </label>
                                  <input
                                    type="date"
                                    value={docState?.expiresAt || ''}
                                    onChange={(e) =>
                                      setNewProfileDocs((prev) => ({
                                        ...prev,
                                        [meta.type]: {
                                          ...prev[meta.type],
                                          expiresAt: e.target.value,
                                        },
                                      }))
                                    }
                                    className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono"
                                  />
                                </div>

                                <label className="w-full py-1 px-2 bg-slate-900 hover:bg-slate-800 text-white rounded text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer">
                                  <Upload className="w-3 h-3 shrink-0" />
                                  <span className="truncate">
                                    {uploadingKey === `new-${meta.type}`
                                      ? 'Lendo data...'
                                      : docState?.fileName
                                      ? docState.fileName
                                      : 'Upload (Auto-venc.)'}
                                  </span>
                                  <input
                                    type="file"
                                    className="hidden"
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      const b64 = await readFileAsBase64(file);
                                      setUploadingKey(`new-${meta.type}`);
                                      let detectedExpiresAt = docState?.expiresAt || '';
                                      try {
                                        const res = await fetch(
                                          '/api/admin/documents/extract-expiration',
                                          {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                              docType: meta.type,
                                              fileName: file.name,
                                              fileBase64: b64,
                                            }),
                                          }
                                        );
                                        if (res.ok) {
                                          const extData = await res.json();
                                          if (extData.expiresAt) {
                                            detectedExpiresAt = extData.expiresAt;
                                          }
                                        }
                                      } catch {
                                        // fallback handled on save
                                      } finally {
                                        setUploadingKey(null);
                                      }
                                      setNewProfileDocs((prev) => ({
                                        ...prev,
                                        [meta.type]: {
                                          ...prev[meta.type],
                                          fileName: file.name,
                                          fileBase64: b64,
                                          expiresAt: detectedExpiresAt,
                                        },
                                      }));
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {saving ? 'Salvando...' : 'Salvar Recurso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
