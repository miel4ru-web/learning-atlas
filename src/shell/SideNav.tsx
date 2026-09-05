// 데스크톱(≥900px) 사이드바 네비. 좁은 화면에서는 CSS로 숨기고 TabBar가 대신
// 뜬다 — 둘 다 VIEWS(views/registry.ts) 하나만 읽으므로, 새 화면을 등록하면
// 두 네비에 동시에 나타난다.

import { VIEWS } from '../views/registry'

interface Props {
  active: string
  onNavigate: (id: string) => void
}

export function SideNav({ active, onNavigate }: Props) {
  return (
    <nav className="sidenav" aria-label="주요 화면">
      <div className="sidenav-inner">
        <div className="sidenav-brand">Learning Atlas</div>
        <ul className="sidenav-list">
          {VIEWS.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className={v.id === active ? 'sidenav-item active' : 'sidenav-item'}
                aria-current={v.id === active ? 'page' : undefined}
                onClick={() => onNavigate(v.id)}
              >
                {v.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
