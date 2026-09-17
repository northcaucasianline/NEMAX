import { useMemo, useState } from "react";

function clean(value) {
  return String(value || "").trim().replace(/^#/, "").replace(/\s+/g, " ").slice(0, 36);
}

export function TagInput({ value = [], onChange, suggestions = [], placeholder = "Добавьте интерес и нажмите Enter", max = 8, disabled = false }) {
  const [draft, setDraft] = useState("");
  const filtered = useMemo(() => suggestions.filter((item) => !value.includes(item) && (!draft || item.toLocaleLowerCase("ru").includes(draft.toLocaleLowerCase("ru")))).slice(0, 8), [suggestions, value, draft]);

  function add(raw) {
    if (disabled) return;
    const tag = clean(raw);
    if (!tag || value.some((item) => item.toLocaleLowerCase("ru") === tag.toLocaleLowerCase("ru")) || value.length >= max) return;
    onChange?.([...value, tag]);
    setDraft("");
  }

  function keyDown(event) {
    if (disabled) return;
    if (["Enter", ","].includes(event.key)) { event.preventDefault(); add(draft); }
    if (event.key === "Backspace" && !draft && value.length) onChange?.(value.slice(0, -1));
  }

  return <div className={`tag-input-wrap ${disabled ? "disabled" : ""}`}>
    <div className="tag-input">
      {value.map((tag) => <span key={tag} className="interest-tag"><i>#</i>{tag}<button type="button" disabled={disabled} onClick={() => onChange?.(value.filter((item) => item !== tag))}>×</button></span>)}
      {!disabled && value.length < max && <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={keyDown} onBlur={() => draft && add(draft)} placeholder={value.length ? "Ещё тег…" : placeholder} />}
    </div>
    {!disabled && draft && filtered.length > 0 && <div className="tag-suggestions">{filtered.map((tag) => <button type="button" key={tag} onMouseDown={(event) => event.preventDefault()} onClick={() => add(tag)}>#{tag}</button>)}</div>}
    <small className="tag-input-hint">Можно создать любые теги. До {max} штук.</small>
  </div>;
}

export default TagInput;
