const assert = require('node:assert/strict');
const test = require('node:test');
const { clustering, segmentSentences } = require('./clustering.cjs');

test('recognizes sentence punctuation without splitting common abbreviations or decimals', () => {
  assert.deepEqual(
    segmentSentences('Dr. Smith measured 3.14 units. Was it reliable? Yes!'),
    ['Dr. Smith measured 3.14 units.', 'Was it reliable?', 'Yes!'],
  );
});

test('groups complete sentences near the target character count', () => {
  const sentences = [
    'Alpha introduces the topic clearly.',
    'Beta adds supporting context carefully.',
    'Gamma closes the short discussion.',
  ];

  assert.deepEqual(
    clustering(sentences.join(' '), { targetChars: 75, minChars: 30, maxChars: 85 }),
    [sentences.slice(0, 2).join(' '), sentences[2]],
  );
});

test('merges an undersized final block when the result stays below the maximum', () => {
  const text = 'First sentence has enough detail. Second sentence adds context. Last one.';

  assert.deepEqual(
    clustering(text, { targetChars: 55, minChars: 40, maxChars: 90 }),
    [text],
  );
});

test('preserves paragraph and Markdown heading boundaries', () => {
  const text = '# Findings\n\nThe first paragraph ends here. It has another sentence.\n\nA new paragraph starts here.';

  assert.deepEqual(clustering(text), [
    '# Findings',
    'The first paragraph ends here. It has another sentence.',
    'A new paragraph starts here.',
  ]);
});

test('treats every newline as a paragraph boundary and ignores empty lines', () => {
  const text = 'First paragraph.\nSecond paragraph.\n\n\nThird paragraph.';

  assert.deepEqual(clustering(text), [
    'First paragraph.',
    'Second paragraph.',
    'Third paragraph.',
  ]);
});

test('uses blank lines for Markdown paragraph boundaries', () => {
  const text = 'A wrapped Markdown line.\ncontinues in the same paragraph.\n\nA new paragraph starts here.\n\n\nFinal paragraph.';

  assert.deepEqual(clustering(text, { paragraphBreak: 'blank-line' }), [
    'A wrapped Markdown line. continues in the same paragraph.',
    'A new paragraph starts here.',
    'Final paragraph.',
  ]);
});

test('keeps an oversized sentence intact', () => {
  const sentence = `${'word '.repeat(30).trim()}.`;

  assert.deepEqual(
    clustering(sentence, { targetChars: 40, minChars: 20, maxChars: 60 }),
    [sentence],
  );
});

test('returns no blocks for empty input', () => {
  assert.deepEqual(clustering(' \r\n '), []);
});
