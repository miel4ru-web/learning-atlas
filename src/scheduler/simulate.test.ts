import { describe, expect, it } from 'vitest'
import { simulateItem, simulateAll, logLoss, rmse } from './simulate'
import { buildScheduler } from './fsrs'
import { history } from '../test/factories'

const scheduler = buildScheduler()

describe('simulateItem', () => {
  it('첫 채점은 비교할 이전 상태가 없어 건너뛴다', () => {
    expect(simulateItem(history('a', ['good']), scheduler)).toHaveLength(0)
    expect(simulateItem(history('a', ['good', 'good', 'good']), scheduler)).toHaveLength(2)
  })

  it('actual은 again이면 0, 그 외 1', () => {
    const pts = simulateItem(history('a', ['good', 'again', 'good']), scheduler)
    expect(pts.map((p) => p.actual)).toEqual([0, 1])
  })

  it('predicted는 0~1 범위', () => {
    for (const p of simulateItem(history('a', ['good', 'good', 'hard', 'good']), scheduler)) {
      expect(p.predicted).toBeGreaterThanOrEqual(0)
      expect(p.predicted).toBeLessThanOrEqual(1)
    }
  })
})

describe('logLoss / rmse', () => {
  it('빈 입력은 NaN', () => {
    expect(logLoss([])).toBeNaN()
    expect(rmse([])).toBeNaN()
  })

  it('완벽한 예측이면 손실이 0에 가깝다', () => {
    const perfect = [
      { predicted: 1, actual: 1 as const, ts: '' },
      { predicted: 0, actual: 0 as const, ts: '' },
    ]
    expect(logLoss(perfect)).toBeCloseTo(0, 4)
    expect(rmse(perfect)).toBeCloseTo(0, 4)
  })

  it('빗나간 예측일수록 log loss가 크다', () => {
    const ok = [{ predicted: 0.8, actual: 1 as const, ts: '' }]
    const bad = [{ predicted: 0.2, actual: 1 as const, ts: '' }]
    expect(logLoss(bad)).toBeGreaterThan(logLoss(ok))
  })
})

describe('simulateAll', () => {
  it('아이템별 예측 포인트를 합친다', () => {
    const byItem = new Map([
      ['a', history('a', ['good', 'good'])],
      ['b', history('b', ['good', 'good', 'good'])],
    ])
    expect(simulateAll(byItem, scheduler)).toHaveLength(1 + 2)
  })
})
