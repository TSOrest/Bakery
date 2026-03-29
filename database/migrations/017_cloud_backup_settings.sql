-- Налаштування хмарних провайдерів для резервного копіювання
INSERT OR IGNORE INTO settings (key, value, description) VALUES
  ('cloud_gdrive_client_id',    '', 'Google Drive OAuth Client ID'),
  ('cloud_gdrive_client_secret','', 'Google Drive OAuth Client Secret'),
  ('cloud_gdrive_token',        '', 'Google Drive токен (зберігається автоматично)'),
  ('cloud_onedrive_client_id',  '', 'OneDrive (Azure) Application Client ID'),
  ('cloud_onedrive_token',      '', 'OneDrive токен (зберігається автоматично)'),
  ('cloud_dropbox_app_key',     '', 'Dropbox App Key'),
  ('cloud_dropbox_app_secret',  '', 'Dropbox App Secret'),
  ('cloud_dropbox_token',       '', 'Dropbox токен (зберігається автоматично)'),
  ('cloud_folder_name',  'bakery-backups', 'Назва папки в хмарі для бекапів');
