import { describe, expect, it } from 'vitest'
import { base64ToUtf8, utf8ToBase64 } from './githubSync'

describe('utf8ToBase64 / base64ToUtf8', () => {
  it('한글을 포함한 문자열이 왕복된다', () => {
    const text = '{"items":[{"front":"인출 연습이란?"}]}'
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text)
  })

  it('GitHub 응답처럼 줄바꿈이 섞인 base64도 디코딩된다', () => {
    const text = 'hello world'
    const withNewlines = utf8ToBase64(text).replace(/(.{4})/g, '$1\n')
    expect(base64ToUtf8(withNewlines)).toBe(text)
  })

  it('빈 문자열도 처리한다', () => {
    expect(base64ToUtf8(utf8ToBase64(''))).toBe('')
  })

  it('32KB 청크 경계를 넘는 긴 문자열도 안 깨진다', () => {
    const text = '가'.repeat(20000) // UTF-8로 3바이트씩 — 청크 크기(32KB) 경계를 넘는다
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text)
  })
})
