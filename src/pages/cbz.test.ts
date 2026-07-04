import { describe, it, expect } from 'vitest'
import { orderCbzImageNames, IMAGE_RE } from './cbz'

describe('orderCbzImageNames', () => {
  it('natural-sorts so page2 comes before page10 (not lexicographic)', () => {
    expect(orderCbzImageNames(['page10.jpg', 'page2.jpg', 'page1.jpg'])).toEqual([
      'page1.jpg',
      'page2.jpg',
      'page10.jpg',
    ])
  })

  it('keeps only image files — drops ComicInfo.xml, thumbs, folders', () => {
    expect(
      orderCbzImageNames(['ComicInfo.xml', 'Thumbs.db', '001.png', 'sub/', '002.webp']),
    ).toEqual(['001.png', '002.webp'])
  })

  it('is case-insensitive on both extension and name ordering', () => {
    expect(orderCbzImageNames(['B.JPEG', 'a.jpg', 'C.PNG'])).toEqual(['a.jpg', 'B.JPEG', 'C.PNG'])
  })

  it('handles nested paths and mixed extensions', () => {
    expect(
      orderCbzImageNames(['ch1/p10.gif', 'ch1/p2.avif', 'ch1/p1.bmp']),
    ).toEqual(['ch1/p1.bmp', 'ch1/p2.avif', 'ch1/p10.gif'])
  })

  it('returns empty when there are no images', () => {
    expect(orderCbzImageNames(['readme.txt', 'ComicInfo.xml'])).toEqual([])
  })
})

describe('IMAGE_RE', () => {
  it('accepts the comic image formats and rejects others', () => {
    for (const ok of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.avif', 'a.bmp']) {
      expect(IMAGE_RE.test(ok)).toBe(true)
    }
    for (const no of ['a.xml', 'a.txt', 'a.pdf', 'a.jpg.txt', 'a']) {
      expect(IMAGE_RE.test(no)).toBe(false)
    }
  })
})
