/**
 * Shared helpers for formatting asset metadata (file size, dates, aspect
 * ratio). Extracted from the sidebar so the image viewer can render the exact
 * same values without duplicating (and diverging from) the formatting logic.
 */

export interface AspectRatioEntry {
    ratio: number
    text: string
    label?: string
}

export const aspectRatioEntries: AspectRatioEntry[] = [
    { ratio: 1, text: "1 : 1", label: "Square" },
    { ratio: 4 / 3, text: "4 : 3" },
    { ratio: 3 / 2, text: "3 : 2" },
    { ratio: 16 / 9, text: "16 : 9" },
    { ratio: 21 / 9, text: "21 : 9" },
    { ratio: 1.618, text: "1.618 : 1", label: "Golden Ratio" },
    { ratio: 1.414, text: "1.414 : 1", label: "Silver Ratio" },
    { ratio: 3 / 4, text: "3 : 4" },
    { ratio: 2 / 3, text: "2 : 3" },
    { ratio: 9 / 16, text: "9 : 16" },
    { ratio: 16 / 10, text: "16 : 10" },
    { ratio: 5 / 4, text: "5 : 4" },
]

export function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB"
    return bytes + " B"
}

export function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        })
    } catch {
        return iso
    }
}

export function getClosestAspectRatio(w: number, h: number): { text: string; label?: string; percent: number } | null {
    if (!w || !h) return null
    // Always use long side / short side, so ratio >= 1
    const raw = Math.max(w, h) / Math.min(w, h)
    let best = aspectRatioEntries[0]
    let minDiff = Math.abs(raw - best.ratio)
    for (let i = 1; i < aspectRatioEntries.length; i++) {
        const diff = Math.abs(raw - aspectRatioEntries[i].ratio)
        if (diff < minDiff) {
            minDiff = diff
            best = aspectRatioEntries[i]
        }
    }
    const percent = Math.min(100, Math.max(0, Math.round((1 - minDiff / best.ratio) * 100 * 10) / 10))
    return { text: best.text, label: best.label, percent }
}
