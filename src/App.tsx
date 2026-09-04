import { useEffect, useMemo, useState } from 'react'
import type {
  CodeTest,
  Confidence,
  ErrorTag,
  Grade,
  Item,
  ItemType,
  Interaction,
  CardState,
  KnowledgeComponent,
} from './core/types'
import * as db from './core/db'
import { deriveAllCardStates, isLeech, againCount } from './scheduler/fsrs'
import { deriveEloState, masteryProbability } from './scheduler/elo'
import { buildSession, findUrgentKcIds } from './scheduler/session'
import { formatDue } from './core/format'
import { calibrationReport, calibrationLabel, calibrationWarning } from './core/calibration'
import { RespondPanel } from './activities/RespondPanel'
import { errorTagLabel } from './activities/ErrorTagPicker'
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

function latestPerItem(interactions: Interaction[]): Map<string, Interaction> {
  const latest = new Map<string, Interaction>()
  for (const it of interactions) {
    const prev = latest.get(it.itemId)
    if (!prev || it.ts > prev.ts) latest.set(it.itemId, it)
  }
  return latest
}

function itemSummary(item: Item): string {
  switch (item.type) {
    case 'flashcard':
      return item.front
    case 'cloze':
      return item.text.replace(/\{\{(.*?)\}\}/g, '_____')
    case 'mcq':
      return item.prompt
    case 'code':
      return item.prompt
  }
}

const DEFAULT_BUDGET_MIN = 20
const TYPE_LABEL: Record<ItemType, string> = { flashcard: '플래시카드', cloze: '빈칸 채우기', mcq: '4지선다', code: '코드' }

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

  // 카드 추가 폼 상태 — 타입마다 쓰는 필드가 달라 하나의 폼에 다 두고 타입에 따라 보여준다.
  const [newType, setNewType] = useState<ItemType>('flashcard')
  const [itemKcId, setItemKcId] = useState('')
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [clozeText, setClozeText] = useState('')
  const [mcqPrompt, setMcqPrompt] = useState('')
  const [mcqOptions, setMcqOptions] = useState(['', '', '', ''])
  const [mcqCorrect, setMcqCorrect] = useState(0)
  const [codePrompt, setCodePrompt] = useState('')
  const [codeStarter, setCodeStarter] = useState('function solve() {\n  \n}')
  const [codeTestsJson, setCodeTestsJson] = useState('[{"args": [], "expected": null}]')
  const [codeTestsError, setCodeTestsError] = useState<string | null>(null)

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

  // 파생 상태 — 전부 Interaction 로그를 재생해서만 얻는다(DB에 저장하지 않음).
  const byItem = useMemo(() => {
    const map = groupByItem(interactions)
    for (const item of items) {
      if (!map.has(item.id)) map.set(item.id, [])
    }
    return map
  }, [items, interactions])

  const cardStates = useMemo<Map<string, CardState>>(() => deriveAllCardStates(byItem), [byItem])

  const eloState = useMemo(() => deriveEloState(items, interactions), [items, interactions])
  const latestByItem = useMemo(() => latestPerItem(interactions), [interactions])
  const urgentKcIds = useMemo(() => findUrgentKcIds(items, latestByItem), [items, latestByItem])
  const calibration = useMemo(() => calibrationReport(interactions), [interactions])
  const calibrationNote = useMemo(() => calibrationWarning(calibration), [calibration])

  // leech 판정은 CardState가 아니라 아이템별 원본 Interaction 목록으로 한다
  // (fsrs.ts isLeech 주석 참고 — CardState.lapses는 이 용도에 안 맞는다).
  const leechItems = useMemo(
    () => items.filter((item) => isLeech(byItem.get(item.id) ?? [])),
    [items, byItem],
  )
  const leechItemIds = useMemo(() => new Set(leechItems.map((i) => i.id)), [leechItems])

  const dueCount = useMemo(() => {
    let n = 0
    for (const [itemId, state] of cardStates) {
      if (state.state !== 'new' && state.due.getTime() <= now.getTime() && !leechItemIds.has(itemId)) n++
    }
    return n
  }, [cardStates, now, leechItemIds])

  const kcById = useMemo(() => new Map(kcs.map((k) => [k.id, k])), [kcs])

  function startSession() {
    const minutes = Math.max(1, Number(budgetInput) || DEFAULT_BUDGET_MIN)
    const plan = buildSession(items, cardStates, eloState, kcs, now, {
      budgetMinutes: minutes,
      urgentKcIds,
      leechItemIds,
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
  const currentKc = current?.kcId ? kcById.get(current.kcId) : undefined

  async function handleGraded(grade: Grade, errorTag: ErrorTag | null) {
    if (!current) return
    await db.recordInteraction(current.id, grade, confidence, errorTag)
    setConfidence(null)
    setSessionIndex((i) => i + 1)
    await reload() // 전체 카드 목록·KC 숙달도·캘리브레이션을 최신 상태로 — 세션 순서 자체는 고정 유지
  }

  function resetItemForm() {
    setFront('')
    setBack('')
    setClozeText('')
    setMcqPrompt('')
    setMcqOptions(['', '', '', ''])
    setMcqCorrect(0)
    setCodePrompt('')
    setCodeStarter('function solve() {\n  \n}')
    setCodeTestsJson('[{"args": [], "expected": null}]')
    setCodeTestsError(null)
    setItemKcId('')
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    const kcId = itemKcId || null
    if (newType === 'flashcard') {
      if (!front.trim() || !back.trim()) return
      await db.addItem({ type: 'flashcard', front: front.trim(), back: back.trim(), kcId })
    } else if (newType === 'cloze') {
      if (!clozeText.includes('{{')) return
      await db.addItem({ type: 'cloze', text: clozeText.trim(), kcId })
    } else if (newType === 'mcq') {
      if (!mcqPrompt.trim() || mcqOptions.some((o) => !o.trim())) return
      await db.addItem({
        type: 'mcq',
        prompt: mcqPrompt.trim(),
        options: mcqOptions as [string, string, string, string],
        correctIndex: mcqCorrect as 0 | 1 | 2 | 3,
        kcId,
      })
    } else {
      if (!codePrompt.trim()) return
      let tests: CodeTest[]
      try {
        tests = JSON.parse(codeTestsJson)
        setCodeTestsError(null)
      } catch {
        setCodeTestsError('테스트 JSON을 해석할 수 없습니다.')
        return
      }
      await db.addItem({ type: 'code', prompt: codePrompt.trim(), starterCode: codeStarter, tests, kcId })
    }
    resetItemForm()
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
          {leechItems.length > 0 && (
            <>
              {' '}
              · 격리 <strong>{leechItems.length}</strong>
            </>
          )}
        </p>
      </header>

      <section className="queue">
        {!sessionPlan ? (
          <div className="session-start">
            <label>
              오늘 몇 분 학습할까요?
              <input type="number" min={1} value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} />
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

      {calibration.some((b) => b.total > 0) && (
        <section className="calibration">
          <h2>캘리브레이션</h2>
          <div className="calibration-bars">
            {calibration.map((b) => (
              <div key={b.confidence} className="calibration-row">
                <span className="calibration-label">{calibrationLabel(b.confidence)}</span>
                <div className="calibration-bar-track">
                  <div className="calibration-bar-fill" style={{ width: `${Math.round(b.rate * 100)}%` }} />
                </div>
                <span className="calibration-value muted">
                  {b.total > 0 ? `${Math.round(b.rate * 100)}% (${b.total}회)` : '데이터 없음'}
                </span>
              </div>
            ))}
          </div>
          {calibrationNote && <p className="calibration-note">{calibrationNote}</p>}
        </section>
      )}

      {leechItems.length > 0 && (
        <section className="leeches">
          <h2>격리된 카드</h2>
          <p className="muted">계속 틀려서(다시 등급 4회 이상) 세션에서 잠시 뺐습니다.</p>
          <ul>
            {leechItems.map((item) => (
              <li key={item.id}>
                <span className="deck-front">{itemSummary(item)}</span>
                <span className="muted">{againCount(byItem.get(item.id) ?? [])}회 실패</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                  <input type="checkbox" checked={kcPrereqIds.includes(kc.id)} onChange={() => toggleKcPrereq(kc.id)} />
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
        <div className="type-tabs">
          {(['flashcard', 'cloze', 'mcq', 'code'] as ItemType[]).map((t) => (
            <button
              key={t}
              className={t === newType ? 'active' : ''}
              onClick={() => setNewType(t)}
              type="button"
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <form onSubmit={handleAddItem} className="item-form">
          {newType === 'flashcard' && (
            <>
              <input value={front} onChange={(e) => setFront(e.target.value)} placeholder="앞면" />
              <input value={back} onChange={(e) => setBack(e.target.value)} placeholder="뒷면" />
            </>
          )}
          {newType === 'cloze' && (
            <textarea
              value={clozeText}
              onChange={(e) => setClozeText(e.target.value)}
              placeholder="예: 물의 화학식은 {{H2O}}이다"
            />
          )}
          {newType === 'mcq' && (
            <>
              <input value={mcqPrompt} onChange={(e) => setMcqPrompt(e.target.value)} placeholder="문제" />
              {mcqOptions.map((opt, i) => (
                <div className="mcq-option-row" key={i}>
                  <input
                    type="radio"
                    name="mcq-correct"
                    checked={mcqCorrect === i}
                    onChange={() => setMcqCorrect(i)}
                  />
                  <input
                    value={opt}
                    onChange={(e) =>
                      setMcqOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))
                    }
                    placeholder={`보기 ${i + 1}`}
                  />
                </div>
              ))}
            </>
          )}
          {newType === 'code' && (
            <>
              <input value={codePrompt} onChange={(e) => setCodePrompt(e.target.value)} placeholder="문제" />
              <textarea
                value={codeStarter}
                onChange={(e) => setCodeStarter(e.target.value)}
                spellCheck={false}
                className="code-textarea"
              />
              <textarea
                value={codeTestsJson}
                onChange={(e) => setCodeTestsJson(e.target.value)}
                placeholder='[{"args": [2, 3], "expected": 5}]'
                className="code-textarea"
              />
              {codeTestsError && <p className="error-text">{codeTestsError}</p>}
            </>
          )}
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
              const latest = latestByItem.get(item.id)
              return (
                <li key={item.id}>
                  <span className="deck-type muted">{TYPE_LABEL[item.type]}</span>
                  <span className="deck-front">{itemSummary(item)}</span>
                  {kc && <span className="kc-badge kc-badge-sm">{kc.name}</span>}
                  {latest?.errorTag && (
                    <span className="error-tag-badge">{errorTagLabel(latest.errorTag)}</span>
                  )}
                  {leechItemIds.has(item.id) && <span className="leech-badge">격리</span>}
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
