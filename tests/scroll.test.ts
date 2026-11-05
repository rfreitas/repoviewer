import { describe, expect, test } from 'claude-code/testing'

import type { NavProps } from '../types'
import { fromText } from '../hooks/editor'
import { fileKey, initFile, syncFile } from '../hooks/navfile'
import { layoutTable } from '../hooks/table'

const TEXT = Array.from({ length: 300 }, (_, i) => `const line${i} = ${i}`).join('\n') + '\n'

const props = (scroll: number): NavProps => ({
  mode: 'file',
  columns: 60,
  rows: 20,
  surface: 'terminal',
  cursor: 'a.ts',
  cursorAt: 0,
  lineAt: 0,
  scroll,
  file: {
    path: 'a.ts', kind: 'text', text: TEXT, startLine: 1, page: 0, pageCount: 1, lineCount: 300, size: TEXT.length,
    mtimeMs: 1, isEditable: true, isRaw: false, showDiff: false, isTouched: false,
  },
})

describe('scrolling by the wheel', () => {
  test('a rise in the running total moves the window by that many lines, and the cursor stays inside it', () => {
    const opened = initFile(props(0))
    expect(opened.top).toBe(1)

    const down = syncFile(opened, props(90))
    expect(down.top).toBe(91)
    expect(down.line).toBeGreaterThanOrEqual(down.top)

    const back = syncFile(down, props(60))
    expect(back.top).toBe(61)
  })

  test('the window stops at the ends of the file', () => {
    const opened = initFile(props(0))
    expect(syncFile(opened, props(-30)).top).toBe(1)
    expect(syncFile(opened, props(10_000)).top).toBeLessThanOrEqual(300)
  })

  test('a file opened late does not replay the scroll that came before it', () => {
    expect(initFile(props(90)).top).toBe(1)
  })
})

// Rendered markdown: a paragraph is one source line however many rows it wraps to.
const WORDS = Array.from({ length: 60 }, () => 'word').join(' ')

const markdown = (text: string, scroll: number): NavProps => ({
  ...props(scroll),
  file: { ...props(scroll).file!, path: 'a.md', kind: 'markdown', text, lineCount: text.split('\n').length },
})

describe('scrolling rendered markdown by rows', () => {
  // 60 words in a 58 cell page: eleven to a row, six rows.
  const page = ['# T', '', WORDS, '', 'tail', ''].join('\n')

  test('a long paragraph goes by a row at a time, not all at once', () => {
    const opened = initFile(markdown(page, 0))
    expect(opened.top).toBe(1)
    // The heading goes whole; then the paragraph's six rows one by one; then on.
    expect(syncFile(opened, markdown(page, 1))).toMatchObject({ top: 3, rowSkip: 0 })
    expect(syncFile(opened, markdown(page, 3))).toMatchObject({ top: 3, rowSkip: 2 })
    expect(syncFile(opened, markdown(page, 6))).toMatchObject({ top: 3, rowSkip: 5 })
    expect(syncFile(opened, markdown(page, 7))).toMatchObject({ top: 5, rowSkip: 0 })
  })

  test('and back up the same way', () => {
    const opened = initFile(markdown(page, 0))
    const down = syncFile(opened, markdown(page, 7))
    expect(down.top).toBe(5)
    expect(syncFile(down, markdown(page, 6))).toMatchObject({ top: 3, rowSkip: 5 })
    expect(syncFile(down, markdown(page, 0))).toMatchObject({ top: 1, rowSkip: 0 })
  })

  test('page down moves a page of rows, not a page of source lines', () => {
    const long = Array.from({ length: 12 }, () => WORDS).join('\n\n')
    const opened = initFile(markdown(long, 0))
    const after = fileKey(opened, { key: 'pagedown' }, markdown(long, 0), () => {})
    // A 20 row region less its title row and status line: 16 rows of 6-row paragraphs, two whole ones and four rows of
    // the third. By source lines it would have gone 16 lines on, to the last paragraph.
    expect(after).toMatchObject({ top: 5, rowSkip: 4 })
  })
})

describe('state that must not go stale', () => {
  test('wheel ticks while editing are dropped, not replayed when the editor closes', () => {
    const opened = initFile(props(0))
    const editing = syncFile({ ...opened, buffer: fromText(TEXT) }, props(20))
    const closed = syncFile({ ...editing, buffer: undefined }, props(20))
    expect(closed.top).toBe(1)
  })

  test('adopting props leaves a state the next draw does not move again', () => {
    const at = (scroll: number): NavProps => ({ ...props(scroll), rows: 30 })
    // Down and back up: the cursor line ends where only a window without the title row holds it.
    const back = initFile(at(0), initFile(at(38), initFile(at(0))))
    expect(syncFile(back, at(0))).toEqual(back)
  })
})

describe('layoutTable', () => {
  test('ragged rows and empty cells draw as a grid, every line the same width', () => {
    const grid = layoutTable([['a', 'b', 'c'], ['1'], ['1', '', '3', 'extra']], 40)
    const widths = new Set(grid.lines.map(line => line.length))
    expect(widths.size).toBe(1)
    expect(grid.lines.join('\n')).toContain('c')
    expect(grid.lines.join('\n')).not.toContain('extra')
  })
})
