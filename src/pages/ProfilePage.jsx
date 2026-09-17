import useAuth from "../hooks/useAuth";

function ProfilePage() {
  const { user, logout } = useAuth();

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="profile-avatar">👤</div>
        <h2>{user.username}</h2>
        <p>{user.email}</p>
        <button onClick={logout} className="logout-btn">
          Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}

export default ProfilePage;