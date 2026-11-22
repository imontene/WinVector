using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>Propiedades tipográficas de los textos seleccionados y menú Texto (issue #95).</summary>
public sealed partial class MainViewModel
{
    /// <summary>Pesos de la lista del panel, de 100 a 900.</summary>
    public static IReadOnlyList<int> FontWeights { get; } = [100, 200, 300, 400, 500, 600, 700, 800, 900];

    /// <summary>Fuentes instaladas en el equipo, ordenadas; las pone la interfaz al arrancar.</summary>
    public ObservableCollection<string> SystemFonts { get; } = [];

    /// <summary>Hay textos en la selección: el panel muestra sus propiedades.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(
        nameof(ToggleBoldCommand),
        nameof(ToggleItalicCommand),
        nameof(AlignTextStartCommand),
        nameof(AlignTextCenterCommand),
        nameof(AlignTextEndCommand))]
    private bool _hasTextProperties;

    /// <summary>Fuente común de los textos seleccionados, o null si son distintas.</summary>
    [ObservableProperty]
    private string? _textFontFamily;

    /// <summary>Tamaño de la fuente, o NaN si es distinto.</summary>
    [ObservableProperty]
    private double _textFontSize = double.NaN;

    /// <summary>Peso de la fuente (100 a 900), o null si es distinto.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(TextFontWeightIndex), nameof(IsTextBold))]
    private int? _textFontWeight;

    /// <summary>Cursiva, o null si son distintas.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsTextItalic))]
    private bool? _textItalic;

    /// <summary>Alineación, o null si son distintas.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsTextAlignedStart), nameof(IsTextAlignedCenter), nameof(IsTextAlignedEnd))]
    private TextAnchor? _textAnchor;

    /// <summary>Interlineado en múltiplos del tamaño, o NaN si es distinto.</summary>
    [ObservableProperty]
    private double _textLineHeight = double.NaN;

    /// <summary>Posición del peso en <see cref="FontWeights"/>, o -1.</summary>
    public int TextFontWeightIndex => TextFontWeight is { } weight ? Array.IndexOf([.. FontWeights], (int)(Math.Round(weight / 100.0) * 100)) : -1;

    public bool IsTextBold => TextFontWeight >= 600;

    public bool IsTextItalic => TextItalic == true;

    public bool IsTextAlignedStart => TextAnchor == Bridge.TextAnchor.Start;

    public bool IsTextAlignedCenter => TextAnchor == Bridge.TextAnchor.Middle;

    public bool IsTextAlignedEnd => TextAnchor == Bridge.TextAnchor.End;

    /// <summary>Pone la lista de fuentes del sistema, sin repetir y en orden alfabético.</summary>
    public void SetSystemFonts(IEnumerable<string> fonts)
    {
        ArgumentNullException.ThrowIfNull(fonts);
        SystemFonts.Clear();
        foreach (var font in fonts.Where(f => !string.IsNullOrWhiteSpace(f)).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.CurrentCultureIgnoreCase))
        {
            SystemFonts.Add(font);
        }

        UpdateMissingFonts();
    }

    /// <summary>Cambia la fuente de los textos seleccionados.</summary>
    public bool SetTextFontFamily(string family) =>
        !string.IsNullOrWhiteSpace(family) && family.Trim() != TextFontFamily && SendText(fontFamily: family.Trim());

    /// <summary>Cambia el tamaño de la fuente (mayor que 0).</summary>
    public bool SetTextFontSize(double size)
    {
        if (!double.IsFinite(size) || size <= 0 || Math.Abs(size - TextFontSize) < 1e-9)
        {
            OnPropertyChanged(nameof(TextFontSize));
            return false;
        }

        return SendText(fontSize: size);
    }

    /// <summary>Cambia el peso de la fuente (100 a 900).</summary>
    public bool SetTextFontWeight(int weight) =>
        weight is >= 100 and <= 900 && weight != TextFontWeight && SendText(fontWeight: weight);

    /// <summary>Cambia el interlineado (mayor que 0).</summary>
    public bool SetTextLineHeight(double lineHeight)
    {
        if (!double.IsFinite(lineHeight) || lineHeight <= 0 || Math.Abs(lineHeight - TextLineHeight) < 1e-9)
        {
            OnPropertyChanged(nameof(TextLineHeight));
            return false;
        }

        return SendText(lineHeight: lineHeight);
    }

    /// <summary>Pone o quita la cursiva.</summary>
    public bool SetTextItalic(bool italic) => italic != TextItalic && SendText(italic: italic);

    /// <summary>Cambia la alineación.</summary>
    public bool SetTextAnchor(TextAnchor anchor) => anchor != TextAnchor && SendText(anchor: anchor);

    /// <summary>Negrita (700) o normal (400), según lo que tengan ahora.</summary>
    [RelayCommand(CanExecute = nameof(HasTextProperties))]
    public void ToggleBold() => SendText(fontWeight: IsTextBold ? 400 : 700);

    /// <summary>Pone o quita la cursiva.</summary>
    [RelayCommand(CanExecute = nameof(HasTextProperties))]
    public void ToggleItalic() => SendText(italic: !IsTextItalic);

    [RelayCommand(CanExecute = nameof(HasTextProperties))]
    public void AlignTextStart() => SendText(anchor: Bridge.TextAnchor.Start);

    [RelayCommand(CanExecute = nameof(HasTextProperties))]
    public void AlignTextCenter() => SendText(anchor: Bridge.TextAnchor.Middle);

    [RelayCommand(CanExecute = nameof(HasTextProperties))]
    public void AlignTextEnd() => SendText(anchor: Bridge.TextAnchor.End);

    private bool SendText(
        string? fontFamily = null, double? fontSize = null, int? fontWeight = null, bool? italic = null, TextAnchor? anchor = null, double? lineHeight = null)
    {
        if (SelectedDocument is not { IsLoaded: true } document || !HasTextProperties)
        {
            return false;
        }

        var change = new TextChange(document.DocumentId, fontFamily, fontSize, fontWeight, italic, anchor, lineHeight);
        Enqueue(() => SendAsync(BridgeCommands.SelectionSetText, change));
        return true;
    }

    /// <summary>Muestra las propiedades de los textos seleccionados, o ninguna con null.</summary>
    private void ShowText(TextProperties? text)
    {
        HasTextProperties = text is not null;
        TextFontFamily = text?.FontFamily;
        TextFontSize = text?.FontSize is { } size ? Math.Round(size, 2) : double.NaN;
        TextFontWeight = text?.FontWeight;
        TextItalic = text?.Italic;
        TextAnchor = text?.Anchor;
        TextLineHeight = text?.LineHeight is { } lineHeight ? Math.Round(lineHeight, 3) : double.NaN;
    }
}
