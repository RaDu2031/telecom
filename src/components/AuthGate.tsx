import React, { useState } from 'react';
import {
  Lock,
  Mail,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  ChevronLeft,
} from 'lucide-react';
import { AmetaUser, VendorType, isOwnerAdmUser } from '../types/telecom';
import { dataService, sanitizeFirestoreData } from '../services/dataService';
import { AmetaLogo } from './AmetaLogo';
import { auth, db, firebaseConfig, ALLOWED_EMAIL_DOMAIN, isAllowedCorporateEmail } from '../lib/firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firebase';
import {
  validateCpfFormat,
  validatePasswordComplexity,
} from '../utils/authUtils';

interface AuthGateProps {
  onAuthenticated: (user: AmetaUser, initialVendor?: VendorType) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'reset' | 'first_access'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [initialVendorChoice, setInitialVendorChoice] = useState<VendorType>('NOKIA');

  // First Access state
  const [pendingUser, setPendingFirstAccessUser] = useState<{
    uid: string;
    email: string;
    name: string;
    userData: any;
    credentialUser: any;
  } | null>(null);
  const [cpf3DigitsInput, setCpf3DigitsInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const validateCorporateDomain = (rawEmail: string): boolean => {
    return isAllowedCorporateEmail(rawEmail);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!validateCorporateDomain(cleanEmail)) {
      setError(
        `Acesso negado: Utilize exclusivamente um e-mail corporativo do domínio @${ALLOWED_EMAIL_DOMAIN}.`
      );
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      let userCredential: any;
      try {
        userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
      } catch (authErr: any) {
        if (
          authErr?.code === 'auth/invalid-credential' ||
          authErr?.code === 'auth/user-not-found' ||
          authErr?.code === 'auth/wrong-password'
        ) {
          throw new Error('E-mail ou senha incorretos. Solicite o cadastro ao administrador.');
        }
        throw authErr;
      }

      const uid = userCredential.user.uid;
      const userDocRef = doc(db, 'usuarios', uid);
      let userDocSnap: any;

      try {
        userDocSnap = await getDoc(userDocRef);
      } catch (getErr) {
        await signOut(auth);
        handleFirestoreError(getErr, OperationType.GET, `usuarios/${uid}`);
      }

      // Requirement 2: If the user does not have a document in 'usuarios', show message and signOut. Do NOT create doc.
      if (!userDocSnap || !userDocSnap.exists()) {
        await signOut(auth);
        throw new Error('Seu acesso ainda não foi liberado. Fale com o administrador.');
      }

      const userData = userDocSnap.data();
      const isOwner = isOwnerAdmUser(cleanEmail);

      // Check if disabled or blocked
      if (userData.desativado || userData.situacao === 'bloqueado') {
        await signOut(auth);
        throw new Error(
          'Esta conta foi desativada pelo administrador. Seu histórico e demandas continuam preservados. Entre em contato com o ADM.'
        );
      }

      // Check if access is released
      const isReleasedUser =
        isOwner ||
        userData.situacao === 'ativo' ||
        userData.situacao === 'dono' ||
        userData.accessReleased === true;

      if (!isReleasedUser) {
        await signOut(auth);
        throw new Error('Seu acesso ainda não foi liberado. Fale com o administrador.');
      }

      // Check lockout status
      if (userData.lockoutUntil) {
        const lockoutTime = new Date(userData.lockoutUntil).getTime();
        if (lockoutTime > Date.now()) {
          const remainingMinutes = Math.ceil((lockoutTime - Date.now()) / (1000 * 60));
          await signOut(auth);
          throw new Error(
            `Conta temporariamente bloqueada devido a 5 tentativas falhas. Tente novamente em ${remainingMinutes} minuto(s).`
          );
        }
      }

      const loggedUser: AmetaUser = {
        id: userData.id || uid,
        uid: userData.uid || uid,
        name: userData.name || cleanEmail.split('@')[0],
        email: cleanEmail,
        role: userData.role || 'Vistoriador',
        situacao: (userData.situacao || (isOwner ? 'dono' : 'ativo')) as any,
        plataforma: (userData.plataforma || 'NOKIA') as any,
        assignedPlatform: (userData.assignedPlatform || 'NOKIA') as any,
        accessReleased: true,
        tipo: (userData.tipo || (isOwner ? 'admin' : 'usuario')) as any,
        emailVerified: true,
        mustChangePassword: Boolean(userData.mustChangePassword),
        batchStatus: userData.batchStatus,
        createdAt: userData.createdAt || new Date().toISOString(),
      };

      // Check if mandatory password change is required on First Access
      if (userData.mustChangePassword) {
        if (userData.batchStatus === 'Pendente de liberação') {
          await signOut(auth);
          throw new Error(
            'A senha inicial deste lote foi encerrada pelo administrador. Entre em contato com o ADM para redefinir sua senha.'
          );
        }

        let privateData: { cpf?: string; initialPasswordHash?: string; salt?: string } | null = null;
        try {
          const privSnap = await getDoc(doc(db, 'usuarios', uid, 'privado', 'dados'));
          if (privSnap.exists()) {
            privateData = privSnap.data() as any;
          }
        } catch (privErr) {
          console.warn('[AuthGate] Não foi possível carregar dados de usuarios/' + uid + '/privado/dados:', privErr);
        }

        setPendingFirstAccessUser({
          uid,
          email: cleanEmail,
          name: loggedUser.name,
          userData: {
            ...userData,
            cpf: privateData?.cpf || userData.cpf || '',
            initialPasswordHash: privateData?.initialPasswordHash || '',
            salt: privateData?.salt || '',
          },
          credentialUser: userCredential.user,
        });
        setMode('first_access');
        setInfoMessage('Primeiro acesso detectado. Para sua segurança, crie sua nova senha de acesso.');
        return;
      }

      onAuthenticated(loggedUser, initialVendorChoice);
    } catch (err: any) {
      setError(err?.message || 'E-mail ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  };

  const handleFirstAccessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (!pendingUser) {
      setMode('login');
      return;
    }

    if (pendingUser?.userData?.cpf) {
      const cleanCpf = pendingUser.userData.cpf.replace(/\D/g, '');
      if (cleanCpf.length >= 3 && cpf3DigitsInput.length === 3) {
        if (!cleanCpf.startsWith(cpf3DigitsInput)) {
          setError('Os 3 primeiros dígitos do CPF não conferem com o cadastro.');
          return;
        }
      }
    }

    if (newPassword.length < 8) {
      setError('A nova senha deve ter no mínimo 8 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('A confirmação de senha não confere com a nova senha.');
      return;
    }

    const complexity = validatePasswordComplexity(newPassword);
    if (!complexity.isValid) {
      setError(complexity.message || 'Senha fora dos padrões de segurança (deve conter letras e números).');
      return;
    }

    if (newPassword === password) {
      setError('A nova senha deve ser diferente da senha inicial.');
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'usuarios', pendingUser.uid);
      let userSnap;
      try {
        userSnap = await getDoc(userRef);
      } catch (getErr) {
        handleFirestoreError(getErr, OperationType.GET, `usuarios/${pendingUser.uid}`);
      }
      const currentData = userSnap?.data() || pendingUser.userData;

      // Update password in Firebase Auth with auto re-authentication
      if (auth.currentUser) {
        try {
          await updatePassword(auth.currentUser, newPassword);
        } catch (pwErr: any) {
          if (pwErr?.code === 'auth/requires-recent-login') {
            const credential = EmailAuthProvider.credential(pendingUser.email, password);
            await reauthenticateWithCredential(auth.currentUser, credential);
            await updatePassword(auth.currentUser, newPassword);
          } else {
            throw pwErr;
          }
        }
      }

      // Update user document in Firestore
      try {
        await updateDoc(
          userRef,
          sanitizeFirestoreData({
            mustChangePassword: false,
            batchStatus: 'Concluído',
            failedAttempts: 0,
            lockoutUntil: null,
            updatedAt: new Date().toISOString(),
          })
        );

        // Limpar o hash de senha inicial em usuarios/{uid}/privado/dados
        try {
          await updateDoc(
            doc(db, 'usuarios', pendingUser.uid, 'privado', 'dados'),
            sanitizeFirestoreData({
              initialPasswordHash: '',
              updatedAt: new Date().toISOString(),
            })
          );
        } catch {
          // Ignora se o documento privado não tiver sido criado
        }
      } catch (updErr) {
        handleFirestoreError(updErr, OperationType.UPDATE, `usuarios/${pendingUser.uid}`);
      }

      // Audit Log
      await dataService.registrarAuditLog({
        action: 'FIRST_ACCESS',
        actorEmail: pendingUser.email,
        targetEmail: pendingUser.email,
        targetName: pendingUser.name,
        details: 'Primeiro acesso e troca obrigatória de senha concluídos com sucesso.',
      });

      const loggedUser: AmetaUser = {
        id: pendingUser.uid,
        uid: pendingUser.uid,
        name: pendingUser.name,
        email: pendingUser.email,
        role: currentData.role || 'Vistoriador',
        situacao: 'ativo',
        plataforma: currentData.plataforma || 'NOKIA',
        assignedPlatform: currentData.assignedPlatform || 'NOKIA',
        accessReleased: true,
        mustChangePassword: false,
        batchStatus: 'Concluído',
        emailVerified: true,
        createdAt: currentData.createdAt || new Date().toISOString(),
      };

      setInfoMessage('Senha alterada com sucesso! Entrando na plataforma...');
      setTimeout(() => {
        onAuthenticated(loggedUser, initialVendorChoice);
      }, 500);
    } catch (err: any) {
      setError(err?.message || 'Falha ao redefinir a senha do primeiro acesso.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!validateCorporateDomain(cleanEmail)) {
      setError(
        `Informe um e-mail corporativo válido do domínio @${ALLOWED_EMAIL_DOMAIN} para recuperar a senha.`
      );
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setInfoMessage(
        `Instruções de redefinição de senha enviadas com sucesso para ${cleanEmail}.`
      );
    } catch (err: any) {
      setError(err?.message || 'Erro ao solicitar redefinição de senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060B16] flex items-center justify-center p-4 sm:p-6">
      <div className="ameta-modal-panel w-full max-w-md bg-[#0D1526] rounded-[12px] border border-[#1B2741] overflow-hidden flex flex-col">
        {/* Brand Header */}
        <div className="px-8 pt-7 pb-6 bg-[#0A1120] border-b border-[#1B2741] text-white text-center relative">
          <div className="flex items-center justify-center mb-3">
            <div className="px-4 py-2 bg-[#080E1C] rounded-[12px] border border-[#1E2B48] inline-flex items-center justify-center">
              <AmetaLogo size="md" theme="dark" />
            </div>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">Ameta Telecom</h1>
          <p className="text-xs text-slate-400 mt-1 font-medium">
            Gestão Integrada de Sites & Vistorias Nokia e Ericsson
          </p>
        </div>

        {/* Notifications / Feedback */}
        {error && (
          <div className="mx-6 mt-5 p-3 rounded-[8px] bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5 leading-relaxed">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <span className="flex-1 font-medium">{error}</span>
          </div>
        )}

        {infoMessage && (
          <div className="mx-6 mt-5 p-3 rounded-[8px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2.5 leading-relaxed">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <span className="flex-1 font-medium">{infoMessage}</span>
          </div>
        )}

        {/* Form Body */}
        <div className="p-6 sm:p-8 pt-5">
          {mode === 'login' ? (
            /* Login Form */
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  E-mail Corporativo
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={`nome@${ALLOWED_EMAIL_DOMAIN}`}
                    className="w-full pl-9 pr-3.5 py-2.5 bg-[#080E1C] border border-[#1E2B48] rounded-[8px] text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#2DD4BF] focus:ring-2 focus:ring-[#2DD4BF]/20 transition-all duration-150 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-[#080E1C] border border-[#1E2B48] rounded-[8px] text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#2DD4BF] focus:ring-2 focus:ring-[#2DD4BF]/20 transition-all duration-150 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Plataforma Inicial
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#080E1C] rounded-[8px] border border-[#1E2B48]">
                  <button
                    type="button"
                    onClick={() => setInitialVendorChoice('NOKIA')}
                    className={`py-2 rounded-[6px] text-xs font-semibold transition-all duration-150 cursor-pointer ${
                      initialVendorChoice === 'NOKIA'
                        ? 'bg-[#2DD4BF] text-[#041517] font-bold shadow-xs'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    Nokia / TIM
                  </button>
                  <button
                    type="button"
                    onClick={() => setInitialVendorChoice('ERICSSON')}
                    className={`py-2 rounded-[6px] text-xs font-semibold transition-all duration-150 cursor-pointer ${
                      initialVendorChoice === 'ERICSSON'
                        ? 'bg-[#2DD4BF] text-[#041517] font-bold shadow-xs'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    Ericsson / Claro
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-[#2DD4BF] hover:bg-[#22B8A6] text-[#041517] font-bold text-xs rounded-[8px] shadow-xs transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <span>{loading ? 'Entrando...' : 'Acessar Plataforma'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <div className="pt-3 border-t border-[#1B2741] text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode('reset');
                    setError(null);
                    setInfoMessage(null);
                  }}
                  className="text-xs text-[#2DD4BF] hover:text-teal-300 font-semibold cursor-pointer"
                >
                  Esqueceu a senha?
                </button>
              </div>
            </form>
          ) : mode === 'first_access' ? (
            /* First Access Mandatory Password Change Form */
            <form onSubmit={handleFirstAccessSubmit} className="space-y-4">
              <div className="p-3.5 bg-[#142038] border border-[#2DD4BF]/30 rounded-[10px] text-slate-200 text-xs flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-[#2DD4BF] shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold text-white">Criar Sua Senha de Acesso</strong>
                  <span>
                    Olá <strong>{pendingUser?.name}</strong>. Para sua segurança, confirme os 3 primeiros dígitos do seu CPF e defina sua nova senha definitiva.
                  </span>
                </div>
              </div>

              {pendingUser?.userData?.cpf ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    3 Primeiros Dígitos do CPF (Conferência de Identidade)
                  </label>
                  <div className="relative">
                    <ShieldAlert className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      maxLength={3}
                      value={cpf3DigitsInput}
                      onChange={(e) => setCpf3DigitsInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="Ex: 123"
                      className="w-full pl-9 pr-3.5 py-2.5 bg-[#080E1C] border border-[#1E2B48] rounded-[8px] text-xs font-mono font-bold text-slate-100 focus:outline-none focus:border-[#2DD4BF] focus:ring-2 focus:ring-[#2DD4BF]/20 transition-all tabular-nums"
                    />
                  </div>
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nova Senha (Mínimo 8 caracteres, letras e números)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Sua nova senha definitiva"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-[#080E1C] border border-[#1E2B48] rounded-[8px] text-xs text-slate-100 focus:outline-none focus:border-[#2DD4BF] focus:ring-2 focus:ring-[#2DD4BF]/20 transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Confirme a Nova Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Digite a nova senha novamente"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-[#080E1C] border border-[#1E2B48] rounded-[8px] text-xs text-slate-100 focus:outline-none focus:border-[#2DD4BF] focus:ring-2 focus:ring-[#2DD4BF]/20 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-[#2DD4BF] hover:bg-[#22B8A6] text-[#041517] font-bold text-xs rounded-[8px] shadow-xs transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{loading ? 'Salvando...' : 'Salvar Nova Senha & Acessar'}</span>
                </button>
              </div>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPendingFirstAccessUser(null);
                    setMode('login');
                    setError(null);
                    setInfoMessage(null);
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer font-medium"
                >
                  Voltar ao Login
                </button>
              </div>
            </form>
          ) : (
            /* Reset Password Form */
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div className="text-center pb-1">
                <h3 className="text-sm font-bold text-slate-100">Recuperação de Senha</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Informe seu e-mail corporativo para receber as instruções
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  E-mail Corporativo (@{ALLOWED_EMAIL_DOMAIN})
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={`nome@${ALLOWED_EMAIL_DOMAIN}`}
                    className="w-full pl-9 pr-3.5 py-2.5 bg-[#080E1C] border border-[#1E2B48] rounded-[8px] text-xs text-slate-100 focus:outline-none focus:border-[#2DD4BF] focus:ring-2 focus:ring-[#2DD4BF]/20 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-[#2DD4BF] hover:bg-[#22B8A6] text-[#041517] font-bold text-xs rounded-[8px] shadow-xs transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{loading ? 'Enviando...' : 'Enviar Link de Redefinição'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setInfoMessage(null);
                  }}
                  className="w-full py-2.5 text-xs text-slate-400 hover:text-slate-100 font-semibold cursor-pointer flex items-center justify-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Voltar para o Login</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer Project ID Info */}
        <div className="py-2.5 px-6 bg-[#080E1C] border-t border-[#1B2741] text-center">
          <span className="text-[11px] font-mono text-slate-500">
            Projeto: <strong className="font-semibold text-slate-300">{firebaseConfig.projectId}</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
