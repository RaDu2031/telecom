import React, { useState } from 'react';
import {
  Lock,
  Mail,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  KeyRound,
} from 'lucide-react';
import { AmetaUser, VendorType } from '../types/telecom';
import { AmetaLogo } from './AmetaLogo';

interface AuthGateProps {
  onAuthenticated: (user: AmetaUser, initialVendor?: VendorType) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('rafael.araujo@ameta.com.br');
  const [password, setPassword] = useState('ameta2026');
  const [role, setRole] = useState<AmetaUser['role']>('Vistoriador');
  const [initialVendorChoice, setInitialVendorChoice] = useState<VendorType>('NOKIA');

  const [verificationCodeInput, setVerificationCodeInput] = useState('');
  const [serverGeneratedCode, setServerGeneratedCode] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<AmetaUser | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const validateAmetaEmailClient = (rawEmail: string): boolean => {
    const clean = rawEmail.trim().toLowerCase();
    const parts = clean.split('@');
    if (parts.length !== 2 || !parts[0]) return false;
    const domain = parts[1];
    return (
      domain === 'ameta.com' ||
      domain === 'ameta.com.br' ||
      domain === 'ameta.net' ||
      domain === 'ameta.org' ||
      domain === 'ameta.eng.br' ||
      domain.startsWith('ameta.') ||
      domain.endsWith('.ameta.com') ||
      domain.endsWith('.ameta.com.br')
    );
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
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
        setInfoMessage(data.message || 'Confirme o código enviado ao seu e-mail @ameta.');
        setMode('verify');
        setLoading(false);
        return;
      }

      onAuthenticated(data.user, initialVendorChoice);
    } catch {
      setError('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (!validateAmetaEmailClient(email)) {
      setError('O cadastro exige um e-mail corporativo @ameta.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
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

      setPendingUser(data.user);
      setServerGeneratedCode(data.verificationCode || null);
      setInfoMessage(`Código enviado para ${data.user.email}.`);
      setMode('verify');
    } catch {
      setError('Erro ao registrar conta.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const targetEmail = pendingUser?.email || email;
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          code: verificationCodeInput.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Código inválido.');
        setLoading(false);
        return;
      }

      onAuthenticated(data.user, initialVendorChoice);
    } catch {
      setError('Falha ao validar código.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError(null);
    const targetEmail = pendingUser?.email || email;
    try {
      const response = await fetch('/api/auth/resend-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      });
      const data = await response.json();
      if (response.ok) {
        setServerGeneratedCode(data.verificationCode);
        setInfoMessage(`Novo código gerado para ${targetEmail}.`);
      }
    } catch {
      setError('Erro ao reenviar código.');
    }
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
                ? 'Acesse o portal de Engenharia e Sites'
                : mode === 'register'
                ? 'Cadastro corporativo @ameta'
                : 'Verificação de segurança'}
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

        {/* Minimalist Login Form */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                E-mail @ameta
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@ameta.com.br"
                  className="w-full pl-10 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 font-mono transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 transition-colors"
                />
              </div>
            </div>

            {/* Clean Vendor Switcher */}
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

            <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className="hover:text-blue-600 transition-colors cursor-pointer"
              >
                Criar conta @ameta
              </button>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setEmail('teste@ameta.com.br');
                    setPassword('ameta2026');
                  }}
                  className="px-2 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-lg font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Vistoriador Teste
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmail('executor.teste@ameta.com.br');
                    setPassword('ameta2026');
                  }}
                  className="px-2 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 rounded-lg font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Executor Teste
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmail('rafael.araujo@ameta.com.br');
                    setPassword('ameta2026');
                  }}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  ADM
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Minimalist Register Form */}
        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Nome
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome completo"
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                E-mail @ameta
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@ameta.com.br"
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 font-mono focus:outline-none focus:bg-white focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Senha
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer"
            >
              {loading ? 'Criando...' : 'Continuar'}
            </button>

            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className="text-xs text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
              >
                Já tenho conta
              </button>
            </div>
          </form>
        )}

        {/* Minimalist Verification Form */}
        {mode === 'verify' && (
          <form onSubmit={handleVerifyEmail} className="space-y-4">
            {serverGeneratedCode && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-slate-500">Código gerado</div>
                  <div className="text-base font-mono font-bold text-slate-900 tracking-widest tabular-nums">
                    {serverGeneratedCode}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setVerificationCodeInput(serverGeneratedCode)}
                  className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                >
                  Usar código
                </button>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Código de 6 dígitos
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={verificationCodeInput}
                  onChange={(e) => setVerificationCodeInput(e.target.value)}
                  placeholder="000000"
                  className="w-full pl-10 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono tracking-widest text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600 tabular-nums"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={loading || verificationCodeInput.trim().length < 6}
                className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer"
              >
                {loading ? 'Validando...' : 'Confirmar'}
              </button>
              <button
                type="button"
                onClick={handleResendCode}
                className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors cursor-pointer"
                title="Reenviar código"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setMode('login')}
                className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Voltar ao login
              </button>
            </div>
          </form>
        )}
        </div>
      </div>
    </div>
  );
};
