import { describe, expect, it } from 'vitest'
import { computeTotals, flagLowQualityItems } from './stats'
import type { Interaction } from '../core/types'
import { flashcard, history, interaction } from '../test/factories'

const NOW = new Date('2026-01-10T12:00:00.000Z')

function byItemOf(...logs: Interaction[][]): Map<string, Interaction[]> {
  const map = new Map<string, Interaction[]>()
  for (const log of logs) {
    if (log.length > 0) map.set(log[0].itemId, log)
  }
  return map
}

describe('computeTotals', () => {
  it('카드 수·리뷰 수·활동한 날 수를 센다', () => {
    const item = flashcard()
    const log = history(item.id, ['good', 'again', 'good'])
    const totals = computeTotals([item], log, NOW)
    expect(totals).toMatchObject({ totalItems: 1, totalReviews: 3, activeDays: 3 })
  })
})

describe('flagLowQualityItems', () => {
  it('자주 틀리는 카드는 broken으로 신고한다', () => {
    const item = flashcard()
    // 6번 중 1번만 정답 → 정답률 0.167 (임계값 0.2 미만)
    const log = history(item.id, ['again', 'again', 'again', 'again', 'again', 'good'])
    const reports = flagLowQualityItems([item], byItemOf(log))
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ itemId: item.id, flag: 'broken', reviews: 6 })
  })

  it('임계값과 정확히 같은 정답률(0.2)은 신고하지 않는다 — 미만일 때만', () => {
    const item = flashcard()
    const log = history(item.id, ['again', 'again', 'again', 'again', 'good'])
    expect(flagLowQualityItems([item], byItemOf(log))).toEqual([])
  })

  it('표본이 적으면(5회 미만) 자주 틀려도 신고하지 않는다', () => {
    const item = flashcard()
    const log = history(item.id, ['again', 'again', 'again'])
    expect(flagLowQualityItems([item], byItemOf(log))).toEqual([])
  })

  it('열 번 넘게 한 번도 안 틀린 카드는 too-easy로 신고한다', () => {
    const item = flashcard()
    const log = history(item.id, Array.from({ length: 12 }, () => 'good' as const))
    const reports = flagLowQualityItems([item], byItemOf(log))
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ flag: 'too-easy', accuracy: 1, reviews: 12 })
  })

  it('연속 정답이어도 표본이 적으면(10회 미만) 신고하지 않는다 — SRS에선 정상', () => {
    const item = flashcard()
    const log = history(item.id, ['good', 'good', 'good', 'good', 'good'])
    expect(flagLowQualityItems([item], byItemOf(log))).toEqual([])
  })

  it('정상 범위(가끔 틀림)는 신고하지 않는다', () => {
    const item = flashcard()
    const log = history(item.id, ['good', 'good', 'again', 'good', 'good', 'good'])
    expect(flagLowQualityItems([item], byItemOf(log))).toEqual([])
  })

  it('로그가 없는 카드는 건너뛴다', () => {
    const item = flashcard()
    expect(flagLowQualityItems([item], new Map())).toEqual([])
  })

  it('여러 건이면 심한 것(정답률 낮은 순)부터 나온다', () => {
    const bad = flashcard()
    const easy = flashcard()
    const badLog = history(bad.id, ['again', 'again', 'again', 'again', 'again', 'good'])
    const easyLog = Array.from({ length: 12 }, (_, i) => interaction(easy.id, 'good', i))
    const reports = flagLowQualityItems([easy, bad], byItemOf(badLog, easyLog))
    expect(reports.map((r) => r.flag)).toEqual(['broken', 'too-easy'])
  })
})
