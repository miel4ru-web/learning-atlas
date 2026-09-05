// "오늘 알림을 띄워야 하는가"의 순수 판단. Notification API·localStorage 접근은
// 전부 호출자(shell/useForegroundReminder.ts, sw.ts) 몫이다 — 여기는 입력을
// 받아 boolean만 돌려주므로 vitest(node 환경)에서 그대로 시험할 수 있다.

export type NotificationPermissionState = 'default' | 'granted' | 'denied'

export interface ReminderDecisionInput {
  /** 사용자가 토글을 켰는가(StudyPrefs.notificationsEnabled). */
  notificationsEnabled: boolean
  /** 브라우저 Notification 권한 — 저장하지 않고 호출자가 그때그때 읽어 넘긴다. */
  permission: NotificationPermissionState
  dueCount: number
  /** 기기-로컬 'YYYY-MM-DD'. 아직 한 번도 안 띄웠으면 null. */
  lastRemindedDate: string | null
  /** 'YYYY-MM-DD'. 호출자가 지금 시각으로 계산해 넘긴다(localDateString). */
  today: string
}

export function shouldRemindNow(input: ReminderDecisionInput): boolean {
  return (
    input.notificationsEnabled &&
    input.permission === 'granted' &&
    input.dueCount > 0 &&
    input.lastRemindedDate !== input.today
  )
}

/**
 * 기기-로컬 자정 기준 날짜 문자열('YYYY-MM-DD'). UTC로 계산하면 자정 근처에서
 * 하루가 밀린다 — core/format.ts의 startOfDay가 같은 이유로 로컬 기준을 쓴다
 * (그건 비공개 함수라 여기서 따로 구현한다).
 */
export function localDateString(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
