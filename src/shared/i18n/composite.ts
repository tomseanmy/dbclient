/**
 * 复合 i18n key：携带插值变量
 *
 * 背景：主进程产出的字符串中，部分需要插值（如
 *   「包含危险关键字: DROP」「DELETE 缺少 WHERE 子句」）。
 * 这些字符串跨 IPC 边界（SecurityCheckResult.analysis.reasons: string[]），
 * 为保持 string 类型不变，采用「key|vars」编码：
 *
 *   encode('security.analysis.dangerousKeyword', { keyword: 'DROP' })
 *     → 'security.analysis.dangerousKeyword|keyword=DROP'
 *
 * 渲染层用 translateReason() 解析并调用 t()。
 *
 * 支持纯 key（无插值，如 'security.policy.readonly'）与
 * 纯文本（非 key，如旧数据）——后者原样返回。
 */

/** 分隔符：key 与 vars 之间，vars 各项之间 */
const VARS_SEP = '|'
const PAIR_SEP = ';'
const KV_SEP = '='

/**
 * 把 i18n key + 插值变量编码为单个字符串。
 * @param key  i18n key（如 'security.analysis.dangerousKeyword'）
 * @param vars 可选插值变量
 */
export function encodeReason(key: string, vars?: Record<string, string | number>): string {
  if (!vars || Object.keys(vars).length === 0) return key
  const encoded = Object.entries(vars)
    .map(([k, v]) => `${k}${KV_SEP}${v}`)
    .join(PAIR_SEP)
  return `${key}${VARS_SEP}${encoded}`
}

/**
 * 渲染层用：把「复合 key 或纯 key 或纯文本」翻译为最终展示文本。
 *
 * 需要传入 t 函数（来自 react-i18next 的 useTranslation）。
 * - 复合 key（含 |）：解析 key + vars，调 t(key, vars)
 * - 纯 key（在 resources 中存在）：调 t(key)
 * - 纯文本（非 key，如旧数据/已翻译文本）：原样返回
 *
 * @param raw   原始字符串（主进程产出）
 * @param t     i18next 翻译函数
 */
export function translateReason(
  raw: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!raw) return raw
  // 复合 key：key|k1=v1;k2=v2
  const sepIdx = raw.indexOf(VARS_SEP)
  if (sepIdx !== -1) {
    const key = raw.slice(0, sepIdx)
    const varsPart = raw.slice(sepIdx + 1)
    const vars: Record<string, string> = {}
    for (const pair of varsPart.split(PAIR_SEP)) {
      const eqIdx = pair.indexOf(KV_SEP)
      if (eqIdx !== -1) {
        vars[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1)
      }
    }
    return t(key, vars)
  }
  // 纯 key 或纯文本：t() 对缺失 key 默认返回 key 本身（即原样）
  // 但若 raw 是旧版中文纯文本，t() 会返回原文 —— 这里做一次判定：
  // 只有当 raw 看起来像 key（含点号且无中文）时才走 t()
  if (raw.includes('.') && !/[\u4e00-\u9fff]/.test(raw)) {
    return t(raw)
  }
  return raw
}
