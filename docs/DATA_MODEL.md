# 数据结构

应用状态保存在一个版本化 JSON 对象中。

```text
AppState
├── schemaVersion
├── settings
├── patients[]
└── audit[]
```

## Patient

```text
Patient
├── id
├── code
├── mode: IRECIST | RECIST11
├── diagnosis
├── treatment
├── baselineDate
├── notes
├── targetLesions[]
├── nonTargetLesions[]
├── newLesions[]
├── visits[]
├── createdAt
└── updatedAt
```

## TargetLesion

```text
TargetLesion
├── id
├── label
├── organ
├── location
├── isLymphNode
└── baselineMm
```

## NewLesion

```text
NewLesion
├── id
├── label
├── organ
├── location
├── kind: target | nonTarget
├── isLymphNode
├── definite
└── firstDetectedVisitId
```

新发靶病灶的连续测量保存在随访的 `newTargetMeasurements` 中；新发非靶病灶的连续状态保存在 `newNonTargetStatuses` 中。

## Visit

```text
Visit
├── id
├── label
├── date
├── clinicalStable
├── notes
├── targetMeasurements
├── nonTargetStatuses
├── newTargetMeasurements
├── newNonTargetStatuses
├── createdAt
└── updatedAt
```

所有测量单位均为毫米。

## AuditEntry

```text
AuditEntry
├── id
├── timestamp
├── actor
├── action
├── entityType
├── entityId
├── patientId
├── summary
├── before
└── after
```

审计记录保留修改前后快照，最多保存最近 2000 条。该实现是应用级审计，不等同于经过验证的法规审计轨迹。

## 保存、空值与重新载入

nonTargetStatuses 与 newNonTargetStatuses 仅保存已选择的有效枚举；未选择的键直接省略，不能写入空字符串。载入时兼容迁移旧存档中的空字符串，避免整份患者库因未完成的非靶录入被拒绝。靶测量缺失按各测量字段的 null 语义处理，不把缺失数据解释成 0。

界面保存是持久化与内存状态一致的操作：存储配额/权限失败时保留旧持久化数据，并回滚未提交的内存修改。npm run release:check 包含实际浏览器“界面录入→保存→刷新恢复”、旧空值迁移和存储失败回滚检查；此完整检查需要本机 Chrome/Chromium/Edge，支持 `BROWSER_EXECUTABLE` 指定可执行文件；浏览器使用隔离配置，详见 [AGENTS.md](../AGENTS.md)。
