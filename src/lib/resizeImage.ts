export function resizeImage(file: File, maxSize: number): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = maxSize;
      canvas.height = maxSize;
      const ctx = canvas.getContext("2d")!;

      // Center-crop: use the largest square from the source.
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
