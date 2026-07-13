using Collect.Core.Middleware;
using Collect.Core.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Services ──────────────────────────────────────────
builder.Services.AddControllers();

builder.Services.AddSingleton<ILibraryService, LibraryService>();
builder.Services.AddSingleton<IAssetService, AssetService>();
builder.Services.AddSingleton<ITagService, TagService>();
builder.Services.AddSingleton<IThumbnailService, ThumbnailService>();

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

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();

app.MapControllers();

// ── Startup ───────────────────────────────────────────
var port = args.Length > 0 ? args[0] : "5000";
app.Run($"http://0.0.0.0:{port}");
