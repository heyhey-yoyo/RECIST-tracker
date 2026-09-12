// 在临时浏览器内操作真实界面，不读取用户的浏览器资料或病例。
export async function saveBlankStatuses() {
  const wait = async selector => {
    for (let i = 0; i < 100; i += 1) {
      const element = document.querySelector(selector);
      if (element) return element;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error(`未出现控件：${selector}`);
  };
  (await wait('[data-action="load-demo"]')).click();
  (await wait('[data-action="open-patient"]')).click();
  (await wait('[data-tab="visits"]')).click();
  (await wait('[data-action="add-newlesion"]')).click();
  const lesionForm = await wait('[data-form="newlesion-form"]');
  lesionForm.elements.label.value = '浏览器回归用新发非靶病灶';
  lesionForm.elements.organ.value = '肺';
  lesionForm.elements.kind.value = 'nonTarget';
  lesionForm.requestSubmit();
  (await wait('[data-action="edit-visit"]')).click();
  const form = await wait('[data-form="visit-form"]');
  const fields = form.querySelectorAll('select[name^="nt__"],select[name^="newnt__"]');
  if (fields.length !== 2) throw new Error('未同时覆盖原非靶与新发非靶输入');
  for (const field of fields) field.value = '';
  const visitId = form.elements.visitId.value;
  form.requestSubmit();
  const saved = JSON.parse(localStorage.getItem('recist-tracker-state-v1'));
  const visit = saved.patients[0].visits.find(item => item.id === visitId);
  if (Object.keys(visit.nonTargetStatuses).length || Object.keys(visit.newNonTargetStatuses).length) {
    throw new Error('保存时仍写入了未选择状态');
  }
  return { patients: saved.patients.length, visits: saved.patients[0].visits.length, newLesions: saved.patients[0].newLesions.length };
}

export async function assertRestoredAndQuotaRollback() {
  const buttons = [...document.querySelectorAll('[data-action="edit-visit"]')];
  if (buttons.length !== 3) throw new Error('重载后随访未完整恢复');
  const key = 'recist-tracker-state-v1';
  const original = localStorage.getItem(key);
  const patient = JSON.parse(original).patients[0];
  if (patient.newLesions.length !== 1 || patient.nonTargetLesions.length !== 1) throw new Error('重载后病灶丢失');
  buttons[0].click();
  const form = document.querySelector('[data-form="visit-form"]');
  form.elements.notes.value = '这条改动应因配额不足而回滚';
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(name, value) {
    if (name === key) throw new DOMException('回归测试模拟配额不足', 'QuotaExceededError');
    return setItem.call(this, name, value);
  };
  try {
    form.requestSubmit();
    if (localStorage.getItem(key) !== original) throw new Error('失败的保存修改了持久化数据');
    document.querySelector('[data-action="edit-visit"]').click();
    if (document.querySelector('[data-form="visit-form"]').elements.notes.value === '这条改动应因配额不足而回滚') {
      throw new Error('失败的保存没有回滚界面内存状态');
    }
  } finally {
    Storage.prototype.setItem = setItem;
  }
  return { restored: true, memoryRolledBack: true, persistedDataUnchanged: true };
}

export async function injectLegacyEmptyStatuses() {
  const key = 'recist-tracker-state-v1';
  const state = JSON.parse(localStorage.getItem(key));
  const patient = state.patients[0];
  const lesion = patient.newLesions[0];
  const visit = patient.visits.find(item => item.id === lesion.firstDetectedVisitId);
  visit.nonTargetStatuses[patient.nonTargetLesions[0].id] = '';
  visit.newNonTargetStatuses[lesion.id] = '';
  localStorage.setItem(key, JSON.stringify(state));
  return true;
}

export async function assertLegacyRecovery() {
  const buttons = [...document.querySelectorAll('[data-action="edit-visit"]')];
  if (buttons.length !== 3 || document.body.textContent.includes('已阻止载入损坏')) throw new Error('旧空字符串数据未恢复');
  buttons[0].click();
  document.querySelector('[data-form="visit-form"]').requestSubmit();
  const patient = JSON.parse(localStorage.getItem('recist-tracker-state-v1')).patients[0];
  for (const visit of patient.visits) {
    if ([...Object.values(visit.nonTargetStatuses), ...Object.values(visit.newNonTargetStatuses)].includes('')) {
      throw new Error('旧空状态在再次保存后仍存在');
    }
  }
  return { legacyRecovered: true, normalizedAfterSave: true };
}
