using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WinVector.Tools.TabsBenchmark;

/// <summary>
/// Mide memoria, tiempo de carga y tiempo de cambio de pestaña para los dos modelos del ADR 0004.
/// Uso: TabsBenchmark --mode per-tab|shared --tabs N [--objects 2000] [--switches 20] --output archivo.json
/// </summary>
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var options = Options.Parse(args);
        ApplicationConfiguration.Initialize();
        using var form = new BenchmarkForm(options);
        Application.Run(form);
        return form.ExitCode;
    }
}

internal sealed record Options(string Mode, int Tabs, int Objects, int Switches, string Output)
{
    public static Options Parse(string[] args)
    {
        string Get(string name, string fallback)
        {
            var index = Array.IndexOf(args, name);
            return index >= 0 && index + 1 < args.Length ? args[index + 1] : fallback;
        }

        var mode = Get("--mode", "per-tab");
        if (mode is not ("per-tab" or "shared"))
        {
            throw new ArgumentException("--mode debe ser per-tab o shared");
        }

        return new Options(
            mode,
            int.Parse(Get("--tabs", "1"), CultureInfo.InvariantCulture),
            int.Parse(Get("--objects", "2000"), CultureInfo.InvariantCulture),
            int.Parse(Get("--switches", "20"), CultureInfo.InvariantCulture),
            Get("--output", "resultado.json"));
    }
}

internal sealed class BenchmarkForm : Form
{
    private const string HostName = "engine.winvector";
    private readonly Options _options;
    private readonly List<WebView2> _views = [];
    private TaskCompletionSource<string>? _frame;

    public BenchmarkForm(Options options)
    {
        _options = options;
        Text = $"TabsBenchmark {options.Mode} x{options.Tabs}";
        ClientSize = new Size(1280, 800);
        StartPosition = FormStartPosition.CenterScreen;
        Shown += async (_, _) => await RunAsync();
    }

    public int ExitCode { get; private set; } = 1;

    private async Task RunAsync()
    {
        try
        {
            var result = await MeasureAsync();
            File.WriteAllText(_options.Output, JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
            ExitCode = 0;
        }
        catch (Exception ex)
        {
            File.WriteAllText(_options.Output + ".error.txt", ex.ToString());
        }
        finally
        {
            Close();
        }
    }

    private async Task<Dictionary<string, object>> MeasureAsync()
    {
        var userData = Path.Combine(Path.GetTempPath(), $"winvector-bench-{Guid.NewGuid():N}");
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
        var engineFolder = Path.Combine(AppContext.BaseDirectory, "Engine");
        var documents = Enumerable.Range(0, _options.Tabs).Select(i => GenerateDocument(_options.Objects, seed: i)).ToArray();

        var load = Stopwatch.StartNew();
        var viewCount = _options.Mode == "per-tab" ? _options.Tabs : 1;
        for (var i = 0; i < viewCount; i++)
        {
            var view = new WebView2 { Dock = DockStyle.Fill };
            Controls.Add(view);
            view.BringToFront();
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.SetVirtualHostNameToFolderMapping(HostName, engineFolder, CoreWebView2HostResourceAccessKind.Deny);
            view.CoreWebView2.WebMessageReceived += (_, e) => _frame?.TrySetResult(e.TryGetWebMessageAsString());
            await NavigateAsync(view, $"https://{HostName}/index.html");
            _views.Add(view);
        }

        if (_options.Mode == "per-tab")
        {
            for (var i = 0; i < _views.Count; i++)
            {
                await LoadDocumentsAsync(_views[i], [documents[i]]);
            }
        }
        else
        {
            await LoadDocumentsAsync(_views[0], documents);
        }

        await ShowAsync(0);
        load.Stop();

        // Deja que los procesos se asienten antes de medir la memoria.
        await Task.Delay(TimeSpan.FromSeconds(3));
        GC.Collect();
        var memory = MeasureMemory(environment);

        var switches = new List<double>();
        if (_options.Tabs > 1)
        {
            for (var k = 1; k <= _options.Switches; k++)
            {
                var watch = Stopwatch.StartNew();
                await ShowAsync(k % _options.Tabs);
                switches.Add(watch.Elapsed.TotalMilliseconds);
            }
        }

        foreach (var view in _views)
        {
            view.Dispose();
        }

        return new Dictionary<string, object>
        {
            ["mode"] = _options.Mode,
            ["tabs"] = _options.Tabs,
            ["objects"] = _options.Objects,
            ["webView2Version"] = environment.BrowserVersionString,
            ["loadMs"] = Math.Round(load.Elapsed.TotalMilliseconds, 1),
            ["switchMsMedian"] = switches.Count == 0 ? 0 : Math.Round(Median(switches), 1),
            ["switchMsMax"] = switches.Count == 0 ? 0 : Math.Round(switches.Max(), 1),
            ["memory"] = memory,
        };
    }

    private static async Task NavigateAsync(WebView2 view, string uri)
    {
        var completed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Handler(object? sender, CoreWebView2NavigationCompletedEventArgs e) => completed.TrySetResult(e.IsSuccess);
        view.CoreWebView2.NavigationCompleted += Handler;
        view.CoreWebView2.Navigate(uri);
        var ok = await completed.Task;
        view.CoreWebView2.NavigationCompleted -= Handler;
        if (!ok)
        {
            throw new InvalidOperationException($"No se pudo cargar {uri}");
        }
    }

    /// <summary>Sustituye el SVG de ejemplo por los documentos indicados; solo el primero queda visible.</summary>
    private static async Task LoadDocumentsAsync(WebView2 view, string[] documents)
    {
        var json = JsonSerializer.Serialize(documents);
        await view.CoreWebView2.ExecuteScriptAsync($$"""
            (() => {
              const workspace = document.getElementById("workspace");
              const docs = {{json}};
              workspace.innerHTML = docs.map((d, i) =>
                `<div class="winvector-doc" style="display:${i === 0 ? "contents" : "none"}">${d}</div>`).join("");
              return workspace.querySelectorAll("svg *").length;
            })()
            """);
    }

    /// <summary>Muestra la pestaña indicada y espera a que el navegador pinte dos fotogramas.</summary>
    private async Task ShowAsync(int tab)
    {
        _frame = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        WebView2 target;
        string script;
        if (_options.Mode == "per-tab")
        {
            target = _views[tab];
            target.BringToFront();
            target.Visible = true;
            foreach (var other in _views.Where(v => v != target))
            {
                other.Visible = false;
            }

            script = "requestAnimationFrame(() => requestAnimationFrame(() => chrome.webview.postMessage('frame')))";
        }
        else
        {
            target = _views[0];
            script = $$"""
                document.querySelectorAll(".winvector-doc").forEach((d, i) => { d.style.display = i === {{tab}} ? "contents" : "none"; });
                requestAnimationFrame(() => requestAnimationFrame(() => chrome.webview.postMessage('frame')));
                """;
        }

        await target.CoreWebView2.ExecuteScriptAsync(script);
        await _frame.Task.WaitAsync(TimeSpan.FromSeconds(10));
    }

    private static Dictionary<string, object> MeasureMemory(CoreWebView2Environment environment)
    {
        var byKind = new Dictionary<string, (int Count, long Private)>();
        long total = 0;
        foreach (var info in environment.GetProcessInfos())
        {
            try
            {
                using var process = Process.GetProcessById(info.ProcessId);
                var kind = info.Kind.ToString();
                var current = byKind.GetValueOrDefault(kind);
                byKind[kind] = (current.Count + 1, current.Private + process.PrivateMemorySize64);
                total += process.PrivateMemorySize64;
            }
            catch (ArgumentException)
            {
                // El proceso terminó entre la consulta y la medición.
            }
        }

        using var self = Process.GetCurrentProcess();
        return new Dictionary<string, object>
        {
            ["webView2PrivateMB"] = Math.Round(total / 1048576.0, 1),
            ["hostPrivateMB"] = Math.Round(self.PrivateMemorySize64 / 1048576.0, 1),
            ["processes"] = byKind.ToDictionary(p => p.Key, p => (object)new { count = p.Value.Count, privateMB = Math.Round(p.Value.Private / 1048576.0, 1) }),
        };
    }

    /// <summary>Documento de prueba con formas, trazados y textos variados, reproducible con la semilla.</summary>
    private static string GenerateDocument(int objects, int seed)
    {
        var random = new Random(seed);
        var svg = new StringBuilder("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1200" width="1600" height="1200">""");
        for (var i = 0; i < objects; i++)
        {
            var x = random.Next(0, 1580);
            var y = random.Next(0, 1180);
            var color = $"#{random.Next(0x1000000):x6}";
            switch (i % 4)
            {
                case 0:
                    svg.Append(CultureInfo.InvariantCulture, $"""<rect id="r{i}" x="{x}" y="{y}" width="{random.Next(5, 60)}" height="{random.Next(5, 60)}" rx="3" fill="{color}"/>""");
                    break;
                case 1:
                    svg.Append(CultureInfo.InvariantCulture, $"""<circle id="c{i}" cx="{x}" cy="{y}" r="{random.Next(3, 30)}" fill="{color}" stroke="#222" stroke-width="1"/>""");
                    break;
                case 2:
                    svg.Append(CultureInfo.InvariantCulture, $"""<path id="p{i}" d="M{x} {y} C{x + 20} {y - 30} {x + 40} {y + 30} {x + 60} {y}" fill="none" stroke="{color}" stroke-width="2"/>""");
                    break;
                default:
                    svg.Append(CultureInfo.InvariantCulture, $"""<text id="t{i}" x="{x}" y="{y}" font-size="12" fill="{color}">Texto {i}</text>""");
                    break;
            }
        }

        return svg.Append("</svg>").ToString();
    }

    private static double Median(List<double> values)
    {
        var sorted = values.Order().ToArray();
        return sorted.Length % 2 == 1 ? sorted[sorted.Length / 2] : (sorted[(sorted.Length / 2) - 1] + sorted[sorted.Length / 2]) / 2;
    }
}
