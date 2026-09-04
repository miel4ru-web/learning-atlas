// Atlas DRL(코드 실행 채점)의 실행 경계. 사용자가 입력한 임의의 JS를
// 메인 페이지(IndexedDB·다른 사용자 데이터가 있는 곳)에서 절대 실행하지
// 않는다 — sandbox="allow-scripts"만 준 <iframe>(allow-same-origin은
// 절대 넣지 않는다: 넣는 순간 opaque origin이 깨지고 부모 페이지에 접근
// 가능해진다)에서 실행하고, postMessage로만 결과를 받는다.
//
// 알려진 한계: 진짜 무한루프(동기 while(true))는 이 방식으로도 완전히
// 막지 못할 수 있다 — 별도 브라우징 컨텍스트라 대개 메인 스레드를 막지는
// 않지만, 응답이 안 오면 TIMEOUT_MS 후 타임아웃으로 처리할 뿐 iframe
// 자체를 강제 종료하진 않는다. 개인용 학습 도구 규모에서 감수하는 리스크.

import type { CodeTest } from '../core/types'

export interface CodeRunResult {
  ok: boolean
  results: { pass: boolean; actual?: unknown; error?: string }[]
  compileError?: string
  timedOut?: boolean
}

const TIMEOUT_MS = 2000

const HARNESS_HTML = `<!doctype html><html><body><script>
window.addEventListener('message', function (ev) {
  var id = ev.data && ev.data.id
  var code = ev.data.code
  var tests = ev.data.tests || []
  if (!id) return
  var fn
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function(code + '\\n;return typeof solve === "function" ? solve : null;')()
  } catch (e) {
    parent.postMessage({ id: id, compileError: String(e) }, '*')
    return
  }
  if (typeof fn !== 'function') {
    parent.postMessage({ id: id, compileError: 'solve 함수를 찾을 수 없습니다.' }, '*')
    return
  }
  var results = []
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i]
    try {
      var actual = fn.apply(null, t.args)
      results.push({ pass: JSON.stringify(actual) === JSON.stringify(t.expected), actual: actual })
    } catch (e) {
      results.push({ pass: false, error: String(e) })
    }
  }
  parent.postMessage({ id: id, results: results }, '*')
})
</script></body></html>`

let iframe: HTMLIFrameElement | null = null
// srcdoc 문서는 비동기로 로드된다 — 만드는 즉시 postMessage를 보내면 그
// 문서의 스크립트(메시지 리스너)가 아직 붙기 전이라 첫 호출이 통째로
// 유실된다(리스너 없는 시점의 postMessage는 아무도 못 받고 사라진다).
// 'load' 이벤트를 기다리는 프로미스를 만들어 runCode()가 그걸 먼저 await 하게 한다.
let ready: Promise<void> | null = null
const pending = new Map<string, { resolve: (r: CodeRunResult) => void; timer: number }>()

function ensureIframe(): { frame: HTMLIFrameElement; ready: Promise<void> } {
  if (iframe && ready) return { frame: iframe, ready }
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.style.display = 'none'
  const loadPromise = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true })
  })
  frame.srcdoc = HARNESS_HTML
  document.body.appendChild(frame)
  window.addEventListener('message', (ev) => {
    const data = ev.data as { id?: string; results?: CodeRunResult['results']; compileError?: string } | null
    if (!data || typeof data.id !== 'string') return
    const entry = pending.get(data.id)
    if (!entry) return
    window.clearTimeout(entry.timer)
    pending.delete(data.id)
    if (data.compileError) {
      entry.resolve({ ok: false, results: [], compileError: data.compileError })
    } else {
      const results = data.results ?? []
      entry.resolve({ ok: results.every((r) => r.pass), results })
    }
  })
  iframe = frame
  ready = loadPromise
  return { frame, ready: loadPromise }
}

export async function runCode(code: string, tests: CodeTest[]): Promise<CodeRunResult> {
  const { frame, ready } = ensureIframe()
  await ready
  const id = crypto.randomUUID()
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      resolve({ ok: false, results: [], timedOut: true })
    }, TIMEOUT_MS)
    pending.set(id, { resolve, timer })
    frame.contentWindow?.postMessage({ id, code, tests }, '*')
  })
}
