import { describe, expect, test } from 'claude-code/testing'

import { fixture, FILES, ROOT, run } from './fixture'

const SURFACES = ['terminal', 'desktop'] as const
const SLOW = { timeoutMs: 30000 }

const pane = <S extends 'terminal' | 'desktop' | 'vscode'>(surface: S, columns = 60) => ({
  plugin: 'kesav',
  surface,
  component: 'Pane' as const,
  requestId: 'repoviewer',
  props: {
    title: 'repo',
    isFocused: true,
    bodyColumns: columns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
})

type Found = { text: string; props: Record<string, unknown> } | undefined
type Finder = { find: (q: { in?: string; type?: string; text?: RegExp }) => Promise<Found> }

/** What the pane's keyboard Client drew, as one string. */
const drawn = async (ui: Finder) => (await ui.find({ in: 'nav', type: 'Box' }))?.text ?? ''
const codeIn = async (ui: Finder) => (await ui.find({ in: 'nav', type: 'Code' }))?.props

/** The row of the Client's status line: the pane's 30 rows, less the title row, less one (rows count from 0). */
const STATUS_ROW = 28
type Clicker = Finder & { pointer: (e: { in: string; type: 'down'; x: number; y: number; button: 'left' }) => Promise<void> }
/** What the status line says. */
const footer = async (ui: Finder) => String((await ui.find({ in: 'nav', type: 'Text', text: /← (back|file)/ }))?.text)
/** Clicks `label` in the status line, where the file's toggles are. */
const clickFooter = async (ui: Clicker, label: string) => {
  const x = (await footer(ui)).indexOf(label)
  expect(x).toBeGreaterThan(-1)
  await ui.pointer({ in: 'nav', type: 'down', x: x + 1, y: STATUS_ROW, button: 'left' })
}

describe('tree and arrows', () => {
  test('arrows walk into folders and files and back out', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('files'))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      expect(await drawn(ui)).toContain('hooks/')
      expect(await drawn(ui)).toContain('SPEC.md')

      // Folders sort first: assets/, hooks/. Home, then down, lands on hooks/.
      await ui.key({ key: 'home', in: 'nav' })
      await ui.key({ key: 'down', in: 'nav' })
      await ui.key({ key: 'right', in: 'nav' })
      expect(await drawn(ui)).toContain('register.tsx')

      // → again steps into the folder, → on a file opens it.
      await ui.key({ key: 'right', in: 'nav' })
      await ui.key({ key: 'right', in: 'nav' })
      expect((await codeIn(ui))?.path).toBe('hooks/register.tsx')

      // ← leaves the file, ← again goes up to the folder, ← once more collapses it.
      await ui.key({ key: 'left', in: 'nav' })
      expect(await drawn(ui)).toContain('register.tsx')
      await ui.key({ key: 'left', in: 'nav' })
      await ui.key({ key: 'left', in: 'nav' })
      expect(await drawn(ui)).not.toContain('register.tsx')
      await ui.unmount()
    }
  })

  test('← at the top level and typing hand the keys back to the prompt', SLOW, async ($, on) => {
    const fx = fixture(on)
    await $.command.run(run('files'))
    const ui = await $.ui.mount(pane('terminal'))
    await ui.key({ key: 'down', in: 'nav' })
    const before = fx.seen.closes
    await ui.key({ key: 'left', in: 'nav' })
    expect(fx.seen.closes).toBe(before + 1)
    expect(fx.open.has('repoviewer')).toBe(true)

    await ui.key({ key: 'f', in: 'nav' })
    expect(fx.seen.filled).toEqual(['f'])
    await ui.unmount()
  })

  test('the finder ranks fuzzy matches and Enter opens the first', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('files'))
    const ui = await $.ui.mount(pane('terminal'))
    await ui.input({ key: 'filter', text: 'regtsx', kind: 'change' })
    expect(await drawn(ui)).toContain('hooks/register.tsx')
    expect(await drawn(ui)).not.toContain('README.md')
    await ui.input({ key: 'filter', text: 'regtsx' })
    expect((await codeIn(ui))?.path).toBe('hooks/register.tsx')
    // Back out of the file: the finder has reset, so the whole tree shows.
    await ui.key({ key: 'left', in: 'nav' })
    expect(await drawn(ui)).toContain('README.md')
    await ui.unmount()
  })

  test('clearing the finder restores the tree, and the finder takes the keys first', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('files'))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      expect((await ui.find({ key: 'filter' }))?.props.autoFocus).toBe(true)
      const tree = await drawn(ui)
      await ui.input({ key: 'filter', text: 'regtsx', kind: 'change' })
      expect(await drawn(ui)).not.toBe(tree)
      await ui.input({ key: 'filter', text: '', kind: 'change' })
      expect(await drawn(ui)).toBe(tree)
      await ui.unmount()
    }
  })

  test('leaving a file, then the tree, keeps the pane drawn', SLOW, async ($, on) => {
    const fx = fixture(on)
    for (const surface of SURFACES) {
      await $.command.run(run('files', 'SPEC.md'))
      const ui = await $.ui.mount(pane(surface, 70))
      expect(await ui.find({ in: 'nav', type: 'Markdown' })).toBeDefined()
      // ← out of the file: the whole pane (header and the tree in the Client) is drawn, nothing left over from the file.
      await ui.key({ key: 'left', in: 'nav' })
      expect(await ui.find({ key: 'filter' })).toBeDefined()
      expect(await drawn(ui)).toContain('hooks/')
      expect(await ui.find({ in: 'nav', type: 'Markdown' })).toBeUndefined()
      // ← again at the top level hands the keys back: closed and reopened, and still drawn.
      const closes = fx.seen.closes
      await ui.key({ key: 'left', in: 'nav' })
      expect(fx.seen.closes).toBe(closes + 1)
      expect(fx.open.has('repoviewer')).toBe(true)
      expect(await drawn(ui)).toContain('hooks/')
      await ui.unmount()
    }
  })

  test('git marks and Claude edits show in the tree', SLOW, async ($, on) => {
    fixture(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: `${ROOT}/README.md` } as never }))
    await $.command.run(run('files', 'hooks'))
    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/README.md`, old_string: 'small', new_string: 'tiny' })
    const ui = await $.ui.mount(pane('terminal'))
    // Following the edit opened README.md; back to the tree to see the marks.
    await ui.key({ key: 'left', in: 'nav' })
    const tree = await drawn(ui)
    expect(tree).toMatch(/repo\.ts.*M/)
    expect(tree).toContain('●')
    expect(await ui.find({ text: /edited by Claude/ })).toBeDefined()
    await ui.unmount()
  })

  test('a narrow pane still draws', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('files'))
    const ui = await $.ui.mount(pane('terminal', 32))
    expect(await drawn(ui)).toContain('hooks/')
    await ui.unmount()
  })

  test('/files toggles the pane closed, and the next session remembers which', SLOW, async ($, on) => {
    const { open, stored } = fixture(on)
    await $.command.run(run('files'))
    expect(open.has('repoviewer')).toBe(true)
    expect(stored.open).toBe(true)
    await $.command.run(run('files'))
    expect(open.has('repoviewer')).toBe(false)
    expect(stored.open).toBe(false)
  })

  test('the close button and the follow toggle are remembered', SLOW, async ($, on) => {
    const fx = fixture(on)
    await $.command.run(run('files'))
    const ui = await $.ui.mount(pane('terminal'))
    await ui.press({ key: 'tb:follow' })
    expect(fx.stored.follow).toBe(false)
    await ui.press({ key: 'tb:follow' })
    expect(fx.stored.follow).toBe(true)
    await ui.press({ key: 'close' })
    expect(fx.open.has('repoviewer')).toBe(false)
    expect(fx.stored.open).toBe(false)
    await ui.unmount()
  })
})

describe('file view', () => {
  test('markdown renders, and the status line toggles it to source and back', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('repo', 'SPEC.md'))
    const ui = await $.ui.mount(pane('terminal', 70))
    expect(await ui.find({ in: 'nav', type: 'Markdown' })).toBeDefined()
    await clickFooter(ui, 'raw')
    expect(await ui.find({ in: 'nav', type: 'Markdown' })).toBeUndefined()
    expect(await codeIn(ui)).toBeDefined()
    expect(await footer(ui)).toContain('rendered')
    await clickFooter(ui, 'rendered')
    expect(await ui.find({ in: 'nav', type: 'Markdown' })).toBeDefined()
    await ui.unmount()
  })

  test('a toggle in the status line lights up under the pointer, and goes out when it leaves', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('files', 'SPEC.md'))
    const ui = await $.ui.mount(pane('terminal', 70))
    const lit = async () => (await ui.find({ in: 'nav', type: 'Text', text: /^raw$/ }))?.props.underline
    expect(await lit()).toBeUndefined()
    const x = (await footer(ui)).indexOf('raw') + 1
    await ui.pointer({ in: 'nav', type: 'move', x, y: STATUS_ROW })
    expect(await lit()).toBe(true)
    await ui.pointer({ in: 'nav', type: 'move', x, y: 3 })
    expect(await lit()).toBeUndefined()
    await ui.unmount()
  })

  test('the status line holds the file facts, and no rows above the file do', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('files', 'SPEC.md'))
    const ui = await $.ui.mount(pane('terminal', 70))
    // Position, then the size: no "lines", file type or breadcrumb row, and no reveal button.
    expect(await footer(ui)).toMatch(/\d+\/\d+ · [\d.]+ (B|KB)/)
    expect(await ui.find({ type: 'Text', text: /markdown|^fixture$|^repo$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'reveal' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'raw' })).toBeUndefined()
    await ui.unmount()
  })

  test('hard-wrapped markdown joins into paragraphs, but code keeps its lines', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('files', 'SPEC.md'))
    const ui = await $.ui.mount(pane('terminal', 70))
    const text = String((await ui.find({ in: 'nav', type: 'Markdown' }))?.props.text)
    expect(text).toContain('A hard wrapped line.')
    expect(text).toContain('- one more\n- two')
    expect(text).toContain('const x = 1\nconst y = 2')
    await ui.unmount()
  })

  test('a changed file shows its diff', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('files', 'hooks/repo.ts'))
    const ui = await $.ui.mount(pane('terminal'))
    await clickFooter(ui, 'diff')
    // Drawn row by row (Code's diff format leaves stray cells behind): old and new line, each padded to the width.
    const text = await drawn(ui)
    expect(text).toContain('@@ -1 +1 @@')
    expect(text).toContain('-export const repo = 0')
    expect(text).toContain('+export const repo = 1')
    expect(await codeIn(ui)).toBeUndefined()
    await ui.unmount()
  })

  test('a png draws as an image in the terminal only', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('files', 'assets/logo.png'))
    const terminal = await $.ui.mount(pane('terminal'))
    expect((await terminal.find({ type: 'Image' }))?.props.source).toMatchObject({ file: `${ROOT}/assets/logo.png`, format: 'png' })
    await terminal.unmount()
    const desktop = await $.ui.mount(pane('desktop'))
    expect(await desktop.find({ type: 'Image' })).toBeUndefined()
    await desktop.unmount()
  })

  test('Claude asking to show a file opens it at that line', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('files'))
    const shown = await $.tool.call({ tool: 'mcp__kesav__show_file', path: 'hooks/register.tsx', line: 850 } as never)
    expect(String(shown.result)).toContain('Showing hooks/register.tsx')
    const ui = await $.ui.mount(pane('terminal'))
    expect(String((await codeIn(ui))?.source)).toContain('line849')
    await ui.unmount()
  })
})

describe('tables in the pane', () => {
  const TABLE = [
    '# T',
    '',
    '| Kind | What it is |',
    '| --- | --- |',
    '| fork | a fresh subagent that carries the whole session along with it |',
    '| plain | a fresh subagent |',
    '',
    'after',
    '',
  ].join('\n')
  const SMALL = ['| a | b |', '| - | - |', '| 1 | 2 |', ''].join('\n')
  // One Text per drawn line of the grid.
  const grid = async (ui: Finder & { findAll: (q: { in?: string; type?: string; text?: RegExp }) => Promise<{ text: string }[]> }) =>
    (await ui.findAll({ in: 'nav', type: 'Text', text: /^[│┌├└]/ })).map(found => found.text)
  const longest = (rows: string[]) => Math.max(...rows.map(l => l.trimEnd().length))

  test('a table that fits is one row a line, and a narrower pane redraws it wrapped to fit', SLOW, async ($, on) => {
    fixture(on, { ...FILES, 'T.md': TABLE })
    await $.command.run(run('files', 'T.md'))

    const wide = await $.ui.mount(pane('terminal', 90))
    const wideRows = await grid(wide)
    expect(wideRows.some(l => l.includes('a fresh subagent that carries the whole session along with it'))).toBe(true)
    expect(longest(wideRows)).toBeLessThanOrEqual(90)
    await wide.unmount()

    // The same table in each narrower pane: the whole grid fits, and the cell text is all still there.
    let last = Infinity
    for (const columns of [60, 40, 28]) {
      const ui = await $.ui.mount(pane('terminal', columns))
      const rows = await grid(ui)
      expect(longest(rows)).toBeLessThanOrEqual(columns)
      expect(rows.length).toBeGreaterThan(wideRows.length)
      const flat = rows.map(l => l.replace(/[│┌┬┐├┼┤└┴┘─]/g, ' ')).join(' ').replace(/\s+/g, ' ')
      expect(flat).toContain('fork')
      expect(flat).toContain('whole session')
      // Narrower never makes it shorter.
      expect(rows.length).toBeGreaterThanOrEqual(last === Infinity ? 0 : last)
      last = rows.length
      expect(await drawn(ui)).toContain('after')
      await ui.unmount()
    }
  })

  test('a table taller than the pane is cut to it, so it cannot cover the status line', SLOW, async ($, on) => {
    const tall = ['| n | v |', '| - | - |', ...Array.from({ length: 80 }, (_, i) => `| r${i} | v${i} |`), ''].join('\n')
    fixture(on, { ...FILES, 'tall.md': tall })
    await $.command.run(run('files', 'tall.md'))
    const ui = await $.ui.mount(pane('terminal', 60))
    const rows = await grid(ui)
    expect(rows.length).toBeGreaterThan(5)
    expect(rows.length).toBeLessThan(30)
    expect(await drawn(ui)).toContain('back')
    await ui.unmount()
  })

  test('a small table keeps its natural width', SLOW, async ($, on) => {
    fixture(on, { ...FILES, 'S.md': SMALL })
    await $.command.run(run('files', 'S.md'))
    const ui = await $.ui.mount(pane('terminal', 60))
    expect((await grid(ui)).some(l => /│ 1 +│ 2 +│/.test(l))).toBe(true)
    await ui.unmount()
  })

  test('a window that starts inside the table keeps its header', SLOW, async ($, on) => {
    fixture(on, { ...FILES, 'T.md': TABLE })
    await $.command.run(run('files', 'T.md'))
    const ui = await $.ui.mount(pane('terminal', 40))
    // Down skips the blank line: header, rule, then the first row is the window's top.
    for (let n = 0; n < 3; n++) await ui.key({ key: 'down', in: 'nav' })
    const text = await drawn(ui)
    expect(text).toContain('Kind')
    expect(text).toContain('fork')
    await ui.unmount()
  })
})

describe('a pane that stays hidden', () => {
  test('is reported to Claude, not claimed shown', SLOW, async ($, on) => {
    fixture(on).seen.hidden = true
    const shown = await $.tool.call({ tool: 'mcp__kesav__show_file', path: 'README.md' } as never)
    expect(String(shown.result)).toContain('hidden')
    expect(String(shown.result)).toContain('/files')
  })
})

describe('editing in the pane', () => {
  test('→ edits, typing changes the buffer, ctrl+s saves the whole file', SLOW, async ($, on) => {
    const fx = fixture(on)
    await $.command.run(run('files', 'README.md'))
    const ui = await $.ui.mount(pane('terminal'))
    await ui.key({ key: 'right', in: 'nav' })
    expect(await drawn(ui)).toContain('EDIT')
    await ui.key({ key: 'X', in: 'nav' })
    expect(fx.seen.filled).toEqual([])
    await ui.key({ key: 's', ctrl: true, in: 'nav' })
    expect(fx.seen.written['README.md']).toBe(`X${FILES['README.md']}`)
    expect(await drawn(ui)).not.toContain('modified')
    await ui.key({ key: 'q', ctrl: true, in: 'nav' })
    expect(await drawn(ui)).not.toContain('EDIT')
    await ui.unmount()
  })

  test('a save is refused when the file changed on disk, and the second ctrl+s overwrites', SLOW, async ($, on) => {
    const fx = fixture(on)
    await $.command.run(run('files', 'README.md'))
    const ui = await $.ui.mount(pane('terminal'))
    await ui.key({ key: 'right', in: 'nav' })
    await ui.key({ key: 'Y', in: 'nav' })
    fx.touch('README.md', 'someone else\n')
    await ui.key({ key: 's', ctrl: true, in: 'nav' })
    expect(fx.seen.written['README.md']).toBeUndefined()
    expect(await drawn(ui)).toContain('changed on disk')
    await ui.key({ key: 's', ctrl: true, in: 'nav' })
    expect(fx.seen.written['README.md']).toBe(`Y${FILES['README.md']}`)
    await ui.unmount()
  })
})

describe('surfaces without a Client', () => {
  test('VS Code draws the button tree', SLOW, async ($, on) => {
    fixture(on)
    await $.command.run(run('files'))
    const ui = await $.ui.mount(pane('vscode'))
    expect(await ui.find({ key: 'row:hooks' })).toBeDefined()
    await ui.press({ key: 'row:hooks' })
    await ui.press({ key: 'row:hooks/register.tsx' })
    expect((await ui.find({ type: 'Code' }))?.props.path).toBe('hooks/register.tsx')
    await ui.unmount()
  })
})
