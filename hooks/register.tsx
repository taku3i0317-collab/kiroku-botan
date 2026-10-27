import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Item, Plan, Soon, Today } from '../types'
import { ACCENT, GRAY, checkDraw, icon } from './icons'

// 記録の本体は秘書のフォルダの記録のフック（.claude/scripts/life-log.ps1）。この MOD は読むだけで、合図を送るところまで。
// パスは作業フォルダからの相対：status/生活.md の無いフォルダではペインを開かない。
const SEIKATSU = 'status/生活.md'
const KIROKU_DIR = 'journal/記録'
// 締め切り：`status/締め切り.md` の「予定」表と、`status/学業.md` の「個別」表。あるほうを読む（両方あれば両方）
const SHIMEKIRI = 'status/締め切り.md'
const GAKUGYO = 'status/学業.md'
// 記録のフック。ここに書いてある合図の一覧（`$items = @('…', …)`）がボタンになる（フックが受け取る合図と同じ物だけ出す）
const HOOK = '.claude/scripts/life-log.ps1'
// カウントダウンの色を変える残り（分）。音や通知は出さない
const SOON_MIN = 30
// 本人は日本にいる。モジュールの中のタイムゾーンに頼らず、日本時間で数える
const JST = 9 * 60 * 60 * 1000

const PANE = 'kiroku'
const TITLE = 'きろく'

const today = atom({ plugin: 'kiroku-botan', key: 'today' } as const, null)
const picking = atom({ plugin: 'kiroku-botan', key: 'picking' } as const, null)
const flash = atom({ plugin: 'kiroku-botan', key: 'flash' } as const, null)
// 選択肢は少なく（ヒックの法則）：時刻の調整は戻す方向の3段といまだけ、運動の長さは4つ
const STEPS = [30, 10, 5]
const DURATIONS = [10, 20, 30, 60]
// 「しなかった」の合図はメモ「なし」（フックの「合図 メモ」の形のまま）。ボタンの言い方は「## ボタン」の表で項目ごとに決められる
// （例：食べなかった）。書いていなければ、責めない事実の言葉「今日はなし」
const SKIP = 'なし'
const SKIP_LABEL = '今日はなし'
// 意味のまとまりに見出しを付けて分ける（ゲシュタルトの近接）。まとまりは「## ボタン」の表で決める。
// 書いていなければ、毎日のものと、間隔の表のもの（何日かごと）の2つ
const DAILY = '毎日'
const EVERY = '何日かごと'
const ICON_PX = 16

type Clock = { date: string; month: string; prevMonth: string; hm: string; youbi: string; day: number }

const pad = (n: number) => String(n).padStart(2, '0')

function clockOf(ms: number): Clock {
  const d = new Date(ms + JST)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`
  return {
    date: `${y}-${pad(m)}-${pad(d.getUTCDate())}`,
    month: `${y}-${pad(m)}`,
    prevMonth: prev,
    hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    youbi: '日月火水木金土'.charAt(d.getUTCDay()),
    day: d.getUTCDate(),
  }
}

/** status/生活.md の「## 見出し」の下にある表の行を、セルの配列で返す */
function tableRows(md: string, heading: string): string[][] {
  const rows: string[][] = []
  let inside = false
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      inside = line.startsWith(`## ${heading}`)
      continue
    }
    if (!inside || !line.startsWith('|') || /^\|\s*-/.test(line)) continue
    rows.push(line.split('|').slice(1, -1).map(c => c.trim()))
  }
  return rows.slice(1) // 見出し行を落とす
}

/** 表を見出しの名前で引く：列の順が変わっても読める（見出しに `name` を含む列。無ければ `fallback` 番目） */
function tableBy(md: string, heading: string): { rows: string[][]; col: (name: string, fallback: number) => number } {
  const all: string[][] = []
  let inside = false
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      inside = line.startsWith(`## ${heading}`)
      continue
    }
    if (!inside || !line.startsWith('|') || /^\|\s*-/.test(line)) continue
    all.push(line.split('|').slice(1, -1).map(c => c.trim()))
  }
  const head = all[0] ?? []
  return {
    rows: all.slice(1),
    col: (name, fallback) => {
      const i = head.findIndex(h => h.includes(name))
      return i >= 0 ? i : fallback
    },
  }
}

// 「17:20 に家を出る」「16:40 に準備開始」から、時刻と短い名前を取る
function timedOf(text: string): { hm: string; what: string } | null {
  const m = /(\d{1,2})[:：](\d{2})\s*に\s*([^（(、。]+)/.exec(text)
  if (!m) return null
  return { hm: `${pad(Number(m[1]))}:${m[2]}`, what: (m[3] ?? '').trim() }
}

// 日本時間の「日付＋時刻」を、時計の値（UTC のミリ秒）にする
const msOf = (date: string, hm: string) => Date.parse(`${date}T${hm}:00Z`) - JST


// 曜の書き方：`毎日`・`火・金`・`第1水`（その月の1回目の水曜）
function dayMatches(days: string, c: Clock): boolean {
  if (days === '毎日') return true
  return days.split('・').some(d => {
    const nth = /^第(\d)(.)$/.exec(d)
    if (nth) return nth[2] === c.youbi && Math.ceil(c.day / 7) === Number(nth[1])
    return d === c.youbi
  })
}

// 定例の「すること」から、どの項目の行か：合図の名前を含むもの（「燃えるごみを出す」→ ごみ、「…（合図は `運動`）」→ 運動）
function itemOf(what: string, names: string[]): string | undefined {
  return names.find(n => what.includes(`\`${n}\``)) ?? names.find(n => what.includes(n))
}

// 表示は短く：括弧の注釈と「を出す」などを落とす
function shortWhat(what: string): string {
  return what.replace(/（.*?）/g, '').replace(/を出す$/, '').trim()
}

async function readOr($: Engine, path: string): Promise<string> {
  try {
    return (await $.fs.read(path)) as string
  } catch {
    return ''
  }
}

/** フックの `$items = @('朝', '昼')` から合図の名前を取る。無ければ空 */
function hookItems(ps1: string): string[] {
  const m = /\$items\s*=\s*@\(([^)]*)\)/.exec(ps1)
  return m ? [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map(x => x[1] ?? '').filter(Boolean) : []
}

async function load($: Engine): Promise<Today | null> {
  const md = await readOr($, SEIKATSU)
  if (!md) return null
  const c = clockOf(await $.clock.now())

  const intervals = new Map<string, number>()
  for (const [name, days] of tableRows(md, '間隔')) {
    const n = Number(days)
    if (name && Number.isFinite(n)) intervals.set(name, n)
  }
  const lateFrom = new Map<string, string>()
  for (const [name, from, , days] of tableRows(md, '声かけ')) {
    if (name && from && /^\d{2}:\d{2}$/.test(from) && dayMatches(days ?? '', c)) lateFrom.set(name, from)
  }

  const log = (await readOr($, `${KIROKU_DIR}/${c.prevMonth}.md`)) + '\n' + (await readOr($, `${KIROKU_DIR}/${c.month}.md`))
  const lastAtToday = new Map<string, { hm: string; skipped: boolean }>()
  const lastDate = new Map<string, string>()
  for (const line of log.split(/\r?\n/)) {
    const m = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) (\S+)(?: (\S+))?/.exec(line)
    const [, date = '', hm = '', name = '', note = ''] = m ?? []
    if (!m || name.startsWith('通知:')) continue
    const skipped = note === SKIP
    // あとの行が勝つ：「なし」のあとに打ち直せば済に、済のあとに「なし」なら「なし」に
    if (date === c.date) lastAtToday.set(name, { hm, skipped })
    // 間隔（何日ごと）は、やった日だけで数える
    if (skipped) continue
    const before = lastDate.get(name)
    if (before === undefined || before < date) lastDate.set(name, date)
  }

  const daysSince = (date: string) =>
    Math.round((Date.parse(c.date) - Date.parse(date)) / (24 * 60 * 60 * 1000))

  // ボタンの項目：「## ボタン」の表（| 項目 | まとまり | なしの言い方 |）があればその順。無ければフックの合図の一覧。
  // どちらのあとにも「間隔」の表の項目を足す
  const buttons = tableBy(md, 'ボタン')
  const [bName, bGroup, bSkip] = [buttons.col('項目', 0), buttons.col('まとまり', 1), buttons.col('なし', 2)]
  const listed = buttons.rows.map(r => ({ name: r[bName] ?? '', group: r[bGroup] ?? '', skip: r[bSkip] ?? '' })).filter(b => b.name)
  const base = listed.length > 0 ? listed.map(b => b.name) : hookItems(await readOr($, HOOK))
  const names = [...new Set([...base, ...intervals.keys()])]

  // 今日の定例：項目に結び付くものはその行に、残りは「今日」に
  // 表の列は「| 曜 | すること | 時刻の目安 |」。順が変わっても見出しで引く
  // 時刻の書いてある定例（「17:20 に家を出る」「16:40 に準備開始」）は、カウントダウンの予定にもなる
  const planOf = new Map<string, string>()
  const plans: Plan[] = []
  const soon: Soon[] = []
  const teirei = tableBy(md, '定例')
  const [cDays, cWhat, cWhen] = [teirei.col('曜', 0), teirei.col('すること', 1), teirei.col('時刻', 2)]
  for (const row of teirei.rows) {
    const [days, what, when] = [row[cDays], row[cWhat], row[cWhen]]
    if (!what || !days || !dayMatches(days, c)) continue
    for (const timed of [timedOf(what), timedOf(when ?? '')]) {
      if (timed) soon.push({ what: timed.what, at: msOf(c.date, timed.hm), label: timed.hm })
    }
    const name = itemOf(what, names)
    const w = shortWhat(what)
    if (name === undefined) plans.push({ what: w, when: when ?? '' })
    else planOf.set(name, name === 'ごみ' ? `${w}・${when ?? ''}` : (when ?? ''))
  }
  // 声かけの表にある項目は、声かけが始まる時刻を「ここまでに」の目安として出す
  for (const [name, from] of lateFrom) if (!planOf.has(name)) planOf.set(name, `〜${from}`)

  const items: Item[] = names.map(name => {
    const done = lastAtToday.get(name)
    const at = done?.hm ?? null
    let isLate = false
    if (at === null) {
      const from = lateFrom.get(name)
      const every = intervals.get(name)
      const last = lastDate.get(name)
      if (from) isLate = c.hm >= from
      else if (every !== undefined) isLate = last === undefined || daysSince(last) >= every
    }
    const b = listed.find(x => x.name === name)
    return {
      name,
      at,
      skipped: done?.skipped ?? false,
      isLate,
      plan: planOf.get(name) ?? null,
      group: b?.group || (intervals.has(name) ? EVERY : DAILY),
      skipText: b?.skip || SKIP_LABEL,
    }
  })

  // 締め切り：SessionStart フックと同じ元（status/締め切り.md の「予定」、前からの形の status/学業.md の「個別」）。
  // 7日以内で、状態が済でないもの。時刻は「23:59まで」「16:50まで」から。書いてなければその日の 23:59
  const deadlineTables = [
    { table: tableBy(await readOr($, SHIMEKIRI), '予定'), what: 'やること', subjectAt: -1 },
    { table: tableBy(await readOr($, GAKUGYO), '個別'), what: '出すもの', subjectAt: 1 },
  ]
  for (const dt of deadlineTables) {
    const [gDate, gSubject, gWhat, gState] = [
      dt.table.col('日付', 0),
      dt.table.col('科目', dt.subjectAt),
      dt.table.col(dt.what, 2),
      dt.table.col('状態', 3),
    ]
    for (const row of dt.table.rows) {
      const [date = '', subject = '', what = '', state = ''] = [row[gDate], row[gSubject], row[gWhat], row[gState]]
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || state === '済') continue
      const days = -daysSince(date)
      if (days < 0 || days > 7) continue
      const until = /(\d{1,2})[:：](\d{2})\s*まで/.exec(what)
      const hm = until ? `${pad(Number(until[1]))}:${until[2]}` : '23:59'
      const short = what.replace(/（.*$/, '').trim()
      const d = new Date(Date.parse(date))
      soon.push({
        what: [subject, short].filter(Boolean).join(' '),
        at: msOf(date, hm),
        label: days === 0 ? hm : `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${'日月火水木金土'.charAt(d.getUTCDay())}）${hm}`,
      })
    }
  }
  soon.sort((a, b) => a.at - b.at)
  return { items, plans, soon }
}

// 読み直しに失敗しても、送信やターンは止めない（ペインが前のままになるだけ）
async function refresh($: Engine) {
  try {
    const next = await load($)
    await update($, today, () => next)
  } catch {}
}

export const register: Register = on => {
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    await refresh($)
    timer?.cancel()
    // 目安の時刻をまたいだら色を変えるため、1分ごとに読み直す
    timer = $.clock.every(60_000, () => void refresh($))
    await $.command.register({ name: 'kiroku', description: '生活の記録のペインを右に開く' })
    // ペインは頼まれずには開かない（組織図の下にも同じ記録がある）。/kiroku で開いたときだけ出る
    return next(e)
  })

  on('command.run', { command: 'kiroku' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'きろくのペインを開いた' }
  })

  // フックが記録を書いたあと（送信のあと）と、ターンの終わりに読み直す
  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // アイコンはデスクトップ等の表だけにある Svg で描く。ターミナルでは文字だけ
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const Ico = (props: { name: string; color: string; px?: number }) =>
      Svg ? (
        <Svg source={icon(props.name, props.color)} alt={props.name} width={props.px ?? ICON_PX} height={props.px ?? ICON_PX} />
      ) : null

    const t = await read($, today)
    if (t === null) {
      return <Text dimColor>status/生活.md のあるフォルダで開いたときに使える</Text>
    }
    const now = await $.clock.now()
    const c = clockOf(now)
    const p = await read($, picking)
    const f = await read($, flash)

    const open = (name: string) =>
      update($, picking, cur =>
        cur?.name === name ? null : { name, minutesAgo: 0, duration: name === '運動' ? 20 : null },
      )

    // 合図を送る。先に見た目を進める（楽観的更新）：フックの書き込みを待たずに行が済（または「なし」）になる
    const record = async (name: string, text: string, at: string, skipped: boolean) => {
      await update($, today, cur =>
        cur && { ...cur, items: cur.items.map(i => (i.name === name ? { ...i, at, skipped, isLate: false } : i)) },
      )
      await update($, picking, () => null)
      await update($, flash, () => ({ name, at, skipped }))
      $.clock.after(1600, () => void update($, flash, () => null))
      await $.prompt.submit({ text, asUser: true })
    }
    // ふだんは1回押すだけ：時刻を付けずに送れば、フックが「いま」で書く
    const recordNow = (name: string) => record(name, name, c.hm, false)

    // 「時刻・なし」：押した行のすぐ下に開く（段階的開示）。時刻を戻すか、しなかったと残すか
    const Picker = () => {
      if (p === null) return null
      const at = clockOf(now - p.minutesAgo * 60_000).hm
      const [hh = 0, mm = 0] = c.hm.split(':').map(Number)
      const sinceMidnight = hh * 60 + mm
      const shift = (by: number) =>
        update($, picking, cur =>
          cur && { ...cur, minutesAgo: Math.min(sinceMidnight, Math.max(0, cur.minutesAgo + by)) },
        )
      const send = () =>
        record(p.name, [p.name, at, p.duration !== null ? `${p.duration}分` : ''].filter(Boolean).join(' '), at, false)
      const skip = () => record(p.name, `${p.name} ${SKIP}`, c.hm, true)

      return (
        <Box flexDirection="column" gap="sm" paddingLeft={3} paddingY={1}>
          <Box flexDirection="row" alignItems="center" gap="sm">
            <Text size="title" bold>
              {at}
            </Text>
            <Text dimColor size="caption">
              {p.minutesAgo === 0 ? 'いま' : `${p.minutesAgo}分前`}
            </Text>
          </Box>
          <Box flexDirection="row" alignItems="center" gap="xs" flexWrap="wrap">
            {STEPS.map(m => (
              <Button key={`back-${m}`} variant="secondary" onPress={() => shift(m)}>{`−${m}分`}</Button>
            ))}
            <Button key="now" variant="secondary" dimColor={p.minutesAgo === 0} onPress={() => shift(-sinceMidnight)}>
              いま
            </Button>
          </Box>
          {p.duration !== null && (
            <Box flexDirection="row" alignItems="center" gap="xs" flexWrap="wrap">
              <Text dimColor size="caption">
                長さ
              </Text>
              {DURATIONS.map(d => (
                <Button
                  key={`dur-${d}`}
                  variant={p.duration === d ? 'primary' : 'secondary'}
                  dimColor={p.duration !== d}
                  onPress={() => update($, picking, cur => cur && { ...cur, duration: d })}
                >{`${d}分`}</Button>
              ))}
            </Box>
          )}
          <Box flexDirection="row" alignItems="center" gap="xs" flexWrap="wrap">
            <Button key="send" variant="primary" autoFocus onPress={send}>
              この時刻で記録
            </Button>
            <Button key="skip" variant="secondary" onPress={skip}>
              {t.items.find(i => i.name === p.name)?.skipText ?? SKIP_LABEL}
            </Button>
            <Button key="cancel" variant="secondary" dimColor onPress={() => update($, picking, () => null)}>
              やめる
            </Button>
          </Box>
        </Box>
      )
    }

    // 1行＝1項目。左にアイコン、右に状態（済の時刻／なし／まだ／目安超え）。色は合図にだけ使う（目安超え＝橙）
    // まだの行は押せば「いま」で記録。済の行を押すと、二重に送らずに直す欄が開く
    const Row = ({ item }: { item: Item }) => {
      const isFlashing = f?.name === item.name
      const isOpen = p?.name === item.name
      const isDone = item.at !== null
      // 済なら記録した時刻だけ。まだなら今日の目安（「〜10:00」「燃えるごみ・日没後〜0時」）を先に
      const status = isDone
        ? item.skipped
          ? `${SKIP}（${item.at}）`
          : item.at
        : [item.plan, item.isLate ? '目安超え' : item.plan === null ? 'まだ' : ''].filter(Boolean).join(' · ')
      return (
        <Box key={`row-${item.name}`} flexDirection="column">
          {/* ペインが細いとき（組織図と並んで幅を詰められたとき）は「時刻・なし」が次の行に回る */}
          <Box flexDirection="row" alignItems="center" gap="sm" flexWrap="wrap">
            {isFlashing && Svg ? (
              <Svg source={checkDraw(ACCENT)} alt="記録した" width={ICON_PX} height={ICON_PX} isInteractive />
            ) : (
              <Ico name={isDone ? (item.skipped ? SKIP : '済') : item.name} color={item.isLate ? ACCENT : GRAY} />
            )}
            <Button
              key={`kiroku-${item.name}`}
              plain
              dimColor={isDone && !isOpen}
              onPress={() => (isDone || isOpen ? open(item.name) : recordNow(item.name))}
            >
              <Text bold={isOpen} color={item.isLate ? 'claude' : undefined}>
                {item.name}
              </Text>
              <Text dimColor={!item.isLate} color={item.isLate ? 'claude' : undefined} size="caption">
                {`  ${isFlashing ? '記録しました' : status}`}
              </Text>
            </Button>
            <Box flexGrow={1} />
            {!isOpen && (
              <Button key={`more-${item.name}`} plain dimColor onPress={() => open(item.name)}>
                <Text size="caption">{isDone ? '直す' : '時刻・なし'}</Text>
              </Button>
            )}
          </Box>
          {isOpen && <Picker />}
        </Box>
      )
    }

    // いちばん上：次の予定までの残り。過ぎたら次の予定へ（1分ごとの読み直しで描き直る）。残りが短いと橙にするだけ
    const Countdown = () => {
      const next = t.soon.find(s => s.at > now)
      if (next === undefined) return null
      const mins = Math.ceil((next.at - now) / 60_000)
      const left =
        mins < 24 * 60 ? `${Math.floor(mins / 60)}:${pad(mins % 60)}` : `${Math.floor(mins / 1440)}日 ${Math.floor((mins % 1440) / 60)}時間`
      const color = mins <= SOON_MIN ? 'claude' : undefined
      return (
        <Box flexDirection="column" gap="xs">
          <Text size="heading" bold color={color}>
            {next.what}
          </Text>
          <Box flexDirection="row" alignItems="center" gap="sm" flexWrap="wrap">
            <Text size="title" bold color={color}>
              {`あと ${left}`}
            </Text>
            <Text dimColor size="caption">
              {next.label}
            </Text>
          </Box>
        </Box>
      )
    }

    const groups = [...new Set(t.items.map(i => i.group))].map(title => ({
      title,
      items: t.items.filter(i => i.group === title),
    }))

    return (
      <Box flexDirection="column" gap="md" paddingX={1}>
        <Countdown />
        <Box flexDirection="row" alignItems="center" gap="sm">
          <Ico name="時計" color={GRAY} />
          <Text dimColor size="caption">
            {`${c.date.slice(5).replace('-', '/')}（${c.youbi}）  ${c.hm}`}
          </Text>
        </Box>
        <Text dimColor size="footnote">
          名前を押すと、いまの時刻で記録
        </Text>
        {t.plans.length > 0 && (
          <Box flexDirection="column" gap="xs">
            <Text dimColor size="footnote">
              今日
            </Text>
            {t.plans.map(pl => (
              <Box key={`plan-${pl.what}`} flexDirection="row" gap="sm" paddingLeft={3}>
                <Text>{pl.what}</Text>
                <Text dimColor size="caption">
                  {pl.when}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        {groups.map(g => (
          <Box key={`g-${g.title}`} flexDirection="column" gap="xs">
            <Text dimColor size="footnote">
              {g.title}
            </Text>
            {g.items.map(item => (
              <Row item={item} />
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
