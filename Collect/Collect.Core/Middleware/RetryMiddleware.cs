namespace Collect.Core.Middleware;

/// <summary>
/// Middleware that automatically retries idempotent HTTP requests (GET, HEAD, OPTIONS, TRACE)
/// when the downstream pipeline throws a transient exception (IOException, TimeoutException,
/// TaskCanceledException, HttpRequestException).
///
/// Uses exponential backoff between attempts (200ms → 500ms → 1200ms).
/// Non-idempotent methods (POST, PUT, DELETE, PATCH) pass through without retry
/// to avoid unintended side effects from duplicate execution.
///
/// When all retries are exhausted, the last exception propagates to ErrorHandlingMiddleware
/// which returns a structured 500 response to the client.
/// </summary>
public class RetryMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RetryMiddleware> _logger;

    private static readonly int[] RetryDelaysMs = [200, 500, 1200];
    private static readonly HashSet<string> IdempotentMethods =
        ["GET", "HEAD", "OPTIONS", "TRACE"];

    public RetryMiddleware(RequestDelegate next, ILogger<RetryMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Only retry idempotent methods to avoid duplicate side effects
        if (!IdempotentMethods.Contains(context.Request.Method))
        {
            await _next(context);
            return;
        }

        for (int attempt = 0; attempt <= RetryDelaysMs.Length; attempt++)
        {
            try
            {
                await _next(context);
                return; // Success — no retry needed
            }
            catch (Exception ex) when (IsTransient(ex))
            {
                if (attempt >= RetryDelaysMs.Length)
                {
                    _logger.LogError(ex,
                        "RetryMiddleware: All {Max} retries exhausted for {Method} {Path}",
                        RetryDelaysMs.Length + 1, context.Request.Method, context.Request.Path);
                    throw; // Let ErrorHandlingMiddleware handle it
                }

                _logger.LogWarning(ex,
                    "RetryMiddleware: Transient error on {Method} {Path} (attempt {Attempt}/{Max}), retrying in {Delay}ms",
                    context.Request.Method, context.Request.Path, attempt + 1, RetryDelaysMs.Length + 1, RetryDelaysMs[attempt]);

                await Task.Delay(RetryDelaysMs[attempt]);
            }
        }
    }

    private static bool IsTransient(Exception ex)
    {
        return ex is IOException
            or TimeoutException
            or TaskCanceledException
            or OperationCanceledException
            or HttpRequestException;
    }
}
