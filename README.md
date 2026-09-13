# RECIST Tracker

一个无需后端、可直接部署到 Cloudflare Pages 或 Cloudflare Workers Static Assets 的 RECIST 1.1 / iRECIST 疗效评估网页。

## 主要功能

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
- iUPD 后按触发类别检查进一步增加（同一靶病灶类别总和再增 ≥5 mm）、非靶进一步增加、额外新病灶及另一类别首次进展等确认逻辑
- 4–8 周确认窗口提示和临床稳定性提示
- 自动判定理由与数据质量警告
- 本地审计记录
- JSON 完整备份与恢复，导入时自动校验数据结构与引用完整性
- 存储容量监控与明文存储风险提示
- 导入安全校验：拒绝畸形、恶意或引用不完整的备份
- 响应式桌面与移动端界面
- 不包含图片、Excel、表格或 PDF 导出

iUPD 后不足 28 天的提前检查会提示并保留待确认状态，不参与后续最低值、首次新发病灶参考或自动确认/重置。超过 56 天的检查提示超窗，但仍按可评价性判断；研究方案的特殊例外需人工复核，详见[评估规则](./docs/RULES.md)。规则说明同时列出 PR 延续、总体 CR 后病灶再现和 iUPD 重置的条件与实现边界；“新病灶稳定”本身不等于可重置；新发病灶触发后仍存在、原病灶反应等级不变时，原靶或新靶总和须较该 iUPD 锚点再缩小至少 5 mm。

## 界面风格

采用暖米白、浅灰与赤陶色，衬线标题与系统无衬线正文保持统一层级，图表与状态提示保留必要的颜色区别。

页眉内容区居中，品牌与标题靠左，操作靠右；页眉位于文档顶部，随页面正常滚走，窄屏允许换行。页眉背景与分隔线铺满页面宽度。

未完成的非靶状态可以保存，重新打开时保持数据完整；保存失败会显示提示并保留原记录。长随访表单可内部滚动，保存按钮保持可达。

## 数据与隐私

应用是纯静态网页，业务数据保存在浏览器 `localStorage` 中，不会上传到 Cloudflare 或其他服务器。

这同时意味着：

- 不同设备和浏览器之间不会自动同步。
- 清理网站数据、使用无痕窗口或设备损坏可能造成数据丢失。
- 应定期使用「数据备份」页面导出 JSON。
- 该架构没有用户登录、权限控制或多中心协作能力。

如需多用户协作，可在后续版本中增加 Cloudflare Access、Workers API 和 D1 数据库。

## 本地运行

对外版本以 GitHub Release 为准；应用版本来自 `package.json`，发布时与 Release tag 同步。 数据 schema 版本独立维护，不随补丁发布递增。

项目没有第三方运行时依赖。构建与测试需要 Node.js 20 或更高版本；下方预览命令还需要 Python 3，且 `python3` 命令可用。

```bash
npm run check
npm run preview
```

浏览器打开：

```text
http://localhost:4173
```

`npm run check` 仅需 Node.js，会运行规则单元测试并生成 `dist/`。完整发布验证 `npm run release:check` 还运行真实浏览器场景，需要本机 Chrome、Chromium 或 Edge；常见路径自动发现，其他安装路径设置 `BROWSER_EXECUTABLE` 为浏览器可执行文件路径，配置示例见 [AGENTS.md](./AGENTS.md)。

## 部署

页面按内容标识引用样式和完整脚本依赖，缓存复用前会向服务器确认更新，避免升级时混用旧模块。

**Cloudflare Pages**

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

**Cloudflare Workers Static Assets（可选）**

仓库包含 `wrangler.jsonc`：

```bash
npm run build
npx wrangler deploy
```

配置中的 `not_found_handling` 已设为 `single-page-application`。

## 责任边界

本项目是评估辅助工具，不替代影像科医师、研究者、独立评审委员会或研究方案。

以下情形必须人工判断：

- 病灶是否真正为新发恶性病灶
- 非靶病灶是否达到「明确进展」
- 病灶分裂、融合、局部治疗、骨病灶、囊性病灶及技术性不可测量
- 缺失访视、确认缓解要求和研究方案中的修改标准
- 临床不稳定患者是否继续治疗

该版本没有完成 GxP、21 CFR Part 11 或其他受监管系统验证，不应作为正式临床试验的唯一原始记录。

## License

MIT

---

> AI 编程代理请阅读 [AGENTS.md](./AGENTS.md) 了解代码架构、测试与开发约定。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理都必须同步更新本文件与 AGENTS.md。**
>
> - 新增功能 → 在 README 中添加用户可理解的说明
> - 新增/删除文件 → 更新 AGENTS.md 中的文件清单
> - 修改架构 → 更新 AGENTS.md 的架构说明
> - 部署方式变更 → 同步更新本文部署章节
> - 保持 **README 面向人类用户**，**AGENTS.md 面向 AI 代理**，两份文件不可互相替代
