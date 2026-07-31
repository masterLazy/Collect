using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Collect.Core.Dtos;
using Collect.Core.Models;
using SkiaSharp;
using static Collect.Core.Services.ContentFingerprint;

namespace Collect.Core.Services;

/// <summary>
/// Implements asset CRUD, scanning, tag parsing, search, and thumbnail management.
/// Asset state is derived entirely from the filesystem on each scan; no JSON persistence.
/// </summary>
public partial class AssetService : IAssetService
{
    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif"
    };

    [GeneratedRegex(@"^\[(?<type>[^\]]+)\](?<value>.+)$")]
    private static partial Regex TaggedSegmentRegex();

    private readonly ILibraryService _libraryService;
    private readonly IThumbnailService _thumbnailService;
    private readonly IEncryptionService _encryptionService;
    private readonly ILogger<AssetService> _logger;
    private readonly SemaphoreSlim _semaphore = new(1, 1);

    // Serializes destructive encrypt/decrypt operations across separate backend instances
    // (standalone server + WPF host) operating on the same library simultaneously.
    private const string CrossProcessLockName = @"Global\Collect.BackendOperation";
    private static readonly Mutex? _crossProcessMutex = TryCreateCrossProcessMutex();

    private List<Asset> _assets = new();

    public AssetService(
        ILibraryService libraryService,
        IThumbnailService thumbnailService,
        IEncryptionService encryptionService,
        ILogger<AssetService> logger)
    {
        _libraryService = libraryService;
        _thumbnailService = thumbnailService;
        _encryptionService = encryptionService;
        _logger = logger;
    }

    // ──────────────────────────────────────────────
    //  Cross-process operation lock (V3)
    // ──────────────────────────────────────────────

    private static Mutex? TryCreateCrossProcessMutex()
    {
        try
        {
            return new Mutex(initiallyOwned: false, CrossProcessLockName);
        }
        catch (Exception)
        {
            // Global namespace unavailable (e.g. restricted session) — degrade gracefully:
            // in-process locks still apply; cross-process protection is skipped.
            return null;
        }
    }

    /// <summary>
    /// Attempts to acquire the cross-process operation mutex, which serializes destructive
    /// encrypt/decrypt work (and detects concurrent scans) across separate backend instances.
    /// The named mutex is thread-affine, so callers must acquire and release it without awaiting
    /// in between (release before any <see langword="await"/> that may hop threads).
    /// </summary>
    /// <param name="timeout">How long to wait for the lock before giving up.</param>
    /// <param name="throwIfUnavailable">
    /// When true (destructive operations), throws <see cref="InvalidOperationException"/> if the lock
    /// cannot be acquired so the operation refuses to proceed. When false (scan), logs a prominent
    /// warning and returns null so the caller proceeds non-destructively.
    /// </param>
    /// <param name="operation">Human-readable operation name for log messages.</param>
    /// <returns>A handle that releases the mutex on dispose, or null if it was not acquired.</returns>
    private CrossProcessLockHandle? TryAcquireCrossProcessLock(TimeSpan timeout, bool throwIfUnavailable, string operation)
    {
        if (_crossProcessMutex is null)
        {
            _logger.LogWarning("Cross-process operation lock is unavailable ({Operation}) — proceeding without it", operation);
            return null;
        }

        try
        {
            if (_crossProcessMutex.WaitOne(timeout))
                return new CrossProcessLockHandle(_crossProcessMutex);
        }
        catch (AbandonedMutexException)
        {
            // A previous instance crashed mid-operation; we now own the mutex.
            _logger.LogWarning("Cross-process operation lock was abandoned by a previous instance ({Operation}) — taking ownership", operation);
            return new CrossProcessLockHandle(_crossProcessMutex);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to acquire cross-process operation lock ({Operation})", operation);
            return null;
        }

        if (throwIfUnavailable)
        {
            throw new InvalidOperationException(
                "Another Collect backend instance is currently operating on this library. " +
                "Stop the other instance (standalone server or WPF host) and try again.");
        }

        _logger.LogWarning(
            "Another Collect backend instance appears to be operating on this library — proceeding without the cross-process lock ({Operation})",
            operation);
        return null;
    }

    /// <summary>
    /// Disposable handle that releases the cross-process mutex on dispose.
    /// </summary>
    private sealed class CrossProcessLockHandle : IDisposable
    {
        private readonly Mutex _mutex;

        public CrossProcessLockHandle(Mutex mutex) => _mutex = mutex;

        public void Dispose()
        {
            try { _mutex.ReleaseMutex(); }
            catch (ApplicationException) { /* Mutex not owned on the current thread — ignore. */ }
        }
    }

    // ──────────────────────────────────────────────
    //  Tag Parsing
    // ──────────────────────────────────────────────

    /// <summary>
    /// Parse tags from a filename following the convention:
    /// [画师]yaungpeng-人物-伪厚涂 → [{Type:"画师",Value:"yaungpeng"}, {Type:null,Value:"人物"}, ...]
    /// Edge cases:
    /// - No brackets → type=null, value=segment
    /// - [Type]Value → type="Type", value="Value"
    /// - Pure numbers → skip
    /// </summary>
    public static List<AssetTag> ParseTags(string fileNameWithoutExtension)
    {
        var tags = new List<AssetTag>();
        var segments = fileNameWithoutExtension.Split('-', StringSplitOptions.RemoveEmptyEntries);

        foreach (var segment in segments)
        {
            var trimmed = segment.Trim();
            if (string.IsNullOrEmpty(trimmed))
                continue;

            // Skip pure numeric segments (e.g. version numbers, IDs)
            if (trimmed.All(char.IsDigit))
                continue;

            var match = TaggedSegmentRegex().Match(trimmed);
            if (match.Success)
            {
                var value = match.Groups["value"].Value;
                // Skip if the value part is empty or pure numbers
                if (string.IsNullOrEmpty(value) || value.All(char.IsDigit))
                    continue;

                tags.Add(new AssetTag
                {
                    Type = match.Groups["type"].Value,
                    Value = value
                });
            }
            else
            {
                tags.Add(new AssetTag
                {
                    Type = null,
                    Value = trimmed
                });
            }
        }

        return tags;
    }

    // ──────────────────────────────────────────────
    //  File-Name Encryption Helpers
    // ──────────────────────────────────────────────

    /// <summary>
    /// Returns the encryption key when the current library encrypts on-disk file names AND is
    /// unlocked; otherwise null. Name encryption/decryption only ever runs when both hold
    /// (a locked name-encrypted library falls back to current behavior).
    /// </summary>
    private byte[]? GetFileNameEncryptionKey()
    {
        if (!_libraryService.EncryptsFileNames())
            return null;
        return _libraryService.GetEncryptionKey();
    }

    /// <summary>
    /// Attempts to decrypt an on-disk basename (no extension) to its plaintext form.
    /// Returns the plaintext basename on success, or null when the name is not encrypted with
    /// the given key (a legacy plaintext on-disk name).
    /// </summary>
    private string? DecryptOnDiskBasename(string onDiskFileName, byte[] key)
        => _encryptionService.TryDecryptFileName(onDiskFileName, key, out var plain)
            ? plain
            : null;

    /// <summary>
    /// Encrypts a plaintext basename (no extension) into its deterministic on-disk form.
    /// </summary>
    private string EncryptBasename(string plaintextBasename, byte[] key)
        => _encryptionService.EncryptFileName(plaintextBasename, key);

    /// <summary>
    /// Builds the on-disk file name (encrypted basename + extension) for a plaintext basename.
    /// </summary>
    private string BuildOnDiskName(string plaintextBasename, string extension, byte[] key)
        => EncryptBasename(plaintextBasename, key) + extension;

    /// <summary>
    /// Converts a plaintext relative path into the corresponding on-disk relative path by
    /// encrypting its basename when file-name encryption is active. When no key is available
    /// (feature off, or library locked) the input is returned unchanged.
    /// </summary>
    private string ToOnDiskRelativePath(string plaintextRelativePath, byte[]? nameKey)
    {
        if (nameKey is null)
            return plaintextRelativePath;

        var dir = Path.GetDirectoryName(plaintextRelativePath) ?? "";
        var basename = Path.GetFileNameWithoutExtension(plaintextRelativePath);
        var ext = Path.GetExtension(plaintextRelativePath);
        var onDiskName = BuildOnDiskName(basename, ext, nameKey);
        return string.IsNullOrEmpty(dir) ? onDiskName : dir + Path.DirectorySeparatorChar + onDiskName;
    }

    /// <summary>
    /// Renames the on-disk basename of an asset to its deterministic encrypted form.
    /// FileName stays plaintext; RelativePath is updated to the new on-disk path. Falls back to
    /// plaintext-level suffixes (-01..-999) on collision. Never throws — on failure the file is
    /// left as-is (legacy plaintext name) and a warning is logged.
    /// </summary>
    private void RenameOnDiskBasenameToEncrypted(string libraryPath, string sourceFullPath, Asset asset, byte[] nameKey)
    {
        var plaintextBasename = Path.GetFileNameWithoutExtension(asset.FileName);
        var ext = Path.GetExtension(asset.FileName);
        var onDiskName = BuildOnDiskName(plaintextBasename, ext, nameKey);
        var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
        var onDiskRelPath = string.IsNullOrEmpty(oldDir) ? onDiskName : oldDir + Path.DirectorySeparatorChar + onDiskName;
        var onDiskFullPath = Path.Combine(libraryPath, onDiskRelPath);

        if (string.Equals(Path.GetFileName(asset.RelativePath), onDiskName, StringComparison.OrdinalIgnoreCase))
            return; // basename already encrypted

        if (File.Exists(onDiskFullPath))
        {
            // Collision — fall back to suffixing the plaintext basename, encrypting each candidate.
            for (int i = 1; i <= 999; i++)
            {
                var suffixedPlain = $"{plaintextBasename}-{i:D2}{ext}";
                var suffixedOnDisk = BuildOnDiskName(Path.GetFileNameWithoutExtension(suffixedPlain), ext, nameKey);
                var suffixedRel = string.IsNullOrEmpty(oldDir) ? suffixedOnDisk : oldDir + Path.DirectorySeparatorChar + suffixedOnDisk;
                if (File.Exists(Path.Combine(libraryPath, suffixedRel)))
                    continue;

                if (TryMoveWithRetry(sourceFullPath, Path.Combine(libraryPath, suffixedRel)))
                {
                    asset.FileName = suffixedPlain;
                    asset.RelativePath = suffixedRel;
                    _logger.LogInformation(
                        "Encrypted on-disk name for asset {AssetId} (collision): {Plain} -> {OnDisk}",
                        asset.Id, suffixedPlain, suffixedRel);
                    return;
                }
            }

            _logger.LogWarning(
                "Could not encrypt on-disk name for asset {AssetId} (no unique name) — keeping {Path}",
                asset.Id, sourceFullPath);
            return;
        }

        if (TryMoveWithRetry(sourceFullPath, onDiskFullPath))
        {
            asset.RelativePath = onDiskRelPath;
            _logger.LogInformation(
                "Encrypted on-disk name for asset {AssetId}: {Plain} -> {OnDisk}",
                asset.Id, asset.FileName, onDiskRelPath);
        }
        else
        {
            _logger.LogWarning(
                "Failed to encrypt on-disk name for asset {AssetId} (move failed): {Path}",
                asset.Id, sourceFullPath);
        }
    }

    // ──────────────────────────────────────────────
    //  Scan
    // ──────────────────────────────────────────────

    public async Task<ScanResult> ScanAsync()
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null)
            throw new InvalidOperationException("Library not initialized. Call /api/library/init first.");

        var collectDir = Path.Combine(libraryPath, ".collect");

        await _semaphore.WaitAsync();
        try
        {
            // Cross-process guard: scan is non-destructive, so only try the operation mutex briefly.
            // If another backend instance is mid-encrypt/decrypt, log a prominent warning and proceed —
            // the in-process _semaphore still serializes within this instance.
            int added, removed;
            using (CrossProcessLockHandle? crossProcessLock = TryAcquireCrossProcessLock(
                       TimeSpan.FromMilliseconds(500), throwIfUnavailable: false, "library scan"))
            {
                var scanCounts = ScanFilesSync(libraryPath, collectDir);
                added = scanCounts.Added;
                removed = scanCounts.Removed;
            }

            var tagConflicts = await NormalizeTagsAsync();

            await _libraryService.UpdateAssetCountAsync(_assets.Count);

            return new ScanResult
            {
                Added = added,
                Removed = removed,
                Total = _assets.Count,
                TagConflicts = tagConflicts
            };
        }
        finally
        {
            _semaphore.Release();
        }
    }

    /// <summary>
    /// Runs the synchronous portion of a library scan while the caller holds <see cref="_semaphore"/>:
    /// enumerates image files, creates/reconciles assets, encrypts newly-added plaintext files inline
    /// (when the library is encrypted), saves the manifest, and cleans up orphaned thumbnails.
    /// </summary>
    private (int Added, int Removed, int Total) ScanFilesSync(string libraryPath, string collectDir)
    {
        // Load previous manifest for add/removed tracking
        var previousManifest = AssetsManifest.Load(libraryPath);
        var previousIds = new HashSet<string>(previousManifest.AssetIds, StringComparer.OrdinalIgnoreCase);

        var newAssets = new List<Asset>();
        var added = 0;
        var scannedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var scannedIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var files = Directory.EnumerateFiles(libraryPath, "*.*", SearchOption.AllDirectories)
            .Where(f => !f.StartsWith(collectDir, StringComparison.OrdinalIgnoreCase)
                && ImageExtensions.Contains(Path.GetExtension(f)));

        foreach (var filePath in files)
        {
            try
            {
                var relativePath = Path.GetRelativePath(libraryPath, filePath);
                scannedPaths.Add(relativePath);

                var existing = _assets.FirstOrDefault(a =>
                    a.RelativePath.Equals(relativePath, StringComparison.OrdinalIgnoreCase));

                if (existing is not null)
                {
                    var lastWrite = File.GetLastWriteTimeUtc(filePath);
                    if (existing.LastModified is null || existing.LastModified.Value != lastWrite)
                    {
                        UpdateAssetMetadata(existing, filePath, relativePath);
                        existing.LastModified = lastWrite;
                    }
                    newAssets.Add(existing);
                    scannedIds.Add(existing.Id);
                }
                else
                {
                    var (asset, wasEncrypted, legacyPlaintextName) = CreateAssetFromFile(filePath, relativePath);
                    newAssets.Add(asset);
                    scannedIds.Add(asset.Id);
                    added++;

                    byte[]? encryptionKey = null;
                    if (_libraryService.IsEncryptedLibrary() && !wasEncrypted)
                    {
                        encryptionKey = _libraryService.GetEncryptionKey();
                        if (encryptionKey is not null)
                        {
                            EncryptFileOnDisk(filePath, encryptionKey);
                        }
                    }

                    // File-name encryption: when the library encrypts names, ensure the on-disk
                    // basename is encrypted. Covers both a newly added plaintext file and a legacy
                    // plaintext name detected in CreateAssetFromFile. FileName/Tags stay plaintext;
                    // RelativePath is updated to the encrypted on-disk path.
                    var nameKey = GetFileNameEncryptionKey();
                    if (nameKey is not null && legacyPlaintextName)
                    {
                        RenameOnDiskBasenameToEncrypted(libraryPath, filePath, asset, nameKey);
                    }

                    // LAZY: No longer generate thumbnails during scan.
                    // Thumbnails are generated on-demand when the frontend requests them.
                }
            }
            catch (Exception ex)
            {
                // A single unreadable or problematic file must not abort the whole library scan.
                _logger.LogWarning(ex, "Scan: skipping file {Path}: {Message}", filePath, ex.Message);
            }
        }

        var removed = previousIds.Count > 0
            ? previousIds.Count(id => !scannedIds.Contains(id))
            : _assets.Count(a => !scannedPaths.Contains(a.RelativePath));

        _assets = newAssets;

        // Save updated manifest
        var manifest = new AssetsManifest { AssetIds = scannedIds.ToList() };
        manifest.Save(libraryPath);

        // Clean up orphaned thumbnails using asset IDs from manifest
        _thumbnailService.CleanupOrphanedThumbnails(libraryPath, scannedIds);

        // Remove any leftover "*.collect-backup" sidecars from the retired backup mechanism
        CleanupOrphanedBackups(libraryPath, collectDir);

        return (added, removed, _assets.Count);
    }

    /// <summary>
    /// Removes any leftover "*.collect-backup" sidecar files from the library. These were a retired
    /// safety-net that copied the pre-rewrite bytes to disk before an atomic replace; they are no
    /// longer created (atomic writes never truncate in place). Existing leftovers are deleted on scan
    /// so no plaintext/ciphertext copies linger and bloat the library.
    /// </summary>
    private void CleanupOrphanedBackups(string libraryPath, string collectDir)
    {
        foreach (var backupFile in Directory.EnumerateFiles(libraryPath, "*.collect-backup", SearchOption.AllDirectories))
        {
            if (backupFile.StartsWith(collectDir, StringComparison.OrdinalIgnoreCase))
                continue;

            try
            {
                File.Delete(backupFile);
                _logger.LogInformation("Removed leftover backup {BackupFile}", backupFile);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to delete leftover backup {BackupFile}", backupFile);
            }
        }
    }

    private (Asset Asset, bool WasEncrypted, bool LegacyPlaintextName) CreateAssetFromFile(string filePath, string relativePath)
    {
        var fileInfo = new FileInfo(filePath);
        var onDiskNameWithoutExt = Path.GetFileNameWithoutExtension(filePath);
        var extension = fileInfo.Extension;

        string id;
        int width = 0, height = 0;
        bool wasEncrypted = false;
        bool legacyPlaintextName = false;
        string? detectedMime = null;

        var encryptionKey = _libraryService.GetEncryptionKey();
        if (encryptionKey is not null)
        {
            try
            {
                // Decrypt once, use for both fingerprint and dimension extraction.
                // IMPORTANT: fingerprint size must be decrypted.Length (plaintext size), NOT
                // fileInfo.Length (on-disk encrypted size = plaintext + 28 bytes nonce/tag).
                // Using the encrypted size makes the ID flip the first time a plaintext file gets
                // encrypted, orphaning thumbnails and 404ing stale frontend IDs.
                var decrypted = _encryptionService.ReadAndDecryptFile(filePath, encryptionKey);
                detectedMime = ImageMimeDetector.Detect(decrypted);
                id = ContentFingerprint.Compute(decrypted, decrypted.Length);
                _logger.LogInformation("Scan: {File} is encrypted on disk ({Disk} bytes) → fingerprint {Id} (plaintext {Plain} bytes, mime={Mime})", filePath, fileInfo.Length, id, decrypted.Length, detectedMime ?? GetMimeType(filePath));

                using var decryptedStream = new MemoryStream(decrypted);
                using var codec = SKCodec.Create(decryptedStream);
                if (codec != null)
                {
                    width = codec.Info.Width;
                    height = codec.Info.Height;
                }
                wasEncrypted = true;
            }
            catch (AuthenticationTagMismatchException)
            {
                // File not yet encrypted — fall through to plaintext. Compute(filePath) reads the
                // plaintext bytes with the plaintext size, so it matches the encrypted-case ID.
                id = ContentFingerprint.Compute(filePath);
                _logger.LogInformation("Scan: {File} is plaintext on disk → fingerprint {Id} (will be encrypted after scan)", filePath, id);
                ExtractDimensionsPlaintext(filePath, out width, out height);
            }
        }
        else
        {
            id = ContentFingerprint.Compute(filePath);
            ExtractDimensionsPlaintext(filePath, out width, out height);
        }

        // File-name decryption: when the library encrypts file names and a key is available,
        // recover the plaintext basename so FileName/Tags come from plaintext. When decryption
        // fails the on-disk name is a legacy plaintext name — it is kept as FileName here and
        // renamed to its encrypted form by the caller (see ScanFilesSync).
        var plaintextBasename = onDiskNameWithoutExt;
        var nameEncryptionKey = GetFileNameEncryptionKey();
        if (nameEncryptionKey is not null)
        {
            var decryptedName = DecryptOnDiskBasename(onDiskNameWithoutExt, nameEncryptionKey);
            if (decryptedName is not null)
            {
                plaintextBasename = decryptedName;
            }
            else
            {
                legacyPlaintextName = true;
                _logger.LogInformation(
                    "Scan: {File} has a legacy plaintext name (not decryptable) — will be renamed to its encrypted form",
                    filePath);
            }
        }

        var asset = new Asset
        {
            Id = id,
            FileName = plaintextBasename + extension,
            RelativePath = relativePath,
            FileSize = fileInfo.Length,
            Width = width,
            Height = height,
            MimeType = detectedMime ?? GetMimeType(filePath),
            ImportedAt = DateTime.UtcNow,
            LastModified = fileInfo.LastWriteTimeUtc,
            Tags = ParseTags(plaintextBasename)
        };

        return (asset, wasEncrypted, legacyPlaintextName);
    }

    /// <summary>
    /// Extract image dimensions from a plaintext file (no decryption).
    /// </summary>
    private static void ExtractDimensionsPlaintext(string filePath, out int width, out int height)
    {
        width = 0;
        height = 0;
        try
        {
            using var input = File.OpenRead(filePath);
            using var codec = SKCodec.Create(input);
            if (codec != null)
            {
                width = codec.Info.Width;
                height = codec.Info.Height;
            }
        }
        catch
        {
            // Non-image or corrupt file — dimensions stay 0
        }
    }

    /// <summary>
    /// Read an image file (possibly encrypted) and extract dimensions into the asset.
    /// Falls back to plaintext read if decryption fails (file may not yet be encrypted).
    /// </summary>
    private void UpdateDimensionsFromEncrypted(string filePath, Asset asset)
    {
        var encryptionKey = _libraryService.GetEncryptionKey();
        if (encryptionKey is not null)
        {
            try
            {
                var decrypted = _encryptionService.ReadAndDecryptFile(filePath, encryptionKey);
                using var decryptedStream = new MemoryStream(decrypted);
                using var codec = SKCodec.Create(decryptedStream);
                if (codec != null)
                {
                    asset.Width = codec.Info.Width;
                    asset.Height = codec.Info.Height;
                }
                return; // Successfully read encrypted
            }
            catch (AuthenticationTagMismatchException)
            {
                // File not yet encrypted — fall through to plaintext
            }
            catch
            {
                // Other errors — fall through to plaintext
            }
        }

        // Plaintext fallback
        ExtractDimensionsPlaintext(filePath, out var w, out var h);
        asset.Width = w;
        asset.Height = h;
    }

    /// <summary>
    /// Encrypt a file on disk in place using the given encryption key.
    /// Reads the plaintext file, encrypts in memory, and atomically replaces the file on disk
    /// (see <see cref="SafeFileIO.WriteAllBytesAtomic"/>). The source file is never truncated in
    /// place — a failure leaves the original intact.
    /// </summary>
    /// <remarks>
    /// Double-encryption guard: if the on-disk bytes do not match any known image format
    /// (see <see cref="ImageMimeDetector.Detect"/>), the file is almost certainly already encrypted or
    /// corrupt — it is skipped rather than re-encrypted (fail-safe: leaving a genuinely-plaintext exotic
    /// image unencrypted is acceptable; corrupting it is not).
    /// </remarks>
    /// <returns>True if the file was successfully encrypted; false if it was skipped or failed.</returns>
    private bool EncryptFileOnDisk(string filePath, byte[] encryptionKey)
    {
        byte[] plaintext;
        try
        {
            plaintext = File.ReadAllBytes(filePath);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to read file for encryption (original left untouched): {FilePath}", filePath);
            return false;
        }

        // V2 double-encryption guard: bytes that don't look like a known image are almost certainly
        // already-encrypted or corrupt — do NOT re-encrypt them.
        if (ImageMimeDetector.Detect(plaintext) is null)
        {
            _logger.LogWarning(
                "Skipping encryption of {FilePath}: {Len} bytes do not match a known image format (magic={Magic}); " +
                "file is likely already encrypted or corrupt — left untouched",
                filePath, plaintext.Length, ImageMimeDetector.MagicHex(plaintext));
            return false;
        }

        try
        {
            var encrypted = _encryptionService.Encrypt(plaintext, encryptionKey);
            SafeFileIO.WriteAllBytesAtomic(filePath, encrypted, _logger);
            _logger.LogInformation("Encrypted {FilePath} ({PlainLen} bytes -> {EncryptedLen} bytes)", filePath, plaintext.Length, encrypted.Length);
            return true;
        }
        catch (Exception ex)
        {
            // SafeFileIO guarantees the original file is intact here.
            _logger.LogWarning(ex, "Encryption failed for {FilePath} — original file left intact", filePath);
            return false;
        }
    }

    /// <summary>
    /// Strip tag segments from a filename, leaving only non-tag text.
    /// Uses <see cref="ParseTags"/> to identify which hyphen-separated segments are tags.
    /// If no non-tag segments remain, generates a name like "Asset_{8-char-guid}".
    /// </summary>
    private static string CleanFileName(string fileName)
    {
        var ext = Path.GetExtension(fileName);
        var nameWithoutExt = Path.GetFileNameWithoutExtension(fileName);
        var segments = nameWithoutExt.Split('-', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => s.Trim())
            .Where(s => s.Length > 0)
            .ToList();

        // Only remove segments that explicitly use [Type]Value bracket syntax.
        // Plain text segments (e.g. "vacation", "photo") are kept — they may be
        // part of a normal filename, not necessarily tag content.
        var cleanSegments = segments
            .Where(s => !TaggedSegmentRegex().IsMatch(s))
            .ToList();

        var cleanName = cleanSegments.Count > 0
            ? string.Join("-", cleanSegments)
            : $"Asset_{Guid.NewGuid().ToString("N")[..8]}";

        return $"{cleanName}{ext}";
    }

    private void UpdateAssetMetadata(Asset asset, string filePath, string relativePath)
    {
        var fileInfo = new FileInfo(filePath);
        asset.FileSize = fileInfo.Length;
        asset.RelativePath = relativePath;
        asset.LastModified = fileInfo.LastWriteTimeUtc;
        UpdateDimensionsFromEncrypted(filePath, asset);
    }

    // ──────────────────────────────────────────────
    //  Read / List / Detail
    // ──────────────────────────────────────────────

    public async Task<PaginatedResponse<AssetDto>> GetAssetsAsync(int page, int pageSize, string sort, string? folder = null, bool subfolders = true)
    {
        await EnsureScannedAsync();

        var filtered = _assets.AsEnumerable();

        // Filter by folder
        if (!string.IsNullOrEmpty(folder))
        {
            if (folder == "__root__")
            {
                // Root: assets with no directory separator in their relative path
                filtered = filtered.Where(a =>
                    !a.RelativePath.Contains(Path.DirectorySeparatorChar) &&
                    !a.RelativePath.Contains(Path.AltDirectorySeparatorChar));
            }
            else if (subfolders)
            {
                // Recursive mode: all files under the folder prefix
                var folderPrefix = folder.Replace('\\', '/').TrimEnd('/') + "/";
                filtered = filtered.Where(a =>
                    a.RelativePath.Replace('\\', '/').StartsWith(folderPrefix, StringComparison.OrdinalIgnoreCase));
            }
            else
            {
                // Non-recursive: only files directly in this folder (no subdirectories)
                var normalizedFolder = folder.Replace('\\', '/').TrimEnd('/');
                filtered = filtered.Where(a =>
                {
                    var rel = a.RelativePath.Replace('\\', '/');
                    var dir = Path.GetDirectoryName(rel)?.Replace('\\', '/') ?? "";
                    return string.Equals(dir, normalizedFolder, StringComparison.OrdinalIgnoreCase);
                });
            }
        }

        var assets = sort switch
        {
            "oldest" => filtered.OrderBy(a => a.LastModified ?? a.ImportedAt).ToList(),
            "name" => filtered.OrderBy(a => a.FileName).ToList(),
            "size" => filtered.OrderByDescending(a => a.FileSize).ToList(),
            "random" => filtered.OrderBy(_ => Guid.NewGuid()).ToList(),
            _ => filtered.OrderByDescending(a => a.LastModified ?? a.ImportedAt).ToList() // newest default
        };

        var total = assets.Count;
        var paged = assets
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => MapToDto(a))
            .ToList();

        return new PaginatedResponse<AssetDto>
        {
            Items = paged,
            Total = total,
            Page = page,
            PageSize = pageSize
        };
    }

    public async Task<AssetDetailDto?> GetAssetDetailAsync(string id)
    {
        await EnsureScannedAsync();
        var asset = _assets.FirstOrDefault(a => a.Id == id);
        if (asset is null) return null;

        // Lazy palette computation: if no cached palette exists, compute on demand
        if (asset.Palette is null)
        {
            var libraryPath = _libraryService.GetLibraryPath();
            if (libraryPath is not null)
            {
                var store = PalettesStore.Load(libraryPath);
                if (!store.Palettes.ContainsKey(id))
                {
                    // Palette not in store either — compute it now
                    await ComputePaletteAsync(id);
                }
            }
        }

        return MapToDetailDto(asset);
    }

    public async Task<Asset?> GetAssetAsync(string id)
    {
        await EnsureScannedAsync();
        return _assets.FirstOrDefault(a => a.Id == id);
    }

    public async Task<List<Asset>> GetAllAssetsAsync()
    {
        await EnsureScannedAsync();
        return _assets;
    }

    // ──────────────────────────────────────────────
    //  Update Tags
    // ──────────────────────────────────────────────

    public async Task<bool> UpdateTagsAsync(string id, List<AssetTag> tags)
    {
        await EnsureScannedAsync();

        await _semaphore.WaitAsync();
        try
        {
            var asset = _assets.FirstOrDefault(a => a.Id == id);
            if (asset is null) return false;

            var libraryPath = _libraryService.GetLibraryPath();
            if (libraryPath is null) return false;

            // Reorder: categorized tags before uncategorized tags, using category order if available
            var categoryOrder = await _libraryService.GetCategoryOrderAsync();
            tags = ReorderTags(tags, categoryOrder);

            var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
            var oldExt = Path.GetExtension(asset.FileName);

            // Build new filename from tags (plaintext display name)
            var newFileName = BuildFileNameFromTags(tags, oldExt);
            var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
            var newRelativePath = string.IsNullOrEmpty(oldDir) ? newFileName : oldDir + Path.DirectorySeparatorChar + newFileName;

            // When the library encrypts file names, the on-disk basename is the encrypted form of
            // the plaintext basename; collision checks and File.Move run against the on-disk name
            // while FileName stays plaintext. Suffix logic operates at the plaintext level.
            var nameKey = GetFileNameEncryptionKey();
            var newOnDiskRelativePath = ToOnDiskRelativePath(newRelativePath, nameKey);
            var newFilePath = Path.Combine(libraryPath, newOnDiskRelativePath);

            // Only rename if the filename actually changed
            if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
            {
                // If current filename already has a disambiguation suffix, skip rename
                if (HasDisambiguationSuffix(asset.FileName, newFileName))
                {
                    // Already has suffix, no rename needed for tag-based name
                }
                else if (!File.Exists(newFilePath))
                {
                    // No collision, rename directly
                    _thumbnailService.DeleteThumbnail(libraryPath, asset.Id);
                    if (!TryMoveWithRetry(oldFilePath, newFilePath))
                        return false;
                    asset.FileName = newFileName;
                    asset.RelativePath = newOnDiskRelativePath;
                }
                else
                {
                    // Collision: try numeric suffixes (plaintext level), encrypting each candidate
                    var baseWithoutExt = Path.GetFileNameWithoutExtension(newFileName);
                    bool found = false;
                    for (int i = 1; i <= 999; i++)
                    {
                        var suffixedName = $"{baseWithoutExt}-{i:D2}{oldExt}";
                        var suffixedRelPath = string.IsNullOrEmpty(oldDir) ? suffixedName : oldDir + Path.DirectorySeparatorChar + suffixedName;
                        var suffixedOnDiskRelPath = ToOnDiskRelativePath(suffixedRelPath, nameKey);
                        var suffixedPath = Path.Combine(libraryPath, suffixedOnDiskRelPath);
                        if (!File.Exists(suffixedPath))
                        {
                            try { _thumbnailService.DeleteThumbnail(libraryPath, asset.Id); } catch { }
                            if (TryMoveWithRetry(oldFilePath, suffixedPath))
                            {
                                asset.FileName = suffixedName;
                                asset.RelativePath = suffixedOnDiskRelPath;
                                found = true;
                                break;
                            }
                        }
                    }
                    if (!found)
                        return false;
                }
            }

            asset.Tags = tags;
            return true;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    /// <summary>
    /// Reorder tags so that categorized tags (with a type) come before uncategorized tags.
    /// Categorized tags are sorted by their type name, then by their value.
    /// Uncategorized tags maintain their original relative order.
    /// Returns the original list reference if already in order.
    /// </summary>
    private static List<AssetTag> NormalizeTags(IEnumerable<AssetTag>? tags)
    {
        return tags?
            .Where(t => !string.IsNullOrWhiteSpace(t.Value))
            .Select(t => new AssetTag { Type = t.Type, Value = t.Value.Trim() })
            .ToList() ?? new List<AssetTag>();
    }

    private static List<AssetTag> ReorderTags(List<AssetTag> tags, List<string>? categoryOrder = null)
    {
        // Build a lookup for category order indices
        Dictionary<string, int>? orderIndex = null;
        if (categoryOrder != null && categoryOrder.Count > 0)
        {
            orderIndex = categoryOrder
                .Select((name, idx) => (name, idx))
                .ToDictionary(x => x.name, x => x.idx, StringComparer.OrdinalIgnoreCase);
        }

        var categorized = tags.Where(t => t.Type != null)
            .OrderBy(t => orderIndex != null && orderIndex.TryGetValue(t.Type!, out var idx) ? idx : int.MaxValue)
            .ThenBy(t => t.Type, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.Value, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var uncategorized = tags.Where(t => t.Type == null).ToList();
        if (categorized.Count == 0 || uncategorized.Count == 0)
            return tags;

        // Check if already in order (all categorized before all uncategorized, sorted by type)
        bool alreadyOrdered = true;
        int catIdx = 0;
        foreach (var tag in tags)
        {
            if (tag.Type == null)
            {
                // All categorized should come before any uncategorized
                // Once we see an uncategorized, the rest must be uncategorized
                break;
            }
            else
            {
                // Check that this categorized tag matches the expected sorted order
                if (catIdx < categorized.Count &&
                    (!string.Equals(tag.Type, categorized[catIdx].Type, StringComparison.OrdinalIgnoreCase) ||
                     !string.Equals(tag.Value, categorized[catIdx].Value, StringComparison.OrdinalIgnoreCase)))
                {
                    alreadyOrdered = false;
                    break;
                }
                catIdx++;
            }
        }
        // Also verify no categorized tags appear after uncategorized
        if (alreadyOrdered)
        {
            bool seenUncategorized = false;
            foreach (var tag in tags)
            {
                if (tag.Type == null)
                    seenUncategorized = true;
                else if (seenUncategorized)
                {
                    alreadyOrdered = false;
                    break;
                }
            }
        }
        if (alreadyOrdered && catIdx == categorized.Count)
            return tags;

        var reordered = new List<AssetTag>(categorized.Count + uncategorized.Count);
        reordered.AddRange(categorized);
        reordered.AddRange(uncategorized);
        return reordered;
    }

    private static string BuildFileNameFromTags(List<AssetTag> tags, string extension)
    {
        var segments = new List<string>();
        foreach (var tag in tags)
        {
            var segment = tag.Type is not null ? $"[{tag.Type}]{tag.Value}" : tag.Value;
            segments.Add(segment);
        }
        return string.Join("-", segments) + extension;
    }

    /// <summary>
    /// Check if a filename differs from another only by a numeric disambiguation suffix
    /// (e.g., "tag-01.jpg" vs "tag.jpg" → true; "tag-other.jpg" vs "tag.jpg" → false)
    /// </summary>
    private static bool HasDisambiguationSuffix(string currentFileName, string baseFileName)
    {
        var currentWithoutExt = Path.GetFileNameWithoutExtension(currentFileName);
        var baseWithoutExt = Path.GetFileNameWithoutExtension(baseFileName);
        if (currentWithoutExt.Length <= baseWithoutExt.Length)
            return false;
        if (!currentWithoutExt.StartsWith(baseWithoutExt, StringComparison.OrdinalIgnoreCase))
            return false;
        var suffix = currentWithoutExt.Substring(baseWithoutExt.Length);
        return suffix.Length >= 3 && suffix[0] == '-' && suffix.Substring(1).All(char.IsDigit);
    }

    /// <summary>
    /// Attempt a File.Move with retries to handle transient locks from antivirus / search indexer.
    /// Retries up to <paramref name="maxRetries"/> times with a <paramref name="delayMs"/> pause between attempts.
    /// Returns true if the move succeeded.
    /// </summary>
    private static bool TryMoveWithRetry(string sourcePath, string destPath, int maxRetries = 5, int delayMs = 200)
    {
        for (int attempt = 0; attempt <= maxRetries; attempt++)
        {
            try
            {
                File.Move(sourcePath, destPath);
                return true;
            }
            catch (IOException) when (attempt < maxRetries)
            {
                // File locked by another process — wait and retry
                Thread.Sleep(delayMs);
            }
        }
        return false;
    }

    // ──────────────────────────────────────────────
    //  Search
    // ──────────────────────────────────────────────

    public async Task<PaginatedResponse<AssetDto>> SearchAsync(string query, int page, int pageSize, string? folder = null)
    {
        await EnsureScannedAsync();

        IEnumerable<Asset> results = _assets;

        // Filter by folder prefix if provided
        if (!string.IsNullOrEmpty(folder))
        {
            var folderPrefix = folder.Replace('\\', '/').TrimEnd('/') + "/";
            results = results.Where(a =>
                a.RelativePath.Replace('\\', '/').StartsWith(folderPrefix, StringComparison.OrdinalIgnoreCase));
        }

        // Parse query for tags: prefix
        var tagMatch = System.Text.RegularExpressions.Regex.Match(query, @"tags:(\S+)");
        if (tagMatch.Success)
        {
            var tagQuery = tagMatch.Groups[1].Value;
            var requiredTags = tagQuery.Split('+', StringSplitOptions.RemoveEmptyEntries)
                .Select(t => t.Trim())
                .Where(t => t.Length > 0)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            results = results.Where(a =>
                requiredTags.All(rt => a.Tags.Any(t =>
                    t.Value.Equals(rt, StringComparison.OrdinalIgnoreCase))));

            // Remove the tags: prefix from the query for further filename filtering
            query = query.Replace(tagMatch.Value, "").Trim();
        }

        // Plain text filename search
        if (!string.IsNullOrWhiteSpace(query))
        {
            var searchText = query;
            results = results.Where(a =>
                a.FileName.Contains(searchText, StringComparison.OrdinalIgnoreCase));
        }

        var allResults = results.OrderByDescending(a => a.ImportedAt).ToList();
        var total = allResults.Count;
        var paged = allResults
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(MapToDto)
            .ToList();

        return new PaginatedResponse<AssetDto>
        {
            Items = paged,
            Total = total,
            Page = page,
            PageSize = pageSize
        };
    }

    // ──────────────────────────────────────────────
    //  Upload
    // ──────────────────────────────────────────────

    private static readonly HashSet<string> AllowedUploadExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"
    };

    public async Task<UploadResult> UploadAssetsAsync(List<IFormFile> files, string targetDir, bool keepFilename = false, List<AssetTag>? tags = null)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null)
            throw new InvalidOperationException("Library not initialized.");

        await EnsureScannedAsync();

        var result = new UploadResult();
        var targetPath = Path.Combine(libraryPath, targetDir);
        Directory.CreateDirectory(targetPath);

        await _semaphore.WaitAsync();
        try
        {
            var nameKey = GetFileNameEncryptionKey();

            foreach (var file in files)
            {
                var ext = Path.GetExtension(file.FileName);
                if (!AllowedUploadExtensions.Contains(ext))
                {
                    result.Errors.Add(new UploadError
                    {
                        FileName = file.FileName,
                        Reason = $"Unsupported file type '{ext}'. Allowed: {string.Join(", ", AllowedUploadExtensions)}"
                    });
                    continue;
                }

                try
                {
                    string uploadFileName;

                    if (keepFilename)
                    {
                        // Keep original filename
                        uploadFileName = file.FileName;
                    }
                    else
                    {
                        // Clear filename — use only extension, e.g. ".jpg"
                        uploadFileName = ext;
                    }

                    var destFileName = uploadFileName;
                    var destPath = Path.Combine(targetPath, destFileName);
                    var counter = 1;

                    while (File.Exists(destPath))
                    {
                        if (keepFilename)
                        {
                            var nameWithoutExt = Path.GetFileNameWithoutExtension(uploadFileName);
                            destFileName = $"{nameWithoutExt}-{counter:D2}{ext}";
                        }
                        else
                        {
                            // e.g. "-1.jpg", "-2.jpg"
                            destFileName = $"-{counter:D2}{ext}";
                        }
                        destPath = Path.Combine(targetPath, destFileName);
                        counter++;
                    }

                    // Save file
                    await using (var stream = new FileStream(destPath, FileMode.Create))
                    {
                        await file.CopyToAsync(stream);
                    }

                    // Create asset entry
                    var relativePath = Path.GetRelativePath(libraryPath, destPath);
                    var (asset, wasEncrypted, _) = CreateAssetFromFile(destPath, relativePath);

                    // Only encrypt if the library is encrypted AND file is not already encrypted
                    byte[]? encryptionKey = null;
                    if (_libraryService.IsEncryptedLibrary() && !wasEncrypted)
                    {
                        encryptionKey = _libraryService.GetEncryptionKey();
                        if (encryptionKey is not null)
                        {
                            EncryptFileOnDisk(destPath, encryptionKey);
                        }
                    }

                    // File-name encryption: when the library encrypts names, rename the on-disk
                    // basename to its encrypted form (FileName stays plaintext; RelativePath points
                    // at the encrypted on-disk name).
                    if (nameKey is not null && _libraryService.IsEncryptedLibrary())
                    {
                        RenameOnDiskBasenameToEncrypted(libraryPath, destPath, asset, nameKey);
                        destPath = Path.Combine(libraryPath, asset.RelativePath);
                    }

                    _assets.Add(asset);
                    result.Added++;

                    // Apply batch tags if provided (and not keepFilename — tags replace the filename)
                    var normalizedTags = NormalizeTags(tags);
                    if (normalizedTags.Count > 0)
                    {
                        var categoryOrder = await _libraryService.GetCategoryOrderAsync();
                        var orderedTags = ReorderTags(normalizedTags, categoryOrder);
                        var newExt = Path.GetExtension(destPath);
                        var newName = BuildFileNameFromTags(orderedTags, newExt);
                        var oldDir = Path.GetDirectoryName(destPath) ?? "";
                        var newOnDiskFileName = ToOnDiskRelativePath(newName, nameKey);
                        var newPath = Path.Combine(oldDir, newOnDiskFileName);

                        if (!string.Equals(Path.GetFileName(destPath), newOnDiskFileName, StringComparison.OrdinalIgnoreCase))
                        {
                            if (!File.Exists(newPath))
                            {
                                _thumbnailService.DeleteThumbnail(libraryPath, asset.Id);
                                File.Move(destPath, newPath);
                                destPath = newPath;
                                var newRelativePath = Path.GetRelativePath(libraryPath, destPath);
                                asset.FileName = newName;
                                asset.RelativePath = newRelativePath;
                            }
                            else
                            {
                                // Collision: try numeric suffixes (plaintext level), encrypting each candidate
                                var baseWithoutExt = Path.GetFileNameWithoutExtension(newName);
                                for (int i = 1; i <= 999; i++)
                                {
                                    var suffixedName = $"{baseWithoutExt}-{i:D2}{newExt}";
                                    var suffixedOnDiskFileName = ToOnDiskRelativePath(suffixedName, nameKey);
                                    var suffixedPath = Path.Combine(oldDir, suffixedOnDiskFileName);
                                    if (!File.Exists(suffixedPath))
                                    {
                                        _thumbnailService.DeleteThumbnail(libraryPath, asset.Id);
                                        File.Move(destPath, suffixedPath);
                                        destPath = suffixedPath;
                                        var newRelativePath = Path.GetRelativePath(libraryPath, destPath);
                                        asset.FileName = suffixedName;
                                        asset.RelativePath = newRelativePath;
                                        break;
                                    }
                                }
                            }
                        }
                        asset.Tags = orderedTags;
                    }

                    // LAZY: Thumbnails generated on-demand when the frontend requests them.
                }
                catch (Exception ex)
                {
                    result.Errors.Add(new UploadError
                    {
                        FileName = file.FileName,
                        Reason = ex.Message
                    });
                }
            }
        }
        finally
        {
            _semaphore.Release();
        }

        // Update AssetCount in library.json
        await _libraryService.UpdateAssetCountAsync(_assets.Count);

        return result;
    }

    // ──────────────────────────────────────────────
    //  Move Asset
    // ──────────────────────────────────────────────

    public async Task<AssetDetailDto?> MoveAssetAsync(string id, string targetFolder)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return null;

        await EnsureScannedAsync();

        await _semaphore.WaitAsync();
        try
        {
            var asset = _assets.FirstOrDefault(a => a.Id == id);
            if (asset is null) return null;

            var oldRelativeDir = Path.GetDirectoryName(asset.RelativePath.Replace('\\', '/')) ?? "";
            var targetDir = string.IsNullOrEmpty(targetFolder) ? "" : targetFolder.Replace('\\', '/').Trim('/');

            // No-op if already in the target folder
            if (string.Equals(oldRelativeDir, targetDir, StringComparison.OrdinalIgnoreCase))
                return MapToDetailDto(asset);

            var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
            var fileName = Path.GetFileName(asset.RelativePath);

            // Determine new path
            var ext = Path.GetExtension(fileName);
            var nameWithoutExt = Path.GetFileNameWithoutExtension(fileName);
            var newRelativePath = string.IsNullOrEmpty(targetDir) ? fileName : targetDir.Replace('/', Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar + fileName;
            var newFilePath = Path.Combine(libraryPath, newRelativePath);

            // Handle name collision — use -1, -2, ... suffix
            var counter = 1;
            while (File.Exists(newFilePath))
            {
                var newFileName = $"{nameWithoutExt}-{counter:D2}{ext}";
                newRelativePath = string.IsNullOrEmpty(targetDir) ? newFileName : targetDir.Replace('/', Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar + newFileName;
                newFilePath = Path.Combine(libraryPath, newRelativePath);
                counter++;
            }

            // Ensure target directory exists
            var targetFullDir = Path.GetDirectoryName(newFilePath)!;
            if (!Directory.Exists(targetFullDir))
                Directory.CreateDirectory(targetFullDir);

            // Delete old thumbnail before moving
            _thumbnailService.DeleteThumbnail(libraryPath, asset.Id);

            // Move file on disk
            File.Move(oldFilePath, newFilePath);

            // Update asset metadata (under lock so ScanAsync doesn't interfere)
            var finalFileName = Path.GetFileName(newRelativePath);
            asset.RelativePath = newRelativePath;

            // Name-encrypted libraries keep FileName as the plaintext display name: the move only
            // changes the folder, so FileName must not be replaced by the (encrypted) on-disk name.
            if (GetFileNameEncryptionKey() is null)
            {
                asset.FileName = finalFileName;
            }

            return MapToDetailDto(asset);
        }
        finally
        {
            _semaphore.Release();
        }
    }

    // ──────────────────────────────────────────────
    //  Delete Asset
    // ──────────────────────────────────────────────

    public async Task<bool> DeleteAssetAsync(string id)
    {
        await EnsureScannedAsync();

        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return false;

        await _semaphore.WaitAsync();
        try
        {
            var asset = _assets.FirstOrDefault(a => a.Id == id);
            if (asset is null) return false;

            var sourcePath = Path.Combine(libraryPath, asset.RelativePath);

            // Delete the thumbnail (best effort)
            try
            {
                _thumbnailService.DeleteThumbnail(libraryPath, asset.Id);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to delete thumbnail for asset {AssetId}: {Path}", id, sourcePath);
            }

            // Delete the source file from disk
            if (File.Exists(sourcePath))
            {
                File.Delete(sourcePath);
            }

            // Remove from in-memory list
            _assets.Remove(asset);

            // Update asset count in library metadata
            await _libraryService.UpdateAssetCountAsync(_assets.Count);

            return true;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    // ──────────────────────────────────────────────
    //  File Paths & Thumbnails
    // ──────────────────────────────────────────────

    public string? GetAssetFilePath(string id)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return null;

        var asset = _assets.FirstOrDefault(a => a.Id == id);
        if (asset is null) return null;

        return Path.Combine(libraryPath, asset.RelativePath);
    }

    // ──────────────────────────────────────────────
    //  Clipboard Image
    // ──────────────────────────────────────────────

    public async Task<byte[]?> GetClipboardImageAsync(string id)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return null;

        var asset = await GetAssetAsync(id);
        if (asset is null) return null;

        var filePath = Path.Combine(libraryPath, asset.RelativePath);
        if (!File.Exists(filePath)) return null;

        try
        {
            var encryptionKey = _libraryService.GetEncryptionKey();

            // Decrypt the file if the library is encrypted
            SKCodec codec;
            if (encryptionKey is not null)
            {
                var decrypted = _encryptionService.ReadAndDecryptFile(filePath, encryptionKey);
                using var decryptedStream = new MemoryStream(decrypted);
                codec = SKCodec.Create(decryptedStream);
            }
            else
            {
                using var input = File.OpenRead(filePath);
                codec = SKCodec.Create(input);
            }

            if (codec is null) return null;

            var info = codec.Info;
            var maxDim = Math.Max(info.Width, info.Height);

            using var original = SKBitmap.Decode(codec);
            if (original is null) return null;

            SKBitmap? finalBitmap;
            if (maxDim > 2000)
            {
                float scale = 2000f / maxDim;
                int newWidth = Math.Max(1, (int)(info.Width * scale));
                int newHeight = Math.Max(1, (int)(info.Height * scale));
                finalBitmap = original.Resize(new SKSizeI(newWidth, newHeight), new SKSamplingOptions(SKFilterMode.Linear));
                if (finalBitmap is null) return null;
            }
            else
            {
                finalBitmap = original;
            }

            using var image = SKImage.FromBitmap(finalBitmap);
            using var data = image.Encode(SKEncodedImageFormat.Png, 100);
            var bytes = data.ToArray();

            if (finalBitmap != original)
                finalBitmap.Dispose();

            return bytes;
        }
        catch
        {
            return null;
        }
    }

    public async Task<string?> GetThumbnailPathAsync(string id)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null)
        {
            _logger.LogWarning("Thumbnail: library path is null for asset {Id}", id);
            return null;
        }

        var asset = await GetAssetAsync(id);
        if (asset is null)
        {
            _logger.LogWarning("Thumbnail: asset {Id} not found (in-memory assets: {Count})", id, _assets.Count);
            return null;
        }

        var sourcePath = Path.Combine(libraryPath, asset.RelativePath);
        if (!File.Exists(sourcePath))
        {
            _logger.LogWarning("Thumbnail: source file missing for asset {Id}: {Path}", id, sourcePath);
            return null;
        }

        var encryptionKey = _libraryService.GetEncryptionKey();

        // Palettes are intentionally NOT computed here: they are only computed on demand when the
        // asset detail (sidebar) is opened, so the gallery/waterfall path stays fast.
        var thumbPath = _thumbnailService.GetOrCreateThumbnail(libraryPath, sourcePath, asset.Id, encryptionKey);
        if (thumbPath is null)
            _logger.LogWarning("Thumbnail: generation failed for asset {Id} (source {Path}, key present: {Key})", id, sourcePath, encryptionKey is not null);
        return thumbPath;
    }

    // ──────────────────────────────────────────────
    //  Helpers
    // ──────────────────────────────────────────────

    /// <summary>
    /// Auto-convert untyped tags that have a matching typed tag elsewhere,
    /// reorder tags (categorized first), and rename files on disk.
    /// Returns a list of unresolved conflicts (values with multiple possible types).
    /// </summary>
    private async Task<List<TagConflict>> NormalizeTagsAsync()
    {
        var tagConflicts = new List<TagConflict>();

        // Build map: value_lowercase → set<type> from all assets
        var valueToTypes = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var asset in _assets)
        {
            foreach (var tag in asset.Tags)
            {
                if (tag.Type != null)
                {
                    if (!valueToTypes.ContainsKey(tag.Value))
                        valueToTypes[tag.Value] = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    valueToTypes[tag.Value].Add(tag.Type);
                }
            }
        }

        // Record conflicts for values with multiple possible types
        foreach (var kvp in valueToTypes)
        {
            if (kvp.Value.Count > 1)
            {
                tagConflicts.Add(new TagConflict
                {
                    TagValue = kvp.Key,
                    PossibleTypes = kvp.Value.OrderBy(t => t).ToList()
                });
            }
        }

        // Auto-convert untyped tags and reorder
        var libraryPathForRename = _libraryService.GetLibraryPath();
        var nameKey = GetFileNameEncryptionKey();
        foreach (var asset in _assets)
        {
            // Save original tags so we can revert if file rename fails
            var originalTags = asset.Tags.Select(t => new AssetTag { Type = t.Type, Value = t.Value }).ToList();

            for (int i = 0; i < asset.Tags.Count; i++)
            {
                var tag = asset.Tags[i];
                if (tag.Type != null) continue;
                if (!valueToTypes.TryGetValue(tag.Value, out var types)) continue;
                if (types.Count != 1) continue;

                // Auto-convert: exactly one possible type
                asset.Tags[i] = new AssetTag { Type = types.First(), Value = tag.Value };
            }

            // Reorder: categorized tags before uncategorized tags, sorted by type name
            var reordered = ReorderTags(asset.Tags);
            if (!ReferenceEquals(reordered, asset.Tags))
                asset.Tags = reordered;

            // Always try to persist the current tag order to the filename,
            // even if only the order changed (no type changes).
            // This ensures sorted tags are reflected on disk.
            if (libraryPathForRename != null)
            {
                var oldFilePath = Path.Combine(libraryPathForRename, asset.RelativePath);
                var oldExt = Path.GetExtension(asset.FileName);
                var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                var newRelativePath = string.IsNullOrEmpty(oldDir) ? newFileName : oldDir + Path.DirectorySeparatorChar + newFileName;
                var newOnDiskRelativePath = ToOnDiskRelativePath(newRelativePath, nameKey);
                var newFilePath = Path.Combine(libraryPathForRename, newOnDiskRelativePath);

                if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                {
                    // If current filename already has a disambiguation suffix, skip rename
                    if (HasDisambiguationSuffix(asset.FileName, newFileName))
                    {
                        // Skip rename — asset already has a disambiguation suffix
                    }
                    else if (!File.Exists(newFilePath))
                    {
                        // No collision, rename directly
                        try
                        {
                            _thumbnailService.DeleteThumbnail(libraryPathForRename, asset.Id);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex,
                                "[NormalizeTagsAsync] DeleteThumbnail failed for asset {AssetId}: {OldPath}. Continuing with rename.",
                                asset.Id, oldFilePath);
                        }
                        try
                        {
                            File.Move(oldFilePath, newFilePath);
                            _logger.LogInformation(
                                "[NormalizeTagsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {NewFile}",
                                asset.Id, asset.FileName, newFileName);
                            asset.FileName = newFileName;
                            asset.RelativePath = newOnDiskRelativePath;
                        }
                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                        {
                            _logger.LogError(ex,
                                "[NormalizeTagsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {NewPath}. Reverting tags.",
                                asset.Id, oldFilePath, newFilePath);
                            // Revert in-memory tags to match disk state
                            asset.Tags = originalTags;
                        }
                    }
                    else
                    {
                        // Collision: try numeric suffixes
                        var baseWithoutExt = Path.GetFileNameWithoutExtension(newFileName);
                        bool found = false;
                        for (int i = 1; i <= 999; i++)
                        {
                            var suffixedName = $"{baseWithoutExt}-{i:D2}{oldExt}";
                            var suffixedRelPath = string.IsNullOrEmpty(oldDir) ? suffixedName : oldDir + Path.DirectorySeparatorChar + suffixedName;
                            var suffixedOnDiskRelPath = ToOnDiskRelativePath(suffixedRelPath, nameKey);
                            var suffixedPath = Path.Combine(libraryPathForRename, suffixedOnDiskRelPath);
                            if (!File.Exists(suffixedPath))
                            {
                                try { _thumbnailService.DeleteThumbnail(libraryPathForRename, asset.Id); } catch { }
                                try
                                {
                                    File.Move(oldFilePath, suffixedPath);
                                    _logger.LogInformation(
                                        "[NormalizeTagsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {SuffixedName}",
                                        asset.Id, asset.FileName, suffixedName);
                                    asset.FileName = suffixedName;
                                    asset.RelativePath = suffixedOnDiskRelPath;
                                    found = true;
                                    break;
                                }
                                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                {
                                    _logger.LogError(ex,
                                        "[NormalizeTagsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {SuffixedPath}. Reverting tags.",
                                        asset.Id, oldFilePath, suffixedPath);
                                    break;
                                }
                            }
                        }
                        if (!found)
                        {
                            _logger.LogWarning(
                                "[NormalizeTagsAsync] Could not find unique suffixed name for asset {AssetId}: {NewPath}. Reverting tags.",
                                asset.Id, newFilePath);
                            // Could not find a unique name — revert in-memory tags to match disk
                            asset.Tags = originalTags;
                        }
                    }
                }
            }
        }

        return tagConflicts;
    }

    private async Task EnsureScannedAsync()
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return;

        var collectDir = Path.Combine(libraryPath, ".collect");

        if (_assets.Count == 0)
        {
            await ScanAsync();
            return;
        }

        // For encrypted libraries that are now unlocked, check if dimensions are stale
        // (e.g. scanned before unlock when the decryption key wasn't available).
        if (_libraryService.IsEncryptedLibrary())
        {
            var encryptionKey = _libraryService.GetEncryptionKey();
            if (encryptionKey is not null && _assets.Any(a => a.Width == 0 && a.Height == 0))
            {
                await ScanAsync();
                return;
            }
        }

        // Lightweight check: count image files on disk and compare with in-memory count.
        // This catches files added externally (e.g. manual copy) without a full scan every time.
        var diskCount = Directory.EnumerateFiles(libraryPath, "*.*", SearchOption.AllDirectories)
            .Count(f => !f.StartsWith(collectDir, StringComparison.OrdinalIgnoreCase)
                && ImageExtensions.Contains(Path.GetExtension(f)));
        if (diskCount != _assets.Count)
        {
            await ScanAsync();
        }
        // else: disk count matches, nothing to do
        // NormalizeTagsAsync is only called from ScanAsync to avoid infinite retry
        // loops when tag auto-conversion causes filename collisions on disk.
    }

    private AssetDto MapToDto(Asset asset)
    {
        var libraryId = _libraryService.GetLibraryId();
        var query = libraryId is not null ? $"?libraryId={libraryId}" : "";
        return new AssetDto
        {
            Id = asset.Id,
            FileName = asset.FileName,
            MimeType = asset.MimeType,
            FileSize = asset.FileSize,
            Width = asset.Width,
            Height = asset.Height,
            ThumbnailUrl = $"/api/assets/{asset.Id}/thumbnail{query}",
            ImportedAt = asset.ImportedAt,
            LastModified = asset.LastModified
        };
    }

    private AssetDetailDto MapToDetailDto(Asset asset)
    {
        // Lazily load palette from store if not already cached on the asset
        if (asset.Palette is null)
        {
            try
            {
                var libraryPath = _libraryService.GetLibraryPath();
                if (libraryPath is not null)
                {
                    var store = PalettesStore.Load(libraryPath);
                    if (store.Palettes.TryGetValue(asset.Id, out var cached))
                    {
                        asset.Palette = cached;
                    }
                }
            }
            catch
            {
                // Best-effort: if palette loading fails, continue without it
            }
        }

        var libraryId = _libraryService.GetLibraryId();
        var query = libraryId is not null ? $"?libraryId={libraryId}" : "";
        return new AssetDetailDto
        {
            Id = asset.Id,
            FileName = asset.FileName,
            RelativePath = asset.RelativePath,
            FileSize = asset.FileSize,
            Width = asset.Width,
            Height = asset.Height,
            MimeType = asset.MimeType,
            Tags = asset.Tags,
            ThumbnailUrl = $"/api/assets/{asset.Id}/thumbnail{query}",
            ImageUrl = $"/api/assets/{asset.Id}/image{query}",
            ImportedAt = asset.ImportedAt,
            LastModified = asset.LastModified,
            Palette = asset.Palette
        };
    }

    public async Task<List<TagConflict>> GetTagConflictsAsync()
    {
        await EnsureScannedAsync();

        // After normalization, check for any remaining conflicts
        var valueToTypes = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var asset in _assets)
        {
            foreach (var tag in asset.Tags)
            {
                if (tag.Type != null)
                {
                    if (!valueToTypes.ContainsKey(tag.Value))
                        valueToTypes[tag.Value] = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    valueToTypes[tag.Value].Add(tag.Type);
                }
            }
        }

        var conflicts = new List<TagConflict>();
        foreach (var kvp in valueToTypes)
        {
            if (kvp.Value.Count > 1)
            {
                conflicts.Add(new TagConflict
                {
                    TagValue = kvp.Key,
                    PossibleTypes = kvp.Value.OrderBy(t => t).ToList()
                });
            }
        }

        return conflicts;
    }

    public async Task<bool> ResolveTagConflictsAsync(List<TagConflictResolution> resolutions)
    {
        await _semaphore.WaitAsync();
        try
        {
            foreach (var resolution in resolutions)
            {
                foreach (var asset in _assets)
                {
                    // Save original tags to revert if rename fails
                    var originalTags = asset.Tags.Select(t => new AssetTag { Type = t.Type, Value = t.Value }).ToList();

                    bool tagsChanged = false;
                    for (int i = 0; i < asset.Tags.Count; i++)
                    {
                        var tag = asset.Tags[i];
                        // Update ALL tags with this value to the chosen type,
                        // regardless of whether they already have a type (or a different one)
                        if (!string.Equals(tag.Value, resolution.TagValue, StringComparison.OrdinalIgnoreCase))
                            continue;
                        if (string.Equals(tag.Type, resolution.ChosenType, StringComparison.OrdinalIgnoreCase))
                            continue; // already has the chosen type, skip

                        asset.Tags[i] = new AssetTag { Type = resolution.ChosenType, Value = tag.Value };
                        tagsChanged = true;
                    }

                    if (tagsChanged)
                    {
                        // Reorder: categorized tags before uncategorized tags
                        var reordered = ReorderTags(asset.Tags);
                        if (!ReferenceEquals(reordered, asset.Tags))
                            asset.Tags = reordered;

                        var libraryPath = _libraryService.GetLibraryPath();
                        if (libraryPath == null)
                        {
                            asset.Tags = originalTags;
                            continue;
                        }

                        var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                        var oldExt = Path.GetExtension(asset.FileName);
                        var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                        var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                        var newRelativePath = string.IsNullOrEmpty(oldDir)
                            ? newFileName
                            : oldDir + Path.DirectorySeparatorChar + newFileName;
                        var newFilePath = Path.Combine(libraryPath, newRelativePath);

                        if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                        {
                            // If current filename already has a disambiguation suffix, skip rename
                            if (HasDisambiguationSuffix(asset.FileName, newFileName))
                            {
                                // Skip rename — asset already has a disambiguation suffix
                            }
                            else if (!File.Exists(newFilePath))
                            {
                                // No collision, rename directly
                                try
                                {
                                    _thumbnailService.DeleteThumbnail(libraryPath, asset.Id);
                                }
                                catch (Exception ex)
                                {
                                    _logger.LogWarning(ex,
                                        "[ResolveTagConflictsAsync] DeleteThumbnail failed for asset {AssetId}: {OldPath}. Continuing with rename.",
                                        asset.Id, oldFilePath);
                                }
                                try
                                {
                                    File.Move(oldFilePath, newFilePath);
                                    _logger.LogInformation(
                                        "[ResolveTagConflictsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {NewFile}",
                                        asset.Id, asset.FileName, newFileName);
                                    asset.FileName = newFileName;
                                    asset.RelativePath = newRelativePath;
                                }
                                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                {
                                    _logger.LogError(ex,
                                        "[ResolveTagConflictsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {NewPath}. Reverting tags.",
                                        asset.Id, oldFilePath, newFilePath);
                                    // Revert in-memory tags to match disk state
                                    asset.Tags = originalTags;
                                }
                            }
                            else
                            {
                                // Collision: try numeric suffixes
                                var baseWithoutExt = Path.GetFileNameWithoutExtension(newFileName);
                                bool found = false;
                                for (int i = 1; i <= 999; i++)
                                {
                                    var suffixedName = $"{baseWithoutExt}-{i:D2}{oldExt}";
                                    var suffixedRelPath = string.IsNullOrEmpty(oldDir) ? suffixedName : oldDir + Path.DirectorySeparatorChar + suffixedName;
                                    var suffixedPath = Path.Combine(libraryPath, suffixedRelPath);
                                    if (!File.Exists(suffixedPath))
                                    {
                                        try { _thumbnailService.DeleteThumbnail(libraryPath, asset.Id); } catch { }
                                        try
                                        {
                                            File.Move(oldFilePath, suffixedPath);
                                            _logger.LogInformation(
                                                "[ResolveTagConflictsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {SuffixedName}",
                                                asset.Id, asset.FileName, suffixedName);
                                            asset.FileName = suffixedName;
                                            asset.RelativePath = suffixedRelPath;
                                            found = true;
                                            break;
                                        }
                                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                        {
                                            _logger.LogError(ex,
                                                "[ResolveTagConflictsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {SuffixedPath}. Reverting tags.",
                                                asset.Id, oldFilePath, suffixedPath);
                                            break;
                                        }
                                    }
                                }
                                if (!found)
                                {
                                    _logger.LogWarning(
                                        "[ResolveTagConflictsAsync] Could not find unique suffixed name for asset {AssetId}: {NewPath}. Reverting tags.",
                                        asset.Id, newFilePath);
                                    // Could not find a unique name — revert in-memory tags to match disk
                                    asset.Tags = originalTags;
                                }
                            }
                        }
                    }
                }
            }

            return true;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    public async Task<int> CategorizeTagsAsync(BatchCategorizeRequest request)
    {
        // Don't call EnsureScannedAsync() here — that would trigger NormalizeTagsAsync
        // which auto-converts tags and renames files. Then we'd run our own rename on top,
        // causing potential double-rename issues. Instead, scan directly if empty.
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return 0;

        if (_assets.Count == 0)
            await ScanAsync();

        var affectedAssetIds = new HashSet<string>();

        await _semaphore.WaitAsync();
        try
        {
            var nameKey = GetFileNameEncryptionKey();
            foreach (var change in request.Changes)
            {
                foreach (var asset in _assets)
                {
                    // Save original tags to revert if rename fails
                    var originalTags = asset.Tags.Select(t => new AssetTag { Type = t.Type, Value = t.Value }).ToList();

                    bool tagsChanged = false;
                    for (int i = 0; i < asset.Tags.Count; i++)
                    {
                        var tag = asset.Tags[i];
                        if (!string.Equals(tag.Value, change.TagValue, StringComparison.OrdinalIgnoreCase))
                            continue;
                        if (string.Equals(tag.Type, change.NewType, StringComparison.OrdinalIgnoreCase))
                            continue; // already has the target type, skip

                        asset.Tags[i] = new AssetTag { Type = change.NewType, Value = tag.Value };
                        tagsChanged = true;
                    }

                    if (tagsChanged)
                    {
                        affectedAssetIds.Add(asset.Id);

                        // Reorder: categorized tags before uncategorized tags
                        var reordered = ReorderTags(asset.Tags);
                        if (!ReferenceEquals(reordered, asset.Tags))
                            asset.Tags = reordered;

                        var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                        var oldExt = Path.GetExtension(asset.FileName);
                        var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                        var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                        var newRelativePath = string.IsNullOrEmpty(oldDir)
                            ? newFileName
                            : oldDir + Path.DirectorySeparatorChar + newFileName;
                        var newOnDiskRelativePath = ToOnDiskRelativePath(newRelativePath, nameKey);
                        var newFilePath = Path.Combine(libraryPath, newOnDiskRelativePath);

                        if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                        {
                            // If current filename already has a disambiguation suffix, skip rename
                            if (HasDisambiguationSuffix(asset.FileName, newFileName))
                            {
                                // Skip rename — asset already has a disambiguation suffix
                            }
                            else if (!File.Exists(newFilePath))
                            {
                                // No collision, rename directly
                                try
                                {
                                    _thumbnailService.DeleteThumbnail(libraryPath, asset.Id);
                                }
                                catch (Exception ex)
                                {
                                    _logger.LogWarning(ex,
                                        "[CategorizeTagsAsync] DeleteThumbnail failed for asset {AssetId}: {OldPath}. Continuing with rename.",
                                        asset.Id, oldFilePath);
                                }
                                try
                                {
                                    File.Move(oldFilePath, newFilePath);
                                    _logger.LogInformation(
                                        "[CategorizeTagsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {NewFile}",
                                        asset.Id, asset.FileName, newFileName);
                                    asset.FileName = newFileName;
                                    asset.RelativePath = newOnDiskRelativePath;
                                }
                                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                {
                                    _logger.LogError(ex,
                                        "[CategorizeTagsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {NewPath}. Reverting tags.",
                                        asset.Id, oldFilePath, newFilePath);
                                    // Revert in-memory tags to match disk state
                                    asset.Tags = originalTags;
                                }
                            }
                            else
                            {
                                // Collision: try numeric suffixes
                                var baseWithoutExt = Path.GetFileNameWithoutExtension(newFileName);
                                bool found = false;
                                for (int i = 1; i <= 999; i++)
                                {
                                    var suffixedName = $"{baseWithoutExt}-{i:D2}{oldExt}";
                                    var suffixedRelPath = string.IsNullOrEmpty(oldDir) ? suffixedName : oldDir + Path.DirectorySeparatorChar + suffixedName;
                                    var suffixedOnDiskRelPath = ToOnDiskRelativePath(suffixedRelPath, nameKey);
                                    var suffixedPath = Path.Combine(libraryPath, suffixedOnDiskRelPath);
                                    if (!File.Exists(suffixedPath))
                                    {
                                        try { _thumbnailService.DeleteThumbnail(libraryPath, asset.Id); } catch { }
                                        try
                                        {
                                            File.Move(oldFilePath, suffixedPath);
                                            _logger.LogInformation(
                                                "[CategorizeTagsAsync] Successfully renamed asset {AssetId}: {OldFile} -> {SuffixedName}",
                                                asset.Id, asset.FileName, suffixedName);
                                            asset.FileName = suffixedName;
                                            asset.RelativePath = suffixedOnDiskRelPath;
                                            found = true;
                                            break;
                                        }
                                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                        {
                                            _logger.LogError(ex,
                                                "[CategorizeTagsAsync] File.Move failed for asset {AssetId}: {OldPath} -> {SuffixedPath}. Reverting tags.",
                                                asset.Id, oldFilePath, suffixedPath);
                                            break;
                                        }
                                    }
                                }
                                if (!found)
                                {
                                    _logger.LogWarning(
                                        "[CategorizeTagsAsync] Could not find unique suffixed name for asset {AssetId}: {NewPath}. Reverting tags.",
                                        asset.Id, newFilePath);
                                    // Could not find a unique name — revert in-memory tags to match disk
                                    asset.Tags = originalTags;
                                }
                            }
                        }
                    }
                }
            }

            return affectedAssetIds.Count;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    // ──────────────────────────────────────────────
    //  Bulk Category / Tag Operations
    // ──────────────────────────────────────────────

    public async Task<bool> RenameCategoryAsync(string oldType, string newType)
    {
        await EnsureScannedAsync();

        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return false;

        var anyModified = false;

        await _semaphore.WaitAsync();
        try
        {
            var nameKey = GetFileNameEncryptionKey();
            foreach (var asset in _assets)
            {
                bool tagsChanged = false;
                for (int i = 0; i < asset.Tags.Count; i++)
                {
                    var tag = asset.Tags[i];
                    if (!string.Equals(tag.Type, oldType, StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (string.Equals(tag.Type, newType, StringComparison.OrdinalIgnoreCase))
                        continue;

                    asset.Tags[i] = new AssetTag { Type = newType, Value = tag.Value };
                    tagsChanged = true;
                }

                if (tagsChanged)
                {
                    anyModified = true;

                    var reordered = ReorderTags(asset.Tags);
                    if (!ReferenceEquals(reordered, asset.Tags))
                        asset.Tags = reordered;

                    var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                    var oldExt = Path.GetExtension(asset.FileName);
                    var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                    var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                    var newRelativePath = string.IsNullOrEmpty(oldDir)
                        ? newFileName
                        : oldDir + Path.DirectorySeparatorChar + newFileName;
                    var newOnDiskRelativePath = ToOnDiskRelativePath(newRelativePath, nameKey);
                    var newFilePath = Path.Combine(libraryPath, newOnDiskRelativePath);

                    if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                    {
                        if (!File.Exists(newFilePath))
                        {
                            _thumbnailService.DeleteThumbnail(libraryPath, asset.Id);
                            File.Move(oldFilePath, newFilePath);
                            asset.FileName = newFileName;
                            asset.RelativePath = newOnDiskRelativePath;
                        }
                    }
                }
            }

            // Update category order in library.json to reflect the rename
            var categoryOrder = await _libraryService.GetCategoryOrderAsync();
            if (categoryOrder is not null)
            {
                var updated = false;
                for (int i = 0; i < categoryOrder.Count; i++)
                {
                    if (string.Equals(categoryOrder[i], oldType, StringComparison.OrdinalIgnoreCase))
                    {
                        categoryOrder[i] = newType;
                        updated = true;
                    }
                }
                if (updated)
                {
                    await _libraryService.SetCategoryOrderAsync(categoryOrder);
                }
            }

            return anyModified;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    public async Task<bool> DeleteCategoryAsync(string type)
    {
        await EnsureScannedAsync();

        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return false;

        var anyModified = false;

        await _semaphore.WaitAsync();
        try
        {
            var nameKey = GetFileNameEncryptionKey();
            foreach (var asset in _assets)
            {
                bool tagsChanged = false;
                for (int i = 0; i < asset.Tags.Count; i++)
                {
                    var tag = asset.Tags[i];
                    if (!string.Equals(tag.Type, type, StringComparison.OrdinalIgnoreCase))
                        continue;

                    // Remove the type (set to null) but keep the value
                    asset.Tags[i] = new AssetTag { Type = null, Value = tag.Value };
                    tagsChanged = true;
                }

                if (tagsChanged)
                {
                    anyModified = true;

                    var reordered = ReorderTags(asset.Tags);
                    if (!ReferenceEquals(reordered, asset.Tags))
                        asset.Tags = reordered;

                    var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                    var oldExt = Path.GetExtension(asset.FileName);
                    var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                    var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                    var newRelativePath = string.IsNullOrEmpty(oldDir)
                        ? newFileName
                        : oldDir + Path.DirectorySeparatorChar + newFileName;
                    var newOnDiskRelativePath = ToOnDiskRelativePath(newRelativePath, nameKey);
                    var newFilePath = Path.Combine(libraryPath, newOnDiskRelativePath);

                    if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                    {
                        if (!File.Exists(newFilePath))
                        {
                            _thumbnailService.DeleteThumbnail(libraryPath, asset.Id);
                            File.Move(oldFilePath, newFilePath);
                            asset.FileName = newFileName;
                            asset.RelativePath = newOnDiskRelativePath;
                        }
                    }
                }
            }

            // Clean up category order in library.json to remove the deleted type
            var categoryOrder = await _libraryService.GetCategoryOrderAsync();
            if (categoryOrder is not null)
            {
                var removed = categoryOrder.RemoveAll(n => string.Equals(n, type, StringComparison.OrdinalIgnoreCase));
                if (removed > 0)
                {
                    await _libraryService.SetCategoryOrderAsync(categoryOrder);
                }
            }

            return anyModified;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    public async Task<bool> RenameTagValueAsync(string oldValue, string newValue)
    {
        await EnsureScannedAsync();

        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return false;

        var anyModified = false;

        await _semaphore.WaitAsync();
        try
        {
            var nameKey = GetFileNameEncryptionKey();
            foreach (var asset in _assets)
            {
                // Save original tags BEFORE modifying — needed to revert if file rename fails
                var originalTags = asset.Tags.Select(t => new AssetTag { Type = t.Type, Value = t.Value }).ToList();

                bool tagsChanged = false;
                for (int i = 0; i < asset.Tags.Count; i++)
                {
                    var tag = asset.Tags[i];
                    if (!string.Equals(tag.Value, oldValue, StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (string.Equals(tag.Value, newValue, StringComparison.OrdinalIgnoreCase))
                        continue;

                    asset.Tags[i] = new AssetTag { Type = tag.Type, Value = newValue };
                    tagsChanged = true;
                }

                if (tagsChanged)
                {
                    anyModified = true;

                    var reordered = ReorderTags(asset.Tags);
                    if (!ReferenceEquals(reordered, asset.Tags))
                        asset.Tags = reordered;

                    var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                    var oldExt = Path.GetExtension(asset.FileName);
                    var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                    var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                    var newRelativePath = string.IsNullOrEmpty(oldDir)
                        ? newFileName
                        : oldDir + Path.DirectorySeparatorChar + newFileName;
                    var newOnDiskRelativePath = ToOnDiskRelativePath(newRelativePath, nameKey);
                    var newFilePath = Path.Combine(libraryPath, newOnDiskRelativePath);

                    if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                    {
                        // If current filename already has a disambiguation suffix, skip rename
                        if (HasDisambiguationSuffix(asset.FileName, newFileName))
                        {
                            // Skip rename — asset already has a disambiguation suffix
                        }
                        else if (!File.Exists(newFilePath))
                        {
                            // No collision, rename directly
                            try
                            {
                                _thumbnailService.DeleteThumbnail(libraryPath, asset.Id);
                            }
                            catch (Exception ex)
                            {
                                _logger.LogWarning(ex,
                                    "[RenameTagValueAsync] DeleteThumbnail failed for asset {AssetId}: {OldPath}. Continuing with rename.",
                                    asset.Id, oldFilePath);
                            }
                            try
                            {
                                File.Move(oldFilePath, newFilePath);
                                _logger.LogInformation(
                                    "[RenameTagValueAsync] Successfully renamed asset {AssetId}: {OldFile} -> {NewFile}",
                                    asset.Id, asset.FileName, newFileName);
                                asset.FileName = newFileName;
                                asset.RelativePath = newOnDiskRelativePath;
                            }
                            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                            {
                                _logger.LogError(ex,
                                    "[RenameTagValueAsync] File.Move failed for asset {AssetId}: {OldPath} -> {NewPath}. Reverting tags.",
                                    asset.Id, oldFilePath, newFilePath);
                                // Revert in-memory tags to match disk state
                                asset.Tags = originalTags;
                            }
                        }
                        else
                        {
                            // Collision: try numeric suffixes
                            var baseWithoutExt = Path.GetFileNameWithoutExtension(newFileName);
                            bool found = false;
                            for (int i = 1; i <= 99; i++)
                            {
                                var suffixedName = $"{baseWithoutExt}-{i:D2}{oldExt}";
                                var suffixedRelPath = string.IsNullOrEmpty(oldDir) ? suffixedName : oldDir + Path.DirectorySeparatorChar + suffixedName;
                                var suffixedOnDiskRelPath = ToOnDiskRelativePath(suffixedRelPath, nameKey);
                                var suffixedPath = Path.Combine(libraryPath, suffixedOnDiskRelPath);
                                if (!File.Exists(suffixedPath))
                                {
                                    try { _thumbnailService.DeleteThumbnail(libraryPath, asset.Id); } catch { }
                                    try
                                    {
                                        File.Move(oldFilePath, suffixedPath);
                                        _logger.LogInformation(
                                            "[RenameTagValueAsync] Successfully renamed asset {AssetId}: {OldFile} -> {SuffixedName}",
                                            asset.Id, asset.FileName, suffixedName);
                                        asset.FileName = suffixedName;
                                        asset.RelativePath = suffixedOnDiskRelPath;
                                        found = true;
                                        break;
                                    }
                                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                    {
                                        _logger.LogError(ex,
                                            "[RenameTagValueAsync] File.Move failed for asset {AssetId}: {OldPath} -> {SuffixedPath}. Reverting tags.",
                                            asset.Id, oldFilePath, suffixedPath);
                                        break;
                                    }
                                }
                            }
                            if (!found)
                            {
                                _logger.LogWarning(
                                    "[RenameTagValueAsync] Could not find unique suffixed name for asset {AssetId}: {NewPath}. Reverting tags.",
                                    asset.Id, newFilePath);
                                // Could not find a unique name — revert in-memory tags to match disk
                                asset.Tags = originalTags;
                            }
                        }
                    }
                }
            }

            return anyModified;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    /// <summary>
    /// Decrypt all encrypted files in the current library and remove encryption metadata.
    /// Requires the library to be unlocked, or a password for repair decryption.
    /// When repairing a non-encrypted library, provide the original password.
    /// Returns the number of files decrypted.
    /// </summary>
    /// <summary>
    /// Encrypts every thumbnail in .collect/thumbnails with the library key so the whole library
    /// is consistently encrypted. Plaintext thumbnails are detected by magic bytes and encrypted;
    /// already-encrypted ones are skipped. Never throws — per-file failures are logged.
    /// </summary>
    private void EncryptAllThumbnails(string libraryPath, byte[] encryptionKey)
    {
        var thumbDir = Path.Combine(libraryPath, ".collect", "thumbnails");
        if (!Directory.Exists(thumbDir))
            return;

        foreach (var thumbFile in Directory.EnumerateFiles(thumbDir, "*.webp"))
        {
            try
            {
                var plaintext = File.ReadAllBytes(thumbFile);
                // Only encrypt plaintext thumbnails (known image magic present).
                if (ImageMimeDetector.Detect(plaintext) is null)
                    continue;

                var encrypted = _encryptionService.Encrypt(plaintext, encryptionKey);
                SafeFileIO.WriteAllBytesAtomic(thumbFile, encrypted, _logger);
                _logger.LogInformation("Encrypted thumbnail {Thumb}", thumbFile);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to encrypt thumbnail {Thumb}", thumbFile);
            }
        }
    }

    /// <summary>
    /// Decrypts every thumbnail in .collect/thumbnails back to plaintext so thumbnails keep
    /// working after the library is decrypted. Already-plaintext thumbnails are left as-is.
    /// Never throws — per-file failures are logged.
    /// </summary>
    private void DecryptAllThumbnails(string libraryPath, byte[] encryptionKey)
    {
        var thumbDir = Path.Combine(libraryPath, ".collect", "thumbnails");
        if (!Directory.Exists(thumbDir))
            return;

        foreach (var thumbFile in Directory.EnumerateFiles(thumbDir, "*.webp"))
        {
            try
            {
                var plaintext = _encryptionService.ReadAndDecryptFile(thumbFile, encryptionKey);
                SafeFileIO.WriteAllBytesAtomic(thumbFile, plaintext, _logger);
                _logger.LogInformation("Decrypted thumbnail {Thumb}", thumbFile);
            }
            catch (AuthenticationTagMismatchException)
            {
                // Already plaintext — nothing to do.
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to decrypt thumbnail {Thumb}", thumbFile);
            }
        }
    }

    public async Task<int> EncryptLibraryAsync(string password)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null)
            throw new InvalidOperationException("Library not initialized.");

        if (_libraryService.IsEncryptedLibrary())
            throw new InvalidOperationException("Library is already encrypted.");

        await EnsureScannedAsync();

        // Generate encryption key from password
        var (salt, verificationHash, encryptionKey) = _encryptionService.CreateKey(password);

        int encrypted = 0;

        await _semaphore.WaitAsync();
        try
        {
            // Destructive operation — refuse to run while another backend instance is mid-operation.
            using (CrossProcessLockHandle? crossProcessLock = TryAcquireCrossProcessLock(
                       TimeSpan.FromSeconds(5), throwIfUnavailable: true, "library encrypt"))
            {
                foreach (var asset in _assets)
                {
                    var filePath = Path.Combine(libraryPath, asset.RelativePath);
                    if (!File.Exists(filePath))
                        continue;

                    if (EncryptFileOnDisk(filePath, encryptionKey))
                        encrypted++;
                }

                // File-name encryption is always enabled: after content encryption, rename each
                // on-disk basename to its deterministic encrypted form. FileName stays plaintext;
                // RelativePath tracks the encrypted on-disk path.
                foreach (var asset in _assets)
                {
                    var filePath = Path.Combine(libraryPath, asset.RelativePath);
                    if (!File.Exists(filePath))
                        continue;

                    RenameOnDiskBasenameToEncrypted(libraryPath, filePath, asset, encryptionKey);
                }

                // Also encrypt all thumbnails so the whole library is consistently encrypted.
                EncryptAllThumbnails(libraryPath, encryptionKey);
            }

            // Update library.json with encryption metadata
            await _libraryService.UpdateLibraryInfoAsync(info =>
            {
                info.IsEncrypted = true;
                info.Salt = Convert.ToBase64String(salt);
                info.VerificationHash = Convert.ToBase64String(verificationHash);
                info.AssetCount = _assets.Count;
                info.EncryptFileNames = true;
            });

            // Update registry
            await _libraryService.UpdateAssetCountAsync(_assets.Count);
        }
        finally
        {
            _semaphore.Release();
        }

        _logger.LogInformation("EncryptLibrary: encrypted {Count} file(s)", encrypted);

        return encrypted;
    }

    public async Task<int> DecryptLibraryAsync(string? password = null)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null)
            throw new InvalidOperationException("Library not initialized.");

        var encryptionKey = _libraryService.GetEncryptionKey();

        // If no key available but we know some from this session, try each one
        if (encryptionKey is null)
        {
            var knownKeys = _libraryService.GetAllKnownKeys().ToList();

            // Try all known session keys first (no password needed — keys are raw)
            foreach (var candidateKey in knownKeys)
            {
                // Quick test: try to decrypt the first asset file
                var testAsset = _assets.FirstOrDefault();
                if (testAsset is not null)
                {
                    var testPath = Path.Combine(libraryPath, testAsset.RelativePath);
                    if (File.Exists(testPath))
                    {
                        try
                        {
                            var testData = _encryptionService.ReadAndDecryptFile(testPath, candidateKey);
                            if (testData.Length > 0)
                            {
                                encryptionKey = candidateKey;
                                _logger.LogInformation("Repair decrypt: found matching key from session history");
                                break;
                            }
                        }
                        catch { }
                    }
                }
            }

            // If password provided, try to derive from all known salts
            if (encryptionKey is null && !string.IsNullOrEmpty(password))
            {
                var libraries = await _libraryService.GetLibrariesAsync();
                foreach (var lib in libraries)
                {
                    if (!lib.IsEncrypted || string.IsNullOrEmpty(lib.Salt) || string.IsNullOrEmpty(lib.VerificationHash))
                        continue;

                    var salt = Convert.FromBase64String(lib.Salt);
                    var storedHash = Convert.FromBase64String(lib.VerificationHash);
                    var (valid, key) = _encryptionService.VerifyPassword(password, salt, storedHash);
                    if (valid && key is not null)
                    {
                        encryptionKey = key;
                        _logger.LogInformation("Repair decrypt: found matching key from library {LibraryName}", lib.Name);
                        break;
                    }
                }
            }
        }

        if (encryptionKey is null)
            throw new InvalidOperationException(
                "No encryption key available. If you have never set a password on an encrypted library, " +
                "please reopen the encrypted library first (the one that was open when files got encrypted), " +
                "then try decrypting this library again. The session key from that library will be used.");

        await EnsureScannedAsync();

        int decrypted = 0;
        int failed = 0;
        int skippedMismatch = 0;
        var failedPaths = new List<string>();

        await _semaphore.WaitAsync();
        try
        {
            // Destructive operation — refuse to run while another backend instance is mid-operation.
            using (CrossProcessLockHandle? crossProcessLock = TryAcquireCrossProcessLock(
                       TimeSpan.FromSeconds(5), throwIfUnavailable: true, "library decrypt"))
            {
                foreach (var asset in _assets)
                {
                    var filePath = Path.Combine(libraryPath, asset.RelativePath);
                    if (!File.Exists(filePath))
                        continue;

                    try
                    {
                        // Decrypt in memory first — the file is only touched after a successful decrypt.
                        var plaintext = _encryptionService.ReadAndDecryptFile(filePath, encryptionKey);

                        // Plaintext verification: never write empty decrypted bytes (corrupt ciphertext).
                        // A null magic is only a warning — some valid image formats are exotic and not in
                        // the detector, so they are still written.
                        if (plaintext.Length == 0)
                        {
                            failed++;
                            failedPaths.Add(filePath);
                            _logger.LogWarning("Decrypt: empty plaintext for {Path} — file left untouched", filePath);
                            continue;
                        }

                        if (ImageMimeDetector.Detect(plaintext) is null)
                        {
                            _logger.LogWarning(
                                "Decrypt: plaintext for {Path} does not match a known image format (magic={Magic}) — writing anyway",
                                filePath, ImageMimeDetector.MagicHex(plaintext));
                        }

                        SafeFileIO.WriteAllBytesAtomic(filePath, plaintext, _logger);
                        decrypted++;
                    }
                    catch (AuthenticationTagMismatchException)
                    {
                        // File is not encrypted with the current key — skip WITHOUT touching it.
                        skippedMismatch++;
                        _logger.LogWarning("Decrypt: tag mismatch for {Path} — not encrypted with the current key; left untouched", filePath);
                    }
                    catch (Exception ex)
                    {
                        // The atomic helper guarantees the original file is intact here.
                        failed++;
                        failedPaths.Add(filePath);
                        _logger.LogWarning(ex, "Decrypt failed for {Path} — original file left intact", filePath);
                    }
                }

                // File-name decryption: when the library was encrypting file names, restore the
                // plaintext basenames. FileName stays plaintext; RelativePath is updated to the
                // plaintext on-disk path.
                if (_libraryService.EncryptsFileNames())
                {
                    foreach (var asset in _assets)
                    {
                        var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                        if (!File.Exists(oldFilePath))
                            continue;

                        var onDiskBasename = Path.GetFileNameWithoutExtension(asset.RelativePath);
                        if (!_encryptionService.TryDecryptFileName(onDiskBasename, encryptionKey, out var plaintextBasename))
                        {
                            _logger.LogInformation(
                                "Decrypt: name of {Path} is already plaintext (not decryptable) — skipped",
                                oldFilePath);
                            continue;
                        }

                        var ext = Path.GetExtension(asset.RelativePath);
                        var plaintextName = plaintextBasename + ext;
                        var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                        var plaintextRelPath = string.IsNullOrEmpty(oldDir) ? plaintextName : oldDir + Path.DirectorySeparatorChar + plaintextName;
                        var plaintextFullPath = Path.Combine(libraryPath, plaintextRelPath);

                        if (string.Equals(Path.GetFileName(asset.RelativePath), plaintextName, StringComparison.OrdinalIgnoreCase))
                            continue;

                        if (File.Exists(plaintextFullPath))
                        {
                            // Collision — plaintext-level suffix fallback
                            var renamed = false;
                            for (int i = 1; i <= 999; i++)
                            {
                                var suffixedPlain = $"{plaintextBasename}-{i:D2}{ext}";
                                var suffixedRel = string.IsNullOrEmpty(oldDir) ? suffixedPlain : oldDir + Path.DirectorySeparatorChar + suffixedPlain;
                                if (File.Exists(Path.Combine(libraryPath, suffixedRel)))
                                    continue;

                                if (TryMoveWithRetry(oldFilePath, Path.Combine(libraryPath, suffixedRel)))
                                {
                                    asset.FileName = suffixedPlain;
                                    asset.RelativePath = suffixedRel;
                                    renamed = true;
                                    _logger.LogInformation(
                                        "Decrypt: restored plaintext name for asset {AssetId} (collision): {OnDisk} -> {Plain}",
                                        asset.Id, onDiskBasename, suffixedPlain);
                                    break;
                                }
                            }
                            if (!renamed)
                            {
                                _logger.LogWarning(
                                    "Decrypt: could not restore plaintext name for asset {AssetId} (no unique name) — keeping {Path}",
                                    asset.Id, oldFilePath);
                            }
                        }
                        else if (TryMoveWithRetry(oldFilePath, plaintextFullPath))
                        {
                            asset.FileName = plaintextName;
                            asset.RelativePath = plaintextRelPath;
                            _logger.LogInformation(
                                "Decrypt: restored plaintext name for asset {AssetId}: {OnDisk} -> {Plain}",
                                asset.Id, onDiskBasename, plaintextName);
                        }
                        else
                        {
                            _logger.LogWarning(
                                "Decrypt: failed to restore plaintext name for asset {AssetId} (move failed): {Path}",
                                asset.Id, oldFilePath);
                        }
                    }
                }

                // Also decrypt all thumbnails so they keep working after the library is decrypted.
                DecryptAllThumbnails(libraryPath, encryptionKey);
            }

            // Remove encryption metadata from library.json
            await _libraryService.UpdateLibraryInfoAsync(info =>
            {
                info.IsEncrypted = false;
                info.Salt = null;
                info.VerificationHash = null;
                info.EncryptFileNames = false;
                info.AssetCount = _assets.Count;
            });

            // Update registry to reflect decrypted status
            await _libraryService.UpdateAssetCountAsync(_assets.Count);

            // Clear the encryption key
            _libraryService.LockLibrary();
        }
        finally
        {
            _semaphore.Release();
        }

        if (failed > 0)
        {
            var sample = string.Join(", ", failedPaths.Take(5));
            _logger.LogError(
                "DecryptLibrary: {Failed} file(s) could not be decrypted ({Decrypted} decrypted, {Skipped} tag-mismatch skipped). First paths: {Paths}",
                failed, decrypted, skippedMismatch, sample);
        }
        else
        {
            _logger.LogInformation(
                "DecryptLibrary: decrypted {Decrypted} file(s); skipped {Skipped} (not encrypted with the current key)",
                decrypted, skippedMismatch);
        }

        return decrypted;
    }

    public async Task<bool> DeleteTagValueAsync(string value)
    {
        await EnsureScannedAsync();

        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return false;

        var anyModified = false;

        await _semaphore.WaitAsync();
        try
        {
            var nameKey = GetFileNameEncryptionKey();
            foreach (var asset in _assets)
            {
                // Save original tags BEFORE modifying — needed to revert if file rename fails
                var originalTags = asset.Tags.Select(t => new AssetTag { Type = t.Type, Value = t.Value }).ToList();

                bool tagsChanged = false;
                for (int i = asset.Tags.Count - 1; i >= 0; i--)
                {
                    var tag = asset.Tags[i];
                    if (!string.Equals(tag.Value, value, StringComparison.OrdinalIgnoreCase))
                        continue;

                    asset.Tags.RemoveAt(i);
                    tagsChanged = true;
                }

                if (tagsChanged)
                {
                    anyModified = true;

                    var reordered = ReorderTags(asset.Tags);
                    if (!ReferenceEquals(reordered, asset.Tags))
                        asset.Tags = reordered;

                    var oldFilePath = Path.Combine(libraryPath, asset.RelativePath);
                    var oldExt = Path.GetExtension(asset.FileName);
                    var newFileName = BuildFileNameFromTags(asset.Tags, oldExt);
                    var oldDir = Path.GetDirectoryName(asset.RelativePath) ?? "";
                    var newRelativePath = string.IsNullOrEmpty(oldDir)
                        ? newFileName
                        : oldDir + Path.DirectorySeparatorChar + newFileName;
                    var newOnDiskRelativePath = ToOnDiskRelativePath(newRelativePath, nameKey);
                    var newFilePath = Path.Combine(libraryPath, newOnDiskRelativePath);

                    if (!string.Equals(asset.FileName, newFileName, StringComparison.OrdinalIgnoreCase))
                    {
                        // If current filename already has a disambiguation suffix, skip rename
                        if (HasDisambiguationSuffix(asset.FileName, newFileName))
                        {
                            // Skip rename — asset already has a disambiguation suffix
                        }
                        else if (!File.Exists(newFilePath))
                        {
                            // No collision, rename directly
                            try
                            {
                                _thumbnailService.DeleteThumbnail(libraryPath, asset.Id);
                            }
                            catch (Exception ex)
                            {
                                _logger.LogWarning(ex,
                                    "[DeleteTagValueAsync] DeleteThumbnail failed for asset {AssetId}: {OldPath}. Continuing with rename.",
                                    asset.Id, oldFilePath);
                            }
                            try
                            {
                                File.Move(oldFilePath, newFilePath);
                                _logger.LogInformation(
                                    "[DeleteTagValueAsync] Successfully renamed asset {AssetId}: {OldFile} -> {NewFile}",
                                    asset.Id, asset.FileName, newFileName);
                                asset.FileName = newFileName;
                                asset.RelativePath = newOnDiskRelativePath;
                            }
                            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                            {
                                _logger.LogError(ex,
                                    "[DeleteTagValueAsync] File.Move failed for asset {AssetId}: {OldPath} -> {NewPath}. Reverting tags.",
                                    asset.Id, oldFilePath, newFilePath);
                                // Revert in-memory tags to match disk state
                                asset.Tags = originalTags;
                            }
                        }
                        else
                        {
                            // Collision: try numeric suffixes
                            var baseWithoutExt = Path.GetFileNameWithoutExtension(newFileName);
                            bool found = false;
                            for (int i = 1; i <= 99; i++)
                            {
                                var suffixedName = $"{baseWithoutExt}-{i:D2}{oldExt}";
                                var suffixedRelPath = string.IsNullOrEmpty(oldDir) ? suffixedName : oldDir + Path.DirectorySeparatorChar + suffixedName;
                                var suffixedOnDiskRelPath = ToOnDiskRelativePath(suffixedRelPath, nameKey);
                                var suffixedPath = Path.Combine(libraryPath, suffixedOnDiskRelPath);
                                if (!File.Exists(suffixedPath))
                                {
                                    try { _thumbnailService.DeleteThumbnail(libraryPath, asset.Id); } catch { }
                                    try
                                    {
                                        File.Move(oldFilePath, suffixedPath);
                                        _logger.LogInformation(
                                            "[DeleteTagValueAsync] Successfully renamed asset {AssetId}: {OldFile} -> {SuffixedName}",
                                            asset.Id, asset.FileName, suffixedName);
                                        asset.FileName = suffixedName;
                                        asset.RelativePath = suffixedOnDiskRelPath;
                                        found = true;
                                        break;
                                    }
                                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                                    {
                                        _logger.LogError(ex,
                                            "[DeleteTagValueAsync] File.Move failed for asset {AssetId}: {OldPath} -> {SuffixedPath}. Reverting tags.",
                                            asset.Id, oldFilePath, suffixedPath);
                                        break;
                                    }
                                }
                            }
                            if (!found)
                            {
                                _logger.LogWarning(
                                    "[DeleteTagValueAsync] Could not find unique suffixed name for asset {AssetId}: {NewPath}. Reverting tags.",
                                    asset.Id, newFilePath);
                                // Could not find a unique name — revert in-memory tags to match disk
                                asset.Tags = originalTags;
                            }
                        }
                    }
                }
            }

            return anyModified;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    private static string GetMimeType(string filePath)
    {
        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        return ext switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".gif" => "image/gif",
            ".bmp" => "image/bmp",
            ".webp" => "image/webp",
            ".tiff" or ".tif" => "image/tiff",
            _ => "application/octet-stream"
        };
    }

    // ──────────────────────────────────────────────
    //  Color Palette
    // ──────────────────────────────────────────────

    /// <summary>
    /// Get the cached color palette for an asset. Palettes are computed during thumbnail
    /// generation and stored in .collect/palettes.json. If no cached palette exists
    /// (e.g. for assets that already had thumbnails before this feature was added),
    /// computes it on demand from the original image resized consistently with
    /// the thumbnail generation pipeline (ScalePixels, not mipmap Resize).
    /// Returns null if the asset is not found.
    /// </summary>
    public async Task<ColorPalette?> ComputePaletteAsync(string id)
    {
        var libraryPath = _libraryService.GetLibraryPath();
        if (libraryPath is null) return null;

        var asset = await GetAssetAsync(id);
        if (asset is null) return null;

        // Return cached palette if already in memory
        if (asset.Palette is not null)
            return asset.Palette;

        var store = PalettesStore.Load(libraryPath);
        if (store.Palettes.TryGetValue(id, out var existing))
        {
            asset.Palette = existing;
            return existing;
        }

        // Not in store — compute from the original image by resizing it to
        // thumbnail dimensions using ScalePixels (consistent with thumbnail gen).
        // This avoids WebP lossy decode artifacts that can skew K-means results.
        try
        {
            var sourcePath = Path.Combine(libraryPath, asset.RelativePath);
            if (!File.Exists(sourcePath)) return null;

            var encryptionKey = _libraryService.GetEncryptionKey();
            SKBitmap bitmap;

            if (encryptionKey is not null)
            {
                var decrypted = _encryptionService.ReadAndDecryptFile(sourcePath, encryptionKey);
                using var decryptedStream = new MemoryStream(decrypted);
                bitmap = SKBitmap.Decode(decryptedStream);
            }
            else
            {
                bitmap = SKBitmap.Decode(sourcePath);
            }

            if (bitmap is null) return null;

            using (bitmap)
            {
                // Resize to thumbnail dimensions using same method as GenerateAndSaveThumbnail
                int thumbWidth = Math.Min(400, bitmap.Width);
                int thumbHeight = (int)((double)thumbWidth / bitmap.Width * bitmap.Height);

                using var resized = new SKBitmap(thumbWidth, thumbHeight);
                bitmap.ScalePixels(resized, SKSamplingOptions.Default);

                var palette = ColorPaletteHelper.ComputeFromBitmap(resized);
                if (palette is null) return null;

                store.Palettes[id] = palette;
                store.Save(libraryPath);
                asset.Palette = palette;
                return palette;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to compute color palette for asset {AssetId}", id);
            return null;
        }
    }

    /// <summary>
    /// Invalidate the in-memory asset cache so the next fetch triggers a fresh scan.
    /// Used after unlocking an encrypted library to re-extract dimensions with the decryption key.
    /// </summary>
    public void InvalidateCache()
    {
        _assets = new List<Asset>();
    }
}
