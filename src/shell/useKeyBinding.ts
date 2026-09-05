// 키보드 단축키 — 채점·자신감처럼 버튼 클릭이 반복되는 화면에서 마우스 왕복을 줄인다.
// 입력 필드에 포커스가 있을 때는(빈칸·단답형·자기설명·코드 타이핑) 절대 가로채지 않는다 —
// 그게 이 훅의 핵심 안전장치다. bindings는 매 렌더 새 객체로 넘겨도 된다 — ref로 받아
// 리스너를 마운트당 한 번만 붙인다.

import { useEffect, useRef } from 'react'

type KeyMap = Record<string, () => void>

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

/** bindings의 키를 누르면 대응 콜백을 부른다. 입력 중이거나 수정자 키가 눌려 있으면 무시. */
export function useKeyBinding(bindings: KeyMap): void {
  const bindingsRef = useRef(bindings)
  // 렌더 중에는 ref를 건드리지 않는다 — 매 렌더 뒤 이펙트에서 최신 값으로 갱신만 한다.
  useEffect(() => {
    bindingsRef.current = bindings
  })

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      const handler = bindingsRef.current[e.key]
      if (!handler) return
      e.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
