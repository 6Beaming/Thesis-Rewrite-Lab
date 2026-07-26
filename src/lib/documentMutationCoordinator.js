export function createDocumentMutationCoordinator() {
  const pendingCounts = new Map();
  const latestSequences = new Map();
  let queueTail = Promise.resolve();

  return {
    isPending(documentId) {
      return (pendingCounts.get(documentId) ?? 0) > 0;
    },

    enqueue(documentId, task) {
      const sequence = (latestSequences.get(documentId) ?? 0) + 1;
      latestSequences.set(documentId, sequence);
      pendingCounts.set(documentId, (pendingCounts.get(documentId) ?? 0) + 1);

      const execute = async () => {
        try {
          return await task({
            sequence,
            isLatest: () => latestSequences.get(documentId) === sequence,
          });
        } finally {
          const remaining = (pendingCounts.get(documentId) ?? 1) - 1;
          if (remaining > 0) pendingCounts.set(documentId, remaining);
          else pendingCounts.delete(documentId);
        }
      };

      const queued = queueTail.then(execute, execute);
      queueTail = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
  };
}
