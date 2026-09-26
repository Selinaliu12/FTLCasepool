export const LOCK_MS = 2 * 60 * 60 * 1000;

export function lockedAt(pdfUploadedAt: Date): Date {
  return new Date(pdfUploadedAt.getTime() + LOCK_MS);
}

export function isLocked(pdfUploadedAt: Date, now: Date): boolean {
  return now.getTime() - pdfUploadedAt.getTime() >= LOCK_MS;
}
