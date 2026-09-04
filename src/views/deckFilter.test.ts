import { describe, expect, it } from 'vitest'
import type { CardState, EloState } from '../core/types'
import {
  emptyFilter,
  isFilterActive,
  matchesDeckFilter,
  type DeckFilterCtx,
} from './deckFilter'
import { flashcard, mcq, cloze, kc } from '../test/factories'

const NOW = new Date('2026-02-01T00:00:00.000Z')

function cardState(itemId: string, o: Partial<CardState> = {}): CardState {
  return {
    itemId,
    due: new Date('2026-01-01T00:00:00.000Z'),
    stability: 1,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    state: 'review',
    lastReview: new Date('2026-01-01T00:00:00.000Z'),
    ...o,
  }
}

function ctx(over: Partial<DeckFilterCtx> = {}): DeckFilterCtx {
  return {
    cardStates: new Map(),
    eloState: { itemDifficulty: new Map(), kcMastery: new Map() } as EloState,
    kcById: new Map(),
    leechItemIds: new Set(),
    now: NOW,
    ...over,
  }
}

describe('isFilterActive', () => {
  it('빈 필터는 비활성', () => {
    expect(isFilterActive(emptyFilter())).toBe(false)
  })
  it('아무 조건이나 있으면 활성', () => {
    const withType = emptyFilter()
    withType.types.add('mcq')
    expect(isFilterActive({ ...emptyFilter(), query: 'x' })).toBe(true)
    expect(isFilterActive(withType)).toBe(true)
    expect(isFilterActive({ ...emptyFilter(), kcId: null })).toBe(true)
  })
})

describe('matchesDeckFilter', () => {
  it('빈 필터는 모두 통과', () => {
    expect(matchesDeckFilter(flashcard(), emptyFilter(), ctx())).toBe(true)
  })

  it('타입 필터', () => {
    const f = emptyFilter()
    f.types.add('mcq')
    expect(matchesDeckFilter(mcq(), f, ctx())).toBe(true)
    expect(matchesDeckFilter(flashcard(), f, ctx())).toBe(false)
  })

  it('검색어는 요약 텍스트와 KC 이름에 걸린다', () => {
    const item = flashcard({ front: '광합성 반응식', kcId: 'k1' })
    const c = ctx({ kcById: new Map([['k1', kc({ id: 'k1', name: '생물학' })]]) })
    expect(matchesDeckFilter(item, { ...emptyFilter(), query: '광합성' }, c)).toBe(true)
    expect(matchesDeckFilter(item, { ...emptyFilter(), query: '생물' }, c)).toBe(true)
    expect(matchesDeckFilter(item, { ...emptyFilter(), query: '화학' }, c)).toBe(false)
  })

  it('cloze 검색은 {{ }} 를 벗긴 텍스트 기준', () => {
    const item = cloze({ text: '물은 {{H2O}}' })
    expect(matchesDeckFilter(item, { ...emptyFilter(), query: 'h2o' }, ctx())).toBe(false)
    expect(matchesDeckFilter(item, { ...emptyFilter(), query: '물은' }, ctx())).toBe(true)
  })

  it('분류 필터: null = 분류 없음, id = 해당 KC', () => {
    const withKc = flashcard({ kcId: 'k1' })
    const without = flashcard({ kcId: null })
    expect(matchesDeckFilter(without, { ...emptyFilter(), kcId: null }, ctx())).toBe(true)
    expect(matchesDeckFilter(withKc, { ...emptyFilter(), kcId: null }, ctx())).toBe(false)
    expect(matchesDeckFilter(withKc, { ...emptyFilter(), kcId: 'k1' }, ctx())).toBe(true)
    expect(matchesDeckFilter(withKc, { ...emptyFilter(), kcId: 'k2' }, ctx())).toBe(false)
  })

  it('상태 필터: 만기 / 예정 / 신규 / 격리', () => {
    const due = flashcard()
    const scheduled = flashcard()
    const fresh = flashcard()
    const leech = flashcard()
    const c = ctx({
      cardStates: new Map([
        [due.id, cardState(due.id, { due: new Date('2026-01-15T00:00:00.000Z') })],
        [scheduled.id, cardState(scheduled.id, { due: new Date('2026-03-01T00:00:00.000Z') })],
        [fresh.id, cardState(fresh.id, { state: 'new', reps: 0, lastReview: null })],
        [leech.id, cardState(leech.id, { due: new Date('2026-01-15T00:00:00.000Z') })],
      ]),
      leechItemIds: new Set([leech.id]),
    })
    const withStatus = (s: 'due' | 'scheduled' | 'new' | 'leech') => ({ ...emptyFilter(), status: s })

    expect(matchesDeckFilter(due, withStatus('due'), c)).toBe(true)
    expect(matchesDeckFilter(scheduled, withStatus('due'), c)).toBe(false)
    expect(matchesDeckFilter(scheduled, withStatus('scheduled'), c)).toBe(true)
    expect(matchesDeckFilter(fresh, withStatus('new'), c)).toBe(true)
    expect(matchesDeckFilter(leech, withStatus('leech'), c)).toBe(true)
    // leech는 만기 조건에서 제외
    expect(matchesDeckFilter(leech, withStatus('due'), c)).toBe(false)
  })

  it('난이도 밴드 필터', () => {
    const easy = flashcard({ kcId: 'k1' })
    const c = ctx({
      cardStates: new Map([[easy.id, cardState(easy.id)]]),
      eloState: {
        kcMastery: new Map([['k1', 0]]),
        itemDifficulty: new Map([[easy.id, -1000]]), // 회상 ≈ 1 → too-easy
      },
    })
    expect(matchesDeckFilter(easy, { ...emptyFilter(), band: 'too-easy' }, c)).toBe(true)
    expect(matchesDeckFilter(easy, { ...emptyFilter(), band: 'too-hard' }, c)).toBe(false)
  })
})
