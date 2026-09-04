import { describe, expect, it } from 'vitest'
import { formatDue } from './format'

// 로컬 시각 성분으로 Date를 만들어 startOfDay(로컬 자정) 계산이 TZ와 무관하게
// 결정적이 되게 한다. format.ts 상단 주석의 자정 경계 시나리오를 그대로 검증한다.
const at = (y: number, mon: number, d: number, h = 0, min = 0, s = 0) =>
  new Date(y, mon - 1, d, h, min, s)

describe('formatDue', () => {
  it('이미 지난 만기는 "지금"', () => {
    expect(formatDue(at(2026, 1, 1, 10), at(2026, 1, 1, 12))).toBe('지금')
  })

  it('같은 날 안: 분 / 시간 단위', () => {
    expect(formatDue(at(2026, 1, 1, 10, 30), at(2026, 1, 1, 10, 0))).toBe('30분 후')
    expect(formatDue(at(2026, 1, 1, 12, 0), at(2026, 1, 1, 9, 0))).toBe('3시간 후')
  })

  it('1분 미만이면 "곧"', () => {
    expect(formatDue(at(2026, 1, 1, 10, 0, 20), at(2026, 1, 1, 10, 0, 0))).toBe('곧')
  })

  it('자정을 넘기면 20분 뒤여도 "내일"', () => {
    expect(formatDue(at(2026, 1, 2, 0, 10), at(2026, 1, 1, 23, 50))).toBe('내일')
  })

  it('23시간 뒤여도 달력상 다음 날이면 "내일"(ms 반올림으로 "1일 후"가 되지 않음)', () => {
    expect(formatDue(at(2026, 1, 2, 8, 0), at(2026, 1, 1, 9, 0))).toBe('내일')
  })

  it('이틀 이상은 "N일 후"', () => {
    expect(formatDue(at(2026, 1, 4, 10), at(2026, 1, 1, 10))).toBe('3일 후')
  })
})
