/**
 * 连接表单组件（新建/编辑）
 *
 * 根据数据库类型动态显示字段。
 */
import { useState, useEffect } from 'react'
import { CheckCircle, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  api,
  type ConnectionInput,
  type ConnectionListItem,
  type DbType,
  type Environment,
} from '../api'
import { DB_LABELS, DEFAULT_PORTS, ENV_LABELS, ENV_COLORS } from '../store/connections'
import { parseIpcError } from '../lib/ipc-error'

interface ConnectionFormProps {
  /** 编辑时传入现有连接，新建时为 null */
  initial?: ConnectionListItem | null
  onSave: () => void
  onCancel: () => void
}

const DB_TYPES: DbType[] = ['mysql', 'postgres', 'sqlite', 'redis']
const ENVIRONMENTS: Environment[] = ['dev', 'staging', 'prod']

export function ConnectionForm({ initial, onSave, onCancel }: ConnectionFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<DbType>(initial?.type ?? 'mysql')
  const [host, setHost] = useState(initial?.host ?? 'localhost')
  const [port, setPort] = useState(initial?.port ?? DEFAULT_PORTS[type])
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState('')
  const [database, setDatabase] = useState(initial?.database ?? '')
  const [environment, setEnvironment] = useState<Environment>(initial?.environment ?? 'dev')
  const [color, setColor] = useState(initial?.color ?? '')

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
    fileNotFound?: boolean
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 切换类型时重置默认端口
  useEffect(() => {
    if (!initial) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换数据库类型时重置字段是合法模式
      setPort(DEFAULT_PORTS[type])
      if (type === 'sqlite') {
        setHost('')
        setPort(0)
        setDatabase('')
      }
    }
  }, [type, initial])

  const buildInput = (): ConnectionInput => ({
    name,
    type,
    host: type === 'sqlite' ? undefined : host,
    port: type === 'sqlite' || type === 'redis' ? port || undefined : port,
    username: type === 'sqlite' ? undefined : username,
    password: password || undefined,
    database,
    environment,
    color: color || undefined,
    sortOrder: initial?.sortOrder ?? 0,
  })

  const handleTest = async (opts?: { createFile?: boolean }) => {
    setTesting(true)
    setTestResult(null)
    try {
      const input = buildInput()
      if (opts?.createFile) {
        input.options = { ...input.options, extra: { createIfNotExist: true } }
      }
      // 编辑场景带上 id：密码留空时后端回退取已存密码测试
      const result = await api['connection:test']({
        ...input,
        id: initial?.id,
      })
      setTestResult(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const parsed = parseIpcError(err)
      // SQLite 文件不存在的特殊处理（按结构化错误名识别）
      if (parsed.name === 'FileNotFound') {
        setTestResult({
          success: false,
          message: parsed.message,
          fileNotFound: true,
        })
      } else {
        setTestResult({ success: false, message: msg })
      }
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('connection.nameRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (initial) {
        await api['connection:update']({ id: initial.id, input: buildInput() })
      } else {
        await api['connection:create'](buildInput())
      }
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const isSqlite = type === 'sqlite'

  return (
    <div className="connection-form-modal">
      <div className="connection-form-modal-body">
        <div className="form-field">
          <label>{t('connection.type')}</label>
          <div className="type-selector">
            {DB_TYPES.map((t) => (
              <button
                key={t}
                className={`type-btn ${type === t ? 'active' : ''}`}
                onClick={() => setType(t)}
                type="button"
              >
                {DB_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="form-field">
          <label>{t('connection.name')} *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('connection.namePlaceholder')}
          />
        </div>

        <div className="form-field">
          <label>{t('connection.environment')}</label>
          <div className="env-selector">
            {ENVIRONMENTS.map((env) => (
              <button
                key={env}
                className={`env-btn ${environment === env ? 'active' : ''}`}
                style={
                  environment === env
                    ? { borderColor: ENV_COLORS[env], color: ENV_COLORS[env] }
                    : {}
                }
                onClick={() => setEnvironment(env)}
                type="button"
              >
                {ENV_LABELS[env]}
              </button>
            ))}
          </div>
        </div>

        {!isSqlite && (
          <>
            <div className="form-row">
              <div className="form-field">
                <label>{t('connection.host')}</label>
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="localhost"
                />
              </div>
              <div className="form-field form-field-port">
                <label>{t('connection.port')}</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="form-field">
              <label>{t('connection.username')}</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="root"
              />
            </div>

            <div className="form-field">
              <label>
                {t('connection.password')}{' '}
                {initial && <span className="hint">{t('connection.passwordKeepHint')}</span>}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </>
        )}

        <div className="form-field">
          <label>
            {isSqlite
              ? t('connection.dbFilePath')
              : type === 'redis'
                ? t('connection.dbIndex')
                : t('connection.dbName')}
          </label>
          <input
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder={isSqlite ? '/path/to/database.db' : type === 'redis' ? '0' : 'mydb'}
          />
        </div>

        <div className="form-field">
          <label>{t('connection.colorTag')}</label>
          <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#3b82f6" />
        </div>

        {error && <div className="form-error">{error}</div>}
        {testResult && (
          <div className={`form-test-result ${testResult.success ? 'success' : 'error'}`}>
            {testResult.success ? (
              <CheckCircle size={12} style={{ display: 'inline' }} />
            ) : (
              <XCircle size={12} style={{ display: 'inline' }} />
            )}
            {testResult.message}
            {testResult.fileNotFound && (
              <button
                className="btn btn-primary btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => handleTest({ createFile: true })}
                disabled={testing}
              >
                {t('connection.createAndTest')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="form-actions connection-form-modal-footer">
        <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => handleTest()}
          disabled={testing || saving}
        >
          {testing ? t('connection.testing') : t('connection.testConnection')}
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? t('connection.saving') : initial ? t('common.save') : t('connection.create')}
        </button>
      </div>
    </div>
  )
}
