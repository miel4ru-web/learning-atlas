// 앱 셸 — 헤더(제목 + 만기/전체 요약)와 탭 바, 그리고 지금 선택된 화면 하나.
// 상태는 AtlasProvider(core/AtlasProvider.tsx)가 들고, 화면은 views/registry.ts에
// 등록된다. 이 파일은 그 둘을 조립하기만 한다 — 새 단계가 늘어도 여기는 안 바뀐다.

import { AtlasProvider } from './core/AtlasProvider'
import { useAtlas } from './core/atlas'
import { useHashRoute } from './shell/useHashRoute'
import { TabBar } from './shell/TabBar'
import { SideNav } from './shell/SideNav'
import { VIEWS, VIEW_IDS, DEFAULT_VIEW } from './views/registry'
import './App.css'

function Shell() {
  const { loading, dueCount, items, leechItems } = useAtlas()
  const [active, navigate] = useHashRoute(VIEW_IDS, DEFAULT_VIEW)

  if (loading) {
    return (
      <div className="app">
        <main className="shell">
          <p className="muted">불러오는 중…</p>
        </main>
      </div>
    )
  }

  const ActiveView = (VIEWS.find((v) => v.id === active) ?? VIEWS[0]).Component

  return (
    <div className="app">
      <SideNav active={active} onNavigate={navigate} />
      <main className="shell">
        <header className="topbar">
          <h1>Learning Atlas</h1>
          <p className="stat-line">
            만기 <strong>{dueCount}</strong> · 전체 <strong>{items.length}</strong>
            {leechItems.length > 0 && (
              <>
                {' '}
                · 격리 <strong>{leechItems.length}</strong>
              </>
            )}
          </p>
        </header>

        <TabBar active={active} onNavigate={navigate} />

        <div className={`view view-${active}`}>
          <ActiveView />
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AtlasProvider>
      <Shell />
    </AtlasProvider>
  )
}
