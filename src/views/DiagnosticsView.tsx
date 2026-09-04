// "진단" 화면 — 지금 스케줄러가 얼마나 맞는지(대시보드 v3), 앞으로의 복습
// 부하, 개인 로그 재적합, 그리고 메타인지 캘리브레이션(v1). 전부 읽기 전용
// 집계라 이 화면은 액션이 applyRefit/resetScheduler 둘뿐이다.

import { useAtlas } from '../core/atlas'
import { Dashboard } from '../analytics/Dashboard'
import { calibrationLabel } from '../core/calibration'

export function DiagnosticsView() {
  const a = useAtlas()

  return (
    <>
      <Dashboard
        items={a.items}
        interactions={a.interactions}
        byItem={a.byItem}
        cardStates={a.cardStates}
        eloState={a.eloState}
        leechItemIds={a.leechItemIds}
        now={a.now}
        activeScheduler={a.activeScheduler}
        usingCustomWeights={a.schedulerSettings !== undefined}
        onApplyRefit={a.applyRefit}
        onResetScheduler={a.resetScheduler}
      />

      {a.calibration.some((b) => b.total > 0) && (
        <section className="panel calibration">
          <h2>캘리브레이션</h2>
          <div className="calibration-bars">
            {a.calibration.map((b) => (
              <div key={b.confidence} className="calibration-row">
                <span className="calibration-label">{calibrationLabel(b.confidence)}</span>
                <div className="calibration-bar-track">
                  <div
                    className="calibration-bar-fill"
                    style={{ width: `${Math.round(b.rate * 100)}%` }}
                  />
                </div>
                <span className="calibration-value muted">
                  {b.total > 0 ? `${Math.round(b.rate * 100)}% (${b.total}회)` : '데이터 없음'}
                </span>
              </div>
            ))}
          </div>
          {a.calibrationNote && <p className="calibration-note">{a.calibrationNote}</p>}
        </section>
      )}
    </>
  )
}
