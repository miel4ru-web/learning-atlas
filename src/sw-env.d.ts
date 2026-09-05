// tsconfig.sw.json이 lib: WebWorker를 켜 두면 lib.webworker.d.ts의
// ServiceWorkerGlobalScope/ServiceWorkerGlobalScopeEventMap이 전역으로 들어온다.
// 여기서는 그 두 인터페이스에 선언 병합으로 보강만 한다 — 새로 만들지 않는다.

// injectManifest 전략이 빌드 시 이 자리를 실제 사전 캐시 목록으로 치환한다
// (vite-plugin-pwa 공식 안내와 동일한 최소 타입).
interface ServiceWorkerGlobalScope {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[]
}

// 표준 lib.webworker.d.ts에는 아직 없는 Periodic Background Sync 최소 타입.
interface PeriodicSyncEvent extends ExtendableEvent {
  readonly tag: string
}
interface ServiceWorkerGlobalScopeEventMap {
  periodicsync: PeriodicSyncEvent
}
