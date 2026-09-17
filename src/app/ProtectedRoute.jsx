import { Navigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading">Подключение к серверу…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default ProtectedRoute;
