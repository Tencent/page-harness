// Share switch in the preview dock. The new-tab button opens this link only while sharing is actually up.
// lib/client.js keeps a copy of these three functions; test/share-bar.test.js fails if they drift.

export function shareSwitchOn(status) {
  return !!(status && (status.running || status.starting));
}

export function shareLinkOf(status) {
  return status && status.running && status.shareUrl ? status.shareUrl : "";
}

export function shareSwitchChecked(status, busy) {
  return busy ? !(status && status.running) : shareSwitchOn(status);
}
