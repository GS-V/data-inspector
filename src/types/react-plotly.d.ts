declare module 'react-plotly.js' {
  import type { ComponentType, Ref } from 'react'

  type PlotProps = {
    data: unknown[]
    layout?: Record<string, unknown>
    config?: Record<string, unknown>
    style?: Record<string, string | number>
    useResizeHandler?: boolean
    revision?: number
    onClick?: (event: unknown) => void
    onSelected?: (event: unknown) => void
    ref?: Ref<unknown>
  }

  const Plot: ComponentType<PlotProps>
  export default Plot
}
