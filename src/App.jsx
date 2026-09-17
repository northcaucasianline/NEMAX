import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Header from "./widgets/Header/Header";

function App() {
  const [broadcast, setBroadcast] = useState(null);
  useEffect(() => {
    const handler = (event) => {
      setBroadcast(event.detail);
      setTimeout(() => setBroadcast(null), 12000);
    };
    window.addEventListener("admin:broadcast", handler);
    return () => window.removeEventListener("admin:broadcast", handler);
  }, []);

  return <>
    <Header />
    {broadcast && <div className={`admin-broadcast ${broadcast.severity || "info"}`}><strong>Системное сообщение</strong><span>{broadcast.message}</span><button onClick={() => setBroadcast(null)}>✕</button></div>}
    <main className="app-main"><Outlet /></main>
  </>;
}

export default App;
