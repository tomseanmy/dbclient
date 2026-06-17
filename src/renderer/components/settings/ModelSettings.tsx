/**
 * 模型设置（设置 modal 中的「模型设置」面板）
 *
 * 即原 Settings 页的 LLM Provider 管理 + Token 用量统计。
 * 由父级 Settings 外壳提供 modal 容器，本组件只渲染内容区。
 */
import { useTranslation } from 'react-i18next'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Loader2, CheckCircle, XCircle } from 'lucide-react'
import { api, type LlmProvider, type LlmProviderInput, type UsageSummary } from '../../api'
import { notify } from '../../services/notifications'
import { useLlmProviderStore } from '../../store/llm-providers'
import { useSettingsStore } from '../../store/settings'
import type { ModelDefault } from '@shared/types/settings'

export function ModelSettings() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [editing, setEditing] = useState<{ provider?: LlmProvider } | null>(null)

  const reload = useCallback(async () => {
    const [list, u] = await Promise.all([api['llm:listProviders'](), api['llm:getUsage']()])
    setProviders(list)
    setUsage(u)
    // 同步共享 store：Agent 模式左下角「选择模型」据此即时刷新
    await useLlmProviderStore.getState().refresh()
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
    <>
      {/* 默认模型：Agent / 补全 分类 */}
      <DefaultModelSection providers={providers} />

      {/* Provider 列表 */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>LLM Provider</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
            <Plus size={12} /> {t('modelSettings.add')}
          </button>
        </div>

        {providers.length === 0 ? (
          <div className="empty">{t('modelSettings.noProvider')}</div>
        ) : (
          <div className="provider-list">
            {providers.map((p) => (
              <div key={p.id} className="provider-card">
                <div className="provider-info">
                  <span className="provider-name">{p.name}</span>
                  <span className="provider-url">{p.baseUrl}</span>
                  <span className="provider-models">
                    {p.models.join(' · ') || t('modelSettings.noModels')}
                  </span>
                </div>
                <div className="provider-actions">
                  <button
                    className="btn-icon"
                    title={t('common.edit')}
                    onClick={() => setEditing({ provider: p })}
                  >
                    ✎
                  </button>
                  <button
                    className="btn-icon ctx-danger"
                    title={t('common.delete')}
                    onClick={async () => {
                      if (confirm(t('modelSettings.confirmDeleteProvider', { name: p.name }))) {
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
            <h2>{t('modelSettings.tokenUsage')}</h2>
            {usage.totalCalls > 0 && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  await api['llm:clearUsage']()
                  reload()
                }}
              >
                {t('modelSettings.clear')}
              </button>
            )}
          </div>
          {usage.totalCalls === 0 ? (
            <div className="empty">{t('modelSettings.noUsage')}</div>
          ) : (
            <div className="usage-grid">
              <div className="usage-stat">
                <span className="usage-stat-value">{usage.totalTokens.toLocaleString()}</span>
                <span className="usage-stat-label">{t('modelSettings.totalTokens')}</span>
              </div>
              <div className="usage-stat">
                <span className="usage-stat-value">{usage.totalCalls}</span>
                <span className="usage-stat-label">{t('modelSettings.callCount')}</span>
              </div>
              {usage.byProvider.map((item) => (
                <div key={item.provider} className="usage-stat">
                  <span className="usage-stat-value">{item.totalTokens.toLocaleString()}</span>
                  <span className="usage-stat-label">
                    {item.provider} · {t('modelSettings.callsUnit', { count: item.calls })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
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
  const { t } = useTranslation()
  const [name, setName] = useState(provider?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? 'https://api.deepseek.com/v1')
  const [models, setModels] = useState((provider?.models ?? []).join(', '))
  const [apiKey, setApiKey] = useState('')
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
  })

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api['llm:testProvider'](buildInput())
      setTestResult({ success: result.success, message: result.message })
      // 窗口失焦时提醒连通性测试完成（后台任务）
      if (result.success) {
        void notify('backgroundTask', t('modelSettings.testComplete'), result.message)
      }
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('modelSettings.form.nameRequired'))
      return
    }
    if (!baseUrl.trim()) {
      setError(t('modelSettings.form.baseUrlRequired'))
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
    <div className="settings-provider-form">
      <div className="connection-form">
        <div className="form-field">
          <label>{t('modelSettings.form.name')} *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="DeepSeek" />
        </div>
        <div className="form-field">
          <label>Base URL *</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
          />
          <span className="hint">{t('modelSettings.form.baseUrlHint')}</span>
        </div>
        <div className="form-field">
          <label>{t('modelSettings.form.models')} *</label>
          <input
            value={models}
            onChange={(e) => setModels(e.target.value)}
            placeholder="deepseek-chat, deepseek-reasoner"
          />
          <span className="hint">{t('modelSettings.form.modelsHint')}</span>
        </div>
        <div className="form-field">
          <label>
            {t('modelSettings.form.apiKey')}{' '}
            {provider && <span className="hint">{t('modelSettings.form.apiKeyKeepHint')}</span>}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
          <span className="hint">{t('modelSettings.form.apiKeyHint')}</span>
        </div>
        {testResult && (
          <div className={`form-test-result ${testResult.success ? 'success' : 'error'}`}>
            {testResult.success ? (
              <CheckCircle size={12} style={{ display: 'inline' }} />
            ) : (
              <XCircle size={12} style={{ display: 'inline' }} />
            )}
            {testResult.message}
          </div>
        )}
        {error && <div className="form-error">{error}</div>}

        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-secondary" onClick={handleTest} disabled={testing || saving}>
            {testing ? (
              <>
                <Loader2 size={12} className="spin" /> {t('modelSettings.form.testing')}
              </>
            ) : (
              t('modelSettings.form.testConnect')
            )}
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? t('connection.saving') : provider ? t('common.save') : t('connection.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 默认模型选择区：Agent 模型 / 补全模型 两个分类默认。
 * 每类各自选 Provider + 具体模型；两者可指向不同 Provider/模型。
 * 未配置时回退到第一个 Provider 的第一个模型（由网关兜底）。
 */
function DefaultModelSection({ providers }: { providers: LlmProvider[] }) {
  const { t } = useTranslation()
  const { settings, update } = useSettingsStore()

  const handleChange = async (kind: 'agent' | 'chat', value: ModelDefault | undefined) => {
    await update(kind === 'agent' ? { defaultAgentModel: value } : { defaultChatModel: value })
  }

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>{t('modelSettings.defaultModels.title')}</h2>
      </div>
      {providers.length === 0 ? (
        <div className="empty">{t('modelSettings.defaultModels.empty')}</div>
      ) : (
        <div className="default-model-list">
          <DefaultModelRow
            label={t('modelSettings.defaultModels.agentLabel')}
            hint={t('modelSettings.defaultModels.agentHint')}
            providers={providers}
            value={settings.defaultAgentModel}
            onChange={(v) => handleChange('agent', v)}
          />
          <DefaultModelRow
            label={t('modelSettings.defaultModels.chatLabel')}
            hint={t('modelSettings.defaultModels.chatHint')}
            providers={providers}
            value={settings.defaultChatModel}
            onChange={(v) => handleChange('chat', v)}
          />
        </div>
      )}
    </div>
  )
}

/** 单个默认模型行：Provider 选择 + 模型选择 */
function DefaultModelRow({
  label,
  hint,
  providers,
  value,
  onChange,
}: {
  label: string
  hint: string
  providers: LlmProvider[]
  value?: ModelDefault
  onChange: (v: ModelDefault | undefined) => void
}) {
  const { t } = useTranslation()
  // 当前选中的 provider（校验：若 value.providerId 已失效则为 null）
  const selectedProvider =
    (value?.providerId && providers.find((p) => p.id === value.providerId)) || null
  const providerId = selectedProvider?.id ?? ''
  // 当前选中的模型（校验：必须在所选 provider 的模型列表里）
  const model = value?.model && selectedProvider?.models.includes(value.model) ? value.model : ''

  const handleProviderChange = (newProviderId: string) => {
    if (!newProviderId) {
      onChange(undefined)
      return
    }
    const p = providers.find((x) => x.id === newProviderId)
    // 切换 provider 后，模型回退到该 provider 的第一个模型
    const firstModel = p?.models[0]
    onChange(firstModel ? { providerId: newProviderId, model: firstModel } : undefined)
  }

  const handleModelChange = (newModel: string) => {
    if (!providerId || !newModel) {
      onChange(undefined)
      return
    }
    onChange({ providerId, model: newModel })
  }

  return (
    <div className="default-model-row">
      <div className="default-model-label">
        <span className="default-model-name">{label}</span>
        <span className="default-model-hint">{hint}</span>
      </div>
      <div className="default-model-selects">
        <select
          className="default-model-select"
          value={providerId}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          <option value="">{t('modelSettings.form.notSelected')}</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="default-model-select"
          value={model}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={!providerId}
        >
          <option value="">
            {providerId ? t('modelSettings.form.selectModel') : t('modelSettings.form.dash')}
          </option>
          {selectedProvider?.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
