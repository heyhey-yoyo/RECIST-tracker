import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateOverallResponse,
  evaluateRecistSequence,
  evaluateTargetLesions
} from '../src/domain/recist.js';
import { makePatient, makeVisit } from '../test-utils/fixtures.js';

const target = (code) => ({ code, reappearedAfterTargetCR: false });
const nonTarget = (code) => ({ code });

test('RECIST 1.1 Table 1 keeps evaluable target responses when non-target is not evaluated', () => {
  const cases = [
    ['CR', 'NE', 'PR'],
    ['PR', 'NE', 'PR'],
    ['SD', 'NE', 'SD'],
    ['NE', 'NON_CR_NON_PD', 'NE']
  ];
  for (const [targetCode, nonTargetCode, expected] of cases) {
    assert.equal(evaluateOverallResponse({
      target: target(targetCode),
      nonTarget: nonTarget(nonTargetCode),
      hasDefiniteNewLesion: false
    }).code, expected);
  }
});

test('RECIST target thresholds cover 30%, 20%, and 5 mm boundaries', () => {
  const patient = makePatient();
  assert.equal(evaluateTargetLesions(patient, makeVisit({ id: 'v1', date: '2026-02-01', target: 70 }), []).code, 'PR');
  assert.equal(evaluateTargetLesions(patient, makeVisit({ id: 'v1', date: '2026-02-01', target: 70.1 }), []).code, 'SD');

  const nadirVisit = makeVisit({ id: 'nadir', date: '2026-02-01', target: 20 });
  assert.equal(evaluateTargetLesions(patient, makeVisit({ id: 'v2', date: '2026-03-01', target: 25 }), [nadirVisit]).code, 'PD');
  assert.notEqual(evaluateTargetLesions(patient, makeVisit({ id: 'v2', date: '2026-03-01', target: 24.9 }), [nadirVisit]).code, 'PD');

  const nadir90 = makeVisit({ id: 'nadir', date: '2026-02-01', target: 90 });
  assert.equal(evaluateTargetLesions(patient, makeVisit({ id: 'v2', date: '2026-03-01', target: 108 }), [nadir90]).code, 'PD');
  assert.notEqual(evaluateTargetLesions(patient, makeVisit({ id: 'v2', date: '2026-03-01', target: 107.9 }), [nadir90]).code, 'PD');
});

test('unknown non-target status is NE instead of silently stable', () => {
  const patient = makePatient({
    nonTargetLesions: [{ id: 'nt1', label: 'NT1', organ: '肺', location: '' }],
    visits: [makeVisit({
      id: 'v1', date: '2026-02-01', target: 100,
      nonTargetStatuses: { nt1: 'garbage' }
    })]
  });
  const result = evaluateRecistSequence(patient)[0];
  assert.equal(result.nonTarget.code, 'NE');
  assert.equal(result.overall.code, 'SD');
});

test('exact threshold boundaries classify correctly despite float errors', () => {
  // 精确 -30%：基线 14.0 → 9.8（浮点计算为 -29.999999999999993，原先漏判为 SD）
  const pr = makePatient({ baselineMm: 14, visits: [
    makeVisit({ id: 'v1', date: '2026-02-01', target: 9.8 })
  ] });
  const prResult = evaluateRecistSequence(pr)[0];
  assert.equal(prResult.target.code, 'PR');
  assert.equal(prResult.target.baselineChangePct.toFixed(1), '-30.0');

  // 精确 +20% 与 +5 mm：最低值 27.0 → 32.4（浮点为 19.999999999999996 / 5.4，原先漏判为 SD）
  const pd = makePatient({ baselineMm: 27, visits: [
    makeVisit({ id: 'v1', date: '2026-02-01', target: 27 }),
    makeVisit({ id: 'v2', date: '2026-03-08', target: 32.4 })
  ] });
  assert.equal(evaluateRecistSequence(pd)[1].target.code, 'PD');

  // 精确 +5.0 mm（百分比远超 20%）：最低值 3.2 → 8.2（浮点差值 4.999999999999999，原先漏判为 PR）
  const pd5 = makePatient({ baselineMm: 3.2, visits: [
    makeVisit({ id: 'v1', date: '2026-02-01', target: 3.2 }),
    makeVisit({ id: 'v2', date: '2026-03-08', target: 8.2 })
  ] });
  assert.equal(evaluateRecistSequence(pd5)[1].target.code, 'PD');

  // 边界之下一侧（0.1 mm 精度内）不被误判
  const below = makePatient({ baselineMm: 14, visits: [
    makeVisit({ id: 'v1', date: '2026-02-01', target: 9.9 })
  ] });
  assert.notEqual(evaluateRecistSequence(below)[0].target.code, 'PR');
});
