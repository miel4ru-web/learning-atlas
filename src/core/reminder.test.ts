import { describe, expect, it } from 'vitest'
import { localDateString, shouldRemindNow } from './reminder'

describe('shouldRemindNow', () => {
  const base = {
    notificationsEnabled: true,
    permission: 'granted' as const,
    dueCount: 3,
    lastRemindedDate: null,
    today: '2026-09-05',
  }

  it('알림이 꺼져 있으면 안 띄운다', () => {
    expect(shouldRemindNow({ ...base, notificationsEnabled: false })).toBe(false)
  })

  it('권한이 없으면 안 띄운다', () => {
    expect(shouldRemindNow({ ...base, permission: 'default' })).toBe(false)
    expect(shouldRemindNow({ ...base, permission: 'denied' })).toBe(false)
  })

  it('만기 카드가 없으면 안 띄운다', () => {
    expect(shouldRemindNow({ ...base, dueCount: 0 })).toBe(false)
  })

  it('오늘 이미 띄웠으면 다시 안 띄운다', () => {
    expect(shouldRemindNow({ ...base, lastRemindedDate: '2026-09-05' })).toBe(false)
  })

  it('모든 조건을 만족하면 띄운다', () => {
    expect(shouldRemindNow(base)).toBe(true)
  })

  it('어제 알림 기록이 있어도 날짜가 바뀌었으면 오늘 다시 띄운다', () => {
    expect(shouldRemindNow({ ...base, lastRemindedDate: '2026-09-04' })).toBe(true)
  })
})

describe('localDateString', () => {
  it('자정 직전과 직후를 다른 달력 날짜로 본다(로컬 기준)', () => {
    const beforeMidnight = new Date(2026, 8, 5, 23, 59, 0) // 로컬 시각 9/5 23:59
    const afterMidnight = new Date(2026, 8, 6, 0, 1, 0) // 로컬 시각 9/6 00:01
    expect(localDateString(beforeMidnight)).toBe('2026-09-05')
    expect(localDateString(afterMidnight)).toBe('2026-09-06')
  })

  it('한 자리 월·일에 0을 채운다', () => {
    expect(localDateString(new Date(2026, 0, 3))).toBe('2026-01-03')
  })
})
