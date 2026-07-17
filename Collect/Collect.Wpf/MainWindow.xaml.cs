using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using Collect.Core;
using Collect.Core.Services;
using Forms = System.Windows.Forms;

namespace Collect.Wpf;

/// <summary>
/// Display model for a log entry in the UI.
/// </summary>
public class LogDisplay {
    public string Source { get; init; } = "";   // "BE" or "FE"
    public string Timestamp { get; init; } = "";
    public string Level { get; init; } = "";
    public string Message { get; init; } = "";
}

public partial class MainWindow : Window {
    private CollectHost? _host;
    private readonly DispatcherTimer _logTimer = new();
    private int _currentFilter = -1;
    private long _lastBackendTotal;
    private long _lastFrontendTotal;

    public MainWindow() {
        InitializeComponent();
        UpdateUI(HostStatus.Stopped);

        _logTimer.Interval = TimeSpan.FromSeconds(1);
        _logTimer.Tick += PollLogs;
    }

    private bool _pendingBrowserOpen;
    private Forms.NotifyIcon? _trayIcon;

    private void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e) {
        if (_closeFromTray || _host == null || _host?.IsRunning == false) {
            RemoveTrayIcon();
            return;
        }
        e.Cancel = true;
        MinimizeToTray();
    }

    bool _closeFromTray = false;
    private void MinimizeToTray() {
        Hide();

        if (_trayIcon is null) {
            var iconPath = System.IO.Path.Combine(
                AppDomain.CurrentDomain.BaseDirectory, @"res\icon.ico");

            _trayIcon = new Forms.NotifyIcon {
                Icon = new System.Drawing.Icon(iconPath),
                Text = "Collect",
                Visible = true,
                BalloonTipTitle = "Collect",
                BalloonTipText = "Collect is running",
                BalloonTipIcon = Forms.ToolTipIcon.Info,
            };

            _trayIcon.MouseClick += (s, e) => {
                if (e.Button == MouseButtons.Left) {
                    RestoreFromTray();
                }
            };

            var menu = new Forms.ContextMenuStrip();
            menu.Items.Add("Open", null, (_, _) => RestoreFromTray());
            menu.Items.Add(new Forms.ToolStripSeparator());
            menu.Items.Add("Exit", null, (_, _) => {
                RemoveTrayIcon();
                _closeFromTray = true;
                Dispatcher.Invoke(() => Close());
            });

            _trayIcon.ContextMenuStrip = menu;
        }

        // Play the system notification sound and show a balloon tip.
        System.Media.SystemSounds.Question.Play();
        _trayIcon.ShowBalloonTip(3000);
    }

    private void RestoreFromTray() {
        Show();
        WindowState = WindowState.Normal;
        Activate();
    }

    private void RemoveTrayIcon() {
        if (_trayIcon is not null) {
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
            _trayIcon = null;
        }
    }

    private async void BtnLaunch_Click(object sender, RoutedEventArgs e) {
        BtnLaunch.IsEnabled = false;
        BtnStop.IsEnabled = false;
        BtnOpen.IsEnabled = false;

        _host = new CollectHost();
        _host.StatusChanged += OnHostStatusChanged;

        // Resolve build path
        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        var buildPath = System.IO.Path.GetFullPath(
            System.IO.Path.Combine(baseDir, @"chakra-app"));

        _pendingBrowserOpen = true;
        await _host.StartAsync(5000, buildPath);
    }

    private async void BtnStop_Click(object sender, RoutedEventArgs e) {
        BtnLaunch.IsEnabled = false;
        BtnStop.IsEnabled = false;
        BtnOpen.IsEnabled = false;

        _logTimer.Stop();
        if (_host is not null) {
            await _host.StopAsync();
            _host.StatusChanged -= OnHostStatusChanged;
        }
        _currentFilter = -1;
        _lastBackendTotal = 0;
        _lastFrontendTotal = 0;
        UpdateUI(HostStatus.Stopped);
    }

    private void BtnOpen_Click(object sender, RoutedEventArgs e) {
        OpenBrowser();
    }

    private void TxtUrl_MouseDown(object sender, System.Windows.Input.MouseButtonEventArgs e) {
        OpenBrowser();
    }

    private void OpenBrowser() {
        if (_host is { Status: HostStatus.Running }) {
            Process.Start(new ProcessStartInfo {
                FileName = GetUrl(),
                UseShellExecute = true
            });
        }
    }

    private string GetUrl() {
        var ip = GetLocalIP();
        return $"http://{ip}:{_host?.Port ?? 0}";
    }

    /// <summary>
    /// Gets the first non-loopback IPv4 address on the machine.
    /// Falls back to "localhost" if none found.
    /// </summary>
    private static string GetLocalIP() {
        try {
            var first = NetworkInterface.GetAllNetworkInterfaces()
                .Where(ni => ni.OperationalStatus == OperationalStatus.Up)
                .SelectMany(ni => ni.GetIPProperties().UnicastAddresses)
                .FirstOrDefault(ua => ua.Address.AddressFamily == AddressFamily.InterNetwork
                                      && !IPAddress.IsLoopback(ua.Address));
            if (first != null)
                return first.Address.ToString();
        }
        catch {
            // fall through
        }
        return "localhost";
    }

    private void BtnClear_Click(object sender, RoutedEventArgs e) {
        LogList.Items.Clear();
        _host?.Logs.Clear();
        _currentFilter = -1;
        _lastBackendTotal = 0;
        _lastFrontendTotal = 0;
    }

    private void OnHostStatusChanged(object? sender, HostStatus status) {
        Dispatcher.Invoke(() => {
            UpdateUI(status);
            if (status == HostStatus.Running && _pendingBrowserOpen) {
                _pendingBrowserOpen = false;
                _logTimer.Start();
                _ = WaitForHealthCheckAsync(_host!.Port);
            }
        });
    }

    private async Task WaitForHealthCheckAsync(int port) {
        const int maxRetries = 20;
        const int delayMs = 500;

        using var httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };

        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            Dispatcher.Invoke(() => { TxtStatus.Text = "Starting..."; });

            try {
                var response = await httpClient.GetAsync($"http://localhost:{port}/api/health");
                if (response.IsSuccessStatusCode) {
                    Dispatcher.Invoke(() => {
                        UpdateUI(HostStatus.Running);
                        OpenBrowser();
                        MinimizeToTray();
                    });
                    return;
                }
            }
            catch {
                // Server not ready yet, continue polling
            }

            await Task.Delay(delayMs);
        }

        // All retries exhausted — log a warning and update status
        Dispatcher.Invoke(() => {
            TxtStatus.Text = "Running (health check failed)";
            if (_host!.Logs is LogCollector logCollector) {
                logCollector.AddBackendLog(new LogEntry(
                    DateTime.UtcNow,
                    "Warning",
                    "Collect.Wpf",
                    "Health check failed after 20 retries. Server may not be fully ready."
                ));
            }
        });
    }

    private void UpdateUI(HostStatus status) {
        switch (status) {
            case HostStatus.Stopped:
                TxtStatus.Text = "Stopped";
                TxtStatus.Foreground = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0x66, 0x66, 0x66));
                StatusDot.Fill = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0x66, 0x66, 0x66));
                TxtUrl.Text = "";
                BtnLaunch.IsEnabled = true;
                BtnStop.IsEnabled = false;
                BtnOpen.IsEnabled = false;
                break;

            case HostStatus.Starting:
                TxtStatus.Text = "Starting...";
                TxtStatus.Foreground = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xe3, 0x74, 0x00));
                StatusDot.Fill = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xe3, 0x74, 0x00));
                TxtUrl.Text = "";
                BtnLaunch.IsEnabled = false;
                BtnStop.IsEnabled = false;
                BtnOpen.IsEnabled = false;
                break;

            case HostStatus.Running:
                TxtStatus.Text = "Running";
                TxtStatus.Foreground = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0x1a, 0x73, 0xe8));
                StatusDot.Fill = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0x1a, 0x73, 0xe8));
                TxtUrl.Text = GetUrl();
                BtnLaunch.IsEnabled = false;
                BtnStop.IsEnabled = true;
                BtnOpen.IsEnabled = true;
                break;

            case HostStatus.Failed:
                TxtStatus.Text = "Failed";
                TxtStatus.Foreground = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xd9, 0x30, 0x25));
                StatusDot.Fill = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xd9, 0x30, 0x25));
                TxtUrl.Text = _host?.LastError ?? "";
                BtnLaunch.IsEnabled = true;
                BtnStop.IsEnabled = false;
                BtnOpen.IsEnabled = false;
                break;
        }
    }

    private void PollLogs(object? sender, EventArgs e) {
        if (_host is null) return;

        var filter = LogFilter.SelectedIndex; // 0=All 1=Backend 2=Frontend

        // When filter changes, clear the list and reset tracking so existing
        // items that don't match the new filter are removed.
        if (filter != _currentFilter) {
            LogList.Items.Clear();
            _lastBackendTotal = 0;
            _lastFrontendTotal = 0;
            _currentFilter = filter;
        }

        var backendTotal = _host.Logs.TotalBackendEntries;
        var frontendTotal = _host.Logs.TotalFrontendEntries;

        // Collect new items (already newest-first from GetBackendLogs)
        var newItems = new List<LogDisplay>();

        // Backend
        if (filter != 2) {
            var newCount = (int)(backendTotal - _lastBackendTotal);
            if (newCount > 0) {
                foreach (var entry in _host.Logs.GetBackendLogs(newCount)) {
                    newItems.Add(new LogDisplay {
                        Source = "BE",
                        Timestamp = entry.Timestamp.ToString("HH:mm:ss"),
                        Level = entry.Level,
                        Message = entry.Message
                    });
                }
            }
        }

        // Frontend
        if (filter != 1) {
            var newCount = (int)(frontendTotal - _lastFrontendTotal);
            if (newCount > 0) {
                foreach (var entry in _host.Logs.GetFrontendLogs(newCount)) {
                    newItems.Add(new LogDisplay {
                        Source = "FE",
                        Timestamp = entry.Timestamp.ToString("HH:mm:ss"),
                        Level = entry.Level,
                        Message = entry.Message
                    });
                }
            }
        }

        _lastBackendTotal = backendTotal;
        _lastFrontendTotal = frontendTotal;

        if (newItems.Count == 0) return;

        // Insert newest-first at the top. newItems is already newest-first
        // from GetBackendLogs/GetFrontendLogs, so iterating in reverse and
        // inserting at index 0 yields newest at top.
        for (int i = newItems.Count - 1; i >= 0; i--)
            LogList.Items.Insert(0, newItems[i]);

        // Trim to keep last 2000 entries
        while (LogList.Items.Count > 2000)
            LogList.Items.RemoveAt(LogList.Items.Count - 1);
    }
}