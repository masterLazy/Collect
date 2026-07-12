import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { Alert, Box, Portal } from "@chakra-ui/react"

export interface ToastOptions {
    title: string
    description?: string
    type: "success" | "error" | "info" | "warning"
    duration?: number
}

interface ToastEntry extends ToastOptions {
    id: number
    removing: boolean
}

let nextId = 0

/**
 * A reliable toast hook that does NOT depend on Chakra's internal toaster.
 * Returns an object with a `create` method matching the Chakra toaster API.
 */
export function useCustomToaster() {
    const [toasts, setToasts] = useState<ToastEntry[]>([])
    const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
    const mounted = useRef(true)

    useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false }
    }, [])

    const removeToast = useCallback((id: number) => {
        // Start exit animation
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, removing: true } : t)))
        // Actually remove after animation
        setTimeout(() => {
            if (mounted.current) {
                setToasts((prev) => prev.filter((t) => t.id !== id))
            }
        }, 300)
    }, [])

    const create = useCallback((opts: ToastOptions) => {
        const id = ++nextId
        setToasts((prev) => [...prev, { ...opts, id, removing: false }])
        const duration = opts.duration ?? 4000
        const timer = setTimeout(() => removeToast(id), duration)
        timers.current.set(id, timer)
        return id
    }, [removeToast])

    const dismiss = useCallback((id: number) => {
        const timer = timers.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timers.current.delete(id)
        }
        removeToast(id)
    }, [removeToast])

    return useMemo(() => ({ create, dismiss, toasts }), [create, dismiss, toasts])
}

export interface CustomToaster {
    create: (opts: ToastOptions) => number
    dismiss: (id: number) => void
}

export function ToastContainer({ toasts, onDismiss }: {
    toasts: ToastEntry[]
    onDismiss: (id: number) => void
}) {
    if (toasts.length === 0) return null

    return (
        <Portal>
            <Box
                position="fixed"
                top="16px"
                right="16px"
                zIndex={9999}
                display="flex"
                flexDirection="column"
                gap="2"
                pointerEvents="none"
            >
                {toasts.map((t) => (
                    <Alert.Root
                        key={t.id}
                        status={t.type}
                        pointerEvents="auto"
                        cursor="pointer"
                        onClick={() => onDismiss(t.id)}
                        shadow="lg"
                        minW="280px"
                        maxW="400px"
                        alignItems="start"
                        opacity={t.removing ? 0 : 1}
                        transform={t.removing ? "translateX(20px)" : "translateX(0)"}
                        transition="opacity 0.25s, transform 0.25s"
                    >
                        <Alert.Indicator />
                        <Box>
                            <Alert.Title>{t.title}</Alert.Title>
                            {t.description && (
                                <Alert.Description>{t.description}</Alert.Description>
                            )}
                        </Box>
                    </Alert.Root>
                ))}
            </Box>
        </Portal>
    )
}
