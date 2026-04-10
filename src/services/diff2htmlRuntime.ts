type Diff2HtmlModule = typeof import('diff2html')

let diff2HtmlModule: Diff2HtmlModule | null = null
let diff2HtmlPromise: Promise<Diff2HtmlModule> | null = null

export function getLoadedDiff2HtmlModule(): Diff2HtmlModule | null {
  return diff2HtmlModule
}

export async function ensureDiff2HtmlModule(): Promise<Diff2HtmlModule> {
  if (diff2HtmlModule) {
    return diff2HtmlModule
  }
  if (!diff2HtmlPromise) {
    diff2HtmlPromise = import('diff2html')
  }
  diff2HtmlModule = await diff2HtmlPromise
  return diff2HtmlModule
}
