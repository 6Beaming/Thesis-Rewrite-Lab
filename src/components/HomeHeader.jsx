import HeaderActions from './HeaderActions.jsx';
import MobileSidebarToggle from './MobileSidebarToggle.jsx';
import OwlLogoBadge from './OwlLogoBadge.jsx';

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 18h14" />
      <path d="M7 15l-1.5-7 4 3.2L12 6l2.5 5.2 4-3.2L17 15H7z" />
    </svg>
  );
}

export default function HomeHeader({
  user,
  query,
  onQueryChange,
  onNewDocument,
  onUpload,
  onAccount,
  onSubscription,
  sidebarOpen,
  onToggleSidebar,
  busy,
  compact = false,
  actionsHidden = false,
}) {
  if (actionsHidden) {
    return (
      <header className="home-header home-header--empty" aria-label="Homepage header">
        <MobileSidebarToggle open={sidebarOpen} onClick={onToggleSidebar} />
      </header>
    );
  }

  return (
    <header className={`home-header${compact ? ' home-header--compact' : ''}`}>
      <div className="home-header-left">
        <OwlLogoBadge
          email={user?.display_name || user?.email || 'Your account'}
          avatarSrc={user?.profilePictureUrl || ''}
          onClick={onAccount}
        />
      </div>

      <HeaderActions
        query={query}
        onQueryChange={onQueryChange}
        onNewDocument={onNewDocument}
        onUpload={onUpload}
        busy={busy}
      />

      <button type="button" className="home-pro" onClick={onSubscription}>
        <CrownIcon />
        Pro
      </button>

      <MobileSidebarToggle open={sidebarOpen} onClick={onToggleSidebar} />
    </header>
  );
}
