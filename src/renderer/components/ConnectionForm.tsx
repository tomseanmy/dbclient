/**
 * 连接表单组件（新建/编辑）
 *
 * 根据数据库类型动态显示字段。
 */
import { useState, useEffect } from 'react'
import {
  api,
  type ConnectionInput,
  type ConnectionListItem,
  type DbType,
  type Environment,
} from '../api'
import { DB_LABELS, DEFAULT_PORTS, ENV_LABELS, ENV_COLORS } from '../store/connections'

interface ConnectionFormProps {
  /** 编辑时传入现有连接，新建时为 null */
  initial?: ConnectionListItem | null
  onSave: () => void
  onCancel: () => void
}

const DB_TYPES: DbType[] = ['mysql', 'postgres', 'sqlite', 'redis']
const ENVIRONMENTS: Environment[] = ['dev', 'staging', 'prod']

export function ConnectionForm({ initial, onSave, onCancel }: ConnectionFormProps) {
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
      const result = await api['connection:test'](input)
      setTestResult(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // SQLite 文件不存在的特殊处理
      if (msg.includes('数据库文件不存在')) {
        setTestResult({
          success: false,
          message: msg,
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
      setError('请输入连接名称')
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
    <div className="connection-form">
      <div className="form-field">
        <label>类型</label>
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
        <label>名称 *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="我的数据库" />
      </div>

      <div className="form-field">
        <label>环境</label>
        <div className="env-selector">
          {ENVIRONMENTS.map((env) => (
            <button
              key={env}
              className={`env-btn ${environment === env ? 'active' : ''}`}
              style={
                environment === env ? { borderColor: ENV_COLORS[env], color: ENV_COLORS[env] } : {}
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
              <label>主机</label>
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="localhost"
              />
            </div>
            <div className="form-field form-field-port">
              <label>端口</label>
              <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
            </div>
          </div>

          <div className="form-field">
            <label>用户名</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
            />
          </div>

          <div className="form-field">
            <label>密码 {initial && <span className="hint">（留空保持不变）</span>}</label>
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
        <label>{isSqlite ? '数据库文件路径' : type === 'redis' ? 'DB Index' : '数据库名'}</label>
        <input
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          placeholder={isSqlite ? '/path/to/database.db' : type === 'redis' ? '0' : 'mydb'}
        />
      </div>

      <div className="form-field">
        <label>颜色标记（可选）</label>
        <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#3b82f6" />
      </div>

      {error && <div className="form-error">{error}</div>}
      {testResult && (
        <div className={`form-test-result ${testResult.success ? 'success' : 'error'}`}>
          {testResult.success ? '✅ ' : '❅ '}
          {testResult.message}
          {testResult.fileNotFound && (
            <button
              className="btn btn-primary btn-sm"
              style={{ marginLeft: 8 }}
              onClick={() => handleTest({ createFile: true })}
              disabled={testing}
            >
              创建并测试
            </button>
          )}
        </div>
      )}

      <div className="form-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => handleTest()}
          disabled={testing || saving}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : initial ? '保存' : '创建'}
        </button>
      </div>
    </div>
  )
}
