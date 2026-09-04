import { describe, expect, it } from 'vitest'
import {
  deriveCardState,
  deriveAllCardStates,
  isDue,
  againCount,
  isLeech,
  LEECH_THRESHOLD,
} from './fsrs'
import { history, interaction } from '../test/factories'

describe('deriveCardState', () => {
  it('상호작용이 없으면 새 카드(즉시 만기)', () => {
    const s = deriveCardState('item-1', [])
    expect(s.state).toBe('new')
    expect(s.reps).toBe(0)
    expect(isDue(s)).toBe(true)
  })

  it('입력 순서와 무관하게 같은 상태를 낸다(내부에서 ts로 정렬)', () => {
    const inOrder = history('item-1', ['good', 'good', 'again', 'good'])
    const shuffled = [inOrder[2], inOrder[0], inOrder[3], inOrder[1]]
    expect(deriveCardState('item-1', shuffled)).toEqual(deriveCardState('item-1', inOrder))
  })

  it('good 반복은 안정성을 키우고 만기를 마지막 복습보다 뒤로 민다', () => {
    const s = deriveCardState('item-1', history('item-1', ['good', 'good', 'good', 'good']))
    expect(s.reps).toBe(4)
    expect(s.stability).toBeGreaterThan(0)
    expect(s.lastReview).not.toBeNull()
    expect(s.due.getTime()).toBeGreaterThan(s.lastReview!.getTime())
  })

  it('review 상태에서 again을 받으면 lapses가 늘고 안정성이 줄어든다', () => {
    const beforeLapse = deriveCardState('item-1', history('item-1', ['good', 'good', 'good', 'good']))
    const afterLapse = deriveCardState(
      'item-1',
      history('item-1', ['good', 'good', 'good', 'good', 'again']),
    )
    expect(afterLapse.lapses).toBe(beforeLapse.lapses + 1)
    expect(afterLapse.stability).toBeLessThan(beforeLapse.stability)
    expect(afterLapse.state).not.toBe('new')
  })
})

describe('deriveAllCardStates', () => {
  it('itemId → Interaction[] 맵을 그대로 카드 상태 맵으로 옮긴다', () => {
    const byItem = new Map([
      ['a', history('a', ['good'])],
      ['b', []],
    ])
    const states = deriveAllCardStates(byItem)
    expect(states.get('a')!.reps).toBe(1)
    expect(states.get('b')!.state).toBe('new')
  })
})

describe('leech 판정', () => {
  it('againCount는 again 등급만 센다', () => {
    expect(againCount(history('a', ['again', 'good', 'again', 'hard']))).toBe(2)
  })

  it(`again ${LEECH_THRESHOLD}회 이상이면 leech`, () => {
    const under = Array.from({ length: LEECH_THRESHOLD - 1 }, (_, i) =>
      interaction('a', 'again', i),
    )
    const over = Array.from({ length: LEECH_THRESHOLD }, (_, i) => interaction('a', 'again', i))
    expect(isLeech(under)).toBe(false)
    expect(isLeech(over)).toBe(true)
  })

  it('learning 상태에서만 계속 틀려도(lapses=0) leech로 잡힌다', () => {
    const stuck = history('a', ['again', 'again', 'again', 'again'])
    expect(deriveCardState('a', stuck).lapses).toBe(0)
    expect(isLeech(stuck)).toBe(true)
  })
})
