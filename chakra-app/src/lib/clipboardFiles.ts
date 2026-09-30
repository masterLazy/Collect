/**
 * Helpers for the Add Assets flow: clipboard extraction, upload validation and
 * generated file names.
 *
 * The backend (`AssetService.AllowedUploadExtensions`) only accepts a fixed set
 * of raster image extensions, so the UI validates against the same set and
 * flags anything else *before* it is sent to the server.
 */

export const ALLOWED_UPLOAD_EXTENSIONS = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".tif",
    ".tiff",
] as const

export const ALLOWED_UPLOAD_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
] as const

/** Human readable format list, used in the drop zone hint. */
export const ALLOWED_UPLOAD_LABEL = "JPEG, PNG, WebP, GIF, BMP, TIFF"

/**
 * `<input type="file" accept="...">` value. Extensions are listed in addition to
 * MIME types because some browsers report an empty type for TIFF/BMP files.
 */
export const UPLOAD_ACCEPT_ATTRIBUTE = [
    ...ALLOWED_UPLOAD_EXTENSIONS,
    ...ALLOWED_UPLOAD_MIME_TYPES,
].join(",")

const MIME_TO_EXTENSION: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
}

/** Lower-cased file extension including the dot, e.g. "PHOTO.PNG" -> ".png". */
export function fileExtension(fileName: string): string {
    const dot = fileName.lastIndexOf(".")
    return dot === -1 ? "" : fileName.slice(dot).toLowerCase()
}

/** Best-effort extension for a clipboard blob, which only carries a MIME type. */
export function extensionForMimeType(mimeType: string): string {
    const base = (mimeType || "").toLowerCase().split(";")[0].trim()
    return MIME_TO_EXTENSION[base] ?? "png"
}

/**
 * A file is accepted when either its MIME type or its extension is allowed —
 * the backend decides by extension, and browsers sometimes report an empty or
 * generic MIME type for an otherwise valid image.
 */
export function isAllowedUpload(file: File): boolean {
    const type = (file.type || "").toLowerCase().split(";")[0].trim()
    if ((ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(type)) return true
    return (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(fileExtension(file.name))
}

/** Identity used to skip files that are already queued. */
export function fileKey(file: File): string {
    return `${file.name}|${file.size}|${file.lastModified}`
}

// Screenshots arrive named "image.png" (Chrome), "blob" or with no name at all
// (Firefox). An image *file* copied from the OS clipboard keeps its real name,
// which is worth preserving.
const GENERIC_CLIPBOARD_NAMES = /^(image|blob|untitled|clipboard)(\.\w+)?$/i

/** Timestamped name for a clipboard image, e.g. "pasted-20260930-143210.png". */
export function makePastedFileName(blob: Blob, now: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, "0")
    const stamp =
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    return `pasted-${stamp}.${extensionForMimeType(blob.type)}`
}

/** Give a clipboard blob a usable name, keeping a real one when it has one. */
export function normalizeClipboardFile(file: File): File {
    if (file.name && !GENERIC_CLIPBOARD_NAMES.test(file.name)) return file
    return new File([file], makePastedFileName(file), {
        type: file.type,
        lastModified: file.lastModified || Date.now(),
    })
}

/**
 * Image files carried by a paste/drop event. Non-image payloads (text, HTML,
 * file paths) are ignored so ordinary text pasting keeps working.
 */
export function imageFilesFromDataTransfer(data: DataTransfer | null): File[] {
    if (!data) return []

    const files: File[] = []

    if (data.items && data.items.length > 0) {
        for (let i = 0; i < data.items.length; i++) {
            const item = data.items[i]
            if (item.kind !== "file" || !item.type.startsWith("image/")) continue
            const file = item.getAsFile()
            if (file) files.push(file)
        }
    }

    if (files.length === 0 && data.files) {
        for (let i = 0; i < data.files.length; i++) {
            const file = data.files[i]
            if (file.type.startsWith("image/")) files.push(file)
        }
    }

    return files.map(normalizeClipboardFile)
}

interface ClipboardItemLike {
    types: readonly string[]
    getType: (type: string) => Promise<Blob>
}

/** True when the browser can read images from the clipboard without a paste event. */
export function canReadClipboardImages(): boolean {
    if (typeof navigator === "undefined") return false
    const clipboard = navigator.clipboard as { read?: unknown } | undefined
    return typeof clipboard?.read === "function"
}

/**
 * Read image files straight from the clipboard. Click-driven, unlike a paste
 * event, which makes it the only paste path on tablets/phones. Throws when the
 * browser does not support it or the user denies clipboard access.
 */
export async function readClipboardImageFiles(): Promise<File[]> {
    const clipboard = navigator.clipboard as unknown as {
        read?: () => Promise<ClipboardItemLike[]>
    }
    if (typeof clipboard?.read !== "function") {
        throw new Error("Clipboard image reading is not supported in this browser.")
    }

    const items = await clipboard.read()
    const files: File[] = []

    for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"))
        if (!imageType) continue
        try {
            const blob = await item.getType(imageType)
            files.push(new File([blob], makePastedFileName(blob), { type: imageType }))
        } catch {
            // Skip unreadable clipboard items rather than failing the whole paste.
        }
    }

    return files
}
