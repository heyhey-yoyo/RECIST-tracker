import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIrecistSequence } from '../src/domain/irecist.js';
import { makePatient, makeVisit } from '../test-utils/fixtures.js';

function newTarget(id, firstDetectedVisitId) {
  return {
    id, label: id, organ: '肺', location: '', kind: 'target',
    isLymphNode: false, definite: true, firstDetectedVisitId
  };
}

test('reappearance after prior overall CR produces iUPD instead of NE', () => {
  const patient = makePatient({
    baselineMm: 10,
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 0 }),
      makeVisit({ id: 'v2', date: '2026-03-08', target: 4 })
    ]
  });
  const results = evaluateIrecistSequence(patient);
  assert.deepEqual(results.map((item) => item.irecist.code), ['ICR', 'IUPD']);
  assert.equal(results[1].baseOverall.code, 'PD');
});

test('stable new lesion does not block iPR or iSD after original disease improves', () => {
  const iPrPatient = makePatient({
    newLesions: [newTarget('nl1', 'v1')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 125, newTargetMeasurements: { nl1: 10 } }),
      makeVisit({ id: 'v2', date: '2026-03-08', target: 50, newTargetMeasurements: { nl1: 10 } })
    ]
  });
  assert.deepEqual(evaluateIrecistSequence(iPrPatient).map((item) => item.irecist.code), ['IUPD', 'IPR']);

  const iSdPatient = makePatient({
    newLesions: [newTarget('nl1', 'v1')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 125, newTargetMeasurements: { nl1: 10 } }),
      makeVisit({ id: 'v2', date: '2026-03-08', target: 90, newTargetMeasurements: { nl1: 10 } })
    ]
  });
  assert.deepEqual(evaluateIrecistSequence(iSdPatient).map((item) => item.irecist.code), ['IUPD', 'ISD']);
});

test('unchanged prior PR plus stable new lesion remains iUPD', () => {
  const patient = makePatient({
    newLesions: [newTarget('nl1', 'v2')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 50 }),
      makeVisit({ id: 'v2', date: '2026-03-01', target: 50, newTargetMeasurements: { nl1: 10 } }),
      makeVisit({ id: 'v3', date: '2026-04-05', target: 50, newTargetMeasurements: { nl1: 10 } })
    ]
  });
  assert.deepEqual(evaluateIrecistSequence(patient).map((item) => item.irecist.code), ['IPR', 'IUPD', 'IUPD']);
});

test('scan before 28 days does not alter later nadir or state machine', () => {
  const patient = makePatient({
    newLesions: [newTarget('nl1', 'v1')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 100, newTargetMeasurements: { nl1: 10 } }),
      makeVisit({ id: 'v2', date: '2026-02-15', target: 50, newTargetMeasurements: { nl1: 10 } }),
      makeVisit({ id: 'v3', date: '2026-03-08', target: 60, newTargetMeasurements: { nl1: 10 } })
    ]
  });
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[1].irecist.stateAssessmentUsed, false);
  assert.equal(results[2].target.nadirSum, 100);
  assert.equal(results[2].irecist.code, 'IPR');
  assert.deepEqual(results[2].irecist.confirmationReasons, []);
});

test('new lesion first seen on ignored early scan is re-detected at next eligible scan', () => {
  const patient = makePatient({
    newLesions: [newTarget('nl1', 'v2')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 125 }),
      makeVisit({ id: 'v2', date: '2026-02-15', target: 125, newTargetMeasurements: { nl1: 10 } }),
      makeVisit({ id: 'v3', date: '2026-03-08', target: 125, newTargetMeasurements: { nl1: 10 } })
    ]
  });
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[1].irecist.stateAssessmentUsed, false);
  assert.equal(results[2].irecist.code, 'ICPD');
  assert.ok(results[2].irecist.confirmationReasons.some((reason) => reason.includes('额外确定的新发病灶')));
});

test('27-day scan is excluded and 28-day scan can confirm progression', () => {
  const patient = makePatient({
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 125 }),
      makeVisit({ id: 'v2', date: '2026-02-28', target: 130 }),
      makeVisit({ id: 'v3', date: '2026-03-01', target: 130 })
    ]
  });
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[1].irecist.code, 'IUPD');
  assert.equal(results[1].irecist.stateAssessmentUsed, false);
  assert.equal(results[2].irecist.code, 'ICPD');
});

test('56 days has no late-window warning while 57 days does', () => {
  const within = makePatient({ visits: [
    makeVisit({ id: 'v1', date: '2026-02-01', target: 125 }),
    makeVisit({ id: 'v2', date: '2026-03-29', target: 130 })
  ] });
  assert.equal(evaluateIrecistSequence(within)[1].irecist.warnings.some((item) => item.includes('超过')), false);

  const outside = makePatient({ visits: [
    makeVisit({ id: 'v1', date: '2026-02-01', target: 125 }),
    makeVisit({ id: 'v2', date: '2026-03-30', target: 130 })
  ] });
  assert.equal(evaluateIrecistSequence(outside)[1].irecist.warnings.some((item) => item.includes('超过')), true);
});

test('base CR with unresolved new lesion does not count as prior overall iCR', () => {
  const patient = makePatient({
    baselineMm: 10,
    newLesions: [newTarget('nl1', 'v1')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 0, newTargetMeasurements: { nl1: 10 } }),
      makeVisit({ id: 'v2', date: '2026-03-08', target: 4, newTargetMeasurements: { nl1: 10 } })
    ]
  });
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[0].irecist.code, 'IUPD');
  assert.notEqual(results[1].baseOverall.reason.includes('此前曾达到总体完全缓解'), true);
});

test('NE timepoint after iUPD does not enter nadir series (no false iCPD)', () => {
  // iUPD（新病灶）→ NE（新病灶漏测，原靶 50）→ 原靶 61 + 新病灶稳定：
  // 若 NE 的 50 mm 进入最低值，61 mm 会构成"新类别 PD"误判为 iCPD；
  // 忽略 NE 后应以基线 100 为参考，原靶为 PR，可重置为 iPR。
  const patient = makePatient({
    newLesions: [newTarget('nl1', 'v1')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 100, newTargetMeasurements: { nl1: 10 } }),
      makeVisit({ id: 'v2', date: '2026-03-08', target: 50, newTargetMeasurements: {} }),
      makeVisit({ id: 'v3', date: '2026-04-05', target: 61, newTargetMeasurements: { nl1: 10 } })
    ]
  });
  const results = evaluateIrecistSequence(patient);
  assert.deepEqual(results.map((item) => item.irecist.code), ['IUPD', 'NE', 'IPR']);
  assert.equal(results[2].target.nadirSum, 100);
  assert.ok(results[1].irecist.reason.includes('不进入后续最低值'));
});

test('new target sum exact +5.0 mm boundary confirms iCPD', () => {
  // 3.2 → 8.2 恰为 +5.0 mm（浮点差值为 4.999999999999999，原先漏判为继续 iUPD）
  const patient = makePatient({
    newLesions: [newTarget('nl1', 'v1')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 100, newTargetMeasurements: { nl1: 3.2 } }),
      makeVisit({ id: 'v2', date: '2026-03-08', target: 100, newTargetMeasurements: { nl1: 8.2 } })
    ]
  });
  const results = evaluateIrecistSequence(patient);
  assert.deepEqual(results.map((item) => item.irecist.code), ['IUPD', 'ICPD']);
});

test('new target sum exact +20% boundary (25.5 → 30.6) confirms iCPD', () => {
  // 25.5 → 30.6 恰为 +20% 与 +5.1 mm（浮点百分比为 19.999999999999996，原先漏判）
  const patient = makePatient({
    newLesions: [newTarget('nl1', 'v1')],
    visits: [
      makeVisit({ id: 'v1', date: '2026-02-01', target: 100, newTargetMeasurements: { nl1: 25.5 } }),
      makeVisit({ id: 'v2', date: '2026-03-08', target: 100, newTargetMeasurements: { nl1: 30.6 } })
    ]
  });
  const results = evaluateIrecistSequence(patient);
  assert.deepEqual(results.map((item) => item.irecist.code), ['IUPD', 'ICPD']);
});
