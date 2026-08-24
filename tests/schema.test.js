import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAndNormalizeState, StateValidationError } from '../src/domain/schema.js';
import { makePatient, makeState, makeVisit } from '../test-utils/fixtures.js';

test('strict schema accepts a valid exported-style state', () => {
  const state = makeState(makePatient({ visits: [makeVisit({ id: 'v1', date: '2026-02-01' })] }));
  assert.equal(validateAndNormalizeState(state).patients.length, 1);
});

test('strict schema rejects attribute-injection IDs', () => {
  const state = makeState(makePatient({ id: 'pt_bad\"><img_onerror_x' }));
  assert.throws(() => validateAndNormalizeState(state), StateValidationError);
});

test('strict schema rejects orphan new-lesion references', () => {
  const patient = makePatient({
    visits: [makeVisit({ id: 'v1', date: '2026-02-01' })],
    newLesions: [{
      id: 'nl1', label: 'NL1', organ: '肺', location: '', kind: 'target',
      isLymphNode: false, definite: true, firstDetectedVisitId: 'missing'
    }]
  });
  assert.throws(() => validateAndNormalizeState(makeState(patient)), /不存在的随访/);
});

test('strict schema rejects unknown status values and duplicate IDs', () => {
  const patient = makePatient({
    nonTargetLesions: [{ id: 'nt1', label: 'NT1', organ: '肺', location: '' }],
    visits: [makeVisit({ id: 'v1', date: '2026-02-01', nonTargetStatuses: { nt1: 'garbage' } })]
  });
  assert.throws(() => validateAndNormalizeState(makeState(patient)), /状态值不在允许枚举中/);

  const duplicate = makePatient({
    targetLesions: [
      { id: 't1', label: 'A', organ: '肝', location: '', isLymphNode: false, baselineMm: 10 },
      { id: 't1', label: 'B', organ: '肺', location: '', isLymphNode: false, baselineMm: 10 }
    ]
  });
  assert.throws(() => validateAndNormalizeState(makeState(duplicate)), /重复 ID/);
});

test('strict schema rejects measurement keys for nonexistent lesions', () => {
  const visit = makeVisit({ id: 'v1', date: '2026-02-01' });
  visit.targetMeasurements.ghost = 12;
  assert.throws(
    () => validateAndNormalizeState(makeState(makePatient({ visits: [visit] }))),
    /不存在的病灶 ID/
  );
});

test('strict schema preserves clinically invalid-but-structured records for validation warnings', () => {
  const patient = makePatient({
    targetLesions: Array.from({ length: 6 }, (_, index) => ({
      id: `t${index + 1}`, label: `T${index + 1}`, organ: '肝', location: '',
      isLymphNode: false, baselineMm: index === 0 ? 0 : 10
    }))
  });
  const normalized = validateAndNormalizeState(makeState(patient));
  assert.equal(normalized.patients[0].targetLesions.length, 6);
  assert.equal(normalized.patients[0].targetLesions[0].baselineMm, 0);
});
