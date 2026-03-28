param(
    [string]$Title   = 'Bakery',
    [string]$Message = ''
)
try {
    [Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime] | Out-Null
    $t     = [Windows.UI.Notifications.ToastTemplateType]::ToastText02
    $xml   = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($t)
    $nodes = $xml.GetElementsByTagName('text')
    $nodes.Item(0).AppendChild($xml.CreateTextNode($Title))   | Out-Null
    $nodes.Item(1).AppendChild($xml.CreateTextNode($Message)) | Out-Null
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Bakery').Show($toast)
} catch {
    # Silently ignore — notifications are best-effort
}
