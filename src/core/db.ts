// IndexedDB 접근 계층. items·kcs(카드/지식요소 정의, 편집 가능), interactions
// (채점 로그, append-only — core/types.ts 주석 참고), settings(재적합된
// 스케줄러 파라미터 — 단일 레코드, 없으면 FSRS 기본값 사용).

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  Item,
  NewItem,
  Interaction,
  Grade,
  Confidence,
  ErrorTag,
  KnowledgeComponent,
  SchedulerSettings,
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
    value: SchedulerSettings
  }
}

const SCHEDULER_SETTINGS_KEY = 'scheduler'

let dbPromise: Promise<IDBPDatabase<AtlasDB>> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AtlasDB>('learning-atlas', 4, {
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

export async function recordInteraction(
  itemId: string,
  grade: Grade,
  confidence: Confidence | null,
  errorTag: ErrorTag | null = null,
): Promise<Interaction> {
  const interaction: Interaction = {
    id: newId(),
    itemId,
    ts: new Date().toISOString(),
    grade,
    confidence,
    errorTag,
  }
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

export async function addKC(name: string, prereqIds: string[]): Promise<KnowledgeComponent> {
  const kc: KnowledgeComponent = { id: newId(), name, prereqIds, createdAt: new Date().toISOString() }
  const db = await getDB()
  await db.add('kcs', kc)
  return kc
}

export async function getAllKCs(): Promise<KnowledgeComponent[]> {
  const db = await getDB()
  return db.getAll('kcs')
}

export async function getSchedulerSettings(): Promise<SchedulerSettings | undefined> {
  const db = await getDB()
  return db.get('settings', SCHEDULER_SETTINGS_KEY)
}

export async function saveSchedulerSettings(settings: SchedulerSettings): Promise<void> {
  const db = await getDB()
  await db.put('settings', settings, SCHEDULER_SETTINGS_KEY)
}

export async function clearSchedulerSettings(): Promise<void> {
  const db = await getDB()
  await db.delete('settings', SCHEDULER_SETTINGS_KEY)
}

// 4부 검증 체크리스트: 로그를 지우고 재생해도 같은 스케줄이 나와야 한다.
// 이 함수는 그 주장을 실제로 시험할 수 있게 한다 — interactions만 지우고
// items는 남긴 뒤, 별도로 백업해 둔 로그를 replay 해 review_state가
// 동일하게 재구성되는지 확인하는 용도(개발자 콘솔에서 수동 호출).
export async function wipeInteractions(): Promise<void> {
  const db = await getDB()
  await db.clear('interactions')
}
