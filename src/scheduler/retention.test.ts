import { describe, expect, it } from 'vitest'
import { deriveAllCardStates, buildScheduler } from './fsrs'
import { history } from '../test/factories'

// Atlas 5부: KC별 목표 파지율. FSRS에서 request_retention은 간격(=만기일)만
// 바꾸고 안정성·난이도에는 손대지 않는다 — 그래서 deriveAllCardStates에
// 아이템별 스케줄러(resolver)를 넘길 수 있다.

describe('KC별 목표 파지율', () => {
  const byItem = new Map([['a', history('a', ['good', 'good', 'good', 'good'])]])

  it('파지율이 높을수록 같은 이력에서 만기가 더 이르다', () => {
    const low = deriveAllCardStates(byItem, buildScheduler({ request_retention: 0.8 })).get('a')!
    const high = deriveAllCardStates(byItem, buildScheduler({ request_retention: 0.95 })).get('a')!
    expect(high.due.getTime()).toBeLessThan(low.due.getTime())
  })

  it('안정성·난이도는 파지율과 무관하게 동일하다', () => {
    const low = deriveAllCardStates(byItem, buildScheduler({ request_retention: 0.8 })).get('a')!
    const high = deriveAllCardStates(byItem, buildScheduler({ request_retention: 0.95 })).get('a')!
    expect(high.stability).toBeCloseTo(low.stability, 6)
    expect(high.difficulty).toBeCloseTo(low.difficulty, 6)
    expect(high.reps).toBe(low.reps)
  })

  it('resolver를 주면 아이템마다 다른 스케줄러가 적용된다', () => {
    const two = new Map([
      ['fast', history('fast', ['good', 'good', 'good'])],
      ['slow', history('slow', ['good', 'good', 'good'])],
    ])
    const states = deriveAllCardStates(two, (id) =>
      buildScheduler({ request_retention: id === 'fast' ? 0.95 : 0.8 }),
    )
    expect(states.get('fast')!.due.getTime()).toBeLessThan(states.get('slow')!.due.getTime())
  })
})
