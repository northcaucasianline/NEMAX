import { useState, useEffect } from "react";
import PostCard from "../entities/post/PostCard";
import CreatePost from "../features/create-post/CreatePost";
import useAuth from "../hooks/useAuth";

function HomePage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState(() => {
    const saved = localStorage.getItem("posts");
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem("posts", JSON.stringify(posts));
  }, [posts]);

  function handleCreatePost(text) {
    const newPost = {
      id: Date.now(),
      authorId: user.id,
      authorName: user.username,
      text,
      date: new Date().toLocaleString(),
      likes: [],
      comments: [],
    };
    setPosts([newPost, ...posts]);
  }

  function handleLike(postId) {
    setPosts(
      posts.map((post) => {
        if (post.id !== postId) return post;
        const liked = post.likes.includes(user.id);
        return {
          ...post,
          likes: liked
            ? post.likes.filter((id) => id !== user.id)
            : [...post.likes, user.id],
        };
      })
    );
  }

  function handleDelete(postId) {
    setPosts(posts.filter((p) => p.id !== postId));
  }

  function handleAddComment(postId, text) {
    setPosts(
      posts.map((post) => {
        if (post.id !== postId) return post;
        return {
          ...post,
          comments: [
            ...post.comments,
            {
              id: Date.now(),
              authorId: user.id,
              authorName: user.username,
              text,
              date: new Date().toLocaleString(),
            },
          ],
        };
      })
    );
  }

  return (
    <div className="home-page">
      <CreatePost onCreate={handleCreatePost} />
      <div className="feed">
        {posts.length === 0 ? (
          <p className="empty-feed">Пока нет постов. Будь первым!</p>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUser={user}
              onLike={handleLike}
              onDelete={handleDelete}
              onComment={handleAddComment}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default HomePage;