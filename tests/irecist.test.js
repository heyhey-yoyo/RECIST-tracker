import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIrecistSequence } from '../src/domain/irecist.js';

function basePatient() {
  return {
    baselineDate: '2026-01-01',
    targetLesions: [{ id: 't1', label: '肝病灶', organ: '肝', isLymphNode: false, baselineMm: 50 }],
    nonTargetLesions: [], newLesions: [], visits: []
  };
}

function visit(id, date, value) {
  return {
    id, label: id, date, createdAt: date, clinicalStable: true,
    targetMeasurements: { t1: value }, nonTargetStatuses: {},
    newTargetMeasurements: {}, newNonTargetStatuses: {}
  };
}

test('target PD becomes iUPD then confirms with another 5 mm increase', () => {
  const patient = basePatient();
  patient.visits = [
    visit('v1', '2026-02-01', 40),
    visit('v2', '2026-03-01', 50),
    visit('v3', '2026-04-01', 55)
  ];
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[1].irecist.code, 'IUPD');
  assert.equal(results[2].irecist.code, 'ICPD');
});

test('iUPD resets to iPR when next visit shrinks to RECIST PR', () => {
  const patient = basePatient();
  patient.visits = [
    visit('v1', '2026-02-01', 35),
    visit('v2', '2026-03-01', 50),
    visit('v3', '2026-04-01', 30)
  ];
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[1].irecist.code, 'IUPD');
  assert.equal(results[2].irecist.code, 'IPR');
});

test('additional new lesion after iUPD confirms iCPD', () => {
  const patient = basePatient();
  patient.visits = [visit('v1', '2026-02-01', 40), visit('v2', '2026-03-01', 38)];
  patient.newLesions = [
    { id: 'nl1', label: '肺 1', organ: '肺', kind: 'target', definite: true, firstDetectedVisitId: 'v1', isLymphNode: false },
    { id: 'nl2', label: '肺 2', organ: '肺', kind: 'nonTarget', definite: true, firstDetectedVisitId: 'v2', isLymphNode: false }
  ];
  patient.visits[0].newTargetMeasurements.nl1 = 10;
  patient.visits[1].newTargetMeasurements.nl1 = 10;
  patient.visits[1].newNonTargetStatuses.nl2 = 'present';
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[0].irecist.code, 'IUPD');
  assert.equal(results[1].irecist.code, 'ICPD');
});

test('stable new lesion can coexist with reset to iSD', () => {
  const patient = basePatient();
  patient.visits = [visit('v1', '2026-02-01', 48), visit('v2', '2026-03-01', 45)];
  patient.newLesions = [
    { id: 'nl1', label: '肺 1', organ: '肺', kind: 'target', definite: true, firstDetectedVisitId: 'v1', isLymphNode: false }
  ];
  patient.visits[0].newTargetMeasurements.nl1 = 8;
  patient.visits[1].newTargetMeasurements.nl1 = 8;
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[0].irecist.code, 'IUPD');
  assert.equal(results[1].irecist.code, 'ISD');
});

test('new target lesion confirms iCPD after 5 mm sum increase', () => {
  const patient = basePatient();
  patient.visits = [visit('v1', '2026-02-01', 45), visit('v2', '2026-03-10', 44)];
  patient.newLesions = [
    { id: 'nl1', label: '肺结节', organ: '肺', kind: 'target', definite: true, firstDetectedVisitId: 'v1', isLymphNode: false }
  ];
  patient.visits[0].newTargetMeasurements.nl1 = 8;
  patient.visits[1].newTargetMeasurements.nl1 = 13;
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[0].irecist.code, 'IUPD');
  assert.equal(results[1].irecist.code, 'ICPD');
});

test('new non-target lesion confirms iCPD with any later increase', () => {
  const patient = basePatient();
  patient.visits = [visit('v1', '2026-02-01', 45), visit('v2', '2026-03-10', 44)];
  patient.newLesions = [
    { id: 'nl1', label: '骨病灶', organ: '骨', kind: 'nonTarget', definite: true, firstDetectedVisitId: 'v1', isLymphNode: false }
  ];
  patient.visits[0].newNonTargetStatuses.nl1 = 'present';
  patient.visits[1].newNonTargetStatuses.nl1 = 'increased';
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[0].irecist.code, 'IUPD');
  assert.equal(results[1].irecist.code, 'ICPD');
});

test('confirmation outside 4-8 week window creates a warning', () => {
  const patient = basePatient();
  patient.visits = [visit('v1', '2026-02-01', 65), visit('v2', '2026-05-01', 70)];
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[0].irecist.code, 'IUPD');
  assert.equal(results[1].irecist.code, 'ICPD');
  assert.ok(results[1].irecist.warnings.some((warning) => warning.includes('4–8 周')));
});

test('clinical instability is warned at iUPD without changing timepoint code', () => {
  const patient = basePatient();
  const v1 = visit('v1', '2026-02-01', 65);
  v1.clinicalStable = false;
  patient.visits = [v1];
  const result = evaluateIrecistSequence(patient)[0];
  assert.equal(result.irecist.code, 'IUPD');
  assert.ok(result.irecist.warnings.some((warning) => warning.includes('临床不稳定')));
});
