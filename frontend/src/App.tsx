import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import Layout from "./components/Layout";
import ContractView from "./views/ContractView";
import EventView from "./views/EventView";
import HomeView from "./views/HomeView";
import NotFoundView from "./views/NotFoundView";

// The vanilla router scrolled to the top on every navigation; BrowserRouter doesn't.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomeView />} />
          <Route path="/event/:ticker" element={<EventView />} />
          <Route path="/contract/:ticker" element={<ContractView />} />
          <Route path="*" element={<NotFoundView />} />
        </Route>
      </Routes>
    </>
  );
}
