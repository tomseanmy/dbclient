/**
 * 结构化日志（基于 electron-log）
 *
 * - 同时写入文件（userData/logs/main.log）与控制台
 * - 文件按大小/日期轮转
 * - 提供带上下文的日志方法，便于追溯
 *
 * 用法：
 *   logger.info('消息', { key: value })
 *   logger.error('失败', err)
 */
import log from 'electron-log'

log.transports.file.level = 'info'
log.transports.file.maxSize = 5 * 1024 * 1024 // 5MB 轮转
log.transports.console.level = 'debug'
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}'

// errorMessagesFn：确保 Error 对象被正确序列化（含 stack）
log.errorHandler.startCatching({
  showDialog: process.env.NODE_ENV === 'production',
})

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) =>
    log.debug(msg, ctx ? JSON.stringify(ctx) : ''),
  info: (msg: string, ctx?: Record<string, unknown>) =>
    log.info(msg, ctx ? JSON.stringify(ctx) : ''),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    log.warn(msg, ctx ? JSON.stringify(ctx) : ''),
  error: (msg: string, err?: unknown) => {
    if (err instanceof Error) {
      log.error(msg, err.message, err.stack)
    } else {
      log.error(msg, err ? JSON.stringify(err) : '')
    }
  },
}

export type Logger = typeof logger
