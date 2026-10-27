// 線のアイコン（形は Lucide、ISC ライセンス）。24 の枠、線 2、角は丸。
// 色は2つだけ：ふだんは灰（明るい画面でも暗い画面でも読める中間の灰）、目安を過ぎたら Claude の橙。
export const GRAY = '#8E8E8E'
export const ACCENT = '#D97757'

const PATHS: Record<string, string> = {
  薬: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  朝: '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
  昼: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  夜: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  洗濯: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  ごみ: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  運動: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  時計: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  済: '<path d="M20 6 9 17l-5-5"/>',
  // しなかった：横線1本（Lucide minus）。済とは別の形で、色は変えない
  なし: '<path d="M5 12h14"/>',
}
// 表に足された項目（アイコンが無い）は小さな丸
const DOT = '<circle cx="12" cy="12" r="3"/>'

export function icon(name: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] ?? DOT}</svg>`
}

// 記録した瞬間：輪が広がって消え、チェックが左から描かれる（SMIL。0.45 秒で描き終わる）
export function checkDraw(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<circle cx="12" cy="12" r="6" opacity="0.5"><animate attributeName="r" from="6" to="11" dur="0.5s" fill="freeze"/><animate attributeName="opacity" from="0.5" to="0" dur="0.5s" fill="freeze"/></circle>
<path d="M20 6 9 17l-5-5" stroke-dasharray="24" stroke-dashoffset="24"><animate attributeName="stroke-dashoffset" from="24" to="0" begin="0.05s" dur="0.4s" fill="freeze" calcMode="spline" keySplines="0.2 0 0 1" keyTimes="0;1"/></path>
</svg>`
}
