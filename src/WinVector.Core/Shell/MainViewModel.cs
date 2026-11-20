using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using WinVector.Core.Bridge;
using WinVector.Core.Files;

namespace WinVector.Core.Shell;

/// <summary>
/// Estado de la ventana principal: pestañas de documento, pestaña activa y estado del lienzo.
/// </summary>
/// <remarks>
/// Un único motor gestiona los documentos de todas las pestañas (ADR 0004). Las órdenes al motor
/// (cargar, activar, cerrar) se encolan para que lleguen en el orden en que se producen.
/// </remarks>
public sealed partial class MainViewModel : ObservableObject
{
    /// <summary>
    /// Tiempo máximo de los comandos que llevan un documento completo. Medido con el puente real:
    /// cargar 20 MB tarda unos 7 s y 50 MB unos 17 s (ver contracts/README.md).
    /// </summary>
    public static readonly TimeSpan DocumentCommandTimeout = TimeSpan.FromMinutes(2);

    private readonly IShellTexts _texts;
    private readonly IShellDialogs _dialogs;
    private readonly ILogger _logger;
    private readonly TimeProvider _time;
    private readonly IShellClipboard _clipboard;
    private readonly RecoveryStore? _recovery;
    private ITimer? _recoveryTimer;
    private SynchronizationContext? _uiContext;
    private int _autosaving;
    private BridgeClient? _bridge;
    private Task _engineWork = Task.CompletedTask;
    private int _untitledCount;
    private int _documentCount;

    public MainViewModel(
        IShellTexts texts,
        IShellDialogs? dialogs = null,
        RecentFiles? recentFiles = null,
        ILogger<MainViewModel>? logger = null,
        TimeProvider? timeProvider = null,
        IShellClipboard? clipboard = null,
        RecoveryStore? recovery = null)
    {
        ArgumentNullException.ThrowIfNull(texts);
        _texts = texts;
        _dialogs = dialogs ?? NoDialogs.Instance;
        RecentFiles = recentFiles ?? new RecentFiles(new MemoryRecentFilesStore());
        _logger = logger ?? NullLogger<MainViewModel>.Instance;
        _time = timeProvider ?? TimeProvider.System;
        _clipboard = clipboard ?? new MemoryClipboard();
        _recovery = recovery;
        Commands = new CommandRegistry();
        NewDocument();
        RegisterCommands();
    }

    /// <summary>Órdenes de la aplicación para la paleta de comandos (Ctrl+K).</summary>
    public CommandRegistry Commands { get; }

    /// <summary>Se pide abrir la paleta de comandos (Ctrl+K con el lienzo enfocado).</summary>
    public event EventHandler? CommandPaletteRequested;

    /// <summary>Registra las órdenes con su nombre y su atajo en el idioma de la interfaz.</summary>
    private void RegisterCommands()
    {
        void Add(string id, System.Windows.Input.ICommand command) =>
            Commands.Register(id, _texts.CommandName(id), command, _texts.CommandShortcut(id));

        Add("new", NewDocumentCommand);
        Add("new-with-size", NewDocumentWithSizeCommand);
        Add("open", OpenCommand);
        Add("save", SaveCommand);
        Add("save-as", SaveAsCommand);
        Add("close-tab", new AsyncRelayCommand(() => RequestCloseDocumentAsync(SelectedDocument)));
        Add("undo", UndoCommand);
        Add("redo", RedoCommand);
        Add("cut", CutCommand);
        Add("copy", CopyCommand);
        Add("paste", PasteCommand);
        Add("duplicate", DuplicateCommand);
        Add("delete", DeleteCommand);
        Add("select-all", SelectAllCommand);
        Add("group", GroupCommand);
        Add("ungroup", UngroupCommand);
        Add("bring-to-front", BringToFrontCommand);
        Add("bring-forward", BringForwardCommand);
        Add("send-backward", SendBackwardCommand);
        Add("send-to-back", SendToBackCommand);
        Add("zoom-in", ZoomInCommand);
        Add("zoom-out", ZoomOutCommand);
        Add("zoom-fit", ZoomFitCommand);
        Add("zoom-actual", ZoomActualCommand);
        Add("toggle-rulers", new RelayCommand(() => ShowRulers = !ShowRulers));
        Add("toggle-grid", new RelayCommand(() => ShowGrid = !ShowGrid));
        Add("toggle-snap", new RelayCommand(() => SnapToGrid = !SnapToGrid));
        Add("tool-select", new AsyncRelayCommand(() => SelectToolAsync(ToolName.Select)));
        Add("tool-hand", new AsyncRelayCommand(() => SelectToolAsync(ToolName.Hand)));
        Add("tool-zoom", new AsyncRelayCommand(() => SelectToolAsync(ToolName.Zoom)));
        Add("tool-eyedropper", new AsyncRelayCommand(() => SelectToolAsync(ToolName.Eyedropper)));
        Add("tool-rectangle", new AsyncRelayCommand(() => SelectToolAsync(ToolName.Rectangle)));
        Add("tool-ellipse", new AsyncRelayCommand(() => SelectToolAsync(ToolName.Ellipse)));
        Add("tool-line", new AsyncRelayCommand(() => SelectToolAsync(ToolName.Line)));
        Add("tool-polygon", new AsyncRelayCommand(() => SelectToolAsync(ToolName.Polygon)));
        Add("tool-star", new AsyncRelayCommand(() => SelectToolAsync(ToolName.Star)));
    }

    /// <summary>Archivos abiertos o guardados recientemente.</summary>
    public RecentFiles RecentFiles { get; }

    /// <summary>Pestañas abiertas, en el orden en que se muestran.</summary>
    public ObservableCollection<DocumentTabViewModel> Documents { get; } = [];

    /// <summary>Pestaña activa. Nunca es null mientras haya pestañas abiertas.</summary>
    [ObservableProperty]
    private DocumentTabViewModel? _selectedDocument;

    /// <summary>Resumen de la selección del lienzo para la barra de estado ("circle#sol"). Vacío sin selección.</summary>
    [ObservableProperty]
    private string _selectionSummary = string.Empty;

    /// <summary>Aviso sobre el estado del motor para la barra de estado. Vacío si todo va bien.</summary>
    [ObservableProperty]
    private string _engineStatus = string.Empty;

    /// <summary>True cuando el motor ha cargado y usa la misma versión del protocolo.</summary>
    [ObservableProperty]
    private bool _isEngineReady;

    /// <summary>Latencia de ida y vuelta del puente medida con app.ping al cargar el motor.</summary>
    [ObservableProperty]
    private TimeSpan? _bridgeLatency;

    /// <summary>True si hay algo seleccionado en el documento activo.</summary>
    [ObservableProperty]
    private bool _hasSelection;

    /// <summary>Caja exacta de la selección según el motor, en unidades del documento.</summary>
    private Rect? _selectionBounds;

    /// <summary>Borde izquierdo de la selección (redondeado a centésimas), o NaN sin selección.</summary>
    [ObservableProperty]
    private double _selectionX = double.NaN;

    /// <summary>Borde superior de la selección, o NaN sin selección.</summary>
    [ObservableProperty]
    private double _selectionY = double.NaN;

    /// <summary>Ancho de la selección, o NaN sin selección.</summary>
    [ObservableProperty]
    private double _selectionWidth = double.NaN;

    /// <summary>Alto de la selección, o NaN sin selección.</summary>
    [ObservableProperty]
    private double _selectionHeight = double.NaN;

    /// <summary>Giro en grados del objeto seleccionado, o NaN si no hay exactamente uno.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanRotateSelection))]
    private double _selectionRotation = double.NaN;

    /// <summary>Mantiene la proporción entre ancho y alto al cambiar uno de los dos en el panel.</summary>
    [ObservableProperty]
    private bool _lockAspectRatio;

    /// <summary>
    /// Relleno de la selección: "none", un color "#rrggbb", "url" (degradado o patrón) o null si los
    /// objetos tienen rellenos distintos o no hay selección.
    /// </summary>
    [ObservableProperty]
    private string? _selectionFill;

    /// <summary>Trazo de la selección, con los mismos valores que <see cref="SelectionFill"/>.</summary>
    [ObservableProperty]
    private string? _selectionStroke;

    /// <summary>Grosor del trazo de la selección, o NaN si es distinto entre objetos.</summary>
    [ObservableProperty]
    private double _selectionStrokeWidth = double.NaN;

    /// <summary>Opacidad de la selección en porcentaje (0 a 100), o NaN si es distinta entre objetos.</summary>
    [ObservableProperty]
    private double _selectionOpacityPercent = double.NaN;

    /// <summary>Colores usados hace poco, el más reciente primero.</summary>
    public ObservableCollection<string> RecentColors { get; } = [];

    /// <summary>Colores recientes que se recuerdan.</summary>
    public const int RecentColorsLimit = 10;

    /// <summary>True si se puede girar desde el panel: hay exactamente un objeto seleccionado.</summary>
    public bool CanRotateSelection => !double.IsNaN(SelectionRotation);

    /// <summary>Muestra las reglas del lienzo.</summary>
    [ObservableProperty]
    private bool _showRulers = true;

    /// <summary>Muestra la cuadrícula sobre la mesa de trabajo.</summary>
    [ObservableProperty]
    private bool _showGrid;

    /// <summary>Ajusta a la cuadrícula al dibujar y mover.</summary>
    [ObservableProperty]
    private bool _snapToGrid;

    /// <summary>Herramienta activa del lienzo.</summary>
    [ObservableProperty]
    private ToolName _activeTool = ToolName.Select;

    /// <summary>Zoom del documento activo para la barra de estado ("150 %").</summary>
    public string ZoomText => SelectedDocument is { IsLoaded: true } document ? _texts.ZoomPercent(document.Zoom) : string.Empty;

    /// <summary>Mesa de trabajo del documento activo, o null si aún no se conoce.</summary>
    public Artboard? CurrentArtboard => SelectedDocument?.Artboard;

    /// <summary>True si el documento activo tiene algún paso que deshacer.</summary>
    public bool CanUndo => SelectedDocument is { IsLoaded: true, History.CanUndo: true };

    /// <summary>True si el documento activo tiene algún paso que rehacer.</summary>
    public bool CanRedo => SelectedDocument is { IsLoaded: true, History.CanRedo: true };

    /// <summary>Texto de la orden de deshacer del documento activo ("Deshacer mover").</summary>
    public string UndoLabel => _texts.UndoCommand(SelectedDocument?.History.UndoAction);

    /// <summary>Texto de la orden de rehacer del documento activo ("Rehacer mover").</summary>
    public string RedoLabel => _texts.RedoCommand(SelectedDocument?.History.RedoAction);

    /// <summary>Última medición de latencia en curso o terminada. Permite esperarla en las pruebas.</summary>
    internal Task LatencyMeasurement { get; private set; } = Task.CompletedTask;

    /// <summary>Órdenes al motor pendientes. Permite esperarlas en las pruebas.</summary>
    internal Task EngineWork => _engineWork;

    /// <summary>Abre un documento nuevo vacío y lo activa.</summary>
    [RelayCommand]
    public void NewDocument()
    {
        _untitledCount++;
        AddDocument(_texts.UntitledDocument(_untitledCount), DocumentTemplates.Blank(), filePath: null, FileEncoding.Utf8, isNewBlank: true);
    }

    /// <summary>Pide el tamaño y abre un documento nuevo vacío con él.</summary>
    [RelayCommand]
    public async Task NewDocumentWithSizeAsync()
    {
        if (await _dialogs.AskNewDocumentSizeAsync() is not { } size)
        {
            return;
        }

        _untitledCount++;
        AddDocument(_texts.UntitledDocument(_untitledCount), DocumentTemplates.Blank(size), filePath: null, FileEncoding.Utf8, isNewBlank: false);
    }

    /// <summary>Abre un documento a partir de su texto SVG en una pestaña nueva y la activa.</summary>
    public DocumentTabViewModel OpenDocument(string title, string svg) =>
        AddDocument(title, svg, filePath: null, FileEncoding.Utf8, isNewBlank: false);

    /// <summary>Pide un archivo y lo abre.</summary>
    [RelayCommand]
    public async Task OpenAsync()
    {
        if (await _dialogs.PickFileToOpenAsync() is { } path)
        {
            await OpenFileAsync(path);
        }
    }

    /// <summary>
    /// Abre un archivo SVG en una pestaña nueva, o activa su pestaña si ya está abierto. Si la única
    /// pestaña es un documento nuevo sin tocar, la sustituye. Los errores se muestran al usuario.
    /// </summary>
    /// <returns>La pestaña del documento, o null si no se pudo abrir.</returns>
    public async Task<DocumentTabViewModel?> OpenFileAsync(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var fullPath = Path.GetFullPath(path);
        var fileName = Path.GetFileName(fullPath);

        var existing = Documents.FirstOrDefault(d => d.FilePath is { } open && RecentFiles.PathComparer.Equals(open, fullPath));
        if (existing is not null)
        {
            SelectedDocument = existing;
            RecentFiles.Add(fullPath);
            return existing;
        }

        SvgFileContent content;
        try
        {
            content = await SvgFile.ReadAsync(fullPath);
        }
        catch (FileOperationException ex)
        {
            if (ex.Kind == FileErrorKind.NotFound)
            {
                RecentFiles.Remove(fullPath);
            }

            LogFileFailed("abrir", fullPath, ex.Kind, ex.Message);
            await _dialogs.ShowErrorAsync(_texts.OpenFailedTitle, _texts.FileError(ex.Kind, fileName));
            return null;
        }

        var pristine = Documents.Count == 1 && Documents[0].IsPristine ? Documents[0] : null;
        var document = AddDocument(fileName, content.Text, fullPath, content.Encoding, isNewBlank: false);
        if (IsEngineReady)
        {
            await _engineWork;
            if (!document.IsLoaded)
            {
                // LoadAsync ya ha cerrado la pestaña y ha explicado el error.
                return null;
            }
        }

        if (pristine is not null && pristine.IsPristine && Documents.Contains(pristine))
        {
            CloseDocument(pristine);
        }

        RecentFiles.Add(fullPath);
        return document;
    }

    /// <summary>Guarda el documento activo; si no tiene archivo, pregunta dónde.</summary>
    [RelayCommand]
    public async Task SaveAsync()
    {
        if (SelectedDocument is { } document)
        {
            await SaveDocumentAsync(document);
        }
    }

    /// <summary>Guarda el documento activo en un archivo nuevo.</summary>
    [RelayCommand]
    public async Task SaveAsAsync()
    {
        if (SelectedDocument is { } document)
        {
            await SaveDocumentAsync(document, chooseLocation: true);
        }
    }

    /// <summary>
    /// Guarda un documento con la codificación con la que se abrió. Si no tiene archivo o
    /// <paramref name="chooseLocation"/> es true, pregunta dónde. Los errores se muestran al usuario.
    /// </summary>
    /// <returns>True si se guardó.</returns>
    public async Task<bool> SaveDocumentAsync(DocumentTabViewModel document, bool chooseLocation = false)
    {
        ArgumentNullException.ThrowIfNull(document);
        var path = document.FilePath;
        if (chooseLocation || path is null)
        {
            path = await _dialogs.PickFileToSaveAsync(document.FilePath is { } current ? Path.GetFileName(current) : $"{document.Title}.svg");
            if (path is null)
            {
                return false;
            }
        }

        var fullPath = Path.GetFullPath(path);
        var fileName = Path.GetFileName(fullPath);

        DocumentContent content;
        try
        {
            content = await SerializeAsync(document);
        }
        catch (BridgeException ex)
        {
            LogFileFailed("guardar", fullPath, FileErrorKind.Other, ex.Message);
            await _dialogs.ShowErrorAsync(_texts.SaveFailedTitle, _texts.EngineUnavailable(fileName));
            return false;
        }

        try
        {
            await SvgFile.WriteAsync(fullPath, content.Svg, document.FileEncoding);
        }
        catch (FileOperationException ex)
        {
            LogFileFailed("guardar", fullPath, ex.Kind, ex.Message);
            await _dialogs.ShowErrorAsync(_texts.SaveFailedTitle, _texts.FileError(ex.Kind, fileName));
            return false;
        }

        document.SavedRevision = content.Revision;
        document.LoadsModified = false;
        ForgetRecovery(document);
        document.FilePath = fullPath;
        document.Title = fileName;
        RecentFiles.Add(fullPath);
        return true;
    }

    /// <summary>
    /// Cierra una pestaña. Si tiene cambios sin guardar, pregunta antes: Guardar, No guardar o Cancelar.
    /// </summary>
    /// <returns>True si la pestaña se cerró.</returns>
    public async Task<bool> RequestCloseDocumentAsync(DocumentTabViewModel? document)
    {
        if (document is null || !Documents.Contains(document))
        {
            return false;
        }

        if (!await ConfirmDiscardAsync(document))
        {
            return false;
        }

        CloseDocument(document);
        return true;
    }

    /// <summary>
    /// Antes de cerrar la ventana: pregunta por cada documento con cambios sin guardar.
    /// </summary>
    /// <returns>True si se puede cerrar la ventana; false si el usuario canceló o falló un guardado.</returns>
    public async Task<bool> RequestCloseAllAsync()
    {
        foreach (var document in Documents.Where(d => d.IsModified).ToArray())
        {
            if (!await ConfirmDiscardAsync(document))
            {
                return false;
            }
        }

        return true;
    }

    private async Task<bool> ConfirmDiscardAsync(DocumentTabViewModel document)
    {
        if (!document.IsModified)
        {
            return true;
        }

        SelectedDocument = document;
        return await _dialogs.AskToSaveChangesAsync(document.Title) switch
        {
            UnsavedChangesChoice.Save => await SaveDocumentAsync(document),
            UnsavedChangesChoice.DontSave => true,
            _ => false,
        };
    }

    private DocumentTabViewModel AddDocument(string title, string svg, string? filePath, FileEncoding encoding, bool isNewBlank, bool loadsModified = false)
    {
        _documentCount++;
        var document = new DocumentTabViewModel(
            string.Create(CultureInfo.InvariantCulture, $"d{_documentCount}"),
            title,
            svg)
        {
            FilePath = filePath,
            FileEncoding = encoding,
            IsNewBlank = isNewBlank,
            LoadsModified = loadsModified,
        };
        Documents.Add(document);
        if (IsEngineReady)
        {
            Enqueue(() => LoadAsync(document));
        }

        SelectedDocument = document;
        return document;
    }

    /// <summary>
    /// Cierra una pestaña. Si era la activa, se activa la vecina; si era la última, se abre un
    /// documento nuevo para que la ventana nunca quede vacía.
    /// </summary>
    [RelayCommand]
    public void CloseDocument(DocumentTabViewModel? document)
    {
        if (document is null)
        {
            return;
        }

        var index = Documents.IndexOf(document);
        if (index < 0)
        {
            return;
        }

        var wasSelected = ReferenceEquals(document, SelectedDocument);
        Documents.RemoveAt(index);
        // Cerrar una pestaña descarta sus cambios (se pregunta antes en RequestCloseDocumentAsync).
        ForgetRecovery(document);
        if (IsEngineReady && document.IsLoaded)
        {
            Enqueue(() => SendAsync(BridgeCommands.DocumentClose, new DocumentRef(document.DocumentId)));
        }

        if (Documents.Count == 0)
        {
            NewDocument();
        }
        else if (wasSelected)
        {
            SelectedDocument = Documents[Math.Min(index, Documents.Count - 1)];
        }
    }

    /// <summary>Cada cuánto se guardan las copias de recuperación de los documentos con cambios.</summary>
    public static readonly TimeSpan RecoveryInterval = TimeSpan.FromSeconds(10);

    /// <summary>
    /// Empieza a guardar copias de recuperación de los documentos con cambios, cada
    /// <see cref="RecoveryInterval"/>. Se llama desde la interfaz, que es donde se ejecutan después.
    /// </summary>
    public void StartRecovery()
    {
        if (_recovery is null || _recoveryTimer is not null)
        {
            return;
        }

        _recovery.StartSession();
        _uiContext = SynchronizationContext.Current;
        _recoveryTimer = _time.CreateTimer(
            _ =>
            {
                if (_uiContext is { } context)
                {
                    context.Post(__ => _ = AutosaveAsync(), null);
                }
                else
                {
                    _ = AutosaveAsync();
                }
            },
            null,
            RecoveryInterval,
            RecoveryInterval);
    }

    /// <summary>Cierre normal de la aplicación: deja de guardar copias y borra las de esta sesión.</summary>
    public void EndRecovery()
    {
        _recoveryTimer?.Dispose();
        _recoveryTimer = null;
        _recovery?.EndSession();
    }

    /// <summary>
    /// Guarda una copia de recuperación de cada documento con cambios que hayan cambiado desde la
    /// última. Pide el texto al motor en la cola de órdenes y escribe el archivo sin bloquear la
    /// interfaz. Los documentos sin cambios no tienen copia.
    /// </summary>
    public async Task AutosaveAsync()
    {
        if (_recovery?.SessionFolder is null || !IsEngineReady || Interlocked.Exchange(ref _autosaving, 1) == 1)
        {
            return;
        }

        try
        {
            foreach (var document in Documents.ToArray())
            {
                if (!document.IsLoaded || !document.IsModified)
                {
                    ForgetRecovery(document);
                    continue;
                }

                if (document.RecoveredRevision == document.Revision)
                {
                    continue;
                }

                DocumentContent content;
                try
                {
                    content = await SerializeAsync(document);
                }
                catch (BridgeException ex)
                {
                    LogCommandFailed(BridgeCommands.DocumentSerialize.Name, ex.Code, ex.Message);
                    continue;
                }

                // Mientras se pedía el texto, el documento pudo cerrarse o guardarse.
                if (!Documents.Contains(document) || !document.IsModified)
                {
                    continue;
                }

                try
                {
                    await _recovery.SaveAsync(document.RecoveryKey, document.Title, document.FilePath, document.FileEncoding, content.Svg);
                    document.RecoveredRevision = content.Revision;
                    document.RecoveredSvg = content.Svg;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    LogFileFailed("guardar la copia de recuperación de", document.Title, FileErrorKind.Other, ex.Message);
                }
            }
        }
        finally
        {
            Volatile.Write(ref _autosaving, 0);
        }
    }

    /// <summary>
    /// Al arrancar: si una ejecución anterior terminó de forma inesperada con documentos sin guardar,
    /// pregunta si recuperarlos y los abre con sus cambios. Las copias se borran en los dos casos.
    /// </summary>
    /// <returns>Los documentos recuperados.</returns>
    public async Task<IReadOnlyList<DocumentTabViewModel>> OfferRecoveryAsync()
    {
        if (_recovery is null)
        {
            return [];
        }

        var orphans = _recovery.FindOrphans();
        if (orphans.Count == 0)
        {
            _recovery.DiscardOrphans();
            return [];
        }

        var recovered = new List<DocumentTabViewModel>();
        if (await _dialogs.AskToRecoverAsync(orphans.Select(orphan => orphan.Title).ToList()))
        {
            var pristine = Documents.Count == 1 && Documents[0].IsPristine ? Documents[0] : null;
            foreach (var orphan in orphans)
            {
                recovered.Add(AddDocument(orphan.Title, orphan.Svg, orphan.FilePath, orphan.Encoding, isNewBlank: false, loadsModified: true));
            }

            if (pristine is not null && pristine.IsPristine && Documents.Contains(pristine))
            {
                CloseDocument(pristine);
            }
        }

        _recovery.DiscardOrphans();
        // Los documentos recuperados tienen cambios: su copia se guarda ya en esta sesión.
        await AutosaveAsync();
        return recovered;
    }

    /// <summary>
    /// El proceso del lienzo ha fallado. Si la interfaz lo va a recargar (<paramref name="reloading"/>),
    /// los documentos se cargarán de nuevo desde su última copia de recuperación, con sus cambios sin
    /// guardar; si no, se avisa de que hay que reiniciar (las copias se ofrecerán al volver a abrir).
    /// </summary>
    public void OnEngineFailed(bool reloading)
    {
        IsEngineReady = false;
        EngineStatus = _texts.EngineFailedTitle;
        _engineWork = Task.CompletedTask;
        foreach (var document in Documents)
        {
            if (document.RecoveredSvg is { } svg)
            {
                document.ReplaceInitialSvg(svg);
            }

            document.LoadsModified = document.IsModified;
            document.IsLoaded = false;
            document.History = DocumentHistory.Empty;
            document.RecoveredRevision = null;
        }

        NotifyEditCommandsChanged();
        _ = _dialogs.ShowErrorAsync(_texts.EngineFailedTitle, reloading ? _texts.EngineReloaded : _texts.EngineRestartNeeded);
    }

    private void ForgetRecovery(DocumentTabViewModel document)
    {
        if (document.RecoveredRevision is null && document.RecoveredSvg is null)
        {
            return;
        }

        document.RecoveredRevision = null;
        document.RecoveredSvg = null;
        _recovery?.Delete(document.RecoveryKey);
    }

    /// <summary>Pide al motor el texto actual de un documento, por ejemplo para guardarlo.</summary>
    /// <exception cref="BridgeException">El motor no está disponible o no conoce el documento.</exception>
    public async Task<DocumentContent> SerializeAsync(DocumentTabViewModel document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var bridge = _bridge ?? throw new BridgeException(BridgeErrorCode.Internal, "El motor no está conectado.");
        await _engineWork.ConfigureAwait(false);
        return await bridge.SendAsync(BridgeCommands.DocumentSerialize, new DocumentRef(document.DocumentId), DocumentCommandTimeout).ConfigureAwait(false);
    }

    /// <summary>Deshace el último paso del documento activo.</summary>
    /// <remarks>
    /// Se admiten pulsaciones seguidas antes de que el motor conteste: cada una se encola y deshace un
    /// paso más; si ya no queda nada, el motor no hace nada.
    /// </remarks>
    [RelayCommand(CanExecute = nameof(CanUndo), AllowConcurrentExecutions = true)]
    public Task UndoAsync() => StepHistoryAsync(BridgeCommands.HistoryUndo);

    /// <summary>Rehace el último paso deshecho del documento activo.</summary>
    [RelayCommand(CanExecute = nameof(CanRedo), AllowConcurrentExecutions = true)]
    public Task RedoAsync() => StepHistoryAsync(BridgeCommands.HistoryRedo);

    /// <summary>Selecciona todos los objetos del grupo actual del documento activo.</summary>
    /// <remarks>
    /// Con el lienzo enfocado, el motor atiende Ctrl+A por su cuenta; el menú no lleva el atajo para
    /// no quitárselo a los cuadros de texto de la ventana.
    /// </remarks>
    [RelayCommand(CanExecute = nameof(CanSelectAll))]
    public Task SelectAllAsync()
    {
        if (SelectedDocument is not { IsLoaded: true } document)
        {
            return Task.CompletedTask;
        }

        Enqueue(() => SendAsync(BridgeCommands.SelectionSelectAll, new DocumentRef(document.DocumentId)));
        return _engineWork;
    }

    /// <summary>True si el documento activo está cargado en el motor.</summary>
    public bool CanSelectAll => SelectedDocument is { IsLoaded: true };

    [RelayCommand(CanExecute = nameof(CanSelectAll), AllowConcurrentExecutions = true)]
    public Task ZoomInAsync() => ZoomAsync(ZoomAction.In);

    [RelayCommand(CanExecute = nameof(CanSelectAll), AllowConcurrentExecutions = true)]
    public Task ZoomOutAsync() => ZoomAsync(ZoomAction.Out);

    [RelayCommand(CanExecute = nameof(CanSelectAll), AllowConcurrentExecutions = true)]
    public Task ZoomFitAsync() => ZoomAsync(ZoomAction.Fit);

    [RelayCommand(CanExecute = nameof(CanSelectAll), AllowConcurrentExecutions = true)]
    public Task ZoomActualAsync() => ZoomAsync(ZoomAction.Actual);

    private Task ZoomAsync(ZoomAction action)
    {
        if (SelectedDocument is not { IsLoaded: true } document)
        {
            return Task.CompletedTask;
        }

        Enqueue(async () =>
        {
            if (await SendAsync(BridgeCommands.ViewZoom, new ViewZoom(document.DocumentId, action)) is { } state)
            {
                OnViewportChanged(state);
            }
        });
        return _engineWork;
    }

    /// <summary>Cambia la herramienta activa del lienzo.</summary>
    public Task SelectToolAsync(ToolName tool)
    {
        ActiveTool = tool;
        if (!IsEngineReady)
        {
            return Task.CompletedTask;
        }

        Enqueue(() => SendAsync(BridgeCommands.ToolSelect, new ToolState(tool)));
        return _engineWork;
    }

    /// <summary>
    /// Cambia la mesa de trabajo del documento activo con lo escrito en el editor. Se puede deshacer.
    /// </summary>
    /// <returns>False si algún valor no es válido; entonces no se cambia nada.</returns>
    public bool ApplyArtboard(string? width, string? height, string? viewBox)
    {
        if (SelectedDocument is not { IsLoaded: true } document
            || !ArtboardInput.TryParse(document.DocumentId, width, height, viewBox, out var artboard)
            || artboard is null)
        {
            // El editor vuelve a mostrar los valores actuales.
            OnPropertyChanged(nameof(CurrentArtboard));
            return false;
        }

        if (artboard == document.Artboard)
        {
            return true;
        }

        Enqueue(async () =>
        {
            if (await SendAsync(BridgeCommands.ArtboardSet, artboard) is { } applied)
            {
                OnArtboardChanged(applied);
            }
        });
        return true;
    }

    /// <summary>
    /// Ejecuta un atajo de teclado que el motor ha recibido con el lienzo enfocado. Con el lienzo
    /// enfocado, los aceleradores de los menús no se disparan; el motor atiende los suyos (deshacer,
    /// zoom, seleccionar todo) y envía aquí los de la ventana.
    /// </summary>
    /// <returns>False si el atajo no corresponde a ninguna orden.</returns>
    public async Task<bool> HandleShortcutAsync(KeyboardShortcut shortcut)
    {
        ArgumentNullException.ThrowIfNull(shortcut);
        if (!shortcut.CtrlKey || shortcut.AltKey)
        {
            return false;
        }

        switch (shortcut.Key, shortcut.ShiftKey)
        {
            case ("n", false):
                NewDocument();
                break;
            case ("n", true):
                await NewDocumentWithSizeAsync();
                break;
            case ("o", false):
                await OpenAsync();
                break;
            case ("s", false):
                await SaveAsync();
                break;
            case ("s", true):
                await SaveAsAsync();
                break;
            case ("w", false):
                await RequestCloseDocumentAsync(SelectedDocument);
                break;
            case ("r", false):
                ShowRulers = !ShowRulers;
                break;
            case ("k", false):
                CommandPaletteRequested?.Invoke(this, EventArgs.Empty);
                break;
            case ("c", false):
                await CopyAsync();
                break;
            case ("x", false):
                await CutAsync();
                break;
            case ("v", false):
                await PasteAsync();
                break;
            default:
                return false;
        }

        return true;
    }

    partial void OnShowRulersChanged(bool value) => SendViewOptions();

    partial void OnShowGridChanged(bool value) => SendViewOptions();

    partial void OnSnapToGridChanged(bool value) => SendViewOptions();

    private void SendViewOptions()
    {
        if (IsEngineReady)
        {
            var options = new ViewOptions(ShowRulers, ShowGrid, SnapToGrid);
            Enqueue(() => SendAsync(BridgeCommands.ViewSetOptions, options));
        }
    }

    /// <summary>
    /// Cambia un valor del panel de propiedades: mueve, redimensiona o gira la selección en el motor,
    /// en un paso que se puede deshacer. Solo se envía el campo que cambia (y el alto o el ancho con
    /// la proporción bloqueada), para que el redondeo de los demás no mueva nada.
    /// </summary>
    /// <returns>False si el valor no es válido o no cambia nada; el panel vuelve a mostrar el actual.</returns>
    public bool SetSelectionGeometry(GeometryField field, double value)
    {
        var current = field switch
        {
            GeometryField.X => SelectionX,
            GeometryField.Y => SelectionY,
            GeometryField.Width => SelectionWidth,
            GeometryField.Height => SelectionHeight,
            _ => SelectionRotation,
        };
        var invalid = !double.IsFinite(value)
            || double.IsNaN(current)
            || (field is GeometryField.Width or GeometryField.Height && value <= 0);
        if (invalid || Math.Abs(value - current) < 1e-9
            || SelectedDocument is not { IsLoaded: true } document || _selectionBounds is not { } bounds)
        {
            RefreshGeometry();
            return false;
        }

        double? width = field == GeometryField.Width ? value : null;
        double? height = field == GeometryField.Height ? value : null;
        if (LockAspectRatio && bounds.Width > 0 && bounds.Height > 0)
        {
            height ??= width * bounds.Height / bounds.Width;
            width ??= height * bounds.Width / bounds.Height;
        }

        var geometry = new SelectionGeometry(
            document.DocumentId,
            field == GeometryField.X ? value : null,
            field == GeometryField.Y ? value : null,
            width,
            height,
            field == GeometryField.Rotation ? value : null);
        Enqueue(() => SendAsync(BridgeCommands.SelectionSetGeometry, geometry));
        return true;
    }

    /// <summary>Cambia el relleno de la selección: "none" o un color "#rrggbb".</summary>
    /// <returns>False si el valor no es válido o no hay nada seleccionado.</returns>
    public bool SetSelectionFill(string paint) => SendStyle(fill: NormalizePaint(paint));

    /// <summary>Cambia el trazo de la selección: "none" o un color "#rrggbb".</summary>
    public bool SetSelectionStroke(string paint) => SendStyle(stroke: NormalizePaint(paint));

    /// <summary>Cambia el grosor del trazo de la selección (0 o más).</summary>
    public bool SetSelectionStrokeWidth(double width)
    {
        if (!double.IsFinite(width) || width < 0 || Math.Abs(width - SelectionStrokeWidth) < 1e-9)
        {
            OnPropertyChanged(nameof(SelectionStrokeWidth));
            return false;
        }

        return SendStyle(strokeWidth: width);
    }

    /// <summary>Cambia la opacidad de la selección, en porcentaje (0 a 100).</summary>
    public bool SetSelectionOpacityPercent(double percent)
    {
        if (!double.IsFinite(percent) || percent < 0 || percent > 100 || Math.Abs(percent - SelectionOpacityPercent) < 1e-9)
        {
            OnPropertyChanged(nameof(SelectionOpacityPercent));
            return false;
        }

        return SendStyle(opacity: percent / 100);
    }

    /// <summary>Recuerda un color usado: va el primero de los recientes, sin repetirse.</summary>
    public void RememberColor(string color)
    {
        if (NormalizePaint(color) is not { } hex || hex == "none")
        {
            return;
        }

        RecentColors.Remove(hex);
        RecentColors.Insert(0, hex);
        while (RecentColors.Count > RecentColorsLimit)
        {
            RecentColors.RemoveAt(RecentColors.Count - 1);
        }
    }

    /// <summary>"none" o un color "#rrggbb" en minúsculas; null si no es válido.</summary>
    public static string? NormalizePaint(string? paint)
    {
        var value = paint?.Trim().ToLowerInvariant();
        if (value == "none")
        {
            return value;
        }

        if (value is { Length: 4 } && value[0] == '#' && value[1..].All(Uri.IsHexDigit))
        {
            // #abc → #aabbcc
            return string.Concat("#", value[1], value[1], value[2], value[2], value[3], value[3]);
        }

        return value is { Length: 7 } && value[0] == '#' && value[1..].All(Uri.IsHexDigit) ? value : null;
    }

    private bool SendStyle(string? fill = null, string? stroke = null, double? strokeWidth = null, double? opacity = null)
    {
        if (SelectedDocument is not { IsLoaded: true } document || !HasSelection
            || (fill is null && stroke is null && strokeWidth is null && opacity is null))
        {
            return false;
        }

        var change = new StyleChange(document.DocumentId, fill, stroke, strokeWidth, opacity);
        Enqueue(() => SendAsync(BridgeCommands.SelectionSetStyle, change));
        return true;
    }

    private void ShowStyle(SelectionStyle? style)
    {
        SelectionFill = style?.Fill;
        SelectionStroke = style?.Stroke;
        SelectionStrokeWidth = style?.StrokeWidth is { } width ? Math.Round(width, 2) : double.NaN;
        SelectionOpacityPercent = style?.Opacity is { } opacity ? Math.Round(opacity * 100, 1) : double.NaN;
    }

    /// <summary>Vuelve a anunciar los valores del panel, para que descarte lo escrito.</summary>
    private void RefreshGeometry()
    {
        OnPropertyChanged(nameof(SelectionX));
        OnPropertyChanged(nameof(SelectionY));
        OnPropertyChanged(nameof(SelectionWidth));
        OnPropertyChanged(nameof(SelectionHeight));
        OnPropertyChanged(nameof(SelectionRotation));
    }

    private void ShowGeometry(Rect? bounds, double? rotation)
    {
        _selectionBounds = bounds;
        SelectionX = bounds is null ? double.NaN : Math.Round(bounds.X, 2);
        SelectionY = bounds is null ? double.NaN : Math.Round(bounds.Y, 2);
        SelectionWidth = bounds is null ? double.NaN : Math.Round(bounds.Width, 2);
        SelectionHeight = bounds is null ? double.NaN : Math.Round(bounds.Height, 2);
        SelectionRotation = rotation is { } degrees ? Math.Round(degrees, 2) : double.NaN;
    }

    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task BringToFrontAsync() => ArrangeAsync(ArrangeAction.Front);

    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task BringForwardAsync() => ArrangeAsync(ArrangeAction.Forward);

    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task SendBackwardAsync() => ArrangeAsync(ArrangeAction.Backward);

    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task SendToBackAsync() => ArrangeAsync(ArrangeAction.Back);

    /// <summary>Agrupa la selección sin cambiar su aspecto.</summary>
    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task GroupAsync() => SelectionCommandAsync(BridgeCommands.ObjectGroup);

    /// <summary>Desagrupa los grupos seleccionados que se pueden desagrupar sin cambiar su aspecto.</summary>
    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task UngroupAsync() => SelectionCommandAsync(BridgeCommands.ObjectUngroup);

    /// <summary>Copia la selección al portapapeles como SVG, con las definiciones que usa.</summary>
    /// <remarks>
    /// Cortar, copiar y pegar no llevan acelerador en el menú, para no quitarles Ctrl+C, Ctrl+X y Ctrl+V
    /// a los cuadros de texto. Con el lienzo enfocado, el motor reenvía esos atajos a la aplicación.
    /// </remarks>
    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task CopyAsync() => CopyToClipboardAsync(cut: false);

    /// <summary>Copia la selección al portapapeles y la elimina.</summary>
    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task CutAsync() => CopyToClipboardAsync(cut: true);

    /// <summary>Pega el SVG del portapapeles (de WinVector o de otra aplicación) en el documento activo.</summary>
    [RelayCommand(CanExecute = nameof(CanSelectAll))]
    public async Task PasteAsync()
    {
        if (SelectedDocument is not { IsLoaded: true } document || await _clipboard.GetSvgAsync() is not { } svg)
        {
            return;
        }

        Enqueue(() => SendAsync(BridgeCommands.ClipboardPaste, new ClipboardPaste(document.DocumentId, svg), DocumentCommandTimeout));
        await _engineWork;
    }

    /// <summary>Duplica la selección junto al original.</summary>
    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task DuplicateAsync() => SelectionCommandAsync(BridgeCommands.SelectionDuplicate);

    /// <summary>Elimina la selección.</summary>
    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task DeleteAsync() => SelectionCommandAsync(BridgeCommands.SelectionDelete);

    private Task CopyToClipboardAsync(bool cut)
    {
        if (SelectedDocument is not { IsLoaded: true } document)
        {
            return Task.CompletedTask;
        }

        var reference = new DocumentRef(document.DocumentId);
        Enqueue(async () =>
        {
            if (await SendAsync(BridgeCommands.ClipboardCopy, reference, DocumentCommandTimeout) is not { Svg: { } svg })
            {
                return;
            }

            await _clipboard.SetSvgAsync(svg);
            if (cut)
            {
                await SendAsync(BridgeCommands.SelectionDelete, reference);
            }
        });
        return _engineWork;
    }

    private Task ArrangeAsync(ArrangeAction action)
    {
        if (SelectedDocument is not { IsLoaded: true } document)
        {
            return Task.CompletedTask;
        }

        Enqueue(() => SendAsync(BridgeCommands.ObjectArrange, new ObjectArrange(document.DocumentId, action)));
        return _engineWork;
    }

    /// <summary>Envía al motor un comando sobre la selección del documento activo.</summary>
    private Task SelectionCommandAsync<TResponse>(BridgeCommand<DocumentRef, TResponse> command)
        where TResponse : class
    {
        if (SelectedDocument is not { IsLoaded: true } document)
        {
            return Task.CompletedTask;
        }

        Enqueue(() => SendAsync(command, new DocumentRef(document.DocumentId)));
        return _engineWork;
    }

    partial void OnHasSelectionChanged(bool value)
    {
        BringToFrontCommand.NotifyCanExecuteChanged();
        BringForwardCommand.NotifyCanExecuteChanged();
        SendBackwardCommand.NotifyCanExecuteChanged();
        SendToBackCommand.NotifyCanExecuteChanged();
        GroupCommand.NotifyCanExecuteChanged();
        UngroupCommand.NotifyCanExecuteChanged();
        CopyCommand.NotifyCanExecuteChanged();
        CutCommand.NotifyCanExecuteChanged();
        DuplicateCommand.NotifyCanExecuteChanged();
        DeleteCommand.NotifyCanExecuteChanged();
    }

    private Task StepHistoryAsync(BridgeCommand<DocumentRef, HistoryState> command)
    {
        if (SelectedDocument is not { IsLoaded: true } document)
        {
            return Task.CompletedTask;
        }

        Enqueue(async () =>
        {
            if (await SendAsync(command, new DocumentRef(document.DocumentId)) is { } state)
            {
                OnHistoryChanged(state);
            }
        });
        return _engineWork;
    }

    /// <summary>
    /// Conecta el modelo de vista con el motor. Devuelve un objeto que, al descartarse, deja de
    /// recibir sus eventos.
    /// </summary>
    public IDisposable AttachBridge(BridgeClient bridge)
    {
        ArgumentNullException.ThrowIfNull(bridge);
        _bridge = bridge;
        var subscriptions = new[]
        {
            bridge.Subscribe(BridgeEvents.EngineReady, OnEngineReady),
            bridge.Subscribe(BridgeEvents.SelectionChanged, OnSelectionChanged),
            bridge.Subscribe(BridgeEvents.DocumentChanged, OnDocumentChanged),
            bridge.Subscribe(BridgeEvents.HistoryChanged, OnHistoryChanged),
            bridge.Subscribe(BridgeEvents.ViewportChanged, OnViewportChanged),
            bridge.Subscribe(BridgeEvents.ToolChanged, OnToolChanged),
            bridge.Subscribe(BridgeEvents.ArtboardChanged, OnArtboardChanged),
            bridge.Subscribe(BridgeEvents.KeyboardShortcut, shortcut => _ = HandleShortcutAsync(shortcut)),
        };
        return new CompositeSubscription(subscriptions, () =>
        {
            if (ReferenceEquals(_bridge, bridge))
            {
                _bridge = null;
                IsEngineReady = false;
            }
        });
    }

    partial void OnSelectedDocumentChanged(DocumentTabViewModel? value)
    {
        SelectionSummary = string.Empty;
        HasSelection = false;
        ShowGeometry(null, null);
        ShowStyle(null);
        ShowShape(null);
        OnPropertyChanged(nameof(ZoomText));
        OnPropertyChanged(nameof(CurrentArtboard));
        NotifyEditCommandsChanged();
        if (value is not null && IsEngineReady)
        {
            Enqueue(() => ActivateAsync(value));
        }
    }

    private void OnEngineReady(EngineReady ready)
    {
        if (ready.ProtocolVersion != BridgeProtocol.Version)
        {
            IsEngineReady = false;
            EngineStatus = _texts.ProtocolMismatch(ready.ProtocolVersion, BridgeProtocol.Version);
            LogProtocolMismatch(ready.EngineVersion, ready.ProtocolVersion, BridgeProtocol.Version);
            return;
        }

        IsEngineReady = true;
        EngineStatus = string.Empty;
        LogEngineReady(ready.EngineVersion, ready.ProtocolVersion);

        // El motor empieza con sus valores por defecto: recibe los de la aplicación.
        Enqueue(() => SendAsync(BridgeCommands.ViewSetOptions, new ViewOptions(ShowRulers, ShowGrid, SnapToGrid)));
        if (ActiveTool != ToolName.Select)
        {
            Enqueue(() => SendAsync(BridgeCommands.ToolSelect, new ToolState(ActiveTool)));
        }

        // Las pestañas abiertas antes de que el motor estuviera listo se cargan ahora.
        foreach (var document in Documents.ToArray())
        {
            Enqueue(() => LoadAsync(document));
        }

        if (SelectedDocument is { } selected)
        {
            Enqueue(() => ActivateAsync(selected));
        }

        if (_bridge is { } bridge)
        {
            LatencyMeasurement = MeasureLatencyAsync(bridge);
        }
    }

    private async Task LoadAsync(DocumentTabViewModel document)
    {
        if (!Documents.Contains(document))
        {
            return;
        }

        var result = await SendAsync(
            BridgeCommands.DocumentLoad,
            new DocumentLoad(document.DocumentId, document.Title, document.InitialSvg),
            DocumentCommandTimeout);
        if (result is null)
        {
            return;
        }

        document.IsLoaded = result.Loaded;
        document.LoadError = result.Error?.Message;
        document.Revision = result.Revision;
        // Un documento recuperado tiene cambios sin guardar respecto a su archivo.
        document.SavedRevision = document.LoadsModified ? result.Revision - 1 : result.Revision;
        document.History = DocumentHistory.Empty;
        if (ReferenceEquals(document, SelectedDocument))
        {
            NotifyEditCommandsChanged();
        }

        if (!result.Loaded)
        {
            LogLoadFailed(document.DocumentId, result.Error?.Message ?? string.Empty);
            if (document.FilePath is not null)
            {
                // Un archivo que no es un SVG válido no se queda abierto: se explica por qué.
                CloseDocument(document);
                _ = _dialogs.ShowErrorAsync(_texts.OpenFailedTitle, _texts.InvalidSvg(document.Title, result.Error?.Message ?? string.Empty));
            }
        }
    }

    private async Task ActivateAsync(DocumentTabViewModel document)
    {
        if (document.IsLoaded && ReferenceEquals(document, SelectedDocument))
        {
            await SendAsync(BridgeCommands.DocumentActivate, new DocumentRef(document.DocumentId));
        }
    }

    /// <summary>Envía un comando; si falla, lo registra y devuelve null.</summary>
    private async Task<TResponse?> SendAsync<TPayload, TResponse>(
        BridgeCommand<TPayload, TResponse> command,
        TPayload payload,
        TimeSpan? timeout = null)
        where TResponse : class
    {
        if (_bridge is not { } bridge)
        {
            return null;
        }

        try
        {
            return await bridge.SendAsync(command, payload, timeout);
        }
        catch (BridgeException ex)
        {
            LogCommandFailed(command.Name, ex.Code, ex.Message);
            return null;
        }
    }

    private void Enqueue(Func<Task> work)
    {
        var previous = _engineWork;
        _engineWork = RunAfterAsync(previous, work);
    }

    private static async Task RunAfterAsync(Task previous, Func<Task> work)
    {
        await previous;
        await work();
    }

    /// <summary>Intentos de medir la latencia: en un equipo lento, el primer ping puede perderse mientras carga el motor.</summary>
    internal const int PingAttempts = 3;

    private async Task MeasureLatencyAsync(BridgeClient bridge)
    {
        for (var attempt = 1; attempt <= PingAttempts; attempt++)
        {
            var start = _time.GetTimestamp();
            try
            {
                await bridge.SendAsync(BridgeCommands.AppPing, new AppPing(_time.GetUtcNow().ToUnixTimeMilliseconds()));
                BridgeLatency = _time.GetElapsedTime(start);
                LogLatency(BridgeLatency.Value.TotalMilliseconds);
                return;
            }
            catch (BridgeException ex)
            {
                BridgeLatency = null;
                LogPingFailed(ex.Code, ex.Message);
            }
        }
    }

    private void OnSelectionChanged(SelectionChanged selection)
    {
        if (selection.DocumentId != SelectedDocument?.DocumentId)
        {
            return;
        }

        HasSelection = selection.Items.Count > 0;
        ShowGeometry(selection.Bounds, selection.Items.Count == 1 ? selection.Rotation : null);
        ShowStyle(selection.Items.Count > 0 ? selection.Style : null);
        ShowShape(selection.Items.Count == 1 ? selection.Shape : null);
        var items = selection.Items.Count switch
        {
            0 => string.Empty,
            1 => Describe(selection.Items[0]),
            var count => _texts.MultipleSelection(count),
        };
        SelectionSummary = selection.Scope is { } group ? _texts.SelectionInGroup(items, Describe(group)) : items;
    }

    private void OnDocumentChanged(DocumentState state)
    {
        var document = Documents.FirstOrDefault(d => d.DocumentId == state.DocumentId);
        if (document is not null)
        {
            document.Revision = state.Revision;
        }
    }

    private void OnViewportChanged(ViewportChanged state)
    {
        if (Documents.FirstOrDefault(d => d.DocumentId == state.DocumentId) is not { } document)
        {
            return;
        }

        document.Zoom = state.Zoom;
        if (ReferenceEquals(document, SelectedDocument))
        {
            OnPropertyChanged(nameof(ZoomText));
        }
    }

    private void OnToolChanged(ToolState state) => ActiveTool = state.Tool;

    private void OnArtboardChanged(Artboard artboard)
    {
        if (Documents.FirstOrDefault(d => d.DocumentId == artboard.DocumentId) is not { } document)
        {
            return;
        }

        document.Artboard = artboard;
        if (ReferenceEquals(document, SelectedDocument))
        {
            OnPropertyChanged(nameof(CurrentArtboard));
        }
    }

    private void OnHistoryChanged(HistoryState state)
    {
        var document = Documents.FirstOrDefault(d => d.DocumentId == state.DocumentId);
        if (document is null)
        {
            return;
        }

        document.History = DocumentHistory.From(state);
        if (ReferenceEquals(document, SelectedDocument))
        {
            NotifyEditCommandsChanged();
        }
    }

    /// <summary>Actualiza las órdenes del menú Editar con el estado del documento activo.</summary>
    private void NotifyEditCommandsChanged()
    {
        OnPropertyChanged(nameof(CanUndo));
        OnPropertyChanged(nameof(CanRedo));
        OnPropertyChanged(nameof(UndoLabel));
        OnPropertyChanged(nameof(RedoLabel));
        OnPropertyChanged(nameof(CanSelectAll));
        OnPropertyChanged(nameof(ZoomText));
        UndoCommand.NotifyCanExecuteChanged();
        RedoCommand.NotifyCanExecuteChanged();
        SelectAllCommand.NotifyCanExecuteChanged();
        PasteCommand.NotifyCanExecuteChanged();
        ZoomInCommand.NotifyCanExecuteChanged();
        ZoomOutCommand.NotifyCanExecuteChanged();
        ZoomFitCommand.NotifyCanExecuteChanged();
        ZoomActualCommand.NotifyCanExecuteChanged();
    }

    private static string Describe(SelectedElement element) =>
        element.Id is null ? element.TagName : $"{element.TagName}#{element.Id}";

    [LoggerMessage(Level = LogLevel.Information, Message = "Motor {EngineVersion} listo (protocolo {ProtocolVersion})")]
    private partial void LogEngineReady(string engineVersion, int protocolVersion);

    [LoggerMessage(Level = LogLevel.Error, Message = "El motor {EngineVersion} usa el protocolo {EngineProtocol} y la aplicación el {AppProtocol}")]
    private partial void LogProtocolMismatch(string engineVersion, int engineProtocol, int appProtocol);

    [LoggerMessage(Level = LogLevel.Information, Message = "Latencia del puente (app.ping, ida y vuelta): {LatencyMs:0.00} ms")]
    private partial void LogLatency(double latencyMs);

    [LoggerMessage(Level = LogLevel.Warning, Message = "No se pudo medir la latencia del puente ({Code}): {Reason}")]
    private partial void LogPingFailed(BridgeErrorCode code, string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "El documento {DocumentId} no se pudo cargar: {Reason}")]
    private partial void LogLoadFailed(string documentId, string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "No se pudo {Operation} {Path} ({Kind}): {Reason}")]
    private partial void LogFileFailed(string operation, string path, FileErrorKind kind, string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falló el comando {Command} ({Code}): {Reason}")]
    private partial void LogCommandFailed(string command, BridgeErrorCode code, string reason);

    /// <summary>Diálogos que no preguntan nada: para pruebas y usos sin interfaz.</summary>
    private sealed class NoDialogs : IShellDialogs
    {
        public static readonly NoDialogs Instance = new();

        public Task<string?> PickFileToOpenAsync() => Task.FromResult<string?>(null);

        public Task<string?> PickFileToSaveAsync(string suggestedFileName) => Task.FromResult<string?>(null);

        public Task<UnsavedChangesChoice> AskToSaveChangesAsync(string documentName) => Task.FromResult(UnsavedChangesChoice.Cancel);

        public Task<DocumentSize?> AskNewDocumentSizeAsync() => Task.FromResult<DocumentSize?>(null);

        public Task ShowErrorAsync(string title, string message) => Task.CompletedTask;

        public Task<bool> AskToRecoverAsync(IReadOnlyList<string> documentNames) => Task.FromResult(false);
    }

    /// <summary>Portapapeles en memoria: para pruebas y usos sin interfaz.</summary>
    private sealed class MemoryClipboard : IShellClipboard
    {
        private string? _svg;

        public Task SetSvgAsync(string svg)
        {
            _svg = svg;
            return Task.CompletedTask;
        }

        public Task<string?> GetSvgAsync() => Task.FromResult(_svg);
    }

    private sealed class MemoryRecentFilesStore : IRecentFilesStore
    {
        public IReadOnlyList<string> Load() => [];

        public void Save(IReadOnlyList<string> paths)
        {
        }
    }

    private sealed class CompositeSubscription(IDisposable[] subscriptions, Action onDispose) : IDisposable
    {
        public void Dispose()
        {
            foreach (var subscription in subscriptions)
            {
                subscription.Dispose();
            }

            onDispose();
        }
    }
}

/// <summary>Campo del panel de propiedades de la selección.</summary>
public enum GeometryField
{
    X,
    Y,
    Width,
    Height,
    Rotation,
}
