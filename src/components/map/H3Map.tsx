import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { Map as MapLibreMap, setWorkerUrl, type AddLayerObject, type GeoJSONSource } from 'maplibre-gl'
import { DATA_ATTRIBUTION_HTML } from '../../lib/licenses'
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
import {
  AUSTIN_CENTER,
  AUSTIN_ZOOM,
  EARTH_MAX_ZOOM,
  EARTH_ZOOM,
  GLOBE_START,
  GLOBE_ZOOM,
  HEX_ENTRY_ZOOM,
  boundsForCells,
  buildH3Collection,
  cellsInView,
  type ViewportStatus,
} from '../../lib/h3'
import { createHexDropLayer, HEX_DROP_LAYER_ID } from '../../lib/hex-drop'
import { createHexLiftLayer, HEX_LIFT_LAYER_ID } from '../../lib/hex-lift'
import {
  appearDelayMs,
  appearDurationMs,
  appearEase,
  appearIsQuiet,
  appearKind,
  outgoingDurationMs,
  shouldFadeOutgoing,
  type AppearKind,
} from '../../lib/hex-appear'
import { lensFalloff, lensRadius, lensRings } from '../../lib/lens'
import { H3_RESOLUTION, MIN_VIEWPORT_ZOOM } from '../../lib/limits'
import { useExplorer, type BasemapId, type FitRequest, type HexMode } from '../../store/explorer-store'
import type { FeatureRow } from '../../lib/feature-rows'
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
  touch: boolean
  insets: MapInsets
  fit: FitRequest
  focusNonce: number
  onCellClick: (h3: string, additive: boolean) => void
  onViewportCells: (ids: string[], status: ViewportStatus, resolution: number) => void
  onCenterCell?: (h3: string | null) => void
  cellCoverage?: ReadonlyMap<string, HexCoverage>
  onHexAction?: (h3: string, action: HexAction) => void
  inspectFeatures?: readonly FeatureRow[]
}

type Point = { x: number; y: number }

type LensApi = {
  schedule: () => void
  setInput: (touch: boolean) => void
  appear: (ids: readonly string[], kind: AppearKind, outgoing: GeoJSON.FeatureCollection | null) => void
}

const H3_LAYERS = ['h3-fill', 'h3-glow', 'h3-line'] as const
const H3_OUT_LAYERS = ['h3-out-fill', 'h3-out-line'] as const
const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
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
  touch,
  insets,
  fit,
  focusNonce,
  onCellClick,
  onViewportCells,
  onCenterCell,
  cellCoverage,
  onHexAction,
  inspectFeatures = [],
}: H3MapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const lensRef = useRef<LensApi>({ schedule: () => {}, setInput: () => {}, appear: () => {} })
  const prevGridRef = useRef<{ ids: Set<string>; collection: GeoJSON.FeatureCollection }>({
    ids: new Set(),
    collection: EMPTY_COLLECTION,
  })
  const clickRef = useRef(onCellClick)
  const actionRef = useRef(onHexAction)
  const coverageRef = useRef(cellCoverage)
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
  const viewModeRef = useRef<'hex' | 'earth'>('earth')
  const bridgingRef = useRef(false)
  const cameraLockRef = useRef(false)
  const lastHexCenterRef = useRef(AUSTIN_CENTER)
  const [styleReady, setStyleReady] = useState(0)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [mapError, setMapError] = useState<string | null>(null)
  const inspectOpen = useExplorer((state) => state.inspectOpen)
  const inspectOpenRef = useRef(inspectOpen)
  inspectOpenRef.current = inspectOpen
  const ignoreClickUntilRef = useRef(0)
  const displayResRef = useRef(H3_RESOLUTION)

  useEffect(() => {
    if (!inspectOpen) ignoreClickUntilRef.current = performance.now() + 400
  }, [inspectOpen])

  useLayoutEffect(() => {
    clickRef.current = onCellClick
    actionRef.current = onHexAction
    coverageRef.current = cellCoverage
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
      canvasContextAttributes: { antialias: true },
      attributionControl: { compact: true, customAttribution: DATA_ATTRIBUTION_HTML },
    })
    map.touchZoomRotate.disableRotation()
    map.scrollZoom.setWheelZoomRate(1 / 1100)
    map.scrollZoom.setZoomRate(1 / 320)
    mapRef.current = map

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
    const appearAnims = new Map<string, { start: number; delay: number; duration: number }>()
    let outFade = { from: 0, to: 0, start: 0, duration: 1, value: 0 }

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


    function render(now: number) {
      frame = 0
      if (!active || !map.getSource('h3')) return
      let again = false
      if (strength !== fade.to) {
        const progress = Math.min(1, (now - fade.start) / Math.max(1, fade.duration))
        strength = progress >= 1 ? fade.to : fade.from + (fade.to - fade.from) * (1 - (1 - progress) ** 3)
        again = progress < 1
      }
      if (outFade.value !== outFade.to) {
        const progress = Math.min(1, (now - outFade.start) / Math.max(1, outFade.duration))
        outFade.value =
          progress >= 1 ? outFade.to : outFade.from + (outFade.to - outFade.from) * (1 - (1 - progress) ** 3)
        paintOutgoing(map, outFade.value)
        if (progress >= 1 && outFade.to === 0) clearOutgoing(map)
        else again = true
      }
      if (appearAnims.size > 0) {
        for (const [cell, anim] of appearAnims) {
          const progress = (now - anim.start - anim.delay) / anim.duration
          if (progress < 0) {
            again = true
            continue
          }
          const value = appearEase(progress)
          setCellState(cell, { appear: value })
          if (progress >= 1) appearAnims.delete(cell)
          else again = true
        }
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

      if (mode !== 'off' && drawnCells.size > 0 && anchor && viewModeRef.current !== 'earth' && !arriving) {
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
        liftLayer.setCell(nextHover)
      }
      if (nextCenter !== centerCell) {
        centerCell = nextCenter
        centerRef.current?.(nextCenter)
      }
      if (again) schedule()
    }

    lensRef.current = {
      schedule,
      setInput: (isTouch) => {
        if (isTouch) {
          pointer = null
        }
        fadeTo(restingStrength(), 300)
      },
      appear: (ids, kind, outgoing) => {
        if (kind === 'none' || !map.getSource('h3')) return
        if (reducedMotion()) {
          appearAnims.clear()
          for (const id of ids) setCellState(id, { appear: 1 })
          clearOutgoing(map)
          schedule()
          return
        }
        if (outgoing && outgoing.features.length > 0) {
          const source = map.getSource('h3-out')
          if (source?.type === 'geojson') (source as GeoJSONSource).setData(outgoing)
          outFade = { from: 1, to: 0, start: performance.now(), duration: outgoingDurationMs(), value: 1 }
          paintOutgoing(map, 1)
        }
        if (ids.length === 0) {
          schedule()
          return
        }
        if (appearIsQuiet(ids)) {
          appearAnims.clear()
          for (const id of ids) setCellState(id, { appear: 1 })
          schedule()
          return
        }
        const origin = map.getCenter()
        const originPt = map.project([origin.lng, origin.lat])
        const sample = ids[0]
        const spacing = sample ? neighborSpacing(map, sample) : 48
        const now = performance.now()
        const duration = appearDurationMs(kind)
        for (const id of ids) {
          const [lat, lng] = cellToLatLng(id)
          const point = map.project([lng, lat])
          appearAnims.set(id, {
            start: now,
            delay: appearDelayMs(Math.hypot(point.x - originPt.x, point.y - originPt.y), spacing, kind),
            duration,
          })
          setCellState(id, { appear: 0 })
        }
        schedule()
      },
    }

    let arriving = !calm
    let arrivalArmed = false
    const dropLayer = createHexDropLayer()
    const liftLayer = createHexLiftLayer()
    let diveLive = false
    let diveBasemap = false
    let diveHandoff = false

    const report = () => {
      if (arriving || bridgingRef.current) return
      const zoom = map.getZoom()
      if (viewModeRef.current === 'earth' || zoom < MIN_VIEWPORT_ZOOM) {
        displayResRef.current = H3_RESOLUTION
        viewportRef.current([], 'zoom-in', H3_RESOLUTION)
        return
      }
      const bounds = map.getBounds()
      const next = cellsInView(
        { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
        zoom,
        displayResRef.current,
      )
      displayResRef.current = next.resolution
      viewportRef.current(next.ids, next.status, next.resolution)
      if (next.status === 'ready') {
        const center = map.getCenter()
        lastHexCenterRef.current = { lng: center.lng, lat: center.lat }
      }
    }

    const settleViewMode = () => {
      viewModeRef.current = map.getZoom() >= MIN_VIEWPORT_ZOOM ? 'hex' : 'earth'
    }

    const bridgeTo = (mode: 'hex' | 'earth') => {
      if (bridgingRef.current || arriving) return
      bridgingRef.current = true
      viewModeRef.current = mode
      const hex = lastHexCenterRef.current
      const camera =
        mode === 'earth'
          ? { center: [hex.lng, hex.lat] as [number, number], zoom: EARTH_ZOOM }
          : {
              center: [hex.lng, hex.lat] as [number, number],
              zoom: HEX_ENTRY_ZOOM,
              offset: insetOffset(insetsRef.current),
            }
      if (reducedMotion()) {
        map.jumpTo(camera)
        bridgingRef.current = false
        report()
        return
      }
      map.stop()
      map.easeTo({
        ...camera,
        duration: 1100,
        easing: easeInOutCubic,
        essential: true,
      })
      map.once('moveend', () => {
        bridgingRef.current = false
        settleViewMode()
        report()
      })
    }

    const maybeBridgeZoom = () => {
      if (arriving || bridgingRef.current || cameraLockRef.current) return
      const zoom = map.getZoom()
      if (viewModeRef.current === 'hex' && zoom < MIN_VIEWPORT_ZOOM - 0.02) {
        bridgeTo('earth')
        return
      }
      if (viewModeRef.current === 'earth' && zoom > EARTH_MAX_ZOOM + 0.02) {
        bridgeTo('hex')
      }
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
      diveLive = false
      diveBasemap = false
      diveHandoff = false
      dropLayer.finish()
      if (map.getLayer(HEX_DROP_LAYER_ID)) map.removeLayer(HEX_DROP_LAYER_ID)
      showOpeningAssets(map, modeRef.current)
      if (!map.getLayer(HEX_LIFT_LAYER_ID)) map.addLayer(liftLayer)
      settleViewMode()
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
      hideOpeningAssets(map)
      if (!map.getLayer(HEX_DROP_LAYER_ID)) map.addLayer(dropLayer)
      dropLayer.start(map)
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
          diveLive = true
          diveBasemap = false
          diveHandoff = false
          mark.t = performance.now()
          dropLayer.beginDive(map, AUSTIN_CENTER.lat, AUSTIN_CENTER.lng)
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
      ensureInspectLayers(map)
      if (!map.getLayer(HEX_LIFT_LAYER_ID)) map.addLayer(liftLayer)
      showGlobe(map)
      applied = new Map()
      hoverCell = null
      strength = 0
      appearAnims.clear()
      outFade = { from: 0, to: 0, start: 0, duration: 1, value: 0 }
      prevGridRef.current = { ids: new Set(), collection: EMPTY_COLLECTION }
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
    map.on('zoom', maybeBridgeZoom)
    map.on('move', () => {
      schedule()
      if (arriving && diveLive) {
        const zoom = map.getZoom()
        const center = map.getCenter()
        dropLayer.syncDive(zoom, center.lat, center.lng)
        if (!diveBasemap && dropLayer.diveBasemapDue(zoom)) {
          diveBasemap = true
          showOpeningAssets(map, modeRef.current)
        }
        if (!diveHandoff && dropLayer.diveHandoffDue(zoom)) {
          diveHandoff = true
          dropLayer.fadeOut(480)
        }
        return
      }
      if (!arriving) {
        maybeBridgeZoom()
        reportSoon()
      }
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
      if (!inspectOpenRef.current) fadeTo(0, 320)
    })
    map.on('click', (event) => {
      if (modeRef.current === 'off' || viewModeRef.current === 'earth') return
      if (performance.now() < ignoreClickUntilRef.current) return
      const cell = latLngToCell(event.lngLat.lat, event.lngLat.lng, H3_RESOLUTION)
      const display = latLngToCell(event.lngLat.lat, event.lngLat.lng, displayResRef.current)
      if (!drawnRef.current.has(cell) && !drawnRef.current.has(display)) return
      const shift = event.originalEvent.shiftKey || touchRef.current
      if (inspectOpenRef.current) {
        actionRef.current?.(cell, coverageRef.current?.get(cell)?.status === 'ready' ? 'query' : 'process')
        return
      }
      if (!shift && coverageRef.current?.get(cell)?.status === 'ready') {
        actionRef.current?.(cell, 'query')
        return
      }
      clickRef.current(cell, shift)
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
      if (!arriving) reportSoon()
    })
    observer.observe(container)

    return () => {
      active = false
      cancelAnimationFrame(frame)
      window.clearTimeout(slowTimer)
      window.clearTimeout(handoffTimer)
      window.clearTimeout(revealTimer)
      window.clearTimeout(reportTimer)
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
    const previous = prevGridRef.current
    const kind = appearKind(previous.ids, drawn)
    const nextIds = new Set(drawn)
    const added = kind === 'pan' ? drawn.filter((id) => !previous.ids.has(id)) : [...drawn]
    const removed = [...previous.ids].filter((id) => !nextIds.has(id))
    const outgoing =
      shouldFadeOutgoing(kind, removed.length) && previous.collection.features.length > 0
        ? {
            type: 'FeatureCollection' as const,
            features: previous.collection.features.filter((feature) => {
              const id = feature.properties && typeof feature.properties === 'object' && 'h3' in feature.properties
                ? String(feature.properties.h3)
                : ''
              return removed.includes(id) || kind === 'swap'
            }),
          }
        : null
    if (kind !== 'none' && (added.length > 0 || outgoing)) {
      lensRef.current.appear(added, kind, outgoing)
    }
    prevGridRef.current = { ids: new Set(drawn), collection }
    lensRef.current.schedule()
  }, [collection, drawn, styleReady])

  useEffect(() => {
    modeRef.current = hexMode
    const map = mapRef.current
    if (map?.getLayer('h3-fill')) applyHexMode(map, hexMode)
    lensRef.current.schedule()
  }, [hexMode, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady || !map.isStyleLoaded()) return
    ensureInspectLayers(map)
    const source = map.getSource('inspect-features')
    if (source?.type === 'geojson') {
      ;(source as GeoJSONSource).setData(featuresToCollection(inspectOpen ? inspectFeatures : []))
    }
  }, [inspectFeatures, inspectOpen, styleReady])

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
    runLockedCamera(map, cameraLockRef, viewModeRef, () => {
      viewModeRef.current = 'hex'
      map.fitBounds(bounds, {
        padding: fitPadding(container, insetsRef.current),
        maxZoom: fit.zoomIn ? 14.5 : map.getZoom(),
        duration: reducedMotion() ? 0 : 1180,
        easing: easeInOutCubic,
      })
    })
  }, [fit])

  useEffect(() => {
    if (focusNonce === 0 || !focusRef.current) return
    const map = mapRef.current
    if (!map) return
    const [lat, lng] = cellToLatLng(focusRef.current)
    runLockedCamera(map, cameraLockRef, viewModeRef, () => {
      viewModeRef.current = 'hex'
      map.flyTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), 13.2),
        offset: insetOffset(insetsRef.current),
        duration: reducedMotion() ? 0 : 1200,
        curve: 1.35,
        easing: easeInOutCubic,
      })
    })
  }, [focusNonce])

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        const map = mapRef.current
        if (!map) return
        if (viewModeRef.current === 'earth') {
          runLockedCamera(map, cameraLockRef, viewModeRef, () => {
            viewModeRef.current = 'hex'
            const hex = lastHexCenterRef.current
            easeCamera(map, {
              center: [hex.lng, hex.lat],
              zoom: HEX_ENTRY_ZOOM,
              offset: insetOffset(insetsRef.current),
            })
          })
          return
        }
        zoomBy(map, ZOOM_STEP, insetsRef.current)
      },
      zoomOut: () => {
        const map = mapRef.current
        if (!map) return
        if (viewModeRef.current === 'hex' && map.getZoom() - ZOOM_STEP < MIN_VIEWPORT_ZOOM) {
          runLockedCamera(map, cameraLockRef, viewModeRef, () => {
            viewModeRef.current = 'earth'
            const hex = lastHexCenterRef.current
            easeCamera(map, { center: [hex.lng, hex.lat], zoom: EARTH_ZOOM })
          })
          return
        }
        zoomBy(map, -ZOOM_STEP, insetsRef.current)
      },
      resetView: () => {
        const map = mapRef.current
        if (!map) return
        runLockedCamera(map, cameraLockRef, viewModeRef, () => {
          viewModeRef.current = 'hex'
          map.easeTo({
            center: [AUSTIN_CENTER.lng, AUSTIN_CENTER.lat],
            zoom: AUSTIN_ZOOM,
            bearing: 0,
            offset: insetOffset(insetsRef.current),
            duration: reducedMotion() ? 0 : 1280,
            easing: easeInOutCubic,
          })
        })
      },
    }),
    [],
  )

  const rest = {
    x: (insets.left + size.width - insets.right) / 2,
    y: (insets.top + size.height - insets.bottom) / 2,
  }

  return (
    <div
      className="relative h-full w-full"
      data-testid="h3-map"
      style={{ '--map-inset-bottom': `${insets.bottom}px` } as CSSProperties}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {touch && hexMode !== 'off' && size.width > 0 && <Reticle x={rest.x} y={rest.y} />}
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
  zoomTo(map, map.getZoom() + delta, inset)
}

function zoomTo(map: MapLibreMap, zoom: number, inset: MapInsets) {
  const next = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), zoom))
  easeCamera(map, { zoom: next, offset: insetOffset(inset) })
}

function easeCamera(
  map: MapLibreMap,
  camera: { center?: [number, number]; zoom: number; offset?: [number, number] },
) {
  if (reducedMotion()) {
    map.jumpTo(camera.center ? { center: camera.center, zoom: camera.zoom } : { zoom: camera.zoom })
    return
  }
  map.stop()
  map.easeTo({ ...camera, duration: 1180, easing: easeInOutCubic, essential: true })
}

function runLockedCamera(
  map: MapLibreMap,
  lock: { current: boolean },
  viewMode: { current: 'hex' | 'earth' },
  run: () => void,
) {
  lock.current = true
  run()
  const release = () => {
    lock.current = false
    viewMode.current = map.getZoom() >= MIN_VIEWPORT_ZOOM ? 'hex' : 'earth'
  }
  if (reducedMotion() || !map.isMoving()) {
    release()
    return
  }
  map.once('moveend', release)
}

function hideOpeningAssets(map: MapLibreMap) {
  const style = map.getStyle()
  if (!style?.layers) return
  for (const layer of style.layers) {
    if (layer.id === 'background') {
      map.setPaintProperty('background', 'background-color', '#05080c')
      continue
    }
    if (layer.id === HEX_DROP_LAYER_ID || layer.id === HEX_LIFT_LAYER_ID || layer.id.startsWith('h3')) continue
    map.setLayoutProperty(layer.id, 'visibility', 'none')
  }
  map.setSky({
    'sky-color': '#05080c',
    'horizon-color': '#123238',
    'fog-color': '#05080c',
    'sky-horizon-blend': 0.62,
    'horizon-fog-blend': 0.88,
    'atmosphere-blend': 0.2,
  })
}

function showOpeningAssets(map: MapLibreMap, mode: HexMode) {
  const style = map.getStyle()
  if (!style?.layers) return
  for (const layer of style.layers) {
    if (layer.id === HEX_DROP_LAYER_ID || layer.id === HEX_LIFT_LAYER_ID) continue
    map.setLayoutProperty(layer.id, 'visibility', 'visible')
  }
  showGlobe(map)
  applyHexMode(map, mode)
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
const APPEAR: Expression = ['number', ['feature-state', 'appear'], 0]
const SELECTED: Expression = ['==', ['get', 'selected'], 1]
const FOCUSED: Expression = ['==', ['get', 'focused'], 1]
const EMPTY: Expression = ['==', ['get', 'snapshot'], 'none']

function withAppear(opacity: Expression): Expression {
  return ['*', APPEAR, opacity]
}

function fillOpacity(mode: HexMode): Expression {
  if (mode === 'off') return ['literal', 0]
  return withAppear(['case', EMPTY, 0, HOVER, 0.78, SELECTED, 0.62, FOCUSED, 0.55, 0.5])
}

function lineOpacity(mode: HexMode): Expression {
  if (mode === 'off') return ['literal', 0]
  return withAppear(['case', HOVER, 1, FOCUSED, 1, SELECTED, 1, EMPTY, mode === 'grid' ? 0.22 : ['*', LENS, 0.4], 0.55])
}

function glowOpacity(): Expression {
  return withAppear(['case', HOVER, 0.55, FOCUSED, 0.6, SELECTED, 0.32, 0])
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
  if (!map.getSource('h3-out')) {
    map.addSource('h3-out', {
      type: 'geojson',
      data: EMPTY_COLLECTION,
    })
  }
  if (!map.getSource('h3')) {
    map.addSource('h3', {
      type: 'geojson',
      data: EMPTY_COLLECTION,
      promoteId: 'h3',
    })
  }
  const visibility = mode === 'off' ? 'none' : 'visible'
  const instant = { duration: 0, delay: 0 }
  if (!map.getLayer('h3-out-fill')) {
    map.addLayer(
      {
        id: 'h3-out-fill',
        type: 'fill',
        source: 'h3-out',
        layout: { visibility },
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0,
          'fill-opacity-transition': instant,
        },
      },
      firstSymbolLayer(map),
    )
  }
  if (!map.getLayer('h3-fill')) {
    map.addLayer(
      {
        id: 'h3-fill',
        type: 'fill',
        source: 'h3',
        layout: { visibility },
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': fillOpacity(mode),
          'fill-opacity-transition': instant,
        },
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
          'line-opacity': glowOpacity(),
          'line-opacity-transition': { duration: 0, delay: 0 },
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
          'line-opacity-transition': { duration: 0, delay: 0 },
        },
      },
      beforeId,
    )
  }
  if (!map.getLayer('h3-out-line')) {
    map.addLayer(
      {
        id: 'h3-out-line',
        type: 'line',
        source: 'h3-out',
        layout: { visibility, 'line-join': 'round' },
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'snapshot'], 'current'],
            '#2ee6a6',
            ['==', ['get', 'snapshot'], 'stale'],
            '#f5c451',
            '#6d7d8f',
          ],
          'line-width': ['case', ['==', ['get', 'snapshot'], 'none'], 0.55, 1.15],
          'line-opacity': 0,
          'line-opacity-transition': { duration: 0, delay: 0 },
        },
      },
      beforeId,
    )
  }
}

function featuresToCollection(rows: readonly FeatureRow[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.flatMap((row) => {
      if (!row.geometry) return []
      return [
        {
          type: 'Feature' as const,
          properties: { kind: row.kind, id: row.id },
          geometry: row.geometry,
        },
      ]
    }),
  }
}

function ensureInspectLayers(map: MapLibreMap) {
  if (!map.getSource('inspect-features')) {
    map.addSource('inspect-features', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getLayer('inspect-buildings')) {
    map.addLayer({
      id: 'inspect-buildings',
      type: 'fill',
      source: 'inspect-features',
      filter: ['==', ['get', 'kind'], 'buildings'],
      paint: { 'fill-color': '#7ef0dc', 'fill-opacity': 0.28 },
    })
  }
  if (!map.getLayer('inspect-buildings-line')) {
    map.addLayer({
      id: 'inspect-buildings-line',
      type: 'line',
      source: 'inspect-features',
      filter: ['==', ['get', 'kind'], 'buildings'],
      paint: { 'line-color': '#7ef0dc', 'line-width': 1.2, 'line-opacity': 0.85 },
    })
  }
  if (!map.getLayer('inspect-points')) {
    map.addLayer({
      id: 'inspect-points',
      type: 'circle',
      source: 'inspect-features',
      filter: ['in', ['get', 'kind'], ['literal', ['places', 'addresses']]],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'kind'], 'places'], 5, 3.5],
        'circle-color': ['case', ['==', ['get', 'kind'], 'places'], '#2ee6a6', '#f5c451'],
        'circle-stroke-width': 1,
        'circle-stroke-color': '#04110d',
      },
    })
  }
}

function applyHexMode(map: MapLibreMap, mode: HexMode) {
  const visibility = mode === 'off' ? 'none' : 'visible'
  for (const id of [...H3_LAYERS, ...H3_OUT_LAYERS]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
  }
  map.setPaintProperty('h3-fill', 'fill-opacity', fillOpacity(mode))
  if (map.getLayer('h3-line')) map.setPaintProperty('h3-line', 'line-opacity', lineOpacity(mode))
  if (map.getLayer('h3-glow')) map.setPaintProperty('h3-glow', 'line-opacity', glowOpacity())
}

function paintOutgoing(map: MapLibreMap, fade: number) {
  if (map.getLayer('h3-out-fill')) {
    map.setPaintProperty('h3-out-fill', 'fill-opacity', ['*', ['case', EMPTY, 0, 0.5], fade])
  }
  if (map.getLayer('h3-out-line')) {
    map.setPaintProperty('h3-out-line', 'line-opacity', ['*', ['case', EMPTY, 0.18, 0.45], fade])
  }
}

function clearOutgoing(map: MapLibreMap) {
  const source = map.getSource('h3-out')
  if (source?.type === 'geojson') (source as GeoJSONSource).setData(EMPTY_COLLECTION)
  paintOutgoing(map, 0)
}
