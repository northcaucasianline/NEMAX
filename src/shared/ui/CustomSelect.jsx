import { useEffect, useRef, useState } from "react";

function normalizedOptions(options) {
  return (options || []).map((option) => typeof option === "string" ? { value: option, label: option } : option);
}

function CustomSelect({ value = "", onChange, options = [], placeholder = "Выберите", icon = "⌄", disabled = false, className = "" }) {
  const root = useRef(null);
  const [open, setOpen] = useState(false);
  const items = normalizedOptions(options);
  const selected = items.find((item) => item.value === value);

  useEffect(() => {
    function close(event) { if (!root.current?.contains(event.target)) setOpen(false); }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function choose(item) {
    onChange?.(item.value, item);
    setOpen(false);
  }

  return <div ref={root} className={`custom-select ${open ? "open" : ""} ${className}`}>
    <button type="button" disabled={disabled} className="custom-select-trigger" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-haspopup="listbox">
      <span className="custom-select-leading">{selected?.icon || icon}</span>
      <span className={selected ? "" : "muted"}>{selected?.label || placeholder}</span>
      <span className="custom-select-chevron">⌄</span>
    </button>
    {open && <div className="custom-select-menu" role="listbox">
      {items.map((item) => <button type="button" key={String(item.value)} className={item.value === value ? "selected" : ""} onClick={() => choose(item)} role="option" aria-selected={item.value === value}>
        <span className="custom-select-option-icon">{item.icon || "•"}</span>
        <span><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>
        {item.value === value && <b>✓</b>}
      </button>)}
    </div>}
  </div>;
}

export default CustomSelect;
