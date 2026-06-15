# M3 任务拆解清单 — 权限与安全

| 项       | 内容                                                                                    |
| -------- | --------------------------------------------------------------------------------------- |
| 文档版本 | v0.1                                                                                    |
| 阶段     | M3（权限与安全）                                                                        |
| 配套     | [PRD.md](./PRD.md)（M9 权限安全、M10 隐私）· [TRD.md](./TRD.md)（§3.3 权限、§3.4 隐私） |
| 目标     | 实现环境分级权限、危险 SQL 拦截、统一执行入口拦截、审计日志                             |
| 最后更新 | 2026-06-15                                                                              |

---

## 0. 验收标准（Definition of Done）

| #   | 验收项                                                                                | 验证方式    |
| --- | ------------------------------------------------------------------------------------- | ----------- |
| D1  | 连接的环境标签（dev/staging/prod）影响写权限                                          | 手动        |
| D2  | prod 连接默认只读：SELECT 可执行，INSERT/UPDATE/DELETE/DDL 被拦截                     | 手动        |
| D3  | dev/staging 写操作可执行，但危险语句（DROP/TRUNCATE/无 WHERE 的 DELETE/UPDATE）弹确认 | 手动        |
| D4  | 最高危操作（DROP/TRUNCATE）要求手动输入语句关键词确认                                 | 手动        |
| D5  | 临时提权：prod 连接可临时开启写权限（会话内有效 + 倒计时 + 审计）                     | 手动        |
| D6  | 危险 SQL 识别用 node-sql-parser 解析，解析失败保守判「需确认」                        | 单测        |
| D7  | 审计日志记录所有写操作 + 权限判定结果（allow/deny/confirm）                           | 手动 + 查库 |
| D8  | 影响 ACK：DELETE/UPDATE 前可选预估影响行数                                            | 手动        |
| D9  | typecheck / lint / test 全绿                                                          | CI          |

**M3 不做**：AI 调用权限（M4）、MCP 调用权限（M5）、列级脱敏（M6/P1）。

---

## 1. 设计原则

### 1.1 安全不变量：统一执行入口

M2 已建立 `SqlExecutor.execute(ctx, sql)` 作为三条路径（GUI / AI / MCP）的唯一入口。M3 在此入口**前置拦截层**：

```
SqlExecutor.execute(ctx, sql)
  ├─ 1. 安全检查层（M3 新增）
  │    ├─ 环境权限判定（prod 只读？）
  │    ├─ SQL 类型识别（SELECT / DML / DDL）
  │    ├─ 危险模式检测（无 WHERE / DROP / TRUNCATE）
  │    └─ 返回 Decision：allow / deny / confirm_required
  ├─ 2a. confirm_required → 抛出待确认异常，前端弹窗
  ├─ 2b. deny → 直接拒绝，记录审计
  ├─ 3. allow → 执行 + 审计记录
  └─ 4. 结果返回
```

### 1.2 环境权限矩阵（PRD M9 决策）

| 环境        | SELECT   | DML (INSERT/UPDATE/DELETE) | DDL (CREATE/ALTER/DROP) | 危险语句   |
| ----------- | -------- | -------------------------- | ----------------------- | ---------- |
| **dev**     | ✅ allow | ✅ allow                   | ✅ allow                | ⚠️ confirm |
| **staging** | ✅ allow | ✅ allow                   | ⚠️ confirm              | ⚠️ confirm |
| **prod**    | ✅ allow | ❌ deny（需临时提权）      | ❌ deny                 | ❌ deny    |

### 1.3 危险级别

| 级别        | 含义                                    | 处理                           |
| ----------- | --------------------------------------- | ------------------------------ |
| `safe`      | 只读查询                                | 直接执行                       |
| `write`     | 普通写操作                              | 按环境权限矩阵判定             |
| `dangerous` | DROP/TRUNCATE/无 WHERE 的 DELETE·UPDATE | 始终需确认；最高危需输入关键词 |

---

## 2. 任务拆解（T3.1 ~ T3.6）

### T3.1 SQL 安全分析器

**目标**：解析 SQL，判断类型 + 危险级别。

**子任务**：

- T3.1.1 `src/main/domain/security/analyzer.ts`
  - `analyzeSql(sql): SqlAnalysis`
  - SqlAnalysis：`{ type: 'query'|'dml'|'ddl'|'unknown', dangerLevel, reasons[] }`
  - 用 node-sql-parser 解析 AST
  - 识别无 WHERE 的 DELETE/UPDATE
  - 识别 DROP/TRUNCATE/ALTER
  - **解析失败保守判 `unknown` + `dangerous`**（需确认）
- T3.1.2 危险模式规则表
- T3.1.3 单元测试覆盖各场景

**依赖**：无

---

### T3.2 权限判定器

**目标**：结合环境 + SQL 分析，给出最终 Decision。

**子任务**：

- T3.2.1 `src/main/domain/security/policy.ts`
  - `decide(env, analysis, elevated): Decision`
  - Decision：`allow` / `deny` / `confirm_required`
  - 输入：环境标签、SQL 分析结果、是否已临时提权
- T3.2.2 权限矩阵实现（§1.2）
- T3.2.3 临时提权状态管理（会话级，倒计时）

**依赖**：T3.1

---

### T3.3 审计日志

**目标**：记录所有权限判定与写操作，可追溯。

**子任务**：

- T3.3.1 `audit-log-dao.ts`：基于已有 `audit_log` 表（M0 已建）
  - `record(entry)` / `list(filter)` / `search(keyword)`
- T3.3.2 审计记录内容：来源、连接、SQL、判定结果、风险级别、影响行数、时间
- T3.3.3 IPC：`audit:list` / `audit:search` / `audit:clear`

**依赖**：M0（audit_log 表）

---

### T3.4 集成到 SqlExecutor

**目标**：把安全层接入 M2 的执行入口。

**子任务**：

- T3.4.1 修改 `executor.ts`：
  - 执行前调用 analyzer + policy
  - `confirm_required` 时抛出 `ConfirmationRequiredError`（携带分析结果）
  - `deny` 时抛出 `PermissionDeniedError`
  - `allow` 时执行 + 审计
- T3.4.2 新增 IPC：`db:confirmExecute`
  - 用户确认后调用，带确认标志（普通确认 / 关键词确认）
- T3.4.3 新增 IPC：`connection:elevate` / `connection:revokeElevation`
  - 临时提权 / 撤销

**依赖**：T3.1, T3.2, T3.3

---

### T3.5 前端：确认弹窗 + 审计面板

**子任务**：

- T3.5.1 危险操作确认弹窗组件
  - 显示 SQL + 风险级别 + 预估影响行数
  - 最高危要求输入关键词（如 `DROP`）
  - 确认后调 `db:confirmExecute`
- T3.5.2 临时提权入口
  - prod 连接的「提权」按钮（带倒计时）
- T3.5.3 审计日志面板
  - 列表展示：时间/连接/操作/判定/风险
  - 筛选与搜索
- T3.5.4 权限被拒时的友好提示（而非崩溃）

**依赖**：T3.4

---

### T3.6 测试与验收

- T3.6.1 analyzer 单测（覆盖 SELECT/INSERT/无 WHERE DELETE/DROP/解析失败）
- T3.6.2 policy 单测（覆盖三个环境 × 各危险级别）
- T3.6.3 端到端：prod 连接执行 SELECT 成功、执行 DROP 被拦截
- T3.6.4 文档更新 + git 提交

---

## 3. 依赖关系

```
T3.1 analyzer ──→ T3.2 policy ──→ T3.4 集成 executor ──→ T3.5 前端 ──→ T3.6 验收
                                     ↑
T3.3 审计 DAO ────────────────────────┘
```

**关键路径**：T3.1 → T3.2 → T3.4 → T3.5 → T3.6

---

## 4. 实施批次

| 批次       | 任务               | 产出                                             |
| ---------- | ------------------ | ------------------------------------------------ |
| **批次 A** | T3.1 + T3.2 + T3.3 | 安全分析 + 权限判定 + 审计 DAO（纯逻辑，可单测） |
| **批次 B** | T3.4 + T3.5        | 接入执行入口 + 前端确认弹窗 + 审计面板           |
| **批次 C** | T3.6               | 测试与验收                                       |

---

## 5. 实施记录

### 5.1 交付物清单

**安全分析（T3.1）**

- `src/main/domain/security/analyzer.ts`：SQL 安全分析器
  - node-sql-parser 解析 AST + 危险关键字黑名单双保险
  - 识别 SELECT/DML/DDL 类型 + safe/write/dangerous 级别
  - 无 WHERE 的 DELETE/UPDATE 检测
  - 解析失败保守判 dangerous
  - 多语句批量分析取最高级别
- `analyzer.test.ts`：14 个单测

**权限判定（T3.2）**

- `src/main/domain/security/policy.ts`：
  - 环境权限矩阵（dev/staging/prod × write/ddl/dangerous）
  - decide() 返回 allow/deny/confirm_required
  - 临时提权状态管理（会话级，30 分钟，自动过期）
- `policy.test.ts`：19 个单测

**审计日志（T3.3）**

- `src/main/infra/storage/audit-log-dao.ts`：record/list/search/clear
- 所有权限判定与写操作均记录

**执行入口集成（T3.4）**

- `executor.ts` 重写：执行前 checkSql → deny 抛 PermissionDeniedError → confirm 抛 ConfirmationRequiredError
- `checkSql()` 预检函数（不执行，只分析）
- IPC：db:checkSql / db:confirmExecute / connection:elevate/revokeElevation/getElevation / audit:list/search/clear

**前端（T3.5）**

- `ConfirmDialog.tsx`：危险操作确认弹窗（SQL + 原因 + 关键词确认）
- `PermissionNotice.tsx`：权限拒绝提示 + 临时提权按钮
- `SqlWorkspace.tsx` 重写：执行前预检流程（check → 弹窗/拒绝/执行）

### 5.2 验收状态

| 项                                 | 状态                                |
| ---------------------------------- | ----------------------------------- |
| D1 环境标签影响权限                | ✅                                  |
| D2 prod 默认只读                   | ✅                                  |
| D3 dev/staging 危险操作确认        | ✅                                  |
| D4 DROP/TRUNCATE 关键词确认        | ✅                                  |
| D5 临时提权（倒计时+审计）         | ✅                                  |
| D6 node-sql-parser 解析 + 失败保守 | ✅ 14 单测                          |
| D7 审计日志                        | ✅                                  |
| D8 影响行数                        | ⏳ P1（执行后显示，执行前预估未做） |
| D9 typecheck/lint/test             | ✅ 36 单测全绿                      |
