import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Box, Button, Center, Dialog, Portal, Spinner, Stack, Text, VStack } from "@chakra-ui/react"
import { TagEditor } from "./TagEditor"
import { api } from "../services/api"
import type { AssetTag } from "../types"
import type { CustomToaster } from "./CustomToast"

/** Tags are identified by (type, value) — the same rule the backend uses. */
const sameTag = (a: AssetTag, b: AssetTag) => a.value === b.value && (a.type ?? null) === (b.type ?? null)

interface BatchTagDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Assets the tag change applies to. */
    ids: string[]
    libraryId: string
    toaster?: CustomToaster
    /** Called after a change was written, so the caller can refresh the grid. */
    onApplied: () => void
}

/**
 * Batch tag editing: shows the tags shared by *every* selected asset (the
 * intersection) and lets the user remove or add tags across the whole batch.
 * The editor itself is the same `TagEditor` used by the sidebar — only the save
 * path differs: the diff against the shared list is applied to each asset.
 */
export function BatchTagDialog({ open, onOpenChange, ids, libraryId, toaster, onApplied }: BatchTagDialogProps) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Baseline (shared tags when the dialog opened) and the editable copy.
    const [origin, setOrigin] = useState<AssetTag[]>([])
    const [common, setCommon] = useState<AssetTag[]>([])
    const tagsByIdRef = useRef<Map<string, AssetTag[]>>(new Map())

    // The caller re-creates the `ids` array on every render, so its identity is
    // not a safe effect dependency — the sorted key is. The list itself is
    // derived from that key to stay stable too.
    const idsKey = useMemo(() => [...ids].sort().join("|"), [ids])
    const idList = useMemo(() => (idsKey ? idsKey.split("|") : []), [idsKey])

    useEffect(() => {
        if (!open) return
        let cancelled = false
        setLoading(true)
        setError(null)

        // A dedicated batch endpoint: one request, no palette/thumbnail work.
        api.getAssetsTags(idList, libraryId)
            .then((byId) => {
                if (cancelled) return
                const missing = idList.filter((id) => !byId[id])
                if (missing.length > 0) {
                    setError(`Could not read tags for ${missing.length} of ${idList.length} assets.`)
                    setLoading(false)
                    return
                }

                const allTags = idList.map((id) => byId[id] ?? [])
                tagsByIdRef.current = new Map(idList.map((id, i) => [id, allTags[i]]))

                // Intersection: keep a tag only when every asset carries it.
                const first = allTags[0] ?? []
                const shared = first.filter((tag) => allTags.every((tags) => tags.some((t) => sameTag(t, tag))))
                setOrigin(shared)
                setCommon(shared)
                setLoading(false)
            })
            .catch(() => {
                if (cancelled) return
                setError("Could not read the tags of the selected assets.")
                setLoading(false)
            })

        return () => { cancelled = true }
    }, [open, idsKey, idList, libraryId])

    const applyTags = useCallback(async (next: AssetTag[]) => {
        setError(null)

        // Only the difference to the shared baseline is propagated: tags removed
        // from the shared list are dropped from every asset, tags added are
        // appended to every asset.
        const removed = origin.filter((t) => !next.some((n) => sameTag(n, t)))
        const added = next.filter((n) => !origin.some((o) => sameTag(o, n)))

        const applyTo = (tags: AssetTag[]): AssetTag[] => {
            const merged = tags.filter((t) => !removed.some((r) => sameTag(r, t)))
            for (const tag of added) {
                if (!merged.some((t) => sameTag(t, tag))) merged.push(tag)
            }
            return merged
        }

        const updatedEntries = new Map<string, AssetTag[]>()
        let applied = 0
        let failed = 0

        for (const id of idList) {
            const current = tagsByIdRef.current.get(id)
            if (!current) continue
            const nextTags = applyTo(current)

            // Skip assets the edit does not actually change (no file rename).
            const unchanged = current.length === nextTags.length && nextTags.every((t) => current.some((c) => sameTag(c, t)))
            if (unchanged) {
                updatedEntries.set(id, current)
                continue
            }

            try {
                await api.updateTags(id, nextTags, libraryId)
                updatedEntries.set(id, nextTags)
                applied++
            } catch {
                failed++
            }
        }

        // Keep the cache in sync so a second edit in the same session is correct.
        const cache = new Map(tagsByIdRef.current)
        updatedEntries.forEach((tags, id) => cache.set(id, tags))
        tagsByIdRef.current = cache
        setOrigin(next)
        setCommon(next)

        if (applied > 0) onApplied()

        if (failed > 0) {
            toaster?.create({
                title: "Some assets were not updated",
                description: `${applied} of ${applied + failed} assets were updated. Try again for the rest.`,
                type: "error",
            })
        } else if (applied > 0) {
            toaster?.create({
                title: "Tags updated",
                description: `Applied to ${applied} asset${applied === 1 ? "" : "s"}.`,
                type: "success",
            })
        } else {
            toaster?.create({
                title: "No changes",
                description: "Every selected asset already carried these tags.",
                type: "info",
            })
        }
    }, [origin, idList, libraryId, onApplied, toaster])

    const count = idList.length

    return (
        <Dialog.Root open={open} onOpenChange={(e: { open: boolean }) => onOpenChange(e.open)}>
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Common tags</Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            {loading ? (
                                <Center py="8">
                                    <VStack gap="3">
                                        <Spinner />
                                        <Text fontSize="sm" color="fg.muted">Reading tags…</Text>
                                    </VStack>
                                </Center>
                            ) : error ? (
                                <Text fontSize="sm" color="fg.error">{error}</Text>
                            ) : (
                                <Stack gap="3">
                                    <Text fontSize="sm" color="fg.muted">
                                        {count === 1
                                            ? "Tags of the selected asset."
                                            : `Tags shared by all ${count} selected assets. Editing them updates every asset.`}
                                    </Text>
                                    {common.length === 0 && (
                                        <Box
                                            border="1px dashed"
                                            borderColor="border"
                                            borderRadius="md"
                                            px="3"
                                            py="2"
                                        >
                                            <Text fontSize="sm" color="fg.subtle">
                                                {count === 1
                                                    ? "This asset has no tags yet."
                                                    : "No tag is shared by every selected asset. Add one below to apply it to all of them."}
                                            </Text>
                                        </Box>
                                    )}
                                    <TagEditor
                                        key={idsKey}
                                        tags={common}
                                        onTagsChange={setCommon}
                                        onSaveOverride={applyTags}
                                        libraryId={libraryId}
                                        toaster={toaster}
                                    />
                                </Stack>
                            )}
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Close
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
