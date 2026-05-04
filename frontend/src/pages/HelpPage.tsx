import { useState } from 'react'

const SECTIONS = [
  { id: 'start',    label: '🚀 Початок роботи' },
  { id: 'orders',   label: '📋 Замовлення' },
  { id: 'baking',   label: '🔥 Випічка' },
  { id: 'routes',   label: '🚚 Маршрути' },
  { id: 'shop',     label: '🏪 Магазин' },
  { id: 'finances', label: '💰 Фінанси' },
  { id: 'admin',    label: '⚙️ Налаштування' },
  { id: 'tips',     label: '💡 Корисні поради' },
]

const h2: React.CSSProperties = { fontSize: '1rem', fontWeight: 700, color: '#1a3a5c', margin: '1rem 0 0.4rem', borderBottom: '1px solid #e0eaf4', paddingBottom: '0.2rem' }
const h3: React.CSSProperties = { fontSize: '0.88rem', fontWeight: 700, color: '#2a5a8c', margin: '0.8rem 0 0.25rem' }
const p: React.CSSProperties  = { margin: '0.25rem 0', lineHeight: 1.55, fontSize: '0.87rem' }
const li: React.CSSProperties = { margin: '0.2rem 0', lineHeight: 1.5, fontSize: '0.87rem' }
const kbd: React.CSSProperties = { background: '#f0f4f8', border: '1px solid #c0d0e0', borderRadius: 3, padding: '0 5px', fontSize: '0.78rem', fontFamily: 'monospace' }
const tip: React.CSSProperties = { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 5, padding: '0.4rem 0.7rem', margin: '0.5rem 0', fontSize: '0.84rem' }
const warn: React.CSSProperties = { background: '#fffbe6', border: '1px solid #fcd34d', borderRadius: 5, padding: '0.4rem 0.7rem', margin: '0.5rem 0', fontSize: '0.84rem' }
const badge = (color: string, bg: string, text: string) => (
  <span style={{ background: bg, color, borderRadius: 10, padding: '0.05rem 0.45rem', fontSize: '0.75rem', fontWeight: 700, marginRight: 4 }}>{text}</span>
)

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  const sec = SECTIONS.find(s => s.id === id)!
  return (
    <div id={id} style={{ marginBottom: '0.5rem', border: '1px solid #e0eaf4', borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', textAlign: 'left', padding: '0.65rem 1rem', background: open ? '#1a3a5c' : '#f0f4f8', color: open ? '#fff' : '#1a3a5c', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span>{sec.label}</span>
        <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0.75rem 1.25rem 1rem' }}>{children}</div>}
    </div>
  )
}

export default function HelpPage() {
  const [search, setSearch] = useState('')

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '1rem 1.5rem', fontFamily: 'system-ui, sans-serif', color: '#2c3e50' }}>
      <h1 style={{ fontSize: '1.35rem', color: '#1a3a5c', marginBottom: '0.25rem' }}>📖 Довідник користувача — Пекарня</h1>
      <p style={{ ...p, color: '#666', marginBottom: '1rem' }}>Покрокові інструкції для роботи з системою управління пекарнею.</p>

      <input
        placeholder="🔍 Пошук по довіднику..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', padding: '0.45rem 0.75rem', border: '1px solid #c0d0e0', borderRadius: 6, fontSize: '0.9rem', marginBottom: '1rem', boxSizing: 'border-box' }}
      />

      {/* Навігація */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1.25rem' }}>
        {SECTIONS.map(s => (
          <a key={s.id} href={`#${s.id}`} style={{ textDecoration: 'none', padding: '0.25rem 0.7rem', background: '#e8f0f8', borderRadius: 12, fontSize: '0.8rem', color: '#1a3a5c', fontWeight: 600 }}>
            {s.label}
          </a>
        ))}
      </div>

      {/* ─── ПОЧАТОК РОБОТИ ─────────────────────────────────────── */}
      <Section id="start">
        <h2 style={h2}>Загальні принципи</h2>
        <p style={p}>Програма будує повний цикл пекарні: замовлення → випічка → доставка → оплата. Кожна вкладка відповідає за свій етап.</p>
        <ul>
          <li style={li}><strong>Дата роботи</strong> — відображається у правому верхньому куті. Якщо потрібно внести дані «заднім числом» — змініть дату перед роботою.</li>
          <li style={li}>Після <strong>18:00</strong> система автоматично перемикається на завтрашню дату (для введення замовлень наступного дня).</li>
          <li style={li}><strong>Роль користувача</strong> визначає доступні вкладки. Адміністратор має повний доступ.</li>
        </ul>

        <h2 style={h2}>Типовий робочий день</h2>
        <ol>
          <li style={li}><strong>Ввечері:</strong> Оператор приймає замовлення від клієнтів → вкладка <em>Замовлення</em></li>
          <li style={li}><strong>Вранці:</strong> Пекар дивиться завдання → вкладка <em>Випічка</em> → вносить фактично спечену кількість</li>
          <li style={li}><strong>Вдень:</strong> Оператор формує накладні → вкладка <em>Маршрути</em> → відправляє з водієм</li>
          <li style={li}><strong>Після повернення водія:</strong> Оператор приймає накладні з оплатою або вносить корекції → <em>Маршрути</em></li>
          <li style={li}><strong>Вечір:</strong> Продавець робить звірку залишків → <em>Магазин</em></li>
        </ol>
      </Section>

      {/* ─── ЗАМОВЛЕННЯ ─────────────────────────────────────────── */}
      <Section id="orders">
        <h2 style={h2}>Як приймати замовлення</h2>
        <ol>
          <li style={li}>Виберіть маршрут у лівій панелі (або «Всі клієнти»)</li>
          <li style={li}>Натисніть на рядок клієнта — відкриється список виробів</li>
          <li style={li}>Введіть кількість у полі поруч з виробом → натисніть <kbd style={kbd}>Enter</kbd> для переходу до наступного рядка</li>
          <li style={li}>Дані зберігаються автоматично (без кнопки «Зберегти»)</li>
        </ol>
        <div style={tip}>💡 У лівій панелі в колонках <strong>«Хл»</strong> і <strong>«Бул»</strong> відображається загальна кількість замовленого хліба і булок для кожного клієнта.</div>

        <h3 style={h3}>Копіювання замовлень</h3>
        <p style={p}>Якщо клієнт замовляє те саме що й учора — вгорі в панелі клієнта є кнопка <strong>«↩ Повторити»</strong>. Оберіть дату звідки копіювати → виберіть потрібні вироби → натисніть «Додати».</p>

        <h3 style={h3}>Обмін (↩)</h3>
        <p style={p}>Обмін — коли клієнт повертає черствий хліб і отримує свіжий безкоштовно.</p>
        <ol>
          <li style={li}>Натисніть кнопку <strong>↩</strong> поруч з виробом</li>
          <li style={li}>У зеленому полі введіть кількість одиниць на обмін</li>
          <li style={li}>Натисніть <kbd style={kbd}>Enter</kbd> — рядок обміну збережеться і показуватиметься окремо під основним рядком</li>
        </ol>
        <div style={tip}>💡 Обмін можна додати навіть якщо клієнт не робив нового замовлення — наприклад, вчора взяв 4 батони, сьогодні хоче обміняти 3 черствих без нового замовлення.</div>

        <h3 style={h3}>Знижка / своя ціна (%)</h3>
        <p style={p}>Натисніть <strong>%</strong> поруч з виробом → введіть кількість і ціну (або залиште порожнє для стандартної знижки клієнта) → <strong>«Додати»</strong>.</p>

        <h3 style={h3}>Блокування замовлень</h3>
        <div style={warn}>⚠️ Якщо рядок клієнта позначений замком 🔒 — накладна вже сформована. Змінити замовлення цього клієнта неможливо.</div>
      </Section>

      {/* ─── ВИПІЧКА ────────────────────────────────────────────── */}
      <Section id="baking">
        <h2 style={h2}>Формування завдання</h2>
        <p style={p}>Натисніть <strong>«Сформувати із замовлень»</strong> — система автоматично підрахує потрібну кількість виробів з урахуванням резерву.</p>
        <ul>
          <li style={li}><strong>Замовлено</strong> — сума всіх замовлень клієнтів (включно з обміном та знижковими рядками)</li>
          <li style={li}><strong>Рекомендовано</strong> — замовлено + резерв % (налаштовується в системі)</li>
          <li style={li}><strong>Спечено</strong> — вводить пекар по факту</li>
        </ul>

        <h3 style={h3}>Як вносити фактичну кількість</h3>
        <ol>
          <li style={li}>Натисніть у клітинку «Спечено» поруч з виробом</li>
          <li style={li}>Введіть кількість → <kbd style={kbd}>Enter</kbd> для переходу до наступного рядка</li>
          <li style={li}>Відхилення (±) з'явиться автоматично: <span style={{ color: '#16a34a' }}>+2 зелений</span> = надлишок, <span style={{ color: '#dc2626' }}>-1 червоний</span> = нестача</li>
        </ol>
        <div style={tip}>💡 Натисніть <strong>«Показати всі вироби»</strong> щоб побачити всі вироби, навіть без замовлень — якщо пекар випадково спік зайвий виріб.</div>

        <h3 style={h3}>Секція «Розбіжності» (права панель)</h3>
        <p style={p}>Тут показуються вироби де <em>спечено ≠ замовлено</em>:</p>
        <ul>
          <li style={li}><strong>Нестача</strong> — спечено менше ніж замовлено. Потрібно вирішити кому відмовити або зменшити кількість.</li>
          <li style={li}><strong>Надлишок</strong> — спечено більше ніж замовлено. Потрібно розподілити: до магазину, маршруту, або списати.</li>
        </ul>
        <p style={p}>Для розподілу надлишку: оберіть куди → введіть кількість → <strong>«+ Додати»</strong>.</p>

        <h3 style={h3}>Друк завдання пекарям</h3>
        <p style={p}>Кнопка <strong>«Друк завдання ▾»</strong> → оберіть відділ (Хліб / Булки) → відкриється PDF для друку.</p>
      </Section>

      {/* ─── МАРШРУТИ ───────────────────────────────────────────── */}
      <Section id="routes">
        <h2 style={h2}>Робота з накладними</h2>

        <h3 style={h3}>Статуси накладних</h3>
        <p style={p}>
          {badge('#856404', '#fff3cd', 'Чернетка')} Формується автоматично з замовлень. Ще не відправлена.
        </p>
        <p style={p}>
          {badge('#004085', '#cce5ff', 'Відправлено')} Накладна готова, поїхала з водієм. Можна друкувати.
        </p>
        <p style={p}>
          {badge('#155724', '#d4edda', 'Прийнято')} Оплата і товар підтверджені. Запис потрапляє у фінанси.
        </p>

        <h3 style={h3}>Як відправити накладні</h3>
        <ol>
          <li style={li}>Виберіть маршрут у лівій панелі</li>
          <li style={li}>Позначте потрібних клієнтів галочками (за замовч. всі чернетки вибрані)</li>
          <li style={li}>Натисніть <strong>«▶ Відправити (N)»</strong> → накладні відправляються, PDF відкривається для друку</li>
        </ol>

        <h3 style={h3}>Поле «Оплата» в лівій панелі</h3>
        <p style={p}>Після відправки поруч із сумою накладної з'являється поле оплати (зелений фон). За замовч. = сума накладної.</p>
        <ul>
          <li style={li}>Якщо клієнт <strong>оплатив повністю</strong> — залиште як є</li>
          <li style={li}>Якщо оплатив <strong>частково</strong> — введіть фактичну суму</li>
          <li style={li}>Якщо <strong>не оплатив</strong> — введіть 0</li>
        </ul>
        <div style={tip}>💡 Оплата автоматично записується у баланс клієнта при прийнятті накладної.</div>

        <h3 style={h3}>Прийняття накладних</h3>
        <p style={p}><strong>Масово:</strong> позначте галочками потрібних клієнтів → <strong>«✓ Прийняти (N)»</strong></p>
        <p style={p}><strong>По одній:</strong> натисніть на клієнта → у правій панелі кнопка <strong>«✓ Прийнято»</strong></p>

        <h3 style={h3}>Внесення корекцій</h3>
        <p style={p}>Якщо водій повернув товар або доставив іншу кількість:</p>
        <ol>
          <li style={li}>Натисніть <strong>«✏ Внести корекції»</strong> у правій панелі</li>
          <li style={li}>Змініть кількість у рядках виробів (введіть фактично доставлену кількість)</li>
          <li style={li}>Натисніть <strong>«Підтвердити»</strong> — система створить коригуючу накладну з різницею</li>
        </ol>
        <div style={warn}>⚠️ Після прийняття накладна стає <strong>незмінною</strong>. Усі коригування вносьте ДО натискання «Прийнято».</div>

        <h3 style={h3}>Коригуюча накладна</h3>
        <p style={p}>Відображається нижче основної у правій панелі. Кнопка <strong>🖨</strong> — друк коригуючої накладної.</p>
      </Section>

      {/* ─── МАГАЗИН ────────────────────────────────────────────── */}
      <Section id="shop">
        <h2 style={h2}>Звірка залишків</h2>
        <p style={p}>Звірка — щоденний підрахунок залишків товару в магазині. Відкривається автоматично при вході в розділ.</p>

        <h3 style={h3}>Як проводити звірку</h3>
        <ol>
          <li style={li}>Натисніть на картку магазину → відкривається модальне вікно звірки</li>
          <li style={li}>У колонці <strong>«Залишок»</strong> введіть фактичну кількість кожного виробу що залишилась</li>
          <li style={li}>Натисніть <kbd style={kbd}>Enter</kbd> для переходу до наступного рядка</li>
          <li style={li}><strong>«Продано»</strong> розраховується автоматично: відкрито + надійшло − залишок − списання</li>
          <li style={li}>Після введення всіх залишків натисніть <strong>«Підтвердити звірку»</strong></li>
        </ol>

        <h3 style={h3}>Колонки таблиці звірки</h3>
        <ul>
          <li style={li}><strong>Відкр.</strong> — залишок на початок (кінець попередньої звірки)</li>
          <li style={li}><strong>Надійшло</strong> — отримано від пекарні за цей день</li>
          <li style={li}><strong>Доступно</strong> = Відкр. + Надійшло</li>
          <li style={li}><strong>Списано</strong> — вручну списаний товар (пайок, брак тощо)</li>
          <li style={li}><strong>📱 POS</strong> — продано через касовий термінал</li>
          <li style={li}><strong>Продано</strong> — загальна кількість проданого (Списано + POS + введений залишок)</li>
          <li style={li}><strong>Залишок</strong> — вводиться вручну (фактичний підрахунок)</li>
        </ul>
        <div style={warn}>⚠️ Якщо введений залишок <span style={{ color: '#dc2626', fontWeight: 700 }}>підсвічений червоним ⚠</span> — він перевищує доступну кількість. Перевірте введене значення.</div>

        <h3 style={h3}>Додаткові операції (Списання / Пайок / Передача)</h3>
        <p style={p}>У рядку виробу натисніть <strong>⊕</strong> → оберіть тип операції:</p>
        <ul>
          <li style={li}><strong>Списання</strong> — брак, псування</li>
          <li style={li}><strong>Пайок</strong> — видано персоналу</li>
          <li style={li}><strong>До клієнта</strong> — передано конкретному клієнту</li>
          <li style={li}><strong>Продано поза POS</strong> — продано готівкою поза касовим терміналом (вкажіть ціну)</li>
        </ul>

        <h3 style={h3}>POS — касовий термінал</h3>
        <p style={p}>Продавець використовує окремий інтерфейс «Каса» (встановлюється як окремий додаток на планшеті):</p>
        <ol>
          <li style={li}>Оберіть магазин</li>
          <li style={li}>Натисніть на виріб → він додається в чек</li>
          <li style={li}>Відрегулюйте кількість та натисніть <strong>«Сплатити»</strong></li>
        </ol>
      </Section>

      {/* ─── ФІНАНСИ ────────────────────────────────────────────── */}
      <Section id="finances">
        <h2 style={h2}>Баланс клієнтів</h2>
        <p style={p}>Баланс показує скільки клієнт винен пекарні:</p>
        <ul>
          <li style={li}><span style={{ color: '#dc2626', fontWeight: 700 }}>Червоний</span> — клієнт <strong>винен</strong> (борг)</li>
          <li style={li}><span style={{ color: '#16a34a', fontWeight: 700 }}>Зелений</span> — клієнт <strong>переплатив</strong> (кредит)</li>
          <li style={li}><strong>0</strong> — розрахований повністю</li>
        </ul>

        <h3 style={h3}>Як внести оплату від клієнта</h3>
        <p style={p}><strong>Спосіб 1 (з маршруту):</strong> При прийнятті накладної заповніть поле «Оплата» у лівій панелі — сума автоматично потрапить у фінанси.</p>
        <p style={p}><strong>Спосіб 2 (вручну):</strong></p>
        <ol>
          <li style={li}>Вкладка «Фінанси» → підвкладка «Баланси»</li>
          <li style={li}>Натисніть на рядок клієнта → розгорнеться журнал операцій</li>
          <li style={li}>Натисніть <strong>«+ Оплата»</strong> → введіть суму → <strong>«Зберегти»</strong></li>
        </ol>

        <h3 style={h3}>Касові операції</h3>
        <p style={p}>Для операцій що не пов'язані з конкретним клієнтом (внесення в касу, виведення, тощо):</p>
        <ol>
          <li style={li}>Підвкладка «Журнал» → <strong>«+ Операція»</strong></li>
          <li style={li}>Оберіть статтю (наприклад, «Внесення в касу» або «Виведення з каси»)</li>
          <li style={li}>Введіть суму → <strong>«Зберегти»</strong></li>
        </ol>
        <div style={tip}>💡 Для касових операцій клієнт НЕ потрібен — статті без клієнта позначені <em>«– витрата»</em> або <em>«+ надходження»</em>.</div>

        <h3 style={h3}>Дашборд (Аналітика)</h3>
        <p style={p}>Перша підвкладка — загальна картина: загальний борг, переплати, надходження за тиждень/місяць, топ-боржники, статистика випічки та замовлень.</p>
      </Section>

      {/* ─── НАЛАШТУВАННЯ ───────────────────────────────────────── */}
      <Section id="admin">
        <h2 style={h2}>Довідники</h2>
        <ul>
          <li style={li}><strong>Клієнти</strong> — додавання/редагування клієнтів, їх маршрут, знижка, телефон для Telegram-бота</li>
          <li style={li}><strong>Вироби</strong> — перелік виробів, категорії, вага, собівартість</li>
          <li style={li}><strong>Ціни</strong> — базові ціни з датами дії, індивідуальні ціни клієнтів</li>
          <li style={li}><strong>Маршрути</strong> — групування клієнтів за маршрутами доставки</li>
        </ul>

        <h3 style={h3}>Резервне копіювання та відновлення</h3>
        <p style={p}>Вкладка «Налаштування» → «Бекап та відновлення» → <strong>«Зробити резервну копію»</strong>.</p>
        <div style={warn}>⚠️ Відновлення бази ЗАМІНЮЄ всі поточні дані. Перед відновленням переконайтесь що вибраний правильний файл бекапу.</div>

        <h3 style={h3}>Облікові записи</h3>
        <p style={p}>Ролі користувачів: <strong>Оператор</strong> (замовлення, випічка, маршрути, магазин), <strong>Бухгалтер</strong> (фінанси), <strong>Адміністратор</strong> (повний доступ), <strong>Власник</strong> (перегляд дашборду).</p>
      </Section>

      {/* ─── ПОРАДИ ─────────────────────────────────────────────── */}
      <Section id="tips">
        <h2 style={h2}>Клавіатурні скорочення</h2>
        <ul>
          <li style={li}><kbd style={kbd}>Enter</kbd> — перехід до наступного поля вводу (в замовленнях, випічці)</li>
          <li style={li}><kbd style={kbd}>Tab</kbd> — аналогічно Enter у більшості полів</li>
          <li style={li}><kbd style={kbd}>Esc</kbd> — закрити модальне вікно або скасувати введення</li>
        </ul>

        <h2 style={h2}>Часті запитання</h2>

        <h3 style={h3}>Не можу змінити замовлення клієнта — поле заблоковане</h3>
        <p style={p}>Означає що накладна вже сформована (🔒). Для виправлення зверніться до адміністратора або скасуйте накладну у вкладці Маршрути.</p>

        <h3 style={h3}>Чому сума накладної не збігається з тим що очікувалось?</h3>
        <p style={p}>Перевірте індивідуальні ціни клієнта (Налаштування → Клієнти → Ціни) та знижкові рядки (позначені %) у замовленні.</p>

        <h3 style={h3}>Як переглянути старі дані?</h3>
        <p style={p}>Змініть «Дату роботи» у правому верхньому куті — всі вкладки покажуть дані за вибрану дату.</p>

        <h3 style={h3}>Показники на дашборді Фінансів показують 0</h3>
        <p style={p}>Переконайтесь що бекап БД є актуальним і всі записи мають правильно вказану статтю фінансової операції.</p>

        <h3 style={h3}>Telegram-бот не приймає замовлення</h3>
        <p style={p}>Перевірте статус бота у вкладці Замовлення (кнопка зеленого/червоного кольору у правому верхньому куті таблиці). Якщо «Прийом зупинено» — натисніть кнопку відновлення.</p>

        <div style={{ ...tip, marginTop: '1.5rem' }}>
          💬 Якщо щось не працює або потрібна допомога — натисніть кнопку <strong>💬</strong> у правому нижньому куті для відправки повідомлення розробнику.
        </div>
      </Section>

      <div style={{ textAlign: 'center', color: '#999', fontSize: '0.78rem', marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid #e0eaf4' }}>
        Пекарня — система управління · Версія {import.meta.env.VITE_APP_VERSION ?? '—'}
      </div>
    </div>
  )
}
