import { describe, expect, it } from 'vitest'
import type { CardState, EloState } from '../core/types'
import {
  predictedRecall,
  bandOf,
  bandRank,
  countBands,
  DESIRABLE_LOW,
  DESIRABLE_HIGH,
} from './selection'
import { MASTERY_THETA } from './elo'
import { flashcard } from '../test/factories'

describe('predictedRecall', () => {
  it('kcId 없는 아이템은 null', () => {
    expect(predictedRecall(flashcard({ kcId: null }), emptyElo())).toBeNull()
  })
  it('θ와 문항 난이도로 회상 확률을 낸다', () => {
    const item = flashcard({ kcId: 'kc-1' })
    const elo: EloState = {
      kcMastery: new Map([['kc-1', MASTERY_THETA]]),
      itemDifficulty: new Map([[item.id, 0]]),
    }
    expect(predictedRecall(item, elo)!).toBeCloseTo(0.85, 2)
  })
})

describe('bandOf / bandRank', () => {
  it('경계값 분류', () => {
    expect(bandOf(null)).toBe('unknown')
    expect(bandOf(DESIRABLE_LOW - 0.01)).toBe('too-hard')
    expect(bandOf(DESIRABLE_LOW)).toBe('desirable')
    expect(bandOf(DESIRABLE_HIGH)).toBe('desirable')
    expect(bandOf(DESIRABLE_HIGH + 0.01)).toBe('too-easy')
  })
  it('정렬 우선순위: desirable < too-hard < unknown < too-easy', () => {
    expect(bandRank('desirable')).toBeLessThan(bandRank('too-hard'))
    expect(bandRank('too-hard')).toBeLessThan(bandRank('unknown'))
    expect(bandRank('unknown')).toBeLessThan(bandRank('too-easy'))
  })
})

describe('countBands', () => {
  it('신규·격리 카드는 세지 않고, 나머지를 밴드별로 집계', () => {
    const newCard = flashcard({ kcId: 'kc-1' })
    const leech = flashcard({ kcId: 'kc-1' })
    const easy = flashcard({ kcId: 'kc-1' })
    const hard = flashcard({ kcId: 'kc-1' })
    const noKc = flashcard({ kcId: null })

    const states = new Map<string, CardState>(
      [newCard, leech, easy, hard, noKc].map((i) => [
        i.id,
        review(i.id, i.id === newCard.id ? 'new' : 'review'),
      ]),
    )
    const elo: EloState = {
      kcMastery: new Map([['kc-1', 0]]),
      itemDifficulty: new Map([
        [easy.id, -1000], // θ 0, b -1000 → 회상 ≈ 1 → too-easy
        [hard.id, 1000], // → 회상 ≈ 0 → too-hard
      ]),
    }
    const counts = countBands([newCard, leech, easy, hard, noKc], states, elo, new Set([leech.id]))
    expect(counts.total).toBe(3) // easy, hard, noKc
    expect(counts.tooEasy).toBe(1)
    expect(counts.tooHard).toBe(1)
    expect(counts.unknown).toBe(1)
  })
})

function emptyElo(): EloState {
  return { itemDifficulty: new Map(), kcMastery: new Map() }
}

function review(itemId: string, s: CardState['state']): CardState {
  return {
    itemId,
    due: new Date('2026-01-01T00:00:00.000Z'),
    stability: 1,
    difficulty: 5,
    reps: s === 'new' ? 0 : 3,
    lapses: 0,
    state: s,
    lastReview: s === 'new' ? null : new Date('2026-01-01T00:00:00.000Z'),
  }
}
