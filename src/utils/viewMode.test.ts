import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALPHATAB_DEFAULT_RHYTHM_HEIGHT, TAB_RHYTHM_HEIGHT,
  DEFAULT_VIEW_MODE, VIEW_MODES, VIEW_MODE_LABELS, VIEW_MODE_STORAGE_KEY,
  applyViewModeToSettings, isViewMode, loadViewMode, prepareBassScoreForNotation,
  saveViewMode, viewModeOptions,
} from './viewMode'

describe('表示モードの保存', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('未設定では既定値を返す', () => {
    expect(DEFAULT_VIEW_MODE).toBe('tab-rhythm')
    expect(loadViewMode()).toBe(DEFAULT_VIEW_MODE)
    expect(VIEW_MODES).toEqual(['tab-rhythm', 'score-tab', 'tab-only'])
    expect(VIEW_MODE_LABELS).toEqual({
      'tab-rhythm': 'TAB+リズム', 'score-tab': '五線譜+TAB', 'tab-only': 'TABのみ',
    })
  })

  it.each(['', 'invalid', '"tab-only"', 'TAB-ONLY'])('不正な保存値 %s は既定値になる', value => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, value)
    expect(loadViewMode()).toBe(DEFAULT_VIEW_MODE)
  })

  it('不明な型を表示モードと判定しない', () => {
    for (const value of [null, undefined, 0, {}, [], true]) expect(isViewMode(value)).toBe(false)
  })

  it.each(VIEW_MODES)('%s を文字列で保存・復元する', mode => {
    expect(isViewMode(mode)).toBe(true)
    saveViewMode(mode)
    expect(localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe(mode)
    expect(loadViewMode()).toBe(mode)
  })

  it('読み書きの例外を処理する', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
    expect(loadViewMode()).toBe(DEFAULT_VIEW_MODE)
    expect(() => saveViewMode('score-tab')).not.toThrow()
  })
})

describe('alphaTab の表示設定', () => {
  const cases = [
    ['tab-rhythm', { staveProfile: 3, rhythmMode: 2, rhythmHeight: 30 }],
    ['score-tab', { staveProfile: 1, rhythmMode: 0, rhythmHeight: 25 }],
    ['tab-only', { staveProfile: 3, rhythmMode: 0, rhythmHeight: 25 }],
  ] as const

  it.each(cases)('%s を数値設定に変換する', (mode, options) => {
    expect(viewModeOptions(mode)).toEqual(options)
    const elements = new Map([[99, true], [12, false]])
    const settings = { display: { staveProfile: 0 }, notation: { rhythmMode: 3, rhythmHeight: 0, elements } }
    applyViewModeToSettings(settings, mode)
    expect(settings.display.staveProfile).toBe(options.staveProfile)
    expect(settings.notation.rhythmMode).toBe(options.rhythmMode)
    expect(settings.notation.rhythmHeight).toBe(options.rhythmHeight)
    expect(settings.notation.elements).toBe(elements)
    expect([...elements]).toEqual([[99, true], [12, false]])
  })

  it.each([undefined, null, {}, []])('既存の elements を変更しない (%s)', elements => {
    const settings = { display: {}, notation: { elements } }
    applyViewModeToSettings(settings, 'tab-rhythm')
    expect(settings.notation.elements).toBe(elements)
  })

  it.each(VIEW_MODES)('%s で未設定の elements を作成しない', mode => {
    const settings = { display: {}, notation: {} }
    applyViewModeToSettings(settings, mode)
    expect(settings.notation).not.toHaveProperty('elements')
  })

  it.each([{}, { display: {} }, { notation: {} }])('未設定の display と notation を作成する (%s)', initial => {
    const settings: any = initial
    applyViewModeToSettings(settings, 'tab-rhythm')
    expect(settings).toEqual({
      display: { staveProfile: 3 },
      notation: { rhythmMode: 2, rhythmHeight: 30 },
    })
  })

  it('TAB のリズム表示から TAB のみに切り替えると高さを既定値に戻す', () => {
    expect(TAB_RHYTHM_HEIGHT).toBe(30)
    expect(ALPHATAB_DEFAULT_RHYTHM_HEIGHT).toBe(25)
    const settings = { display: {}, notation: { rhythmHeight: 0 } }
    applyViewModeToSettings(settings, 'tab-rhythm')
    expect(settings.notation.rhythmHeight).toBe(30)
    applyViewModeToSettings(settings, 'tab-only')
    expect(settings.notation.rhythmHeight).toBe(25)
  })
})

describe('ベース五線譜の準備', () => {
  function scoreFor(staff: object, program = 25) {
    return { tracks: [{ playbackInfo: { program }, staves: [staff] }] }
  }

  it('低音チューニングの G2 を F4 にし、他の音部記号を保つ', () => {
    const staff = { tuning: [43, 38, 33, 28], bars: [{ clef: 4 }, { clef: 3 }, { clef: 1 }], displayTranspositionPitch: 0 }
    prepareBassScoreForNotation(scoreFor(staff))
    expect(staff.bars).toEqual([{ clef: 3 }, { clef: 3 }, { clef: 1 }])
    expect(staff.displayTranspositionPitch).toBe(-12)
  })

  it.each([32, 39])('プログラム %s でもベースを判定する', program => {
    const staff = { bars: [{ clef: 4 }], displayTranspositionPitch: undefined }
    prepareBassScoreForNotation(scoreFor(staff, program))
    expect(staff.bars[0].clef).toBe(3)
    expect(staff.displayTranspositionPitch).toBe(-12)
  })

  it.each([
    [64, 59, 55, 50, 45, 40],
    [64, 59, 55, 50, 45, 38],
    [64, 59, 55, 50, 45, 40, 35],
    [59, 54, 50, 45, 40, 35],
    [55, 38, 33, 28],
  ])('ギターや最高音が G3 以上のチューニングは変更しない (%s)', (...tuning) => {
    const staff = { tuning, bars: [{ clef: 4 }], displayTranspositionPitch: 0 }
    const original = structuredClone(staff)
    prepareBassScoreForNotation(scoreFor(staff))
    expect(staff).toEqual(original)
  })

  it.each([
    [43, 38, 33, 28, 23],
    [48, 43, 38, 33, 28, 23],
  ])('多弦ベースをチューニングで判定する (%s)', (...tuning) => {
    const staff = { tuning, bars: [{ clef: 4 }], displayTranspositionPitch: 0 }
    prepareBassScoreForNotation(scoreFor(staff))
    expect(staff.bars[0].clef).toBe(3)
    expect(staff.displayTranspositionPitch).toBe(-12)
  })

  it('既存の F4 と実音の表示移調を変更しない', () => {
    const staff = { bars: [{ clef: 3 }], displayTranspositionPitch: 0 }
    const original = structuredClone(staff)
    prepareBassScoreForNotation(scoreFor(staff, 33))
    expect(staff).toEqual(original)
  })

  it.each([-12, 7])('G2 を変換しても既存の表示移調 %s を維持する', displayTranspositionPitch => {
    const staff = { bars: [{ clef: 4 }], displayTranspositionPitch }
    prepareBassScoreForNotation(scoreFor(staff, 33))
    expect(staff.bars[0].clef).toBe(3)
    expect(staff.displayTranspositionPitch).toBe(displayTranspositionPitch)
  })

  it.each([[], [28, NaN], [28, Infinity], [28, 'bad'], 'bad'].map(tuning => ({ tuning })))('不正なチューニングは変更しない ($tuning)', ({ tuning }) => {
    const staff = { tuning, bars: [{ clef: 4 }], displayTranspositionPitch: 0 }
    const original = structuredClone(staff)
    prepareBassScoreForNotation(scoreFor(staff))
    expect(staff).toEqual(original)
  })

  it('打楽器は変更しない', () => {
    const staff = { isPercussion: true, tuning: [28], bars: [{ clef: 4 }], displayTranspositionPitch: 0 }
    const original = structuredClone(staff)
    prepareBassScoreForNotation(scoreFor(staff, 33))
    expect(staff).toEqual(original)
  })

  it('繰り返しても移調を重ねず、既存の移調も維持する', () => {
    const staff = { tuning: [28], bars: [{ clef: 4 }], displayTranspositionPitch: undefined as number | undefined }
    const score = scoreFor(staff)
    prepareBassScoreForNotation(score)
    const original = structuredClone(staff)
    prepareBassScoreForNotation(score)
    expect(staff).toEqual(original)
    expect(staff.displayTranspositionPitch).toBe(-12)
    staff.displayTranspositionPitch = 0
    prepareBassScoreForNotation(score)
    expect(staff.displayTranspositionPitch).toBe(0)
  })

  it('空・不正な構造でも例外を出さない', () => {
    for (const score of [undefined, null, {}, [], 42, { tracks: {} }, {
      tracks: [null, 1, {}, { staves: {} }, { staves: [null, 1, {}, { tuning: [28, 'bad'] }, { tuning: [] }] },
        { playbackInfo: { program: 32 }, staves: [{ bars: [null, 1, {}] }, { bars: {} }] }],
    }]) {
      expect(() => prepareBassScoreForNotation(score)).not.toThrow()
    }
  })
})
