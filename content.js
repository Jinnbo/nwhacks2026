const showJumpScare = (gifURL, audioURL) => {
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

  function triggerOverlay() {
      if (overlayDisplayed) return;
      overlayDisplayed = true;
      audio.play().catch(err => console.log("Audio blocked:", err));

      if (!document.body.contains(overlay)) {
          document.body.appendChild(overlay);

          // Close button
          const closeButton = overlay.querySelector("#close-overlay");
          closeButton.addEventListener("click", () => {
              audio.pause();
              audio.currentTime = 0;
              overlay.remove();
          });
      }
  }

  // List of interactions to listen for
  const events = ["click", "keydown", "touchstart", "touchmove"];

  // Attach listeners, all will fire the same function once
  events.forEach(evt => {
      document.addEventListener(evt, triggerOverlay, { once: true });
  });
}

const addSticker = (stickerURL) => {
  console.log('addSticker called with URL:', stickerURL);
  console.log('document.body exists:', !!document.body);
  console.log('window.innerWidth:', window.innerWidth, 'window.innerHeight:', window.innerHeight);
  
  const img = document.createElement("img");
  img.src = stickerURL;

  const size = 100; // px

  // Random position
  const maxX = window.innerWidth - size;
  const maxY = window.innerHeight - size;

  img.style.position = "fixed";
  img.style.left = `${Math.random() * maxX}px`;
  img.style.top = `${Math.random() * maxY}px`;

  img.style.width = `${size}px`;
  img.style.height = `${size}px`;

  img.style.zIndex = "2147483640";
  img.style.pointerEvents = "none";
  img.style.userSelect = "none";

  // Random rotation between -30 and +30 degrees
  const rotation = Math.random() * 60 - 30;
  img.style.transform = `rotate(${rotation}deg)`;

  // Add smooth opacity transition for fade-out
  img.style.transition = "opacity 1s";
  img.alt = "sticker";
  
  // Add error handler to see if image fails to load
  img.onerror = (e) => {
    console.error('Image failed to load:', stickerURL, e);
  };
  
  img.onload = () => {
    console.log('Image loaded successfully:', stickerURL);
  };
  
  document.body.appendChild(img);

  const audio = new Audio(chrome.runtime.getURL('hit.wav')); 
  audio.volume = 1.0;
  audio.play().catch(err => console.log("Audio blocked:", err));

  // Start fade-out after 11 seconds
  setTimeout(() => {
    img.style.opacity = "0"; // fade out over 1 second
  }, 11000);

  // Remove sticker after 12 seconds
  setTimeout(() => {
    img.remove();
  }, 12000);
};

// Listen for messages from popup/background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);
  if (message.type === 'SHOW_STICKER' && message.imageUrl) {
    console.log('Received sticker message, calling addSticker with:', message.imageUrl);
    try {
      addSticker(message.imageUrl);
      console.log('addSticker called successfully');
      sendResponse({ success: true });
    } catch (error) {
      console.error('Error calling addSticker:', error);
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