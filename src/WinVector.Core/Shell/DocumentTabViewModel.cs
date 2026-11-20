using CommunityToolkit.Mvvm.ComponentModel;
using WinVector.Core.Bridge;
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

    /// <summary>
    /// Texto con el que se carga el documento en el motor: el del archivo al abrirlo o, tras un fallo
    /// del motor, el de la última copia de recuperación.
    /// </summary>
    public string InitialSvg { get; private set; }

    /// <summary>Identificador de sus copias de recuperación (issue #24).</summary>
    public string RecoveryKey { get; } = Guid.NewGuid().ToString("N");

    /// <summary>Revisión de la última copia de recuperación, o null si no hay ninguna.</summary>
    internal int? RecoveredRevision { get; set; }

    /// <summary>Texto de la última copia de recuperación, o null si no hay ninguna.</summary>
    internal string? RecoveredSvg { get; set; }

    /// <summary>
    /// True si al cargarlo en el motor tiene cambios sin guardar: un documento recuperado, cuyo texto
    /// no es el del archivo.
    /// </summary>
    internal bool LoadsModified { get; set; }

    /// <summary>Cambia el texto con el que se volverá a cargar el documento en el motor.</summary>
    internal void ReplaceInitialSvg(string svg)
    {
        ArgumentNullException.ThrowIfNull(svg);
        InitialSvg = svg;
    }

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

    /// <summary>Estado del historial de deshacer del documento, según el motor.</summary>
    [ObservableProperty]
    private DocumentHistory _history = DocumentHistory.Empty;

    /// <summary>Zoom del documento en el lienzo: 1 es el 100 %.</summary>
    [ObservableProperty]
    private double _zoom = 1;

    /// <summary>Tamaño de la mesa de trabajo según el motor, o null hasta que el motor lo anuncia.</summary>
    [ObservableProperty]
    private Artboard? _artboard;
}

/// <summary>Estado del historial de deshacer de un documento.</summary>
/// <param name="UndoAction">Acción que se desharía ("move"), o null si no hay nada que deshacer.</param>
/// <param name="RedoAction">Acción que se reharía, o null si no hay nada que rehacer.</param>
public sealed record DocumentHistory(bool CanUndo, bool CanRedo, string? UndoAction, string? RedoAction)
{
    /// <summary>Historial sin pasos: el de un documento recién cargado.</summary>
    public static readonly DocumentHistory Empty = new(false, false, null, null);

    internal static DocumentHistory From(HistoryState state) =>
        new(state.CanUndo, state.CanRedo, state.UndoAction, state.RedoAction);
}
