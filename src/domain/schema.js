import {
  SCHEMA_VERSION,
  createInitialState
} from './model.js';
import { parseMeasurement } from '../utils/measurement.js';

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MODES = new Set(['RECIST11', 'IRECIST']);
const NEW_LESION_KINDS = new Set(['target', 'nonTarget']);
const NON_TARGET_STATUSES = new Set([
  'absent', 'present', 'unequivocalProgression', 'furtherIncrease', 'notEvaluable'
]);
const NEW_NON_TARGET_STATUSES = new Set([
  'absent', 'present', 'increased', 'notEvaluable'
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class StateValidationError extends Error {
  constructor(path, message) {
    super(`${path}：${message}`);
    this.name = 'StateValidationError';
    this.path = path;
  }
}

function fail(path, message) {
  throw new StateValidationError(path, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectValue(value, path) {
  if (!isPlainObject(value)) fail(path, '必须是普通对象');
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) fail(`${path}.${key}`, '包含禁止的对象键');
  }
  return value;
}

function arrayValue(value, path, max = 10000) {
  if (!Array.isArray(value)) fail(path, '必须是数组');
  if (value.length > max) fail(path, `项目数量超过上限 ${max}`);
  return value;
}

function stringValue(value, path, { required = false, max = 4000, fallback = '' } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(path, '不能为空');
    return fallback;
  }
  if (typeof value !== 'string') fail(path, '必须是字符串');
  if (value.length > max) fail(path, `长度不能超过 ${max}`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(path, '不能为空');
  return value;
}

function idValue(value, path) {
  const id = stringValue(value, path, { required: true, max: 128 });
  if (!ID_PATTERN.test(id)) fail(path, 'ID 格式无效，只允许字母开头及字母、数字、下划线、连字符');
  return id;
}

function optionalIdValue(value, path) {
  if (value === null || value === undefined || value === '') return null;
  return idValue(value, path);
}

function booleanValue(value, path, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(path, '必须是布尔值');
  return value;
}

function dateValue(value, path, { required = false } = {}) {
  const date = stringValue(value, path, { required, max: 10 });
  if (!date && !required) return '';
  if (!DATE_PATTERN.test(date)) fail(path, '日期必须为 YYYY-MM-DD');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    fail(path, '日期不存在或无效');
  }
  return date;
}

function timestampValue(value, path) {
  const timestamp = stringValue(value, path, { required: true, max: 64 });
  if (Number.isNaN(Date.parse(timestamp))) fail(path, '时间戳无效');
  return timestamp;
}

function uniqueIds(items, path) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) fail(path, `存在重复 ID：${item.id}`);
    seen.add(item.id);
  }
  return seen;
}

function measurementValue(value, path, { allowNull = true, positive = false } = {}) {
  if (value === null && allowNull) return null;
  const parsed = parseMeasurement(value);
  if (parsed.status !== 'measured') fail(path, '测量值必须是有限的非负数字或 null');
  if (positive && parsed.mm <= 0) fail(path, '测量值必须大于 0');
  return parsed.mm;
}

function safeJsonValue(value, path, depth = 0) {
  if (depth > 20) fail(path, '嵌套层级过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, '数字必须是有限值');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 10000) fail(path, '数组过大');
    return value.map((item, index) => safeJsonValue(item, `${path}[${index}]`, depth + 1));
  }
  if (isPlainObject(value)) {
    const result = {};
    const entries = Object.entries(value);
    if (entries.length > 10000) fail(path, '对象字段过多');
    for (const [key, item] of entries) {
      if (FORBIDDEN_KEYS.has(key)) fail(`${path}.${key}`, '包含禁止的对象键');
      result[key] = safeJsonValue(item, `${path}.${key}`, depth + 1);
    }
    return result;
  }
  fail(path, '包含不支持的 JSON 值');
}

function sanitizeMeasurementMap(raw, path, allowedIds) {
  const source = objectValue(raw ?? {}, path);
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    if (!allowedIds.has(key)) fail(`${path}.${key}`, '引用了不存在的病灶 ID');
    output[key] = measurementValue(value, `${path}.${key}`);
  }
  return output;
}

function sanitizeStatusMap(raw, path, allowedIds, allowedStatuses) {
  const source = objectValue(raw ?? {}, path);
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    if (!allowedIds.has(key)) fail(`${path}.${key}`, '引用了不存在的病灶 ID');
    if (typeof value !== 'string' || !allowedStatuses.has(value)) {
      fail(`${path}.${key}`, '状态值不在允许枚举中');
    }
    output[key] = value;
  }
  return output;
}

function sanitizeTargetLesion(raw, path) {
  const lesion = objectValue(raw, path);
  return {
    id: idValue(lesion.id, `${path}.id`),
    label: stringValue(lesion.label, `${path}.label`, { required: true, max: 200 }),
    organ: stringValue(lesion.organ, `${path}.organ`, { required: true, max: 200 }),
    location: stringValue(lesion.location, `${path}.location`, { max: 500 }),
    isLymphNode: booleanValue(lesion.isLymphNode, `${path}.isLymphNode`, false),
    baselineMm: measurementValue(lesion.baselineMm, `${path}.baselineMm`, { allowNull: false })
  };
}

function sanitizeNonTargetLesion(raw, path) {
  const lesion = objectValue(raw, path);
  return {
    id: idValue(lesion.id, `${path}.id`),
    label: stringValue(lesion.label, `${path}.label`, { required: true, max: 200 }),
    organ: stringValue(lesion.organ, `${path}.organ`, { required: true, max: 200 }),
    location: stringValue(lesion.location, `${path}.location`, { max: 500 })
  };
}

function sanitizeNewLesion(raw, path) {
  const lesion = objectValue(raw, path);
  const kind = stringValue(lesion.kind, `${path}.kind`, { required: true, max: 20 });
  if (!NEW_LESION_KINDS.has(kind)) fail(`${path}.kind`, '新发病灶分类无效');
  return {
    id: idValue(lesion.id, `${path}.id`),
    label: stringValue(lesion.label, `${path}.label`, { required: true, max: 200 }),
    organ: stringValue(lesion.organ, `${path}.organ`, { required: true, max: 200 }),
    location: stringValue(lesion.location, `${path}.location`, { max: 500 }),
    kind,
    isLymphNode: booleanValue(lesion.isLymphNode, `${path}.isLymphNode`, false),
    definite: booleanValue(lesion.definite, `${path}.definite`, true),
    firstDetectedVisitId: idValue(lesion.firstDetectedVisitId, `${path}.firstDetectedVisitId`)
  };
}

function sanitizePatient(raw, path) {
  const patient = objectValue(raw, path);
  const mode = stringValue(patient.mode, `${path}.mode`, { required: true, max: 20 });
  if (!MODES.has(mode)) fail(`${path}.mode`, '评估模式无效');

  const targets = arrayValue(patient.targetLesions ?? [], `${path}.targetLesions`, 1000)
    .map((item, index) => sanitizeTargetLesion(item, `${path}.targetLesions[${index}]`));
  const nonTargets = arrayValue(patient.nonTargetLesions ?? [], `${path}.nonTargetLesions`, 1000)
    .map((item, index) => sanitizeNonTargetLesion(item, `${path}.nonTargetLesions[${index}]`));
  const targetIds = uniqueIds(targets, `${path}.targetLesions`);
  const nonTargetIds = uniqueIds(nonTargets, `${path}.nonTargetLesions`);

  const rawVisits = arrayValue(patient.visits ?? [], `${path}.visits`, 10000);
  const visitSkeletons = rawVisits.map((item, index) => {
    const visit = objectValue(item, `${path}.visits[${index}]`);
    return {
      raw: visit,
      id: idValue(visit.id, `${path}.visits[${index}].id`),
      label: stringValue(visit.label, `${path}.visits[${index}].label`, { required: true, max: 200 }),
      date: dateValue(visit.date, `${path}.visits[${index}].date`, { required: true }),
      clinicalStable: booleanValue(visit.clinicalStable, `${path}.visits[${index}].clinicalStable`, true),
      notes: stringValue(visit.notes, `${path}.visits[${index}].notes`, { max: 10000 }),
      createdAt: timestampValue(visit.createdAt, `${path}.visits[${index}].createdAt`),
      updatedAt: timestampValue(visit.updatedAt, `${path}.visits[${index}].updatedAt`)
    };
  });
  const visitIds = uniqueIds(visitSkeletons, `${path}.visits`);

  const newLesions = arrayValue(patient.newLesions ?? [], `${path}.newLesions`, 1000)
    .map((item, index) => sanitizeNewLesion(item, `${path}.newLesions[${index}]`));
  const newLesionIds = uniqueIds(newLesions, `${path}.newLesions`);
  const allLesionIds = new Set([...targetIds, ...nonTargetIds]);
  for (const id of newLesionIds) {
    if (allLesionIds.has(id)) fail(`${path}.newLesions`, `病灶 ID 与基线病灶重复：${id}`);
    allLesionIds.add(id);
  }
  for (const lesion of newLesions) {
    if (!visitIds.has(lesion.firstDetectedVisitId)) {
      fail(`${path}.newLesions.${lesion.id}.firstDetectedVisitId`, '引用了不存在的随访');
    }
  }

  const newTargetIds = new Set(newLesions.filter((item) => item.kind === 'target').map((item) => item.id));
  const newNonTargetIds = new Set(newLesions.filter((item) => item.kind === 'nonTarget').map((item) => item.id));
  const visitOrder = [...visitSkeletons]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const visitIndex = new Map(visitOrder.map((item, index) => [item.id, index]));
  const newLesionById = new Map(newLesions.map((item) => [item.id, item]));

  const visits = visitSkeletons.map((visit, index) => {
    const visitPath = `${path}.visits[${index}]`;
    const newTargetMeasurements = sanitizeMeasurementMap(
      visit.raw.newTargetMeasurements,
      `${visitPath}.newTargetMeasurements`,
      newTargetIds
    );
    const newNonTargetStatuses = sanitizeStatusMap(
      visit.raw.newNonTargetStatuses,
      `${visitPath}.newNonTargetStatuses`,
      newNonTargetIds,
      NEW_NON_TARGET_STATUSES
    );
    for (const lesionId of [...Object.keys(newTargetMeasurements), ...Object.keys(newNonTargetStatuses)]) {
      const lesion = newLesionById.get(lesionId);
      if (visitIndex.get(visit.id) < visitIndex.get(lesion.firstDetectedVisitId)) {
        fail(`${visitPath}`, `包含病灶 ${lesionId} 首次发现之前的测量或状态`);
      }
    }
    return {
      id: visit.id,
      label: visit.label,
      date: visit.date,
      clinicalStable: visit.clinicalStable,
      notes: visit.notes,
      targetMeasurements: sanitizeMeasurementMap(
        visit.raw.targetMeasurements,
        `${visitPath}.targetMeasurements`,
        targetIds
      ),
      nonTargetStatuses: sanitizeStatusMap(
        visit.raw.nonTargetStatuses,
        `${visitPath}.nonTargetStatuses`,
        nonTargetIds,
        NON_TARGET_STATUSES
      ),
      newTargetMeasurements,
      newNonTargetStatuses,
      createdAt: visit.createdAt,
      updatedAt: visit.updatedAt
    };
  });

  return {
    id: idValue(patient.id, `${path}.id`),
    code: stringValue(patient.code, `${path}.code`, { required: true, max: 80 }),
    mode,
    diagnosis: stringValue(patient.diagnosis, `${path}.diagnosis`, { max: 1000 }),
    treatment: stringValue(patient.treatment, `${path}.treatment`, { max: 2000 }),
    baselineDate: dateValue(patient.baselineDate, `${path}.baselineDate`, { required: false }),
    notes: stringValue(patient.notes, `${path}.notes`, { max: 10000 }),
    targetLesions: targets,
    nonTargetLesions: nonTargets,
    newLesions,
    visits,
    createdAt: timestampValue(patient.createdAt, `${path}.createdAt`),
    updatedAt: timestampValue(patient.updatedAt, `${path}.updatedAt`)
  };
}

function sanitizeAuditEntry(raw, path) {
  const entry = objectValue(raw, path);
  return {
    id: idValue(entry.id, `${path}.id`),
    timestamp: timestampValue(entry.timestamp, `${path}.timestamp`),
    actor: stringValue(entry.actor, `${path}.actor`, { required: true, max: 200 }),
    action: stringValue(entry.action, `${path}.action`, { required: true, max: 80 }),
    entityType: stringValue(entry.entityType, `${path}.entityType`, { required: true, max: 80 }),
    entityId: idValue(entry.entityId, `${path}.entityId`),
    patientId: optionalIdValue(entry.patientId, `${path}.patientId`),
    summary: stringValue(entry.summary, `${path}.summary`, { required: true, max: 1000 }),
    before: entry.before === undefined ? null : safeJsonValue(entry.before, `${path}.before`),
    after: entry.after === undefined ? null : safeJsonValue(entry.after, `${path}.after`)
  };
}

/**
 * 对导入或本地持久化数据执行递归白名单校验，并返回不含未知字段的新对象。
 */
export function validateAndNormalizeState(raw) {
  const source = objectValue(raw, 'data');
  if (source.schemaVersion !== undefined && source.schemaVersion !== SCHEMA_VERSION) {
    fail('data.schemaVersion', `不支持的版本 ${source.schemaVersion}，当前仅支持 ${SCHEMA_VERSION}`);
  }
  const defaults = createInitialState();
  const settingsSource = objectValue(source.settings ?? {}, 'data.settings');
  const defaultMode = settingsSource.defaultMode ?? defaults.settings.defaultMode;
  if (!MODES.has(defaultMode)) fail('data.settings.defaultMode', '默认评估模式无效');
  const settings = {
    studyName: stringValue(settingsSource.studyName, 'data.settings.studyName', { max: 200, fallback: defaults.settings.studyName }),
    protocol: stringValue(settingsSource.protocol, 'data.settings.protocol', { max: 200 }),
    assessor: stringValue(settingsSource.assessor, 'data.settings.assessor', { max: 200 }),
    defaultMode
  };

  const patients = arrayValue(source.patients, 'data.patients', 10000)
    .map((item, index) => sanitizePatient(item, `data.patients[${index}]`));
  uniqueIds(patients, 'data.patients');

  const audit = arrayValue(source.audit ?? [], 'data.audit', 2000)
    .map((item, index) => sanitizeAuditEntry(item, `data.audit[${index}]`));
  uniqueIds(audit, 'data.audit');

  return {
    schemaVersion: SCHEMA_VERSION,
    settings,
    patients,
    audit
  };
}

export function isSafeInternalId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
