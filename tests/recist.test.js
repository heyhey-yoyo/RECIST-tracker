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

// P0-1 修复：null 值应视为"未填写"而非 0 mm
test('P0-1: null measurement treated as missing (NE), not zero', () => {
  const patient = patientFixture();
  // 模拟真实表单保存格式：空测量保存为 null
  patient.visits = [{
    id: 'v1', label: 'v1', date: '2026-02-01', createdAt: '2026-02-01',
    targetMeasurements: { t1: 30, t2: null },
    nonTargetStatuses: { n1: 'present' },
    newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
  }];
  const result = evaluateRecistSequence(patient)[0];
  // 一个病灶有值，另一个为 null → 总和无法计算 → NE
  assert.equal(result.target.code, 'NE');
  assert.equal(result.overall.code, 'NE');
});

// P0-1 修复：全部病灶为 null 时不应误判 CR
test('P0-1: all null measurements are NE not CR', () => {
  const patient = patientFixture();
  patient.visits = [{
    id: 'v1', label: 'v1', date: '2026-02-01', createdAt: '2026-02-01',
    targetMeasurements: { t1: null, t2: null },
    nonTargetStatuses: { n1: 'present' },
    newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
  }];
  const result = evaluateRecistSequence(patient)[0];
  // 全部 null 不应误判为 CR（因为 null ≠ 0，病灶并未消失）
  assert.notEqual(result.target.code, 'CR');
  assert.equal(result.target.code, 'NE');
});

// P0-1 修复：null 不应创建虚假的最低值
test('P0-1: null measurement does not create false nadir of zero', () => {
  const patient = patientFixture();
  patient.visits = [
    visit('v1', '2026-02-01', 30, 10), // sum = 40
    {
      id: 'v2', label: 'v2', date: '2026-03-01', createdAt: '2026-03-01',
      targetMeasurements: { t1: 25, t2: null },
      nonTargetStatuses: { n1: 'present' },
      newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
    }
  ];
  const results = evaluateRecistSequence(patient);
  // V2 的 t2 为 null，总和无法计算 → NE（而非将 null 当作 0 从而 sum=25）
  assert.equal(results[1].target.code, 'NE');
});

// P0-4 修复：CR 后病灶重新出现应判 PD
test('P0-4: target lesion reappearance after CR is PD', () => {
  const patient = patientFixture();
  patient.visits = [
    visit('v1', '2026-02-01', 0, 5, 'absent'),  // CR: sum=5 (only lymph 5mm), non-nodal 0
    visit('v2', '2026-03-01', 8, 5)             // lesion reappeared: 8mm
  ];
  const results = evaluateRecistSequence(patient);
  // V1: nadir = 0+5 = 5... wait, the lymph node at 5mm means it's < 10mm so resolved.
  // Actually let me check: allTargetLesionsResolved would check t1=0 (non-lymph → resolved), t2=5 (lymph < 10 → resolved)
  // So V1 is CR. nadirSum = Math.min(70, 5) = 5.
  // V2: t1=8 (non-lymph, >0 → not resolved), t2=5 (lymph <10 → resolved). So not all resolved.
  // currentSum = 13. nadirSum = 5. nadir > 0, so normal PD check applies.
  // nadirChangePct = (13-5)/5*100 = 160%. absoluteIncrease = 8. 160 >= 20 AND 8 >= 5 → PD.
  // This case actually works because nadir is 5, not 0.
  //
  // Let me make a better test case with solo non-nodal lesion achieving CR:
  const patient2 = {
    baselineDate: '2026-01-01',
    targetLesions: [
      { id: 't1', label: '肝 S6', organ: '肝', isLymphNode: false, baselineMm: 30 }
    ],
    nonTargetLesions: [],
    newLesions: [],
    visits: [
      {
        id: 'v1', label: 'v1', date: '2026-02-01', createdAt: '2026-02-01',
        targetMeasurements: { t1: 0 },
        nonTargetStatuses: {},
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      },
      {
        id: 'v2', label: 'v2', date: '2026-03-01', createdAt: '2026-03-01',
        targetMeasurements: { t1: 12 },
        nonTargetStatuses: {},
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      }
    ]
  };
  const results2 = evaluateRecistSequence(patient2);
  // V1: 靶病灶 CR + 无非靶病灶 → 总体 CR
  assert.equal(results2[0].target.code, 'CR');
  assert.equal(results2[0].overall.code, 'CR');
  // V2: 靶病灶 12mm (nadir 0), reappearedAfterTargetCR=true
  // 靶病灶层不自动判 PD，由总体层根据 hadPriorOverallCR=true 判 PD
  assert.equal(results2[1].target.reappearedAfterTargetCR, true);
  assert.equal(results2[1].overall.code, 'PD');
});

// P0-4 修复：淋巴结在 CR 后重新增大超过 10mm 应判 PD
test('P0-4: lymph node re-enlargement past 10mm after CR is PD', () => {
  const patient = {
    baselineDate: '2026-01-01',
    targetLesions: [
      { id: 't1', label: '腹膜后淋巴结', organ: '淋巴结', isLymphNode: true, baselineMm: 20 }
    ],
    nonTargetLesions: [],
    newLesions: [],
    visits: [
      {
        id: 'v1', label: 'v1', date: '2026-02-01', createdAt: '2026-02-01',
        targetMeasurements: { t1: 8 }, // < 10mm → resolved
        nonTargetStatuses: {},
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      },
      {
        id: 'v2', label: 'v2', date: '2026-03-01', createdAt: '2026-03-01',
        targetMeasurements: { t1: 14 }, // > 10mm → reappeared
        nonTargetStatuses: {},
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      }
    ]
  };
  const results = evaluateRecistSequence(patient);
  assert.equal(results[0].target.code, 'CR');
  // 淋巴结重新超过 10mm，nadir 为 8（V1 淋巴结 8mm < 10mm 视为消退）→ hadPriorCR 触发 PD
  assert.equal(results[1].target.code, 'PD');
});

// 复核修复：靶淋巴结 CR 后重新达到 10mm 边界 → PD（无其他病灶）
// 基线 20mm，V1: 8mm (CR)，V2: 10mm → 仅增 2mm 不满足常规 +5mm 阈值
// 靶病灶层不自动 PD，由总体层根据 hadPriorOverallCR=true 判 PD
test('lymph node at exactly 10mm after CR is PD (nadir > 0 boundary)', () => {
  const patient = {
    baselineDate: '2026-01-01',
    targetLesions: [
      { id: 't1', label: '腹膜后淋巴结', organ: '淋巴结', isLymphNode: true, baselineMm: 20 }
    ],
    nonTargetLesions: [],
    newLesions: [],
    visits: [
      {
        id: 'v1', label: 'v1', date: '2026-02-01', createdAt: '2026-02-01',
        targetMeasurements: { t1: 8 },
        nonTargetStatuses: {},
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      },
      {
        id: 'v2', label: 'v2', date: '2026-03-01', createdAt: '2026-03-01',
        targetMeasurements: { t1: 10 }, // 恰好 10mm，常规 PD 需 +5mm（2<5 不触发）
        nonTargetStatuses: {},
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      }
    ]
  };
  const results = evaluateRecistSequence(patient);
  assert.equal(results[0].target.code, 'CR');
  assert.equal(results[0].overall.code, 'CR');
  // V2: 靶病灶层不自动 PD（regular PD 不满足），但 reappearedAfterTargetCR=true
  // 总体层检测 hadPriorOverallCR=true → PD
  assert.equal(results[1].target.reappearedAfterTargetCR, true);
  assert.notEqual(results[1].target.code, 'PD'); // 靶病灶层不自动 PD
  assert.equal(results[1].overall.code, 'PD');
});

// 复核修复：靶病灶 0→1mm 但非靶病灶持续存在 → 不自动判 PD
// 此前总体疗效为 PR（非 CR），靶病灶重新出现不应自动触发 PD
test('target reappearance after target CR but overall PR does NOT auto-PD (non-target present)', () => {
  const patient = {
    baselineDate: '2026-01-01',
    targetLesions: [
      { id: 't1', label: '肝 S6', organ: '肝', isLymphNode: false, baselineMm: 20 }
    ],
    nonTargetLesions: [{ id: 'n1', label: '腹水', organ: '腹膜' }],
    newLesions: [],
    visits: [
      {
        id: 'v1', label: 'v1', date: '2026-02-01', createdAt: '2026-02-01',
        targetMeasurements: { t1: 0 }, // 靶病灶消失
        nonTargetStatuses: { n1: 'present' }, // 非靶病灶仍存在
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      },
      {
        id: 'v2', label: 'v2', date: '2026-03-01', createdAt: '2026-03-01',
        targetMeasurements: { t1: 1 }, // 靶病灶重新出现
        nonTargetStatuses: { n1: 'present' },
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      }
    ]
  };
  const results = evaluateRecistSequence(patient);
  // V1: 靶 CR + 非靶存在 → 总体 PR（非 CR）
  assert.equal(results[0].target.code, 'CR');
  assert.equal(results[0].overall.code, 'PR');
  // V2: reappearedAfterTargetCR=true，但 hadPriorOverallCR=false
  // → 靶病灶层不自动 PD，总体层也不自动 PD
  assert.equal(results[1].target.reappearedAfterTargetCR, true);
  assert.notEqual(results[1].overall.code, 'PD');
});

// 复核修复：靶淋巴结 8→10mm 但非靶病灶持续存在 → 不自动判 PD
// 此前总体疗效为 PR，淋巴结重新达到 10mm 不满足常规 +5mm 阈值
test('lymph node 8→10mm after target CR with non-target present does NOT auto-PD', () => {
  const patient = {
    baselineDate: '2026-01-01',
    targetLesions: [
      { id: 't1', label: '腹膜后淋巴结', organ: '淋巴结', isLymphNode: true, baselineMm: 20 }
    ],
    nonTargetLesions: [{ id: 'n1', label: '腹水', organ: '腹膜' }],
    newLesions: [],
    visits: [
      {
        id: 'v1', label: 'v1', date: '2026-02-01', createdAt: '2026-02-01',
        targetMeasurements: { t1: 8 }, // 淋巴结 < 10mm → 靶 CR
        nonTargetStatuses: { n1: 'present' }, // 非靶仍存在
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      },
      {
        id: 'v2', label: 'v2', date: '2026-03-01', createdAt: '2026-03-01',
        targetMeasurements: { t1: 10 }, // 淋巴结 10mm（+2mm，不满足 +5mm）
        nonTargetStatuses: { n1: 'present' },
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      }
    ]
  };
  const results = evaluateRecistSequence(patient);
  // V1: 靶 CR + 非靶存在 → 总体 PR
  assert.equal(results[0].target.code, 'CR');
  assert.equal(results[0].overall.code, 'PR');
  // V2: 靶病灶 reappearedAfterTargetCR=true，但 hadPriorOverallCR=false
  // 常规 PD 不满足（+2mm < 5mm）→ 靶 = PR，总体 ≠ PD
  assert.equal(results[1].target.reappearedAfterTargetCR, true);
  assert.notEqual(results[1].overall.code, 'PD');
});

// 复核修复：PR 后轻微回升不降为 SD
test('PR persists after slight increase that does not meet PD', () => {
  const patient = {
    baselineDate: '2026-01-01',
    targetLesions: [
      { id: 't1', label: '肝 S6', organ: '肝', isLymphNode: false, baselineMm: 100 }
    ],
    nonTargetLesions: [],
    newLesions: [],
    visits: [
      {
        id: 'v1', label: 'v1', date: '2026-02-01', createdAt: '2026-02-01',
        targetMeasurements: { t1: 69 }, // -31% → PR
        nonTargetStatuses: {},
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      },
      {
        id: 'v2', label: 'v2', date: '2026-03-01', createdAt: '2026-03-01',
        targetMeasurements: { t1: 72 }, // -28% → 不满足 -30%，但既往 PR 应维持
        nonTargetStatuses: {},
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      }
    ]
  };
  const results = evaluateRecistSequence(patient);
  assert.equal(results[0].target.code, 'PR');
  // 既往曾达 PR 且当前未达 PD → 维持 PR，不降为 SD
  assert.equal(results[1].target.code, 'PR');
});

// 复核修复：PR 后真正进展仍应判 PD
test('PR followed by true PD still triggers progression', () => {
  const patient = {
    baselineDate: '2026-01-01',
    targetLesions: [
      { id: 't1', label: '肝 S6', organ: '肝', isLymphNode: false, baselineMm: 100 }
    ],
    nonTargetLesions: [],
    newLesions: [],
    visits: [
      {
        id: 'v1', label: 'v1', date: '2026-02-01', createdAt: '2026-02-01',
        targetMeasurements: { t1: 69 }, // -31% → PR, nadir = 69
        nonTargetStatuses: {},
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      },
      {
        id: 'v2', label: 'v2', date: '2026-03-01', createdAt: '2026-03-01',
        targetMeasurements: { t1: 88 }, // nadir 69→88: +27.5%, +19mm ≥ 5mm → PD
        nonTargetStatuses: {},
        newTargetMeasurements: {}, newNonTargetStatuses: {}, clinicalStable: true
      }
    ]
  };
  const results = evaluateRecistSequence(patient);
  assert.equal(results[0].target.code, 'PR');
  // 真正进展仍应触发 PD
  assert.equal(results[1].target.code, 'PD');
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
