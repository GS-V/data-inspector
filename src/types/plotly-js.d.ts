// react-plotly.js imports this exact entry point internally (see
// node_modules/react-plotly.js/dist/index.mjs), so importing it here too guarantees the same
// module instance -- and thus the same internal Plotly state attached to a given graph div --
// rather than a second, separately-bundled copy of the library. Neither `plotly.js` nor this
// specific sub-path ships its own type declarations, so this covers only what this app calls.
declare module 'plotly.js/dist/plotly' {
  export type DownloadImageFormat = 'png' | 'svg' | 'jpeg' | 'webp'

  export interface DownloadImageOptions {
    format?: DownloadImageFormat
    width?: number
    height?: number
    filename?: string
  }

  const Plotly: {
    downloadImage: (graphDiv: HTMLElement, options: DownloadImageOptions) => Promise<string>
  }

  export default Plotly
}
