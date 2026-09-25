import { describe, expect, it } from 'vitest'
import { detectImageType } from '../../app/lib/image-type'

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap(v => (typeof v === 'string' ? [...Buffer.from(v)] : [v])))

describe('detectImageType', () => {
  it('erkennt PNG, JPEG und WebP am Inhalt', () => {
    expect(detectImageType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toEqual({ extension: 'png', mime: 'image/png' })
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ extension: 'jpg', mime: 'image/jpeg' })
    expect(detectImageType(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '))).toEqual({ extension: 'webp', mime: 'image/webp' })
  })

  it('lehnt SVG, HTML, GIF, RIFF ohne WEBP und Leeres ab', () => {
    for (const input of [
      bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      bytes('<!DOCTYPE html><html>'),
      bytes('GIF89a'),
      bytes('RIFF', 0, 0, 0, 0, 'WAVE'),
      bytes(0x89, 'PN'),
      new Uint8Array()
    ]) {
      expect(detectImageType(input)).toBeNull()
    }
  })
})
