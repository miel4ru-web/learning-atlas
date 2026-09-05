// PWA 새 버전 배너(v28). vite.config.ts에서 registerType:'prompt'로 뒀다 —
// 새 서비스워커가 준비돼도 자동으로 활성화·새로고침하지 않는다(학습 세션
// 도중 예고 없이 리로드되는 걸 피하려는 선택, 사용자 확정). 대신 여기서
// 작은 배너로 물어보고, 누르면 updateServiceWorker(true)가 새 워커에
// SKIP_WAITING을 보내 활성화한 뒤 페이지를 새로고침한다(sw.ts의 message
// 리스너가 그 신호를 받는다).

import { useRegisterSW } from 'virtual:pwa-register/react'

export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="update-banner">
      <span>새 버전이 준비됐습니다.</span>
      <button type="button" onClick={() => updateServiceWorker(true)}>
        새로고침
      </button>
    </div>
  )
}
