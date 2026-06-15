/**
 * 设置页（M4：LLM Provider 管理 + Token 用量统计）
 *
 * 以 modal 形式打开。Provider 列表/新增/编辑/删除/设默认/连通性测试。
 */
import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Trash2, Star, Loader2 } from 'lucide-react'
import { api, type LlmProvider, type LlmProviderInput, type UsageSummary } from '../api'

interface SettingsProps {
  onClose: () => void
}

export function Settings({ onClose }: SettingsProps) {
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [editing, setEditing] = useState<{ provider?: LlmProvider } | null>(null)

  const reload = useCallback(async () => {
    const [list, u] = await Promise.all([api['llm:listProviders'](), api['llm:getUsage']()])
    setProviders(list)
    setUsage(u)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始加载是合法模式
    reload().catch(() => {})
  }, [reload])

  if (editing) {
    return (
      <ProviderForm
        provider={editing.provider}
        onSaved={reload}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="page-connection-manager">
          <div className="page-header">
            <h1>⚙️ 设置</h1>
            <button className="btn-icon" onClick={onClose} title="关闭">
              <X size={16} />
            </button>
          </div>

          {/* Provider 列表 */}
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>LLM Provider</h2>
              <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
                <Plus size={12} /> 添加
              </button>
            </div>

            {providers.length === 0 ? (
              <div className="empty">
                还没有配置 Provider，点击「添加」创建第一个（支持 OpenAI 兼容接口）。
              </div>
            ) : (
              <div className="provider-list">
                {providers.map((p) => (
                  <div key={p.id} className="provider-card">
                    <div className="provider-info">
                      <span className="provider-name">
                        {p.name}
                        {p.isDefault && (
                          <span className="provider-default">
                            <Star size={10} /> 默认
                          </span>
                        )}
                      </span>
                      <span className="provider-url">{p.baseUrl}</span>
                      <span className="provider-models">
                        {p.models.join(' · ') || '未配置模型'}
                      </span>
                    </div>
                    <div className="provider-actions">
                      {!p.isDefault && (
                        <button
                          className="btn-icon"
                          title="设为默认"
                          onClick={() => {
                            api['llm:setDefaultProvider']({ id: p.id }).then(reload)
                          }}
                        >
                          <Star size={14} />
                        </button>
                      )}
                      <button
                        className="btn-icon"
                        title="编辑"
                        onClick={() => setEditing({ provider: p })}
                      >
                        ✎
                      </button>
                      <button
                        className="btn-icon ctx-danger"
                        title="删除"
                        onClick={async () => {
                          if (confirm(`删除 Provider「${p.name}」？`)) {
                            await api['llm:deleteProvider']({ id: p.id })
                            reload()
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Token 用量统计 */}
          {usage && (
            <div className="settings-section">
              <div className="settings-section-header">
                <h2>Token 用量统计</h2>
                {usage.totalCalls > 0 && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={async () => {
                      await api['llm:clearUsage']()
                      reload()
                    }}
                  >
                    清空
                  </button>
                )}
              </div>
              {usage.totalCalls === 0 ? (
                <div className="empty">暂无用量记录</div>
              ) : (
                <div className="usage-grid">
                  <div className="usage-stat">
                    <span className="usage-stat-value">{usage.totalTokens.toLocaleString()}</span>
                    <span className="usage-stat-label">总 Token</span>
                  </div>
                  <div className="usage-stat">
                    <span className="usage-stat-value">{usage.totalCalls}</span>
                    <span className="usage-stat-label">调用次数</span>
                  </div>
                  {usage.byProvider.map((item) => (
                    <div key={item.provider} className="usage-stat">
                      <span className="usage-stat-value">{item.totalTokens.toLocaleString()}</span>
                      <span className="usage-stat-label">
                        {item.provider} · {item.calls} 次
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Provider 表单（新增/编辑） */
function ProviderForm({
  provider,
  onSaved,
  onCancel,
}: {
  provider?: LlmProvider
  onSaved: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(provider?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? 'https://api.deepseek.com/v1')
  const [models, setModels] = useState((provider?.models ?? []).join(', '))
  const [apiKey, setApiKey] = useState('')
  const [isDefault, setIsDefault] = useState(provider?.isDefault ?? false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buildInput = (): LlmProviderInput => ({
    name: name.trim(),
    baseUrl: baseUrl.trim(),
    models: models
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    apiKey: apiKey || undefined,
    isDefault,
  })

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api['llm:testProvider'](buildInput())
      setTestResult({ success: result.success, message: result.message })
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('请输入名称')
      return
    }
    if (!baseUrl.trim()) {
      setError('请输入 Base URL')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const input = buildInput()
      if (provider) {
        await api['llm:updateProvider']({ id: provider.id, input })
      } else {
        await api['llm:createProvider'](input)
      }
      onSaved()
      onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="settings-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="page-connection-manager">
          <div className="page-header">
            <h1>{provider ? '编辑 Provider' : '添加 Provider'}</h1>
            <button className="btn-icon" onClick={onCancel}>
              <X size={16} />
            </button>
          </div>

          <div className="connection-form">
            <div className="form-field">
              <label>名称 *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="DeepSeek"
              />
            </div>
            <div className="form-field">
              <label>Base URL *</label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com/v1"
              />
              <span className="hint">OpenAI 兼容接口，通常以 /v1 结尾</span>
            </div>
            <div className="form-field">
              <label>模型列表 *</label>
              <input
                value={models}
                onChange={(e) => setModels(e.target.value)}
                placeholder="deepseek-chat, deepseek-reasoner"
              />
              <span className="hint">逗号分隔多个模型</span>
            </div>
            <div className="form-field">
              <label>API Key {provider && <span className="hint">（留空保持不变）</span>}</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
              <span className="hint">存入系统 Keychain，不落库</span>
            </div>
            <div className="form-field">
              <label>
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  style={{ width: 'auto', marginRight: 6 }}
                />
                设为默认 Provider
              </label>
            </div>

            {testResult && (
              <div className={`form-test-result ${testResult.success ? 'success' : 'error'}`}>
                {testResult.success ? '✅ ' : '❌ '}
                {testResult.message}
              </div>
            )}
            {error && <div className="form-error">{error}</div>}

            <div className="form-actions">
              <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
                取消
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleTest}
                disabled={testing || saving}
              >
                {testing ? (
                  <>
                    <Loader2 size={12} className="spin" /> 测试中…
                  </>
                ) : (
                  '测试连接'
                )}
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中…' : provider ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
