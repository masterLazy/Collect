using Collect.Core.Services;
using Microsoft.AspNetCore.Mvc;

namespace Collect.Core.Controllers;

[ApiController]
[Route("api/logs")]
public class LogController : ControllerBase
{
    private readonly ILogCollector _logCollector;

    public LogController(ILogCollector logCollector)
    {
        _logCollector = logCollector;
    }

    /// <summary>
    /// Receive log entries from the frontend (browser-side logs).
    /// </summary>
    [HttpPost("frontend")]
    public IActionResult PostFrontendLog([FromBody] FrontendLogEntry entry)
    {
        _logCollector.AddFrontendLog(new LogEntry(
            DateTime.Now,
            entry.Level,
            "Frontend",
            entry.Message,
            entry.Exception
        ));
        return Ok();
    }

    /// <summary>
    /// Get recent backend log entries.
    /// </summary>
    [HttpGet("backend")]
    public IActionResult GetBackendLogs([FromQuery] int count = 100)
    {
        return Ok(_logCollector.GetBackendLogs(count));
    }

    /// <summary>
    /// Get recent frontend log entries.
    /// </summary>
    [HttpGet("frontend")]
    public IActionResult GetFrontendLogs([FromQuery] int count = 100)
    {
        return Ok(_logCollector.GetFrontendLogs(count));
    }
}

/// <summary>
/// Log entry submitted by the frontend via POST /api/logs/frontend.
/// </summary>
public record FrontendLogEntry(string Level, string Message, string? Exception = null);
