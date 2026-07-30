import {
  evaluateOverallResponse,
  evaluateRecistSequence,
  newLesionsFirstDetectedAtVisit,
  sortVisits
} from './recist.js';
import { daysBetween } from '../utils/format.js';

function visitIndexMap(visits) {
  return new Map(visits.map((visit, index) => [visit.id, index]));
}

function lesionResolved(lesion, visit) {
  if (lesion.kind === 'target') {
    const value = Number(visit.newTargetMeasurements?.[lesion.id]);
    if (!Number.isFinite(value) || value < 0) return false;
    return lesion.isLymphNode ? value < 10 : value === 0;
  }
  return visit.newNonTargetStatuses?.[lesion.id] === 'absent';
}

function newLesionMetrics(patient, visit, visits, index, priorMetrics) {
  const indexes = visitIndexMap(visits);
  const eligible = (patient.newLesions || []).filter((lesion) => {
    if (lesion.definite === false) return false;
    const detectedIndex = indexes.get(lesion.firstDetectedVisitId);
    return Number.isInteger(detectedIndex) && detectedIndex <= index;
  });
  const targetLesions = eligible.filter((lesion) => lesion.kind === 'target');
  const nonTargetLesions = eligible.filter((lesion) => lesion.kind === 'nonTarget');
  const targetValues = targetLesions.map((lesion) => Number(visit.newTargetMeasurements?.[lesion.id]));
  const targetSum = targetLesions.length && targetValues.every((value) => Number.isFinite(value) && value >= 0)
    ? targetValues.reduce((sum, value) => sum + value, 0)
    : targetLesions.length ? null : null;
  const targetSums = priorMetrics.map((item) => item.newTargetSum).filter((value) => Number.isFinite(value));
  const targetNadir = targetSums.length ? Math.min(...targetSums) : null;
  const targetAbsoluteIncrease = targetSum != null && targetNadir != null ? targetSum - targetNadir : null;
  const targetPercentIncrease = targetSum != null && targetNadir != null && targetNadir > 0
    ? (targetAbsoluteIncrease / targetNadir) * 100
    : targetNadir === 0 && targetSum != null ? Infinity : null;
  const targetPD = targetAbsoluteIncrease != null && targetAbsoluteIncrease >= 5 &&
    (targetNadir === 0 || targetPercentIncrease >= 20);
  const nonTargetStatuses = nonTargetLesions.map((lesion) => visit.newNonTargetStatuses?.[lesion.id]);
  const nonTargetIncreased = nonTargetStatuses.some((status) => status === 'increased');
  const newNotEvaluable =
    targetLesions.some((lesion) => !Number.isFinite(Number(visit.newTargetMeasurements?.[lesion.id]))) ||
    nonTargetStatuses.some((status) => !status || status === 'notEvaluable');
  const newlyDetected = newLesionsFirstDetectedAtVisit(patient, visit);
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
  if (recistResult.target.code === 'PD') causes.push('target');
  if (recistResult.nonTarget.code === 'PD') causes.push('nonTarget');
  if (metrics.newlyDetected.length > 0 || metrics.newTargetPD || metrics.newNonTargetIncreased) causes.push('newLesion');
  return [...new Set(causes)];
}

function makePendingAnchor(recistResult, metrics, causes) {
  return {
    visitId: recistResult.visit.id,
    date: recistResult.visit.date,
    basis: [...causes],
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

  const additionalNewLesions = metrics.newlyDetected.filter((lesion) => !pending.newLesionIds.includes(lesion.id));
  if (additionalNewLesions.length > 0) confirmations.push(`出现 ${additionalNewLesions.length} 个额外确定的新发病灶`);

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

export function evaluateIrecistSequence(patient) {
  const visits = sortVisits(patient);
  const recistResults = evaluateRecistSequence(patient);
  const results = [];
  const metricsHistory = [];
  let pending = null;
  let confirmed = false;

  for (let index = 0; index < visits.length; index += 1) {
    const recistResult = recistResults[index];
    const metrics = newLesionMetrics(patient, recistResult.visit, visits, index, metricsHistory);
    metricsHistory.push(metrics);
    const baseOverall = evaluateOverallResponse({
      target: recistResult.target,
      nonTarget: recistResult.nonTarget,
      hasDefiniteNewLesion: false
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
    } else if (!pending) {
      if (causes.length > 0) {
        code = 'IUPD';
        reason = reasonForIupd(causes, recistResult, metrics);
        pending = makePendingAnchor(recistResult, metrics, causes);
        anchor = pending;
      } else if (baseOverall.code === 'NE' || metrics.newNotEvaluable) {
        code = 'NE';
        reason = baseOverall.code === 'NE' ? baseOverall.reason : '新发病灶存在缺失评价，无法完成 iRECIST 判定。';
      } else {
        code = mapBaseResponseToImmune(baseOverall.code, metrics);
        reason = `未见未确认或确认进展；依据当前 RECIST 1.1 病灶组合判定为 ${code}。`;
      }
    } else {
      const intervalDays = daysBetween(pending.date, recistResult.visit.date);
      if (intervalDays != null && (intervalDays < 28 || intervalDays > 56)) {
        warnings.push(`本次距离 iUPD 为 ${intervalDays} 天，不在通常建议的 4–8 周确认窗口内；请结合方案和缺失访视规则复核。`);
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
      } else if (!['PD'].includes(baseOverall.code) && !metrics.newTargetPD && !metrics.newNonTargetIncreased && metrics.newlyDetected.length === 0) {
        code = mapBaseResponseToImmune(baseOverall.code, metrics);
        reason = `未确认进一步进展，且原病灶达到 ${baseOverall.code}；iUPD 状态重置，判定为 ${code}。`;
        pending = null;
        anchor = null;
      } else {
        code = 'IUPD';
        reason = '尚未达到 iCPD 的进一步进展标准，也未满足可重置为 iCR/iPR/iSD 的条件，继续记为 iUPD。';
        anchor = pending;
      }
    }

    if (code === 'IUPD' && recistResult.visit.clinicalStable === false) {
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
        confirmationReasons
      },
      newLesionMetrics: metrics
    });
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
