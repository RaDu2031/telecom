import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class CloudErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const raw = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: raw };
  }

  render() {
    if (this.state.hasError) {
      let parsedDetails: Record<string, any> | null = null;
      try {
        parsedDetails = JSON.parse(this.state.errorMessage);
      } catch {
        parsedDetails = null;
      }

      return (
        <div className="min-h-screen bg-[#F0F3FB] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-red-200 rounded-2xl shadow-lg p-6 space-y-4">
            <h2 className="text-base font-bold text-red-700">
              Alerta de Sincronização / Permissão na Nuvem
            </h2>
            <p className="text-xs text-slate-600">
              {parsedDetails?.error ||
                this.state.errorMessage ||
                'Ocorreu um erro inesperado ao sincronizar os dados.'}
            </p>
            {parsedDetails && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-mono text-slate-700 space-y-1">
                <div>Operação: {parsedDetails.operationType}</div>
                <div>Caminho: {parsedDetails.path}</div>
                <div>Usuário: {parsedDetails.authInfo?.email || 'Não autenticado'}</div>
              </div>
            )}
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, errorMessage: '' })}
              className="w-full py-2.5 px-4 bg-[#223585] hover:bg-[#1b2a6b] text-white text-xs font-bold rounded-xl cursor-pointer"
            >
              Continuar no Sistema
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <CloudErrorBoundary>
    <App />
  </CloudErrorBoundary>
);
