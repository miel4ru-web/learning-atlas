// CSV로 카드 여러 장 한 번에 넣기(Atlas 4.6 코어 콘텐츠 파이프라인 — "사람이 직접
// 문항 작성 또는 CSV로 임포트"). 문서가 LLM 문항 생성을 보류하면서 그 자리에
// 지정해 둔 경로가 이것이다.
//
// 여기는 순수 파싱·검증만 한다. 저장은 기존 백업 가져오기(db.importAll merge)를
// 그대로 재사용한다 — 새 DB 코드가 필요 없고, 트랜잭션 하나로 KC와 카드가 함께
// 들어간다는 성질도 공짜로 따라온다.

import type { Item, KnowledgeComponent } from './types'

export interface CsvRowError {
  /** 파일에서의 줄 번호(헤더가 1줄). 사용자가 파일을 열어 바로 찾아갈 수 있게. */
  line: number
  message: string
}

export interface CsvImportResult {
  items: Item[]
  /** 파일에 있었지만 아직 없는 분류 — 가져오기와 함께 만들어진다. */
  newKcs: KnowledgeComponent[]
  errors: CsvRowError[]
  /** 헤더를 뺀 전체 데이터 줄 수(빈 줄 제외). */
  totalRows: number
}

interface BuildOptions {
  newId?: () => string
  now?: () => string
}

/**
 * RFC 4180 수준의 CSV 파서. 따옴표 안의 쉼표·줄바꿈·이중 따옴표("")를 처리하고,
 * 엑셀이 붙이는 BOM과 CRLF를 흡수한다(윈도에서 엑셀로 만든 파일이 가장 흔한 입력이다).
 */
export function parseCsvRows(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++ // 이스케이프된 따옴표
        } else {
          inQuotes = false
        }
      } else {
        field += ch // 따옴표 안에서는 줄바꿈도 그대로 값이다
      }
      continue
    }

    if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// 열 이름은 한국어·영어를 모두 받는다 — 손으로 만든 파일이 대부분이라 이름을
// 외우게 하는 것보다 흔한 표기를 넓게 받아주는 편이 낫다.
const COLUMN_ALIASES: Record<string, string[]> = {
  type: ['type', '타입', '유형'],
  front: ['front', '앞면', '질문', 'q'],
  back: ['back', '뒷면', '답', 'a'],
  text: ['text', '본문', '빈칸'],
  prompt: ['prompt', '문제'],
  answers: ['answers', '정답'],
  kc: ['kc', '분류', '지식요소', '지식 요소'],
}

const TYPE_ALIASES: Record<string, 'flashcard' | 'cloze' | 'short'> = {
  flashcard: 'flashcard',
  플래시카드: 'flashcard',
  카드: 'flashcard',
  cloze: 'cloze',
  빈칸: 'cloze',
  '빈칸 채우기': 'cloze',
  short: 'short',
  단답형: 'short',
  단답: 'short',
}

/** 단답형의 여러 정답은 파이프로 나눈다 — 쉼표는 CSV 구분자와 부딪힌다. */
const ANSWER_SEPARATOR = '|'

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

function mapHeader(header: string[]): Map<string, number> {
  const index = new Map<string, number>()
  header.forEach((raw, i) => {
    const name = normalize(raw)
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(name) && !index.has(field)) index.set(field, i)
    }
  })
  return index
}

/**
 * CSV 텍스트를 그대로 저장할 수 있는 카드·분류로 바꾼다.
 *
 * - `type` 열이 없으면 내용으로 추론한다: `{{ }}`가 있으면 빈칸, 문제+정답이면
 *   단답형, 앞면+뒷면이면 플래시카드.
 * - `kc`(분류)는 **이름**으로 적는다. 이미 있는 분류면 그 id에 붙이고, 없으면
 *   새로 만든다(파일 안에서 같은 이름은 하나로 묶는다).
 * - 한 줄이 잘못돼도 전체를 버리지 않는다 — 그 줄만 오류로 보고하고 나머지는 살린다.
 */
export function buildCsvImport(
  text: string,
  existingKcs: KnowledgeComponent[],
  options: BuildOptions = {},
): CsvImportResult {
  const newId = options.newId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date().toISOString())

  const rows = parseCsvRows(text)
  if (rows.length === 0) {
    return { items: [], newKcs: [], errors: [{ line: 1, message: '빈 파일입니다.' }], totalRows: 0 }
  }

  const column = mapHeader(rows[0])
  if (column.size === 0) {
    return {
      items: [],
      newKcs: [],
      errors: [
        {
          line: 1,
          message:
            '첫 줄(헤더)에서 알아볼 수 있는 열 이름이 없습니다. 예: front,back,kc / 앞면,뒷면,분류',
        },
      ],
      totalRows: 0,
    }
  }

  const kcIdByName = new Map(existingKcs.map((kc) => [normalize(kc.name), kc.id]))
  const newKcs: KnowledgeComponent[] = []
  const items: Item[] = []
  const errors: CsvRowError[] = []
  let totalRows = 0

  const cell = (row: string[], field: string): string => {
    const i = column.get(field)
    return i === undefined ? '' : (row[i] ?? '').trim()
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const line = r + 1
    if (row.every((v) => v.trim() === '')) continue // 빈 줄은 조용히 넘긴다
    totalRows++

    const front = cell(row, 'front')
    const back = cell(row, 'back')
    const clozeText = cell(row, 'text')
    const prompt = cell(row, 'prompt')
    const answersRaw = cell(row, 'answers')
    const typeRaw = normalize(cell(row, 'type'))

    let type: 'flashcard' | 'cloze' | 'short' | null = null
    if (typeRaw) {
      type = TYPE_ALIASES[typeRaw] ?? null
      if (!type) {
        errors.push({ line, message: `모르는 타입입니다: "${cell(row, 'type')}"` })
        continue
      }
    } else if (clozeText.includes('{{')) type = 'cloze'
    else if (prompt && answersRaw) type = 'short'
    else if (front && back) type = 'flashcard'
    else {
      errors.push({ line, message: '어떤 카드인지 알 수 없습니다(필요한 칸이 비어 있습니다).' })
      continue
    }

    // 분류: 이름 → id. 없으면 만들어 두고 이후 줄에서 재사용한다.
    const kcName = cell(row, 'kc')
    let kcId: string | null = null
    if (kcName) {
      const key = normalize(kcName)
      const found = kcIdByName.get(key)
      if (found) kcId = found
      else {
        const created: KnowledgeComponent = {
          id: newId(),
          name: kcName,
          prereqIds: [],
          createdAt: now(),
        }
        newKcs.push(created)
        kcIdByName.set(key, created.id)
        kcId = created.id
      }
    }

    const base = { id: newId(), kcId, createdAt: now() }

    if (type === 'flashcard') {
      if (!front || !back) {
        errors.push({ line, message: '플래시카드는 앞면과 뒷면이 모두 필요합니다.' })
        continue
      }
      items.push({ ...base, type: 'flashcard', front, back })
      continue
    }

    if (type === 'cloze') {
      if (!clozeText.includes('{{') || !clozeText.includes('}}')) {
        errors.push({ line, message: '빈칸 카드에는 {{정답}} 형태의 빈칸이 필요합니다.' })
        continue
      }
      items.push({ ...base, type: 'cloze', text: clozeText })
      continue
    }

    const acceptedAnswers = answersRaw
      .split(ANSWER_SEPARATOR)
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
    if (!prompt || acceptedAnswers.length === 0) {
      errors.push({
        line,
        message: `단답형은 문제와 정답이 필요합니다(정답 여러 개는 ${ANSWER_SEPARATOR}로 구분).`,
      })
      continue
    }
    items.push({ ...base, type: 'short', prompt, acceptedAnswers })
  }

  return { items, newKcs, errors, totalRows }
}
