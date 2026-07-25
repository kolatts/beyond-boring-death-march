using System.Text;
using BeyondBoring.DeathMarch.Functions.Models;

namespace BeyondBoring.DeathMarch.Functions.Services;

public static class Validation
{
    public const int MaxBodyBytes = 4096;

    private static readonly HashSet<string> KnownRoles = new(StringComparer.OrdinalIgnoreCase)
    {
        "VP of Adjacent Concerns",
        "Staff Engineer",
        "Contractor, 6-Week Statement of Work",
        // Short forms the client may send.
        "VP",
        "Contractor",
    };

    // Unambiguous strings: rejected wherever they appear, leetspeak included.
    private static readonly string[] SubstringDenylist =
    {
        "fuck", "shit", "cunt", "bitch", "asshole", "dickhead", "wanker",
        "nigger", "nigga", "faggot", "retard", "whore", "slut", "bastard",
        "jackass", "dumbass", "pussy", "bollocks", "twat", "goddamn",
        "blowjob", "handjob", "cumshot", "jizz", "hitler", "swastika",
        "rapist", "pedophile", "paedophile", "molest",
    };

    // Ambiguous short words: rejected only as whole words (class != ass).
    private static readonly HashSet<string> WordDenylist = new(StringComparer.OrdinalIgnoreCase)
    {
        "ass", "cock", "dick", "tit", "tits", "cum", "rape", "nazi", "fag",
        "penis", "vagina", "anus", "sex",
    };

    public static string? ValidateDeath(DeathModel body)
    {
        if (Text("name", body.Name, 1, 24) is { } nameError) return nameError;
        if (Text("cause", body.Cause, 1, 90) is { } causeError) return causeError;
        if (Text("epitaph", body.Epitaph, 0, 120) is { } epitaphError) return epitaphError;
        if (Role(body.Role) is { } roleError) return roleError;
        if (body.Mile is not (>= 0 and <= 2000))
            return "mile must be an integer between 0 and 2000. The trail is long, but it is not that long.";
        if (body.Days is not (> 0 and <= 100000))
            return "days must be a positive integer. Nobody dies before day one. Many have tried.";
        return null;
    }

    public static string? ValidateScore(ScoreModel body)
    {
        if (Text("name", body.Name, 1, 24) is { } nameError) return nameError;
        if (Role(body.Role) is { } roleError) return roleError;
        if (body.Score is not (>= -10_000_000_000L and <= 10_000_000_000L))
            return "score is missing or implausible. The retrospective requires a number.";
        if (body.Days is not (> 0 and <= 100000))
            return "days must be a positive integer. Even the fastest death march takes a day.";
        if (body.Miles is not (>= 0 and <= 2000))
            return "miles must be an integer between 0 and 2000.";
        if (body.DeadlinesMet is not (>= 0 and <= 1000))
            return "deadlinesMet must be an integer between 0 and 1000.";
        if (body.DeadlinesMissed is not (>= 0 and <= 1000))
            return "deadlinesMissed must be an integer between 0 and 1000.";
        if (body.BusinessDeadlineMet is null)
            return "businessDeadlineMet is required. Leadership will want to know. There will be a slide.";
        return null;
    }

    private static string? Text(string field, string? value, int minLength, int maxLength)
    {
        value ??= "";
        if (value.Length < minLength)
            return $"{field} is required. Anonymity is not offered on this trail.";
        if (value.Length > maxLength)
            return $"{field} exceeds {maxLength} characters. Even in death there is a character limit.";
        if (!IsPrintableAscii(value))
            return $"{field} contains characters outside printable ASCII. The terminal was standardized in 1963. Comply.";
        if (ContainsProfanity(value))
            return $"{field} was rejected by the content review board. The board does not explain itself.";
        return null;
    }

    private static string? Role(string? role) =>
        role is not null && KnownRoles.Contains(role.Trim())
            ? null
            : "role is not a recognized position at this organization. HR has no record of you.";

    private static bool IsPrintableAscii(string value) =>
        value.All(c => c >= 0x20 && c <= 0x7E);

    public static bool ContainsProfanity(string value)
    {
        var normalized = Normalize(value);
        if (SubstringDenylist.Any(normalized.Contains))
        {
            return true;
        }

        var words = normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return words.Any(WordDenylist.Contains);
    }

    /// <summary>Lowercases, maps common leetspeak, and collapses non-letters to spaces.</summary>
    private static string Normalize(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var raw in value.ToLowerInvariant())
        {
            var c = raw switch
            {
                '0' => 'o',
                '1' => 'i',
                '3' => 'e',
                '4' => 'a',
                '5' => 's',
                '7' => 't',
                '@' => 'a',
                '$' => 's',
                '!' => 'i',
                _ => raw,
            };
            builder.Append(char.IsAsciiLetter(c) ? c : ' ');
        }

        // Also produce a squashed variant check target: keep spaces for word checks,
        // but substring checks should ignore separators (f.u.c.k).
        var spaced = builder.ToString();
        var squashed = spaced.Replace(" ", "");
        return squashed + " " + spaced;
    }
}
