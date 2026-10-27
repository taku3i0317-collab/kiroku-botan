import { expect, test } from 'claude-code/testing'

// 秘書のフォルダのファイルを、中身を小さくして置き換える
const FILES: Record<string, string> = {
  // 記録のフック：ここにある合図の一覧がボタンになる
  '.claude/scripts/life-log.ps1': "    $items = @('朝','昼','夜')",
  'status/締め切り.md': [
    '## 予定',
    '| 日付 | 部門 | やること | 状態 |',
    '|---|---|---|---|',
    '| 2026-10-24 | 家 | 書類を出す（12:00まで） | 未 |',
  ].join('\n'),
  'status/生活.md': [
    // 見出しとしなかったときの言い方は、この表で決める
    '## ボタン',
    '| 項目 | まとまり | なしの言い方 |',
    '|---|---|---|',
    '| 朝 | ごはん | 食べなかった |',
    '| 昼 | ごはん | 食べなかった |',
    '| 夜 | ごはん | 食べなかった |',
    '',
    '## 声かけ',
    '| 項目 | から | まで | 曜 | 言い方 |',
    '|---|---|---|---|---|',
    '| 朝 | 10:00 | 11:00 | 毎日 | 朝ごはん |',
    '',
    '## 間隔',
    '| 項目 | 日 | メモ |',
    '|---|---|---|',
    '| 洗濯 | 3 | |',
    '',
    '## 定例（曜日ごと）',
    '| 曜 | すること | 時刻の目安 |',
    '|---|---|---|',
    '| 毎日 | 歩く | いつでも |',
    '| 月・火・水・木・金 | 17:20 に家を出る | 16:40 に準備開始 |',
  ].join('\n'),
  'status/学業.md': [
    '## 個別（日付が決まっているもの）',
    '| 日付 | 科目 | 出すもの | 状態 |',
    '|---|---|---|---|',
    '| 2026-10-24 | 科目A | 05 ミニレポート（23:59まで） | 未 |',
    '| 2026-10-23 | 科目B | アンケート（23:59まで） | 済 |',
    '| 2026-11-30 | 先の科目 | 遠い課題 | 未 |',
  ].join('\n'),
  'journal/記録/2026-10.md': [
    '# 2026-10 の記録',
    '',
    '- 2026-10-20 20:00 洗濯',
    '- 2026-10-23 08:10 朝 なし',
    '- 2026-10-23 08:30 洗濯 なし',
  ].join('\n'),
}

const PANE = {
  plugin: 'kiroku-botan',
  component: 'Pane',
  requestId: 'kiroku',
  props: {
    title: 'きろく',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('「なし」が行に出て、押せばいまで記録、「時刻・なし」から食べなかったを送れる', async ($, on) => {
  on('command.register', () => ({ value: { command: 'kiroku' } }))
  // ペインは頼まれずには開かない（/kiroku のときだけ）
  let opens = 0
  on('ui.open', () => ((opens += 1), { value: { isPlaced: true } }))
  on('fs.read', (_, e) => {
    const key = Object.keys(FILES).find(k => e.path.replace(/\\/g, '/').endsWith(k))
    const text = key === undefined ? undefined : FILES[key]
    if (text === undefined) throw new Error('no file')
    return { value: text }
  })
  // 2026-10-23 12:00（日本時間）
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 23, 3, 0) }))
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opens).toBe(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // 朝は「なし」で、目安超え（橙）にならない
  expect((await ui.find({ type: 'Text', text: /なし（08:10）/ }))?.text).toContain('なし（08:10）')
  // 洗濯は今日「なし」：今日の行は「なし」、間隔はやった日（20日）から数える
  expect((await ui.findAll({ type: 'Text', text: /なし（08:30）/ })).length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /目安超え/ })).toBeUndefined()

  // まだの行は1回押すだけで、時刻なしの合図（フックが「いま」で書く）
  await ui.press({ key: 'kiroku-昼' })
  expect(sent).toEqual(['昼'])

  // 「時刻・なし」を開いて「食べなかった」
  await ui.press({ key: 'more-夜' })
  expect((await ui.find({ type: 'Button', key: 'skip' }))?.text).toBe('食べなかった')
  await ui.press({ key: 'skip' })
  expect(sent).toEqual(['昼', '夜 なし'])

  // 済の行を押しても二重に送らず、直す欄が開く
  await ui.press({ key: 'kiroku-昼' })
  expect(sent).toEqual(['昼', '夜 なし'])
  expect(await ui.find({ type: 'Button', key: 'send' })).toBeDefined()
  await ui.unmount()
})

test('いちばん上に次の予定までの残り。過ぎたら次へ、近いと橙', async ($, on) => {
  on('command.register', () => ({ value: { command: 'kiroku' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_, e) => {
    const key = Object.keys(FILES).find(k => e.path.replace(/\\/g, '/').endsWith(k))
    const text = key === undefined ? undefined : FILES[key]
    if (text === undefined) throw new Error('no file')
    return { value: text }
  })
  // 2026-10-23（金）16:31（日本時間）
  let t = Date.UTC(2026, 9, 23, 7, 31)
  on('clock.now', () => ({ value: t }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const big = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const left = await ui.find({ type: 'Text', text: /^あと / })
    const texts = (await ui.findAll({ type: 'Text' })).map(x => x.text)
    await ui.unmount()
    return { left: left?.text, first: texts[0], color: left?.props.color }
  }

  expect(await big()).toEqual({ left: 'あと 0:09', first: '準備開始', color: 'claude' })
  t = Date.UTC(2026, 9, 23, 7, 41)
  expect(await big()).toEqual({ left: 'あと 0:39', first: '家を出る', color: undefined })
  // 家を出たあとは、済でない7日以内の締め切り（済の行と遠い行は出ない）。締め切り.md の「予定」が先
  t = Date.UTC(2026, 9, 23, 8, 21)
  expect(await big()).toEqual({ left: 'あと 18:39', first: '書類を出す', color: undefined })
  // それが過ぎたら、学業.md の「個別」の行
  t = Date.UTC(2026, 9, 24, 3, 1)
  expect(await big()).toEqual({ left: 'あと 11:58', first: '科目A 05 ミニレポート', color: undefined })
})
