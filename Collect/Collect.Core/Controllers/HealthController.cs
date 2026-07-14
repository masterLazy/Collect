using Microsoft.AspNetCore.Mvc;

namespace Collect.Core.Controllers;

/// <summary>
/// Health check endpoint for server readiness verification.
/// Used by the WPF host to confirm the backend is fully started
/// before opening the browser.
/// </summary>
[ApiController]
[Route("api/health")]
public class HealthController : ControllerBase
{
    /// <summary>
    /// GET /api/health
    /// Returns a simple 200 OK with status "ok".
    /// Has no dependencies on library, services, or authentication.
    /// </summary>
    [HttpGet]
    public IActionResult GetHealth()
    {
        return Ok(new { status = "ok" });
    }
}
