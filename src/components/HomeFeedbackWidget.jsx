import { useEffect, useRef } from 'react';

const FEEDBACK_WIDGET_SCRIPT_ID = 'givefeedback-widget-script';
const FEEDBACK_WIDGET_URL = 'https://app.givefeedback.dev/functions/v1/widget-v2?api-key=f05d6fb2-20e2-4847-a336-14d56b4d7e23';
const DESKTOP_MEDIA_QUERY = '(min-width: 901px)';
const SUPPORT_WIDGET_GAP = 10;

function positionFeedbackWidget() {
  const supportButton = document.querySelector('[data-home-page="support"]');
  const widget = document.getElementById('givefeedback-dev-widget');
  if (!supportButton || !widget) return;

  const supportRect = supportButton.getBoundingClientRect();
  const widgetRect = widget.getBoundingClientRect();
  const supportCenter = supportRect.left + (supportRect.width / 2);
  const right = Math.max(12, window.innerWidth - supportCenter - (widgetRect.width / 2));
  const bottom = Math.max(12, window.innerHeight - supportRect.top + SUPPORT_WIDGET_GAP);

  widget.style.setProperty('right', `${Math.round(right)}px`, 'important');
  widget.style.setProperty('bottom', `${Math.round(bottom)}px`, 'important');
}

function setWidgetVisibility(sidebarOpen) {
  const shouldShow = window.matchMedia(DESKTOP_MEDIA_QUERY).matches || sidebarOpen;
  document.body.classList.toggle('home-feedback-widget-visible', shouldShow);

  if (!window.GiveFeedback) return;
  if (!shouldShow) {
    window.GiveFeedback.disable?.();
    return;
  }

  window.GiveFeedback.enable?.();
  window.requestAnimationFrame(positionFeedbackWidget);
  window.setTimeout(positionFeedbackWidget, 220);
}

export default function HomeFeedbackWidget({ sidebarOpen }) {
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;

  useEffect(() => {
    let script = document.getElementById(FEEDBACK_WIDGET_SCRIPT_ID);
    let widgetObserver;
    const desktopQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);

    function observeWidget() {
      widgetObserver?.disconnect();
      const widgetRoot = document.getElementById('givefeedback-dev-root');
      if (!widgetRoot) return;

      widgetObserver = new MutationObserver(positionFeedbackWidget);
      widgetObserver.observe(widgetRoot, { childList: true, subtree: true });
      positionFeedbackWidget();
    }

    function syncWidget() {
      setWidgetVisibility(sidebarOpenRef.current);
      observeWidget();
    }

    function handleScriptError() {
      script?.removeEventListener('load', syncWidget);
      script?.removeEventListener('error', handleScriptError);
      script?.remove();
    }

    document.body.classList.add('home-feedback-widget-active');
    desktopQuery.addEventListener('change', syncWidget);
    window.addEventListener('resize', positionFeedbackWidget);

    if (window.GiveFeedback) {
      syncWidget();
    } else {
      if (!script) {
        script = document.createElement('script');
        script.id = FEEDBACK_WIDGET_SCRIPT_ID;
        script.src = FEEDBACK_WIDGET_URL;
        script.async = true;
        script.referrerPolicy = 'no-referrer';
        document.body.appendChild(script);
      }
      script.addEventListener('load', syncWidget);
      script.addEventListener('error', handleScriptError);
    }

    return () => {
      script?.removeEventListener('load', syncWidget);
      script?.removeEventListener('error', handleScriptError);
      desktopQuery.removeEventListener('change', syncWidget);
      window.removeEventListener('resize', positionFeedbackWidget);
      widgetObserver?.disconnect();
      document.body.classList.remove(
        'home-feedback-widget-active',
        'home-feedback-widget-visible',
      );
      window.GiveFeedback?.disable?.();
    };
  }, []);

  useEffect(() => {
    setWidgetVisibility(sidebarOpen);
  }, [sidebarOpen]);

  return null;
}
