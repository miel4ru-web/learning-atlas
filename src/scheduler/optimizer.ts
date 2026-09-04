// Atlas 3부 "개인 로그로 재적합". FSRS-6의 21개 가중치를 그레이디언트
// 없이(자동미분 없이) 로컬 탐색으로 개인 로그에 맞춘다.
//
// 방법: Hooke–Jeeves 패턴 탐색. 기본 가중치(default_w — 7억 리뷰로 학습된
// 값)에서 시작해, 각 차원을 ±스텝만큼 흔들어 학습 손실(log loss)이
// 줄어드는 방향을 남기고, 어느 방향도 개선이 없으면 스텝을 반으로 줄인다.
// 21차원이라도 개인 로그(수십~수백 건)에서는 한 번의 손실 계산이 로그
// 전체 재생 한 번(수 ms)이라, 수백 번의 평가가 초 단위로 끝난다.
//
// 시작점을 default_w로 두는 건 임의 초기화보다 훨씬 유리하다 — 이미
// 대규모 데이터로 맞춰진 값이므로, 탐색은 "이 사람에 맞게 미세조정"만
// 하면 된다(전역 탐색이 필요 없다).
//
// 과적합 경계: 파라미터가 21개인데 리뷰가 적으면 그냥 로그를 통째로
// 외워버릴 위험이 크다. 그래서 시간순으로 학습/검증을 나누고(과거로
// 미래를 맞히게), 검증 손실이 실제로 좋아졌을 때만 "개선"이라 부른다.

import { clipParameters, default_w } from 'ts-fsrs'
import type { Interaction } from '../core/types'
import { buildScheduler } from './fsrs'
import { logLoss, simulateAll } from './simulate'

export const MIN_TRAIN_POINTS = 50 // 이보다 적으면 21개 파라미터를 흔드는 게 의미가 없다
export const MIN_TEST_POINTS = 10

export interface OptimizeResult {
  ok: true
  weights: number[]
  requestRetention: number
  trainLossBefore: number
  trainLossAfter: number
  testLossBefore: number
  testLossAfter: number
  testPointCount: number
  evaluations: number
  improved: boolean // 검증 손실이 실제로 줄었는가 — 이게 true일 때만 "적용"을 권한다
}

export type NotEnoughDataReason = 'not-enough-train' | 'not-enough-test'

export interface NotEnoughData {
  ok: false
  reason: NotEnoughDataReason
  trainPointCount: number
  testPointCount: number
}

/** 전체 로그를 시간순으로 정렬했을 때, 검증용으로 뒤에서 몇 %를 뗄지의 경계 시각. */
function findCutTs(interactionsByItem: ReadonlyMap<string, Interaction[]>, testFraction: number): string {
  const all = [...interactionsByItem.values()].flat().sort((a, b) => a.ts.localeCompare(b.ts))
  return all[Math.floor(all.length * (1 - testFraction))]?.ts ?? all[all.length - 1]?.ts ?? ''
}

/** cutTs 이전 interaction만 남긴다 — 재적합이 미래를 못 보게 하는 경계. */
function onlyBefore(
  interactionsByItem: ReadonlyMap<string, Interaction[]>,
  cutTs: string,
): Map<string, Interaction[]> {
  const train = new Map<string, Interaction[]>()
  for (const [itemId, list] of interactionsByItem) {
    train.set(
      itemId,
      list.filter((i) => i.ts <= cutTs),
    )
  }
  return train
}

/**
 * 검증 손실: 카드 상태 재생은 각 아이템의 전체 이력(cutTs 이전 포함)으로
 * 하되 — 그래야 cutTs 시점의 진짜 카드 상태가 나온다 — 손실 집계는 cutTs
 * 이후에 실제로 일어난 채점만 넣는다. simulateAll이 내주는 각 포인트에
 * 실제 발생 시각(ts)이 실려 있어 여기서 바로 거를 수 있다.
 */
function lossAfterCut(
  interactionsByItem: ReadonlyMap<string, Interaction[]>,
  cutTs: string,
  scheduler: ReturnType<typeof buildScheduler>,
): { loss: number; count: number } {
  const points = simulateAll(interactionsByItem, scheduler).filter((p) => p.ts > cutTs)
  return { loss: logLoss(points), count: points.length }
}

export function optimizeParameters(
  interactionsByItem: ReadonlyMap<string, Interaction[]>,
  options?: { maxEvaluations?: number; testFraction?: number; requestRetention?: number },
): OptimizeResult | NotEnoughData {
  const requestRetention = options?.requestRetention ?? 0.9
  const testFraction = options?.testFraction ?? 0.2
  const maxEvaluations = options?.maxEvaluations ?? 600

  const cutTs = findCutTs(interactionsByItem, testFraction)
  const train = onlyBefore(interactionsByItem, cutTs)
  const defaultScheduler = buildScheduler({ request_retention: requestRetention })

  const trainPointCount = simulateAll(train, defaultScheduler).length
  if (trainPointCount < MIN_TRAIN_POINTS) {
    return { ok: false, reason: 'not-enough-train', trainPointCount, testPointCount: 0 }
  }
  const before = lossAfterCut(interactionsByItem, cutTs, defaultScheduler)
  if (before.count < MIN_TEST_POINTS) {
    return { ok: false, reason: 'not-enough-test', trainPointCount, testPointCount: before.count }
  }

  const trainLossBefore = logLoss(simulateAll(train, defaultScheduler))

  let w = [...default_w] as number[]
  let step = w.map((v) => Math.max(0.05, Math.abs(v) * 0.25))
  let bestLoss = trainLossBefore
  let evaluations = 0

  const evalLoss = (candidate: number[]): number => {
    evaluations++
    return logLoss(simulateAll(train, buildScheduler({ request_retention: requestRetention, w: candidate })))
  }

  while (evaluations < maxEvaluations && step.some((s) => s > 1e-4)) {
    let improvedThisPass = false
    for (let dim = 0; dim < w.length && evaluations < maxEvaluations; dim++) {
      for (const dir of [1, -1]) {
        if (evaluations >= maxEvaluations) break
        const candidate = clipParameters(
          w.map((v, j) => (j === dim ? v + dir * step[dim] : v)),
          1,
        ) as number[]
        const loss = evalLoss(candidate)
        if (loss < bestLoss) {
          bestLoss = loss
          w = candidate
          improvedThisPass = true
        }
      }
    }
    if (!improvedThisPass) step = step.map((s) => s / 2)
  }

  const fittedScheduler = buildScheduler({ request_retention: requestRetention, w })
  const after = lossAfterCut(interactionsByItem, cutTs, fittedScheduler)

  return {
    ok: true,
    weights: w,
    requestRetention,
    trainLossBefore,
    trainLossAfter: bestLoss,
    testLossBefore: before.loss,
    testLossAfter: after.loss,
    testPointCount: before.count,
    evaluations,
    improved: after.loss < before.loss,
  }
}
