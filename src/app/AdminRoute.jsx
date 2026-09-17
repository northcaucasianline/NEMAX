import { Navigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading">Проверка прав администратора…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!(user.role === "admin" || user.isSystemAdmin)) return <Navigate to="/" replace />;
  return children;
}

export default AdminRoute;
