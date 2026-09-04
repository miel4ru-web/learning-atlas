import { describe, expect, it } from 'vitest'
import {
  deriveEloState,
  expectedScore,
  masteryProbability,
  isMastered,
  MASTERY_THETA,
} from './elo'
import { flashcard, history, interaction } from '../test/factories'

describe('expectedScore', () => {
  it('θ == b 이면 0.5', () => {
    expect(expectedScore(100, 100)).toBeCloseTo(0.5)
  })
  it('θ가 높을수록 기대 정답률이 오른다(단조)', () => {
    expect(expectedScore(400, 0)).toBeGreaterThan(expectedScore(0, 0))
    expect(expectedScore(0, 0)).toBeGreaterThan(expectedScore(-400, 0))
  })
})

describe('deriveEloState', () => {
  it('kcId 없는 아이템의 상호작용은 건너뛴다', () => {
    const item = flashcard({ kcId: null })
    const state = deriveEloState([item], history(item.id, ['good', 'again']))
    expect(state.kcMastery.size).toBe(0)
    expect(state.itemDifficulty.size).toBe(0)
  })

  it('성공은 θ를 올리고 문항 난이도를 내린다; 실패는 반대', () => {
    const item = flashcard({ kcId: 'kc-1' })
    const up = deriveEloState([item], history(item.id, ['good']))
    const down = deriveEloState([item], history(item.id, ['again']))
    expect(up.kcMastery.get('kc-1')!).toBeGreaterThan(0)
    expect(up.itemDifficulty.get(item.id)!).toBeLessThan(0)
    expect(down.kcMastery.get('kc-1')!).toBeLessThan(0)
    expect(down.itemDifficulty.get(item.id)!).toBeGreaterThan(0)
  })

  it('같은 KC를 공유하는 여러 아이템의 상호작용이 전역 시간순으로 θ에 누적된다', () => {
    const a = flashcard({ kcId: 'kc-1' })
    const b = flashcard({ kcId: 'kc-1' })
    const log = [
      interaction(a.id, 'good', 0),
      interaction(b.id, 'good', 1),
      interaction(a.id, 'good', 2),
    ]
    const single = deriveEloState([a], [interaction(a.id, 'good', 0)])
    const shared = deriveEloState([a, b], log)
    expect(shared.kcMastery.get('kc-1')!).toBeGreaterThan(single.kcMastery.get('kc-1')!)
  })

  it('정렬되지 않은 로그를 넣어도 결과가 같다(내부 정렬)', () => {
    const item = flashcard({ kcId: 'kc-1' })
    const ordered = history(item.id, ['good', 'again', 'good'])
    const jumbled = [ordered[2], ordered[0], ordered[1]]
    expect(deriveEloState([item], jumbled)).toEqual(deriveEloState([item], ordered))
  })
})

describe('masteryProbability / isMastered', () => {
  it('MASTERY_THETA에서 회상 확률이 약 0.85', () => {
    expect(masteryProbability(MASTERY_THETA)).toBeCloseTo(0.85, 2)
  })
  it('임계값 경계', () => {
    expect(isMastered(MASTERY_THETA)).toBe(true)
    expect(isMastered(MASTERY_THETA - 1)).toBe(false)
  })
})
