---
description: "Project overview for Collect — multimedia asset manager. Use when: understanding the full-stack architecture, navigating between backend/frontend layers, deciding which project or service to modify, finding relevant files for a feature, or onboarding to the codebase. Covers solution structure, API routes, DI registrations, component hierarchy, and filesystem layout."
applyTo: "**"
---

# Collect — Project Overview

> A tag-based multimedia asset manager with a Pinterest-style gallery, directory tree navigation, local ASP.NET Core backend with SkiaSharp thumbnail generation, and React + Chakra UI v3 frontend.

```
Repository root: d:\Projects\Collect
Solution:        d:\Projects\Collect\Collect\Collect.slnx
```

## Quick Start

```bash
# Backend (runs on http://localhost:5000, Swagger at /swagger)
cd d:\Projects\Collect\Collect
dotnet run --project Collect.Core

# Frontend (runs on http://localhost:3000)
cd d:\Projects\Collect\chakra-app
npm install
npm start
```

## Solution Structure (3 projects)

| Project | Path | Stack |
|---|---|---|
| `Collect.Core` | `Collect/Collect.Core/` | ASP.NET Core 10, Controller-based API, SkiaSharp, Swashbuckle |
| `Collect.Wpf` | `Collect/Collect.Wpf/` | .NET 10 WPF desktop app (skeleton — no UI implemented) |
| `chakra-app` | `chakra-app/` | React 18 + Chakra UI v3 + React Router 7 + next-themes |

---

## Backend — Collect.Core

### DI Registration (all Singleton)

| Interface | Implementation | Responsibility |
|---|---|---|
| `IAssetService` | `AssetService` | CRUD, filesystem scan, tag parsing, search, thumbnail paths, clipboard image, move, rename, categorize, conflict resolution |
| `ILibraryService` | `LibraryService` | Library init/metadata, directory tree CRUD, recent libraries, persists `.collect/library.json` |
| `ITagService` | `TagService` | Aggregates tags from all assets; returns paginated grouped responses |
| `IThumbnailService` | `ThumbnailService` | WebP thumbnail generation (400px max width, quality 85), content-hash deduplication via MD5(path + size + last-write-time), orphaned thumbnail cleanup |

**Key**: All services are **Singleton**. `AssetService` holds an in-memory `List<Asset>` — no database. Concurrency is managed via `SemaphoreSlim(1,1)`.

### Controllers & Route Prefixes

| Controller | File | Route Prefix | Key Endpoints |
|---|---|---|---|
| `AssetsController` | `Controllers/AssetsController.cs` | `api/assets` | `GET /` (list), `GET /{id}`, `GET /{id}/thumbnail`, `GET /{id}/image`, `GET /search`, `POST /scan`, `POST /upload`, `PUT /{id}/tags`, `POST /{id}/move` |
| `LibraryController` | `Controllers/LibraryController.cs` | `api/library` + `api/libraries` | `GET /info`, `GET /tree`, `POST /init`, `POST /create-directory`, `POST /rename-directory`, `POST /delete-directory`, `POST /load/{id}`, `GET /` (list libraries), `DELETE /{id}` |
| `FsController` | `Controllers/FsController.cs` | `api/fs` | `GET /drives`, `GET /browse?path=...` |
| `TagsController` | `Controllers/TagsController.cs` | `api/tags` | `GET /` (paginated, grouped by type) |

### Models (all in `Models/`)

| Model | Key Properties |
|---|---|
| `Asset` | `Id`, `FileName`, `RelativePath`, `FileSize`, `Width`, `Height`, `MimeType`, `Tags` (list of `AssetTag`), `ImportedAt`, `LastModified` |
| `AssetTag` | `Type` (nullable string, e.g. "画师"), `Value` (e.g. "yaungpeng") |
| `LibraryInfo` | `Id`, `Version`, `Name`, `Path`, `CreatedAt`, `AssetCount` |
| `DirectoryNode` | `Name`, `Path`, `AssetCount`, `Children` (recursive tree) |

### DTOs (all in `Dtos/`)

| DTO | Used For |
|---|---|
| `AssetDto` | List view: `Id`, `FileName`, `MimeType`, `FileSize`, `Width`, `Height`, `ThumbnailUrl`, `ImportedAt` |
| `AssetDetailDto` | Detail view: all of `AssetDto` + `RelativePath`, `Tags`, `ImageUrl`, `LastModified` |
| `PaginatedResponse<T>` | `Items`, `Total`, `Page`, `PageSize` |
| `TagGroupDto` + `TagCountDto` | Tag browser grouped by type |
| `TagGroupsResponse` | `Groups` (list of `TagGroupDto`), `TotalGroups` |

### Filesystem Layout (per library)

```
Library Root/
├── image1.jpg                      ← filename encodes tags: [画师]name-人物-style
├── subfolder/
│   └── image2.png
└── .collect/
    ├── library.json                ← LibraryInfo metadata (persisted by LibraryService)
    └── thumbnails/
        └── <md5hash>.webp          ← SkiaSharp thumbnails (400px max width)
```

### Tag Naming Convention

Tags are encoded in filenames using `-` as separator:
`[Type]Value-untagged-segment-[Type2]Value2.jpg`

- `[画师]yaungpeng` → type="画师", value="yaungpeng"
- `人物` → type=null, value="人物"
- Pure numeric segments are skipped

### Key Architectural Rules

- **No database** — asset state is derived from the filesystem on each scan. Call `POST /api/assets/scan` to refresh.
- **Tag changes rename files** — `UpdateTagsAsync` rebuilds the filename from tags and calls `File.Move`.
- **Thumbnails are content-hash keyed** — MD5 of `filePath + fileSize + lastWriteTimeTicks`. Identical content (same size + time) reuses the thumbnail. Renamed files get new thumbnails; orphan cleanup runs during scan.
- **Request DTOs** for `LibraryController` (`InitRequest`, `CreateDirectoryRequest`, `RenameDirectoryRequest`, `DeleteDirectoryRequest`) are defined inline in `LibraryController.cs`.

---

## Frontend — chakra-app

### Routing

| Route | Component | Description |
|---|---|---|
| `/` | `HomePage` (in `App.tsx`) | Health check, library manager, redirect to active library |
| `/:libraryId/*` | `LibraryPage` | Main browsing: grid + sidebar + top bar + folder tree |

### Component Hierarchy

```
<Provider>                    (src/components/ui/provider.tsx — ChakraProvider + ThemeProvider)
  <BrowserRouter>
    <App>
      <HomePage>              (inline in App.tsx)
      └── <LibraryManager>    (library create/open UI)
      <LibraryPage>           (main browsing page)
        ├── <TopBar>          (search bar, tag filter, add button, home, rescan, library name)
        │   ├── <SearchInput> (autocomplete search with tags: prefix)
        │   └── <TagFilterModal> (filter by tag groups, category management)
        ├── <DirectoryTree>   (folder navigation with context menus)
        ├── <MasonryGrid>     (waterfall grid with infinite scroll)
        │   └── <AssetCard>   (thumbnail card with loading/error states)
        └── <Sidebar>         (asset detail: preview, tags, metadata, actions)
            └── <TagEditor>   (inline tag add/remove/autocomplete)
<other components>
  ├── <AddAssetDialog>        (drag-drop upload with target dir picker)
  ├── <TagConflictDialog>     (resolve tag type conflicts)
  ├── <ServerPathPicker>      (server-side filesystem browser)
  └── <CustomToast>           (toast notification hook)
```

### API Endpoints Consumed by Frontend

All in `src/services/api.ts`. Base URL: `http://localhost:5000`.

| Category | Endpoints |
|---|---|
| **Library** | `GET /api/library/info`, `POST /api/library/init`, `GET /api/library/check`, `GET /api/library/tree`, `POST /api/library/create-directory`, `POST /api/library/rename-directory`, `POST /api/library/delete-directory`, `POST /api/library/load/{id}`, `GET /api/libraries`, `DELETE /api/libraries/{id}` |
| **Assets** | `POST /api/assets/scan`, `GET /api/assets`, `GET /api/assets/search`, `GET /api/assets/{id}`, `GET /api/assets/{id}/thumbnail`, `GET /api/assets/{id}/image`, `GET /api/assets/{id}/clipboard-image`, `PUT /api/assets/{id}/tags`, `POST /api/assets/{id}/move`, `DELETE /api/assets/{id}`, `POST /api/assets/upload` |
| **Tags** | `GET /api/assets/tag-conflicts`, `POST /api/assets/resolve-tag-conflicts`, `POST /api/assets/categorize`, `POST /api/assets/rename-category`, `POST /api/assets/delete-category`, `POST /api/assets/rename-tag`, `POST /api/assets/delete-tag`, `GET /api/tags` |
| **Filesystem** | `GET /api/fs/drives`, `GET /api/fs/browse?path=...` |

### TypeScript Types

All in `src/types.ts` — mirrors backend DTOs exactly.

### Key Frontend Patterns

- **Chakra UI v3** — uses `@chakra-ui/react` v3 with `next-themes` for theme. Import from `@chakra-ui/react`. See `.github/instructions/chakra-ui.instructions.md`.
- **Custom toast system** — `CustomToast` hook avoids Chakra v3 `toaster.create()` API issues.
- **Masonry layout** — custom `MasonryGrid` with `IntersectionObserver` for infinite scroll.
- **Tag filter** — uses `tags:keyword1+keyword2` query prefix in `SearchInput`.

---

## WPF Desktop — Collect.Wpf

Skeleton project only. `MainWindow.xaml` has an empty `Grid` (800×450). No UI or functionality implemented.

---

## Common Task Locations

| Task | Backend File(s) | Frontend File(s) |
|---|---|---|
| Asset scanning / file detection | `Services/AssetService.cs` (ScanAsync) | — |
| Thumbnail generation / cleanup | `Services/ThumbnailService.cs` | — |
| Tag editing / file rename | `Services/AssetService.cs` (UpdateTagsAsync) | `components/TagEditor.tsx` |
| Search / filtering | `Services/AssetService.cs` (SearchAsync) | `components/SearchInput.tsx` |
| Folder navigation | `Services/LibraryService.cs` | `components/DirectoryTree.tsx` |
| Library CRUD | `Controllers/LibraryController.cs` | `components/LibraryManager.tsx` |
| Upload | `Services/AssetService.cs` (UploadAssetsAsync) | `components/AddAssetDialog.tsx` |
| Tag browser | `Services/TagService.cs` | `components/TagFilterModal.tsx` |
| Sidebar / asset detail | — | `components/Sidebar.tsx` |
| Gallery grid | — | `components/MasonryGrid.tsx` |
| API client | — | `services/api.ts` |
| Library metadata persistence | `Services/LibraryService.cs` | — |
| Error handling | `Middleware/ErrorHandlingMiddleware.cs` | — |
