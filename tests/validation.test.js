import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePatient } from '../src/domain/validation.js';

test('validation reports target count and per-organ violations', () => {
  const patient = {
    code: 'P001', baselineDate: '2026-01-01', nonTargetLesions: [], newLesions: [], visits: [],
    targetLesions: Array.from({ length: 6 }, (_, index) => ({
      id: `t${index}`, label: `L${index}`, organ: index < 3 ? '肝' : `器官${index}`,
      isLymphNode: false, baselineMm: 10
    }))
  };
  const issues = validatePatient(patient);
  assert.ok(issues.some((issue) => issue.message.includes('超过 5 个')));
  assert.ok(issues.some((issue) => issue.message.includes('每器官 2 个')));
});

test('paired organs and all lymph node stations count as one organ', () => {
  const patient = {
    code: 'P001', baselineDate: '2026-01-01', nonTargetLesions: [], newLesions: [], visits: [],
    targetLesions: [
      { id: 't0', label: '左肺上叶', organ: '左肺', isLymphNode: false, baselineMm: 10 },
      { id: 't1', label: '左肺下叶', organ: '左肺', isLymphNode: false, baselineMm: 10 },
      { id: 't2', label: '右肺中叶', organ: '右肺', isLymphNode: false, baselineMm: 10 },
      { id: 't3', label: '右肺下叶', organ: 'right lung', isLymphNode: false, baselineMm: 10 }
    ]
  };
  const issues = validatePatient(patient);
  assert.ok(issues.some((issue) => issue.message.includes('“肺”登记了 4 个基线靶病灶')));
});

test('new target lesions are checked for measurability at first detection', () => {
  const patient = {
    code: 'P001', baselineDate: '2026-01-01',
    targetLesions: [], nonTargetLesions: [],
    newLesions: [
      { id: 'nl1', label: '新发小结节', organ: '肝', kind: 'target', isLymphNode: false, definite: true, firstDetectedVisitId: 'v1' },
      { id: 'nl2', label: '新发淋巴结', organ: '淋巴结', kind: 'target', isLymphNode: true, definite: true, firstDetectedVisitId: 'v1' },
      { id: 'nl3', label: '未测新发', organ: '肝', kind: 'target', isLymphNode: false, definite: true, firstDetectedVisitId: 'v1' }
    ],
    visits: [
      { id: 'v1', label: 'V1', date: '2026-02-01', clinicalStable: true, notes: '',
        targetMeasurements: {}, nonTargetStatuses: {},
        newTargetMeasurements: { nl1: 8, nl2: 12, nl3: null }, newNonTargetStatuses: {},
        createdAt: '2026-02-01T08:00:00.000Z', updatedAt: '2026-02-01T08:00:00.000Z' }
    ]
  };
  const issues = validatePatient(patient);
  assert.ok(issues.some((issue) => issue.message.includes('新发靶病灶”新发小结节”长径小于 10 mm')));
  assert.ok(issues.some((issue) => issue.message.includes('新发靶淋巴结”新发淋巴结”短径小于 15 mm')));
  assert.ok(issues.some((issue) => issue.message.includes('新发靶病灶”未测新发”首次测量无效或未填写')));
});
