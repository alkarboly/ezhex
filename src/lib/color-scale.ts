const STOPS: { t: number; rgb: [number, number, number] }[] = [
  { t: 0, rgb: [18, 66, 84] },
  { t: 0.38, rgb: [16, 148, 146] },
  { t: 0.72, rgb: [61, 222, 192] },
  { t: 1, rgb: [222, 255, 196] },
]

const EMPTY_CELL = 'rgb(46 60 74)'

function mix(from: [number, number, number], to: [number, number, number], t: number): string {
  const r = Math.round(from[0] + (to[0] - from[0]) * t)
  const g = Math.round(from[1] + (to[1] - from[1]) * t)
  const b = Math.round(from[2] + (to[2] - from[2]) * t)
  return `rgb(${r} ${g} ${b})`
}

export function densityColor(count: number, max: number): string {
  if (count <= 0 || max <= 0) return EMPTY_CELL
  const t = Math.max(0, Math.min(1, count / max))
  for (let index = 1; index < STOPS.length; index += 1) {
    const previous = STOPS[index - 1]
    const next = STOPS[index]
    if (t <= next.t) {
      const span = next.t - previous.t
      const local = span === 0 ? 0 : (t - previous.t) / span
      return mix(previous.rgb, next.rgb, local)
    }
  }
  const last = STOPS[STOPS.length - 1].rgb
  return `rgb(${last[0]} ${last[1]} ${last[2]})`
}

export function densityGradientCss(): string {
  const parts = STOPS.map((stop) => {
    const [r, g, b] = stop.rgb
    return `rgb(${r} ${g} ${b}) ${stop.t * 100}%`
  })
  return `linear-gradient(90deg, ${parts.join(', ')})`
}
