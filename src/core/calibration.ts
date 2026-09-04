// Atlas 4.5 메타인지 레이어의 출력물. v1에서 모으기 시작한 confidence를
// 실제 결과(grade)와 대조한다 — "확실하다"고 했는데 자꾸 again이면 과신,
// "모르겠다"고 했는데 자꾸 통과하면 과소신. 순수 집계이니 저장하지 않는다.

import type { Confidence, Interaction } from './types'

export interface CalibrationBucket {
  confidence: Confidence
  total: number
  correct: number
  rate: number // correct / total, total===0이면 0
}

const LABEL: Record<Confidence, string> = { 1: '모르겠다', 2: '애매하다', 3: '확실하다' }

export function calibrationLabel(c: Confidence): string {
  return LABEL[c]
}

export function calibrationReport(interactions: Interaction[]): CalibrationBucket[] {
  const totals = new Map<Confidence, { total: number; correct: number }>()
  for (const interaction of interactions) {
    if (interaction.confidence === null) continue
    const bucket = totals.get(interaction.confidence) ?? { total: 0, correct: 0 }
    bucket.total += 1
    if (interaction.grade !== 'again') bucket.correct += 1
    totals.set(interaction.confidence, bucket)
  }
  return ([1, 2, 3] as Confidence[]).map((confidence) => {
    const bucket = totals.get(confidence) ?? { total: 0, correct: 0 }
    return {
      confidence,
      total: bucket.total,
      correct: bucket.correct,
      rate: bucket.total > 0 ? bucket.correct / bucket.total : 0,
    }
  })
}

/**
 * 자신감이 높을수록 실제 정답률도 높아야 정상이다(1 ≤ 2 ≤ 3 순으로 rate 증가).
 * 표본이 있는 구간끼리만 비교해서, 데이터가 아직 없는 구간 때문에 잘못된
 * 경고가 뜨지 않게 한다.
 */
export function calibrationWarning(buckets: CalibrationBucket[]): string | null {
  const withData = buckets.filter((b) => b.total > 0)
  for (let i = 1; i < withData.length; i++) {
    if (withData[i].rate < withData[i - 1].rate) {
      return `"${calibrationLabel(withData[i].confidence)}"의 실제 정답률(${Math.round(withData[i].rate * 100)}%)이 "${calibrationLabel(withData[i - 1].confidence)}"(${Math.round(withData[i - 1].rate * 100)}%)보다 낮습니다 — 자신감과 실제 실력이 어긋나고 있다는 신호입니다.`
    }
  }
  return null
}
