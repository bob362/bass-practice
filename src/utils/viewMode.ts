export type ViewMode = 'tab-rhythm' | 'score-tab' | 'tab-only'

export const VIEW_MODES: readonly ViewMode[] = ['tab-rhythm', 'score-tab', 'tab-only']
export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  'tab-rhythm': 'TAB+リズム',
  'score-tab': '五線譜+TAB',
  'tab-only': 'TABのみ',
}
export const DEFAULT_VIEW_MODE: ViewMode = 'tab-rhythm'
export const VIEW_MODE_STORAGE_KEY = 'bass_practice_view_mode'

/** 表示モードとして有効か判定する。 */
export function isViewMode(v: unknown): v is ViewMode {
  return VIEW_MODES.some(mode => mode === v)
}

/** 端末内の表示設定を読み込み、未設定時は既定値を返す。 */
export function loadViewMode(): ViewMode {
  try {
    const value = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return isViewMode(value) ? value : DEFAULT_VIEW_MODE
  } catch {
    return DEFAULT_VIEW_MODE
  }
}

/** 表示設定を端末内に保存する。 */
export function saveViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    // ストレージが利用できない場合は保存を省略する。
  }
}

export interface AlphaTabViewOptions {
  staveProfile: number
  rhythmMode: number
  rhythmHeight: number
}

export const TAB_RHYTHM_HEIGHT = 30
export const ALPHATAB_DEFAULT_RHYTHM_HEIGHT = 25

/** alphaTab の実行時列挙値に表示モードを変換する。 */
export function viewModeOptions(mode: ViewMode): AlphaTabViewOptions {
  switch (mode) {
    case 'tab-rhythm':
      // 2 (ShowWithBars) は連桁を描画し、1 (ShowWithBeams) は拍ごとの符尾のみを描画する。
      return { staveProfile: 3, rhythmMode: 2, rhythmHeight: TAB_RHYTHM_HEIGHT }
    case 'score-tab':
      return { staveProfile: 1, rhythmMode: 0, rhythmHeight: ALPHATAB_DEFAULT_RHYTHM_HEIGHT }
    case 'tab-only':
      return { staveProfile: 3, rhythmMode: 0, rhythmHeight: ALPHATAB_DEFAULT_RHYTHM_HEIGHT }
  }
}

/** 表示設定のみを変更し、再描画は呼び出し元に任せる。 */
export function applyViewModeToSettings(settings: any, mode: ViewMode): void {
  const options = viewModeOptions(mode)
  settings.display ??= {}
  settings.notation ??= {}
  settings.display.staveProfile = options.staveProfile
  settings.notation.rhythmMode = options.rhythmMode
  settings.notation.rhythmHeight = options.rhythmHeight
}

/**
 * GM ベース (32〜39) または最高開放弦が G3 (55) 未満の有限数チューニングをベースと判定する。
 * 打楽器を除き G2 から F4 に変換し、その呼び出しで変換した譜表のみ未設定・0 の表示移調を -12 にする。
 * 既存のヘ音記号・移調は保持し、繰り返し呼び出しても変更を重ねない。
 */
export function prepareBassScoreForNotation(score: any): void {
  if (!Array.isArray(score?.tracks)) return
  for (const track of score.tracks) {
    if (!Array.isArray(track?.staves)) continue
    const program = track.playbackInfo?.program
    const bassProgram = typeof program === 'number' && program >= 32 && program <= 39
    for (const staff of track.staves) {
      if (!staff || typeof staff !== 'object' || staff.isPercussion) continue
      const tuning = staff.tuning
      const bassTuning = Array.isArray(tuning) && tuning.length > 0
        && tuning.every((pitch: unknown) => typeof pitch === 'number' && Number.isFinite(pitch))
        && Math.max(...tuning) < 55
      if (!bassTuning && !bassProgram) continue
      let converted = false
      if (Array.isArray(staff.bars)) {
        for (const bar of staff.bars) {
          if (bar && typeof bar === 'object' && bar.clef === 4) {
            bar.clef = 3
            converted = true
          }
        }
      }
      if (converted && (staff.displayTranspositionPitch === 0 || staff.displayTranspositionPitch === undefined)) {
        staff.displayTranspositionPitch = -12
      }
    }
  }
}
