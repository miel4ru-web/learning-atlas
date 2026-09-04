// "학습" 화면 — Atlas 4.4 세션. "오늘 N분"을 누르면 session.ts가 그 순간의
// 순서를 고정하고(sessionPlan), 카드를 한 장씩 넘긴다. 세션 진행 상태는 이
// 화면의 로컬 상태다 — 채점할 때마다 전역은 reload 되지만 순서는 고정 유지.

import { useState } from 'react'
import type { Confidence, ErrorTag, Grade, Item } from '../core/types'
import { useAtlas } from '../core/atlas'
import { buildSession } from '../scheduler/session'
import { RespondPanel } from '../activities/RespondPanel'

const DEFAULT_BUDGET_MIN = 20

export function StudyView() {
  const atlas = useAtlas()
  const [sessionPlan, setSessionPlan] = useState<Item[] | null>(null)
  const [sessionIndex, setSessionIndex] = useState(0)
  const [confidence, setConfidence] = useState<Confidence | null>(null)
  const [budgetInput, setBudgetInput] = useState(String(DEFAULT_BUDGET_MIN))

  function startSession() {
    const minutes = Math.max(1, Number(budgetInput) || DEFAULT_BUDGET_MIN)
    const plan = buildSession(atlas.items, atlas.cardStates, atlas.eloState, atlas.kcs, atlas.now, {
      budgetMinutes: minutes,
      urgentKcIds: atlas.urgentKcIds,
      leechItemIds: atlas.leechItemIds,
    })
    setSessionPlan(plan)
    setSessionIndex(0)
    setConfidence(null)
  }

  function endSession() {
    setSessionPlan(null)
    setSessionIndex(0)
    setConfidence(null)
  }

  const current = sessionPlan ? sessionPlan[sessionIndex] : undefined
  const currentKc = current?.kcId ? atlas.kcById.get(current.kcId) : undefined

  async function handleGraded(grade: Grade, errorTag: ErrorTag | null) {
    if (!current) return
    await atlas.recordInteraction(current.id, grade, confidence, errorTag)
    setConfidence(null)
    setSessionIndex((i) => i + 1)
  }

  return (
    <section className="queue">
      {!sessionPlan ? (
        <div className="session-start">
          <label>
            오늘 몇 분 학습할까요?
            <input
              type="number"
              min={1}
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
            />
            분
          </label>
          <button className="start" onClick={startSession} disabled={atlas.items.length === 0}>
            오늘 학습 시작
          </button>
          {atlas.items.length === 0 && <p className="muted">먼저 카드를 추가하세요.</p>}
        </div>
      ) : current ? (
        <div className="card">
          {currentKc && <span className="kc-badge">{currentKc.name}</span>}
          {confidence === null ? (
            <div className="confidence">
              <p className="muted">답을 보기 전에 — 얼마나 자신 있나요?</p>
              <div className="confidence-buttons">
                <button onClick={() => setConfidence(1)}>모르겠다</button>
                <button onClick={() => setConfidence(2)}>애매하다</button>
                <button onClick={() => setConfidence(3)}>확실하다</button>
              </div>
            </div>
          ) : (
            <RespondPanel key={current.id} item={current} onGraded={handleGraded} />
          )}
          <p className="session-progress muted">
            {sessionIndex + 1} / {sessionPlan.length}
          </p>
        </div>
      ) : (
        <div className="empty">
          <p>세션 완료.</p>
          <button className="reveal" onClick={endSession}>
            세션 종료
          </button>
        </div>
      )}
    </section>
  )
}
