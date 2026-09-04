// Atlas 3.3 "바람직한 어려움" — 인출 성공 확률이 0.70–0.85 구간일 때 복습 1회의
// 학습 가치가 가장 크다는 전제(elo.ts MASTERY_THETA 주석의 밴드와 같은 값).
//
// v1부터 Elo(scheduler/elo.ts)는 문항 난이도 b를 계산해 왔지만 여태 아무 데도
// 쓰이지 않았다 — kcMastory(θ)만 숙달도 표시·선수지식 게이팅에 쓰였을 뿐이다.
// 이 모듈이 그 b와 학습자 θ로 "지금 이 카드를 복습하면 얼마나 맞힐 것 같은가"
// (predictedRecall)를 내고, session.ts가 그 값으로 만기 카드의 순서를 조정한다.
//
// 저장하지 않는다: EloState 자체가 Interaction 로그를 재생해 얻은 파생 상태이고,
// 여기서 나오는 예측·밴드도 그 위의 순수 함수다(다른 파생 상태와 같은 원칙).

import type { CardState, EloState, Item } from '../core/types'
import { expectedScore } from './elo'

// Atlas 3.3의 밴드 경계. 상한 0.85는 elo.ts MASTERY_THETA(θ=300 → 기대 정답률
// ≈0.85)와 맞춰져 있다 — "숙달"과 "이제 이 카드는 너무 쉽다"가 같은 선.
export const DESIRABLE_LOW = 0.7
export const DESIRABLE_HIGH = 0.85

export type DifficultyBand = 'too-hard' | 'desirable' | 'too-easy' | 'unknown'

/**
 * 이 아이템을 지금 복습했을 때의 예측 인출 성공 확률(0~1).
 * kcId가 없으면(Elo 비대상 — FSRS 스케줄만 받는 카드) null을 반환한다.
 * 아직 상호작용이 없어 b가 초기값(0)이면 KC의 θ만 반영된 값이 나온다
 * (형제 카드들이 올려놓은 θ가 있으면 그게 쓰이고, 없으면 0.5).
 */
export function predictedRecall(item: Item, elo: EloState): number | null {
  if (item.kcId === null) return null
  const theta = elo.kcMastery.get(item.kcId) ?? 0
  const b = elo.itemDifficulty.get(item.id) ?? 0
  return expectedScore(theta, b)
}

export function bandOf(recall: number | null): DifficultyBand {
  if (recall === null) return 'unknown'
  if (recall < DESIRABLE_LOW) return 'too-hard'
  if (recall > DESIRABLE_HIGH) return 'too-easy'
  return 'desirable'
}

// 복습 정렬용 밴드 우선순위(낮을수록 세션 앞쪽).
//  desirable  — 바로 이 구간의 복습이 학습 가치가 가장 크다.
//  too-hard   — 아직 회상률이 낮지만, 지금이 배우기 좋은 때다(뒤로 미룰 이유 없음).
//  unknown    — Elo 대상이 아니라 판단할 근거가 없다(FSRS 만기일만 믿는다).
//  too-easy   — 과학습. 이번 세션에서 예산에 밀려도 손해가 가장 적다(맨 뒤).
const BAND_RANK: Record<DifficultyBand, number> = {
  desirable: 0,
  'too-hard': 1,
  unknown: 2,
  'too-easy': 3,
}

export function bandRank(band: DifficultyBand): number {
  return BAND_RANK[band]
}

export interface BandCounts {
  desirable: number
  tooHard: number
  tooEasy: number
  unknown: number
  total: number
}

/**
 * 복습 후보(신규·격리 제외) 카드를 밴드별로 센다 — 대시보드 표시용.
 * session.ts가 정렬에 쓰는 predictedRecall/bandOf를 그대로 재사용하므로,
 * "지금 세션이 어떤 난이도의 카드로 채워지는가"를 그대로 보여준다.
 */
export function countBands(
  items: Item[],
  cardStates: ReadonlyMap<string, CardState>,
  elo: EloState,
  leechItemIds: ReadonlySet<string>,
): BandCounts {
  const counts: BandCounts = { desirable: 0, tooHard: 0, tooEasy: 0, unknown: 0, total: 0 }
  for (const item of items) {
    const state = cardStates.get(item.id)
    if (!state || state.state === 'new' || leechItemIds.has(item.id)) continue
    counts.total++
    switch (bandOf(predictedRecall(item, elo))) {
      case 'desirable':
        counts.desirable++
        break
      case 'too-hard':
        counts.tooHard++
        break
      case 'too-easy':
        counts.tooEasy++
        break
      case 'unknown':
        counts.unknown++
        break
    }
  }
  return counts
}

const BAND_LABEL: Record<DifficultyBand, string> = {
  desirable: '적정',
  'too-hard': '너무 어려움',
  'too-easy': '너무 쉬움',
  unknown: '정보 없음',
}

export function bandLabel(band: DifficultyBand): string {
  return BAND_LABEL[band]
}
