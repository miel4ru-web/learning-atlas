// 상단 탭 바 — VIEWS(views/registry.ts)를 그대로 렌더한다. 탭이 늘어나면
// 가로 스크롤로 흡수한다(App.css .tabbar). 활성 탭은 색과 aria-current로 표시.

import { VIEWS } from '../views/registry'

interface Props {
  active: string
  onNavigate: (id: string) => void
}

export function TabBar({ active, onNavigate }: Props) {
  return (
    <nav className="tabbar" aria-label="주요 화면">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          className={v.id === active ? 'tab active' : 'tab'}
          aria-current={v.id === active ? 'page' : undefined}
          onClick={() => onNavigate(v.id)}
        >
          {v.label}
        </button>
      ))}
    </nav>
  )
}
