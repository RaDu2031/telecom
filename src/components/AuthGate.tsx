import React, { useState } from 'react';
import {
  Lock,
  Mail,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  KeyRound,
  LogOut,
  Send,
} from 'lucide-react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  reload,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import { AmetaUser, VendorType } from '../types/telecom';
import { AmetaLogo } from './AmetaLogo';
import {
  auth,
  isFirebaseEnvConfigured,
  isAllowedCorporateEmail,
  ALLOWED_EMAIL_DOMAIN,
} from '../lib/firebase';
import { dataService } from '../services/dataService';
import { cloudFetch } from '../lib/firebaseCloud';

const fetch = cloudFetch;

interface AuthGateProps {
  onAuthenticated: (user: AmetaUser, initialVendor?: VendorType) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'verify' | 'reset'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [initialVendorChoice, setInitialVendorChoice] = useState<VendorType>('NOKIA');

  const [unverifiedFirebaseUser, setUnverifiedFirebaseUser] = useState<FirebaseUser | null>(null);
  const [verificationCodeInput, setVerificationCodeInput] = useState('');
  const [serverGeneratedCode, setServerGeneratedCode] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<AmetaUser | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const validateCorporateDomain = (rawEmail: string): boolean => {
    return isAllowedCorporateEmail(rawEmail);
  };

  const translateFirebaseAuthError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password')) {
      return 'E-mail ou senha incorretos.';
    }
    if (msg.includes('auth/user-not-found')) {
      return 'Nenhuma conta encontrada com este e-mail. Clique em "Criar conta".';
    }
    if (msg.includes('auth/email-already-in-use')) {
      return 'Este e-mail @ametaservicos.com.br já possui conta cadastrada. Faça login ou recupere a senha.';
    }
    if (msg.includes('auth/weak-password')) {
      return 'A senha deve ter no mínimo 8 caracteres.';
    }
    if (msg.includes('auth/too-many-requests')) {
      return 'Muitas tentativas seguidas. Aguarde alguns instantes antes de tentar novamente.';
    }
    return `Erro de autenticação: ${msg}`;
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

    if (password.length < 8) {
      setError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }

    setLoading(true);
    try {
      if (isFirebaseEnvConfigured && auth) {
        const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
        await reload(cred.user);

        if (!cred.user.emailVerified) {
          setUnverifiedFirebaseUser(cred.user);
          setInfoMessage(
            `Seu e-mail (${cleanEmail}) ainda não foi verificado. Verifique sua caixa de entrada ou clique em "Reenviar e-mail de verificação".`
          );
          setMode('verify');
          setLoading(false);
          return;
        }

        await cred.user.getIdToken(true);
        const ametaUser = await dataService.garantirUsuarioAoAutenticar({
          uid: cred.user.uid,
          email: cleanEmail,
          name: cred.user.displayName || name.trim() || cleanEmail.split('@')[0],
          emailVerified: true,
        });

        onAuthenticated(ametaUser, initialVendorChoice);
        return;
      }

      // Fallback local caso .env.local ainda não esteja configurado no ambiente de preview
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Falha na autenticação.');
        setLoading(false);
        return;
      }

      if (data.requiresVerification) {
        setPendingUser(data.user);
        setServerGeneratedCode(data.verificationCode || null);
        setInfoMessage(
          data.message || `Verifique seu e-mail (${cleanEmail}) para liberar o acesso.`
        );
        setMode('verify');
        setLoading(false);
        return;
      }

      onAuthenticated(data.user, initialVendorChoice);
    } catch (err) {
      setError(translateFirebaseAuthError(err));
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
        `Cadastro rejeitado: Só são aceitos e-mails do domínio @${ALLOWED_EMAIL_DOMAIN}.`
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
      if (isFirebaseEnvConfigured && auth) {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        await updateProfile(cred.user, { displayName: name.trim() });
        await sendEmailVerification(cred.user);

        setUnverifiedFirebaseUser(cred.user);
        setInfoMessage(
          `Conta criada! Enviamos um link de verificação do Firebase para ${cleanEmail}. Confirme o e-mail na sua caixa de entrada para acessar o sistema.`
        );
        setMode('verify');
        setLoading(false);
        return;
      }

      // Fallback local caso .env.local ainda não esteja preenchido
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: cleanEmail,
          password,
          role: 'Vistoriador',
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Não foi possível concluir o cadastro.');
        setLoading(false);
        return;
      }

      setPendingUser({
        ...data.user,
        situacao: 'aguardando',
        accessReleased: false,
      });
      setServerGeneratedCode(data.verificationCode || null);
      setInfoMessage(
        `Enviamos a verificação para ${cleanEmail}. Confirme seu e-mail abaixo para continuar.`
      );
      setMode('verify');
    } catch (err) {
      setError(translateFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCheckEmailVerified = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setLoading(true);

    try {
      if (isFirebaseEnvConfigured && auth) {
        const currentUser = auth.currentUser || unverifiedFirebaseUser;
        if (!currentUser) {
          setError('Sessão expirada. Faça login novamente após verificar seu e-mail.');
          setMode('login');
          setLoading(false);
          return;
        }

        await reload(currentUser);
        if (!currentUser.emailVerified) {
          setError(
            'Seu e-mail ainda consta como não verificado no Firebase. Clique no link enviado para sua caixa de entrada (ou spam) e tente novamente.'
          );
          setLoading(false);
          return;
        }

        await currentUser.getIdToken(true);
        const ametaUser = await dataService.garantirUsuarioAoAutenticar({
          uid: currentUser.uid,
          email: currentUser.email || email.trim().toLowerCase(),
          name: currentUser.displayName || name.trim() || email.split('@')[0],
          emailVerified: true,
        });

        onAuthenticated(ametaUser, initialVendorChoice);
        return;
      }

      // Fallback local
      const targetEmail = pendingUser?.email || email.trim().toLowerCase();
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          code: verificationCodeInput.trim() || serverGeneratedCode || '000000',
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Não foi possível verificar o e-mail.');
        setLoading(false);
        return;
      }

      onAuthenticated(
        {
          ...data.user,
          situacao: data.user.situacao || (data.user.accessReleased ? 'ativo' : 'aguardando'),
        },
        initialVendorChoice
      );
    } catch (err) {
      setError(translateFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setError(null);
    setInfoMessage(null);
    setLoading(true);

    try {
      if (isFirebaseEnvConfigured && auth) {
        const currentUser = auth.currentUser || unverifiedFirebaseUser;
        if (currentUser) {
          await sendEmailVerification(currentUser);
          setInfoMessage(
            `E-mail de verificação reenviado para ${currentUser.email}. Verifique sua caixa de entrada e spam.`
          );
        } else {
          setError('Faça login novamente para solicitar um novo envio de verificação.');
        }
        setLoading(false);
        return;
      }

      const targetEmail = pendingUser?.email || email.trim().toLowerCase();
      const response = await fetch('/api/auth/resend-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      });
      const data = await response.json();
      if (response.ok) {
        setServerGeneratedCode(data.verificationCode);
        setInfoMessage(`Nova verificação enviada para ${targetEmail}.`);
      }
    } catch (err) {
      setError(translateFirebaseAuthError(err));
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
      if (isFirebaseEnvConfigured && auth) {
        await sendPasswordResetEmail(auth, cleanEmail);
        setInfoMessage(
          `Enviamos um link de redefinição de senha do Firebase para ${cleanEmail}. Verifique sua caixa de entrada.`
        );
      } else {
        setInfoMessage(
          `Instruções de recuperação de senha solicitadas para ${cleanEmail}. Configure o .env.local do Firebase para envio real de e-mail.`
        );
      }
    } catch (err) {
      setError(translateFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSignOutFromVerify = async () => {
    if (isFirebaseEnvConfigured && auth) {
      try {
        await signOut(auth);
      } catch {
        // ignore
      }
    }
    setUnverifiedFirebaseUser(null);
    setPendingUser(null);
    setError(null);
    setInfoMessage(null);
    setMode('login');
  };

  return (
    <div className="min-h-screen bg-[#F0F3FB] text-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden">
        {/* Top Brand Accent Bar with Ameta Navy & Teal */}
        <div className="h-1.5 w-full bg-gradient-to-r from-[#223585] via-[#206289] to-[#1E8E8D]" />

        <div className="p-7 space-y-6">
          {/* Brand Header with Official Ameta Serviços Logo */}
          <div className="flex flex-col items-center text-center space-y-2">
            <AmetaLogo size="lg" theme="light" />
            <p className="text-xs text-slate-500">
              {mode === 'login'
                ? 'Acesse o portal de Engenharia e Sites (@ametaservicos.com.br)'
                : mode === 'register'
                ? 'Criar conta corporativa (@ametaservicos.com.br)'
                : mode === 'reset'
                ? 'Recuperação de senha por e-mail'
                : 'Verifique seu e-mail para liberar o acesso'}
            </p>
          </div>

          {/* Alerts */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {infoMessage && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2.5 text-xs text-blue-700">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>{infoMessage}</span>
            </div>
          )}

          {/* Login Form */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  E-mail Corporativo (@ametaservicos.com.br)
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nome@ametaservicos.com.br"
                    className="w-full pl-10 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 font-mono transition-colors"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-600">
                    Senha (mín. 8 caracteres)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setError(null);
                      setInfoMessage(null);
                    }}
                    className="text-[11px] text-blue-600 hover:underline font-medium cursor-pointer"
                  >
                    Esqueci minha senha
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Projeto Inicial
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setInitialVendorChoice('NOKIA')}
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      initialVendorChoice === 'NOKIA'
                        ? 'bg-white text-blue-600 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    NOKIA
                  </button>
                  <button
                    type="button"
                    onClick={() => setInitialVendorChoice('ERICSSON')}
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      initialVendorChoice === 'ERICSSON'
                        ? 'bg-white text-indigo-600 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    ERICSSON
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>{loading ? 'Entrando...' : 'Entrar'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="pt-2 flex items-center justify-center text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                    setInfoMessage(null);
                  }}
                  className="hover:text-blue-600 font-medium transition-colors cursor-pointer"
                >
                  Criar conta (@ametaservicos.com.br)
                </button>
              </div>
            </form>
          )}

          {/* Register Form */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Nome Completo
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome completo"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  E-mail Corporativo (@ametaservicos.com.br)
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@ametaservicos.com.br"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 font-mono focus:outline-none focus:bg-white focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Senha (mínimo 8 caracteres)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer"
              >
                {loading ? 'Criando conta...' : 'Criar Conta e Enviar E-mail de Verificação'}
              </button>

              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setInfoMessage(null);
                  }}
                  className="text-xs text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
                >
                  Já tenho conta — Voltar ao login
                </button>
              </div>
            </form>
          )}

          {/* Password Reset Form */}
          {mode === 'reset' && (
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  E-mail Corporativo (@ametaservicos.com.br)
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@ametaservicos.com.br"
                    className="w-full pl-10 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 font-mono focus:outline-none focus:bg-white focus:border-blue-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>{loading ? 'Enviando...' : 'Enviar E-mail de Recuperação'}</span>
              </button>

              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setInfoMessage(null);
                  }}
                  className="text-xs text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
                >
                  Voltar ao login
                </button>
              </div>
            </form>
          )}

          {/* Verify Email Screen ("Verifique seu e-mail") */}
          {mode === 'verify' && (
            <form onSubmit={handleCheckEmailVerified} className="space-y-4">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-center">
                <div className="mx-auto w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Mail className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">Verifique seu e-mail</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Enviamos um e-mail de verificação para{' '}
                  <strong className="font-mono text-slate-900">
                    {unverifiedFirebaseUser?.email || pendingUser?.email || email}
                  </strong>
                  . O acesso ao sistema só é liberado após a confirmação do seu e-mail.
                </p>
              </div>

              {!isFirebaseEnvConfigured && serverGeneratedCode && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-slate-500">Código local de teste</div>
                    <div className="text-base font-mono font-bold text-slate-900 tracking-widest tabular-nums">
                      {serverGeneratedCode}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVerificationCodeInput(serverGeneratedCode)}
                    className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  >
                    Preencher
                  </button>
                </div>
              )}

              {!isFirebaseEnvConfigured && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                    Código de confirmação
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
                    <input
                      type="text"
                      maxLength={6}
                      value={verificationCodeInput}
                      onChange={(e) => setVerificationCodeInput(e.target.value)}
                      placeholder="000000"
                      className="w-full pl-10 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono tracking-widest text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600 tabular-nums"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer"
              >
                {loading ? 'Verificando...' : 'Já verifiquei meu e-mail — Entrar'}
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={handleResendVerification}
                className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reenviar e-mail de verificação</span>
              </button>

              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={handleSignOutFromVerify}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sair / Voltar ao login</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
