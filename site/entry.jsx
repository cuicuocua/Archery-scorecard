import React from 'react';
import { createRoot } from 'react-dom/client';
import ArcheryScorecard, { SharedTournamentScreen } from '../ArcheryScorecard.jsx';

const shareToken = new URLSearchParams(window.location.search).get('share');

createRoot(document.getElementById('root')).render(
  shareToken ? <SharedTournamentScreen token={shareToken} /> : <ArcheryScorecard />
);

// Registered for both the organizer app and the public share page — same
// single-shell caching either way (see site/sw.js). Failing silently is
// fine here: it's a progressive enhancement (offline reload + installable
// icon), not something either screen depends on to function online.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
