using CommunityToolkit.Mvvm.ComponentModel;

namespace WinVector.Core.Shell;

/// <summary>
/// Una pestaña de documento en la ventana principal.
/// </summary>
/// <remarks>
/// Por ahora solo tiene título. El documento, la ruta del archivo y el estado de cambios sin guardar
/// llegan en la Fase 1.
/// </remarks>
public sealed partial class DocumentTabViewModel : ObservableObject
{
    public DocumentTabViewModel(string title)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        _title = title;
    }

    /// <summary>Título que se muestra en la pestaña.</summary>
    [ObservableProperty]
    private string _title;
}
