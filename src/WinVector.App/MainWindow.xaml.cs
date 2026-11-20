using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Reflection;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.Windows.ApplicationModel.Resources;
using Windows.ApplicationModel.DataTransfer;
using Windows.Graphics;
using Windows.Storage;
using Windows.System;
using WinVector.App.Shell;
using WinVector.Core.Bridge;
using WinVector.Core.Files;
using WinVector.Core.Shell;

namespace WinVector.App;

/// <summary>
/// Ventana principal con la distribución "Estudio clásico".
/// </summary>
[SuppressMessage(
    "Design",
    "CA1001:Types that own disposable fields should be disposable",
    Justification = "Las ventanas de WinUI no se desechan: los diálogos se liberan en Closed.")]
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

    /// <summary>Copias de recuperación de los documentos con cambios (#24).</summary>
    private readonly RecoveryStore _recovery = new(Path.Combine(AppDataFolder(), "Recuperacion"));
    private readonly StartupTrace _startup = new(AppDataFolder());

    /// <summary>Mientras se prepara el selector al abrirlo, sus cambios no se aplican a la selección.</summary>
    private bool _preparingPicker;

    /// <summary>Último color elegido en el selector abierto, para recordarlo al cerrarlo.</summary>
    private string? _pickedColor;

    private bool _closeConfirmed;

    public MainWindow()
    {
        _dialogs = new WinUIShellDialogs(this, _resources);
        ViewModel = new MainViewModel(
            new ResourceShellTexts(_resources),
            _dialogs,
            new RecentFiles(new TextFileRecentFilesStore(Path.Combine(AppDataFolder(), "archivos-recientes.txt"))),
            App.Logging.CreateLogger<MainViewModel>(),
            clipboard: new WinUIClipboard(),
            recovery: _recovery);

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
        EngineCanvas.EngineFailed += (_, reloading) => ViewModel.OnEngineFailed(reloading);
        Closed += (_, _) =>
        {
            // Cierre normal: las copias de recuperación de esta sesión ya no hacen falta.
            ViewModel.EndRecovery();
            _recovery.Dispose();
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
        RootGrid.Loaded += OnFirstLoaded;
        RootGrid.SizeChanged += (_, _) => UpdateTitleBarInsets();
        UpdateToolStatus(ToolRail.Children.OfType<ToggleButton>().FirstOrDefault(b => b.IsChecked == true));

        // Ctrl+K abre la paleta de comandos, también con el lienzo enfocado (el motor reenvía el atajo).
        var palette = new KeyboardAccelerator { Key = VirtualKey.K, Modifiers = VirtualKeyModifiers.Control };
        palette.Invoked += (_, args) =>
        {
            OpenCommandPalette();
            args.Handled = true;
        };
        RootGrid.KeyboardAccelerators.Add(palette);
        ViewModel.CommandPaletteRequested += (_, _) => OpenCommandPalette();

        // Ctrl++ y Ctrl+- (en el teclado principal y en el numérico) no tienen nombre en VirtualKey.
        AddAccelerator(ZoomInMenuItem, (VirtualKey)187, VirtualKey.Add);
        AddAccelerator(ZoomOutMenuItem, (VirtualKey)189, VirtualKey.Subtract);

        // La herramienta también puede cambiar desde el lienzo, con su atajo de teclado.
        ViewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(MainViewModel.ActiveTool))
            {
                ShowActiveTool(ViewModel.ActiveTool);
            }
            else if (e.PropertyName == nameof(MainViewModel.IsEngineReady) && ViewModel.IsEngineReady)
            {
                _startup.EngineReady();
            }
        };
    }

    /// <summary>
    /// Al mostrarse la ventana: empieza a guardar copias de recuperación y, si la ejecución anterior
    /// terminó de forma inesperada, ofrece recuperar sus documentos.
    /// </summary>
    private async void OnFirstLoaded(object sender, RoutedEventArgs e)
    {
        RootGrid.Loaded -= OnFirstLoaded;
        _startup.WindowLoaded();
#pragma warning disable CA1031 // La recuperación nunca debe impedir que la aplicación arranque.
        try
        {
            ViewModel.StartRecovery();
            await ViewModel.OfferRecoveryAsync();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"No se pudo preparar la recuperación de documentos: {ex}");
        }
#pragma warning restore CA1031
    }

    private static void AddAccelerator(MenuFlyoutItem item, params VirtualKey[] keys)
    {
        foreach (var key in keys)
        {
            item.KeyboardAccelerators.Add(new KeyboardAccelerator { Key = key, Modifiers = VirtualKeyModifiers.Control });
        }
    }

    /// <summary>Intro aplica el tamaño escrito y Esc lo descarta.</summary>
    private void OnArtboardKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Enter)
        {
            ApplyArtboard();
            e.Handled = true;
        }
        else if (e.Key == VirtualKey.Escape)
        {
            ResetArtboardEditor();
            e.Handled = true;
        }
    }

    private void OnArtboardLostFocus(object sender, RoutedEventArgs e) => ApplyArtboard();

    private void OpenCommandPalette()
    {
        CommandSearch.Focus(FocusState.Keyboard);
        CommandSearch.ItemsSource = ViewModel.Commands.Search(CommandSearch.Text);
        CommandSearch.IsSuggestionListOpen = !string.IsNullOrWhiteSpace(CommandSearch.Text);
    }

    private void OnCommandSearchTextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
    {
        if (args.Reason == AutoSuggestionBoxTextChangeReason.UserInput)
        {
            sender.ItemsSource = ViewModel.Commands.Search(sender.Text);
        }
    }

    /// <summary>Intro o un clic en un resultado: ejecuta la orden elegida, o la primera que coincide.</summary>
    private void OnCommandSearchSubmitted(AutoSuggestBox sender, AutoSuggestBoxQuerySubmittedEventArgs args)
    {
        var found = ViewModel.Commands.Search(args.QueryText);
        var entry = args.ChosenSuggestion as CommandEntry ?? (found.Count > 0 ? found[0] : null);
        if (entry is null)
        {
            return;
        }

        sender.Text = string.Empty;
        sender.ItemsSource = null;
        // El foco vuelve al lienzo antes de ejecutar: las órdenes del lienzo se hacen ahí.
        EngineCanvas.Focus(FocusState.Programmatic);
        entry.Execute();
    }

    /// <summary>Texto de una pintura en el panel: el color, "Ninguno", "Varios" o "Degradado o patrón".</summary>
    private string PaintText(string? paint) => paint switch
    {
        null => _resources.GetString("PaintMixed"),
        "none" => _resources.GetString("PaintNone"),
        "url" => _resources.GetString("PaintServer"),
        _ => paint.ToUpperInvariant(),
    };

    private void OnPaintFlyoutOpening(object sender, object e)
    {
        var fill = ReferenceEquals(sender, FillFlyout);
        var picker = fill ? FillPicker : StrokePicker;
        _preparingPicker = true;
        if (BindingFunctions.TryParseColor(fill ? ViewModel.SelectionFill : ViewModel.SelectionStroke, out var color))
        {
            picker.Color = color;
        }

        _preparingPicker = false;
        _pickedColor = null;
        RebuildRecentColors();
    }

    private void OnPaintColorChanged(ColorPicker sender, ColorChangedEventArgs args)
    {
        if (_preparingPicker)
        {
            return;
        }

        var hex = BindingFunctions.ToHex(args.NewColor);
        _pickedColor = hex;
        if (ReferenceEquals(sender, FillPicker))
        {
            ViewModel.SetSelectionFill(hex);
        }
        else
        {
            ViewModel.SetSelectionStroke(hex);
        }
    }

    private void OnPaintFlyoutClosed(object sender, object e)
    {
        if (_pickedColor is { } color)
        {
            ViewModel.RememberColor(color);
        }

        _pickedColor = null;
    }

    private void OnPaintNoneClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: "fill" })
        {
            ViewModel.SetSelectionFill("none");
            FillFlyout.Hide();
        }
        else
        {
            ViewModel.SetSelectionStroke("none");
            StrokeFlyout.Hide();
        }
    }

    /// <summary>Muestras de los colores recientes en los dos selectores.</summary>
    private void RebuildRecentColors()
    {
        foreach (var (panel, fill) in new[] { (FillRecent, true), (StrokeRecent, false) })
        {
            panel.Children.Clear();
            foreach (var color in ViewModel.RecentColors)
            {
                var swatch = new Button
                {
                    Width = 24,
                    Height = 24,
                    Padding = new Thickness(0),
                    Tag = color,
                    Content = new Border { Width = 16, Height = 16, CornerRadius = new CornerRadius(2), Background = BindingFunctions.PaintBrush(color) },
                };
                ToolTipService.SetToolTip(swatch, color.ToUpperInvariant());
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(swatch, color.ToUpperInvariant());
                swatch.Click += (_, _) =>
                {
                    if (fill)
                    {
                        ViewModel.SetSelectionFill(color);
                        FillFlyout.Hide();
                    }
                    else
                    {
                        ViewModel.SetSelectionStroke(color);
                        StrokeFlyout.Hide();
                    }

                    ViewModel.RememberColor(color);
                };
                panel.Children.Add(swatch);
            }
        }
    }

    private void OnStrokeWidthChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (!double.IsNaN(args.NewValue))
        {
            ViewModel.SetSelectionStrokeWidth(args.NewValue);
        }
    }

    private void OnOpacityChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (!double.IsNaN(args.NewValue))
        {
            ViewModel.SetSelectionOpacityPercent(args.NewValue);
        }
    }

    /// <summary>
    /// Un campo del panel de propiedades ha cambiado (Intro, salir del campo o las flechas). Si el
    /// cambio viene de la propia selección, el valor coincide y no se envía nada.
    /// </summary>
    private void OnGeometryValueChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (sender.Tag is string tag && Enum.TryParse<GeometryField>(tag, out var field) && !double.IsNaN(args.NewValue))
        {
            ViewModel.SetSelectionGeometry(field, args.NewValue);
        }
    }

    private void ApplyArtboard()
    {
        if (!ViewModel.ApplyArtboard(ArtboardWidthBox.Text, ArtboardHeightBox.Text, ArtboardViewBoxBox.Text))
        {
            ResetArtboardEditor();
        }
    }

    private void ResetArtboardEditor()
    {
        var artboard = ViewModel.CurrentArtboard;
        ArtboardWidthBox.Text = BindingFunctions.ArtboardWidthText(artboard);
        ArtboardHeightBox.Text = BindingFunctions.ArtboardHeightText(artboard);
        ArtboardViewBoxBox.Text = BindingFunctions.ArtboardViewBoxText(artboard);
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
        CheckOnly(sender as ToggleButton);
        // Las herramientas que ya implementa el motor llevan su nombre en Tag (select, hand, zoom).
        if (sender is ToggleButton { Tag: string tag } && Enum.TryParse<ToolName>(tag, ignoreCase: true, out var tool))
        {
            _ = ViewModel.SelectToolAsync(tool);
        }
    }

    private void ShowActiveTool(ToolName tool)
    {
        var name = tool.ToString();
        CheckOnly(ToolRail.Children.OfType<ToggleButton>()
            .FirstOrDefault(b => b.Tag is string tag && string.Equals(tag, name, StringComparison.OrdinalIgnoreCase)));
    }

    private void CheckOnly(ToggleButton? selected)
    {
        if (selected is null)
        {
            return;
        }

        foreach (var button in ToolRail.Children.OfType<ToggleButton>())
        {
            button.IsChecked = ReferenceEquals(button, selected);
        }

        UpdateToolStatus(selected);
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
