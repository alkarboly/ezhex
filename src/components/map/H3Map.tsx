import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { Map as MapLibreMap, setWorkerUrl, type AddLayerObject, type GeoJSONSource } from 'maplibre-gl'
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react'
import { HexHoverCard } from '../explorer/HexHoverCard'
import {
  AUSTIN_CENTER,
  AUSTIN_ZOOM,
  GLOBE_START,
  GLOBE_ZOOM,
  boundsForCells,
  buildH3Collection,
  cellsInView,
  type ViewportStatus,
} from '../../lib/h3'
import { lensFalloff, lensRadius, lensRings } from '../../lib/lens'
import { H3_RESOLUTION } from '../../lib/limits'
import { cn } from '../../lib/utils'
import { useExplorer, type BasemapId, type FitRequest, type HexMode } from '../../store/explorer-store'
import type { CellCount } from '../../types/queries'
import type { HexAction, HexCoverage } from '../../types/workflows'
import { styleForBasemap } from './map-style'
import 'maplibre-gl/dist/maplibre-gl.css'

// Vite prebundles maplibre-gl, so the library's default worker URL
// (a sibling of the prebundled module) 404s and the map never paints.
setWorkerUrl(maplibreWorkerUrl)

export type MapInsets = { top: number; right: number; bottom: number; left: number }

export type H3MapHandle = {
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
}

type H3MapProps = {
  ref?: Ref<H3MapHandle>
  cells: readonly string[]
  counts: readonly CellCount[]
  selected: readonly string[]
  focusedH3: string | null
  hexMode: HexMode
  basemap: BasemapId
  countLabel: string
  addMode: boolean
  touch: boolean
  insets: MapInsets
  fit: FitRequest
  focusNonce: number
  onCellClick: (h3: string, additive: boolean) => void
  onViewportCells: (ids: string[], status: ViewportStatus, resolution: number) => void
  onCenterCell?: (h3: string | null) => void
  cellCoverage?: ReadonlyMap<string, HexCoverage>
  onHexAction?: (h3: string, action: HexAction) => void
}

type Point = { x: number; y: number }

type LensApi = {
  schedule: () => void
  setInput: (touch: boolean) => void
}

const H3_LAYERS = ['h3-fill', 'h3-glow', 'h3-line'] as const
/** Lens strength before the pointer first reaches the map, so the effect shows on load. */
const INTRO_STRENGTH = 0.7

export function H3Map({
  ref,
  cells,
  counts,
  selected,
  focusedH3,
  hexMode,
  basemap,
  countLabel,
  addMode,
  touch,
  insets,
  fit,
  focusNonce,
  onCellClick,
  onViewportCells,
  onCenterCell,
  cellCoverage,
  onHexAction,
}: H3MapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const lensRef = useRef<LensApi>({ schedule: () => {}, setInput: () => {} })
  const clickRef = useRef(onCellClick)
  const viewportRef = useRef(onViewportCells)
  const centerRef = useRef(onCenterCell)
  const selectedRef = useRef(selected)
  const focusRef = useRef(focusedH3)
  const modeRef = useRef(hexMode)
  const touchRef = useRef(touch)
  const insetsRef = useRef(insets)
  const drawnRef = useRef<ReadonlySet<string>>(new Set())
  const appliedBasemap = useRef(basemap)
  const arrivingRef = useRef(false)
  const [styleReady, setStyleReady] = useState(0)
  const [cardCell, setCardCell] = useState<string | null>(null)
  const [cardVisible, setCardVisible] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [mapError, setMapError] = useState<string | null>(null)
  const cardHeldRef = useRef(false)
  const hideCardRef = useRef(0)
  const inspectOpen = useExplorer((state) => state.inspectOpen)
  const inspectOpenRef = useRef(inspectOpen)
  inspectOpenRef.current = inspectOpen
  const displayResRef = useRef(H3_RESOLUTION)

  useLayoutEffect(() => {
    clickRef.current = onCellClick
    viewportRef.current = onViewportCells
    centerRef.current = onCenterCell
    selectedRef.current = selected
    focusRef.current = focusedH3
  })

  const countMap = useMemo(() => new Map(counts.map((entry) => [entry.h3, entry.count])), [counts])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const drawn = useMemo(() => {
    const all = new Set(cells)
    for (const cell of selected) all.add(cell)
    return [...all]
  }, [cells, selected])
  const collection = useMemo(
    () =>
      buildH3Collection({
        cells: drawn,
        counts: countMap,
        snapshots: new Map([...drawn].map((cell) => [cell, cellCoverage?.get(cell)?.snapshot ?? null])),
        selected: selectedSet,
        focusedH3,
      }),
    [drawn, countMap, cellCoverage, selectedSet, focusedH3],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const calm = reducedMotion()
    arrivingRef.current = !calm
    const openingBasemap = appliedBasemap.current
    const map = new MapLibreMap({
      container,
      style: styleForBasemap(openingBasemap),
      center: calm ? [AUSTIN_CENTER.lng, AUSTIN_CENTER.lat] : [GLOBE_START.lng, GLOBE_START.lat],
      zoom: calm ? AUSTIN_ZOOM : GLOBE_ZOOM,
      bearing: calm ? 0 : -14,
      // Box zoom claims every shift-press and swallows the click, which breaks shift-click to add.
      boxZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      fadeDuration: 300,
      renderWorldCopies: false,
    })
    map.touchZoomRotate.disableRotation()
    map.scrollZoom.setWheelZoomRate(1 / 1100)
    map.scrollZoom.setZoomRate(1 / 320)
    mapRef.current = map

    const revealCard = (cell: string | null) => {
      window.clearTimeout(hideCardRef.current)
      if (cell) {
        setCardCell(cell)
        setCardVisible(true)
        return
      }
      if (cardHeldRef.current || inspectOpenRef.current) return
      hideCardRef.current = window.setTimeout(() => {
        if (!cardHeldRef.current && !inspectOpenRef.current) setCardVisible(false)
      }, 700)
    }

    let active = true
    let frame = 0
    let pointer: Point | null = null
    let lastPointer: Point | null = null
    let pointerSeen = false
    let applied = new Map<string, number>()
    let hoverCell: string | null = null
    let centerCell: string | null = null
    let strength = 0
    let fade = { from: 0, to: 0, start: 0, duration: 1 }

    const schedule = () => {
      if (active && frame === 0) frame = requestAnimationFrame(render)
    }

    const fadeTo = (target: number, duration: number) => {
      fade = { from: strength, to: target, start: performance.now(), duration }
      schedule()
    }

    const restingStrength = () => {
      if (touchRef.current || pointer) return 1
      return pointerSeen ? 0 : INTRO_STRENGTH
    }

    const restPoint = (): Point => {
      const inset = insetsRef.current
      return {
        x: (inset.left + container.clientWidth - inset.right) / 2,
        y: (inset.top + container.clientHeight - inset.bottom) / 2,
      }
    }

    const cellAt = (point: Point, resolution = displayResRef.current) => {
      const lngLat = map.unproject([point.x, point.y])
      return latLngToCell(lngLat.lat, lngLat.lng, resolution)
    }

    const setCellState = (cell: string, state: Record<string, number | boolean>) => {
      map.setFeatureState({ source: 'h3', id: cell }, state)
    }

    const positionCard = () => {
      const card = cardRef.current
      const anchor = pointer ?? lastPointer ?? restPoint()
      if (!card) return
      const width = card.offsetWidth || 256
      const height = card.offsetHeight || 180
      const inset = insetsRef.current
      let x = anchor.x + 12
      let y = anchor.y + 12
      if (x + width > container.clientWidth - 8) x = anchor.x - width - 8
      if (y + height > container.clientHeight - inset.bottom - 8) y = anchor.y - height - 8
      card.style.transform = `translate3d(${Math.max(8, x)}px, ${Math.max(8, y)}px, 0)`
    }

    function render(now: number) {
      frame = 0
      if (!active || !map.getSource('h3')) return
      let again = false
      if (strength !== fade.to) {
        const progress = Math.min(1, (now - fade.start) / Math.max(1, fade.duration))
        strength = progress >= 1 ? fade.to : fade.from + (fade.to - fade.from) * (1 - (1 - progress) ** 3)
        again = progress < 1
      }

      const mode = modeRef.current
      const drawnCells = drawnRef.current
      const isTouch = touchRef.current
      const rest = restPoint()
      const restCell = drawnCells.size > 0 ? cellAt(rest) : null
      const nextCenter = restCell && drawnCells.has(restCell) ? restCell : null
      const anchor = isTouch || !pointerSeen ? rest : (pointer ?? lastPointer)
      const next = new Map<string, number>()
      let nextHover: string | null = null

      if (mode !== 'off' && drawnCells.size > 0 && anchor) {
        const center = cellAt(anchor)
        if (mode === 'lens' && strength > 0.004) {
          const spacing = neighborSpacing(map, center)
          const radius = lensRadius(spacing, isTouch ? 'touch' : 'pointer')
          for (const cell of gridDisk(center, lensRings(radius, spacing))) {
            if (!drawnCells.has(cell)) continue
            const [lat, lng] = cellToLatLng(cell)
            const point = map.project([lng, lat])
            const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y)
            const value = Math.round(lensFalloff(distance, radius) * strength * 100) / 100
            if (value > 0) next.set(cell, value)
          }
        }
        if (isTouch) {
          nextHover = nextCenter
        } else if (pointer) {
          const under = cellAt(pointer)
          nextHover = drawnCells.has(under) ? under : null
        } else if (cardHeldRef.current || inspectOpenRef.current) {
          nextHover = hoverCell
        }
      }

      for (const cell of applied.keys()) {
        if (!next.has(cell)) setCellState(cell, { lens: 0 })
      }
      for (const [cell, value] of next) {
        if (applied.get(cell) !== value) setCellState(cell, { lens: value })
      }
      applied = next

      if (nextHover !== hoverCell) {
        if (hoverCell) setCellState(hoverCell, { hover: false })
        if (nextHover) setCellState(nextHover, { hover: true })
        hoverCell = nextHover
        if (!isTouch) revealCard(nextHover)
      }
      if (nextCenter !== centerCell) {
        centerCell = nextCenter
        centerRef.current?.(nextCenter)
      }
      positionCard()
      if (again) schedule()
    }

    lensRef.current = {
      schedule,
      setInput: (isTouch) => {
        if (isTouch) {
          pointer = null
          if (!inspectOpenRef.current) setCardVisible(false)
        }
        fadeTo(restingStrength(), 300)
      },
    }

    let arriving = !calm
    let arrivalArmed = false

    const report = () => {
      if (arriving) return
      const bounds = map.getBounds()
      const next = cellsInView(
        { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
        map.getZoom(),
        displayResRef.current,
      )
      displayResRef.current = next.resolution
      viewportRef.current(next.ids, next.status, next.resolution)
    }

    let reportTimer = 0
    const reportSoon = () => {
      if (reportTimer) return
      reportTimer = window.setTimeout(() => {
        reportTimer = 0
        report()
      }, 80)
    }

    let handoffTimer = 0
    let revealTimer = 0

    const revealMap = () => {
      window.clearTimeout(revealTimer)
      container.dataset.arrival = ''
    }

    const finishArrival = () => {
      if (!arriving) return
      arriving = false
      arrivingRef.current = false
      if (appliedBasemap.current === openingBasemap) {
        report()
        return
      }
      container.dataset.arrival = 'handoff'
      handoffTimer = window.setTimeout(() => {
        if (!active) return
        map.setStyle(styleForBasemap(appliedBasemap.current), { diff: false })
      }, 320)
    }

    const beginArrival = () => {
      if (!active || arrivalArmed) return
      arrivalArmed = true
      showGlobe(map)
      if (!arriving) {
        report()
        return
      }
      const narrow = container.clientWidth < 768
      const spinMs = narrow ? 2600 : 3800
      const diveMs = narrow ? 3200 : 4600
      let phase: 'spin' | 'dive' = 'spin'
      let cancelled = false
      const mark = { t: performance.now() }
      map.jumpTo({ center: [GLOBE_START.lng, GLOBE_START.lat], zoom: GLOBE_ZOOM, bearing: -14 })
      map.easeTo({
        center: [-102, 26],
        zoom: 1.85,
        bearing: 6,
        duration: spinMs,
        essential: true,
      })
      const onEnd = () => {
        if (cancelled || performance.now() - mark.t < 350 || map.isMoving()) return
        if (phase === 'spin') {
          phase = 'dive'
          mark.t = performance.now()
          map.flyTo({
            center: [AUSTIN_CENTER.lng, AUSTIN_CENTER.lat],
            zoom: AUSTIN_ZOOM,
            bearing: 0,
            offset: insetOffset(insetsRef.current),
            duration: diveMs,
            curve: 1.2,
            minZoom: 1.7,
            essential: true,
          })
          return
        }
        map.off('moveend', onEnd)
        finishArrival()
      }
      map.on('moveend', onEnd)
      const interrupt = () => {
        if (!arriving) return
        cancelled = true
        map.off('moveend', onEnd)
        map.stop()
        finishArrival()
      }
      map.on('mousedown', interrupt)
      map.on('touchstart', interrupt)
    }

    map.on('style.load', () => {
      window.clearTimeout(slowTimer)
      ensureH3Layers(map, modeRef.current)
      showGlobe(map)
      applied = new Map()
      hoverCell = null
      strength = 0
      setMapError(null)
      setStyleReady((value) => value + 1)
      fadeTo(restingStrength(), 600)
      if (!arrivalArmed) beginArrival()
      else if (!arriving) {
        report()
        if (container.dataset.arrival === 'handoff') {
          revealTimer = window.setTimeout(revealMap, 1600)
          map.once('idle', revealMap)
        }
      }
    })
    map.on('load', report)
    map.on('moveend', report)
    map.on('move', () => {
      schedule()
      if (!arriving) reportSoon()
    })
    map.on('mousemove', (event) => {
      if (touchRef.current) return
      pointer = { x: event.point.x, y: event.point.y }
      lastPointer = pointer
      pointerSeen = true
      if (fade.to !== 1) fadeTo(1, 160)
      schedule()
    })
    map.on('mouseout', () => {
      if (touchRef.current) return
      pointer = null
      if (!cardHeldRef.current && !inspectOpenRef.current) fadeTo(0, 320)
    })
    map.on('click', (event) => {
      if (modeRef.current === 'off') return
      const cell = latLngToCell(event.lngLat.lat, event.lngLat.lng, H3_RESOLUTION)
      const display = latLngToCell(event.lngLat.lat, event.lngLat.lng, displayResRef.current)
      if (!drawnRef.current.has(cell) && !drawnRef.current.has(display)) return
      clickRef.current(cell, event.originalEvent.shiftKey || touchRef.current)
    })

    const slowTimer = window.setTimeout(() => {
      if (!map.isStyleLoaded()) {
        setMapError('The basemap is taking too long to load. Check the network connection and reload.')
      }
    }, 12000)

    const observer = new ResizeObserver(() => {
      map.resize()
      setSize({ width: container.clientWidth, height: container.clientHeight })
      schedule()
    })
    observer.observe(container)

    return () => {
      active = false
      cancelAnimationFrame(frame)
      window.clearTimeout(slowTimer)
      window.clearTimeout(handoffTimer)
      window.clearTimeout(revealTimer)
      window.clearTimeout(reportTimer)
      window.clearTimeout(hideCardRef.current)
      observer.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || appliedBasemap.current === basemap) return
    appliedBasemap.current = basemap
    if (arrivingRef.current) return
    setMapError(null)
    // A diffed style update would silently drop the H3 source and layers.
    map.setStyle(styleForBasemap(basemap), { diff: false })
  }, [basemap])

  useEffect(() => {
    drawnRef.current = new Set(drawn)
    const source = mapRef.current?.getSource('h3')
    if (source?.type === 'geojson') (source as GeoJSONSource).setData(collection)
    lensRef.current.schedule()
  }, [collection, drawn, styleReady])

  useEffect(() => {
    modeRef.current = hexMode
    const map = mapRef.current
    if (map?.getLayer('h3-fill')) applyHexMode(map, hexMode)
    lensRef.current.schedule()
  }, [hexMode, styleReady])

  useEffect(() => {
    touchRef.current = touch
    lensRef.current.setInput(touch)
  }, [touch])

  useEffect(() => {
    insetsRef.current = insets
    lensRef.current.schedule()
  }, [insets])

  useEffect(() => {
    if (fit.nonce === 0) return
    const map = mapRef.current
    const container = containerRef.current
    const bounds = boundsForCells([...selectedRef.current])
    if (!map || !container || !bounds) return
    map.fitBounds(bounds, {
      padding: fitPadding(container, insetsRef.current),
      maxZoom: fit.zoomIn ? 14.5 : map.getZoom(),
      duration: reducedMotion() ? 0 : 1180,
      easing: easeInOutCubic,
    })
  }, [fit])

  useEffect(() => {
    if (focusNonce === 0 || !focusRef.current) return
    const map = mapRef.current
    if (!map) return
    const [lat, lng] = cellToLatLng(focusRef.current)
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 13.2),
      offset: insetOffset(insetsRef.current),
      duration: reducedMotion() ? 0 : 1200,
      curve: 1.35,
      easing: easeInOutCubic,
    })
  }, [focusNonce])

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        const map = mapRef.current
        if (map) zoomBy(map, ZOOM_STEP, insetsRef.current)
      },
      zoomOut: () => {
        const map = mapRef.current
        if (map) zoomBy(map, -ZOOM_STEP, insetsRef.current)
      },
      resetView: () =>
        mapRef.current?.easeTo({
          center: [AUSTIN_CENTER.lng, AUSTIN_CENTER.lat],
          zoom: AUSTIN_ZOOM,
          bearing: 0,
          offset: insetOffset(insetsRef.current),
          duration: reducedMotion() ? 0 : 1280,
          easing: easeInOutCubic,
        }),
    }),
    [],
  )

  const rest = {
    x: (insets.left + size.width - insets.right) / 2,
    y: (insets.top + size.height - insets.bottom) / 2,
  }
  const cardCount = cardCell ? (countMap.get(cardCell) ?? 0) : 0
  const cardSelected = cardCell ? selectedSet.has(cardCell) : false
  const cardCoverage = cardCell ? cellCoverage?.get(cardCell) : undefined
  const cardStatus = cardCoverage?.status ?? 'missing'

  useEffect(() => {
    if (!inspectOpen) return
    cardHeldRef.current = true
    window.clearTimeout(hideCardRef.current)
    setCardVisible(true)
    if (!cardCell && selected[0]) setCardCell(selected[0])
  }, [inspectOpen, cardCell, selected])

  const holdCard = () => {
    cardHeldRef.current = true
    window.clearTimeout(hideCardRef.current)
    setCardVisible(true)
  }

  const releaseCard = () => {
    if (inspectOpenRef.current) return
    cardHeldRef.current = false
    hideCardRef.current = window.setTimeout(() => {
      if (!inspectOpenRef.current) setCardVisible(false)
    }, 500)
  }

  return (
    <div
      className="relative h-full w-full"
      data-testid="h3-map"
      style={{ '--map-inset-bottom': `${insets.bottom}px` } as CSSProperties}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {touch && hexMode !== 'off' && size.width > 0 && <Reticle x={rest.x} y={rest.y} />}
      {(!touch || inspectOpen) && (
        <div
          ref={cardRef}
          aria-hidden={!cardVisible}
          className={cn(
            'absolute top-0 left-0 z-20 transition-opacity duration-180',
            cardVisible && cardCell ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          {cardCell && (
            <HexHoverCard
              h3={cardCell}
              count={cardCount}
              countLabel={countLabel}
              selected={cardSelected}
              addMode={addMode}
              dataStatus={cardStatus}
              snapshot={cardCoverage?.snapshot ?? null}
              releaseVersion={cardCoverage?.release_version ?? null}
              onAction={(action) => {
                if (action !== 'query' && !inspectOpenRef.current) {
                  cardHeldRef.current = false
                  setCardVisible(false)
                }
                onHexAction?.(cardCell, action)
              }}
              onMouseEnter={holdCard}
              onMouseLeave={releaseCard}
            />
          )}
        </div>
      )}
      {mapError && (
        <div className="glass absolute top-1/2 left-1/2 z-20 max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl px-4 py-3 text-sm text-destructive">
          {mapError}
        </div>
      )}
    </div>
  )
}

function Reticle({ x, y }: { x: number; y: number }) {
  return (
    <svg
      aria-hidden
      width="44"
      height="44"
      viewBox="0 0 44 44"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_0_10px_rgba(61,222,192,0.55)] transition-[left,top] duration-300"
      style={{ left: x, top: y }}
    >
      <circle cx="22" cy="22" r="13" fill="none" stroke="white" strokeOpacity="0.9" strokeWidth="1.5" />
      <path d="M22 2v8M22 34v8M2 22h8M34 22h8" stroke="white" strokeOpacity="0.9" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="22" cy="22" r="2" fill="#3ddec0" />
    </svg>
  )
}

function neighborSpacing(map: MapLibreMap, center: string): number {
  const neighbor = gridDisk(center, 1).find((cell) => cell !== center)
  if (!neighbor) return 0
  const [aLat, aLng] = cellToLatLng(center)
  const [bLat, bLng] = cellToLatLng(neighbor)
  const a = map.project([aLng, aLat])
  const b = map.project([bLng, bLat])
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function insetOffset(inset: MapInsets): [number, number] {
  return [(inset.left - inset.right) / 2, (inset.top - inset.bottom) / 2]
}

/** MapLibre refuses to fit when padding leaves no room, so shrink it on small screens. */
function fitPadding(container: HTMLElement, inset: MapInsets) {
  const extra = 40
  const width = container.clientWidth
  const height = container.clientHeight
  const horizontal = inset.left + inset.right + extra * 2
  const vertical = inset.top + inset.bottom + extra * 2
  const sx = horizontal > width - 80 ? (width - 80) / horizontal : 1
  const sy = vertical > height - 80 ? (height - 80) / vertical : 1
  return {
    top: Math.max(0, (inset.top + extra) * sy),
    bottom: Math.max(0, (inset.bottom + extra) * sy),
    left: Math.max(0, (inset.left + extra) * sx),
    right: Math.max(0, (inset.right + extra) * sx),
  }
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const ZOOM_STEP = 0.55

function easeInOutCubic(progress: number): number {
  return progress < 0.5 ? 4 * progress * progress * progress : 1 - (-2 * progress + 2) ** 3 / 2
}

function zoomBy(map: MapLibreMap, delta: number, inset: MapInsets) {
  const next = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), map.getZoom() + delta))
  const camera = { zoom: next, offset: insetOffset(inset) }
  if (reducedMotion()) {
    map.jumpTo(camera)
    return
  }
  map.stop()
  map.easeTo({ ...camera, duration: 1180, easing: easeInOutCubic, essential: true })
}

/** Globe in the app palette. Streets colors ease back to the basemap by zoom 7. */
function showGlobe(map: MapLibreMap) {
  map.setProjection({ type: 'globe' })
  map.setSky({
    'sky-color': '#05080c',
    'horizon-color': '#1f8f84',
    'fog-color': '#05080c',
    'sky-horizon-blend': 0.48,
    'horizon-fog-blend': 0.8,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 3, 0.55, 6, 0.2, 8, 0],
  })
  if (map.getLayer('background')) {
    map.setPaintProperty('background', 'background-color', [
      'interpolate',
      ['linear'],
      ['zoom'],
      0,
      '#2e3c4a',
      3,
      '#1c2834',
      7,
      '#0c0c0c',
    ])
  }
  if (map.getLayer('water')) {
    map.setPaintProperty('water', 'fill-color', [
      'interpolate',
      ['linear'],
      ['zoom'],
      0,
      '#0b141c',
      3,
      '#10161c',
      7,
      '#1b1b1d',
    ])
  }
}

type FillPaint = NonNullable<Extract<AddLayerObject, { type: 'fill' }>['paint']>
type Expression = Extract<NonNullable<FillPaint['fill-opacity']>, readonly unknown[]>

const HOVER: Expression = ['boolean', ['feature-state', 'hover'], false]
const LENS: Expression = ['number', ['feature-state', 'lens'], 0]
const SELECTED: Expression = ['==', ['get', 'selected'], 1]
const FOCUSED: Expression = ['==', ['get', 'focused'], 1]
const EMPTY: Expression = ['==', ['get', 'snapshot'], 'none']

function fillOpacity(mode: HexMode): Expression {
  if (mode === 'grid') return ['case', EMPTY, 0, HOVER, 0.72, SELECTED, 0.62, 0.5]
  return [
    'case',
    EMPTY,
    0,
    HOVER,
    0.78,
    ['max', ['*', LENS, 0.58], ['case', SELECTED, 0.4, FOCUSED, 0.48, 0]],
  ]
}

function lineOpacity(mode: HexMode): Expression {
  if (mode === 'grid') return ['case', HOVER, 1, FOCUSED, 1, SELECTED, 1, 0.22]
  return ['case', HOVER, 1, FOCUSED, 1, SELECTED, 1, ['*', LENS, 0.65]]
}

/** Fills go under roads and buildings, so streets cut through the color. */
function firstSymbolLayer(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id
}

/** Outlines go above roads, which would otherwise break them into dashes, but below the place labels. */
function topLabelLayer(map: MapLibreMap): string | undefined {
  const layers = map.getStyle().layers
  let index = layers.length
  while (index > 0 && layers[index - 1].type === 'symbol') index -= 1
  return layers[index]?.id
}

function ensureH3Layers(map: MapLibreMap, mode: HexMode) {
  if (!map.getSource('h3')) {
    map.addSource('h3', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: 'h3',
    })
  }
  const visibility = mode === 'off' ? 'none' : 'visible'
  if (!map.getLayer('h3-fill')) {
    map.addLayer(
      {
        id: 'h3-fill',
        type: 'fill',
        source: 'h3',
        layout: { visibility },
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': fillOpacity(mode) },
      },
      firstSymbolLayer(map),
    )
  }
  const beforeId = topLabelLayer(map)
  if (!map.getLayer('h3-glow')) {
    map.addLayer(
      {
        id: 'h3-glow',
        type: 'line',
        source: 'h3',
        layout: { visibility, 'line-join': 'round' },
        paint: {
          'line-color': [
            'case',
            HOVER,
            '#ffffff',
            ['==', ['get', 'snapshot'], 'stale'],
            '#f5c451',
            '#2ee6a6',
          ],
          'line-width': 7,
          'line-blur': 6,
          'line-opacity': ['case', HOVER, 0.55, FOCUSED, 0.6, SELECTED, 0.32, 0],
        },
      },
      beforeId,
    )
  }
  if (!map.getLayer('h3-line')) {
    map.addLayer(
      {
        id: 'h3-line',
        type: 'line',
        source: 'h3',
        layout: { visibility, 'line-join': 'round' },
        paint: {
          'line-color': [
            'case',
            HOVER,
            '#ffffff',
            FOCUSED,
            '#7ef0dc',
            SELECTED,
            '#ffffff',
            ['==', ['get', 'snapshot'], 'current'],
            '#2ee6a6',
            ['==', ['get', 'snapshot'], 'stale'],
            '#f5c451',
            '#6d7d8f',
          ],
          'line-width': ['case', HOVER, 2, FOCUSED, 2.4, SELECTED, 1.8, EMPTY, 0.55, 1.15],
          'line-opacity': lineOpacity(mode),
        },
      },
      beforeId,
    )
  }
}

function applyHexMode(map: MapLibreMap, mode: HexMode) {
  const visibility = mode === 'off' ? 'none' : 'visible'
  for (const id of H3_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
  }
  map.setPaintProperty('h3-fill', 'fill-opacity', fillOpacity(mode))
  if (map.getLayer('h3-line')) map.setPaintProperty('h3-line', 'line-opacity', lineOpacity(mode))
}
