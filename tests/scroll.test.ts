import { describe, expect, test } from 'claude-code/testing'

import type { NavProps } from '../types'
import { initFile, syncFile } from '../hooks/navfile'

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
