import { tMain } from '@main/i18n'
/**
 * 方言生成器工厂
 *
 * 根据目标 MigrationDialect 返回对应的 DialectGenerator 实现。
 * 上层（structure-script / data-script）通过此工厂获取方言实例，
 * 不直接依赖具体方言类。
 */
import type { MigrationDialect } from '@shared/types/migration'
import type { DialectGenerator } from './types'
import { MysqlDialect } from './mysql-dialect'
import { PostgresDialect } from './postgres-dialect'
import { SqliteDialect } from './sqlite-dialect'

const INSTANCES: Record<MigrationDialect, DialectGenerator> = {
  mysql: new MysqlDialect(),
  postgres: new PostgresDialect(),
  sqlite: new SqliteDialect(),
}

/** 获取指定方言的生成器单例（无副作用，复用实例） */
export function getDialectGenerator(dialect: MigrationDialect): DialectGenerator {
  const gen = INSTANCES[dialect]
  if (!gen) throw new Error(tMain('errors.migration.unsupportedDialect', { dialect }))
  return gen
}

export type { DialectGenerator } from './types'
