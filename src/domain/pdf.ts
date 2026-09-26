export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export function validatePdfMeta(f: {
  name: string;
  type: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  if (f.size === 0) return { ok: false, error: "檔案是空的" };

  const hasPdfExtension = f.name.toLowerCase().endsWith(".pdf");
  if (!hasPdfExtension || f.type !== "application/pdf") {
    return { ok: false, error: "只收 PDF" };
  }

  if (f.size > MAX_PDF_BYTES) return { ok: false, error: "檔案超過 20MB" };

  return { ok: true };
}

export function isPdfMagic(head: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  if (head.length < magic.length) return false;
  return magic.every((byte, i) => head[i] === byte);
}
