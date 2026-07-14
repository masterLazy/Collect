using Collect.Core.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Collect.Core;

/// <summary>
/// Bridge that starts the ASP.NET Core backend and serves the frontend SPA on the same port.
/// Provides log access for the WPF host.
/// </summary>
public class CollectHost
{
    private WebApplication? _app;
    private readonly LogCollector _logCollector = new();

    /// <summary>
    /// Gets the log collector for reading backend/frontend logs.
    /// </summary>
    public ILogCollector Logs => _logCollector;

    /// <summary>
    /// Gets whether the host is currently running.
    /// </summary>
    public bool IsRunning => Status == HostStatus.Running;

    /// <summary>
    /// Gets the current host status.
    /// </summary>
    public HostStatus Status { get; private set; } = HostStatus.Stopped;

    /// <summary>
    /// Raised when the host status changes.
    /// </summary>
    public event EventHandler<HostStatus>? StatusChanged;

    /// <summary>
    /// Gets the port the host is listening on.
    /// </summary>
    public int Port { get; private set; }

    /// <summary>
    /// Gets the last error message, if any.
    /// </summary>
    public string? LastError { get; private set; }

    private void SetStatus(HostStatus status)
    {
        Status = status;
        StatusChanged?.Invoke(this, status);
    }


    /// <summary>
    /// Start the combined backend+frontend host.
    /// </summary>
    /// <param name="port">Preferred TCP port. If busy, a random available port is used instead.</param>
    /// <param name="webRootPath">Path to the frontend build directory (e.g., "../chakra-app/build").</param>
    /// <param name="cancellationToken">Cancellation token for startup.</param>
    public async Task StartAsync(int port, string webRootPath, CancellationToken cancellationToken = default)
    {
        LastError = null;
        SetStatus(HostStatus.Starting);

        try
        {
            // Resolve port: prefer the requested port, fall back to OS-assigned if busy
            var resolved = ResolvePort(port);

            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                Args = new[] { $"--urls=http://0.0.0.0:{resolved}" },
                WebRootPath = webRootPath
            });

        // ── Services ──────────────────────────────────────────
        // IMPORTANT: AddApplicationPart is required because the entry assembly is
        // Collect.Wpf (WinExe), not Collect.Core. Without this, AddControllers()
        // only scans the entry assembly and won't discover controllers in Collect.Core.
        builder.Services.AddControllers()
            .AddApplicationPart(typeof(CollectHost).Assembly);

        // Register existing services
        builder.Services.AddSingleton<IEncryptionService, EncryptionService>();
        builder.Services.AddSingleton<ILibraryService, LibraryService>();
        builder.Services.AddSingleton<IAssetService, AssetService>();
        builder.Services.AddSingleton<ITagService, TagService>();
        builder.Services.AddSingleton<IThumbnailService, ThumbnailService>();

        // Register the log collector as both ILoggerProvider and ILogCollector
        builder.Services.AddSingleton<LogCollector>(_logCollector);
        builder.Services.AddSingleton<ILogCollector>(_logCollector);
        builder.Logging.ClearProviders();
        builder.Logging.AddProvider(_logCollector);
        // Also add console logging so you can see logs in terminal
        builder.Logging.AddConsole();

        // Add CORS (keep for flexibility, though same-origin now)
        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy =>
            {
                policy.AllowAnyOrigin()
                      .AllowAnyHeader()
                      .AllowAnyMethod();
            });
        });

        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen();

        var app = builder.Build();

        // ── Middleware ─────────────────────────────────────────
        app.UseMiddleware<Middleware.ErrorHandlingMiddleware>();

        // CORS (must be before static files and controllers)
        app.UseCors();

        // Swagger (dev only)
        if (app.Environment.IsDevelopment())
        {
            app.UseSwagger();
            app.UseSwaggerUI();
        }

        // ── Static files & SPA fallback ───────────────────────
        // Serve static files from the frontend build directory
        app.UseDefaultFiles();
        app.UseStaticFiles();

        // API routes first, so /api/* requests match controllers before falling back to SPA
        app.MapControllers();

        // SPA fallback: any non-API, non-file request serves index.html
        app.MapFallbackToFile("index.html");

        _app = app;
        await app.StartAsync(cancellationToken);

        // Read back the actual port (important when resolved=0 / OS-assigned)
        var address = app.Urls.First();
        var uri = new Uri(address);
        Port = uri.Port;

        SetStatus(HostStatus.Running);
        }
        catch (Exception ex)
        {
            LastError = ex.Message;
            SetStatus(HostStatus.Failed);
        }
    }

    /// <summary>
    /// Try the preferred port; if busy, return 0 (OS assigns a free port).
    /// </summary>
    private static int ResolvePort(int preferredPort)
    {
        try
        {
            using var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, preferredPort);
            listener.Start();
            listener.Stop();
            return preferredPort;
        }
        catch
        {
            return 0; // let OS pick
        }
    }

    /// <summary>
    /// Gracefully stop the host.
    /// </summary>
    public async Task StopAsync()
    {
        if (_app is not null)
        {
            await _app.StopAsync();
            await _app.DisposeAsync();
            _app = null;
        }
        Port = 0;
        SetStatus(HostStatus.Stopped);
    }
}

/// <summary>
/// Host status values.
/// </summary>
public enum HostStatus
{
    Stopped,
    Starting,
    Running,
    Failed
}
