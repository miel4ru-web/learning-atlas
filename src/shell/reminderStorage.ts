// 복습 알림(v28)의 "오늘 이미 띄웠나" dedup 플래그. 이 앱 최초의 localStorage
// 사용이다 — 기기-로컬 UI 부가 상태일 뿐 학습 데이터가 아니라서, IndexedDB나
// JSON 백업 봉투(core/backup.ts)와는 무관하게 여기 한 곳에 격리해 둔다.
//
// 서비스 워커(sw.ts)는 localStorage에 접근할 수 없다(플랫폼 제약) — 거기서는
// 별도의 작은 IndexedDB로 같은 역할을 한다. 그래서 Tier 1(이 파일)과 Tier 2
// (sw.ts)는 서로 다른 dedup 플래그를 본다: 최악의 경우 하루에 알림이 한 번
// 더/덜 오는 정도이고, 학습 데이터 무결성과는 무관하다.

const LAST_REMINDED_KEY = 'la.reminder.lastNotifiedDate'

export function getLastRemindedDate(): string | null {
  try {
    return localStorage.getItem(LAST_REMINDED_KEY)
  } catch {
    // 프라이빗 모드 등에서 접근이 막혀 있을 수 있다 — 알림을 못 띄우는 것으로
    // 조용히 처리한다(매번 dedup 안 된 걸로 보여도 앱 자체는 멀쩡해야 한다).
    return null
  }
}

export function setLastRemindedDate(date: string): void {
  try {
    localStorage.setItem(LAST_REMINDED_KEY, date)
  } catch {
    // 위와 같은 이유로 조용히 무시.
  }
}
