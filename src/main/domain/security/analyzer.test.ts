/**
 * SQL 安全分析器单元测试
 */
import { describe, it, expect } from 'vitest'
import { analyzeSql, analyzeSqlBatch } from './analyzer'

describe('analyzeSql', () => {
  it('SELECT 识别为 safe query', () => {
    const r = analyzeSql('SELECT * FROM users WHERE id = 1')
    expect(r.type).toBe('query')
    expect(r.dangerLevel).toBe('safe')
  })

  it('INSERT 识别为 write dml', () => {
    const r = analyzeSql("INSERT INTO users (name) VALUES ('alice')")
    expect(r.type).toBe('dml')
    expect(r.dangerLevel).toBe('write')
  })

  it('UPDATE 有 WHERE 识别为 write', () => {
    const r = analyzeSql('UPDATE users SET name = "bob" WHERE id = 1')
    expect(r.type).toBe('dml')
    expect(r.dangerLevel).toBe('write')
  })

  it('UPDATE 无 WHERE 识别为 dangerous', () => {
    const r = analyzeSql('UPDATE users SET name = "bob"')
    expect(r.dangerLevel).toBe('dangerous')
    expect(r.reasons.some((s) => s.includes('missingWhere') && s.includes('UPDATE'))).toBe(true)
  })

  it('DELETE 无 WHERE 识别为 dangerous', () => {
    const r = analyzeSql('DELETE FROM users')
    expect(r.dangerLevel).toBe('dangerous')
    expect(r.reasons.some((s) => s.includes('missingWhere') && s.includes('DELETE'))).toBe(true)
  })

  it('DELETE 有 WHERE 识别为 write', () => {
    const r = analyzeSql('DELETE FROM users WHERE id = 1')
    expect(r.dangerLevel).toBe('write')
  })

  it('DROP TABLE 识别为 dangerous', () => {
    const r = analyzeSql('DROP TABLE users')
    expect(r.dangerLevel).toBe('dangerous')
    expect(r.reasons.some((s) => s.includes('DROP'))).toBe(true)
  })

  it('TRUNCATE 识别为 dangerous', () => {
    const r = analyzeSql('TRUNCATE TABLE users')
    expect(r.dangerLevel).toBe('dangerous')
    expect(r.reasons.some((s) => s.includes('TRUNCATE'))).toBe(true)
  })

  it('CREATE TABLE 识别为 write ddl', () => {
    const r = analyzeSql('CREATE TABLE test (id INT)')
    expect(r.type).toBe('ddl')
    expect(r.dangerLevel).toBe('write')
  })

  it('解析失败的语句保守判为 dangerous', () => {
    const r = analyzeSql('this is not valid sql !!!')
    expect(r.parseFailed).toBe(true)
    expect(r.dangerLevel).toBe('dangerous')
  })

  it('字段名包含 drop 不误判', () => {
    const r = analyzeSql('SELECT drop_count FROM metrics')
    expect(r.type).toBe('query')
    expect(r.dangerLevel).toBe('safe')
  })
})

describe('analyzeSqlBatch', () => {
  it('多条语句取最高危险级别', () => {
    const r = analyzeSqlBatch('SELECT 1; DROP TABLE users')
    expect(r.dangerLevel).toBe('dangerous')
  })

  it('全安全语句返回 safe', () => {
    const r = analyzeSqlBatch('SELECT 1; SELECT 2')
    expect(r.dangerLevel).toBe('safe')
  })

  it('空语句处理', () => {
    const r = analyzeSqlBatch('')
    expect(r.dangerLevel).toBe('safe')
  })
})
