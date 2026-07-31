import { NON_TARGET_STATUSES } from './model.js';
import { daysBetween } from '../utils/format.js';
import { parseMeasurement, sumMeasured, toTenths } from '../utils/measurement.js';

export function sortVisits(patient) {
  return [...(patient.visits || [])].sort((a, b) => {
    const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
    if (dateCompare !== 0) return dateCompare;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

export function baselineTargetSum(patient) {
  if (!patient.targetLesions?.length) return null;
  const parsed = patient.targetLesions.map((lesion) => parseMeasurement(lesion.baselineMm));
  return sumMeasured(parsed);
}

export function targetSumAtVisit(patient, visit) {
  if (!patient.targetLesions?.length) return null;
  const parsed = patient.targetLesions.map((lesion) =>
    parseMeasurement(visit.targetMeasurements?.[lesion.id])
  );
  return sumMeasured(parsed);
}

/**
 * 判断靶病灶是否均已达到 RECIST 消失标准：
 * - 非淋巴结：测量值显式为 0 mm（确定消失）
 * - 淋巴结：短径 < 10 mm
 */
function allTargetLesionsResolved(patient, visit) {
  if (!patient.targetLesions?.length) return false;
  return patient.targetLesions.every((lesion) => {
    const parsed = parseMeasurement(visit.targetMeasurements?.[lesion.id]);
    if (parsed.status !== 'measured') return false;
    return lesion.isLymphNode ? parsed.mm < 10 : parsed.mm === 0;
  });
}

function targetResult(code, reason, extra = {}) {
  return {
    code, reason,
    currentSum: null, baselineSum: null, nadirSum: null,
    baselineChangePct: null, nadirChangePct: null,
    reappearedAfterTargetCR: false,
    ...extra
  };
}

export function evaluateTargetLesions(patient, visit, previousVisits = []) {
  if (!patient.targetLesions?.length) {
    return targetResult('NA', '基线未登记靶病灶。');
  }

  const baselineSum = baselineTargetSum(patient);
  const currentSum = targetSumAtVisit(patient, visit);
  if (baselineSum == null || baselineSum <= 0) {
    return targetResult('NE', '基线靶病灶测量不完整或总和为 0，无法评价。', { currentSum, baselineSum });
  }
  if (currentSum == null) {
    return targetResult('NE', '本次随访存在缺失或无效的靶病灶测量，无法评价。', { baselineSum });
  }

  const priorSums = previousVisits
    .map((item) => targetSumAtVisit(patient, item))
    .filter((value) => Number.isFinite(value));
  const nadirSum = Math.min(baselineSum, ...priorSums);

  // 阈值判断基于 0.1 mm 整数（tenths）交叉相乘，避免 IEEE-754 浮点误差
  // 在精确边界（恰为 -30%、+20%、+5 mm）把 PR/PD 误判成 SD。
  const baselineT = toTenths(baselineSum);
  const currentT = toTenths(currentSum);
  const nadirT = nadirSum > 0 ? toTenths(nadirSum) : 0;
  const baselineChangePct = ((currentT - baselineT) / baselineT) * 100;
  const nadirChangePct = nadirT > 0 ? ((currentT - nadirT) / nadirT) * 100 : null;

  const hadPriorTargetCR = previousVisits.some((v) => allTargetLesionsResolved(patient, v));
  const reappearedAfterTargetCR = hadPriorTargetCR && !allTargetLesionsResolved(patient, visit);

  if (allTargetLesionsResolved(patient, visit)) {
    return targetResult('CR', '所有非淋巴结靶病灶均消失，所有靶淋巴结短径均小于 10 mm。', {
      currentSum, baselineSum, nadirSum, baselineChangePct, nadirChangePct
    });
  }

  const absoluteIncrease = currentSum - nadirSum;
  const isNadirZeroReappearance = nadirT === 0 && currentT > 0;
  const effectiveReappeared = reappearedAfterTargetCR || isNadirZeroReappearance;
  const measured = { currentSum, baselineSum, nadirSum, baselineChangePct, nadirChangePct, reappearedAfterTargetCR: effectiveReappeared };

  if (nadirT > 0 && currentT * 5 >= nadirT * 6 && currentT - nadirT >= 50) {
    return targetResult('PD', `靶病灶直径总和较最低值增加 ${nadirChangePct.toFixed(1)}%，绝对增加 ${absoluteIncrease.toFixed(1)} mm，同时达到 ≥20% 和 ≥5 mm。`, measured);
  }

  if (currentT * 10 <= baselineT * 7) {
    return targetResult('PR', `靶病灶直径总和较基线下降 ${Math.abs(baselineChangePct).toFixed(1)}%，达到至少 30% 的下降。`, measured);
  }

  const hadPriorPR = priorSums.some((sum) => toTenths(sum) * 10 <= baselineT * 7);
  if (hadPriorPR) {
    return targetResult('PR', '既往曾达到部分缓解（相对基线下降 ≥30%），当前未达到进展标准，维持部分缓解评价。', measured);
  }

  return targetResult('SD', '未达到完全缓解、部分缓解或靶病灶进展标准。', measured);
}

export function evaluateNonTargetLesions(patient, visit) {
  if (!patient.nonTargetLesions?.length) {
    return { code: 'NA', reason: '基线未登记非靶病灶。' };
  }
  const statuses = patient.nonTargetLesions.map((lesion) => visit.nonTargetStatuses?.[lesion.id]);
  if (statuses.some((status) => status === 'unequivocalProgression' || status === 'furtherIncrease')) {
    return { code: 'PD', reason: '至少一个非靶病灶被判定为明确进展或进一步增加。' };
  }
  if (statuses.some((status) => !NON_TARGET_STATUSES.has(status) || status === 'notEvaluable')) {
    return { code: 'NE', reason: '至少一个非靶病灶缺失、无法评价或状态值无效。' };
  }
  if (statuses.every((status) => status === 'absent')) {
    return { code: 'CR', reason: '所有非靶病灶均已消失。' };
  }
  return { code: 'NON_CR_NON_PD', reason: '非靶病灶仍存在，但未见明确进展。' };
}

export function definiteNewLesionsByVisit(patient, visit, sortedVisits = sortVisits(patient)) {
  const index = sortedVisits.findIndex((item) => item.id === visit.id);
  if (index < 0) return [];
  const eligibleVisitIds = new Set(sortedVisits.slice(0, index + 1).map((item) => item.id));
  return (patient.newLesions || []).filter(
    (lesion) => lesion.definite !== false && eligibleVisitIds.has(lesion.firstDetectedVisitId)
  );
}

export function newLesionsFirstDetectedAtVisit(patient, visit) {
  return (patient.newLesions || []).filter(
    (lesion) => lesion.definite !== false && lesion.firstDetectedVisitId === visit.id
  );
}

/**
 * RECIST 1.1 Table 1/2 的时间点总体评价矩阵。
 * 非靶病灶“未全部评价”并不会自动把可由靶病灶确定的 PR/SD 降为 NE。
 */
export function evaluateOverallResponse({ target, nonTarget, hasDefiniteNewLesion, hadPriorOverallCR = false }) {
  if (hadPriorOverallCR && target.reappearedAfterTargetCR) {
    return {
      code: 'PD',
      reason: '此前曾达到总体完全缓解，当前至少一个靶病灶重新出现或靶淋巴结重新达到可测量标准（≥10 mm），构成疾病进展。'
    };
  }

  if (hasDefiniteNewLesion || target.code === 'PD' || nonTarget.code === 'PD') {
    return {
      code: 'PD',
      reason: hasDefiniteNewLesion ? '存在确定的新发恶性病灶。' : '靶病灶或非靶病灶达到进展标准。'
    };
  }

  if (target.code === 'NA') {
    if (nonTarget.code === 'CR') return { code: 'CR', reason: '仅有非靶病灶，且全部消失。' };
    if (nonTarget.code === 'NON_CR_NON_PD') {
      return { code: 'NON_CR_NON_PD', reason: '仅有非靶病灶，仍存在但没有明确进展。' };
    }
    return { code: 'NE', reason: '仅有非靶病灶，但本次未全部评价或没有可用于总体评价的病灶。' };
  }

  if (target.code === 'NE') {
    return { code: 'NE', reason: '靶病灶未全部评价，无法确定总体疗效。' };
  }

  if (target.code === 'CR') {
    if (nonTarget.code === 'CR' || nonTarget.code === 'NA') {
      return { code: 'CR', reason: '靶病灶完全缓解，非靶病灶亦全部消失或不适用，且无新发病灶。' };
    }
    if (nonTarget.code === 'NON_CR_NON_PD' || nonTarget.code === 'NE') {
      return {
        code: 'PR',
        reason: '靶病灶完全缓解，但非靶病灶仍存在或未全部评价；按 RECIST 1.1 时间点矩阵总体为 PR。'
      };
    }
  }

  if (target.code === 'PR' && ['CR', 'NON_CR_NON_PD', 'NA', 'NE'].includes(nonTarget.code)) {
    return {
      code: 'PR',
      reason: '靶病灶达到部分缓解，非靶病灶未见明确进展；按 RECIST 1.1 时间点矩阵总体为 PR。'
    };
  }

  if (target.code === 'SD' && ['CR', 'NON_CR_NON_PD', 'NA', 'NE'].includes(nonTarget.code)) {
    return {
      code: 'SD',
      reason: '靶病灶稳定，非靶病灶未见明确进展；按 RECIST 1.1 时间点矩阵总体为 SD。'
    };
  }

  return { code: 'NE', reason: '现有组合无法形成可评价的总体疗效。' };
}

/**
 * 评估单个访视的 RECIST 1.1 结果（靶病灶、非靶病灶、新发病灶、总体评价）。
 * 供 evaluateRecistSequence 与 iRECIST 状态机（irecist.js）共用。
 *
 * @param previousVisits 用于计算最低值（nadir）与既往靶病灶 CR 的访视序列
 * @param allVisits      用于定位新发病灶首次出现顺序的完整排序访视
 */
export function evaluateVisitRecist(patient, visit, previousVisits, allVisits, hadPriorOverallCR) {
  const target = evaluateTargetLesions(patient, visit, previousVisits);
  const nonTarget = evaluateNonTargetLesions(patient, visit);
  const newLesions = definiteNewLesionsByVisit(patient, visit, allVisits);
  const newlyDetected = newLesionsFirstDetectedAtVisit(patient, visit);
  const overall = evaluateOverallResponse({
    target,
    nonTarget,
    hasDefiniteNewLesion: newLesions.length > 0,
    hadPriorOverallCR
  });
  return {
    visit,
    target,
    nonTarget,
    newLesions,
    newlyDetected,
    overall,
    intervalFromBaselineDays: daysBetween(patient.baselineDate, visit.date)
  };
}

export function evaluateRecistSequence(patient) {
  const visits = sortVisits(patient);
  const results = [];
  let hadPriorOverallCR = false;
  for (let index = 0; index < visits.length; index += 1) {
    const result = evaluateVisitRecist(patient, visits[index], visits.slice(0, index), visits, hadPriorOverallCR);
    if (result.overall.code === 'CR') hadPriorOverallCR = true;
    results.push(result);
  }
  return results;
}

export function bestRecistTimepoint(results) {
  const rank = { CR: 5, PR: 4, SD: 3, NON_CR_NON_PD: 2, NE: 1, PD: 0 };
  let best = null;
  for (const result of results) {
    if (!best || (rank[result.overall.code] ?? -1) > (rank[best.overall.code] ?? -1)) best = result;
    if (result.overall.code === 'PD') break;
  }
  return best;
}

/**
 * 返回某随访时间点"可见"的新发病灶：首次发现随访按 (日期, createdAt) 排序后不晚于该随访。
 * visit 可以尚未加入 patient.visits（新建随访），此时按其日期推算预期插入位置。
 * 界面渲染与保存共用，防止把"首次发现之前"的测量/状态写入随访（写入后 schema 会在
 * 载入/导入时拒绝整份数据，导致本地数据不可恢复）。
 */
export function newLesionsTrackableAtVisit(patient, visit) {
  const ordered = sortVisits(patient);
  const indexOf = new Map(ordered.map((item, index) => [item.id, index]));
  const existingIndex = ordered.findIndex((item) => item.id === visit.id);
  if (existingIndex >= 0) {
    return (patient.newLesions || []).filter((lesion) => {
      const detectedIndex = indexOf.get(lesion.firstDetectedVisitId);
      return Number.isInteger(detectedIndex) && detectedIndex <= existingIndex;
    });
  }
  // 新建随访：插入位置会把它之后既有随访的索引整体 +1，
  // 因此可见条件变为"首次发现严格早于插入位置"。
  let insertedAt = ordered.findIndex((item) => {
    const dateCompare = String(item.date || '').localeCompare(String(visit.date || ''));
    if (dateCompare !== 0) return dateCompare > 0;
    return String(item.createdAt || '').localeCompare(String(visit.createdAt || '')) > 0;
  });
  if (insertedAt < 0) insertedAt = ordered.length;
  return (patient.newLesions || []).filter((lesion) => {
    const detectedIndex = indexOf.get(lesion.firstDetectedVisitId);
    return Number.isInteger(detectedIndex) && detectedIndex < insertedAt;
  });
}

/**
 * 删除早于首次发现随访的残留测量/状态键。
 * 首次发现随访被改晚、随访日期重排等操作会遗留此类"时间穿越"键，
 * 不清理则导出/本地数据会被 schema 拒绝。幂等，可在每次保存后调用。
 */
export function pruneNewLesionTimeTravelKeys(patient) {
  const ordered = sortVisits(patient);
  const indexOf = new Map(ordered.map((item, index) => [item.id, index]));
  for (const lesion of patient.newLesions || []) {
    const firstIndex = indexOf.get(lesion.firstDetectedVisitId);
    if (!Number.isInteger(firstIndex)) continue;
    for (const visit of ordered.slice(0, firstIndex)) {
      delete visit.newTargetMeasurements?.[lesion.id];
      delete visit.newNonTargetStatuses?.[lesion.id];
    }
  }
}
