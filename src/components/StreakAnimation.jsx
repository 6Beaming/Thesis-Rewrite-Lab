import lottie from 'lottie-web';
import { useEffect, useRef } from 'react';
import streakAnimation from '../assets/streak_lottie.json';

export default function StreakAnimation({ className = '' }) {
  const containerRef = useRef(null);
  useEffect(() => {
    if (!containerRef.current) return undefined;
    const animation = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: true,
      autoplay: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      animationData: streakAnimation,
    });
    return () => animation.destroy();
  }, []);
  return <div ref={containerRef} className={className} aria-hidden="true" />;
}
