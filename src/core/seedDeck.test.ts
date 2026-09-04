// 예시 덱은 손으로 쓴 정적 데이터라 오타가 그대로 앱에 들어간다. 앱 자신의
// 백업 검증기(parseBackup)를 통과시키는 것으로 형태를 고정한다 — 카드 하나가
// 깨져 있으면 여기서 잡힌다.

import { describe, expect, it } from 'vitest'
import { seedDeck, SEED_DECK_SIZE } from './seedDeck'
import { serializeBackup, parseBackup } from './backup'
import { extractBlanks } from '../scheduler/grading'

const deck = seedDeck()

describe('예시 덱(v22)', () => {
  it('앱의 백업 검증기를 그대로 통과한다', () => {
    const result = parseBackup(serializeBackup(deck))
    expect(result).toMatchObject({ ok: true })
  })

  it('SEED_DECK_SIZE가 실제 카드 수와 같다', () => {
    expect(deck.items).toHaveLength(SEED_DECK_SIZE)
  })

  it('id가 겹치지 않는다(merge로 여러 번 넣어도 안전)', () => {
    const itemIds = new Set(deck.items.map((i) => i.id))
    const kcIds = new Set(deck.kcs.map((k) => k.id))
    expect(itemIds.size).toBe(deck.items.length)
    expect(kcIds.size).toBe(deck.kcs.length)
  })

  it('카드가 가리키는 KC와 KC의 선수지식이 모두 덱 안에 있다', () => {
    const kcIds = new Set(deck.kcs.map((k) => k.id))
    for (const item of deck.items) {
      if (item.kcId !== null) expect(kcIds.has(item.kcId)).toBe(true)
    }
    for (const kc of deck.kcs) {
      for (const prereq of kc.prereqIds) expect(kcIds.has(prereq)).toBe(true)
    }
  })

  it('모든 활동 타입을 한 번 이상 보여준다', () => {
    const types = new Set(deck.items.map((i) => i.type))
    expect([...types].sort()).toEqual(['cloze', 'code', 'flashcard', 'free_text', 'mcq', 'short'])
  })

  it('자기 설명 카드에는 모범 답안이 있다 — 대조할 기준이 없으면 자기 채점이 불가능하다', () => {
    for (const item of deck.items) {
      if (item.type === 'free_text') expect(item.modelAnswer.trim().length).toBeGreaterThan(0)
    }
  })

  it('빈칸 카드에는 실제 빈칸이 있다', () => {
    const clozes = deck.items.filter((i) => i.type === 'cloze')
    expect(clozes.length).toBeGreaterThan(0)
    for (const item of clozes) {
      if (item.type !== 'cloze') continue
      expect(extractBlanks(item.text).length).toBeGreaterThan(0)
    }
  })

  it('단답형에는 허용 답이 하나 이상 있다', () => {
    for (const item of deck.items) {
      if (item.type === 'short') expect(item.acceptedAnswers.length).toBeGreaterThan(0)
    }
  })

  it('채점 로그는 비어 있다 — 남의 학습 기록을 심지 않는다', () => {
    expect(deck.interactions).toEqual([])
    expect(deck.schedulerSettings).toBeNull()
    expect(deck.studyPrefs).toBeNull()
  })
})
