/** ボタン1つ分：今日の最後の記録の時刻、それが「なし」（しなかった）か、目安を過ぎているか、今日やる時間の目安（定例・声かけの表から） */
export type Item = {
  name: string
  at: string | null
  skipped: boolean
  isLate: boolean
  plan: string | null
  /** 見出し（「## ボタン」の表のまとまり。無ければ「毎日」か「何日かごと」） */
  group: string
  /** 「しなかった」のボタンの言い方（「## ボタン」の表。無ければ「今日はなし」） */
  skipText: string
}

/** 項目に結び付かない今日の定例（歩く・家を出る など） */
export type Plan = { what: string; when: string }

/** カウントダウンの予定1つ：時刻の書いてある今日の定例か、7日以内の課題の締め切り。at は時計の値（ミリ秒）、label は見せる時刻 */
export type Soon = { what: string; at: number; label: string }

export type Today = { items: Item[]; plans: Plan[]; soon: Soon[] }

/** 「時刻・なし」を開いている項目：今から何分前か、運動なら何分やったか */
export type Picking = { name: string; minutesAgo: number; duration: number | null }

/** 記録した直後の手ごたえ（チェックが描かれる1.6秒） */
export type Flash = { name: string; at: string; skipped: boolean }

declare module 'claude-code' {
  interface PluginState {
    'kiroku-botan': { today: Today | null; picking: Picking | null; flash: Flash | null }
  }
}
