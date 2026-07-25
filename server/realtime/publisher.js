import { randomUUID } from 'node:crypto';
import { billingRoom, documentRoom, userRoom } from './index.js';

const SAFE_DOCUMENT_FIELDS = new Set([
  'id',
  'user_id',
  'title',
  'academic_style',
  'style_settings',
  'content_json',
  'original_filename',
  'original_mime',
  'completed_chars',
  'total_chars',
  'completed_rate',
  'current_processing_block_id',
  'revision',
  'trashed',
  'trashed_at',
  'created_at',
  'updated_at',
  'blocks',
  'snippet',
]);

const SAFE_PROFILE_FIELDS = new Set([
  'id',
  'auth_user_id',
  'email',
  'display_name',
  'profile_picture_mime',
  'hasProfilePicture',
  'created_at',
  'updated_at',
  'stats',
]);

const SAFE_VERSION_FIELDS = new Set([
  'id',
  'document_id',
  'version_number',
  'label',
  'academic_style_snapshot',
  'text_preview',
  'created_at',
]);

const SAFE_SUBSCRIPTION_FIELDS = new Set([
  'plan',
  'accessState',
  'hasProAccess',
  'stripeStatus',
  'cancelAtPeriodEnd',
  'currentPeriodEnd',
  'recoveryRequired',
  'price',
]);

function pick(value, fields) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => fields.has(key)),
  );
}

export function publicDocument(document) {
  return pick(document, SAFE_DOCUMENT_FIELDS);
}

export function publicProfile(profile) {
  return pick(profile, SAFE_PROFILE_FIELDS);
}

export function publicVersion(version) {
  return pick(version, SAFE_VERSION_FIELDS);
}

export function publicSubscription(subscription) {
  return pick(subscription, SAFE_SUBSCRIPTION_FIELDS);
}

async function updateSocketEntitlement(io, authUserId, nextHasProAccess) {
  const sockets = await io.in(billingRoom(authUserId)).fetchSockets();
  await Promise.all(sockets.map(async (socket) => {
    socket.data.hasProAccess = Boolean(nextHasProAccess);
    if (nextHasProAccess) {
      await socket.join(userRoom(authUserId));
      return;
    }
    const documentRooms = [...socket.rooms].filter((room) => room.startsWith('document:'));
    await Promise.all([
      socket.leave(userRoom(authUserId)),
      ...documentRooms.map((room) => socket.leave(room)),
    ]);
  }));
}

export function createEventPublisher(io, { now = () => new Date(), nextId = randomUUID } = {}) {
  if (!io?.to) {
    throw new TypeError('A Socket.IO server is required to publish realtime events');
  }

  function emit({
    authUserId,
    type,
    resourceId,
    revision = null,
    mutationId = null,
    data,
    documentId = null,
    rooms = null,
  }) {
    const event = {
      eventId: nextId(),
      type,
      occurredAt: now().toISOString(),
      resourceId,
      revision: revision === null || revision === undefined ? null : Number(revision),
      mutationId: mutationId || null,
      data,
    };
    const targetRooms = rooms ?? [userRoom(authUserId)];
    if (documentId) targetRooms.push(documentRoom(documentId));
    io.to(targetRooms).emit(type, event);
    return event;
  }

  return {
    publishDocument({ authUserId, type, document, mutationId = null, extra = {} }) {
      const safeDocument = publicDocument(document);
      return emit({
        authUserId,
        type,
        resourceId: safeDocument.id,
        revision: safeDocument.revision,
        mutationId,
        data: { document: safeDocument, ...extra },
        documentId: safeDocument.id,
      });
    },
    publishDeletedDocument({ authUserId, document, mutationId = null }) {
      return emit({
        authUserId,
        type: 'document:deleted',
        resourceId: document.id,
        revision: document.revision,
        mutationId,
        data: {
          document: {
            id: document.id,
            title: document.title,
            revision: Number(document.revision),
            deleted: true,
          },
        },
        documentId: document.id,
      });
    },
    publishVersion({ authUserId, document, version, mutationId = null }) {
      const safeDocument = publicDocument(document);
      return emit({
        authUserId,
        type: 'version:created',
        resourceId: version.id,
        revision: safeDocument.revision,
        mutationId,
        data: {
          documentId: safeDocument.id,
          version: publicVersion(version),
        },
        documentId: safeDocument.id,
      });
    },
    publishProgress({ authUserId, productUserId, stats, documentId = null, revision = null, mutationId = null }) {
      return emit({
        authUserId,
        type: 'progress:updated',
        resourceId: productUserId,
        revision,
        mutationId,
        data: { stats },
        documentId,
      });
    },
    publishProfile({ authUserId, profile, mutationId = null }) {
      const safeProfile = publicProfile(profile);
      return emit({
        authUserId,
        type: 'profile:updated',
        resourceId: safeProfile.id,
        mutationId,
        data: { profile: safeProfile },
      });
    },
    publishAiJob({ authUserId, documentId, job }) {
      return emit({
        authUserId,
        type: 'ai-job:updated',
        resourceId: job.id,
        data: {
          job: {
            id: job.id,
            documentId: job.document_id,
            blockId: job.block_id,
            sourceTextHash: job.source_text_hash,
            partitionGeneration: Number(job.partition_generation),
            requestedTones: job.requested_tones,
            model: job.model,
            promptVersion: job.prompt_version,
            status: job.status,
            attemptCount: Number(job.attempt_count),
            errorCode: job.safe_error_code,
            updatedAt: job.updated_at,
          },
        },
        documentId,
      });
    },
    publishSubscription({ authUserId, productUserId, subscription }) {
      const safeSubscription = publicSubscription(subscription);
      const event = emit({
        authUserId,
        type: 'subscription:updated',
        resourceId: productUserId,
        data: { subscription: safeSubscription },
        rooms: [billingRoom(authUserId)],
      });
      void updateSocketEntitlement(io, authUserId, safeSubscription?.hasProAccess)
        .catch(() => {});
      return event;
    },
  };
}
