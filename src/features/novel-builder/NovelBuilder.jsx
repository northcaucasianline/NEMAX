import { useEffect, useMemo, useState } from "react";
import CustomSelect from "../../shared/ui/CustomSelect";

function sceneId() {
  return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createNovelConfig() {
  const start = sceneId();
  return {
    startSceneId: start,
    endingText: "Конец истории",
    scenes: [{ id: start, title: "Начало", speaker: "Рассказчик", text: "Однажды всё изменилось…", characterEmoji: "🌙", background: "#171333", choices: [] }],
  };
}

function normalize(config) {
  const fallback = createNovelConfig();
  const scenes = Array.isArray(config?.scenes) && config.scenes.length ? config.scenes : fallback.scenes;
  return {
    ...fallback,
    ...(config || {}),
    scenes: scenes.map((scene, index) => ({
      id: scene.id || sceneId(),
      title: scene.title || `Сцена ${index + 1}`,
      speaker: scene.speaker || "Рассказчик",
      text: scene.text || "",
      characterEmoji: scene.characterEmoji || "🎭",
      background: scene.background || "#171333",
      choices: Array.isArray(scene.choices) ? scene.choices.map((choice) => ({ text: choice.text || "", nextSceneId: choice.nextSceneId || "", scoreDelta: Number(choice.scoreDelta || 0) })) : [],
    })),
  };
}

export default function NovelBuilder({ value, onChange }) {
  const config = useMemo(() => normalize(value), [value]);
  const [selectedId, setSelectedId] = useState(config.startSceneId || config.scenes[0]?.id);
  const selected = config.scenes.find((scene) => scene.id === selectedId) || config.scenes[0];

  useEffect(() => {
    if (!config.scenes.some((scene) => scene.id === selectedId)) setSelectedId(config.scenes[0]?.id || "");
  }, [config.scenes, selectedId]);

  function emit(next) {
    onChange?.(normalize(next));
  }

  function updateScene(patch) {
    emit({ ...config, scenes: config.scenes.map((scene) => scene.id === selected.id ? { ...scene, ...patch } : scene) });
  }

  function addScene() {
    const id = sceneId();
    emit({ ...config, scenes: [...config.scenes, { id, title: `Сцена ${config.scenes.length + 1}`, speaker: "Рассказчик", text: "", characterEmoji: "✨", background: "#171333", choices: [] }] });
    setSelectedId(id);
  }

  function duplicateScene() {
    if (!selected) return;
    const id = sceneId();
    const copy = { ...selected, id, title: `${selected.title} — копия`, choices: selected.choices.map((choice) => ({ ...choice })) };
    emit({ ...config, scenes: [...config.scenes, copy] });
    setSelectedId(id);
  }

  function removeScene() {
    if (!selected || config.scenes.length <= 1) return;
    const nextScenes = config.scenes.filter((scene) => scene.id !== selected.id).map((scene) => ({ ...scene, choices: scene.choices.map((choice) => choice.nextSceneId === selected.id ? { ...choice, nextSceneId: "" } : choice) }));
    const nextStart = config.startSceneId === selected.id ? nextScenes[0].id : config.startSceneId;
    emit({ ...config, startSceneId: nextStart, scenes: nextScenes });
    setSelectedId(nextScenes[0].id);
  }

  function addChoice() {
    updateScene({ choices: [...selected.choices, { text: "Новый выбор", nextSceneId: "", scoreDelta: 0 }] });
  }

  function updateChoice(index, patch) {
    updateScene({ choices: selected.choices.map((choice, choiceIndex) => choiceIndex === index ? { ...choice, ...patch } : choice) });
  }

  function removeChoice(index) {
    updateScene({ choices: selected.choices.filter((_, choiceIndex) => choiceIndex !== index) });
  }

  const sceneOptions = [{ value: "", label: "Завершить новеллу", icon: "■" }, ...config.scenes.map((scene) => ({ value: scene.id, label: scene.title, icon: scene.id === config.startSceneId ? "▶" : "◇" }))];

  return <section className="novel-builder-shell">
    <aside className="novel-scenes-panel">
      <header><div><span className="section-eyebrow">Сценарий</span><h3>Сцены новеллы</h3></div><button type="button" onClick={addScene}>＋</button></header>
      <div className="novel-scenes-list">{config.scenes.map((scene, index) => <button type="button" key={scene.id} className={scene.id === selected?.id ? "active" : ""} onClick={() => setSelectedId(scene.id)}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{scene.title}</strong><small>{scene.speaker}</small></span>{scene.id === config.startSceneId && <i>START</i>}</button>)}</div>
      <div className="novel-scene-actions"><button type="button" onClick={duplicateScene}>Дублировать</button><button type="button" disabled={config.scenes.length <= 1} onClick={removeScene}>Удалить</button></div>
    </aside>

    {selected && <main className="novel-scene-editor">
      <div className="novel-scene-preview" style={{ background: selected.background?.startsWith("#") || selected.background?.includes("gradient") ? selected.background : `linear-gradient(rgba(7,5,23,.18),rgba(7,5,23,.7)), url(${selected.background}) center/cover` }}>
        <span>{selected.characterEmoji || "🎭"}</span><div><small>{selected.speaker || "Рассказчик"}</small><strong>{selected.text || "Текст сцены появится здесь"}</strong></div>
      </div>
      <div className="form-grid-two"><label>Название сцены<input value={selected.title} onChange={(event) => updateScene({ title: event.target.value })} /></label><label>Персонаж / автор реплики<input value={selected.speaker} onChange={(event) => updateScene({ speaker: event.target.value })} /></label></div>
      <div className="form-grid-two"><label>Эмодзи персонажа<input value={selected.characterEmoji} onChange={(event) => updateScene({ characterEmoji: event.target.value.slice(0, 12) })} /></label><label>Фон: цвет, CSS-gradient или URL<input value={selected.background} onChange={(event) => updateScene({ background: event.target.value })} /></label></div>
      <label>Текст сцены<textarea rows={6} value={selected.text} onChange={(event) => updateScene({ text: event.target.value })} placeholder="Диалог, описание или действие…" /></label>
      <div className="novel-start-row"><label><input type="radio" checked={config.startSceneId === selected.id} onChange={() => emit({ ...config, startSceneId: selected.id })} /> Сделать стартовой сценой</label><label>Финальная надпись<input value={config.endingText || ""} onChange={(event) => emit({ ...config, endingText: event.target.value })} /></label></div>
      <section className="novel-choices"><header><div><h3>Варианты выбора</h3><p>Каждый вариант ведёт к другой сцене или завершает историю.</p></div><button type="button" onClick={addChoice}>＋ Вариант</button></header>
        {selected.choices.length === 0 && <div className="novel-empty-choice">Нет вариантов — после этой сцены история завершится.</div>}
        {selected.choices.map((choice, index) => <article key={`${selected.id}-${index}`}><b>{index + 1}</b><input value={choice.text} onChange={(event) => updateChoice(index, { text: event.target.value })} placeholder="Текст выбора" /><CustomSelect value={choice.nextSceneId} onChange={(nextSceneId) => updateChoice(index, { nextSceneId })} options={sceneOptions} /><label className="choice-score">Очки<input type="number" min="-1000" max="1000" value={choice.scoreDelta} onChange={(event) => updateChoice(index, { scoreDelta: Number(event.target.value) })} /></label><button type="button" onClick={() => removeChoice(index)}>×</button></article>)}
      </section>
    </main>}
  </section>;
}
