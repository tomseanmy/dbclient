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
import { app, BrowserWindow, shell, Menu, nativeImage } from 'electron'
import { join } from 'node:path'
import { logger } from './infra/logger'
import { initDb, closeDb } from './infra/storage/db'
import { getAllSettings } from './infra/storage/settings-dao'
import { registerAllHandlers } from './ipc/registry'
import { closeAll as closeAllConnections } from './domain/db/manager'
import { initUpdater, maybeAutoCheckOnStartup } from './domain/updater'
import { initMainI18n, tMain } from './i18n'

/** 应用显示名（菜单栏首项 / About 标题） */
const APP_NAME = 'DB Client'

/**
 * 解析应用图标路径。
 * - 打包后：图标随 extraResources 解包到 <app>/resources/icon.png
 * - 开发期：使用项目根 build/icon.png
 * macOS 的 dock/About 图标由 .icns 直接提供，此处仅 win/linux 与窗口图标使用。
 */
function resolveIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')
}

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
    iconPath: resolveIconPath(),
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
          label: tMain('menu.edit'),
          submenu: [
            { role: 'undo', label: tMain('menu.undo') },
            { role: 'redo', label: tMain('menu.redo') },
            { type: 'separator' },
            { role: 'cut', label: tMain('menu.cut') },
            { role: 'copy', label: tMain('menu.copy') },
            { role: 'paste', label: tMain('menu.paste') },
            { role: 'selectAll', label: tMain('menu.selectAll') },
          ],
        },
        {
          label: tMain('menu.view'),
          submenu: [
            { role: 'reload', label: tMain('menu.reload') },
            { role: 'forceReload', label: tMain('menu.forceReload') },
            { role: 'toggleDevTools', label: tMain('menu.devTools') },
            { type: 'separator' },
            { role: 'resetZoom', label: tMain('menu.resetZoom') },
            { role: 'zoomIn', label: tMain('menu.zoomIn') },
            { role: 'zoomOut', label: tMain('menu.zoomOut') },
            { type: 'separator' },
            { role: 'togglefullscreen', label: tMain('menu.fullscreen') },
          ],
        },
        {
          label: tMain('menu.window'),
          submenu: [
            { role: 'minimize', label: tMain('menu.minimize') },
            { role: 'zoom', label: tMain('menu.zoom') },
            { type: 'separator' },
            { role: 'front' },
          ],
        },
      ]
    : [
        {
          label: tMain('menu.file'),
          submenu: [isMac ? { role: 'close' } : { role: 'quit', label: tMain('menu.quit') }],
        },
        {
          label: tMain('menu.edit'),
          submenu: [
            { role: 'undo', label: tMain('menu.undo') },
            { role: 'redo', label: tMain('menu.redo') },
            { type: 'separator' },
            { role: 'cut', label: tMain('menu.cut') },
            { role: 'copy', label: tMain('menu.copy') },
            { role: 'paste', label: tMain('menu.paste') },
            { role: 'selectAll', label: tMain('menu.selectAll') },
          ],
        },
        {
          label: tMain('menu.view'),
          submenu: [
            { role: 'reload', label: tMain('menu.reload') },
            { role: 'forceReload', label: tMain('menu.forceReload') },
            { role: 'toggleDevTools', label: tMain('menu.devTools') },
            { type: 'separator' },
            { role: 'resetZoom', label: tMain('menu.resetZoom') },
            { role: 'zoomIn', label: tMain('menu.zoomIn') },
            { role: 'zoomOut', label: tMain('menu.zoomOut') },
            { type: 'separator' },
            { role: 'togglefullscreen', label: tMain('menu.fullscreen') },
          ],
        },
      ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'
  // Linux 无原生 acrylic/vibrancy，用不透明实色兜底；
  // mac/Win 侧栏要穿透窗体透出桌面，窗口背景必须透明。
  const transparentWindow = isMac || isWin
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: nativeImage.createFromPath(resolveIconPath()),
    // mac：hiddenInset 保留红绿灯；win/linux：hidden 去掉原生大标题栏，保留可缩放边框
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac && { trafficLightPosition: { x: 13, y: 14 } }),
    show: false, // ready-to-show 后再显示，避免白屏
    title: 'AI DB Client',
    // 窗口背景色：
    // - mac/Win：必须透明（#00000000），否则 vibrancy/acrylic 被实色挡死，无法透出桌面；
    // - Linux：不透明实色（暗岩灰）防启动白屏。
    backgroundColor: transparentWindow ? '#00000000' : '#191a1c',
    // mac/Win：原生透明穿透，让侧栏区域真正透到桌面
    ...(transparentWindow && { transparent: true }),
    // macOS 毛玻璃：侧栏透出桌面（仅 mac 生效）
    ...(isMac && { vibrancy: 'under-window', visualEffectState: 'active' }),
    // Win11 亚克力磨砂：半透明+模糊，深浅自动跟随 nativeTheme（theme:apply 已接通）
    ...(isWin && { backgroundMaterial: 'acrylic' }),
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
    // 初始化主进程 i18n（读本地设置 language；重启生效策略）
    await initMainI18n(getAllSettings().language)
    setupAppMenu()
    await registerAllHandlers()
    createWindow()
    // 自动更新：初始化 + 启动后台静默检查（24h 节流，打包模式才生效）
    initUpdater()
    maybeAutoCheckOnStartup()
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
