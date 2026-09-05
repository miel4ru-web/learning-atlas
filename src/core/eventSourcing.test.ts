// Atlas 4.2의 핵심 주장을 CI로 박제한다: "파생 상태는 저장하지 않고 Interaction
// 로그를 재생해 매번 얻는다 — 로그가 유일한 진실의 원천이고, 재생 순서·저장
// 형태와 무관하게 같은 결과가 나와야 한다."

import { describe, expect, it } from 'vitest'
import { deriveAllCardStates } from '../scheduler/fsrs'
import { deriveEloState } from '../scheduler/elo'
import { serializeBackup, parseBackup } from './backup'
import type { DbSnapshot } from './db'
import { flashcard, interaction } from '../test/factories'

function groupByItem(interactions: DbSnapshot['interactions']) {
  const map = new Map<string, DbSnapshot['interactions']>()
  for (const it of interactions) {
    const list = map.get(it.itemId)
    if (list) list.push(it)
    else map.set(it.itemId, [it])
  }
  return map
}

function scenario(): DbSnapshot {
  const a = flashcard({ id: 'a', kcId: 'kc-1' })
  const b = flashcard({ id: 'b', kcId: 'kc-1' })
  const c = flashcard({ id: 'c', kcId: 'kc-2' })
  const grades = ['good', 'good', 'again', 'good', 'hard', 'good'] as const
  const interactions = [
    ...grades.map((g, i) => interaction('a', g, i)),
    ...grades.map((g, i) => interaction('b', g === 'again' ? 'good' : g, i + 0.5)),
    ...grades.map((g, i) => interaction('c', g, i + 0.25)),
  ]
  return {
    items: [a, b, c],
    interactions,
    kcs: [],
    schedulerSettings: null,
    studyPrefs: null,
    sessions: [],
  }
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

describe('재생 결정성', () => {
  it('Interaction 배열 순서를 섞어도 카드 상태·Elo 숙달도가 동일하다', () => {
    const snap = scenario()
    const ordered = snap.interactions

    const baselineCards = deriveAllCardStates(groupByItem(ordered))
    const baselineElo = deriveEloState(snap.items, ordered)

    for (const seed of [1, 7, 42, 999]) {
      const jumbled = shuffle(ordered, seed)
      expect(deriveAllCardStates(groupByItem(jumbled))).toEqual(baselineCards)
      expect(deriveEloState(snap.items, jumbled)).toEqual(baselineElo)
    }
  })

  it('백업으로 내보냈다 되돌려도 파생 상태가 그대로 재구성된다', () => {
    const snap = scenario()
    const restored = parseBackup(serializeBackup(snap))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return

    expect(deriveAllCardStates(groupByItem(restored.snapshot.interactions))).toEqual(
      deriveAllCardStates(groupByItem(snap.interactions)),
    )
    expect(deriveEloState(restored.snapshot.items, restored.snapshot.interactions)).toEqual(
      deriveEloState(snap.items, snap.interactions),
    )
  })

  it('빈 로그 → 모든 카드가 "새 카드"', () => {
    const snap = scenario()
    const states = deriveAllCardStates(groupByItem([]))
    expect(states.size).toBe(0)
    const withItems = deriveAllCardStates(
      new Map(snap.items.map((i) => [i.id, []])),
    )
    expect([...withItems.values()].every((s) => s.state === 'new')).toBe(true)
  })
})
