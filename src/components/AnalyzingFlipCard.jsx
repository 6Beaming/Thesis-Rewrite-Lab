export default function AnalyzingFlipCard({
  face,
  onFaceChange,
  nlpPanel,
  aiPanel,
}) {
  const showAi = face === 'ai';
  return (
    <section className={`analysis-flip-card${showAi ? ' is-flipped' : ''}`}>
      <div className="analysis-flip-card__switcher" role="tablist" aria-label="Review type">
        <button
          type="button"
          role="tab"
          aria-selected={!showAi}
          className={!showAi ? 'is-active' : ''}
          onClick={() => onFaceChange('nlp')}
        >
          Standard check
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showAi}
          className={showAi ? 'is-active' : ''}
          onClick={() => onFaceChange('ai')}
        >
          Writing coach
        </button>
      </div>
      <div className="analysis-flip-card__viewport">
        <div className="analysis-flip-card__inner">
          <div className="analysis-flip-card__face analysis-flip-card__face--front" aria-hidden={showAi}>
            {nlpPanel}
          </div>
          <div className="analysis-flip-card__face analysis-flip-card__face--back" aria-hidden={!showAi}>
            {aiPanel}
          </div>
        </div>
      </div>
    </section>
  );
}
