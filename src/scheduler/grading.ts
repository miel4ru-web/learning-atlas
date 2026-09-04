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
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function checkCloze(item: ClozeItem, answers: string[]): boolean {
  const blanks = extractBlanks(item.text)
  if (blanks.length !== answers.length) return false
  return blanks.every((blank, i) => normalize(blank) === normalize(answers[i] ?? ''))
}

/** acceptedAnswers 중 하나와만 (정규화 후) 일치해도 정답 — 동의어·다른 표기 허용. */
export function checkShortAnswer(item: ShortAnswerItem, answer: string): boolean {
  const given = normalize(answer)
  return item.acceptedAnswers.some((a) => normalize(a) === given)
}
