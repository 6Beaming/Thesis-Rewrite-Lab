import { io } from 'socket.io-client';

export const COMMITTED_EVENT_TYPES = [
  'profile:updated',
  'subscription:updated',
  'progress:updated',
  'document:created',
  'document:updated',
  'document:trashed',
  'document:restored',
  'document:deleted',
  'block:updated',
  'version:created',
  'document:reverted',
];

let socket;

export function getRealtimeSocket() {
  if (!socket) {
    socket = io({
      autoConnect: false,
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
  }
  return socket;
}

export function connectRealtime() {
  const client = getRealtimeSocket();
  if (!client.connected) client.connect();
  return client;
}

export function disconnectRealtime() {
  if (socket) socket.disconnect();
}

function emitWithAcknowledgement(client, type, payload) {
  return new Promise((resolve) => {
    client.timeout(5_000).emit(type, payload, (error, response) => {
      resolve(error ? { ok: false, error: 'Realtime request timed out' } : response);
    });
  });
}

export function subscribeToDocument(documentId) {
  return emitWithAcknowledgement(getRealtimeSocket(), 'document:subscribe', { documentId });
}

export function unsubscribeFromDocument(documentId) {
  return emitWithAcknowledgement(getRealtimeSocket(), 'document:unsubscribe', { documentId });
}

export function requestRealtimeSync() {
  return emitWithAcknowledgement(getRealtimeSocket(), 'sync:request', {});
}

export function listenForCommittedEvents(client, listener) {
  COMMITTED_EVENT_TYPES.forEach((type) => client.on(type, listener));
  return () => COMMITTED_EVENT_TYPES.forEach((type) => client.off(type, listener));
}
