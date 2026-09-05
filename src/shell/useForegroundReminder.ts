// Tier 1(필수) — 탭이 열려 있는 동안의 복습 알림. 트리거: (a) 탭이 hidden 될
// 때, (b) visible 상태에서 15분간 입력이 없을 때. 두 경우 모두 "지금 이 순간"
// 기준으로 dueCount를 다시 계산한다 — atlas.now/atlas.dueCount는 reload()
// 시점에 고정돼 있어(AtlasProvider.tsx), 오래 열어둔 탭에서는 자정을 넘겨도
// 갱신되지 않는다. 그런데 알림의 주 시나리오가 정확히 "오래 열어둔 탭"이라,
// 그 값을 그대로 쓰면 어제 날짜로 dedup되거나 새로 만기된 카드를 놓친다.
//
// Tier 2(최선형, 선택) — 알림이 켜지고 권한이 막 허용된 시점에 한 번, Periodic
// Background Sync 등록을 시도한다. 크로미움 계열 + PWA 설치 상태에서만 동작
// 하고, 그 외에는 조용히 no-op이다(sw.ts의 checkAndNotify가 실제 알림을 낸다).
//
// 브라우저 API에 직접 붙는 통합 코드라 unit test는 없다 — 판단 로직 자체는
// core/reminder.ts(순수 함수)에서 테스트한다.

import { useEffect, useRef } from 'react'
import type { AtlasData } from '../core/atlas'
import { computeDueCountFromData } from '../core/dueCount'
import { localDateString, shouldRemindNow, type NotificationPermissionState } from '../core/reminder'
import { getLastRemindedDate, setLastRemindedDate } from './reminderStorage'

const IDLE_MS = 15 * 60 * 1000 // 15분 무활동
const PERIODIC_SYNC_TAG = 'review-reminder'
const PERIODIC_SYNC_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000

// 표준 lib.dom.d.ts에 아직 없는 실험적 API — 여기서만 최소한으로 타입을 준다.
interface PeriodicSyncManager {
  register(tag: string, options: { minInterval: number }): Promise<void>
}
interface ServiceWorkerRegistrationWithPeriodicSync extends ServiceWorkerRegistration {
  periodicSync: PeriodicSyncManager
}

function currentPermission(): NotificationPermissionState {
  return 'Notification' in window ? Notification.permission : 'denied'
}

type ReminderAtlas = Pick<
  AtlasData,
  'loading' | 'items' | 'interactions' | 'kcs' | 'schedulerSettings' | 'studyPrefs'
>

export function useForegroundReminder(atlas: ReminderAtlas): void {
  // 이벤트 리스너는 마운트 시 한 번만 붙이고(재부착 비용을 피하려고), 실제
  // 트리거 시점엔 이 ref로 최신 atlas 값을 읽는다. ref 갱신 자체는 렌더 중이
  // 아니라 별도 effect에서 한다(렌더 중 ref 쓰기는 React가 권장하지 않는다).
  const atlasRef = useRef(atlas)
  useEffect(() => {
    atlasRef.current = atlas
  })

  useEffect(() => {
    if (!('Notification' in window)) return // 미지원 브라우저 — 조용히 아무것도 안 함

    let idleTimer: number | undefined

    function evaluateAndNotify() {
      const { loading, items, interactions, kcs, schedulerSettings, studyPrefs } = atlasRef.current
      if (loading) return
      const notificationsEnabled = studyPrefs?.notificationsEnabled ?? false
      if (!notificationsEnabled) return

      const at = new Date()
      const dueCount = computeDueCountFromData(items, interactions, kcs, schedulerSettings ?? null, at)
      const today = localDateString(at)

      const shouldRemind = shouldRemindNow({
        notificationsEnabled,
        permission: currentPermission(),
        dueCount,
        lastRemindedDate: getLastRemindedDate(),
        today,
      })
      if (!shouldRemind) return

      const notification = new Notification('복습할 카드가 있어요', {
        body: `${dueCount}장 대기 중입니다`,
        tag: 'learning-atlas-due',
        icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
      })
      notification.onclick = () => {
        window.focus()
        notification.close()
      }
      setLastRemindedDate(today)
    }

    function resetIdleTimer() {
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(evaluateAndNotify, IDLE_MS)
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        window.clearTimeout(idleTimer)
        evaluateAndNotify()
      } else {
        resetIdleTimer()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    document.addEventListener('pointerdown', resetIdleTimer)
    document.addEventListener('keydown', resetIdleTimer)
    resetIdleTimer()

    return () => {
      window.clearTimeout(idleTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('pointerdown', resetIdleTimer)
      document.removeEventListener('keydown', resetIdleTimer)
    }
  }, [])

  // Tier 2 등록 — 알림이 켜지고 권한이 granted일 때만 시도한다. 실패(미지원
  // 브라우저, 권한 거부, PWA 미설치 등)는 전부 조용히 무시한다 — 최선형 기능이라
  // 등록이 안 돼도 Tier 1은 그대로 동작한다.
  useEffect(() => {
    const notificationsEnabled = atlas.studyPrefs?.notificationsEnabled ?? false
    if (!notificationsEnabled || currentPermission() !== 'granted') return
    if (!('serviceWorker' in navigator)) return

    let cancelled = false
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.ready
        if (cancelled || !('periodicSync' in registration)) return
        const status = await navigator.permissions.query({
          name: 'periodic-background-sync' as unknown as PermissionName,
        })
        if (cancelled || status.state !== 'granted') return
        await (registration as ServiceWorkerRegistrationWithPeriodicSync).periodicSync.register(
          PERIODIC_SYNC_TAG,
          { minInterval: PERIODIC_SYNC_MIN_INTERVAL_MS },
        )
      } catch {
        // 미지원·거부 — 조용히 무시.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [atlas.studyPrefs?.notificationsEnabled])
}
