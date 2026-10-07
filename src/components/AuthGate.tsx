import React, { useState } from 'react';
import {
  Lock,
  Mail,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Send,
  User,
  ShieldCheck,
  RefreshCw,
  ChevronLeft,
} from 'lucide-react';
import { AmetaUser, VendorType } from '../types/telecom';
import { AmetaLogo } from './AmetaLogo';
import { auth, db, firebaseConfig, ALLOWED_EMAIL_DOMAIN, isAllowedCorporateEmail } from '../lib/firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface AuthGateProps {
  onAuthenticated: (user: AmetaUser, initialVendor?: VendorType) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [requestedRole, setRequestedRole] = useState<AmetaUser['role']>('Vistoriador');
  const [requestedEquipe, setRequestedEquipe] = useState('');
  const [initialVendorChoice, setInitialVendorChoice] = useState<VendorType>('NOKIA');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);

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
      const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
      const isOwner = cleanEmail === 'rafael.araujo@ametaservicos.com.br';

      // Check email verification for non-owners
      if (!userCredential.user.emailVerified && !isOwner) {
        setNeedsEmailVerification(true);
        setError(null);
        setLoading(false);
        return;
      }

      const userDocRef = doc(db, 'usuarios', userCredential.user.uid);
      const userDocSnap = await getDoc(userDocRef);

      let userData: any;
      if (userDocSnap.exists()) {
        userData = userDocSnap.data();
      } else {
        userData = {
          id: userCredential.user.uid,
          uid: userCredential.user.uid,
          name: cleanEmail.split('@')[0],
          email: cleanEmail,
          tipo: isOwner ? 'admin' : 'usuario',
          role: isOwner ? 'ADM' : 'Vistoriador',
          equipe: 'Coordenação / ADM',
          situacao: isOwner ? 'dono' : 'aguardando',
          plataforma: isOwner ? 'AMBAS' : initialVendorChoice,
          assignedPlatform: isOwner ? 'BOTH' : initialVendorChoice,
          accessReleased: isOwner,
          emailVerified: userCredential.user.emailVerified,
          createdAt: new Date().toISOString(),
        };
        await setDoc(userDocRef, userData);
      }

      const loggedUser: AmetaUser = {
        id: userData.id || userCredential.user.uid,
        uid: userData.uid || userCredential.user.uid,
        name: userData.name || cleanEmail.split('@')[0],
        email: cleanEmail,
        role: userData.role || 'Vistoriador',
        situacao: (userData.situacao || (isOwner ? 'dono' : 'aguardando')) as any,
        plataforma: (userData.plataforma || 'NOKIA') as any,
        assignedPlatform: (userData.assignedPlatform || 'NOKIA') as any,
        accessReleased: isOwner || userData.accessReleased === true || userData.situacao === 'ativo',
        tipo: (userData.tipo || (isOwner ? 'admin' : 'usuario')) as any,
        emailVerified: userCredential.user.emailVerified || isOwner,
        createdAt: userData.createdAt || new Date().toISOString(),
      };

      onAuthenticated(loggedUser, initialVendorChoice);
    } catch (err: any) {
      setError(err?.message || 'E-mail ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!validateCorporateDomain(cleanEmail)) {
      setError(
        `Cadastro rejeitado: Só são aceitos e-mails corporativos do domínio @${ALLOWED_EMAIL_DOMAIN}.`
      );
      return;
    }

    if (password.length < 8) {
      setError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }

    if (!name.trim()) {
      setError('Informe seu nome completo.');
      return;
    }

    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      try {
        await sendEmailVerification(userCredential.user);
      } catch (err) {
        console.warn('Erro ao disparar e-mail de verificação:', err);
      }

      const isOwner = cleanEmail === 'rafael.araujo@ametaservicos.com.br';
      const userData = {
        id: userCredential.user.uid,
        uid: userCredential.user.uid,
        name: name.trim(),
        email: cleanEmail,
        tipo: (isOwner ? 'admin' : 'usuario') as 'admin' | 'usuario',
        role: isOwner ? ('ADM' as const) : requestedRole,
        equipe: requestedEquipe.trim() || name.trim(),
        telefone: '',
        plataforma: initialVendorChoice === 'ERICSSON' ? ('ERICSSON' as const) : ('NOKIA' as const),
        assignedPlatform: initialVendorChoice === 'ERICSSON' ? ('ERICSSON' as const) : ('NOKIA' as const),
        situacao: isOwner ? ('dono' as const) : ('aguardando' as const),
        accessReleased: isOwner,
        documents: [],
        emailVerified: false,
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'usuarios', userCredential.user.uid), userData);

      if (isOwner) {
        const finalOwner: AmetaUser = {
          ...userData,
          role: 'ADM',
          situacao: 'dono',
          plataforma: 'AMBAS',
          assignedPlatform: 'BOTH',
          accessReleased: true,
          emailVerified: true,
        };
        onAuthenticated(finalOwner, initialVendorChoice);
      } else {
        setNeedsEmailVerification(true);
        setInfoMessage('Cadastro realizado com sucesso! Enviamos um link de confirmação para seu e-mail.');
      }
    } catch (err: any) {
      setError(err?.message || 'Não foi possível concluir o cadastro.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setError(null);
    setInfoMessage(null);
    if (!auth.currentUser) {
      setError('Faça login com seu e-mail e senha para reenviar o link de verificação.');
      return;
    }
    try {
      await sendEmailVerification(auth.currentUser);
      setInfoMessage('E-mail de verificação reenviado com sucesso! Verifique sua caixa de entrada e spam.');
    } catch (err: any) {
      setError(err?.message || 'Erro ao reenviar e-mail de verificação.');
    }
  };

  const handleCheckVerification = async () => {
    setError(null);
    setInfoMessage(null);
    if (!auth.currentUser) {
      setNeedsEmailVerification(false);
      setMode('login');
      return;
    }
    setLoading(true);
    try {
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
      if (auth.currentUser.emailVerified) {
        setInfoMessage('E-mail verificado com sucesso! Carregando seu acesso...');
        setNeedsEmailVerification(false);

        const cleanEmail = (auth.currentUser.email || '').trim().toLowerCase();
        const userDocRef = doc(db, 'usuarios', auth.currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        const userData = userDocSnap.exists() ? userDocSnap.data() : {};

        const loggedUser: AmetaUser = {
          id: auth.currentUser.uid,
          uid: auth.currentUser.uid,
          name: userData.name || cleanEmail.split('@')[0],
          email: cleanEmail,
          role: userData.role || 'Vistoriador',
          situacao: (userData.situacao || 'aguardando') as any,
          plataforma: (userData.plataforma || 'NOKIA') as any,
          assignedPlatform: (userData.assignedPlatform || 'NOKIA') as any,
          accessReleased: userData.accessReleased === true || userData.situacao === 'ativo',
          tipo: (userData.tipo || 'usuario') as any,
          emailVerified: true,
          createdAt: userData.createdAt || new Date().toISOString(),
        };

        onAuthenticated(loggedUser, initialVendorChoice);
      } else {
        setError('O e-mail ainda não foi confirmado. Abra o link que enviamos para sua caixa de entrada.');
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao verificar confirmação.');
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
          <div className="w-16 h-16 bg-white/10 rounded-2xl mx-auto flex items-center justify-center mb-3.5 backdrop-blur-md shadow-inner border border-white/20">
            <AmetaLogo size="md" theme="dark" />
          </div>
          <h1 className="text-xl font-black tracking-tight text-white">Ameta Telecom</h1>
          <p className="text-xs text-blue-200/90 mt-1 font-medium">
            Gestão Integrada de Sites & Vistorias Nokia e Ericsson
          </p>
        </div>

        {/* Mode Selector Tabs (Hidden when in email verification state) */}
        {!needsEmailVerification && (
          <div className="grid grid-cols-2 bg-slate-100 p-1.5 mx-6 mt-6 rounded-2xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setInfoMessage(null);
              }}
              className={`py-2.5 rounded-xl transition-all cursor-pointer ${
                mode === 'login'
                  ? 'bg-white text-blue-950 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
                setInfoMessage(null);
              }}
              className={`py-2.5 rounded-xl transition-all cursor-pointer ${
                mode === 'register'
                  ? 'bg-white text-blue-950 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Cadastrar-se
            </button>
          </div>
        )}

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
          {needsEmailVerification ? (
            /* Email Verification Screen */
            <div className="space-y-4 text-center py-2">
              <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto text-amber-600 shadow-inner">
                <Mail className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Verifique seu e-mail para continuar</h3>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  Enviamos um link de confirmação para o seu e-mail corporativo. Por favor, clique no link recebido para validar sua conta.
                </p>
              </div>

              <div className="space-y-2.5 pt-3">
                <button
                  type="button"
                  onClick={handleCheckVerification}
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-blue-700 to-indigo-800 hover:from-blue-800 hover:to-indigo-900 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  <span>{loading ? 'Verificando...' : 'Já verifiquei meu e-mail'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={loading}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  Reenviar e-mail de verificação
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setNeedsEmailVerification(false);
                    setMode('login');
                    setError(null);
                    setInfoMessage(null);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 font-semibold pt-1 cursor-pointer block mx-auto"
                >
                  Voltar para tela de Login
                </button>
              </div>
            </div>
          ) : mode === 'login' ? (
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

              {/* Utility Links */}
              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-center">
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
                <button
                  type="button"
                  onClick={() => {
                    setNeedsEmailVerification(true);
                    setError(null);
                    setInfoMessage(null);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                >
                  Reenviar verificação
                </button>
              </div>
            </form>
          ) : mode === 'register' ? (
            /* Register Form */
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nome Completo
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Seu Nome Completo"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
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

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Senha (mínimo 8 caracteres)
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

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Perfil Desejado
                  </label>
                  <select
                    value={requestedRole}
                    onChange={(e) => setRequestedRole(e.target.value as AmetaUser['role'])}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium cursor-pointer"
                  >
                    <option value="Vistoriador">Vistoriador</option>
                    <option value="Executor">Executor</option>
                    <option value="Coordenador Geral">Coordenador Geral</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Equipe / Dupla
                  </label>
                  <input
                    type="text"
                    value={requestedEquipe}
                    onChange={(e) => setRequestedEquipe(e.target.value)}
                    placeholder="Ex: Equipe Alpha"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
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
                  className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>{loading ? 'Cadastrando...' : 'Solicitar Cadastro'}</span>
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
