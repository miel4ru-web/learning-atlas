// Atlas 4.4 세션 오케스트레이터 + 3.3 문항 선택 정책(선수지식 게이팅·인터리빙)을
// v1 규모에 맞게 단순화해 구현한다. "오늘 N분"을 누르면 나오는 고정 순서 —
// 이 배열을 한 번 만들어 세션 동안 그대로 따라간다(due 큐를 매번 다시 계산하지 않는다).

import type { CardState, EloState, Item, KnowledgeComponent } from '../core/types'
import { isMastered } from './elo'

export interface SessionOptions {
  budgetMinutes: number
  /** 카드 한 장에 드는 평균 시간(분) 추정치. v1은 활동 타입이 하나뿐이라 고정값. */
  costPerCardMinutes?: number
  /** 동일 KC가 연속으로 나올 수 있는 최대 횟수(Atlas 3.3 인터리빙 제약). */
  maxConsecutiveSameKc?: number
}

const DEFAULT_COST_PER_CARD_MIN = 0.75
const DEFAULT_MAX_CONSECUTIVE_SAME_KC = 2

/** Atlas 3.3 ready(): 이 KC의 모든 선수 KC가 숙달 임계값을 넘었는가. */
function isReady(kc: KnowledgeComponent | undefined, mastery: Map<string, number>): boolean {
  if (!kc) return true // 참조가 끊긴 kcId는 막지 않는다(방어적 기본값).
  return kc.prereqIds.every((prereqId) => isMastered(mastery.get(prereqId) ?? 0))
}

/**
 * 오늘 세션에 넣을 카드 순서를 만든다.
 * 1. 복습(이미 한 번 이상 채점된 만기 카드)이 항상 신규보다 우선한다.
 * 2. 신규(한 번도 채점되지 않은) 카드는 KC 선수지식이 준비된 것만 후보가 된다
 *    — 복습은 게이팅하지 않는다: 이미 시작한 카드를 선수지식 미달을 이유로
 *    멈추면 그 자체로 파지가 끊긴다.
 * 3. 예산이 허용하는 한, 같은 KC가 maxConsecutiveSameKc회 연속되지 않도록
 *    건너뛰며 담는다(뒤로 미룰 뿐 버리지 않음 — 다음 세션에서 다시 후보가 된다).
 */
export function buildSession(
  items: Item[],
  cardStates: Map<string, CardState>,
  eloState: EloState,
  kcs: KnowledgeComponent[],
  now: Date,
  options: SessionOptions,
): Item[] {
  const cost = options.costPerCardMinutes ?? DEFAULT_COST_PER_CARD_MIN
  const maxRun = options.maxConsecutiveSameKc ?? DEFAULT_MAX_CONSECUTIVE_SAME_KC
  const kcById = new Map(kcs.map((kc) => [kc.id, kc]))

  const reviews: Item[] = []
  const fresh: Item[] = []

  for (const item of items) {
    const state = cardStates.get(item.id)
    if (!state) continue
    if (state.state === 'new') {
      if (item.kcId === null || isReady(kcById.get(item.kcId), eloState.kcMastery)) {
        fresh.push(item)
      }
    } else if (state.due.getTime() <= now.getTime()) {
      reviews.push(item)
    }
  }

  reviews.sort((a, b) => cardStates.get(a.id)!.due.getTime() - cardStates.get(b.id)!.due.getTime())
  fresh.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const ranked = [...reviews, ...fresh] // 복습 우선(4부): 신규는 남은 예산 안에서만
  const plan: Item[] = []
  let budgetLeft = options.budgetMinutes
  let lastKc: string | null = null
  let run = 0

  for (const item of ranked) {
    if (budgetLeft < cost) continue // 지금은 예산 초과라도, 더 싼 후보가 뒤에 있을 수 있어 break 대신 continue
    if (item.kcId !== null && item.kcId === lastKc && run >= maxRun) continue // 인터리빙 제약 — 건너뛰고 다음 후보로

    plan.push(item)
    budgetLeft -= cost
    if (item.kcId !== null && item.kcId === lastKc) run += 1
    else {
      lastKc = item.kcId
      run = item.kcId !== null ? 1 : 0
    }
  }

  return plan
}
