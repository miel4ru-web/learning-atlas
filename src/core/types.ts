// 4부 도메인 모델의 v0+v1+v2 부분 집합. Item · Interaction · KnowledgeComponent
// 세 가지만 영속화한다. CardState(FSRS)와 EloState(숙달도)는 저장하지 않고
// Interaction 로그를 재생해 매번 도출한다 — Atlas 4.2 "이벤트 소싱" 그대로:
// 로그가 유일한 진실의 원천이고, 파생 상태는 언제든 버리고 다시 계산할 수 있다.

export type Grade = 'again' | 'hard' | 'good' | 'easy'

/** 자신감 입력 — Atlas 4.5 메타인지 레이어. 응답 전(정답 공개 전)에 받는다. */
export type Confidence = 1 | 2 | 3 // 1=모르겠다, 2=애매하다, 3=확실하다

/**
 * 오답 원인 분류(Atlas 2부 ERR). again으로 채점될 때만 선택(건너뛰기 가능).
 * concept는 session.ts의 재출제 가중치에 실제로 쓰인다(같은 KC를 앞당김).
 */
export type ErrorTag = 'concept' | 'procedure' | 'carelessness' | 'time'

/** 학습 대상의 최소 단위(Atlas 4.1). 선수지식 DAG는 prereqIds로 표현한다. */
export interface KnowledgeComponent {
  id: string
  name: string
  prereqIds: string[] // 이 KC를 "준비된" 상태로 보려면 먼저 숙달해야 하는 KC들
  createdAt: string
  /**
   * 이 KC에 속한 카드의 목표 파지율(Atlas 5부 "매트릭스"). 없으면 전역 기본값
   * (재적합 설정의 requestRetention, 없으면 0.90)을 쓴다. 높일수록 간격이 짧아져
   * 복습이 잦아진다 — 시험 임박 과목은 0.95, 교양은 0.85 식으로 카드가 아니라
   * 개념 단위로 조절한다. (v5 데이터 호환을 위해 optional.)
   */
  requestRetention?: number
}

interface ItemBase {
  id: string
  kcId: string | null // v1 단순화: 카드당 KC 하나(Atlas의 item_kc 다대다·가중치는 필요해지면 v3에서)
  createdAt: string // ISO-8601
}

/** v0의 활동 타입. 정답을 자기 채점(4단계)한다 — 그 판단 자체가 학습 신호다. */
export interface FlashcardItem extends ItemBase {
  type: 'flashcard'
  front: string
  back: string
}

/** 빈칸 채우기. `{{정답}}` 구간이 빈칸이 된다. 객관적으로 자동 채점된다. */
export interface ClozeItem extends ItemBase {
  type: 'cloze'
  text: string // 예: "물의 화학식은 {{H2O}}이다"
}

/** 4지선다. 객관적으로 자동 채점된다. */
export interface McqItem extends ItemBase {
  type: 'mcq'
  prompt: string
  options: [string, string, string, string]
  correctIndex: 0 | 1 | 2 | 3
  /**
   * 오답 선택지별 오개념 라벨(Atlas 3.4 "오답 선택지 자체에 오개념 태그를 미리
   * 붙여 둔다"). options와 길이·순서가 같고, 라벨을 안 단 선택지는 null.
   * 정답 위치의 값은 쓰지 않는다.
   *
   * 로그에는 따로 저장하지 않는다 — v19부터 "몇 번을 골랐는지"(selectedIndex)가
   * 남으므로, 그 인덱스로 이 표를 찾아보면 된다. 파생 상태를 저장하지 않는다는
   * 원칙 그대로다. 대신 나중에 선택지 순서를 바꿔 편집하면 과거 로그의 해석도
   * 같이 바뀐다(카드 내용을 고치면 과거 채점의 맥락도 달라지는 건 이 앱의 기존
   * 성질과 같다).
   */
  distractorTags?: (string | null)[]
}

/**
 * 단답형(v17). cloze처럼 자동 채점되지만 문장 속 빈칸이 아니라 완결된 질문에
 * 직접 타이핑한다 — 회상을 문장 구조 힌트 없이 순수하게 시험한다는 점이 cloze와
 * 다르다. acceptedAnswers는 동의어·다른 표기(예: "물"/"H2O")를 허용하려고 여럿
 * 둘 수 있다 — grading.ts의 checkShortAnswer가 그중 하나와만 일치해도 정답 처리.
 */
export interface ShortAnswerItem extends ItemBase {
  type: 'short'
  prompt: string
  acceptedAnswers: string[]
}

export interface CodeTest {
  args: unknown[] // JSON 직렬화 가능한 인자
  expected: unknown
}

/** 코드 실행 채점(Atlas DRL). `solve(...)` 함수를 정의하게 하고 테스트로 검증한다. */
export interface CodeItem extends ItemBase {
  type: 'code'
  prompt: string
  starterCode: string
  tests: CodeTest[]
}

/**
 * 자기 설명 / 정교화 질문(v24). Dunlosky 표의 중간 등급 두 기법 — "왜 그런가"를
 * 스스로 답하게 하고(정교화 질문), 풀이를 자기 말로 설명하게 한다(자기 설명).
 *
 * 채점은 기계가 못 한다. 문서 3.5는 서술형 루브릭 채점을 LLM 보류 트랙에 두면서
 * "지금 대신" 쓸 방법으로 **모범 답안 대조 자기 채점**을 지정했다 — 그게 이 타입이다.
 * keyPoints는 그 자기 채점이 후해지지 않게 "무엇을 짚었어야 하는지"를 같이 보여주는
 * 체크리스트다(3.5가 경고한 자기 채점의 주된 실패 모드가 후한 채점이다).
 */
export interface FreeTextItem extends ItemBase {
  type: 'free_text'
  prompt: string
  modelAnswer: string
  keyPoints?: string[]
}

export type Item = FlashcardItem | ClozeItem | McqItem | CodeItem | ShortAnswerItem | FreeTextItem
export type ItemType = Item['type']

// 일반 Omit<Item,K>는 유니온을 먼저 keyof로 뭉개버려서 flashcard의 front,
// mcq의 options 같은 타입별 필드가 전부 사라진다. `T extends any ? … : never`로
// 유니온을 분배한 뒤 각 멤버에 Omit을 적용해야 필드가 살아남는다.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** db.addItem()의 입력 타입 — 타입별 필드는 유지한 채 id·createdAt만 뺀다. */
export type NewItem = DistributiveOmit<Item, 'id' | 'createdAt'>

/** 실제로 일어난 채점 사건 하나. append-only — 절대 수정·삭제하지 않는다. */
export interface Interaction {
  id: string
  itemId: string
  ts: string // ISO-8601, 채점이 일어난 시각
  grade: Grade
  confidence: Confidence | null // 응답 전 자신감. v0 데이터 호환을 위해 null 허용.
  errorTag: ErrorTag | null // again일 때만 값이 있을 수 있다. v1 데이터 호환을 위해 null 허용.

  // ---- v19 부가 신호(Atlas 4.7 스키마의 latency_ms·response·policy_version) ----
  // 전부 optional이다: v18까지의 로그에는 없고, 앞으로도 활동 타입에 따라 있을 수도
  // 없을 수도 있다(플래시카드는 입력이 없으니 response가 없다). 읽는 쪽은 항상
  // "없을 수 있다"를 전제로 다룬다.
  //
  // 왜 지금 남기기 시작하는가: 파생 상태는 로그만 있으면 언제든 다시 만들 수 있지만,
  // 로그에 안 남긴 신호는 소급 복구가 불가능하다. 지금 쓰는 곳이 없어도 쌓아 둬야
  // 나중에 5부(기능 숙달형 Elo = 정확도 × 소요 시간)·3.4(오답 패턴 분류)·
  // 3.6(파라미터 교체 전후 비교)이 성립한다.

  /** 문항이 화면에 뜬 뒤 채점까지 걸린 시간(ms). 자신감 입력 단계는 포함하지 않는다. */
  latencyMs?: number
  /** 사용자가 실제로 낸 응답 원문. 빈칸은 ' | '로 이어 붙이고, 코드는 제출한 소스 전체. */
  response?: string
  /** 4지선다에서 고른 선택지 인덱스(정답이든 오답이든). 3.4 오개념 태깅의 재료. */
  selectedIndex?: number
  /** 채점 당시 활성 스케줄러 파라미터 식별자 — 재적합 설정의 fittedAt, 기본값이면 'default'. */
  policyVersion?: string
  /** 어느 학습 세션에서 나온 채점인가(v27). 세션 밖에서 채점될 일은 아직 없지만 optional이다. */
  sessionId?: string
  /**
   * 사전 테스트(Atlas 1부 "배우기 전에 틀려 보기", v23)로 낸 문항이었는가.
   * true면 로그에는 남되 파생 학습 상태(FSRS·Elo·캘리브레이션·문항 품질)에서는
   * 빠진다 — 아직 안 배운 걸 물어봤으니 틀린 게 카드나 학습자 탓이 아니다.
   * core/interactions.ts의 isScored()가 이 구분을 한곳에서 담당한다.
   */
  pretest?: boolean
}

/**
 * 채점 한 건에 딸린 부가 신호(위 Interaction의 v19 필드들 중 활동 UI가 만들어 주는 것).
 * 활동 타입마다 낼 수 있는 신호가 달라 전부 optional이다.
 */
export interface InteractionSignals {
  latencyMs?: number
  response?: string
  selectedIndex?: number
  pretest?: boolean
  sessionId?: string
}

/**
 * 한 번의 학습 세션(Atlas 4.7 `session(id, started_at, budget_min, policy_version)`).
 *
 * 이건 파생 상태가 아니라 사건 기록이라 저장한다 — "그때 무엇을 내주기로 했는가"는
 * 로그를 재생해도 복원되지 않는다(그 순간의 만기·숙달도·예산이 다 지나갔다).
 * 덕분에 두 가지가 된다: 새로고침해도 하던 세션을 이어서 하기, 그리고 "20분을
 * 달라 했는데 실제로 몇 장을 했나"를 나중에 보기(3.1 부하 평준화 튜닝의 근거).
 *
 * 진행 상황(어디까지 했나)은 여기 저장하지 않는다. 그건 채점 로그에서 나온다 —
 * sessionId가 붙은 Interaction을 보면 되므로, 따로 들고 있다가 어긋날 여지를 만들지 않는다.
 */
export interface StudySession {
  id: string
  startedAt: string // ISO-8601
  /** 끝낸 시각. null이면 아직 진행 중(이어서 하기 대상). */
  endedAt: string | null
  budgetMinutes: number
  /** 시작 당시 활성 스케줄러 파라미터 식별자(Interaction.policyVersion과 같은 값). */
  policyVersion: string
  /** 시작할 때 고정한 카드 순서(4.4 "그 순간의 순서를 고정한다"). */
  plannedItemIds: string[]
  /** 맨 앞에 붙인 사전 테스트 카드(v23). 없으면 null. */
  pretestItemId: string | null
}

/** Interaction 로그를 재생해 얻는 FSRS 파생 상태. DB에 저장하지 않는다. */
export interface CardState {
  itemId: string
  due: Date
  stability: number
  difficulty: number
  reps: number
  lapses: number
  state: 'new' | 'learning' | 'review' | 'relearning'
  lastReview: Date | null
}

/** Interaction 로그를 재생해 얻는 Elo 파생 상태(Atlas 3.2). DB에 저장하지 않는다. */
export interface EloState {
  itemDifficulty: Map<string, number> // itemId → b
  kcMastery: Map<string, number> // kcId → theta
}

/**
 * 개인 로그로 재적합한 FSRS 파라미터(Atlas 3부·4부 Policy). 이것만 저장하고
 * CardState는 저장하지 않는다 — 스케줄러를 이걸로 바꿔 끼우면 과거 로그
 * 전체가 새 파라미터로 재계산된다(Atlas 4.2). 저장된 게 없으면 FSRS-6
 * 기본값(request_retention=0.9, default_w)을 쓴다.
 */
export interface SchedulerSettings {
  w: number[]
  requestRetention: number
  fittedAt: string
  testLossBefore: number
  testLossAfter: number
}

/**
 * 백로그·휴가 모드 설정(Atlas 3.1, v18). SchedulerSettings와 달리 FSRS
 * 파라미터가 아니라 세션 편성 정책이라 별도 레코드로 둔다(단일 레코드, 선택
 * — 없으면 무제한/평소대로).
 */
export interface StudyPrefs {
  /** 정렬된 만기 복습 후보 중 오늘 세션에 넣을 상한. null이면 무제한. */
  dailyReviewCap: number | null
  /** true면 신규(미채점) 카드를 세션 후보에서 뺀다 — 밀린 복습부터 갚는다. */
  vacationMode: boolean
}
