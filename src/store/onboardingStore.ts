import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialTutorialProgress, parseTutorialProgress, practiceQuantity, type TutorialProgress, type TutorialStage, type ProductDraft, type PracticeId } from '../services/onboarding/onboardingModel';
import { restorePracticeCart, useTutorialCartStore } from './tutorialCartStore';
import { practiceCartQuantities } from '../services/onboarding/practiceCatalog';

type OnboardingStore = TutorialProgress & {
  sessionKey: string | null; hydrated: boolean; runtimeReady: boolean; active: boolean; celebrating: boolean;
  remoteChecked: boolean; eligible: boolean; completionProductId: string | null; error: string | null; busy: boolean;
  canRestartProduct: boolean;
  openRequest: number; guideRevision: number; routeName: string;
  hydrate: (key: string | null) => Promise<void>;
  setRuntimeReady: (ready: boolean) => void;
  requestOpen: () => void; open: () => void; postpone: () => void; dismissCelebration: () => void;
  go: (stage: TutorialStage) => void; quantity: (id: PracticeId, quantity: number) => void;
  completePractice: () => boolean;
  setDraft: (draft: ProductDraft) => void; confirmField: () => void;
  savedProduct: (localId: string) => void; finishWithExisting: (serverId: string) => void;
  completionProblem: (issue: TutorialProgress['completionIssue'], rejectedId?: string | null) => void;
  restartProduct: () => void;
  applyRemote: (state: { completedAt: string | null; mobileAutoStartEligible: boolean; completionProductId: string | null }, celebrate?: boolean) => void;
};
// Serializar snapshots evita que una escritura lenta restaure un paso anterior.
let writes = Promise.resolve();
let hydrationEpoch = 0;
function persist() {
  const s = useOnboardingStore.getState();
  if (!s.sessionKey || !s.hydrated) return;
  const key = s.sessionKey;
  const value: TutorialProgress = { stage: s.stage, introSeen: s.introSeen, quantities: s.quantities, draft: s.draft,
    productLocalId: s.productLocalId, productServerId: s.productServerId, completedAt: s.completedAt,
    completionIssue: s.completionIssue, rejectedProductId: s.rejectedProductId };
  writes = writes.then(() => AsyncStorage.setItem(key, JSON.stringify(value))).catch(error => {
    console.warn('No se pudo conservar el tutorial móvil:', error);
    if (useOnboardingStore.getState().sessionKey === key) useOnboardingStore.setState({ error: 'No se pudo guardar el avance en este dispositivo.' });
  });
}
export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  ...initialTutorialProgress(), sessionKey: null, hydrated: false, runtimeReady: false, active: false, celebrating: false,
  remoteChecked: false, eligible: false, completionProductId: null, error: null, busy: false, canRestartProduct: false, openRequest: 0, guideRevision: 0, routeName: '',
  hydrate: async key => {
    const epoch = ++hydrationEpoch;
    set({ ...initialTutorialProgress(), sessionKey: key, hydrated: false, active: false, celebrating: false,
      remoteChecked: false, eligible: false, completionProductId: null, error: null, busy: false, canRestartProduct: false });
    useTutorialCartStore.getState().clear();
    if (!key) return;
    try {
      await writes;
      const raw = await AsyncStorage.getItem(key);
      if (get().sessionKey !== key || epoch !== hydrationEpoch) return;
      set({ ...parseTutorialProgress(raw), hydrated: true });
    } catch {
      if (get().sessionKey === key && epoch === hydrationEpoch) set({ hydrated: true, introSeen: true, error: 'No se pudo recuperar el avance. Puedes iniciar la guía manualmente.' });
    }
  },
  setRuntimeReady: ready => set({ runtimeReady: ready }),
  requestOpen: () => set(s => ({ openRequest: s.openRequest + 1 })),
  open: () => {
    if (get().completedAt) return;
    if (get().stage === 'catalog' || get().stage === 'cart') restorePracticeCart(get().quantities);
    set({ active: true, celebrating: false, introSeen: true, error: null }); persist();
  },
  postpone: () => {
    set({ active: false, introSeen: true });
    useTutorialCartStore.getState().clear();
    persist();
  },
  dismissCelebration: () => set({ celebrating: false, active: false }),
  go: stage => {
    if (get().completedAt) return;
    if (stage === 'catalog' && get().stage === 'sell') restorePracticeCart(get().quantities);
    set({ stage }); persist();
  },
  quantity: (id, value) => { set(s => ({ quantities: { ...s.quantities, [id]: practiceQuantity(value) } })); persist(); },
  completePractice: () => {
    const state = get(), cart = useTutorialCartStore.getState();
    if (!state.active || state.stage !== 'cart' || !cart.items.length || state.completedAt) return false;
    set({ stage: 'practiceDone', quantities: practiceCartQuantities(cart.items) });
    cart.clear();
    persist();
    return true;
  },
  setDraft: draft => { set({ draft }); persist(); },
  confirmField: () => set(s => ({ guideRevision: s.guideRevision + 1 })),
  // Cambiar de candidato invalida ambas referencias anteriores en el mismo snapshot.
  savedProduct: localId => {
    if (get().completedAt) return;
    set({ productLocalId: localId, productServerId: null, stage: 'pending', active: false, celebrating: true,
      quantities: {}, completionIssue: null, rejectedProductId: null, canRestartProduct: false });
    useTutorialCartStore.getState().clear(); persist();
  },
  finishWithExisting: serverId => {
    if (get().completedAt) return;
    const celebrate = get().stage !== 'pending';
    set({ productServerId: serverId, productLocalId: null, stage: 'pending', active: false, celebrating: get().celebrating || celebrate,
      quantities: {}, completionIssue: null, rejectedProductId: null, canRestartProduct: false });
    useTutorialCartStore.getState().clear(); persist();
  },
  completionProblem: (issue, rejectedId = null) => { if (get().completedAt) return; set({ completionIssue: issue, rejectedProductId: rejectedId }); persist(); },
  restartProduct: () => {
    if (get().completedAt || !get().canRestartProduct) return;
    set({ stage: 'product', active: true, celebrating: false, productLocalId: null, productServerId: null, completionIssue: null, rejectedProductId: null, canRestartProduct: false, error: null }); persist();
  },
  applyRemote: (state, celebrate = false) => {
    if (state.completedAt) {
      set({ completedAt: state.completedAt, stage: 'completed', active: false, celebrating: get().celebrating || (celebrate && !get().completedAt), quantities: {},
        remoteChecked: true, eligible: state.mobileAutoStartEligible, completionProductId: state.completionProductId, error: null, busy: false, completionIssue: null, rejectedProductId: null, canRestartProduct: false });
      useTutorialCartStore.getState().clear(); persist();
    } else set({ remoteChecked: true, eligible: state.mobileAutoStartEligible, completionProductId: state.completionProductId });
  },
}));

// Conservar cada cambio permite reanudar incluso si el sistema cierra la app.
useTutorialCartStore.subscribe(cart => {
  const tutorial = useOnboardingStore.getState();
  if (!tutorial.active || !['catalog', 'cart'].includes(tutorial.stage)) return;
  const quantities = practiceCartQuantities(cart.items);
  if (JSON.stringify(quantities) === JSON.stringify(tutorial.quantities)) return;
  useOnboardingStore.setState({ quantities });
  persist();
});
