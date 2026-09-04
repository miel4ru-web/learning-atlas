import { useEffect, useMemo, useRef, useState } from 'react'
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
  SchedulerSettings,
} from './core/types'
import * as db from './core/db'
import { deriveAllCardStates, isLeech, againCount, buildScheduler } from './scheduler/fsrs'
import { deriveEloState, masteryProbability } from './scheduler/elo'
import { buildSession, findUrgentKcIds } from './scheduler/session'
import { bandOf, bandLabel, predictedRecall } from './scheduler/selection'
import { formatDue } from './core/format'
import { calibrationReport, calibrationLabel, calibrationWarning } from './core/calibration'
import { RespondPanel } from './activities/RespondPanel'
import { errorTagLabel } from './activities/ErrorTagPicker'
import { Dashboard } from './analytics/Dashboard'
import type { OptimizeResult } from './scheduler/optimizer'
import { serializeBackup, parseBackup, backupFilename, type BackupSummary } from './core/backup'
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
  const [schedulerSettings, setSchedulerSettings] = useState<SchedulerSettings | undefined>(undefined)
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

  // 백업(v5) — 파일을 고르면 검증만 하고, 실제 반영은 사용자가 모드를 골라
  // "실행"을 누를 때 한다(특히 완전 교체는 되돌릴 수 없으므로).
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importPreview, setImportPreview] = useState<{
    snapshot: db.DbSnapshot
    summary: BackupSummary
  } | null>(null)
  const [importMode, setImportMode] = useState<db.ImportMode>('merge')
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  async function reload() {
    const [allItems, allInteractions, allKcs, settings] = await Promise.all([
      db.getAllItems(),
      db.getAllInteractions(),
      db.getAllKCs(),
      db.getSchedulerSettings(),
    ])
    setItems(allItems)
    setInteractions(allInteractions)
    setKcs(allKcs)
    setSchedulerSettings(settings)
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

  // v3: 저장된 재적합 파라미터가 있으면 그걸로, 없으면 FSRS-6 기본값으로.
  // Atlas 4.2 — 스케줄러를 바꿔 끼우면 카드 상태는 이 로그 전체가 다시
  // 계산된다(따로 저장된 review_state가 없으니 자동으로 그렇게 된다).
  const activeScheduler = useMemo(
    () =>
      buildScheduler(
        schedulerSettings ? { w: schedulerSettings.w, request_retention: schedulerSettings.requestRetention } : {},
      ),
    [schedulerSettings],
  )

  const cardStates = useMemo<Map<string, CardState>>(
    () => deriveAllCardStates(byItem, activeScheduler),
    [byItem, activeScheduler],
  )

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

  async function handleApplyRefit(result: OptimizeResult) {
    await db.saveSchedulerSettings({
      w: result.weights,
      requestRetention: result.requestRetention,
      fittedAt: new Date().toISOString(),
      testLossBefore: result.testLossBefore,
      testLossAfter: result.testLossAfter,
    })
    await reload()
  }

  async function handleResetScheduler() {
    await db.clearSchedulerSettings()
    await reload()
  }

  async function handleExport() {
    const snapshot = await db.exportAll()
    const blob = new Blob([serializeBackup(snapshot)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = backupFilename()
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일을 다시 골라도 change가 발생하도록
    if (!file) return
    const result = parseBackup(await file.text())
    if (!result.ok) {
      setImportError(result.error)
      setImportPreview(null)
      return
    }
    setImportError(null)
    setImportPreview({ snapshot: result.snapshot, summary: result.summary })
  }

  async function handleConfirmImport() {
    if (!importPreview) return
    setImporting(true)
    await db.importAll(importPreview.snapshot, importMode)
    setImportPreview(null)
    setImportMode('merge')
    setImporting(false)
    await reload()
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

      <Dashboard
        items={items}
        interactions={interactions}
        byItem={byItem}
        cardStates={cardStates}
        eloState={eloState}
        leechItemIds={leechItemIds}
        now={now}
        activeScheduler={activeScheduler}
        usingCustomWeights={schedulerSettings !== undefined}
        onApplyRefit={handleApplyRefit}
        onResetScheduler={handleResetScheduler}
      />

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
              // 예측 회상률은 한 번이라도 복습해 Elo 난이도가 잡힌 카드에만 의미가 있다.
              const recall = state && state.state !== 'new' ? predictedRecall(item, eloState) : null
              return (
                <li key={item.id}>
                  <span className="deck-type muted">{TYPE_LABEL[item.type]}</span>
                  <span className="deck-front">{itemSummary(item)}</span>
                  {kc && <span className="kc-badge kc-badge-sm">{kc.name}</span>}
                  {latest?.errorTag && (
                    <span className="error-tag-badge">{errorTagLabel(latest.errorTag)}</span>
                  )}
                  {recall !== null && (
                    <span
                      className={`band-badge band-${bandOf(recall)}`}
                      title={`예측 회상률 — ${bandLabel(bandOf(recall))}`}
                    >
                      {Math.round(recall * 100)}%
                    </span>
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

      <section className="backup">
        <h2>데이터</h2>
        <p className="muted">
          카드·채점 로그·지식 요소·스케줄러 설정을 JSON 파일 하나로 내보내고 되돌립니다. 이 앱은
          데이터를 이 브라우저에만 저장하니, 가끔 내보내 두는 걸 권합니다.
        </p>
        <div className="backup-actions">
          <button className="reveal" onClick={handleExport}>
            내보내기
          </button>
          <button className="reveal" onClick={() => fileInputRef.current?.click()}>
            파일 선택…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={handleFilePicked}
          />
        </div>

        {importError && <p className="error-text">{importError}</p>}

        {importPreview && (
          <div className="import-preview">
            <p>
              카드 <strong>{importPreview.summary.items}</strong> · 로그{' '}
              <strong>{importPreview.summary.interactions}</strong> · 지식 요소{' '}
              <strong>{importPreview.summary.kcs}</strong>
              {importPreview.summary.hasSettings && ' · 스케줄러 설정 포함'}
            </p>
            {importPreview.summary.exportedAt && (
              <p className="muted">
                내보낸 시각: {new Date(importPreview.summary.exportedAt).toLocaleString()}
              </p>
            )}
            <div className="import-mode">
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                />
                병합 — 같은 id는 파일 내용으로 덮고, 나머지 기존 데이터는 그대로 둡니다
              </label>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                />
                완전 교체 — 지금 데이터를 모두 지우고 파일 내용만 남깁니다(되돌릴 수 없음)
              </label>
            </div>
            <div className="backup-actions">
              <button
                className={importMode === 'replace' ? 'danger' : 'start'}
                onClick={handleConfirmImport}
                disabled={importing}
              >
                {importing ? '가져오는 중…' : importMode === 'replace' ? '교체 실행' : '병합 실행'}
              </button>
              <button className="reveal" onClick={() => setImportPreview(null)} disabled={importing}>
                취소
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
