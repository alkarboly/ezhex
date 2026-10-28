/**
 * City hover lift. The hovered hex rises off the globe along the
 * surface normal. A shadow stays on the ground so the plate reads
 * even with a top-down camera.
 */

import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MapLibreMap,
} from 'maplibre-gl'
import { appearEase } from './hex-appear'
import {
  bindGlobeProjection,
  bindHexAttribs,
  buildHexAttrMesh,
  compileGlShader,
  type HexMesh,
} from './hex-mesh'

export const HEX_LIFT_LAYER_ID = 'hex-lift'
export const HEX_LIFT_HEIGHT_M = 420
export const HEX_LIFT_MS = 240

type ProgramSet = {
  program: WebGLProgram
  aPos: number
}

export type HexLiftLayer = CustomLayerInterface & {
  setCell: (cell: string | null) => void
}

export function hexLiftElevation(progress: number): number {
  return HEX_LIFT_HEIGHT_M * appearEase(progress)
}

export function createHexLiftLayer(): HexLiftLayer {
  const shaders = new Map<string, ProgramSet>()
  let fillBuffer: WebGLBuffer | null = null
  let lineBuffer: WebGLBuffer | null = null
  let mesh: HexMesh | null = null
  let gl: WebGL2RenderingContext | null = null
  let map: MapLibreMap | null = null
  let cell: string | null = null
  let from = 0
  let to = 0
  let started = 0
  let value = 0

  const tick = () => {
    map?.triggerRepaint()
  }

  const upload = (id: string | null) => {
    if (!id) {
      mesh = null
      return
    }
    mesh = buildHexAttrMesh([id], () => ({ delay: 0, keep: 1 }))
    if (!gl || !fillBuffer || !lineBuffer) return
    gl.bindBuffer(gl.ARRAY_BUFFER, fillBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.fill, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.line, gl.DYNAMIC_DRAW)
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
      uniform float u_elevation;
      void main() {
        gl_Position = projectTileFor3D(a_pos, u_elevation);
      }`,
    )
    const fragment = compileGlShader(
      context,
      context.FRAGMENT_SHADER,
      `#version 300 es
      precision highp float;
      uniform vec4 u_color;
      out vec4 fragColor;
      void main() {
        fragColor = vec4(u_color.rgb * u_color.a, u_color.a);
      }`,
    )
    if (!vertex || !fragment) return null
    const program = context.createProgram()
    if (!program) return null
    context.attachShader(program, vertex)
    context.attachShader(program, fragment)
    context.linkProgram(program)
    if (!context.getProgramParameter(program, context.LINK_STATUS)) return null
    const next = { program, aPos: context.getAttribLocation(program, 'a_pos') }
    shaders.set(key, next)
    return next
  }

  const draw = (
    context: WebGL2RenderingContext,
    args: CustomRenderMethodInput,
    buffer: WebGLBuffer,
    count: number,
    mode: number,
    elevation: number,
    color: [number, number, number, number],
  ) => {
    const set = getProgram(context, args)
    if (!set || !mesh) return
    context.useProgram(set.program)
    bindGlobeProjection(context, set.program, args)
    context.uniform1f(context.getUniformLocation(set.program, 'u_elevation'), elevation)
    context.uniform4f(context.getUniformLocation(set.program, 'u_color'), color[0], color[1], color[2], color[3])
    context.bindBuffer(context.ARRAY_BUFFER, buffer)
    bindHexAttribs(context, set.aPos, -1, -1)
    context.drawArrays(mode, 0, count)
  }

  return {
    id: HEX_LIFT_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(nextMap, context) {
      map = nextMap
      gl = context
      fillBuffer = context.createBuffer()
      lineBuffer = context.createBuffer()
      if (cell) upload(cell)
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
      if (!mesh || !fillBuffer || !lineBuffer) return
      const progress = Math.min(1, (performance.now() - started) / HEX_LIFT_MS)
      value = from + (to - from) * appearEase(progress)
      context.enable(context.BLEND)
      context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA)
      const lift = Math.max(0, value)
      const globe = args.defaultProjectionData.projectionTransition
      const mercatorZ = map ? (MercatorCoordinate.fromLngLat(map.getCenter(), lift).z ?? 0) : 0
      const elevation = globe > 0.5 ? lift : mercatorZ
      const shadow = Math.min(0.4, 0.12 + (lift / HEX_LIFT_HEIGHT_M) * 0.28)
      context.disable(context.DEPTH_TEST)
      draw(context, args, fillBuffer, mesh.fillCount, context.TRIANGLES, 0, [0.02, 0.04, 0.05, shadow])
      draw(context, args, fillBuffer, mesh.fillCount, context.TRIANGLES, elevation, [0.85, 0.99, 0.95, 0.72])
      draw(context, args, lineBuffer, mesh.lineCount, context.LINES, elevation, [1, 1, 1, 1])
      if (progress >= 1 && !cell && value <= 0) mesh = null
      if (cell || progress < 1) tick()
    },
    setCell(next) {
      if (next === cell) return
      const previous = cell
      cell = next
      from = value
      to = next ? HEX_LIFT_HEIGHT_M : 0
      started = performance.now()
      const id = next ?? previous
      if (id) upload(id)
      else mesh = null
      tick()
    },
  }
}
