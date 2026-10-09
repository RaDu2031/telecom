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
import { AmetaUser, VendorType } from '../types/telecom';
import { dataService, sanitizeFirestoreData } from '../services/dataService';
import { AmetaLogo } from './AmetaLogo';
import { auth, db, firebaseConfig, ALLOWED_EMAIL_DOMAIN, isAllowedCorporateEmail } from '../lib/firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
} from 'firebase/auth';
import { doc, getDoc, updateDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
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
        // Fallback for imported/pre-seeded users who don't have a Firebase Auth account yet
        let preSeededData: any = null;

        try {
          const usersCol = collection(db, 'usuarios');
          const q = query(usersCol, where('email', '==', cleanEmail));
          const qSnap = await getDocs(q);
          if (!qSnap.empty) {
            preSeededData = qSnap.docs[0].data();
          }
        } catch (dbErr) {
          console.warn('Consulta de pré-cadastro em usuarios ignorada:', dbErr);
        }

        if (!preSeededData) {
          try {
            const initialRes = await window.fetch('/initial-db.json');
            if (initialRes.ok) {
              const initialJson = await initialRes.json();
              if (Array.isArray(initialJson.users)) {
                preSeededData = initialJson.users.find(
                  (u: any) => u.email?.toLowerCase() === cleanEmail
                );
              }
            }
          } catch (e) {
            console.error('Erro ao buscar fallback em initial-db.json:', e);
          }
        }

        if (preSeededData) {
          if (password === 'ameta2026' || preSeededData.mustChangePassword) {
            try {
              userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
              const newUid = userCredential.user.uid;
              await setDoc(
                doc(db, 'usuarios', newUid),
                sanitizeFirestoreData({
                  ...preSeededData,
                  id: newUid,
                  uid: newUid,
                }),
                { merge: true }
              );
            } catch (createErr: any) {
              if (createErr?.code === 'auth/email-already-in-use') {
                throw new Error('E-mail ou senha incorretos.');
              }
              throw createErr;
            }
          } else {
            throw new Error('E-mail ou senha incorretos.');
          }
        } else {
          if (authErr?.code === 'auth/invalid-credential' || authErr?.code === 'auth/user-not-found' || authErr?.code === 'auth/wrong-password') {
            throw new Error('E-mail ou senha incorretos. Solicite o cadastro de sua conta ao Administrador.');
          }
          throw authErr;
        }
      }

      const userDocRef = doc(db, 'usuarios', userCredential.user.uid);
      const userDocSnap = await getDoc(userDocRef);

      let userData: any;
      if (userDocSnap.exists()) {
        userData = userDocSnap.data();
      } else {
        const isOwner = cleanEmail === 'rafael.araujo@ametaservicos.com.br';
        userData = {
          id: userCredential.user.uid,
          uid: userCredential.user.uid,
          name: cleanEmail.split('@')[0],
          email: cleanEmail,
          tipo: isOwner ? 'admin' : 'usuario',
          role: isOwner ? 'ADM' : 'Vistoriador',
          situacao: isOwner ? 'dono' : 'ativo',
          plataforma: isOwner ? 'AMBAS' : initialVendorChoice,
          assignedPlatform: isOwner ? 'BOTH' : initialVendorChoice,
          accessReleased: true,
          documents: [],
          emailVerified: true,
          equipe: '',
          telefone: '',
          createdAt: new Date().toISOString(),
        };
        await setDoc(userDocRef, sanitizeFirestoreData(userData));
      }

      // Check if user is disabled or blocked
      if (userData.desativado || userData.situacao === 'bloqueado') {
        throw new Error(
          'Esta conta foi desativada pelo administrador. Seu histórico e demandas continuam preservados. Entre em contato com o ADM.'
        );
      }

      // Check lockout status
      if (userData.lockoutUntil) {
        const lockoutTime = new Date(userData.lockoutUntil).getTime();
        if (lockoutTime > Date.now()) {
          const remainingMinutes = Math.ceil((lockoutTime - Date.now()) / (1000 * 60));
          throw new Error(
            `Conta temporariamente bloqueada devido a 5 tentativas falhas. Tente novamente em ${remainingMinutes} minuto(s).`
          );
        }
      }

      const isOwner = cleanEmail === 'rafael.araujo@ametaservicos.com.br';
      const loggedUser: AmetaUser = {
        id: userData.id || userCredential.user.uid,
        uid: userData.uid || userCredential.user.uid,
        name: userData.name || cleanEmail.split('@')[0],
        email: cleanEmail,
        role: userData.role || 'Vistoriador',
        situacao: (userData.situacao || (isOwner ? 'dono' : 'ativo')) as any,
        plataforma: (userData.plataforma || 'NOKIA') as any,
        assignedPlatform: (userData.assignedPlatform || 'NOKIA') as any,
        accessReleased: isOwner || userData.accessReleased === true || userData.situacao === 'ativo',
        tipo: (userData.tipo || (isOwner ? 'admin' : 'usuario')) as any,
        emailVerified: true,
        mustChangePassword: Boolean(userData.mustChangePassword),
        batchStatus: userData.batchStatus,
        createdAt: userData.createdAt || new Date().toISOString(),
      };

      // Check if mandatory password change is required on First Access
      if (userData.mustChangePassword) {
        if (userData.batchStatus === 'Pendente de liberação') {
          throw new Error(
            'A senha inicial deste lote foi encerrada pelo administrador. Entre em contato com o ADM para redefinir sua senha.'
          );
        }

        setPendingFirstAccessUser({
          uid: userCredential.user.uid,
          email: cleanEmail,
          name: loggedUser.name,
          userData,
          credentialUser: userCredential.user,
        });
        setMode('first_access');
        setInfoMessage('Primeiro acesso detectado. Para sua segurança, confirme seus dados e crie uma nova senha.');
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

    const cleanCpf3 = cpf3DigitsInput.replace(/\D/g, '');
    if (cleanCpf3.length !== 3) {
      setError('Informe exatamente os 3 primeiros dígitos do seu CPF.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('A confirmação de senha não confere com a nova senha.');
      return;
    }

    const complexity = validatePasswordComplexity(newPassword);
    if (!complexity.isValid) {
      setError(complexity.message || 'Senha fora dos padrões de segurança.');
      return;
    }

    if (newPassword === password) {
      setError('A nova senha deve ser diferente da senha inicial.');
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'usuarios', pendingUser.uid);
      const userSnap = await getDoc(userRef);
      const currentData = userSnap.data() || pendingUser.userData;

      // Check lockout again
      if (currentData.lockoutUntil) {
        const lockoutTime = new Date(currentData.lockoutUntil).getTime();
        if (lockoutTime > Date.now()) {
          const remainingMinutes = Math.ceil((lockoutTime - Date.now()) / (1000 * 60));
          throw new Error(
            `Conta temporariamente bloqueada após 5 tentativas falhas. Tente novamente em ${remainingMinutes} minuto(s).`
          );
        }
      }

      // Verify CPF 3 digits
      const expectedCpf = currentData.cpf || '';
      const expectedCpf3 = currentData.cpf3Digits || validateCpfFormat(expectedCpf).first3Digits;

      if (expectedCpf3 && cleanCpf3 !== expectedCpf3) {
        const failedAttempts = (currentData.failedAttempts || 0) + 1;
        let updatePayload: any = { failedAttempts };

        if (failedAttempts >= 5) {
          const lockoutUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          updatePayload.lockoutUntil = lockoutUntil;

          await dataService.registrarAuditLog({
            action: 'ACCOUNT_LOCKOUT',
            actorEmail: pendingUser.email,
            targetEmail: pendingUser.email,
            targetName: pendingUser.name,
            details: 'Conta bloqueada por 15 minutos após 5 tentativas incorretas na conferência de CPF.',
          });
        } else {
          await dataService.registrarAuditLog({
            action: 'FAILED_ATTEMPT',
            actorEmail: pendingUser.email,
            targetEmail: pendingUser.email,
            targetName: pendingUser.name,
            details: `Tentativa incorreta de CPF no primeiro acesso (${failedAttempts}/5).`,
          });
        }

        await updateDoc(userRef, sanitizeFirestoreData(updatePayload));

        if (failedAttempts >= 5) {
          throw new Error('Número máximo de 5 tentativas excedido. A conta foi bloqueada por 15 minutos.');
        } else {
          throw new Error(`Conferência de CPF incorreta (${failedAttempts}/5 tentativas). Tente novamente.`);
        }
      }

      // Update password in Firebase Auth
      if (auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
      }

      // Update user document in Firestore
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100/80 overflow-hidden flex flex-col">
        {/* Brand Header */}
        <div className="px-8 pt-8 pb-6 bg-gradient-to-br from-blue-900 via-indigo-950 to-slate-900 text-white text-center relative">
          <div className="flex items-center justify-center mb-3.5">
            <div className="px-4 py-2.5 bg-white/10 rounded-2xl backdrop-blur-md shadow-inner border border-white/20 inline-flex items-center justify-center">
              <AmetaLogo size="md" theme="dark" />
            </div>
          </div>
          <h1 className="text-xl font-black tracking-tight text-white">Ameta Telecom</h1>
          <p className="text-xs text-blue-200/90 mt-1 font-medium">
            Gestão Integrada de Sites & Vistorias Nokia e Ericsson
          </p>
        </div>

        {/* Notifications / Feedback */}
        {error && (
          <div className="mx-6 mt-4 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5 leading-relaxed">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            <span className="flex-1 font-medium">{error}</span>
          </div>
        )}

        {infoMessage && (
          <div className="mx-6 mt-4 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5 leading-relaxed">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
            <span className="flex-1 font-medium">{infoMessage}</span>
          </div>
        )}

        {/* Form Body */}
        <div className="p-6 sm:p-8 pt-5">
          {mode === 'login' ? (
            /* Login Form */
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  E-mail Corporativo
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={`nome@${ALLOWED_EMAIL_DOMAIN}`}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Plataforma Inicial
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInitialVendorChoice('NOKIA')}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      initialVendorChoice === 'NOKIA'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Nokia / TIM
                  </button>
                  <button
                    type="button"
                    onClick={() => setInitialVendorChoice('ERICSSON')}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      initialVendorChoice === 'ERICSSON'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
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
                  className="w-full py-3 bg-gradient-to-r from-blue-700 to-indigo-800 hover:from-blue-800 hover:to-indigo-900 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <span>{loading ? 'Entrando...' : 'Acessar Plataforma'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <div className="pt-3 border-t border-slate-100 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode('reset');
                    setError(null);
                    setInfoMessage(null);
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold cursor-pointer"
                >
                  Esqueceu a senha?
                </button>
              </div>
            </form>
          ) : mode === 'first_access' ? (
            /* First Access Mandatory Password Change Form */
            <form onSubmit={handleFirstAccessSubmit} className="space-y-4">
              <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl text-blue-900 text-xs flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold">Criar Sua Senha de Acesso</strong>
                  <span>
                    Olá <strong>{pendingUser?.name}</strong>. Para sua segurança, confirme os 3 primeiros dígitos do seu CPF e defina sua nova senha definitiva.
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  3 Primeiros Dígitos do CPF (Conferência de Identidade)
                </label>
                <div className="relative">
                  <ShieldAlert className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    required
                    maxLength={3}
                    value={cpf3DigitsInput}
                    onChange={(e) => setCpf3DigitsInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="Ex: 123"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nova Senha (Mínimo 8 caracteres, letras e números)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Sua nova senha definitiva"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Confirme a Nova Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Digite a nova senha novamente"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
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
                  className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer font-medium"
                >
                  Voltar ao Login
                </button>
              </div>
            </form>
          ) : (
            /* Reset Password Form */
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div className="text-center pb-1">
                <h3 className="text-sm font-bold text-slate-900">Recuperação de Senha</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Informe seu e-mail corporativo para receber as instruções
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  E-mail Corporativo (@{ALLOWED_EMAIL_DOMAIN})
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={`nome@${ALLOWED_EMAIL_DOMAIN}`}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                  />
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-blue-700 to-indigo-800 hover:from-blue-800 hover:to-indigo-900 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
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
                  className="w-full py-2.5 text-xs text-slate-600 hover:text-slate-900 font-semibold cursor-pointer flex items-center justify-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Voltar para o Login</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer Project ID Info */}
        <div className="py-2.5 px-6 bg-slate-50 border-t border-slate-100 text-center">
          <span className="text-[11px] font-mono text-slate-400">
            Projeto: <strong className="font-semibold text-slate-600">{firebaseConfig.projectId}</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
