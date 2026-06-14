});

  document.getElementById("btn-add").addEventListener("click", () => {
    const name = document.getElementById("input-aircraft").value.trim();
    if (!name || watchlist.includes(name)) return;
    watchlist.push(name);
    localStorage.setItem("watchlist", JSON.stringify(watchlist));
    addWatchlistTag(name);
    document.getElementById("input-aircraft").value = "";
  });

  document.getElementById("input-aircraft").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-add").click();
  });

  document.getElementById("btn-toggle").addEventListener("click", () => {
    if (monitoring) {
      stopMonitoring();
    } else {
      if (!userLocation) { alert("Please set your location first!"); return; }
      startMonitoring();
    }
  });

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
