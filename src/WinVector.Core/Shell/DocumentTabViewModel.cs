using CommunityToolkit.Mvvm.ComponentModel;

namespace WinVector.Core.Shell;

/// <summary>
/// Una pestaña de documento en la ventana principal. Su documento vive en el motor con el
/// identificador <see cref="DocumentId"/> (ADR 0004).
/// </summary>
public sealed partial class DocumentTabViewModel : ObservableObject
{
    public DocumentTabViewModel(string documentId, string title, string initialSvg)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(documentId);
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        ArgumentNullException.ThrowIfNull(initialSvg);
        DocumentId = documentId;
        InitialSvg = initialSvg;
        _title = title;
    }

    /// <summary>Identificador del documento en el motor.</summary>
    public string DocumentId { get; }

    /// <summary>Texto con el que se abrió el documento.</summary>
    public string InitialSvg { get; }

    /// <summary>Título que se muestra en la pestaña.</summary>
    [ObservableProperty]
    private string _title;

    /// <summary>True cuando el motor ha cargado el documento.</summary>
    [ObservableProperty]
    private bool _isLoaded;

    /// <summary>Por qué no se pudo cargar el documento, o null si se cargó o aún no se ha intentado.</summary>
    [ObservableProperty]
    private string? _loadError;

    /// <summary>Revisión actual del documento en el motor; aumenta con cada cambio.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsModified))]
    private int _revision;

    /// <summary>Revisión que coincide con el archivo guardado.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsModified))]
    private int _savedRevision;

    /// <summary>True si hay cambios sin guardar.</summary>
    public bool IsModified => Revision != SavedRevision;
}
