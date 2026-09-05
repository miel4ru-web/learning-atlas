import { describe, expect, it } from 'vitest'
import {
  computeTotals,
  countMisconceptions,
  flagLowQualityItems,
  countErrorTags,
  accuracyTrend,
  slowestItems,
} from './stats'
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

describe('countErrorTags(v32)', () => {
  it('again으로 채점되며 사유를 고른 것만 세고, 많이 걸린 순으로 준다', () => {
    const item = flashcard()
    const byItem = new Map([
      [
        item.id,
        [
          interaction(item.id, 'again', 0, { errorTag: 'concept' }),
          interaction(item.id, 'again', 1, { errorTag: 'concept' }),
          interaction(item.id, 'again', 2, { errorTag: 'carelessness' }),
          interaction(item.id, 'again', 3, { errorTag: null }), // 사유 건너뛰기
          interaction(item.id, 'good', 4), // 정답에는 애초에 errorTag가 없다
        ],
      ],
    ])
    expect(countErrorTags(byItem)).toEqual([
      { tag: 'concept', count: 2 },
      { tag: 'carelessness', count: 1 },
    ])
  })

  it('로그가 없으면 빈 배열', () => {
    expect(countErrorTags(new Map())).toEqual([])
  })
})

describe('accuracyTrend(v32)', () => {
  const NOW32 = new Date('2026-01-10T12:00:00.000Z')

  it('일별 리뷰 수·정답률을 낸다', () => {
    const item = flashcard()
    const byItem = new Map([
      [
        item.id,
        [
          interaction(item.id, 'good', 8),
          interaction(item.id, 'again', 8),
          interaction(item.id, 'good', 9),
        ],
      ],
    ])
    const result = accuracyTrend(byItem, NOW32, 30)
    expect(result.find((d) => d.dateKey === '2026-01-09')).toMatchObject({ reviews: 2, accuracy: 0.5 })
    expect(result.find((d) => d.dateKey === '2026-01-10')).toMatchObject({
      reviews: 1,
      accuracy: 1,
      label: '오늘',
    })
  })

  it('창 밖의 오래된 로그는 건너뛴다', () => {
    const item = flashcard()
    const byItem = new Map([[item.id, [interaction(item.id, 'good', 0)]]])
    const result = accuracyTrend(byItem, NOW32, 5) // 5일 창 — dayOffset 0은 훨씬 이전
    expect(result.every((d) => d.reviews === 0)).toBe(true)
  })

  it('리뷰가 없으면 reviews 0·accuracy 0, 창 길이만큼 날짜를 채운다', () => {
    const result = accuracyTrend(new Map(), NOW32, 7)
    expect(result).toHaveLength(7)
    expect(result.every((d) => d.reviews === 0 && d.accuracy === 0)).toBe(true)
  })
})

describe('slowestItems(v32)', () => {
  it('정답 중 응답시간 중앙값이 큰 카드부터 순서를 매긴다(표본 3회 이상만)', () => {
    const slow = flashcard()
    const fast = flashcard()
    const tooFew = flashcard()
    const byItem = new Map([
      [
        slow.id,
        [
          interaction(slow.id, 'good', 0, { latencyMs: 9000 }),
          interaction(slow.id, 'good', 1, { latencyMs: 8000 }),
          interaction(slow.id, 'good', 2, { latencyMs: 10000 }),
        ],
      ],
      [
        fast.id,
        [
          interaction(fast.id, 'good', 0, { latencyMs: 1000 }),
          interaction(fast.id, 'good', 1, { latencyMs: 1200 }),
          interaction(fast.id, 'good', 2, { latencyMs: 900 }),
        ],
      ],
      [
        tooFew.id,
        [
          interaction(tooFew.id, 'good', 0, { latencyMs: 50000 }),
          interaction(tooFew.id, 'good', 1, { latencyMs: 50000 }),
        ],
      ],
    ])
    const result = slowestItems([slow, fast, tooFew], byItem)
    expect(result.map((r) => r.itemId)).toEqual([slow.id, fast.id])
    expect(result[0]).toMatchObject({ medianLatencyMs: 9000, reviews: 3 })
  })

  it('again으로 채점된 응답, latencyMs 없는 로그는 표본에서 제외한다', () => {
    const item = flashcard()
    const byItem = new Map([
      [
        item.id,
        [
          interaction(item.id, 'again', 0, { latencyMs: 20000 }),
          interaction(item.id, 'good', 1, { latencyMs: 3000 }),
          interaction(item.id, 'good', 2),
          interaction(item.id, 'good', 3, { latencyMs: 4000 }),
        ],
      ],
    ])
    // 유효 표본(정답 + latencyMs 있음)이 2건뿐이라 최소 3회 기준에 못 미친다.
    expect(slowestItems([item], byItem)).toEqual([])
  })

  it('limit으로 상위 N개만 돌려준다', () => {
    const items = Array.from({ length: 3 }, () => flashcard())
    const byItem = new Map(
      items.map((item, idx) => [
        item.id,
        Array.from({ length: 3 }, (_, i) =>
          interaction(item.id, 'good', i, { latencyMs: (idx + 1) * 1000 }),
        ),
      ]),
    )
    expect(slowestItems(items, byItem, 2)).toHaveLength(2)
  })
})
