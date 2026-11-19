using System.Text;

namespace WinVector.Core.Shell;

/// <summary>Separa una línea de argumentos al estilo de Windows: espacios y comillas dobles.</summary>
public static class CommandLine
{
    public static IReadOnlyList<string> SplitArguments(string? commandLine)
    {
        var arguments = new List<string>();
        if (string.IsNullOrWhiteSpace(commandLine))
        {
            return arguments;
        }

        var current = new StringBuilder();
        var quoted = false;
        var hasArgument = false;
        foreach (var character in commandLine)
        {
            if (character == '"')
            {
                quoted = !quoted;
                hasArgument = true;
            }
            else if (char.IsWhiteSpace(character) && !quoted)
            {
                if (hasArgument)
                {
                    arguments.Add(current.ToString());
                    current.Clear();
                    hasArgument = false;
                }
            }
            else
            {
                current.Append(character);
                hasArgument = true;
            }
        }

        if (hasArgument)
        {
            arguments.Add(current.ToString());
        }

        return arguments;
    }
}
