import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareWorkspaceCitationCheck } from './workspaceSavePolicy.js';

test('citation checks continue without saving when the workspace is clean', async () => {
  let saveCalls = 0;

  const ready = await prepareWorkspaceCitationCheck({
    workspaceDirty: false,
    saveWorkspaceDocument: async () => {
      saveCalls += 1;
      return true;
    },
  });

  assert.equal(ready, true);
  assert.equal(saveCalls, 0);
});

test('citation checks synchronize dirty editor content before checking', async () => {
  const calls = [];

  const ready = await prepareWorkspaceCitationCheck({
    workspaceDirty: true,
    saveWorkspaceDocument: async (options) => {
      calls.push(options);
      return { id: 'document-1', revision: 3 };
    },
  });

  assert.equal(ready, true);
  assert.deepEqual(calls, [{ automatic: true }]);
});

test('citation checks stop when dirty editor content cannot be synchronized', async () => {
  const ready = await prepareWorkspaceCitationCheck({
    workspaceDirty: true,
    saveWorkspaceDocument: async () => false,
  });

  assert.equal(ready, false);
});
