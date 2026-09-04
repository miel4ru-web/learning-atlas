// 상대 시각 표시. 순수 ms 나눗셈(diffMs / 86_400_000)으로 "N일 후"를 계산하면
// 자정 경계에서 어긋난다 — 예: 지금 23:50, 만기 내일 00:10이면 실제 차이는
// 20분인데 반올림 없이도 "다음 날"이라 체감상 "내일"이어야 하고, 반대로
// 지금 09:00, 만기 내일 08:00(23시간 후)이면 ms 기준 반올림으로 "1일 후"가
// 되어 실제로는 오늘 안에 다시 만기가 온다는 인상을 준다. 달력 날짜 차이와
// 남은 시간을 분리해서 계산해야 둘 다 정확하다.

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function formatDue(due: Date, now: Date): string {
  const diffMs = due.getTime() - now.getTime()
  if (diffMs <= 0) return '지금'

  const dayDiff = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000)

  if (dayDiff <= 0) {
    // 오늘 안에 다시 만기 — 달력 날짜는 안 바뀌므로 남은 시간으로 표시.
    const minutes = Math.round(diffMs / 60_000)
    if (minutes < 1) return '곧'
    if (minutes < 60) return `${minutes}분 후`
    return `${Math.round(diffMs / 3_600_000)}시간 후`
  }
  if (dayDiff === 1) return '내일'
  return `${dayDiff}일 후`
}
