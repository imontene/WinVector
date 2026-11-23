using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>Degradados del relleno y del trazo desde el panel Apariencia (issue #109).</summary>
public sealed partial class MainViewModel
{
    private GradientEditorViewModel? _fillGradient;
    private GradientEditorViewModel? _strokeGradient;

    /// <summary>Editor del degradado del relleno de la selección.</summary>
    public GradientEditorViewModel FillGradient =>
        _fillGradient ??= new GradientEditorViewModel(PaintProperty.Fill, SendGradient, SetSelectionFill);

    /// <summary>Editor del degradado del trazo de la selección.</summary>
    public GradientEditorViewModel StrokeGradient =>
        _strokeGradient ??= new GradientEditorViewModel(PaintProperty.Stroke, SendGradient, SetSelectionStroke);

    private bool SendGradient(GradientRequestChange change)
    {
        if (SelectedDocument is not { IsLoaded: true } document || !HasSelection)
        {
            return false;
        }

        var request = new GradientRequest(document.DocumentId, change.Property, change.Kind, change.Stops, change.Spread);
        Enqueue(() => SendAsync(BridgeCommands.SelectionSetGradient, request));
        return true;
    }

    private void ShowGradients(SelectionStyle? style)
    {
        FillGradient.Show(style?.Fill, style?.FillGradient);
        StrokeGradient.Show(style?.Stroke, style?.StrokeGradient);
    }
}
