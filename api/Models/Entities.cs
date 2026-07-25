using Azure;
using Azure.Data.Tables;

namespace BeyondBoring.DeathMarch.Functions.Models;

public class DeathEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "DEATH";
    public string RowKey { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public string Name { get; set; } = "";
    public string Cause { get; set; } = "";
    public int Mile { get; set; }
    public string Epitaph { get; set; } = "";
    public string Role { get; set; } = "";
    public int Days { get; set; }
}

public class ScoreEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "SCORE";
    public string RowKey { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public string Name { get; set; } = "";
    public long Score { get; set; }
    public string Role { get; set; } = "";
    public int Days { get; set; }
    public int Miles { get; set; }
    public int DeadlinesMet { get; set; }
    public int DeadlinesMissed { get; set; }
    public bool BusinessDeadlineMet { get; set; }
}

public class RateLimitEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "RATE";
    public string RowKey { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public int Count { get; set; }
}
