// "진단" 화면 — 지금 스케줄러가 얼마나 맞는지(대시보드 v3), 앞으로의 복습
// 부하, 개인 로그 재적합, 그리고 메타인지 캘리브레이션(v1). 전부 읽기 전용
// 집계라 이 화면은 액션이 applyRefit/resetScheduler 둘뿐이다.

import { useMemo } from 'react'
import { useAtlas } from '../core/atlas'
import { Dashboard } from '../analytics/Dashboard'
import { calibrationLabel } from '../core/calibration'
import { summarizeSessions } from '../core/sessions'

export function DiagnosticsView() {
  const a = useAtlas()
  // 세션 요약(v27) — 저장된 건 세션 기록뿐이고, 몇 장 했는지는 로그에서 센다.
  const sessions = useMemo(
    () => summarizeSessions(a.sessions, a.interactions),
    [a.sessions, a.interactions],
  )

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

      {sessions.length > 0 && (
        <section className="panel session-log">
          <h2>최근 세션</h2>
          <p className="muted">
            요청한 예산과 실제로 해낸 양입니다. 계획보다 자주 모자란다면 예산이나 하루 상한을
            현실에 맞게 낮추는 편이 백로그가 쌓이는 것보다 낫습니다.
          </p>
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <span className="session-when">
                  {new Date(s.startedAt).toLocaleDateString()}{' '}
                  {new Date(s.startedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="session-count">
                  {s.completed} / {s.planned}장
                </span>
                <span className="muted">
                  예산 {s.budgetMinutes}분{s.elapsedMinutes > 0 && ` · 실제 ${s.elapsedMinutes}분`}
                </span>
                {!s.finished && <span className="session-open">진행 중</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

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
