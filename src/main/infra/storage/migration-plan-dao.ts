/**
 * 迁移方案 DAO
 *
 * 迁移方案存本地 SQLite（migration_plans 表，005 迁移建）。
 * 仅存配置（源/目标连接、表、维度、选项、告警），不存任何数据行。
 * 复用时由上层重新 diff（源/目标结构可能已变），不复用历史 diff 结果。
 */
import { randomUUID } from 'node:crypto'
import type {
  MigrationPlan,
  SavedMigrationPlan,
  SavedMigrationPlanInput,
} from '@shared/types/migration'
import { getDb } from './db'

interface MigrationPlanRow {
  id: string
  name: string
  source_conn: string
  target_conn: string
  plan_json: string
  created_at: string
  updated_at: string
}

/** 从 plan_json 还原 MigrationPlan（去掉 name，name 单列存储） */
function planFromJson(planJson: string): MigrationPlan {
  return JSON.parse(planJson) as MigrationPlan
}

function rowToPlan(row: MigrationPlanRow): SavedMigrationPlan {
  const plan = planFromJson(row.plan_json)
  return {
    ...plan,
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const migrationPlanDao = {
  /** 列出所有迁移方案（按更新时间倒序） */
  list(): SavedMigrationPlan[] {
    const db = getDb()
    const rows = db
      .prepare(`SELECT * FROM migration_plans ORDER BY updated_at DESC`)
      .all() as MigrationPlanRow[]
    return rows.map(rowToPlan)
  },

  /** 获取单个方案 */
  get(id: string): SavedMigrationPlan | null {
    const db = getDb()
    const row = db.prepare(`SELECT * FROM migration_plans WHERE id = ?`).get(id) as
      | MigrationPlanRow
      | undefined
    return row ? rowToPlan(row) : null
  },

  /** 新建方案 */
  create(input: SavedMigrationPlanInput): SavedMigrationPlan {
    const db = getDb()
    const id = randomUUID()
    const now = new Date().toISOString()
    // name 单列存储，plan_json 不含 name/id/时间戳
    const { name: _name, ...planRest } = input
    void _name
    const planJson = JSON.stringify(planRest)

    db.prepare(
      `INSERT INTO migration_plans
        (id, name, source_conn, target_conn, plan_json, created_at, updated_at)
       VALUES
        (@id, @name, @source_conn, @target_conn, @plan_json, @created_at, @updated_at)`,
    ).run({
      id,
      name: input.name,
      source_conn: input.pairs[0]?.source.connectionId ?? '',
      target_conn: input.pairs[0]?.target.connectionId ?? '',
      plan_json: planJson,
      created_at: now,
      updated_at: now,
    })

    const created = this.get(id)
    if (!created) throw new Error(`迁移方案创建后查询失败：${id}`)
    return created
  },

  /** 更新方案（复用同一 id，刷新 plan_json） */
  update(id: string, input: SavedMigrationPlanInput): SavedMigrationPlan {
    const db = getDb()
    const now = new Date().toISOString()
    const { name: _name, ...planRest } = input
    void _name
    const planJson = JSON.stringify(planRest)

    db.prepare(
      `UPDATE migration_plans SET
        name = @name, source_conn = @source_conn, target_conn = @target_conn,
        plan_json = @plan_json, updated_at = @updated_at
       WHERE id = @id`,
    ).run({
      id,
      name: input.name,
      source_conn: input.pairs[0]?.source.connectionId ?? '',
      target_conn: input.pairs[0]?.target.connectionId ?? '',
      plan_json: planJson,
      updated_at: now,
    })

    const updated = this.get(id)
    if (!updated) throw new Error(`迁移方案更新后查询失败：${id}`)
    return updated
  },

  /** 删除方案 */
  remove(id: string): void {
    const db = getDb()
    db.prepare(`DELETE FROM migration_plans WHERE id = ?`).run(id)
  },
}
