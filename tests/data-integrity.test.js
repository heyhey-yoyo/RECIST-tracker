import test from 'node:test';
import assert from 'node:assert/strict';
import { newLesionsTrackableAtVisit, pruneNewLesionTimeTravelKeys } from '../src/domain/recist.js';
import { validateAndNormalizeState } from '../src/domain/schema.js';
import { makePatient, makeVisit, makeState } from '../test-utils/fixtures.js';

function newTarget(id, firstDetectedVisitId) {
  return {
    id, label: id, organ: '肺', location: '', kind: 'target',
    isLymphNode: false, definite: true, firstDetectedVisitId
  };
}

test('editing an early visit cannot touch new lesions detected later', () => {
  const patient = makePatient({
    newLesions: [newTarget('nl1', 'v2')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 100 }),
      makeVisit({ id: 'v2', date: '2026-03-01', target: 100, newTargetMeasurements: { nl1: 10 } })
    ]
  });
  const v1 = patient.visits.find((item) => item.id === 'v1');
  assert.deepEqual(newLesionsTrackableAtVisit(patient, v1).map((item) => item.id), []);
});

test('new visit date determines which new lesions are visible', () => {
  const patient = makePatient({
    newLesions: [newTarget('nl1', 'v2')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 100 }),
      makeVisit({ id: 'v2', date: '2026-03-01', target: 100, newTargetMeasurements: { nl1: 10 } })
    ]
  });
  const early = { id: 'new-early', date: '2026-02-15', createdAt: '2026-07-31T00:00:00.000Z' };
  assert.deepEqual(newLesionsTrackableAtVisit(patient, early).map((item) => item.id), []);
  const late = { id: 'new-late', date: '2026-03-15', createdAt: '2026-07-31T00:00:00.000Z' };
  assert.deepEqual(newLesionsTrackableAtVisit(patient, late).map((item) => item.id), ['nl1']);
});

test('prune removes measurement keys before first detection (firstDetected moved later)', () => {
  const patient = makePatient({
    newLesions: [newTarget('nl1', 'v1')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 100, newTargetMeasurements: { nl1: 10 } }),
      makeVisit({ id: 'v2', date: '2026-03-01', target: 100, newTargetMeasurements: { nl1: 11 } })
    ]
  });
  patient.newLesions[0].firstDetectedVisitId = 'v2'; // 模拟首次发现随访改晚
  pruneNewLesionTimeTravelKeys(patient);
  const v1 = patient.visits.find((item) => item.id === 'v1');
  assert.equal('nl1' in v1.newTargetMeasurements, false);
  assert.equal(patient.visits.find((item) => item.id === 'v2').newTargetMeasurements.nl1, 11);
});

test('data with time-travel keys is rejected by schema but accepted after prune', () => {
  const patient = makePatient({
    newLesions: [newTarget('nl1', 'v2')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 100, newTargetMeasurements: { nl1: 10 } }),
      makeVisit({ id: 'v2', date: '2026-03-01', target: 100, newTargetMeasurements: { nl1: 10 } })
    ]
  });
  assert.throws(() => validateAndNormalizeState(makeState(patient)), /首次发现之前/);
  pruneNewLesionTimeTravelKeys(patient);
  const normalized = validateAndNormalizeState(makeState(patient));
  assert.equal(normalized.patients[0].visits[0].newTargetMeasurements.nl1, undefined);
});
