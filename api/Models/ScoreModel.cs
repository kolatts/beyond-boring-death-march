namespace BeyondBoring.DeathMarch.Functions.Models;

public class ScoreModel
{
    public string Name { get; set; } = "";
    public long? Score { get; set; }
    public string Role { get; set; } = "";
    public int? Days { get; set; }
    public int? Miles { get; set; }
    public int? DeadlinesMet { get; set; }
    public int? DeadlinesMissed { get; set; }
    public bool? BusinessDeadlineMet { get; set; }
}

public class ScoreResponseModel
{
    public string Name { get; set; } = "";
    public long Score { get; set; }
    public string Role { get; set; } = "";
    public int Days { get; set; }
    public int Miles { get; set; }
    public int DeadlinesMet { get; set; }
    public int DeadlinesMissed { get; set; }
    public bool BusinessDeadlineMet { get; set; }
    public DateTimeOffset Timestamp { get; set; }
}
