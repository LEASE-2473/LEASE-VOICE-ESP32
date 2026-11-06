param([switch]$Check)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$script:port = $null
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
$script:dataDir = Join-Path $PSScriptRoot 'data'

$form = New-Object Windows.Forms.Form
$form.Text = 'LEASE 设备配网'
$form.ClientSize = New-Object Drawing.Size(470, 310)
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
$portBox = Add-Input 20
$portBox.Text = 'COM3'
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
$status.Text = '烧录 M1 后使用；请先关闭烧录软件。'
$status.Location = New-Object Drawing.Point(20, 246)
$status.Size = New-Object Drawing.Size(430, 55)
$form.Controls.Add($status)

function Save-Device([string]$address) {
    $parsedIp = $null
    if (-not [Net.IPAddress]::TryParse($address, [ref]$parsedIp)) { return }
    if ($parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return }
    if ($script:savedAddress -eq $address) { return }
    New-Item -ItemType Directory -Path $script:dataDir -Force | Out-Null
    $record = @{ endpoint = ('http://' + $address); token = $script:token; port = $portBox.Text.Trim() }
    $json = $record | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $script:dataDir 'device.json'), $json, (New-Object Text.UTF8Encoding($false)))
    $script:savedAddress = $address
    $status.Text = '已连接，设备地址：http://' + $address
}

$button.Add_Click({
    try {
        if ([string]::IsNullOrWhiteSpace($ssidBox.Text)) { $status.Text = '请填写 Wi-Fi 名称。'; return }
        if ([Text.Encoding]::UTF8.GetByteCount($ssidBox.Text) -gt 32) { $status.Text = 'Wi-Fi 名称超过 32 字节。'; return }
        if ([Text.Encoding]::UTF8.GetByteCount($passwordBox.Text) -gt 63) { $status.Text = 'Wi-Fi 密码超过 63 字节。'; return }
        if ($script:port -and $script:port.IsOpen) { $script:port.Close() }
        $script:port = New-Object IO.Ports.SerialPort($portBox.Text.Trim(), 115200)
        $script:port.DtrEnable = $false
        $script:port.RtsEnable = $false
        $script:port.Encoding = New-Object Text.UTF8Encoding($false)
        $script:port.NewLine = "`n"
        $script:port.ReadTimeout = 100
        $script:port.WriteTimeout = 1500
        $script:port.Open()
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
        if ($script:port -and $script:port.IsOpen) { $script:port.Close() }
    }
})

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
    if (-not $script:port -or -not $script:port.IsOpen) { return }
    try {
        if ($script:pending -and [DateTime]::UtcNow -ge $script:sendAt) {
            $script:port.WriteLine($script:pending)
            $script:pending = $null
            $script:nextStatus = [DateTime]::UtcNow.AddSeconds(3)
        }
        if ([DateTime]::UtcNow -ge $script:deadline) {
            $script:deadline = [DateTime]::MaxValue
            $button.Enabled = $true
            if (-not $script:accepted) {
                $status.Text = '设备未确认配置，请确认已烧录 M1 后重试。'
                $script:port.Close()
                return
            }
            if (-not $script:savedAddress) {
                $status.Text = '尚未获取 IP，请检查 Wi-Fi 名称、密码及 2.4GHz 网络。'
            }
        }
        if ([DateTime]::UtcNow -ge $script:nextStatus) {
            $script:port.WriteLine('{"action":"status"}')
            $script:nextStatus = [DateTime]::UtcNow.AddSeconds(3)
        }
        $script:buffer += $script:port.ReadExisting()
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
                    $status.Text = '设备拒绝配置，请检查名称和密码后重试。'
                    $button.Enabled = $true
                }
            }
            if ($script:accepted -and $reply.state -eq 'connected' -and $reply.ip) {
                Save-Device ([string]$reply.ip)
                $button.Enabled = $true
            }
        }
    } catch {
        $script:pending = $null
        $status.Text = '设备连接中断，请检查 USB 后重试。'
        $button.Enabled = $true
        if ($script:port -and $script:port.IsOpen) { $script:port.Close() }
    }
})
$form.Add_FormClosed({
    $timer.Stop()
    $script:pending = $null
    if ($script:port) { $script:port.Dispose() }
})
if ($Check) {
    $form.Dispose()
    Write-Output 'PASS: device setup form created without opening any serial port.'
    exit 0
}
$timer.Start()
[void]$form.ShowDialog()
