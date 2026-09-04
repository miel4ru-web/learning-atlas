import { describe, expect, it } from 'vitest'
import { calibrationReport, calibrationWarning, calibrationLabel } from './calibration'
import { interaction } from '../test/factories'

describe('calibrationReport', () => {
  it('confidence가 null인 상호작용은 무시한다', () => {
    const report = calibrationReport([
      interaction('a', 'good', 0, { confidence: null }),
      interaction('a', 'again', 1, { confidence: null }),
    ])
    expect(report.every((b) => b.total === 0)).toBe(true)
  })

  it('confidence 구간별로 again이 아닌 비율(정답률)을 집계한다', () => {
    const report = calibrationReport([
      interaction('a', 'good', 0, { confidence: 3 }),
      interaction('a', 'good', 1, { confidence: 3 }),
      interaction('a', 'again', 2, { confidence: 3 }),
      interaction('a', 'again', 3, { confidence: 1 }),
    ])
    const high = report.find((b) => b.confidence === 3)!
    const low = report.find((b) => b.confidence === 1)!
    expect(high).toMatchObject({ total: 3, correct: 2 })
    expect(high.rate).toBeCloseTo(2 / 3)
    expect(low).toMatchObject({ total: 1, correct: 0, rate: 0 })
  })

  it('항상 1·2·3 세 구간을 순서대로 반환한다', () => {
    expect(calibrationReport([]).map((b) => b.confidence)).toEqual([1, 2, 3])
  })
})

describe('calibrationWarning', () => {
  it('자신감이 높을수록 정답률도 높으면(단조) 경고 없음', () => {
    const report = calibrationReport([
      interaction('a', 'again', 0, { confidence: 1 }),
      interaction('a', 'good', 1, { confidence: 3 }),
    ])
    expect(calibrationWarning(report)).toBeNull()
  })

  it('낮은 자신감의 정답률이 더 높으면(역전) 경고', () => {
    const report = calibrationReport([
      interaction('a', 'good', 0, { confidence: 1 }),
      interaction('a', 'again', 1, { confidence: 3 }),
    ])
    expect(calibrationWarning(report)).toContain(calibrationLabel(3))
  })

  it('표본 없는 구간은 비교에서 빠져 잘못된 경고를 내지 않는다', () => {
    const report = calibrationReport([
      interaction('a', 'good', 0, { confidence: 1 }),
      interaction('a', 'good', 1, { confidence: 3 }),
    ])
    expect(calibrationWarning(report)).toBeNull()
  })
})
