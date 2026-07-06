import { useEffect, useMemo, useState } from 'react';
import DocumentsSection from '../components/DocumentsSection.jsx';
import EmptyState from '../components/EmptyState.jsx';
import HomeShell from '../components/HomeShell.jsx';
import ProgressBanner from '../components/ProgressBanner.jsx';
import { useAuth } from '../components/AuthProvider.jsx';
import { createDocument, listDocuments, moveToTrash, uploadDocument } from '../services/documentsApi.js';
import { getMe, uploadProfilePicture } from '../services/usersApi.js';
import HomepageAccount from './homepageAccount.jsx';
import HomepageCredits from './homepageCredits.jsx';
import HomepageSubscription from './homepageSubscription.jsx';
import HomepageSupport from './homepageSupport.jsx';
import HomepageTrash from './homepageTrash.jsx';
import HomepageVersionControl from './homepageVersionControl.jsx';

const DEMO_USER = {
  display_name: 'Signed-in user',
  email: '',
  stats: {
    completed_rate: 0.78,
    streak_day_count: 1,
  },
};

const DEMO_DOCUMENTS = [
  {
    id: 'demo-doc-1',
    title: 'Assignment 2: article 2',
    academic_style: 'APA',
    snippet: 'Assignment 2: article 2',
    secondarySnippet: '(cognitive behavioral therapy)...',
    updated_at: new Date(Date.now() - 24 * 60 * 1000).toISOString(),
    completed_rate: 0.78,
    completed_chars: 780,
    total_chars: 1000,
  },
  {
    id: 'demo-doc-2',
    title: 'Literature Review: learning transfer',
    academic_style: 'MLA',
    snippet: 'Learning transfer depends on how prior concepts are organized.',
    secondarySnippet: 'This draft compares near transfer and far transfer...',
    updated_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    completed_rate: 0.34,
    completed_chars: 340,
    total_chars: 1000,
  },
  {
    id: 'demo-doc-3',
    title: 'Methods Notes: interview protocol',
    academic_style: 'Chicago',
    snippet: 'The interview protocol uses semi-structured questions.',
    secondarySnippet: 'Participants are grouped by writing experience...',
    updated_at: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString(),
    completed_rate: 0.91,
    completed_chars: 910,
    total_chars: 1000,
  },
];
const DEMO_STORE_KEY = 'project-thesis-rewriter:demo-store:v1';
const LOCAL_PROFILE_PICTURE_KEY = 'project-thesis-rewriter:local-profile-picture:v1';

function readLocalProfilePicture() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(LOCAL_PROFILE_PICTURE_KEY) || '';
}

function writeLocalProfilePicture(value) {
  if (typeof window === 'undefined') return;
  if (value) {
    window.localStorage.setItem(LOCAL_PROFILE_PICTURE_KEY, value);
  } else {
    window.localStorage.removeItem(LOCAL_PROFILE_PICTURE_KEY);
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function homeUserFromAuth(authUser, fallback = DEMO_USER) {
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

function readDemoStore() {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEMO_STORE_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.documents)) return null;
    return {
      documents: parsed.documents,
      trashDocuments: Array.isArray(parsed.trashDocuments) ? parsed.trashDocuments : [],
      hiddenDocumentIds: Array.isArray(parsed.hiddenDocumentIds) ? parsed.hiddenDocumentIds : [],
    };
  } catch {
    return null;
  }
}

function writeDemoStore({ documents, trashDocuments, hiddenDocumentIds }) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEMO_STORE_KEY, JSON.stringify({
    documents,
    trashDocuments,
    hiddenDocumentIds,
  }));
}

function demoDocumentsFallback(sourceDocuments = DEMO_DOCUMENTS, q = '', sort = 'most_recent', hiddenIds = []) {
  const normalizedQuery = q.trim().toLowerCase();
  const hidden = new Set(hiddenIds);
  const filtered = sourceDocuments.filter((document) => {
    if (hidden.has(document.id)) return false;
    if (!normalizedQuery) return true;
    return [
      document.title,
      document.academic_style,
      document.snippet,
      document.secondarySnippet,
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery));
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (sort === 'least_recent') {
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    }
    if (sort === 'most_completed') {
      return Number(b.completed_rate ?? 0) - Number(a.completed_rate ?? 0);
    }
    if (sort === 'least_completed') {
      return Number(a.completed_rate ?? 0) - Number(b.completed_rate ?? 0);
    }
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
  return sorted;
}

function pickHistoryDocument(documents, currentDocument) {
  if (currentDocument && documents.some((document) => document.id === currentDocument.id)) {
    return currentDocument;
  }
  return documents[0] ?? DEMO_DOCUMENTS[0];
}

// Temporary local fallback for offline UI testing while PostgreSQL is unavailable.
// The backend upload path still uses scripts/lib/initialClustering.cjs for real imports.
function localInitialClustering(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.endsWith('.') ? part : `${part}.`));
}

function demoBlockAttrs(blockId, status, length) {
  return {
    blockId,
    status,
    length,
    lineHeight: '2.0',
    textIndent: '0.5in',
    textAlign: 'left',
    fontFamily: 'Times New Roman',
    fontSize: '12pt',
  };
}

function createLocalDemoDocument({ title = 'Untitled document', text = 'Start writing your document.', filename = null }) {
  const id = `demo-local-${Date.now()}-${Math.round(Math.random() * 10000)}`;
  const blocks = localInitialClustering(text).map((sentence, index) => {
    const blockId = `${id}-block-${index + 1}`;
    const status = index === 0 ? 'processing' : 'unprocessed';
    const attrs = demoBlockAttrs(blockId, status, sentence.length);
    return {
      id: blockId,
      document_id: id,
      block_index: index,
      text_content: sentence,
      status,
      char_length: sentence.length,
      attrs,
      tiptap_node: {
        type: 'paragraph',
        attrs,
        content: [{ type: 'text', text: sentence }],
      },
    };
  });
  const safeBlocks = blocks.length ? blocks : localInitialClustering('Start writing your document.').map((sentence, index) => {
    const blockId = `${id}-block-${index + 1}`;
    const status = 'processing';
    const attrs = demoBlockAttrs(blockId, status, sentence.length);
    return {
      id: blockId,
      document_id: id,
      block_index: index,
      text_content: sentence,
      status,
      char_length: sentence.length,
      attrs,
      tiptap_node: {
        type: 'paragraph',
        attrs,
        content: [{ type: 'text', text: sentence }],
      },
    };
  });
  const totalChars = safeBlocks.reduce((sum, block) => sum + block.char_length, 0);

  return {
    id,
    title,
    academic_style: 'APA',
    snippet: safeBlocks[0]?.text_content ?? title,
    secondarySnippet: safeBlocks[1]?.text_content ?? 'Local demo document created while PostgreSQL is offline.',
    content_json: {
      type: 'doc',
      content: safeBlocks.map((block) => block.tiptap_node),
    },
    blocks: safeBlocks,
    current_processing_block_id: safeBlocks[0]?.id ?? null,
    original_filename: filename,
    completed_rate: 0,
    completed_chars: 0,
    total_chars: totalChars,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export default function HomePage({ onOpenWorkspace }) {
  const { user: authUser, signOut } = useAuth();
  const storedDemo = useMemo(() => readDemoStore(), []);
  const [user, setUser] = useState(() => {
    const localProfilePicture = readLocalProfilePicture();
    return {
      ...homeUserFromAuth(authUser),
      profilePictureUrl: localProfilePicture,
      hasProfilePicture: Boolean(localProfilePicture),
    };
  });
  const [demoDocuments, setDemoDocuments] = useState(storedDemo?.documents ?? DEMO_DOCUMENTS);
  const [documents, setDocuments] = useState(storedDemo?.documents ?? DEMO_DOCUMENTS);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('most_recent');
  const [activePage, setActivePage] = useState('docs');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [historyDocument, setHistoryDocument] = useState((storedDemo?.documents ?? DEMO_DOCUMENTS)[0]);
  const [hiddenDemoDocumentIds, setHiddenDemoDocumentIds] = useState(storedDemo?.hiddenDocumentIds ?? []);
  const [demoTrashDocuments, setDemoTrashDocuments] = useState(storedDemo?.trashDocuments ?? []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    writeDemoStore({
      documents: demoDocuments,
      trashDocuments: demoTrashDocuments,
      hiddenDocumentIds: hiddenDemoDocumentIds,
    });
  }, [demoDocuments, demoTrashDocuments, hiddenDemoDocumentIds]);

  useEffect(() => {
    if (!authUser) return;
    setUser((current) => homeUserFromAuth(authUser, current));
  }, [authUser]);

  useEffect(() => {
    let alive = true;
    getMe()
      .then((profile) => {
        if (alive) {
          const localProfilePicture = readLocalProfilePicture();
          setUser((current) => ({
            ...current,
            ...profile,
            email: authUser?.email || profile.email || current.email,
            display_name: authUser?.name || profile.display_name || current.display_name,
            profilePictureUrl: localProfilePicture || current.profilePictureUrl || '',
            hasProfilePicture: Boolean(localProfilePicture || profile.hasProfilePicture || current.hasProfilePicture),
          }));
        }
      })
      .catch(() => {
        if (alive) setNotice('Local database is not connected yet; showing demo homepage data.');
      });

    return () => {
      alive = false;
    };
  }, [authUser]);

  useEffect(() => {
    let alive = true;
    listDocuments({ q: query, sort })
      .then((data) => {
        if (alive) {
          const nextDocuments = data.documents ?? [];
          setDocuments(nextDocuments);
          setHistoryDocument((current) => pickHistoryDocument(nextDocuments, current));
          setNotice('');
        }
      })
      .catch(() => {
        if (alive) {
          const nextDocuments = demoDocumentsFallback(demoDocuments, query, sort, hiddenDemoDocumentIds);
          setDocuments(nextDocuments);
          setHistoryDocument((current) => pickHistoryDocument(nextDocuments, current));
        }
      });

    return () => {
      alive = false;
    };
  }, [query, sort, hiddenDemoDocumentIds, demoDocuments]);

  const progressValue = useMemo(() => {
    return Math.round(Number(user?.stats?.completed_rate ?? 0) * 100);
  }, [user]);

  async function handleNewDocument() {
    setBusy(true);
    try {
      const result = await createDocument();
      onOpenWorkspace?.(result.document);
    } catch {
      const document = createLocalDemoDocument({
        title: 'Untitled document',
        text: 'Start writing your document. This local document is available until PostgreSQL is connected.',
      });
      const nextDemoDocuments = [document, ...demoDocuments];
      setDemoDocuments(nextDemoDocuments);
      setDocuments((current) => [document, ...current]);
      setHistoryDocument(document);
      setNotice('PostgreSQL is offline; opened a local demo document instead.');
      writeDemoStore({
        documents: nextDemoDocuments,
        trashDocuments: demoTrashDocuments,
        hiddenDocumentIds: hiddenDemoDocumentIds,
      });
      onOpenWorkspace?.(document);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file) {
    setBusy(true);
    try {
      const result = await uploadDocument(file);
      onOpenWorkspace?.(result.document);
    } catch (error) {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.doc')) {
        setNotice('.doc uploads are not supported. Please upload .docx, .md, or .txt.');
      } else if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
        const text = await file.text();
        const document = createLocalDemoDocument({
          title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') || 'Uploaded demo document',
          text,
          filename: file.name,
        });
        const nextDemoDocuments = [document, ...demoDocuments];
        setDemoDocuments(nextDemoDocuments);
        setDocuments((current) => [document, ...current]);
        setHistoryDocument(document);
        setNotice('PostgreSQL is offline; opened a local demo upload instead.');
        writeDemoStore({
          documents: nextDemoDocuments,
          trashDocuments: demoTrashDocuments,
          hiddenDocumentIds: hiddenDemoDocumentIds,
        });
        onOpenWorkspace?.(document);
      } else if (lowerName.endsWith('.docx')) {
        setNotice(error.message || '.docx parsing needs the local upload API while PostgreSQL is offline.');
      } else {
        setNotice(error.message || 'Upload failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(document) {
    if (document.id.startsWith('demo-')) {
      const trashedDocument = {
        ...document,
        trashed: true,
        trashed_at: new Date().toISOString(),
      };
      setHiddenDemoDocumentIds((current) => (
        current.includes(document.id) ? current : [...current, document.id]
      ));
      setDemoTrashDocuments((current) => [
        trashedDocument,
        ...current.filter((item) => item.id !== document.id),
      ]);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setNotice(`${document.title} moved to demo trash.`);
      return;
    }

    setBusy(true);
    try {
      await moveToTrash(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
    } catch (error) {
      setNotice(error.message || 'Could not move document to trash.');
    } finally {
      setBusy(false);
    }
  }

  async function handleProfileUpload(file) {
    let localDataUrl = '';
    try {
      localDataUrl = await fileToDataUrl(file);
      writeLocalProfilePicture(localDataUrl);
      setUser((current) => ({
        ...current,
        profilePictureUrl: localDataUrl,
        hasProfilePicture: true,
      }));

      const nextUser = await uploadProfilePicture(file);
      setUser((current) => ({
        ...current,
        ...nextUser,
        profilePictureUrl: current.profilePictureUrl || localDataUrl,
        hasProfilePicture: true,
      }));
      setNotice('Profile picture updated.');
    } catch (error) {
      if (localDataUrl) {
        setNotice('Profile picture saved locally until the database is connected.');
        return;
      }
      setNotice(error.message || 'Profile upload failed.');
    }
  }

  function handleOpenDocument(document) {
    setHistoryDocument(document);
    onOpenWorkspace?.(document);
  }

  function handleDocumentReverted(document) {
    if (!document) return;
    setHistoryDocument(document);
    if (document.id?.startsWith('demo-')) {
      setDemoDocuments((current) => current.map((item) => (
        item.id === document.id ? { ...item, ...document } : item
      )));
    }
    setDocuments((current) => current.map((item) => (
      item.id === document.id ? { ...item, ...document } : item
    )));
  }

  function handleDemoRestore(document) {
    setDemoTrashDocuments((current) => current.filter((item) => item.id !== document.id));
    setHiddenDemoDocumentIds((current) => current.filter((id) => id !== document.id));
    setDemoDocuments((current) => current.map((item) => (
      item.id === document.id
        ? { ...item, ...document, trashed: false, trashed_at: null, updated_at: new Date().toISOString() }
        : item
    )));
    setNotice(`${document.title} restored to Docs.`);
  }

  function handleDemoDeleteForever(document) {
    setDemoTrashDocuments((current) => current.filter((item) => item.id !== document.id));
    setDemoDocuments((current) => current.filter((item) => item.id !== document.id));
    setHiddenDemoDocumentIds((current) => (
      current.includes(document.id) ? current : [...current, document.id]
    ));
    setNotice(`${document.title} permanently deleted from demo data.`);
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
          demoDocuments={demoTrashDocuments}
          onDemoRestore={handleDemoRestore}
          onDemoDeleteForever={handleDemoDeleteForever}
          onNotice={setNotice}
        />
      );
    }

    if (activePage === 'credits') {
      return <HomepageCredits />;
    }

    if (activePage === 'versions') {
      return (
        <HomepageVersionControl
          document={historyDocument}
          onNotice={setNotice}
          onDocumentReverted={handleDocumentReverted}
        />
      );
    }

    if (activePage === 'support') {
      return <HomepageSupport />;
    }

    return <HomepageSubscription />;
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
        setActivePage(page);
        setSidebarOpen(false);
      }}
      onToggleSidebar={() => setSidebarOpen((value) => !value)}
      onAccount={() => setAccountOpen(true)}
      onSubscription={() => setActivePage('subscription')}
      actionsHidden={hideHeaderActions}
    >
      {renderMainContent()}
      {accountOpen ? (
        <HomepageAccount
          user={user}
          onClose={() => setAccountOpen(false)}
          onLogout={signOut}
          onUploadProfile={handleProfileUpload}
        />
      ) : null}
    </HomeShell>
  );
}
