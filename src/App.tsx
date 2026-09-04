import { useEffect, useMemo, useState } from 'react'
import type { Confidence, Grade, Item, Interaction, CardState, KnowledgeComponent } from './core/types'
import * as db from './core/db'
import { deriveAllCardStates } from './scheduler/fsrs'
import { deriveEloState, masteryProbability } from './scheduler/elo'
import { buildSession } from './scheduler/session'
import { formatDue } from './core/format'
import './App.css'

function groupByItem(interactions: Interaction[]): Map<string, Interaction[]> {
  const map = new Map<string, Interaction[]>()
  for (const it of interactions) {
    const list = map.get(it.itemId)
    if (list) list.push(it)
    else map.set(it.itemId, [it])
  }
  return map
}

const DEFAULT_BUDGET_MIN = 20

export default function App() {
  const [items, setItems] = useState<Item[]>([])
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [kcs, setKcs] = useState<KnowledgeComponent[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => new Date())

  // 세션 상태: 시작하면 그 순간의 순서를 고정한다(session.ts 주석 참고).
  const [sessionPlan, setSessionPlan] = useState<Item[] | null>(null)
  const [sessionIndex, setSessionIndex] = useState(0)
  const [confidence, setConfidence] = useState<Confidence | null>(null)
  const [budgetInput, setBudgetInput] = useState(String(DEFAULT_BUDGET_MIN))

  // 폼 상태
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [itemKcId, setItemKcId] = useState('')
  const [kcName, setKcName] = useState('')
  const [kcPrereqIds, setKcPrereqIds] = useState<string[]>([])

  async function reload() {
    const [allItems, allInteractions, allKcs] = await Promise.all([
      db.getAllItems(),
      db.getAllInteractions(),
      db.getAllKCs(),
    ])
    setItems(allItems)
    setInteractions(allInteractions)
    setKcs(allKcs)
    setLoading(false)
    setNow(new Date())
  }

  useEffect(() => {
    reload()
  }, [])

  // 파생 상태 — 둘 다 Interaction 로그를 재생해서만 얻는다(DB에 저장하지 않음).
  const cardStates = useMemo<Map<string, CardState>>(() => {
    const byItem = groupByItem(interactions)
    for (const item of items) {
      if (!byItem.has(item.id)) byItem.set(item.id, [])
    }
    return deriveAllCardStates(byItem)
  }, [items, interactions])

  const eloState = useMemo(() => deriveEloState(items, interactions), [items, interactions])

  const dueCount = useMemo(() => {
    let n = 0
    for (const [, state] of cardStates) {
      if (state.state !== 'new' && state.due.getTime() <= now.getTime()) n++
    }
    return n
  }, [cardStates, now])

  const kcById = useMemo(() => new Map(kcs.map((k) => [k.id, k])), [kcs])

  function startSession() {
    const minutes = Math.max(1, Number(budgetInput) || DEFAULT_BUDGET_MIN)
    const plan = buildSession(items, cardStates, eloState, kcs, now, { budgetMinutes: minutes })
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
  const currentKc = current?.kcId ? kcById.get(current.kcId) : undefined

  async function handleGrade(grade: Grade) {
    if (!current) return
    await db.recordInteraction(current.id, grade, confidence)
    setConfidence(null)
    setSessionIndex((i) => i + 1)
    await reload() // 전체 카드 목록·KC 숙달도 표시를 최신 상태로 — 세션 순서 자체는 고정 유지
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    if (!front.trim() || !back.trim()) return
    await db.addItem(front.trim(), back.trim(), itemKcId || null)
    setFront('')
    setBack('')
    setItemKcId('')
    await reload()
  }

  async function handleAddKc(e: React.FormEvent) {
    e.preventDefault()
    if (!kcName.trim()) return
    await db.addKC(kcName.trim(), kcPrereqIds)
    setKcName('')
    setKcPrereqIds([])
    await reload()
  }

  async function handleDelete(itemId: string) {
    await db.deleteItem(itemId)
    await reload()
  }

  function toggleKcPrereq(id: string) {
    setKcPrereqIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">불러오는 중…</p>
      </main>
    )
  }

  return (
    <main className="shell">
      <header className="topbar">
        <h1>Learning Atlas</h1>
        <p className="stat-line">
          만기 <strong>{dueCount}</strong> · 전체 <strong>{items.length}</strong>
        </p>
      </header>

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
            <button className="start" onClick={startSession} disabled={items.length === 0}>
              오늘 학습 시작
            </button>
            {items.length === 0 && <p className="muted">먼저 카드를 추가하세요.</p>}
          </div>
        ) : current ? (
          <div className="card">
            {currentKc && <span className="kc-badge">{currentKc.name}</span>}
            <p className="card-front">{current.front}</p>
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
              <>
                <p className="card-back">{current.back}</p>
                <div className="grades">
                  <button className="grade grade-again" onClick={() => handleGrade('again')}>
                    다시
                  </button>
                  <button className="grade grade-hard" onClick={() => handleGrade('hard')}>
                    어려움
                  </button>
                  <button className="grade grade-good" onClick={() => handleGrade('good')}>
                    좋음
                  </button>
                  <button className="grade grade-easy" onClick={() => handleGrade('easy')}>
                    쉬움
                  </button>
                </div>
              </>
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

      <section className="kcs">
        <h2>지식 요소</h2>
        {kcs.length > 0 && (
          <ul className="kc-list">
            {kcs.map((kc) => {
              const theta = eloState.kcMastery.get(kc.id) ?? 0
              const pct = Math.round(masteryProbability(theta) * 100)
              const prereqNames = kc.prereqIds.map((id) => kcById.get(id)?.name ?? '?').join(', ')
              return (
                <li key={kc.id}>
                  <span className="kc-name">{kc.name}</span>
                  <span className="kc-mastery muted">숙달도 {pct}%</span>
                  {prereqNames && <span className="kc-prereq muted">선수: {prereqNames}</span>}
                </li>
              )
            })}
          </ul>
        )}
        <form onSubmit={handleAddKc} className="kc-form">
          <input value={kcName} onChange={(e) => setKcName(e.target.value)} placeholder="새 지식 요소 이름" />
          {kcs.length > 0 && (
            <div className="kc-prereq-picker">
              <span className="muted">선수지식:</span>
              {kcs.map((kc) => (
                <label key={kc.id}>
                  <input
                    type="checkbox"
                    checked={kcPrereqIds.includes(kc.id)}
                    onChange={() => toggleKcPrereq(kc.id)}
                  />
                  {kc.name}
                </label>
              ))}
            </div>
          )}
          <button type="submit">지식 요소 추가</button>
        </form>
      </section>

      <section className="add-item">
        <h2>카드 추가</h2>
        <form onSubmit={handleAddItem}>
          <input value={front} onChange={(e) => setFront(e.target.value)} placeholder="앞면" />
          <input value={back} onChange={(e) => setBack(e.target.value)} placeholder="뒷면" />
          <select value={itemKcId} onChange={(e) => setItemKcId(e.target.value)}>
            <option value="">지식 요소 없음</option>
            {kcs.map((kc) => (
              <option key={kc.id} value={kc.id}>
                {kc.name}
              </option>
            ))}
          </select>
          <button type="submit">추가</button>
        </form>
      </section>

      {items.length > 0 && (
        <section className="deck">
          <h2>전체 카드</h2>
          <ul>
            {items.map((item) => {
              const state = cardStates.get(item.id)
              const kc = item.kcId ? kcById.get(item.kcId) : undefined
              return (
                <li key={item.id}>
                  <span className="deck-front">{item.front}</span>
                  {kc && <span className="kc-badge kc-badge-sm">{kc.name}</span>}
                  <span className="deck-due muted">{state ? formatDue(state.due, now) : ''}</span>
                  <button className="delete" onClick={() => handleDelete(item.id)}>
                    삭제
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </main>
  )
}
