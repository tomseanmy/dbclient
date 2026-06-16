/**
 * 流式对话 streamId 生成（AiChat / AgentWorkspace 共用）
 *
 * streamId 用于主进程管理活跃的流（AbortController），
 * 渲染进程用它过滤自己订阅的事件，避免并发流串扰。
 */

/**
 * 生成简易唯一 streamId（足够区分并发流）。
 * @param prefix 前缀，用于区分流类型（如 's' 普通对话、'a' AGENT）
 */
export function genStreamId(prefix: string = 's'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
