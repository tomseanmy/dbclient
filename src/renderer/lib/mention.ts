/**
 * #mention（@数据库/表 自动补全）相关纯函数（AgentWorkspace 用）
 *
 * 这些是纯函数（无 React 依赖），从 AgentWorkspace 提取以便单测与复用。
 * mention 的状态管理（候选计算 / 选中 / 应用）仍留在组件内。
 */

/** 由连接生成 #mention 标签（# + 连接名） */
export function makeMentionTag(connName: string): string {
  return `#${connName}`
}

/** mention 上下文：连接（#db）或表（#db 之后的单词 / @触发的表补全） */
export type MentionContext =
  | { kind: 'connection'; query: string }
  | { kind: 'table'; query: string; connTag: string }
  | null

/**
 * 检测 textarea 当前光标处的 mention 上下文：
 * - 连接上下文：光标在「#...」标签内（# 与光标间无空白）→ 弹连接候选。
 * - 表上下文（两种触发）：
 *   1) 光标在「#连接名 」之后的单词内 → 弹该连接下的表候选。
 *   2) 光标在「@单词」内（@ 位于行首或空白后）→ 弹「当前生效连接」的表候选。
 * 否则返回 null。
 *
 * @ 触发的表上下文 connTag 为空串，表示「用当前生效连接」（由组件解析 activeConn）。
 */
export function detectMention(el: HTMLTextAreaElement): MentionContext {
  const { selectionStart, selectionEnd, value } = el
  if (selectionStart !== selectionEnd) return null
  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionEnd)

  // —— @ 表补全：@ 位于行首或空白后，@ 与光标间无空白 ——
  const atIdx = before.lastIndexOf('@')
  // 取 # 与 @ 中更靠近光标的一个，避免二者并存时误判
  const hashIdx = before.lastIndexOf('#')
  if (atIdx > hashIdx && atIdx !== -1) {
    const prevChar = before[atIdx - 1]
    const atLineStartOrSpace = prevChar === undefined || /\s/.test(prevChar)
    const queryPart = before.slice(atIdx + 1)
    if (atLineStartOrSpace && !/\s/.test(queryPart) && /^\s|$/.test(after)) {
      // connTag 空串 = 当前生效连接
      return { kind: 'table', query: queryPart, connTag: '' }
    }
  }

  // —— # 连接上下文：最近一个未闭合的 # ——
  if (hashIdx !== -1) {
    const prevChar = before[hashIdx - 1]
    const atLineStartOrSpace = prevChar === undefined || /\s/.test(prevChar)
    const tagPart = before.slice(hashIdx + 1)
    if (atLineStartOrSpace && !/\s/.test(tagPart)) {
      return { kind: 'connection', query: tagPart }
    }
    // #tag 后已有空白：尝试表上下文
    const tagMatch = tagPart.match(/^([\w-]+)\s+(\S*)$/)
    if (atLineStartOrSpace && tagMatch) {
      const connTag = tagMatch[1]!
      const tableQuery = tagMatch[2]!
      // 光标必须紧接在该单词内（单词后无更多非空白内容）
      if (/^\s|$/.test(after)) {
        return { kind: 'table', query: tableQuery, connTag }
      }
    }
  }
  return null
}

/** textarea 自适应高度：内容增多时向上扩展，封顶 200px */
export function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}
