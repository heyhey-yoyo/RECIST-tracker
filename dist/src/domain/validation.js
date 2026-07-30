import { baselineTargetSum, sortVisits, targetSumAtVisit } from './recist.js';
import { daysBetween } from '../utils/format.js';
import { parseMeasurement } from '../utils/measurement.js';

export function validatePatient(patient) {
  const issues = [];
  const targets = patient.targetLesions || [];
  if (!patient.code?.trim()) issues.push({ level: 'error', message: '受试者编号不能为空。' });
  if (!patient.baselineDate) issues.push({ level: 'warning', message: '尚未填写基线日期。' });
  if (targets.length > 5) issues.push({ level: 'error', message: '基线靶病灶超过 5 个。' });

  const byOrgan = new Map();
  for (const lesion of targets) {
    const organ = lesion.organ?.trim() || '未填写器官';
    byOrgan.set(organ, (byOrgan.get(organ) || 0) + 1);
    const parsed = parseMeasurement(lesion.baselineMm);
    if (parsed.status !== 'measured') {
      issues.push({ level: 'error', message: `靶病灶”${lesion.label}”的基线测量无效或未填写。` });
    } else if (parsed.mm <= 0) {
      issues.push({ level: 'error', message: `靶病灶”${lesion.label}”的基线测量必须大于 0。` });
    } else if (lesion.isLymphNode && parsed.mm < 15) {
      issues.push({ level: 'warning', message: `靶淋巴结”${lesion.label}”基线短径小于 15 mm，通常不满足可测量靶病灶标准。` });
    } else if (!lesion.isLymphNode && parsed.mm < 10) {
      issues.push({ level: 'warning', message: `靶病灶”${lesion.label}”基线长径小于 10 mm，通常不满足可测量靶病灶标准。` });
    }
  }
  for (const [organ, count] of byOrgan.entries()) {
    if (count > 2) issues.push({ level: 'error', message: `器官“${organ}”登记了 ${count} 个基线靶病灶，超过每器官 2 个。` });
  }

  if (targets.length > 0 && baselineTargetSum(patient) == null) {
    issues.push({ level: 'error', message: '基线靶病灶直径总和无法计算。' });
  }

  const visits = sortVisits(patient);
  const seenDates = new Map();
  for (const visit of visits) {
    if (!visit.date) issues.push({ level: 'error', message: `随访“${visit.label}”缺少日期。` });
    if (visit.date && patient.baselineDate) {
      const interval = daysBetween(patient.baselineDate, visit.date);
      if (interval != null && interval < 0) issues.push({ level: 'error', message: `随访“${visit.label}”早于基线日期。` });
    }
    if (visit.date) {
      if (seenDates.has(visit.date)) issues.push({ level: 'warning', message: `日期 ${visit.date} 存在多个随访，请确认顺序。` });
      seenDates.set(visit.date, true);
    }
    if (targets.length && targetSumAtVisit(patient, visit) == null) {
      issues.push({ level: 'warning', message: `随访“${visit.label}”的靶病灶测量不完整。` });
    }
  }

  const newTargets = (patient.newLesions || []).filter((lesion) => lesion.kind === 'target' && lesion.definite !== false);
  if (newTargets.length > 5) issues.push({ level: 'error', message: '确定的新发靶病灶超过 5 个。' });
  const newByOrgan = new Map();
  for (const lesion of newTargets) {
    const organ = lesion.organ?.trim() || '未填写器官';
    newByOrgan.set(organ, (newByOrgan.get(organ) || 0) + 1);
  }
  for (const [organ, count] of newByOrgan.entries()) {
    if (count > 2) issues.push({ level: 'error', message: `器官“${organ}”登记了 ${count} 个新发靶病灶，超过每器官 2 个。` });
  }

  return issues;
}
