chrome.browserAction.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  chrome.tabs.executeScript(tab.id, { file: "scraper.js" }, () => {
    if (chrome.runtime.lastError) {
      console.error("Injection error:", chrome.runtime.lastError.message);
      alert("Could not inject scraper: " + chrome.runtime.lastError.message);
    }
  });
});
