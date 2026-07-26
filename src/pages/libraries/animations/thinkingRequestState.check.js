import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginThinkingRequest,
  cancelThinkingRequest,
  canStartRequestedThinking,
} from './thinkingRequestState.js';

function createAnimationState() {
  return {
    thinking: false,
    thinkingRequested: false,
    error: false,
  };
}

test('a cancelled delayed thinking request cannot start after loading has ended', () => {
  const state = createAnimationState();
  assert.equal(beginThinkingRequest(state), true);
  cancelThinkingRequest(state);
  assert.equal(canStartRequestedThinking(state), false);
  assert.equal(state.thinking, false);
});

test('only one pending thinking request can be active', () => {
  const state = createAnimationState();
  assert.equal(beginThinkingRequest(state), true);
  assert.equal(beginThinkingRequest(state), false);
  assert.equal(canStartRequestedThinking(state), true);
});
