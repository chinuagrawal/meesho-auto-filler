console.log("Meesho Autofill Tool: Content script loaded");

let isCapturing = false;
let capturedFields = [];
let pageOverlay = null;
let countDisplay = null;
let stopButton = null;
let toast = null;

class SelectorEngine {
  static getSelector(element) {
    if (!element) return null;

    if (element.id) {
      return `#${element.id}`;
    }

    const tag = element.tagName.toLowerCase();
    const classes = Array.from(element.classList)
      .map((c) => `.${c}`)
      .join("");

    if (element.name) {
      return `${tag}[name="${element.name}"]`;
    }

    if (element.placeholder) {
      return `${tag}[placeholder="${element.placeholder}"]`;
    }

    if (classes) {
      return `${tag}${classes}`;
    }

    return this.getPath(element);
  }

  static getPath(element) {
    if (!element) return "";
    const path = [];
    let current = element;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      }
      if (current.classList.length > 0) {
        selector += "." + Array.from(current.classList).join(".");
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(" > ");
  }

  static findLabelForInput(input) {
    if (!input) return null;

    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) return label.textContent.trim();
    }

    let parent = input.parentElement;
    let labelTexts = [];

    for (let i = 0; i < 3; i++) {
      if (!parent) break;

      const labels = parent.querySelectorAll("label");
      labels.forEach((l) => {
        const text = l.textContent.trim();
        if (text) labelTexts.push(text);
      });

      let sibling = input.previousElementSibling;
      const prevTexts = [];
      while (sibling) {
        if (
          sibling.tagName &&
          !["INPUT", "TEXTAREA", "SELECT"].includes(
            sibling.tagName.toUpperCase(),
          )
        ) {
          const text = sibling.textContent.trim();
          if (text) prevTexts.unshift(text);
        }
        sibling = sibling.previousElementSibling;
      }
      prevTexts.forEach((t) => labelTexts.push(t));

      parent = parent.parentElement;
    }

    labelTexts = [...new Set(labelTexts)];

    return labelTexts.find((t) => t.length > 0 && t.length < 100) || null;
  }
}

class FormFiller {
  static sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static addHighlight(element) {
    element.style.border = "3px solid #FFEB3B";
    element.style.boxShadow = "0 0 10px rgba(255, 235, 59, 0.5)";
    element.style.transition = "all 0.3s";
  }

  static removeHighlight(element) {
    element.style.border = "";
    element.style.boxShadow = "";
  }

  static triggerEvents(element, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )?.set;

    if (element.tagName.toLowerCase() === "input" && nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else if (
      element.tagName.toLowerCase() === "textarea" &&
      nativeTextAreaValueSetter
    ) {
      nativeTextAreaValueSetter.call(element, value);
    } else if (
      element.tagName.toLowerCase() === "select" &&
      nativeSelectValueSetter
    ) {
      nativeSelectValueSetter.call(element, value);
    } else {
      element.value = value;
    }

    const events = ["input", "change", "blur"];
    events.forEach((eventName) => {
      const event = new Event(eventName, { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
    });
  }

  static async triggerCustomSelect(element, value) {
    try {
      this.addHighlight(element);
      await this.sleep(200);

      // 1. Find the dropdown trigger (combobox wrapper)
      let dropdownTrigger = element;
      // If element is input, find parent combobox or div wrapper
      if (
        element.tagName.toLowerCase() === "input" ||
        element.getAttribute("role") !== "combobox"
      ) {
        let temp = element;
        for (let i = 0; i < 10; i++) {
          // go up 10 levels max
          if (!temp.parentElement) break;
          temp = temp.parentElement;
          if (
            temp.getAttribute("role") === "combobox" ||
            (temp.className &&
              (temp.className.includes("MuiInputBase-root") ||
                temp.className.includes("MuiFormControl-root")))
          ) {
            dropdownTrigger = temp;
            break;
          }
        }
      }

      // 2. Click the trigger to open menu
      dropdownTrigger.click();
      await this.sleep(300);

      // 3. Look for visible options
      const options = Array.from(
        document.querySelectorAll('[role="option"], li, .dropdown-item'),
      );

      // 4. Try to find exact match first
      const exactOption = options.find(
        (el) => el.textContent.trim().toLowerCase() === value.toLowerCase(),
      );

      if (exactOption) {
        this.addHighlight(exactOption);
        await this.sleep(150);
        exactOption.click();
      } else {
        // 5. Fallback: Type in search input
        const inputField = dropdownTrigger.querySelector("input");
        if (inputField) {
          // Use native setter
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          )?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(inputField, value);
          } else {
            inputField.value = value;
          }
          // Fire events for React
          inputField.dispatchEvent(new Event("input", { bubbles: true }));
          inputField.dispatchEvent(new Event("change", { bubbles: true }));
          await this.sleep(400);

          // 6. Re-search filtered options and click first
          const filteredOptions = Array.from(
            document.querySelectorAll('[role="option"], li'),
          );
          const firstResult = filteredOptions[0];
          if (firstResult) {
            this.addHighlight(firstResult);
            await this.sleep(150);
            firstResult.click();
          }
        }
      }

      await this.sleep(200);
      this.removeHighlight(element);
    } catch (e) {
      console.error("Error filling custom select:", e);
      this.removeHighlight(element);
    }
  }

  static async fillField(fieldData) {
    try {
      let element = document.querySelector(fieldData.selector);
      if (!element) {
        const allInputs = document.querySelectorAll(
          'input, textarea, select, [role="combobox"], div[class*="select"], div[class*="dropdown"], div[class*="Mui"]',
        );
        for (const el of allInputs) {
          const label = SelectorEngine.findLabelForInput(el);
          if (
            label &&
            label.toLowerCase().includes(fieldData.label.toLowerCase())
          ) {
            element = el;
            break;
          }
        }
      }

      if (!element) {
        console.warn("Element not found for:", fieldData.label);
        return false;
      }

      this.addHighlight(element);
      await this.sleep(200);

      if (element.tagName.toLowerCase() === "select") {
        const options = Array.from(element.options);
        const option = options.find(
          (o) =>
            o.text.toLowerCase().includes(fieldData.value.toLowerCase()) ||
            o.value.toLowerCase().includes(fieldData.value.toLowerCase()),
        );
        if (option) {
          element.value = option.value;
          element.selectedIndex = option.index;
          this.triggerEvents(element, option.value);
        }
      } else if (
        element.getAttribute("role") === "combobox" ||
        element.className.includes("select") ||
        element.className.includes("dropdown") ||
        element.className.includes("Mui") ||
        element.querySelector("input") !== null // if div contains input, treat as custom select
      ) {
        await this.triggerCustomSelect(element, fieldData.value);
      } else {
        this.triggerEvents(element, fieldData.value);
      }

      await this.sleep(200);
      this.removeHighlight(element);
      return true;
    } catch (error) {
      console.error("Error filling field:", fieldData.label, error);
      return false;
    }
  }

  static async fillForm(formData) {
    const results = [];
    for (const field of formData) {
      const success = await this.fillField(field);
      results.push({ label: field.label, success, value: field.value });
    }
    return results;
  }

  static getFieldValue(element) {
    let value = "";
    if (element.tagName.toLowerCase() === "select") {
      value = element.options[element.selectedIndex]?.text || element.value;
    } else if (element.getAttribute("role") === "combobox") {
      const input = element.querySelector("input");
      value = input?.value || element.textContent?.trim() || "";
    } else if (
      element.tagName.toLowerCase() === "div" &&
      (element.className.includes("select") ||
        element.className.includes("dropdown"))
    ) {
      const input = element.querySelector("input");
      value = input?.value || element.textContent?.trim() || "";
    } else {
      value = element.value || "";
    }
    return value;
  }

  static getFieldData(element) {
    let label = SelectorEngine.findLabelForInput(element);
    const placeholder = element.placeholder || "";
    const fieldName = element.name || element.id || "";
    const finalLabel = label || placeholder || fieldName;

    if (!finalLabel || finalLabel.length === 0) return null;

    const value = this.getFieldValue(element);

    return {
      label: finalLabel,
      value: value,
      selector: SelectorEngine.getSelector(element),
    };
  }
}

function isFormField(element) {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute("role");
  return (
    (tag === "input" &&
      !["hidden", "submit", "button"].includes(element.type)) ||
    tag === "textarea" ||
    tag === "select" ||
    role === "combobox" ||
    (tag === "div" &&
      (element.className.includes("select") ||
        element.className.includes("dropdown")))
  );
}

function getFieldElement(element) {
  if (isFormField(element)) return element;
  const parent = element.closest(
    'input, textarea, select, [role="combobox"], div[class*="select"], div[class*="dropdown"]',
  );
  return parent;
}

function createPageOverlay() {
  // Create main container
  pageOverlay = document.createElement("div");
  pageOverlay.id = "meesho-autofill-overlay";
  pageOverlay.style.cssText = `
    position: fixed !important;
    top: 20px !important;
    right: 20px !important;
    z-index: 2147483647 !important;
    background: #FFEB3B !important;
    border: 3px solid black !important;
    padding: 15px !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
    font-family: Arial, sans-serif !important;
    pointer-events: auto !important;
  `;

  // Title
  const title = document.createElement("div");
  title.style.cssText = `
    font-size: 16px !important;
    font-weight: bold !important;
    margin-bottom: 10px !important;
    color: black !important;
  `;
  title.textContent = "Meesho Autofill - Capturing...";
  pageOverlay.appendChild(title);

  // Count display
  countDisplay = document.createElement("div");
  countDisplay.id = "meesho-autofill-count";
  countDisplay.style.cssText = `
    font-size: 14px !important;
    font-weight: bold !important;
    margin-bottom: 10px !important;
    color: black !important;
  `;
  countDisplay.textContent = "Fields captured: 0";
  pageOverlay.appendChild(countDisplay);

  // Stop button
  stopButton = document.createElement("button");
  stopButton.id = "meesho-autofill-stop";
  stopButton.style.cssText = `
    width: 100% !important;
    padding: 10px !important;
    background: #f44336 !important;
    color: white !important;
    border: 2px solid black !important;
    font-size: 14px !important;
    font-weight: bold !important;
    cursor: pointer !important;
    border-radius: 4px !important;
    pointer-events: auto !important;
  `;
  stopButton.textContent = "■ STOP CAPTURE";
  stopButton.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("Stop button clicked!");
    stopCapture();
  };
  pageOverlay.appendChild(stopButton);

  document.body.appendChild(pageOverlay);
}

function removePageOverlay() {
  if (pageOverlay && pageOverlay.parentNode) {
    pageOverlay.parentNode.removeChild(pageOverlay);
  }
}

function showToast(message) {
  if (toast && toast.parentNode) {
    toast.parentNode.removeChild(toast);
  }
  toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed !important;
    bottom: 30px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    background: #4CAF50 !important;
    color: white !important;
    padding: 12px 24px !important;
    border-radius: 4px !important;
    font-family: Arial, sans-serif !important;
    font-size: 14px !important;
    font-weight: bold !important;
    z-index: 1000000 !important;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    if (toast && toast.parentNode) {
      toast.style.transition = "opacity 0.3s";
      toast.style.opacity = "0";
      setTimeout(() => {
        if (toast && toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }
  }, 2000);
}

let currentHoveredElement = null;

function handleMouseOver(event) {
  const fieldEl = getFieldElement(event.target);
  if (fieldEl) {
    if (currentHoveredElement && currentHoveredElement !== fieldEl) {
      currentHoveredElement.style.outline = "";
    }
    currentHoveredElement = fieldEl;
    currentHoveredElement.style.outline = "3px solid #FF5722";
  }
}

function handleMouseOut(event) {
  if (currentHoveredElement) {
    currentHoveredElement.style.outline = "";
    currentHoveredElement = null;
  }
}

function handleClick(event) {
  if (!isCapturing) return;

  // Check if click is on our own overlay elements - if so, don't interfere!
  const overlay = document.getElementById("meesho-autofill-overlay");
  if (overlay && overlay.contains(event.target)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const fieldEl = getFieldElement(event.target);
  if (fieldEl) {
    const fieldData = FormFiller.getFieldData(fieldEl);
    if (fieldData && fieldData.value) {
      // Check if field is already captured
      const alreadyExists = capturedFields.some(
        (f) => f.label === fieldData.label && f.selector === fieldData.selector,
      );
      if (!alreadyExists) {
        capturedFields.push(fieldData);

        // Visual feedback
        fieldEl.style.outline = "3px solid #4CAF50";

        // Update count display on page
        if (countDisplay) {
          countDisplay.textContent = `Fields captured: ${capturedFields.length}`;
        }

        // Show toast
        showToast(`✓ Captured: ${fieldData.label}`);

        // Send count to popup
        try {
          chrome.runtime.sendMessage({
            action: "updateCaptureCount",
            count: capturedFields.length,
          });
        } catch (e) {
          console.log("Popup not open");
        }
      } else {
        showToast(`Already captured: ${fieldData.label}`);
      }
    }
  }
}

function startCapture() {
  if (isCapturing) return;
  isCapturing = true;
  capturedFields = [];
  createPageOverlay();

  document.addEventListener("mouseover", handleMouseOver, true);
  document.addEventListener("mouseout", handleMouseOut, true);
  document.addEventListener("click", handleClick, true);
}

function stopCapture() {
  if (!isCapturing) return;
  isCapturing = false;

  console.log("Stop capture called! Captured fields:", capturedFields);

  removePageOverlay();
  document.removeEventListener("mouseover", handleMouseOver, true);
  document.removeEventListener("mouseout", handleMouseOut, true);
  document.removeEventListener("click", handleClick, true);

  if (currentHoveredElement) {
    currentHoveredElement.style.outline = "";
    currentHoveredElement = null;
  }

  // Remove all green outlines
  document
    .querySelectorAll('[style*="outline: 3px solid #4CAF50"]')
    .forEach((el) => {
      el.style.outline = "";
    });

  // Save to storage temporarily
  chrome.storage.local.set({ tempCapturedData: capturedFields }, () => {
    console.log("✅ Saved temp data to chrome.storage:", capturedFields);
  });

  // Send to popup
  try {
    chrome.runtime.sendMessage(
      {
        action: "captureComplete",
        data: capturedFields,
      },
      (response) => {
        console.log("Message sent, response from popup:", response);
      },
    );
  } catch (e) {
    console.log("Popup not open, but temp data is saved!");
  }

  showToast(
    `Capture complete! ${capturedFields.length} fields captured - please open extension to save!`,
  );

  // Show a direct alert
  if (capturedFields.length > 0) {
    alert(
      `✅ Successfully captured ${capturedFields.length} fields! Now open the extension popup to save them to your profile!`,
    );
  } else {
    alert("⚠️ No fields were captured!");
  }

  return capturedFields;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case "ping":
          sendResponse({ success: true });
          break;

        case "startCapture":
          startCapture();
          sendResponse({ success: true });
          break;

        case "stopCapture":
          const data = stopCapture();
          sendResponse({ success: true, data });
          break;

        case "autofill":
          const results = await FormFiller.fillForm(request.data);
          sendResponse({ success: true, results });
          break;

        default:
          sendResponse({ success: false, error: "Unknown action" });
      }
    } catch (error) {
      console.error("Error handling message:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});
