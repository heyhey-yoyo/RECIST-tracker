/**
 * RECIST 1.1 / iRECIST 测量值解析工具。
 *
 * 核心约束：
 * - null / undefined / "" 均视为"未填写"，不是 0 mm
 * - Number(null) === 0 和 Number("") === 0 是 JavaScript 最常见的隐式转换陷阱
 * - 只有显式传入有效非负数值才返回 measured 状态
 */

export const MEASUREMENT_STATUS = Object.freeze({
  MEASURED: 'measured',
  MISSING: 'missing',
  INVALID: 'invalid'
});

/**
 * 解析单个测量值，返回结构化结果。
 *
 * @param {unknown} value - 来自表单或导入数据的原始值
 * @returns {{ status: 'measured', mm: number } | { status: 'missing' | 'invalid' }}
 */
export function parseMeasurement(value) {
  // null / undefined / 空字符串 → 未填写
  if (value === null || value === undefined || value === '') {
    return { status: MEASUREMENT_STATUS.MISSING };
  }

  const mm = Number(value);

  // NaN / Infinity / 负数 → 无效
  if (!Number.isFinite(mm) || mm < 0) {
    return { status: MEASUREMENT_STATUS.INVALID };
  }

  return { status: MEASUREMENT_STATUS.MEASURED, mm };
}

/**
 * 批量解析测量值映射表（如 visit.targetMeasurements）。
 * 返回数组中每个元素的解析结果。
 *
 * @param {Record<string, unknown>} map - 病灶ID → 原始值
 * @param {Array<{id: string}>} lesions - 病灶列表
 * @returns {Array<{ lesionId: string, status: 'measured' | 'missing' | 'invalid', mm?: number }>}
 */
export function parseMeasurementMap(map, lesions) {
  return lesions.map((lesion) => {
    const raw = map?.[lesion.id];
    const parsed = parseMeasurement(raw);
    return { lesionId: lesion.id, ...parsed };
  });
}

/**
 * 检查解析结果列表中是否全部为有效测量值。
 */
export function allMeasured(parsedList) {
  return parsedList.every((item) => item.status === MEASUREMENT_STATUS.MEASURED);
}

/**
 * 检查解析结果列表中是否有缺失值。
 */
export function hasMissing(parsedList) {
  return parsedList.some((item) => item.status === MEASUREMENT_STATUS.MISSING);
}

/**
 * 检查解析结果列表中是否有无效值。
 */
export function hasInvalid(parsedList) {
  return parsedList.some((item) => item.status === MEASUREMENT_STATUS.INVALID);
}

/**
 * 从解析结果列表中提取有效数值的和。
 * 如有任何非 measured 项，返回 null。
 */
export function sumMeasured(parsedList) {
  if (!allMeasured(parsedList)) return null;
  return parsedList.reduce((sum, item) => sum + item.mm, 0);
}
