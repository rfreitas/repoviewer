// Tables the pane draws itself. The Markdown element draws a table's cells wrapped onto several
// lines but its borders for one, so the grid tears in a narrow pane: here the column widths come
// from the pane's width and each cell wraps inside its own column.

/** A table as drawn lines: line 0 is the top border and lines 1..head the header's. */
export type Table = { lines: string[]; head: number }

const RULE = /^:?-+:?$/

/** The cells of one table row, without the inline markers that would only widen them. */
const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim().replace(/\\\||\*\*|__|`/g, m => (m === '\\|' ? '|' : '')))

/** The rows of a table block, header first and the rule left out. Undefined when the second line is no rule. */
export function parseTable(block: string[]): string[][] | undefined {
  const rows = block.map(splitRow)
  if (rows.length < 2 || !rows[1]!.every(cell => RULE.test(cell))) return undefined

  return [rows[0]!, ...rows.slice(2)]
}

/** `text` broken into lines of at most `width` characters, at spaces where it can, inside a word where it must. */
function wrap(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (line !== '') out.push(line)
      line = ''
      out.push(word.slice(0, width))
      word = word.slice(width)
    }
    if (line === '') line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      out.push(line)
      line = word
    }
  }
  out.push(line)

  return out
}

/** The table drawn to fit `width` cells: columns at their natural width, the widest narrowed one cell
 * at a time until the grid fits (no column under 3 cells). */
export function layoutTable(rows: string[][], width: number): Table {
  const n = rows[0]!.length
  const cells = rows.map(row => Array.from({ length: n }, (_, c) => row[c] ?? ''))
  const w = Array.from({ length: n }, (_, c) => Math.max(3, ...cells.map(row => row[c]!.length)))
  const room = Math.max(3 * n, width - (3 * n + 1))
  for (let total = w.reduce((a, b) => a + b, 0); total > room; total--) {
    const widest = w.indexOf(Math.max(...w))
    if (w[widest]! <= 3) break
    w[widest]!--
  }

  const rule = (left: string, mid: string, right: string) => left + w.map(x => '─'.repeat(x + 2)).join(mid) + right
  const drawRow = (row: string[]): string[] => {
    const wrapped = row.map((text, c) => wrap(text, w[c]!))
    const height = Math.max(...wrapped.map(lines => lines.length))

    return Array.from({ length: height }, (_, k) => '│' + wrapped.map((lines, c) => ` ${(lines[k] ?? '').padEnd(w[c]!)} `).join('│') + '│')
  }
  const head = drawRow(cells[0]!)

  return {
    lines: [rule('┌', '┬', '┐'), ...head, rule('├', '┼', '┤'), ...cells.slice(1).flatMap(drawRow), rule('└', '┴', '┘')],
    head: head.length,
  }
}
