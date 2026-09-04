// 카드 추가 / 편집 폼. 하나의 컴포넌트가 두 경우를 다 처리한다 — `initial`이
// 없으면 추가(타입 탭 노출), 있으면 편집(타입 고정, 저장/취소). 타입마다 쓰는
// 필드가 달라 한 폼에 다 두고 선택된 타입만 보여준다.
//
// CardsView는 이 폼을 key로 리마운트해서 상태를 리셋한다(추가 후 비우기, 편집
// 진입 시 initial로 채우기) — 그래서 여기서는 useEffect로 initial을 감시하지 않는다.

import { useState, type FormEvent } from 'react'
import type { CodeTest, Item, ItemType, KnowledgeComponent, NewItem } from '../core/types'
import { useAtlas } from '../core/atlas'
import { TYPE_LABEL } from './itemDisplay'

const DEFAULT_STARTER = 'function solve() {\n  \n}'
const DEFAULT_TESTS = '[{"args": [], "expected": null}]'

interface Props {
  kcs: KnowledgeComponent[]
  initial?: Item
  /** 저장·취소 후 호출 — CardsView가 편집 모드를 닫고 폼을 리셋한다. */
  onDone: () => void
}

export function ItemForm({ kcs, initial, onDone }: Props) {
  const atlas = useAtlas()
  const editing = initial !== undefined

  const [type, setType] = useState<ItemType>(initial?.type ?? 'flashcard')
  const [front, setFront] = useState(initial?.type === 'flashcard' ? initial.front : '')
  const [back, setBack] = useState(initial?.type === 'flashcard' ? initial.back : '')
  const [clozeText, setClozeText] = useState(initial?.type === 'cloze' ? initial.text : '')
  const [mcqPrompt, setMcqPrompt] = useState(initial?.type === 'mcq' ? initial.prompt : '')
  const [mcqOptions, setMcqOptions] = useState<string[]>(
    initial?.type === 'mcq' ? [...initial.options] : ['', '', '', ''],
  )
  const [mcqCorrect, setMcqCorrect] = useState<number>(
    initial?.type === 'mcq' ? initial.correctIndex : 0,
  )
  const [codePrompt, setCodePrompt] = useState(initial?.type === 'code' ? initial.prompt : '')
  const [codeStarter, setCodeStarter] = useState(
    initial?.type === 'code' ? initial.starterCode : DEFAULT_STARTER,
  )
  const [codeTestsJson, setCodeTestsJson] = useState(
    initial?.type === 'code' ? JSON.stringify(initial.tests) : DEFAULT_TESTS,
  )
  const [codeTestsError, setCodeTestsError] = useState<string | null>(null)
  const [kcId, setKcId] = useState(initial?.kcId ?? '')

  function buildPayload(): NewItem | null {
    const selectedKc = kcId || null
    if (type === 'flashcard') {
      if (!front.trim() || !back.trim()) return null
      return { type: 'flashcard', front: front.trim(), back: back.trim(), kcId: selectedKc }
    }
    if (type === 'cloze') {
      if (!clozeText.includes('{{')) return null
      return { type: 'cloze', text: clozeText.trim(), kcId: selectedKc }
    }
    if (type === 'mcq') {
      if (!mcqPrompt.trim() || mcqOptions.some((o) => !o.trim())) return null
      return {
        type: 'mcq',
        prompt: mcqPrompt.trim(),
        options: mcqOptions as [string, string, string, string],
        correctIndex: mcqCorrect as 0 | 1 | 2 | 3,
        kcId: selectedKc,
      }
    }
    if (!codePrompt.trim()) return null
    let tests: CodeTest[]
    try {
      tests = JSON.parse(codeTestsJson)
    } catch {
      setCodeTestsError('테스트 JSON을 해석할 수 없습니다.')
      return null
    }
    setCodeTestsError(null)
    return { type: 'code', prompt: codePrompt.trim(), starterCode: codeStarter, tests, kcId: selectedKc }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const payload = buildPayload()
    if (!payload) return
    if (initial) {
      await atlas.updateItem({
        ...(payload as object),
        id: initial.id,
        createdAt: initial.createdAt,
      } as Item)
    } else {
      await atlas.addItem(payload)
    }
    onDone()
  }

  return (
    <section className="panel item-panel">
      <h2>{editing ? '카드 편집' : '카드 추가'}</h2>

      {editing ? (
        <p className="muted item-edit-type">{TYPE_LABEL[type]}</p>
      ) : (
        <div className="type-tabs">
          {(['flashcard', 'cloze', 'mcq', 'code'] as ItemType[]).map((t) => (
            <button
              key={t}
              className={t === type ? 'active' : ''}
              onClick={() => setType(t)}
              type="button"
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="item-form">
        {type === 'flashcard' && (
          <>
            <input value={front} onChange={(e) => setFront(e.target.value)} placeholder="앞면" />
            <input value={back} onChange={(e) => setBack(e.target.value)} placeholder="뒷면" />
          </>
        )}
        {type === 'cloze' && (
          <textarea
            value={clozeText}
            onChange={(e) => setClozeText(e.target.value)}
            placeholder="예: 물의 화학식은 {{H2O}}이다"
          />
        )}
        {type === 'mcq' && (
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
        {type === 'code' && (
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

        <select value={kcId} onChange={(e) => setKcId(e.target.value)}>
          <option value="">지식 요소 없음</option>
          {kcs.map((kc) => (
            <option key={kc.id} value={kc.id}>
              {kc.name}
            </option>
          ))}
        </select>

        <div className="form-actions">
          <button type="submit">{editing ? '저장' : '추가'}</button>
          {editing && (
            <button type="button" className="reveal" onClick={onDone}>
              취소
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
