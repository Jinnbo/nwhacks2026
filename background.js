// Background service worker for persistent Realtime subscriptions
// Uses importScripts (no ES modules) to load Supabase UMD build

importScripts('supabase.js', 'config-umd.js');

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
          sendStickerToAllTabs(sticker.image_url);
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
function sendStickerToAllTabs(imageUrl) {
  console.log('[Background] Sending sticker to all tabs:', imageUrl);

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
            imageUrl: imageUrl
          },
          (response) => {
            if (chrome.runtime.lastError) {
              // Content script not loaded, inject it directly
              console.log(`[Background] Content script not loaded on tab ${tab.id}, injecting script`);
              injectStickerScript(tab.id, imageUrl);
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
function injectStickerScript(tabId, imageUrl) {
  const addStickerFunction = (url) => {
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

    // Start fade-out after 11 seconds
    setTimeout(() => {
      img.style.opacity = "0";
    }, 11000);

    // Remove sticker after 12 seconds
    setTimeout(() => {
      img.remove();
    }, 12000);
  };

  chrome.scripting.executeScript(
    {
      target: { tabId: tabId },
      func: addStickerFunction,
      args: [imageUrl]
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
