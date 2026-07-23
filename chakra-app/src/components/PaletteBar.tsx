import { useState } from "react"
import { Box, Flex } from "@chakra-ui/react"
import { Tooltip } from "./ui/tooltip"
import { copyToClipboard } from "../services/clipboard"
import type { ColorPalette } from "../types"

interface PaletteBarProps {
    palette: ColorPalette | null | undefined
}

export function PaletteBar({ palette }: PaletteBarProps) {
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

    if (!palette || !palette.colors || palette.colors.length === 0) return null

    const handleClick = async (hex: string, i: number) => {
        await copyToClipboard(hex)
        setCopiedIndex(i)
        setTimeout(() => setCopiedIndex(null), 1200)
    }

    return (
        <Flex width="full" height="6" borderRadius="md" overflow="hidden">
            {palette.colors.map((color, i) => (
                <Tooltip
                    key={i}
                    content={copiedIndex === i ? "Copied!" : color.hex}
                    open={copiedIndex === i ? true : undefined}
                    positioning={{ placement: "top", gutter: 4 }}
                    openDelay={0}
                    closeDelay={copiedIndex === i ? 1200 : 200}
                    lazyMount
                >
                    <Box
                        flex={color.proportion}
                        minWidth="6"
                        bg={color.hex}
                        cursor="pointer"
                        onClick={() => handleClick(color.hex, i)}
                        _hover={{ opacity: 0.85 }}
                        transition="opacity 0.15s"
                    />
                </Tooltip>
            ))}
        </Flex>
    )
}
