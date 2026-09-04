// 활동 타입별 "응답 받기" UI. 자신감 입력은 이미 끝난 뒤에 이 컴포넌트가 뜬다
// (App.tsx가 그 단계를 관리). 여기서는 타입마다 다른 입력 방식을 처리하고,
// 최종적으로 Grade(+틀렸으면 ErrorTag)를 확정해 onGraded로 한 번만 올린다.

import { useState } from 'react'
import type { CodeItem, ClozeItem, ErrorTag, FlashcardItem, Grade, Item, McqItem } from '../core/types'
import { checkCloze, checkMcq, clozePrompt, extractBlanks, gradeFromCorrectness } from '../scheduler/grading'
import { runCode } from '../scheduler/codeRunner'
import { ErrorTagPicker } from './ErrorTagPicker'

interface Props {
  item: Item
  onGraded: (grade: Grade, errorTag: ErrorTag | null) => void
}

export function RespondPanel({ item, onGraded }: Props) {
  switch (item.type) {
    case 'flashcard':
      return <FlashcardRespond item={item} onGraded={onGraded} />
    case 'mcq':
      return <McqRespond item={item} onGraded={onGraded} />
    case 'cloze':
      return <ClozeRespond item={item} onGraded={onGraded} />
    case 'code':
      return <CodeRespond item={item} onGraded={onGraded} />
  }
}

// ---- flashcard: 기존 v0/v1 그대로. 자기 채점이라 결과 배너 없이 즉시 확정된다. ----
function FlashcardRespond({ item, onGraded }: { item: FlashcardItem; onGraded: Props['onGraded'] }) {
  const [revealed, setRevealed] = useState(false)
  const [awaitingTag, setAwaitingTag] = useState(false)

  function grade(g: Grade) {
    if (g === 'again') setAwaitingTag(true)
    else onGraded(g, null)
  }

  return (
    <>
      <p className="card-front">{item.front}</p>
      {!revealed ? (
        <button className="reveal" onClick={() => setRevealed(true)}>
          답 보기
        </button>
      ) : awaitingTag ? (
        <ErrorTagPicker onPick={(tag) => onGraded('again', tag)} />
      ) : (
        <>
          <p className="card-back">{item.back}</p>
          <div className="grades">
            <button className="grade grade-again" onClick={() => grade('again')}>
              다시
            </button>
            <button className="grade grade-hard" onClick={() => grade('hard')}>
              어려움
            </button>
            <button className="grade grade-good" onClick={() => grade('good')}>
              좋음
            </button>
            <button className="grade grade-easy" onClick={() => grade('easy')}>
              쉬움
            </button>
          </div>
        </>
      )}
    </>
  )
}

// 객관식 계열(mcq/cloze/code) 공통 결과 배너: 맞으면 "다음", 틀리면 태그 선택.
// grade는 항상 gradeFromCorrectness()가 만든 값을 그대로 받는다 — 이 컴포넌트가
// 정답/오답을 다시 판단하지 않는다(판정은 각 활동의 check*() 몫).
function ObjectiveOutcome({
  grade,
  correctAnswerText,
  onGraded,
}: {
  grade: Grade
  correctAnswerText: string
  onGraded: Props['onGraded']
}) {
  if (grade !== 'again') {
    return (
      <div className="outcome outcome-correct">
        <p>정답입니다.</p>
        <button className="reveal" onClick={() => onGraded(grade, null)}>
          다음
        </button>
      </div>
    )
  }
  return (
    <div className="outcome outcome-incorrect">
      <p>오답입니다. 정답: {correctAnswerText}</p>
      <ErrorTagPicker onPick={(tag) => onGraded('again', tag)} />
    </div>
  )
}

function McqRespond({ item, onGraded }: { item: McqItem; onGraded: Props['onGraded'] }) {
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <>
      <p className="card-front">{item.prompt}</p>
      {selected === null ? (
        <div className="mcq-options">
          {item.options.map((opt, i) => (
            <button key={i} onClick={() => setSelected(i)}>
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <ObjectiveOutcome
          grade={gradeFromCorrectness(checkMcq(item, selected))}
          correctAnswerText={item.options[item.correctIndex]}
          onGraded={onGraded}
        />
      )}
    </>
  )
}

function ClozeRespond({ item, onGraded }: { item: ClozeItem; onGraded: Props['onGraded'] }) {
  const blanks = extractBlanks(item.text)
  const [answers, setAnswers] = useState<string[]>(() => blanks.map(() => ''))
  const [submitted, setSubmitted] = useState(false)

  return (
    <>
      <p className="card-front">{clozePrompt(item.text)}</p>
      {!submitted ? (
        <form
          className="cloze-form"
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(true)
          }}
        >
          {blanks.map((_, i) => (
            <input
              key={i}
              value={answers[i]}
              placeholder={`빈칸 ${i + 1}`}
              onChange={(e) =>
                setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))
              }
            />
          ))}
          <button type="submit">제출</button>
        </form>
      ) : (
        <ObjectiveOutcome
          grade={gradeFromCorrectness(checkCloze(item, answers))}
          correctAnswerText={blanks.join(', ')}
          onGraded={onGraded}
        />
      )}
    </>
  )
}

function CodeRespond({ item, onGraded }: { item: CodeItem; onGraded: Props['onGraded'] }) {
  const [code, setCode] = useState(item.starterCode)
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<{ grade: Grade; detail: string } | null>(null)

  async function run() {
    setRunning(true)
    const result = await runCode(code, item.tests)
    setRunning(false)
    if (result.timedOut) {
      setOutcome({ grade: 'again', detail: '제한 시간을 초과했습니다.' })
      return
    }
    if (result.compileError) {
      setOutcome({ grade: 'again', detail: result.compileError })
      return
    }
    const passed = result.results.filter((r) => r.pass).length
    setOutcome({
      grade: gradeFromCorrectness(result.ok),
      detail: `${passed}/${result.results.length} 테스트 통과`,
    })
  }

  return (
    <>
      <p className="card-front">{item.prompt}</p>
      {!outcome ? (
        <div className="code-editor">
          <textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
          <button className="reveal" onClick={run} disabled={running}>
            {running ? '채점 중…' : '채점'}
          </button>
        </div>
      ) : (
        <ObjectiveOutcome grade={outcome.grade} correctAnswerText={outcome.detail} onGraded={onGraded} />
      )}
    </>
  )
}
