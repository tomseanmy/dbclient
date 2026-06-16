/**
 * savedQuery:* IPC handler —— 保存查询的 CRUD
 */
import { registerHandler } from './registry'
import { savedQueryDao } from '@main/infra/storage/saved-queries-dao'

export function registerSavedQueryHandlers(): void {
  registerHandler('savedQuery:list', (_event, { connectionId }) => {
    return savedQueryDao.list(connectionId)
  })

  registerHandler('savedQuery:search', (_event, { keyword }) => {
    return savedQueryDao.search(keyword)
  })

  registerHandler('savedQuery:save', (_event, input) => {
    return savedQueryDao.create(input)
  })

  registerHandler('savedQuery:update', (_event, { id, patch }) => {
    savedQueryDao.update(id, patch)
    return { success: true }
  })

  registerHandler('savedQuery:delete', (_event, { id }) => {
    savedQueryDao.remove(id)
    return { success: true }
  })
}
