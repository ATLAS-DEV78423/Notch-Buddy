# Control center worker — volume, brightness, Night light, Do not disturb and
# memory boost for the Coucou island. Rust spawns this on the first command:
# one JSON request per stdin line, one JSON response per stdout line.
#
# Ported from the reference Dynamic_island system_control.ps1 — the same
# IAudioEndpointVolume COM, WmiMonitorBrightness WMI, CloudStore registry blob,
# quiet-hours WNF state and EmptyWorkingSet trim — minus the polling loops,
# Bluetooth and the audio meter: nothing here polls, the worker answers a
# command and goes back to sleeping in ReadLine.

param([int]$ParentPid = 0)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$audioCode = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace WinAudioSys {
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IAudioEndpointVolumeCallback pNotify);
        int UnregisterControlChangeNotify(IAudioEndpointVolumeCallback pNotify);
        int GetChannelCount(out uint pnChannelCount);
        int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
        int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
        int GetMasterVolumeLevel(out float pfLevelDB);
        int GetMasterVolumeLevelScalar(out float pfLevel);
        int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
        int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
        int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
        int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
        int GetMute(out bool pbMute);
        int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
        int VolumeStepUp(ref Guid pguidEventContext);
        int VolumeStepDown(ref Guid pguidEventContext);
        int QueryHardwareSupport(out uint pdwHardwareSupportMask);
        int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
    }

    [Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolumeCallback {
        [PreserveSig]
        int OnNotify(IntPtr pNotify);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice {
        int Activate(ref Guid id, int cls_ctx, IntPtr ap, [MarshalAs(UnmanagedType.IUnknown)] out object ip);
        int OpenPropertyStore(int access, out IPropertyStore ps);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out int state);
    }

    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceCollection {
        int GetCount(out int count);
        int Item(int n, out IMMDevice dev);
    }

    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        int GetCount(out int count);
        int GetAt(int iProperty, out PROPERTYKEY pkey);
        int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        int SetValue(ref PROPERTYKEY key, ref PROPVARIANT propvar);
        int Commit();
    }
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PROPERTYKEY {
        public Guid fmtid;
        public int pid;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct PROPVARIANT {
        public short vt;
        public short wReserved1;
        public short wReserved2;
        public short wReserved3;
        public IntPtr pwszVal;
        public IntPtr pad;   // PROPVARIANT is 24 bytes on x64: GetValue writes all of them
    }

    [Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMNotificationClient {
        void OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId, uint dwNewState);
        void OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId);
        void OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId);
        void OnDefaultDeviceChanged(int dataFlow, int role, [MarshalAs(UnmanagedType.LPWStr)] string pwstrDefaultDeviceId);
        void OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId, PROPERTYKEY key);
    }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int df, int sm, out IMMDeviceCollection devs);
        int GetDefaultAudioEndpoint(int df, int role, out IMMDevice ep);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ep);
        int RegisterEndpointNotificationCallback(IMMNotificationClient pClient);
        int UnregisterEndpointNotificationCallback(IMMNotificationClient pClient);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDevEnum { }

    // No callbacks or meter here: every call re-checks that the cached endpoint
    // is still the default output, so plugging in headphones between two
    // commands re-hooks without a poll loop or a notification registration.
    public class Audio {
        private static readonly object _comLock = new object();
        private static IAudioEndpointVolume _cached;
        private static string _cachedId;
        private static IMMDeviceEnumerator _enumerator;

        private static void EnsureEnumerator() {
            if (_enumerator == null) {
                try { _enumerator = (IMMDeviceEnumerator)new MMDevEnum(); } catch {}
            }
        }

        private static IMMDevice GetDefaultDevice() {
            IMMDevice dev = null;
            try { _enumerator.GetDefaultAudioEndpoint(0, 0, out dev); } catch { dev = null; }
            if (dev == null) {
                try { _enumerator.GetDefaultAudioEndpoint(0, 1, out dev); } catch { dev = null; }
            }
            return dev;
        }

        private static void ReleaseCached() {
            if (_cached != null) {
                try { Marshal.ReleaseComObject(_cached); } catch {}
                _cached = null;
            }
            _cachedId = null;
        }

        // Caller must hold _comLock. A no-op while the default output is unchanged.
        private static void RehookInternal() {
            try {
                EnsureEnumerator();
                if (_enumerator == null) return;
                IMMDevice dev = GetDefaultDevice();
                if (dev == null) { ReleaseCached(); return; }
                string id = null;
                try { dev.GetId(out id); } catch {}
                if (_cached != null && id != null && id == _cachedId) {
                    try { Marshal.ReleaseComObject(dev); } catch {}
                    return;
                }
                ReleaseCached();
                Guid iid = typeof(IAudioEndpointVolume).GUID;
                object epv = null;
                dev.Activate(ref iid, 1, IntPtr.Zero, out epv);
                _cached = (IAudioEndpointVolume)epv;
                _cachedId = id;
                try { Marshal.ReleaseComObject(dev); } catch {}
            } catch {
                ReleaseCached();
            }
        }

        // -1 = no usable output device (the worker reports that as an error).
        public static float GetMasterVolume() {
            lock (_comLock) {
                RehookInternal();
                if (_cached == null) return -1f;
                try {
                    float v = 0;
                    _cached.GetMasterVolumeLevelScalar(out v);
                    return v * 100f;
                } catch { ReleaseCached(); return -1f; }
            }
        }

        public static bool SetMasterVolume(float level) {
            level = Math.Max(0f, Math.Min(100f, level));
            lock (_comLock) {
                RehookInternal();
                if (_cached == null) return false;
                try {
                    Guid g = Guid.Empty;
                    _cached.SetMasterVolumeLevelScalar(level / 100f, ref g);
                    return true;
                } catch { ReleaseCached(); return false; }
            }
        }

        public static bool GetMute() {
            lock (_comLock) {
                RehookInternal();
                if (_cached == null) return false;
                try {
                    bool m = false;
                    _cached.GetMute(out m);
                    return m;
                } catch { ReleaseCached(); return false; }
            }
        }

        public static bool SetMute(bool mute) {
            lock (_comLock) {
                RehookInternal();
                if (_cached == null) return false;
                try {
                    Guid g = Guid.Empty;
                    _cached.SetMute(mute, ref g);
                    return true;
                } catch { ReleaseCached(); return false; }
            }
        }
    }

    // Night light and Do not disturb have no public Windows API. These use the
    // same undocumented state Windows' own toggles use: the Night light
    // CloudStore blob and the shell's quiet-hours WNF state.
    public static class SysToggles {
        static readonly string NightLightKey = @"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate";
        const ulong WNF_QUIETHOURS_PROFILE = 0x0D83063EA3BF1C75;

        [DllImport("ntdll.dll")]
        static extern int NtQueryWnfStateData(ref ulong stateName, IntPtr typeId, IntPtr scope, out uint changeStamp, byte[] buffer, ref uint bufferSize);
        [DllImport("ntdll.dll")]
        static extern int NtUpdateWnfStateData(ref ulong stateName, byte[] buffer, uint length, IntPtr typeId, IntPtr scope, uint matchingChangeStamp, uint checkStamp);

        // 1 = on, 0 = off, -1 = unknown (never configured on this PC)
        public static int GetNightLight() {
            try {
                using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(NightLightKey)) {
                    if (k == null) return -1;
                    var d = k.GetValue("Data") as byte[];
                    if (d == null || d.Length < 25) return -1;
                    return d[18] == 0x15 ? 1 : 0;
                }
            } catch { return -1; }
        }

        public static bool SetNightLight(bool on) {
            try {
                using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(NightLightKey, true)) {
                    if (k == null) return false;
                    var d = k.GetValue("Data") as byte[];
                    if (d == null || d.Length < 25) return false;
                    bool cur = d[18] == 0x15;
                    if (cur == on) return true;
                    var list = new List<byte>(d);
                    if (on) {
                        list.InsertRange(23, new byte[] { 0x10, 0x00 });
                        list[18] = 0x15;
                    } else {
                        if (!(list[23] == 0x10 && list[24] == 0x00)) return false; // unexpected layout: don't guess
                        list.RemoveRange(23, 2);
                        list[18] = 0x13;
                    }
                    // Move the 5-byte varint timestamp at [10..14] forward so Windows applies the change
                    ulong ts = 0;
                    for (int i = 0; i < 5; i++) ts |= (ulong)(list[10 + i] & 0x7F) << (7 * i);
                    ulong now = (ulong)DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                    ts = Math.Max(ts + 1, now);
                    for (int i = 0; i < 5; i++) {
                        byte b = (byte)((ts >> (7 * i)) & 0x7F);
                        if (i < 4) b |= 0x80;
                        list[10 + i] = b;
                    }
                    k.SetValue("Data", list.ToArray(), Microsoft.Win32.RegistryValueKind.Binary);
                    return true;
                }
            } catch { return false; }
        }

        // 1 = on (priority only / alarms only), 0 = off, -1 = unknown
        public static int GetDnd() {
            try {
                ulong name = WNF_QUIETHOURS_PROFILE;
                uint stamp; uint size = 4; var buf = new byte[4];
                if (NtQueryWnfStateData(ref name, IntPtr.Zero, IntPtr.Zero, out stamp, buf, ref size) != 0) return -1;
                return BitConverter.ToInt32(buf, 0) != 0 ? 1 : 0;
            } catch { return -1; }
        }

        public static bool SetDnd(bool on) {
            try {
                ulong name = WNF_QUIETHOURS_PROFILE;
                var b = BitConverter.GetBytes(on ? 1 : 0);
                return NtUpdateWnfStateData(ref name, b, 4, IntPtr.Zero, IntPtr.Zero, 0, 0) == 0;
            } catch { return false; }
        }
    }

    // "memory boost": trims the working sets of the user's background apps
    // (EmptyWorkingSet), returning idle memory to Windows without closing
    // anything. Skips system processes, the foreground app, this app (the
    // Rust parent's PID) and the WebView2 processes drawing the island.
    public static class MemOptimizer {
        [DllImport("psapi.dll")] static extern bool EmptyWorkingSet(IntPtr hProcess);
        [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

        [StructLayout(LayoutKind.Sequential)]
        struct MEMORYSTATUSEX {
            public uint dwLength; public uint dwMemoryLoad;
            public ulong ullTotalPhys; public ulong ullAvailPhys;
            public ulong ullTotalPageFile; public ulong ullAvailPageFile;
            public ulong ullTotalVirtual; public ulong ullAvailVirtual; public ulong ullAvailExtendedVirtual;
        }
        [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);

        const uint PROCESS_SET_QUOTA = 0x0100;
        const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        public static int ParentPid = 0;
        static readonly HashSet<string> Skip = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "System", "Idle", "Registry", "MemCompression", "smss", "csrss", "wininit", "winlogon", "services",
            "lsass", "dwm", "fontdrvhost", "audiodg", "sihost", "ctfmon", "Coucou", "msedgewebview2"
        };

        static ulong UsedBytes() {
            var m = new MEMORYSTATUSEX();
            m.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            return GlobalMemoryStatusEx(ref m) ? m.ullTotalPhys - m.ullAvailPhys : 0;
        }

        // Returns "freedMb|trimmed". Never throws: the loop skips anything it
        // cannot open, which is the common case for protected processes.
        public static string Run() {
            try {
                int self = Process.GetCurrentProcess().Id;
                int session = Process.GetCurrentProcess().SessionId;
                uint fg = 0;
                GetWindowThreadProcessId(GetForegroundWindow(), out fg);
                ulong usedBefore = UsedBytes();

                var procs = new List<Process>(Process.GetProcesses());
                procs.Sort((a, b) => { try { return b.WorkingSet64.CompareTo(a.WorkingSet64); } catch { return 0; } });

                int count = 0;
                foreach (var p in procs) {
                    try {
                        if (p.Id == self || p.Id == ParentPid || p.Id == (int)fg || p.Id <= 4 || p.SessionId != session) continue;
                        if (Skip.Contains(p.ProcessName)) continue;
                        long before = p.WorkingSet64;
                        if (before < 8L * 1024 * 1024) continue;
                        IntPtr h = OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_LIMITED_INFORMATION, false, p.Id);
                        if (h == IntPtr.Zero) continue;
                        bool ok = EmptyWorkingSet(h);
                        CloseHandle(h);
                        if (ok) count++;
                    } catch { }
                    finally { try { p.Dispose(); } catch { } }
                }

                Thread.Sleep(400); // let the memory manager settle
                ulong usedAfter = UsedBytes();
                long freed = usedBefore > usedAfter ? (long)((usedBefore - usedAfter) / (1024 * 1024)) : 0;
                return freed + "|" + count;
            } catch {
                return "0|0";
            }
        }
    }
}
'@

# The worker refuses to answer anything if the C# side did not compile; the
# reason rides along in every error response instead of a dead pipe.
$workerReady = $false
try {
    Add-Type -TypeDefinition $audioCode -ErrorAction Stop
    [WinAudioSys.MemOptimizer]::ParentPid = $ParentPid
    $workerReady = $true
} catch {
    $startupError = $_.Exception.Message
}

# ── Brightness via WmiMonitorBrightness ────────────────────────────────────────

function Get-CurrentBrightness {
    try {
        $inst = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
        if ($inst) { return [int]$inst.CurrentBrightness }
    } catch {}
    return $null
}

function Set-CurrentBrightness([int]$val) {
    if (-not $global:brightMethods) {
        try {
            $global:brightMethods = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
        } catch {}
    }
    if (-not $global:brightMethods) { return $false }
    try {
        Invoke-CimMethod -InputObject $global:brightMethods -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [uint32]$val } -ErrorAction Stop | Out-Null
        return $true
    } catch {
        # Stale CIM instance (e.g. after sleep/resume) - refresh once and retry
        $global:brightMethods = $null
        try {
            $global:brightMethods = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
        } catch {}
        if (-not $global:brightMethods) { return $false }
        try {
            Invoke-CimMethod -InputObject $global:brightMethods -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [uint32]$val } -ErrorAction Stop | Out-Null
            return $true
        } catch { return $false }
    }
}

# ── One JSON response per request ─────────────────────────────────────────────

function Invoke-Request($req) {
    $name = [string]$req.cmd

    if ($name -eq 'get_volume') {
        $level = [WinAudioSys.Audio]::GetMasterVolume()
        if ($level -lt 0) { return @{ ok = $false; error = 'No audio output device' } }
        return @{ ok = $true; level = [int][math]::Round($level); muted = [bool][WinAudioSys.Audio]::GetMute() }
    }

    elseif ($name -eq 'set_volume') {
        if (-not [WinAudioSys.Audio]::SetMasterVolume([int]$req.level)) { return @{ ok = $false; error = 'No audio output device' } }
        return @{ ok = $true; level = [int][math]::Round([WinAudioSys.Audio]::GetMasterVolume()); muted = [bool][WinAudioSys.Audio]::GetMute() }
    }

    elseif ($name -eq 'toggle_mute') {
        $level = [WinAudioSys.Audio]::GetMasterVolume()
        if ($level -lt 0) { return @{ ok = $false; error = 'No audio output device' } }
        if (-not [WinAudioSys.Audio]::SetMute(-not [WinAudioSys.Audio]::GetMute())) { return @{ ok = $false; error = 'No audio output device' } }
        return @{ ok = $true; level = [int][math]::Round($level); muted = [bool][WinAudioSys.Audio]::GetMute() }
    }

    elseif ($name -eq 'get_brightness') {
        $b = Get-CurrentBrightness
        if ($null -eq $b) { return @{ ok = $false; error = 'Brightness is not controllable on this display' } }
        return @{ ok = $true; level = [int]$b }
    }

    elseif ($name -eq 'set_brightness') {
        $val = [int]$req.level
        if ($val -lt 0) { $val = 0 }
        if ($val -gt 100) { $val = 100 }
        if (-not (Set-CurrentBrightness $val)) { return @{ ok = $false; error = 'Brightness is not controllable on this display' } }
        return @{ ok = $true; level = $val }
    }

    elseif ($name -eq 'toggle_night_light') {
        $cur = [WinAudioSys.SysToggles]::GetNightLight()
        if ($cur -lt 0) { return @{ ok = $false; error = 'Night light has never been configured on this PC' } }
        if (-not [WinAudioSys.SysToggles]::SetNightLight($cur -eq 0)) { return @{ ok = $false; error = 'Could not change Night light' } }
        return @{ ok = $true; nightLight = ([WinAudioSys.SysToggles]::GetNightLight() -eq 1) }
    }

    elseif ($name -eq 'toggle_dnd') {
        $cur = [WinAudioSys.SysToggles]::GetDnd()
        if ($cur -lt 0) { return @{ ok = $false; error = 'Do not disturb state is unavailable' } }
        if (-not [WinAudioSys.SysToggles]::SetDnd($cur -eq 0)) { return @{ ok = $false; error = 'Could not change Do not disturb' } }
        return @{ ok = $true; dnd = ([WinAudioSys.SysToggles]::GetDnd() -eq 1) }
    }

    elseif ($name -eq 'memory_boost') {
        $r = [WinAudioSys.MemOptimizer]::Run()
        $parts = $r.Split('|')
        return @{ ok = $true; freedMb = [int]$parts[0]; count = [int]$parts[1] }
    }

    else {
        return @{ ok = $false; error = "unknown command: $name" }
    }
}

# ── Main loop: one request line in, one response line out ─────────────────────

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq '') { continue }

    $resp = $null
    if (-not $workerReady) {
        $resp = @{ ok = $false; error = "the control worker failed to start: $startupError" }
    } else {
        try {
            $req = ConvertFrom-Json -InputObject $line
            # -Last 1: anything a handler leaked onto the pipeline before its
            # hashtable is dropped, so exactly one JSON object goes out.
            $resp = Invoke-Request $req | Select-Object -Last 1
        } catch {
            $resp = @{ ok = $false; error = $_.Exception.Message }
        }
        if ($null -eq $resp) { $resp = @{ ok = $false; error = 'the control worker produced no response' } }
    }

    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $resp -Compress -Depth 5))
    [Console]::Out.Flush()
}
[Environment]::Exit(0)
