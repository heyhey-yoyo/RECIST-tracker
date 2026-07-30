import { createInitialState, normalizeState, clone, createId, nowIso } from './domain/model.js';

const STORAGE_KEY = 'recist-tracker-state-v1';

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to load state', error);
    return createInitialState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  const text = await file.text();
  const parsed = JSON.parse(text);
  const candidate = parsed?.app === 'recist-tracker' ? parsed.data : parsed;
  if (!candidate || !Array.isArray(candidate.patients)) {
    throw new Error('备份文件格式不正确。');
  }
  return normalizeState(candidate);
}
