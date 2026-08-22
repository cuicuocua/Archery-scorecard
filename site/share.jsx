// Entry point for the public spectator page (share.html).
//
// Imports ONLY SharedTournamentScreen, which is the whole point: esbuild
// tree-shakes everything the personal scorecard needs and nothing else
// reaches — most visibly recharts and its d3 tail, ~338 KB of charting
// that this page has never rendered a pixel of. A spectator following a
// link used to download the entire organizer app to look at a bracket.
//
// Deliberately does NOT register the service worker, unlike entry.jsx.
// sw.js caches every navigation response under one SHELL_URL key ('./'),
// so a spectator's visit would overwrite the organizer's cached app shell
// with this page. A spectator follows a link once and leaves; they have
// nothing to install.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SharedTournamentScreen } from '../ArcheryScorecard.jsx';

const shareToken = new URLSearchParams(window.location.search).get('share');

createRoot(document.getElementById('root')).render(<SharedTournamentScreen token={shareToken} />);
