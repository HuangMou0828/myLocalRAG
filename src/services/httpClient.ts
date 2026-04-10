export type JsonRequest = <T>(input: string, init?: RequestInit) => Promise<T>

export const requestJson: JsonRequest = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || `请求失败: ${response.status}`)
  }
  return response.json() as Promise<T>
}
