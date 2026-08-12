import { useEffect, useState } from "react"
import { Routes, Route, useLocation, useNavigate, Navigate } from "react-router-dom"
import {
  Button,
  Center,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react"
import { Provider } from "./components/ui/provider"
import { LibraryManager } from "./components/LibraryManager"
import { LibraryPage } from "./components/LibraryPage"
import { ImageViewerPage } from "./components/ImageViewerPage"
import { useCustomToaster, ToastContainer, CustomToaster } from "./components/CustomToast"
import { api } from "./services/api"

/**
 * Home page — handles server connection check, then shows LibraryManager
 * or redirects to an already-active library.
 */
function HomePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const toaster = useCustomToaster()
  const [initializing, setInitializing] = useState(true)
  const [initError, setInitError] = useState(false)
  const [libraryReady, setLibraryReady] = useState(false)

  useEffect(() => {
    // If navigated here via Home/Back button (forceHome), show manager directly
    if (location.state?.forceHome) {
      setInitializing(false)
      setLibraryReady(false)
      // Clear the state so a refresh doesn't keep us on manager
      navigate("/", { replace: true, state: {} })
      return
    }

    let cancelled = false

    api.getLibraries()
      .then(() => {
        if (cancelled) return
        setLibraryReady(false)
      })
      .catch((err) => {
        if (!cancelled) {
          if (err?.message?.includes("404") || err?.toString?.()?.includes("404")) {
            setLibraryReady(false)
          } else {
            setInitError(true)
            setLibraryReady(false)
          }
        }
      })
      .finally(() => {
        if (!cancelled) setInitializing(false)
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (initializing) {
    return (
      <Center height="100vh" bg="bg">
        <VStack gap="4">
          <Spinner size="lg" colorPalette="accent" />
          <Text color="fg.muted" fontSize="sm">Connecting to Collect server...</Text>
        </VStack>
      </Center>
    )
  }

  if (initError) {
    return (
      <Center height="100vh" bg="bg">
        <VStack gap="4">
          <Text color="fg" fontWeight="bold" fontSize="lg">Cannot connect to server</Text>
          <Text color="fg.muted" fontSize="sm">Make sure the Collect backend service is running and accessible.</Text>
          <Button
            colorPalette="accent"
            onClick={() => {
              setInitError(false)
              setInitializing(true)
              api.getLibraries()
                .then(() => setLibraryReady(true))
                .catch(() => setInitError(true))
                .finally(() => setInitializing(false))
            }}
          >
            Retry
          </Button>
        </VStack>
      </Center>
    )
  }

  // If library is ready but we didn't redirect (edge case — no ID), show manager
  if (libraryReady) {
    return <Navigate to="/" replace />
  }

  return (
    <>
      <LibraryManager toaster={toaster as CustomToaster} onLibraryReady={(libraryId) => {
        if (libraryId) {
          // Push (not replace) so browser Back from the library returns to the manager
          navigate(`/${libraryId.slice(0, 8)}`)
        } else {
          navigate("/", { replace: true })
        }
      }} />
      <ToastContainer toasts={toaster.toasts} onDismiss={toaster.dismiss} />
    </>
  )
}

export function App() {
  return (
    <Provider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/:libraryId/view/:assetId" element={<ImageViewerPage />} />
        <Route path="/:libraryId/root/*" element={<LibraryPage />} />
        <Route path="/:libraryId" element={<LibraryPage />} />
      </Routes>
    </Provider>
  )
}
