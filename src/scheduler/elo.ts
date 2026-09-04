// Atlas 3.2 숙달도 추정 — Elo. "학습자 θ, 문항 b 각 1개 스칼라",
// θ ← θ + K(S − E), E = 1/(1+10^((b−θ)/400)) 그대로 구현한다.
//
// FSRS(scheduler/fsrs.ts)와 마찬가지로 저장하지 않고 Interaction 로그를
// 재생해 도출한다. 다만 FSRS는 아이템별로 독립적으로 재생하면 되지만,
// Elo는 하나의 KC를 공유하는 여러 아이템의 Interaction이 전역 시간순으로
// 서로의 θ에 영향을 준다 — 그래서 전체 로그를 한 번에 훑는다.

import type { Grade, Item, Interaction, EloState } from '../core/types'

const INITIAL_THETA = 0
const INITIAL_DIFFICULTY = 0

// 학습자 θ는 빠르게, 문항 난이도 b는 느리게 움직인다 — 문항 난이도가
// 매 응답마다 요동치면 "밴드 유지" 같은 다음 선택 로직이 불안정해진다.
const K_LEARNER = 32
const K_ITEM = 16

// v1 단순화: 4단계 채점을 이진 성패로 접는다. again=실패(0), 나머지=성공(1).
// hard/good/easy의 차이는 FSRS 쪽(난이도·안정성)이 이미 반영하므로,
// Elo는 "회상에 성공했는가"만 본다. 필요해지면 hard=0.5 같은 부분점수로 확장.
function successScore(grade: Grade): number {
  return grade === 'again' ? 0 : 1
}

export function expectedScore(theta: number, difficulty: number): number {
  return 1 / (1 + Math.pow(10, (difficulty - theta) / 400))
}

/**
 * 아이템·KC 매핑과 전체 Interaction 로그(오래된 순 아님 — 내부에서 정렬)로부터
 * 현재 θ(kcMastery)와 b(itemDifficulty)를 도출한다. kcId가 없는 아이템의
 * Interaction은 건너뛴다 — Elo 대상이 아니라 FSRS 스케줄만 적용되는 카드다.
 */
export function deriveEloState(items: Item[], interactions: Interaction[]): EloState {
  const kcOfItem = new Map(items.map((item) => [item.id, item.kcId]))
  const sorted = [...interactions].sort((a, b) => a.ts.localeCompare(b.ts))

  const itemDifficulty = new Map<string, number>()
  const kcMastery = new Map<string, number>()

  for (const interaction of sorted) {
    const kcId = kcOfItem.get(interaction.itemId)
    if (!kcId) continue

    const b = itemDifficulty.get(interaction.itemId) ?? INITIAL_DIFFICULTY
    const theta = kcMastery.get(kcId) ?? INITIAL_THETA
    const expected = expectedScore(theta, b)
    const actual = successScore(interaction.grade)
    const delta = actual - expected

    kcMastery.set(kcId, theta + K_LEARNER * delta)
    itemDifficulty.set(interaction.itemId, b - K_ITEM * delta)
  }

  return { itemDifficulty, kcMastery }
}

// θ가 300이면 난이도 0인 기준 문항에 대한 기대 정답률이 약 0.85다
// (0.85 = 1/(1+10^(-θ/400)) 을 θ에 대해 풀면 θ ≈ 301.3).
// Atlas 3.3의 "바람직한 어려움" 밴드(0.70–0.85) 상한과 맞춘 값 — MST의
// 선수지식 게이팅(3.3 ready())에서 이 값을 "숙달"의 임계값으로 쓴다.
//
// 로지스틱 곡선이라 θ가 0에서 이 값까지 오르는 데 드는 반복 횟수는 선형이
// 아니다 — K_LEARNER=32 기준으로 계속 성공만 해도 실측 약 50회 안팎 걸린다
// (_verify_v1.ts 참고). 한 KC를 여러 카드가 공유하면 그 반복이 카드들에
// 나뉘므로 체감상 그렇게 느리지 않지만, 너무 느리다고 판단되면 K_LEARNER를
// 올리거나 MASTERY_THETA를 낮추는 쪽으로 튜닝한다.
export const MASTERY_THETA = 300

export function isMastered(theta: number): boolean {
  return theta >= MASTERY_THETA
}

export function masteryProbability(theta: number): number {
  return expectedScore(theta, 0)
}
