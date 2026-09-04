// Atlas 3.6 "모델이 맞는지 검증하는 법" — 오프라인 시뮬레이션. 리뷰 로그에
// 대해 각 채점 직전 시점의 예측 인출가능성(R)과 실제 결과를 나란히 모아
// log loss·RMSE를 낸다. 스케줄러 파라미터를 바꿔도(요청 파지율, 재적합된
// 가중치) 같은 로그로 다시 돌려 비교할 수 있다 — 실제 서버·사용자 없이도
// "이 정책이 저 정책보다 나은가"에 답한다.

import { createEmptyCard, type Card, type FSRS } from 'ts-fsrs'
import type { Interaction } from '../core/types'
import { GRADE_TO_RATING } from './fsrs'

export interface PredictionPoint {
  /** 이 채점이 일어나기 직전, 그 시점 카드 상태로 예측한 인출가능성(0~1). */
  predicted: number
  /** 실제 결과: again이면 0(회상 실패), 그 외는 1(회상 성공). */
  actual: 0 | 1
  /** 이 채점이 실제로 일어난 시각(ISO). optimizer.ts가 train/test 경계로 거른다. */
  ts: string
}

/**
 * 아이템 하나의 Interaction을 시간순으로 재생하며, 두 번째 채점부터
 * "직전 상태로 이번 결과를 예측했다면?"을 기록한다. 첫 채점은 비교할
 * 이전 상태가 없어 건너뛴다(새 카드는 예측이 아니라 관찰의 시작점).
 */
export function simulateItem(interactions: Interaction[], scheduler: FSRS): PredictionPoint[] {
  const sorted = [...interactions].sort((a, b) => a.ts.localeCompare(b.ts))
  if (sorted.length === 0) return []

  let card: Card = createEmptyCard(new Date(sorted[0].ts))
  const points: PredictionPoint[] = []

  for (const interaction of sorted) {
    const now = new Date(interaction.ts)
    if (card.reps > 0) {
      const predicted = scheduler.get_retrievability(card, now, false)
      points.push({ predicted, actual: interaction.grade === 'again' ? 0 : 1, ts: interaction.ts })
    }
    card = scheduler.next(card, now, GRADE_TO_RATING[interaction.grade]).card
  }
  return points
}

export function simulateAll(
  interactionsByItem: ReadonlyMap<string, Interaction[]>,
  scheduler: FSRS,
): PredictionPoint[] {
  const points: PredictionPoint[] = []
  for (const interactions of interactionsByItem.values()) {
    points.push(...simulateItem(interactions, scheduler))
  }
  return points
}

const EPS = 1e-6 // log(0) 방지 — 예측이 정확히 0이나 1이면 무한대가 나온다

export function logLoss(points: PredictionPoint[]): number {
  if (points.length === 0) return NaN
  let sum = 0
  for (const p of points) {
    const pred = Math.min(1 - EPS, Math.max(EPS, p.predicted))
    sum += p.actual === 1 ? -Math.log(pred) : -Math.log(1 - pred)
  }
  return sum / points.length
}

export function rmse(points: PredictionPoint[]): number {
  if (points.length === 0) return NaN
  const sumSq = points.reduce((s, p) => s + (p.predicted - p.actual) ** 2, 0)
  return Math.sqrt(sumSq / points.length)
}
