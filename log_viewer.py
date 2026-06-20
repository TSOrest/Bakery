"""
Bakery — переглядач логів (окреме нативне вікно, tkinter).

Запускається з трею ("Переглянути логи"). Читає текстові лог-файли напряму з диска,
БЕЗ участі веб-сервера чи бази даних — тож працює навіть коли застосунок або БД лежать
(саме для діагностики падінь).

Логи зберігаються по одному файлу на добу: bakery-YYYY-MM-DD.log, кожен рядок з префіксом
[YYYY-MM-DD HH:MM:SS]. Підтримується і старий єдиний bakery.log, а також системні файли
(аварії трею, логи npm-збірки при оновленні).

Запуск:  pythonw log_viewer.py [шлях_до_папки_логів]
"""
import os
import re
import sys
import collections
from pathlib import Path

import tkinter as tk
from tkinter import ttk, font as tkfont

# Максимум рядків, що читаються з одного файла (захист від гігантських логів).
MAX_LINES_PER_FILE = 20000

LEVELS = ["ERROR", "WARNING", "INFO", "DEBUG", "CRITICAL"]
LEVEL_COLORS = {
    "ERROR":    ("#fdecec", "#b00020"),
    "CRITICAL": ("#fbe0e0", "#7a0012"),
    "WARNING":  ("#fff6e0", "#8a5a00"),
    "INFO":     ("#ffffff", "#202020"),
    "DEBUG":    ("#f3f3f3", "#777777"),
}
TYPES = ["Всі", "Сервер", "Застосунок", "HTTP", "Сповіщення", "Інтернет"]

# Префікс рядка: [YYYY-MM-DD HH:MM:SS] або (старий формат) [HH:MM:SS]
LINE_RE = re.compile(
    r"^\[(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2})\]\s+(?P<body>.*)$"
)
LEVEL_RE = re.compile(r"\b(CRITICAL|ERROR|WARNING|WARN|INFO|DEBUG)\b")
HTTP_RE = re.compile(r'"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) .+HTTP/|uvicorn\.access')


# ── Визначення папки логів ────────────────────────────────────────────────────

def resolve_logs_dir() -> Path:
    if len(sys.argv) > 1 and sys.argv[1].strip():
        return Path(sys.argv[1])
    env = os.getenv("BAKERY_DATA_DIR")
    if env:
        return Path(env) / "logs"
    pd = os.getenv("ProgramData")
    if pd and (Path(pd) / "Bakery" / "bakery.db").exists():
        return Path(pd) / "Bakery" / "logs"
    return Path(__file__).resolve().parent / "logs"


# ── Парсинг ──────────────────────────────────────────────────────────────────

class Entry:
    __slots__ = ("date", "time", "level", "type", "message", "lines")

    def __init__(self, date, time_, level, type_, message):
        self.date = date
        self.time = time_
        self.level = level
        self.type = type_
        self.message = message      # перший рядок
        self.lines = [message]      # усі рядки запису (для traceback)

    @property
    def full(self) -> str:
        return "\n".join(self.lines)


def _classify(body: str):
    """Повертає (level, type) за вмістом рядка."""
    if body.startswith("[NOTIFY]"):
        return "INFO", "Сповіщення"
    if body.startswith("[INTERNET]"):
        return ("WARNING" if "DOWN" in body else "INFO"), "Інтернет"
    head = body[:60]
    lvl_m = LEVEL_RE.search(head)
    level = lvl_m.group(1) if lvl_m else None
    if level == "WARN":
        level = "WARNING"
    if level is None:
        if "Traceback (most recent call last)" in body or "Exception" in head or "Error" in head:
            level = "ERROR"
        else:
            level = "INFO"
    if HTTP_RE.search(body):
        type_ = "HTTP"
    elif "backend." in head:
        type_ = "Застосунок"
    else:
        type_ = "Сервер"
    return level, type_


def _read_lines(path: Path):
    """Читає рядки з файла, стійко до кодування — ПОРЯДКОВО: кожен рядок UTF-8, а якщо
    невалідний — cp1251. Так коректно читаються і чисті UTF-8 файли, і старі ANSI-логи,
    і ЗМІШАНІ файли (стара частина cp1251 + нова UTF-8 в одному денному файлі під час переходу)."""
    try:
        raw = path.read_bytes()
    except OSError:
        return []
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    out: list[str] = []
    for bline in raw.split(b"\n"):
        bline = bline.rstrip(b"\r")
        try:
            out.append(bline.decode("utf-8"))
        except UnicodeDecodeError:
            out.append(bline.decode("cp1251", errors="replace"))
    return collections.deque(out, maxlen=MAX_LINES_PER_FILE)


def parse_file(path: Path, fallback_date: str):
    """Парсить файл у список Entry. Рядки без префікса = продовження попереднього."""
    entries = []
    lines = _read_lines(path)
    cur = None
    for raw in lines:
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        m = LINE_RE.match(line)
        if m:
            ts = m.group("ts")
            body = m.group("body")
            if len(ts) > 8:           # 'YYYY-MM-DD HH:MM:SS'
                date, time_ = ts.split(" ", 1)
            else:                      # старий 'HH:MM:SS'
                date, time_ = fallback_date, ts
            level, type_ = _classify(body)
            cur = Entry(date, time_, level, type_, body)
            entries.append(cur)
        elif cur is not None:
            cur.lines.append(line)
            if "Traceback (most recent call last)" in line or line.lstrip().startswith("File \""):
                cur.level = "ERROR"
        else:
            # Файл без нашого префікса (напр. npm-лог) — кожен рядок окремий запис.
            level, type_ = _classify(line)
            entries.append(Entry(fallback_date, "", level, type_, line))
    return entries


def _file_date(path: Path) -> str:
    m = re.search(r"bakery-(\d{4}-\d{2}-\d{2})\.log$", path.name)
    if m:
        return m.group(1)
    try:
        import time
        return time.strftime("%Y-%m-%d", time.localtime(path.stat().st_mtime))
    except OSError:
        return "?"


def scan(logs_dir: Path):
    """Повертає структуру вузлів дерева: [(group_label, [(node_label, [paths])...])]."""
    server_nodes = []  # (label, [path])
    if logs_dir.is_dir():
        dated = sorted(logs_dir.glob("bakery-*.log"),
                       key=lambda p: p.name, reverse=True)
        for p in dated:
            server_nodes.append((_file_date(p), [p]))
        legacy = logs_dir / "bakery.log"
        if legacy.exists():
            server_nodes.append(("bakery.log (старий)", [legacy]))

    system_nodes = []
    sys_map = [
        ("Аварії трею", "tray_crash.log"),
        ("npm: install", "update-npm-install.log"),
        ("npm: install (помилки)", "update-npm-install.log.err"),
        ("npm: build", "update-npm-build.log"),
        ("npm: build (помилки)", "update-npm-build.log.err"),
    ]
    if logs_dir.is_dir():
        for label, fname in sys_map:
            p = logs_dir / fname
            if p.exists():
                system_nodes.append((label, [p]))

    groups = []
    if server_nodes:
        groups.append(("Сервер (по датах)", server_nodes))
    if system_nodes:
        groups.append(("Системні", system_nodes))
    return groups


# ── UI ────────────────────────────────────────────────────────────────────────

class LogViewer:
    def __init__(self, root: tk.Tk, logs_dir: Path):
        self.root = root
        self.logs_dir = logs_dir
        self.current_entries = []     # завантажені (до фільтра)
        self.shown = []               # видимі (після фільтра), синхронні з рядками таблиці

        root.title(f"Bakery — Логи  ({logs_dir})")
        root.geometry("1100x680")
        try:
            root.iconbitmap(default="")  # ігноруємо, якщо немає
        except Exception:
            pass

        self._build_toolbar()
        self._build_panes()
        self.reload()

    def _build_toolbar(self):
        bar = ttk.Frame(self.root, padding=(8, 6))
        bar.pack(side="top", fill="x")

        ttk.Button(bar, text="↻ Оновити", command=self.reload).pack(side="left")
        ttk.Separator(bar, orient="vertical").pack(side="left", fill="y", padx=8)

        ttk.Label(bar, text="Рівень:").pack(side="left")
        self.level_vars = {}
        for lvl in LEVELS:
            v = tk.BooleanVar(value=True)
            self.level_vars[lvl] = v
            ttk.Checkbutton(bar, text=lvl.title(), variable=v,
                            command=self.apply_filter).pack(side="left", padx=2)

        ttk.Separator(bar, orient="vertical").pack(side="left", fill="y", padx=8)
        ttk.Label(bar, text="Тип:").pack(side="left")
        self.type_var = tk.StringVar(value="Всі")
        cb = ttk.Combobox(bar, textvariable=self.type_var, values=TYPES,
                          width=12, state="readonly")
        cb.pack(side="left", padx=(2, 8))
        cb.bind("<<ComboboxSelected>>", lambda e: self.apply_filter())

        ttk.Label(bar, text="Пошук:").pack(side="left")
        self.search_var = tk.StringVar()
        ent = ttk.Entry(bar, textvariable=self.search_var, width=28)
        ent.pack(side="left", padx=2)
        ent.bind("<KeyRelease>", lambda e: self.apply_filter())

        self.status = ttk.Label(bar, text="")
        self.status.pack(side="right")

    def _build_panes(self):
        paned = ttk.Panedwindow(self.root, orient="horizontal")
        paned.pack(fill="both", expand=True)

        # Ліворуч — дерево дат/файлів
        left = ttk.Frame(paned)
        self.tree = ttk.Treeview(left, show="tree", selectmode="browse")
        ysb = ttk.Scrollbar(left, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=ysb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        ysb.pack(side="right", fill="y")
        self.tree.bind("<<TreeviewSelect>>", self._on_tree_select)
        paned.add(left, weight=1)

        # Праворуч — таблиця записів
        right = ttk.Frame(paned)
        cols = ("time", "level", "type", "message")
        self.table = ttk.Treeview(right, columns=cols, show="headings")
        self.table.heading("time", text="Час")
        self.table.heading("level", text="Рівень")
        self.table.heading("type", text="Тип")
        self.table.heading("message", text="Повідомлення")
        self.table.column("time", width=150, anchor="w", stretch=False)
        self.table.column("level", width=80, anchor="w", stretch=False)
        self.table.column("type", width=100, anchor="w", stretch=False)
        self.table.column("message", width=620, anchor="w")
        tysb = ttk.Scrollbar(right, orient="vertical", command=self.table.yview)
        txsb = ttk.Scrollbar(right, orient="horizontal", command=self.table.xview)
        self.table.configure(yscrollcommand=tysb.set, xscrollcommand=txsb.set)
        self.table.grid(row=0, column=0, sticky="nsew")
        tysb.grid(row=0, column=1, sticky="ns")
        txsb.grid(row=1, column=0, sticky="ew")
        right.rowconfigure(0, weight=1)
        right.columnconfigure(0, weight=1)
        self.table.bind("<Double-1>", self._show_detail)
        paned.add(right, weight=4)

        mono = tkfont.nametofont("TkFixedFont")
        self.table.tag_configure("_mono", font=mono)
        for lvl, (bg, fg) in LEVEL_COLORS.items():
            self.table.tag_configure(lvl, background=bg, foreground=fg)

    # ── дані ──
    def reload(self):
        prev = self._selected_paths()
        self.groups = scan(self.logs_dir)
        self.tree.delete(*self.tree.get_children())
        self._node_paths = {}     # iid -> [Path]
        first_leaf = None
        for gi, (glabel, nodes) in enumerate(self.groups):
            gid = self.tree.insert("", "end", text=glabel, open=(gi == 0))
            self._node_paths[gid] = [p for _, paths in nodes for p in paths]
            for nlabel, paths in nodes:
                nid = self.tree.insert(gid, "end", text=nlabel)
                self._node_paths[nid] = paths
                if first_leaf is None:
                    first_leaf = nid
        if not self.groups:
            self.status.config(text=f"Логів не знайдено у {self.logs_dir}")
            self._load_entries([])
            return
        # відновити попередній вибір або взяти найсвіжіший
        target = None
        for iid, paths in self._node_paths.items():
            if paths == prev:
                target = iid
                break
        target = target or first_leaf
        if target:
            self.tree.selection_set(target)
            self.tree.see(target)
            self._on_tree_select(None)

    def _selected_paths(self):
        sel = self.tree.selection() if hasattr(self, "tree") else None
        if sel and sel[0] in getattr(self, "_node_paths", {}):
            return self._node_paths[sel[0]]
        return None

    def _on_tree_select(self, _evt):
        paths = self._selected_paths()
        if not paths:
            return
        entries = []
        for p in paths:
            entries.extend(parse_file(p, _file_date(p)))
        self._load_entries(entries)

    def _load_entries(self, entries):
        self.current_entries = entries
        self.apply_filter()

    # ── фільтр ──
    def apply_filter(self):
        allowed = {l for l, v in self.level_vars.items() if v.get()}
        type_sel = self.type_var.get()
        q = self.search_var.get().strip().lower()
        self.table.delete(*self.table.get_children())
        self.shown = []
        for e in self.current_entries:
            if e.level not in allowed:
                continue
            if type_sel != "Всі" and e.type != type_sel:
                continue
            if q and q not in e.full.lower():
                continue
            first = e.message
            if len(e.lines) > 1:
                first = first + f"  ⏎(+{len(e.lines) - 1})"
            self.table.insert("", "end",
                              values=(f"{e.date} {e.time}".strip(), e.level, e.type, first),
                              tags=(e.level, "_mono"))
            self.shown.append(e)
        self.status.config(text=f"Показано: {len(self.shown)} / {len(self.current_entries)}")

    def _show_detail(self, _evt):
        sel = self.table.selection()
        if not sel:
            return
        idx = self.table.index(sel[0])
        if idx >= len(self.shown):
            return
        e = self.shown[idx]
        win = tk.Toplevel(self.root)
        win.title(f"{e.date} {e.time}  ·  {e.level}  ·  {e.type}")
        win.geometry("820x460")
        txt = tk.Text(win, wrap="none", font=tkfont.nametofont("TkFixedFont"))
        ysb = ttk.Scrollbar(win, orient="vertical", command=txt.yview)
        xsb = ttk.Scrollbar(win, orient="horizontal", command=txt.xview)
        txt.configure(yscrollcommand=ysb.set, xscrollcommand=xsb.set)
        txt.grid(row=0, column=0, sticky="nsew")
        ysb.grid(row=0, column=1, sticky="ns")
        xsb.grid(row=1, column=0, sticky="ew")
        win.rowconfigure(0, weight=1)
        win.columnconfigure(0, weight=1)
        txt.insert("1.0", e.full)
        txt.config(state="disabled")
        win.bind("<Escape>", lambda ev: win.destroy())


def main():
    logs_dir = resolve_logs_dir()
    root = tk.Tk()
    try:
        ttk.Style().theme_use("vista")
    except tk.TclError:
        pass
    LogViewer(root, logs_dir)
    root.mainloop()


if __name__ == "__main__":
    main()
