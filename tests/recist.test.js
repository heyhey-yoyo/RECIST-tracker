import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecistSequence } from '../src/domain/recist.js';

function patientFixture() {
  return {
    baselineDate: '2026-01-01',
    targetLesions: [
      { id: 't1', label: '肝 S6', organ: '肝', isLymphNode: false, baselineMm: 50 },
      { id: 't2', label: '腹膜后淋巴结', organ: '淋巴结', isLymphNode: true, baselineMm: 20 }
    ],
    nonTargetLesions: [{ id: 'n1', label: '腹水', organ: '腹膜' }],
    newLesions: [],
    visits: []
  };
}

function visit(id, date, a, b, nt = 'present') {
  return {
    id, label: id, date, createdAt: date,
    targetMeasurements: { t1: a, t2: b },
    nonTargetStatuses: { n1: nt },
    newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
  };
}

test('RECIST target PR uses 30% decrease from baseline', () => {
  const patient = patientFixture();
  patient.visits = [visit('v1', '2026-02-01', 30, 15)];
  const result = evaluateRecistSequence(patient)[0];
  assert.equal(result.target.currentSum, 45);
  assert.equal(result.target.code, 'PR');
  assert.equal(result.overall.code, 'PR');
});

test('RECIST PD requires both 20% and 5 mm from nadir', () => {
  const patient = patientFixture();
  patient.visits = [
    visit('v1', '2026-02-01', 40, 10),
    visit('v2', '2026-03-01', 43, 11),
    visit('v3', '2026-04-01', 49, 11)
  ];
  const results = evaluateRecistSequence(patient);
  assert.equal(results[1].target.code, 'SD');
  assert.equal(results[2].target.code, 'PD');
});

test('target CR requires non-nodal disappearance and nodes below 10 mm', () => {
  const patient = patientFixture();
  patient.visits = [visit('v1', '2026-02-01', 0, 9, 'absent')];
  const result = evaluateRecistSequence(patient)[0];
  assert.equal(result.target.code, 'CR');
  assert.equal(result.overall.code, 'CR');
});

test('definite new lesion makes RECIST PD', () => {
  const patient = patientFixture();
  patient.visits = [visit('v1', '2026-02-01', 30, 15)];
  patient.newLesions = [{ id: 'nl1', label: '肺结节', organ: '肺', kind: 'target', definite: true, firstDetectedVisitId: 'v1' }];
  patient.visits[0].newTargetMeasurements.nl1 = 8;
  const result = evaluateRecistSequence(patient)[0];
  assert.equal(result.overall.code, 'PD');
});

test('missing target measurement is NE', () => {
  const patient = patientFixture();
  patient.visits = [visit('v1', '2026-02-01', 30, undefined)];
  const result = evaluateRecistSequence(patient)[0];
  assert.equal(result.target.code, 'NE');
  assert.equal(result.overall.code, 'NE');
});

test('PD from nadir overrides PR threshold from baseline', () => {
  const patient = patientFixture();
  patient.visits = [
    visit('v1', '2026-02-01', 20, 10),
    visit('v2', '2026-03-01', 37, 11)
  ];
  const results = evaluateRecistSequence(patient);
  assert.equal(results[0].target.code, 'PR');
  assert.equal(results[1].target.code, 'PD');
});
