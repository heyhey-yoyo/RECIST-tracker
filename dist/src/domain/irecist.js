import { evaluateOverallResponse, evaluateVisitRecist, sortVisits } from './recist.js';
import { daysBetween } from '../utils/format.js';
import { parseMeasurement, allMeasured, sumMeasured } from '../utils/measurement.js';

function visitIndexMap(visits) {
  return new Map(visits.map((visit, index) => [visit.id, index]));
}

function lesionResolved(lesion, visit) {
  if (lesion.kind === 'target') {
    const parsed = parseMeasurement(visit.newTargetMeasurements?.[lesion.id]);
    if (parsed.status !== 'measured') return false;
    return lesion.isLymphNode ? parsed.mm < 10 : parsed.mm === 0;
  }
  return visit.newNonTargetStatuses?.[lesion.id] === 'absent';
}

/**
 * 计算 iRECIST 新发病灶指标。
 *
 * stateVisits 只包含可推进 iRECIST 状态机的时间点；不足 4 周的提前扫描不会进入该数组。
 * 因此，若病灶首次记录在被忽略的提前扫描，在下一次合规扫描仍存在时，会在该合规扫描
 * 被视为首次进入状态机，而不会因提前扫描而丢失“额外新病灶”的确认信号。
 */
function newLesionMetrics(patient, visit, stateVisits, allVisits, priorMetrics) {
  const allIndexes = visitIndexMap(allVisits);
  const stateIndexes = visitIndexMap(stateVisits);
  const currentAllIndex = allIndexes.get(visit.id);
  const currentStateIndex = stateIndexes.get(visit.id);

  const effectiveDetectionVisit = new Map();
  const eligible = (patient.newLesions || []).filter((lesion) => {
    if (lesion.definite === false) return false;
    const detectedAllIndex = allIndexes.get(lesion.firstDetectedVisitId);
    if (!Number.isInteger(detectedAllIndex) || detectedAllIndex > currentAllIndex) return false;
    const firstStateVisit = stateVisits.find((candidate) => {
      const candidateAllIndex = allIndexes.get(candidate.id);
      return Number.isInteger(candidateAllIndex) && candidateAllIndex >= detectedAllIndex;
    });
    if (!firstStateVisit) return false;
    effectiveDetectionVisit.set(lesion.id, firstStateVisit.id);
    return stateIndexes.get(firstStateVisit.id) <= currentStateIndex;
  });

  const targetLesions = eligible.filter((lesion) => lesion.kind === 'target');
  const nonTargetLesions = eligible.filter((lesion) => lesion.kind === 'nonTarget');
  const targetParsed = targetLesions.map((lesion) =>
    parseMeasurement(visit.newTargetMeasurements?.[lesion.id])
  );
  const targetSum = targetLesions.length && allMeasured(targetParsed)
    ? sumMeasured(targetParsed)
    : null;
  const targetSums = priorMetrics
    .map((item) => item.newTargetSum)
    .filter((value) => Number.isFinite(value));
  const targetNadir = targetSums.length ? Math.min(...targetSums) : null;
  const targetAbsoluteIncrease = targetSum != null && targetNadir != null ? targetSum - targetNadir : null;
  const targetPercentIncrease = targetSum != null && targetNadir != null && targetNadir > 0
    ? (targetAbsoluteIncrease / targetNadir) * 100
    : targetNadir === 0 && targetSum != null ? Infinity : null;
  const targetPD = targetAbsoluteIncrease != null && targetAbsoluteIncrease >= 5 &&
    (targetNadir === 0 || targetPercentIncrease >= 20);

  const nonTargetStatuses = nonTargetLesions.map(
    (lesion) => visit.newNonTargetStatuses?.[lesion.id]
  );
  const nonTargetIncreased = nonTargetStatuses.some((status) => status === 'increased');
  const newNotEvaluable =
    targetParsed.some((parsed) => parsed.status !== 'measured') ||
    nonTargetStatuses.some((status) => !status || status === 'notEvaluable');
  const newlyDetected = eligible.filter(
    (lesion) => effectiveDetectionVisit.get(lesion.id) === visit.id
  );
  const allResolved = eligible.length > 0 && eligible.every((lesion) => lesionResolved(lesion, visit));

  return {
    eligible,
    newlyDetected,
    newTargetSum: targetSum,
    newTargetNadir: targetNadir,
    newTargetAbsoluteIncrease: targetAbsoluteIncrease,
    newTargetPercentIncrease: targetPercentIncrease,
    newTargetPD: targetPD,
    newNonTargetIncreased: nonTargetIncreased,
    newNotEvaluable,
    allResolved
  };
}

function mapBaseResponseToImmune(baseCode, newMetrics) {
  switch (baseCode) {
    case 'CR':
      // 对仍存在的新病灶保守标记为 iPR；iCR 通常还需确认残余新病灶非恶性。
      if (!newMetrics.eligible.length || newMetrics.allResolved) return 'ICR';
      return 'IPR';
    case 'PR': return 'IPR';
    case 'SD': return 'ISD';
    case 'NON_CR_NON_PD': return 'NON_ICR_NON_IUPD';
    default: return 'NE';
  }
}

function rawProgressionCauses(recistResult, baseOverall, metrics) {
  const causes = [];
  if (
    recistResult.target.code === 'PD' ||
    (baseOverall.code === 'PD' && recistResult.target.reappearedAfterTargetCR)
  ) causes.push('target');
  if (recistResult.nonTarget.code === 'PD') causes.push('nonTarget');
  if (metrics.newlyDetected.length > 0 || metrics.newTargetPD || metrics.newNonTargetIncreased) {
    causes.push('newLesion');
  }
  return [...new Set(causes)];
}

function makePendingAnchor(recistResult, baseOverall, metrics, causes) {
  return {
    visitId: recistResult.visit.id,
    date: recistResult.visit.date,
    basis: [...causes],
    baseOverallCode: baseOverall.code,
    targetSum: recistResult.target.currentSum,
    newTargetSum: metrics.newTargetSum,
    newLesionIds: metrics.eligible.map((lesion) => lesion.id)
  };
}

function confirmProgression({ pending, recistResult, metrics }) {
  const confirmations = [];
  const basis = new Set(pending.basis);

  if (
    basis.has('target') &&
    Number.isFinite(recistResult.target.currentSum) &&
    Number.isFinite(pending.targetSum) &&
    recistResult.target.currentSum - pending.targetSum >= 5
  ) {
    confirmations.push(`原靶病灶总和较 iUPD 进一步增加 ${(recistResult.target.currentSum - pending.targetSum).toFixed(1)} mm（≥5 mm）`);
  }

  if (
    basis.has('nonTarget') &&
    Object.values(recistResult.visit.nonTargetStatuses || {}).some((status) => status === 'furtherIncrease')
  ) {
    confirmations.push('先前导致 iUPD 的非靶病灶出现进一步增加');
  }

  if (basis.has('newLesion')) {
    if (
      Number.isFinite(metrics.newTargetSum) &&
      Number.isFinite(pending.newTargetSum) &&
      metrics.newTargetSum - pending.newTargetSum >= 5
    ) {
      confirmations.push(`新发靶病灶总和较 iUPD 进一步增加 ${(metrics.newTargetSum - pending.newTargetSum).toFixed(1)} mm（≥5 mm）`);
    }
    if (metrics.newNonTargetIncreased) confirmations.push('新发非靶病灶较 iUPD 增大');
  }

  const additionalNewLesions = metrics.newlyDetected.filter(
    (lesion) => !pending.newLesionIds.includes(lesion.id)
  );
  if (additionalNewLesions.length > 0) {
    confirmations.push(`出现 ${additionalNewLesions.length} 个额外确定的新发病灶`);
  }

  if (!basis.has('target') && recistResult.target.code === 'PD') {
    confirmations.push('原靶病灶在新的病灶类别达到 RECIST 1.1 进展');
  }
  if (!basis.has('nonTarget') && recistResult.nonTarget.code === 'PD') {
    confirmations.push('非靶病灶在新的病灶类别达到明确进展');
  }
  if (!basis.has('newLesion') && (metrics.newTargetPD || metrics.newNonTargetIncreased)) {
    confirmations.push('既往新发病灶类别达到新的进展标准');
  }

  return confirmations;
}

function reasonForIupd(causes, recistResult, metrics) {
  const details = [];
  if (causes.includes('target')) details.push(recistResult.target.reason);
  if (causes.includes('nonTarget')) details.push(recistResult.nonTarget.reason);
  if (metrics.newlyDetected.length > 0) details.push(`本次发现 ${metrics.newlyDetected.length} 个确定的新发病灶。`);
  if (metrics.newTargetPD) details.push('既往新发靶病灶总和达到进展标准。');
  if (metrics.newNonTargetIncreased) details.push('既往新发非靶病灶增大。');
  return `达到初始进展标准，暂记为 iUPD，需后续确认。${details.length ? ` ${details.join(' ')}` : ''}`;
}

const RESPONSE_RANK = Object.freeze({
  PD: 0,
  NON_CR_NON_PD: 1,
  SD: 2,
  PR: 3,
  CR: 4
});

/**
 * iUPD 未被确认时，允许按基线重新赋予 iSD/iPR/iCR。
 * 新病灶不必完全消退，只要没有进一步增大或新增；但若原病灶反应与 iUPD 时间点完全相同，
 * 则继续保留 iUPD，避免把“未变化的既往 PR + 稳定新病灶”错误重置为 iPR。
 */
function canResetFromIupd({ baseOverall, metrics, pending, recistResult }) {
  if (baseOverall.code === 'PD' || baseOverall.code === 'NE') return false;
  if (metrics.newTargetPD || metrics.newNonTargetIncreased || metrics.newlyDetected.length > 0) return false;

  const basis = new Set(pending.basis);
  if (basis.has('target') && recistResult.target.code === 'PD') return false;
  if (basis.has('nonTarget') && recistResult.nonTarget.code === 'PD') return false;

  if (!basis.has('newLesion')) return true;
  if (metrics.allResolved) return true;

  const currentRank = RESPONSE_RANK[baseOverall.code] ?? -1;
  const anchorRank = RESPONSE_RANK[pending.baseOverallCode] ?? -1;
  if (pending.baseOverallCode === 'PD' || currentRank > anchorRank) return true;

  const targetImproved =
    Number.isFinite(recistResult.target.currentSum) &&
    Number.isFinite(pending.targetSum) &&
    recistResult.target.currentSum < pending.targetSum;
  return currentRank === anchorRank && targetImproved;
}

export function evaluateIrecistSequence(patient) {
  const visits = sortVisits(patient);
  const results = [];
  const committedVisits = [];
  const metricsHistory = [];
  let pending = null;
  let confirmed = false;
  let hadPriorOverallCR = false;

  for (const visit of visits) {
    const intervalDays = pending ? daysBetween(pending.date, visit.date) : null;
    const tooEarly = Boolean(pending && intervalDays != null && intervalDays < 28);
    const stateVisitsForCurrent = [...committedVisits, visit];
    const recistResult = evaluateVisitRecist(
      patient,
      visit,
      committedVisits,
      visits,
      hadPriorOverallCR
    );
    const metrics = newLesionMetrics(
      patient,
      visit,
      stateVisitsForCurrent,
      visits,
      metricsHistory
    );
    const baseOverall = evaluateOverallResponse({
      target: recistResult.target,
      nonTarget: recistResult.nonTarget,
      hasDefiniteNewLesion: false,
      hadPriorOverallCR
    });
    const causes = rawProgressionCauses(recistResult, baseOverall, metrics);
    const warnings = [];
    let code;
    let reason;
    let confirmationReasons = [];
    let anchor = pending;

    if (confirmed) {
      code = 'ICPD';
      reason = '既往已确认 iCPD；后续时间点保持为 iCPD。';
    } else if (tooEarly) {
      code = 'IUPD';
      reason = `本次距离 iUPD 仅 ${intervalDays} 天，不足 4 周，不能自动确认 iCPD；该时间点不进入后续最低值、首次新病灶或确认状态计算。`;
      warnings.push(`提前检查（${intervalDays} 天 < 28 天）已从 iRECIST 状态机参考序列中排除。若满足方案规定的特殊例外，请人工复核。`);
      anchor = pending;
    } else if (!pending) {
      if (causes.length > 0) {
        code = 'IUPD';
        reason = reasonForIupd(causes, recistResult, metrics);
        pending = makePendingAnchor(recistResult, baseOverall, metrics, causes);
        anchor = pending;
      } else if (baseOverall.code === 'NE' || metrics.newNotEvaluable) {
        code = 'NE';
        reason = baseOverall.code === 'NE'
          ? baseOverall.reason
          : '新发病灶存在缺失评价，无法完成 iRECIST 判定。';
      } else {
        code = mapBaseResponseToImmune(baseOverall.code, metrics);
        reason = `未见未确认或确认进展；依据当前 RECIST 1.1 病灶组合判定为 ${code}。`;
      }
    } else {
      const outsideWindow = intervalDays != null && intervalDays > 56;
      if (outsideWindow) {
        warnings.push(`本次距离 iUPD 为 ${intervalDays} 天，超过通常建议的 4–8 周确认窗口；请结合方案和缺失访视规则复核。`);
      }

      confirmationReasons = confirmProgression({ pending, recistResult, metrics });
      if (confirmationReasons.length > 0) {
        code = 'ICPD';
        reason = `iUPD 后出现进一步进展，确认 iCPD：${confirmationReasons.join('；')}。`;
        confirmed = true;
        anchor = pending;
      } else if (baseOverall.code === 'NE' || metrics.newNotEvaluable) {
        code = 'NE';
        reason = 'iUPD 后本次存在无法评价项；未自动确认 iCPD，保留待人工复核。';
        anchor = pending;
      } else if (canResetFromIupd({ baseOverall, metrics, pending, recistResult })) {
        code = mapBaseResponseToImmune(baseOverall.code, metrics);
        reason = `未确认进一步进展，且当前病灶组合满足 ${code}；iUPD 状态已重置。`;
        pending = null;
        anchor = null;
      } else {
        code = 'IUPD';
        reason = '尚未达到 iCPD 的进一步进展标准；当前反应也未较 iUPD 时间点改善到可重置状态，继续记为 iUPD。';
        anchor = pending;
      }
    }

    if (code === 'IUPD' && visit.clinicalStable === false) {
      warnings.push('已标记临床不稳定。iRECIST 的继续治疗决策不应仅依赖影像判定，需由临床团队处理。');
    }

    results.push({
      ...recistResult,
      baseOverall,
      irecist: {
        code,
        reason,
        warnings,
        pendingAnchor: anchor ? { ...anchor } : null,
        confirmationReasons,
        stateAssessmentUsed: !tooEarly
      },
      newLesionMetrics: metrics
    });

    if (!tooEarly) {
      committedVisits.push(visit);
      metricsHistory.push(metrics);
      if (code === 'ICR') hadPriorOverallCR = true;
    }
  }
  return results;
}

export function bestIrecistTimepoint(results) {
  const rank = { ICR: 5, IPR: 4, ISD: 3, NON_ICR_NON_IUPD: 2, IUPD: 1, NE: 0, ICPD: -1 };
  let best = null;
  for (const result of results) {
    if (!best || (rank[result.irecist.code] ?? -2) > (rank[best.irecist.code] ?? -2)) best = result;
  }
  return best;
}
