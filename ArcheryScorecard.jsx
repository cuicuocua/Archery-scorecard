import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  Target, Clock, ChevronLeft, ChevronRight, Plus, Trash2,
  Download, RotateCcw, Play, Check, StickyNote,
} from 'lucide-react';

/*
 * Arcieri Senesi — Scorecard v1
 *
 * FITARCO assumptions (round definitions live in ROUND_TYPES below and are
 * meant to be edited freely — nothing about them is hardcoded elsewhere):
 *  - Indoor 18m: 40cm face, 3 frecce/volée, 20 volée (60 frecce) — standard.
 *  - Indoor 25m: 60cm face, 3 frecce/volée, 20 volée — mirrors the 18m
 *    structure for the Italian indoor 25+18 combined round; verify locally.
 *  - Targa 70m / 60m: 122cm face, 6 frecce/volée, 12 volée (72 frecce) —
 *    70m is the WA1440/720 distance; 60m is used for some categories.
 *  - Targa 50m: 80cm face, 6 frecce/volée, 12 volée — typical compound/
 *    barebow 50m setup.
 *  - Scoring: 10 zones, X is the inner half of the 10 ring, counted
 *    separately but worth 10. Ring colours centre-out: gold, gold, red,
 *    red, blue, blue, black, black, white, white (as specified).
 */

const STORAGE_KEY = 'archery-scorecard-v1';

const ROUND_TYPES = [
  { id: 'indoor18', label: 'Indoor 18m', category: 'Indoor', distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 20, editable: false },
  { id: 'indoor25', label: 'Indoor 25m', category: 'Indoor', distanceM: 25, faceCm: 60, arrowsPerEnd: 3, ends: 20, editable: false },
  { id: 'targa70', label: 'Targa 70m', category: 'Targa', distanceM: 70, faceCm: 122, arrowsPerEnd: 6, ends: 12, editable: false },
  { id: 'targa60', label: 'Targa 60m', category: 'Targa', distanceM: 60, faceCm: 122, arrowsPerEnd: 6, ends: 12, editable: false },
  { id: 'targa50', label: 'Targa 50m', category: 'Targa', distanceM: 50, faceCm: 80, arrowsPerEnd: 6, ends: 12, editable: false },
  { id: 'free', label: 'Allenamento libero', category: 'Allenamento', distanceM: 30, faceCm: 40, arrowsPerEnd: 3, ends: 10, editable: true },
];

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

function findPersonalBest(sessions, roundId, excludeId) {
  const candidates = sessions.filter(s => s.roundId === roundId && s.status === 'completed' && s.id !== excludeId);
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

function groupStats(session, arrows) {
  const pts = arrows.filter(a => a.x != null && a.y != null);
  if (!pts.length) return null;
  const r = session.round.faceCm / 2;
  const cx = pts.reduce((s, a) => s + a.x, 0) / pts.length;
  const cy = pts.reduce((s, a) => s + a.y, 0) / pts.length;
  const meanRadiusCm = pts.reduce((s, a) => {
    const dx = (a.x - cx) * r, dy = (a.y - cy) * r;
    return s + Math.sqrt(dx * dx + dy * dy);
  }, 0) / pts.length;
  return { x: cx, y: cy, cxCm: cx * r, cyCm: cy * r, meanRadiusCm, count: pts.length };
}

function describeBias(cxCm, cyCm) {
  const ax = Math.abs(cxCm), ay = Math.abs(cyCm);
  if (ax < 0.3 && ay < 0.3) return 'centrato';
  const parts = [];
  if (ax >= 0.3) parts.push(`${ax.toFixed(1)} cm a ${cxCm > 0 ? 'destra' : 'sinistra'}`);
  if (ay >= 0.3) parts.push(`${ay.toFixed(1)} cm in ${cyCm > 0 ? 'basso' : 'alto'}`);
  return parts.join(', ');
}

function fatigueCurve(sessions, roundId) {
  const list = sessions.filter(s => s.roundId === roundId && s.status === 'completed');
  const maxEnds = list.reduce((m, s) => Math.max(m, s.round.ends), 0);
  const rows = [];
  for (let i = 0; i < maxEnds; i++) {
    let sum = 0, count = 0;
    list.forEach(s => {
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

function LoadingScreen() {
  return <div className="min-h-screen flex items-center justify-center" style={{ background: T.bg, color: T.textDim }}>Caricamento…</div>;
}

// ---------- target face ----------

function TargetFace({ faceCm, zoom = 1, interactive = false, onTap, points = [], centroid = null, dense = false }) {
  const svgRef = useRef(null);
  const margin = interactive && zoom === 1 ? 15 : 0;
  const half = FACE_R / zoom + margin;
  const vb = `${-half} ${-half} ${half * 2} ${half * 2}`;

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

        {centroid && (
          <g opacity={0.9}>
            <line x1={centroid.x * FACE_R - 8} y1={centroid.y * FACE_R} x2={centroid.x * FACE_R + 8} y2={centroid.y * FACE_R} stroke={T.text} strokeWidth={1.2} />
            <line x1={centroid.x * FACE_R} y1={centroid.y * FACE_R - 8} x2={centroid.x * FACE_R} y2={centroid.y * FACE_R + 8} stroke={T.text} strokeWidth={1.2} />
            <circle cx={centroid.x * FACE_R} cy={centroid.y * FACE_R} r={3} fill="none" stroke={T.text} strokeWidth={1} />
          </g>
        )}
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
        <div className="text-sm uppercase tracking-wide" style={{ color: T.textDim }}>Sessione completata</div>
        <div className="text-5xl font-bold" style={numeralStyle}>{total}</div>
        <div className="text-sm mt-1" style={{ color: T.textDim }}>
          {session.round.label} · media {avg.toFixed(2)} · {xCount(session)} X
        </div>
      </div>
      <SessionMetaEditor session={session} onUpdate={onUpdate} />
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

  const pb = useMemo(() => findPersonalBest(sessions, session.roundId, session.id), [sessions, session.roundId, session.id]);
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
          <div className="font-semibold leading-tight">{round.label}</div>
          <div className="text-xs" style={{ color: T.textDim }}>{isComplete ? 'Completata' : `Volée ${endIdx + 1} di ${round.ends}`}</div>
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
              />
            ) : (
              <Keypad onScore={(score, isX) => handleAddArrow(score, isX, null, null)} />
            )}
          </div>

          {mode === 'face' && stats3 && (
            <div className="px-4 pt-2 text-sm text-center" style={{ color: T.textDim }}>
              Gruppo (ultime {Math.min(3, endsShotCount)} volée): {describeBias(stats3.cxCm, stats3.cyCm)} · dispersione {stats3.meanRadiusCm.toFixed(1)} cm
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

function NewSessionScreen({ onCreate, onCancel }) {
  const freeDef = ROUND_TYPES.find(r => r.id === 'free');
  const [selectedId, setSelectedId] = useState(ROUND_TYPES[0].id);
  const [free, setFree] = useState({ distanceM: freeDef.distanceM, faceCm: freeDef.faceCm, arrowsPerEnd: freeDef.arrowsPerEnd, ends: freeDef.ends });
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');

  const selected = ROUND_TYPES.find(r => r.id === selectedId);
  const effective = selected.editable ? { ...selected, ...free } : selected;

  function handleStart() {
    onCreate(createSession(effective, { location, note }));
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="p-2 -ml-2 rounded-full"><ChevronLeft /></button>
        <div className="text-xl font-bold">Nuova sessione</div>
      </div>

      <div className="flex flex-col gap-2">
        {ROUND_TYPES.map(r => (
          <button key={r.id} onClick={() => setSelectedId(r.id)}
            className="text-left rounded-2xl px-4 py-3 flex items-center justify-between"
            style={{ background: r.id === selectedId ? T.surfaceAlt : T.surface, border: `1px solid ${r.id === selectedId ? T.gold : T.border}` }}>
            <div>
              <div className="font-semibold">{r.label}</div>
              <div className="text-xs" style={{ color: T.textDim }}>{r.distanceM} m · {r.faceCm} cm · {r.arrowsPerEnd}×{r.ends} frecce</div>
            </div>
            {r.id === selectedId && <Check color={T.gold} size={20} />}
          </button>
        ))}
      </div>

      {selected.editable && (
        <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <Stepper label="Distanza (m)" value={free.distanceM} onChange={v => setFree(f => ({ ...f, distanceM: v }))} min={5} max={90} step={5} />
          <Stepper label="Diametro bersaglio (cm)" value={free.faceCm} onChange={v => setFree(f => ({ ...f, faceCm: v }))} min={20} max={122} step={10} />
          <Stepper label="Frecce a volée" value={free.arrowsPerEnd} onChange={v => setFree(f => ({ ...f, arrowsPerEnd: v }))} min={1} max={6} step={1} />
          <Stepper label="Numero di volée" value={free.ends} onChange={v => setFree(f => ({ ...f, ends: v }))} min={1} max={40} step={1} />
        </div>
      )}

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

function ChartCard({ title, children }) {
  return (
    <div className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
      <div className="text-sm font-semibold" style={{ color: T.textDim }}>{title}</div>
      <div className="h-40">{children}</div>
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
          <div className="font-semibold truncate">
            {session.round.label}
            {!isDone && <span className="ml-2 text-xs font-normal" style={{ color: T.gold }}>in corso</span>}
          </div>
          <div className="text-xs truncate" style={{ color: T.textDim }}>
            {formatDateFull(session.startedAt)}{session.location ? ` · ${session.location}` : ''}{session.note ? ` · ${session.note}` : ''}
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
  const filtered = filterId === 'all' ? sessions : sessions.filter(s => s.roundId === filterId);
  const completed = filtered.filter(s => s.status === 'completed');
  const roundDef = filterId === 'all' ? null : ROUND_TYPES.find(r => r.id === filterId);

  const trend = useMemo(() =>
    completed.slice().sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
      .map(s => ({ label: formatDateShort(s.completedAt), score: totalScore(s) })),
    [completed]);

  const pb = completed.length ? completed.reduce((b, s) => (totalScore(s) > totalScore(b) ? s : b)) : null;
  const avgScore = completed.length ? completed.reduce((s, x) => s + totalScore(x), 0) / completed.length : null;

  const fatigue = useMemo(() => (filterId === 'all' ? [] : fatigueCurve(sessions, filterId)), [sessions, filterId]);

  const allArrows = useMemo(() => completed.flatMap(s => flattenArrows(s)), [completed]);
  const cumGroup = useMemo(() => {
    if (!roundDef) return null;
    const pts = allArrows.filter(a => a.x != null);
    if (!pts.length) return null;
    const r = roundDef.faceCm / 2;
    const cx = pts.reduce((s, a) => s + a.x, 0) / pts.length;
    const cy = pts.reduce((s, a) => s + a.y, 0) / pts.length;
    return { x: cx, y: cy, cxCm: cx * r, cyCm: cy * r, count: pts.length };
  }, [allArrows, roundDef]);

  return (
    <div className="max-w-md mx-auto px-4 pt-4 pb-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="text-xl font-bold">Storico</div>
        <button onClick={() => exportJson(sessions)} className="p-2 rounded-full" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <Download size={18} />
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <FilterChip active={filterId === 'all'} onClick={() => setFilterId('all')} label="Tutte le prove" />
        {ROUND_TYPES.map(r => <FilterChip key={r.id} active={filterId === r.id} onClick={() => setFilterId(r.id)} label={r.label} />)}
      </div>

      {filterId === 'all' ? (
        <div className="text-sm" style={{ color: T.textDim }}>{sessions.length} sessioni salvate. Seleziona una prova per le statistiche dettagliate.</div>
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
        <div className="text-xl font-bold">{session.round.label}</div>
      </div>

      <div className="text-sm" style={{ color: T.textDim }}>
        {formatDateFull(session.startedAt)}{session.location ? ` · ${session.location}` : ''}
      </div>

      <div className="text-center py-2">
        <div className="text-5xl font-bold" style={numeralStyle}>{totalScore(session)}</div>
        <div className="text-sm" style={{ color: T.textDim }}>
          media {(totalScore(session) / arrowsShotCount(session)).toFixed(2)} · {xCount(session)} X
        </div>
      </div>

      <TargetFace faceCm={session.round.faceCm} points={flattenArrows(session).filter(a => a.x != null)} />

      <SessionMetaEditor session={session} onUpdate={onUpdate} />

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
            <div className="text-lg font-semibold">{s.round.label}</div>
            <div className="text-sm" style={{ color: T.textDim }}>Volée {currentEndIndex(s) + 1} di {s.round.ends}</div>
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
