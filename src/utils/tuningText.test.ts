import { describe, expect, it } from 'vitest'
import { parseTuningText } from './tuningText'

describe('parseTuningText', () => {
  it('空文字と Standard はスタンダード', () => {
    expect(parseTuningText('', 4)).toEqual({ tuning: 'E1 A1 D2 G2', label: 'スタンダード' })
    expect(parseTuningText('Standard tuning', 4)).toEqual({ tuning: 'E1 A1 D2 G2', label: 'スタンダード' })
    expect(parseTuningText('Standard tuning', 5)).toEqual({ tuning: 'B0 E1 A1 D2 G2', label: 'スタンダード' })
  })

  it('半音下げ', () => {
    expect(parseTuningText('Tune down 1/2 step', 4)).toEqual({ tuning: 'D#1 G#1 C#2 F#2', label: '半音下げ' })
    expect(parseTuningText('Tune down 1/2 step', 5)).toEqual({ tuning: 'A#0 D#1 G#1 C#2 F#2', label: '半音下げ' })
  })

  it('半音下げ + 弦ごとの記載があってもチューニングは進まない', () => {
    expect(parseTuningText('Tune down 1/2 step (1) = G b (2) = D b (3) = A b (4) = E b', 4).tuning).toBe('D#1 G#1 C#2 F#2')
    // macOS 風に臨時記号グリフが消えた場合も元の音を残す
    expect(parseTuningText('Tune down 1/2 step = G = D = A = E', 4).tuning).toBe('D#1 G#1 C#2 F#2')
  })

  it('全音下げ', () => {
    expect(parseTuningText('Tune down 1 step (1) = F (2) = C (3) = G (4) = D', 4)).toEqual({
      tuning: 'D1 G1 C2 F2',
      label: '全音下げ',
    })
  })

  it('Drop D の各種表記', () => {
    for (const text of ['Drop D', 'Dropped D (4) = D', 'Dropped D = D']) {
      expect(parseTuningText(text, 4)).toEqual({ tuning: 'D1 A1 D2 G2', label: 'ドロップD' })
    }
  })

  it('Drop D + 半音下げ', () => {
    expect(parseTuningText('Dropped D tune down 1/2 step = G = D = A = D', 4)).toEqual({
      tuning: 'C#1 G#1 C#2 F#2',
      label: 'ドロップD 半音下げ',
    })
  })

  it('Drop C', () => {
    expect(parseTuningText('Drop C', 4).tuning).toBe('C1 G1 C2 F2')
    expect(parseTuningText('Dropped C (1) = F (2) = C (3) = G (4) = C', 4).tuning).toBe('C1 G1 C2 F2')
  })

  it('Dropped B', () => {
    expect(parseTuningText('Dropped B (1) = E (2) = B (3) = G b (4) = B', 4).tuning).toBe('B0 F#1 B1 E2')
  })

  it('弦ごとの入力のみ', () => {
    expect(parseTuningText('(1) = E b (2) = B b (3) = F (4) = B b', 4).tuning).toBe('A#0 F1 A#1 D#2')
  })

  it('弦ごとの入力のみの場合は臨時記号のない音名もそのまま使う', () => {
    expect(parseTuningText('(4) = F', 4).tuning).toBe('F1 A1 D2 G2')
    expect(parseTuningText('(1) = F (2) = C (3) = G (4) = D', 4).tuning).toBe('D1 G1 C2 F2')
  })

  it('明示弦番号で弦数を伸ばす', () => {
    expect(parseTuningText('(5) = A #', 4).tuning).toBe('A#0 E1 A1 D2 G2')
    expect(parseTuningText('(5) = G #', 4).tuning).toBe('G#0 E1 A1 D2 G2')
  })

  it('テンポ表記はチューニングにしない', () => {
    expect(parseTuningText('= 120', 4)).toEqual({ tuning: 'E1 A1 D2 G2', label: 'スタンダード' })
  })

  it('Eb standard / D standard', () => {
    expect(parseTuningText('Eb standard', 4)).toEqual({ tuning: 'D#1 G#1 C#2 F#2', label: '半音下げ' })
    expect(parseTuningText('D standard', 4).tuning).toBe('D1 G1 C2 F2')
  })

  it('REGRESSION: 半音下げ・全音下げを Drop D にしない', () => {
    for (const text of ['Tune down 1/2 step', 'Tune down 1 step']) {
      expect(parseTuningText(text, 4)).not.toEqual({ tuning: 'D1 A1 D2 G2', label: 'ドロップD' })
    }
  })
})
