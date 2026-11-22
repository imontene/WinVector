using CommunityToolkit.Mvvm.ComponentModel;
using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>
/// Aviso de fuentes que faltan (issue #97): el motor dice qué listas de fuentes usan los textos de
/// cada documento y aquí se comparan con las fuentes instaladas. El documento no cambia.
/// </summary>
public sealed partial class MainViewModel
{
    /// <summary>Familias genéricas de CSS: siempre hay una fuente para ellas.</summary>
    private static readonly HashSet<string> GenericFamilies = new(StringComparer.OrdinalIgnoreCase)
    {
        "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace",
    };

    private readonly Dictionary<string, IReadOnlyList<FontUse>> _documentFonts = [];

    /// <summary>Avisos cerrados por el usuario: documento y mensaje que se cerró.</summary>
    private readonly Dictionary<string, string> _dismissedFonts = [];

    /// <summary>Aviso de las fuentes que faltan en el documento activo, o vacío.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasMissingFonts))]
    private string _missingFontsMessage = string.Empty;

    /// <summary>Hay que avisar de fuentes que faltan (y el usuario no ha cerrado el aviso).</summary>
    public bool HasMissingFonts => MissingFontsMessage.Length > 0;

    /// <summary>La fuente de los textos seleccionados no está instalada en este equipo.</summary>
    public bool IsTextFontMissing => TextFontFamily is { } family && IsMissing(family);

    /// <summary>Cierra el aviso del documento activo; vuelve si faltan otras fuentes.</summary>
    public void DismissMissingFonts()
    {
        if (SelectedDocument is { } document && MissingFontsMessage.Length > 0)
        {
            _dismissedFonts[document.DocumentId] = MissingFontsMessage;
        }

        MissingFontsMessage = string.Empty;
    }

    private void OnDocumentFonts(DocumentFonts fonts)
    {
        _documentFonts[fonts.DocumentId] = fonts.Fonts;
        if (fonts.DocumentId == SelectedDocument?.DocumentId)
        {
            UpdateMissingFonts();
        }
    }

    /// <summary>True si la familia no es genérica y no está entre las instaladas (si ya se conocen).</summary>
    private bool IsMissing(string family) =>
        SystemFonts.Count > 0 && !GenericFamilies.Contains(family) && !SystemFonts.Contains(family, StringComparer.OrdinalIgnoreCase);

    /// <summary>Vuelve a calcular el aviso del documento activo.</summary>
    private void UpdateMissingFonts()
    {
        OnPropertyChanged(nameof(IsTextFontMissing));
        if (SelectedDocument is not { } document || !_documentFonts.TryGetValue(document.DocumentId, out var uses))
        {
            MissingFontsMessage = string.Empty;
            return;
        }

        var missing = new List<(string Font, string? Replacement)>();
        foreach (var families in uses.Select(use => use.Families))
        {
            if (families.Count == 0 || !IsMissing(families[0]) || missing.Exists(m => string.Equals(m.Font, families[0], StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            // Se dibuja con la primera de las demás que sí hay (o una genérica).
            missing.Add((families[0], families.Skip(1).FirstOrDefault(family => !IsMissing(family))));
        }

        var message = missing.Count == 0 ? string.Empty : _texts.MissingFonts(missing);
        MissingFontsMessage = _dismissedFonts.TryGetValue(document.DocumentId, out var dismissed) && dismissed == message
            ? string.Empty
            : message;
    }

    partial void OnTextFontFamilyChanged(string? value) => OnPropertyChanged(nameof(IsTextFontMissing));
}
