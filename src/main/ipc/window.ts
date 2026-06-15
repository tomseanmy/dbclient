/**
 * window:* IPC handler —— 自绘标题栏的窗口控制（win/linux）
 *
 * 通过 BrowserWindow.fromWebContents(event.sender) 拿到调用方所在窗口，
 * 无需导出 mainWindow，与现有 handler 签名一致。
 */
import { BrowserWindow } from 'electron'
import { registerHandler } from './registry'

export function registerWindowHandlers(): void {
  registerHandler('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  registerHandler('window:maximizeToggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  registerHandler('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  registerHandler('window:isMaximized', (event) => {
    return Boolean(BrowserWindow.fromWebContents(event.sender)?.isMaximized())
  })
}
