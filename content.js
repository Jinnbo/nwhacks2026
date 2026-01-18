const showJumpScare = async (gifURL, audioURL) => {
  // Check if this sticker has already been shown/closed in any tab
  try {
    const stored = await chrome.storage.local.get(['shownScaryStickers']);
    const shownStickers = stored.shownScaryStickers || {};
    if (shownStickers[gifURL]) {
      console.log('Scary sticker already shown/closed, skipping:', gifURL);
      return;
    }
  } catch (e) {
    console.log('Could not check shown stickers:', e);
  }

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
      <img src="${gifURL}" 
          alt="GIF" 
          style="width: 1000px; height: auto;">
      <button class="close-button" id="close-overlay">X</button>
  `;

  const audio = new Audio(audioURL);
  audio.loop = true;
  audio.volume = 1.0;

  let overlayDisplayed = false;
  const eventListeners = [];

  async function triggerOverlay() {
      if (overlayDisplayed) return;
      
      // Double-check storage in case sticker was closed in another tab
      try {
        const stored = await chrome.storage.local.get(['shownScaryStickers']);
        const shownStickers = stored.shownScaryStickers || {};
        if (shownStickers[gifURL]) {
          console.log('Scary sticker already shown/closed in another tab, skipping:', gifURL);
          // Remove listeners since we're not showing
          eventListeners.forEach(({ event, handler }) => {
              document.removeEventListener(event, handler);
          });
          eventListeners.length = 0;
          return;
        }
      } catch (e) {
        console.log('Could not check shown stickers in triggerOverlay:', e);
      }
      
      overlayDisplayed = true;
      audio.play().catch(err => console.log("Audio blocked:", err));

      if (!document.body.contains(overlay)) {
          document.body.appendChild(overlay);

          // Close button
          const closeButton = overlay.querySelector("#close-overlay");
          closeButton.addEventListener("click", async () => {
              audio.pause();
              audio.currentTime = 0;
              overlay.remove();
              
              // Mark this sticker as shown/closed in storage (shared across tabs)
              try {
                const stored = await chrome.storage.local.get(['shownScaryStickers']);
                const shownStickers = stored.shownScaryStickers || {};
                shownStickers[gifURL] = true;
                await chrome.storage.local.set({ shownScaryStickers: shownStickers });
                console.log('Marked scary sticker as shown/closed:', gifURL);
              } catch (e) {
                console.log('Could not save shown sticker:', e);
              }
              
              // Remove all event listeners
              eventListeners.forEach(({ event, handler }) => {
                  document.removeEventListener(event, handler);
              });
              eventListeners.length = 0;
          });
      }
  }

  // List of interactions to listen for
  const events = ["click", "keydown", "touchstart", "touchmove"];

  // Attach listeners, all will fire the same function once
  events.forEach(evt => {
      document.addEventListener(evt, triggerOverlay, { once: true });
      // Store reference for cleanup
      eventListeners.push({ event: evt, handler: triggerOverlay });
  });
}

const addSticker = (stickerURL) => {
  const audio = new Audio(chrome.runtime.getURL('hit.wav')); 
  audio.volume = 1.0;
  audio.play().catch(err => console.log("Audio blocked:", err));

  // Preload image to get natural dimensions
  const tempImg = new Image();
  tempImg.src = stickerURL;

  tempImg.onload = () => {
    let width = tempImg.naturalWidth;
    let height = tempImg.naturalHeight;

    const maxHeight = 100;
    if (height > maxHeight) {
      const scale = maxHeight / height;
      height = maxHeight;
      width = width * scale;
    }

    const img = document.createElement("img");
    img.src = stickerURL;
    img.alt = "sticker";
    img.style.height = `${height}px`;
    img.style.width = `${width}px`;
    img.style.position = "fixed";
    img.style.zIndex = "2147483640";
    img.style.pointerEvents = "none";
    img.style.userSelect = "none";
    img.style.transition = "opacity 1s";

    // Random rotation
    const rotation = Math.random() * 60 - 30;
    img.style.transform = `rotate(${rotation}deg)`;

    // Random position
    const maxX = window.innerWidth - width;
    const maxY = window.innerHeight - height;
    img.style.left = `${Math.random() * maxX}px`;
    img.style.top = `${Math.random() * maxY}px`;

    document.body.appendChild(img);

    setTimeout(() => { img.style.opacity = "0"; }, 11000);
    setTimeout(() => { img.remove(); }, 12000);
  };

  tempImg.onerror = (e) => {
    console.error('Image failed to load:', stickerURL, e);
  };
};


// Listen for messages from popup/background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);
  if (message.type === 'SHOW_STICKER' && message.imageUrl) {
    const scary = message.scary || false;
    const scaryAudioUrl = chrome.runtime.getURL('scary.mp3');
    
    try {
      if (scary) {
        console.log('Received scary sticker message, calling showJumpScare with:', message.imageUrl);
        showJumpScare(message.imageUrl, scaryAudioUrl);
        console.log('showJumpScare called successfully');
      } else {
        console.log('Received sticker message, calling addSticker with:', message.imageUrl);
        addSticker(message.imageUrl);
        console.log('addSticker called successfully');
      }
      sendResponse({ success: true });
    } catch (error) {
      console.error('Error calling sticker function:', error);
      sendResponse({ success: false, error: error.message });
    }
  } else {
    console.log('Message type or imageUrl missing:', { type: message.type, imageUrl: message.imageUrl });
  }
  return true; // Keep the message channel open for async response
});

// for (let i = 0; i < 80; i++) {
//   setTimeout(() => {
//     addSticker("https://images.freeimages.com/image/previews/80a/panda-boy-anime-hood-png-5693574.png?fmt=webp&h=350");
//   }, i * 1000);
// }
// showJumpScare("https://xrvicqszlafncvfmqydp.supabase.co/storage/v1/object/public/sticker/fnaf-gif.gif", "https://www.myinstants.com/en/instant/fnaf-jumpscare-scream/?utm_source=copy&utm_medium=share");

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'toggleOverlay') {
    console.log("Content js got the toggle overlay action!");
    showUploadOverlay();
  }
});

const showUploadOverlay = () => {
  // Remove generate overlay if it exists
  const existingGenerate = document.querySelector('.generate-modal');
  if (existingGenerate) existingGenerate.remove();

  // Check if upload overlay exists
  let existing = document.querySelector('.upload-modal');
  if (existing) {
    existing.remove(); // toggle
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'upload-modal';
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>Add Sticker</h2>
        <button class="btn close-modal">X</button>
      </div>

      <img id="stickerPreview" src="" alt="Preview" style="max-width: 100%; max-height: 200px; max-width: 200px; display: none; border: 1px solid #ccc; border-radius: 4px; margin: auto;">

      <label for="stickerUpload" class="btn">Choose File</label>
      <input type="file" id="stickerUpload" style="display: none;" accept=".png, .jpg, .jpeg, .gif">
      
      <div class="modal-actions">
        <button class="btn switch-upload-button">Generate</button>
        <button class="btn btn-secondary confirm-btn">Confirm</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.switch-upload-button').addEventListener('click', () => showGenerateOverlay());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const input = document.getElementById('stickerUpload');
  const preview = document.getElementById('stickerPreview');

  input.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;   // set image src
        preview.style.display = 'block'; // make it visible
      };
      reader.readAsDataURL(file);
    } else {
      preview.src = '';
      preview.style.display = 'none';
    }
  });

  const confirmButton = overlay.querySelector('.confirm-btn');
  confirmButton.addEventListener('click', async () => {
    const file = input.files[0];
    if (!file) {
      alert('Please select a file first.');
      return;
    }

    try {
      // Create FormData with file and sticker flag
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sticker', 'true');

      // Make POST request to edge function
      const response = await fetch('https://xrvicqszlafncvfmqydp.supabase.co/functions/v1/smooth-function', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Upload failed with status ${response.status}`);
      }

      const asset = await response.json();
      console.log('Upload successful:', asset);
      
      // Close modal on success
      overlay.remove();
    } catch (error) {
      console.error('Error uploading file:', error);
      // Keep modal open on error for user to retry
    }
  });
};

const showGenerateOverlay = () => {
  // Remove upload overlay if it exists
  const existingUpload = document.querySelector('.upload-modal');
  if (existingUpload) existingUpload.remove();

  // Check if generate overlay exists
  let existing = document.querySelector('.generate-modal');
  if (existing) {
    existing.remove(); // toggle
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'generate-modal';
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>Add Sticker</h2>
        <button class="close-modal">X</button>
      </div>

      <p>Describe the sticker you want to generate:</p>

      <img id="stickerPreview" src="" alt="Preview" style="max-width: 100%; max-height: 200px; max-width: 200px; display: none; border: 1px solid #ccc; border-radius: 4px; margin: auto;">
      <textarea class="sticker-prompt-input" rows="4" cols="50" placeholder="E.g., A cartoon beaver standing in front of Jupiter"></textarea>

      <div id="generate-status" style="display: none; padding: 8px; border-radius: 4px; margin: 8px 0;"></div>

      <div class="modal-actions">
        <button class="btn switch-upload-button">Upload</button>
        <button class="btn-secondary confirm-button">Generate</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.switch-upload-button').addEventListener('click', () => showUploadOverlay());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const confirmButton = overlay.querySelector('.confirm-button');
  const statusDiv = overlay.querySelector('#generate-status');
  const textarea = overlay.querySelector('.sticker-prompt-input');

  confirmButton.addEventListener('click', async () => {
    const prompt = textarea.value.trim();

    if (!prompt) {
      alert('Please enter a prompt first.');
      return;
    }

    // Show loading state
    confirmButton.disabled = true;
    confirmButton.textContent = 'Generating...';
    statusDiv.style.display = 'block';
    statusDiv.style.background = '#e3f2fd';
    statusDiv.style.color = '#1976d2';
    statusDiv.textContent = 'Generating sticker...';
    textarea.disabled = true;

    try {
      // Get SUPABASE_ANON_KEY from background script
      let apikey = '';
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_API_KEY' });
        if (response && response.apikey) {
          apikey = response.apikey;
        }
      } catch (e) {
        console.log('Could not get API key from background script:', e);
        // Fallback: try global scope
        if (typeof SUPABASE_ANON_KEY !== 'undefined') {
          apikey = SUPABASE_ANON_KEY;
        }
      }

      // Call the edge function
      const headers = {
        'Content-Type': 'application/json'
      };
      if (apikey) {
        headers['apikey'] = apikey;
      }

      const response = await fetch('https://xrvicqszlafncvfmqydp.supabase.co/functions/v1/generate-sticker-via-prompt', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ prompt })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Generation failed with status ${response.status}`);
      }

      const asset = await response.json();
      console.log('Sticker generated successfully:', asset);

      // Show success message
      statusDiv.style.background = '#e8f5e9';
      statusDiv.style.color = '#2e7d32';
      statusDiv.textContent = 'Created successfully!';

      // Close modal after brief delay
      setTimeout(() => {
        overlay.remove();
      }, 1500);

    } catch (error) {
      console.error('Error generating sticker:', error);
      
      // Show error message
      statusDiv.style.background = '#ffebee';
      statusDiv.style.color = '#c62828';
      statusDiv.textContent = `Error: ${error.message}`;

      // Re-enable button and textarea for retry
      confirmButton.disabled = false;
      confirmButton.textContent = 'Generate';
      textarea.disabled = false;
    }
  });
};
