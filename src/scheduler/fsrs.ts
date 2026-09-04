// Atlas 3.1 스케줄링 계층. ts-fsrs(FSRS-6 레퍼런스 구현)를 감싼다 — 21개
// 모수를 손으로 재구현하지 않고, 검증된 라이브러리에 위임한다.
//
// 카드 상태는 저장하지 않는다. deriveCardState()가 Interaction 로그를
// 순서대로 재생해 매번 계산한다 — Atlas 4.2의 핵심 결정: 스케줄러를
// 교체해도(SM-2 → FSRS, 또는 FSRS 모수 재적합) 과거 로그로 전량 재계산 가능.

import {
  fsrs,
  createEmptyCard,
  Rating,
  State,
  type Card,
  type FSRS,
  type FSRSParameters,
  type Grade as FsrsGrade,
} from 'ts-fsrs'
import type { Grade, Interaction, CardState } from '../core/types'

// 목표 파지율. Atlas 3.1: "목표 파지율을 정하면 간격은 역산된다."
// 0.90 = 암기형 기본값(5부 매트릭스). v3부터는 고정 상수가 아니라
// buildScheduler()로 만든다 — 개인 로그로 재적합한 파라미터(scheduler/
// optimizer.ts)를 넣어 바꿔치기할 수 있어야 하기 때문(Atlas 4.2: 스케줄러
// 교체 시 과거 로그로 전량 재계산 가능해야 한다).
export function buildScheduler(params: Partial<FSRSParameters> = {}): FSRS {
  return fsrs({ request_retention: 0.9, ...params })
}

const defaultScheduler = buildScheduler()

export const GRADE_TO_RATING: Record<Grade, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}

const STATE_LABEL: Record<State, CardState['state']> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
}

function toCardState(itemId: string, card: Card): CardState {
  return {
    itemId,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_LABEL[card.state],
    lastReview: card.last_review ?? null,
  }
}

/**
 * itemId 하나의 Interaction들(오래된 순)을 처음부터 재생해 현재 카드 상태를 구한다.
 * interactions가 비어 있으면 "새 카드"(즉시 만기) 상태를 반환한다.
 * scheduler를 지정하지 않으면 기본 파라미터(request_retention=0.9, FSRS-6 기본
 * 가중치)를 쓴다 — 개인 재적합 결과를 반영하려면 buildScheduler()로 만든
 * 인스턴스를 넘긴다(App.tsx가 저장된 설정을 로드해 이렇게 한다).
 */
export function deriveCardState(
  itemId: string,
  interactions: Interaction[],
  scheduler: FSRS = defaultScheduler,
): CardState {
  const sorted = [...interactions].sort((a, b) => a.ts.localeCompare(b.ts))
  let card: Card = createEmptyCard(sorted.length > 0 ? new Date(sorted[0].ts) : new Date())
  for (const interaction of sorted) {
    const now = new Date(interaction.ts)
    const result = scheduler.next(card, now, GRADE_TO_RATING[interaction.grade])
    card = result.card
  }
  return toCardState(itemId, card)
}

/** 여러 아이템의 카드 상태를 한 번에 구한다. itemId → Interaction[] 로 묶어서 넘긴다. */
export function deriveAllCardStates(
  interactionsByItem: Map<string, Interaction[]>,
  scheduler: FSRS = defaultScheduler,
): Map<string, CardState> {
  const result = new Map<string, CardState>()
  for (const [itemId, interactions] of interactionsByItem) {
    result.set(itemId, deriveCardState(itemId, interactions, scheduler))
  }
  return result
}

export function isDue(state: CardState, now: Date = new Date()): boolean {
  return state.due.getTime() <= now.getTime()
}

// Atlas 2부 ERR: "반복 실패 카드 격리(leech)".
//
// 처음엔 CardState.lapses(ts-fsrs 내부 카운터)를 그대로 쓰려 했으나, 그 값은
// "복습 상태에서 다시 잊어버린 횟수"만 세고, 배우는 중(Learning) 계속
// again을 받는 경우는 전혀 세지 않는다 — 한 번도 review 상태로 넘어가 보지
// 못한 채 계속 틀리는, 어떤 의미로는 가장 심한 leech가 lapses=0으로
// 잡힌다(_debug_lapses.ts로 확인). Anki의 leech 판정처럼 "전체 again
// 횟수"를 직접 세는 편이 의도(계속 틀리는 카드)에 더 가깝다.
export const LEECH_THRESHOLD = 4

export function againCount(interactions: Interaction[]): number {
  return interactions.filter((i) => i.grade === 'again').length
}

export function isLeech(interactions: Interaction[]): boolean {
  return againCount(interactions) >= LEECH_THRESHOLD
}
