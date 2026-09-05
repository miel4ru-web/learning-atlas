// 만기 카드 수 계산 — AtlasProvider(페이지)와 sw.ts(서비스 워커) 양쪽에서 똑같이
// 써야 한다. 두 곳에 각자 복사해 두면 한쪽만 고쳐지는 사고가 난다 — 여기 하나만
// 진실의 원천으로 둔다. db.ts·interactions.ts·fsrs.ts와 마찬가지로 DOM에 의존하는
// 게 하나도 없어 서비스 워커에서도 그대로 import해 쓸 수 있다(core/reminder.ts 참고).

import type { CardState, Interaction, Item, KnowledgeComponent, SchedulerSettings } from './types'
import { buildScheduler, deriveAllCardStates, isLeech } from '../scheduler/fsrs'
import { scoredOnly } from './interactions'

/** AtlasProvider.tsx의 byItem 규칙과 같다 — 이력 없는 아이템도 빈 배열로 채운다
 *  (그래야 새 카드도 cardStates에 "new" 상태로 잡힌다). */
export function groupByItem(
  items: readonly Item[],
  interactions: readonly Interaction[],
): Map<string, Interaction[]> {
  const map = new Map<string, Interaction[]>()
  for (const it of interactions) {
    const list = map.get(it.itemId)
    if (list) list.push(it)
    else map.set(it.itemId, [it])
  }
  for (const item of items) {
    if (!map.has(item.id)) map.set(item.id, [])
  }
  return map
}

/**
 * 아이템 → (그 KC의 목표 파지율로 만든) 스케줄러 조회 함수. AtlasProvider.tsx의
 * schedulerForItem useMemo와 같은 규칙(Atlas 5부 "매트릭스") — 등장하는 파지율
 * 값마다 인스턴스를 하나만 만들어 두고, 반환 함수는 조회만 한다.
 */
export function buildSchedulerForItem(
  items: readonly Item[],
  kcs: readonly KnowledgeComponent[],
  schedulerSettings: SchedulerSettings | null,
): (itemId: string) => ReturnType<typeof buildScheduler> {
  const globalRetention = schedulerSettings?.requestRetention ?? 0.9
  const customWeights = schedulerSettings?.w

  const retentionOfKc = new Map(kcs.map((k) => [k.id, k.requestRetention]))
  const itemKc = new Map(items.map((it) => [it.id, it.kcId]))

  const retentions = new Set<number>([globalRetention])
  for (const k of kcs) if (k.requestRetention != null) retentions.add(k.requestRetention)

  const byRetention = new Map<number, ReturnType<typeof buildScheduler>>()
  for (const r of retentions) {
    byRetention.set(
      r,
      buildScheduler(customWeights ? { w: customWeights, request_retention: r } : { request_retention: r }),
    )
  }

  return (itemId: string) => {
    const kcId = itemKc.get(itemId) ?? null
    const r = (kcId !== null ? retentionOfKc.get(kcId) : undefined) ?? globalRetention
    return byRetention.get(r) ?? byRetention.get(globalRetention)!
  }
}

/**
 * 만기 판정 규칙 자체. 이 앱에서 "몇 장 밀렸나"의 정의는 여기 한 줄뿐이다 —
 * new 상태(한 번도 안 본 카드)와 leech(격리된 카드)는 세지 않는다.
 */
export function countDue(
  cardStates: ReadonlyMap<string, CardState>,
  leechItemIds: ReadonlySet<string>,
  now: Date,
): number {
  let n = 0
  for (const [itemId, state] of cardStates) {
    if (state.state !== 'new' && state.due.getTime() <= now.getTime() && !leechItemIds.has(itemId)) {
      n++
    }
  }
  return n
}

/**
 * 원본 배열에서 체인 전체(사전 테스트 제외 → 카드 상태 재생 → leech 판정 →
 * 만기 카운트)를 돌려 만기 수까지 한 번에 낸다. AtlasProvider가 이미 메모해 둔
 * cardStates/leechItemIds를 쓸 수 없는 곳 — 서비스 워커(sw.ts)나 "지금 이 순간
 * 기준으로 다시 세야 하는" 알림 훅(shell/useForegroundReminder.ts) — 에서만
 * 쓴다. 평소 화면은 AtlasProvider의 dueCount(countDue 호출)를 그대로 쓴다.
 */
export function computeDueCountFromData(
  items: readonly Item[],
  interactions: readonly Interaction[],
  kcs: readonly KnowledgeComponent[],
  schedulerSettings: SchedulerSettings | null,
  now: Date,
): number {
  const scored = scoredOnly(interactions)
  const byItem = groupByItem(items, scored)
  const schedulerForItem = buildSchedulerForItem(items, kcs, schedulerSettings)
  const cardStates = deriveAllCardStates(byItem, schedulerForItem)
  const leechItemIds = new Set(
    items.filter((item) => isLeech(byItem.get(item.id) ?? [])).map((i) => i.id),
  )
  return countDue(cardStates, leechItemIds, now)
}
