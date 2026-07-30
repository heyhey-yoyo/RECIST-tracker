import { createInitialState } from './domain/model.js';

export function createDemoState() {
  const state = createInitialState();
  state.settings = {
    studyName: '胃癌免疫治疗示例研究',
    protocol: 'DEMO-001',
    assessor: '示例评估者',
    defaultMode: 'IRECIST'
  };
  state.patients = [{
    id: 'pt_demo_001',
    code: 'DEMO-001',
    mode: 'IRECIST',
    diagnosis: '晚期胃腺癌',
    treatment: 'PD-1 抑制剂联合化疗',
    baselineDate: '2026-01-01',
    notes: '仅用于演示，不代表真实病例。',
    targetLesions: [
      { id: 't_demo_1', label: '肝 S6 转移灶', organ: '肝', location: 'S6', isLymphNode: false, baselineMm: 40 },
      { id: 't_demo_2', label: '腹膜后淋巴结', organ: '淋巴结', location: '腹主动脉旁', isLymphNode: true, baselineMm: 20 }
    ],
    nonTargetLesions: [
      { id: 'nt_demo_1', label: '少量腹水', organ: '腹膜', location: '盆腔' }
    ],
    newLesions: [],
    visits: [
      {
        id: 'v_demo_1', label: '第 1 次随访', date: '2026-02-01', clinicalStable: true,
        notes: '治疗后首次复查。',
        targetMeasurements: { t_demo_1: 30, t_demo_2: 14 },
        nonTargetStatuses: { nt_demo_1: 'present' },
        newTargetMeasurements: {}, newNonTargetStatuses: {},
        createdAt: '2026-02-01T08:00:00.000Z', updatedAt: '2026-02-01T08:00:00.000Z'
      },
      {
        id: 'v_demo_2', label: '第 2 次随访', date: '2026-03-01', clinicalStable: true,
        notes: '影像达到初始进展，患者临床稳定。',
        targetMeasurements: { t_demo_1: 42, t_demo_2: 18 },
        nonTargetStatuses: { nt_demo_1: 'present' },
        newTargetMeasurements: {}, newNonTargetStatuses: {},
        createdAt: '2026-03-01T08:00:00.000Z', updatedAt: '2026-03-01T08:00:00.000Z'
      },
      {
        id: 'v_demo_3', label: '确认随访', date: '2026-04-05', clinicalStable: false,
        notes: '原靶病灶总和较 iUPD 增加 7 mm。',
        targetMeasurements: { t_demo_1: 47, t_demo_2: 20 },
        nonTargetStatuses: { nt_demo_1: 'furtherIncrease' },
        newTargetMeasurements: {}, newNonTargetStatuses: {},
        createdAt: '2026-04-05T08:00:00.000Z', updatedAt: '2026-04-05T08:00:00.000Z'
      }
    ],
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-04-05T08:00:00.000Z'
  }];
  state.audit = [{
    id: 'audit_demo_1', timestamp: new Date().toISOString(), actor: '系统', action: 'LOAD_DEMO',
    entityType: 'study', entityId: 'demo', patientId: null,
    summary: '载入演示数据', before: null, after: null
  }];
  return state;
}
