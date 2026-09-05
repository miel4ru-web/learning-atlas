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

/** 저장된 오개념 태그(null 허용, 길이 미정)를 폼이 쓰는 4칸 문자열 배열로 편다. */
function mcqOptionsInitial(tags: (string | null)[] | undefined): string[] {
  return Array.from({ length: 4 }, (_, i) => tags?.[i] ?? '')
}

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
  // 오개념 태그는 선택지와 같은 길이로 들고 다닌다(빈 문자열 = 태그 없음).
  const [mcqTags, setMcqTags] = useState<string[]>(
    initial?.type === 'mcq'
      ? mcqOptionsInitial(initial.distractorTags)
      : ['', '', '', ''],
  )
  const [codePrompt, setCodePrompt] = useState(initial?.type === 'code' ? initial.prompt : '')
  const [codeStarter, setCodeStarter] = useState(
    initial?.type === 'code' ? initial.starterCode : DEFAULT_STARTER,
  )
  const [codeTestsJson, setCodeTestsJson] = useState(
    initial?.type === 'code' ? JSON.stringify(initial.tests) : DEFAULT_TESTS,
  )
  // 저장 실패 사유 — buildPayload()가 필드별 구체적인 메시지를 돌려주면 여기 보여준다.
  // 예전에는 buildPayload가 null만 반환해 "추가 버튼이 안 먹는" 것처럼 보였다.
  const [formError, setFormError] = useState<string | null>(null)
  const [shortPrompt, setShortPrompt] = useState(initial?.type === 'short' ? initial.prompt : '')
  // 쉼표로 여러 정답(동의어) — 저장은 배열이지만 폼에서는 한 줄로 편집하는 게 더 간단하다.
  const [shortAnswersText, setShortAnswersText] = useState(
    initial?.type === 'short' ? initial.acceptedAnswers.join(', ') : '',
  )
  const [explainPrompt, setExplainPrompt] = useState(
    initial?.type === 'free_text' ? initial.prompt : '',
  )
  const [explainModelAnswer, setExplainModelAnswer] = useState(
    initial?.type === 'free_text' ? initial.modelAnswer : '',
  )
  // 핵심 요소는 한 줄에 하나 — 쉼표로 나누면 문장 안의 쉼표와 부딪힌다.
  const [explainKeyPointsText, setExplainKeyPointsText] = useState(
    initial?.type === 'free_text' ? (initial.keyPoints ?? []).join('\n') : '',
  )
  const [kcId, setKcId] = useState(initial?.kcId ?? '')

  /** 저장 가능하면 아이템을, 아니면 화면에 보여줄 구체적인 사유를 돌려준다. */
  function buildPayload(): { ok: true; item: NewItem } | { ok: false; message: string } {
    const selectedKc = kcId || null
    if (type === 'flashcard') {
      if (!front.trim()) return { ok: false, message: '앞면을 입력하세요.' }
      if (!back.trim()) return { ok: false, message: '뒷면을 입력하세요.' }
      return { ok: true, item: { type: 'flashcard', front: front.trim(), back: back.trim(), kcId: selectedKc } }
    }
    if (type === 'cloze') {
      if (!clozeText.trim()) return { ok: false, message: '문제 내용을 입력하세요.' }
      if (!clozeText.includes('{{')) {
        return { ok: false, message: '빈칸 카드에는 {{정답}} 형식의 빈칸이 하나는 있어야 합니다.' }
      }
      return { ok: true, item: { type: 'cloze', text: clozeText.trim(), kcId: selectedKc } }
    }
    if (type === 'mcq') {
      if (!mcqPrompt.trim()) return { ok: false, message: '문제를 입력하세요.' }
      if (mcqOptions.some((o) => !o.trim())) return { ok: false, message: '보기 4개를 모두 채우세요.' }
      // 정답 자리는 비워서 저장한다 — 정답을 고른 건 오개념이 아니다.
      const distractorTags = mcqTags.map((t, i) => (i === mcqCorrect ? null : t.trim() || null))
      return {
        ok: true,
        item: {
          type: 'mcq',
          prompt: mcqPrompt.trim(),
          options: mcqOptions as [string, string, string, string],
          correctIndex: mcqCorrect as 0 | 1 | 2 | 3,
          ...(distractorTags.some((t) => t !== null) ? { distractorTags } : {}),
          kcId: selectedKc,
        },
      }
    }
    if (type === 'code') {
      if (!codePrompt.trim()) return { ok: false, message: '문제를 입력하세요.' }
      let tests: CodeTest[]
      try {
        tests = JSON.parse(codeTestsJson)
      } catch {
        return { ok: false, message: '테스트 JSON을 해석할 수 없습니다.' }
      }
      return {
        ok: true,
        item: { type: 'code', prompt: codePrompt.trim(), starterCode: codeStarter, tests, kcId: selectedKc },
      }
    }
    if (type === 'short') {
      const acceptedAnswers = shortAnswersText
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a.length > 0)
      if (!shortPrompt.trim()) return { ok: false, message: '문제를 입력하세요.' }
      if (acceptedAnswers.length === 0) return { ok: false, message: '정답을 하나 이상 입력하세요.' }
      return { ok: true, item: { type: 'short', prompt: shortPrompt.trim(), acceptedAnswers, kcId: selectedKc } }
    }
    if (!explainPrompt.trim()) return { ok: false, message: '질문을 입력하세요.' }
    if (!explainModelAnswer.trim()) return { ok: false, message: '모범 답안을 입력하세요.' }
    const keyPoints = explainKeyPointsText
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    return {
      ok: true,
      item: {
        type: 'free_text',
        prompt: explainPrompt.trim(),
        modelAnswer: explainModelAnswer.trim(),
        // 없으면 필드 자체를 안 넣는다 — optional 필드의 형태를 저장·백업 양쪽에서 통일.
        ...(keyPoints.length > 0 ? { keyPoints } : {}),
        kcId: selectedKc,
      },
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const result = buildPayload()
    if (!result.ok) {
      setFormError(result.message)
      return
    }
    setFormError(null)
    const payload = result.item
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
          {(Object.keys(TYPE_LABEL) as ItemType[]).map((t) => (
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
                {/* 오개념 태그(v25)는 오답 선택지에만 의미가 있다 — 정답 줄에는 숨긴다. */}
                {mcqCorrect !== i && (
                  <input
                    className="mcq-tag"
                    value={mcqTags[i]}
                    onChange={(e) =>
                      setMcqTags((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))
                    }
                    placeholder="이 답을 고르는 이유 (선택)"
                  />
                )}
              </div>
            ))}
            <p className="muted mcq-tag-help">
              오답 선택지에 &quot;왜 이걸 고르게 되는지&quot;를 적어두면, 나중에 진단 화면에서
              자주 걸리는 오개념으로 모아 볼 수 있습니다.
            </p>
          </>
        )}
        {type === 'short' && (
          <>
            <input
              value={shortPrompt}
              onChange={(e) => setShortPrompt(e.target.value)}
              placeholder="문제"
            />
            <input
              value={shortAnswersText}
              onChange={(e) => setShortAnswersText(e.target.value)}
              placeholder="정답 (동의어는 쉼표로 구분, 예: 물, H2O)"
            />
          </>
        )}
        {type === 'free_text' && (
          <>
            <input
              value={explainPrompt}
              onChange={(e) => setExplainPrompt(e.target.value)}
              placeholder="질문 (예: 왜 간격을 두고 복습해야 하나?)"
            />
            <textarea
              value={explainModelAnswer}
              onChange={(e) => setExplainModelAnswer(e.target.value)}
              placeholder="모범 답안 — 내 설명과 대조할 기준"
            />
            <textarea
              value={explainKeyPointsText}
              onChange={(e) => setExplainKeyPointsText(e.target.value)}
              placeholder="핵심 요소 (선택) — 한 줄에 하나씩"
            />
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

        {formError && <p className="error-text">{formError}</p>}

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
