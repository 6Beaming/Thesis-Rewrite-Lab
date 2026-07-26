import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { mapBlockIssuesToEditorRanges } from '../lib/nlp/blockIssueMapping.js';

export const NLP_ISSUE_DECORATION_META = 'nlpIssueDecoration';

function trackedText(node) {
  return node.textBetween(0, node.content.size, '\n', '\n');
}

export function buildNlpIssueDecorations(state, issues = []) {
  if (!Array.isArray(issues) || !issues.length) return DecorationSet.empty;
  const byBlock = new Map();
  for (const issue of issues) {
    if (!issue?.blockId) continue;
    if (!byBlock.has(issue.blockId)) byBlock.set(issue.blockId, []);
    byBlock.get(issue.blockId).push(issue);
  }
  const decorations = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'blockSegment') return;
    const blockIssues = byBlock.get(node.attrs.blockId);
    if (!blockIssues?.length) return;
    const mapped = mapBlockIssuesToEditorRanges({
      blockId: node.attrs.blockId,
      text: trackedText(node),
      pos,
    }, blockIssues);
    for (const issue of mapped) {
      decorations.push(Decoration.inline(issue.from, issue.to, {
        class: `nlp-issue-decoration nlp-issue-decoration--${issue.severity}`,
        'data-nlp-code': issue.code,
        'data-nlp-message': issue.message,
        title: issue.message,
        role: 'note',
        'aria-label': `${issue.severity === 'blocking' ? 'Blocking issue' : 'Writing warning'}: ${issue.message}`,
        tabindex: '0',
      }, {
        inclusiveStart: false,
        inclusiveEnd: false,
      }));
    }
  });
  return DecorationSet.create(state.doc, decorations);
}

export const NlpIssueDecorationPlugin = Extension.create({
  name: 'nlpIssueDecoration',

  addStorage() {
    return { issues: [] };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('nlpIssueDecoration'),
        props: {
          decorations: (state) => buildNlpIssueDecorations(state, this.storage.issues),
        },
      }),
    ];
  },
});
