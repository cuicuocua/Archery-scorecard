import React from 'react';
import { createRoot } from 'react-dom/client';
import ArcheryScorecard, { SharedTournamentScreen } from '../ArcheryScorecard.jsx';

const shareToken = new URLSearchParams(window.location.search).get('share');

createRoot(document.getElementById('root')).render(
  shareToken ? <SharedTournamentScreen token={shareToken} /> : <ArcheryScorecard />
);
