import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { useOnboardingStore } from '../../store/onboardingStore';
import { db } from '../../database/Database';
import { syncService } from '../sync/SyncService';
import { onboardingStorageKey } from './onboardingModel';
import { completeSharedOnboarding, fetchSharedOnboarding, onboardingHeaders } from './onboardingApi';
import { validProductAmounts } from '../products/productAmounts';

export function useOnboardingRuntime() {
  const { getToken } = useAuth();
  const tokenGetter = useRef(getToken); tokenGetter.current = getToken;
  const accountId = useAuthStore(s => s.accountId);
  const ownerId = useAuthStore(s => s.subUser?.isOwner ? s.subUser.id : null);
  const authenticated = useAuthStore(s => s.isAuthenticated);
  const key = authenticated && accountId && ownerId ? onboardingStorageKey(accountId, ownerId) : null;
  useEffect(() => { void useOnboardingStore.getState().hydrate(key); }, [key]);
  const hydrated = useOnboardingStore(s => s.hydrated);
  const online = useSyncStore(s => s.isOnline);
  const lastSync = useSyncStore(s => s.lastSyncTime);
  const stage = useOnboardingStore(s => s.stage);
  const routeName = useOnboardingStore(s => s.routeName);
  const checkRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!key || !hydrated || !useOnboardingStore.getState().hydrated || useOnboardingStore.getState().sessionKey !== key || !accountId) return;
    let disposed = false, running = false;
    let blockedAuthorization: string | null = null;
    const rejected = new Set<string>();
    const abort = new AbortController();
    const current = () => !disposed && useOnboardingStore.getState().sessionKey === key && useAuthStore.getState().accountId === accountId;
    const check = async () => {
      if (!current() || running || AppState.currentState !== 'active' || !useSyncStore.getState().isOnline) return;
      // Tomar el lock antes del primer await: tampoco finalizamos dos veces ante eventos simultáneos.
      running = true;
      try {
        const token = await tokenGetter.current();
        if (!current()) return;
        const auth = useAuthStore.getState();
        if (!token || !auth.subUserToken || !auth.subUser?.isOwner) return;
        const headers = onboardingHeaders(token, auth.subUserToken, accountId);
        const authorization = `${token}:${auth.subUserToken}`;
        let remote = await fetchSharedOnboarding(headers, abort.signal);
        if (!current()) return;
        const beforeRemote = useOnboardingStore.getState();
        beforeRemote.applyRemote(remote, !!remote.completedAt && beforeRemote.active && beforeRemote.stage === 'pending');
        if (remote.completedAt && !beforeRemote.completedAt) void syncService.incrementalSync().catch(() => {});
        let state = useOnboardingStore.getState();
        if (remote.completedAt || state.stage !== 'pending') return;
        if (state.rejectedProductId) rejected.add(state.rejectedProductId);
        useOnboardingStore.setState({ busy: true, canRestartProduct: false });
        let productId = state.productServerId;
        let localServerId: string | null = null;
        let pendingOperation = false;
        if (state.productLocalId) {
          const product = await db.queryFirst<{ server_id: string | null; synced: number; cost_cents: number; price_cents: number; is_available_for_sale: number; data: string }>('SELECT server_id, synced, cost_cents, price_cents, is_available_for_sale, data FROM products WHERE local_id = ? LIMIT 1', [state.productLocalId]);
          const queued = await db.queryFirst("SELECT id FROM sync_queue WHERE entity_type = 'product' AND entity_local_id = ? AND status != 'synced' LIMIT 1", [state.productLocalId]);
          if (!current()) return;
          pendingOperation = !!queued;
          localServerId = product?.server_id ?? null;
          let data: { isActive?: boolean } = {};
          try { data = JSON.parse(product?.data || '{}'); } catch { /* Las columnas siguen siendo la fuente de importes. */ }
          if (!product) state.completionProblem('missing_product');
          else if (!validProductAmounts(product.price_cents, product.cost_cents)) state.completionProblem('needs_correction');
          else if (!product.is_available_for_sale || data.isActive === false) state.completionProblem('invalid_product', product.server_id);
          else if (state.completionIssue !== 'invalid_product') state.completionProblem(null);
          state = useOnboardingStore.getState();
          productId = !state.completionIssue && product?.synced && product.server_id ? product.server_id : null;
        }
        if (state.rejectedProductId) rejected.add(state.rejectedProductId);
        if (productId && rejected.has(productId)) productId = null;
        if (!productId && state.completionIssue && remote.completionProductId && remote.completionProductId !== localServerId && !rejected.has(remote.completionProductId)) {
          // El candidato alternativo sustituye también el localId: nunca consultar después la fila anterior.
          state.finishWithExisting(remote.completionProductId);
          productId = remote.completionProductId;
        }
        if (!productId) {
          state = useOnboardingStore.getState();
          useOnboardingStore.setState({ canRestartProduct: !!state.completionIssue && state.completionIssue !== 'needs_correction' && !pendingOperation,
            error: state.completionIssue === 'needs_correction' ? 'Corrige el precio y el costo del producto guardado. Deben ser mayores que cero.' : state.completionIssue ? 'El producto elegido ya no está disponible. Puedes retomar el paso de producto cuando no queden envíos pendientes.' : null });
          return;
        }
        if (blockedAuthorization === authorization) return;
        useOnboardingStore.setState({ error: null });
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const completedAt = await completeSharedOnboarding(headers, productId, abort.signal);
            if (!current()) return;
            state = useOnboardingStore.getState();
            state.applyRemote({ ...remote, completedAt }, state.active);
            void syncService.incrementalSync().catch(() => {});
            return;
          } catch (error) {
            if (!current()) return;
            const status = (error as any)?.response?.status;
            if (status === 401 || status === 403) blockedAuthorization = authorization;
            if (status !== 422 && status !== 400) throw error;
            rejected.add(productId);
            useOnboardingStore.getState().completionProblem('invalid_product', productId);
            // Una respuesta 422 es definitiva para este candidato, no una pérdida de conexión.
            remote = await fetchSharedOnboarding(headers, abort.signal);
            if (!current()) return;
            state = useOnboardingStore.getState();
            state.applyRemote(remote, !!remote.completedAt && state.active);
            if (remote.completedAt) {
              void syncService.incrementalSync().catch(() => {});
              return;
            }
            const alternative = remote.completionProductId;
            if (attempt === 0 && alternative && !rejected.has(alternative)) {
              state.finishWithExisting(alternative);
              productId = alternative;
              continue;
            }
            useOnboardingStore.setState({ canRestartProduct: !pendingOperation, error: 'El producto elegido ya no es válido. Retoma el paso de producto para continuar.' });
            return;
          }
        }
      } catch (error) {
        const status = (error as any)?.response?.status;
        if (current()) useOnboardingStore.setState({ error: status === 401 ? 'Tu sesión venció. Vuelve a iniciar sesión para confirmar el tutorial.' : status === 403 ? 'Tu usuario no tiene permiso para completar el tutorial. Vuelve a entrar con el dueño del negocio.' : 'No se pudo confirmar el progreso. Lo reintentaremos al conectar de nuevo.' });
      } finally {
        running = false;
        if (current()) useOnboardingStore.setState({ busy: false });
      }
    };
    checkRef.current = () => { void check(); };
    void check();
    const interval = setInterval(() => { if (!useOnboardingStore.getState().completedAt) void check(); }, 30000);
    const app = AppState.addEventListener('change', next => { if (next === 'active') void check(); });
    const unsubscribe = db.subscribeChanges(() => { if (useOnboardingStore.getState().stage === 'pending') void check(); });
    return () => { disposed = true; abort.abort(); clearInterval(interval); app.remove(); unsubscribe(); checkRef.current = () => {}; };
  }, [key, hydrated]);
  useEffect(() => { checkRef.current(); }, [online, lastSync, stage, routeName]);
  return key;
}
