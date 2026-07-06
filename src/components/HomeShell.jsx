import { useEffect } from 'react';
import HomeHeader from './HomeHeader.jsx';
import HomeSidebar from './HomeSidebar.jsx';

export default function HomeShell({
  user,
  activePage,
  sidebarOpen,
  query,
  busy,
  onQueryChange,
  onNewDocument,
  onUpload,
  onSelectPage,
  onToggleSidebar,
  onAccount,
  onSubscription,
  actionsHidden = false,
  children,
}) {
  useEffect(() => {
    if (!sidebarOpen) return undefined;

    function closeSidebarOnOutsideClick(event) {
      if (window.matchMedia?.('(min-width: 901px)').matches) {
        return;
      }
      const target = event.target;
      if (
        target.closest?.('.home-sidebar')
        || target.closest?.('.home-sidebar-toggle')
      ) {
        return;
      }
      onToggleSidebar?.();
    }

    document.addEventListener('pointerdown', closeSidebarOnOutsideClick);
    return () => {
      document.removeEventListener('pointerdown', closeSidebarOnOutsideClick);
    };
  }, [sidebarOpen, onToggleSidebar]);

  return (
    <main className="home-page">
      <HomeHeader
        user={user}
        query={query}
        busy={busy}
        onQueryChange={onQueryChange}
        onNewDocument={onNewDocument}
        onUpload={onUpload}
        onAccount={onAccount}
        onSubscription={onSubscription}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        actionsHidden={actionsHidden}
      />
      <div className="home-layout">
        <section className="home-main">{children}</section>
        <HomeSidebar active={activePage} open={sidebarOpen} onSelect={onSelectPage} />
      </div>
    </main>
  );
}
