/**
 * 右键菜单「点击外部关闭」逻辑（App / ObjectTree 共用）
 *
 * 当菜单处于打开态时，监听 window 的 click / contextmenu 事件以关闭菜单；
 * 菜单关闭后自动移除监听。行为与原内联 useEffect 一致，仅提取为可复用 hook。
 */
import { useEffect, useRef } from 'react'

/**
 * @param isOpen 菜单是否处于打开态
 * @param close  关闭菜单的回调（清空菜单 state）
 */
export function useContextMenuClose(isOpen: boolean, close: () => void): void {
  // close 用 ref 承载，避免每次渲染的新闭包导致监听器重挂载；
  // close 通常是 setXxx(null)，不依赖外部闭包变量，ref 承载行为等价且更高效。
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })

  useEffect(() => {
    if (!isOpen) return
    const handler = (): void => closeRef.current()
    window.addEventListener('click', handler)
    window.addEventListener('contextmenu', handler)
    return () => {
      window.removeEventListener('click', handler)
      window.removeEventListener('contextmenu', handler)
    }
  }, [isOpen])
}
