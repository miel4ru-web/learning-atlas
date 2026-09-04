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
    expect(checkCloze(item, ['h2o'])).toBe(true)
    expect(checkCloze(item, [' H2O '])).toBe(true)
    expect(checkCloze(item, ['CO2'])).toBe(false)
  })

  it('빈칸 개수가 다르면 오답', () => {
    const item = cloze({ text: '{{a}}와 {{b}}' })
    expect(checkCloze(item, ['a'])).toBe(false)
  })
})

describe('checkShortAnswer', () => {
  it('acceptedAnswers 중 하나와 (정규화 후) 일치하면 정답', () => {
    const item = shortAnswer({ acceptedAnswers: ['물', 'H2O'] })
    expect(checkShortAnswer(item, '물')).toBe(true)
    expect(checkShortAnswer(item, 'h2o')).toBe(true)
    expect(checkShortAnswer(item, ' H2O  ')).toBe(true)
    expect(checkShortAnswer(item, '산소')).toBe(false)
  })

  it('공백 여러 칸은 하나로 접어서 비교', () => {
    const item = shortAnswer({ acceptedAnswers: ['foo bar'] })
    expect(checkShortAnswer(item, 'foo   bar')).toBe(true)
  })
})
