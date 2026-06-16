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
import { app, BrowserWindow, shell, Menu } from 'electron'
import { join } from 'node:path'
import { logger } from './infra/logger'
import { initDb, closeDb } from './infra/storage/db'
import { registerAllHandlers } from './ipc/registry'
import { closeAll as closeAllConnections } from './domain/db/manager'

/** 应用显示名（菜单栏首项 / About 标题） */
const APP_NAME = 'DB Client'

// ===== 单实例锁：防止多开导致本地库/MCP 端口冲突 =====
if (!app.requestSingleInstanceLock()) {
  logger.warn('已有实例运行，退出当前进程')
  app.quit()
}

let mainWindow: BrowserWindow | null = null

/**
 * 设置应用菜单 + About 面板。
 *
 * 自定义菜单模板，使菜单栏首项显示应用名（而非 "Electron"）。
 * About 面板通过 setAboutPanelOptions 填入准确的应用版本 + Electron 版本。
 * dev 模式下用 app.setName 让 mac 菜单首项取到应用名。
 */
function setupAppMenu(): void {
  const isMac = process.platform === 'darwin'

  // dev 模式：设置应用名，使 mac 菜单首项（role: appMenu）显示应用名而非 Electron
  if (!app.isPackaged) {
    app.setName(APP_NAME)
  }

  // About 面板：展示准确版本号
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: process.versions.electron, // Electron 版本（mac About 的 "Version" 行）
    copyright: 'MIT License',
    // win/linux About 对话框的额外信息
    credits: ``,
  })

  const template: Electron.MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: APP_NAME,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        {
          label: '编辑',
          submenu: [
            { role: 'undo', label: '撤销' },
            { role: 'redo', label: '重做' },
            { type: 'separator' },
            { role: 'cut', label: '剪切' },
            { role: 'copy', label: '复制' },
            { role: 'paste', label: '粘贴' },
            { role: 'selectAll', label: '全选' },
          ],
        },
        {
          label: '视图',
          submenu: [
            { role: 'reload', label: '重新加载' },
            { role: 'forceReload', label: '强制重新加载' },
            { role: 'toggleDevTools', label: '开发者工具' },
            { type: 'separator' },
            { role: 'resetZoom', label: '重置缩放' },
            { role: 'zoomIn', label: '放大' },
            { role: 'zoomOut', label: '缩小' },
            { type: 'separator' },
            { role: 'togglefullscreen', label: '全屏' },
          ],
        },
        {
          label: '窗口',
          submenu: [
            { role: 'minimize', label: '最小化' },
            { role: 'zoom', label: '缩放' },
            { type: 'separator' },
            { role: 'front' },
          ],
        },
      ]
    : [
        {
          label: '文件',
          submenu: [isMac ? { role: 'close' } : { role: 'quit', label: '退出' }],
        },
        {
          label: '编辑',
          submenu: [
            { role: 'undo', label: '撤销' },
            { role: 'redo', label: '重做' },
            { type: 'separator' },
            { role: 'cut', label: '剪切' },
            { role: 'copy', label: '复制' },
            { role: 'paste', label: '粘贴' },
            { role: 'selectAll', label: '全选' },
          ],
        },
        {
          label: '视图',
          submenu: [
            { role: 'reload', label: '重新加载' },
            { role: 'forceReload', label: '强制重新加载' },
            { role: 'toggleDevTools', label: '开发者工具' },
            { type: 'separator' },
            { role: 'resetZoom', label: '重置缩放' },
            { role: 'zoomIn', label: '放大' },
            { role: 'zoomOut', label: '缩小' },
            { type: 'separator' },
            { role: 'togglefullscreen', label: '全屏' },
          ],
        },
      ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    // mac：hiddenInset 保留红绿灯；win/linux：hidden 去掉原生大标题栏，保留可缩放边框
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac && { trafficLightPosition: { x: 13, y: 14 } }),
    show: false, // ready-to-show 后再显示，避免白屏
    title: 'AI DB Client',
    backgroundColor: '#191a1c', // 暗岩灰 rgb(25,26,28)，防止启动白屏
    // macOS 毛玻璃：侧栏透出桌面（仅 mac 生效）
    ...(isMac && { vibrancy: 'under-window', visualEffectState: 'active' }),
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
    setupAppMenu()
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
