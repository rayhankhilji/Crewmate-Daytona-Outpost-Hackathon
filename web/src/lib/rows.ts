import type { Brief, InputRow } from '../types'

/**
 * Parses the rows pasted into the launch control. Mirrors the rules POST /runs
 * enforces — non-empty, non-ragged, and carrying every column the Brief's
 * variables read from — so a bad paste is named here rather than as a 400.
 */
export type RowsResult =
  { ok: true; columns: string[]; rows: InputRow[] } | { ok: false; message: string }

function splitLine(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((cell) => cell.trim())
}

export function parseRows(text: string, brief: Brief): RowsResult {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')

  if (lines.length === 0) {
    return { ok: false, message: 'Paste a header row and one row of input data per worker.' }
  }
  if (lines.length === 1) {
    return {
      ok: false,
      message: 'That is only a header row. Add one row of input data for each worker you want.',
    }
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const columns = splitLine(lines[0], delimiter)

  const blank = columns.findIndex((column) => column === '')
  if (blank !== -1) {
    return { ok: false, message: `Column ${blank + 1} in the header has no name.` }
  }

  const rows: InputRow[] = []
  for (const [offset, line] of lines.slice(1).entries()) {
    const cells = splitLine(line, delimiter)
    if (cells.length !== columns.length) {
      return {
        ok: false,
        message: `Row ${offset + 1} has ${cells.length} ${
          cells.length === 1 ? 'value' : 'values'
        } but the header names ${columns.length} columns.`,
      }
    }
    const row: InputRow = {}
    columns.forEach((column, index) => {
      row[column] = cells[index]
    })
    rows.push(row)
  }

  const missing = brief.variables
    .map((variable) => variable.source_column)
    .filter((column) => !columns.includes(column))

  if (missing.length > 0) {
    return {
      ok: false,
      message: `The Brief reads from ${missing.length === 1 ? 'a column' : 'columns'} your rows do not have: ${missing.join(', ')}.`,
    }
  }

  return { ok: true, columns, rows }
}

/** A header row plus the values observed in the recording, ready to edit. */
export function exampleRows(brief: Brief, count: number): string {
  const columns = brief.variables.map((variable) => variable.source_column)
  if (columns.length === 0) {
    return ''
  }
  const header = columns.join('\t')
  const body = Array.from({ length: count }, (_, index) =>
    brief.variables
      .map((variable) => (index === 0 ? variable.example : `${variable.example} ${index + 1}`))
      .join('\t'),
  )
  return [header, ...body].join('\n')
}
