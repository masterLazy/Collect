import { useState, useEffect, useRef } from "react"
import { Box, Button, Field, HStack, Input, Stack, Tag, Text } from "@chakra-ui/react"
import { api } from "../services/api"
import type { AssetTag } from "../types"

interface TagEditorProps {
    tags: AssetTag[]
    assetId: string
    onTagsChange: (tags: AssetTag[]) => void
}

function CheckIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}

function XIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
        </svg>
    )
}

export function TagEditor({ tags, assetId, onTagsChange }: TagEditorProps) {
    const [inputValue, setInputValue] = useState("")
    const [suggestions, setSuggestions] = useState<string[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [saving, setSaving] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (inputValue.length > 0) {
            api.getTags().then((res) => {
                const allTags = res.groups.flatMap((g) => g.tags.map((t) => t.value))
                const filtered = allTags.filter(
                    (t) => t.toLowerCase().includes(inputValue.toLowerCase()) && !tags.some((tag) => tag.value === t)
                )
                setSuggestions(filtered.slice(0, 10))
                setShowSuggestions(filtered.length > 0)
            }).catch(() => { })
        } else {
            setShowSuggestions(false)
        }
    }, [inputValue, tags])

    const handleAddTag = (value: string) => {
        const trimmed = value.trim()
        if (!trimmed || tags.some((t) => t.value === trimmed)) return
        const newTags = [...tags, { type: null, value: trimmed }]
        onTagsChange(newTags)
        setInputValue("")
        setShowSuggestions(false)
        inputRef.current?.focus()
    }

    const handleRemoveTag = (value: string) => {
        onTagsChange(tags.filter((t) => t.value !== value))
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            await api.updateTags(assetId, tags)
        } catch {
            // Toast handled by parent
        } finally {
            setSaving(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault()
            handleAddTag(inputValue)
        }
    }

    return (
        <Stack gap="3" position="relative">
            <Text fontWeight="semibold" fontSize="sm" color="fg">Tags</Text>

            <HStack gap="2" flexWrap="wrap">
                {tags.map((tag) => (
                    <Tag.Root
                        key={(tag.type ?? "") + ":" + tag.value}
                        size="sm"
                        colorPalette="accent"
                    >
                        {tag.type && (
                            <Tag.StartElement>
                                <Text fontSize="xs" color="fg.subtle">{tag.type}</Text>
                            </Tag.StartElement>
                        )}
                        <Tag.Label>{tag.value}</Tag.Label>
                        <Tag.EndElement>
                            <Box as="button" onClick={() => handleRemoveTag(tag.value)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                                <XIcon />
                            </Box>
                        </Tag.EndElement>
                    </Tag.Root>
                ))}
            </HStack>

            <Field.Root>
                <HStack gap="2">
                    <Input
                        ref={inputRef}
                        placeholder="Add tag..."
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        size="sm"
                        bg="bg"
                        border="1px solid"
                        borderColor="border"
                    />
                    <Button
                        size="sm"
                        colorPalette="accent"
                        loading={saving}
                        onClick={handleSave}
                        disabled={tags.length === 0}
                    >
                        <CheckIcon />
                        Save
                    </Button>
                </HStack>
            </Field.Root>

            {showSuggestions && (
                <Box
                    position="absolute"
                    zIndex="dropdown"
                    bg="bg"
                    border="1px solid"
                    borderColor="border"
                    borderRadius="md"
                    shadow="md"
                    mt="1"
                    maxH="200px"
                    overflowY="auto"
                    width="full"
                    top="100%"
                >
                    {suggestions.map((s) => (
                        <Box
                            key={s}
                            px="3"
                            py="2"
                            cursor="pointer"
                            _hover={{ bg: "bg.subtle" }}
                            onClick={() => handleAddTag(s)}
                            fontSize="sm"
                        >
                            {s}
                        </Box>
                    ))}
                </Box>
            )}
        </Stack>
    )
}
