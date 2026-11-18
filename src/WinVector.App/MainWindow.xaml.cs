using System.Globalization;
using System.Reflection;
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

    public MainWindow()
    {
        ViewModel = new MainViewModel(number =>
            string.Format(CultureInfo.CurrentCulture, _resources.GetString("UntitledDocument"), number));

        InitializeComponent();

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBarDragRegion);
        AppWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Tall;
        AppWindow.Resize(new SizeInt32(InitialWidth, InitialHeight));
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.PreferredMinimumWidth = MinimumWidth;
            presenter.PreferredMinimumHeight = MinimumHeight;
        }

        RootGrid.Loaded += (_, _) => UpdateTitleBarInsets();
        RootGrid.SizeChanged += (_, _) => UpdateTitleBarInsets();
        UpdateToolStatus(ToolRail.Children.OfType<ToggleButton>().FirstOrDefault(b => b.IsChecked == true));
    }

    public MainViewModel ViewModel { get; }

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
