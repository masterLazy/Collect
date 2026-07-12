import { Input, Stack } from "@chakra-ui/react"
import { useEffect, useRef, useState } from "react"

interface SearchInputProps {
    value: string
    onChange: (value: string) => void
}

function SearchIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
        </svg>
    )
}

export function SearchInput({ value, onChange }: SearchInputProps) {
    const [localValue, setLocalValue] = useState(value)
    const timerRef = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => {
        setLocalValue(value)
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value
        setLocalValue(newValue)

        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
            onChange(newValue)
        }, 300)
    }

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [])

    return (
        <Stack gap="0" width="full" maxW="400px" position="relative">
            <Stack
                position="absolute"
                left="3"
                top="50%"
                transform="translateY(-50%)"
                zIndex="1"
                color="fg.subtle"
                pointerEvents="none"
            >
                <SearchIcon />
            </Stack>
            <Input
                placeholder="Search files or tags:tag1+tag2"
                value={localValue}
                onChange={handleChange}
                bg="bg"
                border="1px solid"
                borderColor="border"
                _placeholder={{ color: "fg.subtle" }}
                paddingLeft="10"
            />
        </Stack>
    )
}
