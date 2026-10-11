type ToastListener = (message: string) => void;
const toastListeners = new Set<ToastListener>();

export const showToast = (message: string): void => {
  if (!message) return;
  toastListeners.forEach((listener) => {
    try {
      listener(message);
    } catch (err) {
      console.error('Erro no listener de toast:', err);
    }
  });
};

export const subscribeToast = (listener: ToastListener): (() => void) => {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
};
