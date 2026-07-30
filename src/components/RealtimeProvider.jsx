import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider.jsx';
import { getDocument, listDocuments } from '../services/documentsApi.js';
import { listTrash } from '../services/trashApi.js';
import { getMe } from '../services/usersApi.js';
import { listVersions } from '../services/versionsApi.js';
import { confirmCheckoutSession, getSubscription } from '../services/subscriptionApi.js';
import {
  connectRealtime,
  disconnectRealtime,
  listenForCommittedEvents,
  requestRealtimeSync,
  subscribeToDocument,
  unsubscribeFromDocument,
} from '../services/realtime.js';

const RealtimeContext = createContext(null);
const MAX_SEEN_EVENT_IDS = 300;

function emptyState() {
  return {
    profile: null,
    documents: [],
    trashDocuments: [],
    documentDetails: {},
    versionsByDocument: {},
    deletedDocumentIds: [],
    subscription: null,
    subscriptionLoading: false,
    connection: 'disconnected',
    error: '',
  };
}

function revisionOf(document) {
  const value = Number(document?.revision);
  return Number.isFinite(value) ? value : null;
}

function upsertById(items, item) {
  const index = items.findIndex((current) => current.id === item.id);
  if (index < 0) return [item, ...items];
  return items.map((current) => (current.id === item.id ? { ...current, ...item } : current));
}

function withoutId(items, id) {
  return items.filter((item) => item.id !== id);
}

export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState(emptyState);
  const latestRevisionRef = useRef(new Map());
  const latestStatsTimestampRef = useRef(0);
  const seenEventIdsRef = useRef(new Set());
  const subscribedDocumentsRef = useRef(new Set());
  const observedVersionDocumentsRef = useRef(new Set());
  const userRef = useRef(user);
  const subscriptionRef = useRef(null);
  const refreshSharedRef = useRef(() => Promise.resolve());

  const rememberEvent = useCallback((eventId) => {
    if (!eventId || seenEventIdsRef.current.has(eventId)) return false;
    seenEventIdsRef.current.add(eventId);
    if (seenEventIdsRef.current.size > MAX_SEEN_EVENT_IDS) {
      const [oldest] = seenEventIdsRef.current;
      seenEventIdsRef.current.delete(oldest);
    }
    return true;
  }, []);

  const canApplyDocument = useCallback((document, { force = false } = {}) => {
    const revision = revisionOf(document);
    if (!document?.id || revision === null) return Boolean(document?.id);
    const knownRevision = latestRevisionRef.current.get(document.id) ?? 0;
    if (!force && revision <= knownRevision) return false;
    latestRevisionRef.current.set(document.id, revision);
    return true;
  }, []);

  const applyDocument = useCallback((type, document, { force = false } = {}) => {
    if (!document?.id || !canApplyDocument(document, { force })) return false;
    setState((current) => {
      const active = ['document:created', 'document:updated', 'block:updated', 'document:restored', 'document:reverted'].includes(type);
      const trashed = type === 'document:trashed';
      const deleted = type === 'document:deleted' || document.deleted;
      const documentDetails = deleted
        ? Object.fromEntries(Object.entries(current.documentDetails).filter(([id]) => id !== document.id))
        : (document.content_json || document.blocks
          ? { ...current.documentDetails, [document.id]: { ...current.documentDetails[document.id], ...document } }
          : current.documentDetails);
      return {
        ...current,
        documents: active ? upsertById(withoutId(current.documents, document.id), document) : withoutId(current.documents, document.id),
        trashDocuments: trashed
          ? upsertById(withoutId(current.trashDocuments, document.id), document)
          : withoutId(current.trashDocuments, document.id),
        documentDetails,
        deletedDocumentIds: deleted
          ? upsertById(current.deletedDocumentIds, { id: document.id })
          : withoutId(current.deletedDocumentIds, document.id),
      };
    });
    return true;
  }, [canApplyDocument]);

  const applyProfile = useCallback((profile) => {
    if (!profile) return;
    setState((current) => ({
      ...current,
      profile: { ...current.profile, ...profile },
    }));
  }, []);

  const clearError = useCallback(() => {
    setState((current) => ({ ...current, error: '' }));
  }, []);

  const applyVersion = useCallback((documentId, version) => {
    if (!documentId || !version) return;
    setState((current) => {
      const existingVersions = current.versionsByDocument[documentId] ?? [];
      const supersededVersions = version.is_current === true
        ? existingVersions.map((existing) => (
          existing.is_current === true && existing.id !== version.id
            ? { ...existing, is_current: false }
            : existing
        ))
        : existingVersions;
      return {
        ...current,
        versionsByDocument: {
          ...current.versionsByDocument,
          [documentId]: upsertById(supersededVersions, version)
            .sort((left, right) => Number(right.version_number) - Number(left.version_number)),
        },
      };
    });
  }, []);

  const applySubscription = useCallback((subscription) => {
    if (!subscription) return;
    subscriptionRef.current = subscription;
    setState((current) => {
      const hasProAccess = Boolean(subscription.hasProAccess);
      return {
        ...current,
        subscription,
        subscriptionLoading: false,
        ...(hasProAccess ? {} : {
          profile: null,
          documents: [],
          trashDocuments: [],
          documentDetails: {},
          versionsByDocument: {},
          deletedDocumentIds: [],
        }),
      };
    });
  }, []);

  const refreshSubscription = useCallback(async ({ checkoutSessionId = null } = {}) => {
    if (!userRef.current) return null;
    setState((current) => ({ ...current, subscriptionLoading: true }));
    try {
      const result = checkoutSessionId
        ? await confirmCheckoutSession(checkoutSessionId)
        : await getSubscription();
      const subscription = result?.subscription ?? null;
      if (!subscription) throw new Error('Subscription status is unavailable.');
      applySubscription(subscription);
      return subscription;
    } catch (error) {
      setState((current) => ({
        ...current,
        subscriptionLoading: false,
        error: error.message || 'Could not check your subscription.',
      }));
      throw error;
    }
  }, [applySubscription]);

  const applyCommittedEvent = useCallback((event) => {
    if (!event?.eventId || !rememberEvent(event.eventId)) return;
    const { type, data = {} } = event;
    if (type === 'subscription:updated') {
      applySubscription(data.subscription);
      if (data.subscription?.hasProAccess) {
        void refreshSharedRef.current().catch(() => {});
      }
      return;
    }
    if (type === 'profile:updated') {
      applyProfile(data.profile);
      return;
    }
    if (type === 'progress:updated') {
      const updatedAt = Date.parse(data.stats?.updated_at ?? '');
      if (Number.isFinite(updatedAt) && updatedAt < latestStatsTimestampRef.current) return;
      if (Number.isFinite(updatedAt)) latestStatsTimestampRef.current = updatedAt;
      setState((current) => ({
        ...current,
        profile: current.profile ? { ...current.profile, stats: data.stats } : current.profile,
      }));
      return;
    }
    if (type === 'version:created') {
      applyVersion(data.documentId, data.version);
      return;
    }
    if (data.document) applyDocument(type, data.document);
  }, [applyDocument, applyProfile, applySubscription, applyVersion, rememberEvent]);

  const refreshShared = useCallback(async () => {
    if (!userRef.current || !subscriptionRef.current?.hasProAccess) return;
    const [profile, documentsData, trashData] = await Promise.all([
      getMe(),
      listDocuments({ sort: 'most_recent' }),
      listTrash(),
    ]);
    setState((current) => ({
      ...current,
      profile,
      documents: documentsData.documents ?? [],
      trashDocuments: trashData.documents ?? [],
      error: '',
    }));
    [...(documentsData.documents ?? []), ...(trashData.documents ?? [])].forEach((document) => {
      const revision = revisionOf(document);
      if (revision !== null) latestRevisionRef.current.set(document.id, revision);
    });
    const statsUpdatedAt = Date.parse(profile.stats?.updated_at ?? '');
    if (Number.isFinite(statsUpdatedAt)) latestStatsTimestampRef.current = statsUpdatedAt;
  }, []);

  useEffect(() => {
    refreshSharedRef.current = refreshShared;
  }, [refreshShared]);

  const refreshDocument = useCallback(async (documentId) => {
    try {
      const result = await getDocument(documentId);
      applyDocument(
        result.document.trashed ? 'document:trashed' : 'document:updated',
        result.document,
        { force: true },
      );
      return result.document;
    } catch (error) {
      if (error.status === 404) {
        const revision = (latestRevisionRef.current.get(documentId) ?? 0) + 1;
        applyDocument('document:deleted', { id: documentId, revision, deleted: true }, { force: true });
      }
      throw error;
    }
  }, [applyDocument]);

  const refreshVersions = useCallback(async (documentId) => {
    observedVersionDocumentsRef.current.add(documentId);
    const result = await listVersions(documentId);
    setState((current) => ({
      ...current,
      versionsByDocument: { ...current.versionsByDocument, [documentId]: result.versions ?? [] },
    }));
    return result.versions ?? [];
  }, []);

  const subscribeDocument = useCallback((documentId) => {
    if (!documentId || !subscriptionRef.current?.hasProAccess) return () => {};
    subscribedDocumentsRef.current.add(documentId);
    subscribeToDocument(documentId);
    return () => {
      subscribedDocumentsRef.current.delete(documentId);
      unsubscribeFromDocument(documentId);
    };
  }, []);

  useEffect(() => {
    userRef.current = user;
    if (!user) {
      disconnectRealtime();
      latestRevisionRef.current.clear();
      latestStatsTimestampRef.current = 0;
      seenEventIdsRef.current.clear();
      subscribedDocumentsRef.current.clear();
      observedVersionDocumentsRef.current.clear();
      subscriptionRef.current = null;
      setState(emptyState());
      return undefined;
    }

    subscriptionRef.current = null;
    setState((current) => ({
      ...emptyState(),
      connection: current.connection,
      subscriptionLoading: true,
    }));

    const client = connectRealtime();
    const removeCommittedListeners = listenForCommittedEvents(client, applyCommittedEvent);
    const handleConnect = async () => {
      setState((current) => ({ ...current, connection: 'connected' }));
      try {
        const subscription = await refreshSubscription();
        const syncTasks = [requestRealtimeSync()];
        if (subscription?.hasProAccess) {
          syncTasks.push(
            refreshShared(),
            ...[...subscribedDocumentsRef.current].flatMap((documentId) => [
              subscribeToDocument(documentId),
              refreshDocument(documentId).catch(() => null),
            ]),
            ...[...observedVersionDocumentsRef.current].map((documentId) => (
              refreshVersions(documentId).catch(() => null)
            )),
          );
        }
        await Promise.all(syncTasks);
      } catch (error) {
        setState((current) => ({
          ...current,
          connection: 'error',
          error: error.message || 'Could not refresh server data.',
        }));
      }
    };
    const handleDisconnect = () => setState((current) => ({ ...current, connection: 'disconnected' }));
    const handleConnectError = (error) => {
      setState((current) => ({
        ...current,
        connection: 'error',
        error: error?.message || 'Could not connect to realtime updates.',
      }));
      if (error?.data?.code === 'AUTH_REQUIRED') {
        window.dispatchEvent(new Event('app:auth-expired'));
      }
    };

    client.on('connect', handleConnect);
    client.on('disconnect', handleDisconnect);
    client.on('connect_error', handleConnectError);
    if (client.connected) handleConnect();

    return () => {
      removeCommittedListeners();
      client.off('connect', handleConnect);
      client.off('disconnect', handleDisconnect);
      client.off('connect_error', handleConnectError);
      disconnectRealtime();
    };
  }, [applyCommittedEvent, refreshDocument, refreshShared, refreshSubscription, refreshVersions, user]);

  useEffect(() => {
    function handleSubscriptionRequired() {
      refreshSubscription().catch(() => {});
    }

    window.addEventListener('app:subscription-required', handleSubscriptionRequired);
    return () => window.removeEventListener('app:subscription-required', handleSubscriptionRequired);
  }, [refreshSubscription]);

  const value = {
    state,
    applyDocument,
    applyProfile,
    applyVersion,
    applySubscription,
    clearError,
    refreshSubscription,
    refreshShared,
    refreshDocument,
    refreshVersions,
    subscribeDocument,
  };

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used inside RealtimeProvider');
  return context;
}
