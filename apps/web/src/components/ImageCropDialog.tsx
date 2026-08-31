import { Button, Icon, Modal } from "@showme/design-system";
import { useState } from "react";
import { type CropShape, useImageCropper } from "./useImageCropper";

export interface ImageCropDialogProps {
  /** The file the owner just picked. Null closes the dialog. */
  file: File | null;
  /** Where the picture will be used — decides the frame's shape and its size. */
  shape: CropShape;
  /** What the frame is for, e.g. "Profile picture". Titles the dialog. */
  title: string;
  onCancel(): void;
  /** The cropped file. Falls back to the original when the browser could not
   * decode the picture at all — see `useImageCropper`'s `undecodable`. */
  onConfirm(file: File): void;
}

/**
 * The stage between picking a picture and uploading it.
 *
 * The frame is the shape the picture will actually be shown in — a circle for
 * an avatar, a wide strip for a banner — and what is inside it is what gets
 * encoded. That is the whole design brief: before this, the raw file went to
 * storage and every surface centre-cropped it with CSS, so the owner could see
 * their picture was wrong and had no way to say what they meant.
 *
 * Presentational by the review gate's rule. It holds one piece of state (is the
 * encode running) and nothing else; the cover fit, the pan clamp, the pinch and
 * the canvas encode are all in `useImageCropper`.
 */
export function ImageCropDialog({ file, shape, title, onCancel, onConfirm }: ImageCropDialogProps) {
  const cropper = useImageCropper(file, shape);
  const [isEncoding, setIsEncoding] = useState(false);
  const isCircle = shape.aspect === 1;

  const confirm = async () => {
    if (!file) return;
    setIsEncoding(true);
    try {
      const cropped = await cropper.crop();
      // A picture this browser could not decode is uploaded as it came. Refusing
      // it instead would take away an upload that worked before the crop stage
      // existed, which is a worse outcome than an uncropped avatar.
      onConfirm(cropped ?? file);
    } finally {
      setIsEncoding(false);
    }
  };

  return (
    <Modal
      open={Boolean(file)}
      onClose={onCancel}
      title={`Crop ${title.toLowerCase()}`}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            leftIcon={<Icon name="check" size={15} />}
            disabled={cropper.status === "loading" || isEncoding}
            onClick={confirm}
          >
            {isEncoding ? "Preparing…" : "Use this crop"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--dim)" }}>
          {cropper.status === "undecodable"
            ? "This browser can't open that picture to crop it — it will be uploaded as it is."
            : shape.guidance}
        </p>

        {cropper.status !== "undecodable" && (
          <>
            {/* `aspect-ratio` + `width: 100%` is the whole responsive story: the
                frame is as wide as the dialog body and as tall as its shape says,
                at every width from 360px up. No fixed pixel size to overflow. */}
            <div
              ref={cropper.frameRef}
              onPointerDown={cropper.onPointerDown}
              onPointerMove={cropper.onPointerMove}
              onPointerUp={cropper.onPointerUp}
              onPointerCancel={cropper.onPointerUp}
              style={{
                position: "relative",
                width: "100%",
                maxWidth: "100%",
                aspectRatio: String(shape.aspect),
                overflow: "hidden",
                borderRadius: isCircle ? "50%" : 12,
                border: "1px solid var(--border-strong)",
                background: "var(--elevated)",
                // The browser's own pan/zoom must not compete with ours, or a
                // drag inside the frame scrolls the dialog on a phone instead of
                // moving the picture.
                touchAction: "none",
                cursor: cropper.status === "ready" ? "grab" : "default",
                userSelect: "none",
              }}
            >
              {cropper.imageUrl && (
                <img
                  src={cropper.imageUrl}
                  alt=""
                  draggable={false}
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: cropper.imageWidth,
                    height: cropper.imageHeight,
                    maxWidth: "none",
                    transform: `translate(-50%, -50%) translate(${cropper.offsetX}px, ${cropper.offsetY}px)`,
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Icon name="search" size={15} />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                }}
              >
                Zoom
              </span>
              {/* A native range, deliberately: it is the one control a keyboard,
                  a screen reader and a thumb all already know, and the design
                  system has no slider to reach for. */}
              <input
                type="range"
                min={1}
                max={cropper.maxZoom}
                step={0.01}
                value={cropper.zoom}
                onChange={(changed) => cropper.setZoom(Number(changed.target.value))}
                aria-label="Zoom"
                style={{ flex: 1, minWidth: 0, accentColor: "var(--brand-red)" }}
              />
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
