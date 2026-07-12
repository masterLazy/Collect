import { Button, HStack, Text } from "@chakra-ui/react"
import { SearchInput } from "./SearchInput"
import { TagFilterModal } from "./TagFilterModal"

interface TopBarProps {
    searchQuery: string
    onSearchChange: (query: string) => void
    selectedTags: string[]
    onTagsChange: (tags: string[]) => void
    onOpenAddDialog: () => void
}

function PlusIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

export function TopBar({
    searchQuery,
    onSearchChange,
    selectedTags,
    onTagsChange,
    onOpenAddDialog,
}: TopBarProps) {
    return (
        <HStack
            width="full"
            px="4"
            py="3"
            bg="bg"
            borderBottom="1px solid"
            borderColor="border"
            gap="4"
            flexWrap="wrap"
        >
            <Text
                fontSize="xl"
                fontWeight="bold"
                color="fg"
                whiteSpace="nowrap"
                hideBelow="sm"
            >
                Collect
            </Text>

            <SearchInput value={searchQuery} onChange={onSearchChange} />

            <HStack gap="2" marginLeft="auto">
                <Button
                    variant="outline"
                    size="sm"
                    colorPalette="accent"
                    onClick={onOpenAddDialog}
                >
                    <PlusIcon />
                    Add
                </Button>

                <TagFilterModal
                    selectedTags={selectedTags}
                    onTagsChange={onTagsChange}
                />
            </HStack>
        </HStack>
    )
}
