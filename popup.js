document.addEventListener("DOMContentLoaded", async () => {
  console.log("Popup loaded!");
  const profileSelect = document.getElementById("profileSelect");
  const newBtn = document.getElementById("newBtn");
  const editBtn = document.getElementById("editBtn");
  const delBtn = document.getElementById("delBtn");
  const startCaptureBtn = document.getElementById("startCaptureBtn");
  const stopCaptureBtn = document.getElementById("stopCaptureBtn");
  const captureCountEl = document.getElementById("captureCount");
  const autofillBtn = document.getElementById("autofillBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importFile = document.getElementById("importFile");
  const modal = document.getElementById("profileModal");
  const closeModal = document.querySelector(".close");
  const profileNameInput = document.getElementById("profileName");
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const modalTitle = document.getElementById("modalTitle");

  let profiles = [];
  let editingProfileId = null;
  let tempData = null;

  // Initialize: stop button is disabled
  stopCaptureBtn.disabled = true;
  stopCaptureBtn.style.opacity = "0.5";

  await loadProfiles();

  // Check if there's temp captured data
  const storageData = await chrome.storage.local.get("tempCapturedData");
  tempData = storageData.tempCapturedData;

  // Create a save temp data button if needed
  const container = document.querySelector(".container");
  let saveTempBtn = null;

  if (tempData && tempData.length > 0) {
    saveTempBtn = document.createElement("button");
    saveTempBtn.textContent = `💾 Save ${tempData.length} Captured Fields!`;
    saveTempBtn.style.cssText = `
      width: 100%;
      padding: 10px;
      background: #4CAF50;
      color: white;
      border: 2px solid black;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      margin-bottom: 15px;
    `;
    saveTempBtn.onclick = async () => {
      const selectedId = profileSelect.value;
      if (!selectedId) {
        alert("Please select a profile first!");
        return;
      }
      const index = profiles.findIndex((p) => p.id === selectedId);
      if (index !== -1) {
        profiles[index].data = tempData;
        await chrome.storage.local.set({ profiles });
        await chrome.storage.local.remove("tempCapturedData");
        tempData = null;
        if (saveTempBtn && saveTempBtn.parentNode) {
          saveTempBtn.parentNode.removeChild(saveTempBtn);
        }
        alert(
          `✅ Saved ${profiles[index].data.length} fields to "${profiles[index].name}"!`,
        );
        await loadProfiles();
      }
    };
    container.insertBefore(
      saveTempBtn,
      container.firstChild.nextSibling.nextSibling,
    ); // Insert after header
  }

  async function ensureContentScriptInjected(tabId) {
    console.log("Checking if content script is injected in tab:", tabId);
    try {
      await chrome.tabs.sendMessage(tabId, { action: "ping" });
      console.log("Content script already injected");
      return true;
    } catch (e) {
      console.log("Content script not found, injecting now");
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["combined-content.js"],
        });
        console.log("Content script injected successfully");
        return true;
      } catch (err) {
        console.error("Error injecting content script:", err);
        return false;
      }
    }
  }

  async function loadProfiles() {
    const result = await chrome.storage.local.get("profiles");
    profiles = result.profiles || [];
    renderProfileSelect();
  }

  function renderProfileSelect() {
    profileSelect.innerHTML = '<option value="">Select Profile</option>';
    profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent =
        profile.name +
        (profile.data.length > 0 ? ` (${profile.data.length} fields)` : "");
      profileSelect.appendChild(option);
    });
  }

  function openModal(title = "New Profile", existingName = "") {
    modalTitle.textContent = title;
    profileNameInput.value = existingName;
    modal.style.display = "block";
  }

  function hideModal() {
    modal.style.display = "none";
    editingProfileId = null;
    profileNameInput.value = "";
  }

  closeModal.addEventListener("click", hideModal);
  window.addEventListener("click", (e) => {
    if (e.target === modal) hideModal();
  });

  newBtn.addEventListener("click", () => {
    openModal("New Profile");
  });

  editBtn.addEventListener("click", () => {
    const selectedId = profileSelect.value;
    if (!selectedId) {
      alert("Please select a profile to edit");
      return;
    }
    const profile = profiles.find((p) => p.id === selectedId);
    if (profile) {
      editingProfileId = selectedId;
      openModal("Edit Profile", profile.name);
    }
  });

  delBtn.addEventListener("click", async () => {
    const selectedId = profileSelect.value;
    if (!selectedId) {
      alert("Please select a profile to delete");
      return;
    }
    if (confirm("Are you sure you want to delete this profile?")) {
      profiles = profiles.filter((p) => p.id !== selectedId);
      await chrome.storage.local.set({ profiles });
      await loadProfiles();
    }
  });

  saveProfileBtn.addEventListener("click", async () => {
    const name = profileNameInput.value.trim();
    if (!name) {
      alert("Please enter a profile name");
      return;
    }

    if (editingProfileId) {
      const index = profiles.findIndex((p) => p.id === editingProfileId);
      if (index !== -1) {
        profiles[index].name = name;
      }
    } else {
      profiles.push({
        id: Date.now().toString(),
        name,
        data: [],
      });
    }

    await chrome.storage.local.set({ profiles });
    await loadProfiles();
    hideModal();
  });

  startCaptureBtn.addEventListener("click", async () => {
    console.log("Start capture button clicked!");
    const selectedId = profileSelect.value;
    if (!selectedId) {
      alert("Please select or create a profile first");
      return;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) {
      alert("Please make sure you are on Meesho product page");
      return;
    }

    const injected = await ensureContentScriptInjected(tab.id);
    if (!injected) {
      alert(
        "Could not inject content script. Please refresh the page and try again.",
      );
      return;
    }

    try {
      console.log("Sending startCapture message to tab", tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "startCapture",
      });
      console.log("Response from startCapture:", response);
      if (response && response.success) {
        console.log("Disabling start, enabling stop");
        startCaptureBtn.disabled = true;
        startCaptureBtn.style.opacity = "0.5";
        stopCaptureBtn.disabled = false;
        stopCaptureBtn.style.opacity = "1";
        captureCountEl.textContent = "Fields captured: 0";
        alert(
          "✅ Capture started! You will see a STOP button on the page! Click fields to capture them!",
        );
      }
    } catch (e) {
      console.error("Error starting capture:", e);
      alert(
        "Error starting capture: " +
          e.message +
          ". Please refresh the page and try again.",
      );
    }
  });

  stopCaptureBtn.addEventListener("click", async () => {
    console.log("Stop capture button clicked!");
    const selectedId = profileSelect.value;
    if (!selectedId) return;

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return;

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "stopCapture",
      });
      if (response && response.success) {
        const index = profiles.findIndex((p) => p.id === selectedId);
        if (index !== -1) {
          profiles[index].data = response.data;
          await chrome.storage.local.set({ profiles });
          await chrome.storage.local.remove("tempCapturedData");
          alert(
            `✅ Captured ${response.data.length} fields for profile "${profiles[index].name}"!`,
          );
          await loadProfiles();
        }
        startCaptureBtn.disabled = false;
        startCaptureBtn.style.opacity = "1";
        stopCaptureBtn.disabled = true;
        stopCaptureBtn.style.opacity = "0.5";
      }
    } catch (e) {
      console.error("Error stopping capture:", e);
      alert("Error stopping capture");
    }
  });

  autofillBtn.addEventListener("click", async () => {
    const selectedId = profileSelect.value;
    if (!selectedId) {
      alert("Please select a profile first");
      return;
    }

    const profile = profiles.find((p) => p.id === selectedId);
    if (!profile || profile.data.length === 0) {
      alert("Profile has no data. Please capture data first.");
      return;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) {
      alert("Please make sure you are on Meesho product page");
      return;
    }

    const injected = await ensureContentScriptInjected(tab.id);
    if (!injected) {
      alert(
        "Could not inject content script. Please refresh the page and try again.",
      );
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "autofill",
        data: profile.data,
      });
      if (response.success) {
        const successCount = response.results.filter((r) => r.success).length;
        alert(
          `✅ Auto-filled ${successCount} out of ${response.results.length} fields!`,
        );
      } else {
        alert("Failed to auto-fill form");
      }
    } catch (e) {
      alert("Please make sure you are on Meesho product page");
    }
  });

  exportBtn.addEventListener("click", async () => {
    if (profiles.length === 0) {
      alert("No profiles to export");
      return;
    }
    const dataStr = JSON.stringify(profiles, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meesho-profiles.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  importBtn.addEventListener("click", () => {
    importFile.click();
  });

  importFile.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedProfiles = JSON.parse(event.target.result);
        if (Array.isArray(importedProfiles)) {
          profiles = [
            ...profiles,
            ...importedProfiles.filter(
              (p) => !profiles.some((existing) => existing.id === p.id),
            ),
          ];
          await chrome.storage.local.set({ profiles });
          await loadProfiles();
          alert("✅ Profiles imported successfully!");
        } else {
          alert("Invalid file format");
        }
      } catch (err) {
        alert("Failed to import profiles");
      }
    };
    reader.readAsText(file);
    importFile.value = "";
  });

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateCaptureCount") {
      captureCountEl.textContent = `Fields captured: ${request.count}`;
    } else if (request.action === "captureComplete") {
      console.log("Capture complete received in popup!");
      const selectedId = profileSelect.value;
      if (selectedId) {
        const index = profiles.findIndex((p) => p.id === selectedId);
        if (index !== -1) {
          profiles[index].data = request.data;
          chrome.storage.local.set({ profiles });
          chrome.storage.local.remove("tempCapturedData");
          loadProfiles();
          alert(
            `✅ Captured ${request.data.length} fields for profile "${profiles[index].name}"!`,
          );
        }
        startCaptureBtn.disabled = false;
        startCaptureBtn.style.opacity = "1";
        stopCaptureBtn.disabled = true;
        stopCaptureBtn.style.opacity = "0.5";

        // Remove save temp button if present
        if (saveTempBtn && saveTempBtn.parentNode) {
          saveTempBtn.parentNode.removeChild(saveTempBtn);
        }
      }
    }
  });
});
