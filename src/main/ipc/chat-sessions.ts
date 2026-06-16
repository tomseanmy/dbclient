/**
 * chatSession:* IPC handler —— AI 对话会话与消息的 CRUD
 */
import { registerHandler } from './registry'
import { chatSessionDao } from '@main/infra/storage/chat-session-dao'

export function registerChatSessionHandlers(): void {
  registerHandler('chatSession:list', (_event, { connectionId }) => {
    return chatSessionDao.listSessions(connectionId)
  })

  registerHandler('chatSession:create', (_event, input) => {
    return chatSessionDao.createSession(input)
  })

  registerHandler('chatSession:rename', (_event, { id, title }) => {
    chatSessionDao.renameSession(id, title)
    return { success: true }
  })

  registerHandler('chatSession:delete', (_event, { id }) => {
    chatSessionDao.deleteSession(id)
    return { success: true }
  })

  registerHandler('chatSession:getMessages', (_event, { sessionId }) => {
    return chatSessionDao.listMessages(sessionId)
  })

  registerHandler(
    'chatSession:appendMessage',
    (_event, { sessionId, connectionId, role, content, sqlText }) => {
      chatSessionDao.appendMessage({
        sessionId,
        connectionId,
        role,
        content,
        sqlText,
      })
      return { success: true }
    },
  )
}
