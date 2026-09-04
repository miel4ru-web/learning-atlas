// Atlas 4.4 세션 오케스트레이터 + 3.3 문항 선택 정책(선수지식 게이팅·인터리빙) +
// 2부 ERR(leech 격리·재출제)를 v2 규모에 맞게 단순화해 구현한다. "오늘 N분"을
// 누르면 나오는 고정 순서 — 이 배열을 한 번 만들어 세션 동안 그대로 따라간다.

import type { CardState, EloState, Item, KnowledgeComponent } from '../core/types'
import { isMastered } from './elo'

export interface SessionOptions {
  budgetMinutes: number
  /** 카드 한 장에 드는 평균 시간(분) 추정치. v2도 활동 타입별 차이는 아직 안 둔다. */
  costPerCardMinutes?: number
  /** 동일 KC가 연속으로 나올 수 있는 최대 횟수(Atlas 3.3 인터리빙 제약). */
  maxConsecutiveSameKc?: number
  /**
   * 재출제 정책(Atlas 2부 ERR): 최근 '개념 결손'으로 틀린 KC의 id 집합.
   * 여기 속한 KC의 만기 카드는 다른 만기일 순서를 제치고 세션 앞쪽으로 온다
   * — 개념이 흔들린 채로 며칠을 더 기다리게 두지 않는다.
   */
  urgentKcIds?: ReadonlySet<string>
  /**
   * leech(Atlas 2부 ERR) 격리: fsrs.ts isLeech()로 판정한 itemId 집합.
   * buildSession은 이 집합을 그대로 신뢰하고 뺄 뿐, 판정 자체는 하지 않는다
   * — isLeech가 필요로 하는 아이템별 원본 Interaction 목록까지 이 함수에
   * 끌고 오지 않기 위해서다.
   */
  leechItemIds?: ReadonlySet<string>
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
 *    단, leechItemIds에 속한 카드는 복습 후보에서도 뺀다: 같은 방식으로
 *    계속 틀리는 카드를 계속 들이미는 건 도움이 안 된다.
 * 2. urgentKcIds에 속한 KC의 복습은 due 순서를 제치고 맨 앞으로 온다(재출제).
 * 3. 신규(한 번도 채점되지 않은) 카드는 KC 선수지식이 준비된 것만 후보가 된다
 *    — 복습은 게이팅하지 않는다: 이미 시작한 카드를 선수지식 미달을 이유로
 *    멈추면 그 자체로 파지가 끊긴다.
 * 4. 예산이 허용하는 한, 같은 KC가 maxConsecutiveSameKc회 연속되지 않도록
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
  const urgentKcIds = options.urgentKcIds ?? new Set<string>()
  const leechItemIds = options.leechItemIds ?? new Set<string>()
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
    } else if (state.due.getTime() <= now.getTime() && !leechItemIds.has(item.id)) {
      reviews.push(item)
    }
  }

  reviews.sort((a, b) => {
    const aUrgent = a.kcId !== null && urgentKcIds.has(a.kcId)
    const bUrgent = b.kcId !== null && urgentKcIds.has(b.kcId)
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1
    return cardStates.get(a.id)!.due.getTime() - cardStates.get(b.id)!.due.getTime()
  })
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

/**
 * urgentKcIds 계산: 각 KC에 대해 "그 KC를 가진 아이템들 중 가장 최근 Interaction"이
 * concept 오답이었는지 본다. App.tsx가 interactions를 들고 있으니 여기서 순수
 * 함수로 뽑아 buildSession에 넘긴다.
 */
export function findUrgentKcIds(
  items: Item[],
  latestInteractionByItem: ReadonlyMap<string, { grade: string; errorTag: string | null }>,
): Set<string> {
  const urgent = new Set<string>()
  for (const item of items) {
    if (item.kcId === null) continue
    const latest = latestInteractionByItem.get(item.id)
    if (latest && latest.grade === 'again' && latest.errorTag === 'concept') {
      urgent.add(item.kcId)
    }
  }
  return urgent
}
