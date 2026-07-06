// Temporary sentence clustering library for local testing.
// It intentionally uses only period notation until richer segmentation exists.
function initialClustering(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.endsWith('.') ? part : `${part}.`));
}

module.exports = { initialClustering };
