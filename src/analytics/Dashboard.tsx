// Atlas v3 — 분석 대시보드(ANL) + 오프라인 시뮬레이션(3.6) + 개인 재적합(3부).
// AtlasProvider가 이미 들고 있는 파생 상태(byItem·cardStates·activeScheduler)를
// DiagnosticsView가 그대로 넘겨주고, 여기서는 보여주기만 한다 — 새로 저장하는 건 없다.

import { useMemo, useState } from 'react'
import type { FSRS } from 'ts-fsrs'
import type { CardState, EloState, Interaction, Item } from '../core/types'
import { computeTotals, computeForecast } from './stats'
import { simulateAll, logLoss, rmse } from '../scheduler/simulate'
import { optimizeParameters, type OptimizeResult, type NotEnoughData } from '../scheduler/optimizer'
import { countBands, DESIRABLE_HIGH, DESIRABLE_LOW } from '../scheduler/selection'

interface Props {
  items: Item[]
  interactions: Interaction[]
  byItem: ReadonlyMap<string, Interaction[]>
  cardStates: ReadonlyMap<string, CardState>
  eloState: EloState
  leechItemIds: ReadonlySet<string>
  now: Date
  activeScheduler: FSRS
  usingCustomWeights: boolean
  onApplyRefit: (result: OptimizeResult) => Promise<void>
  onResetScheduler: () => Promise<void>
}

const NOT_ENOUGH_LABEL: Record<NotEnoughData['reason'], string> = {
  'not-enough-train': '학습에 쓸 리뷰가 아직 부족합니다',
  'not-enough-test': '검증에 쓸 최근 리뷰가 아직 부족합니다',
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export function Dashboard({
  items,
  interactions,
  byItem,
  cardStates,
  eloState,
  leechItemIds,
  now,
  activeScheduler,
  usingCustomWeights,
  onApplyRefit,
  onResetScheduler,
}: Props) {
  const [refitting, setRefitting] = useState(false)
  const [refitResult, setRefitResult] = useState<OptimizeResult | NotEnoughData | null>(null)
  const [applying, setApplying] = useState(false)

  const totals = useMemo(() => computeTotals(items, interactions, now), [items, interactions, now])
  const forecast = useMemo(
    () => computeForecast(cardStates, leechItemIds, now, 7),
    [cardStates, leechItemIds, now],
  )
  const maxForecast = Math.max(1, ...forecast.map((f) => f.count))

  const bands = useMemo(
    () => countBands(items, cardStates, eloState, leechItemIds),
    [items, cardStates, eloState, leechItemIds],
  )

  const accuracy = useMemo(() => {
    const points = simulateAll(byItem, activeScheduler)
    return { points: points.length, logLoss: logLoss(points), rmse: rmse(points) }
  }, [byItem, activeScheduler])

  async function runRefit() {
    setRefitting(true)
    setRefitResult(null)
    // setTimeout(0)으로 한 틱 양보해 "계산 중" 상태가 실제로 화면에 그려지게
    // 한다 — 최적화 자체는 동기 계산이라 그동안 메인 스레드가 막힌다.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const result = optimizeParameters(byItem)
    setRefitResult(result)
    setRefitting(false)
  }

  async function apply() {
    if (!refitResult || !refitResult.ok) return
    setApplying(true)
    await onApplyRefit(refitResult)
    setApplying(false)
    setRefitResult(null)
  }

  return (
    <>
      <section className="panel stat-panel">
        <div className="stat-grid">
          <div className="stat-cell">
            <span className="stat-value">{totals.totalReviews}</span>
            <span className="stat-label">전체 리뷰</span>
          </div>
          <div className="stat-cell">
            <span className="stat-value">{totals.totalItems}</span>
            <span className="stat-label">전체 카드</span>
          </div>
          <div className="stat-cell">
            <span className="stat-value">{totals.activeDays}</span>
            <span className="stat-label">학습한 날</span>
          </div>
          <div className="stat-cell">
            <span className="stat-value">{totals.currentStreak}</span>
            <span className="stat-label">연속 학습일</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>다음 7일 예상 부하</h2>
        <div className="forecast">
          {forecast.map((f) => (
            <div className="forecast-col" key={f.dateKey}>
              <span className="forecast-count">{f.count}</span>
              <div
                className="forecast-bar"
                style={{ height: `${Math.max(4, (f.count / maxForecast) * 64)}px` }}
              />
              <span className="forecast-label muted">{f.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>난이도 밴드</h2>
        <p className="muted">
        복습 후보 카드(신규·격리 제외)를 지금 다시 풀면 얼마나 맞힐지로 나눈 것 —
        {' '}
        {Math.round(DESIRABLE_LOW * 100)}–{Math.round(DESIRABLE_HIGH * 100)}%가 "바람직한 어려움"
        구간이고, 세션은 이 구간을 먼저 배치합니다.
      </p>
      {bands.total > 0 ? (
        <>
          <div className="band-bar">
            {bands.desirable > 0 && (
              <span
                className="band-seg band-desirable"
                style={{ flexGrow: bands.desirable }}
                title={`적정 ${bands.desirable}`}
              />
            )}
            {bands.tooHard > 0 && (
              <span
                className="band-seg band-too-hard"
                style={{ flexGrow: bands.tooHard }}
                title={`너무 어려움 ${bands.tooHard}`}
              />
            )}
            {bands.unknown > 0 && (
              <span
                className="band-seg band-unknown"
                style={{ flexGrow: bands.unknown }}
                title={`정보 없음 ${bands.unknown}`}
              />
            )}
            {bands.tooEasy > 0 && (
              <span
                className="band-seg band-too-easy"
                style={{ flexGrow: bands.tooEasy }}
                title={`너무 쉬움 ${bands.tooEasy}`}
              />
            )}
          </div>
          <ul className="band-legend">
            <li>
              <span className="band-dot band-desirable" /> 적정 <strong>{bands.desirable}</strong>
            </li>
            <li>
              <span className="band-dot band-too-hard" /> 너무 어려움 <strong>{bands.tooHard}</strong>
            </li>
            <li>
              <span className="band-dot band-too-easy" /> 너무 쉬움 <strong>{bands.tooEasy}</strong>
            </li>
            {bands.unknown > 0 && (
              <li>
                <span className="band-dot band-unknown" /> 정보 없음 <strong>{bands.unknown}</strong>
              </li>
            )}
          </ul>
        </>
      ) : (
        <p className="muted">복습 이력이 쌓이면 카드별 예측 난이도를 보여줍니다.</p>
      )}
      </section>

      <section className="panel">
        <h2>모델 정확도</h2>
        <p className="muted">
          지금 쓰는 스케줄러가 실제 리뷰 결과를 얼마나 잘 맞혔는지(3.6 오프라인 시뮬레이션) —
          각 리뷰 직전 예측한 회상 확률과 실제 정답 여부를 비교한 값. 낮을수록 좋다.
        </p>
        {accuracy.points > 0 ? (
          <div className="accuracy-row">
            <span>
              log loss <strong>{accuracy.logLoss.toFixed(4)}</strong>
            </span>
            <span>
              RMSE <strong>{accuracy.rmse.toFixed(4)}</strong>
            </span>
            <span className="muted">({accuracy.points}개 예측)</span>
          </div>
        ) : (
          <p className="muted">같은 카드를 두 번 이상 복습해야 예측 정확도를 잴 수 있습니다.</p>
        )}
      </section>

      <section className="panel refit-panel">
        <h2>개인 로그로 재적합</h2>
        <p className="muted">
        {usingCustomWeights
          ? '지금은 재적합된 파라미터를 쓰고 있습니다.'
          : '지금은 FSRS-6 기본 파라미터(7억 건의 외부 리뷰로 학습됨)를 쓰고 있습니다.'}{' '}
        과거 리뷰의 80%로 21개 파라미터를 다시 맞추고, 나머지 20%(최근 리뷰)로 실제 개선됐는지 확인합니다.
      </p>
      <button className="reveal" onClick={runRefit} disabled={refitting}>
        {refitting ? '계산 중…' : '재적합 실행'}
      </button>

      {refitResult && !refitResult.ok && (
        <p className="refit-note">
          {NOT_ENOUGH_LABEL[refitResult.reason]} (학습용 {refitResult.trainPointCount}개
          {refitResult.reason === 'not-enough-test' ? `, 검증용 ${refitResult.testPointCount}개` : ''} — 계속
          학습하면 다시 시도할 수 있습니다)
        </p>
      )}

      {refitResult && refitResult.ok && (
        <div className="refit-result">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col"></th>
                  <th scope="col">학습(80%)</th>
                  <th scope="col">검증(20%, {refitResult.testPointCount}개)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">전</th>
                  <td>{refitResult.trainLossBefore.toFixed(4)}</td>
                  <td>{refitResult.testLossBefore.toFixed(4)}</td>
                </tr>
                <tr>
                  <th scope="row">후</th>
                  <td>{refitResult.trainLossAfter.toFixed(4)}</td>
                  <td>{refitResult.testLossAfter.toFixed(4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {refitResult.improved ? (
            <>
              <p className="refit-note refit-improved">
                검증 손실이 {pct(1 - refitResult.testLossAfter / refitResult.testLossBefore)} 줄었습니다 —
                적용을 권장합니다.
              </p>
              <button className="start" onClick={apply} disabled={applying}>
                {applying ? '적용 중…' : '적용'}
              </button>
            </>
          ) : (
            <p className="refit-note">
              검증 데이터에서는 개선되지 않았습니다(과적합 방지 — 학습 손실만 좋아진 경우일 수 있습니다).
              적용하지 않는 걸 권장합니다. 리뷰가 더 쌓이면 다시 시도해 보세요.
            </p>
          )}
        </div>
      )}

        {usingCustomWeights && (
          <button className="reveal" onClick={onResetScheduler}>
            기본 파라미터로 되돌리기
          </button>
        )}
      </section>
    </>
  )
}
