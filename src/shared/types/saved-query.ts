/**
 * 保存查询类型（主进程与渲染进程共享）
 *
 * 在 shared 层独立定义，与 DAO 的结构保持一致（DAO 反向引用此类型），
 * 避免 shared 反向依赖 main 内部模块。
 */

/** 保存查询记录（列表/展示用） */
export interface SavedQueryRecord {
  id: string
  name: string
  sqlText: string
  /** 关联连接 id（可空，表示通用查询） */
  connectionId: string | null
  description: string | null
  createdAt: string
  updatedAt: string
}

/** 创建/更新时的输入 */
export interface SavedQueryInput {
  name: string
  sqlText: string
  connectionId?: string | null
  description?: string
}

/** 更新时的可变字段 */
export interface SavedQueryUpdatePatch {
  name?: string
  sqlText?: string
  description?: string
}
