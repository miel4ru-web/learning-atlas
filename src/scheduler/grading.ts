// 객관식 활동 타입(mcq·cloze·code)의 채점 로직. flashcard는 자기 채점(4단계)
// 그대로라 여기 없다 — 이 파일은 "정답이 기계적으로 판정되는" 타입만 다룬다.
// 판정 결과(정답/오답)를 Grade로 접는 규칙은 하나: 정답→good, 오답→again.
// hard/easy 뉘앙스는 사람이 자기 채점할 때만 의미가 있어서, 객관식에는 없다.

import type { ClozeItem, McqItem, ShortAnswerItem, Grade } from '../core/types'

export function gradeFromCorrectness(correct: boolean): Grade {
  return correct ? 'good' : 'again'
}

export function checkMcq(item: McqItem, selectedIndex: number): boolean {
  return selectedIndex === item.correctIndex
}

const BLANK_RE = /\{\{(.*?)\}\}/g

/** `{{정답}}` 구간의 정답 문자열들을 순서대로 뽑는다. */
export function extractBlanks(text: string): string[] {
  return [...text.matchAll(BLANK_RE)].map((m) => m[1])
}

/** 빈칸을 감춘 표시용 텍스트. `{{H2O}}` → `_____`. */
export function clozePrompt(text: string): string {
  return text.replace(BLANK_RE, '_____')
}

function normalize(s: string): string {
  return s
    .normalize('NFKC') // 전각/반각, 자모 결합 등 표기만 다른 문자를 같은 걸로 본다
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:'"()[\]{}]/g, '') // 문장부호 차이로 오답 처리되지 않게
    .replace(/\s+/g, ' ')
}

/**
 * 타이핑 채점의 세 등급(v32 오타 허용). 완전 일치가 아니어도 편집거리 1이면
 * "거의 맞음"으로 보고 사용자가 정답/오답을 직접 고르게 한다(자동으로 정답
 * 처리하지 않는다 — 어학처럼 철자 자체가 정답인 경우가 있어서다). 답이 아주
 * 짧으면(NEAR_MISS_MIN_LENGTH 미만) 한 글자 차이가 뜻을 완전히 바꿀 수 있으므로
 * (예: "물"→"불") near를 인정하지 않고 완전 일치만 정답으로 본다.
 */
export type MatchResult = 'correct' | 'near' | 'wrong'

const NEAR_MISS_MIN_LENGTH = 5
const MATCH_RANK: Record<MatchResult, number> = { wrong: 0, near: 1, correct: 2 }

/** 두 문자열 사이의 편집거리(Levenshtein). 삽입·삭제·치환 각 1비용. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let curr = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

function matchAnswer(expected: string, given: string): MatchResult {
  const a = normalize(expected)
  const b = normalize(given)
  if (a === b) return 'correct'
  if (a.length < NEAR_MISS_MIN_LENGTH) return 'wrong'
  return editDistance(a, b) === 1 ? 'near' : 'wrong'
}

/** 여럿 중 최악의 등급으로 접는다 — 빈칸 하나라도 완전히 틀렸으면 전체가 오답이다. */
function worstMatch(results: MatchResult[]): MatchResult {
  return results.reduce((worst, r) => (MATCH_RANK[r] < MATCH_RANK[worst] ? r : worst), 'correct' as MatchResult)
}

export function checkCloze(item: ClozeItem, answers: string[]): MatchResult {
  const blanks = extractBlanks(item.text)
  if (blanks.length !== answers.length) return 'wrong'
  return worstMatch(blanks.map((blank, i) => matchAnswer(blank, answers[i] ?? '')))
}

/** acceptedAnswers 중 가장 나은 결과를 쓴다 — 동의어 중 하나만 완전히 맞아도 정답. */
export function checkShortAnswer(item: ShortAnswerItem, answer: string): MatchResult {
  let best: MatchResult = 'wrong'
  for (const accepted of item.acceptedAnswers) {
    const result = matchAnswer(accepted, answer)
    if (result === 'correct') return 'correct'
    if (MATCH_RANK[result] > MATCH_RANK[best]) best = result
  }
  return best
}
