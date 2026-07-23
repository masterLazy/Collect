/**
 * Try to copy text to clipboard programmatically.
 *
 * `navigator.clipboard.writeText()` requires a secure context (HTTPS or localhost).
 * On mobile devices over HTTP, both `writeText` and `execCommand('copy')` fail.
 *
 * When all programmatic methods fail, this shows a visible, auto-selected
 * text input at the top of the viewport so the user can long-press to copy
 * via the native system menu. The input auto-dismisses after a few seconds
 * or on scroll/touch outside.
 */
export async function copyToClipboard(
    text: string,
    toaster?: { create: (opts: { title: string; type: "success" | "error" | "info" | "warning" }) => unknown },
): Promise<boolean> {
    // 1. Try modern clipboard API (works on HTTPS/localhost)
    try {
        await navigator.clipboard.writeText(text)
        toaster?.create({ title: "Copied!", type: "success" })
        return true
    } catch {
        // 2. Try legacy execCommand fallback
        try {
            const ta = document.createElement("textarea")
            ta.value = text
            ta.style.position = "fixed"
            ta.style.opacity = "0"
            ta.style.pointerEvents = "none"
            ta.style.left = "-9999px"
            document.body.appendChild(ta)
            ta.focus()
            ta.select()
            const result = document.execCommand("copy")
            document.body.removeChild(ta)
            if (result) {
                toaster?.create({ title: "Copied!", type: "success" })
                return true
            }
        } catch {
            // fall through to visual fallback
        }

        // 3. Visual fallback for mobile HTTP — show a visible, auto-selected input
        return showCopyFallback(text, toaster)
    }
}

function showCopyFallback(
    text: string,
    toaster?: { create: (opts: { title: string; type: "success" | "error" | "info" | "warning" }) => unknown },
): false {
    const overlay = document.createElement("div")
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
        padding: 16px; background: rgba(0,0,0,0.75);
        display: flex; flex-direction: column; gap: 8px;
        animation: fadeIn 0.2s ease;
    `

    const label = document.createElement("div")
    label.textContent = "Long press / tap and hold to copy"
    label.style.cssText = "color: #fff; font-size: 13px; text-align: center;"

    const input = document.createElement("textarea")
    input.readOnly = true
    input.value = text
    input.style.cssText = `
        width: 100%; padding: 12px; font-size: 14px;
        border: 1px solid rgba(255,255,255,0.3); border-radius: 6px;
        background: #fff; color: #000; resize: none;
        box-sizing: border-box; outline: none;
    `
    input.rows = Math.min(5, text.split("\n").length)

    const dismissBtn = document.createElement("button")
    dismissBtn.textContent = "✕"
    dismissBtn.style.cssText = `
        position: absolute; top: 8px; right: 12px;
        background: none; border: none; color: #fff;
        font-size: 18px; cursor: pointer; padding: 4px;
    `

    overlay.appendChild(label)
    overlay.appendChild(input)
    overlay.appendChild(dismissBtn)
    document.body.appendChild(overlay)

    // Auto-select the text so the system copy menu appears on long-press
    setTimeout(() => {
        input.focus()
        input.select()
    }, 100)

    toaster?.create({
        title: "Long press the text to copy",
        type: "info",
    })

    const cleanup = () => {
        if (overlay.parentNode) document.body.removeChild(overlay)
    }

    dismissBtn.onclick = cleanup
    overlay.onclick = (e) => { if (e.target === overlay) cleanup() }

    // Auto-dismiss after 8 seconds
    setTimeout(cleanup, 8000)

    return false
}
