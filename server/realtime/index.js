import { Server } from 'socket.io';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function userRoom(authUserId) {
  return `user:${authUserId}`;
}

export function documentRoom(documentId) {
  return `document:${documentId}`;
}

function socketAuthRequest(socket) {
  const forwardedProtocol = String(socket.handshake.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim();
  return {
    protocol: forwardedProtocol || (socket.request.socket.encrypted ? 'https' : 'http'),
    headers: socket.request.headers,
  };
}

function acknowledgement(callback) {
  return typeof callback === 'function' ? callback : () => {};
}

export function attachRealtimeServer(httpServer, dependencies = {}) {
  const {
    getSession: loadSession,
    resolveProductUser,
    ownsDocument,
    origin,
  } = dependencies;
  if (
    typeof loadSession !== 'function'
    || typeof resolveProductUser !== 'function'
    || typeof ownsDocument !== 'function'
    || !origin
  ) {
    throw new TypeError('Realtime authentication, ownership, and origin dependencies are required');
  }

  const io = new Server(httpServer, {
    cors: {
      origin,
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    try {
      const session = await loadSession(socketAuthRequest(socket));
      if (!session?.user) {
        const error = new Error('Authentication required');
        error.data = { code: 'AUTH_REQUIRED' };
        next(error);
        return;
      }
      const productUser = await resolveProductUser(session.user);
      socket.data.authUserId = session.user.id;
      socket.data.productUserId = productUser.id;
      next();
    } catch {
      const error = new Error('Authentication required');
      error.data = { code: 'AUTH_REQUIRED' };
      next(error);
    }
  });

  io.on('connection', (socket) => {
    socket.join(userRoom(socket.data.authUserId));

    socket.on('document:subscribe', async (payload, callback) => {
      const acknowledge = acknowledgement(callback);
      const documentId = String(payload?.documentId ?? '');
      if (!UUID_PATTERN.test(documentId)) {
        acknowledge({ ok: false, error: 'Invalid document ID' });
        return;
      }
      try {
        const owned = await ownsDocument(documentId, socket.data.productUserId);
        if (!owned) {
          acknowledge({ ok: false, error: 'Document not found' });
          return;
        }
        await socket.join(documentRoom(documentId));
        acknowledge({ ok: true, documentId });
      } catch {
        acknowledge({ ok: false, error: 'Could not subscribe to document' });
      }
    });

    socket.on('document:unsubscribe', async (payload, callback) => {
      const acknowledge = acknowledgement(callback);
      const documentId = String(payload?.documentId ?? '');
      if (!UUID_PATTERN.test(documentId)) {
        acknowledge({ ok: false, error: 'Invalid document ID' });
        return;
      }
      await socket.leave(documentRoom(documentId));
      acknowledge({ ok: true, documentId });
    });

    socket.on('sync:request', (_payload, callback) => {
      acknowledgement(callback)({ ok: true });
    });
  });

  return io;
}
