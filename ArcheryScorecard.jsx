import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, ComposedChart, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ErrorBar,
} from 'recharts';
import {
  Target, Clock, ChevronLeft, ChevronRight, Plus, Trash2,
  Download, Upload, RotateCcw, Play, Check, StickyNote, LogOut, BarChart3,
  Swords, Trophy, Users, UserPlus, Shuffle, RefreshCw, Unlock, Pencil, Share2, Mail,
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
 *  - Tapping the target face scores the arrow as a POINT at the tap
 *    position (see scoreFromRadiusUnits). Real scoring gives a line-cutting
 *    arrow the higher ring, so a tapped arrow sitting on a boundary can
 *    score one lower than the same arrow would on paper. Enter the called
 *    score on the keypad when it matters; the face is for group shape.
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
// Indoor face variants beyond the plain single full-face: WA/FITARCO's
// triple vertical/triangular (recurve and compound — compound's 10-ring is
// half the diameter, see COMPOUND_TEN_SCALE) and the Vegas 3-Spot round.
// Every triple round is still 3 arrows/end (one per spot) — that's a real
// rule, not a stylistic choice, so it's baked into each entry below rather
// than left pickable. Vegas is only ever shot at 18m/40cm and is a shorter
// round (30 arrows, not 60), so it isn't just "indoor18 with a different
// spotLayout" — it gets its own entry with its own end count.
function indoorTripleVariants(distanceM, faceCm) {
  return [
    { id: `indoor${distanceM}TripleVerticaleR`, label: `Indoor ${distanceM}m — tripla verticale`, category: `Indoor ${distanceM}m`, editable: false,
      stages: [{ distanceM, faceCm, arrowsPerEnd: 3, ends: 20, spotLayout: 'vertical3', ringClass: 'spot6R' }] },
    { id: `indoor${distanceM}TripleTriangolareR`, label: `Indoor ${distanceM}m — tripla triangolare`, category: `Indoor ${distanceM}m`, editable: false,
      stages: [{ distanceM, faceCm, arrowsPerEnd: 3, ends: 20, spotLayout: 'triangular3', ringClass: 'spot6R' }] },
    { id: `indoor${distanceM}TripleVerticaleC`, label: `Indoor ${distanceM}m — tripla verticale (compound)`, category: `Indoor ${distanceM}m`, editable: false,
      stages: [{ distanceM, faceCm, arrowsPerEnd: 3, ends: 20, spotLayout: 'vertical3', ringClass: 'spot6C' }] },
    { id: `indoor${distanceM}TripleTriangolareC`, label: `Indoor ${distanceM}m — tripla triangolare (compound)`, category: `Indoor ${distanceM}m`, editable: false,
      stages: [{ distanceM, faceCm, arrowsPerEnd: 3, ends: 20, spotLayout: 'triangular3', ringClass: 'spot6C' }] },
    { id: `indoor${distanceM}SingoloC`, label: `Indoor ${distanceM}m — singolo (compound)`, category: `Indoor ${distanceM}m`, editable: false,
      stages: [{ distanceM, faceCm, arrowsPerEnd: 3, ends: 20, spotLayout: 'single', ringClass: 'indoor6C' }] },
  ];
}

const ROUND_TYPES = [
  { id: 'indoor18', label: 'Indoor 18m', category: 'Indoor 18m', editable: false,
    stages: [{ distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 20 }] },
  ...indoorTripleVariants(18, 40),
  { id: 'vegas3spot', label: 'Vegas 3 punti', category: 'Indoor 18m', editable: false,
    stages: [{ distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 10, spotLayout: 'triangular3', ringClass: 'spot6R' }] },

  { id: 'indoor25', label: 'Indoor 25m', category: 'Indoor 25m', editable: false,
    stages: [{ distanceM: 25, faceCm: 60, arrowsPerEnd: 3, ends: 20 }] },
  ...indoorTripleVariants(25, 60),

  { id: 'targa90', label: 'Targa 90m', category: 'Targa 122cm', editable: false,
    stages: [{ distanceM: 90, faceCm: 122, arrowsPerEnd: 6, ends: 12 }] },
  { id: 'targa70', label: 'Targa 70m', category: 'Targa 122cm', editable: false,
    stages: [{ distanceM: 70, faceCm: 122, arrowsPerEnd: 6, ends: 12 }] },
  { id: 'targa60', label: 'Targa 60m', category: 'Targa 122cm', editable: false,
    stages: [{ distanceM: 60, faceCm: 122, arrowsPerEnd: 6, ends: 12 }] },

  // The 80cm face only ever prints rings 5-10 (see ringGeometry's
  // 'outdoor6' — a margin-cut face, not an isolated spot: the paper itself
  // is still 80cm, just blank beyond ring 5).
  { id: 'targa50', label: 'Targa 50m', category: 'Targa 80cm', editable: false,
    stages: [{ distanceM: 50, faceCm: 80, arrowsPerEnd: 6, ends: 12, ringClass: 'outdoor6' }] },
  { id: 'targa40', label: 'Targa 40m', category: 'Targa 80cm', editable: false,
    stages: [{ distanceM: 40, faceCm: 80, arrowsPerEnd: 6, ends: 12, ringClass: 'outdoor6' }] },
  { id: 'targa30', label: 'Targa 30m', category: 'Targa 80cm', editable: false,
    stages: [{ distanceM: 30, faceCm: 80, arrowsPerEnd: 6, ends: 12, ringClass: 'outdoor6' }] },

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

// How many completed sessions a round+arco+tipo combination needs before the
// "Analisi avanzata" block appears at all.
const MIN_SESSIONS_FOR_DEEP_ANALYSIS = 5;

// ...and how many a SINGLE condition bucket needs before it gets a bar of
// its own. These answer different questions and the first can't stand in for
// the second: at the 5-session minimum, spread across four wind levels,
// buckets of one are normal — and a one-session bar looks exactly as
// authoritative as a ten-session one. Sub-threshold buckets are withheld
// and counted, rather than charted with a caveat nobody reads.
const MIN_SESSIONS_PER_CONDITION = 3;

// How far back the per-session takeaway looks when working out "your usual
// average". A rolling window rather than all history — see sessionInsight.
const INSIGHT_BASELINE_SESSIONS = 10;

const T = {
  bg: '#14161A',
  bgElevated: '#1B1E24',
  surface: '#20242B',
  surfaceAlt: '#262B33',
  border: '#31363F',
  borderStrong: '#3C424C',
  text: '#F1EFE7',
  textDim: '#9BA0AA',
  // Lightened from #6B707A (same cool-gray hue, scaled ~1.3x) — the
  // original failed WCAG AA (3.64:1 on bg, 3.13:1 on surfaceAlt) despite
  // being used for real text (category labels, "Annulla" links, nav
  // labels), not just decorative borders/icons. This clears 4.5:1 against
  // every surface tone in the app (bg 5.79:1, surface 4.98:1, surfaceAlt
  // 4.55:1) while staying visually the faintest of the three text tiers.
  textFaint: '#8B929F',
  gold: '#E7B933',
  blue: '#3373B0',
  red: '#D8434A',
  ahead: '#5FBE7A',
  behind: '#E0A23C',
  onRed: '#FFFFFF',
  // Near-black outline for arrow-hit dots on TargetFace — deliberately
  // darker/more neutral than T.bg so it reads against any ring color
  // (gold/red/blue/black/white) the dot might land on.
  markStroke: '#0C0B08',
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

// Shared by every chart tooltip in the app. The width cap and the wrapping
// are load-bearing, not cosmetic: a recharts tooltip is absolutely
// positioned and its default item style is `nowrap`, so a wordy label
// ("1.51 mrad su 561 frecce") renders as one long unbreakable box. Recharts
// only nudges that box away from the cursor — it never shrinks it — so on a
// phone it runs past the chart, past the card, and past the viewport, and
// the whole PAGE gains a horizontal scroll. Capping the width and letting
// the text wrap keeps every tooltip inside its own card.
const TOOLTIP_STYLE = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  maxWidth: 200,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
};
const TOOLTIP_LABEL_STYLE = { color: T.text, whiteSpace: 'normal' };
const TOOLTIP_ITEM_STYLE = { whiteSpace: 'normal' };

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

// Undocumented keyboard mirror of the Keypad, for superuser mode — digits
// 1-9 as-is, 0 for a plain 10, x for an X, m for a miss. Deliberately not
// surfaced anywhere in the UI (see keyboardScoring prop on MatchScreen /
// ThreeWayFinalScreen): it's a shortcut for whoever already knows it's
// there, not a feature to advertise.
const KEY_SCORE_MAP = {
  '1': { score: 1, isX: false }, '2': { score: 2, isX: false }, '3': { score: 3, isX: false },
  '4': { score: 4, isX: false }, '5': { score: 5, isX: false }, '6': { score: 6, isX: false },
  '7': { score: 7, isX: false }, '8': { score: 8, isX: false }, '9': { score: 9, isX: false },
  '0': { score: 10, isX: false }, 'x': { score: 10, isX: true }, 'm': { score: 0, isX: false },
};
function keyToScore(key) { return KEY_SCORE_MAP[key.toLowerCase()] || null; }

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

// ---------- ring geometry ----------
//
// `ringClass` describes which rings a face actually has printed and how big
// its 10-ring is — independent of the face's physical size (`faceCm`) and
// of how many spots it has (`spotLayout`). Two genuinely different real
// shapes both reduce the ring count, and they're not the same construction:
//   - a "margin-cut" face ('outdoor6'/'indoor6C') is physically full-size
//     with its outer rings simply left unprinted — a tap out there is a
//     miss, but the target paper itself is the same size as a full face.
//   - an "isolated spot" face ('spot6R'/'spot6C') is a genuinely smaller
//     piece of paper — the WA/Vegas triple's 20cm spot *is* the inner half
//     (by radius) of a 40cm face, printed on its own with no blank margin
//     beyond ring 6, hence the ×2 rescale below.
// Compound's 10-ring is half the diameter of recurve's in every variant
// that has one, since compound's precision demands a tighter center even
// on an otherwise-identical face.
const COMPOUND_TEN_SCALE = 0.5;

function ringGeometry(ringClass) {
  if (ringClass === 'spot6R' || ringClass === 'spot6C') {
    const rescale = 2; // stretch the kept 10-50 unit band out to fill 0-100
    const tenScale = ringClass === 'spot6C' ? COMPOUND_TEN_SCALE : 1;
    const specs = RING_SPECS.filter(s => s.score >= 6)
      .map(s => ({ ...s, outer: s.outer * rescale * (s.score === 10 ? tenScale : 1) }));
    return { specs, xOuter: X_OUTER * rescale * tenScale, minRing: 6 };
  }
  if (ringClass === 'outdoor6') return { specs: RING_SPECS, xOuter: X_OUTER, minRing: 5 };
  if (ringClass === 'indoor6C') {
    const specs = RING_SPECS.map(s => (s.score === 10 ? { ...s, outer: s.outer * COMPOUND_TEN_SCALE } : s));
    return { specs, xOuter: X_OUTER * COMPOUND_TEN_SCALE, minRing: 6 };
  }
  return { specs: RING_SPECS, xOuter: X_OUTER, minRing: 1 }; // 'full'
}

function roundSpotLayout(round) { return round.spotLayout || 'single'; }
function roundRingClass(round) { return round.ringClass || 'full'; }
function spotCount(spotLayout) { return spotLayout === 'single' ? 1 : 3; }

// The physical diameter of ONE spot — half the class size for an isolated
// multi-spot face (each spot is genuinely smaller paper), unchanged for a
// single-spot face (including a margin-cut one, which stays full size with
// blank unscored margin). Used for cm-based group-dispersion stats.
function spotFaceCm(faceCm, spotLayout) {
  return spotLayout === 'single' ? faceCm : faceCm / 2;
}

function scoreFromRadiusUnits(d, ringClass) {
  if (d > FACE_R) return { score: 0, isX: false };
  const { specs, xOuter, minRing } = ringGeometry(ringClass);
  if (d <= xOuter) return { score: 10, isX: true };
  // Read the ring boundary straight off the same specs TargetFace draws,
  // rather than assuming an even 10-unit step per ring — isolated-spot
  // ringClasses rescale those boundaries (see ringGeometry above), so a
  // fixed step would score them wrong.
  const hit = [...specs].sort((a, b) => a.outer - b.outer).find(s => d <= s.outer);
  const score = hit ? hit.score : 0;
  if (score < minRing) return { score: 0, isX: false };
  return { score, isX: false };
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

// `round` (not a raw faceCm) so this can derive the physical size of what
// x/y are actually normalized against — for a multi-spot round that's each
// spot's own smaller diameter (spotFaceCm), not the round's class-size
// faceCm, since x/y on those arrows are spot-local.
function computeGroupStats(points, round) {
  const pts = points.filter(a => a.x != null && a.y != null);
  if (!pts.length) return null;
  const r = spotFaceCm(round.faceCm, roundSpotLayout(round)) / 2;
  const cx = pts.reduce((s, a) => s + a.x, 0) / pts.length;
  const cy = pts.reduce((s, a) => s + a.y, 0) / pts.length;
  let sumR = 0, maxR = 0, sumDx2 = 0, sumDy2 = 0;
  pts.forEach(a => {
    const dx = (a.x - cx) * r, dy = (a.y - cy) * r;
    const d = Math.sqrt(dx * dx + dy * dy);
    sumR += d;
    if (d > maxR) maxR = d;
    sumDx2 += dx * dx;
    sumDy2 += dy * dy;
  });
  return {
    x: cx, y: cy, cxCm: cx * r, cyCm: cy * r,
    meanRadiusCm: sumR / pts.length, maxRadiusCm: maxR,
    // Per-axis spread, kept separate rather than collapsed into the radius:
    // a group that scatters vertically and one that scatters horizontally
    // have the same mean radius and are not the same group.
    sdXCm: Math.sqrt(sumDx2 / pts.length), sdYCm: Math.sqrt(sumDy2 / pts.length),
    count: pts.length,
  };
}

function groupStats(stage, arrows) {
  return computeGroupStats(arrows, stage.round);
}

// On a multi-spot face every spot is aimed at separately, so pooling their
// arrows into one centroid averages away exactly the thing worth seeing —
// a vertical triple routinely groups high on the top spot and low on the
// bottom one, and the pooled view reports that as "centred". Always returns
// one entry per spot (just one for a single-spot round) so callers have a
// single code path.
function groupStatsBySpot(round, arrows) {
  const layout = roundSpotLayout(round);
  return Array.from({ length: spotCount(layout) }, (_, spot) => {
    const own = arrows.filter(a => (a.spot || 0) === spot);
    return { spot, arrows: own, stats: computeGroupStats(own, round) };
  });
}

// Radius of the 10-ring in cm for this round's face — the natural yardstick
// for "is this group tight", and it self-scales across face sizes and
// across compound's halved 10-ring without a magic constant.
function tenRingRadiusCm(round) {
  const { specs } = ringGeometry(roundRingClass(round));
  const ten = specs.find(s => s.score === 10);
  const spotR = spotFaceCm(round.faceCm, roundSpotLayout(round)) / 2;
  return ten ? (ten.outer / FACE_R) * spotR : spotR / 10;
}

// ---------- zoom sizing ----------
//
// How big the 10-ring actually renders, as a fraction of the visible
// viewport, at a given zoom. This — not the face's physical diameter — is
// what decides whether an arrow can be placed accurately by thumb: a
// compound 10-ring is half the diameter of a recurve one, and a triple
// sheet fits three spots in the space a single face gets, so the same "1×"
// means very different things from one round to the next.
function tenRingViewFraction(round, zoom) {
  const layout = roundSpotLayout(round);
  const { specs } = ringGeometry(roundRingClass(round));
  const ten = specs.find(s => s.score === 10);
  const tenOuter = ten ? ten.outer : FACE_R / 10;
  let halfExtent;
  if (layout === 'single') {
    halfExtent = FACE_R / zoom + (zoom === 1 ? 15 : 0); // mirrors TargetFace's 1× margin
  } else {
    const offsets = spotOffsets(layout);
    const spotR = FACE_R + 3;
    const xs = offsets.map(o => o.x), ys = offsets.map(o => o.y);
    const w = (Math.max(...xs) + spotR) - (Math.min(...xs) - spotR);
    const h = (Math.max(...ys) + spotR) - (Math.min(...ys) - spotR);
    halfExtent = Math.max(w, h) / 2 / zoom;
  }
  return tenOuter / (halfExtent * 2);
}

// The yardstick every other round is measured against: a plain recurve
// face at 1×, which is what the app has always opened at and what the tap
// target has always been tuned for.
function tapReferenceFraction() {
  return tenRingViewFraction({ faceCm: 40, ringClass: 'full', spotLayout: 'single' }, 1);
}

function isCompoundRingClass(ringClass) { return ringClass === 'indoor6C' || ringClass === 'spot6C'; }

// Compound faces get one extra step on the ladder: their 10-ring is half
// the diameter, so the zoom a recurve archer tops out at still leaves a
// compound centre small. Recurve rounds keep the ladder they've always had.
function zoomLevelsFor(round) {
  return isCompoundRingClass(roundRingClass(round)) ? [1, 2, 4, 8] : [1, 2, 4];
}

// Open at the first zoom where the 10-ring is at least as big on screen as
// a recurve face's is at 1×. Compound centres and vertical triples start
// zoomed in because at 1× they are genuinely too small to tap accurately;
// a plain recurve face still opens at 1×, unchanged.
function defaultZoomFor(round) {
  const target = tapReferenceFraction();
  const levels = zoomLevelsFor(round);
  return levels.find(z => tenRingViewFraction(round, z) >= target) || levels[levels.length - 1];
}

// Whether a group's offset from centre is real or just the scatter of a
// small sample: the standard error of the centroid, against the same
// two-sigma bar sessionInsight uses for fatigue. Below that the group is
// centred as far as this many arrows can tell, and "move your aim 1cm
// left" would be chasing noise.
function groupOffsetIsReal(stats) {
  if (!stats || stats.count < 2) return false;
  const offset = Math.sqrt(stats.cxCm ** 2 + stats.cyCm ** 2);
  const se = Math.sqrt(stats.sdXCm ** 2 + stats.sdYCm ** 2) / Math.sqrt(stats.count);
  return offset >= Math.max(0.3, 2 * se);
}

// A structured read of one group: where it sits, how wide it is, and which
// way it scatters — kept descriptive on purpose. The offset is arithmetic
// (it's how far off centre the arrows actually landed, so it's also the
// size of the correction that would centre them); the *cause* is not, and
// this app deliberately doesn't guess at one — see sessionInsight.
function describeGroupShape(stats, round) {
  if (!stats) return null;
  const offsetCm = Math.sqrt(stats.cxCm ** 2 + stats.cyCm ** 2);
  const offCentre = groupOffsetIsReal(stats);
  const tenR = tenRingRadiusCm(round);
  const tight = stats.meanRadiusCm <= tenR;

  let headline;
  if (!offCentre && tight) headline = 'Compatto e centrato';
  else if (!offCentre) headline = 'Centrato, ma disperso';
  else if (tight) headline = 'Compatto ma spostato';
  else headline = 'Spostato e disperso';

  // Which way it scatters. Only called out when one axis clearly dominates
  // — a roughly round group has no axis worth naming — and only once the
  // group is wide enough for "which way" to mean anything: a group tight
  // enough to read as a single hole has an axis in the arithmetic but not
  // on the target, and naming it would be reporting rounding noise.
  const ratio = stats.sdYCm > 0 ? stats.sdXCm / stats.sdYCm : 1;
  const axis = (stats.count < 3 || stats.meanRadiusCm < 0.3) ? null
    : ratio > 1.5 ? 'orizzontale'
    : ratio < 1 / 1.5 ? 'verticale'
    : null;

  return { offsetCm, offCentre, tight, headline, axis, stats };
}

// Below this many positioned arrows an offset is a rumour, not a reading —
// two-sigma on a handful of arrows still clears far too easily, and a sight
// moved on that evidence is as likely to be moved the wrong way.
const SIGHT_MIN_ARROWS = 6;

// A graded verdict on whether the group is actually telling you to move
// anything, rather than just handing over an offset and leaving the archer
// to assume it's a correction. Four things can be true of an off-centre
// group and only one of them is worth touching the sight for:
//   insufficient — too few arrows to distinguish a bias from scatter
//   centred      — the offset is inside its own error bars
//   unstable     — the group moved during the session, so there's no one
//                  offset to correct to; a sight change chases a drift
//   spread       — the offset is real but smaller than how wide the group
//                  is, so consistency is the binding constraint, not aim
//   adjust       — real, stable, and big relative to the spread
// `arrows` must be in the order they were shot; the drift test depends on
// it. Says nothing about WHY the group sits where it does — sight, anchor,
// stance, spine and wind all move it, and this data can't separate them.
function assessSightAdjustment(arrows, round) {
  const positioned = (arrows || []).filter(a => a.x != null && a.y != null);
  const stats = computeGroupStats(positioned, round);
  if (!stats) return null;
  if (stats.count < SIGHT_MIN_ARROWS) return { verdict: 'insufficient', stats, needed: SIGHT_MIN_ARROWS };
  if (!groupOffsetIsReal(stats)) return { verdict: 'centred', stats, offsetCm: 0 };

  const offsetCm = Math.sqrt(stats.cxCm ** 2 + stats.cyCm ** 2);
  const mid = Math.floor(positioned.length / 2);
  const first = computeGroupStats(positioned.slice(0, mid), round);
  const second = computeGroupStats(positioned.slice(mid), round);
  if (first && second && spotsDifferSignificantly(first, second)) {
    const driftCm = Math.sqrt((first.cxCm - second.cxCm) ** 2 + (first.cyCm - second.cyCm) ** 2);
    return { verdict: 'unstable', stats, offsetCm, driftCm };
  }
  if (offsetCm < stats.meanRadiusCm) return { verdict: 'spread', stats, offsetCm };
  return { verdict: 'adjust', stats, offsetCm };
}

// Do two spots sit far enough apart to be worth correcting separately, or
// is the difference within what this many arrows can resolve? Same
// two-sigma test as groupOffsetIsReal, applied to the gap between them.
function spotsDifferSignificantly(a, b) {
  if (!a || !b || a.count < 2 || b.count < 2) return false;
  const gap = Math.sqrt((a.cxCm - b.cxCm) ** 2 + (a.cyCm - b.cyCm) ** 2);
  const seA = (a.sdXCm ** 2 + a.sdYCm ** 2) / a.count;
  const seB = (b.sdXCm ** 2 + b.sdYCm ** 2) / b.count;
  return gap >= Math.max(0.5, 2 * Math.sqrt(seA + seB));
}

// The widest significant gap between any two spots, or null if they're all
// consistent with each other — the one thing a per-spot breakdown can say
// that a pooled group never could.
function widestSpotGap(perSpot) {
  const usable = perSpot.filter(p => p.stats && p.stats.count >= 2);
  let worst = null;
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i], b = usable[j];
      if (!spotsDifferSignificantly(a.stats, b.stats)) continue;
      const gap = Math.sqrt((a.stats.cxCm - b.stats.cxCm) ** 2 + (a.stats.cyCm - b.stats.cyCm) ** 2);
      if (!worst || gap > worst.gapCm) worst = { a: a.spot, b: b.spot, gapCm: gap };
    }
  }
  return worst;
}

// ---------- flyers ----------
//
// One bad release is not the same kind of event as the group it landed
// outside of, and mean/max radius don't distinguish them: a single flyer
// sets maxRadiusCm on its own and drags meanRadiusCm up with it, so a
// tight group with one mistake reads as a loose group. Splitting them
// answers two different questions — how well am I grouping, and how often
// do I throw one — instead of blurring both into one number.
//
// Elliptical distance (dx/sdX, dy/sdY) rather than plain radius, because a
// group that legitimately scatters vertically shouldn't have its tall
// arrows called flyers. At 3 sigma a true bivariate normal leaves ~1.1% of
// arrows outside, so on a 60-arrow end this flags roughly one arrow by
// chance — anything more than that is a real tail.
const FLYER_SIGMA = 3;
const FLYER_MIN_ARROWS = 8;

function separateFlyers(points, round) {
  const stats = computeGroupStats(points, round);
  if (!stats || stats.count < FLYER_MIN_ARROWS || stats.sdXCm <= 0 || stats.sdYCm <= 0) return null;
  const r = spotFaceCm(round.faceCm, roundSpotLayout(round)) / 2;
  const core = [], flyers = [];
  points.filter(a => a.x != null && a.y != null).forEach(a => {
    const dx = (a.x - stats.x) * r / stats.sdXCm;
    const dy = (a.y - stats.y) * r / stats.sdYCm;
    (Math.sqrt(dx * dx + dy * dy) > FLYER_SIGMA ? flyers : core).push(a);
  });
  if (!flyers.length) return null;
  return { coreStats: computeGroupStats(core, round), flyers, all: stats };
}

// ---------- expected score model ----------
//
// The group readout speaks in centimetres, which is the wrong currency: an
// archer decides whether to touch the sight in points. Fitting the arrows
// as a 2D normal (centroid + per-axis spread, all of which computeGroupStats
// already returns) and integrating it over the ring boundaries turns the
// group into an expected points-per-arrow — and, by re-running it with the
// centroid moved to zero, into the two numbers actually worth knowing:
// how much a perfect sight correction would be worth, and how much is left
// on the table by spread alone, which no sight setting can recover.
//
// Deliberately a MODEL, not a measurement: it assumes the arrows are
// normally distributed, which flyers violate (see separateFlyers). It's
// reported alongside the real average so a bad fit is visible rather than
// hidden.
//
// Grid integration rather than a closed form: the score is a step function
// of radius, so there's nothing smooth to integrate analytically. An odd
// node count puts a sample exactly on the centroid, and +-4 sigma covers
// 99.99% of the mass; the weights are renormalized so the truncated tail
// doesn't quietly bias the result downward.
const SCORE_MODEL_NODES = 121;
const SCORE_MODEL_SIGMAS = 4;

function expectedScorePerArrow(round, cxCm, cyCm, sdXCm, sdYCm) {
  const spotR = spotFaceCm(round.faceCm, roundSpotLayout(round)) / 2;
  const ringClass = roundRingClass(round);
  const scoreAt = (xCm, yCm) =>
    scoreFromRadiusUnits(Math.sqrt(xCm * xCm + yCm * yCm) / spotR * FACE_R, ringClass).score;
  if (!(sdXCm > 0) || !(sdYCm > 0)) return scoreAt(cxCm, cyCm);

  const n = SCORE_MODEL_NODES;
  const stepX = (2 * SCORE_MODEL_SIGMAS * sdXCm) / (n - 1);
  const stepY = (2 * SCORE_MODEL_SIGMAS * sdYCm) / (n - 1);
  // Marginal weights, computed once instead of n^2 times: the distribution
  // is separable and both axes share the same grid of standard scores, so
  // the 2D weight at (i,j) is just w[i]*w[j].
  const w = [];
  for (let i = 0; i < n; i++) {
    const z = -SCORE_MODEL_SIGMAS + (i * 2 * SCORE_MODEL_SIGMAS) / (n - 1);
    w.push(Math.exp(-0.5 * z * z));
  }
  let sum = 0, weight = 0;
  for (let i = 0; i < n; i++) {
    const xCm = cxCm - SCORE_MODEL_SIGMAS * sdXCm + i * stepX;
    for (let j = 0; j < n; j++) {
      const yCm = cyCm - SCORE_MODEL_SIGMAS * sdYCm + j * stepY;
      const ww = w[i] * w[j];
      sum += ww * scoreAt(xCm, yCm);
      weight += ww;
    }
  }
  return weight ? sum / weight : 0;
}

// The best a single arrow can score. X counts 10, so this is the ceiling on
// every ring class the app models.
const MAX_ARROW_SCORE = 10;

// The full read: what this group is worth, what centring it would be worth,
// and what the spread costs on top. `aim` is the honest size of the prize
// for a sight correction — and it is routinely much smaller than the
// centimetre offset makes it feel, which is exactly why it's worth showing.
function pointsBreakdown(stats, round) {
  if (!stats || stats.count < 2) return null;
  const expected = expectedScorePerArrow(round, stats.cxCm, stats.cyCm, stats.sdXCm, stats.sdYCm);
  const centred = expectedScorePerArrow(round, 0, 0, stats.sdXCm, stats.sdYCm);
  return {
    expected,
    centred,
    // Clamped at zero: the model can put a marginally off-centre group a
    // hair above a centred one through grid noise, and "moving your sight
    // would LOSE you 0.01 points" is not a thing worth printing.
    aim: Math.max(0, centred - expected),
    spread: Math.max(0, MAX_ARROW_SCORE - centred),
  };
}

// ---------- cross-round comparability ----------
//
// Every other figure in the app is locked to one round shape, so there's no
// way to ask "am I shooting better at 18m or at 70m" — the scores aren't
// comparable and neither are the centimetres, since the same angular error
// makes a group twice as wide at twice the distance. Dividing the group by
// the distance removes exactly that, leaving the angle the archer's form
// actually subtends. Milliradians because 1 mrad is 1cm at 10m, which makes
// the number easy to sanity-check.
//
// This is a physical normalization, not a handicap or a rating: it says
// nothing about how the two distances compare in difficulty (wind and sight
// marks don't scale linearly), only about how tightly the archer is
// shooting at each. A proper cross-round rating would need a published
// scheme (Archery GB's handicap tables are the established one; World
// Archery has no official equivalent) and is deliberately not invented here.
function angularDispersionMrad(stats, distanceM) {
  if (!stats || !distanceM) return null;
  return (stats.meanRadiusCm / 100) / distanceM * 1000;
}

// Compares distance + face size + spot layout + ring class, not arrows-per-
// end/ends — how a round gets chunked into ends is a scoring convention,
// not a real difficulty difference, so two rounds at the same distance/
// face/target-variant are the same round for comparison purposes even if
// one was shot 12x6 and the other 6x12. A WA1440's 70m stage and a
// standalone Targa 70m session DO count as the same round on purpose; two
// "Personalizzata" stages at different distances or face sizes never do —
// and neither do, say, an Indoor 18m single face and an Indoor 18m triple
// vertical, despite sharing distanceM/faceCm: they're not the same
// challenge, so they must never share a personal-best bucket.
function sameRound(a, b) {
  return a.distanceM === b.distanceM && a.faceCm === b.faceCm
    && roundSpotLayout(a) === roundSpotLayout(b) && roundRingClass(a) === roundRingClass(b);
}

// entries: a flat list from stageEntries() — see below. scope: { round, bowType, sessionType }.
// Unlike Statistiche — which groups by distance+face alone and compares
// per-arrow — a personal best here must also have the SAME TOTAL ARROW
// COUNT as the stage being shot. Two reasons, and they point the same way:
// comparing raw totals across different lengths meant a 72-arrow Targa 70m
// always outranked a 36-arrow WA1440 70m stage no matter how well the
// latter was shot; and paceVsPB below compares the two cumulative curves
// arrow by arrow, which is only meaningful between rounds of equal length.
// Chunking still doesn't matter (12x6 and 6x12 are both 72 arrows, and
// sameRound already treats them as the same round).
function findPersonalBest(entries, scope, excludeSessionId) {
  const scopeArrows = scope.round.arrowsPerEnd * scope.round.ends;
  const candidates = entries.filter(e =>
    entryIsRankable(e) &&
    e.sessionId !== excludeSessionId &&
    sameRound(e.round, scope.round) &&
    e.round.arrowsPerEnd * e.round.ends === scopeArrows &&
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
// A session is `{ id, stages: [stage, ...], sessionType, bowType,
// conditions, status, startedAt, completedAt, location, note }`.
// (Sessions saved before v1.19 also carry `roundId`/`roundLabel`; nothing
// reads them — the display name is derived from the stage shape instead,
// see sessionDisplayName.)
// status/completedAt are session-wide: a multi-stage session only becomes
// 'completed' once every stage is full, so a partially-shot WA1440 never
// counts toward anyone's personal best (matches how a partially-shot single
// round already worked before multi-stage rounds existed).

function createSession(roundDef, meta) {
  const stages = roundDef.stages.map(st => ({
    round: {
      label: `${st.distanceM}m`, distanceM: st.distanceM, faceCm: st.faceCm, arrowsPerEnd: st.arrowsPerEnd, ends: st.ends,
      spotLayout: st.spotLayout || 'single', ringClass: st.ringClass || 'full',
    },
    ends: Array.from({ length: st.ends }, (_, i) => ({ index: i, arrows: [] })),
  }));
  return {
    id: uid(),
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
// How many arrows the round called for, shot or not — only meaningful for a
// session that didn't get there, so it exists for the partial-session copy.
function sessionPlannedArrows(session) { return session.stages.reduce((s, st) => s + totalArrowsInRound(st), 0); }

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

// Commits a confirmed volée and stamps the end with the moment it was
// confirmed. The stamp is what every pace figure is derived from (see
// endDurations) — it measures shooting AND scoring, since the app gets used
// at the target as much as at the line, and nothing downstream claims
// otherwise. Ends saved before this existed simply have no `at`, and every
// reader skips them.
function sessionConfirmEnd(session, arrows, at) {
  const stageIdx = activeStageIndex(session);
  const endIdx = currentEndIndex(session.stages[stageIdx]);
  const next = arrows.reduce((acc, a) => sessionAddArrow(acc, a), session);
  const stamp = at || new Date().toISOString();
  return {
    ...next,
    stages: next.stages.map((st, i) => (i !== stageIdx ? st : {
      ...st,
      ends: st.ends.map((e, j) => (j === endIdx ? { ...e, at: stamp } : e)),
    })),
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

// ---------- interrupted sessions ----------
//
// Rain, light, a broken nock, running out of time: rounds get abandoned,
// and before this they stayed 'in_progress' forever — sitting in Home's
// resume list and counting for nothing. Closing one early marks it
// 'partial', a third status alongside in_progress/completed.
//
// How a partial counts, which is the whole question:
//   - Records and rankings (personal bests, the "best" column) use only
//     rounds that were actually finished. A 30-arrow half-round can't be
//     ranked against a 60-arrow one, and per-arrow averaging doesn't fix
//     that — a short session is a sprint, and this app charts fatigue as a
//     real effect precisely because the back half is harder.
//   - Arrow-weighted aggregates and diagnostics (lifetime totals, the
//     per-arrow trend, colour distribution, group and dispersion analysis,
//     condition buckets) DO include partials. Those arrows were really
//     shot, every one of those figures is already weighted by arrow count
//     so a short session contributes proportionally less, and discarding
//     them would throw away real evidence about how someone was shooting.
//   - Below MIN_ARROWS_FOR_PARTIAL_STATS the session is kept for the record
//     but counts for nothing: an average over three arrows is noise.
//
// A finished STAGE inside a partial session is still a finished round —
// abandoning a WA1440 at the third distance doesn't un-shoot the first two
// — so those stages stay eligible for personal bests. Sessions left
// 'in_progress' are untouched by all of this: they're still being shot.
const MIN_ARROWS_FOR_PARTIAL_STATS = 12;

function closeSessionEarly(session) {
  if (session.status === 'completed') return session;
  return { ...session, status: 'partial', completedAt: new Date().toISOString() };
}

// Closing early is a judgement call made at the range, and sometimes the
// wrong one — reopening puts the session back exactly where it was.
function reopenSession(session) {
  if (session.status !== 'partial') return session;
  return { ...session, status: 'in_progress', completedAt: null };
}

function stageIsFull(entry) { return arrowsShotCount(entry) >= totalArrowsInRound(entry); }

// Whether a stage entry may hold a record: it has to be a round that was
// actually shot end to end.
function entryIsRankable(entry) {
  if (entry.status === 'completed') return true;
  return entry.status === 'partial' && stageIsFull(entry);
}

// Whether a stage entry counts toward arrow-weighted aggregates.
function entryCountsForStats(entry) {
  if (entry.status === 'completed') return true;
  return entry.status === 'partial' && arrowsShotCount(entry) >= MIN_ARROWS_FOR_PARTIAL_STATS;
}

function sessionCountsForStats(session) {
  if (session.status === 'completed') return true;
  return session.status === 'partial' && sessionArrowsShot(session) >= MIN_ARROWS_FOR_PARTIAL_STATS;
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

// Standardized display name for a session — always computed from its round
// shape, never freely typed (the old free-text "Nome prova" field let two
// identical 30m/40cm rounds end up named completely differently, or not
// named at all beyond the generic "Personalizzata"). Returns the archetype
// name alone ("Targa 70m", "WA 1440") with nothing appended when the shape
// is recognized; a session that doesn't match any known archetype gets
// named after its actual distance(s) and face size(s) instead, and
// `isArchetype: false` so callers can flag it visually rather than let it
// pass as a "real" round name. Two multi-stage archetypes are recognized
// this way: a 4-stage round (this club's WA 1440 aggregate convention) and
// a 2-stage 25m+18m round (the standard FITARCO/WA Combined round). Any
// other multi-stage shape isn't a known archetype.
// WA 1440 is four distances shot long-to-short, the two longest on the
// 122cm face and the two shortest on the 80cm face. The distances
// themselves vary by category (90/70/50/30 for senior men, 70/60/50/30 for
// senior women, shorter again for juniors and para classes), so the
// archetype is recognised by that face-and-ordering shape rather than one
// hardcoded distance set. Matching on stage count alone — as this used to —
// labelled any four-stage session "WA 1440", including four rounds at 18m.
function isWA1440(stages) {
  if (stages.length !== 4) return false;
  const faces = stages.map(st => st.round.faceCm);
  const dists = stages.map(st => st.round.distanceM);
  return faces[0] === 122 && faces[1] === 122 && faces[2] === 80 && faces[3] === 80
    && dists.every((d, i) => i === 0 || d < dists[i - 1]);
}

// The standard FITARCO/WA indoor combined round: 25m on a 60cm face and 18m
// on a 40cm face, in either order. Face sizes are checked too — 25m and 18m
// on some other face is a different round.
function isWACombined(stages) {
  if (stages.length !== 2) return false;
  const shot = stages.map(st => `${st.round.distanceM}/${st.round.faceCm}`).sort();
  return shot[0] === '18/40' && shot[1] === '25/60';
}

function sessionDisplayName(session) {
  const { stages } = session;
  if (stages.length === 1) {
    const preset = matchedPreset(stages[0].round);
    return { name: roundShapeLabel(stages[0].round), isArchetype: !!preset };
  }
  if (isWA1440(stages)) return { name: 'WA 1440', isArchetype: true };
  if (isWACombined(stages)) return { name: 'WA Combined', isArchetype: true };
  return { name: stages.map(st => `${st.round.distanceM}m · ${st.round.faceCm}cm`).join(' + '), isArchetype: false };
}

// Renders a session's standardized name — full-strength text for a
// recognized archetype ("Targa 70m", "WA 1440"), dimmed for a shape that
// doesn't match one, so a raw "30m · 80cm" distance/face label reads as
// descriptive rather than passing as an official round name.
function SessionName({ session }) {
  const { name, isArchetype } = sessionDisplayName(session);
  return <span style={isArchetype ? undefined : { color: T.textFaint }}>{name}</span>;
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
    // Carried through for scoreByLocation. Sessions have always recorded a
    // field and stage entries have always dropped it, which is why nothing
    // could be broken down by where it was shot.
    location: s.location,
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
//
// Everything here reports what happened; nothing attributes a cause. The
// archer knows what they changed today and this function doesn't, so a
// confident wrong explanation is worse for them than a bare observation.
function sessionInsight(session, allSessions) {
  const entries = stageEntries(allSessions);
  let baselineSum = 0, baselineArrows = 0;
  // Distinct sessions, not a running total across stages — a 4-stage
  // session used to count its baseline sessions once per stage and claim a
  // sample up to 4x larger than it really compared against.
  const histSessions = new Set();
  session.stages.forEach(stage => {
    const hist = entries.filter(e =>
      entryCountsForStats(e) && e.sessionId !== session.id &&
      sameRound(e.round, stage.round) &&
      (e.bowType || null) === (session.bowType || null) &&
      (e.sessionType || 'allenamento') === (session.sessionType || 'allenamento'))
      // Most recent first, then capped: comparing today against every
      // session ever shot means comparing an improving archer against a
      // worse version of themselves indefinitely, so a good session keeps
      // reading as "sopra la media" long after it stopped being true (and
      // the reverse once form is found). A rolling window tracks the level
      // they're actually at now.
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, INSIGHT_BASELINE_SESSIONS);
    if (!hist.length) return;
    hist.forEach(e => histSessions.add(e.sessionId));
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
      sentences.push(`Media in linea con il tuo standard: ${thisAvg.toFixed(2)} punti a freccia (confronto sulle ultime ${histSessions.size} sessioni).`);
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
  const group = posArrows.length ? computeGroupStats(posArrows, mainStage.round) : null;

  const half = Math.ceil(mainStage.ends.length / 2);
  const firstHalfArrows = mainStage.ends.slice(0, half).flatMap(e => e.arrows);
  const secondHalfArrows = mainStage.ends.slice(half).flatMap(e => e.arrows);
  const firstAvg = firstHalfArrows.length ? firstHalfArrows.reduce((s, a) => s + a.score, 0) / firstHalfArrows.length : null;
  const secondAvg = secondHalfArrows.length ? secondHalfArrows.reduce((s, a) => s + a.score, 0) / secondHalfArrows.length : null;
  const fatigueDelta = firstAvg != null && secondAvg != null ? secondAvg - firstAvg : null;

  // A half-to-half difference has to clear this session's OWN noise before
  // it means anything. The old test was a flat 0.4 points with no dispersion
  // term: for a typical per-arrow spread that sits barely over one standard
  // error of the difference, so a perfectly steady archer tripped the
  // "affaticamento" or "buona ripresa" line a large fraction of the time.
  // Two standard errors, with a 0.4 floor so a freakishly tight session
  // can't call a trivial wobble significant either.
  const stageArrows = flattenArrows(mainStage).map(a => a.score);
  const stageMean = stageArrows.length ? stageArrows.reduce((s, v) => s + v, 0) / stageArrows.length : 0;
  const stageSd = stageArrows.length > 1
    ? Math.sqrt(stageArrows.reduce((s, v) => s + (v - stageMean) ** 2, 0) / stageArrows.length)
    : 0;
  const halfSe = (firstHalfArrows.length && secondHalfArrows.length)
    ? stageSd * Math.sqrt(1 / firstHalfArrows.length + 1 / secondHalfArrows.length)
    : Infinity;
  const fatigueThreshold = Math.max(0.4, 2 * halfSe);

  const arrows = sessionFlattenArrows(session);
  const misses = arrows.filter(a => a.score === 0).length;
  const golds = arrows.filter(a => a.score === 10).length;
  const goldRate = arrows.length ? golds / arrows.length : 0;

  // On a multi-spot face, spots that disagree with each other outrank the
  // overall offset: pooling them is what hides the pattern, so if the data
  // can resolve a difference between spots that's the more useful thing to
  // say — and the pooled offset below would be an average of groups the
  // archer never shot as one.
  const spotGap = roundSpotLayout(mainStage.round) !== 'single'
    ? widestSpotGap(groupStatsBySpot(mainStage.round, posArrows))
    : null;

  if (spotGap) {
    sentences.push(`Gli spot non sono allineati tra loro: ${spotGap.gapCm.toFixed(1)} cm tra lo spot ${spotGap.a + 1} e lo spot ${spotGap.b + 1}. Vanno valutati separatamente.`);
  } else if (group && Math.sqrt(group.cxCm ** 2 + group.cyCm ** 2) >= 1.5) {
    // Reports the offset and stops there. It used to add "attenzione al
    // rilascio", which is a diagnosis the data cannot support — a group
    // that sits consistently off centre is more often a sight setting than
    // a release fault, and stance, anchor, spine and wind all move it too.
    // This is the only line in the app that tells the archer what to change
    // about their technique, so it is the last one that should guess.
    sentences.push(`Gruppo spostato ${describeBias(group.cxCm, group.cyCm)} rispetto al centro del bersaglio.`);
  } else if (fatigueDelta != null && fatigueDelta <= -fatigueThreshold) {
    sentences.push('Punteggio in calo nella seconda parte: possibile affaticamento.');
  } else if (fatigueDelta != null && fatigueDelta >= fatigueThreshold) {
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
// Per end position (1st volée, 2nd, ...), across every session in the
// list: the range (min-max) and average of that end's own per-arrow
// average — a "how do I tend to perform at volée N" view, not just a
// single flat average, so a real peak (or a dip) at a particular end is
// visible instead of averaged away. Per-arrow rather than per-end-total so
// ends with different arrow counts stay comparable.
// Linear interpolation between order statistics — the same definition
// spreadsheets use, so a quartile printed here matches one worked out by
// hand. `sorted` must already be ascending.
function quantile(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Median and interquartile band, NOT min-max. The range between the best
// and worst a volée has ever gone is not a property of the archer: it can
// only grow as sessions accumulate, so a round shape with thirty sessions
// draws a visibly wider band than one with six purely from having been shot
// more. The quartiles are stable under sample size and say the thing the
// chart is actually for — where this volée usually lands. `n` rides along
// so a volée that only the long rounds ever reach can be read with its
// thinner support in view.
function endRangeStats(completedList) {
  const maxEnds = completedList.reduce((m, s) => Math.max(m, s.round.ends), 0);
  const rows = [];
  for (let i = 0; i < maxEnds; i++) {
    const endAvgs = [];
    completedList.forEach(s => {
      const end = s.ends[i];
      if (end && end.arrows.length) {
        endAvgs.push(end.arrows.reduce((a, b) => a + b.score, 0) / end.arrows.length);
      }
    });
    if (!endAvgs.length) { rows.push({ end: i + 1, band: null, median: null, avg: null, n: 0 }); continue; }
    endAvgs.sort((a, b) => a - b);
    rows.push({
      end: i + 1,
      band: [quantile(endAvgs, 0.25), quantile(endAvgs, 0.75)],
      median: quantile(endAvgs, 0.5),
      avg: endAvgs.reduce((a, b) => a + b, 0) / endAvgs.length,
      n: endAvgs.length,
    });
  }
  return rows;
}

// ---------- uncertainty ----------
//
// Ordinary least squares of y on x, with the standard error of the slope —
// enough to ask "is this line actually sloping, or am I reading noise",
// which is the question every trend chart in the app silently invited and
// never answered. Returns null below three points, where a slope has no
// residual degrees of freedom left to estimate its own error from.
function linearFit(points) {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, sxy = 0;
  points.forEach(p => { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); });
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const residualSs = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const slopeSe = Math.sqrt(residualSs / (n - 2) / sxx);
  return { slope, intercept, slopeSe, n };
}

// Is the session-to-session line going anywhere? Same two-sigma bar the
// rest of the app uses. `perTen` restates the slope over ten sessions,
// because a slope per session is a number nobody can feel.
function trendVerdict(series, key = 'avg') {
  const points = series.map((row, i) => ({ x: i, y: row[key] })).filter(p => Number.isFinite(p.y));
  const fit = linearFit(points);
  if (!fit) return { verdict: 'insufficient', n: points.length };
  const significant = Math.abs(fit.slope) >= 2 * fit.slopeSe;
  return {
    verdict: !significant ? 'flat' : fit.slope > 0 ? 'up' : 'down',
    slope: fit.slope,
    perTen: fit.slope * 10,
    slopeSe: fit.slopeSe,
    n: fit.n,
  };
}

// Each session's average with its own error bar. A 60-arrow average carries
// a standard error of roughly a quarter point, which is bigger than most of
// the movement the trend line shows — so plotting the points bare invites
// the archer to read a story into scatter. The band is +-2 SE: sessions
// whose bands overlap did not measurably differ.
function avgTrendWithBands(completedList) {
  return completedList
    .slice()
    .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
    .map(e => {
      const scores = flattenArrows(e).map(a => a.score);
      const n = scores.length;
      const avg = n ? scores.reduce((s, v) => s + v, 0) / n : 0;
      const sd = n > 1 ? Math.sqrt(scores.reduce((s, v) => s + (v - avg) ** 2, 0) / (n - 1)) : 0;
      const se = n > 1 ? sd / Math.sqrt(n) : 0;
      return { label: formatDateShort(e.completedAt), avg, se, n, band: [avg - 2 * se, avg + 2 * se] };
    });
}

// Population standard deviation of a session's individual arrow scores.
function scoreStdDevBySession(completedList) {
  return completedList
    .slice()
    .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
    .map(e => {
      const scores = flattenArrows(e).map(a => a.score);
      if (scores.length < 2) return { label: formatDateShort(e.completedAt), stddev: null, mean: null };
      const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
      const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
      return { label: formatDateShort(e.completedAt), stddev: Math.sqrt(variance), mean };
    });
}

// How many sessions before the sigma-versus-mean relationship can be fitted
// from the archer's own data. Below this the raw sigma is shown instead,
// with the caveat that it moves with the average.
const CONSISTENCY_FIT_MIN_SESSIONS = 5;

// Raw sigma is a bad consistency measure and this chart used to present it
// as a good one. Arrow scores are capped at 10, so as a group tightens every
// arrow converges on the ceiling and sigma is dragged to zero with it: an
// archer improving from 8.0 to 9.5 points per arrow will show a falling
// sigma whether or not they became any steadier. Plotted next to the average
// it is close to an upside-down copy of it.
//
// What's left once that's removed is the useful part. Fitting sigma against
// the session average over the archer's own history gives the sigma a
// session of that quality would normally have; the residual is how much
// steadier (below zero) or streakier (above zero) it actually was. Self-
// calibrating, so it needs no reference table and no assumption about level.
function consistencyTrend(completedList) {
  const rows = scoreStdDevBySession(completedList);
  const usable = rows.filter(r => r.stddev != null);
  if (usable.length < CONSISTENCY_FIT_MIN_SESSIONS) return { rows, fitted: false };
  const fit = linearFit(usable.map(r => ({ x: r.mean, y: r.stddev })));
  if (!fit) return { rows, fitted: false };
  return {
    fitted: true,
    rows: rows.map(r => (r.stddev == null ? { ...r, expected: null, residual: null } : {
      ...r,
      expected: fit.intercept + fit.slope * r.mean,
      residual: r.stddev - (fit.intercept + fit.slope * r.mean),
    })),
  };
}

// Dispersion and drift over time, computed PER SPOT. Pooling every arrow on
// a triple face through one centroid — which this did — mixes three
// separately-aimed groups into a group nobody shot: the centroid lands
// between the spots, and any disagreement between them is added to the
// dispersion as if it were scatter. That's the exact error groupStatsBySpot
// exists to prevent, and it was still live here after the group readouts
// were fixed.
//
// Dispersion is the arrow-weighted mean of the per-spot dispersions, which
// for a single-spot round is unchanged. Drift is only a direction when
// there's one aim point: on a multi-spot face each spot gets its own offset
// magnitude instead, since averaging three directions produces a vector
// pointing nowhere in particular.
function dispersionTrend(completedList) {
  return completedList
    .slice()
    .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
    .map(s => {
      const perSpot = groupStatsBySpot(s.round, flattenArrows(s));
      const usable = perSpot.filter(p => p.stats);
      if (!usable.length) return null;
      const arrows = usable.reduce((n, p) => n + p.stats.count, 0);
      const row = {
        label: formatDateShort(s.completedAt),
        dispersion: usable.reduce((sum, p) => sum + p.stats.meanRadiusCm * p.stats.count, 0) / arrows,
        multi: roundSpotLayout(s.round) !== 'single',
      };
      if (!row.multi) {
        row.biasX = usable[0].stats.cxCm;
        row.biasY = usable[0].stats.cyCm;
      } else {
        perSpot.forEach(p => {
          row[`spot${p.spot}`] = p.stats
            ? Math.sqrt(p.stats.cxCm ** 2 + p.stats.cyCm ** 2)
            : null;
        });
      }
      return row;
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
// Each bar now carries its own two-sigma error bar. Without one, a bucket
// built from three sessions renders exactly as authoritatively as one built
// from thirty, and the eye reads any difference in bar height as a real
// effect — which, at these sample sizes, it usually isn't. The error bar is
// the sampling error only; it says nothing about the confounding these
// buckets are full of (your windy sessions may all be from a period when you
// were shooting worse anyway), which is why the UI says so in words.
function scoreByCondition(completedList, dimension) {
  const dim = CONDITION_DIMENSIONS.find(d => d.id === dimension);
  const buckets = {};
  dim.options.forEach(o => { buckets[o.id] = { sum: 0, sumSq: 0, arrows: 0, sessions: 0 }; });
  completedList.forEach(s => {
    const c = s.conditions;
    if (!c) return;
    const values = dimension === 'tags' ? (c.tags || []) : (c[dimension] ? [c[dimension]] : []);
    const arrows = flattenArrows(s);
    values.forEach(v => {
      if (!buckets[v]) return;
      buckets[v].sum += totalScore(s);
      buckets[v].sumSq += arrows.reduce((t, a) => t + a.score * a.score, 0);
      buckets[v].arrows += arrows.length;
      buckets[v].sessions += 1;
    });
  });
  return dim.options
    .map(o => {
      const b = buckets[o.id];
      const avg = b.arrows ? b.sum / b.arrows : 0;
      const variance = b.arrows > 1 ? Math.max(0, b.sumSq / b.arrows - avg * avg) : 0;
      const se = b.arrows > 1 ? Math.sqrt(variance / b.arrows) : 0;
      return { key: o.label, avg, count: b.sessions, arrows: b.arrows, err: 2 * se };
    })
    .filter(r => r.count >= MIN_SESSIONS_PER_CONDITION);
}

// ---------- training load ----------
//
// Nothing in the app tracked volume, which is odd for a training log: how
// much you shoot is the best-established driver of how well you shoot, and
// every session already carries the date needed to count it. Weeks run
// Monday to Sunday and are emitted unbroken, so a fortnight off shows up as
// two empty columns rather than silently closing the gap.
function weekStartOf(iso) {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday = 0
  return d;
}

function weeklyVolume(sessions, weeks = 16) {
  const counted = sessions.filter(sessionCountsForStats);
  if (!counted.length) return [];
  const latest = counted.reduce((a, b) => (new Date(b.completedAt) > new Date(a.completedAt) ? b : a));
  const end = weekStartOf(latest.completedAt);
  const buckets = new Map();
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i * 7);
    buckets.set(d.getTime(), { label: formatDateShort(d.toISOString()), arrows: 0, sessions: 0 });
  }
  counted.forEach(s => {
    const key = weekStartOf(s.completedAt).getTime();
    const b = buckets.get(key);
    if (!b) return;
    b.arrows += sessionArrowsShot(s);
    b.sessions += 1;
  });
  return Array.from(buckets.values());
}

// Whole days since the last session that counted — the number a training
// log should put in front of you without being asked.
function daysSinceLastSession(sessions, now = new Date()) {
  const counted = sessions.filter(sessionCountsForStats);
  if (!counted.length) return null;
  const latest = counted.reduce((a, b) => (new Date(b.completedAt) > new Date(a.completedAt) ? b : a));
  return Math.floor((now - new Date(latest.completedAt)) / 86400000);
}

// ---------- contrasts ----------
//
// Two arrow-weighted means with a two-sigma test on their difference. The
// app could already FILTER by session type but never CONTRASTED them, so
// the question every archer asks — how much do I drop in competition — took
// flipping between two chips and remembering two numbers.
function meanWithError(entries) {
  let sum = 0, sumSq = 0, arrows = 0;
  entries.forEach(e => flattenArrows(e).forEach(a => { sum += a.score; sumSq += a.score * a.score; arrows += 1; }));
  if (!arrows) return null;
  const avg = sum / arrows;
  const variance = arrows > 1 ? Math.max(0, sumSq / arrows - avg * avg) : 0;
  return { avg, arrows, sessions: entries.length, se: arrows > 1 ? Math.sqrt(variance / arrows) : 0 };
}

function contrastGroups(entriesA, entriesB) {
  const a = meanWithError(entriesA), b = meanWithError(entriesB);
  if (!a || !b) return null;
  const diff = a.avg - b.avg;
  const se = Math.sqrt(a.se ** 2 + b.se ** 2);
  return { a, b, diff, se, significant: Math.abs(diff) >= 2 * se };
}

// Gara against allenamento, on whatever scope the caller has already
// filtered to. Arrow-weighted, so a single long competition doesn't outvote
// a season of training.
function typeContrast(entries) {
  const gara = entries.filter(e => (e.sessionType || 'allenamento') === 'gara');
  const training = entries.filter(e => (e.sessionType || 'allenamento') === 'allenamento');
  if (!gara.length || !training.length) return null;
  return contrastGroups(gara, training);
}

// ---------- position within the end ----------
//
// Which arrow of the volée is it? The data has always been there, ordered,
// and nothing ever looked: a first arrow shot cold and a last arrow shot
// after two sighters of feedback are different shots, and archers routinely
// have a strong preference between them. Two-sigma test of the first arrow
// against all the others, so a hunch doesn't get printed as a finding.
function arrowPositionStats(completedList) {
  const perEnd = completedList.reduce((m, e) => Math.max(m, e.round.arrowsPerEnd), 0);
  const slots = Array.from({ length: perEnd }, () => ({ sum: 0, sumSq: 0, n: 0 }));
  completedList.forEach(e => e.ends.forEach(end => end.arrows.forEach((a, i) => {
    if (!slots[i]) return;
    slots[i].sum += a.score;
    slots[i].sumSq += a.score * a.score;
    slots[i].n += 1;
  })));
  const rows = slots.map((s, i) => {
    const avg = s.n ? s.sum / s.n : 0;
    const variance = s.n > 1 ? Math.max(0, s.sumSq / s.n - avg * avg) : 0;
    const se = s.n > 1 ? Math.sqrt(variance / s.n) : 0;
    return { position: i + 1, avg, n: s.n, se, err: 2 * se };
  }).filter(r => r.n > 0);
  if (rows.length < 2) return { rows, firstArrow: null };
  const first = rows[0];
  const rest = slots.slice(1).reduce((acc, s) => ({ sum: acc.sum + s.sum, sumSq: acc.sumSq + s.sumSq, n: acc.n + s.n }), { sum: 0, sumSq: 0, n: 0 });
  const restAvg = rest.n ? rest.sum / rest.n : 0;
  const restVar = rest.n > 1 ? Math.max(0, rest.sumSq / rest.n - restAvg * restAvg) : 0;
  const restSe = rest.n > 1 ? Math.sqrt(restVar / rest.n) : 0;
  const diff = first.avg - restAvg;
  const se = Math.sqrt(first.se ** 2 + restSe ** 2);
  return { rows, firstArrow: { diff, se, significant: Math.abs(diff) >= 2 * se, restAvg } };
}

// ---------- X rate ----------
//
// X count existed as one lifetime tile and nothing else, which undersells
// it: for compound especially the X is what separates two archers who both
// shoot tens, and it's the tie-break that decides placings.
function xRateTrend(completedList) {
  return completedList
    .slice()
    .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
    .map(e => {
      const arrows = flattenArrows(e);
      return {
        label: formatDateShort(e.completedAt),
        pct: arrows.length ? (arrows.filter(a => a.isX).length / arrows.length) * 100 : 0,
        n: arrows.length,
      };
    });
}

// ---------- where you shoot ----------
//
// `location` was collected on every session and only ever printed back.
// Free text, so it's grouped case- and whitespace-insensitively, and the
// most-used spelling is what gets displayed.
function normalizeLocationKey(location) {
  return (location || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function scoreByLocation(completedList) {
  const buckets = new Map();
  completedList.forEach(s => {
    const key = normalizeLocationKey(s.location);
    if (!key) return;
    if (!buckets.has(key)) buckets.set(key, { names: new Map(), entries: [] });
    const b = buckets.get(key);
    const shown = (s.location || '').trim().replace(/\s+/g, ' ');
    b.names.set(shown, (b.names.get(shown) || 0) + 1);
    b.entries.push(s);
  });
  return Array.from(buckets.values())
    .map(b => {
      const stats = meanWithError(b.entries);
      const label = Array.from(b.names.entries()).sort((x, y) => y[1] - x[1])[0][0];
      return { key: label, avg: stats.avg, count: stats.sessions, arrows: stats.arrows, err: 2 * stats.se };
    })
    .filter(r => r.count >= MIN_SESSIONS_PER_CONDITION)
    .sort((a, b) => b.avg - a.avg);
}

// ---------- rhythm ----------
//
// Ends carry `at`, the moment the volée was confirmed (see sessionConfirmEnd).
// The gap between consecutive stamps is how long that volée took to shoot
// AND score, which is the honest description — the app is used at the target
// as often as at the line, so this is pace of work, not draw time. Gaps
// beyond REST_GAP_SECONDS are dropped as breaks rather than folded into an
// average they would dominate.
const REST_GAP_SECONDS = 15 * 60;

function endDurations(entry) {
  const out = [];
  for (let i = 1; i < entry.ends.length; i++) {
    const prev = entry.ends[i - 1], cur = entry.ends[i];
    if (!prev.at || !cur.at || !cur.arrows.length) continue;
    const secs = (new Date(cur.at) - new Date(prev.at)) / 1000;
    if (secs <= 0 || secs > REST_GAP_SECONDS) continue;
    out.push({ index: i, seconds: secs, avg: cur.arrows.reduce((s, a) => s + a.score, 0) / cur.arrows.length });
  }
  return out;
}

// Splits each session's own volées at its own median pace, then contrasts
// the two halves. Within-session so a slow session and a fast archer aren't
// compared with each other, and the median is per session so it adapts to
// how that day was shot.
function paceContrast(completedList) {
  const slow = [], fast = [];
  let sessionsWithTiming = 0;
  completedList.forEach(e => {
    const durations = endDurations(e);
    if (durations.length < 4) return;
    sessionsWithTiming += 1;
    const median = quantile(durations.map(d => d.seconds).sort((a, b) => a - b), 0.5);
    durations.forEach(d => (d.seconds > median ? slow : fast).push(d.avg));
  });
  if (sessionsWithTiming < 3 || !slow.length || !fast.length) return { sessionsWithTiming, contrast: null };
  const summarize = (vals) => {
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.length > 1 ? vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length : 0;
    return { avg, n: vals.length, se: vals.length > 1 ? Math.sqrt(variance / vals.length) : 0 };
  };
  const a = summarize(slow), b = summarize(fast);
  const diff = a.avg - b.avg;
  const se = Math.sqrt(a.se ** 2 + b.se ** 2);
  return { sessionsWithTiming, contrast: { slow: a, fast: b, diff, se, significant: Math.abs(diff) >= 2 * se } };
}

// Median seconds per volée, session by session — the plain descriptive
// counterpart to the contrast above.
function paceTrend(completedList) {
  return completedList
    .slice()
    .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
    .map(e => {
      const durations = endDurations(e);
      if (durations.length < 2) return null;
      return {
        label: formatDateShort(e.completedAt),
        seconds: quantile(durations.map(d => d.seconds).sort((a, b) => a - b), 0.5),
      };
    })
    .filter(Boolean);
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

// Outbox: at a range, connectivity is often marginal, and every save above
// is fire-and-forget straight to Supabase with no local copy — a failed
// write used to just be gone on reload. Each upsert/delete below records
// itself here BEFORE attempting the network call and only clears itself on
// confirmed success, so a failed write survives reload/tab close and gets
// retried (see flushPending, called on boot and on the 'online' event).
//
// The key is per-account. It used to be a single global one, which meant a
// club device shared by two archers would replay whatever the first had
// queued offline under whoever signed in NEXT — flushPending writes with the
// current userId, so A's sessions landed in B's account and vanished from
// A's.
const PENDING_KEY = 'archery-scorecard-pending-v1';
const pendingKey = userId => `${PENDING_KEY}:${userId}`;

function readPending(userId) {
  try { return JSON.parse(localStorage.getItem(pendingKey(userId))) || {}; } catch { return {}; }
}
function writePending(userId, map) {
  try { localStorage.setItem(pendingKey(userId), JSON.stringify(map)); } catch { /* storage full/unavailable */ }
}
function setPending(userId, kind, id, op, data) {
  const map = readPending(userId);
  map[`${kind}:${id}`] = { kind, id, op, data };
  writePending(userId, map);
}
function clearPending(userId, kind, id) {
  const map = readPending(userId);
  delete map[`${kind}:${id}`];
  writePending(userId, map);
}

// One-time adoption of anything left in the old un-scoped key. Whoever signs
// in first inherits it — which is the very ambiguity the per-account key
// exists to remove, but it only applies to writes queued before this
// version, and dropping them on the floor would be a guaranteed loss rather
// than a hypothetical mis-attribution.
function adoptLegacyPending(userId) {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const legacy = JSON.parse(raw) || {};
    if (Object.keys(legacy).length) writePending(userId, { ...legacy, ...readPending(userId) });
    localStorage.removeItem(PENDING_KEY);
  } catch { /* ignore */ }
}
// Overlays any writes still stuck in the outbox onto freshly-loaded remote
// data, so a device that's still offline at boot shows the last edit made
// on it instead of quietly reverting to stale server state.
function applyPending(userId, loaded, kind) {
  const entries = Object.values(readPending(userId)).filter(e => e.kind === kind);
  if (entries.length === 0) return loaded;
  const { normalize } = STORES[kind];
  let list = [...loaded];
  entries.forEach(e => {
    if (e.op === 'delete') {
      list = list.filter(item => item.id !== e.id);
    } else {
      const normalized = normalize(e.data);
      const idx = list.findIndex(item => item.id === e.id);
      if (idx === -1) list.push(normalized); else list[idx] = normalized;
    }
  });
  return list;
}
async function flushPending(userId) {
  adoptLegacyPending(userId);
  for (const e of Object.values(readPending(userId))) {
    const store = STORES[e.kind];
    if (e.op === 'delete') await store.remove(userId, e.id);
    else await store.upsert(userId, e.data);
  }
}

// Sessions and tournaments are the same row shape in two tables (id, user_id,
// data jsonb, updated_at) and were originally written as two identical sets of
// load/upsert/delete functions, which is also why flushPending/applyPending
// above needed a kind-dispatch and a normalize parameter. One factory for the
// two real implementations collapses all of that: `kind` is the outbox key,
// `normalize` the on-read migration for that entity, `msg` its console strings.
function makeStore(kind, table, normalize, msg) {
  return {
    kind, normalize,
    async load(userId) {
      try {
        const { data, error } = await supabase.from(table).select('data').eq('user_id', userId);
        if (error) throw error;
        return (data || []).map(row => normalize(row.data));
      } catch (err) {
        console.error(msg.load, err);
        return [];
      }
    },
    // Records itself in the outbox BEFORE the network call and only clears on
    // confirmed success — see the PENDING_KEY comment above.
    async upsert(userId, item) {
      setPending(userId, kind, item.id, 'upsert', item);
      try {
        const { error } = await supabase.from(table).upsert({
          id: item.id, user_id: userId, data: item, updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        clearPending(userId, kind, item.id);
        return true;
      } catch (err) {
        console.error(msg.save, err);
        return false;
      }
    },
    async remove(userId, id) {
      setPending(userId, kind, id, 'delete', null);
      try {
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) throw error;
        clearPending(userId, kind, id);
        return true;
      } catch (err) {
        console.error(msg.remove, err);
        return false;
      }
    },
  };
}

// Tournaments live in their own table (same pattern as sessions) so a
// tournament can be created, scored live, and revisited across devices
// without touching the personal-scorecard data at all.
// Tournaments created before the final-format feature don't have
// finalFormat/finalStage/thirdPlaceMatch at all — treat them as the
// 'standard' format with no bronze match, i.e. exactly how they behaved
// before this feature existed.
function normalizeTournament(t) {
  if (t.finalFormat) return t;
  return { ...t, finalFormat: 'standard', finalStage: t.finalStage || null, thirdPlaceMatch: t.thirdPlaceMatch || null };
}

// The only two stores. Keys here are the outbox `kind` values, so adding a
// third entity needs nothing else: flushPending/applyPending both look it up.
const STORES = {
  session: makeStore('session', 'sessions', normalizeSession, {
    load: 'Errore nel caricamento dei dati',
    save: 'Errore nel salvataggio dei dati',
    remove: 'Errore nella eliminazione',
  }),
  tournament: makeStore('tournament', 'tournaments', normalizeTournament, {
    load: 'Errore nel caricamento dei tornei',
    save: 'Errore nel salvataggio del torneo',
    remove: 'Errore nella eliminazione del torneo',
  }),
};

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

// Email + password. Sign-in and sign-up deliberately send nothing: no
// confirmation mail, no magic link, so neither can be blocked by Supabase's
// free-tier email delivery (unreliable without custom SMTP).
//
// Password recovery is the one exception and it does depend on that
// channel — it was added later, and inherited exactly the dependency the
// rest of this screen is built to avoid. resetPasswordForEmail resolves
// once Supabase has ACCEPTED the request, not once the mail arrives, so
// there is nothing to check here and the confirmation below has to say so
// rather than promise delivery. If recovery turns out to matter on a
// competition morning, custom SMTP is the fix, not more code here.
function AuthGate() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);

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
      // A request that never reached Supabase carries no HTTP status
      // (AuthRetryableFetchError uses 0, a bare fetch failure has none).
      // Collapsing that into "wrong password" tells an archer standing at
      // a range with no signal to doubt credentials that are fine — on
      // competition morning, that sends them looking for the wrong fix.
      const status = typeof err?.status === 'number' ? err.status : 0;
      if (status === 0) setError('Connessione assente. Controlla la rete e riprova.');
      else setError(mode === 'signup' ? 'Registrazione non riuscita. Riprova.' : 'Email o password errati.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReset() {
    setBusy(true); setError('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + window.location.pathname });
      if (error) throw error;
      setResetSent(true);
      // The recovery link brings the user back with a PASSWORD_RECOVERY
      // auth event, handled at the root component — it intercepts before
      // the normal signed-in app to force setting a new password.
    } catch (err) {
      setError('Invio non riuscito. Controlla l\'indirizzo email e riprova.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'reset') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-6" style={{ background: T.bg, color: T.text }}>
        <div className="flex flex-col items-center gap-2 text-center">
          <Target size={40} color={T.gold} />
          <h1 className="text-xl font-bold">Recupera password</h1>
          <div className="text-sm max-w-xs" style={{ color: T.textDim }}>
            {resetSent
              ? 'Richiesta inviata. Se non trovi il link entro qualche minuto, controlla lo spam: la consegna delle email non è garantita. In quel caso scrivi all’organizzatore.'
              : 'Ti mandiamo un link per reimpostare la password'}
          </div>
        </div>

        {!resetSent && (
          <div className="w-full max-w-xs flex flex-col gap-3">
            <input type="email" inputMode="email" autoComplete="email" aria-label="Email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="La tua email" onKeyDown={e => e.key === 'Enter' && email && submitReset()}
              className="rounded-xl px-4 py-3 text-center" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
            <button onClick={submitReset} disabled={!email || busy}
              className="rounded-2xl py-3.5 font-bold disabled:opacity-40" style={{ background: T.gold, color: GOLD_TEXT }}>
              {busy ? '…' : 'Invia link'}
            </button>
          </div>
        )}
        <button onClick={() => { setMode('signin'); setError(''); setResetSent(false); }} className="text-sm py-1" style={{ color: T.textDim }}>
          Torna al login
        </button>
        {error && <div className="text-sm text-center" style={{ color: T.behind }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-6" style={{ background: T.bg, color: T.text }}>
      <div className="flex flex-col items-center gap-2 text-center">
        <Target size={40} color={T.gold} />
        <h1 className="text-xl font-bold">Arcieri Senesi</h1>
        <div className="text-sm max-w-xs" style={{ color: T.textDim }}>Accedi per avere i tuoi dati su tutti i dispositivi</div>
      </div>

      <div className="w-full max-w-xs flex flex-col gap-3">
        <input type="email" inputMode="email" autoComplete="email" aria-label="Email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="La tua email"
          className="rounded-xl px-4 py-3 text-center" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} aria-label="Password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Password" onKeyDown={e => e.key === 'Enter' && email && password && submit()}
          className="rounded-xl px-4 py-3 text-center" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        {mode === 'signup' && <div className="text-xs text-center" style={{ color: T.textDim }}>Almeno 6 caratteri</div>}
        <button onClick={submit} disabled={!email || !password || busy}
          className="rounded-2xl py-3.5 font-bold disabled:opacity-40" style={{ background: T.gold, color: GOLD_TEXT }}>
          {busy ? '…' : mode === 'signup' ? 'Crea account' : 'Accedi'}
        </button>
        <div className="flex items-center justify-between">
          <button onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); }} className="text-sm py-1" style={{ color: T.textDim }}>
            {mode === 'signup' ? 'Hai già un account? Accedi' : 'Primo accesso? Crea un account'}
          </button>
          {mode === 'signin' && (
            <button onClick={() => { setMode('reset'); setError(''); }} className="text-sm py-1" style={{ color: T.textDim }}>
              Password dimenticata?
            </button>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-center" style={{ color: T.behind }}>{error}</div>}
    </div>
  );
}

// Landing screen after a password-recovery email link — supabase.auth
// fires a PASSWORD_RECOVERY event with a valid (recovery) session, but the
// user hasn't actually chosen a new password yet. Intercepting here at the
// root, instead of just letting the recovery session log them straight
// into the app, is what makes "forgot password" actually resolve losing
// access instead of just resending the same unusable credential.
function SetNewPasswordScreen({ onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      onDone();
    } catch (err) {
      setError('Impossibile impostare la password. Riprova.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-6" style={{ background: T.bg, color: T.text }}>
      <div className="flex flex-col items-center gap-2 text-center">
        <Target size={40} color={T.gold} />
        <h1 className="text-xl font-bold">Imposta una nuova password</h1>
      </div>
      <div className="w-full max-w-xs flex flex-col gap-3">
        <input type="password" autoComplete="new-password" aria-label="Nuova password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Nuova password" onKeyDown={e => e.key === 'Enter' && password.length >= 6 && submit()}
          className="rounded-xl px-4 py-3 text-center" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        <div className="text-xs text-center" style={{ color: T.textDim }}>Almeno 6 caratteri</div>
        <button onClick={submit} disabled={password.length < 6 || busy}
          className="rounded-2xl py-3.5 font-bold disabled:opacity-40" style={{ background: T.gold, color: GOLD_TEXT }}>
          {busy ? '…' : 'Salva password'}
        </button>
      </div>
      {error && <div className="text-sm text-center" style={{ color: T.behind }}>{error}</div>}
    </div>
  );
}

// ---------- target face ----------

// Center offsets (in FACE_R=100 units) for each spot of a multi-spot face,
// arranged the way a real WA/Vegas triple sheet is printed: a vertical
// column, or a triangle with one spot at the apex and two along the base.
// A small gap beyond edge-to-edge spacing (2*FACE_R apart) keeps adjacent
// spots visually separated instead of touching.
function spotOffsets(spotLayout) {
  const gap = 16;
  const step = FACE_R * 2 + gap;
  if (spotLayout === 'vertical3') return [{ x: 0, y: -step }, { x: 0, y: 0 }, { x: 0, y: step }];
  if (spotLayout === 'triangular3') {
    const h = step * Math.sqrt(3) / 2;
    return [{ x: -step / 2, y: h / 3 }, { x: 0, y: -2 * h / 3 }, { x: step / 2, y: h / 3 }];
  }
  return [{ x: 0, y: 0 }];
}

// Renders one spot's rings + arrow marks + group overlay, already inside
// whatever <g transform> positions it — shared between the single-spot and
// multi-spot layouts so there's exactly one place that draws a target.
function SpotRings({ ringClass, centroid, groupRadius, points, dense }) {
  const { specs, xOuter, minRing } = ringGeometry(ringClass);
  return (
    <>
      <circle cx={0} cy={0} r={FACE_R + 3} fill="none" stroke={T.borderStrong} strokeWidth={1.5} />
      {specs.filter(spec => spec.score >= minRing).map(spec => {
        const c = SCORE_COLORS[spec.group];
        const strokeColor = spec.group === 'black' ? 'rgba(230,225,215,0.45)' : 'rgba(15,13,8,0.35)';
        return <circle key={spec.score} cx={0} cy={0} r={spec.outer} fill={c.fill} stroke={strokeColor} strokeWidth={0.6} />;
      })}
      <circle cx={0} cy={0} r={xOuter} fill="none" stroke="rgba(15,13,8,0.55)" strokeWidth={0.6} />

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
            stroke={p.ghost ? 'none' : T.markStroke} strokeWidth={p.ghost ? 0 : 0.5} opacity={opacity} />
        );
      })}
    </>
  );
}

// `spotLayout` beyond 'single' (the default) renders 2-3 independent mini
// faces instead of one — a real WA/Vegas triple sheet. `onTap` is always
// `(spotIdx, x, y)`; single-spot callers just get spotIdx 0 every time.
// On a multi-spot face `zoomSpot` picks which spot the zoom crops around
// (the whole sheet has no single "middle" worth magnifying), so the caller
// drives it from whichever spot is being shot.
function TargetFace({ faceCm, ringClass = 'full', spotLayout = 'single', zoom = 1, zoomSpot = 0, interactive = false, onTap, points = [], centroid = null, dense = false }) {
  const svgRef = useRef(null);
  const isMulti = spotLayout !== 'single';
  const offsets = spotOffsets(spotLayout);
  // `centroid` may be one group (single-spot, or one shared reading) or an
  // array indexed by spot. Each spot is aimed at separately, so drawing one
  // pooled crosshair across all three would show every spot a group that
  // none of them actually shot.
  const centroidFor = (i) => (Array.isArray(centroid) ? centroid[i] || null : centroid);
  const spotRadiusCm = spotFaceCm(faceCm, spotLayout) / 2;
  const groupRadiusFor = (c) => (c && c.maxRadiusCm != null && c.maxRadiusCm > 0
    ? (c.maxRadiusCm / spotRadiusCm) * FACE_R
    : null);

  let vbX, vbY, vbW, vbH;
  if (isMulti) {
    const spotR = FACE_R + 3;
    const xs = offsets.map(o => o.x), ys = offsets.map(o => o.y);
    const minX = Math.min(...xs) - spotR, maxX = Math.max(...xs) + spotR;
    const minY = Math.min(...ys) - spotR, maxY = Math.max(...ys) + spotR;
    // The viewport is square and preserveAspectRatio letterboxes, so what's
    // actually visible is the sheet's longer side — that's the extent zoom
    // divides, keeping "2×" the same linear magnification it means for a
    // single face. At 1× the whole sheet stays framed; past that the crop
    // recenters on the chosen spot, since a triple sheet's midpoint is
    // empty paper on a vertical layout and not on any spot at all.
    const base = Math.max(maxX - minX, maxY - minY) / 2;
    const half = base / zoom;
    const focus = zoom > 1
      ? (offsets[zoomSpot] || offsets[0])
      : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    vbX = focus.x - half; vbY = focus.y - half; vbW = half * 2; vbH = half * 2;
  } else {
    // Zoom always crops around the target's true center (the bullseye), not
    // wherever the current group happens to be — a zoomed-in view should show
    // "the middle of the target," which is what a scorer expects the crop to
    // mean, even if that means a group that's drifted off-center runs closer
    // to the edge of the zoomed crop.
    const margin = interactive && zoom === 1 ? 15 : 0;
    const half = FACE_R / zoom + margin;
    vbX = -half; vbY = -half; vbW = half * 2; vbH = half * 2;
  }
  const vb = `${vbX} ${vbY} ${vbW} ${vbH}`;

  function handlePointerDown(evt) {
    if (!interactive || !svgRef.current) return;
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const loc = pt.matrixTransform(ctm.inverse());
    for (let i = 0; i < offsets.length; i++) {
      const x = (loc.x - offsets[i].x) / FACE_R;
      const y = (loc.y - offsets[i].y) / FACE_R;
      if (Math.sqrt(x * x + y * y) <= 1.15) { onTap(i, x, y); return; }
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto aspect-square rounded-2xl overflow-hidden" style={{ background: T.bgElevated }}>
      <svg ref={svgRef} viewBox={vb} className="w-full h-full touch-none" onPointerDown={handlePointerDown}>
        {offsets.map((o, i) => {
          const c = centroidFor(i);
          return (
            <g key={i} transform={`translate(${o.x} ${o.y})`}>
              <SpotRings ringClass={ringClass} centroid={c} groupRadius={groupRadiusFor(c)} dense={dense}
                points={points.filter(p => !isMulti || (p.spot || 0) === i)} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// The written half of a group reading: where it sits, how wide, which way
// it scatters. Descriptive by design — the offset doubles as the size of
// the correction that would centre the group, but what to change to get
// there (sight, anchor, stance, spine, wind) is not in this data.
function sightAdviceText(advice, stats) {
  if (!advice) return null;
  switch (advice.verdict) {
    case 'insufficient':
      return `Ancora poche frecce per giudicare la mira (${advice.stats.count} di ${advice.needed}).`;
    case 'centred':
      return 'Nessuna correzione: lo scarto rientra nel margine di errore.';
    case 'unstable':
      return `Gruppo non stabile: si è spostato di ${advice.driftCm.toFixed(1)} cm tra prima e seconda metà, quindi non c'è un unico scarto da correggere.`;
    case 'spread':
      return `La dispersione (${stats.meanRadiusCm.toFixed(1)} cm) è più larga dello scarto: la costanza pesa più della mira.`;
    case 'adjust':
      return 'Scarto stabile e più largo della dispersione: correzione utile.';
    default:
      return null;
  }
}

function GroupReadout({ shape, advice, round, arrows }) {
  const stats = shape ? shape.stats : null;
  const positioned = useMemo(() => (arrows || []).filter(a => a.x != null && a.y != null), [arrows]);
  // The offset in points, which is the currency the decision is actually
  // made in: a centimetre of offset on a 122cm face and on a Vegas spot are
  // not the same mistake, and only this converts them.
  const model = useMemo(
    () => (stats && stats.count >= SIGHT_MIN_ARROWS && round ? pointsBreakdown(stats, round) : null),
    [stats, round]);
  const flyers = useMemo(() => (round ? separateFlyers(positioned, round) : null), [positioned, round]);
  if (!shape) return null;
  const { offsetCm, offCentre, headline, axis } = shape;
  const adviceText = sightAdviceText(advice, stats);
  const mrad = round ? angularDispersionMrad(stats, round.distanceM) : null;
  // Printed next to the model so a bad fit is visible instead of implied.
  // The model assumes a normal group; a session with flyers in it will show
  // the two numbers pulling apart, which is information, not an error.
  const actual = positioned.length
    ? positioned.reduce((s, a) => s + a.score, 0) / positioned.length
    : null;
  return (
    <div className="text-xs flex flex-col gap-0.5" style={{ color: T.textDim }}>
      <div className="font-semibold" style={{ color: T.text }}>{headline}</div>
      <div>
        {offCentre
          ? `Scarto ${describeBias(stats.cxCm, stats.cyCm)}${
              // The combined figure only says something new when the offset
              // has two components — on a purely sideways or purely vertical
              // one it just repeats the number describeBias already gave.
              Math.abs(stats.cxCm) >= 0.3 && Math.abs(stats.cyCm) >= 0.3
                ? ` (${offsetCm.toFixed(1)} cm in totale)` : ''}`
          : 'Centro entro il margine di errore'}
      </div>
      <div>
        Ampiezza {stats.maxRadiusCm.toFixed(1)} cm · media {stats.meanRadiusCm.toFixed(1)} cm
        {axis ? ` · dispersione ${axis}` : ''} · {stats.count} frecce
        {mrad != null ? ` · ${mrad.toFixed(1)} mrad` : ''}
      </div>
      {model && (
        <div style={{ color: T.text }}>
          Centrare il gruppo vale <span style={{ color: T.gold, fontWeight: 700 }}>+{model.aim.toFixed(2)}</span> punti a freccia
          {' '}· la dispersione ne costa {model.spread.toFixed(2)}
        </div>
      )}
      {model && actual != null && (
        <div style={{ color: T.textFaint }}>
          Modello {model.expected.toFixed(2)} · reale {actual.toFixed(2)} punti a freccia
        </div>
      )}
      {/* Only when setting the thrown arrows aside actually changes the
          reading. On a 60-arrow group a single arrow just past 3 sigma
          moves the mean by less than the printed decimal, and "il nucleo
          misura 2.0 cm invece di 2.0" is a sentence that says nothing. */}
      {flyers && flyers.coreStats && stats.meanRadiusCm - flyers.coreStats.meanRadiusCm >= 0.05 && (
        <div style={{ color: T.textFaint }}>
          {flyers.flyers.length} frecc{flyers.flyers.length === 1 ? 'ia' : 'e'} fuori gruppo: senza
          {flyers.flyers.length === 1 ? ' quella' : ' quelle'} il gruppo misura {flyers.coreStats.meanRadiusCm.toFixed(1)} cm
          {' '}invece di {stats.meanRadiusCm.toFixed(1)}
        </div>
      )}
      {adviceText && (
        <div style={{ color: advice.verdict === 'adjust' ? T.gold : T.textFaint }}>{adviceText}</div>
      )}
    </div>
  );
}

// One target per spot, each with its own arrows, its own group overlay and
// its own reading — plus, when the spots genuinely disagree, the one line a
// pooled group can never produce. Renders a single face for a single-spot
// round, so both kinds of round go through the same path.
function GroupAnalysis({ round, arrows, dense = true }) {
  const layout = roundSpotLayout(round);
  const isMulti = layout !== 'single';
  const perSpot = groupStatsBySpot(round, arrows);
  const shapes = perSpot.map(p => describeGroupShape(p.stats, round));
  const gap = isMulti ? widestSpotGap(perSpot) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className={isMulti ? 'grid grid-cols-1 sm:grid-cols-3 gap-4' : ''}>
        {perSpot.map(({ spot, arrows: spotArrows, stats }) => (
          <div key={spot} className="flex flex-col gap-2">
            {isMulti && (
              <div className="text-xs font-semibold uppercase tracking-wide flex items-baseline gap-2" style={{ color: T.textFaint }}>
                <span>Spot {spot + 1}</span>
                {/* Per-spot SCORE, not just per-spot geometry: the spots are
                    scored the same and a spot that quietly averages half a
                    point below the others is the plainest possible statement
                    of the same thing the group offsets are hinting at. */}
                {spotArrows.length > 0 && (
                  <span style={{ color: T.textDim }}>
                    media {(spotArrows.reduce((s, a) => s + a.score, 0) / spotArrows.length).toFixed(2)} su {spotArrows.length}
                  </span>
                )}
              </div>
            )}
            <TargetFace faceCm={spotFaceCm(round.faceCm, layout)} ringClass={roundRingClass(round)}
              points={spotArrows.filter(a => a.x != null)} centroid={stats} dense={dense} />
            {stats
              ? <GroupReadout shape={shapes[spot]} advice={assessSightAdjustment(spotArrows, round)} round={round} arrows={spotArrows} />
              : <div className="text-xs" style={{ color: T.textFaint }}>Nessuna freccia con posizione registrata.</div>}
          </div>
        ))}
      </div>
      {gap && (
        <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.textDim }}>
          Lo spot {gap.a + 1} e lo spot {gap.b + 1} sono spostati di {gap.gapCm.toFixed(1)} cm l'uno rispetto all'altro:
          {' '}più della dispersione dei due gruppi, quindi vanno corretti separatamente e non come un unico gruppo.
        </div>
      )}
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
// yyyy-mm-dd in the LOCAL timezone, for <input type="date">. Slicing the
// ISO string instead gives the UTC date, which for a session started just
// after midnight local time is the previous day — the picker would then
// disagree with the date shown everywhere else (formatDateFull and friends
// all render locally), and touching it would silently shift the session.
function localDateInputValue(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

  return (
    <div className="flex flex-col gap-3 w-full rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="text-sm font-semibold" style={{ color: T.textDim }}>Dettagli</div>

      <input type="date" value={localDateInputValue(session.startedAt)} onChange={e => e.target.value && onUpdate(s => withSessionDate(s, e.target.value))}
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
            className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 min-h-11"
            style={{
              background: isActive(o.id) ? T.surfaceAlt : T.surface,
              border: `1px solid ${isActive(o.id) ? T.gold : T.border}`,
              color: isActive(o.id) ? T.gold : T.textDim,
            }}>
            {/* Multi-select rows get a checkbox glyph so they read as
                "toggle any of these" at a glance, distinct from the plain
                pill used for single-choice rows (choose exactly one). */}
            {multi && (
              <span className="w-3 h-3 rounded-[3px] flex items-center justify-center shrink-0"
                style={{ border: `1.5px solid ${isActive(o.id) ? T.gold : T.textFaint}`, background: isActive(o.id) ? T.gold : 'transparent' }}>
                {isActive(o.id) && <Check size={9} color={GOLD_TEXT} strokeWidth={3} />}
              </span>
            )}
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
    <div className="px-4 py-6 flex flex-col gap-5 items-center text-center w-full max-w-3xl mx-auto">
      <div>
        <div className="text-sm uppercase tracking-wide flex items-center gap-2 justify-center" style={{ color: T.textDim }}>
          {session.status === 'partial' ? 'Sessione interrotta' : 'Sessione completata'}
          <SessionTypeBadge sessionType={session.sessionType} />
        </div>
        <div className="text-5xl font-bold" style={numeralStyle}>{total}</div>
        <div className="text-sm mt-1" style={{ color: T.textDim }}>
          <SessionName session={session} /> · media {avg.toFixed(2)} · {sessionXCount(session)} X
          {bowLabel(session.bowType) ? ` · ${bowLabel(session.bowType)}` : ''}
        </div>
        {session.status === 'partial' && (
          <div className="text-xs mt-2" style={{ color: T.textFaint }}>
            {shot} frecce su {sessionPlannedArrows(session)}
            {sessionArrowsShot(session) >= MIN_ARROWS_FOR_PARTIAL_STATS
              ? ' · conta nelle medie, non tra i primati'
              : ` · sotto le ${MIN_ARROWS_FOR_PARTIAL_STATS} frecce, non entra nelle statistiche`}
          </div>
        )}
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
  // Opens at whatever zoom makes this face's 10-ring as tappable as a
  // recurve face is at 1× — see defaultZoomFor. Re-derived when the stage
  // changes, since a multi-distance round can move between faces that need
  // very different zoom (and a level the previous face offered, like 8×,
  // may not exist on the next one).
  const [noteOpen, setNoteOpen] = useState(false);
  // The end currently being shot is buffered locally, not written into
  // session state arrow-by-arrow — there's no telling what the last arrow
  // of an end actually was from the target face alone (colors are close,
  // chips are small), so the whole end needs a confirm step before it
  // locks in and the screen moves on to the next one. See confirmEnd().
  const [pending, setPending] = useState([]);
  // Which spot (0..spotCount-1) the next arrow goes to on a multi-spot
  // face — drives the keypad-mode spot selector and the miss button's
  // target. Auto-follows nextOpenSpot (see the effect below) so it always
  // starts pointed at an open spot, but a manual pick in between two fills
  // sticks until the next arrow actually lands.
  const [activeSpot, setActiveSpot] = useState(0);

  const isComplete = session.status === 'completed';
  // A session closed early is finished too — it just isn't complete.
  // Everything that asks "can I still shoot this?" keys off isFinished;
  // only the header label distinguishes the two.
  const isFinished = isComplete || session.status === 'partial';
  const stageIdx = activeStageIndex(session);
  const stage = session.stages[stageIdx];
  const round = stage.round;
  const spotLayout = roundSpotLayout(round);
  const isMultiSpot = spotLayout !== 'single';
  const multiStage = session.stages.length > 1;
  const zoomLevels = zoomLevelsFor(round);
  const [zoom, setZoom] = useState(() => defaultZoomFor(round));
  const roundKey = roundShapeKey(round);
  useEffect(() => { setZoom(defaultZoomFor(round)); }, [roundKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const endIdx = currentEndIndex(stage);
  // stage.ends[endIdx] only gains arrows once confirmEnd() commits them —
  // except when it's been reopened by undoing back into an already-scored
  // end (see handleUndo), in which case it can already hold some confirmed
  // arrows. Either way, `pending` is what's still unconfirmed on top of
  // whatever's already there, so the display view is the two concatenated.
  const currentEnd = useMemo(
    () => ({ ...stage.ends[endIdx], arrows: [...stage.ends[endIdx].arrows, ...pending] }),
    [stage, endIdx, pending]);
  const displayStage = useMemo(
    () => ({ ...stage, ends: stage.ends.map((e, i) => (i === endIdx ? currentEnd : e)) }),
    [stage, endIdx, currentEnd]);
  const ghostArrows = useMemo(() => displayStage.ends.slice(0, endIdx).flatMap(e => e.arrows), [displayStage, endIdx]);
  const endReady = currentEnd.arrows.length >= round.arrowsPerEnd;

  // One arrow per spot per end on a multi-spot face — a real rule, not a
  // UI convenience, so it's enforced here rather than left to arrowsPerEnd
  // alone (which only caps the *count*, not which spots it's spread over).
  const filledSpots = useMemo(() => new Set(currentEnd.arrows.map(a => a.spot || 0)), [currentEnd]);
  const nextOpenSpot = useMemo(() => {
    for (let i = 0; i < spotCount(spotLayout); i++) if (!filledSpots.has(i)) return i;
    return 0;
  }, [filledSpots, spotLayout]);
  useEffect(() => { setActiveSpot(nextOpenSpot); }, [nextOpenSpot]);

  // Stats are scoped to the stage currently being shot, since that's what a
  // personal best is scoped to — the session-wide total (shown separately
  // for multi-stage rounds) would mix distances into a meaningless number.
  // Computed off displayStage so they update live as arrows are entered,
  // even though nothing is actually saved until the end is confirmed.
  const total = totalScore(displayStage);
  const shot = arrowsShotCount(displayStage);
  const avg = shot ? total / shot : 0;
  const projected = shot ? Math.round(avg * totalArrowsInRound(displayStage)) : null;
  const sessionTotalSoFar = sessionTotalScore(session) + total - totalScore(stage);

  const entries = useMemo(() => stageEntries(sessions), [sessions]);
  const pb = useMemo(
    () => findPersonalBest(entries, { round, bowType: session.bowType, sessionType: session.sessionType }, session.id),
    [entries, round, session.bowType, session.sessionType, session.id]);
  const pace = shot ? paceVsPB(displayStage, pb) : null;

  const last3 = useMemo(() => {
    const withArrows = displayStage.ends.filter(e => e.arrows.length > 0);
    return withArrows.slice(-3).flatMap(e => e.arrows);
  }, [displayStage]);
  // Per spot, not pooled — on a triple face each spot is aimed at
  // separately, so one shared crosshair drawn over all three would show
  // every spot a group none of them shot. For a single-spot round this is
  // a one-element array and behaves exactly as before.
  const perSpot3 = useMemo(() => groupStatsBySpot(round, last3), [round, last3]);
  const spotShapes3 = useMemo(() => perSpot3.map(p => describeGroupShape(p.stats, round)), [perSpot3, round]);
  const centroids3 = isMultiSpot ? perSpot3.map(p => p.stats) : perSpot3[0].stats;
  const anySpotStats = perSpot3.some(p => p.stats);
  const endsShotCount = displayStage.ends.filter(e => e.arrows.length > 0).length;

  function handleAddArrow(score, isX, x, y, spot = 0) {
    if (isFinished || endReady) return;
    if (isMultiSpot && filledSpots.has(spot)) return; // that spot already has its one arrow this end
    setPending(p => [...p, { score, isX, x: x ?? null, y: y ?? null, ...(isMultiSpot ? { spot } : {}) }]);
  }

  function handleFaceTap(spotIdx, x, y) {
    const d = Math.sqrt(x * x + y * y) * FACE_R;
    const r = scoreFromRadiusUnits(d, roundRingClass(round));
    handleAddArrow(r.score, r.isX, x, y, spotIdx);
  }

  // Undo pops the still-unconfirmed end first — nothing saved yet, so
  // that's a free local edit. Once there's nothing pending, it falls
  // through to reopening the last *confirmed* end, same as before.
  function handleUndo() {
    if (pending.length > 0) { setPending(p => p.slice(0, -1)); return; }
    onUpdate(s => sessionUndoLastArrow(s));
  }

  function confirmEnd() {
    if (!endReady) return;
    onUpdate(s => sessionConfirmEnd(s, pending));
    setPending([]);
  }

  return (
    <div className="flex flex-col w-full max-w-3xl mx-auto min-h-screen">
      <header className="sticky top-0 z-10 flex items-center justify-between px-3 py-3" style={{ background: T.bg, borderBottom: `1px solid ${T.border}` }}>
        <button onClick={onExit} className="p-2 -ml-2 rounded-full active:scale-95 transition-transform min-w-11 min-h-11 flex items-center justify-center" aria-label="Indietro"><ChevronLeft /></button>
        <div className="text-center">
          <div className="font-semibold leading-tight flex items-center gap-2 justify-center">
            <SessionName session={session} />
            <SessionTypeBadge sessionType={session.sessionType} />
          </div>
          <div className="text-xs" style={{ color: T.textDim }}>
            {isComplete ? 'Completata' : session.status === 'partial' ? 'Interrotta' : sessionProgressLabel(session)}
            {bowLabel(session.bowType) ? ` · ${bowLabel(session.bowType)}` : ''}
          </div>
        </div>
        <button onClick={() => setNoteOpen(o => !o)} className="p-2 -mr-2 rounded-full active:scale-95 transition-transform"><StickyNote size={20} /></button>
      </header>

      {noteOpen && !isFinished && (
        <div className="px-4 py-3" style={{ background: T.surface, borderBottom: `1px solid ${T.border}` }}>
          <SessionMetaEditor session={session} onUpdate={onUpdate} />
        </div>
      )}

      {!isFinished && (
        <>
          {multiStage && (
            <div className="px-4 pt-3 text-xs text-center" style={{ color: T.textDim }}>
              Totale sessione finora: <span style={{ ...numeralStyle, color: T.text, fontWeight: 700 }}>{sessionTotalSoFar}</span>
              {' '}· tappa attuale {round.distanceM}m / {round.faceCm}cm
            </div>
          )}
          <StatsBar total={total} avg={avg} projected={projected} pace={pace} hasPb={!!pb} />

          {/* Wraps rather than overflowing: the mode control plus a four-step
              zoom ladder (compound faces get 8×) is wider than a narrow
              phone, and without wrapping the excess pushed the whole page
              into a horizontal scroll instead of moving to a second line. */}
          <div className="px-4 pt-3 flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl options={[{ id: 'face', label: 'Bersaglio' }, { id: 'keypad', label: 'Tastierino' }]} value={mode} onChange={setMode} />
            {mode === 'face' && (
              <SegmentedControl options={zoomLevels.map(z => ({ id: z, label: `${z}×` }))} value={zoom} onChange={setZoom} small />
            )}
          </div>

          {/* Which spot the zoom is pointed at. Only meaningful once zoomed
              in — at 1× the whole sheet is framed and there's nothing to
              aim — so it appears with the zoom rather than sitting inert.
              Shares `activeSpot` with the keypad's spot selector, so the
              view follows along to the next open spot as the end fills. */}
          {mode === 'face' && isMultiSpot && zoom > 1 && (
            <div className="px-4 pt-3 flex items-center gap-2">
              <span className="text-xs shrink-0" style={{ color: T.textDim }}>Zoom su</span>
              <SegmentedControl
                options={Array.from({ length: spotCount(spotLayout) }, (_, i) => ({ id: i, label: String(i + 1) }))}
                value={activeSpot} onChange={setActiveSpot} small />
            </div>
          )}

          <div className="px-4 pt-3">
            {mode === 'face' ? (
              <TargetFace
                faceCm={round.faceCm}
                ringClass={roundRingClass(round)}
                spotLayout={spotLayout}
                zoom={zoom}
                zoomSpot={activeSpot}
                interactive
                onTap={handleFaceTap}
                points={[...ghostArrows.map(a => ({ ...a, ghost: true })), ...currentEnd.arrows.map(a => ({ ...a, ghost: false }))]}
                centroid={centroids3}
              />
            ) : (
              <div className="flex flex-col gap-3">
                {isMultiSpot && (
                  <SegmentedControl
                    options={Array.from({ length: spotCount(spotLayout) }, (_, i) => ({ id: i, label: String(i + 1) }))}
                    value={activeSpot} onChange={setActiveSpot} />
                )}
                <Keypad onScore={(score, isX) => handleAddArrow(score, isX, null, null, activeSpot)} />
              </div>
            )}
          </div>

          {mode === 'face' && (
            <div className="px-4 pt-3">
              <button onClick={() => handleAddArrow(0, false, null, null, nextOpenSpot)} disabled={endReady}
                className="w-full rounded-xl py-2.5 text-sm font-bold disabled:opacity-40"
                style={{ background: SCORE_COLORS.miss.fill, color: SCORE_COLORS.miss.text }}>
                Freccia a vuoto (M)
              </button>
            </div>
          )}

          {mode === 'face' && anySpotStats && (
            <div className="px-4 pt-2 text-sm flex flex-col gap-1" style={{ color: T.textDim }}>
              <div className="text-xs uppercase tracking-wide" style={{ color: T.textFaint }}>
                Gruppo · ultime {Math.min(3, endsShotCount)} volée
              </div>
              {perSpot3.map(({ spot, stats }) => stats && (
                <div key={spot}>
                  {isMultiSpot ? `Spot ${spot + 1}: ` : ''}
                  {spotShapes3[spot].offCentre ? describeBias(stats.cxCm, stats.cyCm) : 'centrato'}
                  {' '}· ampiezza {stats.maxRadiusCm.toFixed(1)} cm
                </div>
              ))}
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
            <button onClick={confirmEnd} disabled={!endReady}
              className="w-full mt-3 rounded-2xl py-3.5 font-bold disabled:opacity-40"
              style={{ background: T.gold, color: GOLD_TEXT }}>
              Conferma volée
            </button>
          </div>

          <div className="px-4 pb-8 flex flex-col">
            <Disclosure label="Termina la sessione qui" icon={Check}>
              {close => (
                <>
                  <div className="text-xs" style={{ color: T.textDim }}>
                    Chiude la sessione con le {shot} frecce già confermate delle {totalArrowsInRound(stage)} previste
                    {pending.length > 0 ? ` (la volée in corso, non confermata, viene scartata)` : ''}.
                    {' '}Le frecce restano nello storico e contano nelle medie, ma una prova interrotta non entra tra i primati.
                    {' '}Puoi riaprirla dal dettaglio della sessione.
                  </div>
                  <button onClick={() => { close(); onUpdate(s => closeSessionEarly(s)); }}
                    className="rounded-xl py-2.5 text-sm font-bold" style={{ background: T.gold, color: GOLD_TEXT }}>
                    Termina sessione
                  </button>
                </>
              )}
            </Disclosure>
          </div>
        </>
      )}

      {isFinished && <SessionSummary session={session} sessions={sessions} onExit={onExit} onUpdate={onUpdate} />}
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
    <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={goBack} className="p-2 -ml-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" aria-label="Indietro"><ChevronLeft /></button>
        <h1 className="text-xl font-bold">{NEW_SESSION_TITLES[step]}</h1>
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
                        <button onClick={() => setFree(f => f.filter((_, j) => j !== i))} className="p-1.5 rounded-full min-w-11 min-h-11 flex items-center justify-center" style={{ color: T.textDim }} aria-label={`Rimuovi tappa ${i + 1}`}>
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
// Import is a trust boundary: whatever comes out of the file picker gets
// upserted to Supabase BEFORE anything renders it, so a wrong file used to
// persist and then crash every render of Storico
// (flattenArrows -> stage.ends.flatMap on an undefined `ends`), leaving the
// account broken until the rows were deleted server-side. Checking the
// shape first turns that into a message. Deliberately structural only — it
// asks "can the app read this?", not "are these scores plausible".
function isImportableSession(s) {
  if (!s || typeof s !== 'object' || typeof s.id !== 'string') return false;
  // Pre-v1.4 files carry a flat round+ends; normalizeSession wraps those.
  const stages = s.stages || (s.round && s.ends ? [{ round: s.round, ends: s.ends }] : null);
  if (!Array.isArray(stages) || stages.length === 0) return false;
  return stages.every(st =>
    st && st.round &&
    Number.isFinite(st.round.arrowsPerEnd) && Number.isFinite(st.round.ends) &&
    Number.isFinite(st.round.distanceM) && Number.isFinite(st.round.faceCm) &&
    Array.isArray(st.ends) &&
    st.ends.every(e => e && Array.isArray(e.arrows) && e.arrows.every(a => a && Number.isFinite(a.score))));
}

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
        const usable = list.filter(isImportableSession);
        if (!usable.length) throw new Error('no valid sessions');
        onImport(usable);
        const skipped = list.length - usable.length;
        setStatus(skipped
          ? `Importate ${usable.length} sessioni · ${skipped} ignorate perché non leggibili`
          : `Importate ${usable.length} sessioni`);
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
      <button onClick={() => inputRef.current?.click()} className="p-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" style={{ background: T.surface, border: `1px solid ${T.border}` }} aria-label="Importa sessioni">
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

// A horizontally-scrolling chip row has no visual cue that more chips sit
// off-screen once it overflows — a standing edge fade signals it without
// tracking scroll position in JS. Harmless when the row already fits: the
// mask only ever bites into space that's off-screen or already empty.
function ScrollFadeRow({ children }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1"
      style={{
        WebkitMaskImage: 'linear-gradient(to right, transparent, black 12px, black calc(100% - 20px), transparent)',
        maskImage: 'linear-gradient(to right, transparent, black 12px, black calc(100% - 20px), transparent)',
      }}>
      {children}
    </div>
  );
}

function FilterChip({ active, onClick, label }) {
  return (
    <button onClick={onClick} className="whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium min-h-11 flex items-center"
      style={{ background: active ? T.gold : T.surface, color: active ? GOLD_TEXT : T.textDim, border: `1px solid ${active ? T.gold : T.border}` }}>
      {label}
    </button>
  );
}

function ChartCard({ title, subtitle, children, tall = false }) {
  return (
    <div className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div>
        <div className="text-sm font-semibold" style={{ color: T.textDim }}>{title}</div>
        {subtitle && <div className="text-xs" style={{ color: T.textFaint }}>{subtitle}</div>}
      </div>
      {/* overflow-x-clip is a backstop, not the fix: tooltip width is
          capped at the source (TOOLTIP_STYLE). It's here so that no future
          chart can make the whole page scroll sideways on a phone the way
          the angular-dispersion tooltip did. `clip` rather than `hidden`
          because hidden would make this a scroll container and break
          sticky positioning; clip leaves the vertical axis visible. */}
      <div className={`overflow-x-clip ${tall ? 'h-48' : 'h-40'}`}>{children}</div>
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
  const isPartial = session.status === 'partial';
  return (
    <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <button onClick={onOpen} className="flex-1 text-left flex items-center justify-between gap-2 min-w-0 min-h-11">
        <div className="min-w-0">
          <div className="font-semibold truncate flex items-center gap-2">
            <span className="truncate"><SessionName session={session} /></span>
            <SessionTypeBadge sessionType={session.sessionType} />
            {!isDone && (
              <span className="text-xs font-normal shrink-0" style={{ color: isPartial ? T.textFaint : T.gold }}>
                {isPartial ? 'interrotta' : 'in corso'}
              </span>
            )}
          </div>
          <div className="text-xs truncate" style={{ color: T.textDim }}>
            {formatDateFull(session.startedAt)}
            {bowLabel(session.bowType) ? ` · ${bowLabel(session.bowType)}` : ''}
            {session.location ? ` · ${session.location}` : ''}{session.note ? ` · ${session.note}` : ''}
          </div>
        </div>
        <div className="text-lg font-bold shrink-0" style={numeralStyle}>
          {isDone || isPartial ? sessionTotalScore(session) : sessionProgressBadge(session)}
        </div>
      </button>
      <button onClick={() => (confirming ? onDelete() : setConfirming(true))} className="p-2 rounded-full shrink-0 min-w-11 min-h-11 flex items-center justify-center"
        style={{ background: confirming ? T.red : 'transparent', color: confirming ? T.onRed : T.textFaint }}
        aria-label={confirming ? 'Conferma eliminazione' : 'Elimina sessione'}>
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
  const matchingEntries = filterId === 'all' ? [] : allEntries.filter(e => roundShapeKey(e.round) === filterId);

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Storico</h1>
        <div className="flex items-center gap-2">
          <ImportButton onImport={onImport} />
          <button onClick={() => exportJson(sessions)} className="p-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" style={{ background: T.surface, border: `1px solid ${T.border}` }} aria-label="Esporta sessioni">
            <Download size={18} />
          </button>
          <button onClick={onSignOut} className="p-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" style={{ background: T.surface, border: `1px solid ${T.border}` }} aria-label="Esci">
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <ScrollFadeRow>
          <FilterChip active={filterId === 'all'} onClick={() => setFilterId('all')} label="Tutte le prove" />
          {stageShapes.map(s => <FilterChip key={s.key} active={filterId === s.key} onClick={() => setFilterId(s.key)} label={roundShapeLabel(s.round)} />)}
        </ScrollFadeRow>
        <ScrollFadeRow>
          <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} label="Tutti i tipi" />
          {SESSION_TYPES.map(t => <FilterChip key={t.id} active={typeFilter === t.id} onClick={() => setTypeFilter(t.id)} label={t.label} />)}
        </ScrollFadeRow>
        <ScrollFadeRow>
          <FilterChip active={bowFilter === 'all'} onClick={() => setBowFilter('all')} label="Tutti gli archi" />
          {BOW_TYPES.map(b => <FilterChip key={b.id} active={bowFilter === b.id} onClick={() => setBowFilter(b.id)} label={b.label} />)}
        </ScrollFadeRow>
      </div>

      {filterId === 'all' && (
        <div className="text-sm" style={{ color: T.textDim }}>{typeAndBowFiltered.length} sessioni. Seleziona una prova per filtrare l'elenco.</div>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold" style={{ color: T.textDim }}>Sessioni</div>
        {filterId === 'all' ? (
          <>
            {typeAndBowFiltered.length === 0 && <div className="text-sm" style={{ color: T.textDim }}>Nessuna sessione.</div>}
            {typeAndBowFiltered.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).map(s => (
              <SessionRow key={s.id} session={s} onOpen={() => (s.status === 'in_progress' ? onResume(s.id) : onOpen(s.id))} onDelete={() => onDelete(s.id)} />
            ))}
          </>
        ) : (
          <>
            {matchingEntries.length === 0 && <div className="text-sm" style={{ color: T.textDim }}>Nessuna sessione.</div>}
            {matchingEntries.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).map((e, i) => (
              <StageEntryRow key={`${e.sessionId}-${e.stageIndex}`} entry={e} onOpen={() => (e.status === 'in_progress' ? onResume(e.sessionId) : onOpen(e.sessionId))} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// Groups distinct stage shapes into a stable key for the round filter — a
// custom/multi-stage round's shape isn't a fixed preset id, so the filter
// list is built from what's actually been shot. Distance + face only (see
// sameRound()) — how a round was chunked into ends doesn't change what
// round it is.
function roundShapeKey(round) { return `${round.distanceM}|${round.faceCm}|${roundSpotLayout(round)}|${roundRingClass(round)}`; }

// The single-stage preset this shape matches, or null if it doesn't match
// any recognized archetype exactly.
function matchedPreset(round) {
  const candidates = ROUND_TYPES.filter(r => r.stages.length === 1 && sameRound(r.stages[0], round));
  if (!candidates.length) return null;
  // Vegas and the 20-end triangular triple share distance, face, spot
  // layout and ring class, and differ only in how long the round is —
  // which sameRound ignores on purpose (see there: chunking and length
  // aren't what makes a round a different round for grouping). For a
  // *name*, though, length is exactly what separates them, so prefer a
  // preset whose arrow count also matches before falling back.
  const arrows = round.arrowsPerEnd * round.ends;
  return candidates.find(r => r.stages[0].arrowsPerEnd * r.stages[0].ends === arrows) || candidates[0];
}

function roundShapeLabel(round) {
  const preset = matchedPreset(round);
  if (preset) return preset.label;
  return `${round.distanceM}m · ${round.faceCm}cm`;
}

// A row for one stage-entry — used when Storico is filtered to a specific
// round shape, so a WA1440's 70m stage shows up (and scores) on its own,
// separate from the session's grand total.
function StageEntryRow({ entry, onOpen }) {
  const isDone = entry.status === 'completed';
  const isPartial = entry.status === 'partial';
  return (
    <button onClick={onOpen} className="w-full text-left rounded-2xl px-4 py-3 flex items-center justify-between gap-2" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="min-w-0">
        <div className="font-semibold truncate flex items-center gap-2">
          <span className="truncate">{entry.round.distanceM}m · {entry.round.faceCm}cm</span>
          <SessionTypeBadge sessionType={entry.sessionType} />
          {!isDone && (
            <span className="text-xs font-normal shrink-0" style={{ color: isPartial ? T.textFaint : T.gold }}>
              {isPartial ? 'interrotta' : 'in corso'}
            </span>
          )}
          {entry.stageCount > 1 && <span className="text-xs font-normal shrink-0" style={{ color: T.textFaint }}>Tappa {entry.stageIndex + 1}/{entry.stageCount}</span>}
        </div>
        <div className="text-xs truncate" style={{ color: T.textDim }}>
          {formatDateFull(entry.startedAt)}{bowLabel(entry.bowType) ? ` · ${bowLabel(entry.bowType)}` : ''}
        </div>
      </div>
      <div className="text-lg font-bold shrink-0" style={numeralStyle}>
        {isDone || isPartial ? totalScore(entry) : `${currentEndIndex(entry) + 1}/${entry.round.ends}`}
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
//
// That makes the chart WORK for both input methods; it does not make the
// two methods equivalent, and this pools them. A keypad arrow carries the
// score that was called on the target face, line-cutters rounded up as
// FITARCO/WA require. A face-tapped arrow is scored by scoreFromRadiusUnits
// from the tap alone, which models the arrow as a dimensionless point and
// so can only ever round DOWN at a ring boundary. Face-tapped rounds
// therefore read very slightly low against keypad rounds, and a trend line
// here can move because the input method changed rather than the shooting.
// Not corrected on purpose: applying a shaft width now would silently
// rescore future sessions against every past one, which is the same
// discontinuity by another route.
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

// Same ring-color breakdown as hitRateByColor(), but one row per session
// (chronological) instead of one aggregate snapshot — the trend
// counterpart, for a 100%-stacked area chart showing how the color mix
// shifts over time rather than just where it stands today.
function colorTrendByShape(completedList) {
  return completedList
    .slice()
    .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
    .map(e => {
      const arrows = flattenArrows(e);
      const total = arrows.length;
      const counts = {};
      RING_GROUP_ORDER.forEach(k => (counts[k] = 0));
      arrows.forEach(a => { counts[ringGroupForScore(a.score)] += 1; });
      const row = { label: formatDateShort(e.completedAt) };
      RING_GROUP_ORDER.forEach(k => { row[k] = total ? (counts[k] / total) * 100 : 0; });
      return row;
    });
}

// One row per distinct round shape ever shot: personal best, average, and
// how many times — the cumulative counterpart to Storico's per-round PB tile.
// Both best and avg are per-arrow (not raw totals): roundShapeKey() groups
// by distance+face only, so a group can mix sessions with different arrow
// counts (e.g. a 72-arrow Targa 70m and a 36-arrow WA1440 stage), and
// comparing raw totals would simply reward whichever had more arrows.
//
// Per-arrow removes that, but it does NOT make the two lengths equivalent,
// and this used to claim it did. Points per arrow is only length-independent
// if fatigue isn't real — and this app charts fatigue as a feature
// (endRangeStats, and sessionInsight's "calo nella seconda parte"), so by
// its own account a 72-arrow average has more of its arrows in the tired
// half. `mixedLengths` marks a group where that caveat is live, so the
// number is read with it rather than instead of it. findPersonalBest takes
// the stricter line and won't cross lengths at all, because pace compares
// the two cumulative curves arrow by arrow.
function bestByShape(entries) {
  const map = new Map();
  entries.forEach(e => {
    const key = roundShapeKey(e.round);
    if (!map.has(key)) map.set(key, { round: e.round, entries: [] });
    map.get(key).entries.push(e);
  });
  return Array.from(map.values())
    .map(({ round, entries: es }) => {
      const totalArrows = es.reduce((s, e) => s + arrowsShotCount(e), 0);
      const totalPoints = es.reduce((s, e) => s + totalScore(e), 0);
      // The average is arrow-weighted over everything that counts, but the
      // "best" is a record and only a round shot end to end can hold one —
      // otherwise a good half-round outranks every full one.
      const rankable = es.filter(entryIsRankable);
      return {
        round,
        count: es.length,
        best: rankable.length ? Math.max(...rankable.map(e => totalScore(e) / arrowsShotCount(e))) : null,
        avg: totalArrows ? totalPoints / totalArrows : 0,
        mixedLengths: new Set(es.map(e => e.round.arrowsPerEnd * e.round.ends)).size > 1,
      };
    })
    .sort((a, b) => b.round.distanceM - a.round.distanceM || b.round.faceCm - a.round.faceCm);
}

// Below this many positioned arrows a round shape doesn't get an angular
// bar — the whole point of the chart is comparing shapes against each
// other, and a bar built on a handful of arrows invites a comparison the
// data can't support.
const ANGULAR_MIN_ARROWS = 30;

// Angular dispersion per round shape: the one figure in the app that's
// comparable ACROSS distances and face sizes. Arrow-weighted and per spot,
// like everything else.
function angularByShape(entries) {
  const map = new Map();
  entries.forEach(e => {
    const usable = groupStatsBySpot(e.round, flattenArrows(e)).filter(p => p.stats);
    if (!usable.length || !e.round.distanceM) return;
    const key = roundShapeKey(e.round);
    if (!map.has(key)) map.set(key, { round: e.round, sum: 0, arrows: 0 });
    const b = map.get(key);
    usable.forEach(p => {
      b.sum += angularDispersionMrad(p.stats, e.round.distanceM) * p.stats.count;
      b.arrows += p.stats.count;
    });
  });
  return Array.from(map.values())
    .filter(b => b.arrows >= ANGULAR_MIN_ARROWS)
    .map(b => ({ key: roundShapeLabel(b.round), mrad: b.sum / b.arrows, arrows: b.arrows }))
    .sort((a, b) => a.mrad - b.mrad);
}

// The archer's own competition record, pulled out of the tournaments they
// organized. Matches record every arrow individually, so this is real
// arrow-level data that until now lived only inside the bracket screens and
// never reached the statistics tab at all.
//
// Identification is by the email the organizer recorded against a
// participant (the same one that lets a participant self-score from the
// public link) — the only link that exists between an account and a name in
// a bracket. No email, no record: nothing here guesses from names.
function ownMatchRecord(tournaments, email) {
  const key = (email || '').trim().toLowerCase();
  if (!key) return null;
  let matches = 0, won = 0, arrows = 0, points = 0, sumSq = 0;
  const events = new Set();
  (tournaments || []).forEach(t => {
    const me = (t.participants || []).find(p => (p.email || '').trim().toLowerCase() === key);
    if (!me) return;
    flatMatchRefs(t).forEach(ref => {
      // threeFinal has three sides and its own shape — see matchRefHasParticipant.
      if (ref.kind === 'threeFinal') return;
      const resolved = resolveMatchRef(t, ref);
      const m = resolved && resolved.match;
      if (!m || m.forfeit) return;
      const side = m.slotA && m.slotA.id === me.id ? 'A' : m.slotB && m.slotB.id === me.id ? 'B' : null;
      if (!side) return;
      const own = (m.units || []).flatMap(u => (side === 'A' ? u.arrowsA : u.arrowsB) || []);
      if (!own.length) return;
      matches += 1;
      events.add(t.id);
      if (m.status === 'completed' && m.winnerSlot === side) won += 1;
      own.forEach(v => { arrows += 1; points += v; sumSq += v * v; });
    });
  });
  if (!matches) return null;
  const avg = points / arrows;
  const variance = arrows > 1 ? Math.max(0, sumSq / arrows - avg * avg) : 0;
  return {
    matches, won, arrows, avg,
    err: arrows > 1 ? 2 * Math.sqrt(variance / arrows) : 0,
    tournaments: events.size,
  };
}

function StatisticheScreen({ sessions, tournaments = [], userEmail = null }) {
  // "Counts for stats" rather than "completed": a session closed early
  // still shot real arrows, and every figure on this screen is
  // arrow-weighted. Records are held back separately — see entryIsRankable.
  const completedSessions = useMemo(() => sessions.filter(sessionCountsForStats), [sessions]);
  const entries = useMemo(() => stageEntries(completedSessions).filter(entryCountsForStats), [completedSessions]);

  const totalArrows = entries.reduce((s, e) => s + arrowsShotCount(e), 0);
  const totalX = entries.reduce((s, e) => s + xCount(e), 0);

  const shapeRows = useMemo(() => bestByShape(entries), [entries]);
  const volume = useMemo(() => weeklyVolume(completedSessions), [completedSessions]);
  const idleDays = useMemo(() => daysSinceLastSession(completedSessions), [completedSessions]);
  const angular = useMemo(() => angularByShape(entries), [entries]);
  const matchRecord = useMemo(() => ownMatchRecord(tournaments, userEmail), [tournaments, userEmail]);

  const typeCounts = useMemo(() => {
    const counts = {};
    SESSION_TYPES.forEach(t => (counts[t.id] = 0));
    completedSessions.forEach(s => { counts[s.sessionType || 'allenamento'] += 1; });
    return counts;
  }, [completedSessions]);

  // Defaults to whichever round shape was most recently completed, so the
  // scoped section below always opens on something relevant instead of an
  // empty "pick one" state. Lazy initializer: only needs to run once, since
  // `entries` at mount time is what a first-time visitor sees regardless of
  // later data changes (re-selecting explicitly is what chip taps are for).
  const [filterId, setFilterId] = useState(() => {
    if (!entries.length) return null;
    const latest = entries.reduce((a, b) => (new Date(b.completedAt) > new Date(a.completedAt) ? b : a));
    return roundShapeKey(latest.round);
  });
  const [typeFilter, setTypeFilter] = useState('all');
  const [bowFilter, setBowFilter] = useState('all');
  const [conditionDim, setConditionDim] = useState('wind');

  const typeAndBowFiltered = sessions.filter(s =>
    (typeFilter === 'all' || (s.sessionType || 'allenamento') === typeFilter) &&
    (bowFilter === 'all' || s.bowType === bowFilter));
  const allEntries = useMemo(() => stageEntries(typeAndBowFiltered), [typeAndBowFiltered]);
  const activeShape = filterId ? shapeRows.find(r => roundShapeKey(r.round) === filterId)?.round : null;
  const multiSpotShape = !!activeShape && roundSpotLayout(activeShape) !== 'single';
  const matchingEntries = filterId ? allEntries.filter(e => roundShapeKey(e.round) === filterId) : [];
  const completed = matchingEntries.filter(entryCountsForStats);

  // Per-arrow average throughout, not raw totals — roundShapeKey() groups
  // by distance+face only, so a group can mix sessions with different
  // arrow counts (e.g. 72-arrow Targa 70m alongside a 36-arrow WA1440
  // stage); comparing raw totals would unfairly favor whichever had more
  // arrows.
  const entryAvg = e => totalScore(e) / arrowsShotCount(e);
  const trendBands = useMemo(() => avgTrendWithBands(completed), [completed]);
  const trendCall = useMemo(() => trendVerdict(trendBands), [trendBands]);
  const consistency = useMemo(() => consistencyTrend(completed), [completed]);
  const xTrend = useMemo(() => (filterId ? xRateTrend(completed) : []), [completed, filterId]);
  const positions = useMemo(() => (filterId ? arrowPositionStats(completed) : { rows: [], firstArrow: null }), [completed, filterId]);
  // Deliberately ignores the tipo chip — contrasting gara with allenamento
  // is impossible once one of the two has been filtered away — but keeps
  // the round shape and the bow, which are what make the two comparable at
  // all.
  const contrast = useMemo(() => {
    if (!filterId) return null;
    const scoped = stageEntries(sessions).filter(e =>
      roundShapeKey(e.round) === filterId &&
      (bowFilter === 'all' || e.bowType === bowFilter) &&
      entryCountsForStats(e));
    return typeContrast(scoped);
  }, [sessions, filterId, bowFilter]);
  const byLocation = useMemo(() => (filterId ? scoreByLocation(completed) : []), [completed, filterId]);
  const pace = useMemo(() => (filterId ? paceContrast(completed) : { sessionsWithTiming: 0, contrast: null }), [completed, filterId]);
  const paceRows = useMemo(() => (filterId ? paceTrend(completed) : []), [completed, filterId]);
  const pb = completed.length ? completed.reduce((b, e) => (entryAvg(e) > entryAvg(b) ? e : b)) : null;
  const totalArrowsFiltered = completed.reduce((s, e) => s + arrowsShotCount(e), 0);
  const avgScore = totalArrowsFiltered ? completed.reduce((s, e) => s + totalScore(e), 0) / totalArrowsFiltered : null;
  const xRate = totalArrowsFiltered ? (completed.reduce((s, e) => s + xCount(e), 0) / totalArrowsFiltered) * 100 : null;
  const colorData = useMemo(() => hitRateByColor(completed), [completed]);
  const colorTrend = useMemo(() => (filterId ? colorTrendByShape(completed) : []), [completed, filterId]);
  const endRange = useMemo(() => (filterId ? endRangeStats(completed) : []), [completed, filterId]);
  const allArrows = useMemo(() => completed.flatMap(e => flattenArrows(e)), [completed]);
  // Just a gate on "is there anything positioned to draw" — the analysis
  // itself is per spot inside GroupAnalysis, and pooling here to decide
  // whether to render it would have been the same mistake one level up.
  const hasPositions = useMemo(() => !!activeShape && allArrows.some(a => a.x != null), [allArrows, activeShape]);
  const dispersion = useMemo(() => (filterId ? dispersionTrend(completed) : []), [completed, filterId]);
  const distribution = useMemo(() => (filterId ? scoreDistribution(completed) : []), [completed, filterId]);
  const byCondition = useMemo(() => (filterId ? scoreByCondition(completed, conditionDim) : []), [completed, filterId, conditionDim]);
  const deepAnalysisReady = filterId != null && completed.length >= MIN_SESSIONS_FOR_DEEP_ANALYSIS;

  if (!completedSessions.length) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
        <h1 className="text-xl font-bold">Statistiche</h1>
        <div className="rounded-2xl p-4 text-sm" style={{ background: T.surface, border: `1px dashed ${T.border}`, color: T.textDim }}>
          Completa qualche sessione per iniziare a vedere le tue statistiche cumulative.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-5">
      <h1 className="text-xl font-bold">Statistiche</h1>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Sessioni" value={completedSessions.length} />
        <StatTile label="Frecce" value={totalArrows} />
        <StatTile label="X totali" value={totalX} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold" style={{ color: T.textDim }}>Sessioni per tipo</div>
        <div className="grid grid-cols-3 gap-2">
          {SESSION_TYPES.map(t => <StatTile key={t.id} label={t.label} value={typeCounts[t.id]} />)}
        </div>
      </div>

      {/* Volume. Not scoped to a round shape on purpose: how much you shoot
          is a property of the training week, not of one prova, and mixing
          18m and 70m arrows in the same bar is exactly right for it. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm font-semibold" style={{ color: T.textDim }}>Carico di allenamento</div>
          {idleDays != null && (
            <div className="text-xs" style={{ color: idleDays > 14 ? T.behind : T.textFaint }}>
              {idleDays === 0 ? 'ultima sessione oggi' : `${idleDays} giorn${idleDays === 1 ? 'o' : 'i'} dall'ultima sessione`}
            </div>
          )}
        </div>
        <ChartCard title="Frecce per settimana" subtitle="Volume settimanale su tutte le prove, sessioni interrotte comprese">
          {volume.some(w => w.arrows > 0) ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volume}>
                <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(v, name, item) => [`${v} frecce · ${item.payload.sessions} sessioni`, 'settimana']} />
                <Bar dataKey="arrows" fill={T.gold} radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart text="Nessuna sessione recente" />}
        </ChartCard>
      </div>

      {/* The only cross-round figure in the app. Scores can't be compared
          between 18m and 70m and neither can centimetres; the angle the
          group subtends can. */}
      {angular.length >= 2 && (
        <ChartCard title="Dispersione angolare per prova (mrad)" subtitle="Ampiezza del gruppo rapportata alla distanza: confrontabile tra prove diverse, più basso è meglio">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={angular} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid stroke={T.border} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" stroke={T.textDim} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="key" stroke={T.textDim} tick={{ fontSize: 10 }} width={132} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={(v, name, item) => [`${Number(v).toFixed(2)} mrad su ${item.payload.arrows} frecce`, 'dispersione']} />
              <Bar dataKey="mrad" fill={T.blue} radius={[0, 3, 3, 0]} maxBarSize={40} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Match arrows have always been recorded one by one inside the
          brackets and never counted anywhere. They still don't mix into the
          round-shape statistics — a set match isn't a round — but they're
          no longer invisible. */}
      {matchRecord && (
        <div className="rounded-2xl p-4 flex flex-col gap-1" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <div className="text-sm font-semibold" style={{ color: T.textDim }}>I tuoi scontri diretti</div>
          <div className="text-sm" style={{ color: T.text }}>
            {matchRecord.won} vittorie su {matchRecord.matches} match in {matchRecord.tournaments} tornei
            {' '}· {matchRecord.avg.toFixed(2)} ± {matchRecord.err.toFixed(2)} punti a freccia su {matchRecord.arrows} frecce
          </div>
          <div className="text-xs" style={{ color: T.textFaint }}>
            Dalle gare che hai organizzato, riconoscendoti dall'email registrata tra i partecipanti. Non entra nelle
            statistiche per prova: i match si tirano a set, con distanze e volée diverse dai round.
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold" style={{ color: T.textDim }}>Le tue prove</div>
        <div className="flex flex-col gap-2">
          {shapeRows.map(row => {
            const key = roundShapeKey(row.round);
            const active = key === filterId;
            return (
              <button key={key} onClick={() => setFilterId(key)}
                className="text-left rounded-2xl px-4 py-3 flex items-center justify-between gap-2"
                style={{ background: active ? T.surfaceAlt : T.surface, border: `1px solid ${active ? T.gold : T.border}` }}>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{roundShapeLabel(row.round)}</div>
                  <div className="text-xs" style={{ color: T.textDim }}>
                    media {row.avg.toFixed(2)}/freccia · {row.count} sessioni
                    {/* Same distance and face, different round lengths — the
                        per-arrow average pools them, which is fair on volume
                        but not on fatigue. Said out loud rather than hidden
                        behind the arithmetic. */}
                    {row.mixedLengths && <span style={{ color: T.textFaint }}> · lunghezze diverse</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold" style={numeralStyle}>{row.best != null ? row.best.toFixed(2) : '—'}</div>
                  <div className="text-xs" style={{ color: T.textFaint }}>primato/freccia</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {filterId && (
        <>
          <div className="flex flex-col gap-2">
            <ScrollFadeRow>
              <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} label="Tutti i tipi" />
              {SESSION_TYPES.map(t => <FilterChip key={t.id} active={typeFilter === t.id} onClick={() => setTypeFilter(t.id)} label={t.label} />)}
            </ScrollFadeRow>
            <ScrollFadeRow>
              <FilterChip active={bowFilter === 'all'} onClick={() => setBowFilter('all')} label="Tutti gli archi" />
              {BOW_TYPES.map(b => <FilterChip key={b.id} active={bowFilter === b.id} onClick={() => setBowFilter(b.id)} label={b.label} />)}
            </ScrollFadeRow>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <StatTile label="Sessioni" value={completed.length} />
            <StatTile label="Media/freccia" value={avgScore != null ? avgScore.toFixed(2) : '—'} />
            <StatTile label="Primato/freccia" value={pb ? entryAvg(pb).toFixed(2) : '—'} />
            <StatTile label="X" value={xRate != null ? `${xRate.toFixed(1)}%` : '—'} />
          </div>

          <ChartCard title="Andamento media a freccia"
            subtitle="Punti medi per freccia, con l'incertezza di ciascuna media: dove due bande si sovrappongono, le due sessioni non sono distinguibili">
            {trendBands.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendBands}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 10]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v, name) => (name === 'band'
                      ? [`${v[0].toFixed(2)} – ${v[1].toFixed(2)}`, 'incertezza']
                      : [Number(v).toFixed(2), 'media a freccia'])} />
                  <Bar dataKey="band" fill={T.gold} fillOpacity={0.32} radius={[3, 3, 3, 3]} isAnimationActive={false} />
                  <Line type="monotone" dataKey="avg" stroke={T.gold} strokeWidth={2} dot={{ r: 3, fill: T.gold }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Servono almeno 2 sessioni completate" />}
          </ChartCard>

          {/* The verdict the chart used to leave to the eye. A line drawn
              through noisy points always looks like it's going somewhere. */}
          <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.textDim }}>
            {trendCall.verdict === 'insufficient' && 'Servono almeno 3 sessioni per dire se c’è una tendenza.'}
            {trendCall.verdict === 'flat' && 'Nessuna tendenza misurabile: le differenze tra sessioni rientrano nel rumore statistico.'}
            {trendCall.verdict === 'up' && (
              <span style={{ color: T.ahead }}>In crescita: +{trendCall.perTen.toFixed(2)} punti a freccia ogni 10 sessioni.</span>
            )}
            {trendCall.verdict === 'down' && (
              <span style={{ color: T.behind }}>In calo: {trendCall.perTen.toFixed(2)} punti a freccia ogni 10 sessioni.</span>
            )}
          </div>

          {/* Sigma alone is not consistency: scores are capped at 10, so it
              falls on its own as the average rises. See consistencyTrend. */}
          {consistency.fitted ? (
            <ChartCard title="Costanza (a parità di media)"
              subtitle="Quanto la sessione è stata più regolare (sotto zero) o più altalenante (sopra zero) di quanto ci si aspetti a quella media">
              {consistency.rows.filter(c => c.residual != null).length >= 2 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={consistency.rows}>
                    <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                    <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={46} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                      formatter={(v, name, item) => [`${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)} (σ ${item.payload.stddev.toFixed(2)}, attesa ${item.payload.expected.toFixed(2)})`, 'costanza']} />
                    <ReferenceLine y={0} stroke={T.borderStrong} />
                    <Line type="monotone" dataKey="residual" stroke={T.blue} strokeWidth={2} dot={{ r: 3, fill: T.blue }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="Dati insufficienti" />}
            </ChartCard>
          ) : (
            <ChartCard title="Costanza"
              subtitle={`Variazione dei punteggi in ogni sessione. Attenzione: cala da sola quando la media sale — da ${CONSISTENCY_FIT_MIN_SESSIONS} sessioni in poi questo grafico si corregge da solo`}>
              {consistency.rows.filter(c => c.stddev != null).length >= 2 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={consistency.rows}>
                    <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                    <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 'auto']} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                      formatter={(v) => [`σ = ${Number(v).toFixed(2)} punti`, 'costanza']} />
                    <Line type="monotone" dataKey="stddev" stroke={T.blue} strokeWidth={2} dot={{ r: 3, fill: T.blue }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="Servono almeno 2 sessioni completate" />}
            </ChartCard>
          )}

          <ChartCard title="Andamento colori nel tempo" subtitle="Percentuale di frecce per colore, sessione per sessione">
            {colorTrend.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={colorTrend}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={32} unit="%" domain={[0, 100]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v, name) => [`${Number(v).toFixed(1)}%`, RING_GROUP_LABELS[name]]} />
                  {RING_GROUP_ORDER.map(k => (
                    <Area key={k} type="monotone" dataKey={k} stackId="colors" stroke={SCORE_COLORS[k].fill} fill={SCORE_COLORS[k].fill} isAnimationActive={false} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Servono almeno 2 sessioni completate" />}
          </ChartCard>

          <ChartCard title="Frecce per colore" subtitle="Percentuale di tutte le frecce finite in ciascun colore">
            {completed.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={colorData}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="key" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={32} unit="%" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v, name, item) => [`${item.payload.count} frecce (${Number(v).toFixed(1)}%)`, 'frecce']} />
                  <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {colorData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Nessuna sessione per questa combinazione" />}
          </ChartCard>

          <ChartCard title="Andamento per volée (mediana e quartili)"
            subtitle="Dove finisce di solito ogni volée. Quartili e non minimo-massimo: il minimo e il massimo possono solo allargarsi man mano che accumuli sessioni">
            {endRange.filter(f => f.band != null).length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={endRange}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="end" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 10]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v, name, item) => (name === 'band'
                      ? [`${v[0].toFixed(2)} – ${v[1].toFixed(2)}`, 'metà centrale']
                      : [`${Number(v).toFixed(2)} su ${item.payload.n} sessioni`, 'mediana'])}
                    labelFormatter={(l) => `Volée ${l}`} />
                  <Bar dataKey="band" fill={T.blue} fillOpacity={0.35} radius={[3, 3, 3, 3]} isAnimationActive={false} />
                  <Line type="monotone" dataKey="median" stroke={T.gold} strokeWidth={2} dot={{ r: 3, fill: T.gold }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Dati insufficienti" />}
          </ChartCard>

          {/* Which arrow of the volée is it? Ordered data that was sitting
              in every session since v1 and had never been looked at. */}
          {positions.rows.length >= 2 && (
            <ChartCard title="Media per posizione nella volée" subtitle="Prima, seconda, terza freccia... con la relativa incertezza">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={positions.rows}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="position" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 10]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v, name, item) => [`${Number(v).toFixed(2)} su ${item.payload.n} frecce`, 'media']}
                    labelFormatter={(l) => `Freccia ${l} della volée`} />
                  <Bar dataKey="avg" fill={T.blue} radius={[3, 3, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                    <ErrorBar dataKey="err" width={4} strokeWidth={1.5} stroke={T.textDim} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {positions.firstArrow && (
            <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.textDim }}>
              {positions.firstArrow.significant
                ? `La prima freccia della volée vale ${positions.firstArrow.diff > 0 ? '+' : ''}${positions.firstArrow.diff.toFixed(2)} punti rispetto alle altre.`
                : 'La prima freccia della volée non si distingue dalle altre.'}
            </div>
          )}

          <ChartCard title="Percentuale di X" subtitle="Quota di frecce nell'X, sessione per sessione">
            {xTrend.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={xTrend}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={32} unit="%" domain={[0, 'auto']} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v, name, item) => [`${Number(v).toFixed(1)}% su ${item.payload.n} frecce`, 'X']} />
                  <Line type="monotone" dataKey="pct" stroke={T.gold} strokeWidth={2} dot={{ r: 3, fill: T.gold }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Servono almeno 2 sessioni completate" />}
          </ChartCard>

          {/* The app could always filter by type; it could never contrast
              them, which is the form the question is actually asked in. */}
          {contrast && (
            <div className="rounded-2xl p-4 flex flex-col gap-1" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <div className="text-sm font-semibold" style={{ color: T.textDim }}>Gara contro allenamento</div>
              <div className="text-sm" style={{ color: T.text }}>
                {contrast.significant
                  ? `In gara ${contrast.diff >= 0 ? 'guadagni' : 'perdi'} ${Math.abs(contrast.diff).toFixed(2)} punti a freccia.`
                  : 'Nessuna differenza misurabile tra gara e allenamento.'}
              </div>
              <div className="text-xs" style={{ color: T.textFaint }}>
                Gara {contrast.a.avg.toFixed(2)} su {contrast.a.arrows} frecce ({contrast.a.sessions} sessioni)
                {' '}· allenamento {contrast.b.avg.toFixed(2)} su {contrast.b.arrows} frecce ({contrast.b.sessions} sessioni).
                {' '}Il filtro per tipo non si applica qui: servono entrambi per confrontarli.
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold" style={{ color: T.textDim }}>Gruppo cumulativo</div>
            {hasPositions ? (
              <GroupAnalysis round={activeShape} arrows={allArrows.filter(a => a.x != null)} dense />
            ) : (
              <div className="rounded-2xl p-4 text-sm" style={{ background: T.surface, border: `1px dashed ${T.border}`, color: T.textDim }}>
                Nessuna freccia con posizione registrata per questa combinazione. Registra le posizioni sul bersaglio per sbloccare questa analisi.
              </div>
            )}
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
                <ChartCard title="Dispersione media nel tempo (cm)" subtitle="Distanza media delle frecce dal centro del proprio gruppo, sessione per sessione — su bersagli a più spot è la media dei tre gruppi, non un gruppo unico">
                  {dispersion.length >= 2 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dispersion}>
                        <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                        <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 'auto']} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                          formatter={(v) => [`${Number(v).toFixed(1)} cm`, 'dispersione']} />
                        <Line type="monotone" dataKey="dispersion" stroke={T.blue} strokeWidth={2} dot={{ r: 3, fill: T.blue }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <EmptyChart text="Nessuna freccia con posizione registrata" />}
                </ChartCard>

                {/* One aim point, one direction to drift in. On a triple
                    face there are three, and averaging three directions
                    produces an arrow pointing nowhere — so each spot gets
                    its own distance-from-centre instead, with the
                    directions left to the per-spot readouts below. */}
                {multiSpotShape ? (
                  <ChartCard title="Scarto dal centro per spot (cm)" subtitle="Quanto è lontano dal centro il gruppo di ciascuno spot, nel tempo — le direzioni sono nei riquadri per spot qui sotto" tall>
                    {dispersion.length >= 2 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dispersion}>
                          <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                          <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 'auto']} />
                          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                            formatter={(v, name) => [`${Number(v).toFixed(1)} cm`, `Spot ${Number(name.replace('spot', '')) + 1}`]} />
                          <Legend formatter={(value) => `Spot ${Number(String(value).replace('spot', '')) + 1}`} wrapperStyle={{ fontSize: 11, color: T.textDim }} />
                          {[0, 1, 2].map((i) => (
                            <Line key={i} type="monotone" dataKey={`spot${i}`} stroke={[T.gold, T.blue, T.red][i]} strokeWidth={2}
                              dot={{ r: 2, fill: [T.gold, T.blue, T.red][i] }} connectNulls isAnimationActive={false} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    ) : <EmptyChart text="Nessuna freccia con posizione registrata" />}
                  </ChartCard>
                ) : (
                  <ChartCard title="Deriva orizzontale e verticale (cm)" subtitle="Scostamento medio del gruppo da centro, per direzione, nel tempo" tall>
                    {dispersion.length >= 2 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dispersion}>
                          <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                          <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={['auto', 'auto']} />
                          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                            formatter={(v, name) => [`${Number(v).toFixed(1)} cm`, name === 'biasX' ? 'orizzontale' : 'verticale']} />
                          <Legend formatter={(value) => (value === 'biasX' ? 'Orizzontale' : 'Verticale')} wrapperStyle={{ fontSize: 11, color: T.textDim }} />
                          <Line type="monotone" dataKey="biasX" stroke={T.gold} strokeWidth={2} dot={{ r: 2, fill: T.gold }} isAnimationActive={false} />
                          <Line type="monotone" dataKey="biasY" stroke={T.red} strokeWidth={2} dot={{ r: 2, fill: T.red }} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : <EmptyChart text="Nessuna freccia con posizione registrata" />}
                  </ChartCard>
                )}

                <ChartCard title="Distribuzione dei punteggi" subtitle="Quante frecce hai segnato per ciascun punteggio">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={distribution}>
                      <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="key" stroke={T.textDim} tick={{ fontSize: 11 }} />
                      <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} allowDecimals={false} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
                      <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                        {distribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* `location` was collected from day one and only ever
                    printed back next to the date. */}
                {byLocation.length >= 2 && (
                  <ChartCard title="Media per campo" subtitle="Dove tiri meglio, tra i campi con almeno qualche sessione registrata">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={byLocation}>
                        <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="key" stroke={T.textDim} tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={44} />
                        <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 10]} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                          formatter={(v, name, item) => [`${Number(v).toFixed(2)} su ${item.payload.arrows} frecce (${item.payload.count} sessioni)`, 'media']} />
                        <Bar dataKey="avg" fill={T.gold} radius={[3, 3, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                          <ErrorBar dataKey="err" width={4} strokeWidth={1.5} stroke={T.textDim} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}

                <div className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: T.textDim }}>Media per condizioni</div>
                    <div className="text-xs" style={{ color: T.textFaint }}>
                      Media punti/freccia per ogni condizione con almeno {MIN_SESSIONS_PER_CONDITION} sessioni.
                      {' '}Le barre di errore sono l'incertezza della media: se si sovrappongono, la differenza non è
                      {' '}misurabile. Restano comunque condizioni che si accompagnano tra loro — vento, stagione e
                      {' '}periodo di forma viaggiano insieme, e questo confronto non le separa.
                    </div>
                  </div>
                  <div className="overflow-x-auto pb-1">
                    <SegmentedControl options={CONDITION_DIMENSIONS} value={conditionDim} onChange={setConditionDim} small />
                  </div>
                  <div className="h-40 overflow-x-clip">
                    {byCondition.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={byCondition}>
                          <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="key" stroke={T.textDim} tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={40} />
                          <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 10]} />
                          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                            formatter={(v, name, item) => [`${Number(v).toFixed(2)} su ${item.payload.arrows} frecce (${item.payload.count} sessioni)`, 'media']} />
                          <Bar dataKey="avg" fill={T.blue} radius={[3, 3, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                            <ErrorBar dataKey="err" width={4} strokeWidth={1.5} stroke={T.textDim} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <EmptyChart text={`Nessuna condizione ha ancora ${MIN_SESSIONS_PER_CONDITION} sessioni registrate: continua a segnare vento, sole e momento della giornata.`} />}
                  </div>
                </div>

                {/* Pace. Only appears once enough sessions carry volée
                    timestamps — nothing before this release has them. */}
                {pace.contrast ? (
                  <div className="rounded-2xl p-4 flex flex-col gap-1" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                    <div className="text-sm font-semibold" style={{ color: T.textDim }}>Ritmo</div>
                    <div className="text-sm" style={{ color: T.text }}>
                      {pace.contrast.significant
                        ? `Le volée più lente della tua mediana valgono ${pace.contrast.diff > 0 ? '+' : ''}${pace.contrast.diff.toFixed(2)} punti a freccia rispetto a quelle più veloci.`
                        : 'Volée lente e volée veloci rendono allo stesso modo.'}
                    </div>
                    <div className="text-xs" style={{ color: T.textFaint }}>
                      Confronto interno a ogni sessione, su {pace.sessionsWithTiming} sessioni con i tempi registrati.
                      {' '}Il tempo è quello tra una volée confermata e la successiva: comprende sia il tiro sia la
                      {' '}segnatura, quindi è il ritmo di lavoro, non il tempo di trazione.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl p-4 text-sm" style={{ background: T.surface, border: `1px dashed ${T.border}`, color: T.textDim }}>
                    Ritmo: servono almeno 3 sessioni con i tempi delle volée
                    {' '}(ne hai {pace.sessionsWithTiming}). I tempi vengono registrati dalle sessioni tirate d'ora in avanti.
                  </div>
                )}

                {paceRows.length >= 2 && (
                  <ChartCard title="Secondi per volée (mediana)" subtitle="Quanto tempo passa tra una volée confermata e la successiva">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={paceRows}>
                        <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                        <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={32} domain={[0, 'auto']} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                          formatter={(v) => [`${Math.round(Number(v))} s`, 'per volée']} />
                        <Line type="monotone" dataKey="seconds" stroke={T.blue} strokeWidth={2} dot={{ r: 3, fill: T.blue }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- session detail ----------

function DeleteSessionButton({ onDelete, label = 'Elimina sessione' }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button onClick={() => (confirming ? onDelete() : setConfirming(true))}
      className="rounded-2xl py-3 font-semibold flex items-center justify-center gap-2"
      style={{ background: confirming ? T.red : T.surface, color: confirming ? T.onRed : T.textDim, border: `1px solid ${confirming ? T.red : T.border}` }}>
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
    <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" aria-label="Indietro"><ChevronLeft /></button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <SessionName session={session} />
          <SessionTypeBadge sessionType={session.sessionType} />
        </h1>
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

      {session.status === 'partial' && (
        <div className="rounded-2xl px-4 py-3 flex flex-col gap-3" style={{ background: T.surfaceAlt, border: `1px solid ${T.border}` }}>
          <div className="text-sm" style={{ color: T.textDim }}>
            Sessione interrotta: {sessionArrowsShot(session)} frecce su {sessionPlannedArrows(session)}.
            {' '}{sessionCountsForStats(session)
              ? 'Conta nelle medie e nelle analisi, ma non tra i primati.'
              : `Sotto le ${MIN_ARROWS_FOR_PARTIAL_STATS} frecce, quindi resta nello storico ma non entra nelle statistiche.`}
          </div>
          <button onClick={() => onUpdate(s => reopenSession(s))}
            className="rounded-xl py-2.5 text-sm font-semibold self-start px-4"
            style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }}>
            Riprendi la sessione
          </button>
        </div>
      )}

      <InsightCard sentences={insight} />

      {!multiStage ? (
        <>
          <GroupAnalysis round={session.stages[0].round}
            arrows={flattenArrows(session.stages[0]).filter(a => a.x != null)} dense={false} />
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
              <GroupAnalysis round={stage.round} arrows={flattenArrows(stage).filter(a => a.x != null)} dense={false} />
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
    <div className="px-4 pt-6 pb-4 flex flex-col gap-6 w-full max-w-3xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="rounded-2xl p-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <Target size={28} color={T.gold} />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: T.textDim }}>Arcieri Senesi</div>
          <h1 className="text-2xl font-bold">Scorecard</h1>
        </div>
        <button onClick={() => window.location.reload()} className="ml-auto p-2 rounded-full active:scale-95 transition-transform min-w-11 min-h-11 flex items-center justify-center"
          style={{ background: T.surface, border: `1px solid ${T.border}` }} title="Ricarica l'app per aggiornamenti" aria-label="Aggiorna">
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
              <SessionName session={s} />
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
          same max-w-3xl centered column the screens above it use, so icons
          don't spread across the full width on a wide viewport. (The two
          bracket screens are deliberately wider — the nav simply doesn't
          line up with those, and the bracket has its own scroll anyway.) */}
      <div className="flex w-full max-w-3xl mx-auto">
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
//    under WA rules. That is NOT modelled: MATCH_FORMATS below has three
//    fixed entries and no way to add one, so a compound bracket scored here
//    is scored as set play. Adding it means a format whose units array is a
//    single unit spanning the whole match — the engine already handles that
//    shape, there is just no entry for it.

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

// A standalone 2-way match not living in the bracket's `rounds` array (the
// standard format's bronze match, the 3-way format's preliminary, or any of
// Lancaster's three sequential matches) — same shape as makeMatch() produces,
// just without a bracket position since nothing propagates into it via the
// normal round-index math.
function emptyMatch() {
  return { slotA: null, slotB: null, status: 'waiting', winnerSlot: null, units: [], cumSpA: 0, cumSpB: 0, shootOff: null, forfeit: false };
}

// Three ways to decide the podium once the field is down to its last 4:
// - standard: normal bracket semifinal + final, plus an independent bronze
//   match between the two semifinal losers (today's app had no bronze match
//   at all — the losers were just eliminated).
// - threeway: semifinal round is still played normally; its two losers play
//   a preliminary decider whose winner joins the two semifinal winners for a
//   genuine 3-way final (see the "3-way match engine" section below) —
//   gold/silver/bronze all decided among those 3; the preliminary's loser is
//   locked into 4th.
// - lancaster: the semifinal + final rounds are skipped entirely. Once the
//   bracket produces 4 semifinalists, they're re-ranked by their original
//   seeding score (not by how the bracket happened to pair them) into a
//   sequential ladder: 4th-seed vs 3rd-seed, winner vs 2nd-seed, winner vs
//   1st-seed for gold — three ordinary 2-way matches, chained.
const FINAL_FORMATS = [
  { id: 'standard', label: 'Finale classica', desc: 'Semifinali + finale per l’oro, più una finale indipendente per il bronzo tra le due sconfitte in semifinale.' },
  { id: 'threeway', label: 'Finale a 3', desc: 'Le due sconfitte in semifinale si giocano un turno preliminare: la vincitrice raggiunge le due finaliste per una finale a 3 che assegna oro, argento e bronzo.' },
  { id: 'lancaster', label: 'Finale Lancaster', desc: 'Le 4 semifinaliste vengono riordinate per punteggio di qualifica: 4ª contro 3ª, la vincente contro la 2ª, la vincente contro la 1ª per l’oro.' },
];
function finalFormatDef(id) { return FINAL_FORMATS.find(f => f.id === id) || FINAL_FORMATS[0]; }

// participants: array of { id, name, seedScore, ... } already sorted best
// seed first (highest seedScore first). Returns { size, rounds, finalFormat,
// finalStage, thirdPlaceMatch }. rounds[0] is the first round (byes already
// resolved into empty slotB); later rounds start with null slots, filled in
// as earlier rounds complete. For 'threeway'/'lancaster' with at least 4
// competitors, `rounds` is truncated below (threeway drops the final round,
// lancaster the last two) and whatever those rounds would have produced is
// handled by `finalStage` instead. Below 4 competitors there's no "last 4"
// to speak of, so it silently behaves like a plain single match regardless
// of finalFormat.
function buildBracket(participants, finalFormat = 'standard') {
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

  const totalRounds = rounds.length; // = log2(size)
  const usesFinalStage = (finalFormat === 'threeway' || finalFormat === 'lancaster') && totalRounds >= 2;

  if (!usesFinalStage) {
    const thirdPlaceMatch = (finalFormat === 'standard' && totalRounds >= 2) ? emptyMatch() : null;
    return { size, rounds, finalFormat, finalStage: null, thirdPlaceMatch };
  }

  if (finalFormat === 'threeway') {
    // Only the final round is dropped — the semifinal round is still real
    // bracket matches, since we need actual winners vs losers out of it.
    const keptRounds = rounds.slice(0, rounds.length - 1);
    const finalStage = {
      format: 'threeway',
      prelim: emptyMatch(),
      final: { sides: [null, null, null], status: 'waiting', units: [], cumSp: [0, 0, 0], goldSlot: null, runoff: null },
      standings: {},
    };
    // Seed straight away from the semifinal round: with a non-power-of-2
    // field it can already contain byes, and a bye is never "played", so
    // this is the only chance it gets to claim its side of the final.
    const seeded = relinkThreeWayFinalStage(finalStage, keptRounds[keptRounds.length - 1]);
    return { size, rounds: keptRounds, finalFormat, finalStage: seeded, thirdPlaceMatch: null };
  }

  // lancaster: both semifinal and final rounds are dropped. The last kept
  // round's 4 winners (or, if there is no kept round at all — exactly 4
  // competitors — the 4 competitors themselves) become the semifinalists.
  const keptRounds = rounds.slice(0, rounds.length - 2);
  const finalStage = {
    format: 'lancaster',
    sides: [null, null, null, null],
    match1: emptyMatch(), match2: emptyMatch(), match3: emptyMatch(),
    playIn: null,
    standings: {},
  };
  if (keptRounds.length === 0) {
    finalStage.sides = seedLancasterSides(bySeedPos);
    seedLancasterLadder(finalStage);
  }
  return { size, rounds: keptRounds, finalFormat, finalStage, thirdPlaceMatch: null };
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
    forfeit: false,
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
  // Replaces the match object rather than mutating it: the same object is
  // still referenced by the previous tournament state. fillMatchSlot below
  // handles both the 'pending' transition and invalidating a result that
  // belonged to whoever this winner displaces.
  nextRound[nextMatchIdx] = fillMatchSlot(nextRound[nextMatchIdx], nextSlotKey, winner);
}

// Strips a match back to "not played yet" while keeping its slots and
// bracket position. Used when an upstream correction changes who is
// actually in a match: the arrows, set points and winner recorded on it
// were earned by somebody who is no longer here, and reattributing them to
// their replacement is worse than losing them.
function clearMatchResult(match) {
  return {
    ...match,
    units: [], cumSpA: match.baseSpA || 0, cumSpB: match.baseSpB || 0,
    shootOff: null, forfeit: false, winnerSlot: null,
    status: (match.slotA && match.slotB) ? 'pending' : 'waiting',
  };
}

// Fills one slot of a match fed from outside the normal round-to-round
// propagation (bronze match / threeway prelim / a Lancaster ladder match),
// and is also what propagateWinner uses for the ordinary case. Marks it
// 'pending' once both slots are present — does NOT auto-resolve a lone slot
// as a bye, since a slot can legitimately still be waiting on a future feed
// (e.g. a Lancaster match's slot fed by an earlier match in the ladder).
// Use resolveByeIfLonely() for a slot that's truly never getting a second
// competitor.
//
// Displacing an existing occupant of the slot discards whatever was recorded
// on the match (see clearMatchResult) — that only ever happens when an
// earlier result was corrected, and the old score cannot survive the change.
function fillMatchSlot(match, key, participant) {
  const displaced = match[key] && (!participant || match[key].id !== participant.id);
  const next = { ...match, [key]: participant || null };
  if (displaced && matchHasResult(match)) return clearMatchResult(next);
  // Only promote a match nobody has touched yet. The relink helpers re-feed
  // every slot in a chain on every change, including already-played ones,
  // so an unconditional 'pending' here would reset a finished match to
  // unplayed and the tournament would never finish.
  if (next.slotA && next.slotB && next.status === 'waiting') next.status = 'pending';
  return next;
}

// Everything downstream of a match whose result just changed is invalid too:
// empty the slot it fed in the next round, drop that match's own recorded
// arrows with it, and repeat to the end of the bracket. Without this,
// correcting a semifinal leaves a final that reads "Da giocare" while still
// carrying the previous winner, their set points, and their arrows.
function invalidateDownstream(rounds, roundIdx, matchIdx) {
  const nextRound = rounds[roundIdx + 1];
  if (!nextRound) return;
  const nextMatchIdx = Math.floor(matchIdx / 2);
  const slotKey = matchIdx % 2 === 0 ? 'slotA' : 'slotB';
  const prev = nextRound[nextMatchIdx];
  if (!prev[slotKey] && !matchHasResult(prev)) return; // nothing was ever fed here
  nextRound[nextMatchIdx] = clearMatchResult({ ...prev, [slotKey]: null });
  invalidateDownstream(rounds, roundIdx + 1, nextMatchIdx);
}

function matchIsDecided(m) { return !!m && (m.status === 'completed' || m.status === 'bye'); }

// Only for a slot where the other side is genuinely never coming — mirrors
// makeMatch()'s bye handling. Only reachable when a small, non-power-of-2
// field leaves an unfillable slot all the way into the final stage.
function resolveByeIfLonely(match) {
  const bye = !!(match.slotA && !match.slotB) || !!(!match.slotA && match.slotB);
  if (!bye) return match;
  return { ...match, status: 'bye', winnerSlot: match.slotA ? 'A' : 'B' };
}

// Re-ranks a set of (up to 4) semifinalists by their original qualification
// seeding score — not by how the bracket happened to pair them up — since
// Lancaster's running order is score-based, not bracket-position-based.
// Nulls (an unfilled slot from a small field) sort last.
function seedLancasterSides(people) {
  return people.slice().sort((a, b) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return b.seedScore - a.seedScore;
  });
}

// Re-derives the ladder's internal wiring from its own current state: each
// match's winner becomes the challenger in the next one, and the standings
// fall out of who lost where. Derived rather than updated incrementally,
// which buys three things a "push the winner forward when a match is
// played" approach kept getting wrong:
//  - a BYE chains. With 3 competitors the 4th slot is empty, so match1
//    resolves as a bye that nobody ever plays — and therefore never fed
//    match2, leaving the whole ladder deadlocked with no playable match.
//  - a CORRECTION propagates. Re-running this after any ladder match
//    changes re-feeds every downstream slot, and fillMatchSlot discards a
//    result whose competitor got displaced, so the chain self-cleans.
//  - the standings can't drift out of step with the matches they describe.
function relinkLancasterLadder(finalStage) {
  const fs = { ...finalStage };
  // The optional wildcard play-in is one extra link at the front of the
  // same chain — its winner takes the 4th-seed's spot in match1.
  if (fs.playIn) {
    fs.match1 = fillMatchSlot(fs.match1, 'slotA', matchIsDecided(fs.playIn) ? winnerOf(fs.playIn) : null);
  }
  fs.match2 = fillMatchSlot(fs.match2, 'slotB', matchIsDecided(fs.match1) ? winnerOf(fs.match1) : null);
  fs.match3 = fillMatchSlot(fs.match3, 'slotB', matchIsDecided(fs.match2) ? winnerOf(fs.match2) : null);

  // A bye has no loser, so it awards no placing — with 3 competitors there
  // simply is no 4th. The play-in's loser keeps whatever placing their
  // earlier bracket exit already gave them (this app doesn't track 5th+).
  const standings = {};
  if (fs.match1.status === 'completed') standings.fourth = loserOf(fs.match1);
  if (fs.match2.status === 'completed') standings.third = loserOf(fs.match2);
  if (fs.match3.status === 'completed') {
    standings.first = winnerOf(fs.match3);
    standings.second = loserOf(fs.match3);
  }
  fs.standings = standings;
  return fs;
}

// Wires the 3-match Lancaster ladder once the 4 semifinalists are known:
// match1 = 4th-seed vs 3rd-seed; match2 and match3 already have their
// "bye" side (2nd-seed, 1st-seed) pre-filled — only the side fed by the
// previous match in the chain is still to come, which relinkLancasterLadder
// then resolves. Mutates finalStage in place since it's only ever called on
// a freshly-built object nothing else references yet.
function seedLancasterLadder(finalStage) {
  const [s1, s2, s3, s4] = finalStage.sides;
  finalStage.match1 = resolveByeIfLonely(fillMatchSlot(fillMatchSlot(emptyMatch(), 'slotA', s4), 'slotB', s3));
  finalStage.match2 = fillMatchSlot(emptyMatch(), 'slotA', s2);
  finalStage.match3 = fillMatchSlot(emptyMatch(), 'slotA', s1);
  Object.assign(finalStage, relinkLancasterLadder(finalStage));
}

// Re-derives the whole 3-way final stage from the semifinal round plus the
// 3rd/4th prelim's own state: the two semifinal winners take sides 0 and 1,
// their losers meet in the prelim, and the prelim's winner takes side 2.
// State-driven for the same reasons as relinkLancasterLadder above — most
// importantly because a BYE never runs through applyMatchResult at all, so
// an event-driven version left its side of the final permanently empty and
// the tournament unfinishable (3 competitors in a 4-slot bracket).
function relinkThreeWayFinalStage(finalStage, semis) {
  const sides = [null, null, null];
  let prelim = finalStage.prelim;

  semis.forEach((m, i) => {
    if (!matchIsDecided(m)) return;
    sides[i] = winnerOf(m);
    // A bye produced no loser, so it sends nobody to the prelim.
    prelim = fillMatchSlot(prelim, i === 0 ? 'slotA' : 'slotB', m.status === 'completed' ? loserOf(m) : null);
  });
  // Only once every semifinal is settled can a lone prelim entrant be
  // declared a bye — before that the second slot is still coming.
  if (semis.every(matchIsDecided)) prelim = resolveByeIfLonely(prelim);
  if (matchIsDecided(prelim)) sides[2] = winnerOf(prelim);

  const sameSides = sides.every((s, i) => (s?.id ?? null) === (finalStage.final.sides[i]?.id ?? null));
  const final = (!sameSides && finalStage.final.units.length)
    ? { ...finalStage.final, sides, units: [], cumSp: [0, 0, 0], goldSlot: null, silverSlot: null,
        bronzeSlot: null, runoff: null, shootoffContenders: null, status: 'waiting' }
    : { ...finalStage.final, sides };
  if (sides.every(Boolean) && final.status === 'waiting') final.status = 'pending';

  return { ...finalStage, prelim, final, standings: prelim.status === 'completed' ? { fourth: loserOf(prelim) } : {} };
}

// Anyone not currently one of the 4 Lancaster semifinalists has necessarily
// already lost a match — Lancaster's final stage is only ever reached via a
// strict single-elimination bracket — so eligibility needs no separate
// "eliminated" bookkeeping, just excluding the 4 current sides.
function eligibleLancasterWildcards(tournament) {
  const sideIds = new Set(tournament.finalStage.sides.filter(Boolean).map(s => s.id));
  return tournament.participants.filter(p => !sideIds.has(p.id)).sort((a, b) => a.seed - b.seed);
}

// Sets up (or replaces) the wildcard play-in: `wildcard` challenges the
// current 4th seed for their spot in the ladder. match1.slotA is cleared
// back to 'waiting' so it gets fed by the play-in's winner instead (see
// applyMatchResult's lancasterPlayIn branch) — match1.slotB (3rd seed) is
// untouched, and so are match2/match3/standings.
function setLancasterWildcard(finalStage, wildcard) {
  const playIn = fillMatchSlot(fillMatchSlot(emptyMatch(), 'slotA', wildcard), 'slotB', finalStage.sides[3]);
  return { ...finalStage, playIn, match1: { ...finalStage.match1, slotA: null, status: 'waiting' } };
}

// Backs out of a not-yet-played wildcard pick, restoring the plain
// 4th-vs-3rd ladder exactly as seedLancasterLadder originally wired it.
function clearLancasterWildcard(finalStage) {
  return { ...finalStage, playIn: null, match1: { ...finalStage.match1, slotA: finalStage.sides[3], status: 'pending' } };
}

// ---------- match engine ----------

function sumArrows(scores) { return scores.reduce((s, v) => s + v, 0); }

// The winner/loser of a decided 2-way match. Worth naming: applyMatchResult
// below derives both back-to-back in five separate branches, and a
// transposed slotA/slotB in one of those ternaries is invisible on review
// and fatal to a bracket. Only meaningful once winnerSlot is set.
function winnerOf(m) { return m.winnerSlot === 'A' ? m.slotA : m.slotB; }
function loserOf(m) { return m.winnerSlot === 'A' ? m.slotB : m.slotA; }

// Records one unit's (set/end) arrows for one side. Once both sides have
// this unit recorded, set-points are awarded and the match's cumulative
// state + status are recomputed.
function recordUnit(match, formatDef, unitIndex, side, arrows) {
  const units = match.units.slice();
  let unit = units[unitIndex] || { index: unitIndex, arrowsA: null, arrowsB: null, totalA: null, totalB: null, spA: null, spB: null };
  unit = { ...unit, [side === 'A' ? 'arrowsA' : 'arrowsB']: arrows, [side === 'A' ? 'totalA' : 'totalB']: sumArrows(arrows) };
  units[unitIndex] = unit;

  // Starts from the match's carried-over set points, not from zero: the
  // 3-way final's silver/bronze runoff begins at whatever the two archers
  // had already earned against each other (see startThreeWayRunoff).
  // Absent on every ordinary match, where it reads as 0.
  let cumSpA = match.baseSpA || 0, cumSpB = match.baseSpB || 0;
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

// A competitor withdraws or never shows up for a match that's already been
// fed (both slots assigned). The other side is awarded the win without
// playing — same completion path as a normal result, so it advances through
// propagateWinner exactly like any other win. Any arrows already recorded
// on this match (e.g. a mid-match withdrawal) are left in place for the
// record but no longer affect the outcome.
function forfeitMatch(match, winnerSlot) {
  return { ...match, status: 'completed', winnerSlot, forfeit: true };
}

// ---------- 3-way final engine (threeway final format only) ----------
//
// 3 archers shoot every end simultaneously. Each end awards 2 set-points
// total to whoever's strictly highest that end; if 2 or 3 archers tie for
// the top score, they split it 1 point each (so a 3-way tie is 1-1-1, not
// the usual 2-0). Once every end's been shot (or someone reaches the
// winning total early), gold goes outright to whoever's strictly ahead —
// only a genuine tie for the lead needs a shoot-off. Whichever way gold is
// decided, the other two then play on for silver/bronze, carrying over
// whatever set-points they already had against each other, via the
// ordinary 2-way engine (recordUnit/recordShootOff/forfeitMatch) — a
// silver/bronze runoff is really just a normal match that happens to start
// at a non-zero score.

function sumThreeWayPoints(units) {
  const cumSp = [0, 0, 0];
  units.forEach(u => { if (u && u.sps) u.sps.forEach((sp, i) => { cumSp[i] += sp || 0; }); });
  return cumSp;
}

function record3WayUnit(final, formatDef, unitIndex, sideIdx, arrows) {
  const units = final.units.slice();
  let unit = units[unitIndex] || { index: unitIndex, arrows: [null, null, null], totals: [null, null, null], sps: [null, null, null] };
  const totals = unit.totals.slice();
  const arrowsArr = unit.arrows.slice();
  totals[sideIdx] = sumArrows(arrows);
  arrowsArr[sideIdx] = arrows;
  unit = { ...unit, totals, arrows: arrowsArr };
  if (unit.totals.every(t => t != null)) {
    const endMax = Math.max(...unit.totals);
    const endLeaders = unit.totals.filter(v => v === endMax).length;
    unit.sps = unit.totals.map(t => (t === endMax ? (endLeaders === 1 ? 2 : 1) : 0));
  }
  units[unitIndex] = unit;

  const cumSp = sumThreeWayPoints(units);
  const unitsPlayed = units.filter(u => u && u.totals.every(t => t != null)).length;
  const decided = cumSp.some(sp => sp >= formatDef.setPointsToWin);
  const exhausted = unitsPlayed >= formatDef.units;

  let status = 'in_progress';
  let goldSlot = final.goldSlot;
  let shootoffContenders = final.shootoffContenders || null;
  if (decided || exhausted) {
    const max = Math.max(...cumSp);
    const leaders = [0, 1, 2].filter(i => cumSp[i] === max);
    if (leaders.length === 1) {
      goldSlot = leaders[0];
      status = 'runoff';
    } else {
      status = 'shootoff3';
      shootoffContenders = leaders;
    }
  }

  let next = { ...final, units, cumSp, status, goldSlot, shootoffContenders };
  if (status === 'runoff') next = startThreeWayRunoff(next, formatDef);
  return next;
}

// Manual gold declaration among whoever was tied for the lead — same
// judgment-call pattern as a normal 2-way shoot-off, just with 2 or 3
// contenders instead of always 2.
function record3WayShootOff(final, formatDef, goldSlot, arrows) {
  const next = { ...final, status: 'runoff', goldSlot, shootOff3: arrows || null };
  return startThreeWayRunoff(next, formatDef);
}

// Starts the silver/bronze runoff as an ordinary 2-way match object —
// slotA/slotB set to the real participants — seeded with each side's own
// set-points exactly as they stood in the 3-way phase (their literal
// cumSp, not a head-to-head score recomputed from arrows: those two could
// easily have tied every single end without ever contesting the lead, in
// which case recomputing would give a different number than what they
// actually earned). Their arrow history stays on the 3-way final for the
// record; the runoff's own ends start counting fresh from here.
function startThreeWayRunoff(final, formatDef) {
  const remaining = [0, 1, 2].filter(i => i !== final.goldSlot);
  const runoff = {
    slotA: final.sides[remaining[0]], slotB: final.sides[remaining[1]],
    units: [],
    // baseSpA/baseSpB are what recordUnit accumulates onto. Setting only
    // cumSpA/cumSpB is not enough — recordUnit recomputes those from the
    // units array on every end, so the carried points would vanish the
    // moment the first runoff end was confirmed.
    baseSpA: final.cumSp[remaining[0]], baseSpB: final.cumSp[remaining[1]],
    cumSpA: final.cumSp[remaining[0]], cumSpB: final.cumSp[remaining[1]],
    status: 'in_progress', winnerSlot: null, shootOff: null, forfeit: false,
  };
  return { ...final, runoff: { ...runoff, sideA: remaining[0], sideB: remaining[1] } };
}

// MatchScreen plays the runoff exactly like a normal match (including
// forfeit) and hands back the updated match object — this folds it back
// into the 3-way final and, once it's decided, records silver/bronze.
function applyThreeWayRunoffUpdate(final, updatedRunoff) {
  const runoff = { ...updatedRunoff, sideA: final.runoff.sideA, sideB: final.runoff.sideB };
  if (runoff.status !== 'completed') return { ...final, runoff };
  const silverSlot = runoff.winnerSlot === 'A' ? runoff.sideA : runoff.sideB;
  const bronzeSlot = runoff.winnerSlot === 'A' ? runoff.sideB : runoff.sideA;
  return { ...final, runoff, status: 'completed', silverSlot, bronzeSlot };
}

function matchHasResult(m) {
  return !!m && isScored(m);
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
  if (fromEnd === 4) return 'Sedicesimi di finale';
  if (fromEnd === 5) return 'Trentaduesimi di finale';
  return `Turno ${idx + 1}`;
}

// tournament.rounds is truncated for threeway/lancaster finals (their last
// 1-2 rounds move into finalStage instead of staying real bracket rounds —
// see buildBracket) — round labels need the *true* bracket depth (round of
// 32, ottavi, quarti, ecc.) computed from the bracket's size, not just how
// many rounds happen to still be in the array, or the last kept round gets
// mislabeled "Finale" even though the real final is the separate Lancaster
// ladder (or 3-way final) shown below it.
function trueRoundCount(tournament) {
  return Math.log2(tournament.bracketSize);
}

function uidT() { return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function resizeToCanvas(img, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Picks the logo's dominant colour: keep only the "colorful" pixels (drop
// near-white, near-black and low-saturation ones, which are usually
// background rather than the mark), bucket those by hue, and average within
// the single most populous bucket.
//
// Averaging ALL the colourful pixels together — what this did originally —
// only works for a single-hue logo. Given a two-colour club crest, red and
// blue average to a muddy purple that appears nowhere in the image, and
// the saturation filter makes that worse rather than better by removing the
// neutrals that would at least have kept the result plausible. Taking the
// most common hue instead guarantees the accent is a colour the logo
// actually contains.
const ACCENT_HUE_BUCKETS = 24; // 15° each

function extractAccentColor(canvas) {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  const bins = Array.from({ length: ACCENT_HUE_BUCKETS }, () => ({ r: 0, g: 0, b: 0, n: 0 }));

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const lightness = (max + min) / 2;
    const delta = max - min;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    if (saturation < 0.15 || lightness < 0.12 || lightness > 0.9) continue;
    // delta > 0 here, since saturation 0 was filtered out just above.
    let hue = max === rn ? ((gn - bn) / delta) % 6
      : max === gn ? (bn - rn) / delta + 2
        : (rn - gn) / delta + 4;
    hue = ((hue * 60) + 360) % 360;
    const bin = bins[Math.min(ACCENT_HUE_BUCKETS - 1, Math.floor(hue / (360 / ACCENT_HUE_BUCKETS)))];
    bin.r += r; bin.g += g; bin.b += b; bin.n++;
  }

  const best = bins.reduce((a, b) => (b.n > a.n ? b : a));
  if (!best.n) return null;
  const toHex = v => Math.round(v / best.n).toString(16).padStart(2, '0');
  return `#${toHex(best.r)}${toHex(best.g)}${toHex(best.b)}`;
}

function relativeLuminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA) + 0.05;
  const lB = relativeLuminance(hexB) + 0.05;
  return lA > lB ? lA / lB : lB / lA;
}

// 4.5:1, not the 3:1 large-text/graphics threshold: the accent is used for
// the small "Campione" caption and other body-size text on the public page,
// not just for borders and icons. A logo colour that can't clear this is
// dropped and the page falls back to T.gold.
function accentColorContrastOk(hex) {
  return contrastRatio(hex, T.bg) >= 4.5;
}

function createTournament({ name, date, distanceM, faceCm, formatId, participants, finalFormat = 'standard' }) {
  const sorted = participants.slice().sort((a, b) => b.seedScore - a.seedScore);
  const seeded = sorted.map((p, i) => ({ ...p, seed: i + 1 }));
  const { size, rounds, finalStage, thirdPlaceMatch } = buildBracket(seeded, finalFormat);
  return {
    id: uidT(),
    name, date, distanceM, faceCm, formatId, finalFormat,
    participants: seeded,
    bracketSize: size,
    rounds, finalStage, thirdPlaceMatch,
    createdAt: new Date().toISOString(),
  };
}

// Looks up the plain 2-way match (and a display title) a ref points to, for
// any ref kind MatchScreen itself can play — everything except 'threeFinal',
// which needs the dedicated ThreeWayFinalScreen instead.
function resolveMatchRef(tournament, ref) {
  if (ref.kind === 'round') return { match: tournament.rounds[ref.roundIdx][ref.matchIdx], title: roundName(trueRoundCount(tournament), ref.roundIdx) };
  if (ref.kind === 'thirdPlace') return { match: tournament.thirdPlaceMatch, title: 'Finale 3°/4° posto' };
  if (ref.kind === 'prelim') return { match: tournament.finalStage.prelim, title: 'Preliminare 3°/4° posto' };
  if (ref.kind === 'lancasterPlayIn') return { match: tournament.finalStage.playIn, title: 'Ripescaggio (per la 4ª posizione)' };
  if (ref.kind === 'lancaster1') return { match: tournament.finalStage.match1, title: '4ª vs 3ª (per punteggio)' };
  if (ref.kind === 'lancaster2') return { match: tournament.finalStage.match2, title: 'Vincente vs 2ª (per punteggio)' };
  if (ref.kind === 'lancaster3') return { match: tournament.finalStage.match3, title: 'Finale (per punteggio)' };
  return null;
}

function refEquals(a, b) {
  if (!a || !b) return false;
  return a.kind === b.kind && a.roundIdx === b.roundIdx && a.matchIdx === b.matchIdx;
}

// Every openable match/final in a tournament, in the same order the
// bracket screen lists them — used for superuser mode's arrow-key
// navigation (see the root component's keydown handler).
function flatMatchRefs(tournament) {
  const refs = [];
  tournament.rounds.forEach((round, ri) => round.forEach((_, mi) => refs.push({ kind: 'round', roundIdx: ri, matchIdx: mi })));
  if (tournament.finalFormat === 'standard' && tournament.thirdPlaceMatch) refs.push({ kind: 'thirdPlace' });
  if (tournament.finalFormat === 'threeway' && tournament.finalStage) refs.push({ kind: 'prelim' }, { kind: 'threeFinal' });
  if (tournament.finalFormat === 'lancaster' && tournament.finalStage) {
    if (tournament.finalStage.playIn) refs.push({ kind: 'lancasterPlayIn' });
    refs.push({ kind: 'lancaster1' }, { kind: 'lancaster2' }, { kind: 'lancaster3' });
  }
  return refs;
}

// Stable string key for a match ref, used as the pendingSubmissions map
// key (see participant self-scoring below). Every non-'round' kind is
// already a unique singleton string, so this is injective across every
// ref a tournament can produce. Opaque bookkeeping — nothing server-side
// ever parses or interprets it, only this file's own reconciliation logic
// does, via parseRefKey below.
function refKey(ref) {
  return ref.kind === 'round' ? `round:${ref.roundIdx}:${ref.matchIdx}` : ref.kind;
}

function parseRefKey(key) {
  if (key.startsWith('round:')) {
    const [, roundIdx, matchIdx] = key.split(':');
    return { kind: 'round', roundIdx: Number(roundIdx), matchIdx: Number(matchIdx) };
  }
  return { kind: key };
}

// threeFinal is deliberately excluded everywhere this is used — its
// 3-sided ThreeWayFinalScreen doesn't share MatchScreen's slotA/slotB
// shape, and a gold/silver/bronze final is realistically always run live
// by the organizer anyway.
function matchRefHasParticipant(tournament, ref, participantId) {
  if (ref.kind === 'threeFinal') return false;
  const resolved = resolveMatchRef(tournament, ref);
  if (!resolved) return false;
  return resolved.match.slotA?.id === participantId || resolved.match.slotB?.id === participantId;
}

// Order-insensitive per-unit, per-side comparison: two participants
// independently recalling the same end don't always list the arrows in
// the same order (e.g. "10-9-8" vs "10-8-9" are the same end), so this
// sorts each side's arrows numerically before comparing rather than
// requiring the arrays to match element-for-element. totalA/totalB/spA/spB
// are sums derived from the arrows, so they agree automatically whenever
// the arrows do — no need to compare them separately.
// Replays an agreed set of unit scores onto the bracket's OWN match object.
//
// unitsMatch below establishes that two submissions agree on the arrows —
// and that totals and set points, being sums of those arrows, therefore
// agree too. That is true, and it used to be taken as licence to apply one
// participant's whole match object to the bracket. It isn't: winnerSlot,
// status, slotA/slotB, shootOff and forfeit are not derived from the
// arrows, so two people could agree on every arrow while submitting
// different verdicts on who won — and the first one in would stand.
//
// Re-deriving from the real match means nothing a participant sends is
// trusted except the arrow scores themselves, and those are range-checked
// here. Returns null if the submission isn't replayable, in which case the
// caller discards it rather than guessing.
function rebuildMatchFromUnits(match, formatDef, units) {
  if (!Array.isArray(units) || units.length === 0) return null;
  const valid = arr => Array.isArray(arr) && arr.length > 0 &&
    arr.every(v => Number.isFinite(v) && v >= 0 && v <= 10);
  let m = match;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u || !valid(u.arrowsA) || !valid(u.arrowsB)) return null;
    m = recordUnit(m, formatDef, i, 'A', u.arrowsA);
    m = recordUnit(m, formatDef, i, 'B', u.arrowsB);
  }
  return m;
}

// Written into pendingSubmissions[matchKey] in place of the two
// submissions when reconciliation throws them away — either because the
// arrows disagreed or because they wouldn't replay onto the bracket. The
// participant page reads it to explain why it's asking for the score
// again; without it, a discarded submission is indistinguishable from
// never having sent one, and both archers' phones still say "inviato".
// Underscore-prefixed so it can never collide with a participant id
// (uid() emits `id_...`), since the SQL function merges new submissions
// into the same object by participant id.
const SUBMISSION_MISMATCH_KEY = '__mismatch';

function unitsMatch(unitsA, unitsB) {
  if (!Array.isArray(unitsA) || !Array.isArray(unitsB) || unitsA.length !== unitsB.length) return false;
  const sortNums = arr => [...(arr || [])].sort((x, y) => x - y);
  return unitsA.every((ua, i) => {
    const ub = unitsB[i];
    if (!ub) return false;
    return JSON.stringify(sortNums(ua.arrowsA)) === JSON.stringify(sortNums(ub.arrowsA))
        && JSON.stringify(sortNums(ua.arrowsB)) === JSON.stringify(sortNums(ub.arrowsB));
  });
}

// The decision half of the participant-submission reconciliation: given a
// tournament and the pendingSubmissions blob just read back from the
// server, work out what the bracket and that blob should become. Pure, and
// deliberately separate from the effect that polls for it — this is the
// only path by which someone who is not the organizer can move the
// bracket, and it was previously twenty lines buried in a functional
// updater where nothing could reach it.
function reconcilePendingSubmissions(tournament, remotePending, now = new Date().toISOString()) {
  let next = tournament;
  const pending = { ...remotePending };
  for (const [matchKey, submissions] of Object.entries(remotePending)) {
    const ids = Object.keys(submissions).filter(id => id !== SUBMISSION_MISMATCH_KEY);
    if (ids.length < 2) continue; // only one side in so far — nothing to reconcile yet
    const ref = parseRefKey(matchKey);
    if (!isRefPlayable(next, ref)) { delete pending[matchKey]; continue; }
    const [subA, subB] = ids.map(id => submissions[id].updatedMatch);
    let applied = false;
    if (unitsMatch(subA?.units, subB?.units)) {
      // Replay the agreed arrows onto the bracket's own match rather than
      // applying the object a participant sent — see rebuildMatchFromUnits.
      const rebuilt = rebuildMatchFromUnits(resolveMatchRef(next, ref).match, matchFormatDef(next.formatId), subA.units);
      if (rebuilt) { next = applyMatchResult(next, ref, rebuilt); applied = true; }
    }
    // Applied: the submissions have done their job and go. Not applied:
    // the arrows disagreed, or agreed but wouldn't replay — either way
    // both are discarded, but a marker replaces them so the participant
    // page can say why it wants the score again. Dropping them with no
    // trace is what let two archers walk away believing a match was
    // recorded when nothing was.
    if (applied) delete pending[matchKey];
    else pending[matchKey] = { [SUBMISSION_MISMATCH_KEY]: now };
  }
  return { ...next, pendingSubmissions: pending };
}

// The three status sets every card, bracket cell and playability check reads.
// These used to be re-inlined as boolean chains at five call sites, which
// meant adding a match status was a find-all-the-copies exercise.
// 'playable' = a scorer can open it now; 'scored' = it has a score worth
// showing (a running one counts, a bye doesn't).
const PLAYABLE_MATCH_STATUSES = new Set(['pending', 'in_progress', 'shootoff']);
const SCORED_MATCH_STATUSES = new Set(['completed', 'in_progress', 'shootoff']);
const PLAYABLE_3WAY_STATUSES = new Set(['pending', 'in_progress', 'shootoff3', 'runoff']);

const isPlayable = m => PLAYABLE_MATCH_STATUSES.has(m.status);
const isScored = m => SCORED_MATCH_STATUSES.has(m.status);

function isRefPlayable(tournament, ref) {
  if (ref.kind === 'threeFinal') return PLAYABLE_3WAY_STATUSES.has(tournament.finalStage.final.status);
  const resolved = resolveMatchRef(tournament, ref);
  return !!resolved && isPlayable(resolved.match);
}

// Superuser auto-advance: given the match/final that was just completed,
// finds the next playable one in bracket order, wrapping around — same
// ordering and playability rules the arrow-key bracket cursor already uses,
// so the two stay mentally consistent. Returns null once nothing is left to
// play, in which case the caller falls back to just showing the bracket.
function nextPlayableRef(tournament, justCompletedRef) {
  const all = flatMatchRefs(tournament);
  const idx = justCompletedRef ? all.findIndex(r => refEquals(r, justCompletedRef)) : -1;
  const start = idx === -1 ? 0 : idx + 1;
  for (let i = 0; i < all.length; i++) {
    const candidate = all[(start + i) % all.length];
    if (isRefPlayable(tournament, candidate)) return candidate;
  }
  return null;
}

// Applies a completed (or in-progress) match's result back into the
// tournament. `ref` identifies where the match lives:
//   { kind: 'round', roundIdx, matchIdx }  — a normal bracket position
//   { kind: 'thirdPlace' }                 — standard format's bronze match
//   { kind: 'prelim' }                     — threeway's 3rd/4th decider
//   { kind: 'lancaster1'|'lancaster2'|'lancaster3' } — Lancaster's ladder
//   { kind: 'threeFinal' }                 — the 3-way final itself
// and drives the propagation appropriate to that spot (see FINAL_FORMATS
// for what each one feeds into).
function applyMatchResult(tournament, ref, updatedMatch) {
  if (ref.kind === 'round') {
    const prevMatch = tournament.rounds[ref.roundIdx][ref.matchIdx];
    const rounds = tournament.rounds.map(r => r.slice());
    rounds[ref.roundIdx][ref.matchIdx] = updatedMatch;
    const next = { ...tournament, rounds };

    // Correcting a confirmed set can flip (or un-decide) a result that has
    // already been propagated. Everything it fed was earned by a competitor
    // who may no longer be in those matches, so it has to be torn down
    // BEFORE the new winner is pushed forward — otherwise the old winner's
    // arrows stay attached to whoever replaced them, and the bracket ends up
    // showing a match that is at once "Da giocare" and already won.
    if (prevMatch.status === 'completed' &&
        (updatedMatch.status !== 'completed' || winnerOf(prevMatch)?.id !== winnerOf(updatedMatch)?.id)) {
      invalidateDownstream(rounds, ref.roundIdx, ref.matchIdx);
    }

    const isLastRound = ref.roundIdx === rounds.length - 1;
    if (!isLastRound) {
      if (updatedMatch.status === 'completed') propagateWinner(rounds, ref.roundIdx, ref.matchIdx, updatedMatch.winnerSlot);

      if (tournament.finalFormat === 'standard' && tournament.thirdPlaceMatch && ref.roundIdx === rounds.length - 2) {
        const semis = rounds[ref.roundIdx];
        let tp = tournament.thirdPlaceMatch;
        semis.forEach((m, i) => {
          tp = fillMatchSlot(tp, i % 2 === 0 ? 'slotA' : 'slotB', m.status === 'completed' ? loserOf(m) : null);
        });
        if (semis.every(matchIsDecided)) tp = resolveByeIfLonely(tp);
        next.thirdPlaceMatch = tp;
      }
      return next;
    }

    // This round produces the semifinalists for a custom final stage. Both
    // branches re-derive from the round as a whole rather than from the one
    // match just played, so byes — which never reach this function — seed
    // their side too.
    if (tournament.finalFormat === 'threeway' && tournament.finalStage) {
      next.finalStage = relinkThreeWayFinalStage(tournament.finalStage, rounds[ref.roundIdx]);
      return next;
    }

    if (tournament.finalFormat === 'lancaster' && tournament.finalStage) {
      const winners = rounds[ref.roundIdx].map(m => (matchIsDecided(m) ? winnerOf(m) : null));
      const finalStage = { ...tournament.finalStage };
      if (winners.every(Boolean)) {
        finalStage.sides = seedLancasterSides(winners);
        seedLancasterLadder(finalStage);
      }
      next.finalStage = finalStage;
      return next;
    }

    return next; // standard format's own final round — nothing extra to do
  }

  if (ref.kind === 'thirdPlace') {
    return { ...tournament, thirdPlaceMatch: updatedMatch };
  }

  if (ref.kind === 'prelim') {
    const semis = tournament.rounds[tournament.rounds.length - 1] || [];
    return { ...tournament, finalStage: relinkThreeWayFinalStage({ ...tournament.finalStage, prelim: updatedMatch }, semis) };
  }

  // Every Lancaster ladder slot is fed by the match before it — the optional
  // wildcard play-in into match1, match1 into match2, match2 into match3 —
  // so whichever link just changed, relinking the whole chain re-feeds the
  // rest and re-derives the standings from it.
  const LANCASTER_REFS = { lancasterPlayIn: 'playIn', lancaster1: 'match1', lancaster2: 'match2', lancaster3: 'match3' };
  if (LANCASTER_REFS[ref.kind]) {
    const finalStage = { ...tournament.finalStage, [LANCASTER_REFS[ref.kind]]: updatedMatch };
    return { ...tournament, finalStage: relinkLancasterLadder(finalStage) };
  }

  if (ref.kind === 'threeFinal') {
    return { ...tournament, finalStage: { ...tournament.finalStage, final: updatedMatch } };
  }

  return tournament;
}

function tournamentIsComplete(tournament) {
  if (tournament.finalStage) {
    if (tournament.finalFormat === 'threeway') return tournament.finalStage.final.status === 'completed';
    if (tournament.finalFormat === 'lancaster') return tournament.finalStage.match3.status === 'completed';
  }
  const last = tournament.rounds[tournament.rounds.length - 1];
  return last.length === 1 && last[0].status === 'completed';
}

// Unifies "who finished where" across all three final formats once the
// tournament (or as much of it as has a result) allows it — used for the
// podium display. Returns null until there's at least a gold medalist.
function tournamentPodium(tournament) {
  if (tournament.finalFormat === 'threeway' && tournament.finalStage) {
    const f = tournament.finalStage.final;
    if (f.status !== 'completed') return null;
    return {
      gold: f.sides[f.goldSlot], silver: f.sides[f.silverSlot], bronze: f.sides[f.bronzeSlot],
      fourth: tournament.finalStage.standings.fourth || null,
    };
  }
  if (tournament.finalFormat === 'lancaster' && tournament.finalStage) {
    if (tournament.finalStage.match3.status !== 'completed') return null;
    const s = tournament.finalStage.standings;
    return { gold: s.first || null, silver: s.second || null, bronze: s.third || null, fourth: s.fourth || null };
  }
  const last = tournament.rounds[tournament.rounds.length - 1];
  if (!last || last.length !== 1 || last[0].status !== 'completed') return null;
  const f = last[0];
  const gold = winnerOf(f);
  const silver = loserOf(f);
  let bronze = null, fourth = null;
  const tp = tournament.thirdPlaceMatch;
  if (tp && (tp.status === 'completed' || tp.status === 'bye')) {
    bronze = winnerOf(tp);
    fourth = tp.status === 'completed' ? loserOf(tp) : null;
  }
  return { gold, silver, bronze, fourth };
}

// True once any match has a real result on it (played or forfeited).
// Byes don't count — they're just structural, not something anyone played.
// Used to gate the "edit participants & redraw bracket" flow: safe only
// while nothing in the draw has actually happened yet.
function tournamentHasStarted(tournament) {
  if (tournament.rounds.some(round => round.some(matchHasResult))) return true;
  if (matchHasResult(tournament.thirdPlaceMatch)) return true;
  const fs = tournament.finalStage;
  if (fs) {
    if (fs.format === 'threeway' && (matchHasResult(fs.prelim) || fs.final.units.length > 0 || fs.final.status === 'completed')) return true;
    if (fs.format === 'lancaster' && (matchHasResult(fs.playIn) || matchHasResult(fs.match1) || matchHasResult(fs.match2) || matchHasResult(fs.match3))) return true;
  }
  return false;
}

// Re-seeds and rebuilds the whole bracket from scratch against a new
// participant list, discarding the old draw entirely. Only meant to be
// used before the tournament has started (see tournamentHasStarted) —
// calling it after real results exist would silently wipe them.
function rebuildTournamentBracket(tournament, participants, finalFormat = tournament.finalFormat) {
  const sorted = participants.slice().sort((a, b) => b.seedScore - a.seedScore);
  const seeded = sorted.map((p, i) => ({ ...p, seed: i + 1 }));
  const { size, rounds, finalStage, thirdPlaceMatch } = buildBracket(seeded, finalFormat);
  return { ...tournament, participants: seeded, bracketSize: size, rounds, finalFormat, finalStage, thirdPlaceMatch };
}

// Wipes every match result and redraws the bracket against the exact same
// seeded participant list — a do-over, not a redraw. Unlike
// rebuildTournamentBracket (which is only safe pre-start, since it can
// change who's in the draw), this is meant to be used at any point,
// including mid- or post-tournament, when the scorer wants to throw away
// what's been played and start the bracket fresh. Optionally also swaps
// the final format at the same time, since a reset already wipes results.
function resetTournamentBracket(tournament, finalFormat = tournament.finalFormat) {
  return rebuildTournamentBracket(tournament, tournament.participants, finalFormat);
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
        <button onClick={add} disabled={!name.trim()} className="w-11 h-11 rounded-xl flex items-center justify-center disabled:opacity-40" style={{ background: T.gold, color: GOLD_TEXT }} aria-label="Aggiungi arciere">
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
              <button onClick={() => remove(p.id)} className="p-1 rounded-full shrink-0 min-w-11 min-h-11 flex items-center justify-center" style={{ color: T.textFaint }} aria-label={`Rimuovi ${p.name}`}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {sorted.length < 2 && <div className="text-xs" style={{ color: T.textDim }}>Servono almeno 2 {isTeam ? 'squadre' : 'arcieri'} per creare il tabellone.</div>}
    </div>
  );
}

function FinalFormatPicker({ value, onChange }) {
  return (
    <div className="flex flex-col gap-2">
      {FINAL_FORMATS.map(f => (
        <button key={f.id} onClick={() => onChange(f.id)}
          className="text-left rounded-2xl px-4 py-3 flex items-center justify-between gap-3"
          style={{ background: f.id === value ? T.surfaceAlt : T.surface, border: `1px solid ${f.id === value ? T.gold : T.border}` }}>
          <div>
            <div className="font-semibold">{f.label}</div>
            <div className="text-xs" style={{ color: T.textDim }}>{f.desc}</div>
          </div>
          {f.id === value && <Check color={T.gold} size={20} className="shrink-0" />}
        </button>
      ))}
    </div>
  );
}

const TOURNAMENT_STEPS = ['details', 'format', 'participants', 'final'];
const TOURNAMENT_STEP_TITLES = { details: 'Nuovo torneo', format: 'Formato match', participants: 'Partecipanti', final: 'Formato finale' };

// Six decision categories used to be a single unbroken scroll — the same
// step-by-step pattern NewSessionScreen already uses for the (lower-stakes)
// personal-session flow, applied here so a multi-decision setup task reads
// as a sequence instead of a wall.
function TournamentCreateScreen({ onCreate, onCancel }) {
  const [step, setStep] = useState('details');
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formatId, setFormatId] = useState('individual');
  const [distanceM, setDistanceM] = useState(70);
  const [faceCm, setFaceCm] = useState(122);
  const [participants, setParticipants] = useState([]);
  const [finalFormat, setFinalFormat] = useState('standard');

  const canContinue = step === 'details' ? !!name.trim() : step === 'participants' ? participants.length >= 2 : true;
  const canCreate = name.trim() && participants.length >= 2;

  function goBack() {
    const idx = TOURNAMENT_STEPS.indexOf(step);
    if (idx <= 0) onCancel();
    else setStep(TOURNAMENT_STEPS[idx - 1]);
  }
  function goNext() {
    const idx = TOURNAMENT_STEPS.indexOf(step);
    if (idx < TOURNAMENT_STEPS.length - 1) setStep(TOURNAMENT_STEPS[idx + 1]);
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={goBack} className="p-2 -ml-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" aria-label="Indietro"><ChevronLeft /></button>
        <h1 className="text-xl font-bold">{TOURNAMENT_STEP_TITLES[step]}</h1>
      </div>

      <div className="flex gap-1.5">
        {TOURNAMENT_STEPS.map(s => (
          <div key={s} className="h-1 flex-1 rounded-full"
            style={{ background: TOURNAMENT_STEPS.indexOf(s) <= TOURNAMENT_STEPS.indexOf(step) ? T.gold : T.border }} />
        ))}
      </div>

      {step === 'details' && (
        <div className="flex flex-col gap-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome del torneo"
            className="rounded-xl px-3 py-2.5" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="rounded-xl px-3 py-2.5" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text, colorScheme: 'dark' }} />
        </div>
      )}

      {step === 'format' && (
        <div className="flex flex-col gap-4">
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

          <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <Stepper label="Distanza (m)" value={distanceM} onChange={setDistanceM} min={10} max={90} step={5} />
            <div className="flex items-center justify-between">
              <div className="text-sm" style={{ color: T.textDim }}>Diametro bersaglio (cm)</div>
              <SegmentedControl options={FACE_SIZE_OPTIONS} value={faceCm} onChange={setFaceCm} small />
            </div>
          </div>
        </div>
      )}

      {step === 'participants' && (
        <div className="flex flex-col gap-2">
          <div className="text-xs" style={{ color: T.textDim }}>Partecipanti (ordinati per punteggio di qualifica)</div>
          <ParticipantEditor formatId={formatId} participants={participants} setParticipants={setParticipants} />
        </div>
      )}

      {step === 'final' && (
        <div className="flex flex-col gap-2">
          <div className="text-xs" style={{ color: T.textDim }}>Formato finale (con almeno 4 partecipanti)</div>
          <FinalFormatPicker value={finalFormat} onChange={setFinalFormat} />
        </div>
      )}

      {step === 'final' ? (
        <button onClick={() => canCreate && onCreate(createTournament({ name: name.trim(), date, distanceM, faceCm, formatId, participants, finalFormat }))}
          disabled={!canCreate} className="rounded-2xl py-4 font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-40"
          style={{ background: T.gold, color: GOLD_TEXT }}>
          <Shuffle size={20} /> Genera tabellone
        </button>
      ) : (
        <button onClick={goNext} disabled={!canContinue}
          className="rounded-2xl py-3.5 font-bold disabled:opacity-40" style={{ background: T.gold, color: GOLD_TEXT }}>
          Continua
        </button>
      )}
    </div>
  );
}

// Edits the participant list of a not-yet-started tournament and redraws
// the whole bracket from scratch on save (see rebuildTournamentBracket).
// Format/distance/face/date stay fixed here — this is only for fixing the
// entry list (no-shows, late arrivals, withdrawals before play begins).
function TournamentEditParticipantsScreen({ tournament, onSave, onCancel }) {
  const [participants, setParticipants] = useState(tournament.participants);
  const [finalFormat, setFinalFormat] = useState(tournament.finalFormat);
  const canSave = participants.length >= 2;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="p-2 -ml-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" aria-label="Indietro"><ChevronLeft /></button>
        <h1 className="text-xl font-bold">Modifica partecipanti</h1>
      </div>
      <div className="text-sm" style={{ color: T.textDim }}>
        Il tabellone verrà rigenerato da zero con il nuovo elenco. Puoi farlo solo prima che sia stato giocato o dichiarato ritirato il primo match.
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs" style={{ color: T.textDim }}>Partecipanti (ordinati per punteggio di qualifica)</div>
        <ParticipantEditor formatId={tournament.formatId} participants={participants} setParticipants={setParticipants} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs" style={{ color: T.textDim }}>Formato finale (con almeno 4 partecipanti)</div>
        <FinalFormatPicker value={finalFormat} onChange={setFinalFormat} />
      </div>

      <button onClick={() => canSave && onSave(participants, finalFormat)}
        disabled={!canSave} className="rounded-2xl py-4 font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-40"
        style={{ background: T.gold, color: GOLD_TEXT }}>
        <Shuffle size={20} /> Rigenera tabellone
      </button>
    </div>
  );
}

// ---------- tournament: bracket + match ----------

function MatchCard({ match, onOpen, focused, accentColor = T.gold }) {
  const playable = isPlayable(match);
  const statusLabel = match.status === 'bye' ? 'Bye' : match.status === 'waiting' ? 'In attesa' :
    match.status === 'completed' ? 'Conclusa' : match.status === 'shootoff' ? 'Spareggio' : 'Da giocare';
  return (
    <button onClick={() => playable && onOpen()} disabled={!playable}
      className="w-full text-left rounded-2xl px-4 py-3 flex flex-col gap-2"
      style={{ background: T.surface, border: `1px solid ${playable ? accentColor : T.border}`, opacity: match.status === 'waiting' ? 0.6 : 1,
        boxShadow: focused ? `0 0 0 2px ${T.blue}` : undefined }}>
      <div className="flex items-center justify-between text-xs" style={{ color: T.textDim }}>
        <span>{statusLabel}{match.forfeit ? ' · W.O.' : ''}</span>
        {isScored(match) && (
          <span style={numeralStyle}>{match.cumSpA} - {match.cumSpB}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className={`truncate ${match.winnerSlot === 'A' ? 'font-bold' : ''}`} style={{ color: match.winnerSlot === 'B' ? T.textDim : T.text }}>
          {match.slotA ? `${match.slotA.seed}. ${match.slotA.name}` : '—'}
        </div>
        {match.winnerSlot === 'A' && <Check size={16} color={accentColor} />}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className={`truncate ${match.winnerSlot === 'B' ? 'font-bold' : ''}`} style={{ color: match.winnerSlot === 'A' ? T.textDim : T.text }}>
          {match.slotB ? `${match.slotB.seed}. ${match.slotB.name}` : '—'}
        </div>
        {match.winnerSlot === 'B' && <Check size={16} color={accentColor} />}
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

const BRACKET_CARD_W = 264;
const BRACKET_CARD_H = 64;
const BRACKET_ROW_GAP = 16;
const BRACKET_COL_GAP = 80;
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

function CompactMatchCard({ match, x, y, onOpen, focused, accentColor = T.gold }) {
  const playable = isPlayable(match);
  const scored = isScored(match);
  return (
    <button onClick={() => playable && onOpen()} disabled={!playable}
      className="absolute rounded-xl px-2.5 py-1.5 flex flex-col justify-center gap-0.5 text-left"
      style={{ left: x, top: y, width: BRACKET_CARD_W, height: BRACKET_CARD_H,
        background: T.surface, border: `1px solid ${playable ? accentColor : T.border}`, opacity: match.status === 'waiting' ? 0.55 : 1,
        boxShadow: focused ? `0 0 0 2px ${T.blue}` : undefined }}>
      <div className={`text-xs truncate ${match.winnerSlot === 'A' ? 'font-bold' : ''}`} style={{ color: match.winnerSlot === 'B' ? T.textDim : T.text }}>
        {match.slotA ? `${match.slotA.seed}. ${match.slotA.name}` : '—'}
      </div>
      <div className={`text-xs truncate ${match.winnerSlot === 'B' ? 'font-bold' : ''}`} style={{ color: match.winnerSlot === 'A' ? T.textDim : T.text }}>
        {match.slotB ? `${match.slotB.seed}. ${match.slotB.name}` : '—'}
      </div>
      {scored && <div className="text-[10px]" style={{ color: T.textFaint, ...numeralStyle }}>{match.cumSpA} - {match.cumSpB}{match.forfeit ? ' · W.O.' : ''}</div>}
    </button>
  );
}

function BracketTree({ tournament, onOpenMatch, focusRef, accentColor = T.gold }) {
  const { rounds } = tournament;
  const { centers, totalHeight } = useMemo(() => computeBracketLayout(rounds), [rounds]);
  const colWidth = BRACKET_CARD_W + BRACKET_COL_GAP;
  const totalWidth = rounds.length * colWidth - BRACKET_COL_GAP;

  return (
    <div className="overflow-x-auto -mx-4 px-4 pb-2">
      {/* Horizontal scroll only — no maxHeight/vertical scroll here, so a
          tall bracket just extends the page's own scroll instead of being
          trapped in its own confined scroll box with content below it
          (the podium, the Lancaster ladder, ecc.) unreachable without a
          separate inner scroll. mx-auto centers the tree when it's narrower
          than the viewport (wide desktop screens) — auto margins can't go
          negative, so on a narrow screen where the tree is wider than its
          container this has no effect and round 1 stays flush-left, exactly
          as the horizontal
          scroll already relies on. */}
      <div className="relative mx-auto" style={{ width: totalWidth, height: totalHeight + BRACKET_Y_OFFSET }}>
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
              {roundName(trueRoundCount(tournament), r)}
            </div>
            {round.map((m, i) => (
              <CompactMatchCard key={i} match={m} x={r * colWidth} y={centers[r][i] - BRACKET_CARD_H / 2 + BRACKET_Y_OFFSET}
                onOpen={() => onOpenMatch({ kind: 'round', roundIdx: r, matchIdx: i })}
                focused={refEquals(focusRef, { kind: 'round', roundIdx: r, matchIdx: i })} accentColor={accentColor} />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// Compact summary of the 3-way final's live state — three names instead of
// the usual two, with each side's running set-points and, once decided,
// gold/silver markers (bronze is implied: whoever's left).
function ThreeWayFinalCard({ final, onOpen, focused, accentColor = T.gold }) {
  const playable = PLAYABLE_3WAY_STATUSES.has(final.status);
  const statusLabel = final.status === 'waiting' ? 'In attesa' : final.status === 'pending' ? 'Da giocare'
    : final.status === 'shootoff3' ? 'Spareggio per l’oro' : final.status === 'runoff' ? 'Spareggio 2°/3° posto'
    : final.status === 'completed' ? 'Conclusa' : 'In corso';
  return (
    <button onClick={() => playable && onOpen()} disabled={!playable}
      className="w-full text-left rounded-2xl px-4 py-3 flex flex-col gap-2"
      style={{ background: T.surface, border: `1px solid ${playable ? accentColor : T.border}`, opacity: final.status === 'waiting' ? 0.6 : 1,
        boxShadow: focused ? `0 0 0 2px ${T.blue}` : undefined }}>
      <div className="text-xs" style={{ color: T.textDim }}>{statusLabel}</div>
      {[0, 1, 2].map(i => (
        <div key={i} className="flex items-center justify-between gap-2">
          <div className={`truncate ${final.goldSlot === i ? 'font-bold' : ''}`} style={{ color: T.text }}>
            {final.sides[i] ? final.sides[i].name : '—'}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={numeralStyle}>{final.cumSp ? final.cumSp[i] || 0 : 0}</span>
            {final.goldSlot === i && <Trophy size={14} color={accentColor} />}
            {final.silverSlot === i && <Check size={14} color={T.textDim} />}
          </div>
        </div>
      ))}
    </button>
  );
}

function PodiumCard({ podium, accentColor = T.gold }) {
  if (!podium || !podium.gold) return null;
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: T.surfaceAlt, border: `1px solid ${accentColor}` }}>
      <div className="flex items-center gap-3">
        <Trophy color={accentColor} size={28} />
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: accentColor }}>Campione</div>
          <div className="text-lg font-bold">{podium.gold.name}</div>
        </div>
      </div>
      {(podium.silver || podium.bronze || podium.fourth) && (
        <div className="text-sm flex flex-col gap-0.5 pl-1" style={{ color: T.textDim }}>
          {podium.silver && <div>2° — {podium.silver.name}</div>}
          {podium.bronze && <div>3° — {podium.bronze.name}</div>}
          {podium.fourth && <div>4° — {podium.fourth.name}</div>}
        </div>
      )}
    </div>
  );
}

// Collapsed trigger that expands into a dashed panel — the idiom every
// tournament-level control below uses (reset, share, emails, logo,
// withdrawal, Lancaster wildcard). It was copy-pasted six times, and the
// copies had drifted: some closed with "Chiudi", some with "Annulla", some
// offered both. One component, one "Chiudi".
//
// `variant` is the only real difference between them: a destructive or
// primary action gets the full card trigger, an in-context aside gets a
// small text link. `children` may be a function taking a `close` callback,
// for panels whose own primary action should also collapse them.
function Disclosure({ label, icon: Icon, variant = 'button', onOpen, onClose, children }) {
  const [open, setOpen] = useState(false);
  const close = () => { setOpen(false); onClose?.(); };

  if (!open) {
    const start = () => { onOpen?.(); setOpen(true); };
    return variant === 'link' ? (
      <button onClick={start} className="text-xs self-center py-1" style={{ color: T.textFaint }}>{label}</button>
    ) : (
      <button onClick={start}
        className="rounded-2xl py-3 font-semibold flex items-center justify-center gap-2 min-h-11"
        style={{ background: T.surface, color: T.textDim, border: `1px solid ${T.border}` }}>
        {Icon && <Icon size={16} />} {label}
      </button>
    );
  }

  return (
    <div className="rounded-2xl p-3 flex flex-col gap-3" style={{ background: T.surfaceAlt, border: `1px dashed ${T.border}` }}>
      {typeof children === 'function' ? children(close) : children}
      <button onClick={close} className="text-xs self-center py-1" style={{ color: T.textFaint }}>Chiudi</button>
    </div>
  );
}

// Resets the whole bracket back to "just seeded", discarding every match
// result played so far. Shown only once the tournament has actually started
// (nothing to reset before that). While at it, the final format can be
// changed too — a reset already discards finalStage entirely, so swapping
// the format at the same time costs nothing extra (see resetTournamentBracket).
function ResetTournamentButton({ tournament, onReset }) {
  const [finalFormat, setFinalFormat] = useState(tournament.finalFormat);

  return (
    <Disclosure label="Reset torneo" icon={RotateCcw} onOpen={() => setFinalFormat(tournament.finalFormat)}>
      <div className="text-xs" style={{ color: T.textDim }}>Cancella tutti i risultati e rigenera il tabellone. Puoi anche cambiare il formato della finale.</div>
      <FinalFormatPicker value={finalFormat} onChange={setFinalFormat} />
      <button onClick={() => onReset(finalFormat)}
        className="rounded-xl py-2.5 font-semibold flex items-center justify-center gap-2"
        style={{ background: T.red, color: T.onRed }}>
        <RotateCcw size={16} /> Conferma: cancella tutti i risultati
      </button>
    </Disclosure>
  );
}

// Minting a token is idempotent (re-tapping "Condividi torneo" after a link
// already exists just re-copies it) so an already-sent link never silently
// breaks.
function ShareTournamentControl({ tournament, onSetShareToken }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = () => {
    const token = tournament.shareToken || crypto.randomUUID();
    if (!tournament.shareToken) onSetShareToken(token);
    // share.html is the stripped spectator build (see site/build.js): the
    // same screen without the personal scorecard or its charting library
    // behind it, ~400 KB instead of ~930 KB on a range with one bar of
    // signal. Resolved relative to the current document so it works from
    // both `/app/` and `/app/index.html`. index.html still handles
    // ?share= itself, so links copied before this change keep working —
    // they just download more than they need to.
    const url = `${new URL('share.html', window.location.href).href}?share=${token}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
  };

  return (
    <Disclosure label="Condividi torneo" icon={Share2}>
      <div className="text-xs" style={{ color: T.textDim }}>
        Chiunque abbia questo link può seguire il tabellone in tempo reale, senza bisogno di accedere.
      </div>
      <button onClick={handleCopy}
        className="rounded-xl py-2.5 font-semibold flex items-center justify-center gap-2 min-h-11"
        style={{ background: T.gold, color: GOLD_TEXT }}>
        <Share2 size={16} /> {copied ? 'Link copiato!' : (tournament.shareToken ? 'Copia link' : 'Genera e copia link')}
      </button>
      {tournament.shareToken && (
        <button onClick={() => onSetShareToken(null)} className="text-xs self-center py-1" style={{ color: T.textFaint }}>Disattiva condivisione</button>
      )}
    </Disclosure>
  );
}

// Unlike the edit-participants-and-rebuild-bracket flow, this only ever sets
// an `email` field on each participant — it never touches bracket structure,
// so it works identically before, during, or after the tournament is live,
// with no tournamentHasStarted gate.
function ManageParticipantEmailsControl({ tournament, onSetParticipantEmails }) {
  const [emails, setEmails] = useState(() => Object.fromEntries(tournament.participants.map(p => [p.id, p.email || ''])));

  return (
    <Disclosure label="Gestisci email partecipanti" icon={Mail}>
      {(close) => (
        <>
          <div className="text-xs" style={{ color: T.textDim }}>
            Un partecipante con email può accedere dal link pubblico e inserire da solo il punteggio del proprio turno.
          </div>
          {tournament.participants.map(p => (
            <div key={p.id} className="flex items-center gap-2">
              <div className="flex-1 truncate text-sm">{p.name}</div>
              <input type="email" inputMode="email" aria-label={`Email di ${p.name}`} value={emails[p.id] || ''}
                onChange={e => setEmails(prev => ({ ...prev, [p.id]: e.target.value }))}
                placeholder="email@esempio.it" className="w-40 rounded-xl px-3 py-2 text-sm"
                style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
            </div>
          ))}
          <button onClick={() => {
            onSetParticipantEmails(tournament.participants.map(p => ({ ...p, email: emails[p.id]?.trim() || undefined })));
            close();
          }}
            className="rounded-xl py-2.5 font-semibold flex items-center justify-center gap-2 min-h-11"
            style={{ background: T.gold, color: GOLD_TEXT }}>
            Salva
          </button>
        </>
      )}
    </Disclosure>
  );
}

// Resizes and re-extracts the accent color client-side before ever touching
// the network — the upload itself is always a small PNG, regardless of what
// the organizer's phone camera originally produced.
function LogoUpload({ tournament, userId, onSetLogo }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Formato non valido — usa PNG, JPG o WebP.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const img = await loadImageFromFile(file);
      const canvas = resizeToCanvas(img, 512);
      const extracted = extractAccentColor(canvas);
      const accentColor = extracted && accentColorContrastOk(extracted) ? extracted : null;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const path = `${userId}/${tournament.id}.png`;
      const { error: uploadError } = await supabase.storage.from('tournament-logos').upload(path, blob, { upsert: true, contentType: 'image/png' });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('tournament-logos').getPublicUrl(path);
      // Cache-bust: the path is fixed per tournament, so re-uploading at the
      // same URL needs a changing query string or a stale cached image could
      // keep being served after a real change.
      onSetLogo({ logoUrl: `${publicUrl}?v=${Date.now()}`, accentColor });
    } catch (err) {
      console.error('Errore caricamento logo', err);
      setError('Caricamento non riuscito. Riprova.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await supabase.storage.from('tournament-logos').remove([`${userId}/${tournament.id}.png`]);
    } catch (err) {
      console.error('Errore rimozione logo', err);
    }
    onSetLogo({ logoUrl: null, accentColor: null });
    setBusy(false);
  }

  return (
    <Disclosure label={tournament.logoUrl ? 'Cambia logo' : 'Carica logo'} icon={Target}>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
      {error && <div className="text-xs" style={{ color: T.red }}>{error}</div>}
      <button onClick={() => inputRef.current?.click()} disabled={busy}
        className="rounded-xl py-2.5 font-semibold flex items-center justify-center gap-2 min-h-11 disabled:opacity-40"
        style={{ background: T.gold, color: GOLD_TEXT }}>
        <Target size={16} /> {busy ? 'Caricamento…' : (tournament.logoUrl ? 'Sostituisci logo' : 'Scegli immagine')}
      </button>
      {tournament.logoUrl && (
        <button onClick={handleRemove} disabled={busy} className="text-xs self-center py-1 disabled:opacity-40" style={{ color: T.textFaint }}>Rimuovi logo</button>
      )}
    </Disclosure>
  );
}

// A labelled stack of match cards — the section idiom every final-stage
// block below uses.
function Section({ title, children }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold" style={{ color: T.textDim }}>{title}</div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

// The bracket itself plus whichever final-stage blocks the format calls for
// — shared verbatim by the organizer's BracketScreen and the public
// SharedTournamentScreen. Those two were near-identical copies, which is why
// threading accentColor through the public page took two commits (8b67bcc
// then 02cca67) and why the copies had already drifted on how the Lancaster
// play-in renders. A spectator passes none of the handlers: they default to
// no-ops, which is exactly what read-only means here.
//
// wildcardControl is the one genuine asymmetry — only the organizer can pick
// a Lancaster wildcard; a spectator just sees the resulting play-in match.
// Passing it as a node rather than a boolean keeps this component ignorant
// of who's looking at it.
function TournamentBody({
  tournament, accentColor = T.gold, focusRef = null, viewMode = 'bracket',
  onOpenMatch = () => {}, onOpenThreeFinal = () => {}, wildcardControl = null,
}) {
  const fs = tournament.finalStage;
  const card = (match, ref) => (
    <MatchCard match={match} accentColor={accentColor}
      onOpen={() => onOpenMatch(ref)} focused={refEquals(focusRef, ref)} />
  );

  return (
    <>
      {tournament.rounds.length > 0 && (viewMode === 'bracket' ? (
        <BracketTree tournament={tournament} onOpenMatch={onOpenMatch} focusRef={focusRef} accentColor={accentColor} />
      ) : (
        tournament.rounds.map((round, ri) => (
          <Section key={ri} title={roundName(trueRoundCount(tournament), ri)}>
            {round.map((m, mi) => m.status !== 'bye' && (
              <React.Fragment key={mi}>{card(m, { kind: 'round', roundIdx: ri, matchIdx: mi })}</React.Fragment>
            ))}
          </Section>
        ))
      ))}

      {tournament.finalFormat === 'standard' && tournament.thirdPlaceMatch && (
        <Section title="Finale 3°/4° posto">{card(tournament.thirdPlaceMatch, { kind: 'thirdPlace' })}</Section>
      )}

      {tournament.finalFormat === 'threeway' && fs && (
        <>
          <Section title="Preliminare 3°/4° posto">{card(fs.prelim, { kind: 'prelim' })}</Section>
          <Section title="Finale a 3 — oro/argento/bronzo">
            <ThreeWayFinalCard final={fs.final} accentColor={accentColor}
              onOpen={onOpenThreeFinal} focused={refEquals(focusRef, { kind: 'threeFinal' })} />
          </Section>
        </>
      )}

      {tournament.finalFormat === 'lancaster' && fs && (
        <Section title="Finale Lancaster (per punteggio di qualifica)">
          {wildcardControl ?? (fs.playIn && card(fs.playIn, { kind: 'lancasterPlayIn' }))}
          {card(fs.match1, { kind: 'lancaster1' })}
          {card(fs.match2, { kind: 'lancaster2' })}
          {card(fs.match3, { kind: 'lancaster3' })}
        </Section>
      )}
    </>
  );
}

function BracketScreen({ tournament, onBack, onOpenMatch, onOpenThreeFinal, onDelete, onEditParticipants, onReset, onSetShareToken, onSetParticipantEmails, userId, onSetLogo, onSetLancasterWildcard, onClearLancasterWildcard, focusRef }) {
  const [viewMode, setViewMode] = useState('bracket');
  const started = tournamentHasStarted(tournament);
  const podium = tournamentPodium(tournament);
  const fs = tournament.finalStage;

  return (
    <div className="w-full mx-auto px-4 pt-4 pb-12 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" aria-label="Indietro"><ChevronLeft /></button>
        <h1 className="text-xl font-bold flex-1 truncate">{tournament.name}</h1>
        {!started && (
          <button onClick={onEditParticipants} className="p-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" style={{ background: T.surface, border: `1px solid ${T.border}` }} title="Modifica partecipanti" aria-label="Modifica partecipanti">
            <Users size={18} color={T.textDim} />
          </button>
        )}
      </div>
      <div className="text-sm" style={{ color: T.textDim }}>
        {formatDateShort(tournament.date)} · {matchFormatDef(tournament.formatId).label} · {tournament.distanceM}m/{tournament.faceCm}cm · {finalFormatDef(tournament.finalFormat).label}
      </div>

      {tournament.logoUrl && (
        <img src={tournament.logoUrl} alt="Logo del torneo" className="h-16 w-auto self-start rounded-xl" style={{ background: T.surface }} />
      )}
      <LogoUpload tournament={tournament} userId={userId} onSetLogo={onSetLogo} />

      <ShareTournamentControl tournament={tournament} onSetShareToken={onSetShareToken} />
      <ManageParticipantEmailsControl tournament={tournament} onSetParticipantEmails={onSetParticipantEmails} />

      <PodiumCard podium={podium} />

      {tournament.rounds.length > 0 && (
        <SegmentedControl options={[{ id: 'list', label: 'Elenco' }, { id: 'bracket', label: 'Tabellone' }]} value={viewMode} onChange={setViewMode} />
      )}

      <TournamentBody tournament={tournament} viewMode={viewMode} focusRef={focusRef}
        onOpenMatch={onOpenMatch} onOpenThreeFinal={onOpenThreeFinal}
        wildcardControl={fs && tournament.finalFormat === 'lancaster' ? (
          <LancasterWildcardControl tournament={tournament} finalStage={fs} focusRef={focusRef}
            onOpenPlayIn={() => onOpenMatch({ kind: 'lancasterPlayIn' })}
            onSetWildcard={onSetLancasterWildcard} onClearWildcard={onClearLancasterWildcard} />
        ) : null} />

      {started && <ResetTournamentButton tournament={tournament} onReset={onReset} />}
      <DeleteSessionButton onDelete={onDelete} label="Elimina torneo" />
    </div>
  );
}

// Lets a participant the organizer has given an email to identify
// themselves on the public share page and score their own current match.
// Reuses the exact MatchScreen the organizer's own app scores with —
// keyboardScoring is always off here (that's a superuser convenience for
// the organizer's own device). The only thing that differs from the
// organizer's own scoring flow is where onComplete's result goes: instead
// of applying directly to the bracket via applyMatchResult, it's stored as
// a pending submission via submit_participant_match, and only actually
// applied once the opponent's own submission is present and matches (see
// the reconciliation effect in the root component).
function ParticipantAccess({ tournament, token, onSubmitted }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null); // { participantId, email, name }
  const [submitted, setSubmitted] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const markerAtSubmitRef = useRef(null);
  const resetForMarkerRef = useRef(null);
  // MatchScreen's onComplete fires after EVERY set, not just the final
  // one (same as it does for the organizer's own scoring, where each call
  // round-trips through applyMatchResult and re-renders with the updated
  // match). There's no server-side bracket write to round-trip through
  // here, so this local state plays that role instead — fed back into
  // MatchScreen as `match` so unit-by-unit progress keeps advancing until
  // the match actually reaches 'completed'.
  const [liveMatch, setLiveMatch] = useState(null);

  async function identify() {
    setBusy(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('identify_participant', {
      p_token: token, p_email: email.trim(), p_name: name.trim(),
    });
    setBusy(false);
    if (rpcError || !data || data.length === 0) {
      setError('Email o nome non riconosciuti. Controlla con l’organizzatore.');
      return;
    }
    setSession({ participantId: data[0].participant_id, email: email.trim(), name: name.trim() });
  }

  // This is the one write in the app with no outbox behind it: a
  // participant has no auth session, so there's no per-account queue to
  // retry from (see the outbox note in README). That makes checking the
  // RPC's error mandatory rather than optional — the archer is standing at
  // an outdoor range on marginal signal, and "inviato" on their phone is
  // the only evidence they have that the score left the device. It used to
  // be shown unconditionally.
  async function handleComplete(updatedMatch, matchKey) {
    setLiveMatch(updatedMatch);
    if (updatedMatch.status !== 'completed') return; // more sets to go
    const markerNow = tournament.pendingSubmissions?.[matchKey]?.[SUBMISSION_MISMATCH_KEY] || null;
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('submit_participant_match', {
      p_token: token, p_email: session.email, p_name: session.name,
      p_match_key: matchKey, p_submission: { updatedMatch, submittedAt: new Date().toISOString() },
    });
    setBusy(false);
    if (rpcError) { setSendFailed(true); return; }
    markerAtSubmitRef.current = markerNow;
    setSendFailed(false);
    setSubmitted(true);
    onSubmitted?.();
  }

  if (!session) {
    if (!open) {
      return (
        <button onClick={() => setOpen(true)}
          className="rounded-2xl py-3 font-semibold flex items-center justify-center gap-2 min-h-11"
          style={{ background: T.surface, color: T.textDim, border: `1px solid ${T.border}` }}>
          <Mail size={16} /> Sei un partecipante?
        </button>
      );
    }
    return (
      <div className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: T.surfaceAlt, border: `1px dashed ${T.border}` }}>
        <div className="text-xs" style={{ color: T.textDim }}>
          Inserisci la tua email e il tuo nome per inserire il punteggio del tuo turno.
        </div>
        <input type="email" inputMode="email" autoComplete="email" aria-label="Email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="La tua email" className="rounded-xl px-3 py-2.5"
          style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        <input aria-label="Nome" value={name} onChange={e => setName(e.target.value)}
          placeholder="Il tuo nome" className="rounded-xl px-3 py-2.5"
          style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        {error && <div className="text-xs" style={{ color: T.red }}>{error}</div>}
        <button onClick={identify} disabled={!email.trim() || !name.trim() || busy}
          className="rounded-xl py-2.5 font-semibold flex items-center justify-center gap-2 min-h-11 disabled:opacity-40"
          style={{ background: T.gold, color: GOLD_TEXT }}>
          Accedi
        </button>
        <button onClick={() => setOpen(false)} className="text-xs self-center py-1" style={{ color: T.textFaint }}>Chiudi</button>
      </div>
    );
  }

  const candidateRefs = flatMatchRefs(tournament).filter(r => r.kind !== 'threeFinal');
  const ref = candidateRefs.find(r => isRefPlayable(tournament, r) && matchRefHasParticipant(tournament, r, session.participantId));
  const matchKey = ref ? refKey(ref) : null;
  const pendingForMatch = matchKey ? tournament.pendingSubmissions?.[matchKey] : null;
  const alreadyPending = !!pendingForMatch?.[session.participantId];
  const marker = pendingForMatch?.[SUBMISSION_MISMATCH_KEY] || null;
  // A marker that differs from the one standing when this archer last sent
  // is a mismatch that happened AFTER their send — so it discarded it.
  // Same marker means it's the one that asked them to re-enter, which
  // their pending submission is already the answer to. Without this
  // distinction the page either lies for a poll interval or nags for one.
  const discarded = !!marker && !alreadyPending && marker !== markerAtSubmitRef.current;

  // The RPC failed and nothing reached Postgres. The scored match is still
  // in local state, so offer it back rather than dropping it — there is no
  // outbox behind this write to pick it up later.
  if (sendFailed && liveMatch && matchKey) {
    return (
      <div className="rounded-2xl p-3 flex flex-col gap-2 items-center text-center" style={{ background: T.surfaceAlt, border: `1px solid ${T.red}` }}>
        <div className="text-sm font-semibold" style={{ color: T.red }}>Invio non riuscito</div>
        <div className="text-xs" style={{ color: T.textDim }}>
          Il punteggio è ancora su questo telefono e non è stato registrato. Controlla la connessione e riprova.
        </div>
        <button onClick={() => handleComplete(liveMatch, matchKey)} disabled={busy}
          className="rounded-xl px-4 py-2.5 font-semibold min-h-11 disabled:opacity-40"
          style={{ background: T.gold, color: GOLD_TEXT }}>
          {busy ? 'Invio…' : 'Riprova'}
        </button>
      </div>
    );
  }

  if (ref && !alreadyPending && (!submitted || discarded)) {
    const resolved = resolveMatchRef(tournament, ref);
    // Discovering a discard clears the match that was thrown away — once,
    // keyed on the marker. Clearing it on every render instead would wipe
    // each set the moment it was confirmed (confirming calls setLiveMatch,
    // which re-renders while the banner is still up), so the archer could
    // never get past set 1 of the re-entry they are being asked for.
    if (discarded && resetForMarkerRef.current !== marker) {
      resetForMarkerRef.current = marker;
      if (liveMatch) setLiveMatch(null);
      if (submitted) setSubmitted(false);
    }
    return (
      <div className="flex flex-col gap-2">
        {discarded && (
          <div className="rounded-2xl p-3 text-xs" style={{ background: T.surfaceAlt, border: `1px solid ${T.red}`, color: T.textDim }}>
            I punteggi inviati dai due arcieri non coincidevano, quindi <strong style={{ color: T.red }}>nessuno dei due è stato registrato</strong>. Confrontate le frecce fra voi e reinserite il turno.
          </div>
        )}
        <MatchScreen match={liveMatch || resolved.match} title={resolved.title} formatId={tournament.formatId} keyboardScoring={false}
          onBack={() => { setSession(null); setLiveMatch(null); }}
          onComplete={(updatedMatch) => handleComplete(updatedMatch, matchKey)} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-3 flex flex-col gap-2 items-center text-center" style={{ background: T.surfaceAlt, border: `1px dashed ${T.border}` }}>
      <div className="text-sm" style={{ color: T.textDim }}>
        {(alreadyPending || submitted)
          ? 'Punteggio inviato. In attesa che anche l’avversario invii il proprio.'
          : 'Nessun turno da giocare al momento.'}
      </div>
      <button onClick={() => setSession(null)} className="text-xs py-1" style={{ color: T.textFaint }}>Torna al tabellone</button>
    </div>
  );
}

// Public, no-login view of a tournament — mounted directly by entry.jsx
// when the URL has ?share=<token>, bypassing AuthGate and every bit of
// Supabase auth machinery entirely (a spectator's visit should never fire
// an auth listener or session check). Polls get_shared_tournament() every
// 5min until the tournament's first result lands, then every 45s, then
// stops entirely once the tournament is complete (see `started`/`finished`
// below) — and only touches state (and re-renders) when the row's
// updated_at actually moved, so an unchanged bracket never visibly
// flickers.
export function SharedTournamentScreen({ token }) {
  const [tournament, setTournament] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'not-found'
  // Tracks the last-seen updated_at outside React state so refresh() can
  // compare against it without depending on (and thus staling on, or
  // needing to nest a second setState inside a functional updater for)
  // lastUpdatedAt itself — setTournament/setStatus/setLastUpdatedAt all
  // fire together, in the same tick, whenever something actually changed.
  const lastUpdatedRef = useRef(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_shared_tournament', { p_token: token });
    // A transient network error leaves whatever's currently displayed
    // alone and just retries next interval — only a successful call that
    // genuinely finds no matching row means "not shared" (a failed
    // request must never be treated the same as an invalid token).
    if (error) return;
    if (!data || data.length === 0) {
      setStatus('not-found');
      return;
    }
    const row = data[0];
    setStatus('ready');
    if (lastUpdatedRef.current !== row.updated_at) {
      lastUpdatedRef.current = row.updated_at;
      setTournament(normalizeTournament(row.data));
      setLastUpdatedAt(row.updated_at);
    }
  }, [token]);

  // Nothing changes on a bracket before its first result, so polling every
  // 45s from the moment the link is opened just burns requests on a page
  // that hasn't moved yet — poll every 5min until tournamentHasStarted()
  // flips true, then switch to 45s for the rest of the live event, and
  // stop polling entirely once tournamentIsComplete() — a finished
  // tournament has nothing left to change. The manual refresh icon still
  // works after polling stops, in case a score gets corrected post-final.
  const started = tournament ? tournamentHasStarted(tournament) : false;
  const finished = tournament ? tournamentIsComplete(tournament) : false;

  useEffect(() => {
    refresh();
    if (finished) return;
    const intervalMs = started ? 45 * 1000 : 5 * 60 * 1000;
    const interval = setInterval(refresh, intervalMs);
    return () => clearInterval(interval);
  }, [refresh, started, finished]);

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'not-found') {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center" style={{ background: T.bg, color: T.textDim }}>
        Questo torneo non è più condiviso, o il link non è valido.
      </div>
    );
  }

  const podium = tournamentPodium(tournament);
  const accentColor = tournament.accentColor || T.gold;

  return (
    <div className="min-h-screen w-full mx-auto px-4 pt-4 pb-12 flex flex-col gap-4" style={{ background: T.bg, color: T.text }}>
      <div className="flex items-center gap-2">
        {tournament.logoUrl && (
          <img src={tournament.logoUrl} alt="Logo del torneo" className="h-10 w-auto rounded-lg" style={{ background: T.surface }} />
        )}
        <h1 className="text-xl font-bold flex-1 truncate">{tournament.name}</h1>
        <button onClick={refresh} className="p-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" style={{ background: T.surface, border: `1px solid ${T.border}` }} aria-label="Aggiorna">
          <RefreshCw size={18} color={T.textDim} />
        </button>
      </div>
      <div className="text-sm" style={{ color: T.textDim }}>
        {formatDateShort(tournament.date)} · {matchFormatDef(tournament.formatId).label} · {tournament.distanceM}m/{tournament.faceCm}cm · {finalFormatDef(tournament.finalFormat).label}
      </div>
      {lastUpdatedAt && (
        <div className="text-xs" style={{ color: T.textFaint }}>
          Ultimo aggiornamento: {new Date(lastUpdatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      <ParticipantAccess tournament={tournament} token={token} onSubmitted={refresh} />

      <PodiumCard podium={podium} accentColor={accentColor} />

      <TournamentBody tournament={tournament} accentColor={accentColor} />
    </div>
  );
}

// Lets the scorer declare a walkover when one side withdraws or never
// shows up, for a match that's already been fed (both sides assigned).
// Collapsed by default and gated behind a per-side confirm tap so it can't
// be triggered by accident during normal scoring.
function WithdrawalControl({ match, onForfeit }) {
  const [confirmSlot, setConfirmSlot] = useState(null);

  return (
    <Disclosure variant="link" label="Un arciere si ritira o non si presenta →" onClose={() => setConfirmSlot(null)}>
      <div className="text-xs" style={{ color: T.textDim }}>Chi si ritira? L'avversario vince a tavolino.</div>
      <div className="flex gap-2">
        <button onClick={() => (confirmSlot === 'A' ? onForfeit('B') : setConfirmSlot('A'))}
          className="flex-1 rounded-xl py-2 text-sm font-semibold"
          style={{ background: confirmSlot === 'A' ? T.red : T.surface, color: confirmSlot === 'A' ? T.onRed : T.text, border: `1px solid ${confirmSlot === 'A' ? T.red : T.border}` }}>
          {confirmSlot === 'A' ? 'Conferma ritiro' : sideLabel(match.slotA)}
        </button>
        <button onClick={() => (confirmSlot === 'B' ? onForfeit('A') : setConfirmSlot('B'))}
          className="flex-1 rounded-xl py-2 text-sm font-semibold"
          style={{ background: confirmSlot === 'B' ? T.red : T.surface, color: confirmSlot === 'B' ? T.onRed : T.text, border: `1px solid ${confirmSlot === 'B' ? T.red : T.border}` }}>
          {confirmSlot === 'B' ? 'Conferma ritiro' : sideLabel(match.slotB)}
        </button>
      </div>
    </Disclosure>
  );
}

// Lets the organizer bring one previously-eliminated competitor back into
// the Lancaster final as a wildcard, challenging the 4th seed for their
// ladder spot via a play-in match (see setLancasterWildcard). Collapsed by
// default, same pattern as WithdrawalControl. Once picked, the play-in
// itself is just a normal MatchCard — undo stays offered until it's scored.
function LancasterWildcardControl({ tournament, finalStage, focusRef, onOpenPlayIn, onSetWildcard, onClearWildcard }) {
  if (finalStage.playIn) {
    return (
      <div className="flex flex-col gap-1.5">
        <MatchCard match={finalStage.playIn} onOpen={onOpenPlayIn} focused={refEquals(focusRef, { kind: 'lancasterPlayIn' })} />
        {finalStage.playIn.status !== 'completed' && (
          <button onClick={onClearWildcard} className="text-xs self-center py-1" style={{ color: T.textFaint }}>Annulla ripescaggio</button>
        )}
      </div>
    );
  }

  if (finalStage.match1.status === 'completed') return null;
  // With fewer than 4 competitors the ladder's 4th slot is empty, so match1
  // is a bye — there is no 4th seed to challenge, and everyone still in the
  // tournament is already on the ladder. Offering the wildcard here read
  // the name off that empty slot and crashed the page.
  if (!finalStage.sides[3]) return null;

  return (
    <Disclosure variant="link" label="Ripescaggio: fai rientrare un'eliminata →">
      {(close) => {
        const eligible = eligibleLancasterWildcards(tournament);
        return (
          <>
            <div className="text-xs" style={{ color: T.textDim }}>Chi rientra a sfidare {finalStage.sides[3].name} per la 4ª posizione?</div>
            {eligible.length === 0 ? (
              <div className="text-xs" style={{ color: T.textFaint }}>Nessuna eliminata disponibile.</div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                {eligible.map(p => (
                  <button key={p.id} onClick={() => { onSetWildcard(p); close(); }}
                    className="text-left rounded-xl px-3 py-2 text-sm" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                    {p.seed}. {p.name}
                  </button>
                ))}
              </div>
            )}
          </>
        );
      }}
    </Disclosure>
  );
}

// Confirmed set/end history for a match, with tap-to-reopen correction.
// recordUnit() already recomputes cumulative score from the full units
// array regardless of which index changes, so "fixing a mistake" is just
// resubmitting that one unit — no separate undo/audit data model needed.
// The only recovery before this was wiping the entire bracket via "Reset
// torneo", which throws away every other result along with the one typo.
function UnitHistory({ units, formatDef, editingUnitIndex, onEdit }) {
  const played = units.map((u, i) => ({ u, i })).filter(({ u }) => u && u.totalA != null && u.totalB != null);
  if (played.length === 0) return null;
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
      {played.map(({ u, i }, row) => (
        <button key={i} onClick={() => onEdit(i)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm"
          style={{
            background: i === editingUnitIndex ? T.surfaceAlt : T.surface,
            borderTop: row === 0 ? 'none' : `1px solid ${T.border}`,
          }}>
          <span style={{ color: T.textDim }}>{formatDef.unitLabel} {i + 1}</span>
          <span className="font-semibold" style={numeralStyle}>{u.totalA} – {u.totalB}</span>
          <span style={{ color: T.textDim }}>{u.spA} – {u.spB} PS</span>
          <Pencil size={14} color={T.textFaint} />
        </button>
      ))}
    </div>
  );
}

function ArrowsInputColumn({ label, needed, pending, onUndo }) {
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
      <button onClick={onUndo} disabled={pending.length === 0} className="text-xs py-1 rounded-full disabled:opacity-30" style={{ color: T.textDim }}>
        Annulla ultima
      </button>
    </div>
  );
}

// Plays out any ordinary 2-way match, wherever it lives in the tournament
// — a normal bracket position, the standard format's bronze match, the
// threeway format's preliminary decider, or one of Lancaster's three
// ladder matches. The caller resolves `match`+`title` from whatever
// reference it's tracking and gets back just the updated match object via
// onComplete — it decides how that propagates (see applyMatchResult).
function MatchScreen({ match, title, formatId, onBack, onDone, onComplete, keyboardScoring }) {
  // onDone is the "this match is over, where to next" action — distinct
  // from onBack (the chevron, which can fire mid-match too). Falls back to
  // onBack so callers that don't care about the distinction (non-superuser
  // navigation) don't need to pass both.
  const finish = onDone || onBack;
  const formatDef = matchFormatDef(formatId);
  const needed = arrowsPerUnit(formatDef);
  const unitIdx = currentUnitIndex(match);

  const [pendingA, setPendingA] = useState([]);
  const [pendingB, setPendingB] = useState([]);
  const [activeSide, setActiveSide] = useState('A');
  const [shootA, setShootA] = useState([]);
  const [shootB, setShootB] = useState([]);
  // Set when correcting an already-confirmed unit via UnitHistory, instead
  // of scoring the live/next one. Takes priority over match.status ('shootoff'
  // or 'completed') for which input UI shows — correcting a past unit is
  // never itself a shoot-off.
  const [editingUnitIndex, setEditingUnitIndex] = useState(null);
  const isEditing = editingUnitIndex != null;
  const activeUnitIdx = isEditing ? editingUnitIndex : unitIdx;
  const inShootoffInput = match.status === 'shootoff' && !isEditing;

  function startEditUnit(idx) {
    const u = match.units[idx];
    setEditingUnitIndex(idx);
    setPendingA((u.arrowsA || []).map(score => ({ score, isX: false })));
    setPendingB((u.arrowsB || []).map(score => ({ score, isX: false })));
    setActiveSide('A');
  }
  function cancelEditUnit() {
    setEditingUnitIndex(null);
    setPendingA([]); setPendingB([]); setActiveSide('A');
  }

  // Undocumented keyboard mirror of the Keypad/undo/confirm buttons —
  // only live in superuser mode (see keyToScore). Enter only fires the
  // shortcut when the confirm button would itself be enabled; shoot-off
  // still requires a manual "Vince X" tap since declaring a winner is a
  // judgment call the keyboard shouldn't shortcut.
  useEffect(() => {
    if (!keyboardScoring || (match.status === 'completed' && !isEditing)) return;
    function handleKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveSide(e.key === 'ArrowLeft' ? 'A' : 'B');
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (inShootoffInput) (activeSide === 'A' ? setShootA : setShootB)(l => l.slice(0, -1));
        else undoArrow(activeSide);
        return;
      }
      if (e.key === 'Enter') {
        if (!inShootoffInput && pendingA.length >= needed && pendingB.length >= needed) {
          e.preventDefault();
          submitUnit();
        }
        return;
      }
      const mapped = keyToScore(e.key);
      if (!mapped) return;
      e.preventDefault();
      if (inShootoffInput) (activeSide === 'A' ? setShootA : setShootB)(l => [...l, mapped]);
      else addArrow(activeSide, mapped.score, mapped.isX);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [keyboardScoring, match.status, isEditing, inShootoffInput, activeSide, pendingA.length, pendingB.length, needed]);

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
    let m = recordUnit(match, formatDef, activeUnitIdx, 'A', pendingA.map(a => a.score));
    m = recordUnit(m, formatDef, activeUnitIdx, 'B', pendingB.map(a => a.score));
    setPendingA([]); setPendingB([]); setActiveSide('A'); setEditingUnitIndex(null);
    onComplete(m);
  }

  function submitShootOff(winnerSlot) {
    const m = recordShootOff(match, winnerSlot, shootA.map(a => a.score), shootB.map(a => a.score));
    onComplete(m);
  }

  function submitForfeit(winnerSlot) {
    onComplete(forfeitMatch(match, winnerSlot));
  }

  if (match.status === 'completed' && !isEditing) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4 items-center text-center">
        <div className="flex items-center gap-2 self-start">
          <button onClick={finish} className="p-2 -ml-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" aria-label="Indietro"><ChevronLeft /></button>
          <h1 className="text-xl font-bold">{title}</h1>
        </div>
        <Trophy color={T.gold} size={32} />
        <div className="text-2xl font-bold">{sideLabel(winnerOf(match))}</div>
        <div className="text-sm" style={{ color: T.textDim }}>
          {match.forfeit ? `vince a tavolino (ritiro di ${sideLabel(loserOf(match))})` : `vince ${match.cumSpA} - ${match.cumSpB}`}
        </div>
        {!match.forfeit && (
          <div className="w-full flex flex-col gap-1.5 self-stretch">
            <UnitHistory units={match.units} formatDef={formatDef} editingUnitIndex={editingUnitIndex} onEdit={startEditUnit} />
            <div className="text-xs" style={{ color: T.textFaint }}>Tocca una {formatDef.unitLabel.toLowerCase()} per correggerla</div>
          </div>
        )}
        <button onClick={finish} className="w-full rounded-2xl py-3.5 font-bold" style={{ background: T.gold, color: GOLD_TEXT }}>Torna al tabellone</button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" aria-label="Indietro"><ChevronLeft /></button>
        <h1 className="text-xl font-bold">{title}</h1>
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

      {!isEditing && <WithdrawalControl match={match} onForfeit={submitForfeit} />}

      <UnitHistory units={match.units} formatDef={formatDef} editingUnitIndex={editingUnitIndex} onEdit={startEditUnit} />

      {isEditing && (
        <div className="rounded-2xl px-3 py-2 flex items-center justify-between gap-2" style={{ background: T.surfaceAlt, border: `1px dashed ${T.gold}` }}>
          <span className="text-sm font-semibold" style={{ color: T.gold }}>Correzione — {formatDef.unitLabel} {activeUnitIdx + 1}</span>
          <button onClick={cancelEditUnit} className="text-xs font-semibold" style={{ color: T.textDim }}>Annulla</button>
        </div>
      )}

      {inShootoffInput ? (
        <div className="flex flex-col gap-4">
          <div className="text-center text-sm font-semibold" style={{ color: T.gold }}>Spareggio — chi ha piazzato la freccia più vicina al centro?</div>
          <div className="flex gap-3">
            <ArrowsInputColumn label={sideLabel(match.slotA)} needed={formatDef.archersPerSide} pending={shootA} onUndo={() => setShootA(l => l.slice(0, -1))} />
            <ArrowsInputColumn label={sideLabel(match.slotB)} needed={formatDef.archersPerSide} pending={shootB} onUndo={() => setShootB(l => l.slice(0, -1))} />
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
          {!isEditing && (
            <div className="text-center text-sm" style={{ color: T.textDim }}>
              {formatDef.unitLabel} {activeUnitIdx + 1} di {formatDef.units}
            </div>
          )}
          <div className="flex gap-3">
            <ArrowsInputColumn label={sideLabel(match.slotA)} needed={needed} pending={pendingA} onUndo={() => undoArrow('A')} />
            <ArrowsInputColumn label={sideLabel(match.slotB)} needed={needed} pending={pendingB} onUndo={() => undoArrow('B')} />
          </div>
          <SegmentedControl options={[{ id: 'A', label: sideLabel(match.slotA) }, { id: 'B', label: sideLabel(match.slotB) }]} value={activeSide} onChange={setActiveSide} />
          <Keypad onScore={(score, isX) => addArrow(activeSide, score, isX)} />
          <button onClick={submitUnit} disabled={pendingA.length < needed || pendingB.length < needed}
            className="rounded-2xl py-3.5 font-bold disabled:opacity-40" style={{ background: T.gold, color: GOLD_TEXT }}>
            {isEditing ? 'Salva correzione' : `Conferma ${formatDef.unitLabel.toLowerCase()}`}
          </button>
        </>
      )}
    </div>
  );
}

// The threeway format's 3-way final: all 3 shoot every end simultaneously
// until gold is decided (see record3WayUnit), then hands off to an
// ordinary MatchScreen for the silver/bronze runoff between whoever's left
// — that phase needs nothing special, it's just a normal match that starts
// at a carried-over score.
function ThreeWayFinalScreen({ tournament, onBack, onDone, onComplete, keyboardScoring }) {
  const finish = onDone || onBack;
  const formatDef = matchFormatDef(tournament.formatId);
  const needed = arrowsPerUnit(formatDef);
  const final = tournament.finalStage.final;
  const openUnitIdx = final.units.findIndex(u => !u || u.totals.some(t => t == null));
  const activeUnitIdx = openUnitIdx === -1 ? final.units.length : openUnitIdx;

  const [pending, setPending] = useState([[], [], []]);
  const [activeSide, setActiveSide] = useState(0);
  const [shootPending, setShootPending] = useState([[], [], []]);

  // Same undocumented keyboard mirror as MatchScreen (see keyToScore).
  // Skips entirely once we're in the runoff phase — that delegates to a
  // real MatchScreen below, which gets its own keyboardScoring listener.
  useEffect(() => {
    if (!keyboardScoring || final.status === 'runoff' || final.status === 'completed') return;
    function handleKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const inShootoff = final.status === 'shootoff3';
      const contenders = final.shootoffContenders || [0, 1, 2];
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const options = inShootoff ? contenders : [0, 1, 2];
        const idx = options.indexOf(activeSide);
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        setActiveSide(options[idx === -1 ? 0 : (idx + delta + options.length) % options.length]);
        return;
      }
      if (inShootoff && !contenders.includes(activeSide)) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (inShootoff) setShootPending(p => p.map((arr, j) => (j === activeSide ? arr.slice(0, -1) : arr)));
        else undoArrow(activeSide);
        return;
      }
      if (e.key === 'Enter') {
        if (!inShootoff && [0, 1, 2].every(i => pending[i].length >= needed)) { e.preventDefault(); submitUnit(); }
        return;
      }
      const mapped = keyToScore(e.key);
      if (!mapped) return;
      e.preventDefault();
      if (inShootoff) setShootPending(p => p.map((arr, j) => (j === activeSide ? [...arr, mapped] : arr)));
      else addArrow(activeSide, mapped.score, mapped.isX);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [keyboardScoring, final.status, activeSide, pending, shootPending, needed]);

  if (final.status === 'runoff') {
    return (
      <MatchScreen match={final.runoff} title="Spareggio 2°/3° posto" formatId={tournament.formatId} keyboardScoring={keyboardScoring}
        onBack={onBack} onDone={onDone} onComplete={(updatedRunoff) => onComplete(applyThreeWayRunoffUpdate(final, updatedRunoff))} />
    );
  }

  if (final.status === 'completed') {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4 items-center text-center">
        <div className="flex items-center gap-2 self-start">
          <button onClick={finish} className="p-2 -ml-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" aria-label="Indietro"><ChevronLeft /></button>
          <h1 className="text-xl font-bold">Finale a 3</h1>
        </div>
        <Trophy color={T.gold} size={32} />
        <div className="text-2xl font-bold">{final.sides[final.goldSlot].name}</div>
        <div className="text-sm flex flex-col gap-1" style={{ color: T.textDim }}>
          <div>2° — {final.sides[final.silverSlot].name}</div>
          <div>3° — {final.sides[final.bronzeSlot].name}</div>
        </div>
        <button onClick={finish} className="w-full rounded-2xl py-3.5 font-bold" style={{ background: T.gold, color: GOLD_TEXT }}>Torna al tabellone</button>
      </div>
    );
  }

  function addArrow(sideIdx, score, isX) {
    setPending(p => {
      if (p[sideIdx].length >= needed) return p;
      const next = p.map((arr, i) => (i === sideIdx ? [...arr, { score, isX }] : arr));
      if (next[sideIdx].length === needed) {
        const nextSide = [0, 1, 2].find(i => i !== sideIdx && next[i].length < needed);
        if (nextSide != null) setActiveSide(nextSide);
      }
      return next;
    });
  }
  function undoArrow(sideIdx) {
    setPending(p => p.map((arr, i) => (i === sideIdx ? arr.slice(0, -1) : arr)));
  }
  function submitUnit() {
    let f = final;
    [0, 1, 2].forEach(i => { f = record3WayUnit(f, formatDef, activeUnitIdx, i, pending[i].map(a => a.score)); });
    setPending([[], [], []]); setActiveSide(0);
    onComplete(f);
  }
  function submitShootOff3(goldSlot) {
    onComplete(record3WayShootOff(final, formatDef, goldSlot, shootPending));
  }

  if (final.status === 'shootoff3') {
    const contenders = final.shootoffContenders || [0, 1, 2];
    return (
      <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-2 -ml-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" aria-label="Indietro"><ChevronLeft /></button>
          <h1 className="text-xl font-bold">Finale a 3</h1>
        </div>
        <div className="text-center text-sm font-semibold" style={{ color: T.gold }}>Spareggio per l’oro — chi ha piazzato la freccia più vicina al centro?</div>
        <div className="flex gap-3">
          {contenders.map(i => (
            <ArrowsInputColumn key={i} label={final.sides[i].name} needed={formatDef.archersPerSide} pending={shootPending[i]}
              onUndo={() => setShootPending(p => p.map((arr, j) => (j === i ? arr.slice(0, -1) : arr)))} />
          ))}
        </div>
        <SegmentedControl options={contenders.map(i => ({ id: i, label: final.sides[i].name }))} value={activeSide} onChange={setActiveSide} />
        <Keypad onScore={(score, isX) => setShootPending(p => p.map((arr, j) => (j === activeSide ? [...arr, { score, isX }] : arr)))} />
        <div className="flex gap-2">
          {contenders.map(i => (
            <button key={i} onClick={() => submitShootOff3(i)} className="flex-1 rounded-2xl py-3.5 font-bold" style={{ background: T.gold, color: GOLD_TEXT }}>
              Vince {final.sides[i].name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" aria-label="Indietro"><ChevronLeft /></button>
        <h1 className="text-xl font-bold">Finale a 3</h1>
      </div>

      <div className="rounded-2xl p-4 flex items-center justify-around" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        {[0, 1, 2].map(i => (
          <div key={i} className="text-center">
            <div className="font-semibold truncate max-w-[6rem]">{final.sides[i] ? final.sides[i].name : '—'}</div>
            <div className="text-2xl font-bold" style={numeralStyle}>{final.cumSp[i]}</div>
          </div>
        ))}
      </div>

      <div className="text-center text-sm" style={{ color: T.textDim }}>
        {formatDef.unitLabel} {activeUnitIdx + 1} di {formatDef.units}
      </div>
      <div className="flex gap-2">
        {[0, 1, 2].map(i => (
          <ArrowsInputColumn key={i} label={final.sides[i] ? final.sides[i].name : '—'} needed={needed} pending={pending[i]} onUndo={() => undoArrow(i)} />
        ))}
      </div>
      <SegmentedControl options={[0, 1, 2].map(i => ({ id: i, label: final.sides[i] ? final.sides[i].name : '—' }))} value={activeSide} onChange={setActiveSide} />
      <Keypad onScore={(score, isX) => addArrow(activeSide, score, isX)} />
      <button onClick={submitUnit} disabled={[0, 1, 2].some(i => pending[i].length < needed)}
        className="rounded-2xl py-3.5 font-bold disabled:opacity-40" style={{ background: T.gold, color: GOLD_TEXT }}>
        Conferma {formatDef.unitLabel.toLowerCase()}
      </button>
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
      <button onClick={onOpen} className="flex-1 text-left min-w-0 min-h-11">
        <div className="font-semibold truncate flex items-center gap-2">
          <span className="truncate">{tournament.name}</span>
          {complete && <Trophy size={14} color={T.gold} />}
        </div>
        <div className="text-xs truncate" style={{ color: T.textDim }}>
          {formatDateShort(tournament.date)} · {matchFormatDef(tournament.formatId).label} · {tournament.participants.length} partecipanti
        </div>
      </button>
      <button onClick={() => (confirming ? onDelete() : setConfirming(true))} className="p-2 rounded-full shrink-0 min-w-11 min-h-11 flex items-center justify-center"
        style={{ background: confirming ? T.red : 'transparent', color: confirming ? T.onRed : T.textFaint }}
        aria-label={confirming ? 'Conferma eliminazione' : 'Elimina torneo'}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function TorneiScreen({ tournaments, onNew, onOpen, onDelete }) {
  return (
    <div className="w-full max-w-3xl mx-auto px-4 pt-6 pb-8 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tornei</h1>
        <button onClick={onNew} className="p-2.5 rounded-full min-w-11 min-h-11 flex items-center justify-center" style={{ background: T.gold, color: GOLD_TEXT }} aria-label="Nuovo torneo"><Plus size={20} /></button>
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
  const [passwordRecovery, setPasswordRecovery] = useState(false);
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
  const [superuser, setSuperuser] = useState(false);
  const [bracketCursor, setBracketCursor] = useState(null);

  const activeTournament = tournaments.find(t => t.id === activeTournamentId) || null;

  const flagSaveError = useCallback((ok, message) => {
    if (!ok) setSaveError(message);
  }, []);

  // Superuser mode: desktop-only (real keyboard + pointer), toggled with
  // "q". While on, opening a match keeps the bracket on screen and docks
  // the scoring card next to it instead of navigating away — the bracket
  // re-renders live as each end is saved, since match updates already flow
  // straight back into tournament state (see applyMatchResult). Toggling
  // mid-match folds/unfolds the split view instead of losing your place.
  useEffect(() => {
    function isDesktopEnv() {
      return typeof window !== 'undefined' && window.matchMedia
        && window.matchMedia('(pointer: fine)').matches && window.innerWidth >= 1024;
    }
    function handleKeyDown(e) {
      if (e.key !== 'q' && e.key !== 'Q') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
      if (!isDesktopEnv()) return;
      setSuperuser(prev => {
        const next = !prev;
        setView(v => {
          if (!activeMatchRef || (v !== 'bracket' && v !== 'match' && v !== 'threefinal')) return v;
          if (next) return 'bracket';
          return activeMatchRef.kind === 'threeFinal' ? 'threefinal' : 'match';
        });
        return next;
      });
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeMatchRef]);

  useEffect(() => { setBracketCursor(null); }, [activeTournamentId]);

  // Superuser bracket navigation: ArrowUp/Down move a cursor through the
  // playable matches (same order as the bracket screen lists them), Enter
  // opens whichever one the cursor is on — docking it in the split view
  // exactly like a click would (see onOpenMatch). Lets a whole round get
  // scored without ever touching the mouse.
  useEffect(() => {
    if (!superuser || view !== 'bracket' || !activeTournament) return;
    function handleKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
      const navigable = flatMatchRefs(activeTournament).filter(r => isRefPlayable(activeTournament, r));
      if (navigable.length === 0) return;
      const cursor = bracketCursor && navigable.some(r => refEquals(r, bracketCursor)) ? bracketCursor
        : (activeMatchRef && navigable.some(r => refEquals(r, activeMatchRef)) ? activeMatchRef : navigable[0]);
      if (e.key === 'Enter') {
        e.preventDefault();
        setActiveMatchRef(cursor);
        setBracketCursor(cursor);
        return;
      }
      e.preventDefault();
      const idx = navigable.findIndex(r => refEquals(r, cursor));
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setBracketCursor(navigable[(idx + delta + navigable.length) % navigable.length]);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [superuser, view, activeTournament, bracketCursor, activeMatchRef]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      setAuthSession(session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = authSession?.user?.id ?? null;

  useEffect(() => {
    if (!userId) { setSessions([]); setTournaments([]); setLoaded(false); return; }
    let mounted = true;
    // Retry anything left in the outbox from a previous offline session
    // before loading — if the retry itself fails (still offline), applyPending
    // below still overlays those edits onto what we loaded, so nothing appears
    // to have reverted.
    flushPending(userId).then(() => {
      STORES.session.load(userId).then(s => {
        if (!mounted) return;
        const merged = applyPending(userId, s, 'session');
        setSessions(merged);
        setLoaded(true);
        if (merged.length === 0) setLegacyData(findLegacyLocalSessions());
      });
      STORES.tournament.load(userId).then(t => {
        if (mounted) setTournaments(applyPending(userId, t, 'tournament'));
      });
    });
    return () => { mounted = false; };
  }, [userId]);

  // Connectivity can return mid-session (e.g. walking back into range of a
  // signal) without a reload — retry the outbox as soon as it does, so a
  // save made while offline doesn't just sit there until the tab is closed
  // and reopened.
  useEffect(() => {
    if (!userId) return;
    function handleOnline() { flushPending(userId); }
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [userId]);

  const updateSession = useCallback((id, updater) => {
    setSessions(prev => {
      const next = prev.map(s => (s.id === id ? updater(s) : s));
      const changed = next.find(s => s.id === id);
      if (changed && userId) STORES.session.upsert(userId, changed).then(ok => flagSaveError(ok, 'Impossibile salvare la sessione online: la modifica resta su questo dispositivo e verrà sincronizzata da sola appena torna la connessione.'));
      return next;
    });
  }, [userId, flagSaveError]);

  const addSession = useCallback((session) => {
    setSessions(prev => [...prev, session]);
    if (userId) STORES.session.upsert(userId, session).then(ok => flagSaveError(ok, 'Impossibile salvare la sessione online: resta su questo dispositivo e verrà sincronizzata da sola appena torna la connessione.'));
  }, [userId, flagSaveError]);

  const deleteSession = useCallback((id) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (userId) STORES.session.remove(userId, id).then(ok => flagSaveError(ok, 'Impossibile eliminare la sessione online: verrà ritentato da solo appena torna la connessione.'));
  }, [userId, flagSaveError]);

  const importSessions = useCallback((imported) => {
    const normalized = imported.map(normalizeSession);
    setSessions(prev => {
      const byId = new Map(prev.map(s => [s.id, s]));
      normalized.forEach(s => byId.set(s.id, s));
      const next = Array.from(byId.values());
      if (userId) Promise.all(normalized.map(s => STORES.session.upsert(userId, s)))
        .then(results => flagSaveError(results.every(Boolean), 'Alcune sessioni importate non sono state salvate online: verranno sincronizzate da sole appena torna la connessione.'));
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
    if (userId) STORES.tournament.upsert(userId, tournament).then(ok => flagSaveError(ok, 'Impossibile salvare il torneo online: resta su questo dispositivo e verrà sincronizzato da solo appena torna la connessione. Se il problema persiste, controlla che la tabella "tournaments" esista su Supabase.'));
  }, [userId, flagSaveError]);

  const updateTournament = useCallback((id, updater) => {
    setTournaments(prev => {
      const next = prev.map(t => (t.id === id ? updater(t) : t));
      const changed = next.find(t => t.id === id);
      if (changed && userId) STORES.tournament.upsert(userId, changed).then(ok => flagSaveError(ok, 'Impossibile salvare gli aggiornamenti del torneo online: restano su questo dispositivo e verranno sincronizzati da soli appena torna la connessione. Se il problema persiste, controlla che la tabella "tournaments" esista su Supabase.'));
      return next;
    });
  }, [userId, flagSaveError]);

  const deleteTournament = useCallback((id) => {
    setTournaments(prev => prev.filter(t => t.id !== id));
    if (!userId) return;
    // The logo is a Storage object, not part of the row, so deleting the
    // tournament left it behind forever. Fire-and-forget and never surfaced:
    // a failed cleanup is one stray file, not lost data, and it must not
    // block or fail the delete itself. Removing a path that was never
    // uploaded is a no-op server-side, so no need to check for one first.
    supabase.storage.from('tournament-logos').remove([`${userId}/${id}.png`]).catch(() => {});
    STORES.tournament.remove(userId, id).then(ok => flagSaveError(ok, 'Impossibile eliminare il torneo online: verrà ritentato da solo appena torna la connessione.'));
  }, [userId, flagSaveError]);

  // Participants write their own match submissions directly via the
  // submit_participant_match RPC — they have no Supabase Auth session of
  // their own, so that write bypasses this app's local state entirely.
  // While a tournament is open here, poll its own row every 30s for
  // pendingSubmissions a participant may have added, and once both sides
  // of a match agree (see unitsMatch above), apply the result through the
  // exact same applyMatchResult() the organizer's own manual scoring uses
  // — this is the only place bracket-shape knowledge lives, so it's
  // reused rather than taught to SQL a second time.
  const lastPendingJsonRef = useRef('{}');
  useEffect(() => {
    if (!activeTournament || !userId) return;
    let cancelled = false;

    async function reconcile() {
      const { data, error } = await supabase.from('tournaments').select('data').eq('id', activeTournament.id).single();
      if (cancelled || error) return;
      const remotePending = data?.data?.pendingSubmissions || {};
      const remoteJson = JSON.stringify(remotePending);
      if (remoteJson === lastPendingJsonRef.current) return;
      lastPendingJsonRef.current = remoteJson;
      if (Object.keys(remotePending).length === 0) return;

      updateTournament(activeTournament.id, t => reconcilePendingSubmissions(t, remotePending));
    }

    reconcile();
    const interval = setInterval(reconcile, 30 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeTournament?.id, userId]);

  if (authSession === undefined) return <LoadingScreen />;
  if (passwordRecovery) return <SetNewPasswordScreen onDone={() => setPasswordRecovery(false)} />;
  if (authSession === null) return <AuthGate />;
  if (!loaded) return <LoadingScreen />;

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;
  const detailSession = sessions.find(s => s.id === detailSessionId) || null;
  const resolvedMatch = (activeTournament && activeMatchRef && activeMatchRef.kind !== 'threeFinal')
    ? resolveMatchRef(activeTournament, activeMatchRef) : null;

  return (
    <div className="flex flex-col font-sans antialiased" style={{ background: T.bg, color: T.text, minHeight: '100vh' }}>
      {saveError && (
        <div className="fixed top-0 left-0 right-0 z-50 px-4 pt-3 flex justify-center pointer-events-none">
          <div className="w-full rounded-xl px-4 py-3 text-sm font-medium flex items-start gap-3 shadow-lg pointer-events-auto"
            style={{ background: T.red, color: T.onRed }}>
            <span className="flex-1">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="font-bold shrink-0 min-w-11 min-h-11 flex items-center justify-center -my-2 -mr-2" aria-label="Chiudi avviso">✕</button>
          </div>
        </div>
      )}
      {superuser && (
        <div className="w-full px-4 py-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs font-semibold"
          style={{ background: T.gold, color: GOLD_TEXT }}>
          <span className="flex items-center gap-1.5"><Unlock size={12} /> Superuser (q per uscire)</span>
          <span className="flex items-center gap-1"><span className="font-mono">↑↓</span> sfoglia match</span>
          <span className="flex items-center gap-1"><span className="font-mono">←→</span> cambia lato</span>
          <span className="flex items-center gap-1"><span className="font-mono">Invio</span> apri / conferma</span>
          <span className="flex items-center gap-1"><span className="font-mono">⌫</span> annulla freccia</span>
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

        {view === 'statistiche' && (
          <StatisticheScreen sessions={sessions} tournaments={tournaments} userEmail={authSession?.user?.email || null} />
        )}

        {view === 'tornei' && (
          <TorneiScreen tournaments={tournaments}
            onNew={() => setView('tornei-new')}
            onOpen={(id) => { setActiveMatchRef(null); setActiveTournamentId(id); setView('bracket'); }}
            onDelete={deleteTournament} />
        )}

        {view === 'tornei-new' && (
          <TournamentCreateScreen
            onCreate={(t) => { addTournament(t); setActiveTournamentId(t.id); setView('bracket'); }}
            onCancel={() => setView('tornei')} />
        )}

        {view === 'bracket' && activeTournament && (() => {
          const navigable = superuser ? flatMatchRefs(activeTournament).filter(r => isRefPlayable(activeTournament, r)) : [];
          const bracketFocusRef = navigable.length === 0 ? null
            : (bracketCursor && navigable.some(r => refEquals(r, bracketCursor)) ? bracketCursor
              : (activeMatchRef && navigable.some(r => refEquals(r, activeMatchRef)) ? activeMatchRef : navigable[0]));
          const bracket = (
            <BracketScreen tournament={activeTournament} focusRef={bracketFocusRef}
              onBack={() => { setActiveMatchRef(null); setActiveTournamentId(null); setView('tornei'); }}
              onOpenMatch={(ref) => { setActiveMatchRef(ref); if (!superuser) setView('match'); }}
              onOpenThreeFinal={() => { setActiveMatchRef({ kind: 'threeFinal' }); if (!superuser) setView('threefinal'); }}
              onDelete={() => { setActiveMatchRef(null); deleteTournament(activeTournament.id); setActiveTournamentId(null); setView('tornei'); }}
              onEditParticipants={() => setView('tornei-edit')}
              onReset={(finalFormat) => updateTournament(activeTournament.id, t => resetTournamentBracket(t, finalFormat))}
              onSetShareToken={(token) => updateTournament(activeTournament.id, t => ({ ...t, shareToken: token }))}
              onSetParticipantEmails={(participants) => updateTournament(activeTournament.id, t => ({ ...t, participants }))}
              userId={userId}
              onSetLogo={(logo) => updateTournament(activeTournament.id, t => ({ ...t, ...logo }))}
              onSetLancasterWildcard={(wildcard) => updateTournament(activeTournament.id, t => ({ ...t, finalStage: setLancasterWildcard(t.finalStage, wildcard) }))}
              onClearLancasterWildcard={() => updateTournament(activeTournament.id, t => ({ ...t, finalStage: clearLancasterWildcard(t.finalStage) }))} />
          );
          if (!superuser || !activeMatchRef) return bracket;

          // Skip the trip back to the bracket entirely: jump straight to
          // whatever's next to score, in the same order the arrow-key
          // cursor uses, so scoring a whole round stays a one-click loop.
          const advance = () => {
            const next = nextPlayableRef(activeTournament, activeMatchRef);
            setActiveMatchRef(next);
            setBracketCursor(next);
          };

          const splitMatch = activeMatchRef.kind === 'threeFinal' ? (
            <ThreeWayFinalScreen tournament={activeTournament} keyboardScoring={superuser}
              onBack={() => setActiveMatchRef(null)} onDone={advance}
              onComplete={(updatedFinal) => updateTournament(activeTournament.id, t => applyMatchResult(t, { kind: 'threeFinal' }, updatedFinal))} />
          ) : (resolvedMatch && (
            <MatchScreen match={resolvedMatch.match} title={resolvedMatch.title} formatId={activeTournament.formatId} keyboardScoring={superuser}
              onBack={() => setActiveMatchRef(null)} onDone={advance}
              onComplete={(updatedMatch) => updateTournament(activeTournament.id, t => applyMatchResult(t, activeMatchRef, updatedMatch))} />
          ));
          if (!splitMatch) return bracket;

          // Both panes scroll together as one page — the docked match card
          // just sticks near the top of the viewport as you scroll, rather
          // than carrying its own independent scroll region nested inside
          // the page's, which is disorienting with two scrollbars active.
          return (
            <div className="flex flex-col lg:flex-row lg:items-start">
              <div className="flex-1 min-w-0">{bracket}</div>
              <div className="w-full lg:w-[26rem] shrink-0 lg:sticky lg:top-4 border-t lg:border-t-0 lg:border-l"
                style={{ borderColor: T.border }}>
                {splitMatch}
              </div>
            </div>
          );
        })()}

        {view === 'tornei-edit' && activeTournament && (
          <TournamentEditParticipantsScreen tournament={activeTournament}
            onSave={(participants, finalFormat) => { updateTournament(activeTournament.id, t => rebuildTournamentBracket(t, participants, finalFormat)); setView('bracket'); }}
            onCancel={() => setView('bracket')} />
        )}

        {view === 'match' && activeTournament && activeMatchRef && resolvedMatch && (
          <MatchScreen match={resolvedMatch.match} title={resolvedMatch.title} formatId={activeTournament.formatId} keyboardScoring={superuser}
            onBack={() => { setActiveMatchRef(null); setView('bracket'); }}
            onComplete={(updatedMatch) => updateTournament(activeTournament.id, t => applyMatchResult(t, activeMatchRef, updatedMatch))} />
        )}

        {view === 'threefinal' && activeTournament && (
          <ThreeWayFinalScreen tournament={activeTournament} keyboardScoring={superuser}
            onBack={() => { setActiveMatchRef(null); setView('bracket'); }}
            onComplete={(updatedFinal) => updateTournament(activeTournament.id, t => applyMatchResult(t, { kind: 'threeFinal' }, updatedFinal))} />
        )}
      </div>

      {view !== 'shoot' && view !== 'match' && view !== 'threefinal' && <BottomNav view={view} setView={setView} />}
    </div>
  );
}

// ---------- test-only exports ----------
//
// Named exports purely so `test/` can import the pure logic functions
// directly (see test/load.cjs) without needing a browser, Supabase, or
// React rendering — none of this is consumed by the app itself, which only
// ever imports the default export (and SharedTournamentScreen) from
// site/entry.jsx. Grouped here in one place, rather than scattered `export`
// keywords throughout, so the tested surface is visible at a glance and
// adding a function to it is a one-line change.
export {
  // personal scorecard: scoring + arrows
  ringGroupForScore, scoreRank, ringGeometry, scoreFromRadiusUnits,
  roundSpotLayout, roundRingClass, spotCount, spotFaceCm, spotOffsets,
  groupStatsBySpot, tenRingRadiusCm, groupOffsetIsReal, describeGroupShape,
  spotsDifferSignificantly, widestSpotGap, assessSightAdjustment,
  tenRingViewFraction, tapReferenceFraction, isCompoundRingClass,
  zoomLevelsFor, defaultZoomFor,
  flattenArrows, totalScore, xCount, arrowsShotCount, totalArrowsInRound,
  cumulativeScores, currentEndIndex, addArrow, undoLastArrow,
  computeGroupStats, groupStats,
  // personal scorecard: sessions + personal bests
  sameRound, findPersonalBest, paceVsPB, createSession, sessionFlattenArrows,
  sessionTotalScore, sessionXCount, sessionArrowsShot,
  activeStageIndex, sessionAddArrow, sessionUndoLastArrow, sessionProgressLabel,
  closeSessionEarly, reopenSession, stageIsFull, entryIsRankable, sessionPlannedArrows,
  entryCountsForStats, sessionCountsForStats, sessionConfirmEnd,
  sessionDisplayName, stageEntries, normalizeSession, withSessionDate,
  roundShapeKey, matchedPreset, roundShapeLabel,
  // personal scorecard: analysis
  describeBias, endRangeStats, scoreStdDevBySession, dispersionTrend,
  scoreDistribution, scoreByCondition, hitRateByColor, colorTrendByShape,
  bestByShape, sessionInsight,
  // personal scorecard: group model + uncertainty
  separateFlyers, expectedScorePerArrow, pointsBreakdown, angularDispersionMrad,
  angularByShape, quantile, linearFit, trendVerdict, avgTrendWithBands,
  consistencyTrend,
  // personal scorecard: volume, contrasts, rhythm
  weeklyVolume, weekStartOf, daysSinceLastSession, meanWithError, contrastGroups,
  typeContrast, arrowPositionStats, xRateTrend, normalizeLocationKey,
  scoreByLocation, endDurations, paceContrast, paceTrend, ownMatchRecord,
  // offline outbox
  readPending, writePending, setPending, clearPending, applyPending,
  adoptLegacyPending,
  // tournaments: bracket engine
  matchFormatDef, arrowsPerUnit, standardSeedOrder, emptyMatch, finalFormatDef,
  buildBracket, makeMatch, propagateWinner, fillMatchSlot, resolveByeIfLonely,
  seedLancasterSides, seedLancasterLadder, eligibleLancasterWildcards,
  setLancasterWildcard, clearLancasterWildcard, createTournament,
  normalizeTournament, rebuildTournamentBracket, resetTournamentBracket,
  // tournaments: match scoring
  sumArrows, recordUnit, recordShootOff, forfeitMatch, sumThreeWayPoints,
  record3WayUnit, record3WayShootOff, startThreeWayRunoff,
  applyThreeWayRunoffUpdate, matchHasResult, currentUnitIndex, sideLabel,
  roundName, trueRoundCount,
  // tournaments: refs + state derivation
  resolveMatchRef, refEquals, refKey, flatMatchRefs, isRefPlayable,
  nextPlayableRef, applyMatchResult, tournamentIsComplete, tournamentPodium,
  tournamentHasStarted, winnerOf, loserOf,
  // tournaments: participant self-scoring
  unitsMatch, rebuildMatchFromUnits, reconcilePendingSubmissions, SUBMISSION_MISMATCH_KEY,
  // components, for the DOM tests in test/ (see test/dom.cjs)
  AuthGate,
};
