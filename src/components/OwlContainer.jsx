import { useRef } from 'react';
import owlMarkup from '../assets/owl.svg?raw';
import booksUrl from '../assets/books.svg';
import twigUrl from '../assets/twig.svg';
import thinkingUrl from '../assets/thinking.svg';
import answerUrl from '../assets/answer.svg';
import errorUrl from '../assets/error.svg';
import { getContainerCssVars } from '../pages/libraries/animations/containerLayout.js';
import { useOwlAnimator } from '../pages/libraries/animations/useOwlAnimator.jsx';

const bottomAssets = {
  desktop: booksUrl,
  mobile: twigUrl,
};

export default function OwlContainer({ variant = 'desktop', className = '', style = {} }) {
  const stageRef = useRef(null);
  useOwlAnimator(stageRef, 'random');

  const cssVars = getContainerCssVars(variant);
  const bottomSrc = bottomAssets[variant] ?? booksUrl;

  return (
    <div
      className={`owl-container owl-container--${variant} ${className}`.trim()}
      style={{ ...cssVars, ...style }}
    >
      <div className="owl-container__indicators" aria-hidden="true">
        <img id="thinking-indicator" className="indicator thinking" src={thinkingUrl} alt="" />
        <img id="answer-indicator" className="indicator answer" src={answerUrl} alt="" />
        <img id="error-indicator" className="indicator error" src={errorUrl} alt="" />
      </div>

      <div className="owl-container__owl">
        <section id="animation-stage" className="stage" ref={stageRef}>
          <div
            className="owl-wrap"
            id="owl-wrap"
            dangerouslySetInnerHTML={{ __html: owlMarkup.replace('<svg ', '<svg id="owl-svg" ') }}
          />
          <div id="particle-layer" className="particle-layer" aria-hidden="true" />
        </section>
      </div>

      <div className="owl-container__bottom" aria-hidden="true">
        <img src={bottomSrc} alt="" />
      </div>
    </div>
  );
}
