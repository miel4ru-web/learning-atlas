// "카드" 화면 — 학습 대상의 정의를 관리한다. 지식 요소(KC)와 그 선수지식
// DAG, 네 가지 활동 타입의 카드 추가, 전체 목록(예측 회상률·만기·오답 태그
// 배지 포함), 그리고 계속 틀려 격리된 카드. 채점 로그는 여기서 건드리지 않는다.

import { useState, type FormEvent } from 'react'
import type { CodeTest, Item, ItemType } from '../core/types'
import { useAtlas } from '../core/atlas'
import { againCount } from '../scheduler/fsrs'
import { masteryProbability } from '../scheduler/elo'
import { bandOf, bandLabel, predictedRecall } from '../scheduler/selection'
import { formatDue } from '../core/format'
import { errorTagLabel } from '../activities/ErrorTagPicker'

const TYPE_LABEL: Record<ItemType, string> = {
  flashcard: '플래시카드',
  cloze: '빈칸 채우기',
  mcq: '4지선다',
  code: '코드',
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

export function CardsView() {
  const atlas = useAtlas()
  const { kcs, kcById, eloState, cardStates, latestByItem, leechItems, leechItemIds, byItem, now } =
    atlas

  // 카드 추가 폼 — 타입마다 쓰는 필드가 달라 하나의 폼에 다 두고 타입에 따라 보여준다.
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

  async function handleAddItem(e: FormEvent) {
    e.preventDefault()
    const kcId = itemKcId || null
    if (newType === 'flashcard') {
      if (!front.trim() || !back.trim()) return
      await atlas.addItem({ type: 'flashcard', front: front.trim(), back: back.trim(), kcId })
    } else if (newType === 'cloze') {
      if (!clozeText.includes('{{')) return
      await atlas.addItem({ type: 'cloze', text: clozeText.trim(), kcId })
    } else if (newType === 'mcq') {
      if (!mcqPrompt.trim() || mcqOptions.some((o) => !o.trim())) return
      await atlas.addItem({
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
      await atlas.addItem({
        type: 'code',
        prompt: codePrompt.trim(),
        starterCode: codeStarter,
        tests,
        kcId,
      })
    }
    resetItemForm()
  }

  async function handleAddKc(e: FormEvent) {
    e.preventDefault()
    if (!kcName.trim()) return
    await atlas.addKC(kcName.trim(), kcPrereqIds)
    setKcName('')
    setKcPrereqIds([])
  }

  function toggleKcPrereq(id: string) {
    setKcPrereqIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <>
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
          <input
            value={kcName}
            onChange={(e) => setKcName(e.target.value)}
            placeholder="새 지식 요소 이름"
          />
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
              <input
                value={mcqPrompt}
                onChange={(e) => setMcqPrompt(e.target.value)}
                placeholder="문제"
              />
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
              <input
                value={codePrompt}
                onChange={(e) => setCodePrompt(e.target.value)}
                placeholder="문제"
              />
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

      {atlas.items.length > 0 && (
        <section className="deck">
          <h2>전체 카드</h2>
          <ul>
            {atlas.items.map((item) => {
              const state = cardStates.get(item.id)
              const kc = item.kcId ? kcById.get(item.kcId) : undefined
              const latest = latestByItem.get(item.id)
              // 예측 회상률은 한 번이라도 복습해 Elo 난이도가 잡힌 카드에만 의미가 있다.
              const recall =
                state && state.state !== 'new' ? predictedRecall(item, eloState) : null
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
                  <button className="delete" onClick={() => atlas.deleteItem(item.id)}>
                    삭제
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}
