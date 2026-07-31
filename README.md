# RECIST Tracker

一个无需后端、可直接部署到 Cloudflare Pages 或 Cloudflare Workers Static Assets 的 RECIST 1.1 / iRECIST 疗效评估网页。

## 功能

- 研究设置与评估者记录
- 多受试者管理
- 基线靶病灶：最多 5 个、每器官最多 2 个的校验（左右成对器官与全部淋巴结站各计为一个器官）
- 淋巴结短径与非淋巴结最长径
- 基线非靶病灶
- 连续随访测量
- 自动计算靶病灶直径总和、较基线变化、较最低值变化
- RECIST 1.1：CR、PR、SD、PD、NE、Non-CR/Non-PD
- iRECIST：iCR、iPR、iSD、iUPD、iCPD
- 新发靶病灶单独求和并校验可测量性；新发非靶病灶定性跟踪
- iUPD 后 5 mm 进一步增加、非靶病灶进一步增加、额外新病灶等确认逻辑
- 4–8 周确认窗口提示和临床稳定性提示
- 自动判定理由与数据质量警告
- 本地审计记录
- JSON 完整备份与恢复，导入时自动校验数据结构与引用完整性
- 存储容量监控与明文存储风险提示
- 导入安全校验：拒绝畸形、恶意或引用不完整的备份
- 响应式桌面与移动端界面
- 不包含图片、Excel、表格或 PDF 导出

## 界面风格

界面采用 YDchenTools 工具站统一视觉语言：米白页面背景、半透明白色页眉、`YDchen` 衬线字标、浅灰 `Tools` 字样、竖向分隔线及紧凑的双行工具标题。主功能导航位于页眉下方，并针对桌面和移动端分别优化。

## 数据与隐私

应用是纯静态网页，业务数据保存在浏览器 `localStorage` 中，不会上传到 Cloudflare 或其他服务器。

这同时意味着：

- 不同设备和浏览器之间不会自动同步。
- 清理网站数据、使用无痕窗口或设备损坏可能造成数据丢失。
- 应定期使用“数据备份”页面导出 JSON。
- 该架构没有用户登录、权限控制或多中心协作能力。

如需多用户协作，可在后续版本中增加 Cloudflare Access、Workers API 和 D1 数据库。

## 本地运行

项目没有第三方运行时依赖，只要求 Node.js 20 或更高版本。

```bash
npm run check
npm run preview
```

浏览器打开：

```text
http://localhost:4173
```

`npm run check` 会运行规则单元测试并生成 `dist/`。

## 部署到 Cloudflare Pages

**通过 GitHub 自动部署**

1. 将项目推送到 GitHub。
2. 在 Cloudflare Dashboard 中进入 **Workers & Pages**。
3. 创建 Pages 项目并连接仓库。
4. 使用以下设置：

```text
Production branch: main
Build command: npm run build
Build output directory: dist
Node.js version: 20 或更高
```

每次推送后 Cloudflare Pages 会自动构建和部署。

**直接上传**

```bash
npm run build
npx wrangler pages deploy dist --project-name recist-tracker
```

## 部署到 Cloudflare Workers Static Assets

仓库包含 `wrangler.jsonc`：

```bash
npm run build
npx wrangler deploy
```

配置中的 `not_found_handling` 已设为 `single-page-application`。

## 项目结构

```text
index.html               HTML 入口和 Cloudflare 安全响应头
_headers                 Cloudflare 安全响应头
scripts/build.mjs       无依赖静态构建脚本
src/app.js              页面、表单和状态管理
src/domain/recist.js    RECIST 1.1 规则
src/domain/irecist.js   iRECIST 顺序状态机
src/domain/validation.js 数据质量校验
src/domain/schema.js    导入数据递归白名单校验
src/domain/model.js     数据模型、工厂函数与状态枚举
src/utils/format.js     日期/数字格式化与 HTML 转义
src/utils/measurement.js 严格测量值解析
src/storage.js          localStorage、审计、容量监控与 JSON 备份
src/demo.js             内置演示数据
test-utils/fixtures.js  测试夹具工厂函数
tests/                  Node 内置测试运行器测试（35 项）
dist/                   可直接部署的静态产物
```

更详细的规则边界见 [`docs/RULES.md`](docs/RULES.md)，数据结构见 [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)。

## 医疗与合规边界

本项目是评估辅助工具，不替代影像科医师、研究者、独立评审委员会或研究方案。

以下情形必须人工判断：

- 病灶是否真正为新发恶性病灶
- 非靶病灶是否达到“明确进展”
- 病灶分裂、融合、局部治疗、骨病灶、囊性病灶及技术性不可测量
- 缺失访视、确认缓解要求和研究方案中的修改标准
- 临床不稳定患者是否继续治疗

该版本没有完成 GxP、21 CFR Part 11 或其他受监管系统验证，不应作为正式临床试验的唯一原始记录。

## 规则资料

- RECIST Working Group, RECIST 1.1: https://recist.eortc.org/recist-1-1/
- RECIST Working Group, iRECIST: https://recist.eortc.org/irecist/
- Seymour et al., iRECIST guideline: https://recist.eortc.org/recist/wp-content/uploads/sites/4/2017/03/Manuscript_IRECIST_Lancet-Oncology_Seymour-et-al_revision_FINAL_clean_nov25.pdf
- Cloudflare Pages React/static deployment: https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/
- Cloudflare SPA serving: https://developers.cloudflare.com/pages/configuration/serving-pages/

## License

MIT

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（Claude Code、Cursor、Copilot 等）都必须同步更新本文件与 AGENTS.md。**
>
> - 新增功能 → 在 README 中添加用户可理解的说明
> - 新增/删除文件 → 更新本文和 AGENTS.md 中的文件清单
> - 修改架构 → 更新 AGENTS.md 的架构说明
> - 部署方式变更 → 同步更新本文部署章节
> - 保持 **README 面向人类用户**，**AGENTS.md 面向 AI 代理**，两份文件不可互相替代
