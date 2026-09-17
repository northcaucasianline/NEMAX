import { useMemo, useState } from "react";

export default function NovelPlayer({ game, onFinish }) {
  const config = game.config || {};
  const scenes = Array.isArray(config.scenes) ? config.scenes : [];
  const byId = useMemo(() => new Map(scenes.map((scene) => [scene.id, scene])), [scenes]);
  const startId = config.startSceneId && byId.has(config.startSceneId) ? config.startSceneId : scenes[0]?.id;
  const [sceneId, setSceneId] = useState(startId);
  const [history, setHistory] = useState([]);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const scene = byId.get(sceneId);

  function choose(choice) {
    const nextScore = score + Number(choice.scoreDelta || 0);
    setScore(nextScore);
    setHistory((items) => [...items, sceneId]);
    if (choice.nextSceneId && byId.has(choice.nextSceneId)) setSceneId(choice.nextSceneId);
    else { setFinished(true); onFinish?.(nextScore, { path: [...history, sceneId], endingSceneId: sceneId }); }
  }

  function continueScene() {
    if (scene?.choices?.length) return;
    setFinished(true);
    onFinish?.(score, { path: [...history, sceneId], endingSceneId: sceneId });
  }

  function restart() {
    setSceneId(startId); setHistory([]); setScore(0); setFinished(false);
  }

  if (!scene) return <div className="novel-player-error">В новелле пока нет сцен.</div>;
  const background = scene.background?.startsWith("#") || scene.background?.includes("gradient") ? scene.background : `linear-gradient(rgba(4,3,18,.1),rgba(4,3,18,.72)), url(${scene.background}) center/cover`;

  return <div className="novel-player" style={{ background }}>
    {!finished ? <><div className="novel-stage-character">{scene.characterEmoji || "🎭"}</div><div className="novel-dialogue"><small>{scene.speaker || "Рассказчик"}</small><p>{scene.text || "…"}</p>{scene.choices?.length ? <div className="novel-player-choices">{scene.choices.map((choice, index) => <button key={index} onClick={() => choose(choice)}><b>{index + 1}</b><span>{choice.text || `Вариант ${index + 1}`}</span></button>)}</div> : <button className="novel-continue" onClick={continueScene}>Продолжить →</button>}<footer><span>Сцена: {scene.title || "Без названия"}</span><span>Путь: {history.length + 1}</span></footer></div></> : <div className="novel-ending"><span>✦</span><h2>{config.endingText || "Конец истории"}</h2><p>Пройдено сцен: {history.length + 1}</p><strong>{score} сюжетных очков</strong><button onClick={restart}>Пройти ещё раз</button></div>}
  </div>;
}
