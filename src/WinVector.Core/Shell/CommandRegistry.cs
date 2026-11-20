using System.Globalization;
using System.Text;
using System.Windows.Input;

namespace WinVector.Core.Shell;

/// <summary>Una orden de la aplicación: su nombre en el idioma de la interfaz, su atajo y qué hace.</summary>
/// <param name="Id">Identificador estable en inglés ("undo"); también sirve para buscarla.</param>
/// <param name="Name">Nombre localizado ("Deshacer").</param>
/// <param name="Shortcut">Atajo de teclado para mostrar ("Ctrl+Z"), o vacío.</param>
/// <param name="Command">La misma orden que usan los menús y los botones.</param>
public sealed record CommandEntry(string Id, string Name, string Shortcut, ICommand Command)
{
    /// <summary>True si ahora se puede ejecutar.</summary>
    public bool CanExecute => Command.CanExecute(null);

    /// <summary>Ejecuta la orden si se puede.</summary>
    public bool Execute()
    {
        if (!CanExecute)
        {
            return false;
        }

        Command.Execute(null);
        return true;
    }
}

/// <summary>
/// Registro central de órdenes, para la paleta de comandos (Ctrl+K). Las órdenes son las mismas que
/// usan los menús y los botones, así que se activan y desactivan igual.
/// </summary>
public sealed class CommandRegistry
{
    private readonly List<CommandEntry> _entries = [];

    /// <summary>Órdenes registradas, en el orden en que se registraron.</summary>
    public IReadOnlyList<CommandEntry> All => _entries;

    public void Register(string id, string name, ICommand command, string shortcut = "")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentNullException.ThrowIfNull(command);
        if (_entries.Any(entry => entry.Id == id))
        {
            throw new ArgumentException($"La orden {id} ya está registrada.", nameof(id));
        }

        _entries.Add(new CommandEntry(id, name, shortcut, command));
    }

    /// <summary>
    /// Órdenes que se pueden ejecutar ahora y coinciden con lo escrito, de la más a la menos
    /// parecida. No distingue tildes ni mayúsculas ("rehacer" encuentra "Rehacer"; "agrupacion",
    /// "Agrupación"). También busca por el identificador en inglés ("undo").
    /// </summary>
    public IReadOnlyList<CommandEntry> Search(string query, int limit = 10)
    {
        var words = Normalize(query).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0)
        {
            return [];
        }

        return _entries
            .Where(entry => entry.CanExecute)
            .Select((entry, order) => (entry, order, score: Score(entry, words)))
            .Where(match => match.score > 0)
            .OrderByDescending(match => match.score)
            .ThenBy(match => match.order)
            .Take(limit)
            .Select(match => match.entry)
            .ToList();
    }

    /// <summary>
    /// Letras con tilde de los idiomas europeos y su letra base. La descomposición Unicode ya las
    /// separa, pero no está disponible cuando .NET se ejecuta sin datos de globalización.
    /// </summary>
    private static readonly Dictionary<char, char> Unaccented = BuildUnaccented();

    private static Dictionary<char, char> BuildUnaccented()
    {
        var map = new Dictionary<char, char>();
        foreach (var (letters, letter) in new[]
        {
            ("áàäâãåā", 'a'), ("éèëêē", 'e'), ("íìïîī", 'i'), ("óòöôõøō", 'o'), ("úùüûū", 'u'),
            ("ñ", 'n'), ("ç", 'c'), ("ýÿ", 'y'),
        })
        {
            foreach (var accented in letters)
            {
                map[accented] = letter;
            }
        }

        return map;
    }

    /// <summary>Texto sin tildes, en minúsculas y con los espacios simplificados.</summary>
    public static string Normalize(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var decomposed = text.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            var lower = char.ToLowerInvariant(character);
            builder.Append(char.IsLetterOrDigit(lower) ? Unaccented.GetValueOrDefault(lower, lower) : ' ');
        }

        return string.Join(' ', builder.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>
    /// Puntuación de una orden: más si el nombre empieza por lo escrito o si las palabras escritas
    /// son el principio de palabras del nombre; 0 si alguna palabra no aparece.
    /// </summary>
    private static int Score(CommandEntry entry, string[] words)
    {
        var name = Normalize(entry.Name);
        var id = Normalize(entry.Id);
        var query = string.Join(' ', words);
        if (name == query || id == query)
        {
            return 100;
        }

        var nameWords = name.Split(' ');
        var score = name.StartsWith(query, StringComparison.Ordinal) ? 80 : 0;
        foreach (var word in words)
        {
            if (nameWords.Any(nameWord => nameWord.StartsWith(word, StringComparison.Ordinal)))
            {
                score += 20;
            }
            else if (name.Contains(word, StringComparison.Ordinal))
            {
                score += 10;
            }
            else if (id.Contains(word, StringComparison.Ordinal))
            {
                score += 5;
            }
            else
            {
                return 0;
            }
        }

        return score;
    }
}
