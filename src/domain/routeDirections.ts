export interface RouteDirection<T> {
  from: T
  to: T
  fraction: number
}

/** Place arrows at the midpoint of each equal-distance interval along the drawn lines. */
export function sampleRouteDirections<T>(
  lines: readonly (readonly T[])[],
  distance: (from: T, to: T) => number,
  spacing: number,
  minimumLength: number,
): RouteDirection<T>[] {
  const segments: { from: T; to: T; start: number; length: number }[] = []
  let total = 0
  for (const line of lines) {
    for (let index = 1; index < line.length; index++) {
      const from = line[index - 1]
      const to = line[index]
      const length = distance(from, to)
      if (length <= 0) continue
      const start = total
      total += length
      segments.push({ from, to, start, length })
    }
  }
  if (total < minimumLength) return []

  const count = Math.min(40, Math.max(1, Math.round(total / spacing)))
  let segmentIndex = 0
  return Array.from({ length: count }, (_, index) => {
    const offset = ((index + 0.5) * total) / count
    while (offset > segments[segmentIndex].start + segments[segmentIndex].length) segmentIndex++
    const { from, to, start, length } = segments[segmentIndex]
    return { from, to, fraction: (offset - start) / length }
  })
}
