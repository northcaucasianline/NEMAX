import { createBrowserRouter } from "react-router-dom";
import App from "../App";
import MessengerPage from "../pages/MessengerPage";
import SettingsPage from "../pages/SettingsPage";
import SearchPage from "../pages/SearchPage";
import UserProfilePage from "../pages/UserProfilePage";
import LoginPage from "../pages/LoginPage";
import RegisterPage from "../pages/RegisterPage";
import ProtectedRoute from "./ProtectedRoute";
import AdminRoute from "./AdminRoute";
import NewsPage from "../pages/NewsPage";
import AdminPage from "../pages/AdminPage";
import BoardsPage from "../pages/BoardsPage";
import RoomsPage from "../pages/RoomsPage";
import GamesPage from "../pages/GamesPage";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <ProtectedRoute><MessengerPage /></ProtectedRoute> },
      { path: "settings", element: <ProtectedRoute><SettingsPage /></ProtectedRoute> },
      { path: "news", element: <ProtectedRoute><NewsPage /></ProtectedRoute> },
      { path: "boards", element: <ProtectedRoute><BoardsPage /></ProtectedRoute> },
      { path: "rooms", element: <ProtectedRoute><RoomsPage /></ProtectedRoute> },
      { path: "games", element: <ProtectedRoute><GamesPage /></ProtectedRoute> },
      { path: "admin", element: <AdminRoute><AdminPage /></AdminRoute> },
      { path: "search", element: <ProtectedRoute><SearchPage /></ProtectedRoute> },
      { path: "profile/:id", element: <ProtectedRoute><UserProfilePage /></ProtectedRoute> },
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
    ],
  },
]);

export { router };