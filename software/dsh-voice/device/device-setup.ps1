param([switch]$Check, [Alias('Port')][string]$InitialPort)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$script:serialConnection = $null
$script:buffer = ''
$script:pending = $null
$script:sendAt = [DateTime]::MaxValue
$script:accepted = $false
$script:nextStatus = [DateTime]::MaxValue
$script:deadline = [DateTime]::MaxValue
$script:savedAddress = ''
$random = New-Object byte[] 24
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($random)
$rng.Dispose()
$script:token = ([BitConverter]::ToString($random)).Replace('-', '').ToLowerInvariant()

$form = New-Object Windows.Forms.Form
$form.Text = 'LEASE VOICE 设备配网 · 0.7.3'
$form.ClientSize = New-Object Drawing.Size(470, 410)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object Drawing.Font('Microsoft YaHei UI', 10)

function Add-Label([string]$text, [int]$y) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $text
    $label.Location = New-Object Drawing.Point(20, $y)
    $label.Size = New-Object Drawing.Size(120, 28)
    $form.Controls.Add($label)
}
function Add-Input([int]$y) {
    $inputBox = New-Object Windows.Forms.TextBox
    $inputBox.Location = New-Object Drawing.Point(145, $y)
    $inputBox.Size = New-Object Drawing.Size(300, 28)
    $form.Controls.Add($inputBox)
    return $inputBox
}
Add-Label '串口' 22
$portBox = New-Object Windows.Forms.ComboBox
$portBox.Location = New-Object Drawing.Point(145, 20)
$portBox.Size = New-Object Drawing.Size(220, 28)
$portBox.DropDownStyle = 'DropDown'
$form.Controls.Add($portBox)
function Refresh-Ports {
    $selected = $portBox.Text
    $portBox.Items.Clear()
    foreach ($item in ([IO.Ports.SerialPort]::GetPortNames() | Sort-Object)) { [void]$portBox.Items.Add($item) }
    if ($selected) { $portBox.Text = $selected }
    elseif ($portBox.Items.Count -gt 0) { $portBox.SelectedIndex = 0 }
}
$refresh = New-Object Windows.Forms.Button
$refresh.Text = '刷新'
$refresh.Location = New-Object Drawing.Point(375, 20)
$refresh.Size = New-Object Drawing.Size(70, 28)
$refresh.Add_Click({ Refresh-Ports })
$form.Controls.Add($refresh)
Refresh-Ports
if ($InitialPort) { $portBox.Text = $InitialPort }
Add-Label 'Wi-Fi 名称' 65
$ssidBox = Add-Input 63
Add-Label 'Wi-Fi 密码' 108
$passwordBox = Add-Input 106
$passwordBox.UseSystemPasswordChar = $true
$note = New-Object Windows.Forms.Label
$note.Text = '请使用 2.4GHz Wi-Fi。密码只发送给 USB 连接的设备。'
$note.Location = New-Object Drawing.Point(20, 150)
$note.Size = New-Object Drawing.Size(430, 40)
$form.Controls.Add($note)
$button = New-Object Windows.Forms.Button
$button.Text = '保存并连接'
$button.Location = New-Object Drawing.Point(145, 195)
$button.Size = New-Object Drawing.Size(155, 35)
$form.Controls.Add($button)
$status = New-Object Windows.Forms.Label
$status.Text = '配套 M1+ 固件可用；请先关闭占用串口的软件。'
$status.Location = New-Object Drawing.Point(20, 246)
$status.Size = New-Object Drawing.Size(430, 55)
$form.Controls.Add($status)

# Idempotent cleanup: a failed/legacy assignment must never prevent window closure.
function Release-SerialConnection {
    $connection = $script:serialConnection
    $script:serialConnection = $null
    $script:pending = $null
    $script:buffer = ''
    $script:sendAt = [DateTime]::MaxValue
    $script:nextStatus = [DateTime]::MaxValue
    $script:deadline = [DateTime]::MaxValue
    if ($connection -is [IO.Ports.SerialPort]) {
        try { if ($connection.IsOpen) { $connection.Close() } } catch {}
        finally { try { $connection.Dispose() } catch {} }
    }
}
function Cancel-Provisioning {
    Release-SerialConnection
    $script:accepted = $false
    $script:savedAddress = ''
    $passwordBox.Clear()
    $export.Enabled = $false
    $button.Enabled = $true
    $status.Text = '已取消并释放串口，可以重试或关闭窗口；已发送到设备的设置不会回滚。'
}
$cancel = New-Object Windows.Forms.Button
$cancel.Text = '取消 / 释放串口'
$cancel.Location = New-Object Drawing.Point(305, 195)
$cancel.Size = New-Object Drawing.Size(140, 35)
$cancel.Add_Click({ Cancel-Provisioning })
$form.Controls.Add($cancel)
$form.CancelButton = $cancel

function Save-Device([string]$address) {
    $parsedIp = $null
    if (-not [Net.IPAddress]::TryParse($address, [ref]$parsedIp)) { return }
    if ($parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return }
    $script:savedAddress = $address
    $status.Text = '已联网：http://' + $address + '。可导出配对文件，再到插件设备页导入并检查连接。'
    $export.Enabled = $true
}

$button.Add_Click({
    try {
        if ($portBox.Text.Trim() -notmatch '^COM[1-9][0-9]*$') { $status.Text = '请选择或输入有效串口，例如 COM3。'; return }
        $export.Enabled = $false
        if ([string]::IsNullOrWhiteSpace($ssidBox.Text)) { $status.Text = '请填写 Wi-Fi 名称。'; return }
        if ([Text.Encoding]::UTF8.GetByteCount($ssidBox.Text) -gt 32) { $status.Text = 'Wi-Fi 名称超过 32 字节。'; return }
        if ([Text.Encoding]::UTF8.GetByteCount($passwordBox.Text) -gt 63) { $status.Text = 'Wi-Fi 密码超过 63 字节。'; return }
        Release-SerialConnection
        $script:serialConnection = New-Object IO.Ports.SerialPort($portBox.Text.Trim(), 115200)
        $script:serialConnection.DtrEnable = $false
        $script:serialConnection.RtsEnable = $false
        $script:serialConnection.Encoding = New-Object Text.UTF8Encoding($false)
        $script:serialConnection.NewLine = "`n"
        $script:serialConnection.ReadTimeout = 100
        $script:serialConnection.WriteTimeout = 1500
        $script:serialConnection.Open()
        $script:buffer = ''
        $script:accepted = $false
        $script:savedAddress = ''
        $request = @{ action = 'wifi-set'; ssid = $ssidBox.Text; password = $passwordBox.Text; token = $script:token }
        $script:pending = $request | ConvertTo-Json -Compress
        $passwordBox.Clear()
        $request = $null
        $script:sendAt = [DateTime]::UtcNow.AddSeconds(2)
        $script:nextStatus = [DateTime]::MaxValue
        $script:deadline = [DateTime]::UtcNow.AddSeconds(20)
        $button.Enabled = $false
        $status.Text = '正在通过 USB 配置设备…'
    } catch {
        $script:pending = $null
        $button.Enabled = $true
        $status.Text = '无法配置：请检查串口，关闭其他串口工具后重试。'
        Release-SerialConnection
    }
})

Add-Label '设备名称' 310
$nameBox = Add-Input 308
$nameBox.Text = '我的 ESP32-S3'
$export = New-Object Windows.Forms.Button
$export.Text = '导出配对文件（含敏感Token）'
$export.Location = New-Object Drawing.Point(145, 350)
$export.Size = New-Object Drawing.Size(300, 35)
$export.Enabled = $false
$form.Controls.Add($export)
$export.Add_Click({
    if (-not $script:savedAddress) { return }
    $dialog = New-Object Windows.Forms.SaveFileDialog
    $dialog.Filter = 'LEASE 配对文件 (*.pairing.json)|*.pairing.json'
    $dialog.FileName = 'lease-device.pairing.json'
    try {
        if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { return }
        $record = @{ name = $nameBox.Text.Trim(); endpoint = ('http://' + $script:savedAddress); token = $script:token }
        $json = $record | ConvertTo-Json
        [IO.File]::WriteAllText($dialog.FileName, $json, (New-Object Text.UTF8Encoding($false)))
        $status.Text = '配对文件已导出，含敏感 Token，请勿上传、提交或分享。'
    } catch { $status.Text = '导出失败，请检查保存位置的写入权限。' }
    finally { $dialog.Dispose() }
})
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
    if ($script:serialConnection -isnot [IO.Ports.SerialPort]) { return }
    try {
        if (-not $script:serialConnection.IsOpen) { return }
        if ($script:pending -and [DateTime]::UtcNow -ge $script:sendAt) {
            $script:serialConnection.WriteLine($script:pending)
            $script:pending = $null
            $script:nextStatus = [DateTime]::UtcNow.AddSeconds(3)
        }
        if ([DateTime]::UtcNow -ge $script:deadline) {
            $script:deadline = [DateTime]::MaxValue
            $button.Enabled = $true
            if (-not $script:accepted) {
                $status.Text = '设备未确认配置，请确认已烧录配套固件 后重试。'
                Release-SerialConnection
                return
            }
            if (-not $script:savedAddress) {
                Release-SerialConnection
                $export.Enabled = $false
                $status.Text = '尚未获取 IP，已释放串口；请检查 Wi-Fi 名称、密码及 2.4GHz 网络后重试。'
                return
            }
        }
        if ([DateTime]::UtcNow -ge $script:nextStatus) {
            $script:serialConnection.WriteLine('{"action":"status"}')
            $script:nextStatus = [DateTime]::UtcNow.AddSeconds(3)
        }
        $script:buffer += $script:serialConnection.ReadExisting()
        if ($script:buffer.Length -gt 32768) { $script:buffer = $script:buffer.Substring($script:buffer.Length - 16384) }
        while ($script:buffer.Contains("`n")) {
            $cut = $script:buffer.IndexOf("`n")
            $line = $script:buffer.Substring(0, $cut).Trim()
            $script:buffer = $script:buffer.Substring($cut + 1)
            if (-not $line.StartsWith('{')) { continue }
            try { $reply = $line | ConvertFrom-Json } catch { continue }
            if ($reply.protocol -ne 1) { continue }
            if ($reply.action -eq 'wifi-set') {
                if ($reply.ok -eq $true) {
                    $script:accepted = $true
                    $script:deadline = [DateTime]::UtcNow.AddSeconds(40)
                    $status.Text = '配置已保存，正在连接 Wi-Fi…'
                } else {
                    Release-SerialConnection
                    $status.Text = '设备拒绝配置，请检查名称和密码后重试。'
                    $button.Enabled = $true
                }
            }
            if ($script:accepted -and $reply.state -eq 'connected' -and $reply.ip) {
                Save-Device ([string]$reply.ip)
                $button.Enabled = $true
            } elseif ($script:accepted -and $reply.action -eq 'status' -and $reply.state) {
                $export.Enabled = $false
                $status.Text = '联网状态：' + [string]$reply.state + '，等待设备获取 IP…'
            }
        }
    } catch {
        $script:pending = $null
        $export.Enabled = $false
        $status.Text = '设备连接中断，请检查 USB 后重试。'
        $button.Enabled = $true
        Release-SerialConnection
    }
})
$form.Add_FormClosing({
    $timer.Stop()
    Release-SerialConnection
    $passwordBox.Clear()
})
$form.Add_FormClosed({ $script:formClosed = $true })
try {
    if ($Check) {
        if ($InitialPort -and $portBox.Text -ne $InitialPort) { throw 'Port argument was not passed to selector' }
        # No test opens a port, sends wifi-set or reads user credentials.
        foreach ($invalid in @($null, '', 'COM3')) {
            $script:serialConnection = $invalid
            $script:pending = 'fixture-not-a-credential'
            Release-SerialConnection
            Release-SerialConnection
            if ($null -ne $script:serialConnection -or $null -ne $script:pending) { throw 'Cleanup did not clear state' }
        }
        $script:serialConnection = New-Object IO.Ports.SerialPort('COM3', 115200)
        $script:serialConnection.DtrEnable = $false
        $script:serialConnection.RtsEnable = $false
        Release-SerialConnection
        $script:serialConnection = New-Object IO.Ports.SerialPort('COM3', 115200)
        $script:serialConnection.Dispose()
        Release-SerialConnection
        $script:serialConnection = 'COM3'
        Cancel-Provisioning
        if (-not $button.Enabled -or $export.Enabled) { throw 'Cancel left invalid control state' }
        # Exercise actual WinForms events, not just constructing and disposing controls.
        $form.Opacity = 0
        $form.ShowInTaskbar = $false
        $script:formClosed = $false
        $script:serialConnection = 'COM3'
        $closeTest = New-Object Windows.Forms.Timer
        $closeTest.Interval = 100
        $closeTest.Add_Tick({ $closeTest.Stop(); $cancel.PerformClick(); $script:serialConnection = 'COM3'; $form.Close() })
        try { $closeTest.Start(); [void]$form.ShowDialog() }
        finally { $closeTest.Dispose() }
        if (-not $script:formClosed -or $null -ne $script:serialConnection) { throw 'Form close failed' }
        Write-Output 'PASS: null/string/closed/disposed serial cleanup, repeated cleanup, cancel and actual FormClosing/FormClosed; no serial port opened.'
    } else {
        $timer.Start()
        [void]$form.ShowDialog()
    }
} finally {
    $timer.Stop()
    Release-SerialConnection
    $timer.Dispose()
    $form.Dispose()
}
