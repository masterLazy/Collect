# Collect — Multimedia Asset Manager

A tag-based multimedia asset manager with waterfall (Pinterest-style) gallery, directory tree navigation, and a local ASP.NET Core backend with SkiaSharp thumbnail generation.

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Node.js 18+](https://nodejs.org/)

### Backend (API server)

```bash
cd Collect
dotnet run --project Collect.Core
```

The API server starts at `http://localhost:5000`. Swagger UI is available at `http://localhost:5000/swagger` in development mode.

### Frontend (Web UI)

```bash
cd chakra-app
npm install
npm start
```

The web app opens at `http://localhost:3000`. It connects to the backend at `http://localhost:5000`.

### Development workflow

1. Start the backend first (`dotnet run`)
2. Start the frontend (`npm start`)
3. Open `http://localhost:3000`, create a library pointing to a folder of images
4. The backend scans the folder, generates WebP thumbnails, and serves them to the frontend

## Project structure

```
├── Collect/              # ASP.NET Core backend
│   └── Collect.Core/     # API controllers, services, models
├── chakra-app/           # React + Chakra UI v3 frontend
└── README.md
```
