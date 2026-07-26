import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  rewriteCardShowsProcessing,
  shouldAnimateWorkspaceOwl,
} from '../lib/rewriteProcessingState.js';

test('workspace modes share the required analyzing-first order and defaults', async () => {
  const source = await readFile(new URL('./WorkspacePage.jsx', import.meta.url), 'utf8');
  assert.match(
    source,
    /WORKSPACE_AI_MODES\s*=\s*Object\.freeze\(\['analyzing', 'practicing', 'rewriting'\]\)/u,
  );
  assert.match(source, /useState\('analyzing'\)/u);
  assert.doesNotMatch(source, /\['rewriting', 'analyzing', 'practicing'\]\.map/u);
  assert.match(
    source,
    /const workspaceOwlLoading = shouldAnimateWorkspaceOwl\(\{/u,
  );
  assert.match(
    source,
    /visibleBlockNlp\?\.identity\?\.nlpSnapshotFingerprint/u,
  );
  assert.match(source, /setTemplateSwitchReview\(\{/u);
  assert.match(source, /convertDocumentCitationStyle\(selectedDocument\.id/u);
  assert.match(source, /disabled=\{styleName === 'Customized'\}/u);
  assert.match(
    source,
    /requestLoading:\s*workspaceOwlRequestLoading/u,
  );
  assert.match(source, /const generateLabel = processingPrompt/u);
});

test('visible AI Writing processing prompts drive owl thinking state', () => {
  const currentRewriteBlock = { attrs: { resumeStatus: 'unprocessed', changeSource: 'none' } };
  assert.equal(rewriteCardShowsProcessing({ state: 'queued', response: '' }, currentRewriteBlock), true);
  assert.equal(rewriteCardShowsProcessing({ state: 'running', response: '' }, currentRewriteBlock), true);
  assert.equal(rewriteCardShowsProcessing({ state: 'idle', response: '' }, currentRewriteBlock), true);
  assert.equal(rewriteCardShowsProcessing({ state: 'failed', response: '' }, currentRewriteBlock), false);
  assert.equal(rewriteCardShowsProcessing({ state: 'completed', response: 'Done' }, currentRewriteBlock), false);

  const base = {
    requestLoading: false,
    workspaceMode: 'rewriting',
    mobileOwlOpen: false,
    mobilePanelMode: 'analyzing',
    rewriteAllCompleted: false,
    rewriteNlpEligible: true,
    rewriteCards: [{ state: 'running', response: '' }],
    currentRewriteBlock,
  };
  assert.equal(shouldAnimateWorkspaceOwl(base), true);
  assert.equal(shouldAnimateWorkspaceOwl({ ...base, workspaceMode: 'analyzing' }), false);
  assert.equal(shouldAnimateWorkspaceOwl({ ...base, requestLoading: true, workspaceMode: 'analyzing' }), true);
});

test('language review switcher remains an equal responsive grid', async () => {
  const css = await readFile(new URL('../styles/workspace.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /\.analysis-flip-card__switcher\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/su,
  );
  assert.match(
    css,
    /\.analysis-flip-card__switcher button\s*\{[^}]*font-size:\s*clamp\(/su,
  );
});
