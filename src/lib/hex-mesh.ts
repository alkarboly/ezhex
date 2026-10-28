/**
 * Mercator hex plates for globe custom layers.
 * projectTileFor3D takes these 0..1 coords plus elevation in meters.
 */

import { cellToBoundary } from 'h3-js'
import { MercatorCoordinate, type CustomRenderMethodInput } from 'maplibre-gl'

export type HexMesh = {
  fill: Float32Array
  fillCount: number
  line: Float32Array
  lineCount: number
}

export type HexVertAttr = {
  delay: number
  keep: number
}

const STRIDE_FLOATS = 4

export function buildHexAttrMesh(
  cells: readonly string[],
  attr: (cell: string) => HexVertAttr,
): HexMesh {
  const fills: number[] = []
  const lines: number[] = []
  for (const cell of cells) {
    const extra = attr(cell)
    const ring = unwrapRing(cellToBoundary(cell, true).map((pair) => [pair[0], pair[1]] as [number, number]))
    const verts = ring.map(([lng, lat]) => MercatorCoordinate.fromLngLat({ lng, lat }))
    if (verts.length < 3) continue
    for (let i = 1; i < verts.length - 1; i += 1) {
      pushVert(fills, verts[0], extra)
      pushVert(fills, verts[i], extra)
      pushVert(fills, verts[i + 1], extra)
    }
    for (let i = 0; i < verts.length; i += 1) {
      pushVert(lines, verts[i], extra)
      pushVert(lines, verts[(i + 1) % verts.length], extra)
    }
  }
  return {
    fill: new Float32Array(fills),
    fillCount: fills.length / STRIDE_FLOATS,
    line: new Float32Array(lines),
    lineCount: lines.length / STRIDE_FLOATS,
  }
}

export function bindGlobeProjection(gl: WebGL2RenderingContext, program: WebGLProgram, args: CustomRenderMethodInput) {
  const data = args.defaultProjectionData
  gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_projection_fallback_matrix'), false, data.fallbackMatrix)
  gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_projection_matrix'), false, data.mainMatrix)
  gl.uniform4f(gl.getUniformLocation(program, 'u_projection_tile_mercator_coords'), ...data.tileMercatorCoords)
  gl.uniform4f(gl.getUniformLocation(program, 'u_projection_clipping_plane'), ...data.clippingPlane)
  gl.uniform1f(gl.getUniformLocation(program, 'u_projection_transition'), data.projectionTransition)
  const clip = gl.getUniformLocation(program, 'u_projection_clip_antimeridian')
  if (clip) gl.uniform1f(clip, data.clipAntimeridian ? 1 : 0)
}

export function compileGlShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
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

export function bindHexAttribs(gl: WebGL2RenderingContext, aPos: number, aDelay: number, aKeep: number) {
  const stride = STRIDE_FLOATS * 4
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0)
  if (aDelay >= 0) {
    gl.enableVertexAttribArray(aDelay)
    gl.vertexAttribPointer(aDelay, 1, gl.FLOAT, false, stride, 8)
  }
  if (aKeep >= 0) {
    gl.enableVertexAttribArray(aKeep)
    gl.vertexAttribPointer(aKeep, 1, gl.FLOAT, false, stride, 12)
  }
}

function pushVert(target: number[], point: { x: number; y: number }, extra: HexVertAttr) {
  target.push(point.x, point.y, extra.delay, extra.keep)
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
