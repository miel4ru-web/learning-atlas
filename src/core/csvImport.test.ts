import { describe, expect, it } from 'vitest'
import { buildCsvImport, parseCsvRows } from './csvImport'
import { kc } from '../test/factories'

// id·시각을 고정해 결과를 예측 가능하게 만든다(실제로는 crypto.randomUUID/now).
let seq = 0
const opts = {
  newId: () => `gen-${++seq}`,
  now: () => '2026-01-01T00:00:00.000Z',
}
function build(text: string, kcs = [] as ReturnType<typeof kc>[]) {
  seq = 0
  return buildCsvImport(text, kcs, opts)
}

describe('parseCsvRows', () => {
  it('따옴표 안의 쉼표와 줄바꿈을 값으로 다룬다', () => {
    const rows = parseCsvRows('a,"b,c","d\ne"\n')
    expect(rows).toEqual([['a', 'b,c', 'd\ne']])
  })

  it('이중 따옴표는 따옴표 한 개로 푼다', () => {
    expect(parseCsvRows('"그는 ""안녕""이라 했다"')).toEqual([['그는 "안녕"이라 했다']])
  })

  it('CRLF와 BOM을 흡수한다 — 엑셀에서 나온 파일이 이렇다', () => {
    const rows = parseCsvRows('﻿front,back\r\n앞,뒤\r\n')
    expect(rows).toEqual([
      ['front', 'back'],
      ['앞', '뒤'],
    ])
  })

  it('마지막 줄에 줄바꿈이 없어도 읽는다', () => {
    expect(parseCsvRows('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('buildCsvImport', () => {
  it('가장 단순한 형태(앞면·뒷면)를 플래시카드로 읽는다', () => {
    const result = build('front,back\n인출 연습이란?,기억에서 꺼내 보는 것\n')
    expect(result.errors).toEqual([])
    expect(result.totalRows).toBe(1)
    expect(result.items).toEqual([
      {
        id: 'gen-1',
        type: 'flashcard',
        kcId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        front: '인출 연습이란?',
        back: '기억에서 꺼내 보는 것',
      },
    ])
  })

  it('한국어 열 이름도 받는다', () => {
    const result = build('앞면,뒷면\n질문,답\n')
    expect(result.errors).toEqual([])
    expect(result.items[0]).toMatchObject({ type: 'flashcard', front: '질문', back: '답' })
  })

  it('type 열이 없으면 내용으로 타입을 추론한다', () => {
    const result = build(
      'front,back,text,prompt,answers\n앞,뒤,,,\n,,물은 {{H2O}}이다,,\n,,,물의 화학식은?,물|H2O\n',
    )
    expect(result.errors).toEqual([])
    expect(result.items.map((i) => i.type)).toEqual(['flashcard', 'cloze', 'short'])
    const short = result.items[2]
    if (short.type !== 'short') throw new Error('expected short')
    expect(short.acceptedAnswers).toEqual(['물', 'H2O'])
  })

  it('type 열을 명시하면 그걸 따른다(한국어 표기 포함)', () => {
    const result = build('type,front,back\n플래시카드,앞,뒤\n')
    expect(result.items[0].type).toBe('flashcard')
  })

  it('이미 있는 분류는 이름으로 찾아 붙이고, 없으면 새로 만든다', () => {
    const existing = kc({ id: 'kc-known', name: '학습 원리' })
    const result = build('front,back,kc\n앞1,뒤1,학습 원리\n앞2,뒤2,새 분류\n앞3,뒤3,새 분류\n', [
      existing,
    ])
    expect(result.errors).toEqual([])
    expect(result.items[0].kcId).toBe('kc-known')
    // 파일 안에서 같은 이름은 하나로 묶인다
    expect(result.newKcs).toHaveLength(1)
    expect(result.newKcs[0].name).toBe('새 분류')
    expect(result.items[1].kcId).toBe(result.newKcs[0].id)
    expect(result.items[2].kcId).toBe(result.newKcs[0].id)
  })

  it('분류 이름은 대소문자·앞뒤 공백을 무시하고 맞춘다', () => {
    const existing = kc({ id: 'kc-1', name: 'Biology' })
    const result = build('front,back,kc\n앞,뒤,  biology \n', [existing])
    expect(result.items[0].kcId).toBe('kc-1')
    expect(result.newKcs).toEqual([])
  })

  it('잘못된 줄만 오류로 보고하고 나머지는 살린다', () => {
    const result = build('front,back\n앞1,뒤1\n앞만있음,\n앞2,뒤2\n')
    expect(result.items).toHaveLength(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].line).toBe(3) // 헤더가 1줄
    expect(result.totalRows).toBe(3)
  })

  it('빈칸 카드에 {{}}가 없으면 오류', () => {
    const result = build('type,text\n빈칸,빈칸이 없는 문장\n')
    expect(result.items).toEqual([])
    expect(result.errors[0].message).toContain('{{정답}}')
  })

  it('빈 줄은 오류가 아니라 그냥 건너뛴다', () => {
    const result = build('front,back\n앞,뒤\n\n,\n')
    expect(result.items).toHaveLength(1)
    expect(result.errors).toEqual([])
    expect(result.totalRows).toBe(1)
  })

  it('모르는 타입은 그 줄만 오류', () => {
    const result = build('type,front,back\n노래,앞,뒤\n')
    expect(result.errors[0].message).toContain('모르는 타입')
  })

  it('헤더를 못 알아보면 파일 전체를 거부하고 이유를 알려준다', () => {
    const result = build('컬럼1,컬럼2\n값1,값2\n')
    expect(result.items).toEqual([])
    expect(result.errors[0].line).toBe(1)
    expect(result.errors[0].message).toContain('헤더')
  })

  it('빈 파일', () => {
    expect(build('').errors[0].message).toContain('빈 파일')
  })
})
