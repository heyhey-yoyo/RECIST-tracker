export const SCHEMA_VERSION = 1;

export const RESPONSE_LABELS = Object.freeze({
  CR: 'CR 完全缓解',
  PR: 'PR 部分缓解',
  SD: 'SD 疾病稳定',
  PD: 'PD 疾病进展',
  NE: 'NE 无法评价',
  NA: '不适用',
  NON_CR_NON_PD: 'Non-CR/Non-PD 非完全缓解且非进展',
  NON_ICR_NON_IUPD: 'Non-iCR/Non-iUPD',
  ICR: 'iCR 免疫完全缓解',
  IPR: 'iPR 免疫部分缓解',
  ISD: 'iSD 免疫疾病稳定',
  IUPD: 'iUPD 免疫未确认进展',
  ICPD: 'iCPD 免疫确认进展'
});

export const NON_TARGET_STATUS_LABELS = Object.freeze({
  absent: '消失',
  present: '存在 / 非 CR 非 PD',
  unequivocalProgression: '明确进展',
  furtherIncrease: '较上次进一步增加',
  notEvaluable: '无法评价'
});

export const NEW_NON_TARGET_STATUS_LABELS = Object.freeze({
  absent: '消失',
  present: '存在 / 稳定',
  increased: '较上次增加',
  notEvaluable: '无法评价'
});

export function createId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createInitialState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      studyName: 'RECIST Tracker',
      protocol: '',
      assessor: '',
      defaultMode: 'IRECIST'
    },
    patients: [],
    audit: []
  };
}

export function createPatient(input = {}) {
  const timestamp = nowIso();
  return {
    id: createId('pt'),
    code: input.code?.trim() || '未命名受试者',
    mode: input.mode === 'RECIST11' ? 'RECIST11' : 'IRECIST',
    diagnosis: input.diagnosis?.trim() || '',
    treatment: input.treatment?.trim() || '',
    baselineDate: input.baselineDate || '',
    notes: input.notes?.trim() || '',
    targetLesions: [],
    nonTargetLesions: [],
    newLesions: [],
    visits: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createVisit(input = {}) {
  const timestamp = nowIso();
  return {
    id: createId('visit'),
    label: input.label?.trim() || '随访',
    date: input.date || '',
    clinicalStable: input.clinicalStable !== false,
    notes: input.notes?.trim() || '',
    targetMeasurements: {},
    nonTargetStatuses: {},
    newTargetMeasurements: {},
    newNonTargetStatuses: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return createInitialState();
  const base = createInitialState();
  const state = {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings || {}) },
    patients: Array.isArray(raw.patients) ? raw.patients : [],
    audit: Array.isArray(raw.audit) ? raw.audit : []
  };
  state.schemaVersion = SCHEMA_VERSION;
  state.patients = state.patients.map((patient) => ({
    ...patient,
    targetLesions: Array.isArray(patient.targetLesions) ? patient.targetLesions : [],
    nonTargetLesions: Array.isArray(patient.nonTargetLesions) ? patient.nonTargetLesions : [],
    newLesions: Array.isArray(patient.newLesions) ? patient.newLesions : [],
    visits: Array.isArray(patient.visits) ? patient.visits.map((visit) => ({
      ...visit,
      clinicalStable: visit.clinicalStable !== false,
      targetMeasurements: visit.targetMeasurements || {},
      nonTargetStatuses: visit.nonTargetStatuses || {},
      newTargetMeasurements: visit.newTargetMeasurements || {},
      newNonTargetStatuses: visit.newNonTargetStatuses || {}
    })) : []
  }));
  return state;
}

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
