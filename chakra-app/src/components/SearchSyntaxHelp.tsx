import { Box, Text } from "@chakra-ui/react"
import { SEARCH_FIELDS, SYNTAX_COLOR, type SearchFieldSpec } from "../lib/searchQuery"

interface SearchSyntaxHelpProps {
    /** Called with the field the user clicked, to insert it into the query. */
    onPick: (field: SearchFieldSpec) => void
}

const GROUPS: { title: string; kinds: SearchFieldSpec["kind"][] }[] = [
    { title: "Tags", kinds: ["tags"] },
    { title: "File type", kinds: ["enum"] },
    { title: "Numbers", kinds: ["number"] },
]

/**
 * Reference panel for the search box syntax. Every row is clickable and inserts
 * that filter into the query, so the cheat sheet doubles as a menu. Rows stay
 * one line tall: the syntax on the left, its explanation flush right.
 */
export function SearchSyntaxHelp({ onPick }: SearchSyntaxHelpProps) {
    return (
        <Box pb="1.5">
            <Box
                px="3"
                py="1.5"
                borderBottomWidth="1px"
                borderColor="border"
                display="flex"
                alignItems="baseline"
                gap="2"
            >
                <Text fontSize="sm" fontWeight="semibold" flexShrink="0">
                    Search syntax
                </Text>
                <Text fontSize="2xs" color="fg.subtle" flex="1" textAlign="right">
                    Click to insert
                </Text>
            </Box>

            {GROUPS.map((group) => (
                <Box key={group.title}>
                    <Text
                        px="3"
                        pt="1.5"
                        pb="0.5"
                        fontSize="2xs"
                        textTransform="uppercase"
                        letterSpacing="wider"
                        color="fg.subtle"
                    >
                        {group.title}
                    </Text>
                    {SEARCH_FIELDS.filter((field) => group.kinds.indexOf(field.kind) !== -1).map((field) => (
                        <Box
                            key={field.key}
                            px="3"
                            py="1"
                            cursor="pointer"
                            display="flex"
                            alignItems="baseline"
                            gap="2"
                            title={field.example}
                            _hover={{ bg: "bg.subtle" }}
                            onClick={() => onPick(field)}
                        >
                            <Box as="span" fontFamily="mono" fontSize="sm" color={SYNTAX_COLOR} flexShrink="0">
                                {field.key}
                                {field.kind === "number" ? ">=" : ":"}
                            </Box>
                            <Box as="span" fontSize="xs" color="fg.muted" flex="1" textAlign="right">
                                {field.description}
                            </Box>
                        </Box>
                    ))}
                </Box>
            ))}
        </Box>
    )
}

/** Text a field inserts when it is picked from a menu, e.g. `size>=`. */
export function fieldStarter(field: SearchFieldSpec): string {
    return field.kind === "number" ? `${field.key}>=` : `${field.key}:`
}
