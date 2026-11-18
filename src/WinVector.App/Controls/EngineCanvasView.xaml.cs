using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Windows.ApplicationModel.Resources;
using Windows.System;
using WinVector.Core.Canvas;

namespace WinVector.App.Controls;

/// <summary>
/// Lienzo de edición: aloja el motor (src/engine) en un WebView2 servido desde la carpeta de la
/// aplicación, sin red, y le impide salir de esa página.
/// </summary>
public sealed partial class EngineCanvasView : UserControl
{
    private readonly ResourceLoader _resources = new();
    private bool _initializationStarted;
    private bool _engineLoaded;

    public EngineCanvasView()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        ActualThemeChanged += (_, _) => ApplyColorScheme();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_initializationStarted)
        {
            return;
        }

        _initializationStarted = true;

        // Cualquier fallo al preparar el lienzo se muestra en él; no debe cerrar la aplicación.
#pragma warning disable CA1031
        try
        {
            await InitializeAsync();
        }
        catch (Exception ex)
        {
            ShowError(_resources.GetString("CanvasErrorTitle"), ex.Message);
        }
#pragma warning restore CA1031
    }

    private async Task InitializeAsync()
    {
        if (!IsWebView2RuntimeAvailable())
        {
            ShowError(_resources.GetString("CanvasRuntimeMissingTitle"), _resources.GetString("CanvasRuntimeMissingBody"));
            RuntimeDownloadLink.Visibility = Visibility.Visible;
            return;
        }

        var engineFolder = Path.Combine(AppContext.BaseDirectory, EngineLocation.FolderName);
        if (!File.Exists(Path.Combine(engineFolder, "index.html")))
        {
            ShowError(_resources.GetString("CanvasErrorTitle"), _resources.GetString("CanvasEngineMissing"));
            return;
        }

        await CanvasWebView.EnsureCoreWebView2Async();
        var core = CanvasWebView.CoreWebView2;

        var settings = core.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsPinchZoomEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.AreHostObjectsAllowed = false;
        settings.IsWebMessageEnabled = true;
#if DEBUG
        settings.AreDevToolsEnabled = true;
#else
        settings.AreDevToolsEnabled = false;
#endif

        core.SetVirtualHostNameToFolderMapping(
            EngineLocation.HostName,
            engineFolder,
            CoreWebView2HostResourceAccessKind.Deny);

        core.NavigationStarting += OnNavigationStarting;
        core.NewWindowRequested += OnNewWindowRequested;
        core.NavigationCompleted += OnNavigationCompleted;

        ApplyColorScheme();
        core.Navigate(EngineLocation.EntryPage.AbsoluteUri);
    }

    private static bool IsWebView2RuntimeAvailable()
    {
        try
        {
            return !string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());
        }
        catch (COMException)
        {
            return false;
        }
    }

    /// <summary>El tema del motor (prefers-color-scheme) sigue al de la aplicación.</summary>
    private void ApplyColorScheme()
    {
        if (CanvasWebView.CoreWebView2 is { } core)
        {
            core.Profile.PreferredColorScheme = ActualTheme == ElementTheme.Dark
                ? CoreWebView2PreferredColorScheme.Dark
                : CoreWebView2PreferredColorScheme.Light;
        }
    }

    private static void OnNavigationStarting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs args)
    {
        var decision = EngineNavigationPolicy.Decide(args.Uri);
        if (decision == EngineNavigationDecision.Allow)
        {
            return;
        }

        args.Cancel = true;
        if (decision == EngineNavigationDecision.OpenExternally && args.IsUserInitiated)
        {
            _ = Launcher.LaunchUriAsync(new Uri(args.Uri));
        }
    }

    private static void OnNewWindowRequested(CoreWebView2 sender, CoreWebView2NewWindowRequestedEventArgs args)
    {
        // El lienzo nunca abre ventanas propias; los enlaces web van al navegador del sistema.
        args.Handled = true;
        if (EngineNavigationPolicy.Decide(args.Uri) == EngineNavigationDecision.OpenExternally && args.IsUserInitiated)
        {
            _ = Launcher.LaunchUriAsync(new Uri(args.Uri));
        }
    }

    private void OnNavigationCompleted(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        // Solo importa la carga inicial del motor; las navegaciones canceladas después no son errores.
        if (_engineLoaded)
        {
            return;
        }

        if (args.IsSuccess)
        {
            _engineLoaded = true;
            LoadingPanel.Visibility = Visibility.Collapsed;
            CanvasWebView.Opacity = 1;
            CanvasWebView.IsHitTestVisible = true;
            CanvasWebView.IsTabStop = true;
        }
        else
        {
            ShowError(_resources.GetString("CanvasErrorTitle"), args.WebErrorStatus.ToString());
        }
    }

    private void ShowError(string title, string message)
    {
        LoadingPanel.Visibility = Visibility.Collapsed;
        ErrorTitle.Text = title;
        ErrorMessage.Text = message;
        ErrorPanel.Visibility = Visibility.Visible;
    }
}
