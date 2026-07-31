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

// 状态枚举的唯一来源：由上方 LABELS 键派生，recist.js / schema.js 均引用此处
export const NON_TARGET_STATUSES = Object.freeze(new Set(Object.keys(NON_TARGET_STATUS_LABELS)));
export const NEW_NON_TARGET_STATUSES = Object.freeze(new Set(Object.keys(NEW_NON_TARGET_STATUS_LABELS)));

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

/**
 * RECIST 1.1 器官计数规则：成对器官（肺、肾、肾上腺、卵巢、睾丸、乳房）左右
 * 各算一个器官，全部淋巴结站算一个器官。用户输入的是自由文本，计数前先归组，
 * 否则"左肺 2 个 + 右肺 2 个"可绕过每器官最多 2 个的校验。
 */
const ORGAN_GROUP_ALIASES = new Map([
  ['肺', '肺'], ['左肺', '肺'], ['右肺', '肺'],
  ['lung', '肺'], ['left lung', '肺'], ['right lung', '肺'],
  ['肾', '肾'], ['左肾', '肾'], ['右肾', '肾'],
  ['kidney', '肾'], ['left kidney', '肾'], ['right kidney', '肾'],
  ['肾上腺', '肾上腺'], ['左肾上腺', '肾上腺'], ['右肾上腺', '肾上腺'],
  ['adrenal', '肾上腺'], ['left adrenal', '肾上腺'], ['right adrenal', '肾上腺'],
  ['卵巢', '卵巢'], ['左卵巢', '卵巢'], ['右卵巢', '卵巢'],
  ['ovary', '卵巢'], ['left ovary', '卵巢'], ['right ovary', '卵巢'],
  ['睾丸', '睾丸'], ['左睾丸', '睾丸'], ['右睾丸', '睾丸'],
  ['testis', '睾丸'], ['left testis', '睾丸'], ['right testis', '睾丸'],
  ['testicle', '睾丸'], ['left testicle', '睾丸'], ['right testicle', '睾丸'],
  ['乳房', '乳房'], ['左乳房', '乳房'], ['右乳房', '乳房'], ['左乳', '乳房'], ['右乳', '乳房'],
  ['breast', '乳房'], ['left breast', '乳房'], ['right breast', '乳房'],
  ['淋巴结', '淋巴结'], ['颈淋巴结', '淋巴结'], ['颈部淋巴结', '淋巴结'],
  ['纵隔淋巴结', '淋巴结'], ['腋下淋巴结', '淋巴结'], ['腋窝淋巴结', '淋巴结'],
  ['腹股沟淋巴结', '淋巴结'], ['腹膜后淋巴结', '淋巴结'], ['盆腔淋巴结', '淋巴结'],
  ['lymph node', '淋巴结'], ['lymph nodes', '淋巴结'],
  ['cervical lymph node', '淋巴结'], ['cervical lymph nodes', '淋巴结'],
  ['mediastinal lymph node', '淋巴结'], ['mediastinal lymph nodes', '淋巴结'],
  ['axillary lymph node', '淋巴结'], ['axillary lymph nodes', '淋巴结'],
  ['inguinal lymph node', '淋巴结'], ['inguinal lymph nodes', '淋巴结'],
  ['retroperitoneal lymph node', '淋巴结'], ['retroperitoneal lymph nodes', '淋巴结'],
  ['pelvic lymph node', '淋巴结'], ['pelvic lymph nodes', '淋巴结']
]);

export function organGroup(organ) {
  const key = String(organ || '').trim().toLowerCase();
  return ORGAN_GROUP_ALIASES.get(key) || key || '未填写器官';
}
