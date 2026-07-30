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
