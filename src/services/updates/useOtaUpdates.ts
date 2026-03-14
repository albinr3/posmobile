import { useCallback, useMemo, useRef, useState } from 'react';
import * as Updates from 'expo-updates';

type OtaUpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

interface OtaUpdateState {
  status: OtaUpdateStatus;
  visible: boolean;
  errorMessage: string | null;
}

const DEFAULT_ERROR_MESSAGE = 'No se pudo completar la actualizacion. Intenta de nuevo.';

export function useOtaUpdates() {
  const [state, setState] = useState<OtaUpdateState>({
    status: 'idle',
    visible: false,
    errorMessage: null,
  });
  const runningCheckRef = useRef(false);
  const runningDownloadRef = useRef(false);

  const supported = useMemo(() => !__DEV__ && Updates.isEnabled, []);

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }));
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!supported || runningCheckRef.current) return;

    runningCheckRef.current = true;
    setState({ status: 'checking', visible: true, errorMessage: null });

    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setState({ status: 'idle', visible: false, errorMessage: null });
        return;
      }

      setState({ status: 'available', visible: true, errorMessage: null });
    } catch (error: any) {
      const message = String(error?.message || DEFAULT_ERROR_MESSAGE);
      setState({ status: 'error', visible: true, errorMessage: message });
    } finally {
      runningCheckRef.current = false;
    }
  }, [supported]);

  const downloadUpdate = useCallback(async () => {
    if (!supported || runningDownloadRef.current) return;

    runningDownloadRef.current = true;
    setState((prev) => ({ ...prev, status: 'downloading', visible: true, errorMessage: null }));

    try {
      const result = await Updates.fetchUpdateAsync();
      if (result.isNew) {
        setState({ status: 'ready', visible: true, errorMessage: null });
        return;
      }

      setState({ status: 'idle', visible: false, errorMessage: null });
    } catch (error: any) {
      const message = String(error?.message || DEFAULT_ERROR_MESSAGE);
      setState({ status: 'error', visible: true, errorMessage: message });
    } finally {
      runningDownloadRef.current = false;
    }
  }, [supported]);

  const reloadApp = useCallback(async () => {
    if (!supported) return;

    try {
      await Updates.reloadAsync();
    } catch (error: any) {
      const message = String(error?.message || DEFAULT_ERROR_MESSAGE);
      setState({ status: 'error', visible: true, errorMessage: message });
    }
  }, [supported]);

  return {
    status: state.status,
    visible: state.visible,
    errorMessage: state.errorMessage,
    supported,
    dismiss,
    checkForUpdates,
    downloadUpdate,
    reloadApp,
  };
}
