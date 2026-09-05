// "학습" 화면 — Atlas 4.4 세션. "오늘 N분"을 누르면 session.ts가 그 순간의
// 순서를 고정하고(sessionPlan), 카드를 한 장씩 넘긴다. 세션 진행 상태는 이
// 화면의 로컬 상태다 — 채점할 때마다 전역은 reload 되지만 순서는 고정 유지.

import { useMemo, useState } from 'react'
import type {
  Confidence,
  ErrorTag,
  Grade,
  InteractionSignals,
  Item,
  StudySession,
} from '../core/types'
import { useAtlas } from '../core/atlas'
import { useKeyBinding } from '../shell/useKeyBinding'
import { openSession, resumeIndex } from '../core/sessions'
import { buildSession, pickPretestItem } from '../scheduler/session'
import { seedDeck, SEED_DECK_SIZE } from '../core/seedDeck'
import { RespondPanel } from '../activities/RespondPanel'
import { ItemForm } from './ItemForm'

const DEFAULT_BUDGET_MIN = 20
const CONFIDENCE_LABEL: Record<Confidence, string> = { 1: '모르겠다', 2: '애매하다', 3: '확실하다' }

// 새 지식요소라도 평균 이만큼의 카드마다 한 번만 실제로 묻는다(v33) — "KC당 평생 1회"
// 만으로는 새 지식요소가 몰린 세션(예: 콜드스타트, 큰 CSV 임포트 직후)에서 여전히
// 질문이 쏟아진다. 샘플링에서 빠진 카드는 그 KC를 "물어본 적 있음"으로 표시하지
// 않는다 — 나중에 같은 KC의 다른 카드가 다시 후보가 되면 또 기회가 있다.
const CONFIDENCE_SAMPLE_EVERY = 3

/** id에서 결정적으로(같은 id면 항상 같은 결과) 대략 1/everyN 확률의 표본만 통과시킨다. */
function stableSampleIn(id: string, everyN: number): boolean {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return hash % everyN === 0
}

export function StudyView() {
  const atlas = useAtlas()
  const [sessionPlan, setSessionPlan] = useState<Item[] | null>(null)
  const [sessionIndex, setSessionIndex] = useState(0)
  // KC가 없는 카드(그룹핑 대상 아님)용 — 신규 후보로서 아래 샘플링을 그대로 통과해야 묻는다.
  const [confidence, setConfidence] = useState<Confidence | null>(null)
  // 이번 세션에서 KC별로 이미 고른 자신감 값(세션이 끝나면 사라진다 — 평생 이력은
  // historicallyAskedKcIds가 따로 맡는다).
  const [kcConfidence, setKcConfidence] = useState<Map<string, Confidence>>(new Map())
  // groupStartIndex는 "자신감을 마지막으로 새로 고른 sessionIndex" — 화면에는 이 값보다
  // 뒤에 있을 때만(=지금 막 고른 게 아닐 때만) "다시 묻지 않습니다" 안내를 보여준다.
  const [groupStartIndex, setGroupStartIndex] = useState(0)
  const [budgetInput, setBudgetInput] = useState(String(DEFAULT_BUDGET_MIN))
  const [seeding, setSeeding] = useState(false)
  const [pretestItemId, setPretestItemId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  // 세션 중 카드 편집(v32) — 세션 순서는 시작 시점에 고정되지만, 내용은 그때그때
  // 최신으로 보여줘야 편집한 게 바로 반영된다. 아래 itemById가 그 재해석을 담당한다.
  const [editingCard, setEditingCard] = useState(false)

  // 새로고침·탭 이동으로 끊긴 세션(v27). 화면에 세션이 안 떠 있을 때만 물어본다.
  const resumable = sessionPlan === null ? openSession(atlas.sessions) : null

  // "카드" 화면 덱 필터에서 "이 카드로 학습 시작"을 눌렀으면 sessionScopeItemIds가
  // 차 있다 — buildSession의 후보 풀을 그 카드들로만 좁힌다. 세션 편성 로직
  // 자체(만기·신규·선수지식 게이팅 등)는 그대로다: 풀만 미리 걸러서 넘긴다.
  const scope = atlas.sessionScopeItemIds
  const scopedPool = scope ? atlas.items.filter((item) => scope.has(item.id)) : atlas.items

  // 백로그/휴가 모드(Atlas 3.1, v18) — DB에 저장돼 있으면 그대로, 없으면 기본값
  // (무제한·평소대로). CardsView의 KC 목표 파지율 select와 같은 패턴: 로컬
  // 미러 없이 atlas.studyPrefs를 그대로 읽고 바뀔 때마다 바로 저장한다.
  const studyPrefs = atlas.studyPrefs ?? { dailyReviewCap: null, vacationMode: false }
  const [dailyCapInput, setDailyCapInput] = useState(
    studyPrefs.dailyReviewCap != null ? String(studyPrefs.dailyReviewCap) : '',
  )

  function commitDailyCap() {
    const trimmed = dailyCapInput.trim()
    const cap = trimmed === '' ? null : Math.max(0, Math.trunc(Number(trimmed)) || 0)
    setDailyCapInput(cap != null ? String(cap) : '')
    if (cap !== studyPrefs.dailyReviewCap) atlas.saveStudyPrefs({ ...studyPrefs, dailyReviewCap: cap })
  }

  function toggleVacationMode() {
    atlas.saveStudyPrefs({ ...studyPrefs, vacationMode: !studyPrefs.vacationMode })
  }

  // 복습 알림(PWA, v28). Notification.permission은 반응형이 아니라(바뀌어도
  // 리렌더를 유발하지 않는다) 스냅샷을 상태로 들고 있다가 요청 결과로 갱신한다.
  const notificationsSupported = typeof Notification !== 'undefined'
  const [notifPermission, setNotifPermission] = useState(
    notificationsSupported ? Notification.permission : 'denied',
  )

  function toggleNotifications() {
    const turningOn = !studyPrefs.notificationsEnabled
    if (turningOn && notifPermission === 'default') {
      // 유저 제스처(이 클릭) 안에서 동기적으로 호출해야 프롬프트가 뜬다 — await 앞에서 부른다.
      Notification.requestPermission().then((result) => {
        setNotifPermission(result)
        if (result === 'granted') {
          atlas.saveStudyPrefs({ ...studyPrefs, notificationsEnabled: true })
        }
      })
      return
    }
    atlas.saveStudyPrefs({ ...studyPrefs, notificationsEnabled: turningOn })
  }

  // 콜드스타트(6부 함정) — 카드가 하나도 없을 때만 보이는 맛보기 덱. 기존
  // 가져오기 경로(merge)를 그대로 쓰므로 여러 번 눌러도 카드가 불어나지 않는다.
  async function addSeedDeck() {
    setSeeding(true)
    await atlas.importBackup(seedDeck(), 'merge')
    setSeeding(false)
  }

  async function startSession() {
    const minutes = Math.max(1, Number(budgetInput) || DEFAULT_BUDGET_MIN)
    const plan = buildSession(scopedPool, atlas.cardStates, atlas.eloState, atlas.kcs, atlas.now, {
      budgetMinutes: minutes,
      urgentKcIds: atlas.urgentKcIds,
      leechItemIds: atlas.leechItemIds,
      dailyReviewCap: studyPrefs.dailyReviewCap,
      vacationMode: studyPrefs.vacationMode,
    })

    // 사전 테스트(v23)는 세션 맨 앞 한 장. 오늘 할 게 아예 없으면 붙이지 않는다
    // — 빈 세션에 "아직 안 배운 문제"만 덜렁 내미는 건 학습이 아니라 훼방이다.
    // 휴가 모드일 때도 붙이지 않는다(밀린 복습부터 갚는 게 그 모드의 목적).
    const pretest =
      plan.length > 0 && !studyPrefs.vacationMode
        ? pickPretestItem(scopedPool, atlas.cardStates, atlas.eloState, atlas.kcs, atlas.pretestedIds)
        : null

    const full = pretest ? [pretest, ...plan] : plan

    // 새로 시작하기 전에 남아 있던 세션은 닫는다(중간에 창을 닫았던 경우).
    if (resumable) await atlas.endStudySession(resumable.id)

    // 세션 기록(v27) — 이 순서와 예산은 지금 이 순간의 상태에서만 나오는 값이라
    // 로그 재생으로는 복원되지 않는다. 그래서 파생 상태와 달리 저장한다.
    const record = await atlas.startStudySession({
      startedAt: new Date().toISOString(),
      budgetMinutes: minutes,
      policyVersion: atlas.schedulerSettings?.fittedAt ?? 'default',
      plannedItemIds: full.map((item) => item.id),
      pretestItemId: pretest?.id ?? null,
    })

    setSessionId(record.id)
    setSessionPlan(full)
    setPretestItemId(pretest?.id ?? null)
    setSessionIndex(0)
    setConfidence(null)
    setKcConfidence(new Map())
    setGroupStartIndex(0)
    setEditingCard(false)
    atlas.clearSessionScope() // 한 번 쓰고 나면 다음 "오늘 학습 시작"은 다시 전체 풀로.
  }

  /**
   * 중단된 세션 이어서 하기(v27). 계획된 순서를 그대로 되살리고, 어디까지 했는지는
   * 채점 로그에서 계산한다 — 진행 상황을 따로 저장하지 않으니 어긋날 일이 없다.
   * 그 사이 지워진 카드는 빠지므로 계획이 짧아질 수 있다.
   */
  function resumeSession(session: StudySession) {
    const byId = new Map(atlas.items.map((item) => [item.id, item]))
    const plan = session.plannedItemIds
      .map((id) => byId.get(id))
      .filter((item): item is Item => item !== undefined)

    setSessionId(session.id)
    setSessionPlan(plan)
    setPretestItemId(session.pretestItemId)
    const resumeAt = Math.min(resumeIndex(session, atlas.interactions), plan.length)
    setSessionIndex(resumeAt)
    setConfidence(null)
    setKcConfidence(new Map())
    setGroupStartIndex(resumeAt)
    setEditingCard(false)
  }

  async function endSession() {
    if (sessionId) await atlas.endStudySession(sessionId)
    setSessionId(null)
    setSessionPlan(null)
    setSessionIndex(0)
    setConfidence(null)
    setEditingCard(false)
  }

  // sessionPlan은 세션 시작 시점의 스냅샷이라 세션 중 카드를 편집해도 거기엔
  // 반영되지 않는다 — id로 atlas.items를 다시 찾아 항상 최신 내용을 보여준다.
  const itemById = useMemo(() => new Map(atlas.items.map((item) => [item.id, item])), [atlas.items])
  const plannedItem = sessionPlan ? sessionPlan[sessionIndex] : undefined
  const current = plannedItem ? (itemById.get(plannedItem.id) ?? plannedItem) : undefined
  const currentKc = current?.kcId ? atlas.kcById.get(current.kcId) : undefined

  // v33 — 세션당 1회로는 지식요소가 다양한 세션에서 여전히 자주 묻게 되어, "KC당
  // 평생 1회"로 넓힌다: 전체 채점 로그를 훑어 자신감을 한 번이라도 받은 적 있는 KC는
  // 세션이 바뀌어도 다시 묻지 않는다. 아이템이 지워졌으면 그 로그의 KC는 알 수 없어
  // 건너뛴다(다른 파생 상태의 기존 관례와 같다).
  const historicallyAskedKcIds = useMemo(() => {
    const ids = new Set<string>()
    for (const i of atlas.interactions) {
      if (i.confidence == null) continue
      const kcId = itemById.get(i.itemId)?.kcId
      if (kcId) ids.add(kcId)
    }
    return ids
  }, [atlas.interactions, itemById])

  const kcAlreadyKnown =
    current?.kcId != null && (kcConfidence.has(current.kcId) || historicallyAskedKcIds.has(current.kcId))
  // "물어볼 만한 후보"인가 — KC가 없거나(그룹 없음), 있다면 이번 세션·과거 전체
  // 어디서도 아직 안 물어봤을 때. 후보라도 CONFIDENCE_SAMPLE_EVERY 표본만 실제로 묻는다.
  const isConfidenceCandidate = current != null && !kcAlreadyKnown
  const shouldPromptConfidence =
    isConfidenceCandidate && stableSampleIn(current!.id, CONFIDENCE_SAMPLE_EVERY)
  // 실제로 기록할 값 — 이번 세션에 이미 답했다면 그 값, 아니면(과거에 답했거나 이번엔
  // 샘플링에서 빠졌다면) null. 오래된 값을 지금 것처럼 재사용해 캘리브레이션을 왜곡하지 않는다.
  const confidenceToRecord: Confidence | null =
    current?.kcId != null ? kcConfidence.get(current.kcId) ?? null : confidence

  function pickConfidence(value: Confidence) {
    if (current?.kcId != null) {
      setKcConfidence((prev) => new Map(prev).set(current.kcId as string, value))
    } else {
      setConfidence(value)
    }
    setGroupStartIndex(sessionIndex)
  }

  // 자신감 프롬프트가 떠 있을 때만 1~3을 가로챈다 — 답이 이미 정해졌거나(RespondPanel
  // 단계) 이번엔 안 묻기로 했으면 빈 맵을 넘겨 그쪽 단축키(채점 1~4)와 겹치지 않게 한다.
  useKeyBinding(
    current && !editingCard && shouldPromptConfidence
      ? { '1': () => pickConfidence(1), '2': () => pickConfidence(2), '3': () => pickConfidence(3) }
      : {},
  )

  async function handleGraded(
    grade: Grade,
    errorTag: ErrorTag | null,
    signals: InteractionSignals,
  ) {
    if (!current) return
    await atlas.recordInteraction(current.id, grade, confidenceToRecord, errorTag, {
      ...signals,
      pretest: current.id === pretestItemId,
      ...(sessionId ? { sessionId } : {}),
    })
    // KC가 있는 카드는 kcConfidence 맵이 세션 내내 값을 들고 있으니 리셋할 필요가 없다.
    // KC가 없는 카드만 이 로컬 state를 쓰므로 매번 초기화해 다음 카드에서 새로 묻는다.
    setConfidence(null)
    setEditingCard(false)
    setSessionIndex((i) => i + 1)
  }

  return (
    <section className="queue">
      {!sessionPlan ? (
        <div className="session-start">
          {resumable && (
            <div className="resume-note">
              <p className="muted">
                하던 세션이 남아 있습니다 —{' '}
                {resumeIndex(resumable, atlas.interactions)}/{resumable.plannedItemIds.length}장 진행,{' '}
                {new Date(resumable.startedAt).toLocaleString()} 시작
              </p>
              <button className="reveal" onClick={() => resumeSession(resumable)}>
                이어서 하기
              </button>
            </div>
          )}
          {scope && (
            <p className="session-scope-note muted">
              &quot;카드&quot; 필터 결과 {scope.size}장으로 시작합니다.{' '}
              <button type="button" className="reveal" onClick={() => atlas.clearSessionScope()}>
                해제
              </button>
            </p>
          )}
          <label>
            오늘 몇 분 학습할까요?
            <input
              type="number"
              min={1}
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
            />
            분
          </label>

          <div className="study-prefs">
            <label className="vacation-toggle">
              <input type="checkbox" checked={studyPrefs.vacationMode} onChange={toggleVacationMode} />
              휴가 모드 — 신규 카드 도입 중지, 밀린 복습만
            </label>
            <label>
              하루 복습 상한
              <input
                type="number"
                min={0}
                placeholder="무제한"
                value={dailyCapInput}
                onChange={(e) => setDailyCapInput(e.target.value)}
                onBlur={commitDailyCap}
              />
              장
            </label>
            <label className="notifications-toggle">
              <input
                type="checkbox"
                checked={studyPrefs.notificationsEnabled ?? false}
                onChange={toggleNotifications}
                disabled={!notificationsSupported}
              />
              알림 받기 — 만기 카드가 있을 때 브라우저 알림
            </label>
            {notifPermission === 'denied' && (
              <p className="muted">
                브라우저에서 알림이 차단되어 있습니다. 사이트 설정에서 허용으로 바꿔주세요.
              </p>
            )}
            <p className="muted reminder-caveat">
              탭이 열려 있을 때만 확실히 동작합니다. 앱을 완전히 닫은 상태에서의 알림은
              브라우저·기기에 따라 오지 않을 수 있습니다.
            </p>
          </div>

          <button className="start" onClick={startSession} disabled={atlas.items.length === 0}>
            오늘 학습 시작
          </button>
          {atlas.items.length === 0 && (
            <div className="empty-start">
              <p className="muted">먼저 카드를 추가하세요.</p>
              <button className="reveal" onClick={addSeedDeck} disabled={seeding}>
                {seeding ? '넣는 중…' : `예시 덱 넣기 (${SEED_DECK_SIZE}장)`}
              </button>
              <p className="muted seed-note">
                이 앱이 쓰는 학습 원리를 소재로 한 맛보기 덱입니다. 다섯 가지 활동 타입과
                선수지식 연결을 한 번씩 보여줍니다.
              </p>
            </div>
          )}
        </div>
      ) : current ? (
        <div className="card">
          {current.id === pretestItemId && (
            <div className="pretest-note">
              <span className="pretest-badge">사전 테스트</span>
              <p className="muted">
                아직 배우지 않은 내용입니다. 틀려도 기록에 반영되지 않으니 편하게 찍어 보세요 —
                미리 한 번 틀려 보는 것만으로 나중에 배울 때 더 잘 붙습니다.
              </p>
            </div>
          )}
          <div className="card-header">
            {currentKc && <span className="kc-badge">{currentKc.name}</span>}
            <button
              type="button"
              className="reveal edit-current-card"
              onClick={() => setEditingCard((v) => !v)}
            >
              {editingCard ? '편집 취소' : '이 카드 편집'}
            </button>
          </div>
          {editingCard ? (
            <ItemForm key={current.id} kcs={atlas.kcs} initial={current} onDone={() => setEditingCard(false)} />
          ) : shouldPromptConfidence ? (
            <div className="confidence">
              <p className="muted">답을 보기 전에 — 얼마나 자신 있나요?</p>
              <div className="confidence-buttons">
                <button onClick={() => pickConfidence(1)}>모르겠다 (1)</button>
                <button onClick={() => pickConfidence(2)}>애매하다 (2)</button>
                <button onClick={() => pickConfidence(3)}>확실하다 (3)</button>
              </div>
            </div>
          ) : (
            <>
              {current.kcId != null && kcConfidence.has(current.kcId) && sessionIndex > groupStartIndex && (
                <p className="muted confidence-carried">
                  이 지식요소는 이번 세션에서 이미 답변해 다시 묻지 않습니다 (
                  {CONFIDENCE_LABEL[kcConfidence.get(current.kcId) as Confidence]})
                </p>
              )}
              {current.kcId != null &&
                !kcConfidence.has(current.kcId) &&
                historicallyAskedKcIds.has(current.kcId) && (
                  <p className="muted confidence-carried">
                    이 지식요소는 예전에 이미 확인해 이번엔 묻지 않습니다.
                  </p>
                )}
              <RespondPanel key={current.id} item={current} onGraded={handleGraded} />
            </>
          )}
          <p className="session-progress muted">
            {sessionIndex + 1} / {sessionPlan.length}
          </p>
        </div>
      ) : (
        <div className="empty">
          <p>세션 완료.</p>
          <button className="reveal" onClick={endSession}>
            세션 종료
          </button>
        </div>
      )}
    </section>
  )
}
