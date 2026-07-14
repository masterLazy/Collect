namespace Collect.Core.Services;

/// <summary>
/// Provides access to captured log entries for backend and frontend.
/// Used by the WPF host to display logs in the desktop UI.
/// </summary>
public interface ILogCollector
{
    /// <summary>
    /// Total number of backend log entries ever added (monotonically increasing).
    /// </summary>
    long TotalBackendEntries { get; }

    /// <summary>
    /// Total number of frontend log entries ever added (monotonically increasing).
    /// </summary>
    long TotalFrontendEntries { get; }

    /// <summary>
    /// Get recent backend log entries (newest first).
    /// </summary>
    IReadOnlyList<LogEntry> GetBackendLogs(int count = 100);

    /// <summary>
    /// Get recent frontend log entries (newest first).
    /// Frontend logs are sent via a special API endpoint.
    /// </summary>
    IReadOnlyList<LogEntry> GetFrontendLogs(int count = 100);

    /// <summary>
    /// Add a frontend log entry (called by the API controller).
    /// </summary>
    void AddFrontendLog(LogEntry entry);

    /// <summary>
    /// Clears all collected logs.
    /// </summary>
    void Clear();
}

/// <summary>
/// A single log entry.
/// </summary>
public record LogEntry(
    DateTime Timestamp,
    string Level,    // "Information", "Warning", "Error", "Debug"
    string Category, // e.g. "Collect.Core.Services.AssetService"
    string Message,
    string? Exception = null
);
