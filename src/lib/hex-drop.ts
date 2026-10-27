/**
 * Opening hex drop. Vertices sit in mercator 0..1 and use MapLibre's
 * projectTileFor3D so elevation is meters above the globe sphere.
 * North hexes fall first. South hexes land last.
 */

import { cellToBoundary, cellToLatLng } from 'h3-js'
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MapLibreMap,
} from 'maplibre-gl'
import { earthHexCells } from './h3'
import { appearDurationMs, appearEase, introDelayMs } from './hex-appear'

export const HEX_DROP_LAYER_ID = 'hex-drop'
export const HEX_DROP_HEIGHT_M = 2_800_000
export const HEX_DROP_DURATION_MS = appearDurationMs('intro')
export const HEX_DROP_WAVE_MS = 1800

type Mesh = {
  fill: Float32Array
  fillCount: number
  line: Float32Array
  lineCount: number
}

type ProgramSet = {
  program: WebGLProgram
  aPos: number
  aDelay: number
}

export type HexDropLayer = CustomLayerInterface & {
  start: (map: MapLibreMap) => void
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
  let mesh: Mesh | null = null
  let map: MapLibreMap | null = null
  let startedAt = 0
  let forceDone = false
  let fadeStart = 0
  let fadeMs = 0
  let layerAlpha = 1

  const tick = () => {
    map?.triggerRepaint()
  }

  const bindProjection = (gl: WebGL2RenderingContext, program: WebGLProgram, args: CustomRenderMethodInput) => {
    const data = args.defaultProjectionData
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_projection_fallback_matrix'), false, data.fallbackMatrix)
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_projection_matrix'), false, data.mainMatrix)
    gl.uniform4f(gl.getUniformLocation(program, 'u_projection_tile_mercator_coords'), ...data.tileMercatorCoords)
    gl.uniform4f(gl.getUniformLocation(program, 'u_projection_clipping_plane'), ...data.clippingPlane)
    gl.uniform1f(gl.getUniformLocation(program, 'u_projection_transition'), data.projectionTransition)
    const clip = gl.getUniformLocation(program, 'u_projection_clip_antimeridian')
    if (clip) gl.uniform1f(clip, data.clipAntimeridian ? 1 : 0)
  }

  const getProgram = (gl: WebGL2RenderingContext, args: CustomRenderMethodInput): ProgramSet | null => {
    const key = args.shaderData.variantName
    const cached = shaders.get(key)
    if (cached) return cached
    const vertex = compile(
      gl,
      gl.VERTEX_SHADER,
      `#version 300 es
      ${args.shaderData.vertexShaderPrelude}
      ${args.shaderData.define}
      in vec2 a_pos;
      in float a_delay;
      uniform float u_now;
      uniform float u_duration;
      uniform float u_drop;
      out float v_alpha;
      void main() {
        float t = clamp((u_now - a_delay) / max(u_duration, 1.0), 0.0, 1.0);
        float eased = 1.0 - pow(1.0 - t, 3.0);
        float elevation = u_drop * (1.0 - eased);
        v_alpha = smoothstep(0.0, 0.12, t);
        gl_Position = projectTileFor3D(a_pos, elevation);
      }`,
    )
    const fragment = compile(
      gl,
      gl.FRAGMENT_SHADER,
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
    const program = gl.createProgram()
    if (!program) return null
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
    const next = {
      program,
      aPos: gl.getAttribLocation(program, 'a_pos'),
      aDelay: gl.getAttribLocation(program, 'a_delay'),
    }
    shaders.set(key, next)
    return next
  }

  const draw = (
    gl: WebGL2RenderingContext,
    args: CustomRenderMethodInput,
    buffer: WebGLBuffer,
    count: number,
    mode: number,
    color: [number, number, number, number],
  ) => {
    const set = getProgram(gl, args)
    if (!set || !mesh) return
    const elapsed = forceDone ? HEX_DROP_WAVE_MS + HEX_DROP_DURATION_MS : Math.max(0, performance.now() - startedAt)
    if (fadeStart > 0) {
      layerAlpha = Math.max(0, 1 - (performance.now() - fadeStart) / Math.max(1, fadeMs))
    }
    gl.useProgram(set.program)
    bindProjection(gl, set.program, args)
    gl.uniform1f(gl.getUniformLocation(set.program, 'u_now'), elapsed)
    gl.uniform1f(gl.getUniformLocation(set.program, 'u_duration'), HEX_DROP_DURATION_MS)
    gl.uniform1f(gl.getUniformLocation(set.program, 'u_drop'), HEX_DROP_HEIGHT_M)
    gl.uniform1f(gl.getUniformLocation(set.program, 'u_layer_alpha'), layerAlpha)
    gl.uniform4f(gl.getUniformLocation(set.program, 'u_color'), color[0], color[1], color[2], color[3])
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(set.aPos)
    gl.vertexAttribPointer(set.aPos, 2, gl.FLOAT, false, 12, 0)
    gl.enableVertexAttribArray(set.aDelay)
    gl.vertexAttribPointer(set.aDelay, 1, gl.FLOAT, false, 12, 8)
    gl.drawArrays(mode, 0, count)
  }

  return {
    id: HEX_DROP_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(nextMap, gl) {
      map = nextMap
      mesh = buildHexDropMesh()
      fillBuffer = gl.createBuffer()
      lineBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, fillBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, mesh.fill, gl.STATIC_DRAW)
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, mesh.line, gl.STATIC_DRAW)
    },
    onRemove(_nextMap, gl) {
      if (fillBuffer) gl.deleteBuffer(fillBuffer)
      if (lineBuffer) gl.deleteBuffer(lineBuffer)
      fillBuffer = null
      lineBuffer = null
      map = null
    },
    render(gl, args) {
      if (!mesh || !fillBuffer || !lineBuffer || layerAlpha <= 0) return
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      draw(gl, args, fillBuffer, mesh.fillCount, gl.TRIANGLES, [0.494, 0.941, 0.863, 0.16])
      draw(gl, args, lineBuffer, mesh.lineCount, gl.LINES, [0.494, 0.941, 0.863, 0.92])
      const elapsed = forceDone ? HEX_DROP_WAVE_MS + HEX_DROP_DURATION_MS : performance.now() - startedAt
      const fading = fadeStart > 0 && layerAlpha > 0
      if (startedAt > 0 && (elapsed < HEX_DROP_WAVE_MS + HEX_DROP_DURATION_MS || fading)) tick()
    },
    start(nextMap) {
      map = nextMap
      startedAt = performance.now()
      forceDone = false
      fadeStart = 0
      layerAlpha = 1
      tick()
    },
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

export function buildHexDropMesh(cells: readonly string[] = earthHexCells()): Mesh {
  const fills: number[] = []
  const lines: number[] = []
  for (const cell of cells) {
    const [lat] = cellToLatLng(cell)
    const delay = introDelayMs(lat)
    const ring = unwrapRing(cellToBoundary(cell, true).map((pair) => [pair[0], pair[1]] as [number, number]))
    const verts = ringToMercator(ring)
    if (verts.length < 3) continue
    for (let i = 1; i < verts.length - 1; i += 1) {
      pushVert(fills, verts[0], delay)
      pushVert(fills, verts[i], delay)
      pushVert(fills, verts[i + 1], delay)
    }
    for (let i = 0; i < verts.length; i += 1) {
      const next = verts[(i + 1) % verts.length]
      pushVert(lines, verts[i], delay)
      pushVert(lines, next, delay)
    }
  }
  return {
    fill: new Float32Array(fills),
    fillCount: fills.length / 3,
    line: new Float32Array(lines),
    lineCount: lines.length / 3,
  }
}

function pushVert(target: number[], point: { x: number; y: number }, delay: number) {
  target.push(point.x, point.y, delay)
}

function unwrapRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring
  const out: [number, number][] = [[ring[0][0], ring[0][1]]]
  for (let i = 1; i < ring.length; i += 1) {
    let lng = ring[i][0]
    const prev = out[i - 1][0]
    while (lng - prev > 180) lng -= 360
    while (lng - prev < -180) lng += 360
    out.push([lng, ring[i][1]])
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) out.pop()
  return out
}

function ringToMercator(ring: [number, number][]) {
  return ring.map(([lng, lat]) => MercatorCoordinate.fromLngLat({ lng, lat }))
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}
