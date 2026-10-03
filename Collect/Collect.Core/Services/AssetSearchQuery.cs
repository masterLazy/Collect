using System.Globalization;
using System.Text.RegularExpressions;

namespace Collect.Core.Services;

/// <summary>Comparison used by a numeric filter.</summary>
public enum NumericOperator
{
    /// <summary><c>&gt;=</c> — at least the given value.</summary>
    AtLeast,

    /// <summary><c>&lt;=</c> — at most the given value.</summary>
    AtMost,

    /// <summary><c>~</c> — within ±10% of the given value.</summary>
    About,
}

/// <summary>Asset property a numeric filter applies to.</summary>
public enum NumericTarget
{
    Boost,
    Size,
    Width,
    Height,
    Ratio,
}

/// <summary>One numeric constraint, e.g. <c>width&gt;=1920</c>.</summary>
public sealed record NumericFilter(NumericTarget Target, NumericOperator Operator, double Value);

/// <summary>
/// A tag an asset must (or must not) carry. <see cref="Type"/> is set when the
/// query scoped the tag with a <c>[type]</c> prefix, e.g. <c>tags:[画师]name</c>.
/// </summary>
public sealed record TagFilter(string? Type, string Value);

/// <summary>
/// A parsed search query. Every clause is AND-ed together:
/// <list type="bullet">
/// <item><c>tags:a+b</c> — needs all of a and b</item>
/// <item><c>withoutTags:x</c> — must not carry x</item>
/// <item><c>type:png,webp</c> — any of the given file types</item>
/// <item><c>size&gt;=1MB</c>, <c>width~1920</c>, <c>boost&gt;=3</c>, <c>ratio&gt;1</c></item>
/// <item>bare words — file name substrings; <c>"two words"</c> — a verbatim phrase</item>
/// </list>
/// </summary>
public sealed class AssetSearchQuery
{
    public List<TagFilter> Tags { get; } = new();

    public List<TagFilter> WithoutTags { get; } = new();

    public List<NumericFilter> NumericFilters { get; } = new();

    public List<string> FileTypes { get; } = new();

    public List<string> Words { get; } = new();

    public List<string> Phrases { get; } = new();

    /// <summary>
    /// Tokens that named a real filter but carried a value we could not understand.
    /// They are demoted to plain file-name searches; the search box parses the
    /// query itself to warn about them, so this is mostly useful for logging.
    /// </summary>
    public List<string> InvalidTokens { get; } = new();

    public bool IsEmpty =>
        Tags.Count == 0 && WithoutTags.Count == 0 && NumericFilters.Count == 0 &&
        FileTypes.Count == 0 && Words.Count == 0 && Phrases.Count == 0;
}

/// <summary>
/// Parses the search box syntax. Kept deliberately small: a query is a list of
/// whitespace separated tokens, and a token only becomes a filter when it names
/// a known field and is followed by a valid separator and value. An unfinished
/// token (<c>width&gt;=</c>) does not restrict anything; a token with an
/// unparsable value falls back to a file-name search, and anything else stays
/// plain text, so a query never fails the request.
/// </summary>
public static class AssetSearchQueryParser
{
    /// <summary>Relative tolerance applied by the <c>~</c> operator.</summary>
    public const double ApproximateTolerance = 0.10;

    /// <summary>Splits into words, keeping <c>"quoted phrases"</c> together.</summary>
    private static readonly Regex TokenPattern = new(
        "\"(?<quoted>[^\"]*)\"|(?<word>\\S+)", RegexOptions.Compiled);

    /// <summary><c>field</c> + separator (<c>:</c>, <c>&gt;=</c>, <c>&lt;=</c>, <c>~</c>) + value.</summary>
    private static readonly Regex TermPattern = new(
        @"^(?<name>[A-Za-z]+)(?<sep>:|>=|<=|~)(?<value>.*)$", RegexOptions.Compiled);

    /// <summary>An optional <c>[type]</c> prefix on a tag value.</summary>
    private static readonly Regex TypedTagPattern = new(
        @"^\[(?<type>[^\]]+)\](?<value>.+)$", RegexOptions.Compiled);

    /// <summary>Number plus an optional unit: <c>1.5MB</c>, <c>1920px</c>, <c>420</c>.</summary>
    private static readonly Regex NumberPattern = new(
        @"^(?<number>\d+(?:\.\d+)?)(?<unit>[A-Za-z]*)$", RegexOptions.Compiled);

    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif",
    };

    public static AssetSearchQuery Parse(string? raw)
    {
        var query = new AssetSearchQuery();
        if (string.IsNullOrWhiteSpace(raw)) return query;

        foreach (Match token in TokenPattern.Matches(raw))
        {
            if (token.Groups["quoted"].Success)
            {
                var phrase = token.Groups["quoted"].Value.Trim();
                if (phrase.Length > 0) query.Phrases.Add(phrase);
                continue;
            }

            AddWord(query, token.Groups["word"].Value);
        }

        return query;
    }

    private static void AddWord(AssetSearchQuery query, string word)
    {
        var term = TermPattern.Match(word);

        // No separator, or a separator without a field name: plain text.
        if (!term.Success)
        {
            query.Words.Add(word);
            return;
        }

        var name = term.Groups["name"].Value;
        var sep = term.Groups["sep"].Value;
        var value = term.Groups["value"].Value.Trim();

        switch (name.ToLowerInvariant())
        {
            case "tags" or "tag":
                AddTagClause(query, word, sep, value, exclude: false);
                return;

            case "withouttags" or "withouttag" or "notags" or "notag":
                AddTagClause(query, word, sep, value, exclude: true);
                return;

            case "type" or "ext" or "format":
                if (sep != ":")
                {
                    Unparsable(query, word);
                    return;
                }
                foreach (var part in value.Split(',', StringSplitOptions.RemoveEmptyEntries))
                {
                    var type = part.Trim().TrimStart('.').ToLowerInvariant();
                    if (type.Length > 0) query.FileTypes.Add(type);
                }
                if (query.FileTypes.Count == 0 && value.Length > 0) Unparsable(query, word);
                return;

            case "boost" or "boosts":
                AddNumericClause(query, word, sep, value, NumericTarget.Boost);
                return;

            case "size" or "filesize":
                AddNumericClause(query, word, sep, value, NumericTarget.Size);
                return;

            case "width":
                AddNumericClause(query, word, sep, value, NumericTarget.Width);
                return;

            case "height":
                AddNumericClause(query, word, sep, value, NumericTarget.Height);
                return;

            case "ratio" or "aspect":
                AddNumericClause(query, word, sep, value, NumericTarget.Ratio);
                return;

            default:
                // Unknown qualifier — falls back to a file-name search.
                query.Words.Add(word);
                return;
        }
    }

    private static void AddTagClause(AssetSearchQuery query, string word, string sep, string value, bool exclude)
    {
        if (sep != ":")
        {
            Unparsable(query, word);
            return;
        }

        // An empty value means the user is still typing — no clause yet, and no
        // error either: the query simply stays unrestricted by this field.
        var added = 0;
        foreach (var part in value.Split('+', StringSplitOptions.RemoveEmptyEntries))
        {
            var (negated, text) = SplitNegation(part);
            if (text.Length == 0) continue;

            string? type = null;
            var typed = TypedTagPattern.Match(text);
            if (typed.Success)
            {
                type = typed.Groups["type"].Value.Trim();
                text = typed.Groups["value"].Value.Trim();
                if (type.Length == 0) type = null;
            }

            if (text.Length == 0) continue;

            // A leading '-' inside tags: means "without this tag".
            var target = exclude || negated ? query.WithoutTags : query.Tags;
            target.Add(new TagFilter(type, text));
            added++;
        }

        if (added == 0 && value.Length > 0) Unparsable(query, word);
    }

    private static void AddNumericClause(AssetSearchQuery query, string word, string sep, string value, NumericTarget target)
    {
        var op = sep switch
        {
            ">=" => NumericOperator.AtLeast,
            "<=" => NumericOperator.AtMost,
            "~" => NumericOperator.About,
            _ => (NumericOperator?)null,
        };

        if (op is null)
        {
            Unparsable(query, word);
            return;
        }

        // Empty value: still typing, so the field does not restrict anything yet.
        if (value.Length == 0) return;

        var match = NumberPattern.Match(value);
        if (!match.Success || !TryGetUnitMultiplier(target, match.Groups["unit"].Value, out var multiplier))
        {
            Unparsable(query, word);
            return;
        }

        var number = double.Parse(match.Groups["number"].Value, CultureInfo.InvariantCulture);
        query.NumericFilters.Add(new NumericFilter(target, op.Value, number * multiplier));
    }

    /// <summary>
    /// A filter that named a real field but carries a value we cannot understand.
    /// It is recorded for the caller and demoted to a file-name search, so a typo
    /// narrows the results to nothing instead of quietly showing the whole library.
    /// </summary>
    private static void Unparsable(AssetSearchQuery query, string word)
    {
        query.InvalidTokens.Add(word);
        query.Words.Add(word);
    }

    private static (bool Negated, string Text) SplitNegation(string part)
    {
        var text = part.Trim();
        if (text.StartsWith('-'))
        {
            return (true, text[1..].Trim());
        }
        return (false, text);
    }

    /// <summary>Bytes per unit for <c>size</c>, pixels per unit for width/height.</summary>
    private static bool TryGetUnitMultiplier(NumericTarget target, string unit, out double multiplier)
    {
        multiplier = 1;
        var u = unit.ToLowerInvariant();

        switch (target)
        {
            case NumericTarget.Size:
                return u switch
                {
                    "" or "b" => Assign(1, out multiplier),
                    "k" or "kb" or "kib" => Assign(1024, out multiplier),
                    "m" or "mb" or "mib" => Assign(1024 * 1024, out multiplier),
                    "g" or "gb" or "gib" => Assign(1024d * 1024 * 1024, out multiplier),
                    _ => false,
                };

            case NumericTarget.Width:
            case NumericTarget.Height:
                return u switch
                {
                    "" or "px" => Assign(1, out multiplier),
                    _ => false,
                };

            default:
                // boost and ratio are plain numbers.
                return u.Length == 0;
        }
    }

    private static bool Assign(double value, out double multiplier)
    {
        multiplier = value;
        return true;
    }

    /// <summary>True when <paramref name="fileName"/> has the requested file type.</summary>
    public static bool MatchesFileType(string fileName, string type)
    {
        if (type == "image")
        {
            return ImageExtensions.Any(ext => fileName.EndsWith("." + ext, StringComparison.OrdinalIgnoreCase));
        }

        // jpeg/tif are the long spellings of jpg/tiff: treat them as one type.
        var extensions = type switch
        {
            "jpg" => new[] { "jpg", "jpeg" },
            "jpeg" => new[] { "jpg", "jpeg" },
            "tiff" => new[] { "tiff", "tif" },
            "tif" => new[] { "tiff", "tif" },
            _ => new[] { type },
        };

        return extensions.Any(ext => fileName.EndsWith("." + ext, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Compares an asset's value against one numeric filter.</summary>
    public static bool MatchesNumeric(NumericFilter filter, double actual) => filter.Operator switch
    {
        NumericOperator.AtLeast => actual >= filter.Value,
        NumericOperator.AtMost => actual <= filter.Value,
        NumericOperator.About => filter.Value == 0
            ? actual == 0
            : Math.Abs(actual - filter.Value) <= filter.Value * ApproximateTolerance,
        _ => true,
    };
}
