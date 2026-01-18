const showJumpScare = (gifPath, audioPath) => {
  const overlay = document.createElement('div');
  gifPath = chrome.runtime.getURL(gifPath);
  overlay.innerHTML = `
    <div class="overlay">
      <img src="https://xrvicqszlafncvfmqydp.supabase.co/storage/v1/object/public/sticker/fnaf-gif.gif" 
          alt="GIF" 
          style="width: 1000px; height: auto;">
      <button class="close-button" id="close-overlay">X</button>
    </div>
  `;

  const audio = new Audio(chrome.runtime.getURL(audioPath));
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

// showJumpScare("gifs/fnaf-gif.gif", "audio/fnaf-sound.mp3");

const addSticker = (stickerURL) => {
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

  img.style.zIndex = "2147483647";
  img.style.pointerEvents = "none";
  img.style.userSelect = "none";

  // Random rotation between -30 and +30 degrees
  const rotation = Math.random() * 60 - 30;
  img.style.transform = `rotate(${rotation}deg)`;

  // Add smooth opacity transition for fade-out
  img.style.transition = "opacity 1s";
  img.alt = "sticker";
  document.body.appendChild(img);

  // Start fade-out after 19 seconds
  setTimeout(() => {
    img.style.opacity = "0"; // fade out over 1 second
  }, 19000);

  // Remove sticker after 20 seconds
  setTimeout(() => {
    img.remove();
  }, 20000);
};

for (let i = 0; i < 80; i++) {
  addSticker("https://images.freeimages.com/image/previews/80a/panda-boy-anime-hood-png-5693574.png?fmt=webp&h=350");
}
