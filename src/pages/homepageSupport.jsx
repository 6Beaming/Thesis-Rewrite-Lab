import { useMemo, useState } from 'react';

const QUICK_START_STEPS = [
  {
    number: '01',
    title: 'Create or upload',
    copy: 'Choose New document, or upload a .docx, .md, or .txt file from the Docs page.',
  },
  {
    number: '02',
    title: 'Work through a block',
    copy: 'Select a highlighted text block, then analyze, practice, rewrite, complete, or skip it.',
  },
  {
    number: '03',
    title: 'Save and export',
    copy: 'Save your current work and choose Export to download the latest version as a Word file.',
  },
];

const GUIDE_TOPICS = [
  {
    id: 'documents',
    icon: 'document',
    eyebrow: 'Documents',
    title: 'Start and organize your work',
    summary: 'The Docs page is the home base for every paper.',
    steps: [
      'Choose New document to begin with a blank paper, or Upload to import a .docx, .md, or .txt file up to 2.5 MB.',
      'Use the search field to find a document by title and Sort by to order documents by date or completion.',
      'Select a document card to open its workspace. The card shows its academic style and current progress.',
      'Open the three-dot menu on a card to export it or move it to Trash.',
    ],
    note: 'A legacy .doc file is not supported. Save it as .docx before uploading.',
    keywords: 'home docs upload import search sort new blank progress delete menu',
  },
  {
    id: 'editor',
    icon: 'edit',
    eyebrow: 'Editor',
    title: 'Edit, format, and track progress',
    summary: 'The workspace keeps writing, formatting, and coaching together.',
    steps: [
      'Edit the title at the top and write directly on the paper. Use the toolbar for headings, lists, alignment, indentation, and inline formatting.',
      'Choose APA, MLA, Chicago, or Customized in the Styles panel. A template controls the global page and paragraph format.',
      'Select a text block to make it active. Choose Complete when the block is ready, or Skip to move on without rewriting it.',
      'Use Save in the toolbar whenever you want a versioned snapshot. If autosave is enabled, changes are also saved after a short pause.',
    ],
    note: 'The selected template stays active while saving preserves any local formatting differences.',
    keywords: 'workspace title toolbar styles apa mla chicago customized complete skip format autosave',
  },
  {
    id: 'ai-coach',
    icon: 'spark',
    eyebrow: 'Pro AI coach',
    title: 'Analyze, practice, and rewrite',
    summary: 'Use the owl panel to learn from one focused block at a time.',
    steps: [
      'Select a block and open Analyzing. Writing checks flag spelling, punctuation, fragments, and sentence connections without editing your text.',
      'Flip to the AI review for clarity, conciseness, academic style, flow, and targeted practice goals.',
      'Open Practicing, write your own revision, and choose Get AI feedback. Compare scores, follow the hints, then apply your version when ready.',
      'Open Rewriting to compare Formal & Academic, Persuasive & Argumentative, and Accessible & Concise options. Review Why this works before choosing Use this rewrite.',
    ],
    note: 'Suggestions never replace your writing automatically. You decide what to reject, apply, complete, or skip.',
    keywords: 'pro ai owl analysis language spelling grammar practice feedback score rewrite tone formal persuasive concise',
  },
  {
    id: 'citations',
    icon: 'quote',
    eyebrow: 'Pro citations',
    title: 'Review citations and references',
    summary: 'Check whether in-text citations match the sources listed in your paper.',
    steps: [
      'Choose APA, MLA, or Chicago before starting citation review. Customized formatting does not define a citation standard.',
      'Select Check citations in the Analyzing panel to review formatting, missing sources, and listed sources that are not used in the text.',
      'Choose Find the source when a citation has no match. If several publications are possible, select the title you actually used.',
      'Review every proposed change, then Accept change or Reject. Accepted citation changes are saved as a new document version.',
    ],
    note: 'Switching academic templates can convert the reference list and in-text citations after you confirm the change.',
    keywords: 'pro citation bibliography references apa mla chicago source doi missing unused format accept reject',
  },
  {
    id: 'history',
    icon: 'history',
    eyebrow: 'Recovery',
    title: 'Use versions, Trash, and history',
    summary: 'Saved work can be compared, restored, and recovered.',
    steps: [
      'Open Version history from the homepage sidebar and choose a document.',
      'Select two saved versions to compare their text, then restore the version you want to continue from.',
      'Open Trash to restore a document that was removed from Docs or delete it permanently.',
      'Use the recent-document list in the workspace to switch papers after saving your current edits.',
    ],
    note: 'Restoring a version updates the working document. Review it in the workspace before continuing.',
    keywords: 'version history compare restore trash recover delete recent document',
  },
  {
    id: 'export',
    icon: 'download',
    eyebrow: 'Pro export',
    title: 'Download the finished paper',
    summary: 'Export creates a Word document from the latest saved content.',
    steps: [
      'From Docs, open a document card’s three-dot menu and choose Export to download its saved version.',
      'From the workspace, choose Export in the toolbar. Unsaved edits are saved first so the download stays current.',
      'Unsaved edits are saved as written, including local formatting that differs from the selected template.',
      'Open the downloaded .docx file to review page margins, spacing, indentation, lists, headings, and inline formatting.',
    ],
    note: 'The current export format is .docx. The filename comes from the document title.',
    keywords: 'pro export download word docx save current format filename',
  },
  {
    id: 'account',
    icon: 'person',
    eyebrow: 'Account',
    title: 'Personalize writing support',
    summary: 'Account preferences can shape every document.',
    steps: [
      'Select your account badge in the homepage header to open the account panel.',
      'Upload an avatar or open Writing preferences.',
      'Choose your audience, subject context, vocabulary, structure, claim style, and feedback detail, or add custom instructions.',
      'Changes are saved automatically when you toggle Autosave, choose an option, or finish editing custom instructions.',
    ],
    note: 'Writing preferences refine the selected rewrite tone; they do not replace it.',
    keywords: 'account avatar profile writing preferences audience vocabulary autosave custom instructions',
  },
];

const FAQS = [
  {
    question: 'What does Pro include?',
    answer: 'The workspace requires an active Pro plan. Pro includes document editing, academic templates, personalized writing preferences, language and AI review, guided practice, three rewrite tones, citation tools, version history, and DOCX export.',
    keywords: 'pro subscription plan included pricing billing',
  },
  {
    question: 'Does an AI suggestion change my paper immediately?',
    answer: 'No. Language suggestions are temporary, and AI analysis is read-only. A practice attempt, rewrite, or citation proposal changes the paper only after you choose its apply or accept action.',
    keywords: 'ai automatic suggestion apply accept safety control',
  },
  {
    question: 'Why is citation review disabled?',
    answer: 'Citation review needs a defined citation standard. Choose APA, MLA, or Chicago instead of Customized formatting, then run the check again.',
    keywords: 'citation disabled customized apa mla chicago',
  },
  {
    question: 'What happens if I leave with unsaved edits?',
    answer: 'The workspace asks whether to cancel, leave without saving, or save before leaving. Enabling Autosave for docs reduces the chance of an unsaved draft.',
    keywords: 'leave unsaved save autosave warning',
  },
  {
    question: 'Where did my deleted document go?',
    answer: 'Documents removed from Docs first go to Trash. Open Trash from the sidebar to restore the document or delete it permanently.',
    keywords: 'deleted missing trash restore recover',
  },
  {
    question: 'Can I use the workspace on a phone or tablet?',
    answer: 'Yes. Use the workspace menu for uploads, styles, and recent documents. Tap the movable owl to open the analyzing, practicing, and rewriting panels.',
    keywords: 'mobile phone tablet owl menu responsive',
  },
  {
    question: 'How do I manage or cancel Pro?',
    answer: 'Choose the gold Pro button in the homepage header. The subscription page shows your current access and lets you cancel at the end of the billing period, resume auto-renew, or update payment details when needed.',
    keywords: 'pro cancel resume payment billing subscription',
  },
];

function SupportIcon({ type }) {
  const paths = {
    search: ['M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z', 'm16 16 4 4'],
    document: ['M7 3h7l4 4v14H7z', 'M14 3v5h4', 'M10 12h5', 'M10 16h5'],
    edit: ['m5 17-.8 3.8L8 20l10.5-10.5-3-3Z', 'm13.8 8.2 3 3'],
    spark: ['m12 3 1.4 4.1L17.5 9l-4.1 1.5L12 15l-1.5-4.5L6.5 9l4-1.9Z', 'M18.5 15.5 19 17l1.5.5-1.5.5-.5 1.5L18 18l-1.5-.5L18 17Z'],
    quote: ['M5 7h5v5H7c0 2-1 3-3 4', 'M14 7h5v5h-3c0 2-1 3-3 4'],
    history: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 5v5h5', 'M12 7v5l3 2'],
    download: ['M12 4v11', 'm7.5 10.5 4.5 4.5 4.5-4.5', 'M5 20h14'],
    person: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M5 21a7 7 0 0 1 14 0'],
    check: ['M5 12.5 9.5 17 19 7.5'],
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {(paths[type] ?? paths.check).map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

function searchableTopic(topic) {
  return [
    topic.eyebrow,
    topic.title,
    topic.summary,
    topic.note,
    topic.keywords,
    ...topic.steps,
  ].join(' ').toLowerCase();
}

export default function HomepageSupport({ onOpenSubscription }) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTopics = useMemo(() => (
    normalizedQuery
      ? GUIDE_TOPICS.filter((topic) => searchableTopic(topic).includes(normalizedQuery))
      : GUIDE_TOPICS
  ), [normalizedQuery]);
  const visibleFaqs = useMemo(() => (
    normalizedQuery
      ? FAQS.filter((item) => (
        `${item.question} ${item.answer} ${item.keywords}`.toLowerCase().includes(normalizedQuery)
      ))
      : FAQS
  ), [normalizedQuery]);
  const resultCount = visibleTopics.length + visibleFaqs.length;

  return (
    <section className="home-subpage support-page" aria-labelledby="support-title">
      <header className="home-subpage-header support-hero">
        <div className="support-hero-copy">
          <span className="support-kicker">Product manual &amp; feature guide</span>
          <h1 id="support-title">Learn Thesis Rewriter</h1>
          <p>
            Follow a paper from upload to polished DOCX and find clear
            instructions for every part of the website.
          </p>
          <div className="support-hero-actions">
            <a className="support-primary-link" href="#support-quick-start">Start with the basics</a>
            <a className="support-secondary-link" href="#support-faq">View FAQ</a>
          </div>
        </div>
        <div className="support-hero-preview" aria-label="Product workflow">
          <span>One paper</span>
          <ol>
            <li><SupportIcon type="document" />Write</li>
            <li><SupportIcon type="spark" />Learn</li>
            <li><SupportIcon type="check" />Finish</li>
          </ol>
          <small>You approve every change.</small>
        </div>
      </header>

      <section className="support-search-panel" aria-labelledby="support-search-heading">
        <div>
          <span className="support-section-label">Find an answer</span>
          <h2 id="support-search-heading">What would you like to do?</h2>
        </div>
        <label className="support-search">
          <span className="support-visually-hidden">Search the product guide</span>
          <SupportIcon type="search" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try “citations”, “export”, or “autosave”"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear guide search">
              Clear
            </button>
          ) : null}
        </label>
        <p className="support-search-status" aria-live="polite">
          {normalizedQuery
            ? `${resultCount} matching ${resultCount === 1 ? 'answer' : 'answers'}`
            : 'Search the full manual and frequently asked questions.'}
        </p>
      </section>

      {!normalizedQuery ? (
        <section className="support-section" id="support-quick-start" aria-labelledby="support-quick-start-title">
          <div className="support-section-heading">
            <div>
              <span className="support-section-label">Quick start</span>
              <h2 id="support-quick-start-title">Your first document in three steps</h2>
            </div>
            <p>Use the Docs page and workspace together.</p>
          </div>
          <div className="support-quick-grid">
            {QUICK_START_STEPS.map((step) => (
              <article className="support-quick-card" key={step.number}>
                <span>{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="support-manual-layout">
        <section className="support-section support-manual" aria-labelledby="support-manual-title">
          <div className="support-section-heading">
            <div>
              <span className="support-section-label">Complete manual</span>
              <h2 id="support-manual-title">
                {normalizedQuery ? 'Matching guides' : 'Work from draft to submission'}
              </h2>
            </div>
          </div>
          {visibleTopics.length ? (
            <div className="support-guide-list">
              {visibleTopics.map((topic) => (
                <article className="support-guide-card" id={`support-${topic.id}`} key={topic.id}>
                  <header>
                    <span className="support-guide-icon"><SupportIcon type={topic.icon} /></span>
                    <div>
                      <span className="support-guide-eyebrow">{topic.eyebrow}</span>
                      <h3>{topic.title}</h3>
                      <p>{topic.summary}</p>
                    </div>
                  </header>
                  <ol className="support-guide-steps">
                    {topic.steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                  <p className="support-guide-note"><strong>Good to know:</strong> {topic.note}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="support-no-results">
              <SupportIcon type="search" />
              <h3>No manual section matches “{query.trim()}”</h3>
              <p>Try a feature name such as upload, rewrite, citation, version, or export.</p>
              <button type="button" onClick={() => setQuery('')}>Show the full manual</button>
            </div>
          )}
        </section>

        <aside className="support-side-rail" aria-label="Pro features">
          <section className="support-pro-card" aria-labelledby="support-pro-title">
            <span className="support-pro-badge">PRO</span>
            <h2 id="support-pro-title">Complete Pro workspace</h2>
            <p>
              Pro unlocks the editor, personalized coaching, citation tools,
              version history, and DOCX export.
            </p>
            <ul>
              <li><SupportIcon type="check" />AI analysis, practice, and rewrites</li>
              <li><SupportIcon type="check" />APA, MLA, and Chicago workflows</li>
              <li><SupportIcon type="check" />Saved versions and Word export</li>
            </ul>
            <button type="button" onClick={onOpenSubscription}>View or manage Pro</button>
            <small>An active Pro plan is required to use the workspace.</small>
          </section>
        </aside>
      </div>

      <section className="support-section support-faq" id="support-faq" aria-labelledby="support-faq-title">
        <div className="support-section-heading">
          <div>
            <span className="support-section-label">Troubleshooting</span>
            <h2 id="support-faq-title">Frequently asked questions</h2>
          </div>
          <p>Select a question to expand its answer.</p>
        </div>
        {visibleFaqs.length ? (
          <div className="support-faq-grid">
            {visibleFaqs.map((item) => (
              <details key={item.question}>
                <summary>{item.question}<span aria-hidden="true">+</span></summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        ) : (
          <p className="support-faq-empty">No frequently asked question matches this search.</p>
        )}
      </section>
    </section>
  );
}
