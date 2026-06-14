/**
 * db:* IPC handler —— 数据库浏览（连接/断开/schema/表结构）
 */
import { registerHandler } from './registry'
import { connectionsDao } from '@main/infra/storage/connections-dao'
import {
  connect,
  disconnect,
  getDriver,
  getRedisDriver,
  isConnected,
} from '@main/domain/db/manager'
import { logger } from '@main/infra/logger'

export function registerDatabaseHandlers(): void {
  // 连接到数据库
  registerHandler('db:connect', async (_event, { connectionId }) => {
    const config = connectionsDao.get(connectionId)
    if (!config) {
      return { success: false, message: '连接配置不存在' }
    }
    if (isConnected(connectionId)) {
      return { success: true, message: '已连接' }
    }
    try {
      logger.info('连接数据库', { id: connectionId, type: config.type })
      await connect(config)
      // 取服务器信息（测试连通性附带）
      const driver = getDriver(connectionId)
      let serverInfo: string | undefined
      try {
        const result = await driver.testConnection({
          config,
          password: undefined,
        })
        serverInfo = result.serverInfo
      } catch {
        // 已连接成功，测试信息失败忽略
      }
      return { success: true, message: '连接成功', serverInfo }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('连接数据库失败', err)
      return { success: false, message }
    }
  })

  // 断开连接
  registerHandler('db:disconnect', async (_event, { connectionId }) => {
    await disconnect(connectionId)
    return { success: true }
  })

  // 列出 schema
  registerHandler('db:listSchemas', async (_event, { connectionId }) => {
    const driver = getDriver(connectionId)
    return driver.listSchemas()
  })

  // 列出表
  registerHandler('db:listTables', async (_event, { connectionId, schema }) => {
    const driver = getDriver(connectionId)
    return driver.listTables(schema)
  })

  // 表结构详情
  registerHandler('db:describeTable', async (_event, { connectionId, schema, table }) => {
    const driver = getDriver(connectionId)
    return driver.describeTable({ schema, table })
  })

  // 执行查询（SELECT 等）
  registerHandler('db:executeQuery', async (_event, { connectionId, sql, limit }) => {
    const { executeSql } = await import('@main/domain/executor')
    const outcome = await executeSql({ connectionId, source: 'gui' }, sql, { limit })
    if (outcome.kind === 'query') return outcome.result
    // 语句类型包装成 QueryResult 形式
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: 0,
      message: `${outcome.rowsAffected} 行受影响`,
    }
  })

  // 执行语句（INSERT/UPDATE/DELETE/DDL）
  registerHandler('db:executeStatement', async (_event, { connectionId, sql }) => {
    const { executeSql } = await import('@main/domain/executor')
    const outcome = await executeSql({ connectionId, source: 'gui' }, sql)
    return {
      rowsAffected: outcome.kind === 'statement' ? outcome.rowsAffected : outcome.result.rowCount,
    }
  })

  // Redis key 概览
  registerHandler('db:getRedisOverview', async (_event, { connectionId }) => {
    const driver = getRedisDriver(connectionId)
    return driver.getRedisOverview()
  })
}
