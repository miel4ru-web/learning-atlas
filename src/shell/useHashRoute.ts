// 라우터 라이브러리 없이 location.hash 하나로 탭 상태를 유지한다.
// #diagnostics 처럼 URL에 남으므로 새로고침·뒤로가기·북마크가 그대로 먹는다.
// validIds/fallback은 views/registry.ts에서 온 모듈 상수라 재구독이 필요 없다.

import { useEffect, useState } from 'react'

export function useHashRoute(
  validIds: readonly string[],
  fallback: string,
): readonly [string, (id: string) => void] {
  const resolve = () => {
    const id = window.location.hash.slice(1)
    return validIds.includes(id) ? id : fallback
  }

  const [active, setActive] = useState(resolve)

  useEffect(() => {
    // validIds/fallback은 모듈 상수라 마운트 시 한 번만 구독하면 된다.
    const onChange = () => {
      const id = window.location.hash.slice(1)
      setActive(validIds.includes(id) ? id : fallback)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [validIds, fallback])

  const navigate = (id: string) => {
    window.location.hash = id
  }

  return [active, navigate] as const
}
