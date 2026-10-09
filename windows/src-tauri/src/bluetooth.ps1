# Bluetooth worker — paired devices, connect/disconnect and battery levels for
# the Coucou island. Rust spawns this on the first command: one JSON request
# per stdin line, one JSON response per stdout line.
#
# Ported from the reference Dynamic_island system_control.ps1 — the same
# IDeviceTopology / IKsControl one-shot reconnect on the Bluetooth audio driver
# (on its own dedicated STA thread, because those COM objects are
# apartment-threaded), the WinRT DeviceInformation enumeration and the
# cfgmgr32 battery walk — minus the polling loops: this worker answers a
# command and goes back to sleeping in ReadLine.

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$btCode = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace WinBt {
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

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int df, int sm, out IMMDeviceCollection devs);
        int GetDefaultAudioEndpoint(int df, int role, out IMMDevice ep);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ep);
        int RegisterEndpointNotificationCallback(IMMNotificationClient pClient);
        int UnregisterEndpointNotificationCallback(IMMNotificationClient pClient);
    }

    [Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMNotificationClient {
        void OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId, uint dwNewState);
        void OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId);
        void OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId);
        void OnDefaultDeviceChanged(int dataFlow, int role, [MarshalAs(UnmanagedType.LPWStr)] string pwstrDefaultDeviceId);
        void OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId, PROPERTYKEY key);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDevEnum { }

    [Guid("2A07407E-6497-4A18-9787-32F79BD0D98F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IDeviceTopology {
        int GetConnectorCount(out uint pCount);
        int GetConnector(uint nIndex, out IConnector ppConnector);
    }

    [Guid("9C2C4058-23F5-41DE-877A-DF3AF236A09E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IConnector {
        int GetConnectorType(out int pType);
        int GetDataFlow(out int pFlow);
        int ConnectTo(IConnector pConnectTo);
        int Disconnect();
        int IsConnected(out bool pbConnected);
        int GetConnectedTo(out IConnector ppConTo);
        int GetConnectorIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string ppwstrConnectorId);
        int GetDeviceIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string ppwstrDeviceId);
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KSPROPERTY {
        public Guid Set;
        public int Id;
        public int Flags;
    }

    [Guid("28F54685-06FD-11D2-B27A-00A0C9223196"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IKsControl {
        [PreserveSig] int KsProperty(ref KSPROPERTY Property, int PropertyLength, IntPtr PropertyData, int DataLength, out int BytesReturned);
    }

    // Quick connect for paired Bluetooth audio devices (headphones, speakers, headsets).
    // Windows has no public "connect this Bluetooth device" API; this is the same
    // request the Windows sound panel's Connect button sends: a one-shot reconnect /
    // disconnect property on the Bluetooth audio driver behind each audio endpoint.
    // Other Bluetooth devices (mice, keyboards) connect on their own.
    // Ported from the reference; its Report()/SetAsync() jobs printed to stdout
    // themselves, here the main thread owns stdout (exactly one JSON line per
    // request), so a job hands its result back through a slot and the caller waits.
    public class BtConnect {
        static readonly Guid BtAudioSet = new Guid("7FA06C40-B8F6-4C7E-8556-E8C33A12E54D");
        const int OneShotReconnect = 0, OneShotDisconnect = 1, TypeGet = 1;

        public class Dev {
            public string Id;
            public string Name;
            public bool Connected;
            public List<string> Controls = new List<string>();
        }

        public class Outcome {
            public bool Accepted;
            public bool Reached;
        }

        static PROPERTYKEY Key(string fmtid, int pid) {
            PROPERTYKEY k = new PROPERTYKEY(); k.fmtid = new Guid(fmtid); k.pid = pid; return k;
        }

        static string CleanName(string n) {
            if (string.IsNullOrEmpty(n)) return "";
            foreach (string suffix in new string[] { " Hands-Free AG Audio", " Hands-Free AG", " Hands-Free Audio", " Hands-Free", " Stereo", " Avrcp Transport" }) {
                if (n.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) n = n.Substring(0, n.Length - suffix.Length);
            }
            return n.Trim();
        }

        // Paired Bluetooth audio devices, one entry per physical device
        public static List<Dev> Scan() {
            var byId = new Dictionary<string, Dev>(StringComparer.OrdinalIgnoreCase);
            var list = new List<Dev>();
            IMMDeviceEnumerator en = null;
            IMMDeviceCollection coll = null;
            try {
                en = (IMMDeviceEnumerator)new MMDevEnum();
                // Render and capture endpoints that are active, unplugged or not present
                en.EnumAudioEndpoints(2, 1 | 4 | 8, out coll);
                int count; coll.GetCount(out count);
                PROPERTYKEY pkContainer = Key("8c7ed206-3f8a-4827-b3ab-ae9e1faefc6c", 2);
                PROPERTYKEY pkAdapter = Key("026e516e-b814-414b-83cd-856d6fef4822", 2);
                Guid iidTopo = typeof(IDeviceTopology).GUID;
                for (int i = 0; i < count; i++) {
                    IMMDevice dev = null;
                    object topoObj = null;
                    IConnector con = null;
                    IPropertyStore ps = null;
                    try {
                        coll.Item(i, out dev);
                        dev.Activate(ref iidTopo, 23, IntPtr.Zero, out topoObj);
                        ((IDeviceTopology)topoObj).GetConnector(0, out con);
                        string controlId;
                        con.GetDeviceIdConnectedTo(out controlId);
                        if (controlId == null || controlId.IndexOf(@"\\?\bth", StringComparison.OrdinalIgnoreCase) < 0) continue;

                        int state; dev.GetState(out state);
                        dev.OpenPropertyStore(0, out ps);
                        PROPVARIANT pv;
                        string id = controlId, name = "";
                        ps.GetValue(ref pkContainer, out pv);
                        if (pv.vt == 72 && pv.pwszVal != IntPtr.Zero) id = ((Guid)Marshal.PtrToStructure(pv.pwszVal, typeof(Guid))).ToString();
                        ps.GetValue(ref pkAdapter, out pv);
                        if (pv.vt == 31 && pv.pwszVal != IntPtr.Zero) name = CleanName(Marshal.PtrToStringUni(pv.pwszVal));

                        Dev d;
                        if (!byId.TryGetValue(id, out d)) { d = new Dev(); d.Id = id; d.Name = name; byId[id] = d; list.Add(d); }
                        if (d.Name == "" && name != "") d.Name = name;
                        if (state == 1) d.Connected = true;
                        if (!d.Controls.Contains(controlId)) d.Controls.Add(controlId);
                    } catch { }
                    finally { Release(ps); Release(con); Release(topoObj); Release(dev); }
                }
            } catch { }
            finally {
                if (coll != null) { try { Marshal.ReleaseComObject(coll); } catch { } }
                if (en != null) { try { Marshal.ReleaseComObject(en); } catch { } }
            }
            list.RemoveAll(d => d.Name == "");
            return list;
        }

        static void Release(object o) {
            if (o != null) { try { Marshal.ReleaseComObject(o); } catch { } }
        }

        // All of this runs on one dedicated STA thread. The audio topology objects are
        // apartment-threaded: touched from the command thread (which blocks reading
        // stdin and never pumps messages) they deadlock every later call.
        static readonly List<Action> _jobs = new List<Action>();
        static readonly AutoResetEvent _wake = new AutoResetEvent(false);
        static readonly ManualResetEvent _never = new ManualResetEvent(false);
        static Thread _worker;

        static void Post(Action job) {
            lock (_jobs) {
                _jobs.Add(job);
                if (_worker == null) {
                    _worker = new Thread(Work);
                    _worker.SetApartmentState(ApartmentState.STA);
                    _worker.IsBackground = true;
                    _worker.Start();
                }
            }
            _wake.Set();
        }

        static void Work() {
            while (true) {
                Action job = null;
                lock (_jobs) { if (_jobs.Count > 0) { job = _jobs[0]; _jobs.RemoveAt(0); } }
                if (job == null) { _wake.WaitOne(); continue; }
                try { job(); } catch { }
            }
        }

        // One scan for the main thread: the result arrives in a slot instead of on
        // stdout, so the response line is always the worker's own JSON.
        public static Dev[] ScanSync() {
            Dev[] result = null;
            var done = new ManualResetEvent(false);
            Post(() => {
                try { result = Scan().ToArray(); } catch { }
                finally { done.Set(); }
            });
            done.WaitOne();
            return result;
        }

        // Asks the driver to connect (or disconnect) every audio service of the device,
        // then waits for the device to actually change state. Returns whether the
        // request was accepted and whether the state was reached.
        public static Outcome SetSync(string id, bool connect) {
            var outcome = new Outcome();
            var done = new ManualResetEvent(false);
            Post(() => {
                try {
                    if (Set(id, connect)) {
                        outcome.Accepted = true;
                        for (int i = 0; i < 30 && !outcome.Reached; i++) {
                            _never.WaitOne(400);   // a wait that keeps this STA's message pump alive
                            Dev d = Scan().Find(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase));
                            outcome.Reached = d != null && d.Connected == connect;
                        }
                    }
                } catch { }
                finally { done.Set(); }
            });
            done.WaitOne();
            return outcome;
        }

        // Asks the driver to connect (or disconnect) every audio service of the device.
        // Returns true if at least one request was accepted; the connection itself
        // completes a moment later.
        static bool Set(string id, bool connect) {
            bool ok = false;
            IMMDeviceEnumerator en = null;
            try {
                Dev target = Scan().Find(d => string.Equals(d.Id, id, StringComparison.OrdinalIgnoreCase));
                if (target == null) return false;
                en = (IMMDeviceEnumerator)new MMDevEnum();
                Guid iidKs = typeof(IKsControl).GUID;
                foreach (string controlId in target.Controls) {
                    IMMDevice ctl = null;
                    object ksObj = null;
                    try {
                        en.GetDevice(controlId, out ctl);
                        ctl.Activate(ref iidKs, 23, IntPtr.Zero, out ksObj);
                        KSPROPERTY prop = new KSPROPERTY();
                        prop.Set = BtAudioSet;
                        prop.Id = connect ? OneShotReconnect : OneShotDisconnect;
                        prop.Flags = TypeGet;
                        int returned;
                        if (((IKsControl)ksObj).KsProperty(ref prop, Marshal.SizeOf(typeof(KSPROPERTY)), IntPtr.Zero, 0, out returned) >= 0) ok = true;
                    } catch { }
                    finally { Release(ksObj); Release(ctl); }
                }
            } catch { }
            finally { Release(en); }
            return ok;
        }
    }

    public class BtHelper {
        [DllImport("cfgmgr32.dll", EntryPoint = "CM_Get_Device_ID_List_SizeW", CharSet = CharSet.Unicode)]
        public static extern int CM_Get_Device_ID_List_Size(out uint pulLen, string pszFilter, uint ulFlags);

        [DllImport("cfgmgr32.dll", EntryPoint = "CM_Get_Device_ID_ListW", CharSet = CharSet.Unicode)]
        public static extern int CM_Get_Device_ID_List(string pszFilter, [Out] char[] buffer, uint bufferLen, uint ulFlags);

        [DllImport("cfgmgr32.dll", EntryPoint = "CM_Locate_DevNodeW", CharSet = CharSet.Unicode)]
        public static extern int CM_Locate_DevNode(out uint devInst, string devId, int flags);

        [StructLayout(LayoutKind.Sequential)]
        public struct DEVPROPKEY {
            public Guid fmtid;
            public uint pid;
        }

        [DllImport("cfgmgr32.dll", EntryPoint = "CM_Get_DevNode_PropertyW", CharSet = CharSet.Unicode)]
        public static extern int CM_Get_DevNode_Property(uint devInst, ref DEVPROPKEY propertyKey, out uint propertyType, byte[] propertyBuffer, ref uint propertyBufferSize, uint flags);

        private static DEVPROPKEY pkDesc = new DEVPROPKEY { fmtid = new Guid("b725f130-47ef-101a-a5f1-02608c9eebac"), pid = 10 };
        private static DEVPROPKEY pkFriendly = new DEVPROPKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 12 };
        private static DEVPROPKEY pkBatt = new DEVPROPKEY { fmtid = new Guid("104EA319-6EE2-4701-BD47-8DDBF425BBE5"), pid = 2 };

        private static string ReadStringProp(uint devInst, ref DEVPROPKEY pk) {
            uint ptype = 0;
            byte[] buf = new byte[512];
            uint size = 512;
            if (CM_Get_DevNode_Property(devInst, ref pk, out ptype, buf, ref size, 0) == 0 && size > 2) {
                return System.Text.Encoding.Unicode.GetString(buf, 0, (int)size).TrimEnd('\0', ' ');
            }
            return "";
        }

        public static Dictionary<string, int> GetAllBatteries() {
            var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            // Query present devices in BTHENUM and BTHLE (0x100 = CM_GETIDLIST_FILTER_PRESENT)
            foreach (string filter in new string[] { "BTHENUM", "BTHLE" }) {
                uint len = 0;
                if (CM_Get_Device_ID_List_Size(out len, filter, 0x100) != 0 || len == 0) continue;
                char[] buf = new char[len];
                if (CM_Get_Device_ID_List(filter, buf, len, 0x100) != 0) continue;

                string all = new string(buf);
                string[] ids = all.Split(new char[] { '\0' }, StringSplitOptions.RemoveEmptyEntries);

                foreach (string id in ids) {
                    uint devInst;
                    if (CM_Locate_DevNode(out devInst, id, 0) != 0) continue;

                    uint ptype = 0;
                    uint bSize = 4;
                    byte[] bBuf = new byte[4];
                    if (CM_Get_DevNode_Property(devInst, ref pkBatt, out ptype, bBuf, ref bSize, 0) == 0 && bSize > 0) {
                        int batt = (int)bBuf[0];

                        string rawName = ReadStringProp(devInst, ref pkFriendly);
                        if (string.IsNullOrEmpty(rawName)) {
                            rawName = ReadStringProp(devInst, ref pkDesc);
                        }

                        if (!string.IsNullOrEmpty(rawName)) {
                            string clean = rawName
                                .Replace(" Hands-Free AG", "")
                                .Replace(" Hands-Free", "")
                                .Replace(" Avrcp Transport", "")
                                .Trim();
                            map[clean] = batt;
                        }
                    }
                }
            }
            return map;
        }
    }
}
'@

# The worker refuses to answer anything if the C# side did not compile; the
# reason rides along in every error response instead of a dead pipe.
$workerReady = $false
try {
    Add-Type -TypeDefinition $btCode -ErrorAction Stop
    $workerReady = $true
} catch {
    $startupError = $_.Exception.Message
}

# WinRT enumeration — the Bluetooth devices Windows sees as connected, of every
# kind (mice, keyboards, phones), not only the audio endpoints below. If it is
# unavailable the audio-topology scan alone still answers.
$btSelector = $null
$asTaskGeneric = $null
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
    [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType=WindowsRuntime] | Out-Null
    [Windows.Devices.Bluetooth.BluetoothConnectionStatus, Windows.Devices.Bluetooth, ContentType=WindowsRuntime] | Out-Null
    [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType=WindowsRuntime] | Out-Null
    $btSelector = [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromConnectionStatus([Windows.Devices.Bluetooth.BluetoothConnectionStatus]::Connected)
    $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod
    } | Select-Object -First 1
} catch {}

# ── Bluetooth helpers (ported from the reference) ─────────────────────────────

function Normalize-BtName($n) {
    if (-not $n) { return $null }
    $n = $n.Trim()
    $n = $n -replace '(?i)\s+Hands-Free( AG)?( Audio)?$', '' -replace '(?i)\s+Stereo$', '' -replace '(?i)\s+Avrcp Transport$', ''
    $n = $n.Trim()
    if ($n) { return $n }
    return $null
}

function Find-Battery($name, $battMap) {
    if (-not $name -or -not $battMap) { return -1 }
    if ($battMap.ContainsKey($name)) { return [int]$battMap[$name] }
    foreach ($k in $battMap.Keys) {
        if ($name.IndexOf($k, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $k.IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return [int]$battMap[$k]
        }
    }
    return -1
}

# Names of the Bluetooth devices Windows reports as connected (WinRT), or @()
# when WinRT is unavailable or the query times out.
function Get-WinRtNames {
    $names = @()
    if ($btSelector -and $asTaskGeneric) {
        try {
            $op = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($btSelector)
            $asTask = $asTaskGeneric.MakeGenericMethod([Windows.Devices.Enumeration.DeviceInformationCollection])
            $task = $asTask.Invoke($null, @($op))
            if ($task.Wait(3000)) {
                $names = @($task.Result | ForEach-Object { Normalize-BtName $_.Name } | Where-Object { $_ })
            }
        } catch {}
    }
    return ,$names
}

# Icon hint for the island, from the reference's pickDeviceIcon
# (BluetoothAlert.jsx): a case-insensitive match on the device name.
function Get-DeviceType([string]$name) {
    if (-not $name) { return '' }
    $n = $name.ToLowerInvariant()
    if ($n -match 'airpod|buds|earbud|ear|tws|headphone|headset|rockerz|wh-|wf-|qc|soundcore|tune|studio|bass|anc|jabra|beats') { return 'headphones' }
    if ($n -match 'speaker|soundbar|boom|flip|charge|jbl go|stone') { return 'speaker' }
    if ($n -match 'keyboard|keys') { return 'keyboard' }
    if ($n -match 'mouse|mx master|trackpad') { return 'mouse' }
    if ($n -match 'controller|gamepad|xbox|dualsense|dualshock') { return 'gamepad' }
    if ($n -match 'phone|galaxy|pixel|iphone|redmi|oneplus') { return 'phone' }
    return ''
}

# The device list: the paired audio devices the driver knows about (connected or
# not, with the controls connect/disconnect needs) plus every Bluetooth device
# Windows reports as connected. Battery only exists while a device is present,
# so a disconnected device reports -1, like the reference.
function Get-BtDevices {
    $audio = [WinBt.BtConnect]::ScanSync()
    if ($null -eq $audio) { $audio = @() }

    $batt = $null
    try { $batt = [WinBt.BtHelper]::GetAllBatteries() } catch {}

    $list = New-Object System.Collections.Generic.List[object]
    $names = New-Object System.Collections.Generic.List[string]

    foreach ($d in @($audio)) {
        if (-not $d.Name) { continue }
        $names.Add($d.Name)
        $b = -1
        if ($d.Connected) { $b = Find-Battery $d.Name $batt }
        $list.Add([pscustomobject]@{
            name      = $d.Name
            type      = Get-DeviceType $d.Name
            battery   = $b
            connected = [bool]$d.Connected
        })
    }

    foreach ($n in @(Get-WinRtNames)) {
        $dup = $false
        foreach ($existing in $names) {
            if ($existing.IndexOf($n, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $n.IndexOf($existing, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $dup = $true; break }
        }
        if ($dup) { continue }
        $names.Add($n)
        $list.Add([pscustomobject]@{
            name      = $n
            type      = Get-DeviceType $n
            battery   = Find-Battery $n $batt
            connected = $true
        })
    }

    return $list.ToArray()
}

# The displayed name may come from WinRT while the controls hang off the audio
# adapter's name, so fall back to the reference's contains-match.
function Find-Connectable([string]$name, $audio) {
    if (-not $name) { return $null }
    foreach ($d in @($audio)) {
        if ($d.Name -and $d.Name -eq $name) { return $d }
    }
    foreach ($d in @($audio)) {
        $n = $d.Name
        if ($n -and ($n.IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $name.IndexOf($n, [StringComparison]::OrdinalIgnoreCase) -ge 0)) { return $d }
    }
    return $null
}

# ── One JSON response per request ─────────────────────────────────────────────

function Invoke-Request($req) {
    $name = [string]$req.cmd

    if ($name -eq 'get_bt_devices') {
        return @{ ok = $true; devices = @(Get-BtDevices) }
    }

    elseif ($name -eq 'bt_connect' -or $name -eq 'bt_disconnect') {
        $connect = ($name -eq 'bt_connect')
        $verb = if ($connect) { 'connect' } else { 'disconnect' }
        $devName = [string]$req.name
        if (-not $devName) { return @{ ok = $false; error = 'missing device name' } }

        $audio = [WinBt.BtConnect]::ScanSync()
        if ($null -eq $audio) { $audio = @() }
        $target = Find-Connectable $devName $audio
        if ($null -eq $target) {
            return @{ ok = $false; error = "Not a connectable Bluetooth audio device: $devName"; devices = @(Get-BtDevices) }
        }

        $outcome = [WinBt.BtConnect]::SetSync($target.Id, $connect)
        if (-not $outcome.Accepted) {
            return @{ ok = $false; error = "Could not $verb $devName"; devices = @(Get-BtDevices) }
        }
        $devices = @(Get-BtDevices)
        if (-not $outcome.Reached) {
            return @{ ok = $false; error = "$devName did not $verb in time"; devices = $devices }
        }
        return @{ ok = $true; devices = $devices }
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
        $resp = @{ ok = $false; error = "the bluetooth worker failed to start: $startupError" }
    } else {
        try {
            $req = ConvertFrom-Json -InputObject $line
            # -Last 1: anything a handler leaked onto the pipeline before its
            # hashtable is dropped, so exactly one JSON object goes out.
            $resp = Invoke-Request $req | Select-Object -Last 1
        } catch {
            $resp = @{ ok = $false; error = $_.Exception.Message }
        }
        if ($null -eq $resp) { $resp = @{ ok = $false; error = 'the bluetooth worker produced no response' } }
    }

    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $resp -Compress -Depth 5))
    [Console]::Out.Flush()
}
[Environment]::Exit(0)
