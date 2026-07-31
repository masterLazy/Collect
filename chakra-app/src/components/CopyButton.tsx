import { useState, useCallback } from "react"
import { Box, Button, type ButtonProps } from "@chakra-ui/react"
import { Tooltip } from "./ui/tooltip"

interface CopyButtonProps {
    /** The text to copy to clipboard */
    text: string
    /** Optional additional CSS class */
    className?: string
    /** Button size variant. Default: "xs" */
    size?: ButtonProps["size"]
    /** Button color palette. Default: undefined (uses fg.subtle) */
    colorPalette?: ButtonProps["colorPalette"]
    /** Button variant. Default: "ghost" */
    variant?: ButtonProps["variant"]
    /** If true, calls stopPropagation() on click event. Useful inside popovers. */
    stopPropagation?: boolean
}

function CheckIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}

function CopyIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    )
}

export function CopyButton({
    text,
    className,
    size = "xs",
    colorPalette,
    variant = "ghost",
    stopPropagation,
}: CopyButtonProps) {
    const [copied, setCopied] = useState(false)

    const handleCopy = useCallback(
        (e: React.MouseEvent) => {
            if (stopPropagation) {
                e.stopPropagation()
            }
            const doCopy = async () => {
                try {
                    await navigator.clipboard.writeText(text)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                } catch {
                    // Fallback: try legacy execCommand
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
                        document.execCommand("copy")
                        document.body.removeChild(ta)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                    } catch {
                        // Silently fail — no alert feedback per design
                    }
                }
            }
            doCopy()
        },
        [text, stopPropagation],
    )

    return (
        <Tooltip
            content="Copied!"
            open={copied}
            disabled={!copied}
            closeDelay={100}
            positioning={{ placement: "top", gutter: 4 }}
        >
            <Button
                size={size}
                variant={variant}
                colorPalette={colorPalette}
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                cursor="pointer"
                color={copied ? "green.500" : (colorPalette ? undefined : "fg.subtle")}
                opacity={!colorPalette && !copied ? 0.5 : undefined}
                transition="opacity 0.15s"
                onClick={handleCopy}
                aria-label={copied ? "Copied" : "Copy to clipboard"}
                className={className}
                _focus={{ outline: "none" }}
                _focusVisible={{ outline: "2px solid", outlineColor: "colorPalette.focusRing" }}
                _hover={!colorPalette ? { opacity: 1, bg: "bg.subtle" } : undefined}
            >
                <Box
                    position="relative"
                    width="14px"
                    height="14px"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                >
                    {/* Copy icon — fades out and scales down when copied */}
                    <Box
                        position="absolute"
                        display="inline-flex"
                        transition="opacity 0.2s, transform 0.2s"
                        opacity={copied ? 0 : 1}
                        transform={copied ? "scale(0.5)" : "scale(1)"}
                    >
                        <CopyIcon />
                    </Box>
                    {/* Check icon — fades in and scales up when copied */}
                    <Box
                        position="absolute"
                        display="inline-flex"
                        transition="opacity 0.2s, transform 0.2s"
                        opacity={copied ? 1 : 0}
                        transform={copied ? "scale(1)" : "scale(0.5)"}
                    >
                        <CheckIcon />
                    </Box>
                </Box>
            </Button>
        </Tooltip>
    )
}
