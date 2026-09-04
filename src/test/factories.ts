// 테스트용 도메인 객체 팩토리. 시각은 2026-01-01 UTC 기준 dayOffset(일)로 준다
// — FSRS/Elo 재생이 상대 간격만 보므로 절대값은 중요하지 않고, 순서만 맞으면 된다.

import type {
  ClozeItem,
  CodeItem,
  FlashcardItem,
  Grade,
  Interaction,
  KnowledgeComponent,
  McqItem,
  ShortAnswerItem,
} from '../core/types'

let seq = 0
export function resetIds(): void {
  seq = 0
}
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

const EPOCH = Date.UTC(2026, 0, 1)
export function iso(dayOffset: number): string {
  return new Date(EPOCH + dayOffset * 86_400_000).toISOString()
}

export function flashcard(o: Partial<FlashcardItem> = {}): FlashcardItem {
  return {
    id: nextId('item'),
    type: 'flashcard',
    kcId: null,
    createdAt: iso(0),
    front: 'front',
    back: 'back',
    ...o,
  }
}

export function cloze(o: Partial<ClozeItem> = {}): ClozeItem {
  return {
    id: nextId('item'),
    type: 'cloze',
    kcId: null,
    createdAt: iso(0),
    text: '물의 화학식은 {{H2O}}이다',
    ...o,
  }
}

export function mcq(o: Partial<McqItem> = {}): McqItem {
  return {
    id: nextId('item'),
    type: 'mcq',
    kcId: null,
    createdAt: iso(0),
    prompt: 'prompt',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    ...o,
  }
}

export function code(o: Partial<CodeItem> = {}): CodeItem {
  return {
    id: nextId('item'),
    type: 'code',
    kcId: null,
    createdAt: iso(0),
    prompt: 'add',
    starterCode: 'function solve(){}',
    tests: [{ args: [1, 2], expected: 3 }],
    ...o,
  }
}

export function shortAnswer(o: Partial<ShortAnswerItem> = {}): ShortAnswerItem {
  return {
    id: nextId('item'),
    type: 'short',
    kcId: null,
    createdAt: iso(0),
    prompt: 'prompt',
    acceptedAnswers: ['answer'],
    ...o,
  }
}

export function kc(o: Partial<KnowledgeComponent> = {}): KnowledgeComponent {
  return { id: nextId('kc'), name: 'KC', prereqIds: [], createdAt: iso(0), ...o }
}

export function interaction(
  itemId: string,
  grade: Grade,
  dayOffset: number,
  o: Partial<Interaction> = {},
): Interaction {
  return {
    id: nextId('x'),
    itemId,
    ts: iso(dayOffset),
    grade,
    confidence: null,
    errorTag: null,
    ...o,
  }
}

/** grade들을 하루 간격 Interaction 배열로 편다(dayOffset = 인덱스). */
export function history(itemId: string, grades: Grade[], startDay = 0): Interaction[] {
  return grades.map((g, i) => interaction(itemId, g, startDay + i))
}
