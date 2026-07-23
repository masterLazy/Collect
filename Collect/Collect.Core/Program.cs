using Collect.Core.Middleware;
using Collect.Core.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Services ──────────────────────────────────────────
builder.Services.AddControllers();

builder.Services.AddSingleton<IEncryptionService, EncryptionService>();
builder.Services.AddSingleton<ILibraryService, LibraryService>();
builder.Services.AddSingleton<IAssetService, AssetService>();
builder.Services.AddSingleton<ITagService, TagService>();
builder.Services.AddSingleton<IThumbnailService, ThumbnailService>();
builder.Services.AddHttpContextAccessor();

// ── CORS ──────────────────────────────────────────────
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// ── Swagger (dev only) ────────────────────────────────
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// ── Middleware Pipeline ───────────────────────────────
app.UseMiddleware<ErrorHandlingMiddleware>();
app.UseMiddleware<LibraryContextMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();

app.MapControllers();

// ── Port Resolution ──────────────────────────────────
// Try the requested port, then up to 4 sequential ports (5000-5004 by default).
// If all are busy, fall back to an OS-assigned port.

var requestedPort = args.Length > 0 ? args[0] : "5000";
int.TryParse(requestedPort, out var portNum);
if (portNum <= 0 || portNum > 65535)
    portNum = 5000;

bool portFree = false;
for (int i = 0; i < 5; i++)
{
    int candidate = portNum + i;
    try
    {
        using var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, candidate);
        listener.Start();
        listener.Stop();
        portNum = candidate;
        portFree = true;
        break;
    }
    catch
    {
        Console.WriteLine($"[Collect] Port {candidate} is in use, trying next...");
    }
}

if (!portFree)
{
    Console.WriteLine($"[Collect] Ports {portNum}-{portNum + 4} are all in use, using a random available port.");
    portNum = 0;
}

Console.WriteLine($"[Collect] Starting on port {portNum}");

// ── Startup ───────────────────────────────────────────
app.Urls.Clear();
app.Urls.Add($"http://0.0.0.0:{portNum}");
app.Run();
