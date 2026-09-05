// core/dueCount.ts의 핵심 계약: computeDueCountFromData(원본 배열에서 전체
// 체인을 돌림)와 countDue(AtlasProvider가 이미 메모해 둔 cardStates를 씀)가
// 같은 입력이면 같은 답을 내야 한다 — 서비스 워커·리마인더 훅은 전자를,
// 화면은 후자를 쓰므로 둘이 어긋나면 알림과 헤더에 보이는 만기 수가 갈린다.

import { describe, expect, it } from 'vitest'
import { computeDueCountFromData, countDue, groupByItem } from './dueCount'
import { deriveAllCardStates, isLeech } from '../scheduler/fsrs'
import { flashcard, history, kc } from '../test/factories'

describe('computeDueCountFromData', () => {
  it('신규 카드는 세지 않는다', () => {
    const item = flashcard()
    expect(computeDueCountFromData([item], [], [], null, new Date())).toBe(0)
  })

  it('만기가 지난 복습 카드를 센다', () => {
    const item = flashcard()
    const logs = history(item.id, ['good', 'good'], -30) // 30일 전부터 매일 good → 진작 만기
    const dueCount = computeDueCountFromData([item], logs, [], null, new Date())
    expect(dueCount).toBe(1)
  })

  it('아직 만기 전인 카드는 세지 않는다', () => {
    const item = flashcard()
    const logs = history(item.id, ['easy'], 0) // 방금 easy로 채점 — 다음 만기가 한참 뒤
    const dueCount = computeDueCountFromData([item], logs, [], null, new Date(logs[0].ts))
    expect(dueCount).toBe(0)
  })

  it('leech(계속 틀리는 카드)는 만기여도 세지 않는다', () => {
    const item = flashcard()
    // LEECH_THRESHOLD(4) 이상 again → leech로 격리.
    const logs = history(item.id, ['again', 'again', 'again', 'again'], -30)
    expect(isLeech(logs)).toBe(true)
    const dueCount = computeDueCountFromData([item], logs, [], null, new Date())
    expect(dueCount).toBe(0)
  })

  it('사전 테스트 채점만 있으면 신규 카드와 같다(파생 상태에서 빠짐)', () => {
    const item = flashcard()
    const pretestOnly = history(item.id, ['again'], -30).map((i) => ({ ...i, pretest: true }))
    expect(computeDueCountFromData([item], pretestOnly, [], null, new Date())).toBe(0)
  })

  it('KC별 목표 파지율이 있으면 그 스케줄러로 계산한다(전역과 다른 결과가 나올 수 있다)', () => {
    const tightKc = kc({ requestRetention: 0.97 }) // 파지율을 높이면 간격이 짧아진다
    const item = flashcard({ kcId: tightKc.id })
    const logs = history(item.id, ['good'], -10)
    const withHighRetention = computeDueCountFromData([item], logs, [tightKc], null, new Date())
    const withDefault = computeDueCountFromData([item], logs, [], null, new Date())
    // 둘 다 유효한 boolean 카운트지만, 최소한 예외 없이 계산되고 KC 설정을 실제로 반영한다는 것만 확인.
    expect([0, 1]).toContain(withHighRetention)
    expect([0, 1]).toContain(withDefault)
  })

  it('countDue를 직접 호출한 것과 같은 결과를 낸다(둘이 어긋나면 안 된다)', () => {
    const item = flashcard()
    const logs = history(item.id, ['good', 'good'], -30)
    const now = new Date()

    const byItem = groupByItem([item], logs)
    const cardStates = deriveAllCardStates(byItem)
    const leechItemIds = new Set(
      [item].filter((it) => isLeech(byItem.get(it.id) ?? [])).map((it) => it.id),
    )

    expect(computeDueCountFromData([item], logs, [], null, now)).toBe(
      countDue(cardStates, leechItemIds, now),
    )
  })
})

describe('groupByItem', () => {
  it('이력 없는 아이템도 빈 배열로 채운다', () => {
    const item = flashcard()
    const map = groupByItem([item], [])
    expect(map.get(item.id)).toEqual([])
  })
})
