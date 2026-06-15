/**
 * 权限判定器单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { decide, elevate, revokeElevation, isElevated, elevationRemaining } from './policy'
import type { SqlAnalysis } from './analyzer'

function makeAnalysis(
  dangerLevel: 'safe' | 'write' | 'dangerous',
  type: 'query' | 'dml' | 'ddl' | 'unknown',
): SqlAnalysis {
  const result: SqlAnalysis = { type, dangerLevel, reasons: [], tables: [], parseFailed: false }
  return result
}

const SAFE_QUERY = makeAnalysis('safe', 'query')
const WRITE_DML = makeAnalysis('write', 'dml')
const WRITE_DDL = makeAnalysis('write', 'ddl')
const DANGEROUS = makeAnalysis('dangerous', 'ddl')

describe('decide - 权限矩阵', () => {
  beforeEach(() => {
    // 清理提权状态
    revokeElevation('conn-1')
    revokeElevation('conn-2')
    revokeElevation('conn-3')
  })

  describe('dev 环境', () => {
    it('SELECT allow', () => {
      expect(decide({ environment: 'dev', analysis: SAFE_QUERY, elevated: false }).decision).toBe(
        'allow',
      )
    })
    it('DML allow', () => {
      expect(decide({ environment: 'dev', analysis: WRITE_DML, elevated: false }).decision).toBe(
        'allow',
      )
    })
    it('DDL allow', () => {
      expect(decide({ environment: 'dev', analysis: WRITE_DDL, elevated: false }).decision).toBe(
        'allow',
      )
    })
    it('危险操作 confirm', () => {
      expect(decide({ environment: 'dev', analysis: DANGEROUS, elevated: false }).decision).toBe(
        'confirm_required',
      )
    })
  })

  describe('staging 环境', () => {
    it('SELECT allow', () => {
      expect(
        decide({ environment: 'staging', analysis: SAFE_QUERY, elevated: false }).decision,
      ).toBe('allow')
    })
    it('DML allow', () => {
      expect(
        decide({ environment: 'staging', analysis: WRITE_DML, elevated: false }).decision,
      ).toBe('allow')
    })
    it('DDL confirm', () => {
      expect(
        decide({ environment: 'staging', analysis: WRITE_DDL, elevated: false }).decision,
      ).toBe('confirm_required')
    })
    it('危险操作 confirm', () => {
      expect(
        decide({ environment: 'staging', analysis: DANGEROUS, elevated: false }).decision,
      ).toBe('confirm_required')
    })
  })

  describe('prod 环境（未提权）', () => {
    it('SELECT allow', () => {
      expect(decide({ environment: 'prod', analysis: SAFE_QUERY, elevated: false }).decision).toBe(
        'allow',
      )
    })
    it('DML deny', () => {
      expect(decide({ environment: 'prod', analysis: WRITE_DML, elevated: false }).decision).toBe(
        'deny',
      )
    })
    it('DDL deny', () => {
      expect(decide({ environment: 'prod', analysis: WRITE_DDL, elevated: false }).decision).toBe(
        'deny',
      )
    })
    it('危险操作 deny', () => {
      expect(decide({ environment: 'prod', analysis: DANGEROUS, elevated: false }).decision).toBe(
        'deny',
      )
    })
  })

  describe('prod 环境（已提权）', () => {
    it('DML allow', () => {
      expect(decide({ environment: 'prod', analysis: WRITE_DML, elevated: true }).decision).toBe(
        'allow',
      )
    })
    it('DDL confirm', () => {
      expect(decide({ environment: 'prod', analysis: WRITE_DDL, elevated: true }).decision).toBe(
        'confirm_required',
      )
    })
    it('危险操作仍 confirm', () => {
      expect(decide({ environment: 'prod', analysis: DANGEROUS, elevated: true }).decision).toBe(
        'confirm_required',
      )
    })
  })
})

describe('提权状态管理', () => {
  beforeEach(() => {
    revokeElevation('conn-test')
  })

  it('提权后 isElevated 返回 true', () => {
    elevate('conn-test', 'gui', 60000)
    expect(isElevated('conn-test')).toBe(true)
  })

  it('撤销后 isElevated 返回 false', () => {
    elevate('conn-test', 'gui', 60000)
    revokeElevation('conn-test')
    expect(isElevated('conn-test')).toBe(false)
  })

  it('过期后自动失效', () => {
    elevate('conn-test', 'gui', 1) // 1ms
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(isElevated('conn-test')).toBe(false)
        resolve(undefined)
      }, 10)
    })
  })

  it('elevationRemaining 返回剩余毫秒', () => {
    elevate('conn-test', 'gui', 60000)
    const remaining = elevationRemaining('conn-test')
    expect(remaining).toBeGreaterThan(50000)
    expect(remaining).toBeLessThanOrEqual(60000)
  })
})
