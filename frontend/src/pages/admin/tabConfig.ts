/**
 * Конфіг вкладок Довідників — структура використовується у AdminPage
 * (для рендеру sidebar) і у RolePermissionsTab (для матриці прав).
 *
 * Винесено у окремий файл щоб уникнути circular import
 * AdminPage ↔ RolePermissionsTab.
 */

export type Tab =
  | 'products' | 'categories' | 'units'
  | 'clients'  | 'routes' | 'client_groups'
  | 'prices'   | 'ingredients' | 'margin'
  | 'settings_bakery' | 'settings_bot' | 'settings_bot_tpl' | 'settings_issues'
  | 'users' | 'permissions'
  | 'system_clients'
  | 'finance_articles'
  | 'backup'

export interface TabGroup {
  label: string
  permKey: string
  tabs: { key: Tab; label: string }[]
}

export const ADMIN_TAB_GROUPS: TabGroup[] = [
  {
    label: 'Виробництво',
    permKey: 'admin_goods',
    tabs: [
      { key: 'products',   label: 'Вироби' },
      { key: 'categories', label: 'Категорії' },
      { key: 'units',      label: 'Одиниці виміру' },
    ],
  },
  {
    label: 'Клієнти',
    permKey: 'admin_clients',
    tabs: [
      { key: 'clients',       label: 'Клієнти' },
      { key: 'routes',        label: 'Маршрути' },
      { key: 'client_groups', label: 'Групи клієнтів' },
    ],
  },
  {
    label: 'Ціни та собівартість',
    permKey: 'admin_prices',
    tabs: [
      { key: 'prices',      label: 'Ціни' },
      { key: 'ingredients', label: 'Інгредієнти' },
      { key: 'margin',      label: 'Маржа' },
    ],
  },
  {
    label: 'Організація',
    permKey: 'admin_org',
    tabs: [
      { key: 'settings_bakery',  label: 'Параметри пекарні' },
      { key: 'system_clients',    label: 'Системні клієнти' },
      { key: 'finance_articles',  label: 'Фінансові статті' },
      { key: 'settings_bot',      label: 'Telegram Бот' },
      { key: 'settings_bot_tpl', label: 'Шаблони повідомлень' },
      { key: 'settings_issues',  label: 'Система звернень' },
    ],
  },
  {
    label: 'Система',
    permKey: 'admin_system',
    tabs: [
      { key: 'users',       label: 'Користувачі' },
      { key: 'permissions', label: 'Права ролей' },
      { key: 'backup',      label: 'Бекапи та імпорт' },
    ],
  },
]
