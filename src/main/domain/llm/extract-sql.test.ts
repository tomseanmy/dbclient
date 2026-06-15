/**
 * extract-sql 单元测试
 */
import { describe, it, expect } from 'vitest'
import { extractSql } from './extract-sql'

describe('extractSql', () => {
  it('提取 ```sql 围栏代码块', () => {
    const text = '好的，查询如下：\n\n```sql\nSELECT * FROM users;\n```\n\n这条语句...'
    const result = extractSql(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('SELECT * FROM users;')
  })

  it('提取无语言标记的围栏代码块', () => {
    const text = '```\nSELECT 1;\n```'
    const result = extractSql(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('SELECT 1;')
  })

  it('提取多个 SQL 代码块', () => {
    const text = '方案一：\n```sql\nSELECT * FROM a;\n```\n方案二：\n```sql\nSELECT * FROM b;\n```'
    const result = extractSql(text)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('SELECT * FROM a;')
    expect(result[1]).toBe('SELECT * FROM b;')
  })

  it('无 SQL 代码块时返回空数组', () => {
    const text = '这个问题需要更多信息才能回答。'
    const result = extractSql(text)
    expect(result).toHaveLength(0)
  })

  it('纯 SQL 文本（无围栏）且以关键字开头时启发式提取', () => {
    const text = 'SELECT id, name FROM users WHERE active = 1'
    const result = extractSql(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('SELECT')
  })

  it('普通中文文本不误判为 SQL', () => {
    const text = '你可以尝试查询用户表来获取数据。'
    const result = extractSql(text)
    expect(result).toHaveLength(0)
  })

  it('空围栏代码块被忽略', () => {
    const text = '```sql\n\n```'
    const result = extractSql(text)
    expect(result).toHaveLength(0)
  })

  it('代码块内含换行和缩进完整保留', () => {
    const text = '```sql\nSELECT *\n  FROM users\n  WHERE id = 1\n    AND active = 1;\n```'
    const result = extractSql(text)
    expect(result[0]).toContain('WHERE')
    expect(result[0]).toContain('AND active')
  })
})
