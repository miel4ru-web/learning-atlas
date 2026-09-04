# Learning Atlas

브라우저에서 도는 로컬 우선 간격 반복 학습 도구. 데이터는 전부 이 브라우저의
IndexedDB에만 저장된다(서버 없음). React 19 + TypeScript + Vite.

## 설계 원칙 — 이벤트 소싱

영속화하는 건 세 가지뿐이다.

| 스토어 | 내용 |
| --- | --- |
| `items` | 카드 정의 (플래시카드 / 빈칸 / 4지선다 / 코드) |
| `kcs` | 지식 요소(Knowledge Component)와 선수지식 DAG |
| `interactions` | 채점 로그 — **append-only, 수정·삭제 안 함** |
| `settings` | 개인 로그로 재적합한 FSRS 파라미터 (단일 레코드, 선택) |

FSRS 카드 상태, Elo 숙달도, 캘리브레이션, 예측 회상률 등 **파생 상태는 저장하지
않는다**. 매번 `interactions` 로그를 재생해 계산한다. 덕분에 스케줄러를 바꿔
끼우거나(SM-2 → FSRS, 파라미터 재적합) 백업을 복원해도 과거 로그 전체가 새
기준으로 재계산된다.

## 기능 (v0 → v7)

- **v0** FSRS-6 스케줄러(`ts-fsrs`), 이벤트 소싱 플래시카드 큐
- **v1** KC 선수지식 DAG, Elo 숙달도 추정(θ·b), 세션 오케스트레이터, 응답 전 자신감 입력
- **v2** 빈칸/4지선다/코드 활동 타입, 오답 원인 태깅, leech 격리·재출제, 메타인지 캘리브레이션
- **v3** 분석 대시보드, 오프라인 시뮬레이션(log loss·RMSE), 개인 로그로 FSRS 21개 파라미터 재적합(Hooke–Jeeves)
- **v4** "바람직한 어려움" 밴드(예측 회상률 0.70–0.85) 기반 문항 선택 — v1부터 계산만 되던 Elo 문항 난이도를 여기서 활용
- **v5** 전체 데이터 JSON 내보내기 / 가져오기(병합·완전교체), 파일 검증
- **v6** 탭 셸 구조 — 전역 상태(`AtlasProvider`)와 화면(`views/`) 분리, 화면 등록소(`views/registry.ts`)로 확장
- **v7** 반응형 데스크톱 레이아웃 — ≥900px 사이드바, 그 아래는 상단 탭 바
- **v8** 지식 요소 삭제 (참조하던 카드는 분류만 해제, 로그 유지)
- **v9** 데스크톱 화면별 다단 레이아웃 (진단 2열, 카드 폼/목록 분리)
- **v10** 카드 편집 (추가/편집 겸용 `ItemForm`)
- **v11** 테스트 스위트 (vitest + fake-indexeddb)
- **v12** KC별 목표 파지율 (Atlas 5부 "매트릭스") — 개념 단위로 복습 빈도 조절
- **v13** 덱 검색·필터 (타입/상태/KC/난이도 밴드)
- **v14** 필터된 덱으로 학습 세션 시작 — 덱 필터 결과를 세션 후보 풀로 바로 연결
- **v15** KC 선수지식 그래프 시각화 — prereqIds DAG를 SVG로, 숙달/준비/잠김 상태 표시
- **v16** 카드 일괄 작업 — 덱 필터 결과에서 여러 장을 골라 분류 재배정·삭제

## 구조

```
src/
  core/        도메인 모델, IndexedDB 접근, 백업, 캘리브레이션, 전역 상태(AtlasProvider)
  scheduler/   FSRS 래퍼, Elo, 세션 편성, 난이도 밴드 선택, 재적합 옵티마이저, 시뮬레이션
  activities/  활동 타입별 응답 UI, 오답 태그 선택
  analytics/   대시보드, 통계 집계
  shell/       탭 바 / 사이드바 / 해시 라우팅
  views/       학습 · 진단 · 카드 · 데이터 (+ registry)
```

새 화면(단계)을 추가하려면 `views/`에 컴포넌트 파일 하나를 만들고
`views/registry.ts`의 `VIEWS` 배열에 한 줄 등록하면 된다.

## 개발

```bash
npm install
npm run dev      # Vite 개발 서버
npm run build    # tsc -b && vite build
npm run lint     # oxlint
npm test         # vitest — 스케줄러·집계·백업·재생 결정성 (fake-indexeddb로 DB 계층까지)
```

`src/**/*.test.ts` 는 "로그를 재생하면 저장 순서·형태와 무관하게 같은 파생
상태가 나온다"는 이벤트 소싱 불변식(`core/eventSourcing.test.ts`)을 포함해
FSRS/Elo/세션 편성/캘리브레이션/백업을 고정한다.
