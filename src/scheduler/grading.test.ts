import { describe, expect, it } from 'vitest'
import { checkCloze, checkMcq, checkShortAnswer, gradeFromCorrectness } from './grading'
import { cloze, mcq, shortAnswer } from '../test/factories'

describe('gradeFromCorrectness', () => {
  it('참이면 good, 거짓이면 again', () => {
    expect(gradeFromCorrectness(true)).toBe('good')
    expect(gradeFromCorrectness(false)).toBe('again')
  })
})

describe('checkMcq', () => {
  it('correctIndex와 일치할 때만 정답', () => {
    const item = mcq({ correctIndex: 2 })
    expect(checkMcq(item, 2)).toBe(true)
    expect(checkMcq(item, 0)).toBe(false)
  })
})

describe('checkCloze', () => {
  it('빈칸 개수·내용이 모두 맞아야 정답(대소문자·앞뒤공백 무시)', () => {
    const item = cloze({ text: '물의 화학식은 {{H2O}}이다' })
    expect(checkCloze(item, ['h2o'])).toBe('correct')
    expect(checkCloze(item, [' H2O '])).toBe('correct')
  })

  it('편집거리 1이면 near, 그보다 멀면 wrong (짧은 정답 제외)', () => {
    // "H2O"는 3자라 NEAR_MISS_MIN_LENGTH(5) 미만 — near 없이 완전 일치만 정답.
    const item = cloze({ text: '물의 화학식은 {{H2O}}이다' })
    expect(checkCloze(item, ['H2X'])).toBe('wrong')
    expect(checkCloze(item, ['CO2'])).toBe('wrong')
  })

  it('긴 정답은 편집거리 1을 near로 인정한다', () => {
    const item = cloze({ text: '{{receive}}' })
    expect(checkCloze(item, ['receive'])).toBe('correct')
    expect(checkCloze(item, ['receiv'])).toBe('near') // 마지막 글자 하나 빠짐(삭제 1회)
    expect(checkCloze(item, ['receivee'])).toBe('near') // 글자 하나 더 붙음(삽입 1회)
  })

  it('문장부호·전각 문자 차이는 무시한다', () => {
    const item = cloze({ text: '{{hello}}' })
    expect(checkCloze(item, ['hello,'])).toBe('correct')
    expect(checkCloze(item, ['ｈｅｌｌｏ'])).toBe('correct') // 전각 → NFKC 정규화
  })

  it('빈칸 개수가 다르면 오답', () => {
    const item = cloze({ text: '{{a}}와 {{b}}' })
    expect(checkCloze(item, ['a'])).toBe('wrong')
  })

  it('여러 빈칸 중 하나라도 완전히 틀리면 전체가 wrong (최악으로 접기)', () => {
    const item = cloze({ text: '{{alpha}} {{beta}}' })
    // alpha는 정답, beta는 완전히 다른 문자열 → wrong이 이겨야 한다
    expect(checkCloze(item, ['alpha', 'zzzzzzzz'])).toBe('wrong')
  })
})

describe('checkShortAnswer', () => {
  it('acceptedAnswers 중 하나와 (정규화 후) 일치하면 정답', () => {
    const item = shortAnswer({ acceptedAnswers: ['물', 'H2O'] })
    expect(checkShortAnswer(item, '물')).toBe('correct')
    expect(checkShortAnswer(item, 'h2o')).toBe('correct')
    expect(checkShortAnswer(item, ' H2O  ')).toBe('correct')
    expect(checkShortAnswer(item, '산소')).toBe('wrong')
  })

  it('공백 여러 칸은 하나로 접어서 비교', () => {
    const item = shortAnswer({ acceptedAnswers: ['foo bar'] })
    expect(checkShortAnswer(item, 'foo   bar')).toBe('correct')
  })

  it('짧은 정답(4자 이하)은 한 글자만 달라도 near 없이 오답', () => {
    const item = shortAnswer({ acceptedAnswers: ['물'] })
    expect(checkShortAnswer(item, '불')).toBe('wrong')
  })

  it('긴 정답에서 편집거리 1짜리 오타는 near', () => {
    const item = shortAnswer({ acceptedAnswers: ['receive'] })
    expect(checkShortAnswer(item, 'receiv')).toBe('near') // 삭제 1회
    expect(checkShortAnswer(item, 'received')).toBe('near') // 삽입 1회
    expect(checkShortAnswer(item, 'receipe')).toBe('near') // 치환 1회(v→p)
    expect(checkShortAnswer(item, 'totally different')).toBe('wrong')
  })

  it('동의어 중 하나만 완전히 맞아도 correct가 near보다 우선한다', () => {
    const item = shortAnswer({ acceptedAnswers: ['receive', 'accept'] })
    expect(checkShortAnswer(item, 'accept')).toBe('correct')
  })
})
