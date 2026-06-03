console.log('Meesho Autofill Tool: Background service worker loaded');

// Just relay messages between popup and content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // If message comes from content script, forward to popup
  if (sender.tab) {
    chrome.runtime.sendMessage(request);
  }
  return true;
});
