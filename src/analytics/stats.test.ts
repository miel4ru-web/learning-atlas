import { describe, expect, it } from 'vitest'
import { computeTotals, countMisconceptions, flagLowQualityItems } from './stats'
import type { Interaction } from '../core/types'
import { flashcard, history, interaction, mcq } from '../test/factories'

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

describe('countMisconceptions(v25)', () => {
  // 정답 0번, 오답 1~3번. 1번에만 오개념 라벨이 달려 있다.
  const tagged = mcq({
    id: 'q1',
    correctIndex: 0,
    distractorTags: [null, '인출과 재읽기를 혼동', null, null],
  })

  function log(itemId: string, selectedIndex: number, i = 0): Interaction {
    return interaction(itemId, selectedIndex === 0 ? 'good' : 'again', i, { selectedIndex })
  }

  it('라벨이 달린 오답을 고른 횟수를 센다', () => {
    const byItem = new Map([[tagged.id, [log('q1', 1, 0), log('q1', 1, 1)]]])
    expect(countMisconceptions([tagged], byItem)).toEqual([
      { label: '인출과 재읽기를 혼동', count: 2, itemIds: ['q1'] },
    ])
  })

  it('정답을 고른 채점과 라벨 없는 오답은 세지 않는다', () => {
    const byItem = new Map([[tagged.id, [log('q1', 0, 0), log('q1', 2, 1), log('q1', 3, 2)]]])
    expect(countMisconceptions([tagged], byItem)).toEqual([])
  })

  it('selectedIndex가 없는 구버전 로그는 건너뛴다', () => {
    const byItem = new Map([[tagged.id, [interaction('q1', 'again', 0)]]])
    expect(countMisconceptions([tagged], byItem)).toEqual([])
  })

  it('태그가 없는 문항, 4지선다가 아닌 카드는 대상이 아니다', () => {
    const plain = mcq({ id: 'q2', correctIndex: 0 })
    const card = flashcard({ id: 'f1' })
    const byItem = new Map([
      [plain.id, [log('q2', 1)]],
      [card.id, [interaction('f1', 'again', 0, { selectedIndex: 1 })]],
    ])
    expect(countMisconceptions([plain, card], byItem)).toEqual([])
  })

  it('여러 카드에 같은 라벨이 있으면 합쳐 세고, 많이 걸린 순으로 준다', () => {
    const a = mcq({ id: 'qa', correctIndex: 0, distractorTags: [null, '같은 오개념', null, null] })
    const b = mcq({ id: 'qb', correctIndex: 0, distractorTags: [null, '같은 오개념', null, null] })
    const c = mcq({ id: 'qc', correctIndex: 0, distractorTags: [null, '드문 오개념', null, null] })
    const byItem = new Map([
      [a.id, [log('qa', 1, 0), log('qa', 1, 1)]],
      [b.id, [log('qb', 1, 2)]],
      [c.id, [log('qc', 1, 3)]],
    ])
    const result = countMisconceptions([a, b, c], byItem)
    expect(result[0]).toEqual({ label: '같은 오개념', count: 3, itemIds: ['qa', 'qb'] })
    expect(result[1]).toMatchObject({ label: '드문 오개념', count: 1 })
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
