using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Collect.Core.Services;

/// <summary>
/// Thread-safe log collector that captures log entries in memory.
/// Registered as a singleton ILoggerProvider so all ILogger calls flow through it.
/// Also implements ILogCollector for external consumption (e.g., WPF UI).
/// </summary>
public class LogCollector : ILoggerProvider, ILogCollector
{
    private readonly ConcurrentQueue<LogEntry> _backendLogs = new();
    private readonly ConcurrentQueue<LogEntry> _frontendLogs = new();
    private const int MaxEntries = 5000;
    private long _totalBackendAdded;
    private long _totalFrontendAdded;

    public long TotalBackendEntries => Interlocked.Read(ref _totalBackendAdded);
    public long TotalFrontendEntries => Interlocked.Read(ref _totalFrontendAdded);

    public ILogger CreateLogger(string categoryName)
    {
        return new CollectLogger(categoryName, this);
    }

    public void AddBackendLog(LogEntry entry)
    {
        _backendLogs.Enqueue(entry);
        Interlocked.Increment(ref _totalBackendAdded);
        while (_backendLogs.Count > MaxEntries)
            _backendLogs.TryDequeue(out _);
    }

    public IReadOnlyList<LogEntry> GetBackendLogs(int count = 100)
    {
        return _backendLogs.Reverse().Take(count).ToList().AsReadOnly();
    }

    public IReadOnlyList<LogEntry> GetFrontendLogs(int count = 100)
    {
        return _frontendLogs.Reverse().Take(count).ToList().AsReadOnly();
    }

    public void AddFrontendLog(LogEntry entry)
    {
        _frontendLogs.Enqueue(entry);
        Interlocked.Increment(ref _totalFrontendAdded);
        while (_frontendLogs.Count > MaxEntries)
            _frontendLogs.TryDequeue(out _);
    }

    public void Clear()
    {
        while (_backendLogs.TryDequeue(out _)) { }
        while (_frontendLogs.TryDequeue(out _)) { }
    }

    public void Dispose() { }

    private sealed class CollectLogger : ILogger
    {
        private readonly string _categoryName;
        private readonly LogCollector _collector;

        public CollectLogger(string categoryName, LogCollector collector)
        {
            _categoryName = categoryName;
            _collector = collector;
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;

            var level = logLevel switch
            {
                LogLevel.Trace => "Trace",
                LogLevel.Debug => "Debug",
                LogLevel.Information => "Information",
                LogLevel.Warning => "Warning",
                LogLevel.Error => "Error",
                LogLevel.Critical => "Critical",
                _ => "Information"
            };

            _collector.AddBackendLog(new LogEntry(
                DateTime.Now,
                level,
                _categoryName,
                formatter(state, exception),
                exception?.ToString()
            ));
        }
    }
}
