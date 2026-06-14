/**
 * 连接管理器
 *
 * 维护活跃连接的 driver 实例池（connectionId → driver）。
 * 是「三条执行路径」（GUI / AI / MCP）共用的运行时连接状态。
 *
 * 密码从 CredentialStore 取出后传入 driver，不在此缓存。
 */
import type { ConnectionConfig } from '@shared/types/connection'
import { createDriver, type DbDriver, type RedisDriver } from './driver'
import { getCredentialStore } from '@main/infra/credential'

interface ActiveConnection {
  config: ConnectionConfig
  driver: DbDriver
}

const pool = new Map<string, ActiveConnection>()

/** 建立并保持连接 */
export async function connect(connConfig: ConnectionConfig): Promise<void> {
  if (pool.has(connConfig.id)) return

  const driver = createDriver(connConfig.type)
  const password = await getCredentialStore().getPassword(connConfig.id)
  await driver.connect({ config: connConfig, password: password ?? undefined })
  pool.set(connConfig.id, { config: connConfig, driver })
}

/** 断开并移除连接 */
export async function disconnect(connectionId: string): Promise<void> {
  const entry = pool.get(connectionId)
  if (entry) {
    await entry.driver.disconnect()
    pool.delete(connectionId)
  }
}

/** 获取活跃连接的 driver（不存在则抛错） */
export function getDriver(connectionId: string): DbDriver {
  const entry = pool.get(connectionId)
  if (!entry) {
    throw new Error(`连接 ${connectionId} 未建立，请先调用 connect`)
  }
  return entry.driver
}

/** 获取 Redis driver（带类型断言，仅 Redis 连接可用） */
export function getRedisDriver(connectionId: string): RedisDriver {
  const driver = getDriver(connectionId)
  if (!('getRedisOverview' in driver)) {
    throw new Error('该连接不是 Redis 类型')
  }
  return driver as RedisDriver
}

/** 连接是否处于活跃状态 */
export function isConnected(connectionId: string): boolean {
  return pool.has(connectionId)
}

/** 关闭所有连接（应用退出时调用） */
export async function closeAll(): Promise<void> {
  const entries = [...pool.values()]
  pool.clear()
  await Promise.all(entries.map((e) => e.driver.disconnect().catch(() => {})))
}
