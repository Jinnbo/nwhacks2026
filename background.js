// Background service worker for persistent Realtime subscriptions
// Uses importScripts (no ES modules) to load Supabase UMD build

importScripts('supabase.js', 'config.js');

// Supabase client instance
let supabaseClient = null;
let realtimeChannel = null;
let currentUserId = null;

// Alarm name for keeping service worker alive
const KEEPALIVE_ALARM = 'keepalive';
const KEEPALIVE_INTERVAL_MINUTES = 0.4; // ~24 seconds to stay under 30s limit

// Initialize Supabase client
function initSupabase() {
  if (!supabaseClient && typeof supabase !== 'undefined' && supabase.createClient) {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('[Background] Supabase client initialized');
    return true;
  }
  return supabaseClient !== null;
}

// Set up Realtime subscription for a user
function setupRealtimeSubscription(userId) {
  if (!initSupabase()) {
    console.error('[Background] Failed to initialize Supabase');
    return;
  }

  // Clean up existing subscription
  cleanupRealtimeSubscription();

  currentUserId = userId;
  console.log('[Background] Setting up Realtime subscription for user:', userId);

  // Create channel for stickers
  realtimeChannel = supabaseClient
    .channel(`stickers:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'stickers',
        filter: `recipient_id=eq.${userId}`
      },
      (payload) => {
        console.log('[Background] New sticker received:', payload);
        const sticker = payload.new;
        if (sticker && sticker.image_url) {
          const scary = sticker.scary || false;
          sendStickerToAllTabs(sticker.image_url, scary);
        }
      }
    )
    .subscribe((status) => {
      console.log('[Background] Realtime subscription status:', status);
      if (status === 'SUBSCRIBED') {
        console.log('[Background] Successfully subscribed to stickers');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('[Background] Error subscribing to stickers channel');
      }
    });

  // Start keepalive alarm
  startKeepaliveAlarm();
}

// Clean up Realtime subscription
function cleanupRealtimeSubscription() {
  if (realtimeChannel && supabaseClient) {
    console.log('[Background] Cleaning up Realtime subscription');
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  currentUserId = null;
  stopKeepaliveAlarm();
}

// Send sticker to all tabs via content scripts
function sendStickerToAllTabs(imageUrl, scary) {
  const scaryBool = scary || false;
  console.log('[Background] Sending sticker to all tabs:', imageUrl, 'scary:', scaryBool);

  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError) {
      console.error('[Background] Error querying tabs:', chrome.runtime.lastError);
      return;
    }

    console.log(`[Background] Found ${tabs.length} tabs`);

    tabs.forEach((tab) => {
      // Skip chrome:// and extension pages
      if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        console.log(`[Background] Sending message to tab ${tab.id} (${tab.url})`);

        chrome.tabs.sendMessage(
          tab.id,
          {
            type: 'SHOW_STICKER',
            imageUrl: imageUrl,
            scary: scaryBool
          },
          (response) => {
            if (chrome.runtime.lastError) {
              // Content script not loaded, inject it directly
              console.log(`[Background] Content script not loaded on tab ${tab.id}, injecting script`);
              injectStickerScript(tab.id, imageUrl, scaryBool);
            } else {
              console.log(`[Background] Sticker sent to tab ${tab.id}, response:`, response);
            }
          }
        );
      }
    });
  });
}

// Inject script directly to show sticker if content script isn't loaded
function injectStickerScript(tabId, imageUrl, scary) {
  const scaryBool = scary || false;
  const scaryAudioUrl = chrome.runtime.getURL('scary.mp3');
  
  const showStickerFunction = async (url, isScary, audioUrl) => {
    if (isScary) {
      // Check if this sticker has already been shown/closed in any tab
      try {
        const stored = await chrome.storage.local.get(['shownScaryStickers']);
        const shownStickers = stored.shownScaryStickers || {};
        if (shownStickers[url]) {
          console.log('Scary sticker already shown/closed, skipping:', url);
          return;
        }
      } catch (e) {
        console.log('Could not check shown stickers:', e);
      }

      // Call showJumpScare for scary stickers
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.innerHTML = `
          <img src="${url}" 
              alt="GIF" 
              style="width: 1000px; height: auto;">
          <button class="close-button" id="close-overlay">X</button>
      `;

      const audio = new Audio(audioUrl);
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
            if (shownStickers[url]) {
              console.log('Scary sticker already shown/closed in another tab, skipping:', url);
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
                    shownStickers[url] = true;
                    await chrome.storage.local.set({ shownScaryStickers: shownStickers });
                    console.log('Marked scary sticker as shown/closed:', url);
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
    } else {
      // Call addSticker for normal stickers
      const img = document.createElement("img");
      img.src = url;

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
      document.body.appendChild(img);

      const audio = new Audio(chrome.runtime.getURL('hit.wav')); 
      audio.volume = 1.0;
      audio.play().catch(err => console.log("Audio blocked:", err));

      // Start fade-out after 11 seconds
      setTimeout(() => {
        img.style.opacity = "0";
      }, 11000);

      // Remove sticker after 12 seconds
      setTimeout(() => {
        img.remove();
      }, 12000);
    }
  };

  chrome.scripting.executeScript(
    {
      target: { tabId: tabId },
      func: showStickerFunction,
      args: [imageUrl, scaryBool, scaryAudioUrl]
    },
    (results) => {
      if (chrome.runtime.lastError) {
        console.error(`[Background] Error injecting script into tab ${tabId}:`, chrome.runtime.lastError);
      } else {
        console.log(`[Background] Successfully injected sticker script into tab ${tabId}`);
      }
    }
  );
}

// Start keepalive alarm to prevent service worker termination
function startKeepaliveAlarm() {
  chrome.alarms.create(KEEPALIVE_ALARM, {
    periodInMinutes: KEEPALIVE_INTERVAL_MINUTES
  });
  console.log('[Background] Keepalive alarm started');
}

// Stop keepalive alarm
function stopKeepaliveAlarm() {
  chrome.alarms.clear(KEEPALIVE_ALARM);
  console.log('[Background] Keepalive alarm stopped');
}

// Handle alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    console.log('[Background] Keepalive alarm fired');
    
    // Check if we need to reconnect
    if (currentUserId && (!realtimeChannel || realtimeChannel.state !== 'joined')) {
      console.log('[Background] Reconnecting Realtime subscription...');
      setupRealtimeSubscription(currentUserId);
    }
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message);

  if (message.type === 'START_REALTIME') {
    const userId = message.userId;
    if (userId) {
      // Store user ID in storage for persistence
      chrome.storage.local.set({ realtimeUserId: userId }, () => {
        console.log('[Background] Stored user ID:', userId);
        setupRealtimeSubscription(userId);
        sendResponse({ success: true });
      });
      return true; // Keep channel open for async response
    } else {
      sendResponse({ success: false, error: 'No userId provided' });
    }
  } else if (message.type === 'STOP_REALTIME') {
    // Clear stored user ID
    chrome.storage.local.remove('realtimeUserId', () => {
      console.log('[Background] Cleared stored user ID');
      cleanupRealtimeSubscription();
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async response
  } else if (message.type === 'GET_REALTIME_STATUS') {
    sendResponse({
      isSubscribed: realtimeChannel !== null,
      userId: currentUserId
    });
  } else if (message.type === 'GET_API_KEY') {
    sendResponse({
      apikey: typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : ''
    });
  }

  return false;
});

// On service worker startup, check for existing user and reconnect
chrome.storage.local.get(['realtimeUserId'], (result) => {
  if (result.realtimeUserId) {
    console.log('[Background] Found stored user ID on startup:', result.realtimeUserId);
    setupRealtimeSubscription(result.realtimeUserId);
  } else {
    console.log('[Background] No stored user ID found on startup');
  }
});

console.log('[Background] Service worker initialized');
