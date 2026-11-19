using Microsoft.Extensions.Logging;
using Microsoft.UI.Xaml;

namespace WinVector.App;

/// <summary>
/// Punto de entrada de la aplicación.
/// </summary>
public partial class App : Application
{
    private MainWindow? _window;

    /// <summary>
    /// Registro de la aplicación. Por ahora escribe en la salida de depuración (Visual Studio o
    /// DebugView); un registro en archivo llegará cuando haga falta diagnosticar en equipos de usuarios.
    /// </summary>
    public static ILoggerFactory Logging { get; } = LoggerFactory.Create(builder => builder
        .AddDebug()
#if DEBUG
        .SetMinimumLevel(LogLevel.Debug));
#else
        .SetMinimumLevel(LogLevel.Information));
#endif

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
        _ = _window.OpenFilesAsync(FilesToOpen(args));
    }

    /// <summary>
    /// Archivos con los que se abrió la aplicación: desde el Explorador ("Abrir con" o doble clic, si
    /// es la aplicación predeterminada) o como argumentos de la línea de comandos.
    /// </summary>
    private static IReadOnlyList<string> FilesToOpen(LaunchActivatedEventArgs args)
    {
        var activation = Microsoft.Windows.AppLifecycle.AppInstance.GetCurrent().GetActivatedEventArgs();
        if (activation.Kind == Microsoft.Windows.AppLifecycle.ExtendedActivationKind.File
            && activation.Data is Windows.ApplicationModel.Activation.IFileActivatedEventArgs files)
        {
            return [.. files.Files.Select(file => file.Path)];
        }

        // En las aplicaciones empaquetadas, LaunchActivatedEventArgs.Arguments de WinUI puede llegar
        // vacío: los argumentos se toman de la activación o, en su defecto, de la línea de comandos.
        if (activation.Kind == Microsoft.Windows.AppLifecycle.ExtendedActivationKind.Launch
            && activation.Data is Windows.ApplicationModel.Activation.ILaunchActivatedEventArgs launch
            && !string.IsNullOrWhiteSpace(launch.Arguments))
        {
            return WinVector.Core.Shell.CommandLine.SplitArguments(launch.Arguments);
        }

        if (!string.IsNullOrWhiteSpace(args.Arguments))
        {
            return WinVector.Core.Shell.CommandLine.SplitArguments(args.Arguments);
        }

        return [.. Environment.GetCommandLineArgs().Skip(1)];
    }
}
