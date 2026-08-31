import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Choosing WHICH PART of a picture is kept, before any of it is uploaded.
 *
 * The whole state machine for the crop dialog lives here so the dialog itself
 * stays a rendering of numbers: it draws a frame, an image at a transform, and a
 * zoom slider, and emits "cropped". Everything that is arithmetic — the cover
 * fit, the pan clamp, the pinch, the source rectangle, the encode — is here.
 *
 * WHY THIS EXISTS AT ALL. There was no crop anywhere in the app: the upload hook
 * PUT the raw `File` to storage untouched, and every surface then centre-cropped
 * it with CSS `background-size: cover`. So a band photo with the singer at the
 * left edge became a circular avatar of a guitar, the owner could see it was
 * wrong and had no way to say what they meant, and storage held megabytes of
 * pixels nobody would ever see. Cropping before the PUT fixes all three: the
 * bytes in the bucket ARE the picture the owner chose.
 *
 * NO DEPENDENCY. Everything below is `<img>` + pointer events + one
 * `canvas.toBlob`. The alternatives weighed were `react-easy-crop` (~14 kB gzip,
 * and it brings its own gesture layer) and `cropperjs` (~40 kB gzip plus a
 * stylesheet). Both would have carried a second design language into a screen
 * that already has one, for roughly 150 lines of arithmetic we can read.
 */

/** A crop shape, named for where the result is actually used. */
export interface CropShape {
  /** width / height of the frame — and of the file that comes out of it. */
  aspect: number;
  /** Longest edge we will ever write. The crop never UPSCALES past the source. */
  outputWidth: number;
  /** Said to the owner, above the frame. */
  guidance: string;
}

/**
 * The two shapes a profile picture is used at. The crop frame matches the place
 * the picture lands, which is the point: offering a free crop and then letting
 * CSS `cover` centre-crop it again is the bug, not the fix.
 *
 * `banner` is 3:1 because that is the size the field has always advised
 * ("around 1500×500"). The hero draws it 190px tall inside a full-width card,
 * which is wider still — a 3:1 source is trimmed a little at the top and bottom
 * there rather than being pillar-boxed, which is the right way round.
 */
export const CROP_SHAPES: Record<"avatar" | "banner", CropShape> = {
  avatar: {
    aspect: 1,
    outputWidth: 1024,
    guidance:
      "Drag to move, pinch or use the slider to zoom. This is the square your picture is shown in.",
  },
  banner: {
    aspect: 3,
    outputWidth: 1500,
    guidance:
      "Drag to move, pinch or use the slider to zoom. This is the strip that runs across the top of your page.",
  },
};

const MAX_ZOOM = 4;

/**
 * What the crop is encoded as.
 *
 * WebP first: it keeps transparency (a venue's logo often has some), it is a
 * third the size of the equivalent JPEG, and it is on the API's `photo`
 * allow-list. PNG is the fallback, and it is a real one rather than a formality
 * — `toBlob` with an unsupported type does not throw, it silently hands back a
 * PNG, so the returned blob's OWN type is what we believe, not what we asked
 * for.
 */
const PREFERRED_TYPE = "image/webp";
const FALLBACK_TYPE = "image/png";

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** `photo.HEIC` must not become `photo.HEIC` holding WebP bytes. */
function renameForType(fileName: string, type: string): string {
  const extension = type === "image/webp" ? "webp" : "png";
  const stem = fileName.replace(/\.[^.]+$/, "") || "image";
  return `${stem}.${extension}`;
}

export type CropperStatus = "idle" | "loading" | "ready" | "undecodable";

export interface ImageCropperView {
  status: CropperStatus;
  /** Object URL for the source image; null until it has loaded. */
  imageUrl: string | null;
  /** Put this on the fixed-aspect frame — the hook measures it to do the maths. */
  frameRef: (node: HTMLDivElement | null) => void;
  /** Width/height/transform for the `<img>` inside the frame. */
  imageWidth: number;
  imageHeight: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
  maxZoom: number;
  setZoom(next: number): void;
  onPointerDown(pointerEvent: ReactPointerEvent<HTMLDivElement>): void;
  onPointerMove(pointerEvent: ReactPointerEvent<HTMLDivElement>): void;
  onPointerUp(pointerEvent: ReactPointerEvent<HTMLDivElement>): void;
  /** Encode the visible rectangle. Null when there is nothing to encode. */
  crop(): Promise<File | null>;
}

export function useImageCropper(file: File | null, shape: CropShape): ImageCropperView {
  const [status, setStatus] = useState<CropperStatus>("idle");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [zoom, setRawZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const imageElement = useRef<HTMLImageElement | null>(null);
  // Live pointers, so one finger pans and two fingers pinch on the same surface.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  // Decode the picked file. The object URL is revoked when the file changes or
  // the dialog closes — a leaked one pins the whole image in memory.
  useEffect(() => {
    if (!file) {
      setStatus("idle");
      setImageUrl(null);
      setNatural(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setStatus("loading");
    setImageUrl(url);
    setNatural(null);
    setRawZoom(1);
    setOffset({ x: 0, y: 0 });

    const image = new Image();
    image.onload = () => {
      imageElement.current = image;
      setNatural({ width: image.naturalWidth, height: image.naturalHeight });
      setStatus(image.naturalWidth > 0 ? "ready" : "undecodable");
    };
    // A format this browser cannot decode — HEIC outside Safari is the real
    // case. Not an error to shout about: the caller uploads the original
    // untouched, which is exactly what it did before this existed.
    image.onerror = () => {
      imageElement.current = null;
      setStatus("undecodable");
    };
    image.src = url;

    return () => {
      URL.revokeObjectURL(url);
      imageElement.current = null;
    };
  }, [file]);

  /**
   * The frame is sized by CSS (`aspect-ratio` inside a fluid column), so its
   * pixel size is only knowable by measuring — and it changes when the phone
   * rotates or the dialog reflows.
   *
   * Measured from the REF CALLBACK rather than from an effect, because the frame
   * is mounted and unmounted with the dialog: an effect would have to name the
   * thing that makes it appear as a dependency, and would then be re-subscribing
   * on a state change instead of on the element actually arriving. The callback
   * fires exactly when the element does, which is the question being asked.
   */
  const observer = useRef<ResizeObserver | null>(null);
  const frameRef = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setFrame({ width: node.clientWidth, height: node.clientHeight });
    if (typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(() =>
      setFrame({ width: node.clientWidth, height: node.clientHeight }),
    );
    observer.current.observe(node);
  }, []);

  // "Cover": the smallest scale at which the picture fills the frame in both
  // axes. It is the floor, so no zoom or pan can ever expose an empty corner —
  // which is what makes the clamp below sufficient rather than merely tidy.
  const coverScale =
    natural && frame.width > 0 && natural.width > 0 && natural.height > 0
      ? Math.max(frame.width / natural.width, frame.height / natural.height)
      : 0;
  const drawScale = coverScale * zoom;
  const imageWidth = natural ? natural.width * drawScale : 0;
  const imageHeight = natural ? natural.height * drawScale : 0;

  const clampOffset = useCallback(
    (candidate: { x: number; y: number }, width: number, height: number) => ({
      x: Math.min(Math.max(candidate.x, -(width - frame.width) / 2), (width - frame.width) / 2),
      y: Math.min(Math.max(candidate.y, -(height - frame.height) / 2), (height - frame.height) / 2),
    }),
    [frame.width, frame.height],
  );

  const clamped = clampOffset(offset, imageWidth, imageHeight);

  const setZoom = useCallback(
    (next: number) => {
      const bounded = Math.min(Math.max(next, 1), MAX_ZOOM);
      setRawZoom(bounded);
      // Re-clamp against the NEW size in the same tick. Zooming out with the
      // picture panned to one edge would otherwise leave the offset outside the
      // new bounds and show a bar of dialog background inside the frame.
      if (natural) {
        const width = natural.width * coverScale * bounded;
        const height = natural.height * coverScale * bounded;
        setOffset((current) => clampOffset(current, width, height));
      }
    },
    [natural, coverScale, clampOffset],
  );

  const distanceBetweenPointers = (): number => {
    const [first, second] = [...pointers.current.values()];
    if (!first || !second) return 0;
    return Math.hypot(first.x - second.x, first.y - second.y);
  };

  const onPointerDown = (pointerEvent: ReactPointerEvent<HTMLDivElement>) => {
    if (status !== "ready") return;
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    pointers.current.set(pointerEvent.pointerId, {
      x: pointerEvent.clientX,
      y: pointerEvent.clientY,
    });
    if (pointers.current.size === 2) {
      pinchStart.current = { distance: distanceBetweenPointers(), zoom };
    }
  };

  const onPointerMove = (pointerEvent: ReactPointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(pointerEvent.pointerId);
    if (!previous || status !== "ready") return;
    const next = { x: pointerEvent.clientX, y: pointerEvent.clientY };
    pointers.current.set(pointerEvent.pointerId, next);

    if (pointers.current.size >= 2) {
      const start = pinchStart.current;
      const distance = distanceBetweenPointers();
      if (start && start.distance > 0 && distance > 0) {
        setZoom(start.zoom * (distance / start.distance));
      }
      return;
    }

    // One pointer: pan by the raw delta, so the picture tracks the finger
    // exactly rather than at some invented sensitivity.
    setOffset((current) =>
      clampOffset(
        { x: current.x + (next.x - previous.x), y: current.y + (next.y - previous.y) },
        imageWidth,
        imageHeight,
      ),
    );
  };

  const onPointerUp = (pointerEvent: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(pointerEvent.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  };

  /**
   * The visible rectangle, as a file.
   *
   * Frame coordinates map back to source pixels through the single scale factor
   * the preview is drawn with, so what is encoded is exactly what was framed —
   * there is no second, differently-rounded idea of the crop anywhere.
   */
  const crop = async (): Promise<File | null> => {
    const image = imageElement.current;
    if (!image || !natural || !file || status !== "ready" || drawScale <= 0) return null;

    const left = frame.width / 2 + clamped.x - imageWidth / 2;
    const top = frame.height / 2 + clamped.y - imageHeight / 2;
    const sourceWidth = frame.width / drawScale;
    const sourceHeight = frame.height / drawScale;
    const sourceX = Math.min(Math.max(-left / drawScale, 0), natural.width - sourceWidth);
    const sourceY = Math.min(Math.max(-top / drawScale, 0), natural.height - sourceHeight);

    // Never upscale: a 300px thumbnail cropped to an avatar stays 300px rather
    // than being blown up to 1024 and stored four times as large for no pixels.
    const outputWidth = Math.max(1, Math.round(Math.min(shape.outputWidth, sourceWidth)));
    const outputHeight = Math.max(1, Math.round(outputWidth / shape.aspect));

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      outputWidth,
      outputHeight,
    );

    let blob = await toBlob(canvas, PREFERRED_TYPE, 0.92);
    if (!blob || blob.type !== PREFERRED_TYPE) blob = await toBlob(canvas, FALLBACK_TYPE);
    if (!blob) return null;
    return new File([blob], renameForType(file.name, blob.type), { type: blob.type });
  };

  return {
    status,
    imageUrl,
    frameRef,
    imageWidth,
    imageHeight,
    offsetX: clamped.x,
    offsetY: clamped.y,
    zoom,
    maxZoom: MAX_ZOOM,
    setZoom,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    crop,
  };
}
