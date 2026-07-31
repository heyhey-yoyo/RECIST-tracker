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
