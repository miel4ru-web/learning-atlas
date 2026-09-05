// 활동 타입별 "응답 받기" UI. 자신감 입력은 이미 끝난 뒤에 이 컴포넌트가 뜬다
// (StudyView가 그 단계를 관리). 여기서는 타입마다 다른 입력 방식을 처리하고,
// 최종적으로 Grade(+틀렸으면 ErrorTag)를 확정해 onGraded로 한 번만 올린다.
//
// v19: 채점과 함께 부가 신호(InteractionSignals)도 올린다. 응답 시간은 이 컴포넌트가
// 마운트된 순간(=문제가 화면에 뜬 순간)부터 재고, 응답 원문·선택지 인덱스는 각 활동이
// 자기가 아는 만큼만 채운다. 자신감 입력 단계는 문제 내용이 아직 안 보이므로 시간에서 뺀다.

import { useEffect, useRef, useState } from 'react'
import { useKeyBinding } from '../shell/useKeyBinding'
import type {
  CodeItem,
  ClozeItem,
  ErrorTag,
  FlashcardItem,
  FreeTextItem,
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
  type MatchResult,
} from '../scheduler/grading'
import { runCode } from '../scheduler/codeRunner'
import { ErrorTagPicker } from './ErrorTagPicker'
import { shuffledIndices } from './shuffle'

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
    case 'free_text':
      return <FreeTextRespond item={item} onGraded={graded} />
  }
}

// 자기 채점 4단계 — 플래시카드와 자기 설명이 함께 쓴다. 채점 기준이 사람 판단인
// 활동은 이 UI를, 기계 판정이 가능한 활동은 ObjectiveOutcome을 쓴다.
function SelfGrade({ onGraded }: { onGraded: (grade: Grade, errorTag: ErrorTag | null) => void }) {
  const [awaitingTag, setAwaitingTag] = useState(false)

  useKeyBinding(
    awaitingTag
      ? {}
      : {
          '1': () => setAwaitingTag(true),
          '2': () => onGraded('hard', null),
          '3': () => onGraded('good', null),
          '4': () => onGraded('easy', null),
        },
  )

  if (awaitingTag) return <ErrorTagPicker onPick={(tag) => onGraded('again', tag)} />

  return (
    <div className="grades">
      <button className="grade grade-again" onClick={() => setAwaitingTag(true)}>
        다시 (1)
      </button>
      <button className="grade grade-hard" onClick={() => onGraded('hard', null)}>
        어려움 (2)
      </button>
      <button className="grade grade-good" onClick={() => onGraded('good', null)}>
        좋음 (3)
      </button>
      <button className="grade grade-easy" onClick={() => onGraded('easy', null)}>
        쉬움 (4)
      </button>
    </div>
  )
}

// ---- flashcard: 기존 v0/v1 그대로. 자기 채점이라 결과 배너 없이 즉시 확정된다.
// 입력 필드가 없으니 남길 응답 원문도 없다(신호는 응답 시간뿐). ----
function FlashcardRespond({ item, onGraded }: { item: FlashcardItem; onGraded: Graded }) {
  const [revealed, setRevealed] = useState(false)

  useKeyBinding(revealed ? {} : { ' ': () => setRevealed(true) })

  return (
    <>
      <p className="card-front">{item.front}</p>
      {!revealed ? (
        <button className="reveal" onClick={() => setRevealed(true)}>
          답 보기 (Space)
        </button>
      ) : (
        <>
          {/* 오답 태그를 고르는 동안에도 답은 계속 보인다 — 왜 틀렸는지 고르려면 정답을 봐야 한다. */}
          <p className="card-back">{item.back}</p>
          <SelfGrade onGraded={onGraded} />
        </>
      )}
    </>
  )
}

// 자기 설명(v24): 먼저 자기 말로 쓰게 하고(생성 효과), 그다음에야 모범 답안을 보여
// 대조시킨다. 순서가 핵심이다 — 먼저 보여주면 "읽고 고개 끄덕이기"가 되어 1부의
// 저효용 구간(재읽기)으로 떨어진다. 채점은 사람이 하되, keyPoints로 무엇을 짚었어야
// 하는지 같이 보여줘 자기 채점이 후해지는 걸 조금이나마 막는다(3.5).
function FreeTextRespond({ item, onGraded }: { item: FreeTextItem; onGraded: Graded }) {
  const [answer, setAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)

  if (!submitted) {
    return (
      <>
        <p className="card-front">{item.prompt}</p>
        <form
          className="free-text-form"
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(true)
          }}
        >
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="자기 말로 설명해 보세요"
            autoFocus
          />
          <button type="submit">설명 마치고 답안 보기</button>
        </form>
      </>
    )
  }

  return (
    <>
      <p className="card-front">{item.prompt}</p>
      <div className="free-text-compare">
        <div className="free-text-mine">
          <h3>내 설명</h3>
          <p>{answer.trim() || '(비어 있음)'}</p>
        </div>
        <div className="free-text-model">
          <h3>모범 답안</h3>
          <p>{item.modelAnswer}</p>
          {item.keyPoints && item.keyPoints.length > 0 && (
            <ul className="free-text-points">
              {item.keyPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="muted free-text-hint">빠뜨린 부분을 기준으로 스스로 채점하세요.</p>
      <SelfGrade onGraded={(grade, tag) => onGraded(grade, tag, { response: answer })} />
    </>
  )
}

// 객관식 계열(mcq/cloze/code) 공통 결과 배너: 맞으면 "다음", 틀리면 태그 선택.
// grade는 항상 gradeFromCorrectness()가 만든 값을 그대로 받는다 — 이 컴포넌트가
// 정답/오답을 다시 판단하지 않는다(판정은 각 활동의 check*() 몫).
function ObjectiveOutcome({
  grade,
  correctAnswerText,
  misconception,
  onGraded,
}: {
  grade: Grade
  correctAnswerText: string
  /** 고른 오답에 미리 달아둔 오개념 라벨(Atlas 3.4). 있으면 왜 틀렸는지를 바로 짚어준다. */
  misconception?: string | null
  /** 각 활동이 자기 신호(응답 원문 등)를 미리 감아서 넘겨준다. */
  onGraded: (grade: Grade, errorTag: ErrorTag | null) => void
}) {
  useKeyBinding(
    grade !== 'again' ? { ' ': () => onGraded(grade, null), Enter: () => onGraded(grade, null) } : {},
  )

  if (grade !== 'again') {
    return (
      <div className="outcome outcome-correct">
        <p>정답입니다.</p>
        <button className="reveal" onClick={() => onGraded(grade, null)}>
          다음 (Space)
        </button>
      </div>
    )
  }
  return (
    <div className="outcome outcome-incorrect">
      <p>오답입니다. 정답: {correctAnswerText}</p>
      {misconception && <p className="misconception-note">{misconception}</p>}
      <ErrorTagPicker onPick={(tag) => onGraded('again', tag)} />
    </div>
  )
}

// 오타 허용(v32) — 편집거리 1짜리 "거의 맞음"은 자동으로 정답 처리하지 않고
// 사용자가 직접 고르게 한다. cloze·단답형이 공유한다.
function NearMissBanner({
  correctAnswerText,
  givenText,
  onResolve,
}: {
  correctAnswerText: string
  givenText: string
  onResolve: (grade: Grade) => void
}) {
  useKeyBinding({ '1': () => onResolve('good'), '2': () => onResolve('again') })
  return (
    <div className="outcome outcome-near">
      <p>
        거의 맞았습니다. 정답: <strong>{correctAnswerText}</strong> (입력: {givenText || '(빈칸)'})
      </p>
      <div className="near-miss-buttons">
        <button className="grade grade-good" onClick={() => onResolve('good')}>
          정답으로 (1)
        </button>
        <button className="grade grade-again" onClick={() => onResolve('again')}>
          오답으로 (2)
        </button>
      </div>
    </div>
  )
}

/** near면 아직 결론이 안 났다는 뜻으로 null, 그 외엔 바로 Grade가 정해진다. */
function gradeFromMatch(result: MatchResult): Grade | null {
  if (result === 'near') return null
  return gradeFromCorrectness(result === 'correct')
}

function McqRespond({ item, onGraded }: { item: McqItem; onGraded: Graded }) {
  const [selected, setSelected] = useState<number | null>(null)
  // 표시 순서만 섞는다(v32) — selected·채점·오개념 태깅은 전부 원본 인덱스를 쓴다.
  const [order] = useState(() => shuffledIndices(item.options.length))

  return (
    <>
      <p className="card-front">{item.prompt}</p>
      {selected === null ? (
        <div className="mcq-options">
          {order.map((originalIndex) => (
            <button key={originalIndex} onClick={() => setSelected(originalIndex)}>
              {item.options[originalIndex]}
            </button>
          ))}
        </div>
      ) : (
        <ObjectiveOutcome
          grade={gradeFromCorrectness(checkMcq(item, selected))}
          correctAnswerText={item.options[item.correctIndex]}
          misconception={item.distractorTags?.[selected] ?? null}
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
  const [resolvedGrade, setResolvedGrade] = useState<Grade | null>(null)

  const result = submitted ? checkCloze(item, answers) : null
  // 빈칸이 여럿이면 ' | '로 이어 붙인다(정답 표기 blanks.join(', ')와 구분되게).
  const responseText = answers.join(' | ')

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
      ) : result && resolvedGrade === null && gradeFromMatch(result) === null ? (
        <NearMissBanner
          correctAnswerText={blanks.join(', ')}
          givenText={responseText}
          onResolve={setResolvedGrade}
        />
      ) : (
        <ObjectiveOutcome
          grade={resolvedGrade ?? gradeFromMatch(result ?? 'wrong') ?? 'again'}
          correctAnswerText={blanks.join(', ')}
          onGraded={(grade, tag) => onGraded(grade, tag, { response: responseText })}
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
  const [resolvedGrade, setResolvedGrade] = useState<Grade | null>(null)

  const result = submitted ? checkShortAnswer(item, answer) : null

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
      ) : result && resolvedGrade === null && gradeFromMatch(result) === null ? (
        <NearMissBanner
          correctAnswerText={item.acceptedAnswers.join(' / ')}
          givenText={answer}
          onResolve={setResolvedGrade}
        />
      ) : (
        <ObjectiveOutcome
          grade={resolvedGrade ?? gradeFromMatch(result ?? 'wrong') ?? 'again'}
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
