// PWA 서비스 워커(v28) — 앱 셸 오프라인 캐싱 + Tier 2(최선형) 백그라운드 복습
// 알림. injectManifest 전략이라 precache 호출은 우리가 직접 쓴다(vite.config.ts
// 참고). db.ts·dueCount.ts·reminder.ts는 DOM에 의존하지 않아 여기서도 그대로
// import해 쓴다 — 만기 판정 규칙을 페이지와 중복 구현하지 않는다.
//
// Tier 2는 크로미움 계열 + PWA 설치 상태에서만, 브라우저가 고른 시각에
// 실행되는 최선형 기능이다(타이밍 보장 없음). 지원하지 않는 브라우저에서는
// periodicsync 자체가 안 붙으니 이 파일의 나머지는 조용히 아무 일도 안 한다.

import { openDB } from 'idb'
import { precacheAndRoute } from 'workbox-precaching'
import { getAllInteractions, getAllItems, getAllKCs, getSchedulerSettings, getStudyPrefs } from './core/db'
import { computeDueCountFromData } from './core/dueCount'
import { localDateString, shouldRemindNow } from './core/reminder'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

// registerType:'prompt'(vite.config.ts) — 배너의 "새로고침" 버튼이 이 메시지를
// 보낸다. 이걸 받아 skipWaiting 해야 대기 중인 새 워커가 실제로 활성화된다.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'review-reminder') event.waitUntil(checkAndNotify())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus()
      return self.clients.openWindow('/')
    }),
  )
})

// ---- Tier 2 dedup 저장소 ----
// 서비스 워커는 localStorage에 접근할 수 없다(플랫폼 제약) — Tier 1
// (shell/reminderStorage.ts)과는 별도로, learning-atlas 메인 DB(core/db.ts의
// DB_VERSION·백업 범위)와 완전히 무관한 아주 작은 전용 IndexedDB에 dedup
// 날짜만 저장한다. 두 Tier가 서로 다른 플래그를 보게 되지만, 최악의 경우
// 하루에 알림이 한 번 더/덜 오는 정도이고 학습 데이터 무결성과는 무관하다.

const REMINDER_DB_NAME = 'learning-atlas-reminder'
const REMINDER_STORE = 'state'
const LAST_NOTIFIED_KEY = 'lastNotifiedDate'

function getReminderDB() {
  return openDB(REMINDER_DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(REMINDER_STORE)
    },
  })
}

async function getSwLastNotifiedDate(): Promise<string | null> {
  const db = await getReminderDB()
  const v = await db.get(REMINDER_STORE, LAST_NOTIFIED_KEY)
  return typeof v === 'string' ? v : null
}

async function setSwLastNotifiedDate(date: string): Promise<void> {
  const db = await getReminderDB()
  await db.put(REMINDER_STORE, date, LAST_NOTIFIED_KEY)
}

async function checkAndNotify(): Promise<void> {
  const prefs = await getStudyPrefs()
  if (!prefs?.notificationsEnabled) return // 그 사이 껐으면 존중한다.

  const [items, interactions, kcs, schedulerSettings] = await Promise.all([
    getAllItems(),
    getAllInteractions(),
    getAllKCs(),
    getSchedulerSettings(),
  ])

  const at = new Date()
  const dueCount = computeDueCountFromData(items, interactions, kcs, schedulerSettings ?? null, at)
  const today = localDateString(at)
  const lastRemindedDate = await getSwLastNotifiedDate()

  // 서비스 워커 전역에는 Notification 생성자·permission이 노출되지 않는다
  // (showNotification만 쓸 수 있다) — periodicsync가 애초에 붙었다는 것 자체가
  // 브라우저가 알림 권한을 이미 확인했다는 뜻이라 'granted'로 취급한다.
  const shouldRemind = shouldRemindNow({
    notificationsEnabled: true,
    permission: 'granted',
    dueCount,
    lastRemindedDate,
    today,
  })
  if (!shouldRemind) return

  await self.registration.showNotification('복습할 카드가 있어요', {
    body: `${dueCount}장 대기 중입니다`,
    tag: 'learning-atlas-due',
    icon: '/icons/icon-192.png',
  })
  await setSwLastNotifiedDate(today)
}
