/**
 * Electron 主进程入口
 *
 * 启动流程：
 *   app.whenReady()
 *     → 初始化日志
 *     → 单实例锁
 *     → 初始化本地数据库
 *     → 注册 IPC handler
 *     → 创建主窗口
 *     → 全局错误兜底
 */
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { logger } from './infra/logger'
import { initDb, closeDb } from './infra/storage/db'
import { registerAllHandlers } from './ipc/registry'
import { closeAll as closeAllConnections } from './domain/db/manager'

// ===== 单实例锁：防止多开导致本地库/MCP 端口冲突 =====
if (!app.requestSingleInstanceLock()) {
  logger.warn('已有实例运行，退出当前进程')
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false, // ready-to-show 后再显示，避免白屏
    title: 'AI DB Client',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, // 安全：隔离 Node 与渲染上下文
      nodeIntegration: false, // 安全：渲染进程不直连 Node
      sandbox: true, // 安全：沙箱化
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 外部链接在系统浏览器打开，不在应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // dev: 加载 dev server；prod: 加载打包产物
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ===== macOS：关闭窗口不退出，dock 图标点击重建窗口 =====
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// ===== 退出前清理 =====
app.on('before-quit', async () => {
  await closeAllConnections()
  closeDb()
})

// ===== 启动主流程 =====
app.whenReady().then(async () => {
  logger.info('应用启动', { version: app.getVersion(), platform: process.platform })

  try {
    initDb()
    await registerAllHandlers()
    createWindow()
    logger.info('应用就绪')
  } catch (err) {
    logger.error('启动失败', err)
    // 致命错误：提示用户后退出
    throw err
  }
})

// ===== 全局错误兜底 =====
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', err)
})

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason)
})
