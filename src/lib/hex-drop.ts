/**
 * Opening hex drop, then the dive punch-in.
 * Vertices sit in mercator 0..1 and use MapLibre's projectTileFor3D.
 * North hexes fall first. The dive keeps the Austin cell and splits it.
 */

import { cellToLatLng } from 'h3-js'
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'
import {
  diveHexCells,
  diveResolutionForZoom,
  earthFocusCell,
  earthHexCells,
} from './h3'
import { appearDurationMs, appearEase, introDelayMs } from './hex-appear'
import {
  bindGlobeProjection,
  bindHexAttribs,
  buildHexAttrMesh,
  compileGlShader,
  type HexMesh,
} from './hex-mesh'

export const HEX_DROP_LAYER_ID = 'hex-drop'
export const HEX_DROP_HEIGHT_M = 2_800_000
export const HEX_DROP_DURATION_MS = appearDurationMs('intro')
export const HEX_DROP_WAVE_MS = 1800
export const HEX_DIVE_FADE_MS = 720
export const HEX_DIVE_BASEMAP_ZOOM = 7.4
export const HEX_DIVE_HANDOFF_ZOOM = 10.8

type ProgramSet = {
  program: WebGLProgram
  aPos: number
  aDelay: number
  aKeep: number
}

export type HexDropLayer = CustomLayerInterface & {
  start: (map: MapLibreMap) => void
  beginDive: (map: MapLibreMap, lat: number, lng: number) => void
  syncDive: (zoom: number, lat: number, lng: number) => void
  diveBasemapDue: (zoom: number) => boolean
  diveHandoffDue: (zoom: number) => boolean
  finish: () => void
  fadeOut: (ms?: number) => void
}

export function hexDropElevation(elapsedMs: number, lat: number): number {
  const delay = introDelayMs(lat)
  const t = Math.min(1, Math.max(0, (elapsedMs - delay) / HEX_DROP_DURATION_MS))
  return HEX_DROP_HEIGHT_M * (1 - appearEase(t))
}

export function createHexDropLayer(): HexDropLayer {
  const shaders = new Map<string, ProgramSet>()
  let fillBuffer: WebGLBuffer | null = null
  let lineBuffer: WebGLBuffer | null = null
  let mesh: HexMesh | null = null
  let gl: WebGL2RenderingContext | null = null
  let map: MapLibreMap | null = null
  let startedAt = 0
  let forceDone = false
  let fadeStart = 0
  let fadeMs = 0
  let layerAlpha = 1
  let diveStarted = 0
  let focus = ''
  let meshKey = ''

  const tick = () => {
    map?.triggerRepaint()
  }

  const getProgram = (context: WebGL2RenderingContext, args: CustomRenderMethodInput): ProgramSet | null => {
    const key = args.shaderData.variantName
    const cached = shaders.get(key)
    if (cached) return cached
    const vertex = compileGlShader(
      context,
      context.VERTEX_SHADER,
      `#version 300 es
      ${args.shaderData.vertexShaderPrelude}
      ${args.shaderData.define}
      in vec2 a_pos;
      in float a_delay;
      in float a_keep;
      uniform float u_now;
      uniform float u_duration;
      uniform float u_drop;
      uniform float u_dive;
      out float v_alpha;
      void main() {
        float t = clamp((u_now - a_delay) / max(u_duration, 1.0), 0.0, 1.0);
        float eased = 1.0 - pow(1.0 - t, 3.0);
        float elevation = u_drop * (1.0 - eased);
        float visible = mix(1.0, a_keep, clamp(u_dive, 0.0, 1.0));
        v_alpha = smoothstep(0.0, 0.12, t) * visible;
        gl_Position = projectTileFor3D(a_pos, elevation);
      }`,
    )
    const fragment = compileGlShader(
      context,
      context.FRAGMENT_SHADER,
      `#version 300 es
      precision highp float;
      in float v_alpha;
      uniform vec4 u_color;
      uniform float u_layer_alpha;
      out vec4 fragColor;
      void main() {
        float a = u_color.a * v_alpha * u_layer_alpha;
        fragColor = vec4(u_color.rgb * a, a);
      }`,
    )
    if (!vertex || !fragment) return null
    const program = context.createProgram()
    if (!program) return null
    context.attachShader(program, vertex)
    context.attachShader(program, fragment)
    context.linkProgram(program)
    if (!context.getProgramParameter(program, context.LINK_STATUS)) return null
    const next = {
      program,
      aPos: context.getAttribLocation(program, 'a_pos'),
      aDelay: context.getAttribLocation(program, 'a_delay'),
      aKeep: context.getAttribLocation(program, 'a_keep'),
    }
    shaders.set(key, next)
    return next
  }

  const upload = (next: HexMesh) => {
    if (!gl || !fillBuffer || !lineBuffer) {
      mesh = next
      return
    }
    mesh = next
    gl.bindBuffer(gl.ARRAY_BUFFER, fillBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, next.fill, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, next.line, gl.DYNAMIC_DRAW)
  }

  const draw = (
    context: WebGL2RenderingContext,
    args: CustomRenderMethodInput,
    buffer: WebGLBuffer,
    count: number,
    mode: number,
    color: [number, number, number, number],
  ) => {
    const set = getProgram(context, args)
    if (!set || !mesh) return
    const elapsed = forceDone ? HEX_DROP_WAVE_MS + HEX_DROP_DURATION_MS : Math.max(0, performance.now() - startedAt)
    if (fadeStart > 0) {
      layerAlpha = Math.max(0, 1 - (performance.now() - fadeStart) / Math.max(1, fadeMs))
    }
    const dive = diveStarted > 0 ? Math.min(1, (performance.now() - diveStarted) / HEX_DIVE_FADE_MS) : 0
    context.useProgram(set.program)
    bindGlobeProjection(context, set.program, args)
    context.uniform1f(context.getUniformLocation(set.program, 'u_now'), elapsed)
    context.uniform1f(context.getUniformLocation(set.program, 'u_duration'), HEX_DROP_DURATION_MS)
    context.uniform1f(context.getUniformLocation(set.program, 'u_drop'), HEX_DROP_HEIGHT_M)
    context.uniform1f(context.getUniformLocation(set.program, 'u_dive'), dive)
    context.uniform1f(context.getUniformLocation(set.program, 'u_layer_alpha'), layerAlpha)
    context.uniform4f(context.getUniformLocation(set.program, 'u_color'), color[0], color[1], color[2], color[3])
    context.bindBuffer(context.ARRAY_BUFFER, buffer)
    bindHexAttribs(context, set.aPos, set.aDelay, set.aKeep)
    context.drawArrays(mode, 0, count)
  }

  return {
    id: HEX_DROP_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(nextMap, context) {
      map = nextMap
      gl = context
      mesh = buildEarthMesh(new Set())
      fillBuffer = context.createBuffer()
      lineBuffer = context.createBuffer()
      upload(mesh)
    },
    onRemove(_nextMap, context) {
      if (fillBuffer) context.deleteBuffer(fillBuffer)
      if (lineBuffer) context.deleteBuffer(lineBuffer)
      fillBuffer = null
      lineBuffer = null
      gl = null
      map = null
    },
    render(context, args) {
      if (!mesh || !fillBuffer || !lineBuffer || layerAlpha <= 0) return
      context.enable(context.BLEND)
      context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA)
      context.enable(context.DEPTH_TEST)
      context.depthFunc(context.LEQUAL)
      draw(context, args, fillBuffer, mesh.fillCount, context.TRIANGLES, [0.494, 0.941, 0.863, 0.16])
      draw(context, args, lineBuffer, mesh.lineCount, context.LINES, [0.494, 0.941, 0.863, 0.92])
      const elapsed = forceDone ? HEX_DROP_WAVE_MS + HEX_DROP_DURATION_MS : performance.now() - startedAt
      const fading = fadeStart > 0 && layerAlpha > 0
      const diving = diveStarted > 0 && performance.now() - diveStarted < HEX_DIVE_FADE_MS
      if (startedAt > 0 && (elapsed < HEX_DROP_WAVE_MS + HEX_DROP_DURATION_MS || fading || diving)) tick()
    },
    start(nextMap) {
      map = nextMap
      startedAt = performance.now()
      forceDone = false
      fadeStart = 0
      layerAlpha = 1
      diveStarted = 0
      focus = ''
      meshKey = ''
      upload(buildEarthMesh(new Set()))
      tick()
    },
    beginDive(nextMap, lat, lng) {
      map = nextMap
      forceDone = true
      fadeStart = 0
      layerAlpha = 1
      diveStarted = performance.now()
      focus = earthFocusCell(lat, lng)
      meshKey = ''
      upload(buildEarthMesh(new Set([focus])))
      tick()
    },
    syncDive(zoom, lat, lng) {
      if (diveStarted === 0) return
      const resolution = diveResolutionForZoom(zoom)
      const cells = diveHexCells(lat, lng, zoom)
      const key = `${resolution}:${cells[0] ?? ''}:${cells.length}`
      if (key === meshKey) return
      meshKey = key
      if (resolution <= 1) {
        upload(buildEarthMesh(new Set([focus || earthFocusCell(lat, lng)])))
      } else {
        upload(buildHexAttrMesh(cells, () => ({ delay: 0, keep: 1 })))
      }
      tick()
    },
    diveBasemapDue: (zoom) => zoom >= HEX_DIVE_BASEMAP_ZOOM,
    diveHandoffDue: (zoom) => zoom >= HEX_DIVE_HANDOFF_ZOOM,
    finish() {
      forceDone = true
      fadeStart = 0
      layerAlpha = 1
      tick()
    },
    fadeOut(ms = 420) {
      fadeStart = performance.now()
      fadeMs = ms
      tick()
    },
  }
}

export function buildHexDropMesh(cells: readonly string[] = earthHexCells()): HexMesh {
  return buildHexAttrMesh(cells, (cell) => {
    const [lat] = cellToLatLng(cell)
    return { delay: introDelayMs(lat), keep: 1 }
  })
}

function buildEarthMesh(keep: ReadonlySet<string>): HexMesh {
  return buildHexAttrMesh(earthHexCells(), (cell) => {
    const [lat] = cellToLatLng(cell)
    return { delay: introDelayMs(lat), keep: keep.size === 0 || keep.has(cell) ? 1 : 0 }
  })
}
