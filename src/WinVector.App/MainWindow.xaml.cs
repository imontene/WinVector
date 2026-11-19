using System.Globalization;
using System.Reflection;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.Windows.ApplicationModel.Resources;
using Windows.Graphics;
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
    private IDisposable? _bridgeAttachment;

    public MainWindow()
    {
        ViewModel = new MainViewModel(
            new ShellTexts(
                UntitledDocument: number => Format("UntitledDocument", number),
                MultipleSelection: count => Format("SelectionMultiple", count),
                ProtocolMismatch: (engine, app) => Format("EngineProtocolMismatch", engine, app)),
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
        Closed += (_, _) => _bridgeAttachment?.Dispose();

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

    private void OnTabCloseRequested(TabView sender, TabViewTabCloseRequestedEventArgs args) =>
        ViewModel.CloseDocument(args.Item as DocumentTabViewModel);

    private void OnCloseTabClick(object sender, RoutedEventArgs e) =>
        ViewModel.CloseDocument(ViewModel.SelectedDocument);

    private void OnExitClick(object sender, RoutedEventArgs e) => Close();

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
