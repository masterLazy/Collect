using Collect.Core.Services;

namespace Collect.Core.Middleware;

/// <summary>
/// Resolves the libraryId from the request query string and sets the
/// resolved library path in HttpContext.Items["LibraryPath"] so that
/// LibraryService.GetLibraryPath() can read it per-request.
/// This ensures multiple clients accessing different libraries don't conflict.
/// </summary>
public class LibraryContextMiddleware
{
    private readonly RequestDelegate _next;

    public LibraryContextMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, ILibraryService libraryService)
    {
        // Read libraryId from query string
        var libraryId = context.Request.Query["libraryId"].FirstOrDefault();

        if (!string.IsNullOrWhiteSpace(libraryId))
        {
            var path = await libraryService.GetPathByIdAsync(libraryId);
            if (path is not null)
            {
                context.Items["LibraryPath"] = path;
            }
        }

        await _next(context);
    }
}
