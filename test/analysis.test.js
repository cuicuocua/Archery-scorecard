// The analysis layer: the group model, the uncertainty helpers, and the
// aggregates that read data the app was already collecting but never used.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

// ---------- fixtures ----------
//
// x/y are normalized to the radius of the face the arrow was shot at, which
// for a multi-spot round is the SPOT's radius, not the sheet's. Two helpers
// so a fixture can't silently halve every distance in a test: `at` for a
// 40cm single face (20cm radius), `atSpot` for a spot of a 40cm triple
// (10cm radius).
const SINGLE = { distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 2, spotLayout: 'single', ringClass: 'full' };
const TRIPLE = { distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 2, spotLayout: 'vertical3', ringClass: 'spot6R' };

const at = (xCm, yCm, score = 9) => ({ score, isX: false, x: xCm / 20, y: yCm / 20 });
const atSpot = (spot, xCm, yCm, score = 9) => ({ score, isX: false, x: xCm / 10, y: yCm / 10, spot });

function entry(round, arrows, extra = {}) {
  const perEnd = round.arrowsPerEnd;
  const ends = [];
  for (let i = 0; i < arrows.length; i += perEnd) {
    ends.push({ index: ends.length, arrows: arrows.slice(i, i + perEnd) });
  }
  return {
    sessionId: extra.sessionId || `s${ends.length}`,
    status: 'completed',
    completedAt: extra.completedAt || '2026-01-01T10:00:00.000Z',
    round: { ...round, ends: Math.max(round.ends, ends.length) },
    bowType: extra.bowType ?? null,
    sessionType: extra.sessionType || 'allenamento',
    conditions: extra.conditions || null,
    location: extra.location,
    ends,
  };
}

const flat = (score, n) => Array.from({ length: n }, () => ({ score, isX: false, x: null, y: null }));

describe('quantile', () => {
  it('interpolates between order statistics like a spreadsheet does', () => {
    assert.equal(m.quantile([1, 2, 3, 4], 0.5), 2.5);
    assert.equal(m.quantile([1, 2, 3, 4, 5], 0.25), 2);
    assert.equal(m.quantile([7], 0.9), 7, 'a single value is every quantile of itself');
    assert.equal(m.quantile([], 0.5), null);
  });
});

describe('endRangeStats', () => {
  // The old min-max band could only widen as sessions accumulated, so a
  // well-shot round shape looked MORE erratic the more it was practised.
  it('reports quartiles that do not widen just because more sessions exist', () => {
    const round = { ...SINGLE, arrowsPerEnd: 1, ends: 1 };
    const one = m.endRangeStats([5, 5, 5, 5, 9].map((s, i) =>
      entry(round, [{ score: s, isX: false, x: null, y: null }], { sessionId: `a${i}` })));
    const two = m.endRangeStats([5, 5, 5, 5, 9, 9, 1].map((s, i) =>
      entry(round, [{ score: s, isX: false, x: null, y: null }], { sessionId: `b${i}` })));
    assert.equal(one[0].median, 5);
    assert.equal(two[0].median, 5, 'the middle is unmoved by the new extremes');
    assert.ok(two[0].band[1] - two[0].band[0] <= 4,
      'a new best and a new worst do not blow the band open the way min-max would');
    assert.equal(two[0].n, 7, 'the support behind each volée travels with it');
  });

  it('leaves a volée nobody has reached empty rather than zero', () => {
    const rows = m.endRangeStats([entry({ ...SINGLE, arrowsPerEnd: 1, ends: 3 }, [{ score: 9, isX: false, x: null, y: null }])]);
    assert.equal(rows[0].median, 9);
    assert.equal(rows[2].band, null);
    assert.equal(rows[2].n, 0);
  });
});

describe('linearFit / trendVerdict', () => {
  it('recovers a known slope and refuses to fit two points', () => {
    const fit = m.linearFit([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]);
    assert.ok(Math.abs(fit.slope - 2) < 1e-9);
    assert.ok(Math.abs(fit.intercept - 1) < 1e-9);
    assert.equal(m.linearFit([{ x: 0, y: 1 }, { x: 1, y: 2 }]), null);
  });

  // The whole point: a wandering line is not a trend, and the chart used to
  // leave that judgement to the eye.
  it('calls noise flat and a real climb up', () => {
    const noisy = [8.1, 7.9, 8.2, 7.8, 8.15, 7.85, 8.05].map(avg => ({ avg }));
    assert.equal(m.trendVerdict(noisy).verdict, 'flat');

    const climbing = [7.0, 7.3, 7.6, 7.9, 8.2, 8.5].map(avg => ({ avg }));
    const up = m.trendVerdict(climbing);
    assert.equal(up.verdict, 'up');
    assert.ok(Math.abs(up.perTen - 3) < 1e-6, 'a slope of 0.3/session is +3.0 over ten');

    assert.equal(m.trendVerdict([{ avg: 8 }, { avg: 9 }]).verdict, 'insufficient');
  });

  it('calls a real decline down', () => {
    const falling = [9.0, 8.7, 8.4, 8.1, 7.8, 7.5].map(avg => ({ avg }));
    assert.equal(m.trendVerdict(falling).verdict, 'down');
  });
});

describe('avgTrendWithBands', () => {
  it('gives every session an error bar that narrows as arrows accumulate', () => {
    const short = m.avgTrendWithBands([entry(SINGLE, [
      { score: 10, isX: false, x: null, y: null }, { score: 8, isX: false, x: null, y: null },
      { score: 10, isX: false, x: null, y: null }, { score: 8, isX: false, x: null, y: null },
    ])])[0];
    const long = m.avgTrendWithBands([entry(SINGLE, Array.from({ length: 60 }, (_, i) =>
      ({ score: i % 2 ? 8 : 10, isX: false, x: null, y: null })))])[0];
    assert.equal(short.avg, 9);
    assert.equal(long.avg, 9);
    assert.ok(long.se < short.se, 'sixty arrows pin the average down better than four');
    assert.ok(Math.abs((short.band[1] - short.band[0]) - 4 * short.se) < 1e-9, 'the band is +-2 SE');
  });
});

describe('consistencyTrend', () => {
  it('falls back to raw sigma below the fitting threshold', () => {
    const out = m.consistencyTrend([entry(SINGLE, flat(9, 6)), entry(SINGLE, flat(8, 6))]);
    assert.equal(out.fitted, false);
    assert.equal(out.rows.length, 2);
    assert.equal(out.rows[0].stddev, 0);
  });

  // Sigma is dragged down by a rising mean whether or not the archer got
  // steadier — the residual is what's left once that's taken out.
  it('once fitted, an ordinary session sits near zero and a streaky one above it', () => {
    const mixed = (a, b, n) => Array.from({ length: n }, (_, i) => ({ score: i % 2 ? a : b, isX: false, x: null, y: null }));
    const sessions = [
      entry(SINGLE, mixed(10, 8, 20), { sessionId: 'p1', completedAt: '2026-01-01T10:00:00.000Z' }),
      entry(SINGLE, mixed(10, 8, 20), { sessionId: 'p2', completedAt: '2026-01-02T10:00:00.000Z' }),
      entry(SINGLE, mixed(9, 7, 20), { sessionId: 'p3', completedAt: '2026-01-03T10:00:00.000Z' }),
      entry(SINGLE, mixed(9, 7, 20), { sessionId: 'p4', completedAt: '2026-01-04T10:00:00.000Z' }),
      entry(SINGLE, mixed(8, 6, 20), { sessionId: 'p5', completedAt: '2026-01-05T10:00:00.000Z' }),
      // Same average as p3/p4, but swinging twice as wide.
      entry(SINGLE, mixed(10, 6, 20), { sessionId: 'streaky', completedAt: '2026-01-06T10:00:00.000Z' }),
    ];
    const out = m.consistencyTrend(sessions);
    assert.equal(out.fitted, true);
    const streaky = out.rows[out.rows.length - 1];
    assert.ok(streaky.residual > 0.5, 'the wide session reads as less consistent than its average predicts');
    out.rows.slice(0, 5).forEach(r => {
      assert.ok(Math.abs(r.residual) < 0.5, 'the steady sessions sit near their own trend');
    });
  });
});

describe('dispersionTrend — per spot, not pooled', () => {
  // The regression this exists for: pooling every arrow on a triple face
  // through one centroid puts the centre between the spots and books the
  // distance between them as scatter. Three spots, each shot in a tight
  // knot, each 5cm off in a different direction: pooled that reads as a
  // wildly dispersed group, per spot it reads as three tight ones.
  const arrows = [
    atSpot(0, 5, 0), atSpot(1, -5, 0), atSpot(2, 0, 5),
    atSpot(0, 5, 0), atSpot(1, -5, 0), atSpot(2, 0, 5),
  ];

  it('reports each spot tight instead of inventing one loose group', () => {
    const [row] = m.dispersionTrend([entry(TRIPLE, arrows)]);
    assert.ok(row.dispersion < 0.01, `three tight spots are tight, got ${row.dispersion}`);
    const pooled = m.computeGroupStats(arrows, TRIPLE);
    assert.ok(pooled.meanRadiusCm > 3, 'pooling them would have claimed several cm of scatter');
  });

  it('gives each spot its own distance from centre and no shared direction', () => {
    const [row] = m.dispersionTrend([entry(TRIPLE, arrows)]);
    assert.equal(row.multi, true);
    assert.equal(row.biasX, undefined, 'three aim points have no one direction to drift in');
    [0, 1, 2].forEach(i => assert.ok(Math.abs(row[`spot${i}`] - 5) < 0.01, `spot ${i} is 5cm out`));
  });

  it('a single-spot round still reports a signed direction, unchanged', () => {
    const [row] = m.dispersionTrend([entry(SINGLE, [at(3, -2), at(3, -2), at(3, -2)])]);
    assert.equal(row.multi, false);
    assert.ok(Math.abs(row.biasX - 3) < 1e-9);
    assert.ok(Math.abs(row.biasY + 2) < 1e-9);
    assert.ok(row.dispersion < 1e-9);
  });
});

describe('expectedScorePerArrow', () => {
  // On a 40cm face the 10-ring reaches 2cm and the 9-ring 4cm.
  it('a group tight enough to be one hole scores that hole', () => {
    assert.ok(Math.abs(m.expectedScorePerArrow(SINGLE, 0, 0, 0.02, 0.02) - 10) < 0.02);
    assert.ok(Math.abs(m.expectedScorePerArrow(SINGLE, 3, 0, 0.02, 0.02) - 9) < 0.02, '3cm out is the 9 ring');
    assert.ok(Math.abs(m.expectedScorePerArrow(SINGLE, 5, 0, 0.02, 0.02) - 8) < 0.02);
  });

  it('a zero-spread group is scored directly rather than integrated', () => {
    assert.equal(m.expectedScorePerArrow(SINGLE, 0, 0, 0, 0), 10);
  });

  it('spread costs points and offset costs points', () => {
    const tight = m.expectedScorePerArrow(SINGLE, 0, 0, 1, 1);
    const loose = m.expectedScorePerArrow(SINGLE, 0, 0, 3, 3);
    assert.ok(loose < tight, 'a wider group scores less');
    const off = m.expectedScorePerArrow(SINGLE, 4, 0, 1, 1);
    assert.ok(off < tight, 'the same group pushed off centre scores less');
  });

  it('respects the ring class it is handed', () => {
    // indoor6C stops scoring below the 6 ring, so the same wild group is
    // worth strictly less there than on a full face.
    const full = m.expectedScorePerArrow({ ...SINGLE, ringClass: 'full' }, 0, 0, 8, 8);
    const cut = m.expectedScorePerArrow({ ...SINGLE, ringClass: 'indoor6C' }, 0, 0, 8, 8);
    assert.ok(cut < full, 'unprinted rings score zero, so a loose group is punished harder');
  });
});

describe('pointsBreakdown', () => {
  const statsFor = (arrows) => m.computeGroupStats(arrows, SINGLE);

  it('prices the correction in points and never suggests a negative one', () => {
    const off = statsFor([at(4, 0), at(4, 1), at(4, -1), at(3, 0), at(5, 0), at(4, 0.5)]);
    const b = m.pointsBreakdown(off, SINGLE);
    assert.ok(b.aim > 0.3, 'a 4cm offset on a 40cm face is worth real points');
    assert.ok(b.centred > b.expected);

    const centred = statsFor([at(0, 0), at(0, 1), at(0, -1), at(1, 0), at(-1, 0), at(0, 0.5)]);
    const c = m.pointsBreakdown(centred, SINGLE);
    assert.ok(c.aim < 0.05, 'a centred group has nothing to gain from moving');
    assert.ok(c.aim >= 0, 'and the figure is never negative');
  });

  it('the spread cost is what is left between a centred group and a perfect one', () => {
    const stats = statsFor([at(0, 0), at(2, 0), at(-2, 0), at(0, 2), at(0, -2), at(1, 1)]);
    const b = m.pointsBreakdown(stats, SINGLE);
    assert.ok(Math.abs((b.centred + b.spread) - 10) < 1e-9);
    assert.ok(b.spread > 0, 'a group with width leaves points on the table');
  });

  it('declines to model a single arrow', () => {
    assert.equal(m.pointsBreakdown(statsFor([at(0, 0)]), SINGLE), null);
  });
});

describe('separateFlyers', () => {
  const core = [
    at(0.1, 0.2), at(-0.2, 0.1), at(0.2, -0.1), at(-0.1, -0.2),
    at(0.15, 0.05), at(-0.05, 0.15), at(0.05, -0.15), at(-0.15, -0.05),
    at(0.1, -0.1), at(-0.1, 0.1), at(0.2, 0.2), at(-0.2, -0.2),
  ];

  it('pulls one thrown arrow out of a tight group and reports the group without it', () => {
    const out = m.separateFlyers([...core, at(8, 0, 4)], SINGLE);
    assert.ok(out, 'a group with a thrown arrow in it has flyers');
    assert.equal(out.flyers.length, 1);
    assert.ok(out.coreStats.meanRadiusCm < out.all.meanRadiusCm / 3,
      'the group itself is far tighter than the number that included the flyer');
  });

  it('says nothing when there is nothing to say', () => {
    assert.equal(m.separateFlyers(core, SINGLE), null, 'a clean group has no flyers');
    assert.equal(m.separateFlyers(core.slice(0, 5), SINGLE), null, 'and five arrows are too few to judge');
  });
});

describe('angular dispersion', () => {
  it('1 mrad is 1cm at 10m, by construction', () => {
    assert.ok(Math.abs(m.angularDispersionMrad({ meanRadiusCm: 1 }, 10) - 1) < 1e-9);
    assert.ok(Math.abs(m.angularDispersionMrad({ meanRadiusCm: 7 }, 70) - 1) < 1e-9);
  });

  // The point of the whole metric: the same form at two distances is one
  // number, even though the centimetres and the scores are incomparable.
  it('scores the same form the same at 18m and at 70m', () => {
    const near = { ...SINGLE, distanceM: 18, faceCm: 40 };
    const far = { ...SINGLE, distanceM: 70, faceCm: 122 };
    // 1 mrad is 1.8cm at 18m and 7cm at 70m — the same form, four times the
    // group in centimetres.
    const nearArrows = Array.from({ length: 40 }, (_, i) => at(i % 2 ? 1.8 : -1.8, 0));
    // 70m/122cm: face radius 61cm.
    const farArrows = Array.from({ length: 40 }, (_, i) => ({
      score: 9, isX: false, x: (i % 2 ? 7 : -7) / 61, y: 0,
    }));
    const rows = m.angularByShape([entry(near, nearArrows), entry(far, farArrows)]);
    assert.equal(rows.length, 2);
    assert.ok(Math.abs(rows[0].mrad - rows[1].mrad) < 0.01, 'same form, same number');
  });

  it('ignores a round shape with too few positioned arrows to compare', () => {
    assert.deepEqual(m.angularByShape([entry(SINGLE, [at(1, 0), at(-1, 0)])]), []);
  });
});

describe('weeklyVolume / daysSinceLastSession', () => {
  function session(iso, arrows) {
    return {
      id: `v-${iso}`, status: 'completed', completedAt: iso, startedAt: iso,
      stages: [{ round: { ...SINGLE, arrowsPerEnd: 1, ends: arrows }, ends: Array.from({ length: arrows }, (_, i) => ({ index: i, arrows: [{ score: 9, isX: false, x: null, y: null }] })) }],
    };
  }

  it('counts arrows into Monday-based weeks and leaves gaps empty', () => {
    // 2026-08-17 is a Monday; 2026-08-03 is two Mondays before it.
    const rows = m.weeklyVolume([session('2026-08-17T10:00:00.000Z', 30), session('2026-08-03T10:00:00.000Z', 20)], 4);
    assert.equal(rows.length, 4);
    assert.equal(rows[rows.length - 1].arrows, 30, 'the latest week is the last column');
    assert.equal(rows[rows.length - 3].arrows, 20);
    assert.equal(rows[rows.length - 2].arrows, 0, 'the week off shows as a gap, not as closed up');
  });

  it('two sessions in one week land in the same bar', () => {
    const rows = m.weeklyVolume([session('2026-08-17T10:00:00.000Z', 30), session('2026-08-19T10:00:00.000Z', 12)], 2);
    const last = rows[rows.length - 1];
    assert.equal(last.arrows, 42);
    assert.equal(last.sessions, 2);
  });

  it('counts whole days since the last session that counted', () => {
    const days = m.daysSinceLastSession([session('2026-08-10T10:00:00.000Z', 30)], new Date('2026-08-17T12:00:00.000Z'));
    assert.equal(days, 7);
    assert.equal(m.daysSinceLastSession([]), null);
  });
});

describe('contrasts', () => {
  it('calls a real gap real and a small one noise', () => {
    const gara = Array.from({ length: 5 }, (_, i) => entry(SINGLE, flat(7, 60), { sessionId: `g${i}`, sessionType: 'gara' }));
    const training = Array.from({ length: 5 }, (_, i) => entry(SINGLE, flat(9, 60), { sessionId: `t${i}`, sessionType: 'allenamento' }));
    const big = m.typeContrast([...gara, ...training]);
    assert.equal(big.significant, true);
    assert.ok(Math.abs(big.diff + 2) < 1e-9, 'gara minus allenamento');

    const mixed = (a, b, n) => Array.from({ length: n }, (_, i) => ({ score: i % 2 ? a : b, isX: false, x: null, y: null }));
    const noisyGara = [entry(SINGLE, mixed(10, 6, 12), { sessionId: 'ng', sessionType: 'gara' })];
    const noisyTrain = [entry(SINGLE, mixed(10, 6, 12), { sessionId: 'nt', sessionType: 'allenamento' })];
    assert.equal(m.typeContrast([...noisyGara, ...noisyTrain]).significant, false);
  });

  it('needs both sides to contrast anything', () => {
    assert.equal(m.typeContrast([entry(SINGLE, flat(9, 30), { sessionType: 'gara' })]), null);
  });
});

describe('arrowPositionStats', () => {
  it('finds a first arrow that is genuinely worse and reports the rest fairly', () => {
    const ends = Array.from({ length: 40 }, (_, i) => ({
      index: i,
      arrows: [
        { score: 7, isX: false, x: null, y: null },
        { score: 9, isX: false, x: null, y: null },
        { score: 9, isX: false, x: null, y: null },
      ],
    }));
    const out = m.arrowPositionStats([{ ...entry(SINGLE, []), round: { ...SINGLE, ends: 40 }, ends }]);
    assert.equal(out.rows.length, 3);
    assert.equal(out.rows[0].avg, 7);
    assert.equal(out.rows[1].avg, 9);
    assert.equal(out.firstArrow.significant, true);
    assert.ok(Math.abs(out.firstArrow.diff + 2) < 1e-9);
  });

  it('does not call a coin flip a pattern', () => {
    const ends = Array.from({ length: 6 }, (_, i) => ({
      index: i,
      arrows: [
        { score: i % 2 ? 10 : 8, isX: false, x: null, y: null },
        { score: 9, isX: false, x: null, y: null },
      ],
    }));
    const out = m.arrowPositionStats([{ ...entry(SINGLE, []), round: { ...SINGLE, arrowsPerEnd: 2, ends: 6 }, ends }]);
    assert.equal(out.firstArrow.significant, false);
  });
});

describe('xRateTrend', () => {
  it('reports the share of arrows in the X, session by session', () => {
    const withX = [
      { score: 10, isX: true, x: null, y: null }, { score: 10, isX: false, x: null, y: null },
      { score: 9, isX: false, x: null, y: null }, { score: 9, isX: false, x: null, y: null },
    ];
    const [row] = m.xRateTrend([entry(SINGLE, withX)]);
    assert.equal(row.pct, 25);
    assert.equal(row.n, 4);
  });
});

describe('scoreByLocation', () => {
  it('groups spellings of the same field together and shows the commonest one', () => {
    assert.equal(m.normalizeLocationKey('  Campo   Scuola '), 'campo scuola');
    const rows = m.scoreByLocation([
      entry(SINGLE, flat(9, 30), { sessionId: 'l1', location: 'Campo Scuola' }),
      entry(SINGLE, flat(9, 30), { sessionId: 'l2', location: 'campo scuola' }),
      entry(SINGLE, flat(9, 30), { sessionId: 'l3', location: 'Campo  Scuola' }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, 'Campo Scuola', 'the spelling used most is the one shown');
    assert.equal(rows[0].count, 3);
    assert.equal(rows[0].avg, 9);
  });

  it('withholds a field with too few sessions and ignores blank ones', () => {
    const rows = m.scoreByLocation([
      entry(SINGLE, flat(9, 30), { sessionId: 'a', location: 'Palestra' }),
      entry(SINGLE, flat(8, 30), { sessionId: 'b', location: '   ' }),
      entry(SINGLE, flat(8, 30), { sessionId: 'c' }),
    ]);
    assert.deepEqual(rows, []);
  });
});

describe('scoreByCondition', () => {
  it('carries an error bar and the arrows behind each bar', () => {
    const windy = Array.from({ length: 3 }, (_, i) =>
      entry(SINGLE, flat(7, 30), { sessionId: `w${i}`, conditions: { wind: 'forte', timeOfDay: null, sun: null, tags: [] } }));
    const [row] = m.scoreByCondition(windy, 'wind');
    assert.equal(row.avg, 7);
    assert.equal(row.arrows, 90);
    assert.equal(row.count, 3);
    assert.equal(row.err, 0, 'ninety identical arrows have no sampling error');
  });

  it('still withholds a bucket below the session floor', () => {
    const one = [entry(SINGLE, flat(7, 30), { conditions: { wind: 'forte', timeOfDay: null, sun: null, tags: [] } })];
    assert.deepEqual(m.scoreByCondition(one, 'wind'), []);
  });
});

describe('volée timestamps', () => {
  const ROUND = { id: 'r', stages: [{ distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 6 }] };
  const arrow = { score: 9, isX: false, x: null, y: null };

  it('stamps the end it just confirmed and leaves the rest alone', () => {
    let s = m.createSession(ROUND, {});
    s = m.sessionConfirmEnd(s, [arrow, arrow, arrow], '2026-08-17T10:00:00.000Z');
    assert.equal(s.stages[0].ends[0].at, '2026-08-17T10:00:00.000Z');
    assert.equal(s.stages[0].ends[1].at, undefined);
    assert.equal(m.sessionArrowsShot(s), 3);

    s = m.sessionConfirmEnd(s, [arrow, arrow, arrow], '2026-08-17T10:02:00.000Z');
    assert.equal(s.stages[0].ends[1].at, '2026-08-17T10:02:00.000Z');
    assert.equal(s.stages[0].ends[0].at, '2026-08-17T10:00:00.000Z', 'the earlier stamp is not rewritten');
  });

  it('measures the gap between stamps and drops breaks', () => {
    const ends = [
      { index: 0, arrows: [arrow], at: '2026-08-17T10:00:00.000Z' },
      { index: 1, arrows: [arrow], at: '2026-08-17T10:01:00.000Z' },
      { index: 2, arrows: [arrow], at: '2026-08-17T11:30:00.000Z' }, // coffee
      { index: 3, arrows: [arrow], at: '2026-08-17T11:32:00.000Z' },
      { index: 4, arrows: [] },
    ];
    const durations = m.endDurations({ round: { ...SINGLE, arrowsPerEnd: 1, ends: 5 }, ends });
    assert.deepEqual(durations.map(d => d.seconds), [60, 120], 'the 89-minute break is not a volée');
  });

  it('ends saved before timestamps existed simply contribute nothing', () => {
    const ends = [{ index: 0, arrows: [arrow] }, { index: 1, arrows: [arrow] }];
    assert.deepEqual(m.endDurations({ round: { ...SINGLE, arrowsPerEnd: 1, ends: 2 }, ends }), []);
  });
});

describe('paceContrast', () => {
  // Each session is split at its OWN median pace, so a slow day and a fast
  // archer are never compared with each other.
  function timedEntry(id, pattern) {
    let t = Date.parse('2026-08-17T10:00:00.000Z');
    const ends = [{ index: 0, arrows: [{ score: 9, isX: false, x: null, y: null }], at: new Date(t).toISOString() }];
    pattern.forEach(([secs, score], i) => {
      t += secs * 1000;
      ends.push({ index: i + 1, arrows: [{ score, isX: false, x: null, y: null }], at: new Date(t).toISOString() });
    });
    return { ...entry(SINGLE, [], { sessionId: id }), round: { ...SINGLE, arrowsPerEnd: 1, ends: ends.length }, ends };
  }
  const slowIsBetter = [[30, 7], [90, 10], [30, 7], [90, 10], [30, 7], [90, 10]];

  it('needs three timed sessions before it will say anything', () => {
    const out = m.paceContrast([timedEntry('a', slowIsBetter), timedEntry('b', slowIsBetter)]);
    assert.equal(out.sessionsWithTiming, 2);
    assert.equal(out.contrast, null);
  });

  it('contrasts the slow half of each session against the fast half', () => {
    const out = m.paceContrast(['a', 'b', 'c'].map(id => timedEntry(id, slowIsBetter)));
    assert.equal(out.sessionsWithTiming, 3);
    assert.equal(out.contrast.significant, true);
    assert.ok(Math.abs(out.contrast.diff - 3) < 1e-9, 'slow volées scored 10, fast ones 7');
  });

  it('reports a median pace per session', () => {
    const rows = m.paceTrend([timedEntry('a', slowIsBetter)]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].seconds, 60, 'median of three 30s and three 90s volées');
  });
});

describe('ownMatchRecord', () => {
  const me = { id: 'p1', name: 'Io', email: 'Me@Example.IT' };
  const them = { id: 'p2', name: 'Altro' };
  const unit = (a, b) => ({ index: 0, arrowsA: a, arrowsB: b, totalA: a.reduce((s, v) => s + v, 0), totalB: b.reduce((s, v) => s + v, 0), spA: 2, spB: 0 });

  function tournament(match) {
    return { id: 't1', participants: [me, them], finalFormat: 'standard', thirdPlaceMatch: null, finalStage: null, rounds: [[match]] };
  }

  it('finds the archer by email, case and spacing insensitively', () => {
    const match = { ...m.emptyMatch(), slotA: me, slotB: them, status: 'completed', winnerSlot: 'A', units: [unit([10, 9, 9], [8, 8, 8])] };
    const rec = m.ownMatchRecord([tournament(match)], '  me@example.it ');
    assert.equal(rec.matches, 1);
    assert.equal(rec.won, 1);
    assert.equal(rec.arrows, 3);
    assert.ok(Math.abs(rec.avg - 28 / 3) < 1e-9, 'only the archer\'s own arrows count');
    assert.equal(rec.tournaments, 1);
  });

  it('reads the B side correctly and counts a loss as a loss', () => {
    const match = { ...m.emptyMatch(), slotA: them, slotB: me, status: 'completed', winnerSlot: 'A', units: [unit([10, 10, 10], [7, 7, 7])] };
    const rec = m.ownMatchRecord([tournament(match)], 'me@example.it');
    assert.equal(rec.won, 0);
    assert.equal(rec.avg, 7);
  });

  it('never guesses: no email, no record', () => {
    const match = { ...m.emptyMatch(), slotA: me, slotB: them, status: 'completed', winnerSlot: 'A', units: [unit([10, 9, 9], [8, 8, 8])] };
    assert.equal(m.ownMatchRecord([tournament(match)], ''), null);
    assert.equal(m.ownMatchRecord([tournament(match)], 'someone.else@example.it'), null);
    const noEmail = { id: 't2', participants: [{ id: 'p1', name: 'Io' }, them], finalFormat: 'standard', thirdPlaceMatch: null, finalStage: null, rounds: [[match]] };
    assert.equal(m.ownMatchRecord([noEmail], 'me@example.it'), null, 'matching is by email, never by name');
  });

  it('skips walkovers and matches not yet shot', () => {
    const walkover = { ...m.emptyMatch(), slotA: me, slotB: them, status: 'completed', winnerSlot: 'A', forfeit: true, units: [] };
    assert.equal(m.ownMatchRecord([tournament(walkover)], 'me@example.it'), null);
    const empty = { ...m.emptyMatch(), slotA: me, slotB: them, status: 'pending', units: [] };
    assert.equal(m.ownMatchRecord([tournament(empty)], 'me@example.it'), null);
  });
});

describe('sessionInsight — rolling baseline', () => {
  // Comparing today against every session ever shot means comparing an
  // improving archer against a worse version of themselves forever.
  it('measures against recent form, not against the whole archive', () => {
    const ROUND = { id: 'r', stages: [{ distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 2 }] };
    const built = (id, score, day) => {
      let s = m.createSession(ROUND, {});
      s = { ...s, id };
      for (let i = 0; i < 6; i++) s = m.sessionAddArrow(s, { score, isX: false, x: null, y: null });
      return { ...s, completedAt: `2026-01-${String(day).padStart(2, '0')}T10:00:00.000Z` };
    };
    // A long-ago run of weak sessions, then a settled recent level of 9.
    const ancient = Array.from({ length: 12 }, (_, i) => built(`old${i}`, 5, i + 1));
    const recent = Array.from({ length: 10 }, (_, i) => built(`new${i}`, 9, i + 13));
    const today = built('today', 9, 25);

    const [headline] = m.sessionInsight(today, [...ancient, ...recent, today]);
    assert.match(headline, /in linea/i,
      'shooting exactly at current form should read as normal, not as a triumph over an old slump');
  });
});
