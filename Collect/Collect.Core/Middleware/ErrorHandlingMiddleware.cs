using System.Net;
using System.Text.Json;

namespace Collect.Core.Middleware;

/// <summary>
/// Global error handling middleware that catches unhandled exceptions
/// and returns structured JSON error responses.
/// </summary>
public class ErrorHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ErrorHandlingMiddleware> _logger;

    public ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            var path = context.Request.Path.Value ?? "";
            _logger.LogError(ex, "Unhandled exception occurred while processing request: {Method} {Path}",
                context.Request.Method, path);

            // If the response has already started we cannot write an error body — aborting avoids
            // throwing a second exception that would mask the original failure.
            if (context.Response.HasStarted)
            {
                context.Abort();
                return;
            }

            context.Response.ContentType = "application/json";
            context.Response.StatusCode = (int)HttpStatusCode.InternalServerError;

            var response = new
            {
                error = "An internal server error occurred.",
                detail = ex.Message
            };

            await context.Response.WriteAsync(JsonSerializer.Serialize(response));
        }
    }
}
