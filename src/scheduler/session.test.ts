import { describe, expect, it } from 'vitest'
import type { CardState, EloState } from '../core/types'
import { buildSession, findUrgentKcIds } from './session'
import { MASTERY_THETA } from './elo'
import { flashcard, kc } from '../test/factories'

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

  it('같은 KC가 maxConsecutiveSameKc회를 넘겨 연속되지 않는다', () => {
    const sameKc = Array.from({ length: 6 }, () => flashcard({ kcId: 'kc-1' }))
    const other = flashcard({ kcId: 'kc-2' })
    const all = [...sameKc, other]
    const states = new Map(all.map((i) => [i.id, state({ itemId: i.id })]))
    const plan = buildSession(all, states, emptyElo, [], NOW, {
      budgetMinutes: 60,
      maxConsecutiveSameKc: 2,
    })
    let run = 1
    for (let i = 1; i < plan.length; i++) {
      run = plan[i].kcId === plan[i - 1].kcId ? run + 1 : 1
      expect(run).toBeLessThanOrEqual(2)
    }
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
