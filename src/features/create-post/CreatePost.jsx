import { useState } from "react";

function CreatePost({ onCreate }) {
  const [text, setText] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onCreate(text);
    setText("");
  }

  return (
    <form className="create-post" onSubmit={handleSubmit}>
      <textarea
        placeholder="Что у вас нового?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />
      <button type="submit" disabled={!text.trim()}>
        Опубликовать
      </button>
    </form>
  );
}

export default CreatePost;