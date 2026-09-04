// Atlas 2부 ANL — 학습 로그를 모아 상태를 보여주고 예측한다. 전부 Interaction
// 로그 위의 순수 집계다(저장하지 않는다, 다른 파생 상태들과 동일한 원칙).

import type { CardState, Interaction, Item } from '../core/types'

export interface Totals {
  totalItems: number
  totalReviews: number
  activeDays: number
  currentStreak: number
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function computeTotals(items: Item[], interactions: Interaction[], now: Date): Totals {
  const activeDates = new Set<string>()
  for (const i of interactions) activeDates.add(localDateKey(new Date(i.ts)))

  // 스트릭: 오늘부터 거꾸로 세되, "오늘"은 아직 아무것도 안 했어도 스트릭을
  // 끊지 않는다 — 하루가 아직 안 끝났을 뿐이다. 오늘 이후 첫 공백에서 멈춘다.
  let streak = 0
  const cursor = new Date(now)
  if (!activeDates.has(localDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1)
  }
  while (activeDates.has(localDateKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  return {
    totalItems: items.length,
    totalReviews: interactions.length,
    activeDays: activeDates.size,
    currentStreak: streak,
  }
}

export interface ForecastDay {
  dateKey: string
  label: string
  count: number
}

/** 앞으로 days일(오늘 포함) 동안 만기가 되는 카드 수 — leechItemIds는 제외(세션에 어차피 안 나오므로). */
export function computeForecast(
  cardStates: ReadonlyMap<string, CardState>,
  leechItemIds: ReadonlySet<string>,
  now: Date,
  days = 7,
): ForecastDay[] {
  const buckets = new Map<string, number>()
  const order: string[] = []
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  for (let i = 0; i < days; i++) {
    const key = localDateKey(cursor)
    order.push(key)
    buckets.set(key, 0)
    cursor.setDate(cursor.getDate() + 1)
  }
  const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)

  for (const [itemId, state] of cardStates) {
    if (state.state === 'new' || leechItemIds.has(itemId)) continue
    if (state.due.getTime() >= horizon.getTime()) continue
    const key = localDateKey(state.due.getTime() < now.getTime() ? now : state.due)
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  const todayKey = localDateKey(now)
  return order.map((key, i) => ({
    dateKey: key,
    label: key === todayKey ? '오늘' : i === 1 ? '내일' : `${i}일 후`,
    count: buckets.get(key) ?? 0,
  }))
}
