// 사전 테스트(v23)의 핵심 계약: 로그에는 남지만 파생 학습 상태에는 없는 것처럼
// 동작해야 한다. "필터를 통과시킨 로그로 재생한 결과 == 애초에 그 채점이 없었을
// 때의 결과"를 FSRS·Elo 양쪽에서 확인한다.

import { describe, expect, it } from 'vitest'
import { isScored, scoredOnly, pretestedItemIds } from './interactions'
import { deriveAllCardStates, buildScheduler } from '../scheduler/fsrs'
import { deriveEloState } from '../scheduler/elo'
import { flashcard, history, interaction } from '../test/factories'
import type { Interaction } from './types'

const scheduler = buildScheduler({})
const schedulerFor = () => scheduler

function byItem(interactions: Interaction[], itemId: string): Map<string, Interaction[]> {
  return new Map([[itemId, interactions]])
}

describe('isScored / scoredOnly', () => {
  it('사전 테스트만 걸러낸다', () => {
    const normal = interaction('i1', 'good', 0)
    const pre = interaction('i1', 'again', 1, { pretest: true })
    expect(isScored(normal)).toBe(true)
    expect(isScored(pre)).toBe(false)
    expect(scoredOnly([normal, pre])).toEqual([normal])
  })

  it('pretest 필드가 없는 구버전 로그는 그대로 센다', () => {
    const old = interaction('i1', 'good', 0)
    expect('pretest' in old).toBe(false)
    expect(isScored(old)).toBe(true)
  })
})

describe('사전 테스트는 파생 상태를 바꾸지 않는다', () => {
  it('FSRS 카드 상태가 사전 테스트 유무와 무관하게 같다', () => {
    const item = flashcard({ id: 'i1' })
    const real = history(item.id, ['good', 'good'], 1)
    const pre = interaction(item.id, 'again', 0, { pretest: true })

    const withoutPretest = deriveAllCardStates(byItem(real, item.id), schedulerFor)
    const withPretest = deriveAllCardStates(
      byItem(scoredOnly([pre, ...real]), item.id),
      schedulerFor,
    )

    expect(withPretest.get(item.id)).toEqual(withoutPretest.get(item.id))
  })

  it('Elo 숙달도도 마찬가지다', () => {
    const item = flashcard({ id: 'i1', kcId: 'kc-1' })
    const real = history(item.id, ['good', 'good'], 1)
    const pre = interaction(item.id, 'again', 0, { pretest: true })

    const withoutPretest = deriveEloState([item], real)
    const withPretest = deriveEloState([item], scoredOnly([pre, ...real]))

    expect(withPretest.kcMastery.get('kc-1')).toBe(withoutPretest.kcMastery.get('kc-1'))
  })

  it('거르지 않으면 실제로 달라진다 — 필터가 하는 일이 있다는 확인', () => {
    const item = flashcard({ id: 'i1', kcId: 'kc-1' })
    const real = history(item.id, ['good', 'good'], 1)
    const pre = interaction(item.id, 'again', 0, { pretest: true })

    const unfiltered = deriveEloState([item], [pre, ...real])
    const filtered = deriveEloState([item], scoredOnly([pre, ...real]))
    expect(unfiltered.kcMastery.get('kc-1')).not.toBe(filtered.kcMastery.get('kc-1'))
  })
})

describe('pretestedItemIds', () => {
  it('사전 테스트로 낸 적 있는 아이템 id만 모은다', () => {
    const logs = [
      interaction('i1', 'good', 0),
      interaction('i2', 'again', 1, { pretest: true }),
      interaction('i2', 'good', 2),
    ]
    expect([...pretestedItemIds(logs)]).toEqual(['i2'])
  })
})
