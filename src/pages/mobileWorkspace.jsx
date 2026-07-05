import OwlContainer from '../components/OwlContainer.jsx';
import { getMobileContainerCssVars } from './libraries/animations/containerLayout.js';
import { useFloatingWindow } from './libraries/useFloatingWindow.js';

export default function MobileWorkspace() {
  const { windowRef, metrics, position, isDragging, handlers } = useFloatingWindow();

  const style = {
    ...getMobileContainerCssVars(metrics),
    left: `${position.left}px`,
    top: `${position.top}px`,
  };

  return (
    <div className="workspace workspace-mobile">
      <div
        ref={windowRef}
        className={`owl-floating-window${isDragging ? ' is-dragging' : ''}`}
        style={style}
        {...handlers}
      >
        <OwlContainer variant="mobile" />
      </div>
    </div>
  );
}
