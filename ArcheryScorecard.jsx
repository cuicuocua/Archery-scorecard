import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  Target, Clock, ChevronLeft, ChevronRight, Plus, Trash2,
  Download, RotateCcw, Play, Check, StickyNote,
} from 'lucide-react';

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

const STORAGE_KEY = 'archery-scorecard-v1';

const ROUND_TYPES = [
  { id: 'indoor18', label: 'Indoor 18m', category: 'Indoor', distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 20, editable: false },
  { id: 'indoor25', label: 'Indoor 25m', category: 'Indoor', distanceM: 25, faceCm: 60, arrowsPerEnd: 3, ends: 20, editable: false },

  { id: 'targa90', label: 'Targa 90m', category: 'Targa 122cm', distanceM: 90, faceCm: 122, arrowsPerEnd: 6, ends: 12, editable: false },
  { id: 'targa70', label: 'Targa 70m', category: 'Targa 122cm', distanceM: 70, faceCm: 122, arrowsPerEnd: 6, ends: 12, editable: false },
  { id: 'targa60', label: 'Targa 60m', category: 'Targa 122cm', distanceM: 60, faceCm: 122, arrowsPerEnd: 6, ends: 12, editable: false },

  { id: 'targa50', label: 'Targa 50m', category: 'Targa 80cm', distanceM: 50, faceCm: 80, arrowsPerEnd: 6, ends: 12, editable: false },
  { id: 'targa40', label: 'Targa 40m', category: 'Targa 80cm', distanceM: 40, faceCm: 80, arrowsPerEnd: 6, ends: 12, editable: false },
  { id: 'targa30', label: 'Targa 30m', category: 'Targa 80cm', distanceM: 30, faceCm: 80, arrowsPerEnd: 6, ends: 12, editable: false },

  // Fully custom: distance, face, arrows/end and ends are all pickable at
  // session start, for anything not covered above (para/youth classes,
  // club rounds, field-style faces, etc.) — see the editable steppers.
  { id: 'custom', label: 'Personalizzata', category: 'Personalizzata', distanceM: 30, faceCm: 40, arrowsPerEnd: 3, ends: 10, editable: true },
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

function createSession(roundDef, meta) {
  return {
    id: uid(),
    roundId: roundDef.id,
    round: {
      label: roundDef.label,
      distanceM: roundDef.distanceM,
      faceCm: roundDef.faceCm,
      arrowsPerEnd: roundDef.arrowsPerEnd,
      ends: roundDef.ends,
    },
    sessionType: meta.sessionType || 'allenamento',
    bowType: meta.bowType || null,
    conditions: emptyConditions(),
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    completedAt: null,
    location: meta.location || '',
    note: meta.note || '',
    ends: Array.from({ length: roundDef.ends }, (_, i) => ({ index: i, arrows: [] })),
  };
}

function flattenArrows(session) { return session.ends.flatMap(e => e.arrows); }
function totalScore(session) { return flattenArrows(session).reduce((s, a) => s + a.score, 0); }
function xCount(session) { return flattenArrows(session).filter(a => a.isX).length; }
function arrowsShotCount(session) { return flattenArrows(session).length; }
function totalArrowsInRound(session) { return session.round.arrowsPerEnd * session.round.ends; }

function cumulativeScores(session) {
  let sum = 0;
  return flattenArrows(session).map(a => (sum += a.score));
}

function currentEndIndex(session) {
  const idx = session.ends.findIndex(e => e.arrows.length < session.round.arrowsPerEnd);
  return idx === -1 ? session.ends.length - 1 : idx;
}

function addArrow(session, arrow) {
  const perEnd = session.round.arrowsPerEnd;
  const idx = session.ends.findIndex(e => e.arrows.length < perEnd);
  if (idx === -1) return session;
  const ends = session.ends.map((e, i) => (i === idx ? { ...e, arrows: [...e.arrows, arrow] } : e));
  const complete = ends.every(e => e.arrows.length >= perEnd);
  return {
    ...session,
    ends,
    status: complete ? 'completed' : 'in_progress',
    completedAt: complete ? new Date().toISOString() : null,
  };
}

function undoLastArrow(session) {
  for (let i = session.ends.length - 1; i >= 0; i--) {
    if (session.ends[i].arrows.length > 0) {
      const ends = session.ends.map((e, idx) => (idx === i ? { ...e, arrows: e.arrows.slice(0, -1) } : e));
      return { ...session, ends, status: 'in_progress', completedAt: null };
    }
  }
  return session;
}

// Compares the actual round snapshot (distance/face/arrows/ends), not just
// roundId — two "Personalizzata" sessions with different made-up rules
// (common for gara sociale) are not the same round and must not be
// compared as if chasing the same personal best.
function sameRound(a, b) {
  return a.distanceM === b.distanceM && a.faceCm === b.faceCm && a.arrowsPerEnd === b.arrowsPerEnd && a.ends === b.ends;
}

function findPersonalBest(sessions, scope, excludeId) {
  const candidates = sessions.filter(s =>
    s.status === 'completed' &&
    s.id !== excludeId &&
    sameRound(s.round, scope.round) &&
    (s.bowType || null) === (scope.bowType || null) &&
    (s.sessionType || 'allenamento') === (scope.sessionType || 'allenamento'));
  if (!candidates.length) return null;
  return candidates.reduce((best, s) => (totalScore(s) > totalScore(best) ? s : best));
}

function paceVsPB(session, pbSession) {
  if (!pbSession) return null;
  const shot = arrowsShotCount(session);
  if (!shot) return null;
  const curCum = cumulativeScores(session);
  const pbCum = cumulativeScores(pbSession);
  const pbAtShot = pbCum[Math.min(shot, pbCum.length) - 1] ?? 0;
  return curCum[shot - 1] - pbAtShot;
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

function groupStats(session, arrows) {
  return computeGroupStats(arrows, session.round.faceCm);
}

function describeBias(cxCm, cyCm) {
  const ax = Math.abs(cxCm), ay = Math.abs(cyCm);
  if (ax < 0.3 && ay < 0.3) return 'centrato';
  const parts = [];
  if (ax >= 0.3) parts.push(`${ax.toFixed(1)} cm a ${cxCm > 0 ? 'destra' : 'sinistra'}`);
  if (ay >= 0.3) parts.push(`${ay.toFixed(1)} cm in ${cyCm > 0 ? 'basso' : 'alto'}`);
  return parts.join(', ');
}

// completedList: sessions already filtered to status==='completed' and whatever
// round/arco/tipo scope the caller cares about.
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
    const payload = { app: 'arcieri-senesi-scorecard', version: 1, exportedAt: new Date().toISOString(), sessions };
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

async function loadSessions() {
  try {
    const raw = await window.storage.get(STORAGE_KEY);
    if (!raw) return [];
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  } catch (err) {
    console.error('Errore nel caricamento dei dati', err);
    return [];
  }
}

async function persistSessions(sessions) {
  try {
    await window.storage.set(STORAGE_KEY, JSON.stringify({ sessions, savedAt: new Date().toISOString() }));
  } catch (err) {
    console.error('Errore nel salvataggio dei dati', err);
  }
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

function SessionMetaEditor({ session, onUpdate }) {
  const [location, setLocation] = useState(session.location);
  const [note, setNote] = useState(session.note);

  return (
    <div className="flex flex-col gap-2 w-full">
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

function SessionSummary({ session, onExit, onUpdate }) {
  const total = totalScore(session);
  const shot = arrowsShotCount(session);
  const avg = shot ? total / shot : 0;
  return (
    <div className="px-4 py-6 flex flex-col gap-5 items-center text-center max-w-md mx-auto">
      <div>
        <div className="text-sm uppercase tracking-wide flex items-center gap-2 justify-center" style={{ color: T.textDim }}>
          Sessione completata
          <SessionTypeBadge sessionType={session.sessionType} />
        </div>
        <div className="text-5xl font-bold" style={numeralStyle}>{total}</div>
        <div className="text-sm mt-1" style={{ color: T.textDim }}>
          {session.round.label} · media {avg.toFixed(2)} · {xCount(session)} X
          {bowLabel(session.bowType) ? ` · ${bowLabel(session.bowType)}` : ''}
        </div>
      </div>
      <SessionMetaEditor session={session} onUpdate={onUpdate} />
      <ConditionsEditor session={session} onUpdate={onUpdate} />
      <button onClick={onExit} className="w-full rounded-2xl py-4 font-bold text-lg" style={{ background: T.gold, color: GOLD_TEXT }}>
        Torna alla home
      </button>
      <button onClick={() => onUpdate(s => undoLastArrow(s))} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-full" style={{ color: T.textDim }}>
        <RotateCcw size={14} /> Correggi l'ultima freccia
      </button>
    </div>
  );
}

function ShootingScreen({ session, sessions, onUpdate, onExit }) {
  const [mode, setMode] = useState('face');
  const [zoom, setZoom] = useState(1);
  const [noteOpen, setNoteOpen] = useState(false);

  const round = session.round;
  const isComplete = session.status === 'completed';
  const endIdx = currentEndIndex(session);
  const currentEnd = session.ends[endIdx];
  const ghostArrows = useMemo(() => session.ends.slice(0, endIdx).flatMap(e => e.arrows), [session, endIdx]);

  const total = totalScore(session);
  const shot = arrowsShotCount(session);
  const avg = shot ? total / shot : 0;
  const projected = shot ? Math.round(avg * totalArrowsInRound(session)) : null;

  const pb = useMemo(
    () => findPersonalBest(sessions, { round: session.round, bowType: session.bowType, sessionType: session.sessionType }, session.id),
    [sessions, session.round, session.bowType, session.sessionType, session.id]);
  const pace = shot ? paceVsPB(session, pb) : null;

  const last3 = useMemo(() => {
    const withArrows = session.ends.filter(e => e.arrows.length > 0);
    return withArrows.slice(-3).flatMap(e => e.arrows);
  }, [session]);
  const stats3 = groupStats(session, last3);
  const endsShotCount = session.ends.filter(e => e.arrows.length > 0).length;

  function handleAddArrow(score, isX, x, y) {
    if (isComplete) return;
    onUpdate(s => addArrow(s, { score, isX, x: x ?? null, y: y ?? null }));
  }

  function handleFaceTap(x, y) {
    const d = Math.sqrt(x * x + y * y) * FACE_R;
    const r = scoreFromRadiusUnits(d);
    handleAddArrow(r.score, r.isX, x, y);
  }

  function handleUndo() {
    onUpdate(s => undoLastArrow(s));
  }

  return (
    <div className="flex flex-col max-w-md mx-auto min-h-screen">
      <header className="sticky top-0 z-10 flex items-center justify-between px-3 py-3" style={{ background: T.bg, borderBottom: `1px solid ${T.border}` }}>
        <button onClick={onExit} className="p-2 -ml-2 rounded-full active:scale-95 transition-transform"><ChevronLeft /></button>
        <div className="text-center">
          <div className="font-semibold leading-tight flex items-center gap-2 justify-center">
            {round.label}
            <SessionTypeBadge sessionType={session.sessionType} />
          </div>
          <div className="text-xs" style={{ color: T.textDim }}>
            {isComplete ? 'Completata' : `Volée ${endIdx + 1} di ${round.ends}`}
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
              <button onClick={handleUndo} disabled={shot === 0}
                className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-full disabled:opacity-30"
                style={{ background: T.surfaceAlt }}>
                <RotateCcw size={14} /> Annulla
              </button>
            </div>
            <EndChips end={currentEnd} arrowsPerEnd={round.arrowsPerEnd} />
          </div>
        </>
      )}

      {isComplete && <SessionSummary session={session} onExit={onExit} onUpdate={onUpdate} />}
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

function NewSessionScreen({ onCreate, onCancel }) {
  const customDef = ROUND_TYPES.find(r => r.id === 'custom');
  const [step, setStep] = useState('type');
  const [sessionType, setSessionType] = useState('allenamento');
  const [selectedId, setSelectedId] = useState(null);
  const [bowType, setBowType] = useState(null);
  const [free, setFree] = useState({ distanceM: customDef.distanceM, faceCm: customDef.faceCm, arrowsPerEnd: customDef.arrowsPerEnd, ends: customDef.ends });
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');

  const selected = ROUND_TYPES.find(r => r.id === selectedId);
  const effective = selected && selected.editable ? { ...selected, ...free } : selected;

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
    <div className="max-w-md mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
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
                      <div className="text-xs" style={{ color: T.textDim }}>
                        {r.editable ? 'Scegli distanza, bersaglio, frecce e volée' : `${r.distanceM} m · ${r.faceCm} cm · ${r.arrowsPerEnd}×${r.ends} frecce`}
                      </div>
                    </div>
                    {r.id === selectedId && <Check color={T.gold} size={20} />}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {selected && selected.editable && (
            <>
              <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                <Stepper label="Distanza (m)" value={free.distanceM} onChange={v => setFree(f => ({ ...f, distanceM: v }))} min={5} max={100} step={5} />
                <Stepper label="Diametro bersaglio (cm)" value={free.faceCm} onChange={v => setFree(f => ({ ...f, faceCm: v }))} min={20} max={122} step={10} />
                <Stepper label="Frecce a volée" value={free.arrowsPerEnd} onChange={v => setFree(f => ({ ...f, arrowsPerEnd: v }))} min={1} max={6} step={1} />
                <Stepper label="Numero di volée" value={free.ends} onChange={v => setFree(f => ({ ...f, ends: v }))} min={1} max={40} step={1} />
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
            <span className="truncate">{session.round.label}</span>
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
          {isDone ? totalScore(session) : `${currentEndIndex(session) + 1}/${session.round.ends}`}
        </div>
      </button>
      <button onClick={() => (confirming ? onDelete() : setConfirming(true))} className="p-2 rounded-full shrink-0"
        style={{ background: confirming ? T.red : 'transparent', color: confirming ? '#fff' : T.textFaint }}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function StoricoScreen({ sessions, onOpen, onResume, onDelete }) {
  const [filterId, setFilterId] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [bowFilter, setBowFilter] = useState('all');
  const [conditionDim, setConditionDim] = useState('wind');

  const filtered = sessions.filter(s =>
    (filterId === 'all' || s.roundId === filterId) &&
    (typeFilter === 'all' || (s.sessionType || 'allenamento') === typeFilter) &&
    (bowFilter === 'all' || s.bowType === bowFilter));
  const completed = filtered.filter(s => s.status === 'completed');
  const roundDef = filterId === 'all' ? null : ROUND_TYPES.find(r => r.id === filterId);

  const trend = useMemo(() =>
    completed.slice().sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
      .map(s => ({ label: formatDateShort(s.completedAt), score: totalScore(s) })),
    [completed]);

  const pb = completed.length ? completed.reduce((b, s) => (totalScore(s) > totalScore(b) ? s : b)) : null;
  const avgScore = completed.length ? completed.reduce((s, x) => s + totalScore(x), 0) / completed.length : null;

  const fatigue = useMemo(() => (filterId === 'all' ? [] : fatigueCurve(completed)), [completed, filterId]);

  const allArrows = useMemo(() => completed.flatMap(s => flattenArrows(s)), [completed]);
  const cumGroup = useMemo(() => (roundDef ? computeGroupStats(allArrows, roundDef.faceCm) : null), [allArrows, roundDef]);

  const dispersion = useMemo(() => (filterId === 'all' ? [] : dispersionTrend(completed)), [completed, filterId]);
  const distribution = useMemo(() => (filterId === 'all' ? [] : scoreDistribution(completed)), [completed, filterId]);
  const byCondition = useMemo(() => (filterId === 'all' ? [] : scoreByCondition(completed, conditionDim)), [completed, filterId, conditionDim]);
  const deepAnalysisReady = filterId !== 'all' && completed.length >= MIN_SESSIONS_FOR_DEEP_ANALYSIS;

  return (
    <div className="max-w-md mx-auto px-4 pt-4 pb-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="text-xl font-bold">Storico</div>
        <button onClick={() => exportJson(sessions)} className="p-2 rounded-full" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <Download size={18} />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <FilterChip active={filterId === 'all'} onClick={() => setFilterId('all')} label="Tutte le prove" />
          {ROUND_TYPES.map(r => <FilterChip key={r.id} active={filterId === r.id} onClick={() => setFilterId(r.id)} label={r.label} />)}
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
        <div className="text-sm" style={{ color: T.textDim }}>{filtered.length} sessioni. Seleziona una prova per le statistiche dettagliate.</div>
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
            <TargetFace faceCm={roundDef.faceCm} points={allArrows.filter(a => a.x != null)} centroid={cumGroup} dense />
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
        {filtered.length === 0 && <div className="text-sm" style={{ color: T.textDim }}>Nessuna sessione.</div>}
        {filtered.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).map(s => (
          <SessionRow key={s.id} session={s} onOpen={() => (s.status === 'completed' ? onOpen(s.id) : onResume(s.id))} onDelete={() => onDelete(s.id)} />
        ))}
      </div>
    </div>
  );
}

// ---------- session detail ----------

function DeleteSessionButton({ onDelete }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button onClick={() => (confirming ? onDelete() : setConfirming(true))}
      className="rounded-2xl py-3 font-semibold flex items-center justify-center gap-2"
      style={{ background: confirming ? T.red : T.surface, color: confirming ? '#fff' : T.textDim, border: `1px solid ${confirming ? T.red : T.border}` }}>
      <Trash2 size={16} /> {confirming ? 'Conferma eliminazione' : 'Elimina sessione'}
    </button>
  );
}

function DetailScreen({ session, onBack, onUpdate, onDelete }) {
  return (
    <div className="max-w-md mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full"><ChevronLeft /></button>
        <div className="text-xl font-bold flex items-center gap-2">
          {session.round.label}
          <SessionTypeBadge sessionType={session.sessionType} />
        </div>
      </div>

      <div className="text-sm" style={{ color: T.textDim }}>
        {formatDateFull(session.startedAt)}
        {bowLabel(session.bowType) ? ` · ${bowLabel(session.bowType)}` : ''}
        {session.location ? ` · ${session.location}` : ''}
      </div>

      <div className="text-center py-2">
        <div className="text-5xl font-bold" style={numeralStyle}>{totalScore(session)}</div>
        <div className="text-sm" style={{ color: T.textDim }}>
          media {(totalScore(session) / arrowsShotCount(session)).toFixed(2)} · {xCount(session)} X
        </div>
      </div>

      <TargetFace faceCm={session.round.faceCm} points={flattenArrows(session).filter(a => a.x != null)} />

      <SessionMetaEditor session={session} onUpdate={onUpdate} />
      <ConditionsEditor session={session} onUpdate={onUpdate} />

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold" style={{ color: T.textDim }}>Volée</div>
        {session.ends.map((e, i) => e.arrows.length > 0 && (
          <div key={i} className="flex items-center gap-2">
            <div className="w-6 text-sm shrink-0" style={{ color: T.textFaint, ...numeralStyle }}>{i + 1}</div>
            <div className="flex flex-wrap gap-1.5">
              {[...e.arrows].sort((a, b) => scoreRank(b) - scoreRank(a)).map((a, j) => <ArrowChipSmall key={j} arrow={a} />)}
            </div>
            <div className="ml-auto text-sm font-semibold" style={numeralStyle}>{e.arrows.reduce((s, a) => s + a.score, 0)}</div>
          </div>
        ))}
      </div>

      <DeleteSessionButton onDelete={onDelete} />
    </div>
  );
}

// ---------- home ----------

function HomeScreen({ sessions, onNew, onResume }) {
  const suspended = sessions.filter(s => s.status === 'in_progress').sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const completedCount = sessions.filter(s => s.status === 'completed').length;

  return (
    <div className="px-4 pt-6 pb-4 flex flex-col gap-6 max-w-md mx-auto">
      <header className="flex items-center gap-3">
        <div className="rounded-2xl p-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <Target size={28} color={T.gold} />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: T.textDim }}>Arcieri Senesi</div>
          <div className="text-2xl font-bold">Scorecard</div>
        </div>
      </header>

      {suspended.map(s => (
        <button key={s.id} onClick={() => onResume(s.id)}
          className="text-left rounded-2xl p-4 flex items-center justify-between"
          style={{ background: T.surfaceAlt, border: `1px solid ${T.borderStrong}` }}>
          <div>
            <div className="text-sm" style={{ color: T.textDim }}>Sessione in corso</div>
            <div className="text-lg font-semibold flex items-center gap-2">
              {s.round.label}
              <SessionTypeBadge sessionType={s.sessionType} />
            </div>
            <div className="text-sm" style={{ color: T.textDim }}>
              Volée {currentEndIndex(s) + 1} di {s.round.ends}{bowLabel(s.bowType) ? ` · ${bowLabel(s.bowType)}` : ''}
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
    <div className="sticky bottom-0 z-10 flex" style={{ background: T.bgElevated, borderTop: `1px solid ${T.border}` }}>
      <NavButton icon={Target} label="Home" active={view === 'home'} onClick={() => setView('home')} />
      <NavButton icon={Clock} label="Storico" active={view === 'storico'} onClick={() => setView('storico')} />
    </div>
  );
}

// ---------- root ----------

export default function ArcheryScorecard() {
  const [sessions, setSessions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('home');
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [detailSessionId, setDetailSessionId] = useState(null);

  useEffect(() => {
    let mounted = true;
    loadSessions().then(s => { if (mounted) { setSessions(s); setLoaded(true); } });
    return () => { mounted = false; };
  }, []);

  const updateSession = useCallback((id, updater) => {
    setSessions(prev => {
      const next = prev.map(s => (s.id === id ? updater(s) : s));
      persistSessions(next);
      return next;
    });
  }, []);

  const addSession = useCallback((session) => {
    setSessions(prev => {
      const next = [...prev, session];
      persistSessions(next);
      return next;
    });
  }, []);

  const deleteSession = useCallback((id) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      persistSessions(next);
      return next;
    });
  }, []);

  if (!loaded) return <LoadingScreen />;

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;
  const detailSession = sessions.find(s => s.id === detailSessionId) || null;

  return (
    <div className="flex flex-col font-sans antialiased" style={{ background: T.bg, color: T.text, minHeight: '100vh' }}>
      <div className="flex-1">
        {view === 'home' && (
          <HomeScreen sessions={sessions}
            onNew={() => setView('new')}
            onResume={(id) => { setActiveSessionId(id); setView('shoot'); }} />
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
            onDelete={deleteSession} />
        )}

        {view === 'detail' && detailSession && (
          <DetailScreen key={detailSession.id} session={detailSession}
            onBack={() => { setDetailSessionId(null); setView('storico'); }}
            onUpdate={(updater) => updateSession(detailSession.id, updater)}
            onDelete={() => { deleteSession(detailSession.id); setDetailSessionId(null); setView('storico'); }} />
        )}
      </div>

      {view !== 'shoot' && <BottomNav view={view} setView={setView} />}
    </div>
  );
}
