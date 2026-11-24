// The "print" look given to every photo: muted colour, mapped between ink and paper,
// with a warm cast. scripts/images.mjs applies it to the files when the site is built,
// and the editor shows the same look on a new photo straight away.
export const INK = [24 / 255, 20 / 255, 16 / 255];
export const PAPER = [249 / 255, 244 / 255, 233 / 255];
export const WARM = [1, 0.985, 0.94];
export const KEEP_COLOUR = 0.2;
export const LUMA = [0.299, 0.587, 0.114];

// The same treatment, minus the grain, as an SVG colour matrix (rows for red, green and blue).
export function printToneMatrix() {
  const rows = [0, 1, 2].map((k) => {
    const scale = WARM[k] * (PAPER[k] - INK[k]);
    const mix = LUMA.map((weight, c) => scale * ((1 - KEEP_COLOUR) * weight + (c === k ? KEEP_COLOUR : 0)));
    return [...mix, 0, WARM[k] * INK[k]];
  });
  return [...rows.flat(), 0, 0, 0, 1, 0].map((value) => Number(value.toFixed(5))).join(" ");
}
