/** Deterministic placeholder colour per entity id (used while character models are not available). */
export function placeholderColor(id: string, lightness = 52): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `hsl(${h % 360} 68% ${lightness}%)`;
}
