export function createParticleController(ctx) {
  const { state, els, pick, random, setVariantInterval, setVariantTimeout } = ctx;

  function emitNote() {
    if (!els.particleLayer) {
      return;
    }
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = pick(['\u266A', '\u266B', '\u2669']);
    note.style.left = `${random(43, 58)}%`;
    note.style.setProperty('--note-drift', `${random(-34, 34)}px`);
    els.particleLayer.appendChild(note);
    state.projectileNodes.add(note);
    setVariantTimeout(() => {
      note.remove();
      state.projectileNodes.delete(note);
    }, 2500);
  }

  function startNoteSmoke() {
    emitNote();
    setVariantInterval(emitNote, 820);
  }

  function clearProjectiles() {
    state.projectileNodes.forEach((node) => node.remove());
    state.projectileNodes.clear();
  }

  return {
    emitNote,
    startNoteSmoke,
    clearProjectiles,
  };
}
