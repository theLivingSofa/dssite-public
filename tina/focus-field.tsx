import React from "react";
import { wrapFieldsWithMeta } from "tinacms";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, focusPoint } from "../lib/content-rules.mjs";
import { responsive } from "../lib/images";

// "Position in frame" for a gallery photo: drag the photo inside its frame and zoom with
// the slider. Stored as "across down zoom" in percent, e.g. "42 30 140". Empty means the
// default: the upper part of the photo, not zoomed. The page shows it the same way
// (see `.g img` and the fx-, fy- and z- classes in public/css/main.css).

type FinalForm = {
  getState(): { values: Record<string, unknown> };
  subscribe(listener: () => void, subscription: { values: true }): () => void;
};
type Props = { input: { name: string; value?: string; onChange(value: string): void }; form: FinalForm };
type Place = { x: number; y: number; z: number };

// The shapes of the seven gallery frames, in the order the layout repeats them.
// Keep in step with `.g--a img` to `.g--g img` in public/css/main.css.
const FRAMES = [
  { ratio: 16 / 9, x: 50 },
  { ratio: 4 / 5, x: 22 },
  { ratio: 1200 / 271, x: 50, phone: 16 / 7 },
  { ratio: 4 / 3, x: 30 },
  { ratio: 1, x: 62 },
  { ratio: 2.1, x: 50 },
  { ratio: 4 / 5, x: 60 },
];
const DEFAULT_Y = 30;

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
const stored = ({ x, y, z }: Place) => (z > MIN_ZOOM ? `${x} ${y} ${z}` : `${x} ${y}`);

const valueAt = (values: unknown, path: string) =>
  path.split(".").reduce<unknown>((node, step) => (node as Record<string, unknown> | undefined)?.[step], values);

const button: React.CSSProperties = {
  minHeight: 30,
  padding: "0 10px",
  border: "1px solid #16130f",
  borderRadius: 4,
  background: "#fff",
  color: "#16130f",
  font: "500 12px/1.2 system-ui, sans-serif",
  cursor: "pointer",
};
const note: React.CSSProperties = { margin: "6px 0 0", font: "400 12px/1.4 system-ui, sans-serif", color: "#5c5548" };

// The photo as the page shows it in a frame of this shape.
const framed = ({ x, y, z }: Place): React.CSSProperties => ({
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: `${x}% ${y}%`,
  transformOrigin: `${x}% ${y}%`,
  transform: `scale(${z / 100})`,
  userSelect: "none",
  pointerEvents: "none",
});

function PositionPicker({ input, form }: Props) {
  const [, redraw] = React.useReducer((n: number) => n + 1, 0);
  // Redraw when the photo above is changed or the list is reordered.
  React.useEffect(() => form.subscribe(redraw, { values: true }), [form]);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const imageRef = React.useRef<HTMLImageElement>(null);
  const drag = React.useRef<{ id: number; startX: number; startY: number; from: Place } | null>(null);

  const imageName = input.name.replace(/[^.]+$/, "image");
  const image = valueAt(form.getState().values, imageName);
  const src = typeof image === "string" && image ? responsive(image, 1200).src : undefined;
  const index = Number(input.name.match(/\.(\d+)\.[^.]+$/)?.[1] ?? 0);
  const frame = FRAMES[index % FRAMES.length];

  const saved = focusPoint(input.value);
  const place: Place = saved ?? { x: frame.x, y: DEFAULT_Y, z: MIN_ZOOM };
  const set = (next: Place) => input.onChange(stored({ x: clamp(next.x), y: clamp(next.y), z: next.z }));

  // How far one percent of position moves the photo, in pixels, for this frame and zoom.
  // Zero means the photo already fills the frame that way and cannot move.
  const pixelsPerStep = (z: number) => {
    const box = frameRef.current?.getBoundingClientRect();
    const photo = imageRef.current;
    if (!box || !photo?.naturalWidth) return { across: 0, down: 0 };
    const cover = Math.max(box.width / photo.naturalWidth, box.height / photo.naturalHeight);
    const scale = z / 100;
    return {
      across: (box.width - scale * photo.naturalWidth * cover) / 100,
      down: (box.height - scale * photo.naturalHeight * cover) / 100,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, from: place };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const step = pixelsPerStep(start.from.z);
    const x = step.across < -0.01 ? start.from.x + (event.clientX - start.startX) / step.across : start.from.x;
    const y = step.down < -0.01 ? start.from.y + (event.clientY - start.startY) / step.down : start.from.y;
    if (clamp(x) !== place.x || clamp(y) !== place.y) set({ x, y, z: start.from.z });
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Arrow keys move the photo the way it looks: right shows more of its left side.
    const move = { ArrowLeft: [2, 0], ArrowRight: [-2, 0], ArrowUp: [0, 2], ArrowDown: [0, -2] }[event.key];
    if (!move) return;
    event.preventDefault();
    set({ x: place.x + move[0], y: place.y + move[1], z: place.z });
  };

  if (!src) return <p style={note}>Choose a photo above first.</p>;

  return (
    <div>
      <div
        ref={frameRef}
        role="group"
        tabIndex={0}
        aria-label={`Photo position: ${place.x}% across, ${place.y}% down, zoom ${place.z}%. Drag the photo, or use the arrow keys.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKey}
        style={{
          position: "relative",
          aspectRatio: String(frame.ratio),
          overflow: "hidden",
          borderRadius: 4,
          background: "#e8e1d3",
          cursor: drag.current ? "grabbing" : "grab",
          touchAction: "none",
          outlineOffset: 2,
        }}
      >
        <img ref={imageRef} src={src} alt="" draggable={false} onLoad={redraw} style={framed(place)} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, font: "500 12px/1.2 system-ui, sans-serif", color: "#16130f" }}>
        Zoom
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={ZOOM_STEP}
          value={place.z}
          onChange={(event) => set({ ...place, z: Number(event.target.value) })}
          style={{ flex: 1 }}
        />
        <span style={{ minWidth: 38, textAlign: "right" }}>{place.z}%</span>
      </label>
      {frame.phone && (
        <figure style={{ margin: "10px 0 0" }}>
          <div style={{ aspectRatio: String(frame.phone), overflow: "hidden", borderRadius: 3, background: "#e8e1d3", maxWidth: "70%" }}>
            <img src={src} alt="" draggable={false} style={framed(place)} />
          </div>
          <figcaption style={{ ...note, marginTop: 3 }}>The same photo on a phone, where this frame is taller.</figcaption>
        </figure>
      )}
      <p style={note}>
        {saved
          ? "This is how the photo sits in its frame on the page. Drag to move it and use the slider to zoom."
          : "Not set: the frame shows the upper part of the photo. Drag to move it and use the slider to zoom."}
      </p>
      {saved && (
        <button type="button" style={{ ...button, marginTop: 8 }} onClick={() => input.onChange("")}>
          Back to default
        </button>
      )}
    </div>
  );
}

export const FocusPointField = wrapFieldsWithMeta(PositionPicker as unknown as React.FC<Props>);
