import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeasurement } from '../src/utils/measurement.js';

test('measurement parser rejects implicit JavaScript coercions', () => {
  for (const value of [false, true, [], [12], {}, 12n]) {
    assert.deepEqual(parseMeasurement(value), { status: 'invalid' });
  }
});

test('measurement parser distinguishes blank values from zero', () => {
  assert.deepEqual(parseMeasurement(null), { status: 'missing' });
  assert.deepEqual(parseMeasurement(undefined), { status: 'missing' });
  assert.deepEqual(parseMeasurement(''), { status: 'missing' });
  assert.deepEqual(parseMeasurement('   '), { status: 'missing' });
  assert.deepEqual(parseMeasurement(0), { status: 'measured', mm: 0 });
  assert.deepEqual(parseMeasurement('0'), { status: 'measured', mm: 0 });
});

test('measurement parser accepts only finite non-negative numbers and decimal strings', () => {
  assert.deepEqual(parseMeasurement(12.5), { status: 'measured', mm: 12.5 });
  assert.deepEqual(parseMeasurement('12.5'), { status: 'measured', mm: 12.5 });
  assert.deepEqual(parseMeasurement('.5'), { status: 'measured', mm: 0.5 });
  for (const value of [-1, Infinity, NaN, '-1', '1e2', '12mm']) {
    assert.deepEqual(parseMeasurement(value), { status: 'invalid' });
  }
});
