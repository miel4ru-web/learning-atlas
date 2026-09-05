// Atlas 2부 ANL — 학습 로그를 모아 상태를 보여주고 예측한다. 전부 Interaction
// 로그 위의 순수 집계다(저장하지 않는다, 다른 파생 상태들과 동일한 원칙).

import type { CardState, ErrorTag, Interaction, Item } from '../core/types'

// ---- 저품질 문항 신고(Atlas 4.6 콘텐츠 파이프라인) ----
// 문서: "사용 후 b 보정(Elo) · 저품질 문항 자동 신고(정답률 < .2 또는 > .98)".
//
// 최소 리뷰 수를 문서보다 구체적으로 잡았다. 문서의 임계값은 여러 사람이 푸는
// 문제은행을 전제하는데, 1인 덱에서는 표본이 적어 그냥 적용하면 오탐이 쏟아진다.
// 특히 상단(너무 쉬움)은 다르다: 5번 연속 정답은 SRS에서 지극히 정상이라
// 신고할 일이 아니고, "열 번 넘게 만났는데 한 번도 안 틀렸다"쯤 되어야 비로소
// "이 카드는 이제 정보가 없다"는 신호가 된다. 반대로 하단(자주 틀림)은 표본이
// 적어도 문제 자체가 이상할 가능성이 높아 더 일찍 알려주는 편이 낫다.
const BROKEN_BELOW = 0.2
const TOO_EASY_ABOVE = 0.98
const MIN_REVIEWS_BROKEN = 5
const MIN_REVIEWS_TOO_EASY = 10

/** broken = 너무 자주 틀린다(문항·정답이 이상하거나 카드가 너무 크다), too-easy = 정보가 없다. */
export type ItemQualityFlag = 'broken' | 'too-easy'

export interface ItemQualityReport {
  itemId: string
  reviews: number
  accuracy: number
  flag: ItemQualityFlag
}

/**
 * 카드별 정답률로 "점검이 필요한 카드"를 골라낸다. 저장하지 않는 순수 집계 —
 * byItem(AtlasProvider가 이미 들고 있는 파생 상태)을 그대로 받아 쓴다.
 * 신고 순서는 심한 것부터(정답률이 낮은 broken → 높은 too-easy).
 */
export function flagLowQualityItems(
  items: Item[],
  byItem: ReadonlyMap<string, Interaction[]>,
): ItemQualityReport[] {
  const reports: ItemQualityReport[] = []

  for (const item of items) {
    const log = byItem.get(item.id) ?? []
    if (log.length === 0) continue
    const accuracy = log.filter((i) => i.grade !== 'again').length / log.length

    if (accuracy < BROKEN_BELOW && log.length >= MIN_REVIEWS_BROKEN) {
      reports.push({ itemId: item.id, reviews: log.length, accuracy, flag: 'broken' })
    } else if (accuracy > TOO_EASY_ABOVE && log.length >= MIN_REVIEWS_TOO_EASY) {
      reports.push({ itemId: item.id, reviews: log.length, accuracy, flag: 'too-easy' })
    }
  }

  return reports.sort((a, b) => a.accuracy - b.accuracy)
}

// ---- 오개념 집계(Atlas 3.4) ----
// 저장하는 건 없다. "몇 번 선택지를 골랐나"(v19 selectedIndex)와 "그 선택지가 무슨
// 오개념인가"(McqItem.distractorTags)를 로그 위에서 이어 붙이기만 한다.

export interface MisconceptionCount {
  label: string
  count: number
  /** 이 오개념이 나타난 카드들 — 같은 오개념이 여러 문항에 걸쳐 있으면 진짜 개념 결손이다. */
  itemIds: string[]
}

/**
 * 오답으로 고른 선택지에 붙은 오개념 라벨을 세어 많이 걸린 순으로 돌려준다.
 * byItem은 이미 걸러진(사전 테스트 제외) 로그를 받는다 — AtlasProvider 참고.
 */
export function countMisconceptions(
  items: Item[],
  byItem: ReadonlyMap<string, Interaction[]>,
): MisconceptionCount[] {
  const counts = new Map<string, { count: number; itemIds: Set<string> }>()

  for (const item of items) {
    if (item.type !== 'mcq' || !item.distractorTags) continue
    for (const log of byItem.get(item.id) ?? []) {
      const picked = log.selectedIndex
      if (picked === undefined || picked === item.correctIndex) continue
      const label = item.distractorTags[picked]
      if (!label) continue

      const entry = counts.get(label) ?? { count: 0, itemIds: new Set<string>() }
      entry.count += 1
      entry.itemIds.add(item.id)
      counts.set(label, entry)
    }
  }

  return [...counts.entries()]
    .map(([label, { count, itemIds }]) => ({ label, count, itemIds: [...itemIds] }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

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

// ---- 오답 원인 분포(v32, Atlas 2부 ERR) ----
// errorTag는 지금까지 session.ts의 긴급 KC 판정과 Deck.tsx 뱃지에만 쓰이고
// 집계가 없었다. "부주의가 절반"과 "개념 오류가 절반"은 처방이 완전히 다르므로
// 학습자에게 가장 실행 가능한 지표다.

export interface ErrorTagCount {
  tag: ErrorTag
  count: number
}

/** again으로 채점되고 사유를 골랐던 것만 센다(건너뛰면 errorTag가 null). */
export function countErrorTags(byItem: ReadonlyMap<string, Interaction[]>): ErrorTagCount[] {
  const counts = new Map<ErrorTag, number>()
  for (const log of byItem.values()) {
    for (const interaction of log) {
      if (interaction.errorTag == null) continue
      counts.set(interaction.errorTag, (counts.get(interaction.errorTag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
}

// ---- 정답률 추이(v32) ----

export interface AccuracyTrendDay {
  dateKey: string
  label: string
  reviews: number
  /** reviews가 0이면 표시할 값이 없다는 뜻으로 0을 둔다 — 호출부가 reviews로 걸러야 한다. */
  accuracy: number
}

/** 최근 days일(오늘 포함) 동안의 일별 리뷰 수·정답률. */
export function accuracyTrend(
  byItem: ReadonlyMap<string, Interaction[]>,
  now: Date,
  days = 30,
): AccuracyTrendDay[] {
  const buckets = new Map<string, { correct: number; total: number }>()
  const order: string[] = []
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  for (let i = 0; i < days; i++) {
    const key = localDateKey(cursor)
    order.push(key)
    buckets.set(key, { correct: 0, total: 0 })
    cursor.setDate(cursor.getDate() + 1)
  }

  for (const log of byItem.values()) {
    for (const interaction of log) {
      const bucket = buckets.get(localDateKey(new Date(interaction.ts)))
      if (!bucket) continue // 창 밖(더 오래된) 로그는 건너뛴다
      bucket.total += 1
      if (interaction.grade !== 'again') bucket.correct += 1
    }
  }

  const todayKey = localDateKey(now)
  return order.map((key) => {
    const bucket = buckets.get(key)!
    return {
      dateKey: key,
      label: key === todayKey ? '오늘' : key.slice(5), // MM-DD
      reviews: bucket.total,
      accuracy: bucket.total > 0 ? bucket.correct / bucket.total : 0,
    }
  })
}

// ---- 느린 카드(v32) — latencyMs의 첫 소비자 ----
// latencyMs는 v19부터 기록됐지만 여태 읽는 코드가 없었다. "맞히긴 하는데 오래
// 걸린다"는 절차적 지식이 아직 자동화되지 않았다는 신호다(정확도 × 속도의 첫걸음).

export interface SlowItemReport {
  itemId: string
  medianLatencyMs: number
  reviews: number
}

const MIN_LATENCY_SAMPLES = 3

/** 정답 채점 중 응답시간 중앙값이 큰 카드 순. latencyMs 없는 로그(v18 이전 등)는 제외. */
export function slowestItems(
  items: Item[],
  byItem: ReadonlyMap<string, Interaction[]>,
  limit = 10,
): SlowItemReport[] {
  const reports: SlowItemReport[] = []

  for (const item of items) {
    const log = byItem.get(item.id) ?? []
    const latencies = log
      .filter((i): i is Interaction & { latencyMs: number } => i.grade !== 'again' && i.latencyMs !== undefined)
      .map((i) => i.latencyMs)
      .sort((a, b) => a - b)
    if (latencies.length < MIN_LATENCY_SAMPLES) continue

    const mid = Math.floor(latencies.length / 2)
    const medianLatencyMs =
      latencies.length % 2 === 0 ? (latencies[mid - 1] + latencies[mid]) / 2 : latencies[mid]
    reports.push({ itemId: item.id, medianLatencyMs, reviews: latencies.length })
  }

  return reports.sort((a, b) => b.medianLatencyMs - a.medianLatencyMs).slice(0, limit)
}
