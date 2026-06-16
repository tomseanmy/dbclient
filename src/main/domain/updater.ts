/**
 * 应用自动更新核心模块（基于 electron-updater）
 *
 * 职责：
 * - 封装 autoUpdater 的初始化与事件监听
 * - 把更新状态/进度通过 IPC 事件推送给渲染进程
 * - 对外暴露 checkForUpdates / quitAndInstall / getStatus
 * - dev 模式拦截（autoUpdater 仅在打包后可用）
 * - 启动后台自动检查（24h 节流，静默不打扰）
 *
 * 更新源：GitHub Releases 的 latest*.yml（release.yml 已上传），
 *         electron-builder 据电子 publish.github 在产物里生成 app-update.yml，
 *         autoUpdater 启动时自动读取，无需 setFeedURL。
 *
 * 体验对标 Chrome/VSCode：发现新版本 → 后台自动下载 → 下载完成提示重启 → 重启即生效。
 */
import { app, BrowserWindow } from 'electron'
import { autoUpdater, type UpdateInfo as UpdateInfoExt } from 'electron-updater'
import { logger } from '@main/infra/logger'
import { getAllSettings, setSetting } from '@main/infra/storage/settings-dao'
import type { UpdateStatus, UpdateInfo } from '@shared/types/update'

/** 启动自动检查的节流间隔（24h），避免每次启动都请求 GitHub */
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** app_settings 中记录上次检查时间的 key */
const LAST_CHECK_KEY = 'updater.lastCheck'

/**
 * 读取上次检查时间戳。DB 未就绪时返回 0（视为「从未检查」）。
 * 复用 app_settings KV 表，避免引入 electron-store（其 v11 为 ESM-only，
 * 与 electron-vite 的 main CJS 产物不兼容）。
 */
function getLastCheck(): number {
  try {
    const raw = getAllSettings()[LAST_CHECK_KEY]
    return raw ? Number.parseInt(raw, 10) || 0 : 0
  } catch {
    return 0
  }
}

/** 写入上次检查时间戳。DB 未就绪时静默跳过（不影响本次检查流程）。 */
function setLastCheck(ts: number): void {
  try {
    setSetting(LAST_CHECK_KEY, String(ts))
  } catch {
    // 忽略：启动早期 DB 偶发未就绪，下次检查会重写
  }
}

/** 当前更新状态机（模块级单例，供 handler 同步查询） */
let currentStatus: UpdateStatus = 'idle'
/** 当前新版本信息（checking→available 后填充，原始 electron-updater 类型） */
let currentInfo: UpdateInfoExt | undefined
/** 下载进度百分比（0-100） */
let currentProgress = 0
/** 最近一次错误信息 */
let currentError: string | undefined

/** true 时「无更新」不提示（启动自动检查用）；false 时提示「已是最新」 */
let silentCheck = false

/** 是否已注册过事件监听（initUpdater 只注册一次） */
let listenersBound = false

/**
 * 把更新信息序列化为可跨 IPC 传输的子集。
 * electron-updater 的 UpdateInfo 字段较多，这里只取 UI 需要的；
 * releaseNotes 可能是 ReleaseNoteInfo[]，此处只透传 string|null 形式。
 */
function toUpdateInfo(info: UpdateInfoExt | undefined): UpdateInfo | undefined {
  if (!info) return undefined
  return {
    version: info.version,
    releaseName: info.releaseName,
    // releaseNotes 可能是结构化数组，UI 只用字符串形式
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    releaseDate: info.releaseDate,
  }
}

/** 取得主窗口（用于推送 IPC 事件），不存在时静默跳过 */
function getMainWindow(): BrowserWindow | undefined {
  const windows = BrowserWindow.getAllWindows()
  // 取第一个可见窗口作为主窗口；dev/prod 下主窗口总是首个
  return windows.find((w) => !w.isDestroyed()) ?? windows[0]
}

/** 向渲染进程广播状态变化 */
function emitStateChanged(): void {
  const win = getMainWindow()
  win?.webContents.send('update:stateChanged', {
    status: currentStatus,
    info: toUpdateInfo(currentInfo),
    errorMessage: currentError,
  })
}

/** 向渲染进程广播下载进度 */
function emitDownloadProgress(percent: number, transferred: number, total: number): void {
  const win = getMainWindow()
  win?.webContents.send('update:downloadProgress', { percent, transferred, total })
}

/**
 * 注册 autoUpdater 全部事件监听（仅注册一次）。
 * 每个事件更新模块级状态机，并推送给渲染进程。
 */
function bindListeners(): void {
  if (listenersBound) return
  listenersBound = true

  // 开始检查更新
  autoUpdater.on('checking-for-update', () => {
    logger.info('更新检查开始')
    currentStatus = 'checking'
    currentError = undefined
    emitStateChanged()
  })

  // 发现新版本（autoDownload=true 时随后自动下载）
  autoUpdater.on('update-available', (info) => {
    logger.info('发现新版本', { version: info.version })
    currentStatus = 'available'
    currentInfo = info
    emitStateChanged()
  })

  // 已是最新版本：仅手动检查时提示，静默检查不打扰
  autoUpdater.on('update-not-available', (info) => {
    logger.info('已是最新版本', info ? { version: info.version } : undefined)
    currentStatus = 'up-to-date'
    currentInfo = info
    // 静默检查不广播「已是最新」，避免打扰；手动检查始终广播
    if (!silentCheck) emitStateChanged()
  })

  // 下载进度（electron-updater 高频触发，UI 端已做节流渲染）
  let lastEmit = 0
  autoUpdater.on('download-progress', (progress) => {
    currentStatus = 'downloading'
    currentProgress = Math.round(progress.percent)
    // 主进程侧节流：最多每 200ms 推一次，避免 IPC 风暴
    const now = Date.now()
    if (now - lastEmit > 200) {
      lastEmit = now
      emitDownloadProgress(currentProgress, progress.transferred, progress.total)
    }
  })

  // 下载完成：提示「重启以更新」
  autoUpdater.on('update-downloaded', (info) => {
    logger.info('更新下载完成', { version: info.version })
    currentStatus = 'downloaded'
    currentInfo = info
    currentProgress = 100
    emitStateChanged()
  })

  // 出错：记录并广播（仅手动检查或下载阶段出错才提示）
  autoUpdater.on('error', (err) => {
    logger.error('更新出错', err)
    const message = err instanceof Error ? err.message : String(err)
    currentStatus = 'error'
    currentError = message
    if (!silentCheck) emitStateChanged()
  })
}

/**
 * 初始化更新模块（应用启动时调用一次）。
 * dev 模式下不接入 autoUpdater（打包外运行会报错），仅记录日志。
 */
export function initUpdater(): void {
  if (!app.isPackaged) {
    logger.info('开发模式：跳过自动更新初始化')
    return
  }

  // 标准化 electron-updater 行为
  autoUpdater.autoDownload = true // 发现新版本自动后台下载（Chrome 行为）
  autoUpdater.autoInstallOnAppQuit = true // 退出时自动安装已下载的更新（默认即 true）
  autoUpdater.logger = logger as never // 复用 electron-log（类型放宽，运行时兼容）

  bindListeners()
  logger.info('自动更新模块已初始化')
}

/**
 * 触发检查更新。
 * @param silent true 时「无更新/网络错误」不打扰用户（启动自动检查用）
 */
export async function checkForUpdates(
  silent = false,
): Promise<{ status: UpdateStatus; info?: ReturnType<typeof toUpdateInfo> }> {
  silentCheck = silent

  // dev 模式：autoUpdater 在打包外运行会报错，不真正请求 GitHub。
  // 非静默（用户手动点击）时给出明确反馈，避免按钮像没反应一样。
  if (!app.isPackaged) {
    if (!silent) {
      currentStatus = 'error'
      currentError = '开发环境下自动更新不可用（需打包后验证）'
      emitStateChanged()
    }
    return { status: currentStatus, info: toUpdateInfo(currentInfo) }
  }

  // 记录本次检查时间（用于启动节流）
  setLastCheck(Date.now())

  try {
    const result = await autoUpdater.checkForUpdates()
    return {
      status: currentStatus,
      info: toUpdateInfo(result?.updateInfo ?? currentInfo),
    }
  } catch (err) {
    // checkForUpdates 抛错时 autoUpdater 的 error 事件也会触发，状态已被设为 error
    logger.error('checkForUpdates 失败', err)
    return { status: 'error', info: toUpdateInfo(currentInfo) }
  }
}

/** 下载完成后触发：退出当前应用并启动安装程序（重启即新版本） */
export function quitAndInstall(): void {
  if (!app.isPackaged) return
  logger.info('用户确认：重启并安装更新')
  autoUpdater.quitAndInstall()
}

/** 查询当前更新状态（供渲染层初始化同步） */
export function getStatus(): {
  status: UpdateStatus
  info?: ReturnType<typeof toUpdateInfo>
  progress: number
  errorMessage?: string
} {
  return {
    status: currentStatus,
    info: toUpdateInfo(currentInfo),
    progress: currentProgress,
    errorMessage: currentError,
  }
}

/**
 * 启动时的后台自动检查（带 24h 节流）。
 * 仅在打包模式且距上次检查超过间隔时执行，静默不打扰。
 */
export function maybeAutoCheckOnStartup(): void {
  if (!app.isPackaged) return

  const last = getLastCheck()
  if (Date.now() - last < AUTO_CHECK_INTERVAL_MS) {
    logger.info('距上次检查不足 24h，跳过启动自动检查')
    return
  }

  // 延迟 10s 检查：避免与启动初始化（DB 连接、窗口加载）抢资源
  setTimeout(() => {
    checkForUpdates(true).catch((err) => logger.error('启动自动检查失败', err))
  }, 10_000)
}
