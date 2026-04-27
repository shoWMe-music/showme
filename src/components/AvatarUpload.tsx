import { useRef, useCallback } from "react";
import { Camera } from "lucide-react";

const TARGET_SIZE = 200; // px — exported images are 200x200

interface AvatarUploadProps {
  /** Current preview URL (object URL or remote URL) */
  preview: string | null;
  /** Fallback text shown when no preview (e.g. initials or "?") */
  fallback?: string;
  /** Called with the resized File and a local preview URL */
  onChange: (file: File, previewUrl: string) => void;
  /** Circle diameter in px (default 80 = h-20 w-20) */
  size?: number;
  className?: string;
}

function resizeImage(file: File, maxSize: number): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = maxSize;
      canvas.height = maxSize;
      const ctx = canvas.getContext("2d")!;

      // Center-crop: use the largest square from the source
      const srcSize = Math.min(img.width, img.height);
      const sx = (img.width - srcSize) / 2;
      const sy = (img.height - srcSize) / 2;
      ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, maxSize, maxSize);

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Canvas resize failed"));
          resolve(new File([blob], file.name.replace(/\.\w+$/, ".webp"), { type: "image/webp" }));
        },
        "image/webp",
        0.85,
      );
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

export function AvatarUpload({
  preview,
  fallback,
  onChange,
  size = 80,
  className = "",
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const resized = await resizeImage(file, TARGET_SIZE);
        const url = URL.createObjectURL(resized);
        onChange(resized, url);
      } catch {
        // Fallback: use original file without resize
        const url = URL.createObjectURL(file);
        onChange(file, url);
      }
      // Reset so the same file can be re-selected
      e.target.value = "";
    },
    [onChange],
  );

  const px = `${size}px`;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative group"
        style={{ width: px, height: px }}
      >
        {preview ? (
          <img
            src={preview}
            alt="Avatar"
            className="rounded-full object-cover border-2 border-border"
            style={{ width: px, height: px }}
          />
        ) : (
          <div
            className="rounded-full bg-muted flex items-center justify-center border-2 border-dashed border-border text-muted-foreground"
            style={{ width: px, height: px }}
          >
            {fallback ? (
              <span className="text-lg font-bold">{fallback}</span>
            ) : (
              <Camera className="h-6 w-6" />
            )}
          </div>
        )}
        <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <Camera className="h-5 w-5 text-white" />
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
