export function beginThinkingRequest(state) {
  if (state.thinking || state.thinkingRequested) return false;
  state.thinkingRequested = true;
  return true;
}

export function cancelThinkingRequest(state) {
  state.thinkingRequested = false;
}

export function canStartRequestedThinking(state) {
  return Boolean(state.thinkingRequested && !state.thinking && !state.error);
}
