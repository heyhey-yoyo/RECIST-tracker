import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saveState,
  serializedStateSize,
  importBackup,
  loadState,
  getLastLoadWarning,
  StoragePersistenceError
} from '../src/storage.js';
import { makeState } from '../test-utils/fixtures.js';

test('saveState reports serialized size on success', () => {
  const original = globalThis.localStorage;
  let stored = null;
  globalThis.localStorage = { setItem: (_key, value) => { stored = value; } };
  try {
    const state = makeState();
    const result = saveState(state);
    assert.equal(result.bytes, serializedStateSize(state));
    assert.equal(typeof stored, 'string');
  } finally {
    globalThis.localStorage = original;
  }
});

test('saveState converts quota failures into a user-facing persistence error', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    setItem: () => {
      const error = new DOMException('quota', 'QuotaExceededError');
      throw error;
    }
  };
  try {
    assert.throws(() => saveState(makeState()), (error) => {
      assert.ok(error instanceof StoragePersistenceError);
      assert.match(error.message, /空间不足/);
      return true;
    });
  } finally {
    globalThis.localStorage = original;
  }
});


test('importBackup rejects a stored-XSS identifier before it reaches the UI', async () => {
  const state = makeState();
  state.patients.push({
    id: 'pt_bad\"><img_onerror_x', code: 'P-XSS', mode: 'RECIST11', diagnosis: '', treatment: '',
    baselineDate: '', notes: '', targetLesions: [], nonTargetLesions: [], newLesions: [], visits: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  });
  const file = {
    size: 1024,
    text: async () => JSON.stringify({ app: 'recist-tracker', data: state })
  };
  await assert.rejects(() => importBackup(file), /ID 格式无效/);
});

test('loadState rejects corrupted local data and exposes a warning instead of crashing', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => '{not-json' };
  const originalError = console.error;
  console.error = () => {};
  try {
    const state = loadState();
    assert.deepEqual(state.patients, []);
    assert.match(getLastLoadWarning(), /已阻止载入损坏或不兼容/);
  } finally {
    console.error = originalError;
    globalThis.localStorage = original;
  }
});
