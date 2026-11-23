import manifest from "./images.generated.json";

type ImageSet = { width: number; height: number; sizes: { width: number; url: string }[] };

const sets = manifest as Record<string, ImageSet>;

// `target` is the width used as the plain src for browsers that ignore srcset.
export function responsive(value: string | null | undefined, target: number) {
  if (!value) return { src: undefined };
  // TinaCloud serves media from its own host, relative to the media folder.
  const local = value.replace(/^https:\/\/assets\.tina\.io\/[^/]+/, "");
  const set = sets[local] ?? sets[`/assets/img${local}`];
  // A photo uploaded during this editing session has no sizes until the next build.
  if (!set) return { src: value };
  const fitting = set.sizes.filter((size) => size.width <= target);
  return {
    src: (fitting.at(-1) ?? set.sizes[0]).url,
    srcSet: set.sizes.map((size) => `${size.url} ${size.width}w`).join(", "),
    width: set.width,
    height: set.height,
  };
}
