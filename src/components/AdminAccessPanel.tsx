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
  RefreshCw,
} from 'lucide-react';
import {
  AmetaUser,
  UserRole,
  UserSituacao,
  AssignedPlatformScope,
  normalizeUserRole,
  isOwnerAdmUser,
  isUserDono,
  MandatoryDocType,
  UserMandatoryDocument,
  MANDATORY_USER_DOCUMENTS,
  ensureUserMandatoryDocuments,
  evaluateDocumentExpiration,
  evaluateUserOverallDocumentStatus,
} from '../types/telecom';
import { dataService, sanitizeFirestoreData } from '../services/dataService';
import {
  analyzeDocumentValidity,
  DEFAULT_DOC_DURATIONS,
  addMonthsToIsoDate,
} from '../utils/documentOcrUtils';
import { db, firebaseConfig, handleFirestoreError, OperationType, createAuthAccountSecondary } from '../lib/firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

interface AdminAccessPanelProps {
  currentUser: AmetaUser;
  users?: AmetaUser[];
  onUsersUpdated?: (nextUsers: AmetaUser[], toastMsg?: string) => void;
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

async function extractOrCalculateDocumentExpiration(
  file: File,
  docType: MandatoryDocType
): Promise<{
  expiresAt: string;
  origin: string;
}> {
  let expiresAt = '';
  let origin = '';

  try {
    const { result } = await analyzeDocumentValidity(file, docType);
    if (result && result.suggestedDate) {
      expiresAt = result.suggestedDate;
      origin = result.originDescription || 'Lida do documento';
    }
  } catch (ocrErr) {
    console.warn('Erro na análise OCR do documento:', ocrErr);
  }

  if (!expiresAt) {
    const defaultMonths = DEFAULT_DOC_DURATIONS[docType] || 12;
    const todayIso = new Date().toISOString().split('T')[0];
    expiresAt = addMonthsToIsoDate(todayIso, defaultMonths);
    origin = `Calculada pelo prazo padrão (${defaultMonths} meses a partir do envio)`;
  }

  return { expiresAt, origin };
}

export const AdminAccessPanel: React.FC<AdminAccessPanelProps> = ({
  currentUser,
  users: initialUsers = [],
  onUsersUpdated,
  onTestUserView,
  initialExpandedUserId,
}) => {
  const [firestoreUsers, setFirestoreUsers] = useState<AmetaUser[] | null>(null);
  const [firestoreError, setFirestoreError] = useState<{ code: string; message: string } | null>(null);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);

  // Leitura direta e em tempo real da coleção "usuarios" no Firestore sem nenhum filtro de plataforma ou role
  useEffect(() => {
    setIsLoadingUsers(true);
    setFirestoreError(null);

    // Auto-sync initial users from initial-db.json if missing in Firestore
    dataService.sincronizarUsuariosIniciais().catch((err) => {
      console.warn('Erro na sincronização automática de usuários:', err);
    });

    const usuariosCol = collection(db, 'usuarios');
    const unsubscribe = onSnapshot(
      usuariosCol,
      (snapshot) => {
        const loaded: AmetaUser[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            uid: docSnap.id,
            ...data,
          } as AmetaUser;
        });
        setFirestoreUsers(loaded);
        setIsLoadingUsers(false);
        if (onUsersUpdated) {
          onUsersUpdated(loaded);
        }
      },
      (err: any) => {
        console.error('Erro no onSnapshot da coleção usuarios:', err);
        setFirestoreError({
          code: err?.code || 'permission-denied',
          message: err?.message || 'Falha ao ler coleção usuarios no Firestore.',
        });
        setIsLoadingUsers(false);
        try {
          handleFirestoreError(err, OperationType.LIST, 'usuarios');
        } catch {}
      }
    );

    return () => unsubscribe();
  }, []);

  const users = useMemo(() => {
    return firestoreUsers !== null ? firestoreUsers : initialUsers;
  }, [firestoreUsers, initialUsers]);

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

  const pendingApprovalUsers = useMemo(() => {
    return users.filter(
      (u) =>
        !isOwnerAdmUser(u.email, u.situacao) &&
        (u.situacao === 'aguardando' || u.situacao === 'bloqueado' || u.accessReleased === false)
    );
  }, [users]);

  const [pendingDrafts, setPendingDrafts] = useState<
    Record<
      string,
      {
        role: UserRole;
        plataforma: AssignedPlatformScope;
        equipe: string;
      }
    >
  >({});
  const [confirmedApprovals, setConfirmedApprovals] = useState<Record<string, boolean>>({});

  const getPendingDraft = (u: AmetaUser) => {
    const key = u.email.toLowerCase();
    return (
      pendingDrafts[key] || {
        role: normalizeUserRole(u.role, u.email),
        plataforma: (u.assignedPlatform || u.plataforma || 'NOKIA') as AssignedPlatformScope,
        equipe: u.equipe || u.name || '',
      }
    );
  };

  const updatePendingDraft = (
    u: AmetaUser,
    patch: Partial<{ role: UserRole; plataforma: AssignedPlatformScope; equipe: string }>
  ) => {
    const key = u.email.toLowerCase();
    const cur = getPendingDraft(u);
    setPendingDrafts((prev) => ({
      ...prev,
      [key]: { ...cur, ...patch },
    }));
  };

  const handleApprovePendingUser = async (target: AmetaUser) => {
    const userKey = (target.id || target.email).toLowerCase();
    if (!confirmedApprovals[userKey]) {
      setError(`Obrigatório confirmar a Função e a Plataforma antes de liberar o acesso de ${target.name}.`);
      return;
    }
    const draft = getPendingDraft(target);
    const resolvedEquipe =
      draft.equipe.trim() ||
      (draft.role.includes('Coordenador') ? `Coordenação ${draft.plataforma}` : target.name);
    setUpdatingUserId(target.id);
    try {
      await dataService.atualizarPermissoesUsuario(target.uid || target.id, {
        email: target.email,
        name: target.name,
        situacao: 'ativo',
        role: draft.role,
        plataforma: draft.plataforma,
        equipe: resolvedEquipe,
      });
      if (onUsersUpdated) {
        onUsersUpdated(
          users.map((u) =>
            u.id === target.id || (u.email && target.email && u.email.toLowerCase() === target.email.toLowerCase())
              ? {
                  ...u,
                  role: draft.role,
                  plataforma: draft.plataforma,
                  assignedPlatform: draft.plataforma,
                  equipe: resolvedEquipe,
                  situacao: 'ativo',
                  accessReleased: true,
                }
              : u
          ),
          `Acesso de ${target.name} liberado como ${draft.role} (Plataforma: ${draft.plataforma} · Dupla/Equipe: ${resolvedEquipe})!`
        );
      }
    } catch (err: any) {
      console.error('Erro ao aprovar usuário:', err);
      setError(`Erro ao liberar acesso no Firestore: ${err?.message || err}`);
    } finally {
      setUpdatingUserId(null);
    }
  };

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

  // Sort users so that pending ('aguardando' or accessReleased === false) are at the TOP
  const sortedUsersWithDocEval = useMemo(() => {
    return [...usersWithDocEval].sort((a, b) => {
      const aPending = a.user.situacao === 'aguardando' || a.user.accessReleased === false;
      const bPending = b.user.situacao === 'aguardando' || b.user.accessReleased === false;
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;
      const aDono = isOwnerAdmUser(a.user.email, a.user.situacao);
      const bDono = isOwnerAdmUser(b.user.email, b.user.situacao);
      if (aDono && !bDono) return -1;
      if (!aDono && bDono) return 1;
      return (a.user.name || '').localeCompare(b.user.name || '', 'pt-BR');
    });
  }, [usersWithDocEval]);

  const filteredResources = useMemo(() => {
    return sortedUsersWithDocEval.filter(({ user: u, docSummary }) => {
      const r = normalizeUserRole(u.role);
      if (roleFilter !== 'ALL' && r !== roleFilter) return false;
      if (statusFilter !== 'ALL' && docSummary.overallStatus !== statusFilter) return false;
      if (equipeFilter !== 'ALL' && (u.equipe || '') !== equipeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchName = (u.name || '').toLowerCase().includes(q);
        const matchEmail = (u.email || '').toLowerCase().includes(q);
        const matchEquipe = (u.equipe || '').toLowerCase().includes(q);
        const matchTel = (u.telefone || '').toLowerCase().includes(q);
        const matchCpf = (u.cpf || '').toLowerCase().includes(q);
        return matchName || matchEmail || matchEquipe || matchTel || matchCpf;
      }
      return true;
    });
  }, [sortedUsersWithDocEval, roleFilter, statusFilter, equipeFilter, searchQuery]);

  const handleRoleChange = async (userId: string, role: UserRole, resourceName: string) => {
    setUpdatingUserId(userId);
    const target = users.find((u) => u.id === userId);
    try {
      if (target) {
        await dataService.atualizarPermissoesUsuario(target.uid || target.id, {
          email: target.email,
          name: target.name,
          situacao: target.situacao === 'dono' ? 'dono' : 'ativo',
          role,
          plataforma: target.plataforma || target.assignedPlatform || 'NOKIA',
          equipe: target.equipe,
        });
        if (onUsersUpdated) {
          onUsersUpdated(
            users.map((u) =>
              u.id === userId
                ? {
                    ...u,
                    role,
                    situacao: u.situacao === 'dono' ? 'dono' : 'ativo',
                    accessReleased: true,
                  }
                : u
            ),
            `Perfil de ${resourceName} alterado para ${role}`
          );
        }
      }
    } catch (err: any) {
      console.error('Erro ao alterar perfil:', err);
      setError(`Erro ao atualizar perfil no Firestore: ${err?.message || err}`);
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handlePlatformAndSituacaoChange = async (
    target: AmetaUser,
    nextPlatform: AssignedPlatformScope,
    nextSituacao: UserSituacao
  ) => {
    setUpdatingUserId(target.id);
    const nextReleased = nextSituacao === 'ativo' || nextSituacao === 'dono';
    try {
      await dataService.atualizarPermissoesUsuario(target.uid || target.id, {
        email: target.email,
        name: target.name,
        situacao: nextSituacao,
        role: normalizeUserRole(target.role, target.email),
        plataforma: nextPlatform,
        equipe: target.equipe,
      });
      if (onUsersUpdated) {
        onUsersUpdated(
          users.map((u) =>
            u.id === target.id
              ? {
                  ...u,
                  plataforma: nextPlatform,
                  assignedPlatform: nextPlatform,
                  situacao: nextSituacao,
                  accessReleased: nextReleased,
                }
              : u
          ),
          `Permissão de ${target.name} atualizada (${nextPlatform} · ${nextSituacao.toUpperCase()})`
        );
      }
    } catch (err: any) {
      console.error('Erro ao atualizar permissão:', err);
      setError(`Erro ao atualizar permissão no Firestore: ${err?.message || err}`);
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleToggleUserDispensado = async (
    user: AmetaUser,
    nextDispensado: boolean
  ) => {
    setUpdatingUserId(user.id);
    const cleanedDocs = ensureUserMandatoryDocuments(user.documents).map((d) =>
      nextDispensado && (d.statusOverride === 'VENCIDO' || d.statusOverride === 'A_VENCER')
        ? { ...d, statusOverride: undefined }
        : d
    );
    const nextUser: AmetaUser = {
      ...user,
      dispensadoDocumentos: nextDispensado,
      documents: cleanedDocs,
      statusRecurso: nextDispensado ? 'DISPENSADO' : 'VALIDADO',
    };
    nextUser.statusRecurso = evaluateUserOverallDocumentStatus(nextUser).overallStatus;
    try {
      await dataService.salvarDocumentosUsuario({
        uidOrId: user.uid || user.id,
        email: user.email,
        documents: cleanedDocs,
        dispensadoDocumentos: nextDispensado,
        statusRecurso: nextUser.statusRecurso,
      });
      if (onUsersUpdated) {
        onUsersUpdated(
          users.map((u) => (u.id === user.id ? nextUser : u)),
          nextDispensado
            ? `${user.name} marcado como Dispensado de Documentos`
            : `Exigência de documentos reativada para ${user.name}`
        );
      }
    } catch (err: any) {
      console.error('Erro ao alternar dispensa:', err);
      setError(`Erro ao salvar no Firestore: ${err?.message || err}`);
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
    const target = users.find((u) => u.id === userId);
    if (!target) {
      setUpdatingUserId(null);
      return;
    }
    const cleanedDocs = ensureUserMandatoryDocuments(target.documents).map((d) => {
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
      ...target,
      dispensadoDocumentos: isNextDispensado,
      documents: cleanedDocs,
      statusRecurso,
    };
    nextUser.statusRecurso = evaluateUserOverallDocumentStatus(nextUser).overallStatus;

    try {
      await dataService.salvarDocumentosUsuario({
        uidOrId: target.uid || target.id,
        email: target.email,
        documents: cleanedDocs,
        dispensadoDocumentos: isNextDispensado,
        statusRecurso,
      });
      if (onUsersUpdated) {
        onUsersUpdated(
          users.map((u) => (u.id === userId ? nextUser : u)),
          `Status de ${resourceName} alterado para ${statusRecurso}`
        );
      }
    } catch (err: any) {
      console.error('Erro ao atualizar status:', err);
      setError(`Erro ao atualizar status no Firestore: ${err?.message || err}`);
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

    const targetUser = users.find((u) => u.id === userId);
    if (!targetUser) {
      setUploadingKey(null);
      return;
    }

    const nextDocs = ensureUserMandatoryDocuments(targetUser.documents).map((d) => {
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
      if (payload.fileName) {
        copy.fileName = payload.fileName;
        copy.uploadedAt = new Date().toISOString();
        copy.uploadedBy = currentUser.name || currentUser.email;
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
      ...targetUser,
      documents: nextDocs,
    };
    nextUser.statusRecurso = evaluateUserOverallDocumentStatus(nextUser).overallStatus;

    try {
      await updateDoc(
        doc(db, 'usuarios', targetUser.uid || targetUser.id),
        sanitizeFirestoreData({
          documents: nextDocs,
          statusRecurso: nextUser.statusRecurso,
        })
      );
      if (onUsersUpdated && toastMessage) {
        onUsersUpdated(
          users.map((u) => (u.id === userId ? nextUser : u)),
          toastMessage
        );
      }
    } catch (err: any) {
      console.error('Erro ao atualizar documento:', err);
      setError(`Erro ao atualizar documento no Firestore: ${err?.message || err}`);
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

  // Auth creation state
  const [bulkAuthModalOpen, setBulkAuthModalOpen] = useState(false);
  const [singleAuthUser, setSingleAuthUser] = useState<AmetaUser | null>(null);
  const [authDefaultPassword, setAuthDefaultPassword] = useState('ameta2026');
  const [authProcessing, setAuthProcessing] = useState(false);
  const [authReport, setAuthReport] = useState<{
    total: number;
    created: number;
    alreadyExisted: number;
    errors: number;
    details: Array<{ email: string; name: string; status: 'created' | 'already_exists' | 'error'; message: string }>;
  } | null>(null);

  const handleRunAuthCreation = async (targetUsers: AmetaUser[], initialPassword: string) => {
    if (!initialPassword || initialPassword.length < 8) {
      setError('A senha inicial deve ter no mínimo 8 caracteres.');
      return;
    }
    setAuthProcessing(true);
    setError(null);

    const report = {
      total: targetUsers.length,
      created: 0,
      alreadyExisted: 0,
      errors: 0,
      details: [] as Array<{ email: string; name: string; status: 'created' | 'already_exists' | 'error'; message: string }>,
    };

    for (const u of targetUsers) {
      const cleanEmail = (u.email || '').trim().toLowerCase();
      if (!cleanEmail) continue;

      try {
        const { uid: newUid } = await createAuthAccountSecondary(cleanEmail, initialPassword);

        const oldDocId = u.uid || u.id || cleanEmail;
        const updatedUserPayload: AmetaUser = {
          ...u,
          id: newUid,
          uid: newUid,
          email: cleanEmail,
          situacao: 'ativo',
          accessReleased: true,
          mustChangePassword: true,
          emailVerified: true,
          updatedAt: new Date().toISOString(),
        };

        await setDoc(doc(db, 'usuarios', newUid), sanitizeFirestoreData(updatedUserPayload));

        if (oldDocId && oldDocId !== newUid) {
          try {
            await deleteDoc(doc(db, 'usuarios', oldDocId));
          } catch (delErr) {
            console.warn(`[Move User Doc Warning] Nao foi possivel remover doc antigo usuarios/${oldDocId}:`, delErr);
          }
        }

        report.created++;
        report.details.push({
          email: cleanEmail,
          name: u.name || cleanEmail,
          status: 'created',
          message: `Conta criada no Authentication. Documento movido para usuarios/${newUid}`,
        });
      } catch (authErr: any) {
        if (authErr?.code === 'auth/email-already-in-use') {
          report.alreadyExisted++;
          report.details.push({
            email: cleanEmail,
            name: u.name || cleanEmail,
            status: 'already_exists',
            message: 'E-mail ja cadastrado no Authentication (nao alterado).',
          });
        } else {
          console.error('[Auth Batch Creation Error]', cleanEmail, authErr);
          report.errors++;
          report.details.push({
            email: cleanEmail,
            name: u.name || cleanEmail,
            status: 'error',
            message: `Erro ao criar: ${authErr?.code || authErr?.message || authErr}`,
          });
        }
      }
    }

    setAuthProcessing(false);
    setBulkAuthModalOpen(false);
    setSingleAuthUser(null);
    setAuthReport(report);
  };

  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const cleanEmail = email.trim().toLowerCase();

      if (!password || password.length < 8) {
        setError('A senha inicial deve ter no mínimo 8 caracteres.');
        setSaving(false);
        return;
      }

      // Step 1: Create user account in Firebase Authentication via secondary app
      let authResult;
      try {
        authResult = await createAuthAccountSecondary(cleanEmail, password);
      } catch (authErr: any) {
        console.error('[Create Resource Auth Error]', cleanEmail, authErr);
        if (authErr?.code === 'auth/email-already-in-use') {
          setError(`O e-mail "${cleanEmail}" já está cadastrado no Firebase Authentication. Nenhuma alteração foi realizada.`);
        } else {
          setError(`Falha ao criar conta no Authentication para ${cleanEmail} (código: ${authErr?.code || authErr?.message || authErr}).`);
        }
        setSaving(false);
        return;
      }

      const uid = authResult.uid;

      const documentsPayload = MANDATORY_USER_DOCUMENTS.map((meta) => {
        const entry = newProfileDocs[meta.type];
        return {
          type: meta.type,
          label: meta.label,
          expiresAt: entry?.expiresAt || '',
          fileName: entry?.fileName || '',
          fileSize: 0,
          uploadedAt: entry?.fileName ? new Date().toISOString() : '',
          uploadedBy: entry?.fileName ? currentUser.name : '',
          storageFileName: '',
          notes: '',
          statusOverride: entry?.dispensado ? 'DISPENSADO' : undefined,
        };
      });

      const newUser: AmetaUser = {
        id: uid,
        uid: uid,
        name: name.trim(),
        email: cleanEmail,
        telefone: telefone.trim(),
        cpf: cpf.trim(),
        rg: rg.trim(),
        equipe: equipe.trim() || 'Campo',
        atividade: atividade.trim() || 'ACESSO | TX',
        role: newRole,
        tipo: 'usuario',
        situacao: 'ativo',
        plataforma: 'NOKIA',
        assignedPlatform: 'NOKIA',
        accessReleased: true,
        mustChangePassword: true,
        dispensadoDocumentos: newDispensado,
        statusRecurso: newDispensado ? 'DISPENSADO' : 'VALIDADO',
        documents: documentsPayload as UserMandatoryDocument[],
        emailVerified: true,
        createdAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'usuarios', uid), sanitizeFirestoreData(newUser));
      if (onUsersUpdated) {
        onUsersUpdated([...users, newUser], `Perfil ${name.trim()} cadastrado com sucesso no Authentication e Firestore`);
      }
      resetNewResourceForm();
      setAddModalOpen(false);
    } catch (err: any) {
      console.error('Erro ao criar recurso:', err);
      setError(`Falha ao cadastrar recurso no Firestore: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const [importingInitial, setImportingInitial] = useState(false);
  const [initialDataStatus, setInitialDataStatus] = useState<string | null>(null);
  const [initialImportSuccessNotice, setInitialImportSuccessNotice] = useState<string | null>(null);

  const handleImportInitialData = async () => {
    const ok = window.confirm(
      'Deseja importar a base inicial completa (Sites Nokia, Sites Ericsson, Usuários, Configurações de Duplas e Notificações) de public/initial-db.json para o Firestore em lotes?\n\nEssa rotina não apagará nem sobrescreverá dados já existentes.'
    );
    if (!ok) return;
    setImportingInitial(true);
    setInitialDataStatus('Iniciando importação...');
    try {
      const res = await dataService.importarDadosIniciais((msg) => {
        setInitialDataStatus(msg);
      });
      const successNotice = `Importação concluída com sucesso! • ${res.totalSites} Sites Nokia gravados • ${res.totalEricsson} Sites Ericsson gravados • ${res.totalUsers} Usuários gravados. ⚠️ IMPORTANTE: A base já está salva no Firestore. Você já pode remover o arquivo "public/initial-db.json" do repositório para economizar espaço e manter a segurança.`;
      setInitialImportSuccessNotice(successNotice);
      alert(
        `Importação concluída com sucesso!\n• ${res.totalSites} Sites Nokia gravados\n• ${res.totalEricsson} Sites Ericsson gravados\n• ${res.totalUsers} Usuários gravados\n\n⚠️ IMPORTANTE: A base já está salva no Firestore. Você já pode remover o arquivo "public/initial-db.json" do repositório para economizar espaço e manter a segurança.`
      );
    } catch (err: any) {
      console.error('Erro na importação inicial:', err);
      setError(`Falha ao importar dados iniciais no Firestore: ${err?.code || err?.message || err}`);
    } finally {
      setImportingInitial(false);
      setInitialDataStatus(null);
    }
  };

  const handleDeleteResource = async (u: AmetaUser) => {
    if (isOwnerAdmUser(u.email, u.situacao)) return;
    const ok = window.confirm(
      `Deseja EXCLUIR permanentemente o usuário ${u.name} (${u.email})?\n\n- Pressione OK para EXCLUIR o documento do usuário do Firestore.\n- Se quiser apenas bloquear o acesso, altere o status para Bloqueado.`
    );
    if (!ok) return;
    const targetId = u.uid || u.id;
    try {
      await dataService.excluirUsuario(targetId, u.email);
      if (onUsersUpdated) {
        onUsersUpdated(
          users.filter((usr) => usr.id !== targetId && usr.uid !== targetId),
          `Usuário ${u.name} excluído com sucesso do Firestore.`
        );
      }
    } catch (err: any) {
      console.error('Erro ao excluir usuário no Firestore [usuarios]:', err);
      setError(`Erro ao excluir usuário no Firestore [usuarios]: ${err?.code || err?.message || err}`);
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Firestore Connection / Error Banner */}
      {firestoreError && (
        <div className="bg-red-50 border-2 border-red-400 rounded-xl p-4 text-red-900 shadow-sm space-y-1.5">
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span>Erro na leitura em tempo real da coleção "usuarios" no Firestore</span>
          </div>
          <div className="text-xs font-mono">
            Código do erro: <strong className="text-red-700">{firestoreError.code}</strong>
          </div>
          <div className="text-xs text-red-800">{firestoreError.message}</div>
          <div className="text-xs text-slate-600 font-mono pt-1 border-t border-red-200 flex items-center gap-2">
            <span>Projeto Firebase em uso: <strong className="text-slate-800">{firebaseConfig.projectId}</strong></span>
            <span>·</span>
            <span>Banco: <strong>{firebaseConfig.firestoreDatabaseId || '(default)'}</strong></span>
          </div>
        </div>
      )}

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
                    users.find((u) => normalizeUserRole(u.role) === 'Vistoriador') || {
                      id: 'sim-vistoriador',
                      name: 'Vistoriador (Simulação)',
                      email: 'vistoriador.simulacao@ametaservicos.com.br',
                      role: 'Vistoriador' as UserRole,
                      situacao: 'ativo' as const,
                      plataforma: 'NOKIA' as const,
                      assignedPlatform: 'NOKIA' as const,
                      accessReleased: true,
                      equipe: '',
                      emailVerified: true,
                      createdAt: '',
                    };
                  onTestUserView(vist);
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
                    users.find((u) => normalizeUserRole(u.role) === 'Executor') || {
                      id: 'sim-executor',
                      name: 'Executor (Simulação)',
                      email: 'executor.simulacao@ametaservicos.com.br',
                      role: 'Executor' as UserRole,
                      situacao: 'ativo' as const,
                      plataforma: 'NOKIA' as const,
                      assignedPlatform: 'NOKIA' as const,
                      accessReleased: true,
                      equipe: '',
                      emailVerified: true,
                      createdAt: '',
                    };
                  onTestUserView(exec);
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
            onClick={handleImportInitialData}
            disabled={importingInitial}
            className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            title="Importar base completa de dados iniciais (Sites Nokia, Ericsson, Usuários e Duplas) para o Firestore"
          >
            {importingInitial ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{importingInitial ? (initialDataStatus || 'Importando...') : 'Importar Dados Iniciais'}</span>
          </button>

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

          <button
            type="button"
            onClick={() => {
              setError(null);
              setAuthDefaultPassword('ameta2026');
              setBulkAuthModalOpen(true);
            }}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-2xs"
            title="Criar contas de acesso no Firebase Authentication para colaboradores pendentes ou cadastrados no Firestore"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Criar Acesso de Todos os Pendentes</span>
          </button>
        </div>
      </div>

      {/* Aviso pós-importação da base inicial */}
      {initialImportSuccessNotice && (
        <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-400 text-amber-950 flex items-start justify-between gap-3 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <h4 className="font-bold text-sm text-amber-900">Importação Inicial Concluída no Firestore</h4>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                {initialImportSuccessNotice}
              </p>
              <p className="text-xs font-black text-amber-950 mt-1.5">
                ➡️ Ação recomendada: Você já pode remover o arquivo <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono border border-amber-300">public/initial-db.json</code> do repositório.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setInitialImportSuccessNotice(null)}
            className="p-1.5 text-amber-800 hover:text-amber-950 hover:bg-amber-200/60 rounded-lg cursor-pointer"
            title="Fechar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Painel de Liberação de Novos Usuários que Solicitam Cadastro */}
      <div id="pending-approvals-section" className="bg-amber-50/90 border-2 border-amber-300 rounded-xl p-4 space-y-3 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded-full bg-amber-600 text-white font-black text-xs">
              {pendingApprovalUsers.length}
            </span>
            <div>
              <h3 className="text-xs sm:text-sm font-black uppercase tracking-wide text-amber-950">
                Painel de Liberação de Novos Usuários (@ametaservicos.com.br)
              </h3>
              <p className="text-[11px] text-amber-800">
                Novos usuários que solicitam cadastro aparecem aqui. Ao aprovar, eles também alimentam automaticamente a lista de Duplas & Demanda.
              </p>
            </div>
          </div>
        </div>

        {pendingApprovalUsers.length === 0 ? (
          <div className="p-3 rounded-lg bg-white/90 border border-amber-200 text-xs text-slate-600">
            Nenhuma solicitação pendente no momento. Quando um colaborador criar conta com{' '}
            <strong className="text-slate-900">@ametaservicos.com.br</strong> na tela de login, ele aparecerá aqui para você aprovar e definir a dupla/função.
          </div>
        ) : (
          <div className="space-y-2.5">
            {pendingApprovalUsers.map((u) => {
              const draft = getPendingDraft(u);
              const isBusy = updatingUserId === u.id;
              const cardId = `pending-user-${(u.id || u.email).toLowerCase()}`;
              return (
                <div
                  key={u.id}
                  id={cardId}
                  className="p-3.5 rounded-xl bg-white border border-amber-300 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shadow-2xs transition-all duration-300"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-900">{u.name}</span>
                      <span className="px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-bold uppercase">
                        {u.situacao === 'bloqueado' ? 'Bloqueado (Liberar)' : 'Aguardando Liberação'}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-slate-600 mt-0.5">{u.email}</div>
                    
                    {/* Exibição clara do perfil e da plataforma pedidos no cadastro */}
                    <div className="mt-2 p-2 rounded-lg bg-amber-100/70 border border-amber-300 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-amber-950">📋 Solicitado no cadastro:</span>
                      <span className="px-2 py-0.5 rounded bg-white text-indigo-700 font-extrabold border border-indigo-200">
                        Perfil: {u.role || 'Vistoriador'}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white text-slate-800 font-bold border border-slate-200">
                        Plataforma: {u.plataforma || u.assignedPlatform || 'NOKIA'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1 max-w-2xl">
                    <div>
                      <label className="block text-[10px] uppercase text-slate-700 font-extrabold mb-0.5">
                        Função a Liberar *
                      </label>
                      <select
                        value={draft.role}
                        onChange={(e) =>
                          updatePendingDraft(u, { role: e.target.value as UserRole })
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg bg-white border-2 border-indigo-300 focus:border-indigo-600 text-xs font-bold text-slate-900"
                      >
                        <option value="Vistoriador">Vistoriador</option>
                        <option value="Executor">Executor</option>
                        <option value="Coordenador Geral">Coordenador Geral</option>
                        <option value="Coordenador Engenharia">Coordenador Engenharia</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase text-slate-700 font-extrabold mb-0.5">
                        Plataforma a Liberar *
                      </label>
                      <select
                        value={draft.plataforma}
                        onChange={(e) =>
                          updatePendingDraft(u, {
                            plataforma: e.target.value as AssignedPlatformScope,
                          })
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg bg-white border-2 border-indigo-300 focus:border-indigo-600 text-xs font-bold text-slate-900"
                      >
                        <option value="NOKIA">TIM / Nokia</option>
                        <option value="ERICSSON">Ericsson</option>
                        <option value="BOTH">Ambas (TIM + Ericsson)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase text-slate-500 font-bold mb-0.5">
                        Dupla / Equipe
                      </label>
                      <input
                        type="text"
                        value={draft.equipe}
                        onChange={(e) => updatePendingDraft(u, { equipe: e.target.value })}
                        placeholder="Ex: Nome 1 / Nome 2"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-300 text-xs text-slate-900"
                      />
                    </div>

                    <div className="sm:col-span-3 pt-1">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer p-1.5 rounded-md hover:bg-amber-100/50">
                        <input
                          type="checkbox"
                          checked={Boolean(confirmedApprovals[(u.id || u.email).toLowerCase()])}
                          onChange={(e) =>
                            setConfirmedApprovals((prev) => ({
                              ...prev,
                              [(u.id || u.email).toLowerCase()]: e.target.checked,
                            }))
                          }
                          className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                        <span>
                          Confirmo perfil <strong>{draft.role}</strong> e plataforma <strong>{draft.plataforma === 'BOTH' ? 'Ambas' : draft.plataforma}</strong> para liberar o acesso
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy || !confirmedApprovals[(u.id || u.email).toLowerCase()]}
                      onClick={() => handleApprovePendingUser(u)}
                      className="px-3.5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title={
                        !confirmedApprovals[(u.id || u.email).toLowerCase()]
                          ? 'Marque a confirmação obrigatória de Perfil e Plataforma para liberar'
                          : 'Liberar Acesso do usuário'
                      }
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isBusy ? 'Liberando...' : 'Liberar Acesso'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDeleteResource(u)}
                      className="px-2.5 py-2 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                      title="Recusar e remover solicitação"
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
                const isPrimaryAdmin = isOwnerAdmUser(u.email, u.situacao);
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
                          {/* Direct Profile Selector + Platform + Situação (Dono) */}
                          {isPrimaryAdmin || u.situacao === 'dono' ? (
                            <span className="px-3 py-1 bg-amber-500 text-slate-950 font-black text-xs rounded-lg shadow-2xs">
                              Dono (Acesso Total)
                            </span>
                          ) : (
                            <div className="inline-flex items-center gap-1.5 flex-nowrap">
                              {isUserDono(currentUser) && (
                                <>
                                  <button
                                    type="button"
                                    disabled={isUpdating}
                                    onClick={() => {
                                      setError(null);
                                      setAuthDefaultPassword('ameta2026');
                                      setSingleAuthUser(u);
                                    }}
                                    className="px-2 py-1 rounded-lg text-[11px] font-bold border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 transition-colors cursor-pointer whitespace-nowrap"
                                    title="Criar conta de acesso no Firebase Authentication para este colaborador"
                                  >
                                    Criar Acesso
                                  </button>

                                  <select
                                    value={u.plataforma || u.assignedPlatform || 'NOKIA'}
                                    disabled={isUpdating}
                                    onChange={(e) =>
                                      handlePlatformAndSituacaoChange(
                                        u,
                                        e.target.value as AssignedPlatformScope,
                                        u.situacao === 'aguardando' ? 'ativo' : u.situacao || 'ativo'
                                      )
                                    }
                                    title="Selecionar Plataforma (Nokia ou Ericsson)"
                                    className="px-2 py-1 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-800 cursor-pointer"
                                  >
                                    <option value="NOKIA">TIM / Nokia</option>
                                    <option value="ERICSSON">Ericsson</option>
                                    <option value="BOTH">Nokia + Ericsson</option>
                                  </select>

                                  <button
                                    type="button"
                                    disabled={isUpdating}
                                    onClick={() => {
                                      if (u.situacao === 'aguardando' || u.accessReleased === false) {
                                        const cardId = `pending-user-${(u.id || u.email).toLowerCase()}`;
                                        const el = document.getElementById(cardId) || document.getElementById('pending-approvals-section');
                                        if (el) {
                                          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                          el.classList.add('ring-4', 'ring-amber-400');
                                          setTimeout(() => el.classList.remove('ring-4', 'ring-amber-400'), 3000);
                                        }
                                        setError(`Obrigatório confirmar ou alterar o perfil e a plataforma antes de liberar o acesso de ${u.name}. Utilize o cartão de liberação acima.`);
                                        return;
                                      }
                                      const currSit = u.situacao || 'ativo';
                                      const nextSit: UserSituacao = currSit === 'bloqueado' ? 'ativo' : 'bloqueado';
                                      handlePlatformAndSituacaoChange(
                                        u,
                                        u.plataforma || u.assignedPlatform || 'NOKIA',
                                        nextSit
                                      );
                                    }}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border cursor-pointer whitespace-nowrap ${
                                      u.situacao === 'aguardando' || u.accessReleased === false
                                        ? 'bg-amber-100 hover:bg-emerald-600 text-amber-900 hover:text-white border-amber-300'
                                        : u.situacao === 'bloqueado'
                                          ? 'bg-red-100 hover:bg-emerald-600 text-red-800 hover:text-white border-red-300'
                                          : 'bg-emerald-50 hover:bg-red-50 text-emerald-800 hover:text-red-700 border-emerald-200'
                                    }`}
                                    title={
                                      u.situacao === 'aguardando' || u.accessReleased === false
                                        ? 'Clique para ir ao formulário de confirmação de perfil e liberação'
                                        : u.situacao === 'bloqueado'
                                          ? 'Clique para Desbloquear este usuário'
                                          : 'Usuário Ativo — Clique para Bloquear'
                                    }
                                  >
                                    {u.situacao === 'aguardando' || u.accessReleased === false
                                      ? 'Aguardando (Liberar)'
                                      : u.situacao === 'bloqueado'
                                        ? 'Bloqueado (Liberar)'
                                        : 'Ativo'}
                                  </button>
                                </>
                              )}

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
                                                setUploadingKey(`${u.id}-${doc.type}`);
                                                try {
                                                  const b64 = await readFileAsBase64(file);
                                                  const { expiresAt: autoExpiresAt, origin } =
                                                    await extractOrCalculateDocumentExpiration(file, doc.type);
                                                  await handleUpdateUserDocument(
                                                    u.id,
                                                    doc.type,
                                                    {
                                                      fileName: file.name,
                                                      fileBase64: b64,
                                                      expiresAt: autoExpiresAt,
                                                    },
                                                    `Arquivo ${file.name} enviado em ${doc.label} (${u.name}) — Validade: ${formatDateBr(autoExpiresAt)} (${origin})`
                                                  );
                                                } catch (err: any) {
                                                  console.error('Erro ao ler arquivo:', err);
                                                } finally {
                                                  setUploadingKey(null);
                                                  e.target.value = '';
                                                }
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
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Users className="w-10 h-10 text-slate-300" />
                      <div className="text-sm font-bold text-slate-800">
                        {users.length === 0
                          ? '0 usuários cadastrados na coleção "usuarios"'
                          : 'Nenhum recurso encontrado para os filtros selecionados'}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        Projeto Firebase: <strong className="text-slate-700">{firebaseConfig.projectId}</strong> (Banco: {firebaseConfig.firestoreDatabaseId || '(default)'})
                      </div>
                    </div>
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
                                    {docState?.fileName ? docState.fileName : 'Upload Arquivo'}
                                  </span>
                                  <input
                                    type="file"
                                    className="hidden"
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      try {
                                        const b64 = await readFileAsBase64(file);
                                        const { expiresAt: autoExpiresAt } =
                                          await extractOrCalculateDocumentExpiration(file, meta.type);
                                        setNewProfileDocs((prev) => ({
                                          ...prev,
                                          [meta.type]: {
                                            ...prev[meta.type],
                                            fileName: file.name,
                                            fileBase64: b64,
                                            expiresAt: autoExpiresAt,
                                          },
                                        }));
                                      } catch (err) {
                                        console.error('Erro ao ler arquivo no cadastro:', err);
                                      } finally {
                                        e.target.value = '';
                                      }
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
      {/* Modal: Criar Acesso de Todos os Pendentes (Lote Auth) */}
      {bulkAuthModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px]"
          onClick={() => setBulkAuthModalOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-indigo-900 text-white">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-300" />
                <h3 className="text-sm font-bold">Criar Acesso no Firebase Authentication em Lote</h3>
              </div>
              <button
                type="button"
                onClick={() => setBulkAuthModalOpen(false)}
                className="p-1 text-indigo-200 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Esta rotina criará a conta no <strong>Firebase Authentication</strong> para todos os colaboradores/usuários cadastrados no Firestore que ainda não possuem login ou possuem ID desalinhado. O documento no Firestore será movido para <code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-900 font-mono">usuarios/&#123;uid&#125;</code> com o ID correto do Authentication.
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Senha Inicial para as Novas Contas (Mínimo 8 caracteres) *
                </label>
                <input
                  type="text"
                  required
                  minLength={8}
                  value={authDefaultPassword}
                  onChange={(e) => setAuthDefaultPassword(e.target.value)}
                  placeholder="Ex: ameta2026"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBulkAuthModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={authProcessing || authDefaultPassword.length < 8}
                  onClick={() => handleRunAuthCreation(users, authDefaultPassword)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer shadow-2xs"
                >
                  {authProcessing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Criando Acessos...</span>
                    </>
                  ) : (
                    <span>Iniciar Criacao de Acessos</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Criar Acesso Individual */}
      {singleAuthUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px]"
          onClick={() => setSingleAuthUser(null)}
        >
          <div
            className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold">Criar Acesso Authentication</h3>
              </div>
              <button
                type="button"
                onClick={() => setSingleAuthUser(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                <div>Colaborador: <strong className="text-slate-900">{singleAuthUser.name}</strong></div>
                <div>E-mail: <strong className="text-slate-900 font-mono">{singleAuthUser.email}</strong></div>
                <div>Função: <span className="font-semibold text-indigo-700">{singleAuthUser.role}</span></div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Senha Inicial de Acesso (Mínimo 8 caracteres) *
                </label>
                <input
                  type="text"
                  required
                  minLength={8}
                  value={authDefaultPassword}
                  onChange={(e) => setAuthDefaultPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSingleAuthUser(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={authProcessing || authDefaultPassword.length < 8}
                  onClick={() => handleRunAuthCreation([singleAuthUser], authDefaultPassword)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer shadow-2xs"
                >
                  {authProcessing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Criando...</span>
                    </>
                  ) : (
                    <span>Criar Acesso</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Relatorio Final de Criacao de Acessos */}
      {authReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px]"
          onClick={() => setAuthReport(null)}
        >
          <div
            className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold">Relatório Final de Criação de Acessos</h3>
              </div>
              <button
                type="button"
                onClick={() => setAuthReport(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="text-lg font-black text-emerald-700">{authReport.created}</div>
                  <div className="text-[11px] font-bold text-emerald-800">Criados no Auth</div>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="text-lg font-black text-blue-700">{authReport.alreadyExisted}</div>
                  <div className="text-[11px] font-bold text-blue-800">Já Existiam</div>
                </div>
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                  <div className="text-lg font-black text-rose-700">{authReport.errors}</div>
                  <div className="text-[11px] font-bold text-rose-800">Erros</div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold">
                    <tr>
                      <th className="py-2 px-3">E-mail / Nome</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {authReport.details.map((d, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-3">
                          <div className="font-bold text-slate-900">{d.name}</div>
                          <div className="font-mono text-[11px] text-slate-500">{d.email}</div>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          {d.status === 'created' && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                              Criado
                            </span>
                          )}
                          {d.status === 'already_exists' && (
                            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold text-[10px]">
                              Já Existia
                            </span>
                          )}
                          {d.status === 'error' && (
                            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[10px]">
                              Erro
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-600 text-[11px]">{d.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setAuthReport(null)}
                className="px-4 py-2 bg-slate-900 text-white font-bold text-xs rounded-lg cursor-pointer hover:bg-slate-800"
              >
                Fechar Relatório
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
