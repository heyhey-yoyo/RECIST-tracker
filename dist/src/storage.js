import { createInitialState, clone, createId, nowIso } from './domain/model.js';
import { validateAndNormalizeState } from './domain/schema.js';
import { evaluateRecistSequence } from './domain/recist.js';
import { evaluateIrecistSequence } from './domain/irecist.js';

const STORAGE_KEY = 'recist-tracker-state-v1';
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const STORAGE_WARNING_BYTES = 4 * 1024 * 1024;
let lastLoadWarning = '';

export class StoragePersistenceError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'StoragePersistenceError';
  }
}

function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * 防御性规则预演：载入数据后先跑一遍全部评估。
 * 结果不用于展示——若未来规则升级对数据假设更严格（或数据含 schema 校验漏过的异常），
 * 会在 loadState/importBackup 阶段被拒绝并提示"数据已损坏"，而不是在渲染时崩溃。
 */
function preflightCalculations(state) {
  for (const patient of state.patients) {
    evaluateRecistSequence(patient);
    if (patient.mode === 'IRECIST') evaluateIrecistSequence(patient);
  }
}

export function loadState() {
  lastLoadWarning = '';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const state = validateAndNormalizeState(JSON.parse(raw));
    preflightCalculations(state);
    return state;
  } catch (error) {
    console.error('Failed to load state', error);
    lastLoadWarning = `已阻止载入损坏或不兼容的本地数据：${error.message}`;
    return createInitialState();
  }
}

export function getLastLoadWarning() {
  return lastLoadWarning;
}

export function serializedStateSize(state) {
  return byteLength(JSON.stringify(state));
}

export function saveState(state) {
  let serialized;
  try {
    serialized = JSON.stringify(state);
  } catch (error) {
    throw new StoragePersistenceError('数据无法序列化，未写入本地存储。', error);
  }

  const bytes = byteLength(serialized);
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    const quotaExceeded = error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014;
    const message = quotaExceeded
      ? '浏览器本地存储空间不足，改动未保存。请立即导出备份并清理不需要的审计记录或网站数据。'
      : '浏览器拒绝写入本地存储，改动未保存。请检查隐私模式、站点权限或可用空间。';
    throw new StoragePersistenceError(message, error);
  }

  return {
    bytes,
    nearCapacity: bytes >= STORAGE_WARNING_BYTES
  };
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

export function appendAudit(state, { action, entityType, entityId, patientId = null, summary, before = null, after = null }) {
  const entry = {
    id: createId('audit'),
    timestamp: nowIso(),
    actor: state.settings.assessor?.trim() || '本地用户',
    action,
    entityType,
    entityId,
    patientId,
    summary,
    before: before == null ? null : clone(before),
    after: after == null ? null : clone(after)
  };
  state.audit.unshift(entry);
  if (state.audit.length > 2000) state.audit.length = 2000;
  return entry;
}

export function exportBackup(state) {
  const payload = {
    exportedAt: nowIso(),
    app: 'recist-tracker',
    data: state
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `recist-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importBackup(file) {
  if (Number.isFinite(file.size) && file.size > MAX_IMPORT_BYTES) {
    throw new Error('备份文件超过 10 MiB 安全上限。');
  }
  const text = await file.text();
  if (byteLength(text) > MAX_IMPORT_BYTES) {
    throw new Error('备份文件超过 10 MiB 安全上限。');
  }
  const parsed = JSON.parse(text);
  const candidate = parsed?.app === 'recist-tracker' ? parsed.data : parsed;
  const state = validateAndNormalizeState(candidate);
  preflightCalculations(state);
  return state;
}
