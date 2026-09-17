import { useState } from "react";

function PostCard({ post, currentUser, onLike, onDelete, onComment }) {
  const [commentText, setCommentText] = useState("");
  const [showComments, setShowComments] = useState(false);

  const isLiked = post.likes.includes(currentUser.id);
  const isOwner = post.authorId === currentUser.id;

  function handleCommentSubmit(e) {
    e.preventDefault();
    if (!commentText.trim()) return;
    onComment(post.id, commentText);
    setCommentText("");
  }

  return (
    <article className="post-card">
      <div className="post-header">
        <span className="post-author">👤 {post.authorName}</span>
        <span className="post-date">{post.date}</span>
        {isOwner && (
          <button className="delete-btn" onClick={() => onDelete(post.id)}>
            🗑️
          </button>
        )}
      </div>
      <p className="post-text">{post.text}</p>
      <div className="post-actions">
        <button
          className={`like-btn ${isLiked ? "liked" : ""}`}
          onClick={() => onLike(post.id)}
        >
          {isLiked ? "❤️" : "🤍"} {post.likes.length}
        </button>
        <button
          className="comment-toggle"
          onClick={() => setShowComments(!showComments)}
        >
          💬 {post.comments.length}
        </button>
      </div>

      {showComments && (
        <div className="comments-section">
          {post.comments.map((comment) => (
            <div key={comment.id} className="comment">
              <strong>{comment.authorName}</strong>
              <p>{comment.text}</p>
            </div>
          ))}
          <form onSubmit={handleCommentSubmit} className="comment-form">
            <input
              type="text"
              placeholder="Написать комментарий..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
            />
            <button type="submit">Отправить</button>
          </form>
        </div>
      )}
    </article>
  );
}

export default PostCard;