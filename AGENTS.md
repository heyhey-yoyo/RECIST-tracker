# RECIST Tracker — 项目说明（供 AI 编程代理阅读）

## 项目概览

RECIST Tracker 是一个**纯前端 SPA**（单页应用），用于 RECIST 1.1 和 iRECIST 肿瘤疗效评估。目标部署平台为 Cloudflare Pages 或 Cloudflare Workers 静态资源。无后端、无框架、零运行时依赖——全部使用原生 JavaScript ES Modules。

## 构建与测试

```bash
npm run test       # Node.js 内置测试运行器，测试文件在 tests/
npm run build      # 将 public/ + src/ 复制到 dist/（脚本：scripts/build.mjs）
npm run check      # test + build
npm run preview    # 通过 Python http.server 在 http://localhost:4173 预览 dist/
```

需要 **Node.js ≥ 20**。构建脚本使用 `node:fs/promises` 做简单文件复制——无打包器、无压缩器。

## 项目结构

```text
public/                 静态 HTML 入口与 Cloudflare _headers
scripts/build.mjs       零依赖静态构建脚本（复制 public/ + src/ → dist/）
src/
  app.js                全部 UI：路由（hash-based）、表单、模态框、事件处理、渲染
  styles.css            单文件 CSS，无预处理器或框架
  storage.js            localStorage 读写、审计日志、JSON 备份/恢复、
                        容量监控、写入异常回滚
  demo.js               演示数据工厂（胃癌免疫治疗示例）
  domain/
    model.js            数据模型：常量、状态枚举（NON_TARGET_STATUSES /
                        NEW_NON_TARGET_STATUSES，全项目唯一来源，由 LABELS 键派生）、
                        工厂函数（createPatient、createVisit）、状态规范化、clone、
                        organGroup（RECIST 器官计数归组：左右成对器官与全部
                        淋巴结站各计为一个器官）
    recist.js           RECIST 1.1 规则：靶病灶评估、非靶病灶评估、总体疗效、
                        序列评估、最佳时间点；evaluateVisitRecist 为单访视共享
                        评估函数（RECIST 序列与 iRECIST 状态机共用）；另提供
                        newLesionsTrackableAtVisit / pruneNewLesionTimeTravelKeys
                        防止"首次发现之前"的时间穿越测量写入随访
    irecist.js          iRECIST 状态机：iUPD 检测、确认逻辑、重置规则、
                        提前扫描隔离（＜28 天不进入状态机）、NE 时间点隔离
                        （无法评价的时间点不进入后续最低值/参考序列）
    validation.js       数据质量检查（病灶数量、器官组限制、测量有效性、
                        新发靶病灶可测量性）
    schema.js           导入/加载数据递归白名单校验：ID 格式、枚举、引用完整性、
                        XSS 防护、类型约束
  utils/
    format.js           HTML 转义、日期/数字/百分比格式化（zh-CN locale）、
                        daysBetween、responseClass（颜色编码）
    measurement.js      严格测量值解析：拒绝布尔、数组、指数、带单位字符串；
                        null/空白视为缺失，区分于 0 mm；toTenths() 将毫米值
                        转为 0.1 mm 整数供阈值比较使用
test-utils/
  fixtures.js           测试夹具工厂函数（makePatient、makeVisit、makeState）
tests/
  recist.test.js        Node 内置测试：RECIST 1.1 矩阵、靶/非靶/总体疗效边界
  irecist.test.js       Node 内置测试：iRECIST 状态机、提前扫描、窗口、重置
  measurement.test.js   Node 内置测试：严格解析、类型拒绝、0 vs 空值
  schema.test.js         Node 内置测试：schema 校验、引用、XSS、重复 ID
  storage.test.js        Node 内置测试：存储容量、配额异常、损坏数据、XSS 导入
  validation.test.js    Node 内置测试：数据验证检查（含器官归组与新发靶病灶可测量性）
  data-integrity.test.js Node 内置测试：时间穿越测量防护与 schema 往返
docs/
  DATA_MODEL.md         完整数据结构参考
  RULES.md              RECIST 1.1 / iRECIST 规则边界与边缘情况
dist/                   构建产物（由构建脚本生成，仅供参考）
```

## 架构

### 状态管理

全部应用状态存储在单个 `state` 对象（`src/app.js:26`）：

```js
state = {
  schemaVersion: 1,
  settings: { studyName, protocol, assessor, defaultMode },
  patients: [ ... ],
  audit: [ ... ]
}
```

- **持久化**：`loadState()` / `saveState()` 读写 `localStorage`，键为 `recist-tracker-state-v1`。
- **加载时校验**：`loadState()` 调用 `validateAndNormalizeState()`（`schema.js`）进行递归白名单校验，拒绝恶意/畸形数据，返回空状态而不崩溃。
- **保存时保护**：`saveState()` 捕获配额异常并回滚内存状态到上次成功保存的快照。
- **容量监控**：序列化数据 ≥4 MiB 时 UI 显示警告；导出页面显示当前数据大小。
- **审计**：每次变更调用 `appendAudit()`，记录 `{ action, entityType, entityId, patientId, summary, before, after }`。最多 2000 条。

### 路由

基于 hash 的路由（`src/app.js`）：

- `#/patients` — 患者列表（默认）
- `#/patient/:id/overview` — 概览与时间线
- `#/patient/:id/lesions` — 病灶管理
- `#/patient/:id/visits` — 访视记录
- `#/patient/:id/audit` — 审计日志
- `#/settings` — 研究设置
- `#/backup` — 数据备份/恢复
- `#/about` — 规则边界

### UI 模式

整个 UI 使用服务端渲染风格的 HTML 模板字符串，通过 `app.innerHTML = ...` 渲染。无虚拟 DOM 或组件框架。

- `render()` 为主入口：根据路由分发到页面渲染函数，然后设置 `app.innerHTML`。
- 模态框通过 `ui.modal` 状态管理，在同一 `render()` 流程中渲染。
- Toast 通知使用相同模式（`ui.toast`）。
- 所有事件处理通过 `app` 上的委托监听器（click、change、submit），按 `data-action` 属性区分。
- 表单数据通过 `new FormData(form)` 读取，按 `form.dataset.form` 分发。

### 领域逻辑

**RECIST 1.1**（`recist.js`）：

- `evaluateTargetLesions(patient, visit, previousVisits)` — 返回 `{ code, currentSum, baselineSum, nadirSum, baselineChangePct, nadirChangePct, reason }`
- `evaluateNonTargetLesions(patient, visit)` — 返回 `{ code, reason }`
- `evaluateOverallResponse({ target, nonTarget, hasDefiniteNewLesion })` — 综合靶病灶 + 非靶病灶 + 新病灶
- `evaluateVisitRecist(patient, visit, previousVisits, allVisits, hadPriorOverallCR)` — 单访视共享评估函数，`evaluateRecistSequence` 与 iRECIST 状态机（`irecist.js`）共用，修改 RECIST 规则时只需改此处
- `evaluateRecistSequence(patient)` — 按时间顺序处理全部访视，返回每次访视的评估结果
- `newLesionsTrackableAtVisit(patient, visit)` — 随访（含新建）可见的新发病灶集合，界面渲染与保存共用
- `pruneNewLesionTimeTravelKeys(patient)` — 删除早于首次发现随访的残留测量/状态键（幂等）

**阈值比较约定**：RECIST/iRECIST 阈值（-30%、+20%、+5 mm）一律使用 `measurement.js` 的 `toTenths()` 转成 0.1 mm 整数后交叉相乘比较（如 `currentT * 5 >= nadirT * 6`），禁止直接比较浮点百分比或浮点差值——精确边界上 IEEE-754 误差会把 PR/PD 误判为 SD。

**iRECIST**（`irecist.js`）：

- `evaluateIrecistSequence(patient)` — 在 `evaluateRecistSequence()` 结果之上运行的状态机
- 跟踪 `pending` iUPD 锚点；满足进一步进展标准（5 mm 增长、非靶病灶进一步增大、额外新病灶）时确认 iCPD
- 未确认且病灶改善时将 iUPD 重置为 iCR/iPR/iSD
- 对确认窗口违规（不在 28–56 天内）和临床不稳定性发出警告

### 验证约束（`validation.js`）

- 基线靶病灶最多 5 个，每个器官最多 2 个
- 新发靶病灶最多 5 个，每个器官最多 2 个
- 淋巴结：基线短轴 ≥ 15 mm 为可测量（警告）
- 非淋巴结：基线最长径 ≥ 10 mm 为可测量（警告）
- 访视日期不得早于基线日期
- 不允许重复访视日期

## 代码约定

- **语言**：用户界面文案和注释使用中文，标识符使用英文。
- **模块系统**：仅使用 ES modules（`import`/`export`），无需打包器。
- **零依赖**：项目有意保持零 npm 依赖。未经明确批准不得添加依赖。
- **工厂函数**：使用 `model.js` 中的 `createPatient()`、`createVisit()`、`createInitialState()` 构造对象，不要手动构建。
- **克隆**：使用 `model.js` 中的 `clone()`（JSON 往返）进行审计日志前的深拷贝。
- **ID**：使用 `createId(prefix)` 生成 `prefix_uuid`，底层为 `crypto.randomUUID()`。
- **日期处理**：日期存储为 `YYYY-MM-DD` 字符串。使用 `format.js` 中的 `daysBetween()` 计算间隔。使用 `nowIso()` 生成时间戳。
- **审计不可变性**：变更前后始终捕获 `clone(before)` 和 `clone(after)` 用于审计条目。
- **测试风格**：Node 内置测试运行器（`node:test` + `node:assert/strict`）。测试直接导入领域逻辑。

## 重要边界

- 本工具为**医学评估辅助工具**，非受监管的医疗器械。未经 GxP / 21 CFR Part 11 验证。
- 所有数据保留在浏览器中。无后端、无身份验证、无多用户支持。
- 应用明确排除：影像查看、Excel/PDF 导出、打印布局、多中心协作。
- 以下情况始终需要人工审核：病灶良恶性判断、非靶病灶的明确进展、病灶分裂/融合、局部治疗、骨骼/囊性病灶、以及方案特定修改。
- 导入数据经过 `schema.js` 递归白名单校验：ID 必须字母开头、仅含字母数字下划线连字符；状态值必须在已知枚举内；病灶引用完整性校验；未知字段静默丢弃。
- ID 在置入 HTML 属性前统一经过 `escapeHtml()` 转义，防止属性注入型 XSS。
- 修改 RECIST/iRECIST 规则时，务必添加对应的测试用例。
- `dist/` 目录为构建输出，当前提交至仓库仅供参考。构建脚本每次运行会删除并重建。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（包括未来的你自己）都必须遵守：**
>
> - **修改代码后必须同步更新本 AGENTS.md 与 README.md** — 新增文件、架构变更、功能增删、部署方式变更都需要在两份文档中体现
> - README.md 面向**人类用户**（功能介绍、运行方法、部署步骤），AGENTS.md 面向 **AI 代理**（架构、代码组织、测试策略、开发约定）
> - 两份文件**不可互相替代**，各有所众
> - 项目的实际文件结构必须与 AGENTS.md 中列出的文件清单保持一致
