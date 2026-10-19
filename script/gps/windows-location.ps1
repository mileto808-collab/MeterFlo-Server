param([string]$Port = "", [int]$Baud = 9600)
$ErrorActionPreference = "Stop"
if ($Port) {
  if ($Port -notmatch '^COM[1-9]\d{0,2}$' -or $Baud -lt 4800 -or $Baud -gt 921600) { exit 2 }
  $serial = New-Object System.IO.Ports.SerialPort $Port,$Baud,None,8,One
  $serial.ReadTimeout = 7000
  try {
    $serial.Open()
    while ($true) { [Console]::WriteLine($serial.ReadLine()) }
  } finally { $serial.Close() }
} else {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime]
  $locator = New-Object Windows.Devices.Geolocation.Geolocator
  $locator.DesiredAccuracy = [Windows.Devices.Geolocation.PositionAccuracy]::High
  $operation = $locator.GetGeopositionAsync([TimeSpan]::Zero,[TimeSpan]::FromSeconds(6))
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $task = $method.MakeGenericMethod([Windows.Devices.Geolocation.Geoposition]).Invoke($null,@($operation))
  if (-not $task.Wait(7000)) { exit 3 }
  $point = $task.Result.Coordinate
  @{
    coordinates = "$($point.Point.Position.Latitude.ToString('R',[Globalization.CultureInfo]::InvariantCulture)), $($point.Point.Position.Longitude.ToString('R',[Globalization.CultureInfo]::InvariantCulture))"
    source = "native"; receiver = "unknown"; accuracy = $point.Accuracy
    capturedAt = $point.Timestamp.UtcDateTime.ToString("o")
  } | ConvertTo-Json -Compress
}
