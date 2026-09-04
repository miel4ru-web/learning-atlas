// 활동 타입별 "응답 받기" UI. 자신감 입력은 이미 끝난 뒤에 이 컴포넌트가 뜬다
// (StudyView가 그 단계를 관리). 여기서는 타입마다 다른 입력 방식을 처리하고,
// 최종적으로 Grade(+틀렸으면 ErrorTag)를 확정해 onGraded로 한 번만 올린다.
//
// v19: 채점과 함께 부가 신호(InteractionSignals)도 올린다. 응답 시간은 이 컴포넌트가
// 마운트된 순간(=문제가 화면에 뜬 순간)부터 재고, 응답 원문·선택지 인덱스는 각 활동이
// 자기가 아는 만큼만 채운다. 자신감 입력 단계는 문제 내용이 아직 안 보이므로 시간에서 뺀다.

import { useEffect, useRef, useState } from 'react'
import type {
  CodeItem,
  ClozeItem,
  ErrorTag,
  FlashcardItem,
  Grade,
  InteractionSignals,
  Item,
  McqItem,
  ShortAnswerItem,
} from '../core/types'
import {
  checkCloze,
  checkMcq,
  checkShortAnswer,
  clozePrompt,
  extractBlanks,
  gradeFromCorrectness,
} from '../scheduler/grading'
import { runCode } from '../scheduler/codeRunner'
import { ErrorTagPicker } from './ErrorTagPicker'

interface Props {
  item: Item
  onGraded: (grade: Grade, errorTag: ErrorTag | null, signals: InteractionSignals) => void
}

/** 활동 컴포넌트가 쓰는 채점 콜백 — 시간은 부모가 붙이므로 자기 신호만 넘긴다. */
type Graded = (
  grade: Grade,
  errorTag: ErrorTag | null,
  extra?: Omit<InteractionSignals, 'latencyMs'>,
) => void

export function RespondPanel({ item, onGraded }: Props) {
  // 문항이 실제로 화면에 뜬 시각. StudyView가 카드마다 key로 리마운트하므로
  // 마운트 시점 = 새 문항이 보이기 시작한 시점이다. 렌더 중에 Date.now()를 부르면
  // 순수하지 않으므로(리렌더마다 값이 흔들린다) 마운트 이펙트에서 한 번만 잡는다.
  const shownAt = useRef(0)
  useEffect(() => {
    shownAt.current = Date.now()
  }, [])

  const graded: Graded = (grade, errorTag, extra) => {
    // 이펙트 전에 채점될 수는 없지만(사용자 클릭이 필요하다), 만약 그런 일이
    // 생기면 말도 안 되는 값을 남기느니 신호를 빼는 쪽이 낫다.
    const latencyMs = shownAt.current === 0 ? undefined : Date.now() - shownAt.current
    onGraded(grade, errorTag, { latencyMs, ...extra })
  }

  switch (item.type) {
    case 'flashcard':
      return <FlashcardRespond item={item} onGraded={graded} />
    case 'mcq':
      return <McqRespond item={item} onGraded={graded} />
    case 'cloze':
      return <ClozeRespond item={item} onGraded={graded} />
    case 'code':
      return <CodeRespond item={item} onGraded={graded} />
    case 'short':
      return <ShortAnswerRespond item={item} onGraded={graded} />
  }
}

// ---- flashcard: 기존 v0/v1 그대로. 자기 채점이라 결과 배너 없이 즉시 확정된다.
// 입력 필드가 없으니 남길 응답 원문도 없다(신호는 응답 시간뿐). ----
function FlashcardRespond({ item, onGraded }: { item: FlashcardItem; onGraded: Graded }) {
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
  /** 각 활동이 자기 신호(응답 원문 등)를 미리 감아서 넘겨준다. */
  onGraded: (grade: Grade, errorTag: ErrorTag | null) => void
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

function McqRespond({ item, onGraded }: { item: McqItem; onGraded: Graded }) {
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
          // 고른 선택지를 인덱스와 원문 둘 다 남긴다 — 인덱스는 3.4 오개념 태깅용,
          // 원문은 나중에 선택지 순서가 바뀌어도 로그를 읽을 수 있게 하는 보험.
          onGraded={(grade, tag) =>
            onGraded(grade, tag, { selectedIndex: selected, response: item.options[selected] })
          }
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
          // 빈칸이 여럿이면 ' | '로 이어 붙인다(정답 표기 blanks.join(', ')와 구분되게).
          onGraded={(grade, tag) => onGraded(grade, tag, { response: answers.join(' | ') })}
        />
      )}
    </>
  )
}

// 단답형(v17): cloze와 채점 방식(정규화 문자열 비교)은 같지만, 문장 속 빈칸이
// 아니라 완결된 질문 하나에 답 하나를 타이핑한다.
function ShortAnswerRespond({ item, onGraded }: { item: ShortAnswerItem; onGraded: Graded }) {
  const [answer, setAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)

  return (
    <>
      <p className="card-front">{item.prompt}</p>
      {!submitted ? (
        <form
          className="short-answer-form"
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(true)
          }}
        >
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="답" autoFocus />
          <button type="submit">제출</button>
        </form>
      ) : (
        <ObjectiveOutcome
          grade={gradeFromCorrectness(checkShortAnswer(item, answer))}
          correctAnswerText={item.acceptedAnswers.join(' / ')}
          onGraded={(grade, tag) => onGraded(grade, tag, { response: answer })}
        />
      )}
    </>
  )
}

function CodeRespond({ item, onGraded }: { item: CodeItem; onGraded: Graded }) {
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
        <ObjectiveOutcome
          grade={outcome.grade}
          correctAnswerText={outcome.detail}
          // 제출한 소스 전체를 남긴다 — 나중에 "무엇을 어떻게 틀렸나"를 볼 수 있는 유일한 기록.
          onGraded={(grade, tag) => onGraded(grade, tag, { response: code })}
        />
      )}
    </>
  )
}
