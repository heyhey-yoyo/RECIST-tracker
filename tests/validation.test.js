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
