using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>Degradados del relleno y del trazo desde el panel Apariencia (issue #109).</summary>
public sealed partial class MainViewModel
{
    private readonly Dictionary<string, IReadOnlyList<GradientPaint>> _documentGradients = [];
    private GradientEditorViewModel? _fillGradient;
    private GradientEditorViewModel? _strokeGradient;

    /// <summary>Editor del degradado del relleno de la selección.</summary>
    public GradientEditorViewModel FillGradient =>
        _fillGradient ??= new GradientEditorViewModel(PaintProperty.Fill, SendGradient, SetSelectionFill, UseGradient);

    /// <summary>Editor del degradado del trazo de la selección.</summary>
    public GradientEditorViewModel StrokeGradient =>
        _strokeGradient ??= new GradientEditorViewModel(PaintProperty.Stroke, SendGradient, SetSelectionStroke, UseGradient);

    private bool SendGradient(GradientRequestChange change)
    {
        if (SelectedDocument is not { IsLoaded: true } document || !HasSelection)
        {
            return false;
        }

        var request = new GradientRequest(document.DocumentId, change.Property, change.Kind, change.Stops, change.Spread, change.Shared);
        Enqueue(() => SendAsync(BridgeCommands.SelectionSetGradient, request));
        return true;
    }

    private bool UseGradient(UseGradientChange change)
    {
        if (SelectedDocument is not { IsLoaded: true } document || !HasSelection)
        {
            return false;
        }

        var request = new UseGradient(document.DocumentId, change.Property, change.Id, change.Copy);
        Enqueue(() => SendAsync(BridgeCommands.SelectionUseGradient, request));
        return true;
    }

    private void OnDocumentGradients(DocumentGradients gradients)
    {
        _documentGradients[gradients.DocumentId] = gradients.Gradients;
        if (gradients.DocumentId == SelectedDocument?.DocumentId)
        {
            ShowLibrary();
        }
    }

    /// <summary>Muestra en los dos editores la biblioteca del documento activo.</summary>
    private void ShowLibrary()
    {
        var library = SelectedDocument is { } document && _documentGradients.TryGetValue(document.DocumentId, out var gradients)
            ? gradients
            : [];
        FillGradient.ShowLibrary(library);
        StrokeGradient.ShowLibrary(library);
    }

    private void ShowGradients(SelectionStyle? style)
    {
        FillGradient.Show(style?.Fill, style?.FillGradient);
        StrokeGradient.Show(style?.Stroke, style?.StrokeGradient);
    }
}
