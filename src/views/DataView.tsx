// "데이터" 화면(v5) — 네 스토어 전체를 JSON 한 파일로 내보내고 되돌린다.
// 내보내기는 읽기 전용이고, 가져오기는 파일을 고르면 검증만 한 뒤 사용자가
// 모드를 골라 "실행"할 때만 반영한다(완전 교체는 되돌릴 수 없으므로).

import { useRef, useState, type ChangeEvent } from 'react'
import { useAtlas } from '../core/atlas'
import * as db from '../core/db'
import { serializeBackup, parseBackup, backupFilename, type BackupSummary } from '../core/backup'
import { seedDeck, SEED_DECK_SIZE } from '../core/seedDeck'
import { buildCsvImport, type CsvImportResult } from '../core/csvImport'

export function DataView() {
  const atlas = useAtlas()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ snapshot: db.DbSnapshot; summary: BackupSummary } | null>(
    null,
  )
  const [mode, setMode] = useState<db.ImportMode>('merge')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const csvInputRef = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState<CsvImportResult | null>(null)

  async function handleExport() {
    const snapshot = await db.exportAll()
    const blob = new Blob([serializeBackup(snapshot)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = backupFilename()
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일을 다시 골라도 change가 발생하도록
    if (!file) return
    const result = parseBackup(await file.text())
    if (!result.ok) {
      setError(result.error)
      setPreview(null)
      return
    }
    setError(null)
    setPreview({ snapshot: result.snapshot, summary: result.summary })
  }

  async function handleSeed() {
    setSeeding(true)
    await atlas.importBackup(seedDeck(), 'merge')
    setSeeding(false)
  }

  async function handleCsvPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setCsv(buildCsvImport(await file.text(), atlas.kcs))
  }

  // 저장은 백업 가져오기(merge)를 그대로 쓴다 — 새 DB 코드 없이, KC와 카드가
  // 한 트랜잭션에 함께 들어간다. 채점 로그는 건드리지 않는다.
  async function handleConfirmCsv() {
    if (!csv || csv.items.length === 0) return
    setImporting(true)
    await atlas.importBackup(
      {
        items: csv.items,
        interactions: [],
        kcs: csv.newKcs,
        schedulerSettings: null,
        studyPrefs: null,
      },
      'merge',
    )
    setCsv(null)
    setImporting(false)
  }

  async function handleConfirmImport() {
    if (!preview) return
    setImporting(true)
    await atlas.importBackup(preview.snapshot, mode)
    setPreview(null)
    setMode('merge')
    setImporting(false)
  }

  return (
    <section className="panel backup">
      <h2>데이터</h2>
      <p className="muted">
        카드·채점 로그·지식 요소·스케줄러 설정을 JSON 파일 하나로 내보내고 되돌립니다. 이 앱은
        데이터를 이 브라우저에만 저장하니, 가끔 내보내 두는 걸 권합니다.
      </p>
      <div className="backup-actions">
        <button className="reveal" onClick={handleExport}>
          내보내기
        </button>
        <button className="reveal" onClick={() => fileInputRef.current?.click()}>
          파일 선택…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={handleFilePicked}
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="csv-block">
        <h3>CSV로 카드 여러 장 넣기</h3>
        <p className="muted">
          첫 줄에 열 이름을 적습니다. 가장 단순하게는 <code>front,back</code>(또는{' '}
          <code>앞면,뒷면</code>)이면 되고, <code>kc</code>(분류) 열을 더하면 그 이름의 분류에
          붙습니다 — 없는 분류는 새로 만듭니다. <code>text</code>에 <code>{'{{정답}}'}</code>을
          쓰면 빈칸 카드, <code>prompt</code>와 <code>answers</code>(여러 개는 <code>|</code>로
          구분)를 쓰면 단답형이 됩니다. 채점 로그는 건드리지 않습니다.
        </p>
        <div className="backup-actions">
          <button className="reveal" onClick={() => csvInputRef.current?.click()}>
            CSV 파일 선택…
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept="text/csv,.csv,.txt"
            hidden
            onChange={handleCsvPicked}
          />
        </div>

        {csv && (
          <div className="import-preview">
            <p>
              가져올 카드 <strong>{csv.items.length}</strong>장
              {csv.newKcs.length > 0 && <> · 새 분류 {csv.newKcs.length}개</>}
              {csv.errors.length > 0 && (
                <> · <span className="error-text">건너뛴 줄 {csv.errors.length}</span></>
              )}
            </p>
            {csv.newKcs.length > 0 && (
              <p className="muted">새로 만들 분류: {csv.newKcs.map((k) => k.name).join(', ')}</p>
            )}
            {csv.errors.length > 0 && (
              <ul className="csv-errors">
                {csv.errors.slice(0, 5).map((err) => (
                  <li key={err.line}>
                    {err.line}번째 줄 — {err.message}
                  </li>
                ))}
                {csv.errors.length > 5 && <li className="muted">…외 {csv.errors.length - 5}줄</li>}
              </ul>
            )}
            <div className="backup-actions">
              <button
                className="start"
                onClick={handleConfirmCsv}
                disabled={importing || csv.items.length === 0}
              >
                {importing ? '가져오는 중…' : `${csv.items.length}장 가져오기`}
              </button>
              <button className="reveal" onClick={() => setCsv(null)} disabled={importing}>
                취소
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="seed-deck-block">
        <p className="muted">
          둘러볼 카드가 필요하면 예시 덱({SEED_DECK_SIZE}장)을 넣어 볼 수 있습니다. 같은 id를
          덮어쓰므로 여러 번 넣어도 카드가 늘지 않습니다.
        </p>
        <button className="reveal" onClick={handleSeed} disabled={seeding}>
          {seeding ? '넣는 중…' : '예시 덱 넣기'}
        </button>
      </div>

      {preview && (
        <div className="import-preview">
          <p>
            카드 <strong>{preview.summary.items}</strong> · 로그{' '}
            <strong>{preview.summary.interactions}</strong> · 지식 요소{' '}
            <strong>{preview.summary.kcs}</strong>
            {preview.summary.hasSettings && ' · 스케줄러 설정 포함'}
            {preview.summary.hasStudyPrefs && ' · 백로그/휴가 설정 포함'}
          </p>
          {preview.summary.exportedAt && (
            <p className="muted">
              내보낸 시각: {new Date(preview.summary.exportedAt).toLocaleString()}
            </p>
          )}
          <div className="import-mode">
            <label>
              <input
                type="radio"
                name="import-mode"
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
              />
              병합 — 같은 id는 파일 내용으로 덮고, 나머지 기존 데이터는 그대로 둡니다
            </label>
            <label>
              <input
                type="radio"
                name="import-mode"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
              />
              완전 교체 — 지금 데이터를 모두 지우고 파일 내용만 남깁니다(되돌릴 수 없음)
            </label>
          </div>
          <div className="backup-actions">
            <button
              className={mode === 'replace' ? 'danger' : 'start'}
              onClick={handleConfirmImport}
              disabled={importing}
            >
              {importing ? '가져오는 중…' : mode === 'replace' ? '교체 실행' : '병합 실행'}
            </button>
            <button className="reveal" onClick={() => setPreview(null)} disabled={importing}>
              취소
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
