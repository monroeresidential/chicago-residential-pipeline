export function toGeocodeQuery(address: string): string {
  const cleaned = address.replace(/^(\d+)-\d+/, "$1").replace(/\./g, "");
  return `${cleaned}, Chicago, IL`;
}

interface CensusResponse {
  result?: { addressMatches?: { coordinates?: { x?: unknown; y?: unknown } }[] };
}

export function parseCensusResponse(json: unknown): { lat: number; lng: number } | null {
  const c = (json as CensusResponse | null)?.result?.addressMatches?.[0]?.coordinates;
  if (typeof c?.x !== "number" || typeof c?.y !== "number") return null;
  return { lat: c.y, lng: c.x };
}
