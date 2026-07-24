import { useRef } from 'react';
import owlMarkup from '../assets/owl.svg?raw';
import booksUrl from '../assets/books.svg';
import twigUrl from '../assets/twig.svg';
import thinkingUrl from '../assets/thinking.svg';
import answerUrl from '../assets/answer.svg';
import errorUrl from '../assets/error.svg';
import owlPathCatalog from '../../scripts/generated/owl-path-catalog.json';
import { getContainerCssVars } from '../pages/libraries/animations/containerLayout.js';
import { useOwlAnimator } from '../pages/libraries/animations/useOwlAnimator.jsx';

const bottomAssets = {
  desktop: booksUrl,
  mobile: twigUrl,
};

const wandPathFills = {
  wand_frame: 'black',
  right_filler: '#7FDBFE',
  left_filler: '#FE7FA7',
  middle_filler: '#FEC901',
  wand_filler: '#FE8E00',
};

function createMagicWandMarkup() {
  const paths = owlPathCatalog.wand?.intermediate ?? {};
  const pathMarkup = (owlPathCatalog.wand?.ids ?? [])
    .filter((id) => paths[id])
    .map((id) => `<path id="${id}" d="${paths[id]}" fill="${wandPathFills[id] ?? 'black'}"/>`)
    .join('');

  return `<g id="magic_wand" class="wand-hidden">${pathMarkup}</g>`;
}

function createOwlMarkup() {
  const svgWithId = owlMarkup.replace('<svg ', '<svg id="owl-svg" ');
  return svgWithId.replace('<g id="left_wing_group">', `<g id="left_wing_group">${createMagicWandMarkup()}`);
}

const OWL_INNER_HTML = Object.freeze({
  __html: createOwlMarkup(),
});

export default function OwlContainer({
  variant = 'desktop',
  className = '',
  style = {},
  standby = 'random',
  animation = {},
  onAnimatorReady,
}) {
  const stageRef = useRef(null);
  useOwlAnimator(stageRef, { standby, ...animation, onReady: onAnimatorReady });

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
            dangerouslySetInnerHTML={OWL_INNER_HTML}
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
