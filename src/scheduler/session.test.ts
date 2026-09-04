import { describe, expect, it } from 'vitest'
import type { CardState, EloState } from '../core/types'
import { buildSession, findUrgentKcIds } from './session'
import { MASTERY_THETA } from './elo'
import { cloze, flashcard, kc, mcq } from '../test/factories'

const emptyElo: EloState = { itemDifficulty: new Map(), kcMastery: new Map() }
const NOW = new Date('2026-02-01T00:00:00.000Z')

function state(over: Partial<CardState> & { itemId: string }): CardState {
  return {
    due: new Date('2026-01-01T00:00:00.000Z'),
    stability: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state: 'review',
    lastReview: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  }
}

describe('buildSession', () => {
  it('복습(만기)이 신규보다 먼저 온다', () => {
    const review = flashcard()
    const fresh = flashcard()
    const states = new Map([
      [review.id, state({ itemId: review.id })],
      [fresh.id, state({ itemId: fresh.id, state: 'new', reps: 0 })],
    ])
    const plan = buildSession([review, fresh], states, emptyElo, [], NOW, { budgetMinutes: 60 })
    expect(plan.map((i) => i.id)).toEqual([review.id, fresh.id])
  })

  it('예산을 넘는 카드는 담지 않는다', () => {
    const items = Array.from({ length: 10 }, () => flashcard())
    const states = new Map(items.map((i) => [i.id, state({ itemId: i.id })]))
    // costPerCardMinutes 기본 0.75 → 예산 2분이면 최대 2장
    const plan = buildSession(items, states, emptyElo, [], NOW, { budgetMinutes: 2 })
    expect(plan.length).toBe(2)
  })

  it('leech로 지정된 카드는 복습 후보에서 빠진다', () => {
    const normal = flashcard()
    const leech = flashcard()
    const states = new Map([
      [normal.id, state({ itemId: normal.id })],
      [leech.id, state({ itemId: leech.id })],
    ])
    const plan = buildSession([normal, leech], states, emptyElo, [], NOW, {
      budgetMinutes: 60,
      leechItemIds: new Set([leech.id]),
    })
    expect(plan.map((i) => i.id)).toEqual([normal.id])
  })

  it('신규 카드는 선수지식이 숙달돼야 후보가 된다(복습은 게이팅 안 함)', () => {
    const base = kc({ id: 'base' })
    const advanced = kc({ id: 'adv', prereqIds: ['base'] })
    const newCard = flashcard({ kcId: 'adv' })
    const states = new Map([[newCard.id, state({ itemId: newCard.id, state: 'new', reps: 0 })]])

    const notReady = buildSession([newCard], states, emptyElo, [base, advanced], NOW, {
      budgetMinutes: 60,
    })
    expect(notReady).toHaveLength(0)

    const elo: EloState = { itemDifficulty: new Map(), kcMastery: new Map([['base', MASTERY_THETA]]) }
    const ready = buildSession([newCard], states, elo, [base, advanced], NOW, { budgetMinutes: 60 })
    expect(ready).toHaveLength(1)
  })

  it('urgentKcIds의 복습은 만기일 순서를 제치고 맨 앞으로', () => {
    const old = flashcard({ kcId: 'kc-1' })
    const urgent = flashcard({ kcId: 'kc-2' })
    const states = new Map([
      [old.id, state({ itemId: old.id, due: new Date('2026-01-01T00:00:00.000Z') })],
      [urgent.id, state({ itemId: urgent.id, due: new Date('2026-01-20T00:00:00.000Z') })],
    ])
    const plan = buildSession([old, urgent], states, emptyElo, [], NOW, {
      budgetMinutes: 60,
      urgentKcIds: new Set(['kc-2']),
    })
    expect(plan[0].id).toBe(urgent.id)
  })

  it('섞을 KC가 충분하면 같은 KC가 연속되지 않는다', () => {
    const all = [
      ...Array.from({ length: 2 }, () => flashcard({ kcId: 'kc-1' })),
      ...Array.from({ length: 2 }, () => flashcard({ kcId: 'kc-2' })),
      ...Array.from({ length: 2 }, () => flashcard({ kcId: 'kc-3' })),
    ]
    const states = new Map(all.map((i) => [i.id, state({ itemId: i.id })]))
    const plan = buildSession(all, states, emptyElo, [], NOW, {
      budgetMinutes: 60,
      maxConsecutiveSameKc: 1,
    })
    expect(plan).toHaveLength(6)
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].kcId).not.toBe(plan[i - 1].kcId)
    }
  })

  it('섞을 다른 KC가 없으면 KC 제약도 양보한다 — 세션을 굶기지 않는다', () => {
    // 이제 막 만든 KC 하나에 카드 여섯 장 같은 상황(예시 덱 첫 세션이 정확히 이랬다).
    const sameKc = Array.from({ length: 6 }, () => flashcard({ kcId: 'kc-1' }))
    const states = new Map(sameKc.map((i) => [i.id, state({ itemId: i.id })]))
    const plan = buildSession(sameKc, states, emptyElo, [], NOW, {
      budgetMinutes: 60,
      maxConsecutiveSameKc: 2,
    })
    expect(plan).toHaveLength(6)
  })

  it('제약을 양보하더라도 예산은 그대로 지킨다', () => {
    const sameKc = Array.from({ length: 10 }, () => flashcard({ kcId: 'kc-1' }))
    const states = new Map(sameKc.map((i) => [i.id, state({ itemId: i.id })]))
    // costPerCardMinutes 기본 0.75 → 예산 3분이면 4장
    const plan = buildSession(sameKc, states, emptyElo, [], NOW, {
      budgetMinutes: 3,
      maxConsecutiveSameKc: 2,
    })
    expect(plan).toHaveLength(4)
  })

  it('섞을 타입이 충분하면 같은 활동 타입이 연속되지 않는다', () => {
    // KC는 전부 다르게 둬서 KC 제약이 아니라 타입 제약만 시험한다.
    const all = [
      ...Array.from({ length: 3 }, (_, i) => flashcard({ kcId: `f-${i}` })),
      ...Array.from({ length: 3 }, (_, i) => cloze({ kcId: `c-${i}` })),
      ...Array.from({ length: 3 }, (_, i) => mcq({ kcId: `m-${i}` })),
    ]
    const states = new Map(all.map((i) => [i.id, state({ itemId: i.id })]))
    const plan = buildSession(all, states, emptyElo, [], NOW, {
      budgetMinutes: 60,
      maxConsecutiveSameType: 1,
    })
    expect(plan).toHaveLength(9) // 완벽히 교대할 수 있으므로 하나도 밀리지 않는다
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].type).not.toBe(plan[i - 1].type)
    }
  })

  it('섞을 다른 타입이 없으면 제약을 양보한다 — 세션을 굶기지 않는다', () => {
    const only = Array.from({ length: 5 }, (_, i) => flashcard({ kcId: `kc-${i}` }))
    const states = new Map(only.map((i) => [i.id, state({ itemId: i.id })]))
    const plan = buildSession(only, states, emptyElo, [], NOW, {
      budgetMinutes: 60,
      maxConsecutiveSameType: 2,
    })
    // 인터리빙은 순서를 다듬는 장치이지 학습량을 깎는 장치가 아니다(3.3).
    expect(plan).toHaveLength(5)
  })

  it('제약을 양보해도 후보는 하나도 흘리지 않는다(단계 사이에서 사라지지 않음)', () => {
    // kc-1 플래시카드 4장 + kc-2 빈칸 1장. 타입 제약(1)에 걸린 카드가 2차 단계로,
    // 거기서 다시 KC 제약(2)에 걸린 카드가 3차 단계로 넘어간다 — 중간에서 새면
    // 여기 길이가 모자란다.
    const all = [
      ...Array.from({ length: 4 }, () => flashcard({ kcId: 'kc-1' })),
      cloze({ kcId: 'kc-2' }),
    ]
    const states = new Map(all.map((i) => [i.id, state({ itemId: i.id })]))
    const plan = buildSession(all, states, emptyElo, [], NOW, {
      budgetMinutes: 60,
      maxConsecutiveSameKc: 2,
      maxConsecutiveSameType: 1,
    })
    expect(plan).toHaveLength(5)
    // 섞을 상대가 있는 앞부분에서는 제약이 실제로 지켜진다.
    expect(plan[0].type).not.toBe(plan[1].type)
  })

  it('dailyReviewCap: 밀린 복습이 많아도 상위 N개만 오늘 후보가 된다', () => {
    const items = Array.from({ length: 10 }, () => flashcard())
    const states = new Map(items.map((i) => [i.id, state({ itemId: i.id })]))
    const plan = buildSession(items, states, emptyElo, [], NOW, {
      budgetMinutes: 60, // 예산은 10장을 다 담고도 남을 만큼 넉넉함
      dailyReviewCap: 3,
    })
    expect(plan.length).toBe(3)
  })

  it('dailyReviewCap이 없으면(기본) 예산이 허용하는 만큼 전부 담는다', () => {
    const items = Array.from({ length: 10 }, () => flashcard())
    const states = new Map(items.map((i) => [i.id, state({ itemId: i.id })]))
    const plan = buildSession(items, states, emptyElo, [], NOW, { budgetMinutes: 60 })
    expect(plan.length).toBe(10)
  })

  it('vacationMode: 신규 카드는 선수지식이 충족돼도 후보에서 빠진다', () => {
    const newCard = flashcard({ kcId: null })
    const states = new Map([[newCard.id, state({ itemId: newCard.id, state: 'new', reps: 0 })]])
    const plan = buildSession([newCard], states, emptyElo, [], NOW, {
      budgetMinutes: 60,
      vacationMode: true,
    })
    expect(plan).toHaveLength(0)
  })

  it('vacationMode에도 복습(만기)은 그대로 나온다', () => {
    const review = flashcard()
    const states = new Map([[review.id, state({ itemId: review.id })]])
    const plan = buildSession([review], states, emptyElo, [], NOW, {
      budgetMinutes: 60,
      vacationMode: true,
    })
    expect(plan.map((i) => i.id)).toEqual([review.id])
  })
})

describe('findUrgentKcIds', () => {
  it('가장 최근 상호작용이 concept 오답인 KC만 긴급', () => {
    const a = flashcard({ kcId: 'kc-1' })
    const b = flashcard({ kcId: 'kc-2' })
    const latest = new Map([
      [a.id, { grade: 'again', errorTag: 'concept' }],
      [b.id, { grade: 'again', errorTag: 'carelessness' }],
    ])
    expect([...findUrgentKcIds([a, b], latest)]).toEqual(['kc-1'])
  })
})
