// Address in the preview bar: the page the iframe is actually showing.
// lib/client.js keeps a copy; test/preview-bar.test.js fails if the two drift.

export function shownAddress(frameSrc, liveUrl, label) {
  if (liveUrl) return liveUrl;
  if (frameSrc && frameSrc.indexOf("/__ph/embed") === -1) return frameSrc;
  return label || "";
}
