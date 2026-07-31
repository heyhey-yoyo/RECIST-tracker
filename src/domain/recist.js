import { daysBetween } from '../utils/format.js';
import { parseMeasurement, sumMeasured } from '../utils/measurement.js';

const NON_TARGET_STATUSES = new Set([
  'absent',
  'present',
  'unequivocalProgression',
  'furtherIncrease',
  'notEvaluable'
]);

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

export function evaluateTargetLesions(patient, visit, previousVisits = []) {
  if (!patient.targetLesions?.length) {
    return {
      code: 'NA', currentSum: null, baselineSum: null, nadirSum: null,
      baselineChangePct: null, nadirChangePct: null,
      reappearedAfterTargetCR: false,
      reason: '基线未登记靶病灶。'
    };
  }

  const baselineSum = baselineTargetSum(patient);
  const currentSum = targetSumAtVisit(patient, visit);
  if (baselineSum == null || baselineSum <= 0) {
    return {
      code: 'NE', currentSum, baselineSum, nadirSum: null,
      baselineChangePct: null, nadirChangePct: null,
      reappearedAfterTargetCR: false,
      reason: '基线靶病灶测量不完整或总和为 0，无法评价。'
    };
  }
  if (currentSum == null) {
    return {
      code: 'NE', currentSum: null, baselineSum, nadirSum: null,
      baselineChangePct: null, nadirChangePct: null,
      reappearedAfterTargetCR: false,
      reason: '本次随访存在缺失或无效的靶病灶测量，无法评价。'
    };
  }

  const priorSums = previousVisits
    .map((item) => targetSumAtVisit(patient, item))
    .filter((value) => Number.isFinite(value));
  const nadirSum = Math.min(baselineSum, ...priorSums);
  const baselineChangePct = ((currentSum - baselineSum) / baselineSum) * 100;
  const nadirChangePct = nadirSum > 0 ? ((currentSum - nadirSum) / nadirSum) * 100 : null;

  const hadPriorTargetCR = previousVisits.some((v) => allTargetLesionsResolved(patient, v));
  const reappearedAfterTargetCR = hadPriorTargetCR && !allTargetLesionsResolved(patient, visit);

  if (allTargetLesionsResolved(patient, visit)) {
    return {
      code: 'CR', currentSum, baselineSum, nadirSum, baselineChangePct, nadirChangePct,
      reappearedAfterTargetCR: false,
      reason: '所有非淋巴结靶病灶均消失，所有靶淋巴结短径均小于 10 mm。'
    };
  }

  const absoluteIncrease = currentSum - nadirSum;
  const isNadirZeroReappearance = nadirSum === 0 && currentSum > 0;
  const effectiveReappeared = reappearedAfterTargetCR || isNadirZeroReappearance;

  if (nadirSum > 0 && nadirChangePct >= 20 && absoluteIncrease >= 5) {
    return {
      code: 'PD', currentSum, baselineSum, nadirSum, baselineChangePct, nadirChangePct,
      reappearedAfterTargetCR: effectiveReappeared,
      reason: `靶病灶直径总和较最低值增加 ${nadirChangePct.toFixed(1)}%，绝对增加 ${absoluteIncrease.toFixed(1)} mm，同时达到 ≥20% 和 ≥5 mm。`
    };
  }

  if (baselineChangePct <= -30) {
    return {
      code: 'PR', currentSum, baselineSum, nadirSum, baselineChangePct, nadirChangePct,
      reappearedAfterTargetCR: effectiveReappeared,
      reason: `靶病灶直径总和较基线下降 ${Math.abs(baselineChangePct).toFixed(1)}%，达到至少 30% 的下降。`
    };
  }

  const hadPriorPR = priorSums.some((sum) => {
    const pct = ((sum - baselineSum) / baselineSum) * 100;
    return pct <= -30;
  });
  if (hadPriorPR) {
    return {
      code: 'PR', currentSum, baselineSum, nadirSum, baselineChangePct, nadirChangePct,
      reappearedAfterTargetCR: effectiveReappeared,
      reason: '既往曾达到部分缓解（相对基线下降 ≥30%），当前未达到进展标准，维持部分缓解评价。'
    };
  }

  return {
    code: 'SD', currentSum, baselineSum, nadirSum, baselineChangePct, nadirChangePct,
    reappearedAfterTargetCR: effectiveReappeared,
    reason: '未达到完全缓解、部分缓解或靶病灶进展标准。'
  };
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

export function evaluateRecistSequence(patient) {
  const visits = sortVisits(patient);
  const results = [];
  let hadPriorOverallCR = false;
  for (let index = 0; index < visits.length; index += 1) {
    const visit = visits[index];
    const previousVisits = visits.slice(0, index);
    const target = evaluateTargetLesions(patient, visit, previousVisits);
    const nonTarget = evaluateNonTargetLesions(patient, visit);
    const newLesions = definiteNewLesionsByVisit(patient, visit, visits);
    const newlyDetected = newLesionsFirstDetectedAtVisit(patient, visit);
    const overall = evaluateOverallResponse({
      target,
      nonTarget,
      hasDefiniteNewLesion: newLesions.length > 0,
      hadPriorOverallCR
    });
    if (overall.code === 'CR') hadPriorOverallCR = true;
    const intervalFromBaselineDays = daysBetween(patient.baselineDate, visit.date);
    results.push({
      visit,
      target,
      nonTarget,
      newLesions,
      newlyDetected,
      overall,
      intervalFromBaselineDays
    });
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
