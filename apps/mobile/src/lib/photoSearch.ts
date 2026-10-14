/**
 * Hands a photo from the camera screen to the search screen without putting
 * megabytes of base64 in a route param. Held in memory only, taken once.
 */
export type PhotoQuery = { uri: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string; hint?: string };

let pending: PhotoQuery | null = null;
export const setPendingPhoto = (p: PhotoQuery) => { pending = p; };
export const takePendingPhoto = (): PhotoQuery | null => { const p = pending; pending = null; return p; };

export const mediaTypeOf = (mime?: string | null): PhotoQuery['mediaType'] => (mime === 'image/png' ? 'image/png' : mime === 'image/webp' ? 'image/webp' : 'image/jpeg');
/** Photos above this would exceed the server's 5 MB image limit. */
export const MAX_PHOTO_BASE64 = 6_800_000;
