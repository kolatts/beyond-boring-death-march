using Azure.Data.Tables;

namespace BeyondBoring.DeathMarch.Functions.Services;

/// <summary>
/// Lazily creates and caches TableClient instances. Tables are created on first use
/// so a fresh storage account works without a provisioning step.
/// </summary>
public class TableStore
{
    public const string DeathsTable = "deaths";
    public const string ScoresTable = "scores";
    public const string RateLimitsTable = "ratelimits";

    private readonly TableServiceClient _service;
    private readonly Dictionary<string, TableClient> _clients = new();
    private readonly object _lock = new();

    public TableStore(TableServiceClient service) => _service = service;

    public TableClient Get(string tableName)
    {
        lock (_lock)
        {
            if (_clients.TryGetValue(tableName, out var existing))
            {
                return existing;
            }

            var client = _service.GetTableClient(tableName);
            client.CreateIfNotExists();
            _clients[tableName] = client;
            return client;
        }
    }

    /// <summary>
    /// RowKey that sorts newest-first lexicographically: inverted ticks plus a
    /// short uniquifier so two deaths in the same tick both survive. Fitting.
    /// </summary>
    public static string InvertedTicksRowKey() =>
        $"{DateTime.MaxValue.Ticks - DateTime.UtcNow.Ticks:D19}-{Guid.NewGuid():N}"[..28];

    /// <summary>
    /// RowKey that sorts highest-score-first lexicographically. Scores are offset
    /// into non-negative space, inverted, zero-padded, then tie-broken by recency.
    /// </summary>
    public static string InvertedScoreRowKey(long score)
    {
        const long offset = 10_000_000_000L; // supports scores in [-10B, 10B]
        var inverted = (offset * 2) - (score + offset);
        return $"{inverted:D11}-{DateTime.MaxValue.Ticks - DateTime.UtcNow.Ticks:D19}";
    }
}
