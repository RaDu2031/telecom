import React, { useState } from 'react';
import {
  Lock,
  Mail,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Send,
} from 'lucide-react';
import { AmetaUser, VendorType } from '../types/telecom';
import { AmetaLogo } from './AmetaLogo';
import { isAllowedCorporateEmail, ALLOWED_EMAIL_DOMAIN } from '../lib/firebase';

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
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'E-mail ou senha incorretos.');
        setLoading(false);
        return;
      }

      const loggedUser: AmetaUser = {
        ...data.user,
        emailVerified: true,
      };

      onAuthenticated(loggedUser, initialVendorChoice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na conexão com o servidor.');
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
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: cleanEmail,
          password,
          role: requestedRole,
          equipe: requestedEquipe.trim() || name.trim(),
          plataforma: initialVendorChoice === 'ERICSSON' ? 'ERICSSON' : 'NOKIA',
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'Não foi possível concluir o cadastro.');
        setLoading(false);
        return;
      }

      const finalUser: AmetaUser = {
        ...data.user,
        emailVerified: true,
      };

      onAuthenticated(finalUser, initialVendorChoice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar o cadastro.');
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
      setInfoMessage(
        `Solicitação registrada para ${cleanEmail}. Solicite a alteração da sua senha diretamente ao Administrador Dono no Painel de Permissões.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao solicitar redefinição.');
    } finally {
      setLoading(false);
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
                ? 'Acesse o portal de Engenharia e Sites (@ametaservicos.com.br)'
                : mode === 'register'
                ? 'Criar conta corporativa (@ametaservicos.com.br)'
                : 'Recuperação de acesso / senha'}
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
                    Senha (mín. 6 caracteres)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setError(null);
                      setInfoMessage(null);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 transition-colors cursor-pointer"
                  >
                    Esqueceu?
                  </button>
                </div>
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

              {/* Vendor Selector */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Plataforma inicial
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInitialVendorChoice('NOKIA')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      initialVendorChoice === 'NOKIA'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    TIM / Nokia
                  </button>
                  <button
                    type="button"
                    onClick={() => setInitialVendorChoice('ERICSSON')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      initialVendorChoice === 'ERICSSON'
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Ericsson
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <span>{loading ? 'Entrando...' : 'Entrar no Portal'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                    setInfoMessage(null);
                  }}
                  className="text-xs text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
                >
                  Não tem conta? <strong className="text-blue-600">Criar conta</strong>
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
                  placeholder="Seu Nome Completo"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  E-mail Corporativo (@ametaservicos.com.br)
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nome@ametaservicos.com.br"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 font-mono transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Função Pretendida
                  </label>
                  <select
                    value={requestedRole}
                    onChange={(e) => setRequestedRole(e.target.value as AmetaUser['role'])}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-bold focus:outline-none focus:bg-white focus:border-blue-600 cursor-pointer"
                  >
                    <option value="Vistoriador">Vistoriador</option>
                    <option value="Executor">Executor</option>
                    <option value="Coordenador Geral">Coordenador Geral</option>
                    <option value="Coordenador Engenharia">Coordenador Eng.</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Dupla / Equipe (Opcional)
                  </label>
                  <input
                    type="text"
                    value={requestedEquipe}
                    onChange={(e) => setRequestedEquipe(e.target.value)}
                    placeholder="Ex: João / Maria"
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Senha (mín. 8 caracteres)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Plataforma inicial
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInitialVendorChoice('NOKIA')}
                    className={`py-1.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      initialVendorChoice === 'NOKIA'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    TIM / Nokia
                  </button>
                  <button
                    type="button"
                    onClick={() => setInitialVendorChoice('ERICSSON')}
                    className={`py-1.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      initialVendorChoice === 'ERICSSON'
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Ericsson
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <span>{loading ? 'Cadastrando...' : 'Cadastrar e Acessar'}</span>
                <ArrowRight className="w-4 h-4" />
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
                  Já tem conta? <strong className="text-blue-600">Fazer login</strong>
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
                <span>{loading ? 'Enviando...' : 'Solicitar Redefinição'}</span>
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
        </div>
      </div>
    </div>
  );
};
