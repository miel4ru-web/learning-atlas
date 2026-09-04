// "데이터" 화면(v5) — 네 스토어 전체를 JSON 한 파일로 내보내고 되돌린다.
// 내보내기는 읽기 전용이고, 가져오기는 파일을 고르면 검증만 한 뒤 사용자가
// 모드를 골라 "실행"할 때만 반영한다(완전 교체는 되돌릴 수 없으므로).

import { useRef, useState, type ChangeEvent } from 'react'
import { useAtlas } from '../core/atlas'
import * as db from '../core/db'
import { serializeBackup, parseBackup, backupFilename, type BackupSummary } from '../core/backup'

export function DataView() {
  const atlas = useAtlas()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ snapshot: db.DbSnapshot; summary: BackupSummary } | null>(
    null,
  )
  const [mode, setMode] = useState<db.ImportMode>('merge')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

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

  async function handleConfirmImport() {
    if (!preview) return
    setImporting(true)
    await atlas.importBackup(preview.snapshot, mode)
    setPreview(null)
    setMode('merge')
    setImporting(false)
  }

  return (
    <section className="backup">
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

      {preview && (
        <div className="import-preview">
          <p>
            카드 <strong>{preview.summary.items}</strong> · 로그{' '}
            <strong>{preview.summary.interactions}</strong> · 지식 요소{' '}
            <strong>{preview.summary.kcs}</strong>
            {preview.summary.hasSettings && ' · 스케줄러 설정 포함'}
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
