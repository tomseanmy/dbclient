/**
 * IPC 结构化错误解析（渲染进程侧）
 *
 * 主进程 registry 在序列化领域错误时，把结构化字段以 JSON 附在 message 末尾
 * （前缀 __ipc_error_data__:）。前端可通过 parseIpcError() 还原这些字段。
 *
 * 不解析时，err.message 的人类可读部分（前缀 `\n__ipc_error_data__:` 之前）
 * 仍可直接展示，向后兼容现有的 `err instanceof Error ? err.message` 用法。
 */

/** 结构化错误前缀（须与 src/main/ipc/registry.ts 的常量一致） */
const IPC_ERROR_DATA_PREFIX = '__ipc_error_data__:'

/** 解析后的结构化错误 */
export interface ParsedIpcError {
  /** 人类可读的错误消息（去除序列化后缀后的部分） */
  message: string
  /** 错误类名（如 'PermissionDeniedError'） */
  name: string
  /** 结构化数据（领域错误类暴露的字段，如 checkResult / sql） */
  data?: Record<string, unknown>
}

/**
 * 解析 IPC 错误。若 message 含结构化后缀，返回还原后的 message/name/data；
 * 否则原样返回（普通错误）。
 */
export function parseIpcError(err: unknown): ParsedIpcError {
  const rawMessage = err instanceof Error ? err.message : String(err)
  const idx = rawMessage.indexOf('\n' + IPC_ERROR_DATA_PREFIX)
  if (idx === -1) {
    return { message: rawMessage, name: err instanceof Error ? err.name : 'Error' }
  }
  const message = rawMessage.slice(0, idx)
  const jsonStr = rawMessage.slice(idx + 1 + IPC_ERROR_DATA_PREFIX.length)
  try {
    const parsed = JSON.parse(jsonStr) as { name?: string; data?: Record<string, unknown> }
    return {
      message,
      name: parsed.name ?? 'Error',
      data: parsed.data,
    }
  } catch {
    // 序列化数据损坏：回退为普通错误
    return { message, name: 'Error' }
  }
}
