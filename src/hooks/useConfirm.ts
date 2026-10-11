import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';

export interface ConfirmOptions {
  title?: string;
  isDanger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ConfirmRequest {
  message: string;
  options?: ConfirmOptions | boolean;
  resolve: (value: boolean) => void;
}

type ConfirmListener = (request: ConfirmRequest) => void;
const confirmListeners = new Set<ConfirmListener>();

export const requestConfirm = (
  message: string,
  options?: ConfirmOptions | boolean
): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    if (confirmListeners.size === 0) {
      console.warn('ConfirmProvider não foi encontrado montado. Retornando false.');
      resolve(false);
      return;
    }
    confirmListeners.forEach((listener) => {
      try {
        listener({ message, options, resolve });
      } catch (err) {
        console.error('Erro ao acionar confirmListener:', err);
      }
    });
  });
};

export const confirmar = requestConfirm;

export const useConfirm = () => {
  return {
    confirmar: requestConfirm,
  };
};

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    isDanger: boolean;
    confirmLabel: string;
    cancelLabel: string;
  }>({
    isOpen: false,
    title: 'Confirmação',
    message: '',
    isDanger: false,
    confirmLabel: 'Confirmar',
    cancelLabel: 'Cancelar',
  });

  const currentResolverRef = useRef<((value: boolean) => void) | null>(null);

  useEffect(() => {
    const handleRequest = (req: ConfirmRequest) => {
      if (currentResolverRef.current) {
        currentResolverRef.current(false);
      }
      currentResolverRef.current = req.resolve;

      const isDangerOption = typeof req.options === 'boolean' ? req.options : req.options?.isDanger;
      const isDanger =
        isDangerOption !== undefined
          ? isDangerOption
          : /excluir|apagar|remover|limpar|deletar|desvincular|perderá|bloqueado/i.test(req.message);

      const title =
        typeof req.options === 'object' && req.options?.title
          ? req.options.title
          : isDanger
          ? 'Confirmar Exclusão'
          : 'Confirmação';

      const confirmLabel =
        typeof req.options === 'object' && req.options?.confirmLabel
          ? req.options.confirmLabel
          : 'Confirmar';

      const cancelLabel =
        typeof req.options === 'object' && req.options?.cancelLabel
          ? req.options.cancelLabel
          : 'Cancelar';

      setDialog({
        isOpen: true,
        title,
        message: req.message,
        isDanger,
        confirmLabel,
        cancelLabel,
      });
    };

    confirmListeners.add(handleRequest);
    return () => {
      confirmListeners.delete(handleRequest);
    };
  }, []);

  const handleConfirm = useCallback(() => {
    if (currentResolverRef.current) {
      currentResolverRef.current(true);
      currentResolverRef.current = null;
    }
    setDialog((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleCancel = useCallback(() => {
    if (currentResolverRef.current) {
      currentResolverRef.current(false);
      currentResolverRef.current = null;
    }
    setDialog((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return React.createElement(
    React.Fragment,
    null,
    children,
    React.createElement(ConfirmDialog, {
      isOpen: dialog.isOpen,
      title: dialog.title,
      message: dialog.message,
      isDanger: dialog.isDanger,
      confirmLabel: dialog.confirmLabel,
      cancelLabel: dialog.cancelLabel,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
    })
  );
};
