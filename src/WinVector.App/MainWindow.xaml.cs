using System.Globalization;
using System.Reflection;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.Windows.ApplicationModel.Resources;
using Windows.ApplicationModel.DataTransfer;
using Windows.Graphics;
using Windows.Storage;
using WinVector.App.Shell;
using WinVector.Core.Files;
using WinVector.Core.Shell;

namespace WinVector.App;

/// <summary>
/// Ventana principal con la distribución "Estudio clásico".
/// </summary>
public sealed partial class MainWindow : Window
{
    private const int InitialWidth = 1280;
    private const int InitialHeight = 800;
    private const int MinimumWidth = 800;
    private const int MinimumHeight = 500;

    // Espacio extra a la derecha de las pestañas para poder arrastrar la ventana.
    private const double DragRegionExtraWidth = 48;

    private readonly ResourceLoader _resources = new();
    private readonly WinUIShellDialogs _dialogs;
    private IDisposable? _bridgeAttachment;
    private bool _closeConfirmed;

    public MainWindow()
    {
        _dialogs = new WinUIShellDialogs(this, _resources);
        ViewModel = new MainViewModel(
            new ResourceShellTexts(_resources),
            _dialogs,
            new RecentFiles(new TextFileRecentFilesStore(Path.Combine(AppDataFolder(), "archivos-recientes.txt"))),
            App.Logging.CreateLogger<MainViewModel>());

        InitializeComponent();

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBarDragRegion);
        AppWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Tall;
        PlaceWindow();
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.PreferredMinimumWidth = MinimumWidth;
            presenter.PreferredMinimumHeight = MinimumHeight;
        }

        EngineCanvas.BridgeCreated += (_, bridge) =>
        {
            _bridgeAttachment?.Dispose();
            _bridgeAttachment = ViewModel.AttachBridge(bridge);
        };
        EngineCanvas.FilesDropped += async (_, paths) => await OpenFilesAsync(paths);
        Closed += (_, _) =>
        {
            _bridgeAttachment?.Dispose();
            _dialogs.Dispose();
        };
        AppWindow.Closing += OnAppWindowClosing;

        ViewModel.RecentFiles.Items.CollectionChanged += (_, _) => RebuildRecentFilesMenu();
        RebuildRecentFilesMenu();

#if DEBUG
        // La latencia del puente solo interesa durante el desarrollo.
        LatencyStatusText.Visibility = Visibility.Visible;
#endif

        RootGrid.Loaded += (_, _) => UpdateTitleBarInsets();
        RootGrid.SizeChanged += (_, _) => UpdateTitleBarInsets();
        UpdateToolStatus(ToolRail.Children.OfType<ToggleButton>().FirstOrDefault(b => b.IsChecked == true));
    }

    public MainViewModel ViewModel { get; }

    private string Format(string resource, params object[] values) =>
        string.Format(CultureInfo.CurrentCulture, _resources.GetString(resource), values);

    /// <summary>Texto de la primera columna de la barra de estado: el aviso del motor o "Listo".</summary>
    private string EngineStatusText(string engineStatus) =>
        string.IsNullOrEmpty(engineStatus) ? _resources.GetString("StatusReady") : engineStatus;

    private string LatencyText(TimeSpan? latency) =>
        latency is { } value ? Format("StatusBridgeLatency", value.TotalMilliseconds.ToString("0.0", CultureInfo.CurrentCulture)) : string.Empty;

    /// <summary>Tamaño inicial sin superar el 90 % del área de trabajo de la pantalla, y centrada.</summary>
    private void PlaceWindow()
    {
        var workArea = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        var width = Math.Min(InitialWidth, (int)(workArea.Width * 0.9));
        var height = Math.Min(InitialHeight, (int)(workArea.Height * 0.9));
        AppWindow.MoveAndResize(new RectInt32(
            workArea.X + ((workArea.Width - width) / 2),
            workArea.Y + ((workArea.Height - height) / 2),
            width,
            height));
    }

    /// <summary>
    /// Deja sitio a los botones de la barra de título (minimizar, maximizar, cerrar), que Windows
    /// dibuja encima del contenido cuando este se extiende a la barra de título.
    /// </summary>
    private void UpdateTitleBarInsets()
    {
        var scale = RootGrid.XamlRoot?.RasterizationScale ?? 1.0;
        TitleBarHeader.Margin = new Thickness(AppWindow.TitleBar.LeftInset / scale, 0, 0, 0);
        TitleBarDragRegion.MinWidth = (AppWindow.TitleBar.RightInset / scale) + DragRegionExtraWidth;
    }

    private void OnDocumentTabsSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (DocumentTabs.SelectedItem is DocumentTabViewModel document)
        {
            ViewModel.SelectedDocument = document;
        }
    }

    private void OnAddTabButtonClick(TabView sender, object args) => ViewModel.NewDocument();

    private async void OnTabCloseRequested(TabView sender, TabViewTabCloseRequestedEventArgs args) =>
        await ViewModel.RequestCloseDocumentAsync(args.Item as DocumentTabViewModel);

    private async void OnCloseTabClick(object sender, RoutedEventArgs e) =>
        await ViewModel.RequestCloseDocumentAsync(ViewModel.SelectedDocument);

    private async void OnExitClick(object sender, RoutedEventArgs e)
    {
        if (await ViewModel.RequestCloseAllAsync())
        {
            _closeConfirmed = true;
            Close();
        }
    }

    /// <summary>Abre los archivos SVG indicados, por ejemplo los que llegan al arrancar desde el Explorador.</summary>
    public async Task OpenFilesAsync(IEnumerable<string> paths)
    {
        foreach (var path in paths.Where(p => p.EndsWith(".svg", StringComparison.OrdinalIgnoreCase)))
        {
            await ViewModel.OpenFileAsync(path);
        }
    }

    /// <summary>Al cerrar con cambios sin guardar, pregunta antes por cada documento.</summary>
    private async void OnAppWindowClosing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (_closeConfirmed || !ViewModel.Documents.Any(d => d.IsModified))
        {
            return;
        }

        args.Cancel = true;
        if (await ViewModel.RequestCloseAllAsync())
        {
            _closeConfirmed = true;
            Close();
        }
    }

    private void OnDragOver(object sender, DragEventArgs e)
    {
        if (e.DataView.Contains(StandardDataFormats.StorageItems))
        {
            e.AcceptedOperation = DataPackageOperation.Copy;
        }
    }

    private async void OnDrop(object sender, DragEventArgs e)
    {
        if (e.DataView.Contains(StandardDataFormats.StorageItems))
        {
            var items = await e.DataView.GetStorageItemsAsync();
            await OpenFilesAsync(items.OfType<StorageFile>().Select(file => file.Path));
        }
    }

    /// <summary>Submenú Archivos recientes: un elemento por archivo y la opción de borrar la lista.</summary>
    private void RebuildRecentFilesMenu()
    {
        RecentFilesMenu.Items.Clear();
        foreach (var path in ViewModel.RecentFiles.Items)
        {
            var item = new MenuFlyoutItem { Text = Path.GetFileName(path) };
            ToolTipService.SetToolTip(item, path);
            item.Click += async (_, _) => await ViewModel.OpenFileAsync(path);
            RecentFilesMenu.Items.Add(item);
        }

        if (ViewModel.RecentFiles.Items.Count == 0)
        {
            RecentFilesMenu.Items.Add(new MenuFlyoutItem { Text = _resources.GetString("RecentFilesEmpty"), IsEnabled = false });
            return;
        }

        RecentFilesMenu.Items.Add(new MenuFlyoutSeparator());
        var clear = new MenuFlyoutItem { Text = _resources.GetString("RecentFilesClear") };
        clear.Click += (_, _) => ViewModel.RecentFiles.Clear();
        RecentFilesMenu.Items.Add(clear);
    }

    /// <summary>Carpeta de datos de la aplicación: la del paquete o, sin paquete, una en LocalAppData.</summary>
    private static string AppDataFolder()
    {
        try
        {
            return Windows.Storage.ApplicationData.Current.LocalFolder.Path;
        }
        catch (InvalidOperationException)
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WinVector");
        }
    }

    /// <summary>Las herramientas son excluyentes: activar una desactiva las demás.</summary>
    private void OnToolClick(object sender, RoutedEventArgs e)
    {
        foreach (var button in ToolRail.Children.OfType<ToggleButton>())
        {
            button.IsChecked = ReferenceEquals(button, sender);
        }

        UpdateToolStatus(sender as ToggleButton);
    }

    private void UpdateToolStatus(ToggleButton? tool)
    {
        ToolStatusText.Text = tool is null ? string.Empty : ToolTipService.GetToolTip(tool) as string ?? string.Empty;
    }

    private void OnOpenSampleClick(object sender, RoutedEventArgs e)
    {
        var svg = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Assets", "Sample.svg"));
        ViewModel.OpenDocument(_resources.GetString("SampleDocumentTitle"), svg);
    }

    private async void OnAboutClick(object sender, RoutedEventArgs e)
    {
        var version = typeof(App).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion.Split('+')[0] ?? "0.0.0";

        var dialog = new ContentDialog
        {
            XamlRoot = Content.XamlRoot,
            Title = _resources.GetString("AboutTitle"),
            Content = string.Format(CultureInfo.CurrentCulture, _resources.GetString("AboutBody"), version),
            CloseButtonText = _resources.GetString("AboutClose"),
            DefaultButton = ContentDialogButton.Close,
        };
        await dialog.ShowAsync();
    }
}
