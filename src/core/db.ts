// IndexedDB 접근 계층. items·kcs(카드/지식요소 정의, 편집 가능), interactions
// (채점 로그, append-only — core/types.ts 주석 참고), settings(키별로 다른
// 단일 레코드 두 개를 둔 out-of-line 스토어 — 재적합된 스케줄러 파라미터와
// v18 백로그/휴가 모드 설정. 둘 다 없으면 각자의 기본값을 쓴다).

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  Item,
  NewItem,
  Interaction,
  Grade,
  Confidence,
  ErrorTag,
  InteractionSignals,
  KnowledgeComponent,
  SchedulerSettings,
  StudyPrefs,
} from './types'

interface AtlasDB extends DBSchema {
  items: {
    key: string
    value: Item
  }
  kcs: {
    key: string
    value: KnowledgeComponent
  }
  interactions: {
    key: string
    value: Interaction
    indexes: { byItem: string }
  }
  settings: {
    key: string
    value: SchedulerSettings | StudyPrefs
  }
}

const SCHEDULER_SETTINGS_KEY = 'scheduler'
const STUDY_PREFS_KEY = 'studyPrefs'

// 현재 IndexedDB 스키마 버전. 백업 파일에도 같이 적어(core/backup.ts) 다른
// 버전에서 만든 파일을 가져오려 할 때 걸러낸다.
export const DB_VERSION = 5

let dbPromise: Promise<IDBPDatabase<AtlasDB>> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AtlasDB>('learning-atlas', DB_VERSION, {
      // idb는 upgrade가 반환하는 프로미스를 기다려준다 — versionchange 트랜잭션이
      // 마이그레이션(아래 3) 도중 조기 커밋되지 않도록 async 함수로 선언하고 await 한다.
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          db.createObjectStore('items', { keyPath: 'id' })
          const interactions = db.createObjectStore('interactions', { keyPath: 'id' })
          interactions.createIndex('byItem', 'itemId')
        }
        if (oldVersion < 2) {
          db.createObjectStore('kcs', { keyPath: 'id' })
          // 기존 items/interactions 레코드는 kcId/confidence가 없는 채로 남는다.
          // 읽는 쪽에서 `?? null`로 처리한다 (v0 데이터와의 호환).
        }
        if (oldVersion < 3 && oldVersion > 0) {
          // v1까지의 Item은 discriminant 없이 { front, back }만 있었다.
          // v2부터 Item이 판별 유니온이 되면서 type 필드가 필수가 됐으므로,
          // 기존 레코드를 지우는 대신 flashcard로 마이그레이션해 데이터를 지킨다.
          const store = tx.objectStore('items')
          let cursor = await store.openCursor()
          while (cursor) {
            const value = cursor.value as unknown as Record<string, unknown>
            if (!value.type) {
              await cursor.update({ ...value, type: 'flashcard' } as unknown as Item)
            }
            cursor = await cursor.continue()
          }
        }
        if (oldVersion < 4) {
          db.createObjectStore('settings') // out-of-line key(SCHEDULER_SETTINGS_KEY) — keyPath 없음
        }
        if (oldVersion < 5) {
          // KnowledgeComponent에 optional requestRetention 추가(Atlas 5부). 스토어
          // 구조는 그대로 — 기존 KC 레코드는 필드 없이 남고, 읽는 쪽에서 전역
          // 기본값으로 폴백한다. 마이그레이션할 데이터가 없어 버전 표식만 올린다.
        }
      },
    })
  }
  return dbPromise
}

function newId(): string {
  return crypto.randomUUID()
}

export async function addItem(input: NewItem): Promise<Item> {
  // NewItem은 이미 유니온으로 분배된 순수 object 타입들의 합인데도 TS가
  // 제네릭 스프레드를 보수적으로 막는다 — 필드 구성은 NewItem이 보장하므로
  // 여기서만 object로 캐스트해 스프레드한다.
  const item = { ...(input as object), id: newId(), createdAt: new Date().toISOString() } as Item
  const db = await getDB()
  await db.add('items', item)
  return item
}

export async function getAllItems(): Promise<Item[]> {
  const db = await getDB()
  return db.getAll('items')
}

// 카드 내용 편집. id·createdAt은 그대로 두고 put으로 덮어쓴다. 채점 로그
// (interactions)는 itemId로 연결돼 있어 그대로 유지된다 — 내용을 고쳐도
// FSRS·Elo 재생은 등급·시각만 보므로 스케줄이 깨지지 않는다.
export async function updateItem(item: Item): Promise<void> {
  const db = await getDB()
  await db.put('items', item)
}

export async function deleteItem(itemId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['items', 'interactions'], 'readwrite')
  await tx.objectStore('items').delete(itemId)
  const idx = tx.objectStore('interactions').index('byItem')
  let cursor = await idx.openCursor(itemId)
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

// 덱 필터 결과에 대한 일괄 작업(v16). 한 건씩 addItem/deleteItem을 반복 호출하면
// 그때마다 별도 트랜잭션 + AtlasProvider의 reload가 따라붙는다 — 여기선 트랜잭션
// 하나로 묶는다. itemIds에 이미 지워진 id가 섞여 있어도(다른 화면에서 개별
// 삭제된 뒤라든가) 조용히 건너뛴다 — 에러로 전체를 막지 않는다.
export async function bulkSetKc(itemIds: readonly string[], kcId: string | null): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('items', 'readwrite')
  const store = tx.objectStore('items')
  for (const id of itemIds) {
    const item = await store.get(id)
    if (item) await store.put({ ...item, kcId } as Item)
  }
  await tx.done
}

export async function bulkDeleteItems(itemIds: readonly string[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['items', 'interactions'], 'readwrite')
  const items = tx.objectStore('items')
  const idx = tx.objectStore('interactions').index('byItem')
  for (const id of itemIds) {
    await items.delete(id)
    let cursor = await idx.openCursor(id)
    while (cursor) {
      await cursor.delete()
      cursor = await cursor.continue()
    }
  }
  await tx.done
}

// v19: 부가 신호(응답 시간·응답 원문·선택지 인덱스·정책 버전)를 함께 남긴다.
// 값이 없는 신호는 키 자체를 넣지 않는다 — JSON 백업에서 undefined는 어차피
// 사라지므로, 저장 시점부터 "없으면 없는 것"으로 통일해 왕복이 어긋나지 않게 한다.
export async function recordInteraction(
  itemId: string,
  grade: Grade,
  confidence: Confidence | null,
  errorTag: ErrorTag | null = null,
  signals: InteractionSignals & { policyVersion?: string } = {},
): Promise<Interaction> {
  const interaction: Interaction = {
    id: newId(),
    itemId,
    ts: new Date().toISOString(),
    grade,
    confidence,
    errorTag,
  }
  if (signals.latencyMs !== undefined) interaction.latencyMs = signals.latencyMs
  if (signals.response !== undefined) interaction.response = signals.response
  if (signals.selectedIndex !== undefined) interaction.selectedIndex = signals.selectedIndex
  if (signals.policyVersion !== undefined) interaction.policyVersion = signals.policyVersion
  if (signals.pretest) interaction.pretest = true // false는 굳이 남기지 않는다(기본값)

  const db = await getDB()
  await db.add('interactions', interaction)
  return interaction
}

export async function getAllInteractions(): Promise<Interaction[]> {
  const db = await getDB()
  return db.getAll('interactions')
}

export async function getInteractionsForItem(itemId: string): Promise<Interaction[]> {
  const db = await getDB()
  return db.getAllFromIndex('interactions', 'byItem', itemId)
}

export async function addKC(
  name: string,
  prereqIds: string[],
  requestRetention?: number,
): Promise<KnowledgeComponent> {
  const kc: KnowledgeComponent = { id: newId(), name, prereqIds, createdAt: new Date().toISOString() }
  if (requestRetention !== undefined) kc.requestRetention = requestRetention
  const db = await getDB()
  await db.add('kcs', kc)
  return kc
}

export async function updateKC(kc: KnowledgeComponent): Promise<void> {
  const db = await getDB()
  await db.put('kcs', kc)
}

// KC를 지우면 그 KC를 가리키던 카드는 지우지 않고 kcId만 null로 되돌린다(채점
// 로그는 그대로 — 카드가 사라지는 게 아니라 "분류 없음"이 될 뿐이다). 다른 KC의
// 선수지식 목록에서도 빠진다. Elo θ는 다음 재생부터 이 KC가 없으니 자연히 사라진다.
export async function deleteKC(kcId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['kcs', 'items'], 'readwrite')
  const kcs = tx.objectStore('kcs')
  const items = tx.objectStore('items')

  await kcs.delete(kcId)

  let kcCursor = await kcs.openCursor()
  while (kcCursor) {
    const kc = kcCursor.value
    if (kc.prereqIds.includes(kcId)) {
      await kcCursor.update({ ...kc, prereqIds: kc.prereqIds.filter((p) => p !== kcId) })
    }
    kcCursor = await kcCursor.continue()
  }

  let itemCursor = await items.openCursor()
  while (itemCursor) {
    const item = itemCursor.value
    if (item.kcId === kcId) {
      await itemCursor.update({ ...item, kcId: null } as Item)
    }
    itemCursor = await itemCursor.continue()
  }

  await tx.done
}

export async function getAllKCs(): Promise<KnowledgeComponent[]> {
  const db = await getDB()
  return db.getAll('kcs')
}

export async function getSchedulerSettings(): Promise<SchedulerSettings | undefined> {
  const db = await getDB()
  const v = await db.get('settings', SCHEDULER_SETTINGS_KEY)
  return v as SchedulerSettings | undefined
}

export async function saveSchedulerSettings(settings: SchedulerSettings): Promise<void> {
  const db = await getDB()
  await db.put('settings', settings, SCHEDULER_SETTINGS_KEY)
}

export async function clearSchedulerSettings(): Promise<void> {
  const db = await getDB()
  await db.delete('settings', SCHEDULER_SETTINGS_KEY)
}

export async function getStudyPrefs(): Promise<StudyPrefs | undefined> {
  const db = await getDB()
  const v = await db.get('settings', STUDY_PREFS_KEY)
  return v as StudyPrefs | undefined
}

export async function saveStudyPrefs(prefs: StudyPrefs): Promise<void> {
  const db = await getDB()
  await db.put('settings', prefs, STUDY_PREFS_KEY)
}

// 4부 검증 체크리스트: 로그를 지우고 재생해도 같은 스케줄이 나와야 한다.
// 이 함수는 그 주장을 실제로 시험할 수 있게 한다 — interactions만 지우고
// items는 남긴 뒤, 별도로 백업해 둔 로그를 replay 해 review_state가
// 동일하게 재구성되는지 확인하는 용도(개발자 콘솔에서 수동 호출).
export async function wipeInteractions(): Promise<void> {
  const db = await getDB()
  await db.clear('interactions')
}

// ---- 백업(v5): 네 스토어 전체를 그대로 읽고/쓴다 ----
// 영속화하는 건 이 네 스토어가 전부다(파생 상태는 저장 안 함, types.ts 주석).
// 그래서 이걸 통째로 내보냈다 다시 넣으면 카드 상태·숙달도·캘리브레이션이
// 로그 재생으로 똑같이 복원된다 — 위 wipeInteractions 주석의 주장을 사용자가
// 직접 백업/복원으로 확인할 수 있게 된 것.

export interface DbSnapshot {
  items: Item[]
  interactions: Interaction[]
  kcs: KnowledgeComponent[]
  schedulerSettings: SchedulerSettings | null
  studyPrefs: StudyPrefs | null
}

export type ImportMode = 'replace' | 'merge'

export async function exportAll(): Promise<DbSnapshot> {
  const db = await getDB()
  const tx = db.transaction(['items', 'interactions', 'kcs', 'settings'], 'readonly')
  // deleteItem과 같은 방식 — idb 프로미스만 순차 await 한다(그 사이 다른 걸
  // await 하면 트랜잭션이 조기 종료된다).
  const items = await tx.objectStore('items').getAll()
  const interactions = await tx.objectStore('interactions').getAll()
  const kcs = await tx.objectStore('kcs').getAll()
  const schedulerSettings = await tx.objectStore('settings').get(SCHEDULER_SETTINGS_KEY)
  const studyPrefs = await tx.objectStore('settings').get(STUDY_PREFS_KEY)
  await tx.done
  return {
    items,
    interactions,
    kcs,
    schedulerSettings: (schedulerSettings as SchedulerSettings) ?? null,
    studyPrefs: (studyPrefs as StudyPrefs) ?? null,
  }
}

/**
 * merge: id가 겹치면 들어오는 레코드가 이긴다(put). 같은 백업을 두 번 넣어도
 *        결과가 같다(멱등). schedulerSettings/studyPrefs는 파일에 있을 때만 덮어쓴다.
 * replace: 네 스토어를 먼저 비우고 파일 내용만 남긴다. 파일에 설정이 없으면
 *          기존 재적합 설정·백로그 설정도 사라진다(= 각자 기본값으로 복귀).
 */
export async function importAll(snapshot: DbSnapshot, mode: ImportMode): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['items', 'interactions', 'kcs', 'settings'], 'readwrite')
  const items = tx.objectStore('items')
  const interactions = tx.objectStore('interactions')
  const kcs = tx.objectStore('kcs')
  const settings = tx.objectStore('settings')

  if (mode === 'replace') {
    await items.clear()
    await interactions.clear()
    await kcs.clear()
    await settings.clear()
  }

  for (const it of snapshot.items) await items.put(it)
  for (const it of snapshot.interactions) await interactions.put(it)
  for (const kc of snapshot.kcs) await kcs.put(kc)
  if (snapshot.schedulerSettings) {
    await settings.put(snapshot.schedulerSettings, SCHEDULER_SETTINGS_KEY)
  }
  if (snapshot.studyPrefs) {
    await settings.put(snapshot.studyPrefs, STUDY_PREFS_KEY)
  }
  await tx.done
}
