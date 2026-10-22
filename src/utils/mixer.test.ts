import { describe, expect, it, vi } from 'vitest'
import { alphaTabMixFor, applyAlphaTabMix, isBassTrack, mixFromMediaSettings, songVolumeFromPlayerVolume, splitTracks, youtubeVolumeFor } from './mixer'

const mix = { songVolume: 65, bassVolume: 40, masterVolume: 50, songMuted: false, bassMuted: false }
const bass = { playbackInfo: { program: 32 } }
const guitar = { staves: [{ tuning: [40, 45, 50, 55, 59, 64] }] }
const drums = { playbackInfo: { program: 32 }, staves: [{ isPercussion: true, tuning: [20] }] }

describe('mixer', () => {
  it('保存設定に既定値とクランプを適用する', () => {
    expect(mixFromMediaSettings({})).toEqual({ songVolume: 100, bassVolume: 100, masterVolume: 100, songMuted: false, bassMuted: false })
    expect(mixFromMediaSettings({ volume: -5, bassVolume: 150, masterVolume: 33.6, muted: true, tabMuted: true }))
      .toEqual({ songVolume: 0, bassVolume: 100, masterVolume: 34, songMuted: true, bassMuted: true })
    expect(mixFromMediaSettings({ volume: NaN, bassVolume: Infinity }).songVolume).toBe(100)
    expect(mixFromMediaSettings({ bassVolume: Infinity }).bassVolume).toBe(100)
  })

  it('YouTube の音量を整数で計算し、ミュートとは独立させる', () => {
    expect(youtubeVolumeFor(mix)).toBe(33)
    expect(youtubeVolumeFor({ ...mix, songMuted: true })).toBe(33)
    expect(youtubeVolumeFor({ ...mix, masterVolume: 0 })).toBe(0)
    expect(youtubeVolumeFor({ ...mix, songVolume: 300 })).toBe(100)
  })

  it('プレイヤーの音量を逆算し、マスター 0 では更新しない', () => {
    expect(songVolumeFromPlayerVolume(32, 50)).toBe(64)
    expect(songVolumeFromPlayerVolume(10, 30)).toBe(33)
    expect(songVolumeFromPlayerVolume(90, 50)).toBe(100)
    expect(songVolumeFromPlayerVolume(-10, 50)).toBe(0)
    expect(songVolumeFromPlayerVolume(10, 0)).toBeNull()
    expect(songVolumeFromPlayerVolume(10, -1)).toBeNull()
  })

  it('alphaTab のマスターと個別音量・ミュートを計算する', () => {
    expect(alphaTabMixFor(mix)).toEqual({ master: .5, bass: .4, other: .65 })
    expect(alphaTabMixFor({ ...mix, songMuted: true })).toEqual({ master: .5, bass: .4, other: 0 })
    expect(alphaTabMixFor({ ...mix, bassMuted: true, masterVolume: 0 })).toEqual({ master: 0, bass: 0, other: .65 })
  })

  it('GM プログラムと有限数チューニングでベースを検出する', () => {
    for (const program of [32, 39]) expect(isBassTrack({ playbackInfo: { program } })).toBe(true)
    for (const program of [31, 40, '32', Infinity]) expect(isBassTrack({ playbackInfo: { program } })).toBe(false)
    expect(isBassTrack({ staves: [{ tuning: [28, 33, 38, 43] }] })).toBe(true)
    for (const tuning of [[], [55], [NaN], [Infinity], ['28'], null]) {
      expect(isBassTrack({ staves: [{ tuning }] })).toBe(false)
    }
    expect(isBassTrack(drums)).toBe(false)
    expect(isBassTrack({ staves: [...drums.staves, { tuning: [40] }] })).toBe(true)
    expect(isBassTrack(guitar)).toBe(false)
    expect(isBassTrack(null)).toBe(false)
  })

  it('検出したベースとその他のトラックを分離する', () => {
    expect(splitTracks({ tracks: [guitar, bass, drums] })).toEqual({ bass: [bass], other: [guitar, drums] })
  })

  it('ベース未検出時は唯一の非打楽器トラックを代用する', () => {
    expect(splitTracks({ tracks: [guitar] })).toEqual({ bass: [guitar], other: [] })
    expect(splitTracks({ tracks: [drums, guitar] })).toEqual({ bass: [guitar], other: [drums] })
  })

  it('ギターが複数ある場合や打楽器のみの場合は代用しない', () => {
    const secondGuitar = { staves: [{ tuning: [40, 45, 50, 55, 59, 64] }] }
    expect(splitTracks({ tracks: [guitar, secondGuitar] })).toEqual({ bass: [], other: [guitar, secondGuitar] })
    expect(splitTracks({ tracks: [drums] })).toEqual({ bass: [], other: [drums] })
  })

  it('トラックがなければ空の配列を返す', () => {
    for (const score of [null, {}, { tracks: [] }, { tracks: 'invalid' }]) {
      expect(splitTracks(score)).toEqual({ bass: [], other: [] })
    }
  })

  it('API にマスターとトラック音量を適用する', () => {
    const api = { masterVolume: 1, score: { tracks: [bass, guitar] }, changeTrackVolume: vi.fn() }
    applyAlphaTabMix(api, alphaTabMixFor(mix))
    expect(api.masterVolume).toBe(.5)
    expect(api.changeTrackVolume.mock.calls).toEqual([[[bass], .4], [[guitar], .65]])
    api.changeTrackVolume.mockClear()
    api.score.tracks = [bass]
    applyAlphaTabMix(api, alphaTabMixFor(mix))
    expect(api.changeTrackVolume).toHaveBeenCalledTimes(1)
    api.score.tracks = []
    api.changeTrackVolume.mockClear()
    applyAlphaTabMix(api, alphaTabMixFor(mix))
    expect(api.changeTrackVolume).not.toHaveBeenCalled()
  })

  it('スコア・メソッドがなくても適用し、API の例外を吸収する', () => {
    const api = { changeTrackVolume: vi.fn() }
    applyAlphaTabMix(api, alphaTabMixFor(mix))
    expect(api.changeTrackVolume).not.toHaveBeenCalled()
    for (const target of [null, {}, { score: { tracks: [bass] } }, { set masterVolume(_: number) { throw new Error('destroyed') } }, { score: { tracks: [bass] }, changeTrackVolume() { throw new Error('destroyed') } }]) {
      expect(() => applyAlphaTabMix(target, alphaTabMixFor(mix))).not.toThrow()
    }
  })
})
