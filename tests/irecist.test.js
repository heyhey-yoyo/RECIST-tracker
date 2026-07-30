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

// ============================================================
// 已有测试（保持通过）
// ============================================================

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

test('iUPD resets to iPR when next visit shows meaningful shrinkage', () => {
  const patient = basePatient();
  patient.visits = [
    visit('v1', '2026-02-01', 35),
    visit('v2', '2026-03-01', 50),  // iUPD: target PD from nadir 35
    visit('v3', '2026-04-01', 30)   // 较 iUPD 锚点下降 20mm ≥ 5mm，且达到 PR → 重置为 IPR
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

// ============================================================
// P0-2 测试：不足 4 周不得自动确认 iCPD
// ============================================================

test('P0-2: iUPD with < 28 days blocks auto-confirmation even with 5mm increase', () => {
  const patient = basePatient();
  patient.visits = [
    visit('v1', '2026-01-15', 40),
    visit('v2', '2026-02-01', 50),  // iUPD: target PD
    visit('v3', '2026-02-15', 56)   // 仅 14 天后，靶病灶继续增大 6mm ≥ 5mm，但不足 4 周
  ];
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[1].irecist.code, 'IUPD');
  // 不足 28 天应阻止自动确认，保持 IUPD
  assert.equal(results[2].irecist.code, 'IUPD');
  assert.ok(results[2].irecist.warnings.some((w) => w.includes('28 天')));
});

test('P0-2: iUPD at exactly 28 days allows confirmation', () => {
  const patient = basePatient();
  patient.visits = [
    visit('v1', '2026-02-01', 40),
    visit('v2', '2026-03-01', 50),  // iUPD
    visit('v3', '2026-03-29', 56)   // 恰好 28 天后，增加 6mm ≥ 5mm
  ];
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[1].irecist.code, 'IUPD');
  // 28 天及以上不触发提前阻止（tooEarly = interval > 28 ? false）
  // intervalDays = 28, tooEarly = 28 < 28 = false → 允许确认
  assert.equal(results[2].irecist.code, 'ICPD');
});

// ============================================================
// P0-3 测试：iUPD 重置需显著改善
// ============================================================

test('P0-3: iUPD with stable new lesion stays IUPD (does not reset to iSD)', () => {
  // 原错误测试 "stable new lesion can coexist with reset to iSD" 的修正版
  const patient = basePatient();
  patient.visits = [visit('v1', '2026-02-01', 48), visit('v2', '2026-03-01', 45)];
  patient.newLesions = [
    { id: 'nl1', label: '肺 1', organ: '肺', kind: 'target', definite: true, firstDetectedVisitId: 'v1', isLymphNode: false }
  ];
  patient.visits[0].newTargetMeasurements.nl1 = 8;
  patient.visits[1].newTargetMeasurements.nl1 = 8;
  const results = evaluateIrecistSequence(patient);
  // V1: 48mm + 8mm 新病灶 → iUPD（新病灶触发）
  // V2: 45mm + 8mm 新病灶（稳定）→ 新病灶未消退，不应重置
  assert.equal(results[0].irecist.code, 'IUPD');
  // P0-3 修复后：新病灶持续存在 → 保持 IUPD，不重置为 iSD
  assert.equal(results[1].irecist.code, 'IUPD');
});

test('P0-3: iUPD from new lesion resets only when new lesion resolves', () => {
  const patient = basePatient();
  patient.visits = [
    visit('v1', '2026-02-01', 48),
    visit('v2', '2026-03-01', 45),
    visit('v3', '2026-04-01', 42)
  ];
  patient.newLesions = [
    { id: 'nl1', label: '肺 1', organ: '肺', kind: 'target', definite: true, firstDetectedVisitId: 'v1', isLymphNode: false }
  ];
  patient.visits[0].newTargetMeasurements.nl1 = 8;
  patient.visits[1].newTargetMeasurements.nl1 = 8;
  patient.visits[2].newTargetMeasurements.nl1 = 0; // V3 时新病灶消失
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[0].irecist.code, 'IUPD');
  assert.equal(results[1].irecist.code, 'IUPD'); // 新病灶稳定 → 仍 IUPD
  // V3：新病灶消失 + 靶病灶不再进展 → 可重置
  // 靶病灶 42mm 相对基线 50mm 仅降 16%，不满足 PR（需 ≥30%） → 重置为 ISD
  assert.equal(results[2].irecist.code, 'ISD');
});

test('P0-3: iUPD from target PD requires meaningful decrease to reset', () => {
  const patient = basePatient();
  patient.visits = [
    visit('v1', '2026-02-01', 35),
    visit('v2', '2026-03-01', 50),  // iUPD from target PD (nadir 35 → 50, +43%, +15mm)
    visit('v3', '2026-04-01', 47)   // 仅下降 3mm < 5mm，且不是 PR/CR → 不满足重置条件
  ];
  const results = evaluateIrecistSequence(patient);
  assert.equal(results[1].irecist.code, 'IUPD');
  // 靶病灶下降不足 5mm 且未达到 PR/CR → 保持 IUPD
  assert.equal(results[2].irecist.code, 'IUPD');
});

// ============================================================
// P0-1 组合测试：iRECIST 中的空值处理
// ============================================================

test('P0-1 irecist: null new target measurement flags not-evaluable but iUPD takes priority', () => {
  const patient = basePatient();
  patient.visits = [visit('v1', '2026-02-01', 45)];
  patient.newLesions = [
    { id: 'nl1', label: '肺结节', organ: '肺', kind: 'target', definite: true, firstDetectedVisitId: 'v1', isLymphNode: false }
  ];
  // 新靶病灶测量为 null → metrics.newNotEvaluable = true
  // 但确定的新发病灶首次出现触发 iUPD（优先级高于 NE）
  patient.visits[0].newTargetMeasurements.nl1 = null;
  const results = evaluateIrecistSequence(patient);
  // iUPD 优先于 NE（新病灶出现是进展信号）
  assert.equal(results[0].irecist.code, 'IUPD');
  // 但应标记新病灶测量缺失
  assert.equal(results[0].newLesionMetrics.newNotEvaluable, true);
});
