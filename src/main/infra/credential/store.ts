/**
 * 凭据存储抽象接口
 *
 * 密码不入本地数据库，通过此接口存取（macOS Keychain / Win Vault）。
 * 主密码加密兜底（Linux 无 keyring 时）留到后续。
 */

/** 凭据存储接口 */
export interface CredentialStore {
  /** 获取密码；不存在返回 null */
  getPassword(connectionId: string): Promise<string | null>
  /** 保存密码 */
  setPassword(connectionId: string, password: string): Promise<void>
  /** 删除密码 */
  deletePassword(connectionId: string): Promise<void>
}

/** keychain 服务名（Keychain 里的 service 字段） */
const SERVICE_NAME = 'ai-db-client'

/**
 * 基于 keytar 的 Keychain 实现（macOS Keychain / Win Credential Vault / Linux Secret Service）
 */
class KeychainCredentialStore implements CredentialStore {
  async getPassword(connectionId: string): Promise<string | null> {
    const keytar = await import('keytar')
    return keytar.getPassword(SERVICE_NAME, connectionId)
  }

  async setPassword(connectionId: string, password: string): Promise<void> {
    const keytar = await import('keytar')
    await keytar.setPassword(SERVICE_NAME, connectionId, password)
  }

  async deletePassword(connectionId: string): Promise<void> {
    const keytar = await import('keytar')
    await keytar.deletePassword(SERVICE_NAME, connectionId)
  }
}

let store: CredentialStore | null = null

/** 获取凭据存储实例（单例） */
export function getCredentialStore(): CredentialStore {
  if (!store) {
    store = new KeychainCredentialStore()
  }
  return store
}

/** 测试用：注入 mock store */
export function setCredentialStore(mock: CredentialStore): void {
  store = mock
}
