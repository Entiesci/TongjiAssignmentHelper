using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace TongjiHubSetup
{
    internal static class Program
    {
        public const string AppVersion = "ver.0.18";
        public const string PayloadResource = "TongjiHub.Payload";
        public const string LogoResource = "TongjiHub.Logo";

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }

        public static Stream OpenResource(string name)
        {
            return Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
        }
    }

    internal sealed class SetupForm : Form
    {
        private static readonly Color Paper = Color.FromArgb(244, 240, 232);
        private static readonly Color Card = Color.FromArgb(251, 248, 242);
        private static readonly Color Ink = Color.FromArgb(28, 30, 29);
        private static readonly Color Muted = Color.FromArgb(119, 114, 104);
        private static readonly Color Red = Color.FromArgb(168, 58, 50);
        private static readonly Color Line = Color.FromArgb(214, 208, 196);

        private readonly TextBox _pathBox;
        private readonly Button _browse;
        private readonly CheckBox _autostart;
        private readonly CheckBox _launch;
        private readonly Button _install;
        private readonly Button _cancel;
        private readonly ProgressBar _progress;
        private readonly Label _status;
        private readonly Label _headline;

        private bool _busy;
        private bool _finished;
        private string _installedPath;

        public SetupForm()
        {
            Text = "同舟 · 安装程序";
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            BackColor = Paper;
            ClientSize = new Size(600, 442);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;

            try
            {
                using (Stream stream = Program.OpenResource(Program.LogoResource))
                {
                    if (stream != null) Icon = new Icon(stream);
                }
            }
            catch
            {
            }

            Panel header = new Panel();
            header.SetBounds(0, 0, 600, 96);
            header.BackColor = Card;
            header.Paint += delegate(object sender, PaintEventArgs e)
            {
                using (Pen pen = new Pen(Line))
                {
                    e.Graphics.DrawLine(pen, 0, header.Height - 1, header.Width, header.Height - 1);
                }
            };
            Controls.Add(header);

            PictureBox logo = new PictureBox();
            logo.SetBounds(26, 24, 48, 48);
            logo.SizeMode = PictureBoxSizeMode.Zoom;
            try
            {
                using (Stream stream = Program.OpenResource(Program.LogoResource))
                {
                    if (stream != null) logo.Image = Image.FromStream(stream);
                }
            }
            catch
            {
            }
            header.Controls.Add(logo);

            Label title = new Label();
            title.Text = "同舟";
            title.Font = new Font("Microsoft YaHei UI", 17F, FontStyle.Bold, GraphicsUnit.Point);
            title.ForeColor = Ink;
            title.AutoSize = true;
            title.Location = new Point(88, 24);
            header.Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "校园手账 · 安装程序　" + Program.AppVersion;
            subtitle.Font = new Font("Microsoft YaHei UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            subtitle.ForeColor = Muted;
            subtitle.AutoSize = true;
            subtitle.Location = new Point(90, 58);
            header.Controls.Add(subtitle);

            Label pathLabel = new Label();
            pathLabel.Text = "安装位置";
            pathLabel.ForeColor = Muted;
            pathLabel.AutoSize = true;
            pathLabel.Location = new Point(28, 118);
            Controls.Add(pathLabel);

            _pathBox = new TextBox();
            _pathBox.SetBounds(28, 142, 448, 26);
            _pathBox.Text = DefaultInstallPath();
            _pathBox.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(_pathBox);

            _browse = new Button();
            _browse.Text = "浏览…";
            _browse.SetBounds(484, 141, 88, 28);
            _browse.FlatStyle = FlatStyle.System;
            _browse.Click += BrowseClick;
            Controls.Add(_browse);

            _autostart = new CheckBox();
            _autostart.Text = "开机自动启动（登录 Windows 后在托盘运行）";
            _autostart.Checked = true;
            _autostart.AutoSize = true;
            _autostart.ForeColor = Ink;
            _autostart.Location = new Point(28, 190);
            Controls.Add(_autostart);

            _launch = new CheckBox();
            _launch.Text = "安装完成后立即打开同舟";
            _launch.Checked = true;
            _launch.AutoSize = true;
            _launch.ForeColor = Ink;
            _launch.Location = new Point(28, 216);
            Controls.Add(_launch);

            Label note = new Label();
            note.Text = "安装会创建桌面和开始菜单快捷方式。需要 Node.js 18+ 和 Microsoft Edge。";
            note.ForeColor = Muted;
            note.AutoSize = false;
            note.SetBounds(28, 250, 544, 34);
            Controls.Add(note);

            _progress = new ProgressBar();
            _progress.SetBounds(28, 296, 544, 8);
            _progress.Style = ProgressBarStyle.Continuous;
            _progress.Maximum = 100;
            _progress.Visible = false;
            Controls.Add(_progress);

            _status = new Label();
            _status.Text = "";
            _status.ForeColor = Muted;
            _status.AutoSize = false;
            _status.SetBounds(28, 310, 544, 22);
            Controls.Add(_status);

            _headline = new Label();
            _headline.Text = "点击安装，解压全部文件到上面的位置。";
            _headline.ForeColor = Muted;
            _headline.AutoSize = false;
            _headline.SetBounds(28, 336, 544, 22);
            Controls.Add(_headline);

            _install = new Button();
            _install.Text = "安装";
            _install.SetBounds(376, 384, 100, 34);
            _install.BackColor = Ink;
            _install.ForeColor = Paper;
            _install.FlatStyle = FlatStyle.Flat;
            _install.FlatAppearance.BorderSize = 0;
            _install.Click += InstallClick;
            Controls.Add(_install);

            _cancel = new Button();
            _cancel.Text = "取消";
            _cancel.SetBounds(484, 384, 88, 34);
            _cancel.FlatStyle = FlatStyle.System;
            _cancel.Click += delegate { Close(); };
            Controls.Add(_cancel);

            AcceptButton = _install;
            CancelButton = _cancel;
        }

        private static string DefaultInstallPath()
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(Path.Combine(Path.Combine(local, "Programs"), "TongjiHub"), "");
        }

        private void BrowseClick(object sender, EventArgs e)
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择安装位置";
                dialog.SelectedPath = _pathBox.Text;
                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    _pathBox.Text = dialog.SelectedPath;
                }
            }
        }

        private void InstallClick(object sender, EventArgs e)
        {
            if (_finished)
            {
                Close();
                return;
            }
            if (_busy) return;

            string target = _pathBox.Text.Trim();
            if (target.Length == 0)
            {
                MessageBox.Show(this, "请选择安装位置。", "同舟", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            try
            {
                target = Path.GetFullPath(target);
            }
            catch
            {
                MessageBox.Show(this, "安装位置无效。", "同舟", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            _busy = true;
            SetControlsEnabled(false);
            _install.Text = "正在安装…";
            _progress.Visible = true;
            _progress.Value = 0;
            _status.Text = "正在准备…";
            _headline.Text = "正在解压文件，请稍候。";

            bool autostart = _autostart.Checked;
            bool launch = _launch.Checked;

            Thread worker = new Thread(delegate()
            {
                string error = null;
                try
                {
                    ExtractAll(target, delegate(int percent, string name)
                    {
                        SafeInvoke(delegate
                        {
                            _progress.Value = Math.Min(100, Math.Max(0, percent));
                            _status.Text = "正在解压：" + name;
                        });
                    });
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }

                if (error == null)
                {
                    try
                    {
                        SafeInvoke(delegate { _status.Text = "正在创建快捷方式…"; });
                        CreateShortcuts(target, autostart);
                    }
                    catch (Exception ex)
                    {
                        error = "创建快捷方式失败：" + ex.Message;
                    }
                }

                SafeInvoke(delegate
                {
                    _busy = false;
                    if (error != null)
                    {
                        SetControlsEnabled(true);
                        _progress.Visible = false;
                        _status.Text = "";
                        _headline.Text = "点击安装，解压全部文件到上面的位置。";
                        _install.Text = "安装";
                        MessageBox.Show(this, "安装失败：" + Environment.NewLine + error, "同舟", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }

                    _finished = true;
                    _installedPath = target;
                    _progress.Value = 100;
                    _status.Text = "安装完成";
                    _headline.Text = "同舟已安装到：" + target;
                    _install.Text = "完成";
                    _cancel.Visible = false;
                    _pathBox.Enabled = false;
                    _browse.Enabled = false;
                    _autostart.Enabled = false;
                    _launch.Enabled = false;

                    if (launch) LaunchApp(target);
                });
            });

            worker.IsBackground = true;
            worker.Start();
        }

        private void SetControlsEnabled(bool enabled)
        {
            _pathBox.Enabled = enabled;
            _browse.Enabled = enabled;
            _autostart.Enabled = enabled;
            _launch.Enabled = enabled;
            _cancel.Enabled = enabled;
        }

        private void SafeInvoke(MethodInvoker action)
        {
            if (IsDisposed) return;
            try
            {
                if (InvokeRequired) BeginInvoke(action);
                else action();
            }
            catch (ObjectDisposedException)
            {
            }
        }

        private static void ExtractAll(string target, Action<int, string> progress)
        {
            Directory.CreateDirectory(target);

            string temp = Path.Combine(Path.GetTempPath(), "tongji-setup-" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                using (Stream source = Program.OpenResource(Program.PayloadResource))
                {
                    if (source == null) throw new InvalidOperationException("安装包内容缺失。");
                    using (FileStream file = File.Create(temp))
                    {
                        source.CopyTo(file);
                    }
                }

                using (ZipArchive archive = ZipFile.OpenRead(temp))
                {
                    int total = archive.Entries.Count;
                    int index = 0;
                    string root = Path.GetFullPath(target);
                    if (!root.EndsWith(Path.DirectorySeparatorChar.ToString()))
                    {
                        root += Path.DirectorySeparatorChar;
                    }

                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        index++;
                        string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                        string destination = Path.GetFullPath(Path.Combine(root, relative));

                        if (!destination.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }

                        if (entry.Name.Length == 0)
                        {
                            Directory.CreateDirectory(destination);
                        }
                        else
                        {
                            string folder = Path.GetDirectoryName(destination);
                            if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);
                            entry.ExtractToFile(destination, true);
                        }

                        if (progress != null)
                        {
                            int percent = (int)(index * 100L / Math.Max(1, total));
                            progress(percent, entry.FullName);
                        }
                    }
                }
            }
            finally
            {
                try
                {
                    if (File.Exists(temp)) File.Delete(temp);
                }
                catch
                {
                }
            }
        }

        private static void CreateShortcuts(string target, bool autostart)
        {
            string wscript = Path.Combine(Environment.SystemDirectory, "wscript.exe");
            string launcher = Path.Combine(Path.Combine(target, "desktop"), "start-tray.vbs");
            if (!File.Exists(launcher))
            {
                launcher = Path.Combine(target, "启动同舟.vbs");
            }
            string iconPath = Path.Combine(Path.Combine(target, "desktop"), "tray.ico");
            string arguments = "\"" + launcher + "\"";

            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            CreateShortcut(Path.Combine(desktop, "同舟.lnk"), wscript, arguments, target, iconPath, "同舟 · 校园手账");

            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            string menuFolder = Path.Combine(programs, "同舟");
            Directory.CreateDirectory(menuFolder);
            CreateShortcut(Path.Combine(menuFolder, "同舟.lnk"), wscript, arguments, target, iconPath, "同舟 · 校园手账");

            string startupLink = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "TongjiHub.lnk");
            if (autostart)
            {
                CreateShortcut(startupLink, wscript, arguments, target, iconPath, "同舟 · 开机启动");
            }
            else if (File.Exists(startupLink))
            {
                try
                {
                    File.Delete(startupLink);
                }
                catch
                {
                }
            }
        }

        private static void CreateShortcut(string linkPath, string targetPath, string arguments, string workingDirectory, string iconPath, string description)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) throw new InvalidOperationException("无法创建快捷方式。");

            object shell = Activator.CreateInstance(shellType);
            object link = shellType.InvokeMember(
                "CreateShortcut",
                BindingFlags.InvokeMethod,
                null,
                shell,
                new object[] { linkPath });

            Type linkType = link.GetType();
            linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { targetPath });
            linkType.InvokeMember("Arguments", BindingFlags.SetProperty, null, link, new object[] { arguments });
            linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { workingDirectory });
            if (!string.IsNullOrEmpty(iconPath) && File.Exists(iconPath))
            {
                linkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { iconPath });
            }
            linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { description });
            linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
        }

        private static void LaunchApp(string target)
        {
            try
            {
                string launcher = Path.Combine(target, "启动同舟.vbs");
                if (!File.Exists(launcher))
                {
                    launcher = Path.Combine(Path.Combine(target, "desktop"), "start-tray.vbs");
                }

                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = Path.Combine(Environment.SystemDirectory, "wscript.exe");
                info.Arguments = "\"" + launcher + "\"";
                info.WorkingDirectory = target;
                info.UseShellExecute = true;
                info.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(info);
            }
            catch
            {
            }
        }
    }
}
