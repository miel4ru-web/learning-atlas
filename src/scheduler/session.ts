// Atlas 4.4 세션 오케스트레이터 + 3.3 문항 선택 정책(선수지식 게이팅·인터리빙·
// 바람직한 어려움 밴드) + 2부 ERR(leech 격리·재출제)를 v2 규모에 맞게 단순화해
// 구현한다. "오늘 N분"을 누르면 나오는 고정 순서 — 이 배열을 한 번 만들어 세션
// 동안 그대로 따라간다.

import type { CardState, EloState, Item, KnowledgeComponent } from '../core/types'
import { isMastered } from './elo'
import { bandOf, bandRank, predictedRecall } from './selection'

export interface SessionOptions {
  budgetMinutes: number
  /** 카드 한 장에 드는 평균 시간(분) 추정치. v2도 활동 타입별 차이는 아직 안 둔다. */
  costPerCardMinutes?: number
  /** 동일 KC가 연속으로 나올 수 있는 최대 횟수(Atlas 3.3 인터리빙 제약). */
  maxConsecutiveSameKc?: number
  /**
   * 동일 활동 타입이 연속으로 나올 수 있는 최대 횟수(Atlas 3.3의 두 번째 인터리빙
   * 제약). KC 제약과 목적이 다르다 — KC 섞기는 "무엇을 아는가"를 섞고, 타입 섞기는
   * "어떤 방식으로 인출하는가"를 섞어 문항 형태에 대한 과적합(1부 전이)을 막는다.
   * 활동 타입이 다섯이 된 v17부터 실효가 생겼다.
   */
  maxConsecutiveSameType?: number
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
  /**
   * 백로그 정책(Atlas 3.1): 만기 복습이 아무리 많아도 오늘 후보로는 이 개수까지만
   * 삼는다(정렬 후 상위 N). 나머지는 버려지지 않는다 — cardStates가 그대로라
   * 다음 세션에서 다시 후보가 되고, 매번 같은 상한을 적용하면 며칠에 걸쳐
   * 자연히 상환된다(별도 "상환 스케줄"을 저장할 필요가 없다). null/undefined면
   * 무제한(기존 동작).
   */
  dailyReviewCap?: number | null
  /**
   * 휴가 모드(Atlas 3.1): true면 신규(미채점) 카드를 후보에서 아예 뺀다.
   * 복귀 직후엔 밀린 복습부터 갚는 게 우선이라는 문서의 결론 — "부재 기간을
   * 모델에 알리는" 별도 장치가 필요한 게 아니라, 상환 램프(dailyReviewCap)와
   * 신규 도입 정지 두 가지면 충분하다.
   */
  vacationMode?: boolean
}

const DEFAULT_COST_PER_CARD_MIN = 0.75
const DEFAULT_MAX_CONSECUTIVE_SAME_KC = 2
const DEFAULT_MAX_CONSECUTIVE_SAME_TYPE = 3 // 문서 3.3이 예로 든 값

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
 * 2b. 그다음은 "바람직한 어려움" 밴드 순(selection.ts) — 예측 인출률이 0.70–0.85인
 *     카드가 먼저, 과학습(>0.85) 카드가 맨 뒤. 같은 밴드 안에서만 due 순서를 본다.
 *     v1부터 계산만 되고 안 쓰이던 Elo 문항 난이도 b를 여기서 처음 쓴다.
 * 3. 신규(한 번도 채점되지 않은) 카드는 KC 선수지식이 준비된 것만 후보가 된다
 *    — 복습은 게이팅하지 않는다: 이미 시작한 카드를 선수지식 미달을 이유로
 *    멈추면 그 자체로 파지가 끊긴다.
 * 4. 예산이 허용하는 한, 같은 KC가 maxConsecutiveSameKc회, 같은 활동 타입이
 *    maxConsecutiveSameType회를 넘겨 연속되지 않도록 건너뛰며 담는다. 단 제약에
 *    걸려 밀린 카드는 버리지 않고, 예산이 남으면 마지막에 되살린다 — 섞을 상대가
 *    없다고 세션이 두세 장으로 잘리는 게 더 나쁘기 때문(아래 fillFrom 주석).
 * 5. dailyReviewCap(3.1 백로그 정책)이 있으면 정렬된 복습 후보 중 상위 N개만
 *    남긴다 — 밀린 게 아무리 많아도 하루에 다 쏟지 않는다. vacationMode면
 *    신규 카드는 아예 후보에서 뺀다.
 */
export function buildSession(
  items: Item[],
  cardStates: ReadonlyMap<string, CardState>,
  eloState: EloState,
  kcs: KnowledgeComponent[],
  now: Date,
  options: SessionOptions,
): Item[] {
  const cost = options.costPerCardMinutes ?? DEFAULT_COST_PER_CARD_MIN
  const maxRun = options.maxConsecutiveSameKc ?? DEFAULT_MAX_CONSECUTIVE_SAME_KC
  const maxTypeRun = options.maxConsecutiveSameType ?? DEFAULT_MAX_CONSECUTIVE_SAME_TYPE
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

    // 바람직한 어려움 밴드 순 — 같은 밴드 안에서만 만기일로 가른다.
    const aRank = bandRank(bandOf(predictedRecall(a, eloState)))
    const bRank = bandRank(bandOf(predictedRecall(b, eloState)))
    if (aRank !== bRank) return aRank - bRank

    return cardStates.get(a.id)!.due.getTime() - cardStates.get(b.id)!.due.getTime()
  })
  fresh.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const cappedReviews =
    options.dailyReviewCap != null ? reviews.slice(0, options.dailyReviewCap) : reviews
  const rankedFresh = options.vacationMode ? [] : fresh

  const ranked = [...cappedReviews, ...rankedFresh] // 복습 우선(4부): 신규는 남은 예산 안에서만
  const plan: Item[] = []
  let budgetLeft = options.budgetMinutes
  let lastKc: string | null = null
  let run = 0
  let lastType: Item['type'] | null = null
  let typeRun = 0
  // 인터리빙 제약에 걸려 1차 패스에서 밀린 카드들. 버리지 않고 아래에서 되살린다.
  const deferredByType: Item[] = []
  const deferredByKc: Item[] = []

  function place(item: Item) {
    plan.push(item)
    budgetLeft -= cost
    if (item.kcId !== null && item.kcId === lastKc) run += 1
    else {
      lastKc = item.kcId
      run = item.kcId !== null ? 1 : 0
    }
    if (item.type === lastType) typeRun += 1
    else {
      lastType = item.type
      typeRun = 1
    }
  }

  /**
   * 밀린 카드를 예산이 허용하는 만큼 채운다. 직전 카드와 key가 다른 후보 중에서
   * "남은 개수가 가장 많은 key"의 가장 앞(=점수가 높은) 카드를 고른다 — 그냥 앞에서부터
   * 집으면 수가 적은 key가 먼저 소진되고 많은 key가 꼬리에 몰려 결국 연속된다.
   * 섞을 상대가 아예 없으면 순서대로 채운다(제약을 양보하는 지점).
   * 예산이나 isEligible에 막혀 못 넣은 카드는 그대로 돌려준다 — 다음 단계가 이어받는다.
   */
  function fillFrom(
    pending: Item[],
    keyOf: (item: Item) => string | null,
    lastKeyOf: () => string | null,
    isEligible: (item: Item) => boolean = () => true,
  ): Item[] {
    const rest = [...pending]
    while (budgetLeft >= cost && rest.length > 0) {
      const eligible = rest.filter(isEligible)
      if (eligible.length === 0) break
      const lastKey = lastKeyOf()
      const different = eligible.filter((item) => keyOf(item) !== lastKey)
      const pool = different.length > 0 ? different : eligible

      const remaining = new Map<string | null, number>()
      for (const item of pool) remaining.set(keyOf(item), (remaining.get(keyOf(item)) ?? 0) + 1)
      let bestKey = keyOf(pool[0])
      for (const [key, n] of remaining) {
        if (n > (remaining.get(bestKey) ?? 0)) bestKey = key
      }

      const chosen = pool.find((item) => keyOf(item) === bestKey)!
      place(chosen)
      rest.splice(rest.indexOf(chosen), 1)
    }
    return rest
  }

  const blockedByKc = (item: Item) => item.kcId !== null && item.kcId === lastKc && run >= maxRun

  for (const item of ranked) {
    if (budgetLeft < cost) continue // 지금은 예산 초과라도, 더 싼 후보가 뒤에 있을 수 있어 break 대신 continue
    if (blockedByKc(item)) {
      deferredByKc.push(item)
      continue
    }
    if (item.type === lastType && typeRun >= maxTypeRun) {
      deferredByType.push(item)
      continue
    }
    place(item)
  }

  // 2차: 타입 때문에 밀린 것(KC 제약은 여전히 지킨다). 3차: KC 때문에 밀린 것.
  //
  // 왜 제약을 양보하는가 — 인터리빙은 순서를 다듬는 장치이지 학습량을 깎는 장치가
  // 아니다(3.3 "정렬은 점수, 배치는 제약"). 그런데 실제 덱은 "플래시카드만"이거나
  // "이제 막 만든 KC 하나에 카드 다섯 장"인 경우가 흔하고, 그럴 때 제약을 그대로
  // 밀어붙이면 20분을 요청해도 두세 장에서 세션이 끝난다(예시 덱을 처음 넣었을 때
  // 실제로 이 일이 벌어졌다 — 기초 KC 카드 5장 중 2장만 나왔다).
  // 그래서 섞을 수 있을 때는 지키고, 섞을 상대가 없을 때만 양보한다.
  // 순서는 타입 → KC: 같은 개념을 연달아 붙이는 쪽이 더 아쉬우므로 마지막에 푼다.
  const stillBlocked = fillFrom(
    deferredByType,
    (item) => item.type,
    () => lastType,
    (item) => !blockedByKc(item),
  )
  // 2차에서 KC에 막혀 남은 것도 3차로 넘긴다(여기서 흘리면 그대로 사라진다).
  // 원래 점수 순서를 잃지 않도록 ranked 순서로 다시 정렬해서 넘긴다.
  const lastChance = new Set([...deferredByKc, ...stillBlocked].map((item) => item.id))
  fillFrom(
    ranked.filter((item) => lastChance.has(item.id)),
    (item) => item.kcId,
    () => lastKc,
  )

  return plan
}

/**
 * urgentKcIds 계산: 각 KC에 대해 "그 KC를 가진 아이템들 중 가장 최근 Interaction"이
 * concept 오답이었는지 본다. AtlasProvider가 interactions를 들고 있으니 거기서
 * 이 순수 함수로 뽑아 buildSession에 넘긴다.
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
