const REWRITE_CARD_NUMBERS = [1, 2, 3];

// Replace this deterministic response factory with the AI request boundary.
// Its return value remains the card's only replacement text contract.
export function generateResponse(cardNumber) {
  return `This is the AI rewriting placeholder ${cardNumber}.`;
}

// The future regeneration request should preserve this error contract so the
// card can surface provider failures without changing the workspace workflow.
export function regenerateResponse(cardNumber) {
  if (Number(cardNumber) === 2) {
    throw new Error('Network Problems');
  }
  return `This is the regenerated AI rewriting placeholder ${cardNumber}.`;
}

// Always build cards through the response factory; do not embed replacement
// strings in card state, so an AI integration changes only the factories above.
export function createRewriteCards() {
  return REWRITE_CARD_NUMBERS.map((id) => ({
    id,
    title: `Rewriting Card ${id}`,
    response: generateResponse(id),
    error: '',
  }));
}

export default function DocumentRewriter({
  cards = [],
  busy = false,
  locked = false,
  completed = false,
  onApplyResponse,
  onRegenerate,
}) {
  if (completed) {
    return (
      <div className="rewrite-card-list">
        <article className="rewrite-card rewrite-card--complete">
          <strong>Congratulations</strong>
          <p>All completed.</p>
        </article>
      </div>
    );
  }

  function applyCard(card, target) {
    if (busy || locked || card.error) return;
    onApplyResponse?.(card, target);
  }

  return (
    <div className="rewrite-card-list">
      {cards.map((card) => (
        <article
          key={card.id}
          className={`rewrite-card${card.error ? ' has-error' : ''}${locked ? ' is-locked' : ''}`}
          data-workspace-wand-target="true"
          role="button"
          tabIndex={locked || card.error ? -1 : 0}
          aria-disabled={busy || locked || Boolean(card.error)}
          onClick={(event) => applyCard(card, event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            applyCard(card, event.currentTarget);
          }}
        >
          <div className="rewrite-card-header">
            <strong>{card.title}</strong>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRegenerate?.(card.id);
              }}
              disabled={busy || locked}
            >
              Regenerate
            </button>
          </div>
          <p role={card.error ? 'alert' : undefined}>{card.error || card.response}</p>
        </article>
      ))}
    </div>
  );
}
