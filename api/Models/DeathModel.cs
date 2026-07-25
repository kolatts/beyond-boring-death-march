namespace BeyondBoring.DeathMarch.Functions.Models;

public class DeathModel
{
    public string Name { get; set; } = "";
    public string Cause { get; set; } = "";
    public int? Mile { get; set; }
    public string Epitaph { get; set; } = "";
    public string Role { get; set; } = "";
    public int? Days { get; set; }
}

public class DeathResponseModel
{
    public string Name { get; set; } = "";
    public string Cause { get; set; } = "";
    public int Mile { get; set; }
    public string Epitaph { get; set; } = "";
    public string Role { get; set; } = "";
    public int Days { get; set; }
    public DateTimeOffset Timestamp { get; set; }
}
