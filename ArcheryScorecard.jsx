import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  Target, Clock, ChevronLeft, ChevronRight, Plus, Trash2,
  Download, Upload, RotateCcw, Play, Check, StickyNote, LogOut, BarChart3,
  Swords, Trophy, Users, UserPlus, Shuffle, Minus, RefreshCw,
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

/*
 * Arcieri Senesi — Scorecard v1
 *
 * FITARCO / World Archery assumptions (round definitions live in
 * ROUND_TYPES below and are meant to be edited freely — nothing about
 * them is hardcoded elsewhere; "Personalizzata" also lets you pick any
 * distance/face/arrows/ends combination on the fly, for anything not
 * listed as a preset):
 *  - Indoor 18m: 40cm face, 3 frecce/volée, 20 volée (60 frecce) — standard.
 *  - Indoor 25m: 60cm face, 3 frecce/volée, 20 volée — mirrors the 18m
 *    structure for the Italian indoor 25+18 combined round; verify locally.
 *  - Targa 90/70/60m: 122cm face, 6 frecce/volée, 12 volée (72 frecce) —
 *    90/70m are WA1440 long distances (70m is also the current WA ranking
 *    round distance); 60m covers some categories (para, juniors).
 *  - Targa 50/40/30m: 80cm face, 6 frecce/volée, 12 volée — the WA1440
 *    short distances, and the standard compound/barebow distances.
 *  - Scoring: 10 zones, X is the inner half of the 10 ring, counted
 *    separately but worth 10. Ring colours centre-out: gold, gold, red,
 *    red, blue, blue, black, black, white, white (as specified). Compound's
 *    WA rule of only scoring the inner 5-10 ("compound face") is NOT
 *    modelled — all bow types score the full 10-zone face here.
 */

// Every round definition is a list of "stages" — most rounds are a single
// stage (one distance/face/arrows/ends), but multi-distance rounds (WA1440,
// WA Combined, ...) are a sequence of stages shot back to back within one
// session. A session mirrors this: session.stages[] instead of one flat
// round. Personal-best/pace comparisons and analysis are scoped per STAGE
// SHAPE (distance+face+arrows+ends), not per session — so a WA1440's 70m
// stage is compared against every other 70m stage ever shot, whether it
// came from a standalone Targa 70m session or from inside another
// multi-stage round. See stageEntries() below.
const ROUND_TYPES = [
  { id: 'indoor18', label: 'Indoor 18m', category: 'Indoor', editable: false,
    stages: [{ distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 20 }] },
  { id: 'indoor25', label: 'Indoor 25m', category: 'Indoor', editable: false,
    stages: [{ distanceM: 25, faceCm: 60, arrowsPerEnd: 3, ends: 20 }] },

  { id: 'targa90', label: 'Targa 90m', category: 'Targa 122cm', editable: false,
    stages: [{ distanceM: 90, faceCm: 122, arrowsPerEnd: 6, ends: 12 }] },
  { id: 'targa70', label: 'Targa 70m', category: 'Targa 122cm', editable: false,
    stages: [{ distanceM: 70, faceCm: 122, arrowsPerEnd: 6, ends: 12 }] },
  { id: 'targa60', label: 'Targa 60m', category: 'Targa 122cm', editable: false,
    stages: [{ distanceM: 60, faceCm: 122, arrowsPerEnd: 6, ends: 12 }] },

  { id: 'targa50', label: 'Targa 50m', category: 'Targa 80cm', editable: false,
    stages: [{ distanceM: 50, faceCm: 80, arrowsPerEnd: 6, ends: 12 }] },
  { id: 'targa40', label: 'Targa 40m', category: 'Targa 80cm', editable: false,
    stages: [{ distanceM: 40, faceCm: 80, arrowsPerEnd: 6, ends: 12 }] },
  { id: 'targa30', label: 'Targa 30m', category: 'Targa 80cm', editable: false,
    stages: [{ distanceM: 30, faceCm: 80, arrowsPerEnd: 6, ends: 12 }] },

  // Fully custom: one or more stages, each with its own pickable
  // distance/face/arrows/ends — for anything not covered above (para/youth
  // classes, club rounds, field-style faces, WA1440 in whichever distance
  // combination your category shoots, WA Combined, etc). Starts as a single
  // stage; "+ Aggiungi tappa" in the picker appends more.
  { id: 'custom', label: 'Personalizzata', category: 'Personalizzata', editable: true,
    stages: [{ distanceM: 30, faceCm: 40, arrowsPerEnd: 3, ends: 10 }] },
];

// ROUND_TYPES grouped by category, in declaration order — drives the
// grouped headings in the round picker without hardcoding group names twice.
const ROUND_GROUPS = (() => {
  const groups = [];
  ROUND_TYPES.forEach(r => {
    const last = groups[groups.length - 1];
    if (last && last.category === r.category) last.rounds.push(r);
    else groups.push({ category: r.category, rounds: [r] });
  });
  return groups;
})();

const BOW_TYPES = [
  { id: 'ricurvo', label: 'Ricurvo' },
  { id: 'compound', label: 'Compound' },
  { id: 'nudo', label: 'Nudo' },
];

const SESSION_TYPES = [
  { id: 'allenamento', label: 'Allenamento', hint: 'Sessione di pratica personale' },
  { id: 'gara', label: 'Gara', hint: 'Competizione ufficiale FITARCO' },
  // Unofficial, just-for-fun club competitions with made-up rules — the
  // FITARCO/club term for "not a federal gara" is "gara sociale".
  { id: 'sociale', label: 'Gara sociale', hint: 'Competizione informale, regole libere' },
];

// Conditions are logged after the round (you know the wind after you shot
// in it, not before), and always by picking a choice — never free text —
// so they stay analyzable across sessions.
const WIND_LEVELS = [
  { id: 'calma', label: 'Calma' },
  { id: 'leggero', label: 'Leggero' },
  { id: 'moderato', label: 'Moderato' },
  { id: 'forte', label: 'Forte' },
];

const TIME_OF_DAY = [
  { id: 'mattina', label: 'Mattina' },
  { id: 'pomeriggio', label: 'Pomeriggio' },
  { id: 'sera', label: 'Sera' },
];

const SUN_POSITIONS = [
  { id: 'assente', label: 'Assente/nuvoloso' },
  { id: 'alle_spalle', label: 'Alle spalle' },
  { id: 'laterale', label: 'Laterale' },
  { id: 'controluce', label: 'Controluce' },
];

const CONDITION_TAGS = [
  { id: 'pioggia', label: 'Pioggia' },
  { id: 'freddo', label: 'Freddo' },
  { id: 'caldo', label: 'Caldo' },
  { id: 'rumore', label: 'Rumore/folla' },
  { id: 'stanchezza', label: 'Stanchezza' },
  { id: 'materiale_nuovo', label: 'Materiale nuovo' },
];

const CONDITION_DIMENSIONS = [
  { id: 'wind', label: 'Vento', options: WIND_LEVELS },
  { id: 'timeOfDay', label: 'Momento', options: TIME_OF_DAY },
  { id: 'sun', label: 'Sole', options: SUN_POSITIONS },
  { id: 'tags', label: 'Altro', options: CONDITION_TAGS },
];

function emptyConditions() { return { wind: null, timeOfDay: null, sun: null, tags: [] }; }

// Personal-best / pace comparisons and the deeper analysis charts are scoped
// per round + arco + tipo — a gara score and an allenamento score aren't the
// same achievement, and neither are a recurve group and a compound group.
const MIN_SESSIONS_FOR_DEEP_ANALYSIS = 5;

const T = {
  bg: '#14161A',
  bgElevated: '#1B1E24',
  surface: '#20242B',
  surfaceAlt: '#262B33',
  border: '#31363F',
  borderStrong: '#3C424C',
  text: '#F1EFE7',
  textDim: '#9BA0AA',
  textFaint: '#6B707A',
  gold: '#E7B933',
  blue: '#3373B0',
  red: '#D8434A',
  ahead: '#5FBE7A',
  behind: '#E0A23C',
};

const SCORE_COLORS = {
  gold: { fill: '#E7B933', text: '#241A02', ring: '#C79A1E' },
  red: { fill: '#D8434A', text: '#2A0A0C', ring: '#B4363C' },
  blue: { fill: '#3373B0', text: '#0B1A28', ring: '#295D91' },
  black: { fill: '#3B3F46', text: '#F1EFE7', ring: '#4C515A' },
  white: { fill: '#ECE8DF', text: '#1A1A18', ring: '#C9C4B8' },
  miss: { fill: '#4A4F58', text: '#F1EFE7', ring: '#4A4F58' },
};
const GOLD_TEXT = SCORE_COLORS.gold.text;

const CONDENSED = '"Oswald","Barlow Condensed","Roboto Condensed","Arial Narrow",sans-serif';
const numeralStyle = { fontFamily: CONDENSED, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' };

const FACE_R = 100;
const X_OUTER = 5;
const RING_SPECS = [
  { score: 1, outer: 100, group: 'white' },
  { score: 2, outer: 90, group: 'white' },
  { score: 3, outer: 80, group: 'black' },
  { score: 4, outer: 70, group: 'black' },
  { score: 5, outer: 60, group: 'blue' },
  { score: 6, outer: 50, group: 'blue' },
  { score: 7, outer: 40, group: 'red' },
  { score: 8, outer: 30, group: 'red' },
  { score: 9, outer: 20, group: 'gold' },
  { score: 10, outer: 10, group: 'gold' },
];

const KEYPAD_LAYOUT = [
  { score: 10, isX: true, label: 'X' },
  { score: 10, isX: false, label: '10' },
  { score: 9, isX: false, label: '9' },
  { score: 8, isX: false, label: '8' },
  { score: 7, isX: false, label: '7' },
  { score: 6, isX: false, label: '6' },
  { score: 5, isX: false, label: '5' },
  { score: 4, isX: false, label: '4' },
  { score: 3, isX: false, label: '3' },
  { score: 2, isX: false, label: '2' },
  { score: 1, isX: false, label: '1' },
  { score: 0, isX: false, label: 'M' },
];

// ---------- scoring / data helpers ----------

function ringGroupForScore(score) {
  if (score >= 9) return 'gold';
  if (score >= 7) return 'red';
  if (score >= 5) return 'blue';
  if (score >= 3) return 'black';
  if (score >= 1) return 'white';
  return 'miss';
}

function scoreRank(a) { return a.isX ? 11 : a.score; }

function scoreFromRadiusUnits(d) {
  if (d > FACE_R) return { score: 0, isX: false };
  if (d <= X_OUTER) return { score: 10, isX: true };
  const ring10Outer = FACE_R / 10;
  const ringFromOuter = Math.max(1, Math.ceil(d / ring10Outer));
  return { score: Math.max(1, 11 - ringFromOuter), isX: false };
}

function uid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ---------- stage helpers ----------
//
// A "stage" is `{ round: {label,distanceM,faceCm,arrowsPerEnd,ends}, ends: [{index,arrows}] }`
// — structurally identical to what a whole session used to be before v1.4.
// Every function in this section operates on a single stage. A session is a
// list of stages plus shared metadata (type, bow, date, conditions, ...);
// see the "session helpers" section below for the aggregate operations.

function flattenArrows(stage) { return stage.ends.flatMap(e => e.arrows); }
function totalScore(stage) { return flattenArrows(stage).reduce((s, a) => s + a.score, 0); }
function xCount(stage) { return flattenArrows(stage).filter(a => a.isX).length; }
function arrowsShotCount(stage) { return flattenArrows(stage).length; }
function totalArrowsInRound(stage) { return stage.round.arrowsPerEnd * stage.round.ends; }

function cumulativeScores(stage) {
  let sum = 0;
  return flattenArrows(stage).map(a => (sum += a.score));
}

function currentEndIndex(stage) {
  const idx = stage.ends.findIndex(e => e.arrows.length < stage.round.arrowsPerEnd);
  return idx === -1 ? stage.ends.length - 1 : idx;
}

function addArrow(stage, arrow) {
  const perEnd = stage.round.arrowsPerEnd;
  const idx = stage.ends.findIndex(e => e.arrows.length < perEnd);
  if (idx === -1) return stage;
  const ends = stage.ends.map((e, i) => (i === idx ? { ...e, arrows: [...e.arrows, arrow] } : e));
  return { ...stage, ends };
}

function undoLastArrow(stage) {
  for (let i = stage.ends.length - 1; i >= 0; i--) {
    if (stage.ends[i].arrows.length > 0) {
      const ends = stage.ends.map((e, idx) => (idx === i ? { ...e, arrows: e.arrows.slice(0, -1) } : e));
      return { ...stage, ends };
    }
  }
  return stage;
}

function computeGroupStats(points, faceCm) {
  const pts = points.filter(a => a.x != null && a.y != null);
  if (!pts.length) return null;
  const r = faceCm / 2;
  const cx = pts.reduce((s, a) => s + a.x, 0) / pts.length;
  const cy = pts.reduce((s, a) => s + a.y, 0) / pts.length;
  let sumR = 0, maxR = 0;
  pts.forEach(a => {
    const dx = (a.x - cx) * r, dy = (a.y - cy) * r;
    const d = Math.sqrt(dx * dx + dy * dy);
    sumR += d;
    if (d > maxR) maxR = d;
  });
  return { x: cx, y: cy, cxCm: cx * r, cyCm: cy * r, meanRadiusCm: sumR / pts.length, maxRadiusCm: maxR, count: pts.length };
}

function groupStats(stage, arrows) {
  return computeGroupStats(arrows, stage.round.faceCm);
}

// Compares the actual round snapshot (distance/face/arrows/ends), not any
// id — two "Personalizzata" stages with different made-up rules (common for
// gara sociale) are not the same round and must not be compared as if
// chasing the same personal best; conversely a WA1440's 70m stage and a
// standalone Targa 70m session DO count as the same round when the shape
// matches, on purpose.
function sameRound(a, b) {
  return a.distanceM === b.distanceM && a.faceCm === b.faceCm && a.arrowsPerEnd === b.arrowsPerEnd && a.ends === b.ends;
}

// entries: a flat list from stageEntries() — see below. scope: { round, bowType, sessionType }.
function findPersonalBest(entries, scope, excludeSessionId) {
  const candidates = entries.filter(e =>
    e.status === 'completed' &&
    e.sessionId !== excludeSessionId &&
    sameRound(e.round, scope.round) &&
    (e.bowType || null) === (scope.bowType || null) &&
    (e.sessionType || 'allenamento') === (scope.sessionType || 'allenamento'));
  if (!candidates.length) return null;
  return candidates.reduce((best, e) => (totalScore(e) > totalScore(best) ? e : best));
}

function paceVsPB(stage, pbEntry) {
  if (!pbEntry) return null;
  const shot = arrowsShotCount(stage);
  if (!shot) return null;
  const curCum = cumulativeScores(stage);
  const pbCum = cumulativeScores(pbEntry);
  const pbAtShot = pbCum[Math.min(shot, pbCum.length) - 1] ?? 0;
  return curCum[shot - 1] - pbAtShot;
}

// ---------- session helpers ----------
//
// A session is `{ id, roundId, roundLabel, stages: [stage, ...], sessionType,
// bowType, conditions, status, startedAt, completedAt, location, note }`.
// status/completedAt are session-wide: a multi-stage session only becomes
// 'completed' once every stage is full, so a partially-shot WA1440 never
// counts toward anyone's personal best (matches how a partially-shot single
// round already worked before multi-stage rounds existed).

function createSession(roundDef, meta) {
  const stages = roundDef.stages.map(st => ({
    round: { label: `${st.distanceM}m`, distanceM: st.distanceM, faceCm: st.faceCm, arrowsPerEnd: st.arrowsPerEnd, ends: st.ends },
    ends: Array.from({ length: st.ends }, (_, i) => ({ index: i, arrows: [] })),
  }));
  return {
    id: uid(),
    roundId: roundDef.id,
    roundLabel: roundDef.label,
    stages,
    sessionType: meta.sessionType || 'allenamento',
    bowType: meta.bowType || null,
    conditions: emptyConditions(),
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    completedAt: null,
    location: meta.location || '',
    note: meta.note || '',
  };
}

function sessionFlattenArrows(session) { return session.stages.flatMap(flattenArrows); }
function sessionTotalScore(session) { return session.stages.reduce((s, st) => s + totalScore(st), 0); }
function sessionXCount(session) { return session.stages.reduce((s, st) => s + xCount(st), 0); }
function sessionArrowsShot(session) { return session.stages.reduce((s, st) => s + arrowsShotCount(st), 0); }
function sessionTotalArrows(session) { return session.stages.reduce((s, st) => s + totalArrowsInRound(st), 0); }

// Index of the first not-yet-full stage, or the last stage if all are full.
function activeStageIndex(session) {
  const idx = session.stages.findIndex(st => arrowsShotCount(st) < totalArrowsInRound(st));
  return idx === -1 ? session.stages.length - 1 : idx;
}

function sessionAddArrow(session, arrow) {
  const idx = activeStageIndex(session);
  const stages = session.stages.map((st, i) => (i === idx ? addArrow(st, arrow) : st));
  const complete = stages.every(st => arrowsShotCount(st) >= totalArrowsInRound(st));
  return {
    ...session,
    stages,
    status: complete ? 'completed' : 'in_progress',
    completedAt: complete ? new Date().toISOString() : null,
  };
}

function sessionUndoLastArrow(session) {
  for (let i = session.stages.length - 1; i >= 0; i--) {
    if (arrowsShotCount(session.stages[i]) > 0) {
      const stages = session.stages.map((st, j) => (j === i ? undoLastArrow(st) : st));
      return { ...session, stages, status: 'in_progress', completedAt: null };
    }
  }
  return session;
}

// "Tappa 2 di 4 · Volée 3 di 6" for a multi-stage session, or just "Volée 3
// di 6" for a single-stage one — used anywhere a compact progress string is
// shown (Home's resume card, the shooting screen header).
function sessionProgressLabel(session) {
  const idx = activeStageIndex(session);
  const stage = session.stages[idx];
  const endLabel = `Volée ${currentEndIndex(stage) + 1} di ${stage.round.ends}`;
  return session.stages.length > 1 ? `Tappa ${idx + 1} di ${session.stages.length} · ${endLabel}` : endLabel;
}

// "70m · 122cm" for a single-stage session, "70m/122cm + 60m/122cm + ..."
// for a multi-stage one — shown alongside the editable round name so you
// can see exactly what shape you're naming, since the label itself is free
// text and can't be inferred from a typo-prone name alone.
function sessionShapeSummary(session) {
  if (session.stages.length === 1) {
    const r = session.stages[0].round;
    return `${r.distanceM}m · ${r.faceCm}cm`;
  }
  return session.stages.map(st => `${st.round.distanceM}m/${st.round.faceCm}cm`).join(' + ');
}

// Flattens every session's stages into virtual per-stage records for
// personal-best matching and analysis — the one place a multi-distance
// round gets "unbundled" so each distance is judged on its own history.
function stageEntries(sessions) {
  return sessions.flatMap(s => s.stages.map((stage, i) => ({
    sessionId: s.id,
    stageIndex: i,
    stageCount: s.stages.length,
    round: stage.round,
    ends: stage.ends,
    sessionType: s.sessionType,
    bowType: s.bowType,
    conditions: s.conditions,
    status: s.status,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
  })));
}

// Sessions saved before v1.4 have a single flat `round`+`ends` instead of
// `stages`. Rather than migrate stored data, normalize on the way in — old
// sessions keep working untouched and only get rewritten to the new shape
// the next time they're edited (via the normal upsert-on-update path).
function normalizeSession(session) {
  if (session.stages) return session;
  return {
    ...session,
    roundLabel: session.round?.label || 'Sessione',
    stages: [{ round: session.round, ends: session.ends }],
  };
}

function describeBias(cxCm, cyCm) {
  const ax = Math.abs(cxCm), ay = Math.abs(cyCm);
  if (ax < 0.3 && ay < 0.3) return 'centrato';
  const parts = [];
  if (ax >= 0.3) parts.push(`${ax.toFixed(1)} cm a ${cxCm > 0 ? 'destra' : 'sinistra'}`);
  if (ay >= 0.3) parts.push(`${ay.toFixed(1)} cm in ${cyCm > 0 ? 'basso' : 'alto'}`);
  return parts.join(', ');
}

// A short, deterministic 1-2 sentence takeaway for a completed session —
// no external AI call, just arithmetic over the archer's own history, so it
// works fully offline and never invents anything not in the data.
//
// Sentence 1 ("headline"): this session's points-per-arrow against the
// historical points-per-arrow for the SAME round shape + tipo + arco,
// combined per stage (arrow-weighted) so a multi-stage session is compared
// fairly even when its stages have very different baselines.
//
// Sentence 2 ("detail"): whichever signal is most notable, in priority
// order — group bias, in-session fatigue (first half vs second half),
// misses, then gold rate. Omitted if nothing stands out.
function sessionInsight(session, allSessions) {
  const entries = stageEntries(allSessions);
  let baselineSum = 0, baselineArrows = 0, histCount = 0;
  session.stages.forEach(stage => {
    const hist = entries.filter(e =>
      e.status === 'completed' && e.sessionId !== session.id &&
      sameRound(e.round, stage.round) &&
      (e.bowType || null) === (session.bowType || null) &&
      (e.sessionType || 'allenamento') === (session.sessionType || 'allenamento'));
    if (!hist.length) return;
    histCount += hist.length;
    const arrows = arrowsShotCount(stage);
    const histArrows = hist.reduce((s, e) => s + arrowsShotCount(e), 0);
    if (!histArrows) return;
    const histAvg = hist.reduce((s, e) => s + totalScore(e), 0) / histArrows;
    baselineSum += histAvg * arrows;
    baselineArrows += arrows;
  });

  const thisArrows = sessionArrowsShot(session);
  const thisAvg = thisArrows ? sessionTotalScore(session) / thisArrows : 0;
  const sentences = [];

  if (!baselineArrows) {
    sentences.push('Prima sessione registrata per questa combinazione di prova, tipo e arco: da qui inizia la tua media.');
  } else {
    const baselineAvg = baselineSum / baselineArrows;
    const diffPct = baselineAvg ? ((thisAvg - baselineAvg) / baselineAvg) * 100 : 0;
    if (Math.abs(diffPct) < 2) {
      sentences.push(`Media in linea con il tuo standard: ${thisAvg.toFixed(2)} punti a freccia (confronto su ${histCount} sessioni precedenti).`);
    } else if (diffPct > 0) {
      sentences.push(`${diffPct.toFixed(0)}% sopra la tua media abituale: ${thisAvg.toFixed(2)} contro ${baselineAvg.toFixed(2)} punti a freccia.`);
    } else {
      sentences.push(`${Math.abs(diffPct).toFixed(0)}% sotto la tua media abituale: ${thisAvg.toFixed(2)} contro ${baselineAvg.toFixed(2)} punti a freccia.`);
    }
  }

  // Secondary signal — computed from the stage with the most shot arrows,
  // which for the common single-stage session just is the session.
  const mainStage = session.stages.reduce((a, b) => (arrowsShotCount(b) > arrowsShotCount(a) ? b : a));
  const posArrows = flattenArrows(mainStage).filter(a => a.x != null && a.y != null);
  const group = posArrows.length ? computeGroupStats(posArrows, mainStage.round.faceCm) : null;

  const half = Math.ceil(mainStage.ends.length / 2);
  const firstHalfArrows = mainStage.ends.slice(0, half).flatMap(e => e.arrows);
  const secondHalfArrows = mainStage.ends.slice(half).flatMap(e => e.arrows);
  const firstAvg = firstHalfArrows.length ? firstHalfArrows.reduce((s, a) => s + a.score, 0) / firstHalfArrows.length : null;
  const secondAvg = secondHalfArrows.length ? secondHalfArrows.reduce((s, a) => s + a.score, 0) / secondHalfArrows.length : null;
  const fatigueDelta = firstAvg != null && secondAvg != null ? secondAvg - firstAvg : null;

  const arrows = sessionFlattenArrows(session);
  const misses = arrows.filter(a => a.score === 0).length;
  const golds = arrows.filter(a => a.score === 10).length;
  const goldRate = arrows.length ? golds / arrows.length : 0;

  if (group && Math.sqrt(group.cxCm ** 2 + group.cyCm ** 2) >= 1.5) {
    sentences.push(`Gruppo spostato ${describeBias(group.cxCm, group.cyCm)} — attenzione al rilascio.`);
  } else if (fatigueDelta != null && fatigueDelta <= -0.4) {
    sentences.push('Punteggio in calo nella seconda parte: possibile affaticamento.');
  } else if (fatigueDelta != null && fatigueDelta >= 0.4) {
    sentences.push('Partenza più lenta ma buona ripresa nella seconda parte.');
  } else if (misses > 0) {
    sentences.push(`${misses} frecc${misses === 1 ? 'ia' : 'e'} a vuoto da recuperare.`);
  } else if (goldRate >= 0.4) {
    sentences.push(`Ottima concentrazione nell'oro: ${Math.round(goldRate * 100)}% delle frecce.`);
  } else if (group) {
    sentences.push('Gruppo ben centrato.');
  }

  return sentences;
}

// completedList: stage entries (from stageEntries()) already filtered to
// status==='completed' and whatever round-shape/arco/tipo scope the caller
// cares about. A stage entry has the same {round, ends, ...} shape a stage
// does, so every function below works whether it's called with entries
// (Storico) or, in the shooting screen, directly with the active stage.
function fatigueCurve(completedList) {
  const maxEnds = completedList.reduce((m, s) => Math.max(m, s.round.ends), 0);
  const rows = [];
  for (let i = 0; i < maxEnds; i++) {
    let sum = 0, count = 0;
    completedList.forEach(s => {
      const end = s.ends[i];
      if (end && end.arrows.length) {
        sum += end.arrows.reduce((a, b) => a + b.score, 0);
        count += end.arrows.length;
      }
    });
    rows.push({ end: i + 1, avg: count ? sum / count : null });
  }
  return rows;
}

function dispersionTrend(completedList) {
  return completedList
    .slice()
    .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
    .map(s => {
      const g = computeGroupStats(flattenArrows(s), s.round.faceCm);
      return g ? { label: formatDateShort(s.completedAt), dispersion: g.meanRadiusCm, biasX: g.cxCm, biasY: g.cyCm } : null;
    })
    .filter(Boolean);
}

const SCORE_DISTRIBUTION_KEYS = ['X', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1', 'M'];

function scoreDistribution(completedList) {
  const counts = {};
  SCORE_DISTRIBUTION_KEYS.forEach(k => (counts[k] = 0));
  completedList.forEach(s => {
    flattenArrows(s).forEach(a => {
      const key = a.isX ? 'X' : a.score === 0 ? 'M' : String(a.score);
      counts[key] += 1;
    });
  });
  return SCORE_DISTRIBUTION_KEYS.map(key => ({
    key,
    count: counts[key],
    color: SCORE_COLORS[key === 'M' ? 'miss' : ringGroupForScore(key === 'X' ? 10 : Number(key))].fill,
  }));
}

// dimension: one of CONDITION_DIMENSIONS ('wind' | 'timeOfDay' | 'sun' | 'tags').
// avg is per-arrow (comparable to the fatigue curve's 0-10 scale), not per-session total.
function scoreByCondition(completedList, dimension) {
  const dim = CONDITION_DIMENSIONS.find(d => d.id === dimension);
  const buckets = {};
  dim.options.forEach(o => { buckets[o.id] = { sum: 0, arrows: 0, sessions: 0 }; });
  completedList.forEach(s => {
    const c = s.conditions;
    if (!c) return;
    const values = dimension === 'tags' ? (c.tags || []) : (c[dimension] ? [c[dimension]] : []);
    values.forEach(v => {
      if (!buckets[v]) return;
      buckets[v].sum += totalScore(s);
      buckets[v].arrows += arrowsShotCount(s);
      buckets[v].sessions += 1;
    });
  });
  return dim.options
    .map(o => ({ key: o.label, avg: buckets[o.id].arrows ? buckets[o.id].sum / buckets[o.id].arrows : 0, count: buckets[o.id].sessions }))
    .filter(r => r.count > 0);
}

function bowLabel(bowType) {
  const b = BOW_TYPES.find(x => x.id === bowType);
  return b ? b.label : null;
}

function formatDateShort(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}
function formatDateFull(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function exportJson(sessions) {
  try {
    const payload = { app: 'arcieri-senesi-scorecard', version: 2, exportedAt: new Date().toISOString(), sessions };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arcieri-senesi-scorecard-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Errore export', err);
  }
}

// ---------- storage ----------
//
// Sessions live in Supabase (table `sessions`, one row per session, RLS
// scoped to auth.uid()) so the same data is available from any device you
// log into — not tied to one browser or one Claude conversation. Every
// mutation upserts just the changed session; there is no "rewrite the
// whole array" step like a single-key blob store would need.

const SUPABASE_URL = 'https://quomlosgvyrffvplkydc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_qDItHcsh15cNtjDrZwdOXw_Hf38618_';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function loadSessionsRemote(userId) {
  try {
    const { data, error } = await supabase.from('sessions').select('data').eq('user_id', userId);
    if (error) throw error;
    return (data || []).map(row => normalizeSession(row.data));
  } catch (err) {
    console.error('Errore nel caricamento dei dati', err);
    return [];
  }
}

async function upsertSessionRemote(userId, session) {
  try {
    const { error } = await supabase.from('sessions').upsert({
      id: session.id, user_id: userId, data: session, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Errore nel salvataggio dei dati', err);
    return false;
  }
}

async function deleteSessionRemote(sessionId) {
  try {
    const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Errore nella eliminazione', err);
    return false;
  }
}

// Tournaments live in their own table (same pattern as sessions) so a
// tournament can be created, scored live, and revisited across devices
// without touching the personal-scorecard data at all.
async function loadTournamentsRemote(userId) {
  try {
    const { data, error } = await supabase.from('tournaments').select('data').eq('user_id', userId);
    if (error) throw error;
    return (data || []).map(row => row.data);
  } catch (err) {
    console.error('Errore nel caricamento dei tornei', err);
    return [];
  }
}

async function upsertTournamentRemote(userId, tournament) {
  try {
    const { error } = await supabase.from('tournaments').upsert({
      id: tournament.id, user_id: userId, data: tournament, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Errore nel salvataggio del torneo', err);
    return false;
  }
}

async function deleteTournamentRemote(tournamentId) {
  try {
    const { error } = await supabase.from('tournaments').delete().eq('id', tournamentId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Errore nella eliminazione del torneo', err);
    return false;
  }
}

// One-time offer to pull in data saved by the old browser-local demo, if any.
const LEGACY_STORAGE_KEY = 'archery-scorecard-v1';
const LEGACY_MIGRATION_FLAG = 'archery-scorecard-migration-done';

function findLegacyLocalSessions() {
  try {
    if (localStorage.getItem(LEGACY_MIGRATION_FLAG)) return null;
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.sessions) && parsed.sessions.length ? parsed.sessions : null;
  } catch {
    return null;
  }
}

function markLegacyMigrationDone() {
  try { localStorage.setItem(LEGACY_MIGRATION_FLAG, '1'); } catch { /* ignore */ }
}

// ---------- small UI primitives ----------

function SegmentedControl({ options, value, onChange, small }) {
  return (
    <div className="inline-flex rounded-full p-1" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      {options.map(opt => {
        const active = opt.id === value;
        return (
          <button key={opt.id} onClick={() => onChange(opt.id)}
            className={`rounded-full font-semibold transition-colors ${small ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm'}`}
            style={{ background: active ? T.gold : 'transparent', color: active ? GOLD_TEXT : T.textDim }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function StatTile({ label, value, valueColor }) {
  return (
    <div className="rounded-xl px-2 py-2 text-center" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="text-xs" style={{ color: T.textDim }}>{label}</div>
      <div className="text-lg font-bold" style={{ ...numeralStyle, color: valueColor || T.text }}>{value}</div>
    </div>
  );
}

function Pill({ children, tone = 'gold' }) {
  const color = tone === 'gold' ? T.gold : tone === 'blue' ? T.blue : T.textDim;
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0" style={{ color, border: `1px solid ${color}` }}>
      {children}
    </span>
  );
}

function SessionTypeBadge({ sessionType }) {
  if (sessionType === 'gara') return <Pill>Gara</Pill>;
  if (sessionType === 'sociale') return <Pill tone="blue">Sociale</Pill>;
  return null;
}

function LoadingScreen() {
  return <div className="min-h-screen flex items-center justify-center" style={{ background: T.bg, color: T.textDim }}>Caricamento…</div>;
}

// Email + password. Avoids relying on Supabase's email delivery (unreliable
// on the free tier without custom SMTP) — nothing gets sent, so nothing
// can fail to send.
function AuthGate() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    try {
      const { error } = mode === 'signup'
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      // successful sign-in/sign-up fires onAuthStateChange in the root
      // component, which swaps this screen out — nothing else to do here.
    } catch (err) {
      setError(mode === 'signup' ? 'Registrazione non riuscita. Riprova.' : 'Email o password errati.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-6" style={{ background: T.bg, color: T.text }}>
      <div className="flex flex-col items-center gap-2 text-center">
        <Target size={40} color={T.gold} />
        <div className="text-xl font-bold">Arcieri Senesi</div>
        <div className="text-sm max-w-xs" style={{ color: T.textDim }}>Accedi per avere i tuoi dati su tutti i dispositivi</div>
      </div>

      <div className="w-full max-w-xs flex flex-col gap-3">
        <input type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="La tua email"
          className="rounded-xl px-4 py-3 text-center" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Password" onKeyDown={e => e.key === 'Enter' && email && password && submit()}
          className="rounded-xl px-4 py-3 text-center" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        {mode === 'signup' && <div className="text-xs text-center" style={{ color: T.textDim }}>Almeno 6 caratteri</div>}
        <button onClick={submit} disabled={!email || !password || busy}
          className="rounded-2xl py-3.5 font-bold disabled:opacity-40" style={{ background: T.gold, color: GOLD_TEXT }}>
          {busy ? '…' : mode === 'signup' ? 'Crea account' : 'Accedi'}
        </button>
        <button onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); }} className="text-sm py-1" style={{ color: T.textDim }}>
          {mode === 'signup' ? 'Hai già un account? Accedi' : 'Primo accesso? Crea un account'}
        </button>
      </div>

      {error && <div className="text-sm text-center" style={{ color: T.behind }}>{error}</div>}
    </div>
  );
}

// ---------- target face ----------

function TargetFace({ faceCm, zoom = 1, interactive = false, onTap, points = [], centroid = null, dense = false, focus = null }) {
  const svgRef = useRef(null);
  const margin = interactive && zoom === 1 ? 15 : 0;
  const half = FACE_R / zoom + margin;
  // When zoomed in, recenter the crop on where the group actually is (not
  // always the bullseye) so a group that has drifted off-centre stays
  // visible and tappable at high zoom instead of being cropped out.
  const focusX = zoom > 1 && focus ? focus.x * FACE_R : 0;
  const focusY = zoom > 1 && focus ? focus.y * FACE_R : 0;
  const vb = `${focusX - half} ${focusY - half} ${half * 2} ${half * 2}`;
  const groupRadius = centroid && centroid.maxRadiusCm != null && centroid.maxRadiusCm > 0
    ? (centroid.maxRadiusCm / (faceCm / 2)) * FACE_R
    : null;

  function handlePointerDown(evt) {
    if (!interactive || !svgRef.current) return;
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const loc = pt.matrixTransform(ctm.inverse());
    const x = loc.x / FACE_R;
    const y = loc.y / FACE_R;
    if (Math.sqrt(x * x + y * y) > 1.15) return;
    onTap(x, y);
  }

  return (
    <div className="w-full aspect-square rounded-2xl overflow-hidden" style={{ background: T.bgElevated }}>
      <svg ref={svgRef} viewBox={vb} className="w-full h-full touch-none" onPointerDown={handlePointerDown}>
        <circle cx={0} cy={0} r={FACE_R + 3} fill="none" stroke={T.borderStrong} strokeWidth={1.5} />
        {RING_SPECS.map(spec => {
          const c = SCORE_COLORS[spec.group];
          const strokeColor = spec.group === 'black' ? 'rgba(230,225,215,0.45)' : 'rgba(15,13,8,0.35)';
          return <circle key={spec.score} cx={0} cy={0} r={spec.outer} fill={c.fill} stroke={strokeColor} strokeWidth={0.6} />;
        })}
        <circle cx={0} cy={0} r={X_OUTER} fill="none" stroke="rgba(15,13,8,0.55)" strokeWidth={0.6} />

        {/* Group trace + crosshair render BEHIND the arrow marks on purpose — at
            high zoom on a tight group, the crosshair must never hide the very
            arrows it's summarizing. */}
        {centroid && (
          <g>
            {groupRadius != null && (
              <circle cx={centroid.x * FACE_R} cy={centroid.y * FACE_R} r={groupRadius} fill="none"
                stroke={T.text} strokeWidth={0.8} strokeDasharray="3 2" opacity={0.55} />
            )}
            <g opacity={0.7}>
              <line x1={centroid.x * FACE_R - 8} y1={centroid.y * FACE_R} x2={centroid.x * FACE_R + 8} y2={centroid.y * FACE_R} stroke={T.text} strokeWidth={1.2} />
              <line x1={centroid.x * FACE_R} y1={centroid.y * FACE_R - 8} x2={centroid.x * FACE_R} y2={centroid.y * FACE_R + 8} stroke={T.text} strokeWidth={1.2} />
              <circle cx={centroid.x * FACE_R} cy={centroid.y * FACE_R} r={3} fill="none" stroke={T.text} strokeWidth={1} />
            </g>
          </g>
        )}

        {points.map((p, i) => {
          if (p.x == null || p.y == null) return null;
          const c = SCORE_COLORS[ringGroupForScore(p.score)];
          const r = dense ? 1.8 : 2.6;
          const opacity = p.ghost ? 0.35 : (dense ? 0.6 : 0.95);
          return (
            <circle key={i} cx={p.x * FACE_R} cy={p.y * FACE_R} r={r} fill={c.fill}
              stroke={p.ghost ? 'none' : '#0c0b08'} strokeWidth={p.ghost ? 0 : 0.5} opacity={opacity} />
          );
        })}
      </svg>
    </div>
  );
}

function Keypad({ onScore }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {KEYPAD_LAYOUT.map((k, i) => {
        const c = SCORE_COLORS[k.score === 0 ? 'miss' : ringGroupForScore(k.score)];
        return (
          <button key={i} onClick={() => onScore(k.score, k.isX)}
            className="h-16 rounded-2xl text-2xl font-bold active:scale-95 transition-transform"
            style={{ ...numeralStyle, background: c.fill, color: c.text }}>
            {k.label}
          </button>
        );
      })}
    </div>
  );
}

function ArrowChip({ arrow }) {
  const c = SCORE_COLORS[ringGroupForScore(arrow.score)];
  const label = arrow.isX ? 'X' : arrow.score === 0 ? 'M' : String(arrow.score);
  return (
    <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold"
      style={{ ...numeralStyle, background: c.fill, color: c.text, border: `2px solid ${c.ring}` }}>
      {label}
    </div>
  );
}

function ArrowChipSmall({ arrow }) {
  const c = SCORE_COLORS[ringGroupForScore(arrow.score)];
  const label = arrow.isX ? 'X' : arrow.score === 0 ? 'M' : String(arrow.score);
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
      style={{ ...numeralStyle, background: c.fill, color: c.text }}>
      {label}
    </div>
  );
}

function EndChips({ end, arrowsPerEnd }) {
  const sorted = [...end.arrows].sort((a, b) => scoreRank(b) - scoreRank(a));
  const placeholders = Math.max(0, arrowsPerEnd - end.arrows.length);
  return (
    <div className="flex flex-wrap gap-2">
      {sorted.map((a, i) => <ArrowChip key={i} arrow={a} />)}
      {Array.from({ length: placeholders }).map((_, i) => (
        <div key={`ph-${i}`} className="w-14 h-14 rounded-full" style={{ border: `2px dashed ${T.border}` }} />
      ))}
    </div>
  );
}

// ---------- session metadata editor ----------

const BOW_TYPE_OPTIONS_WITH_NONE = [{ id: 'none', label: 'Non specificato' }, ...BOW_TYPES];

// Shifts startedAt (and completedAt, if set) to a new calendar date while
// preserving each timestamp's time-of-day and the gap between the two —
// editing the date of a past session shouldn't invent a shooting time.
function withSessionDate(session, dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return session;
  const oldStart = new Date(session.startedAt);
  const newStart = new Date(oldStart);
  newStart.setFullYear(y, m - 1, d);
  const deltaMs = newStart.getTime() - oldStart.getTime();
  const newCompletedAt = session.completedAt ? new Date(new Date(session.completedAt).getTime() + deltaMs).toISOString() : session.completedAt;
  return { ...session, startedAt: newStart.toISOString(), completedAt: newCompletedAt };
}

function SessionMetaEditor({ session, onUpdate }) {
  const [location, setLocation] = useState(session.location);
  const [note, setNote] = useState(session.note);
  const [roundLabel, setRoundLabel] = useState(session.roundLabel);

  return (
    <div className="flex flex-col gap-3 w-full rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="text-sm font-semibold" style={{ color: T.textDim }}>Dettagli</div>

      <div className="flex flex-col gap-1.5">
        <div className="text-xs flex items-center gap-1.5" style={{ color: T.textDim }}>
          <span>Nome prova</span>
          <span style={{ color: T.textFaint }}>· {sessionShapeSummary(session)}</span>
        </div>
        <input value={roundLabel} onChange={e => setRoundLabel(e.target.value)}
          onBlur={() => { const t = roundLabel.trim(); t ? onUpdate(s => ({ ...s, roundLabel: t })) : setRoundLabel(session.roundLabel); }}
          list="round-label-suggestions" placeholder="es. Targa 70m"
          className="rounded-lg px-3 py-2 text-sm w-full" style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.text }} />
        <datalist id="round-label-suggestions">
          {ROUND_TYPES.map(r => <option key={r.id} value={r.label} />)}
        </datalist>
      </div>

      <input type="date" value={session.startedAt.slice(0, 10)} onChange={e => e.target.value && onUpdate(s => withSessionDate(s, e.target.value))}
        className="rounded-lg px-3 py-2 text-sm w-full" style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.text, colorScheme: 'dark' }} />

      <ChipSelect label="Tipo" options={SESSION_TYPES} value={session.sessionType} onChange={(v) => v && onUpdate(s => ({ ...s, sessionType: v }))} />
      <ChipSelect label="Arco" options={BOW_TYPE_OPTIONS_WITH_NONE} value={session.bowType || 'none'}
        onChange={(v) => onUpdate(s => ({ ...s, bowType: v === 'none' ? null : v }))} />

      <input value={location} onChange={e => setLocation(e.target.value)} onBlur={() => onUpdate(s => ({ ...s, location }))}
        placeholder="Luogo (es. Campo Arcieri Senesi)"
        className="rounded-lg px-3 py-2 text-sm w-full" style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.text }} />
      <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={() => onUpdate(s => ({ ...s, note }))} rows={2}
        placeholder="Note: vento, materiale, sensazioni..."
        className="rounded-lg px-3 py-2 text-sm resize-none w-full" style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.text }} />
    </div>
  );
}

function ChipSelect({ label, options, value, onChange, multi = false }) {
  const isActive = (id) => (multi ? (value || []).includes(id) : value === id);
  function toggle(id) {
    if (multi) {
      const set = new Set(value || []);
      set.has(id) ? set.delete(id) : set.add(id);
      onChange(Array.from(set));
    } else {
      onChange(value === id ? null : id);
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs" style={{ color: T.textDim }}>{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => (
          <button key={o.id} onClick={() => toggle(o.id)}
            className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              background: isActive(o.id) ? T.surfaceAlt : T.surface,
              border: `1px solid ${isActive(o.id) ? T.gold : T.border}`,
              color: isActive(o.id) ? T.gold : T.textDim,
            }}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConditionsEditor({ session, onUpdate }) {
  const conditions = session.conditions || emptyConditions();
  function patch(fields) {
    onUpdate(s => ({ ...s, conditions: { ...(s.conditions || emptyConditions()), ...fields } }));
  }
  return (
    <div className="flex flex-col gap-3 w-full rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="text-sm font-semibold" style={{ color: T.textDim }}>Condizioni</div>
      <ChipSelect label="Vento" options={WIND_LEVELS} value={conditions.wind} onChange={(v) => patch({ wind: v })} />
      <ChipSelect label="Momento della giornata" options={TIME_OF_DAY} value={conditions.timeOfDay} onChange={(v) => patch({ timeOfDay: v })} />
      <ChipSelect label="Posizione del sole" options={SUN_POSITIONS} value={conditions.sun} onChange={(v) => patch({ sun: v })} />
      <ChipSelect label="Altre condizioni" options={CONDITION_TAGS} value={conditions.tags} onChange={(v) => patch({ tags: v })} multi />
    </div>
  );
}

// ---------- shooting screen ----------

function StatsBar({ total, avg, projected, pace, hasPb }) {
  const paceColor = pace == null ? T.textDim : pace > 0 ? T.ahead : pace < 0 ? T.behind : T.textDim;
  const paceLabel = pace == null ? (hasPb ? '—' : 'n/d') : `${pace > 0 ? '+' : ''}${pace}`;
  return (
    <div className="px-4 pt-3 grid grid-cols-4 gap-2">
      <StatTile label="Totale" value={total} />
      <StatTile label="Media" value={avg.toFixed(2)} />
      <StatTile label="Proiez." value={projected ?? '—'} />
      <StatTile label="Ritmo PB" value={paceLabel} valueColor={paceColor} />
    </div>
  );
}

// Small card rendering sessionInsight()'s 1-2 sentences. Returns null (no
// empty card) if there's nothing to say yet.
function InsightCard({ sentences }) {
  if (!sentences.length) return null;
  return (
    <div className="w-full rounded-2xl p-4 flex flex-col gap-1 text-left" style={{ background: T.surfaceAlt, border: `1px solid ${T.border}` }}>
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.gold }}>Analisi rapida</div>
      {sentences.map((s, i) => <div key={i} className="text-sm" style={{ color: T.text }}>{s}</div>)}
    </div>
  );
}

function SessionSummary({ session, sessions, onExit, onUpdate }) {
  const total = sessionTotalScore(session);
  const shot = sessionArrowsShot(session);
  const avg = shot ? total / shot : 0;
  const insight = useMemo(() => sessionInsight(session, sessions), [session, sessions]);
  return (
    <div className="px-4 py-6 flex flex-col gap-5 items-center text-center max-w-md sm:max-w-xl lg:max-w-3xl mx-auto">
      <div>
        <div className="text-sm uppercase tracking-wide flex items-center gap-2 justify-center" style={{ color: T.textDim }}>
          Sessione completata
          <SessionTypeBadge sessionType={session.sessionType} />
        </div>
        <div className="text-5xl font-bold" style={numeralStyle}>{total}</div>
        <div className="text-sm mt-1" style={{ color: T.textDim }}>
          {session.roundLabel} · media {avg.toFixed(2)} · {sessionXCount(session)} X
          {bowLabel(session.bowType) ? ` · ${bowLabel(session.bowType)}` : ''}
        </div>
        {session.stages.length > 1 && (
          <div className="text-xs mt-2 flex flex-wrap gap-1.5 justify-center">
            {session.stages.map((st, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full" style={{ background: T.surfaceAlt, color: T.textDim }}>
                {st.round.distanceM}m: {totalScore(st)}
              </span>
            ))}
          </div>
        )}
      </div>
      <InsightCard sentences={insight} />
      <SessionMetaEditor session={session} onUpdate={onUpdate} />
      <ConditionsEditor session={session} onUpdate={onUpdate} />
      <button onClick={onExit} className="w-full rounded-2xl py-4 font-bold text-lg" style={{ background: T.gold, color: GOLD_TEXT }}>
        Torna alla home
      </button>
      <button onClick={() => onUpdate(s => sessionUndoLastArrow(s))} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-full" style={{ color: T.textDim }}>
        <RotateCcw size={14} /> Correggi l'ultima freccia
      </button>
    </div>
  );
}

function ShootingScreen({ session, sessions, onUpdate, onExit }) {
  const [mode, setMode] = useState('face');
  const [zoom, setZoom] = useState(1);
  const [noteOpen, setNoteOpen] = useState(false);

  const isComplete = session.status === 'completed';
  const stageIdx = activeStageIndex(session);
  const stage = session.stages[stageIdx];
  const round = stage.round;
  const multiStage = session.stages.length > 1;
  const endIdx = currentEndIndex(stage);
  const currentEnd = stage.ends[endIdx];
  const ghostArrows = useMemo(() => stage.ends.slice(0, endIdx).flatMap(e => e.arrows), [stage, endIdx]);

  // Stats are scoped to the stage currently being shot, since that's what a
  // personal best is scoped to — the session-wide total (shown separately
  // for multi-stage rounds) would mix distances into a meaningless number.
  const total = totalScore(stage);
  const shot = arrowsShotCount(stage);
  const avg = shot ? total / shot : 0;
  const projected = shot ? Math.round(avg * totalArrowsInRound(stage)) : null;
  const sessionTotalSoFar = sessionTotalScore(session);

  const entries = useMemo(() => stageEntries(sessions), [sessions]);
  const pb = useMemo(
    () => findPersonalBest(entries, { round, bowType: session.bowType, sessionType: session.sessionType }, session.id),
    [entries, round, session.bowType, session.sessionType, session.id]);
  const pace = shot ? paceVsPB(stage, pb) : null;

  const last3 = useMemo(() => {
    const withArrows = stage.ends.filter(e => e.arrows.length > 0);
    return withArrows.slice(-3).flatMap(e => e.arrows);
  }, [stage]);
  const stats3 = groupStats(stage, last3);
  const endsShotCount = stage.ends.filter(e => e.arrows.length > 0).length;

  function handleAddArrow(score, isX, x, y) {
    if (isComplete) return;
    onUpdate(s => sessionAddArrow(s, { score, isX, x: x ?? null, y: y ?? null }));
  }

  function handleFaceTap(x, y) {
    const d = Math.sqrt(x * x + y * y) * FACE_R;
    const r = scoreFromRadiusUnits(d);
    handleAddArrow(r.score, r.isX, x, y);
  }

  function handleUndo() {
    onUpdate(s => sessionUndoLastArrow(s));
  }

  return (
    <div className="flex flex-col max-w-md sm:max-w-xl lg:max-w-3xl mx-auto min-h-screen">
      <header className="sticky top-0 z-10 flex items-center justify-between px-3 py-3" style={{ background: T.bg, borderBottom: `1px solid ${T.border}` }}>
        <button onClick={onExit} className="p-2 -ml-2 rounded-full active:scale-95 transition-transform"><ChevronLeft /></button>
        <div className="text-center">
          <div className="font-semibold leading-tight flex items-center gap-2 justify-center">
            {session.roundLabel}
            <SessionTypeBadge sessionType={session.sessionType} />
          </div>
          <div className="text-xs" style={{ color: T.textDim }}>
            {isComplete ? 'Completata' : sessionProgressLabel(session)}
            {bowLabel(session.bowType) ? ` · ${bowLabel(session.bowType)}` : ''}
          </div>
        </div>
        <button onClick={() => setNoteOpen(o => !o)} className="p-2 -mr-2 rounded-full active:scale-95 transition-transform"><StickyNote size={20} /></button>
      </header>

      {noteOpen && !isComplete && (
        <div className="px-4 py-3" style={{ background: T.surface, borderBottom: `1px solid ${T.border}` }}>
          <SessionMetaEditor session={session} onUpdate={onUpdate} />
        </div>
      )}

      {!isComplete && (
        <>
          {multiStage && (
            <div className="px-4 pt-3 text-xs text-center" style={{ color: T.textDim }}>
              Totale sessione finora: <span style={{ ...numeralStyle, color: T.text, fontWeight: 700 }}>{sessionTotalSoFar}</span>
              {' '}· tappa attuale {round.distanceM}m / {round.faceCm}cm
            </div>
          )}
          <StatsBar total={total} avg={avg} projected={projected} pace={pace} hasPb={!!pb} />

          <div className="px-4 pt-3 flex items-center justify-between gap-2">
            <SegmentedControl options={[{ id: 'face', label: 'Bersaglio' }, { id: 'keypad', label: 'Tastierino' }]} value={mode} onChange={setMode} />
            {mode === 'face' && <SegmentedControl options={[{ id: 1, label: '1×' }, { id: 2, label: '2×' }, { id: 4, label: '4×' }]} value={zoom} onChange={setZoom} small />}
          </div>

          <div className="px-4 pt-3">
            {mode === 'face' ? (
              <TargetFace
                faceCm={round.faceCm}
                zoom={zoom}
                interactive
                onTap={handleFaceTap}
                points={[...ghostArrows.map(a => ({ ...a, ghost: true })), ...currentEnd.arrows.map(a => ({ ...a, ghost: false }))]}
                centroid={stats3}
                focus={stats3}
              />
            ) : (
              <Keypad onScore={(score, isX) => handleAddArrow(score, isX, null, null)} />
            )}
          </div>

          {mode === 'face' && stats3 && (
            <div className="px-4 pt-2 text-sm text-center" style={{ color: T.textDim }}>
              Gruppo (ultime {Math.min(3, endsShotCount)} volée): {describeBias(stats3.cxCm, stats3.cyCm)} · ampiezza {stats3.maxRadiusCm.toFixed(1)} cm
            </div>
          )}

          <div className="px-4 pt-4 pb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wide" style={{ color: T.textDim }}>Volée corrente</div>
              <button onClick={handleUndo} disabled={shot === 0 && stageIdx === 0}
                className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-full disabled:opacity-30"
                style={{ background: T.surfaceAlt }}>
                <RotateCcw size={14} /> Annulla
              </button>
            </div>
            <EndChips end={currentEnd} arrowsPerEnd={round.arrowsPerEnd} />
          </div>
        </>
      )}

      {isComplete && <SessionSummary session={session} sessions={sessions} onExit={onExit} onUpdate={onUpdate} />}
    </div>
  );
}

// ---------- new session ----------

function Stepper({ label, value, onChange, min, max, step }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-sm" style={{ color: T.textDim }}>{label}</div>
      <div className="flex items-center gap-3">
        <button onClick={() => onChange(Math.max(min, value - step))} className="w-9 h-9 rounded-full text-lg font-bold" style={{ background: T.surfaceAlt }}>−</button>
        <div className="w-10 text-center font-bold" style={numeralStyle}>{value}</div>
        <button onClick={() => onChange(Math.min(max, value + step))} className="w-9 h-9 rounded-full text-lg font-bold" style={{ background: T.surfaceAlt }}>+</button>
      </div>
    </div>
  );
}

const NEW_SESSION_STEPS = ['type', 'round', 'bow', 'details'];
const NEW_SESSION_TITLES = { type: 'Che tipo di sessione?', round: 'Che prova?', bow: 'Con che arco?', details: 'Ultimi dettagli' };

// Short one-line summary shown under a round's name in the picker.
function roundSummary(r) {
  if (r.editable) return 'Scegli distanza, bersaglio, frecce e volée — puoi aggiungere più tappe';
  if (r.stages.length > 1) return `${r.stages.length} tappe · ${r.stages.map(s => s.distanceM).join('/')} m`;
  const s = r.stages[0];
  return `${s.distanceM} m · ${s.faceCm} cm · ${s.arrowsPerEnd}×${s.ends} frecce`;
}

function NewSessionScreen({ onCreate, onCancel }) {
  const customDef = ROUND_TYPES.find(r => r.id === 'custom');
  const [step, setStep] = useState('type');
  const [sessionType, setSessionType] = useState('allenamento');
  const [selectedId, setSelectedId] = useState(null);
  const [bowType, setBowType] = useState(null);
  // Editable rounds keep a local list of stages (starts as a copy of the
  // preset's own stages — one, for "Personalizzata" — and can grow via
  // "+ Aggiungi tappa" for a multi-distance round like WA1440).
  const [free, setFree] = useState(() => customDef.stages.map(s => ({ ...s })));
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');

  const selected = ROUND_TYPES.find(r => r.id === selectedId);
  const effective = selected && selected.editable ? { ...selected, stages: free } : selected;

  function goBack() {
    const idx = NEW_SESSION_STEPS.indexOf(step);
    if (idx <= 0) onCancel();
    else setStep(NEW_SESSION_STEPS[idx - 1]);
  }

  function chooseType(id) {
    setSessionType(id);
    // Gara sociale rounds are usually made up on the spot, so land directly
    // on the custom distance/face picker instead of the fixed presets.
    if (id === 'sociale') setSelectedId('custom');
    setStep('round');
  }

  function chooseRound(id) {
    setSelectedId(id);
    const r = ROUND_TYPES.find(x => x.id === id);
    if (!r.editable) setStep('bow');
    // editable (custom) rounds stay on this step so the steppers are visible;
    // advancing happens via the explicit "Continua" button below.
  }

  function chooseBow(id) {
    setBowType(id);
    setStep('details');
  }

  function handleStart() {
    onCreate(createSession(effective, { location, note, bowType, sessionType }));
  }

  return (
    <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={goBack} className="p-2 -ml-2 rounded-full"><ChevronLeft /></button>
        <div className="text-xl font-bold">{NEW_SESSION_TITLES[step]}</div>
      </div>

      <div className="flex gap-1.5">
        {NEW_SESSION_STEPS.map(s => (
          <div key={s} className="h-1 flex-1 rounded-full"
            style={{ background: NEW_SESSION_STEPS.indexOf(s) <= NEW_SESSION_STEPS.indexOf(step) ? T.gold : T.border }} />
        ))}
      </div>

      {step === 'type' && (
        <div className="flex flex-col gap-2">
          {SESSION_TYPES.map(t => (
            <button key={t.id} onClick={() => chooseType(t.id)}
              className="text-left rounded-2xl px-4 py-4 flex items-center justify-between"
              style={{ background: t.id === sessionType ? T.surfaceAlt : T.surface, border: `1px solid ${t.id === sessionType ? T.gold : T.border}` }}>
              <div>
                <div className="font-semibold text-lg">{t.label}</div>
                <div className="text-xs" style={{ color: T.textDim }}>{t.hint}</div>
              </div>
              <ChevronRight color={T.textDim} />
            </button>
          ))}
        </div>
      )}

      {step === 'round' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {ROUND_GROUPS.map(g => (
              <div key={g.category} className="flex flex-col gap-2">
                <div className="text-xs uppercase tracking-wide" style={{ color: T.textFaint }}>{g.category}</div>
                {g.rounds.map(r => (
                  <button key={r.id} onClick={() => chooseRound(r.id)}
                    className="text-left rounded-2xl px-4 py-3 flex items-center justify-between"
                    style={{ background: r.id === selectedId ? T.surfaceAlt : T.surface, border: `1px solid ${r.id === selectedId ? T.gold : T.border}` }}>
                    <div>
                      <div className="font-semibold">{r.label}</div>
                      <div className="text-xs" style={{ color: T.textDim }}>{roundSummary(r)}</div>
                    </div>
                    {r.id === selectedId && <Check color={T.gold} size={20} />}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {selected && selected.editable && (
            <>
              <div className="flex flex-col gap-3">
                {free.map((st, i) => (
                  <div key={i} className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                    {free.length > 1 && (
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.textFaint }}>Tappa {i + 1}</div>
                        <button onClick={() => setFree(f => f.filter((_, j) => j !== i))} className="p-1.5 rounded-full" style={{ color: T.textDim }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                    <Stepper label="Distanza (m)" value={st.distanceM} onChange={v => setFree(f => f.map((s2, j) => (j === i ? { ...s2, distanceM: v } : s2)))} min={5} max={100} step={5} />
                    <Stepper label="Diametro bersaglio (cm)" value={st.faceCm} onChange={v => setFree(f => f.map((s2, j) => (j === i ? { ...s2, faceCm: v } : s2)))} min={20} max={122} step={10} />
                    <Stepper label="Frecce a volée" value={st.arrowsPerEnd} onChange={v => setFree(f => f.map((s2, j) => (j === i ? { ...s2, arrowsPerEnd: v } : s2)))} min={1} max={6} step={1} />
                    <Stepper label="Numero di volée" value={st.ends} onChange={v => setFree(f => f.map((s2, j) => (j === i ? { ...s2, ends: v } : s2)))} min={1} max={40} step={1} />
                  </div>
                ))}
                <button onClick={() => setFree(f => [...f, { ...f[f.length - 1] }])}
                  className="rounded-xl py-2.5 text-sm font-semibold" style={{ background: T.surfaceAlt, border: `1px dashed ${T.border}`, color: T.textDim }}>
                  + Aggiungi tappa
                </button>
              </div>
              <button onClick={() => setStep('bow')} className="rounded-2xl py-3.5 font-bold" style={{ background: T.gold, color: GOLD_TEXT }}>
                Continua
              </button>
            </>
          )}
        </div>
      )}

      {step === 'bow' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {BOW_TYPES.map(b => (
              <button key={b.id} onClick={() => chooseBow(b.id)}
                className="text-left rounded-2xl px-4 py-4 flex items-center justify-between"
                style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                <div className="font-semibold text-lg">{b.label}</div>
                <ChevronRight color={T.textDim} />
              </button>
            ))}
          </div>
          <button onClick={() => setStep('details')} className="text-sm py-2" style={{ color: T.textDim }}>
            Non specificato
          </button>
        </div>
      )}

      {step === 'details' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Luogo (opzionale)"
              className="rounded-xl px-3 py-2.5" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note (opzionale): vento, materiale, sensazioni..."
              className="rounded-xl px-3 py-2.5 resize-none" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
          </div>
          <button onClick={handleStart} className="rounded-2xl py-4 font-bold text-lg flex items-center justify-center gap-2" style={{ background: T.gold, color: GOLD_TEXT }}>
            <Play size={20} /> Inizia volée
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- history / analysis ----------

// Accepts the same JSON shape produced by exportJson ({ sessions: [...] })
// or a bare array of sessions. Imported sessions overwrite existing ones
// with the same id (so re-importing an updated file is safe) and are
// otherwise added.
function ImportButton({ onImport }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('');

  function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sessions) ? parsed.sessions : null;
        if (!list || !list.length) throw new Error('empty');
        onImport(list);
        setStatus(`Importate ${list.length} sessioni`);
      } catch (err) {
        console.error('Errore import', err);
        setStatus('File non valido');
      } finally {
        setTimeout(() => setStatus(''), 4000);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="relative">
      <input ref={inputRef} type="file" accept="application/json" className="hidden" onChange={handleFile} />
      <button onClick={() => inputRef.current?.click()} className="p-2 rounded-full" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <Upload size={18} />
      </button>
      {status && (
        <div className="absolute right-0 top-full mt-1 whitespace-nowrap text-xs px-2 py-1 rounded-lg z-10"
          style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.textDim }}>
          {status}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }) {
  return (
    <button onClick={onClick} className="whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium"
      style={{ background: active ? T.gold : T.surface, color: active ? GOLD_TEXT : T.textDim, border: `1px solid ${active ? T.gold : T.border}` }}>
      {label}
    </button>
  );
}

function ChartCard({ title, children, tall = false }) {
  return (
    <div className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="text-sm font-semibold" style={{ color: T.textDim }}>{title}</div>
      <div className={tall ? 'h-48' : 'h-40'}>{children}</div>
    </div>
  );
}

function EmptyChart({ text }) {
  return <div className="h-full flex items-center justify-center text-sm text-center px-4" style={{ color: T.textFaint }}>{text}</div>;
}

function SessionRow({ session, onOpen, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  const isDone = session.status === 'completed';
  return (
    <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <button onClick={onOpen} className="flex-1 text-left flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <div className="font-semibold truncate flex items-center gap-2">
            <span className="truncate">{session.roundLabel}</span>
            <SessionTypeBadge sessionType={session.sessionType} />
            {!isDone && <span className="text-xs font-normal shrink-0" style={{ color: T.gold }}>in corso</span>}
          </div>
          <div className="text-xs truncate" style={{ color: T.textDim }}>
            {formatDateFull(session.startedAt)}
            {bowLabel(session.bowType) ? ` · ${bowLabel(session.bowType)}` : ''}
            {session.location ? ` · ${session.location}` : ''}{session.note ? ` · ${session.note}` : ''}
          </div>
        </div>
        <div className="text-lg font-bold shrink-0" style={numeralStyle}>
          {isDone ? sessionTotalScore(session) : sessionProgressBadge(session)}
        </div>
      </button>
      <button onClick={() => (confirming ? onDelete() : setConfirming(true))} className="p-2 rounded-full shrink-0"
        style={{ background: confirming ? T.red : 'transparent', color: confirming ? '#fff' : T.textFaint }}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

// Compact "3/6" progress badge, prefixed with the stage number for
// multi-stage sessions ("2.3/6").
function sessionProgressBadge(session) {
  const idx = activeStageIndex(session);
  const stage = session.stages[idx];
  const frac = `${currentEndIndex(stage) + 1}/${stage.round.ends}`;
  return session.stages.length > 1 ? `${idx + 1}.${frac}` : frac;
}

function StoricoScreen({ sessions, onOpen, onResume, onDelete, onImport, onSignOut }) {
  const [filterId, setFilterId] = useState('all'); // 'all' or a round-shape key from roundShapeKey()
  const [typeFilter, setTypeFilter] = useState('all');
  const [bowFilter, setBowFilter] = useState('all');
  const [conditionDim, setConditionDim] = useState('wind');

  // Type/bow are session-level filters; round is a STAGE-shape filter — a
  // multi-stage session can have some stages match and others not, so it
  // can't be filtered at the session level. Round-filter chips are built
  // from every distinct shape actually shot (not the static preset list),
  // since custom/multi-stage rounds aren't enumerable in advance.
  const typeAndBowFiltered = sessions.filter(s =>
    (typeFilter === 'all' || (s.sessionType || 'allenamento') === typeFilter) &&
    (bowFilter === 'all' || s.bowType === bowFilter));

  const stageShapes = useMemo(() => {
    const map = new Map();
    stageEntries(sessions).forEach(e => {
      const key = roundShapeKey(e.round);
      if (!map.has(key)) map.set(key, { key, round: e.round });
    });
    return Array.from(map.values()).sort((a, b) => b.round.distanceM - a.round.distanceM || b.round.faceCm - a.round.faceCm);
  }, [sessions]);

  const allEntries = useMemo(() => stageEntries(typeAndBowFiltered), [typeAndBowFiltered]);
  const activeShape = filterId === 'all' ? null : stageShapes.find(s => s.key === filterId)?.round;
  const matchingEntries = filterId === 'all' ? [] : allEntries.filter(e => roundShapeKey(e.round) === filterId);
  const completed = matchingEntries.filter(e => e.status === 'completed');

  const trend = useMemo(() =>
    completed.slice().sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
      .map(e => ({ label: formatDateShort(e.completedAt), score: totalScore(e) })),
    [completed]);

  const pb = completed.length ? completed.reduce((b, e) => (totalScore(e) > totalScore(b) ? e : b)) : null;
  const avgScore = completed.length ? completed.reduce((s, e) => s + totalScore(e), 0) / completed.length : null;

  const fatigue = useMemo(() => (filterId === 'all' ? [] : fatigueCurve(completed)), [completed, filterId]);

  const allArrows = useMemo(() => completed.flatMap(e => flattenArrows(e)), [completed]);
  const cumGroup = useMemo(() => (activeShape ? computeGroupStats(allArrows, activeShape.faceCm) : null), [allArrows, activeShape]);

  const dispersion = useMemo(() => (filterId === 'all' ? [] : dispersionTrend(completed)), [completed, filterId]);
  const distribution = useMemo(() => (filterId === 'all' ? [] : scoreDistribution(completed)), [completed, filterId]);
  const byCondition = useMemo(() => (filterId === 'all' ? [] : scoreByCondition(completed, conditionDim)), [completed, filterId, conditionDim]);
  const deepAnalysisReady = filterId !== 'all' && completed.length >= MIN_SESSIONS_FOR_DEEP_ANALYSIS;

  return (
    <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="text-xl font-bold">Storico</div>
        <div className="flex items-center gap-2">
          <ImportButton onImport={onImport} />
          <button onClick={() => exportJson(sessions)} className="p-2 rounded-full" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <Download size={18} />
          </button>
          <button onClick={onSignOut} className="p-2 rounded-full" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <FilterChip active={filterId === 'all'} onClick={() => setFilterId('all')} label="Tutte le prove" />
          {stageShapes.map(s => <FilterChip key={s.key} active={filterId === s.key} onClick={() => setFilterId(s.key)} label={roundShapeLabel(s.round)} />)}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} label="Tutti i tipi" />
          {SESSION_TYPES.map(t => <FilterChip key={t.id} active={typeFilter === t.id} onClick={() => setTypeFilter(t.id)} label={t.label} />)}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <FilterChip active={bowFilter === 'all'} onClick={() => setBowFilter('all')} label="Tutti gli archi" />
          {BOW_TYPES.map(b => <FilterChip key={b.id} active={bowFilter === b.id} onClick={() => setBowFilter(b.id)} label={b.label} />)}
        </div>
      </div>

      {filterId === 'all' ? (
        <div className="text-sm" style={{ color: T.textDim }}>{typeAndBowFiltered.length} sessioni. Seleziona una prova per le statistiche dettagliate.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Sessioni" value={completed.length} />
            <StatTile label="Media" value={avgScore != null ? avgScore.toFixed(1) : '—'} />
            <StatTile label="Primato" value={pb ? totalScore(pb) : '—'} />
          </div>

          <ChartCard title="Andamento punteggio">
            {trend.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={32} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }} />
                  <Line type="monotone" dataKey="score" stroke={T.gold} strokeWidth={2} dot={{ r: 3, fill: T.gold }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Servono almeno 2 sessioni completate" />}
          </ChartCard>

          <ChartCard title="Media per volée (curva di fatica)">
            {fatigue.filter(f => f.avg != null).length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fatigue}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="end" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 10]} />
                  <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                    formatter={(v) => [Number(v).toFixed(2), 'media']} labelFormatter={(l) => `Volée ${l}`} />
                  <Bar dataKey="avg" fill={T.blue} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Dati insufficienti" />}
          </ChartCard>

          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold" style={{ color: T.textDim }}>Gruppo cumulativo</div>
            <TargetFace faceCm={activeShape.faceCm} points={allArrows.filter(a => a.x != null)} centroid={cumGroup} dense />
            {cumGroup ? (
              <div className="text-sm" style={{ color: T.textDim }}>
                Deviazione orizzontale: {Math.abs(cumGroup.cxCm).toFixed(1)} cm {cumGroup.cxCm >= 0 ? 'a destra' : 'a sinistra'} ·
                {' '}Deviazione verticale: {Math.abs(cumGroup.cyCm).toFixed(1)} cm {cumGroup.cyCm >= 0 ? 'in basso' : 'in alto'} · {cumGroup.count} frecce
              </div>
            ) : <div className="text-sm" style={{ color: T.textDim }}>Nessuna freccia con posizione registrata (modalità tastierino).</div>}
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold" style={{ color: T.textDim }}>Analisi avanzata</div>
            {!deepAnalysisReady ? (
              <div className="rounded-2xl p-4 text-sm" style={{ background: T.surface, border: `1px dashed ${T.border}`, color: T.textDim }}>
                Servono almeno {MIN_SESSIONS_FOR_DEEP_ANALYSIS} sessioni completate per questa combinazione di prova, tipo e arco
                {' '}(ne hai {completed.length}). Continua a registrare i tuoi allenamenti e le tue gare.
              </div>
            ) : (
              <>
                <ChartCard title="Dispersione media nel tempo (cm)">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dispersion}>
                      <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                      <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 'auto']} />
                      <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                        formatter={(v) => [`${Number(v).toFixed(1)} cm`, 'dispersione']} />
                      <Line type="monotone" dataKey="dispersion" stroke={T.blue} strokeWidth={2} dot={{ r: 3, fill: T.blue }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Deriva orizzontale e verticale (cm)" tall>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dispersion}>
                      <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                      <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                        formatter={(v, name) => [`${Number(v).toFixed(1)} cm`, name === 'biasX' ? 'orizzontale' : 'verticale']} />
                      <Legend formatter={(value) => (value === 'biasX' ? 'Orizzontale' : 'Verticale')} wrapperStyle={{ fontSize: 11, color: T.textDim }} />
                      <Line type="monotone" dataKey="biasX" stroke={T.gold} strokeWidth={2} dot={{ r: 2, fill: T.gold }} />
                      <Line type="monotone" dataKey="biasY" stroke={T.red} strokeWidth={2} dot={{ r: 2, fill: T.red }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Distribuzione dei punteggi">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={distribution}>
                      <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="key" stroke={T.textDim} tick={{ fontSize: 11 }} />
                      <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }} />
                      <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                        {distribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <div className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                  <div className="text-sm font-semibold" style={{ color: T.textDim }}>Media per condizioni</div>
                  <div className="overflow-x-auto pb-1">
                    <SegmentedControl options={CONDITION_DIMENSIONS} value={conditionDim} onChange={setConditionDim} small />
                  </div>
                  <div className="h-40">
                    {byCondition.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={byCondition}>
                          <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="key" stroke={T.textDim} tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={40} />
                          <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 10]} />
                          <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                            formatter={(v, name, item) => [`${Number(v).toFixed(2)} (${item.payload.count} sessioni)`, 'media']} />
                          <Bar dataKey="avg" fill={T.blue} radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <EmptyChart text="Nessuna condizione registrata per queste sessioni ancora" />}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold" style={{ color: T.textDim }}>Sessioni</div>
        {filterId === 'all' ? (
          <>
            {typeAndBowFiltered.length === 0 && <div className="text-sm" style={{ color: T.textDim }}>Nessuna sessione.</div>}
            {typeAndBowFiltered.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).map(s => (
              <SessionRow key={s.id} session={s} onOpen={() => (s.status === 'completed' ? onOpen(s.id) : onResume(s.id))} onDelete={() => onDelete(s.id)} />
            ))}
          </>
        ) : (
          <>
            {matchingEntries.length === 0 && <div className="text-sm" style={{ color: T.textDim }}>Nessuna sessione.</div>}
            {matchingEntries.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).map((e, i) => (
              <StageEntryRow key={`${e.sessionId}-${e.stageIndex}`} entry={e} onOpen={() => (e.status === 'completed' ? onOpen(e.sessionId) : onResume(e.sessionId))} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// Groups distinct stage shapes into a stable key for the round filter — a
// custom/multi-stage round's shape isn't a fixed preset id, so the filter
// list is built from what's actually been shot.
function roundShapeKey(round) { return `${round.distanceM}|${round.faceCm}|${round.arrowsPerEnd}|${round.ends}`; }

function roundShapeLabel(round) {
  const preset = ROUND_TYPES.find(r => r.stages.length === 1 && sameRound(r.stages[0], round));
  if (preset) return preset.label;
  return `${round.distanceM}m · ${round.faceCm}cm`;
}

// A row for one stage-entry — used when Storico is filtered to a specific
// round shape, so a WA1440's 70m stage shows up (and scores) on its own,
// separate from the session's grand total.
function StageEntryRow({ entry, onOpen }) {
  const isDone = entry.status === 'completed';
  return (
    <button onClick={onOpen} className="w-full text-left rounded-2xl px-4 py-3 flex items-center justify-between gap-2" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="min-w-0">
        <div className="font-semibold truncate flex items-center gap-2">
          <span className="truncate">{entry.round.distanceM}m · {entry.round.faceCm}cm</span>
          <SessionTypeBadge sessionType={entry.sessionType} />
          {!isDone && <span className="text-xs font-normal shrink-0" style={{ color: T.gold }}>in corso</span>}
          {entry.stageCount > 1 && <span className="text-xs font-normal shrink-0" style={{ color: T.textFaint }}>Tappa {entry.stageIndex + 1}/{entry.stageCount}</span>}
        </div>
        <div className="text-xs truncate" style={{ color: T.textDim }}>
          {formatDateFull(entry.startedAt)}{bowLabel(entry.bowType) ? ` · ${bowLabel(entry.bowType)}` : ''}
        </div>
      </div>
      <div className="text-lg font-bold shrink-0" style={numeralStyle}>
        {isDone ? totalScore(entry) : `${currentEndIndex(entry) + 1}/${entry.round.ends}`}
      </div>
    </button>
  );
}

// ---------- statistiche ----------

const RING_GROUP_LABELS = { gold: 'Oro', red: 'Rosso', blue: 'Blu', black: 'Nero', white: 'Bianco', miss: 'Errore' };
const RING_GROUP_ORDER = ['gold', 'red', 'blue', 'black', 'white', 'miss'];

// Percentage of every arrow ever shot landing in each ring-colour group —
// derived straight from score via ringGroupForScore, so it works for
// keypad-entered arrows too (no x/y position needed).
function hitRateByColor(entries) {
  const counts = {};
  RING_GROUP_ORDER.forEach(k => (counts[k] = 0));
  let total = 0;
  entries.forEach(e => flattenArrows(e).forEach(a => {
    counts[ringGroupForScore(a.score)] += 1;
    total += 1;
  }));
  return RING_GROUP_ORDER.map(key => ({
    key: RING_GROUP_LABELS[key],
    count: counts[key],
    pct: total ? (counts[key] / total) * 100 : 0,
    color: SCORE_COLORS[key].fill,
  }));
}

// One row per distinct round shape ever shot: personal best, average, and
// how many times — the cumulative counterpart to Storico's per-round PB tile.
function bestByShape(entries) {
  const map = new Map();
  entries.forEach(e => {
    const key = roundShapeKey(e.round);
    if (!map.has(key)) map.set(key, { round: e.round, entries: [] });
    map.get(key).entries.push(e);
  });
  return Array.from(map.values())
    .map(({ round, entries: es }) => ({
      round,
      count: es.length,
      best: Math.max(...es.map(totalScore)),
      avg: es.reduce((s, e) => s + totalScore(e), 0) / es.length,
    }))
    .sort((a, b) => b.round.distanceM - a.round.distanceM || b.round.faceCm - a.round.faceCm);
}

function StatisticheScreen({ sessions }) {
  const completedSessions = useMemo(() => sessions.filter(s => s.status === 'completed'), [sessions]);
  const entries = useMemo(() => stageEntries(completedSessions), [completedSessions]);

  const totalArrows = entries.reduce((s, e) => s + arrowsShotCount(e), 0);
  const totalScoreSum = entries.reduce((s, e) => s + totalScore(e), 0);
  const avgPerArrow = totalArrows ? totalScoreSum / totalArrows : 0;
  const totalX = entries.reduce((s, e) => s + xCount(e), 0);

  const colorData = useMemo(() => hitRateByColor(entries), [entries]);
  const shapeRows = useMemo(() => bestByShape(entries), [entries]);

  const trend = useMemo(() =>
    completedSessions.slice()
      .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
      .map(s => {
        const arrows = sessionArrowsShot(s);
        return arrows ? { label: formatDateShort(s.completedAt), avg: sessionTotalScore(s) / arrows } : null;
      })
      .filter(Boolean),
    [completedSessions]);

  const typeCounts = useMemo(() => {
    const counts = {};
    SESSION_TYPES.forEach(t => (counts[t.id] = 0));
    completedSessions.forEach(s => { counts[s.sessionType || 'allenamento'] += 1; });
    return counts;
  }, [completedSessions]);

  if (!completedSessions.length) {
    return (
      <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
        <div className="text-xl font-bold">Statistiche</div>
        <div className="rounded-2xl p-4 text-sm" style={{ background: T.surface, border: `1px dashed ${T.border}`, color: T.textDim }}>
          Completa qualche sessione per iniziare a vedere le tue statistiche cumulative.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-5">
      <div className="text-xl font-bold">Statistiche</div>

      <div className="grid grid-cols-4 gap-2">
        <StatTile label="Sessioni" value={completedSessions.length} />
        <StatTile label="Frecce" value={totalArrows} />
        <StatTile label="Media/freccia" value={avgPerArrow.toFixed(2)} />
        <StatTile label="X totali" value={totalX} />
      </div>

      <ChartCard title="Frecce per colore">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={colorData}>
            <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="key" stroke={T.textDim} tick={{ fontSize: 11 }} />
            <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={32} unit="%" />
            <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
              formatter={(v, name, item) => [`${item.payload.count} frecce (${Number(v).toFixed(1)}%)`, 'frecce']} />
            <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
              {colorData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Andamento generale (media a freccia)">
        {trend.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend}>
              <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
              <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 10]} />
              <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                formatter={(v) => [Number(v).toFixed(2), 'media a freccia']} />
              <Line type="monotone" dataKey="avg" stroke={T.gold} strokeWidth={2} dot={{ r: 3, fill: T.gold }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <EmptyChart text="Servono almeno 2 sessioni completate" />}
      </ChartCard>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold" style={{ color: T.textDim }}>Primati per distanza</div>
        <div className="flex flex-col gap-2">
          {shapeRows.map(row => (
            <div key={roundShapeKey(row.round)} className="rounded-2xl px-4 py-3 flex items-center justify-between gap-2" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <div className="min-w-0">
                <div className="font-semibold truncate">{roundShapeLabel(row.round)}</div>
                <div className="text-xs" style={{ color: T.textDim }}>media {row.avg.toFixed(1)} · {row.count} sessioni</div>
              </div>
              <div className="text-lg font-bold shrink-0" style={numeralStyle}>{row.best}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold" style={{ color: T.textDim }}>Sessioni per tipo</div>
        <div className="grid grid-cols-3 gap-2">
          {SESSION_TYPES.map(t => <StatTile key={t.id} label={t.label} value={typeCounts[t.id]} />)}
        </div>
      </div>
    </div>
  );
}

// ---------- session detail ----------

function DeleteSessionButton({ onDelete, label = 'Elimina sessione' }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button onClick={() => (confirming ? onDelete() : setConfirming(true))}
      className="rounded-2xl py-3 font-semibold flex items-center justify-center gap-2"
      style={{ background: confirming ? T.red : T.surface, color: confirming ? '#fff' : T.textDim, border: `1px solid ${confirming ? T.red : T.border}` }}>
      <Trash2 size={16} /> {confirming ? 'Conferma eliminazione' : label}
    </button>
  );
}

function StageEnds({ stage }) {
  return (
    <div className="flex flex-col gap-2">
      {stage.ends.map((e, i) => e.arrows.length > 0 && (
        <div key={i} className="flex items-center gap-2">
          <div className="w-6 text-sm shrink-0" style={{ color: T.textFaint, ...numeralStyle }}>{i + 1}</div>
          <div className="flex flex-wrap gap-1.5">
            {[...e.arrows].sort((a, b) => scoreRank(b) - scoreRank(a)).map((a, j) => <ArrowChipSmall key={j} arrow={a} />)}
          </div>
          <div className="ml-auto text-sm font-semibold" style={numeralStyle}>{e.arrows.reduce((s, a) => s + a.score, 0)}</div>
        </div>
      ))}
    </div>
  );
}

function DetailScreen({ session, sessions, onBack, onUpdate, onDelete }) {
  const multiStage = session.stages.length > 1;
  const insight = useMemo(() => sessionInsight(session, sessions), [session, sessions]);
  return (
    <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full"><ChevronLeft /></button>
        <div className="text-xl font-bold flex items-center gap-2">
          {session.roundLabel}
          <SessionTypeBadge sessionType={session.sessionType} />
        </div>
      </div>

      <div className="text-sm" style={{ color: T.textDim }}>
        {formatDateFull(session.startedAt)}
        {bowLabel(session.bowType) ? ` · ${bowLabel(session.bowType)}` : ''}
        {session.location ? ` · ${session.location}` : ''}
      </div>

      <div className="text-center py-2">
        <div className="text-5xl font-bold" style={numeralStyle}>{sessionTotalScore(session)}</div>
        <div className="text-sm" style={{ color: T.textDim }}>
          media {(sessionTotalScore(session) / sessionArrowsShot(session)).toFixed(2)} · {sessionXCount(session)} X
        </div>
      </div>

      <InsightCard sentences={insight} />

      {!multiStage ? (
        <>
          <TargetFace faceCm={session.stages[0].round.faceCm} points={flattenArrows(session.stages[0]).filter(a => a.x != null)} />
          <SessionMetaEditor session={session} onUpdate={onUpdate} />
          <ConditionsEditor session={session} onUpdate={onUpdate} />
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold" style={{ color: T.textDim }}>Volée</div>
            <StageEnds stage={session.stages[0]} />
          </div>
        </>
      ) : (
        <>
          <SessionMetaEditor session={session} onUpdate={onUpdate} />
          <ConditionsEditor session={session} onUpdate={onUpdate} />
          {session.stages.map((stage, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <div className="flex items-center justify-between">
                <div className="font-semibold">Tappa {i + 1} · {stage.round.distanceM}m · {stage.round.faceCm}cm</div>
                <div className="text-lg font-bold" style={numeralStyle}>{totalScore(stage)}</div>
              </div>
              <TargetFace faceCm={stage.round.faceCm} points={flattenArrows(stage).filter(a => a.x != null)} />
              <StageEnds stage={stage} />
            </div>
          ))}
        </>
      )}

      <DeleteSessionButton onDelete={onDelete} />
    </div>
  );
}

// ---------- home ----------

function HomeScreen({ sessions, onNew, onResume, legacyData, onImportLegacy, onDismissLegacy }) {
  const suspended = sessions.filter(s => s.status === 'in_progress').sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const completedCount = sessions.filter(s => s.status === 'completed').length;

  return (
    <div className="px-4 pt-6 pb-4 flex flex-col gap-6 max-w-md sm:max-w-xl lg:max-w-3xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="rounded-2xl p-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <Target size={28} color={T.gold} />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: T.textDim }}>Arcieri Senesi</div>
          <div className="text-2xl font-bold">Scorecard</div>
        </div>
        <button onClick={() => window.location.reload()} className="ml-auto p-2 rounded-full active:scale-95 transition-transform"
          style={{ background: T.surface, border: `1px solid ${T.border}` }} title="Ricarica l'app per aggiornamenti">
          <RefreshCw size={18} color={T.textDim} />
        </button>
      </header>

      {legacyData && (
        <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: T.surfaceAlt, border: `1px dashed ${T.gold}` }}>
          <div className="font-semibold" style={{ color: T.gold }}>Dati locali trovati</div>
          <div className="text-sm" style={{ color: T.textDim }}>
            {legacyData.length} sessioni salvate su questo dispositivo prima dell'accesso. Importarle nel tuo account?
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onImportLegacy} className="flex-1 rounded-xl py-2 text-sm font-bold" style={{ background: T.gold, color: GOLD_TEXT }}>
              Importa
            </button>
            <button onClick={onDismissLegacy} className="flex-1 rounded-xl py-2 text-sm font-semibold" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.textDim }}>
              Ignora
            </button>
          </div>
        </div>
      )}

      {suspended.map(s => (
        <button key={s.id} onClick={() => onResume(s.id)}
          className="text-left rounded-2xl p-4 flex items-center justify-between"
          style={{ background: T.surfaceAlt, border: `1px solid ${T.borderStrong}` }}>
          <div>
            <div className="text-sm" style={{ color: T.textDim }}>Sessione in corso</div>
            <div className="text-lg font-semibold flex items-center gap-2">
              {s.roundLabel}
              <SessionTypeBadge sessionType={s.sessionType} />
            </div>
            <div className="text-sm" style={{ color: T.textDim }}>
              {sessionProgressLabel(s)}{bowLabel(s.bowType) ? ` · ${bowLabel(s.bowType)}` : ''}
            </div>
          </div>
          <ChevronRight color={T.textDim} />
        </button>
      ))}

      <button onClick={onNew} className="rounded-2xl py-5 flex items-center justify-center gap-2 text-lg font-bold"
        style={{ background: T.gold, color: GOLD_TEXT }}>
        <Plus /> Nuova sessione
      </button>

      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Sessioni completate" value={completedCount} />
        <StatTile label="Prove disponibili" value={ROUND_TYPES.length} />
      </div>
    </div>
  );
}

// ---------- bottom nav ----------

function NavButton({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className="flex-1 flex flex-col items-center gap-1 py-2.5">
      <Icon size={20} color={active ? T.gold : T.textFaint} />
      <span className="text-xs font-medium" style={{ color: active ? T.gold : T.textFaint }}>{label}</span>
    </button>
  );
}

function BottomNav({ view, setView }) {
  return (
    <div className="sticky bottom-0 z-10" style={{ background: T.bgElevated, borderTop: `1px solid ${T.border}` }}>
      {/* Bar background stays full-bleed; the tappable row aligns to the
          same centered column as the screen content above it, so icons
          don't spread across the full width on a wide viewport. */}
      <div className="flex max-w-md sm:max-w-xl lg:max-w-3xl mx-auto">
        <NavButton icon={Target} label="Home" active={view === 'home'} onClick={() => setView('home')} />
        <NavButton icon={Clock} label="Storico" active={view === 'storico'} onClick={() => setView('storico')} />
        <NavButton icon={BarChart3} label="Statistiche" active={view === 'statistiche'} onClick={() => setView('statistiche')} />
        <NavButton icon={Swords} label="Tornei" active={view === 'tornei'} onClick={() => setView('tornei')} />
      </div>
    </div>
  );
}

// ==========================================================================
// Tournament manager
// ==========================================================================
//
// A tournament is single-elimination with WA-style set play. Individual and
// team matches both reduce to the same shape — play a sequence of "units"
// (sets for individual, ends for team), award 2 set-points to the higher
// side each unit (1-1 if tied), first to the target set-points wins; if
// still tied after every unit is played, it goes to a shoot-off. That lets
// one match engine drive both formats instead of two.
//
// WA/FITARCO assumptions (verify locally, same spirit as ROUND_TYPES above):
//  - Individual: best of 5 sets, 3 arrows/set, 2 SP to the set winner (1-1
//    tied), first to 6 SP wins, shoot-off at 5-5.
//  - Team (3 archers/side) and Mixed Team (2 archers/side): 4 ends, each
//    archer shoots 2 arrows/end, 2 SP to the higher end total (1-1 tied),
//    first to 5 SP wins, shoot-off if still tied after 4 ends. Individual
//    archers' arrows are recorded as one combined list per end/side rather
//    than attributed to a specific team member — a deliberate simplification.
//  - Compound elimination is technically cumulative-score, not set play,
//    under WA rules; the "custom" match format below covers that too by
//    setting arrowsPerUnit to the full match and units to 1.

const MATCH_FORMATS = [
  { id: 'individual', label: 'Individuale', archersPerSide: 1, arrowsPerArcherPerUnit: 3, units: 5, setPointsToWin: 6, unitLabel: 'Set' },
  { id: 'mixedTeam', label: 'Team misto', archersPerSide: 2, arrowsPerArcherPerUnit: 2, units: 4, setPointsToWin: 5, unitLabel: 'Volée' },
  { id: 'team', label: 'A squadre', archersPerSide: 3, arrowsPerArcherPerUnit: 2, units: 4, setPointsToWin: 5, unitLabel: 'Volée' },
];

function matchFormatDef(id) { return MATCH_FORMATS.find(f => f.id === id) || MATCH_FORMATS[0]; }
function arrowsPerUnit(formatDef) { return formatDef.archersPerSide * formatDef.arrowsPerArcherPerUnit; }

// The four real WA target face sizes — same values ROUND_TYPES already
// uses — rather than a stepper that lands on non-standard diameters.
const FACE_SIZE_OPTIONS = [40, 60, 80, 122].map(cm => ({ id: cm, label: `${cm}` }));

// ---------- bracket seeding ----------

// Classic recursive tournament seeding order: for size 8 this returns
// [1,8,4,5,2,7,3,6] — i.e. round-1 pairs are 1v8, 4v5, 2v7, 3v6, and the
// top 2 seeds are kept in opposite halves so they can only meet in the
// final. Standard practice for any single-elimination bracket.
function standardSeedOrder(size) {
  if (size <= 1) return [1];
  if (size === 2) return [1, 2];
  const half = standardSeedOrder(size / 2);
  const out = [];
  half.forEach(s => { out.push(s); out.push(size + 1 - s); });
  return out;
}

// participants: array of { id, name, seedScore, ... } already sorted best
// seed first (highest seedScore first). Returns { size, rounds } where
// rounds[0] is the first round (byes already resolved into empty slotB) and
// later rounds start with null slots, filled in as earlier rounds complete.
function buildBracket(participants) {
  const n = participants.length;
  const size = n <= 1 ? 1 : Math.pow(2, Math.ceil(Math.log2(n)));
  const order = standardSeedOrder(size);
  const bySeedPos = order.map(seedNum => participants[seedNum - 1] || null);

  const round0 = [];
  for (let i = 0; i < size / 2; i++) {
    const slotA = bySeedPos[i * 2];
    const slotB = bySeedPos[i * 2 + 1];
    round0.push(makeMatch(0, i, slotA, slotB));
  }

  const rounds = [round0];
  let count = size / 2;
  while (count > 1) {
    count = count / 2;
    const roundIdx = rounds.length;
    rounds.push(Array.from({ length: count }, (_, i) => makeMatch(roundIdx, i, null, null)));
  }

  // Byes resolve immediately and propagate into round 1.
  rounds[0].forEach((m, i) => { if (m.status === 'bye') propagateWinner(rounds, 0, i, m.winnerSlot); });

  return { size, rounds };
}

function makeMatch(roundIdx, matchIdx, slotA, slotB) {
  const bye = !!(slotA && !slotB) || !!(!slotA && slotB);
  return {
    roundIdx, matchIdx,
    slotA: slotA || null, slotB: slotB || null,
    status: bye ? 'bye' : (slotA && slotB) ? 'pending' : 'waiting', // 'waiting' = future round, not yet fed
    winnerSlot: bye ? (slotA ? 'A' : 'B') : null,
    units: [],
    cumSpA: 0, cumSpB: 0,
    shootOff: null,
  };
}

// Pushes a completed match's winner into the correct slot of the next
// round, and re-derives that match's status/bye handling.
function propagateWinner(rounds, roundIdx, matchIdx, winnerSlot) {
  const nextRound = rounds[roundIdx + 1];
  if (!nextRound) return; // final already played
  const match = rounds[roundIdx][matchIdx];
  const winner = winnerSlot === 'A' ? match.slotA : match.slotB;
  const nextMatchIdx = Math.floor(matchIdx / 2);
  const nextSlotKey = matchIdx % 2 === 0 ? 'slotA' : 'slotB';
  const next = nextRound[nextMatchIdx];
  next[nextSlotKey] = winner;
  if (next.slotA && next.slotB) {
    next.status = 'pending';
  } else if (next.slotA || next.slotB) {
    // The other slot is still waiting on an earlier match — leave as
    // 'waiting' until it's filled too (byes only ever happen in round 0,
    // since a real bracket never produces a lone empty slot past that).
  }
}

// ---------- match engine ----------

function sumArrows(scores) { return scores.reduce((s, v) => s + v, 0); }

// Records one unit's (set/end) arrows for one side. Once both sides have
// this unit recorded, set-points are awarded and the match's cumulative
// state + status are recomputed.
function recordUnit(match, formatDef, unitIndex, side, arrows) {
  const units = match.units.slice();
  let unit = units[unitIndex] || { index: unitIndex, arrowsA: null, arrowsB: null, totalA: null, totalB: null, spA: null, spB: null };
  unit = { ...unit, [side === 'A' ? 'arrowsA' : 'arrowsB']: arrows, [side === 'A' ? 'totalA' : 'totalB']: sumArrows(arrows) };
  units[unitIndex] = unit;

  let cumSpA = 0, cumSpB = 0;
  units.forEach(u => {
    if (u.totalA == null || u.totalB == null) return;
    if (u.totalA > u.totalB) { u.spA = 2; u.spB = 0; }
    else if (u.totalB > u.totalA) { u.spA = 0; u.spB = 2; }
    else { u.spA = 1; u.spB = 1; }
    cumSpA += u.spA;
    cumSpB += u.spB;
  });

  const decided = cumSpA >= formatDef.setPointsToWin || cumSpB >= formatDef.setPointsToWin;
  const unitsPlayed = units.filter(u => u.totalA != null && u.totalB != null).length;
  const exhausted = unitsPlayed >= formatDef.units;
  const tied = cumSpA === cumSpB;

  let status = match.status;
  let winnerSlot = match.winnerSlot;
  if (decided) {
    status = 'completed';
    winnerSlot = cumSpA > cumSpB ? 'A' : 'B';
  } else if (exhausted && tied) {
    status = 'shootoff';
  } else {
    status = 'in_progress';
  }

  return { ...match, units, cumSpA, cumSpB, status, winnerSlot };
}

function recordShootOff(match, winnerSlot, arrowsA, arrowsB) {
  return {
    ...match,
    status: 'completed',
    winnerSlot,
    shootOff: { arrowsA: arrowsA || null, arrowsB: arrowsB || null, winner: winnerSlot },
  };
}

function currentUnitIndex(match) {
  const idx = match.units.findIndex(u => !u || u.totalA == null || u.totalB == null);
  return idx === -1 ? match.units.length : idx;
}

function sideLabel(slot) { return slot ? slot.name : '—'; }

function roundName(totalRounds, idx) {
  const fromEnd = totalRounds - 1 - idx;
  if (fromEnd === 0) return 'Finale';
  if (fromEnd === 1) return 'Semifinale';
  if (fromEnd === 2) return 'Quarti di finale';
  if (fromEnd === 3) return 'Ottavi di finale';
  return `Turno ${idx + 1}`;
}

function uidT() { return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

function createTournament({ name, date, distanceM, faceCm, formatId, participants }) {
  const sorted = participants.slice().sort((a, b) => b.seedScore - a.seedScore);
  const seeded = sorted.map((p, i) => ({ ...p, seed: i + 1 }));
  const { size, rounds } = buildBracket(seeded);
  return {
    id: uidT(),
    name, date, distanceM, faceCm, formatId,
    participants: seeded,
    bracketSize: size,
    rounds,
    createdAt: new Date().toISOString(),
  };
}

// Applies a completed match's result back into the tournament's bracket —
// records the score/shoot-off on the match itself and, if it wasn't the
// final, advances the winner into next round's slot.
function applyMatchResult(tournament, roundIdx, matchIdx, updatedMatch) {
  const rounds = tournament.rounds.map(r => r.slice());
  rounds[roundIdx][matchIdx] = updatedMatch;
  if (updatedMatch.status === 'completed') propagateWinner(rounds, roundIdx, matchIdx, updatedMatch.winnerSlot);
  return { ...tournament, rounds };
}

function tournamentIsComplete(tournament) {
  const last = tournament.rounds[tournament.rounds.length - 1];
  return last.length === 1 && last[0].status === 'completed';
}

// ---------- tournament: create / setup ----------

// Parses one participant per line — "Name Score", "Name, Score",
// "Name - Score", "Name: Score", tabs, whatever — by taking the trailing
// number on the line as the seed score and everything before it as the
// name. Lines that don't end in a recognizable number are skipped (and
// reported) rather than guessed at.
// Accepts either order — "Name Score" or "Score Name" — since people paste
// scoreboards both ways (a ranked list is often "280 Alessio", one per
// line). Tries name-then-score first, falls back to score-then-name.
function parseParticipantList(text) {
  const ok = [];
  const bad = [];
  const nameFirst = /^(.*?)[\s,;:|\t-]+(\d+(?:[.,]\d+)?)\s*$/;
  const scoreFirst = /^(\d+(?:[.,]\d+)?)[\s,;:|\t-]+(.*)$/;
  const clean = s => s.trim().replace(/^[-,;:|]+|[-,;:|]+$/g, '').trim();
  text.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
    let name = '', score = NaN;
    const m1 = line.match(nameFirst);
    if (m1) { name = clean(m1[1]); score = Number(m1[2].replace(',', '.')); }
    else {
      const m2 = line.match(scoreFirst);
      if (m2) { score = Number(m2[1].replace(',', '.')); name = clean(m2[2]); }
    }
    if (name && !Number.isNaN(score)) ok.push({ id: uidT(), name, seedScore: score });
    else bad.push(line);
  });
  return { ok, bad };
}

function BulkParticipantInput({ isTeam, setParticipants }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');

  function importList() {
    const { ok, bad } = parseParticipantList(text);
    if (ok.length) setParticipants(list => [...list, ...ok]);
    setStatus(bad.length
      ? `Aggiunti ${ok.length} · non riconosciute ${bad.length}: ${bad.slice(0, 3).join(' / ')}${bad.length > 3 ? '…' : ''}`
      : `Aggiunti ${ok.length}.`);
    setText('');
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm py-1 self-start" style={{ color: T.gold }}>
        Incolla un elenco invece di aggiungere uno a uno →
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: T.surfaceAlt, border: `1px dashed ${T.border}` }}>
      <div className="text-xs" style={{ color: T.textDim }}>
        Una riga per {isTeam ? 'squadra' : 'arciere'}: nome e punteggio, in qualsiasi ordine di separazione
        ("Anna Rossi 600", "Bruno, 590"...).
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={5} placeholder={'Anna Rossi 600\nBruno Bianchi 590\nCarla Neri 580'}
        className="rounded-lg px-3 py-2 text-sm resize-none" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
      <div className="flex gap-2">
        <button onClick={importList} disabled={!text.trim()} className="flex-1 rounded-lg py-2 text-sm font-bold disabled:opacity-40" style={{ background: T.gold, color: GOLD_TEXT }}>
          Importa elenco
        </button>
        <button onClick={() => { setOpen(false); setStatus(''); }} className="rounded-lg px-3 py-2 text-sm" style={{ color: T.textDim }}>
          Chiudi
        </button>
      </div>
      {status && <div className="text-xs" style={{ color: T.textDim }}>{status}</div>}
    </div>
  );
}

function ParticipantEditor({ formatId, participants, setParticipants }) {
  const [name, setName] = useState('');
  const [score, setScore] = useState('');
  const isTeam = formatId !== 'individual';

  function add() {
    if (!name.trim()) return;
    const seedScore = Number(score) || 0;
    setParticipants(list => [...list, { id: uidT(), name: name.trim(), seedScore }]);
    setName(''); setScore('');
  }

  function remove(id) {
    setParticipants(list => list.filter(p => p.id !== id));
  }

  const sorted = participants.slice().sort((a, b) => b.seedScore - a.seedScore);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder={isTeam ? 'Nome squadra' : 'Nome arciere'}
          className="flex-1 rounded-xl px-3 py-2.5" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        <input value={score} onChange={e => setScore(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Punteggio" inputMode="numeric"
          className="w-24 rounded-xl px-3 py-2.5" style={{ ...numeralStyle, background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        <button onClick={add} disabled={!name.trim()} className="w-11 h-11 rounded-xl flex items-center justify-center disabled:opacity-40" style={{ background: T.gold, color: GOLD_TEXT }}>
          <UserPlus size={18} />
        </button>
      </div>
      <BulkParticipantInput isTeam={isTeam} setParticipants={setParticipants} />
      {sorted.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {sorted.map((p, i) => (
            <div key={p.id} className="rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <div className="w-6 text-xs shrink-0" style={{ color: T.textFaint, ...numeralStyle }}>{i + 1}</div>
              <div className="flex-1 truncate font-medium">{p.name}</div>
              <div className="text-sm shrink-0" style={{ ...numeralStyle, color: T.textDim }}>{p.seedScore}</div>
              <button onClick={() => remove(p.id)} className="p-1 rounded-full shrink-0" style={{ color: T.textFaint }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {sorted.length < 2 && <div className="text-xs" style={{ color: T.textDim }}>Servono almeno 2 {isTeam ? 'squadre' : 'arcieri'} per creare il tabellone.</div>}
    </div>
  );
}

function TournamentCreateScreen({ onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formatId, setFormatId] = useState('individual');
  const [distanceM, setDistanceM] = useState(70);
  const [faceCm, setFaceCm] = useState(122);
  const [participants, setParticipants] = useState([]);

  const canCreate = name.trim() && participants.length >= 2;

  return (
    <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="p-2 -ml-2 rounded-full"><ChevronLeft /></button>
        <div className="text-xl font-bold">Nuovo torneo</div>
      </div>

      <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome del torneo"
        className="rounded-xl px-3 py-2.5" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
      <input type="date" value={date} onChange={e => setDate(e.target.value)}
        className="rounded-xl px-3 py-2.5" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text, colorScheme: 'dark' }} />

      <div className="flex flex-col gap-2">
        <div className="text-xs" style={{ color: T.textDim }}>Formato match</div>
        <div className="flex flex-col gap-2">
          {MATCH_FORMATS.map(f => (
            <button key={f.id} onClick={() => setFormatId(f.id)}
              className="text-left rounded-2xl px-4 py-3 flex items-center justify-between"
              style={{ background: f.id === formatId ? T.surfaceAlt : T.surface, border: `1px solid ${f.id === formatId ? T.gold : T.border}` }}>
              <div>
                <div className="font-semibold">{f.label}</div>
                <div className="text-xs" style={{ color: T.textDim }}>
                  {f.archersPerSide > 1 ? `${f.archersPerSide} arcieri/squadra · ` : ''}
                  {f.units} {f.unitLabel.toLowerCase()}{f.units > 1 ? 'i' : ''} · {f.arrowsPerArcherPerUnit} frecce a testa · primo a {f.setPointsToWin} PS
                </div>
              </div>
              {f.id === formatId && <Check color={T.gold} size={20} />}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <Stepper label="Distanza (m)" value={distanceM} onChange={setDistanceM} min={10} max={90} step={5} />
        <div className="flex items-center justify-between">
          <div className="text-sm" style={{ color: T.textDim }}>Diametro bersaglio (cm)</div>
          <SegmentedControl options={FACE_SIZE_OPTIONS} value={faceCm} onChange={setFaceCm} small />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs" style={{ color: T.textDim }}>Partecipanti (ordinati per punteggio di qualifica)</div>
        <ParticipantEditor formatId={formatId} participants={participants} setParticipants={setParticipants} />
      </div>

      <button onClick={() => canCreate && onCreate(createTournament({ name: name.trim(), date, distanceM, faceCm, formatId, participants }))}
        disabled={!canCreate} className="rounded-2xl py-4 font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-40"
        style={{ background: T.gold, color: GOLD_TEXT }}>
        <Shuffle size={20} /> Genera tabellone
      </button>
    </div>
  );
}

// ---------- tournament: bracket + match ----------

function MatchCard({ match, onOpen }) {
  const playable = match.status === 'pending' || match.status === 'in_progress' || match.status === 'shootoff';
  const statusLabel = match.status === 'bye' ? 'Bye' : match.status === 'waiting' ? 'In attesa' :
    match.status === 'completed' ? 'Conclusa' : match.status === 'shootoff' ? 'Spareggio' : 'Da giocare';
  return (
    <button onClick={() => playable && onOpen()} disabled={!playable}
      className="w-full text-left rounded-2xl px-4 py-3 flex flex-col gap-2"
      style={{ background: T.surface, border: `1px solid ${playable ? T.gold : T.border}`, opacity: match.status === 'waiting' ? 0.6 : 1 }}>
      <div className="flex items-center justify-between text-xs" style={{ color: T.textDim }}>
        <span>{statusLabel}</span>
        {(match.status === 'completed' || match.status === 'in_progress' || match.status === 'shootoff') && (
          <span style={numeralStyle}>{match.cumSpA} - {match.cumSpB}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className={`truncate ${match.winnerSlot === 'A' ? 'font-bold' : ''}`} style={{ color: match.winnerSlot === 'B' ? T.textDim : T.text }}>
          {match.slotA ? `${match.slotA.seed}. ${match.slotA.name}` : '—'}
        </div>
        {match.winnerSlot === 'A' && <Check size={16} color={T.gold} />}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className={`truncate ${match.winnerSlot === 'B' ? 'font-bold' : ''}`} style={{ color: match.winnerSlot === 'A' ? T.textDim : T.text }}>
          {match.slotB ? `${match.slotB.seed}. ${match.slotB.name}` : '—'}
        </div>
        {match.winnerSlot === 'B' && <Check size={16} color={T.gold} />}
      </div>
    </button>
  );
}

// ---------- bracket tree view ----------
//
// A classic horizontal bracket (columns of matches, connector lines routing
// each pair of winners into their next-round match) rather than the
// vertical round-by-round list — useful when you want the shape of the
// draw at a glance instead of scrolling through rounds. Positions are
// computed with the standard doubling-spacing algorithm: each round's
// matches are centered on the midpoint of the two matches feeding into
// them, so the whole tree stays visually balanced regardless of bracket
// size. Horizontally scrollable since a bracket wider than 2 rounds won't
// fit a phone screen.

const BRACKET_CARD_W = 176;
const BRACKET_CARD_H = 64;
const BRACKET_ROW_GAP = 16;
const BRACKET_COL_GAP = 40;
const BRACKET_UNIT = BRACKET_CARD_H + BRACKET_ROW_GAP;
const BRACKET_Y_OFFSET = 28; // room for the round-name label above round 0

function computeBracketLayout(rounds) {
  const n0 = rounds[0].length;
  const centers = [];
  centers[0] = Array.from({ length: n0 }, (_, i) => i * BRACKET_UNIT + BRACKET_UNIT / 2);
  for (let r = 1; r < rounds.length; r++) {
    centers[r] = rounds[r].map((_, i) => (centers[r - 1][2 * i] + centers[r - 1][2 * i + 1]) / 2);
  }
  return { centers, totalHeight: n0 * BRACKET_UNIT };
}

function CompactMatchCard({ match, x, y, onOpen }) {
  const playable = match.status === 'pending' || match.status === 'in_progress' || match.status === 'shootoff';
  const scored = match.status === 'completed' || match.status === 'in_progress' || match.status === 'shootoff';
  return (
    <button onClick={() => playable && onOpen()} disabled={!playable}
      className="absolute rounded-xl px-2.5 py-1.5 flex flex-col justify-center gap-0.5 text-left"
      style={{ left: x, top: y, width: BRACKET_CARD_W, height: BRACKET_CARD_H,
        background: T.surface, border: `1px solid ${playable ? T.gold : T.border}`, opacity: match.status === 'waiting' ? 0.55 : 1 }}>
      <div className={`text-xs truncate ${match.winnerSlot === 'A' ? 'font-bold' : ''}`} style={{ color: match.winnerSlot === 'B' ? T.textDim : T.text }}>
        {match.slotA ? `${match.slotA.seed}. ${match.slotA.name}` : '—'}
      </div>
      <div className={`text-xs truncate ${match.winnerSlot === 'B' ? 'font-bold' : ''}`} style={{ color: match.winnerSlot === 'A' ? T.textDim : T.text }}>
        {match.slotB ? `${match.slotB.seed}. ${match.slotB.name}` : '—'}
      </div>
      {scored && <div className="text-[10px]" style={{ color: T.textFaint, ...numeralStyle }}>{match.cumSpA} - {match.cumSpB}</div>}
    </button>
  );
}

function BracketTree({ tournament, onOpenMatch }) {
  const { rounds } = tournament;
  const { centers, totalHeight } = useMemo(() => computeBracketLayout(rounds), [rounds]);
  const colWidth = BRACKET_CARD_W + BRACKET_COL_GAP;
  const totalWidth = rounds.length * colWidth - BRACKET_COL_GAP;

  return (
    <div className="overflow-auto -mx-4 px-4 pb-2" style={{ maxHeight: '70vh' }}>
      <div className="relative" style={{ width: totalWidth, height: totalHeight + BRACKET_Y_OFFSET }}>
        <svg className="absolute inset-0" width={totalWidth} height={totalHeight + BRACKET_Y_OFFSET} style={{ pointerEvents: 'none' }}>
          {rounds.slice(0, -1).map((_, r) => {
            const x1 = r * colWidth + BRACKET_CARD_W;
            const xMid = x1 + BRACKET_COL_GAP / 2;
            const x2 = (r + 1) * colWidth;
            return rounds[r + 1].map((_, i) => {
              const yTop = centers[r][2 * i] + BRACKET_Y_OFFSET;
              const yBottom = centers[r][2 * i + 1] + BRACKET_Y_OFFSET;
              const yParent = centers[r + 1][i] + BRACKET_Y_OFFSET;
              return (
                <g key={`${r}-${i}`} stroke={T.borderStrong} strokeWidth={1.5}>
                  <line x1={x1} y1={yTop} x2={xMid} y2={yTop} />
                  <line x1={x1} y1={yBottom} x2={xMid} y2={yBottom} />
                  <line x1={xMid} y1={yTop} x2={xMid} y2={yBottom} />
                  <line x1={xMid} y1={yParent} x2={x2} y2={yParent} />
                </g>
              );
            });
          })}
        </svg>
        {rounds.map((round, r) => (
          <React.Fragment key={r}>
            <div className="absolute text-xs font-semibold truncate" style={{ left: r * colWidth, top: 0, width: BRACKET_CARD_W, color: T.textDim }}>
              {roundName(rounds.length, r)}
            </div>
            {round.map((m, i) => (
              <CompactMatchCard key={i} match={m} x={r * colWidth} y={centers[r][i] - BRACKET_CARD_H / 2 + BRACKET_Y_OFFSET} onOpen={() => onOpenMatch(r, i)} />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function BracketScreen({ tournament, onBack, onOpenMatch, onDelete }) {
  const [viewMode, setViewMode] = useState('list');
  const complete = tournamentIsComplete(tournament);
  const champion = complete ? (tournament.rounds[tournament.rounds.length - 1][0].winnerSlot === 'A'
    ? tournament.rounds[tournament.rounds.length - 1][0].slotA
    : tournament.rounds[tournament.rounds.length - 1][0].slotB) : null;

  return (
    <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full"><ChevronLeft /></button>
        <div className="text-xl font-bold flex-1 truncate">{tournament.name}</div>
      </div>
      <div className="text-sm" style={{ color: T.textDim }}>
        {formatDateShort(tournament.date)} · {matchFormatDef(tournament.formatId).label} · {tournament.distanceM}m/{tournament.faceCm}cm
      </div>

      {champion && (
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: T.surfaceAlt, border: `1px solid ${T.gold}` }}>
          <Trophy color={T.gold} size={28} />
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: T.gold }}>Campione</div>
            <div className="text-lg font-bold">{champion.name}</div>
          </div>
        </div>
      )}

      <SegmentedControl options={[{ id: 'list', label: 'Elenco' }, { id: 'bracket', label: 'Tabellone' }]} value={viewMode} onChange={setViewMode} />

      {viewMode === 'bracket' ? (
        <BracketTree tournament={tournament} onOpenMatch={onOpenMatch} />
      ) : (
        tournament.rounds.map((round, ri) => (
          <div key={ri} className="flex flex-col gap-2">
            <div className="text-sm font-semibold" style={{ color: T.textDim }}>{roundName(tournament.rounds.length, ri)}</div>
            <div className="flex flex-col gap-2">
              {round.map((m, mi) => <MatchCard key={mi} match={m} onOpen={() => onOpenMatch(ri, mi)} />)}
            </div>
          </div>
        ))
      )}

      <DeleteSessionButton onDelete={onDelete} label="Elimina torneo" />
    </div>
  );
}

function ArrowsInputColumn({ label, needed, pending, onAdd, onUndo, disabled }) {
  return (
    <div className="flex-1 flex flex-col gap-2">
      <div className="text-sm font-semibold text-center">{label}</div>
      <div className="flex flex-wrap justify-center gap-1.5 min-h-[2.5rem]">
        {pending.map((a, i) => <ArrowChipSmall key={i} arrow={a} />)}
        {Array.from({ length: Math.max(0, needed - pending.length) }).map((_, i) => (
          <div key={`ph-${i}`} className="w-8 h-8 rounded-full" style={{ border: `2px dashed ${T.border}` }} />
        ))}
      </div>
      <div className="text-center text-xs" style={{ color: T.textDim }}>{sumArrows(pending.map(a => a.score))} punti</div>
      <button onClick={onUndo} disabled={disabled || pending.length === 0} className="text-xs py-1 rounded-full disabled:opacity-30" style={{ color: T.textDim }}>
        Annulla ultima
      </button>
    </div>
  );
}

function MatchScreen({ tournament, roundIdx, matchIdx, onBack, onComplete }) {
  const match = tournament.rounds[roundIdx][matchIdx];
  const formatDef = matchFormatDef(tournament.formatId);
  const needed = arrowsPerUnit(formatDef);
  const unitIdx = currentUnitIndex(match);

  const [pendingA, setPendingA] = useState([]);
  const [pendingB, setPendingB] = useState([]);
  const [activeSide, setActiveSide] = useState('A');
  const [shootA, setShootA] = useState([]);
  const [shootB, setShootB] = useState([]);

  function addArrow(side, score, isX) {
    const setPending = side === 'A' ? setPendingA : setPendingB;
    setPending(list => {
      if (list.length >= needed) return list;
      const next = [...list, { score, isX }];
      // Auto-advance to the other side once this one's full, so the scorer
      // doesn't have to remember to switch the toggle between sets.
      if (next.length === needed) setActiveSide(side === 'A' ? 'B' : 'A');
      return next;
    });
  }
  function undoArrow(side) {
    const setPending = side === 'A' ? setPendingA : setPendingB;
    setPending(list => list.slice(0, -1));
  }

  function submitUnit() {
    let m = recordUnit(match, formatDef, unitIdx, 'A', pendingA.map(a => a.score));
    m = recordUnit(m, formatDef, unitIdx, 'B', pendingB.map(a => a.score));
    setPendingA([]); setPendingB([]); setActiveSide('A');
    onComplete(roundIdx, matchIdx, m);
  }

  function submitShootOff(winnerSlot) {
    const m = recordShootOff(match, winnerSlot, shootA.map(a => a.score), shootB.map(a => a.score));
    onComplete(roundIdx, matchIdx, m);
  }

  if (match.status === 'completed') {
    return (
      <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4 items-center text-center">
        <div className="flex items-center gap-2 self-start">
          <button onClick={onBack} className="p-2 -ml-2 rounded-full"><ChevronLeft /></button>
          <div className="text-xl font-bold">{roundName(tournament.rounds.length, roundIdx)}</div>
        </div>
        <Trophy color={T.gold} size={32} />
        <div className="text-2xl font-bold">{match.winnerSlot === 'A' ? sideLabel(match.slotA) : sideLabel(match.slotB)}</div>
        <div className="text-sm" style={{ color: T.textDim }}>vince {match.cumSpA} - {match.cumSpB}</div>
        <button onClick={onBack} className="w-full rounded-2xl py-3.5 font-bold" style={{ background: T.gold, color: GOLD_TEXT }}>Torna al tabellone</button>
      </div>
    );
  }

  return (
    <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full"><ChevronLeft /></button>
        <div className="text-xl font-bold">{roundName(tournament.rounds.length, roundIdx)}</div>
      </div>

      <div className="rounded-2xl p-4 flex items-center justify-around" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="text-center">
          <div className="font-semibold truncate max-w-[9rem]">{sideLabel(match.slotA)}</div>
          <div className="text-3xl font-bold" style={numeralStyle}>{match.cumSpA}</div>
        </div>
        <div className="text-sm" style={{ color: T.textFaint }}>PS</div>
        <div className="text-center">
          <div className="font-semibold truncate max-w-[9rem]">{sideLabel(match.slotB)}</div>
          <div className="text-3xl font-bold" style={numeralStyle}>{match.cumSpB}</div>
        </div>
      </div>

      {match.status === 'shootoff' ? (
        <div className="flex flex-col gap-4">
          <div className="text-center text-sm font-semibold" style={{ color: T.gold }}>Spareggio — chi ha piazzato la freccia più vicina al centro?</div>
          <div className="flex gap-3">
            <ArrowsInputColumn label={sideLabel(match.slotA)} needed={formatDef.archersPerSide} pending={shootA}
              onAdd={(s, x) => setShootA(l => [...l, { score: s, isX: x }])} onUndo={() => setShootA(l => l.slice(0, -1))} />
            <ArrowsInputColumn label={sideLabel(match.slotB)} needed={formatDef.archersPerSide} pending={shootB}
              onAdd={(s, x) => setShootB(l => [...l, { score: s, isX: x }])} onUndo={() => setShootB(l => l.slice(0, -1))} />
          </div>
          <SegmentedControl options={[{ id: 'A', label: sideLabel(match.slotA) }, { id: 'B', label: sideLabel(match.slotB) }]} value={activeSide} onChange={setActiveSide} />
          <Keypad onScore={(score, isX) => (activeSide === 'A' ? setShootA(l => [...l, { score, isX }]) : setShootB(l => [...l, { score, isX }]))} />
          <div className="flex gap-2">
            <button onClick={() => submitShootOff('A')} className="flex-1 rounded-2xl py-3.5 font-bold" style={{ background: T.gold, color: GOLD_TEXT }}>
              Vince {sideLabel(match.slotA)}
            </button>
            <button onClick={() => submitShootOff('B')} className="flex-1 rounded-2xl py-3.5 font-bold" style={{ background: T.gold, color: GOLD_TEXT }}>
              Vince {sideLabel(match.slotB)}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="text-center text-sm" style={{ color: T.textDim }}>
            {formatDef.unitLabel} {unitIdx + 1} di {formatDef.units}
          </div>
          <div className="flex gap-3">
            <ArrowsInputColumn label={sideLabel(match.slotA)} needed={needed} pending={pendingA} onUndo={() => undoArrow('A')} />
            <ArrowsInputColumn label={sideLabel(match.slotB)} needed={needed} pending={pendingB} onUndo={() => undoArrow('B')} />
          </div>
          <SegmentedControl options={[{ id: 'A', label: sideLabel(match.slotA) }, { id: 'B', label: sideLabel(match.slotB) }]} value={activeSide} onChange={setActiveSide} />
          <Keypad onScore={(score, isX) => addArrow(activeSide, score, isX)} />
          <button onClick={submitUnit} disabled={pendingA.length < needed || pendingB.length < needed}
            className="rounded-2xl py-3.5 font-bold disabled:opacity-40" style={{ background: T.gold, color: GOLD_TEXT }}>
            Conferma {formatDef.unitLabel.toLowerCase()}
          </button>
        </>
      )}
    </div>
  );
}

function TournamentRow({ tournament, onOpen, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  const complete = tournamentIsComplete(tournament);
  return (
    <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <button onClick={onOpen} className="flex-1 text-left min-w-0">
        <div className="font-semibold truncate flex items-center gap-2">
          <span className="truncate">{tournament.name}</span>
          {complete && <Trophy size={14} color={T.gold} />}
        </div>
        <div className="text-xs truncate" style={{ color: T.textDim }}>
          {formatDateShort(tournament.date)} · {matchFormatDef(tournament.formatId).label} · {tournament.participants.length} partecipanti
        </div>
      </button>
      <button onClick={() => (confirming ? onDelete() : setConfirming(true))} className="p-2 rounded-full shrink-0"
        style={{ background: confirming ? T.red : 'transparent', color: confirming ? '#fff' : T.textFaint }}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function TorneiScreen({ tournaments, onNew, onOpen, onDelete }) {
  return (
    <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto px-4 pt-6 pb-8 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-2xl font-bold">Tornei</div>
        <button onClick={onNew} className="p-2.5 rounded-full" style={{ background: T.gold, color: GOLD_TEXT }}><Plus size={20} /></button>
      </div>
      {tournaments.length === 0 ? (
        <div className="rounded-2xl p-4 text-sm" style={{ background: T.surface, border: `1px dashed ${T.border}`, color: T.textDim }}>
          Nessun torneo ancora. Crea un tabellone a eliminazione diretta e inizia a registrare i match dal vivo.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {tournaments.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(t => (
            <TournamentRow key={t.id} tournament={t} onOpen={() => onOpen(t.id)} onDelete={() => onDelete(t.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- root ----------

export default function ArcheryScorecard() {
  // undefined = auth still resolving, null = signed out, object = signed in
  const [authSession, setAuthSession] = useState(undefined);
  const [sessions, setSessions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('home');
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [detailSessionId, setDetailSessionId] = useState(null);
  const [legacyData, setLegacyData] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [activeTournamentId, setActiveTournamentId] = useState(null);
  const [activeMatchRef, setActiveMatchRef] = useState(null); // { roundIdx, matchIdx }
  const [saveError, setSaveError] = useState(null);

  const flagSaveError = useCallback((ok, message) => {
    if (!ok) setSaveError(message);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setAuthSession(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = authSession?.user?.id ?? null;

  useEffect(() => {
    if (!userId) { setSessions([]); setTournaments([]); setLoaded(false); return; }
    let mounted = true;
    loadSessionsRemote(userId).then(s => {
      if (!mounted) return;
      setSessions(s);
      setLoaded(true);
      if (s.length === 0) setLegacyData(findLegacyLocalSessions());
    });
    loadTournamentsRemote(userId).then(t => { if (mounted) setTournaments(t); });
    return () => { mounted = false; };
  }, [userId]);

  const updateSession = useCallback((id, updater) => {
    setSessions(prev => {
      const next = prev.map(s => (s.id === id ? updater(s) : s));
      const changed = next.find(s => s.id === id);
      if (changed && userId) upsertSessionRemote(userId, changed).then(ok => flagSaveError(ok, 'Impossibile salvare la sessione online: le modifiche resteranno solo su questo dispositivo finché non si risolve.'));
      return next;
    });
  }, [userId, flagSaveError]);

  const addSession = useCallback((session) => {
    setSessions(prev => [...prev, session]);
    if (userId) upsertSessionRemote(userId, session).then(ok => flagSaveError(ok, 'Impossibile salvare la sessione online: resterà solo su questo dispositivo finché non si risolve.'));
  }, [userId, flagSaveError]);

  const deleteSession = useCallback((id) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (userId) deleteSessionRemote(id).then(ok => flagSaveError(ok, 'Impossibile eliminare la sessione online.'));
  }, [userId, flagSaveError]);

  const importSessions = useCallback((imported) => {
    const normalized = imported.map(normalizeSession);
    setSessions(prev => {
      const byId = new Map(prev.map(s => [s.id, s]));
      normalized.forEach(s => byId.set(s.id, s));
      const next = Array.from(byId.values());
      if (userId) Promise.all(normalized.map(s => upsertSessionRemote(userId, s)))
        .then(results => flagSaveError(results.every(Boolean), 'Alcune sessioni importate non sono state salvate online: resteranno solo su questo dispositivo finché non si risolve.'));
      return next;
    });
  }, [userId, flagSaveError]);

  const importLegacyData = useCallback(() => {
    if (legacyData) importSessions(legacyData);
    markLegacyMigrationDone();
    setLegacyData(null);
  }, [legacyData, importSessions]);

  const dismissLegacyData = useCallback(() => {
    markLegacyMigrationDone();
    setLegacyData(null);
  }, []);

  const addTournament = useCallback((tournament) => {
    setTournaments(prev => [...prev, tournament]);
    if (userId) upsertTournamentRemote(userId, tournament).then(ok => flagSaveError(ok, 'Impossibile salvare il torneo online: resterà solo su questo dispositivo e andrà perso al ricaricamento. Controlla che la tabella "tournaments" esista su Supabase.'));
  }, [userId, flagSaveError]);

  const updateTournament = useCallback((id, updater) => {
    setTournaments(prev => {
      const next = prev.map(t => (t.id === id ? updater(t) : t));
      const changed = next.find(t => t.id === id);
      if (changed && userId) upsertTournamentRemote(userId, changed).then(ok => flagSaveError(ok, 'Impossibile salvare gli aggiornamenti del torneo online: andranno persi al ricaricamento. Controlla che la tabella "tournaments" esista su Supabase.'));
      return next;
    });
  }, [userId, flagSaveError]);

  const deleteTournament = useCallback((id) => {
    setTournaments(prev => prev.filter(t => t.id !== id));
    if (userId) deleteTournamentRemote(id).then(ok => flagSaveError(ok, 'Impossibile eliminare il torneo online.'));
  }, [userId, flagSaveError]);

  if (authSession === undefined) return <LoadingScreen />;
  if (authSession === null) return <AuthGate />;
  if (!loaded) return <LoadingScreen />;

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;
  const detailSession = sessions.find(s => s.id === detailSessionId) || null;
  const activeTournament = tournaments.find(t => t.id === activeTournamentId) || null;

  return (
    <div className="flex flex-col font-sans antialiased" style={{ background: T.bg, color: T.text, minHeight: '100vh' }}>
      {saveError && (
        <div className="fixed top-0 left-0 right-0 z-50 px-4 pt-3 flex justify-center pointer-events-none">
          <div className="w-full max-w-md sm:max-w-xl lg:max-w-3xl rounded-xl px-4 py-3 text-sm font-medium flex items-start gap-3 shadow-lg pointer-events-auto"
            style={{ background: T.red, color: '#fff' }}>
            <span className="flex-1">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="font-bold shrink-0" aria-label="Chiudi avviso">✕</button>
          </div>
        </div>
      )}
      <div className="flex-1">
        {view === 'home' && (
          <HomeScreen sessions={sessions}
            onNew={() => setView('new')}
            onResume={(id) => { setActiveSessionId(id); setView('shoot'); }}
            legacyData={legacyData} onImportLegacy={importLegacyData} onDismissLegacy={dismissLegacyData} />
        )}

        {view === 'new' && (
          <NewSessionScreen
            onCreate={(session) => { addSession(session); setActiveSessionId(session.id); setView('shoot'); }}
            onCancel={() => setView('home')} />
        )}

        {view === 'shoot' && activeSession && (
          <ShootingScreen key={activeSession.id} session={activeSession} sessions={sessions}
            onUpdate={(updater) => updateSession(activeSession.id, updater)}
            onExit={() => { setActiveSessionId(null); setView('home'); }} />
        )}

        {view === 'storico' && (
          <StoricoScreen sessions={sessions}
            onOpen={(id) => { setDetailSessionId(id); setView('detail'); }}
            onResume={(id) => { setActiveSessionId(id); setView('shoot'); }}
            onDelete={deleteSession}
            onImport={importSessions}
            onSignOut={() => supabase.auth.signOut()} />
        )}

        {view === 'detail' && detailSession && (
          <DetailScreen key={detailSession.id} session={detailSession} sessions={sessions}
            onBack={() => { setDetailSessionId(null); setView('storico'); }}
            onUpdate={(updater) => updateSession(detailSession.id, updater)}
            onDelete={() => { deleteSession(detailSession.id); setDetailSessionId(null); setView('storico'); }} />
        )}

        {view === 'statistiche' && <StatisticheScreen sessions={sessions} />}

        {view === 'tornei' && (
          <TorneiScreen tournaments={tournaments}
            onNew={() => setView('tornei-new')}
            onOpen={(id) => { setActiveTournamentId(id); setView('bracket'); }}
            onDelete={deleteTournament} />
        )}

        {view === 'tornei-new' && (
          <TournamentCreateScreen
            onCreate={(t) => { addTournament(t); setActiveTournamentId(t.id); setView('bracket'); }}
            onCancel={() => setView('tornei')} />
        )}

        {view === 'bracket' && activeTournament && (
          <BracketScreen tournament={activeTournament}
            onBack={() => { setActiveTournamentId(null); setView('tornei'); }}
            onOpenMatch={(roundIdx, matchIdx) => { setActiveMatchRef({ roundIdx, matchIdx }); setView('match'); }}
            onDelete={() => { deleteTournament(activeTournament.id); setActiveTournamentId(null); setView('tornei'); }} />
        )}

        {view === 'match' && activeTournament && activeMatchRef && (
          <MatchScreen tournament={activeTournament} roundIdx={activeMatchRef.roundIdx} matchIdx={activeMatchRef.matchIdx}
            onBack={() => { setActiveMatchRef(null); setView('bracket'); }}
            onComplete={(roundIdx, matchIdx, updatedMatch) => {
              updateTournament(activeTournament.id, t => applyMatchResult(t, roundIdx, matchIdx, updatedMatch));
            }} />
        )}
      </div>

      {view !== 'shoot' && view !== 'match' && <BottomNav view={view} setView={setView} />}
    </div>
  );
}
