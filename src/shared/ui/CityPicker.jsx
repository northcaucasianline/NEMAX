import { useEffect, useMemo, useRef, useState } from "react";

let cityDataPromise;
const recentKey = "nemax:recent-cities";
const popularCities = [
  "Москва, Москва и Московская область, Россия",
  "Санкт-Петербург, Санкт-Петербург и Ленинградская область, Россия",
  "Екатеринбург, Свердловская область, Россия",
  "Минск, Минская область, Беларусь",
  "Алматы, Алматинская область, Казахстан",
  "Астана, Астана, Казахстан",
  "Ташкент, Ташкент, Узбекистан",
  "Баку, Баку, Азербайджан",
  "Тбилиси, Тбилиси, Грузия",
  "Ереван, Ереван, Армения",
];

function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("ru")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function labelOf(city) {
  return [city.n, city.r, city.c].filter(Boolean).join(", ");
}

async function loadCities() {
  cityDataPromise ||= fetch("/data/world-cities.json")
    .then((response) => {
      if (!response.ok) throw new Error("Не удалось загрузить справочник городов");
      return response.json();
    })
    .then((payload) => (payload.cities || []).map((city) => ({ ...city, label: labelOf(city), search: normalize(`${city.n} ${city.r} ${city.c}`) })));
  return cityDataPromise;
}

function readRecent() {
  try { return JSON.parse(localStorage.getItem(recentKey) || "[]").slice(0, 8); }
  catch { return []; }
}

function saveRecent(value) {
  if (!value) return;
  const next = [value, ...readRecent().filter((item) => item !== value)].slice(0, 8);
  localStorage.setItem(recentKey, JSON.stringify(next));
}

function CityPicker({ value = "", onChange, placeholder = "Выберите город", disabled = false, id, name, required = false, compact = false }) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState(readRecent);

  useEffect(() => {
    function outside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  useEffect(() => {
    if (!open || cities.length) return;
    setLoading(true);
    loadCities().then(setCities).catch((cause) => setError(cause.message)).finally(() => setLoading(false));
  }, [open, cities.length]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo(() => {
    const normalized = normalize(query);
    if (!normalized) {
      const labels = [...recent, ...popularCities.filter((item) => !recent.includes(item))];
      return labels.slice(0, 12).map((label) => {
        const parts = label.split(", ");
        return { label, n: parts[0], r: parts[1] || "", c: parts.slice(2).join(", ") || "" };
      });
    }
    const terms = normalized.split(" ").filter(Boolean);
    const starts = [];
    const contains = [];
    for (const city of cities) {
      if (!terms.every((term) => city.search.includes(term))) continue;
      const target = city.search.startsWith(normalized) || normalize(city.n).startsWith(normalized) ? starts : contains;
      target.push(city);
      if (starts.length + contains.length >= 120) break;
    }
    return [...starts, ...contains].slice(0, 60);
  }, [query, cities, recent]);

  function choose(city) {
    const next = city.label || labelOf(city);
    onChange?.(next, city);
    saveRecent(next);
    setRecent(readRecent());
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(results.length - 1, index + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
    if (event.key === "Enter" && results[activeIndex]) { event.preventDefault(); choose(results[activeIndex]); }
    if (event.key === "Escape") setOpen(false);
  }

  return <div className={`city-picker ${open ? "open" : ""} ${compact ? "compact" : ""}`} ref={rootRef}>
    <input type="hidden" id={id} name={name} value={value} required={required} />
    <button type="button" className="city-picker-trigger" disabled={disabled} onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open}>
      <span className="city-picker-icon">⌖</span>
      <span className={value ? "city-picker-value" : "city-picker-placeholder"}>{value || placeholder}</span>
      {value && !disabled && <span role="button" tabIndex={0} className="city-picker-clear" onClick={(event) => { event.stopPropagation(); onChange?.(""); }} onKeyDown={(event) => event.key === "Enter" && onChange?.("")}>×</span>}
      <span className="city-picker-chevron">⌄</span>
    </button>
    {open && <div className="city-picker-popover">
      <div className="city-picker-search"><span>⌕</span><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={onKeyDown} placeholder="Начните вводить город, регион или страну" /></div>
      <div className="city-picker-caption">{query ? `Найдено: ${results.length}` : recent.length ? "Недавние и популярные" : "Популярные города"}</div>
      <div className="city-picker-results" role="listbox">
        {loading && <div className="city-picker-state">Загружаем города мира…</div>}
        {error && <div className="city-picker-state error">{error}</div>}
        {!loading && !error && results.length === 0 && <div className="city-picker-state">Ничего не найдено. Проверьте написание.</div>}
        {!loading && results.map((city, index) => <button type="button" role="option" aria-selected={value === city.label} className={`${index === activeIndex ? "active" : ""} ${value === city.label ? "selected" : ""}`} key={`${city.i || city.label}-${index}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(city)}>
          <span className="city-result-pin">●</span>
          <span><strong>{city.n}</strong><small>{[city.r, city.c].filter(Boolean).join(" · ")}</small></span>
          {value === city.label && <b>✓</b>}
        </button>)}
      </div>
      <div className="city-picker-footer">34 000+ городов и крупных населённых пунктов · выбор только из справочника</div>
    </div>}
  </div>;
}

export default CityPicker;
