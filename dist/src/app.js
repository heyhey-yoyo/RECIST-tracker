import {
  RESPONSE_LABELS,
  NON_TARGET_STATUS_LABELS,
  NEW_NON_TARGET_STATUS_LABELS,
  createId,
  createPatient,
  createVisit,
  nowIso,
  clone
} from './domain/model.js';
import { evaluateRecistSequence, bestRecistTimepoint, baselineTargetSum, sortVisits } from './domain/recist.js';
import { evaluateIrecistSequence, bestIrecistTimepoint } from './domain/irecist.js';
import { validatePatient } from './domain/validation.js';
import {
  loadState,
  saveState,
  clearState,
  appendAudit,
  exportBackup,
  importBackup,
  getLastLoadWarning,
  serializedStateSize
} from './storage.js';
import { createDemoState } from './demo.js';
import {
  escapeHtml,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  responseClass
} from './utils/format.js';

const app = document.querySelector('#app');
let state = loadState();
let lastPersistedState = clone(state);
let ui = { modal: null, toast: null, storageWarning: getLastLoadWarning() || null };
let toastTimer = null;

function persist() {
  try {
    const result = saveState(state);
    lastPersistedState = clone(state);
    ui.storageWarning = result.nearCapacity
      ? '本地数据已接近常见浏览器存储上限，请立即导出备份并减少审计快照。'
      : null;
    return true;
  } catch (error) {
    state = clone(lastPersistedState);
    ui.modal = null;
    alert(`${error.message}\n本次未保存的改动已回滚到上一次成功保存的状态。`);
    render();
    return false;
  }
}

function showToast(message) {
  ui.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast = null;
    render();
  }, 2600);
}

function getRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length) return { page: 'patients' };
  if (parts[0] === 'patient') return { page: 'patient', patientId: parts[1], tab: parts[2] || 'overview' };
  return { page: parts[0] };
}

function setRoute(hash) {
  location.hash = hash;
}

function currentPatient() {
  const route = getRoute();
  return state.patients.find((patient) => patient.id === route.patientId) || null;
}

function touchPatient(patient) {
  patient.updatedAt = nowIso();
}

function responseLabel(code) {
  return RESPONSE_LABELS[code] || code || '尚无评价';
}

function responseChip(code) {
  return `<span class="response-chip ${responseClass(code)}">${escapeHtml(responseLabel(code))}</span>`;
}

function option(value, label, selectedValue) {
  return `<option value="${escapeHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function renderIssueList(issues) {
  if (!issues.length) return '<div class="issue issue-info">✓ 数据结构检查未发现明显问题。</div>';
  return `<div class="issue-list">${issues.map((issue) => `
    <div class="issue issue-${issue.level === 'error' ? 'error' : 'warning'}">
      <span>${issue.level === 'error' ? '!' : '△'}</span><span>${escapeHtml(issue.message)}</span>
    </div>`).join('')}</div>`;
}

function primaryNav(active) {
  const links = [
    ['patients', '#/patients', '受试者'],
    ['settings', '#/settings', '研究设置'],
    ['backup', '#/backup', '数据备份']
  ];
  return `<div class="tool-nav-wrap">
    <div class="tool-nav-inner">
      <nav class="tool-nav" aria-label="主导航">${links.map(([key, href, label]) => `
        <a class="tool-nav-link ${active === key ? 'active' : ''}" href="${href}" ${active === key ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
      <div class="workspace-context" title="${escapeHtml(state.settings.studyName || 'RECIST Tracker')} · ${escapeHtml(state.settings.protocol || '未设置方案编号')}">
        <span class="workspace-name">${escapeHtml(state.settings.studyName || 'RECIST Tracker')}</span>
        <span class="workspace-separator" aria-hidden="true">·</span>
        <span>${escapeHtml(state.settings.protocol || '未设置方案编号')}</span>
      </div>
    </div>
  </div>`;
}

function shell(content, active) {
  const storageWarning = ui.storageWarning
    ? `<div class="issue issue-warning" role="alert"><span>⚠</span><span>${escapeHtml(ui.storageWarning)}</span></div>`
    : '';
  return `<div class="app-shell">
    <header class="site-header">
      <div class="site-header-inner">
        <div class="yd-brand" aria-label="YDchenTools">
          <span class="yd-brand-name">YDchen</span><span class="yd-brand-tools">Tools</span>
        </div>
        <div class="site-header-divider" aria-hidden="true"></div>
        <div class="tool-heading">
          <h1>RECIST Response Tracker</h1>
          <p>RECIST 1.1 · iRECIST · 疗效评估</p>
        </div>
      </div>
    </header>
    ${primaryNav(active)}
    <main class="main">
      <div class="content">${storageWarning}${content}</div>
    </main>
  </div>`;
}

function getPatientResultSummary(patient) {
  if (!patient.visits.length) return { code: null, label: '尚无随访', date: null };
  if (patient.mode === 'IRECIST') {
    const results = evaluateIrecistSequence(patient);
    const last = results.at(-1);
    return { code: last?.irecist.code, label: responseLabel(last?.irecist.code), date: last?.visit.date };
  }
  const results = evaluateRecistSequence(patient);
  const last = results.at(-1);
  return { code: last?.overall.code, label: responseLabel(last?.overall.code), date: last?.visit.date };
}

function renderPatientsPage() {
  const patientCards = state.patients.map((patient) => {
    const summary = getPatientResultSummary(patient);
    return `<article class="card patient-card">
      <div>
        <div class="actions"><span class="patient-code">${escapeHtml(patient.code)}</span><span class="badge badge-primary">${patient.mode === 'IRECIST' ? 'iRECIST' : 'RECIST 1.1'}</span></div>
        <div class="patient-meta">
          <span>诊断：${escapeHtml(patient.diagnosis || '未填写')}</span>
          <span>基线：${escapeHtml(formatDate(patient.baselineDate))}</span>
          <span>随访：${patient.visits.length} 次</span>
          <span>靶病灶：${patient.targetLesions.length} 个</span>
        </div>
      </div>
      <div class="patient-result">
        ${summary.code ? responseChip(summary.code) : '<span class="badge">尚无评价</span>'}
        <div class="actions">
          <button class="btn btn-secondary btn-small" data-action="open-patient" data-id="${escapeHtml(patient.id)}">打开</button>
          <button class="btn btn-ghost btn-small" data-action="edit-patient" data-id="${escapeHtml(patient.id)}">编辑</button>
          <button class="btn btn-ghost btn-small" data-action="delete-patient" data-id="${escapeHtml(patient.id)}">删除</button>
        </div>
      </div>
    </article>`;
  }).join('');

  const content = `<div class="page-header">
    <div><h1 class="page-title">受试者</h1><p class="page-desc">录入基线病灶和连续影像随访，系统同步计算 RECIST 1.1 与 iRECIST 时间点评价并保留修改记录。</p></div>
    <div class="actions"><button class="btn btn-primary" data-action="new-patient">＋ 新建受试者</button></div>
  </div>
  <div class="grid grid-3" style="margin-bottom:16px">
    <div class="card stat-card"><div class="stat-label">受试者</div><div class="stat-value">${state.patients.length}</div><div class="stat-note">当前浏览器中的病例</div></div>
    <div class="card stat-card"><div class="stat-label">已录随访</div><div class="stat-value">${state.patients.reduce((sum, p) => sum + p.visits.length, 0)}</div><div class="stat-note">所有受试者合计</div></div>
    <div class="card stat-card"><div class="stat-label">数据位置</div><div class="stat-value" style="font-size:18px">本地浏览器</div><div class="stat-note">明文保存在此站点的浏览器存储中</div></div>
  </div>
  ${state.patients.length ? `<div class="patient-list">${patientCards}</div>` : `<div class="card empty">
    <div class="empty-title">还没有受试者</div><p>先创建一个受试者并录入基线病灶。也可以载入内置演示病例查看完整流程。</p>
    <div class="actions" style="justify-content:center"><button class="btn btn-primary" data-action="new-patient">新建受试者</button><button class="btn btn-secondary" data-action="load-demo">载入演示数据</button></div>
  </div>`}`;
  return shell(content, 'patients', state.settings.studyName);
}

function renderSettingsPage() {
  const s = state.settings;
  const content = `<div class="page-header"><div><h1 class="page-title">研究设置</h1><p class="page-desc">设置研究名称、方案编号和默认评估模式。评估者姓名会写入后续审计记录。</p></div></div>
  <form class="card" data-form="settings-form">
    <div class="card-body form-grid">
      <div class="field"><label for="studyName">研究名称</label><input class="input" id="studyName" name="studyName" value="${escapeHtml(s.studyName)}" required></div>
      <div class="field"><label for="protocol">方案编号</label><input class="input" id="protocol" name="protocol" value="${escapeHtml(s.protocol)}"></div>
      <div class="field"><label for="assessor">当前评估者</label><input class="input" id="assessor" name="assessor" value="${escapeHtml(s.assessor)}" placeholder="例如：张医生"></div>
      <div class="field"><label for="defaultMode">新受试者默认模式</label><select id="defaultMode" name="defaultMode">${option('IRECIST','iRECIST',s.defaultMode)}${option('RECIST11','RECIST 1.1',s.defaultMode)}</select></div>
    </div>
    <div class="modal-footer"><button class="btn btn-primary" type="submit">保存设置</button></div>
  </form>`;
  return shell(content, 'settings', '研究设置');
}

function renderBackupPage() {
  const bytes = serializedStateSize(state);
  const sizeLabel = bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  const content = `<div class="page-header"><div><h1 class="page-title">数据备份</h1><p class="page-desc">应用不使用服务器数据库。浏览器数据可能因清理网站数据、无痕模式或设备损坏而丢失，请定期保存 JSON 备份。</p></div></div>
  <div class="issue issue-warning" role="note"><span>⚠</span><span>病例、备注、测量和审计快照会以明文保存在此浏览器的 localStorage 中。请只使用编码后的受试者编号，不要录入姓名、证件号、联系方式等直接身份信息。当前序列化数据约 ${escapeHtml(sizeLabel)}。</span></div>
  <div class="grid grid-2">
    <section class="card"><div class="card-header"><div><h2 class="card-title">导出完整备份</h2><p class="card-subtitle">包含研究设置、受试者、病灶、随访和审计记录。</p></div></div><div class="card-body"><button class="btn btn-primary" data-action="export-backup">下载 JSON 备份</button></div></section>
    <section class="card"><div class="card-header"><div><h2 class="card-title">恢复备份</h2><p class="card-subtitle">导入会替换当前浏览器中的全部数据。</p></div></div><div class="card-body"><label class="btn btn-secondary" for="backup-file">选择 JSON 文件</label><input id="backup-file" data-action="import-backup" type="file" accept="application/json,.json" hidden></div></section>
  </div>
  <section class="card danger-zone" style="margin-top:16px"><div class="card-header"><h2 class="card-title">危险操作</h2></div><div class="card-body actions"><button class="btn btn-secondary" data-action="load-demo">载入演示数据</button><button class="btn btn-danger" data-action="reset-all">清空全部本地数据</button></div></section>`;
  return shell(content, 'backup', '数据备份');
}

function patientTabs(patient, active) {
  const tabs = [['overview','概览'],['lesions','病灶'],['visits','随访录入'],['audit','审计记录']];
  return `<div class="tabs">${tabs.map(([key,label]) => `<button class="tab ${active === key ? 'active' : ''}" data-action="patient-tab" data-patient-id="${escapeHtml(patient.id)}" data-tab="${key}">${label}</button>`).join('')}</div>`;
}

function patientHeader(patient) {
  const summary = getPatientResultSummary(patient);
  return `<div class="page-header">
    <div><div class="actions"><button class="btn btn-ghost btn-small" data-action="back-patients">← 返回</button><span class="badge badge-primary">${patient.mode === 'IRECIST' ? 'iRECIST' : 'RECIST 1.1'}</span></div>
      <h1 class="page-title" style="margin-top:10px">${escapeHtml(patient.code)}</h1>
      <p class="page-desc">${escapeHtml(patient.diagnosis || '未填写诊断')} · 基线 ${escapeHtml(formatDate(patient.baselineDate))}${patient.treatment ? ` · ${escapeHtml(patient.treatment)}` : ''}</p>
    </div>
    <div class="actions">${summary.code ? responseChip(summary.code) : ''}<button class="btn btn-secondary" data-action="edit-patient" data-id="${escapeHtml(patient.id)}">编辑资料</button></div>
  </div>`;
}

function renderOverview(patient) {
  const recist = evaluateRecistSequence(patient);
  const irecist = patient.mode === 'IRECIST' ? evaluateIrecistSequence(patient) : [];
  const activeResults = patient.mode === 'IRECIST' ? irecist : recist;
  const best = patient.mode === 'IRECIST' ? bestIrecistTimepoint(irecist) : bestRecistTimepoint(recist);
  const last = activeResults.at(-1);
  const issues = validatePatient(patient);
  const baselineSum = baselineTargetSum(patient);

  const timeline = activeResults.map((result) => {
    const mainCode = patient.mode === 'IRECIST' ? result.irecist.code : result.overall.code;
    const mainReason = patient.mode === 'IRECIST' ? result.irecist.reason : result.overall.reason;
    const warnings = patient.mode === 'IRECIST' ? result.irecist.warnings : [];
    return `<article class="card timeline-item">
      <div class="timeline-head"><div><div class="timeline-title">${escapeHtml(result.visit.label)}</div><div class="timeline-date">${escapeHtml(formatDate(result.visit.date))}${result.intervalFromBaselineDays != null ? ` · 基线后 ${result.intervalFromBaselineDays} 天` : ''}</div></div>
      <div class="actions">${responseChip(mainCode)}${patient.mode === 'IRECIST' ? `<span class="badge">RECIST ${escapeHtml(result.overall.code)}</span>` : ''}</div></div>
      <div class="timeline-metrics">
        <div class="metric"><div class="metric-label">靶病灶总和</div><div class="metric-value">${formatNumber(result.target.currentSum)} mm</div></div>
        <div class="metric"><div class="metric-label">较基线变化</div><div class="metric-value">${formatPercent(result.target.baselineChangePct)}</div></div>
        <div class="metric"><div class="metric-label">较最低值变化</div><div class="metric-value">${formatPercent(result.target.nadirChangePct)}</div></div>
        <div class="metric"><div class="metric-label">新发病灶</div><div class="metric-value">${result.newlyDetected.length} 个</div></div>
      </div>
      <div class="reason">${escapeHtml(mainReason)}</div>
      ${warnings?.length ? `<div class="issue-list" style="margin-top:10px">${warnings.map((warning) => `<div class="issue issue-warning">${escapeHtml(warning)}</div>`).join('')}</div>` : ''}
    </article>`;
  }).join('');

  return `<div class="grid grid-4" style="margin-bottom:16px">
    <div class="card stat-card"><div class="stat-label">基线靶病灶总和</div><div class="stat-value">${formatNumber(baselineSum)} <small>mm</small></div></div>
    <div class="card stat-card"><div class="stat-label">随访次数</div><div class="stat-value">${patient.visits.length}</div></div>
    <div class="card stat-card"><div class="stat-label">当前评价</div><div class="stat-value" style="font-size:16px">${last ? responseLabel(patient.mode === 'IRECIST' ? last.irecist.code : last.overall.code) : '尚无'}</div></div>
    <div class="card stat-card"><div class="stat-label">最佳时间点评价</div><div class="stat-value" style="font-size:16px">${best ? responseLabel(patient.mode === 'IRECIST' ? best.irecist.code : best.overall.code) : '尚无'}</div></div>
  </div>
  <section class="card" style="margin-bottom:16px"><div class="card-header"><div><h2 class="card-title">数据检查</h2><p class="card-subtitle">错误项应优先修正；警告项可能需要方案或影像专业判断。</p></div></div><div class="card-body">${renderIssueList(issues)}</div></section>
  ${timeline ? `<div class="timeline">${timeline}</div>` : `<div class="card empty"><div class="empty-title">尚无随访评价</div><p>先录入基线病灶，再新增第一次随访。</p><button class="btn btn-primary" data-action="add-visit" data-patient-id="${escapeHtml(patient.id)}">新增随访</button></div>`}`;
}

function renderLesions(patient) {
  const targets = patient.targetLesions.map((lesion) => `<div class="lesion-row"><div><div class="lesion-name">${escapeHtml(lesion.label)}</div><div class="lesion-meta">${escapeHtml(lesion.organ || '未填写器官')} · ${lesion.isLymphNode ? '淋巴结短径' : '最长径'} · 基线 ${formatNumber(Number(lesion.baselineMm))} mm${lesion.location ? ` · ${escapeHtml(lesion.location)}` : ''}</div></div><div class="actions"><button class="btn btn-ghost btn-small" data-action="edit-target" data-patient-id="${escapeHtml(patient.id)}" data-id="${escapeHtml(lesion.id)}">编辑</button><button class="btn btn-ghost btn-small" data-action="delete-target" data-patient-id="${escapeHtml(patient.id)}" data-id="${escapeHtml(lesion.id)}">删除</button></div></div>`).join('');
  const nonTargets = patient.nonTargetLesions.map((lesion) => `<div class="lesion-row"><div><div class="lesion-name">${escapeHtml(lesion.label)}</div><div class="lesion-meta">${escapeHtml(lesion.organ || '未填写器官')}${lesion.location ? ` · ${escapeHtml(lesion.location)}` : ''}</div></div><div class="actions"><button class="btn btn-ghost btn-small" data-action="edit-nontarget" data-patient-id="${escapeHtml(patient.id)}" data-id="${escapeHtml(lesion.id)}">编辑</button><button class="btn btn-ghost btn-small" data-action="delete-nontarget" data-patient-id="${escapeHtml(patient.id)}" data-id="${escapeHtml(lesion.id)}">删除</button></div></div>`).join('');
  const visits = sortVisits(patient);
  const visitMap = new Map(visits.map((visit) => [visit.id, visit]));
  const newLesions = patient.newLesions.map((lesion) => `<div class="lesion-row"><div><div class="lesion-name">${escapeHtml(lesion.label)} ${lesion.definite === false ? '<span class="badge badge-warning">待确认</span>' : ''}</div><div class="lesion-meta">${lesion.kind === 'target' ? '新发靶病灶' : '新发非靶病灶'} · ${escapeHtml(lesion.organ || '未填写器官')} · 首见于 ${escapeHtml(visitMap.get(lesion.firstDetectedVisitId)?.label || '未知随访')}</div></div><div class="actions"><button class="btn btn-ghost btn-small" data-action="edit-newlesion" data-patient-id="${escapeHtml(patient.id)}" data-id="${escapeHtml(lesion.id)}">编辑</button><button class="btn btn-ghost btn-small" data-action="delete-newlesion" data-patient-id="${escapeHtml(patient.id)}" data-id="${escapeHtml(lesion.id)}">删除</button></div></div>`).join('');

  return `<div class="grid grid-2">
    <section class="card"><div class="card-header"><div><h2 class="card-title">基线靶病灶</h2><p class="card-subtitle">最多 5 个，每器官最多 2 个。</p></div><button class="btn btn-primary btn-small" data-action="add-target" data-patient-id="${escapeHtml(patient.id)}">＋ 添加</button></div><div class="card-body"><div class="lesion-list">${targets || '<div class="empty">尚未录入靶病灶</div>'}</div></div></section>
    <section class="card"><div class="card-header"><div><h2 class="card-title">基线非靶病灶</h2><p class="card-subtitle">每次随访记录消失、存在或明确进展。</p></div><button class="btn btn-primary btn-small" data-action="add-nontarget" data-patient-id="${escapeHtml(patient.id)}">＋ 添加</button></div><div class="card-body"><div class="lesion-list">${nonTargets || '<div class="empty">尚未录入非靶病灶</div>'}</div></div></section>
  </div>
  <section class="card" style="margin-top:16px"><div class="card-header"><div><h2 class="card-title">随访中新发病灶</h2><p class="card-subtitle">新发靶病灶单独求和，不并入基线靶病灶总和。</p></div></div><div class="card-body"><div class="lesion-list">${newLesions || '<div class="empty">尚未记录新发病灶。请在对应随访中添加。</div>'}</div></div></section>`;
}

function renderVisits(patient) {
  const results = patient.mode === 'IRECIST' ? evaluateIrecistSequence(patient) : evaluateRecistSequence(patient);
  const cards = results.map((result) => {
    const code = patient.mode === 'IRECIST' ? result.irecist.code : result.overall.code;
    const newCount = patient.newLesions.filter((lesion) => lesion.firstDetectedVisitId === result.visit.id).length;
    return `<article class="card patient-card"><div><div class="actions"><span class="patient-code" style="font-size:16px">${escapeHtml(result.visit.label)}</span>${responseChip(code)}</div><div class="patient-meta"><span>${escapeHtml(formatDate(result.visit.date))}</span><span>靶病灶总和 ${formatNumber(result.target.currentSum)} mm</span><span>新发病灶 ${newCount} 个</span><span>${result.visit.clinicalStable ? '临床稳定' : '临床不稳定'}</span></div></div><div class="patient-result"><div class="actions"><button class="btn btn-primary btn-small" data-action="add-newlesion" data-patient-id="${escapeHtml(patient.id)}" data-visit-id="${escapeHtml(result.visit.id)}">＋ 新发病灶</button><button class="btn btn-secondary btn-small" data-action="edit-visit" data-patient-id="${escapeHtml(patient.id)}" data-id="${escapeHtml(result.visit.id)}">编辑随访</button><button class="btn btn-ghost btn-small" data-action="delete-visit" data-patient-id="${escapeHtml(patient.id)}" data-id="${escapeHtml(result.visit.id)}">删除</button></div></div></article>`;
  }).join('');
  return `<div class="page-header" style="margin-bottom:14px"><div><h2 class="card-title">随访记录</h2><p class="card-subtitle">建议按影像实际日期录入。iUPD 后的下一次可评价随访用于确认或重置。</p></div><button class="btn btn-primary" data-action="add-visit" data-patient-id="${escapeHtml(patient.id)}">＋ 新增随访</button></div>${cards ? `<div class="patient-list">${cards}</div>` : '<div class="card empty"><div class="empty-title">还没有随访</div><p>新增随访后可录入每个病灶的测量和状态。</p></div>'}`;
}

function renderAudit(patient) {
  const entries = state.audit.filter((entry) => entry.patientId === patient.id || (entry.entityType === 'patient' && entry.entityId === patient.id));
  const rows = entries.map((entry) => `<div class="audit-row"><div class="audit-time">${escapeHtml(formatDateTime(entry.timestamp))}</div><div><div class="audit-summary">${escapeHtml(entry.summary)}</div><div class="audit-actor">${escapeHtml(entry.actor)} · ${escapeHtml(entry.action)}</div></div><button class="btn btn-secondary btn-small" data-action="audit-detail" data-id="${escapeHtml(entry.id)}">详情</button></div>`).join('');
  return rows ? `<div class="audit-list">${rows}</div>` : '<div class="card empty"><div class="empty-title">暂无审计记录</div></div>';
}

function renderPatientPage(route) {
  const patient = state.patients.find((item) => item.id === route.patientId);
  if (!patient) return shell('<div class="card empty"><div class="empty-title">受试者不存在</div><button class="btn btn-primary" data-action="back-patients">返回列表</button></div>', 'patients', '受试者');
  const tabContent = route.tab === 'lesions' ? renderLesions(patient) : route.tab === 'visits' ? renderVisits(patient) : route.tab === 'audit' ? renderAudit(patient) : renderOverview(patient);
  return shell(`${patientHeader(patient)}${patientTabs(patient, route.tab)}${tabContent}`, 'patients', patient.code);
}

function renderPatientModal(modal) {
  const patient = modal.patientId ? state.patients.find((item) => item.id === modal.patientId) : null;
  const value = patient || { code: '', mode: state.settings.defaultMode, diagnosis: '', treatment: '', baselineDate: '', notes: '' };
  return modalFrame(patient ? '编辑受试者' : '新建受试者', `<form data-form="patient-form">
    <input type="hidden" name="patientId" value="${escapeHtml(patient?.id || '')}">
    <div class="form-grid">
      <div class="field"><label>受试者编号 *</label><input class="input" name="code" value="${escapeHtml(value.code)}" required maxlength="80"></div>
      <div class="field"><label>评估模式</label><select name="mode">${option('IRECIST','iRECIST',value.mode)}${option('RECIST11','RECIST 1.1',value.mode)}</select></div>
      <div class="field"><label>基线日期</label><input class="input" name="baselineDate" type="date" value="${escapeHtml(value.baselineDate)}"></div>
      <div class="field"><label>诊断</label><input class="input" name="diagnosis" value="${escapeHtml(value.diagnosis)}"></div>
      <div class="field field-full"><label>治疗方案</label><input class="input" name="treatment" value="${escapeHtml(value.treatment)}"></div>
      <div class="field field-full"><label>备注</label><textarea name="notes">${escapeHtml(value.notes)}</textarea></div>
    </div>
    ${modalFooter('保存受试者')}
  </form>`);
}

function renderTargetModal(modal) {
  const patient = state.patients.find((item) => item.id === modal.patientId);
  const lesion = patient?.targetLesions.find((item) => item.id === modal.lesionId);
  const value = lesion || { label: '', organ: '', location: '', isLymphNode: false, baselineMm: '' };
  return modalFrame(lesion ? '编辑基线靶病灶' : '添加基线靶病灶', `<form data-form="target-form">
    <input type="hidden" name="patientId" value="${escapeHtml(patient.id)}"><input type="hidden" name="lesionId" value="${escapeHtml(lesion?.id || '')}">
    <div class="form-grid">
      <div class="field"><label>病灶名称 *</label><input class="input" name="label" value="${escapeHtml(value.label)}" required></div>
      <div class="field"><label>器官 *</label><input class="input" name="organ" value="${escapeHtml(value.organ)}" required placeholder="例如：肝、肺、淋巴结"></div>
      <div class="field"><label>具体位置</label><input class="input" name="location" value="${escapeHtml(value.location)}"></div>
      <div class="field"><label>基线测量（mm）*</label><input class="input" type="number" min="0" step="0.1" name="baselineMm" value="${escapeHtml(value.baselineMm)}" required></div>
      <div class="field field-full"><label class="checkbox"><input type="checkbox" name="isLymphNode" ${value.isLymphNode ? 'checked' : ''}>这是淋巴结病灶，记录短径</label><div class="help">通常非淋巴结靶病灶基线长径应 ≥10 mm；淋巴结短径应 ≥15 mm。</div></div>
    </div>${modalFooter('保存病灶')}</form>`);
}

function renderNonTargetModal(modal) {
  const patient = state.patients.find((item) => item.id === modal.patientId);
  const lesion = patient?.nonTargetLesions.find((item) => item.id === modal.lesionId);
  const value = lesion || { label: '', organ: '', location: '' };
  return modalFrame(lesion ? '编辑非靶病灶' : '添加非靶病灶', `<form data-form="nontarget-form">
    <input type="hidden" name="patientId" value="${escapeHtml(patient.id)}"><input type="hidden" name="lesionId" value="${escapeHtml(lesion?.id || '')}">
    <div class="form-grid"><div class="field"><label>病灶名称 *</label><input class="input" name="label" value="${escapeHtml(value.label)}" required></div><div class="field"><label>器官 *</label><input class="input" name="organ" value="${escapeHtml(value.organ)}" required></div><div class="field field-full"><label>具体位置</label><input class="input" name="location" value="${escapeHtml(value.location)}"></div></div>${modalFooter('保存病灶')}</form>`);
}

function renderVisitModal(modal) {
  const patient = state.patients.find((item) => item.id === modal.patientId);
  const visit = patient?.visits.find((item) => item.id === modal.visitId);
  const value = visit || createVisit({ label: `第 ${patient.visits.length + 1} 次随访`, date: '' });
  const targetRows = patient.targetLesions.map((lesion) => `<div class="measurement-row"><div><div class="lesion-name">${escapeHtml(lesion.label)}</div><div class="lesion-meta">基线 ${formatNumber(Number(lesion.baselineMm))} mm · ${lesion.isLymphNode ? '短径' : '最长径'}</div></div><input class="input" name="target__${escapeHtml(lesion.id)}" type="number" min="0" step="0.1" value="${escapeHtml(value.targetMeasurements?.[lesion.id] ?? '')}" placeholder="mm"></div>`).join('');
  const ntRows = patient.nonTargetLesions.map((lesion) => `<div class="measurement-row"><div><div class="lesion-name">${escapeHtml(lesion.label)}</div><div class="lesion-meta">${escapeHtml(lesion.organ)}</div></div><select name="nt__${escapeHtml(lesion.id)}"><option value="">请选择</option>${Object.entries(NON_TARGET_STATUS_LABELS).map(([key,label]) => option(key,label,value.nonTargetStatuses?.[lesion.id])).join('')}</select></div>`).join('');
  const orderedVisits = sortVisits(patient);
  const currentVisitIndex = visit ? orderedVisits.findIndex((item) => item.id === visit.id) : Number.POSITIVE_INFINITY;
  const visitIndexes = new Map(orderedVisits.map((item, index) => [item.id, index]));
  const trackableNewLesions = patient.newLesions.filter((lesion) => {
    const detectedIndex = visitIndexes.get(lesion.firstDetectedVisitId);
    return !visit || (Number.isInteger(detectedIndex) && detectedIndex <= currentVisitIndex);
  });
  const newTargetRows = trackableNewLesions.filter((lesion) => lesion.kind === 'target').map((lesion) => `<div class="measurement-row"><div><div class="lesion-name">${escapeHtml(lesion.label)} ${lesion.definite === false ? '<span class="badge badge-warning">待确认</span>' : ''}</div><div class="lesion-meta">新发靶病灶 · ${escapeHtml(lesion.organ)}</div></div><input class="input" name="newtarget__${escapeHtml(lesion.id)}" type="number" min="0" step="0.1" value="${escapeHtml(value.newTargetMeasurements?.[lesion.id] ?? '')}" placeholder="mm"></div>`).join('');
  const newNtRows = trackableNewLesions.filter((lesion) => lesion.kind === 'nonTarget').map((lesion) => `<div class="measurement-row"><div><div class="lesion-name">${escapeHtml(lesion.label)} ${lesion.definite === false ? '<span class="badge badge-warning">待确认</span>' : ''}</div><div class="lesion-meta">新发非靶病灶 · ${escapeHtml(lesion.organ)}</div></div><select name="newnt__${escapeHtml(lesion.id)}"><option value="">请选择</option>${Object.entries(NEW_NON_TARGET_STATUS_LABELS).map(([key,label]) => option(key,label,value.newNonTargetStatuses?.[lesion.id])).join('')}</select></div>`).join('');
  return modalFrame(visit ? '编辑随访' : '新增随访', `<form data-form="visit-form">
    <input type="hidden" name="patientId" value="${escapeHtml(patient.id)}"><input type="hidden" name="visitId" value="${escapeHtml(visit?.id || '')}">
    <div class="form-grid"><div class="field"><label>随访名称 *</label><input class="input" name="label" value="${escapeHtml(value.label)}" required></div><div class="field"><label>影像日期 *</label><input class="input" name="date" type="date" value="${escapeHtml(value.date)}" required></div><div class="field field-full"><label class="checkbox"><input type="checkbox" name="clinicalStable" ${value.clinicalStable !== false ? 'checked' : ''}>患者临床稳定</label><div class="help">该项不改变影像时间点评价，但会影响 iUPD 后继续治疗的提示。</div></div></div>
    <div class="section-label">原靶病灶测量</div><div class="measurement-grid">${targetRows || '<div class="issue issue-warning">尚未录入基线靶病灶。</div>'}</div>
    ${patient.nonTargetLesions.length ? `<div class="section-label">原非靶病灶</div><div class="measurement-grid">${ntRows}</div>` : ''}
    ${newTargetRows ? `<div class="section-label">既往新发靶病灶</div><div class="measurement-grid">${newTargetRows}</div>` : ''}
    ${newNtRows ? `<div class="section-label">既往新发非靶病灶</div><div class="measurement-grid">${newNtRows}</div>` : ''}
    <div class="field" style="margin-top:16px"><label>备注</label><textarea name="notes">${escapeHtml(value.notes)}</textarea></div>
    ${modalFooter('保存随访')}
  </form>`);
}

function renderNewLesionModal(modal) {
  const patient = state.patients.find((item) => item.id === modal.patientId);
  const lesion = patient?.newLesions.find((item) => item.id === modal.lesionId);
  const value = lesion || { label: '', organ: '', location: '', kind: 'target', isLymphNode: false, definite: true, firstDetectedVisitId: modal.visitId };
  const visits = sortVisits(patient);
  return modalFrame(lesion ? '编辑新发病灶' : '添加新发病灶', `<form data-form="newlesion-form">
    <input type="hidden" name="patientId" value="${escapeHtml(patient.id)}"><input type="hidden" name="lesionId" value="${escapeHtml(lesion?.id || '')}">
    <div class="form-grid">
      <div class="field"><label>病灶名称 *</label><input class="input" name="label" value="${escapeHtml(value.label)}" required></div>
      <div class="field"><label>器官 *</label><input class="input" name="organ" value="${escapeHtml(value.organ)}" required></div>
      <div class="field"><label>具体位置</label><input class="input" name="location" value="${escapeHtml(value.location)}"></div>
      <div class="field"><label>首次发现随访 *</label><select name="firstDetectedVisitId" required>${visits.map((visit) => option(visit.id, `${visit.label} · ${formatDate(visit.date)}`, value.firstDetectedVisitId)).join('')}</select></div>
      <div class="field"><label>分类</label><select name="kind">${option('target','新发靶病灶（定量测量）',value.kind)}${option('nonTarget','新发非靶病灶（定性评价）',value.kind)}</select></div>
      <div class="field"><label>首次测量 / 状态</label><input class="input" name="initialMeasurement" type="number" min="0" step="0.1" value="${lesion?.kind === 'target' ? escapeHtml(patient.visits.find((visit) => visit.id === value.firstDetectedVisitId)?.newTargetMeasurements?.[lesion.id] ?? '') : ''}" placeholder="靶病灶填写 mm；非靶病灶留空"></div>
      <div class="field field-full"><label class="checkbox"><input type="checkbox" name="isLymphNode" ${value.isLymphNode ? 'checked' : ''}>这是淋巴结病灶，测量短径</label></div>
      <div class="field field-full"><label class="checkbox"><input type="checkbox" name="definite" ${value.definite !== false ? 'checked' : ''}>确定为新发恶性病灶</label><div class="help">未勾选时仅作为待确认病灶记录，不自动触发 PD / iUPD。</div></div>
    </div>${modalFooter('保存新发病灶')}</form>`);
}

function modalFrame(title, body, small = false) {
  return `<div class="modal-backdrop" data-action="close-modal-backdrop"><div class="modal ${small ? 'modal-small' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><div class="modal-header"><h2 class="modal-title">${escapeHtml(title)}</h2><button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭">×</button></div><div class="modal-body">${body}</div></div></div>`;
}

function modalFooter(label) {
  return `<div class="modal-footer"><button class="btn btn-secondary" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${escapeHtml(label)}</button></div>`;
}

function renderAuditModal(modal) {
  const entry = state.audit.find((item) => item.id === modal.auditId);
  if (!entry) return '';
  return modalFrame('审计详情', `<dl class="info-list"><dt>时间</dt><dd>${escapeHtml(formatDateTime(entry.timestamp))}</dd><dt>操作者</dt><dd>${escapeHtml(entry.actor)}</dd><dt>操作</dt><dd>${escapeHtml(entry.action)}</dd><dt>摘要</dt><dd>${escapeHtml(entry.summary)}</dd></dl><div class="section-label">修改前</div><div class="code-block">${escapeHtml(entry.before == null ? '无' : JSON.stringify(entry.before, null, 2))}</div><div class="section-label">修改后</div><div class="code-block">${escapeHtml(entry.after == null ? '无' : JSON.stringify(entry.after, null, 2))}</div>`, true);
}

function renderModal() {
  if (!ui.modal) return '';
  if (ui.modal.type === 'patient') return renderPatientModal(ui.modal);
  if (ui.modal.type === 'target') return renderTargetModal(ui.modal);
  if (ui.modal.type === 'nontarget') return renderNonTargetModal(ui.modal);
  if (ui.modal.type === 'visit') return renderVisitModal(ui.modal);
  if (ui.modal.type === 'newlesion') return renderNewLesionModal(ui.modal);
  if (ui.modal.type === 'audit') return renderAuditModal(ui.modal);
  return '';
}

function render() {
  const route = getRoute();
  let page;
  if (route.page === 'settings') page = renderSettingsPage();
  else if (route.page === 'backup') page = renderBackupPage();
  else if (route.page === 'patient') page = renderPatientPage(route);
  else page = renderPatientsPage();
  app.innerHTML = `${page}${renderModal()}${ui.toast ? `<div class="toast">${escapeHtml(ui.toast)}</div>` : ''}`;
}

function openModal(modal) {
  ui.modal = modal;
  render();
  setTimeout(() => app.querySelector('.modal input:not([type="hidden"]), .modal select, .modal textarea')?.focus(), 0);
}

function closeModal() {
  ui.modal = null;
  render();
}

function logChange(config) {
  appendAudit(state, config);
  return persist();
}

function removeMeasurementReferences(patient, lesionId, kind) {
  for (const visit of patient.visits) {
    if (kind === 'target') delete visit.targetMeasurements[lesionId];
    if (kind === 'nonTarget') delete visit.nonTargetStatuses[lesionId];
    if (kind === 'newTarget') delete visit.newTargetMeasurements[lesionId];
    if (kind === 'newNonTarget') delete visit.newNonTargetStatuses[lesionId];
  }
}

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'close-modal') return closeModal();
  if (action === 'close-modal-backdrop' && event.target === target) return closeModal();
  if (action === 'new-patient') return openModal({ type: 'patient' });
  if (action === 'edit-patient') return openModal({ type: 'patient', patientId: target.dataset.id });
  if (action === 'open-patient') return setRoute(`#/patient/${target.dataset.id}/overview`);
  if (action === 'back-patients') return setRoute('#/patients');
  if (action === 'patient-tab') return setRoute(`#/patient/${target.dataset.patientId}/${target.dataset.tab}`);
  if (action === 'add-target') return openModal({ type: 'target', patientId: target.dataset.patientId });
  if (action === 'edit-target') return openModal({ type: 'target', patientId: target.dataset.patientId, lesionId: target.dataset.id });
  if (action === 'add-nontarget') return openModal({ type: 'nontarget', patientId: target.dataset.patientId });
  if (action === 'edit-nontarget') return openModal({ type: 'nontarget', patientId: target.dataset.patientId, lesionId: target.dataset.id });
  if (action === 'add-visit') return openModal({ type: 'visit', patientId: target.dataset.patientId });
  if (action === 'edit-visit') return openModal({ type: 'visit', patientId: target.dataset.patientId, visitId: target.dataset.id });
  if (action === 'add-newlesion') return openModal({ type: 'newlesion', patientId: target.dataset.patientId, visitId: target.dataset.visitId });
  if (action === 'edit-newlesion') return openModal({ type: 'newlesion', patientId: target.dataset.patientId, lesionId: target.dataset.id });
  if (action === 'audit-detail') return openModal({ type: 'audit', auditId: target.dataset.id });

  if (action === 'delete-patient') {
    const patient = state.patients.find((item) => item.id === target.dataset.id);
    if (!patient || !confirm(`确定删除受试者 ${patient.code} 及其全部数据吗？`)) return;
    const before = clone(patient);
    state.patients = state.patients.filter((item) => item.id !== patient.id);
    if (!logChange({ action: 'DELETE', entityType: 'patient', entityId: patient.id, patientId: patient.id, summary: `删除受试者 ${patient.code}`, before, after: null })) return;
    showToast('受试者已删除'); render(); return;
  }

  if (action === 'delete-target' || action === 'delete-nontarget' || action === 'delete-newlesion') {
    const patient = state.patients.find((item) => item.id === target.dataset.patientId);
    if (!patient) return;
    const collectionName = action === 'delete-target' ? 'targetLesions' : action === 'delete-nontarget' ? 'nonTargetLesions' : 'newLesions';
    const collection = patient[collectionName];
    const lesion = collection.find((item) => item.id === target.dataset.id);
    if (!lesion || !confirm(`确定删除病灶“${lesion.label}”吗？关联随访数据也会删除。`)) return;
    const before = clone(lesion);
    patient[collectionName] = collection.filter((item) => item.id !== lesion.id);
    if (action === 'delete-target') removeMeasurementReferences(patient, lesion.id, 'target');
    if (action === 'delete-nontarget') removeMeasurementReferences(patient, lesion.id, 'nonTarget');
    if (action === 'delete-newlesion') removeMeasurementReferences(patient, lesion.id, lesion.kind === 'target' ? 'newTarget' : 'newNonTarget');
    touchPatient(patient);
    if (!logChange({ action: 'DELETE', entityType: collectionName, entityId: lesion.id, patientId: patient.id, summary: `删除病灶 ${lesion.label}`, before, after: null })) return;
    showToast('病灶已删除'); render(); return;
  }

  if (action === 'delete-visit') {
    const patient = state.patients.find((item) => item.id === target.dataset.patientId);
    const visit = patient?.visits.find((item) => item.id === target.dataset.id);
    if (!visit || !confirm(`确定删除随访“${visit.label}”吗？`)) return;
    const attachedNew = patient.newLesions.filter((lesion) => lesion.firstDetectedVisitId === visit.id);
    if (attachedNew.length && !confirm(`本次随访关联 ${attachedNew.length} 个新发病灶，删除随访会同时删除这些病灶。继续吗？`)) return;
    const before = clone(visit);
    for (const lesion of attachedNew) removeMeasurementReferences(patient, lesion.id, lesion.kind === 'target' ? 'newTarget' : 'newNonTarget');
    patient.newLesions = patient.newLesions.filter((lesion) => lesion.firstDetectedVisitId !== visit.id);
    patient.visits = patient.visits.filter((item) => item.id !== visit.id);
    touchPatient(patient);
    if (!logChange({ action: 'DELETE', entityType: 'visit', entityId: visit.id, patientId: patient.id, summary: `删除随访 ${visit.label}`, before, after: null })) return;
    showToast('随访已删除'); render(); return;
  }

  if (action === 'export-backup') return exportBackup(state);
  if (action === 'load-demo') {
    if (state.patients.length && !confirm('载入演示数据会替换当前全部数据。是否继续？')) return;
    state = createDemoState(); if (!persist()) return; showToast('已载入演示数据'); setRoute('#/patients'); render(); return;
  }
  if (action === 'reset-all') {
    if (!confirm('确定清空全部本地数据吗？此操作无法撤销。')) return;
    clearState();
    state = loadState();
    lastPersistedState = clone(state);
    ui.storageWarning = getLastLoadWarning() || null;
    ui.modal = null;
    showToast('本地数据已清空');
    setRoute('#/patients');
    render();
  }
});

app.addEventListener('change', async (event) => {
  const target = event.target;
  if (target.dataset.action !== 'import-backup' || !target.files?.[0]) return;
  if (!confirm('导入会替换当前全部数据。是否继续？')) { target.value = ''; return; }
  try {
    state = await importBackup(target.files[0]);
    appendAudit(state, { action: 'IMPORT', entityType: 'study', entityId: 'study', summary: '从 JSON 备份恢复数据' });
    if (!persist()) return; showToast('备份恢复成功'); setRoute('#/patients'); render();
  } catch (error) {
    alert(`导入失败：${error.message}`);
  } finally {
    target.value = '';
  }
});

app.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const type = form.dataset.form;

  if (type === 'settings-form') {
    const before = clone(state.settings);
    state.settings = {
      studyName: String(data.get('studyName') || '').trim(),
      protocol: String(data.get('protocol') || '').trim(),
      assessor: String(data.get('assessor') || '').trim(),
      defaultMode: data.get('defaultMode') === 'RECIST11' ? 'RECIST11' : 'IRECIST'
    };
    if (!logChange({ action: 'UPDATE', entityType: 'settings', entityId: 'study', summary: '更新研究设置', before, after: state.settings })) return;
    showToast('设置已保存'); render(); return;
  }

  if (type === 'patient-form') {
    const patientId = String(data.get('patientId') || '');
    const existing = state.patients.find((item) => item.id === patientId);
    if (existing) {
      const before = clone(existing);
      existing.code = String(data.get('code') || '').trim();
      existing.mode = data.get('mode') === 'RECIST11' ? 'RECIST11' : 'IRECIST';
      existing.baselineDate = String(data.get('baselineDate') || '');
      existing.diagnosis = String(data.get('diagnosis') || '').trim();
      existing.treatment = String(data.get('treatment') || '').trim();
      existing.notes = String(data.get('notes') || '').trim();
      touchPatient(existing);
      if (!logChange({ action: 'UPDATE', entityType: 'patient', entityId: existing.id, patientId: existing.id, summary: `更新受试者 ${existing.code}`, before, after: existing })) return;
      closeModal(); showToast('受试者已更新'); return;
    }
    const patient = createPatient({
      code: data.get('code'), mode: data.get('mode'), baselineDate: data.get('baselineDate'),
      diagnosis: data.get('diagnosis'), treatment: data.get('treatment'), notes: data.get('notes')
    });
    state.patients.unshift(patient);
    if (!logChange({ action: 'CREATE', entityType: 'patient', entityId: patient.id, patientId: patient.id, summary: `创建受试者 ${patient.code}`, before: null, after: patient })) return;
    ui.modal = null; showToast('受试者已创建'); setRoute(`#/patient/${patient.id}/lesions`); render(); return;
  }

  if (type === 'target-form') {
    const patient = state.patients.find((item) => item.id === data.get('patientId'));
    if (!patient) return;
    const lesionId = String(data.get('lesionId') || '');
    const existing = patient.targetLesions.find((item) => item.id === lesionId);
    const organ = String(data.get('organ') || '').trim();
    const otherTargets = patient.targetLesions.filter((item) => item.id !== lesionId);
    if (!existing && patient.targetLesions.length >= 5) return alert('基线靶病灶最多 5 个。');
    if (otherTargets.filter((item) => item.organ.trim() === organ).length >= 2) return alert(`器官“${organ}”最多选择 2 个靶病灶。`);
    const next = {
      id: existing?.id || createId('target'),
      label: String(data.get('label') || '').trim(), organ,
      location: String(data.get('location') || '').trim(),
      isLymphNode: data.get('isLymphNode') === 'on',
      baselineMm: Number(data.get('baselineMm'))
    };
    const before = existing ? clone(existing) : null;
    if (existing) Object.assign(existing, next); else patient.targetLesions.push(next);
    touchPatient(patient);
    if (!logChange({ action: existing ? 'UPDATE' : 'CREATE', entityType: 'targetLesion', entityId: next.id, patientId: patient.id, summary: `${existing ? '更新' : '添加'}基线靶病灶 ${next.label}`, before, after: next })) return;
    closeModal(); showToast('靶病灶已保存'); return;
  }

  if (type === 'nontarget-form') {
    const patient = state.patients.find((item) => item.id === data.get('patientId'));
    if (!patient) return;
    const lesionId = String(data.get('lesionId') || '');
    const existing = patient.nonTargetLesions.find((item) => item.id === lesionId);
    const next = { id: existing?.id || createId('nontarget'), label: String(data.get('label') || '').trim(), organ: String(data.get('organ') || '').trim(), location: String(data.get('location') || '').trim() };
    const before = existing ? clone(existing) : null;
    if (existing) Object.assign(existing, next); else patient.nonTargetLesions.push(next);
    touchPatient(patient);
    if (!logChange({ action: existing ? 'UPDATE' : 'CREATE', entityType: 'nonTargetLesion', entityId: next.id, patientId: patient.id, summary: `${existing ? '更新' : '添加'}非靶病灶 ${next.label}`, before, after: next })) return;
    closeModal(); showToast('非靶病灶已保存'); return;
  }

  if (type === 'visit-form') {
    const patient = state.patients.find((item) => item.id === data.get('patientId'));
    if (!patient) return;
    const visitId = String(data.get('visitId') || '');
    const existing = patient.visits.find((item) => item.id === visitId);
    const visit = existing || createVisit();
    const before = existing ? clone(existing) : null;
    visit.label = String(data.get('label') || '').trim();
    visit.date = String(data.get('date') || '');
    visit.clinicalStable = data.get('clinicalStable') === 'on';
    visit.notes = String(data.get('notes') || '').trim();
    visit.updatedAt = nowIso();
    for (const lesion of patient.targetLesions) {
      const raw = String(data.get(`target__${lesion.id}`) ?? '').trim();
      visit.targetMeasurements[lesion.id] = raw === '' ? null : Number(raw);
    }
    for (const lesion of patient.nonTargetLesions) visit.nonTargetStatuses[lesion.id] = String(data.get(`nt__${lesion.id}`) || '');
    for (const lesion of patient.newLesions.filter((item) => item.kind === 'target')) {
      const raw = String(data.get(`newtarget__${lesion.id}`) ?? '').trim();
      visit.newTargetMeasurements[lesion.id] = raw === '' ? null : Number(raw);
    }
    for (const lesion of patient.newLesions.filter((item) => item.kind === 'nonTarget')) visit.newNonTargetStatuses[lesion.id] = String(data.get(`newnt__${lesion.id}`) || '');
    if (!existing) patient.visits.push(visit);
    touchPatient(patient);
    if (!logChange({ action: existing ? 'UPDATE' : 'CREATE', entityType: 'visit', entityId: visit.id, patientId: patient.id, summary: `${existing ? '更新' : '新增'}随访 ${visit.label}`, before, after: visit })) return;
    closeModal(); showToast('随访已保存'); return;
  }

  if (type === 'newlesion-form') {
    const patient = state.patients.find((item) => item.id === data.get('patientId'));
    if (!patient) return;
    const lesionId = String(data.get('lesionId') || '');
    const existing = patient.newLesions.find((item) => item.id === lesionId);
    const kind = data.get('kind') === 'nonTarget' ? 'nonTarget' : 'target';
    const organ = String(data.get('organ') || '').trim();
    const otherNewTargets = patient.newLesions.filter((item) => item.id !== lesionId && item.kind === 'target' && item.definite !== false);
    if (kind === 'target' && data.get('definite') === 'on') {
      if (!existing && otherNewTargets.length >= 5) return alert('确定的新发靶病灶最多 5 个。');
      if (otherNewTargets.filter((item) => item.organ.trim() === organ).length >= 2) return alert(`器官“${organ}”最多记录 2 个新发靶病灶。`);
    }
    const next = {
      id: existing?.id || createId('newlesion'),
      label: String(data.get('label') || '').trim(), organ,
      location: String(data.get('location') || '').trim(), kind,
      isLymphNode: data.get('isLymphNode') === 'on',
      definite: data.get('definite') === 'on',
      firstDetectedVisitId: String(data.get('firstDetectedVisitId') || '')
    };
    const before = existing ? clone(existing) : null;
    if (existing && existing.kind !== kind) removeMeasurementReferences(patient, existing.id, existing.kind === 'target' ? 'newTarget' : 'newNonTarget');
    if (existing) Object.assign(existing, next); else patient.newLesions.push(next);
    const firstVisit = patient.visits.find((visit) => visit.id === next.firstDetectedVisitId);
    if (firstVisit) {
      if (kind === 'target') {
        const raw = String(data.get('initialMeasurement') || '').trim();
        firstVisit.newTargetMeasurements[next.id] = raw === '' ? null : Number(raw);
        delete firstVisit.newNonTargetStatuses[next.id];
      } else {
        firstVisit.newNonTargetStatuses[next.id] = 'present';
        delete firstVisit.newTargetMeasurements[next.id];
      }
    }
    touchPatient(patient);
    if (!logChange({ action: existing ? 'UPDATE' : 'CREATE', entityType: 'newLesion', entityId: next.id, patientId: patient.id, summary: `${existing ? '更新' : '添加'}新发病灶 ${next.label}`, before, after: next })) return;
    closeModal(); showToast('新发病灶已保存'); return;
  }
});

window.addEventListener('hashchange', render);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && ui.modal) closeModal();
});

render();
