import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../shared/lib/api";
import CustomSelect from "../../shared/ui/CustomSelect";
import TagInput from "../../shared/ui/TagInput";
import useAuth from "../../hooks/useAuth";

const LANGUAGES = [
  { value: "javascript", label: "JavaScript", icon: "JS", description: "Web, Canvas и консольные приложения" },
  { value: "python", label: "Python", icon: "Py", description: "Скрипты, алгоритмы и консольные игры" },
  { value: "java", label: "Java", icon: "Jv", description: "Консольные приложения на JVM" },
];

const APP_TYPES = [
  { value: "console", label: "Консоль", icon: ">_", description: "Ввод, вывод и алгоритмы" },
  { value: "web", label: "Web-приложение", icon: "▣", description: "HTML, CSS и JavaScript" },
  { value: "game", label: "Игра", icon: "◇", description: "Canvas или игровая логика" },
];

const TEMPLATES = {
  javascript: {
    web: {
      title: "Моё web-приложение", description: "Интерактивное приложение, созданное в НЕМАКС Code Studio", entryFile: "main.js",
      files: [
        { path: "index.html", content: `<main class="app">
  <span class="badge">НЕМАКС Code Studio</span>
  <h1>Моё приложение</h1>
  <p id="message">Нажмите кнопку, чтобы изменить состояние.</p>
  <button id="action">Запустить</button>
</main>` },
        { path: "style.css", content: `:root { font-family: Inter, system-ui, sans-serif; color: #f8f7ff; background: #090719; }
* { box-sizing: border-box; }
body { min-height: 100vh; display: grid; place-items: center; margin: 0; padding: 24px; background: radial-gradient(circle at 70% 10%, #5425a8 0, transparent 40%), #090719; }
.app { width: min(520px, 100%); padding: 32px; border: 1px solid #ffffff1f; border-radius: 26px; background: #15102ee8; box-shadow: 0 30px 90px #0008; }
.badge { color: #c9ff00; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; }
h1 { margin: 10px 0; font-size: clamp(30px, 8vw, 52px); }
p { color: #aaa6c7; line-height: 1.6; }
button { padding: 13px 20px; border: 0; border-radius: 14px; background: linear-gradient(135deg, #9b3dff, #ff3fb0); color: white; font-weight: 800; cursor: pointer; }` },
        { path: "main.js", content: `const button = document.querySelector("#action");
const message = document.querySelector("#message");
let clicks = 0;

button.addEventListener("click", () => {
  clicks += 1;
  message.textContent = "Приложение работает. Нажатий: " + clicks;
  console.log("Состояние обновлено", { clicks });
});` },
      ],
    },
    game: {
      title: "Canvas-арена", description: "Мини-игра на JavaScript и Canvas", entryFile: "main.js",
      files: [
        { path: "index.html", content: `<div class="hud"><strong>Canvas-арена</strong><span>Счёт: <b id="score">0</b></span></div>
<canvas id="game" width="720" height="420"></canvas>
<p>Управление: WASD или стрелки. Собирайте зелёные сферы.</p>` },
        { path: "style.css", content: `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;align-content:center;gap:10px;padding:18px;background:#070617;color:#fff;font:15px system-ui}.hud{width:min(720px,100%);display:flex;justify-content:space-between;color:#c9ff00}canvas{width:min(720px,100%);aspect-ratio:12/7;border:1px solid #ffffff24;border-radius:18px;background:#100b2d;box-shadow:0 25px 80px #0008}p{color:#938eaf}` },
        { path: "main.js", content: `const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const player = { x: 80, y: 80, size: 22, speed: 4 };
let target = randomTarget();
let score = 0;
const keys = new Set();

function randomTarget() {
  return { x: 30 + Math.random() * (canvas.width - 60), y: 30 + Math.random() * (canvas.height - 60), size: 12 };
}
addEventListener("keydown", event => keys.add(event.key.toLowerCase()));
addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));

function update() {
  if (keys.has("arrowleft") || keys.has("a")) player.x -= player.speed;
  if (keys.has("arrowright") || keys.has("d")) player.x += player.speed;
  if (keys.has("arrowup") || keys.has("w")) player.y -= player.speed;
  if (keys.has("arrowdown") || keys.has("s")) player.y += player.speed;
  player.x = Math.max(player.size, Math.min(canvas.width - player.size, player.x));
  player.y = Math.max(player.size, Math.min(canvas.height - player.size, player.y));
  if (Math.hypot(player.x - target.x, player.y - target.y) < player.size + target.size) {
    score += 1; target = randomTarget(); document.querySelector("#score").textContent = score;
  }
}
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1a1240"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#c9ff00"; ctx.beginPath(); ctx.arc(target.x, target.y, target.size, 0, Math.PI * 2); ctx.fill();
  const gradient = ctx.createLinearGradient(player.x - 20, player.y - 20, player.x + 20, player.y + 20);
  gradient.addColorStop(0, "#9b3dff"); gradient.addColorStop(1, "#ff3fb0");
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(player.x, player.y, player.size, 0, Math.PI * 2); ctx.fill();
}
function loop() { update(); draw(); requestAnimationFrame(loop); }
loop();` },
      ],
    },
    console: {
      title: "JavaScript-программа", description: "Консольное приложение на JavaScript", entryFile: "main.js",
      files: [{ path: "main.js", content: `const numbers = [4, 8, 15, 16, 23, 42];
const average = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
console.log("Числа:", numbers.join(", "));
console.log("Среднее:", average.toFixed(2));` }],
    },
  },
  python: {
    console: {
      title: "Python-программа", description: "Консольное приложение на Python", entryFile: "main.py",
      files: [{ path: "main.py", content: `def calculate_score(values):
    return sum(value * value for value in values)

numbers = [2, 4, 6, 8]
print("Числа:", numbers)
print("Игровой счёт:", calculate_score(numbers))
` }],
    },
    game: {
      title: "Python-викторина", description: "Текстовая игра на Python", entryFile: "main.py",
      files: [{ path: "main.py", content: `questions = [
    ("Столица Франции?", "париж"),
    ("Сколько будет 7 * 8?", "56"),
]
score = 0
print("НЕМАКС: мини-викторина")
for question, answer in questions:
    print(question)
    user_answer = input().strip().lower()
    if user_answer == answer:
        score += 1
        print("Верно!")
    else:
        print("Правильный ответ:", answer)
print(f"Результат: {score}/{len(questions)}")
` }],
    },
  },
  java: {
    console: {
      title: "Java-приложение", description: "Консольное приложение на Java", entryFile: "Main.java",
      files: [{ path: "Main.java", content: `import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Integer> values = List.of(3, 5, 8, 13, 21);
        int sum = values.stream().mapToInt(Integer::intValue).sum();
        System.out.println("Числа: " + values);
        System.out.println("Сумма: " + sum);
    }
}
` }],
    },
    game: {
      title: "Java-арена", description: "Текстовая игровая логика на Java", entryFile: "Main.java",
      files: [{ path: "Main.java", content: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int energy = 100;
        System.out.println("НЕМАКС Java Arena");
        System.out.println("Введите силу удара от 1 до 10:");
        int power = scanner.hasNextInt() ? scanner.nextInt() : 1;
        int damage = Math.max(1, Math.min(10, power)) * 7;
        energy -= damage;
        System.out.println("Урон: " + damage);
        System.out.println("Энергия противника: " + energy);
    }
}
` }],
    },
  },
};

function cloneFiles(files) {
  return files.map((file) => ({ id: file.id || crypto.randomUUID(), path: file.path, content: file.content }));
}

function templateFor(language = "javascript", appType = "web") {
  const type = language !== "javascript" && appType === "web" ? "console" : appType;
  const template = TEMPLATES[language]?.[type] || TEMPLATES[language]?.console || TEMPLATES.javascript.web;
  return {
    title: template.title,
    description: template.description,
    language,
    appType: type,
    coverEmoji: language === "python" ? "🐍" : language === "java" ? "☕" : type === "game" ? "🎮" : "JS",
    accentColor: language === "python" ? "#4fa6ff" : language === "java" ? "#ff7c5c" : "#f7df1e",
    tags: [language, type],
    files: cloneFiles(template.files),
    entryFile: template.entryFile,
    published: false,
  };
}

function escapeStyle(value) {
  return String(value || "").replace(/<\/style/gi, "<\\/style");
}

function createBrowserDocument(project) {
  const file = (path) => project.files.find((item) => item.path === path)?.content || "";
  const html = file("index.html") || `<main><h1>${project.title || "JavaScript-приложение"}</h1><p>Добавьте index.html для интерфейса.</p></main>`;
  const css = escapeStyle(file("style.css"));
  const js = file(project.entryFile) || file("main.js");
  const encoded = btoa(unescape(encodeURIComponent(js)));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; font-src data:; form-action 'none'; base-uri 'none'"><style>${css}</style><script>
  (() => {
    const send = (kind, args) => parent.postMessage({ source: 'nemax-code', kind, args: args.map(value => { try { return typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); } }) }, '*');
    for (const kind of ['log','info','warn','error']) console[kind] = (...args) => send(kind, args);
    addEventListener('error', event => send('error', [event.message + ' @ ' + event.lineno + ':' + event.colno]));
    addEventListener('unhandledrejection', event => send('error', ['Promise: ' + String(event.reason)]));
  })();
</script></head><body>${html}<script>try { (0,eval)(decodeURIComponent(escape(atob(${JSON.stringify(encoded)})))); } catch (error) { console.error(error.stack || error.message); }</script></body></html>`;
}

function ProjectCard({ project, onOpen, onRun, onPublish, onDelete, mine }) {
  const language = LANGUAGES.find((item) => item.value === project.language);
  return <article className="code-project-card" style={{ "--code-accent": project.accentColor || "#56d6ff" }}>
    <div className="code-project-cover"><span>{project.coverEmoji || language?.icon || "⌘"}</span><i>{language?.label}</i></div>
    <div className="code-project-card-body"><h3>{project.title}</h3><p>{project.description || "Описание не добавлено"}</p><div>{(project.tags || []).slice(0, 5).map((tag) => <span key={tag}>#{tag}</span>)}</div><small>{project.files?.length || 0} файлов · {project.runs || 0} запусков</small></div>
    <footer><button onClick={() => onRun(project)}>▶ Запустить</button><button onClick={() => onOpen(project)}>{mine ? "Редактировать" : "Открыть код"}</button>{mine && <><button onClick={() => onPublish(project)}>{project.published ? "Снять" : "Опубликовать"}</button><button className="danger-link" onClick={() => onDelete(project)}>Удалить</button></>}</footer>
  </article>;
}

export default function CodeStudio() {
  const { user } = useAuth();
  const [view, setView] = useState("mine");
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState("");
  const [filterLanguage, setFilterLanguage] = useState("");
  const [project, setProject] = useState(() => templateFor("javascript", "web"));
  const [editingId, setEditingId] = useState("");
  const [activeFileId, setActiveFileId] = useState(project.files[0].id);
  const [output, setOutput] = useState([{ kind: "info", text: "Code Studio готов. Выберите шаблон или откройте проект." }]);
  const [preview, setPreview] = useState("");
  const [stdin, setStdin] = useState("");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runner, setRunner] = useState({ reachable: false, enabled: false });
  const iframeRef = useRef(null);

  const loadProjects = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (filterLanguage) params.set("language", filterLanguage);
    if (view === "mine") params.set("mine", "1");
    const result = await api(`/code/projects?${params}`);
    setProjects(result.projects || []);
  }, [query, filterLanguage, view]);

  useEffect(() => { if (view !== "editor") { const timer = setTimeout(() => loadProjects().catch((error) => setOutput([{ kind: "error", text: error.message }])), 140); return () => clearTimeout(timer); } }, [loadProjects, view]);
  useEffect(() => { api("/code/status").then((result) => setRunner(result.runner || {})).catch(() => setRunner({ reachable: false, enabled: false })); }, []);
  useEffect(() => {
    const projectId = localStorage.getItem("openCodeProjectId");
    if (!projectId) return;
    localStorage.removeItem("openCodeProjectId");
    api(`/code/projects/${projectId}`).then(({ project: saved }) => {
      const next = { ...saved, files: cloneFiles(saved.files || []) };
      setProject(next); setEditingId(saved.id); setActiveFileId(next.files[0]?.id || ""); setView("editor");
      setOutput([{ kind: "info", text: `Открыт проект «${saved.title}» из глобального поиска` }]);
    }).catch((error) => setOutput([{ kind: "error", text: error.message }]));
  }, []);
  useEffect(() => {
    const listener = (event) => {
      if (event.data?.source !== "nemax-code") return;
      const text = (event.data.args || []).join(" ");
      setOutput((items) => [...items, { kind: event.data.kind || "log", text }].slice(-200));
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  const activeFile = project.files.find((file) => file.id === activeFileId) || project.files[0];
  const isOwner = !editingId || project.ownerId === user?.id;
  const lineNumbers = useMemo(() => Array.from({ length: Math.max(1, String(activeFile?.content || "").split("\n").length) }, (_, index) => index + 1), [activeFile?.content]);
  const languageOptions = [{ value: "", label: "Все языки", icon: "⌘" }, ...LANGUAGES];

  function newProject(language = "javascript", appType = language === "javascript" ? "web" : "console") {
    const next = templateFor(language, appType);
    setProject(next); setEditingId(""); setActiveFileId(next.files[0].id); setPreview(""); setOutput([{ kind: "info", text: `Создан шаблон: ${next.title}` }]); setView("editor");
  }

  function openProject(item, runImmediately = false) {
    const next = { ...item, files: cloneFiles(item.files || []) };
    setProject(next); setEditingId(item.id); setActiveFileId(next.files[0]?.id || ""); setPreview(""); setOutput([{ kind: "info", text: `Открыт проект «${item.title}»` }]); setView("editor");
    if (runImmediately) setTimeout(() => runProject(next), 40);
  }

  function changeLanguage(language) {
    if (language === project.language) return;
    if (!confirm("Сменить язык и заменить файлы стартовым шаблоном?")) return;
    const next = templateFor(language, language === "javascript" ? project.appType : project.appType === "web" ? "console" : project.appType);
    setProject({ ...next, title: project.title || next.title, description: project.description || next.description, tags: [...new Set([...(project.tags || []), language])] });
    setActiveFileId(next.files[0].id); setPreview("");
  }

  function changeAppType(appType) {
    if (project.language !== "javascript" && appType === "web") return;
    if (appType === project.appType) return;
    const nextTemplate = TEMPLATES[project.language]?.[appType];
    if (nextTemplate && confirm("Загрузить стартовые файлы для выбранного типа приложения?")) {
      const files = cloneFiles(nextTemplate.files);
      setProject((current) => ({ ...current, appType, files, entryFile: nextTemplate.entryFile }));
      setActiveFileId(files[0].id);
    } else setProject((current) => ({ ...current, appType }));
  }

  function updateActiveFile(content) {
    setProject((current) => ({ ...current, files: current.files.map((file) => file.id === activeFile.id ? { ...file, content } : file) }));
  }

  function addFile() {
    const suggestion = project.language === "python" ? "module.py" : project.language === "java" ? "Helper.java" : "utils.js";
    const path = prompt("Имя нового файла", suggestion)?.trim().replaceAll("\\", "/");
    if (!path || project.files.some((file) => file.path === path)) return;
    const file = { id: crypto.randomUUID(), path, content: "" };
    setProject((current) => ({ ...current, files: [...current.files, file] })); setActiveFileId(file.id);
  }

  function renameFile(file) {
    const path = prompt("Новое имя файла", file.path)?.trim().replaceAll("\\", "/");
    if (!path || project.files.some((item) => item.id !== file.id && item.path === path)) return;
    setProject((current) => ({ ...current, files: current.files.map((item) => item.id === file.id ? { ...item, path } : item), entryFile: current.entryFile === file.path ? path : current.entryFile }));
  }

  function deleteFile(file) {
    if (project.files.length <= 1 || !confirm(`Удалить ${file.path}?`)) return;
    const files = project.files.filter((item) => item.id !== file.id);
    setProject((current) => ({ ...current, files, entryFile: current.entryFile === file.path ? files[0].path : current.entryFile }));
    if (activeFileId === file.id) setActiveFileId(files[0].id);
  }

  function forkProject() {
    const next = { ...project, id: undefined, ownerId: undefined, owner: undefined, title: `${project.title} — копия`, published: false, files: cloneFiles(project.files || []) };
    setProject(next); setEditingId(""); setActiveFileId(next.files[0]?.id || ""); setOutput([{ kind: "info", text: "Создана личная копия проекта. Теперь её можно редактировать и сохранить." }]);
  }

  async function saveProject() {
    if (!project.title.trim()) return alert("Введите название приложения");
    setSaving(true);
    try {
      const result = await api(editingId ? `/code/projects/${editingId}` : "/code/projects", { method: editingId ? "PATCH" : "POST", body: project });
      setEditingId(result.project.id); setProject({ ...result.project, files: cloneFiles(result.project.files) }); setOutput((items) => [...items, { kind: "info", text: "Проект сохранён на сервере" }]);
    } catch (error) { setOutput((items) => [...items, { kind: "error", text: error.message }]); }
    finally { setSaving(false); }
  }

  async function runProject(source = project) {
    setRunning(true); setOutput([{ kind: "info", text: `Запуск ${source.language}…` }]);
    try {
      if (source.language === "javascript" && ["web", "game"].includes(source.appType)) {
        setPreview(createBrowserDocument(source));
        setOutput((items) => [...items, { kind: "info", text: "Приложение запущено в изолированном browser sandbox без доступа к сети и данным НЕМАКС." }]);
        return;
      }
      if (source.language === "javascript" && !runner.enabled) {
        const virtual = { ...source, appType: "web", files: [{ id: "html", path: "index.html", content: "" }, { id: "style", path: "style.css", content: "" }, ...source.files] };
        setPreview(createBrowserDocument(virtual));
        setOutput((items) => [...items, { kind: "warn", text: "Серверный runner выключен — JavaScript выполнен в browser sandbox." }]);
        return;
      }
      const sourceProjectId = source.id || editingId || undefined;
      const sourceIsOwner = !source.ownerId || source.ownerId === user?.id;
      const runBody = sourceProjectId && !sourceIsOwner
        ? { projectId: sourceProjectId, stdin }
        : { projectId: sourceProjectId, language: source.language, files: source.files, entryFile: source.entryFile, stdin };
      const response = await api("/code/run", { method: "POST", body: runBody });
      const result = response.result || {};
      const next = [];
      if (result.compileOutput) next.push({ kind: "info", text: result.compileOutput });
      if (result.stdout) next.push({ kind: "log", text: result.stdout });
      if (result.stderr) next.push({ kind: "error", text: result.stderr });
      next.push({ kind: result.exitCode === 0 ? "info" : "warn", text: result.timedOut ? "Выполнение остановлено по тайм-ауту" : `Процесс завершён с кодом ${result.exitCode} за ${result.durationMs} мс` });
      setOutput(next);
    } catch (error) { setOutput([{ kind: "error", text: error.message }]); }
    finally { setRunning(false); }
  }

  async function togglePublish(item = project) {
    const id = item.id || editingId;
    if (!id) { alert("Сначала сохраните проект"); return; }
    const result = await api(`/code/projects/${id}/publish`, { method: "POST", body: {} });
    if (id === editingId) setProject((current) => ({ ...current, published: result.project.published }));
    await loadProjects().catch(() => {});
  }

  async function deleteProject(item) {
    if (!confirm(`Удалить приложение «${item.title}»?`)) return;
    await api(`/code/projects/${item.id}`, { method: "DELETE" }); await loadProjects();
  }

  return <section className="code-studio">
    <header className="code-studio-intro"><div><span className="section-eyebrow">НЕМАКС CODE STUDIO</span><h2>Разработка приложений внутри PLAY</h2><p>Создавайте JavaScript, Python и Java-проекты, тестируйте их, сохраняйте и публикуйте в галерее.</p></div><div className="runner-indicator"><i className={runner.enabled ? "online" : ""} /><span>{runner.enabled ? "Python / Java runner работает" : "Python / Java runner выключен"}</span></div></header>

    <nav className="code-studio-nav"><button className={view === "gallery" ? "active" : ""} onClick={() => setView("gallery")}>Галерея приложений</button><button className={view === "mine" ? "active" : ""} onClick={() => setView("mine")}>Мои проекты</button><button className={view === "editor" ? "active" : ""} onClick={() => setView("editor")}>Редактор</button><button className="new-code-button" onClick={() => newProject()}>＋ Новый проект</button></nav>

    {view !== "editor" && <><div className="code-project-toolbar"><div className="room-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск приложений и шаблонов" /></div><CustomSelect value={filterLanguage} onChange={setFilterLanguage} options={languageOptions} /></div><div className="code-project-grid">
      {projects.map((item) => <ProjectCard key={item.id} project={item} mine={item.ownerId === user?.id} onOpen={openProject} onRun={(value) => openProject(value, true)} onPublish={togglePublish} onDelete={deleteProject} />)}
      {projects.length === 0 && <div className="code-empty"><strong>Проектов пока нет</strong><span>Создайте первое приложение из готового шаблона.</span><div>{LANGUAGES.map((language) => <button key={language.value} onClick={() => newProject(language.value, language.value === "javascript" ? "web" : "console")}><b>{language.icon}</b><span>{language.label}</span></button>)}</div></div>}
    </div></>}

    {view === "editor" && <div className="code-ide">
      <div className="code-ide-toolbar"><div className="code-project-title"><input readOnly={!isOwner} value={project.title} onChange={(event) => setProject({ ...project, title: event.target.value })} placeholder="Название приложения" /><span>{editingId ? `ID ${editingId.slice(0, 8)}` : "Новый проект"}</span></div><div className="code-toolbar-selects"><CustomSelect disabled={!isOwner} value={project.language} onChange={changeLanguage} options={LANGUAGES} /><CustomSelect disabled={!isOwner} value={project.appType} onChange={changeAppType} options={APP_TYPES.filter((item) => project.language === "javascript" || item.value !== "web")} /></div><div className="code-toolbar-actions"><button onClick={() => runProject()} disabled={running}>{running ? "Выполняется…" : "▶ Запустить"}</button>{isOwner ? <><button onClick={saveProject} disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</button><button className={project.published ? "published" : ""} onClick={() => togglePublish()}>{project.published ? "Опубликовано" : "Опубликовать"}</button></> : <button onClick={forkProject}>Сделать копию</button>}</div></div>

      <aside className="code-file-panel"><div className="code-file-panel-title"><strong>Файлы</strong>{isOwner && <button onClick={addFile}>＋</button>}</div><div className="code-file-list">{project.files.map((file) => <button key={file.id} className={file.id === activeFile?.id ? "active" : ""} onClick={() => setActiveFileId(file.id)} onDoubleClick={() => isOwner && renameFile(file)}><span>{file.path.endsWith(".py") ? "Py" : file.path.endsWith(".java") ? "Jv" : file.path.endsWith(".html") ? "<>" : file.path.endsWith(".css") ? "#" : "JS"}</span><em>{file.path}</em>{project.entryFile === file.path && <i>▶</i>}</button>)}</div>{isOwner && <div className="code-file-actions"><button onClick={() => renameFile(activeFile)}>Переименовать</button><button disabled={project.files.length <= 1} onClick={() => deleteFile(activeFile)}>Удалить</button></div>}<label>Стартовый файл<CustomSelect disabled={!isOwner} value={project.entryFile} onChange={(entryFile) => setProject({ ...project, entryFile })} options={project.files.map((file) => ({ value: file.path, label: file.path, icon: "▶" }))} /></label></aside>

      <main className="code-editor-panel"><div className="code-editor-tabs"><span>{activeFile?.path}</span><small>{String(activeFile?.content || "").length} символов</small></div><div className="code-editor-shell"><div className="code-line-numbers">{lineNumbers.map((line) => <span key={line}>{line}</span>)}</div><textarea readOnly={!isOwner} spellCheck="false" value={activeFile?.content || ""} onChange={(event) => updateActiveFile(event.target.value)} onKeyDown={(event) => { if (isOwner && event.key === "Tab") { event.preventDefault(); const target = event.currentTarget; const start = target.selectionStart; const end = target.selectionEnd; const value = `${target.value.slice(0, start)}  ${target.value.slice(end)}`; updateActiveFile(value); requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2; }); } }} /></div></main>

      <aside className="code-output-panel"><div className="code-result-tabs"><strong>{preview ? "Предпросмотр" : "Консоль"}</strong><div><button className={!preview ? "active" : ""} onClick={() => setPreview("")}>Консоль</button>{project.language === "javascript" && <button className={preview ? "active" : ""} onClick={() => runProject()}>Preview</button>}<button onClick={() => setOutput([])}>Очистить</button></div></div>{preview ? <iframe ref={iframeRef} title="Предпросмотр приложения" sandbox="allow-scripts allow-forms allow-modals" srcDoc={preview} /> : <div className="code-console">{output.length ? output.map((line, index) => <pre className={line.kind} key={`${index}-${line.text.slice(0, 12)}`}>{line.kind === "error" ? "× " : line.kind === "warn" ? "! " : "› "}{line.text}</pre>) : <span>Консоль очищена</span>}</div>}<label className="code-stdin">Стандартный ввод<textarea rows={3} value={stdin} onChange={(event) => setStdin(event.target.value)} placeholder={project.language === "python" || project.language === "java" ? "Каждый ответ с новой строки" : "Необязательно"} /></label></aside>

      <footer className="code-project-settings"><label>Описание<textarea readOnly={!isOwner} rows={2} value={project.description} onChange={(event) => setProject({ ...project, description: event.target.value })} /></label><label>Теги<TagInput disabled={!isOwner} value={project.tags || []} onChange={(tags) => setProject({ ...project, tags })} suggestions={["игра", "обучение", "алгоритмы", "web", "canvas", "консоль"]} /></label><div className="code-visual-settings"><label>Иконка<input readOnly={!isOwner} value={project.coverEmoji || ""} onChange={(event) => setProject({ ...project, coverEmoji: event.target.value.slice(0, 12) })} /></label><label>Цвет<input disabled={!isOwner} type="color" value={project.accentColor || "#56d6ff"} onChange={(event) => setProject({ ...project, accentColor: event.target.value })} /></label></div></footer>
    </div>}
  </section>;
}
