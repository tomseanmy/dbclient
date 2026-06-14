import { registerHandler } from './registry'
import { sqlHistoryDao } from '@main/infra/storage/sql-history-dao'

export function registerSqlHistoryHandlers(): void {
  registerHandler('sqlHistory:list', (_event, { connectionId, limit }) => {
    return sqlHistoryDao.list(connectionId, limit)
  })

  registerHandler('sqlHistory:search', (_event, { keyword, limit }) => {
    return sqlHistoryDao.search(keyword, limit)
  })

  registerHandler('sqlHistory:clear', (_event, { connectionId }) => {
    sqlHistoryDao.clear(connectionId)
    return { success: true }
  })
}
