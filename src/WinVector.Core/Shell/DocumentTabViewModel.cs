using CommunityToolkit.Mvvm.ComponentModel;
using WinVector.Core.Files;

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

    /// <summary>Nombre del documento: el del archivo o "Sin título N".</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Header))]
    private string _title;

    /// <summary>Ruta completa del archivo, o null si el documento no se ha guardado nunca.</summary>
    [ObservableProperty]
    private string? _filePath;

    /// <summary>Codificación con la que se leyó el archivo, para guardarlo igual.</summary>
    public FileEncoding FileEncoding { get; set; } = FileEncoding.Utf8;

    /// <summary>True si es un documento nuevo en blanco que el usuario aún no ha tocado.</summary>
    internal bool IsNewBlank { get; init; }

    /// <summary>True si es un documento nuevo en blanco sin cambios: abrir un archivo lo sustituye.</summary>
    public bool IsPristine => IsNewBlank && FilePath is null && Revision == 0;

    /// <summary>Texto de la pestaña: el título y una marca si hay cambios sin guardar.</summary>
    public string Header => IsModified ? $"{Title} •" : Title;

    /// <summary>True cuando el motor ha cargado el documento.</summary>
    [ObservableProperty]
    private bool _isLoaded;

    /// <summary>Por qué no se pudo cargar el documento, o null si se cargó o aún no se ha intentado.</summary>
    [ObservableProperty]
    private string? _loadError;

    /// <summary>Revisión actual del documento en el motor; aumenta con cada cambio.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsModified))]
    [NotifyPropertyChangedFor(nameof(Header))]
    private int _revision;

    /// <summary>Revisión que coincide con el archivo guardado.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsModified))]
    [NotifyPropertyChangedFor(nameof(Header))]
    private int _savedRevision;

    /// <summary>True si hay cambios sin guardar.</summary>
    public bool IsModified => Revision != SavedRevision;
}
