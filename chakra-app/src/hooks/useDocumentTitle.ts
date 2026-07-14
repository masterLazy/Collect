import { useLayoutEffect } from "react"

/**
 * Sets `document.title` synchronously before the browser paints,
 * preventing the flash of the default HTML title on page refresh.
 *
 * @param title — The full document title string (e.g. "My Library · Collect")
 */
export function useDocumentTitle(title: string): void {
    useLayoutEffect(() => {
        document.title = title
    }, [title])
}
