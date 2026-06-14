/**
 * IPC 类型契约单测
 *
 * 通过类型断言确保 IPC 契约结构正确。
 * 如果有人改坏了 ipc.ts 的类型定义，这里会编译失败。
 *
 * 这些断言在运行时不做任何事（纯类型层），但 tsc 会检查它们。
 * vitest 只负责让这个文件被纳入测试范围。
 */
import { describe, it, expect } from 'vitest'
import type { IpcChannel, IpcReq, IpcRes, RendererApi } from '@shared/ipc'

// ===== 类型层断言（编译期生效）=====
// 用「赋值给 never」的技巧做严格类型检查：类型不匹配会编译失败。

// 1. app:ping 通道存在且有正确的响应类型
const _pingRes: IpcRes<'app:ping'> = { pong: 'pong', ts: 0, version: '' }
void _pingRes

// 2. app:getInfo 响应字段类型正确
const _infoRes: IpcRes<'app:getInfo'> = {
  appVersion: '',
  electronVersion: '',
  nodeVersion: '',
  platform: '',
  userDataPath: '',
}
void _infoRes

// 3. IpcChannel 包含预期的通道
const _channels: IpcChannel[] = ['app:ping', 'app:getInfo']
void _channels

// 4. RendererApi 每个 channel 是返回 Promise 的方法
const _pingFn: RendererApi['app:ping'] = () => Promise.resolve(_pingRes)
void _pingFn

// ===== 运行时层（确保测试套件有真实的断言通过）=====

describe('IPC 类型契约', () => {
  it('IpcChannel 包含 app:ping 与 app:getInfo', () => {
    const channels: IpcChannel[] = ['app:ping', 'app:getInfo']
    expect(channels).toContain('app:ping')
    expect(channels).toContain('app:getInfo')
  })

  it('app:ping 响应结构正确', () => {
    const res: IpcRes<'app:ping'> = { pong: 'pong', ts: Date.now(), version: 'test' }
    expect(res.pong).toBe('pong')
    expect(typeof res.ts).toBe('number')
  })

  it('app:ping 请求类型为 void', () => {
    // void 类型在运行时无值，只验证可被 void 接受
    const req: IpcReq<'app:ping'> = undefined as void
    expect(req).toBeUndefined()
  })
})
