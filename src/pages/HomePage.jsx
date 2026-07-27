import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import DocumentsSection from '../components/DocumentsSection.jsx';
import EmptyState from '../components/EmptyState.jsx';
import HomeShell from '../components/HomeShell.jsx';
import ProgressBanner from '../components/ProgressBanner.jsx';
import { useAuth } from '../components/AuthProvider.jsx';
import { useRealtime } from '../components/RealtimeProvider.jsx';
import {
  createDocument,
  downloadDocument,
  moveToTrash,
  uploadDocument,
} from '../services/documentsApi.js';
import { updateWritingPreferences, uploadProfilePicture } from '../services/usersApi.js';
import HomepageAccount from './homepageAccount.jsx';
import HomepageCredits from './homepageCredits.jsx';
import HomepageSupport from './homepageSupport.jsx';
import HomepageTrash from './homepageTrash.jsx';
import HomepageVersionControl from './homepageVersionControl.jsx';
import { DEFAULT_AUTOSAVE_DOCS } from '../shared/writingPreferences.js';

const EMPTY_USER = {
  display_name: 'Signed-in user',
  email: '',
  autosaveDocs: DEFAULT_AUTOSAVE_DOCS,
  useWritingPreferences: true,
  writingPreferences: {},
  stats: {
    completed_rate: 0,
    streak_day_count: 0,
  },
};

function homeUserFromAuth(authUser, fallback = EMPTY_USER) {
  if (!authUser) return fallback;
  const email = authUser.email || fallback.email;
  return {
    ...fallback,
    display_name: authUser.name || email?.split('@')[0] || fallback.display_name,
    email,
    image: authUser.image || fallback.image,
    authUserId: authUser.id,
  };
}

function pickHistoryDocument(documents, currentDocument) {
  if (currentDocument && documents.some((document) => document.id === currentDocument.id)) {
    return currentDocument;
  }
  return documents[0] ?? null;
}

function visibleDocuments(documents, query, sort) {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = documents.filter((document) => (
    !normalizedQuery || document.title.toLowerCase().includes(normalizedQuery)
  ));
  return [...filtered].sort((left, right) => {
    if (sort === 'least_recent') return new Date(left.updated_at) - new Date(right.updated_at);
    if (sort === 'most_completed') return Number(right.completed_rate) - Number(left.completed_rate);
    if (sort === 'least_completed') return Number(left.completed_rate) - Number(right.completed_rate);
    return new Date(right.updated_at) - new Date(left.updated_at);
  });
}

export default function HomePage({ onOpenWorkspace }) {
  const { user: authUser, signOut } = useAuth();
  const navigate = useNavigate();
  const {
    state: realtimeState,
    applyDocument,
    applyProfile,
    clearError,
    refreshShared,
  } = useRealtime();
  const [user, setUser] = useState(() => ({
    ...homeUserFromAuth(authUser),
    profilePictureUrl: authUser?.image || '',
    hasProfilePicture: Boolean(authUser?.image),
  }));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('most_recent');
  const [activePage, setActivePage] = useState('docs');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [historyDocument, setHistoryDocument] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exportingDocumentId, setExportingDocumentId] = useState(null);
  const [actionError, setActionError] = useState('');
  const documents = useMemo(
    () => visibleDocuments(realtimeState.documents, query, sort),
    [query, realtimeState.documents, sort],
  );
  const homeError = actionError || realtimeState.error;

  function dismissHomeError() {
    setActionError('');
    clearError();
  }

  useEffect(() => {
    if (!authUser) return;
    setUser((current) => homeUserFromAuth(authUser, current));
  }, [authUser]);

  useEffect(() => {
    if (!realtimeState.profile) return;
    const profilePictureUrl = realtimeState.profile.hasProfilePicture
      ? `/api/users/me/profile-picture?v=${encodeURIComponent(realtimeState.profile.updated_at || Date.now())}`
      : (authUser?.image || '');
    setUser((current) => ({
      ...current,
      ...realtimeState.profile,
      email: authUser?.email || realtimeState.profile.email || current.email,
      display_name: authUser?.name || realtimeState.profile.display_name || current.display_name,
      profilePictureUrl,
      hasProfilePicture: Boolean(profilePictureUrl),
    }));
  }, [authUser, realtimeState.profile]);

  useEffect(() => {
    setHistoryDocument((current) => pickHistoryDocument(documents, current));
  }, [documents]);

  const progressValue = useMemo(() => {
    return Math.round(Number(user?.stats?.completed_rate ?? 0) * 100);
  }, [user]);

  async function handleNewDocument() {
    setActionError('');
    setBusy(true);
    try {
      const result = await createDocument();
      applyDocument('document:created', result.document);
      onOpenWorkspace?.(result.document);
    } catch (error) {
      setActionError(error.message || 'Could not create a document.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file) {
    setActionError('');
    setBusy(true);
    try {
      const result = await uploadDocument(file);
      applyDocument('document:created', result.document);
      onOpenWorkspace?.(result.document);
    } catch (error) {
      setActionError(error.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(document) {
    setActionError('');
    setBusy(true);
    try {
      const result = await moveToTrash(document.id);
      applyDocument('document:trashed', result.document);
    } catch (error) {
      setActionError(error.message || 'Could not move document to trash.');
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(document) {
    setActionError('');
    setExportingDocumentId(document.id);
    try {
      await downloadDocument(document.id);
    } catch (error) {
      setActionError(error.message || 'Could not export the document.');
    } finally {
      setExportingDocumentId(null);
    }
  }

  async function handleProfileUpload(file) {
    setActionError('');
    try {
      const nextUser = await uploadProfilePicture(file);
      applyProfile(nextUser);
      setUser((current) => ({
        ...current,
        ...nextUser,
        profilePictureUrl: `/api/users/me/profile-picture?v=${encodeURIComponent(nextUser.updated_at || Date.now())}`,
        hasProfilePicture: true,
      }));
      return true;
    } catch (error) {
      setActionError(error.message || 'Profile upload failed.');
      return false;
    }
  }

  async function handleWritingPreferencesUpdate(settings) {
    setActionError('');
    try {
      const nextUser = await updateWritingPreferences(settings);
      applyProfile(nextUser);
      setUser((current) => ({ ...current, ...nextUser }));
      return true;
    } catch (error) {
      setActionError(error.message || 'Could not update writing preferences.');
      throw error;
    }
  }

  function handleOpenDocument(document) {
    setHistoryDocument(document);
    onOpenWorkspace?.(document);
  }

  function handleDocumentReverted(document) {
    if (!document) return;
    applyDocument('document:reverted', document);
    setHistoryDocument(document);
  }

  function renderMainContent() {
    if (activePage === 'docs') {
      return (
        <>
          <ProgressBanner value={progressValue} />
          {documents.length ? (
            <DocumentsSection
              documents={documents}
              sort={sort}
              onSortChange={setSort}
              onOpenDocument={handleOpenDocument}
              onDeleteDocument={handleDelete}
              onExportDocument={handleExport}
              exportingDocumentId={exportingDocumentId}
            />
          ) : (
            <EmptyState title="No documents yet">Create or upload a document to start practicing.</EmptyState>
          )}
        </>
      );
    }

    if (activePage === 'trash') {
      return (
          <HomepageTrash
            onError={setActionError}
            onChanged={refreshShared}
        />
      );
    }

    if (activePage === 'credits') {
      return <HomepageCredits />;
    }

    if (activePage === 'versions') {
      return (
        <HomepageVersionControl
          documents={realtimeState.documents}
          onError={setActionError}
          onDocumentReverted={handleDocumentReverted}
        />
      );
    }

    if (activePage === 'support') {
      return <HomepageSupport onOpenSubscription={() => navigate('/subscription')} />;
    }

    return <EmptyState title="Choose a workspace section">Select an option from the sidebar.</EmptyState>;
  }

  const hideHeaderActions = ['trash', 'support', 'credits'].includes(activePage);

  return (
    <HomeShell
      user={user}
      activePage={activePage}
      sidebarOpen={sidebarOpen}
      query={query}
      busy={busy}
      onQueryChange={setQuery}
      onNewDocument={handleNewDocument}
      onUpload={handleUpload}
      onSelectPage={(page) => {
        setActionError('');
        setActivePage(page);
        setSidebarOpen(false);
      }}
      onToggleSidebar={() => setSidebarOpen((value) => !value)}
      onAccount={() => setAccountOpen(true)}
      onSubscription={() => navigate('/subscription')}
      actionsHidden={hideHeaderActions}
    >
      <div className="home-main-inner">
        {homeError ? (
          <div className="home-api-notice" role="alert">
            <span>{homeError}</span>
            <button
              type="button"
              className="home-api-notice-close"
              onClick={dismissHomeError}
              aria-label="Dismiss error message"
            >
              ×
            </button>
          </div>
        ) : null}
        {renderMainContent()}
      </div>
      {accountOpen ? (
        <HomepageAccount
          user={user}
          onClose={() => setAccountOpen(false)}
          onLogout={signOut}
          onUploadProfile={handleProfileUpload}
          onUpdateWritingPreferences={handleWritingPreferencesUpdate}
        />
      ) : null}
    </HomeShell>
  );
}
