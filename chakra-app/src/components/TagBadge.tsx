import { Tag, Text } from "@chakra-ui/react"
import { Tooltip } from "./ui/tooltip"

// Deterministic HSL hue from any string via hash (like masonry.html)
export function getTypeHue(type: string): number {
    let hash = 0
    for (let i = 0; i < type.length; i++) {
        hash = ((hash << 5) - hash) + type.charCodeAt(i)
        hash |= 0
    }
    return Math.abs(hash) % 360
}

export interface TagBadgeProps {
    value: string
    type?: string | null
    count?: number
    variant?: "solid" | "subtle"
    isSelected?: boolean
    showCount?: boolean
    onClick?: () => void
    size?: "sm" | "md" | "lg"
}

export function TagBadge({
    value,
    type,
    count,
    variant = "subtle",
    isSelected = false,
    showCount = false,
    onClick,
    size = "lg",
}: TagBadgeProps) {
    const hue = type ? getTypeHue(type) : null
    const resolvedVariant = isSelected ? "solid" : variant

    const tagEl = (
        <Tag.Root
            size={size}
            colorPalette={hue === null ? "accent" : undefined}
            variant={resolvedVariant}
            borderRadius="full"
            display="inline-flex"
            alignItems="center"
            px="2.5"
            py="1"
            cursor={onClick ? "pointer" : undefined}
            onClick={onClick}
            opacity={type ? 0.85 : 1}
            transition="none"
            css={hue !== null ? {
                background: isSelected
                    ? {
                        base: `hsl(${hue},60%,40%)`,
                        _dark: `hsl(${hue},40%,50%)`
                    }
                    : {
                        base: `hsl(${hue},75%,92%)`,
                        _dark: `hsl(${hue},30%,25%)`
                    },
                color: isSelected ? "white" : {
                    base: "black",
                    _dark: `hsl(${hue},70%,80%)`
                },
                border: "1px solid",
                borderColor: isSelected
                    ? {
                        base: `hsl(${hue},70%,88%)`,
                        _dark: `hsl(${hue},30%,25%)`
                    }
                    : "transparent",
            } : undefined}
        >
            <Tag.Label fontSize={size === "sm" ? "xs" : "sm"}>{value}</Tag.Label>
            {showCount && count !== undefined && (
                <Text
                    as="span"
                    fontSize="xs"
                    color={isSelected ?
                        hue !== null ? "white" : {
                            base: "white",
                            _dark: "black"
                        } : "fg.muted"}
                    ml="1"
                >
                    ({count})
                </Text>
            )
            }
        </Tag.Root >
    )

    if (type) {
        return (
            <Tooltip content={type} positioning={{ placement: "top", gutter: 4 }} closeOnPointerDown={false} lazyMount>
                {tagEl}
            </Tooltip>
        )
    }

    return tagEl
}
