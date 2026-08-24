/**
 * RECIST 1.1 / iRECIST 测量值解析工具。
 *
 * 核心约束：
 * - null / undefined / 空字符串（含纯空白）均视为“未填写”，不是 0 mm
 * - 只接受有限的非负 number，或格式明确的十进制数字字符串
 * - 布尔值、数组、对象和隐式可转换值一律视为无效
 */

export const MEASUREMENT_STATUS = Object.freeze({
  MEASURED: 'measured',
  MISSING: 'missing',
  INVALID: 'invalid'
});

const DECIMAL_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * 解析单个测量值，返回结构化结果。
 *
 * @param {unknown} value - 来自表单或导入数据的原始值
 * @returns {{ status: 'measured', mm: number } | { status: 'missing' | 'invalid' }}
 */
export function parseMeasurement(value) {
  if (value === null || value === undefined) {
    return { status: MEASUREMENT_STATUS.MISSING };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return { status: MEASUREMENT_STATUS.INVALID };
    }
    return { status: MEASUREMENT_STATUS.MEASURED, mm: value };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return { status: MEASUREMENT_STATUS.MISSING };
    if (!DECIMAL_PATTERN.test(trimmed)) return { status: MEASUREMENT_STATUS.INVALID };
    const mm = Number(trimmed);
    if (!Number.isFinite(mm) || mm < 0) return { status: MEASUREMENT_STATUS.INVALID };
    return { status: MEASUREMENT_STATUS.MEASURED, mm };
  }

  return { status: MEASUREMENT_STATUS.INVALID };
}

export function allMeasured(parsedList) {
  return parsedList.every((item) => item.status === MEASUREMENT_STATUS.MEASURED);
}

export function sumMeasured(parsedList) {
  if (!allMeasured(parsedList)) return null;
  return parsedList.reduce((sum, item) => sum + item.mm, 0);
}

/**
 * 将毫米值舍入到 0.1 mm 并转为整数（十分之一毫米）。
 * 阈值判断统一基于该整数交叉相乘，避免 IEEE-754 浮点误差在精确边界
 * （恰为 -30%、+20%、+5 mm）把 PR/PD 误判成 SD。
 */
export function toTenths(value) {
  return Math.round(value * 10);
}
