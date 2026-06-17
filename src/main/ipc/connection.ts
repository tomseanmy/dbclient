/**
 * connection:* IPC handler —— 连接管理 CRUD + 测试
 */
import { registerHandler } from './registry'
import { connectionsDao } from '@main/infra/storage/connections-dao'
import { createDriver } from '@main/domain/db/driver'
import { logger } from '@main/infra/logger'
import { tMain } from '@main/i18n'

export function registerConnectionHandlers(): void {
  // 列出所有连接
  registerHandler('connection:list', () => {
    return connectionsDao.list()
  })

  // 获取单个连接
  registerHandler('connection:get', (_event, { id }) => {
    return connectionsDao.get(id) ?? null
  })

  // 新建连接
  registerHandler('connection:create', async (_event, input) => {
    logger.info('新建连接', { name: input.name, type: input.type })
    return connectionsDao.create(input)
  })

  // 更新连接
  registerHandler('connection:update', async (_event, { id, input }) => {
    logger.info('更新连接', { id })
    return connectionsDao.update(id, input)
  })

  // 删除连接
  registerHandler('connection:delete', async (_event, { id }) => {
    logger.info('删除连接', { id })
    await connectionsDao.remove(id)
    return { success: true }
  })

  // 测试连接（不保存，只验证能否连上）
  registerHandler('connection:test', async (_event, input) => {
    logger.info('测试连接', { type: input.type, host: input.host })
    try {
      const driver = createDriver(input.type)
      // 密码：留空时回退取已存密码（编辑场景），新建场景则确实为空
      let password = input.password
      if (!password && input.id) {
        password = (await connectionsDao.getCredential(input.id)) ?? undefined
      }
      // 构造临时 config（测试不落库，用占位值）
      const tempConfig = {
        id: 'test',
        name: 'test',
        type: input.type,
        host: input.host,
        port: input.port,
        username: input.username,
        database: input.database,
        options: input.options,
        environment: 'dev' as const,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      const result = await driver.testConnection({
        config: tempConfig,
        password,
      })
      return {
        success: true,
        message: tMain('errors.db.connectSuccess'),
        serverInfo: result.serverInfo,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('测试连接失败', { message })
      return { success: false, message }
    }
  })
}
