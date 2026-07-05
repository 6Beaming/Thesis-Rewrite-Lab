import blackboardUrl from '../assets/blackboard.png';
import OwlContainer from '../components/OwlContainer.jsx';
import { getBlackboardCssVars } from './libraries/animations/containerLayout.js';

export default function DesktopWorkspace() {
  const blackboardStyle = getBlackboardCssVars();

  return (
    <div className="workspace workspace-desktop">
      <aside className="blackboard" aria-label="Blackboard" style={blackboardStyle}>
        <img className="blackboard__image" src={blackboardUrl} alt="" />
        <div className="blackboard__stage">
          <div className="blackboard__owl-slot">
            <OwlContainer variant="desktop" />
          </div>
        </div>
      </aside>
    </div>
  );
}
