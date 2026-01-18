// Wait for Supabase to be available (loaded via script tag in HTML)
// Config is loaded via script tag in HTML, so SUPABASE_URL and SUPABASE_ANON_KEY are globals
// The UMD build exposes 'supabase' as a global with createClient
let supabase;
function initSupabase() {
  if (typeof window.supabase !== "undefined" && window.supabase.createClient) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
  }
  return false;
}

// Wait for Supabase to load
if (!initSupabase()) {
  // Poll for supabase to be available
  const checkSupabase = setInterval(() => {
    if (initSupabase()) {
      clearInterval(checkSupabase);
      initializeApp();
    }
  }, 10);

  // Fallback timeout
  setTimeout(() => {
    clearInterval(checkSupabase);
    if (!supabase) {
      console.error("Failed to load Supabase library");
      alert("Failed to load Supabase library. Please refresh the extension.");
    }
  }, 5000);
} else {
  initializeApp();
}

// Initialize the app after Supabase is ready
function initializeApp() {
  // Get DOM elements
  const loginContainer = document.getElementById("loginContainer");
  const loggedInContainer = document.getElementById("loggedInContainer");
  const loginBtn = document.getElementById("loginBtn");
  const userInfo = document.getElementById("userInfo");
  const usersList = document.getElementById("usersList");
  const usersListLoading = document.getElementById("usersListLoading");
  const usersSelect = document.getElementById("usersSelect");
  const usersTrigger = document.getElementById("usersSelected");
  const sendStickerBtn = document.getElementById("sendStickerBtn");
  const stickerBanner = document.getElementById("stickerBanner");
  const stickersGallery = document.getElementById("stickersGallery");
  const stickerPreview = document.getElementById("stickerPreview");
  let selectedStickerUrl = null;
  let selectedStickerScary = null;
  let selectedRecipientId = null;
  let selectedRecipientName = null;
  const SCARY_COOLDOWN_MS = 60 * 1000; // 60s cooldown per recipient

  // Cooldown helpers for scary stickers (per-recipient)
  function getLastScarySent(recipientId) {
    try {
      const v = localStorage.getItem(`lastScarySent_${recipientId}`);
      return v ? parseInt(v, 10) : 0;
    } catch (e) {
      return 0;
    }
  }

  function setLastScarySent(recipientId, ts) {
    try {
      localStorage.setItem(`lastScarySent_${recipientId}`, String(ts));
    } catch (e) {
      // ignore
    }
  }

  function canSendScary(recipientId) {
    const last = getLastScarySent(recipientId) || 0;
    const now = Date.now();
    const diff = now - last;
    if (diff >= SCARY_COOLDOWN_MS) return { ok: true };
    return { ok: false, remainingMs: SCARY_COOLDOWN_MS - diff };
  }

  // Track Realtime channel subscription
  let realtimeChannel = null;

  // Show login UI
  function showLoginState() {
    loginContainer.style.display = "flex";
    loggedInContainer.style.display = "none";
  }

  // Show logged in UI
  function showLoggedInState(user) {
    loginContainer.style.display = "none";
    loggedInContainer.style.display = "flex";

    // if (user.email) {
    //   userInfo.textContent = `Logged in as: ${user.email}`;
    // } else {
    //   userInfo.textContent = "Logged in";
    // }

    // Fetch and display users list
    fetchAllUsers(user.id);
    // Fetch stickers from storage and render gallery
    fetchStickersFromStorage();

    // Set up Realtime subscription for stickers
    setupRealtimeSubscription(user.id);
  }

  // Check authentication state on load
  async function checkAuthState() {
    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error("Error getting session:", error);
        showLoginState();
        return;
      }

      if (session) {
        showLoggedInState(session.user);
      } else {
        showLoginState();
      }
    } catch (error) {
      console.error("Error checking auth state:", error);
      showLoginState();
    }
  }

  // Login with Google using Chrome identity API
  async function loginWithGoogle() {
    try {
      // Get the redirect URL for Chrome extension
      const redirectUrl = chrome.identity.getRedirectURL();
      console.log("Redirect URL:", redirectUrl);
      console.log(
        "Make sure this URL is added to Supabase redirect URLs:",
        redirectUrl,
      );

      // Get the OAuth URL from Supabase with skipBrowserRedirect
      // This tells Supabase not to redirect in the browser, we'll handle it with Chrome identity API
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        console.error("Error initiating OAuth:", error);
        alert("Failed to start login: " + error.message);
        return;
      }

      if (!data.url) {
        console.error("No OAuth URL returned");
        alert("Failed to get OAuth URL from Supabase");
        return;
      }

      console.log("Launching OAuth flow with URL:", data.url);

      // Use Chrome identity API to launch OAuth flow
      chrome.identity.launchWebAuthFlow(
        {
          url: data.url,
          interactive: true,
        },
        async (callbackUrl) => {
          if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError;
            const errorMessage =
              error.message || error.toString() || "Unknown error";
            console.error("OAuth flow error:", error);
            console.error("Error message:", errorMessage);
            console.error("Full error object:", JSON.stringify(error, null, 2));

            // Don't show alert if user cancelled
            const isCancelled =
              errorMessage.toLowerCase().includes("canceled") ||
              errorMessage.toLowerCase().includes("user_cancel") ||
              errorMessage.toLowerCase().includes("access_denied");

            if (!isCancelled) {
              alert(
                "Login failed: " +
                  errorMessage +
                  "\n\nMake sure you have configured the redirect URL in Supabase:\n" +
                  redirectUrl,
              );
            }
            return;
          }

          if (!callbackUrl) {
            console.error("No callback URL received");
            return;
          }

          console.log("Callback URL received:", callbackUrl);

          // Parse the callback URL to extract tokens
          try {
            const url = new URL(callbackUrl);

            // Check for tokens in hash (implicit flow)
            if (url.hash) {
              const hash = url.hash.substring(1);
              const params = new URLSearchParams(hash);
              const access_token = params.get("access_token");
              const refresh_token = params.get("refresh_token");

              if (access_token && refresh_token) {
                // Set the session
                const {
                  data: { session },
                  error: sessionError,
                } = await supabase.auth.setSession({
                  access_token,
                  refresh_token,
                });

                if (sessionError) {
                  console.error("Error setting session:", sessionError);
                  alert("Failed to complete login: " + sessionError.message);
                  return;
                }

                if (session) {
                  console.log("Login successful!", session.user);
                  showLoggedInState(session.user);
                }
                return;
              }
            }

            // Check for code in query params (PKCE flow)
            const code = url.searchParams.get("code");
            if (code) {
              // Use getSessionFromUrl to handle PKCE flow
              const {
                data: { session },
                error: sessionError,
              } = await supabase.auth.getSessionFromUrl(callbackUrl);

              if (sessionError) {
                console.error("Error getting session from URL:", sessionError);
                alert("Failed to complete login: " + sessionError.message);
                return;
              }

              if (session) {
                console.log("Login successful!", session.user);
                showLoggedInState(session.user);
              }
              return;
            }

            // Try getSessionFromUrl as fallback
            const {
              data: { session },
              error: sessionError,
            } = await supabase.auth.getSessionFromUrl(callbackUrl);

            if (sessionError) {
              console.error("Error getting session from URL:", sessionError);
              // Check if we already have a session (might have been set automatically)
              const {
                data: { session: existingSession },
              } = await supabase.auth.getSession();
              if (existingSession) {
                console.log("Found existing session after OAuth");
                showLoggedInState(existingSession.user);
              } else {
                alert("Failed to complete login. Please try again.");
              }
              return;
            }

            if (session) {
              console.log("Login successful!", session.user);
              showLoggedInState(session.user);
            }
          } catch (parseError) {
            console.error("Error parsing callback URL:", parseError);
            alert("Failed to parse OAuth callback. Please try again.");
          }
        },
      );
    } catch (error) {
      console.error("Login error:", error);
      alert("Login failed: " + error.message);
    }
  }

  // Logout function
  async function logout() {
    try {
      // Clean up Realtime subscription
      cleanupRealtimeSubscription();

      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("Logout error:", error);
        alert("Failed to logout: " + error.message);
      } else {
        showLoginState();
        // Clear users list
        usersList.innerHTML = "";
        // Hide banner
        hideStickerBanner();
      }
    } catch (error) {
      console.error("Logout error:", error);
      showLoginState();
      usersList.innerHTML = "";
      hideStickerBanner();
    }
  }

  // Fetch all users from Supabase
  async function fetchAllUsers(currentUserId) {
    try {
      // Show loading state
      usersListLoading.classList.add("show");
      usersList.classList.add("empty");

      // Query the user_list view
      const { data, error } = await supabase
        .from("user_list")
        .select("id, display_name, email")
        .order("display_name", { ascending: true, nullsFirst: false });

      if (error) {
        console.error("Error fetching users:", error);
        usersList.innerHTML = '<div class="loading">Error loading users</div>';
        usersListLoading.classList.remove("show");
        return;
      }

      // Show all users including current user (for testing)
      renderUsersList(data);

      usersListLoading.classList.remove("show");
    } catch (error) {
      console.error("Error fetching users:", error);
      usersList.innerHTML = '<div class="loading">Error loading users</div>';
      usersListLoading.classList.remove("show");
    }
  }

  // Fetch assets from the `assets` table (schema: id, created_at, image_url, sticker, scary)
  // We'll load only rows where `sticker` is true. `image_url` is expected to contain the public URL.
  async function fetchStickersFromStorage() {
    if (!stickersGallery) return;
    stickersGallery.innerHTML =
      '<div class="loading">Loading stickers...</div>';

    try {
      // Select relevant columns and fetch rows where sticker OR scary is true
      // This allows us to render a stickers row and a scary row separately.
      const { data: rows, error } = await supabase
        .from("assets")
        .select("id, created_at, image_url, sticker, scary")
        .or("sticker.eq.true,scary.eq.true")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error querying assets table:", error);
        stickersGallery.innerHTML =
          '<div class="loading">Failed to load stickers</div>';
        return;
      }

      if (!rows || rows.length === 0) {
        stickersGallery.innerHTML =
          '<div class="loading">No stickers found</div>';
        return;
      }

      // Render two rows: normal stickers (not scary) and scary stickers
      stickersGallery.innerHTML = "";

      // Partition into stickers and scary. Items that are both will appear in both lists.
      const normal = rows.filter((r) => r.sticker && r.image_url);
      const scary = rows.filter((r) => r.scary && r.image_url);

      console.debug(
        "assets fetched:",
        rows.length,
        "stickers:",
        normal.length,
        "scary:",
        scary.length,
      );

      // Render one unified scrolling gallery containing two labeled sections:
      // first 'Stickers' (normal), then 'Scary' (scary). The outer container
      // (`#stickersGallery`) handles scrolling so inner rows should not.
      stickersGallery.innerHTML = "";

      function renderSection(titleText, items) {
        const section = document.createElement("div");
        section.style.marginBottom = "8px";

        const title = document.createElement("div");
        title.textContent = titleText;
        title.style.fontWeight = "600";
        title.style.marginBottom = "6px";
        section.appendChild(title);

        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "8px";
        row.style.flexWrap = "wrap";

        if (!items || items.length === 0) {
          const none = document.createElement("div");
          none.className = "loading";
          none.textContent = "No items";
          row.appendChild(none);
        } else {
          items.forEach((r) => {
            const url = r.image_url;
            const fname = r.id || (r.created_at ? new Date(r.created_at).toISOString() : url.split("/").pop());

            const thumb = document.createElement("img");
            thumb.src = url;
            thumb.alt = `sticker-${fname}`;
            // use CSS class for sizing/hover/selected styles
            thumb.className = "sticker-thumb";
            // keep title for accessibility
            thumb.title = `${r.scary ? "🔥 Scary sticker" : "Sticker"} • ${r.created_at || ""}`;

            // mark scary stickers with a modifier class
            if (r.scary) thumb.classList.add("sticker-scary");

            thumb.addEventListener("error", () => {
              thumb.style.opacity = "0.4";
              thumb.title = "Failed to load sticker";
            });

            thumb.addEventListener("click", () => {
              selectedStickerUrl = url;
              selectedStickerScary = r.scary || false;
              // clear selection across gallery (use class-based selection)
              stickersGallery.querySelectorAll("img.sticker-thumb").forEach((img) => img.classList.remove("selected"));
              thumb.classList.add("selected");
            });

            row.appendChild(thumb);
          });
        }

        section.appendChild(row);
        return section;
      }

      // stickers (normal) first, then scary
      stickersGallery.appendChild(renderSection(`Sticker (${normal.length})`, normal));
      stickersGallery.appendChild(renderSection(`Scary (${scary.length})`, scary));
    } catch (err) {
      console.error("Unexpected error fetching assets from table:", err);
      stickersGallery.innerHTML =
        '<div class="loading">Error loading stickers</div>';
    }
  }

  // Render users list
  function renderUsersList(users) {
    if (!users || users.length === 0) {
      // Populate select with a disabled placeholder
      if (usersSelect) {
        usersSelect.innerHTML =
          '<option value="">No other users found</option>';
        usersSelect.disabled = true;
      }
      usersList.innerHTML = '<div class="loading">No other users found</div>';
      usersList.classList.remove("empty");
      return;
    }

    // Populate dropdown select
    if (usersSelect) {
      usersSelect.innerHTML = "";
      usersSelect.disabled = false;
      users.forEach((user) => {
        const displayName = user.display_name || user.email || "Unknown User";
        const option = document.createElement("option");
        option.value = user.id;
        option.textContent = displayName;
        usersSelect.appendChild(option);
      });
    }

    // Keep the original list for compatibility but hide it
    usersList.innerHTML = "";
    usersList.classList.remove("empty");

    users.forEach((user) => {
      const userItem = document.createElement("div");
      userItem.className = "user-item";

      // Use display_name if available, otherwise fallback to email
      const displayName = user.display_name || user.email || "Unknown User";
      userItem.textContent = displayName;
      // store id for selection
      userItem.dataset.id = user.id;

      // On click: select user but do NOT auto-send
      userItem.addEventListener("click", () => {
        selectedRecipientId = user.id;
        selectedRecipientName = displayName;

        // If native select exists, update its value to reflect selection
        if (usersSelect) {
          usersSelect.value = user.id;
        }

        // Update the custom trigger text if present
        if (usersTrigger) {
          usersTrigger.textContent = displayName + " ▾";
        }

        // hide list
        if (usersList) usersList.style.display = "none";

        // visual selected state
        usersList.querySelectorAll(".user-item").forEach((el) => el.classList.remove("selected"));
        userItem.classList.add("selected");
      });

      usersList.appendChild(userItem);
    });
  }

  // Set up Realtime subscription via background service worker
  function setupRealtimeSubscription(userId) {
    console.log(
      "Notifying background to start Realtime subscription for user:",
      userId,
    );

    // Send message to background service worker to start Realtime subscription
    chrome.runtime.sendMessage(
      {
        type: "START_REALTIME",
        userId: userId,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error sending START_REALTIME to background:",
            chrome.runtime.lastError,
          );
        } else {
          console.log("Background START_REALTIME response:", response);
        }
      },
    );
  }

  // Clean up Realtime subscription via background service worker
  function cleanupRealtimeSubscription() {
    console.log("Notifying background to stop Realtime subscription");

    // Send message to background service worker to stop Realtime subscription
    chrome.runtime.sendMessage(
      {
        type: "STOP_REALTIME",
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error sending STOP_REALTIME to background:",
            chrome.runtime.lastError,
          );
        } else {
          console.log("Background STOP_REALTIME response:", response);
        }
      },
    );
  }

  // Show sticker banner
  function showStickerBanner(sticker) {
    if (!stickerBanner) return;

    // Get sender info if available (we'll fetch it)
    const bannerContent = document.createElement("div");
    bannerContent.className = "sticker-banner-content";

    const message = document.createElement("div");
    message.className = "sticker-banner-message";
    message.textContent = "🎉 You received a new sticker!";

    const closeBtn = document.createElement("button");
    closeBtn.className = "sticker-banner-close";
    closeBtn.innerHTML = "×";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => {
      hideStickerBanner();
    });

    bannerContent.appendChild(message);
    bannerContent.appendChild(closeBtn);

    stickerBanner.innerHTML = "";
    stickerBanner.appendChild(bannerContent);
    stickerBanner.classList.add("show");

    // Auto-hide after 8 seconds
    setTimeout(() => {
      hideStickerBanner();
    }, 8000);
  }

  // Hide sticker banner
  function hideStickerBanner() {
    if (stickerBanner) {
      stickerBanner.classList.remove("show");
      // Clear content after animation
      setTimeout(() => {
        stickerBanner.innerHTML = "";
      }, 300);
    }
  }

  // Handle user click - create sticker record
  async function handleUserClick(recipientId, displayName, imageUrl, scary) {
    try {
      // Get current user session
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        console.error("Error getting session:", sessionError);
        alert("Error: Not logged in. Please log in again.");
        return;
      }

      const senderId = session.user.id;

      // Use provided imageUrl (from selection) or fallback to existing hardcoded image
      const finalImageUrl =
        imageUrl ||
        "https://xrvicqszlafncvfmqydp.supabase.co/storage/v1/object/public/sticker/fnaf-gif.gif";

      // Insert sticker record
      const { data, error } = await supabase
        .from("stickers")
        .insert([
          {
            sender_id: senderId,
            recipient_id: recipientId,
            image_url: finalImageUrl,
            scary: scary || false,
          },
        ])
        .select();

      if (error) {
        console.error("Error creating sticker:", error);
        alert(`Failed to send sticker to ${displayName}:\n${error.message}`);
        return false;
      }

      // Success!
      console.log("Sticker sent successfully:", data);
      alert(`✓ Sticker sent to ${displayName}!`);
      return true;
    } catch (error) {
      console.error("Error in handleUserClick:", error);
      alert(`Error sending sticker:\n${error.message}`);
      return false;
    }
  }

  // Event listeners
  loginBtn.addEventListener("click", loginWithGoogle);

  // If there's a native select for users, use its change event to set the selected recipient
  if (usersSelect) {
    usersSelect.addEventListener("change", () => {
      selectedRecipientId = usersSelect.value || null;
      selectedRecipientName = usersSelect.options[usersSelect.selectedIndex]
        ? usersSelect.options[usersSelect.selectedIndex].text
        : null;
      // clear any visual selection in custom list (if visible)
      if (usersList) usersList.querySelectorAll(".user-item").forEach((el) => el.classList.remove("selected"));
    });
  }

  // Re-enable custom dropdown trigger/list behavior (if present)
  if (usersTrigger && usersList) {
    usersTrigger.addEventListener("click", (e) => {
      e.stopPropagation();

      // Toggle visibility
      const isHidden = usersList.style.display === "none" || usersList.style.display === "";
      if (!isHidden) {
        usersList.style.display = "none";
        return;
      }

      // Show list as fixed overlay and clamp it within the viewport so it doesn't expand popup height
      usersList.style.display = "flex";
      usersList.style.position = "fixed";

      // Measure trigger and compute a top/left that keeps the list visible
      const rect = usersTrigger.getBoundingClientRect();
      const triggerLeft = Math.max(6, rect.left);
      const triggerWidth = rect.width;
      const gap = 6;
      const maxHeight = 240; // same as CSS

      // Default place below the trigger, but clamp so the list stays within the viewport
      let top = rect.bottom + gap;
      if (top + maxHeight + gap > window.innerHeight) {
        // Not enough room below; clamp top so the list fits within the viewport bottom
        top = Math.max(6, window.innerHeight - maxHeight - gap);
      }

      // Apply computed position and width
      usersList.style.left = `${triggerLeft}px`;
      usersList.style.top = `${top}px`;
      usersList.style.width = `${triggerWidth}px`;
      usersList.style.maxHeight = `${maxHeight}px`;
    });

    // Close list when clicking outside
    document.addEventListener("click", (e) => {
      if (!usersTrigger.contains(e.target) && !usersList.contains(e.target)) {
        usersList.style.display = "none";
      }
    });
  }

  // Send button: uses the selected recipient chosen from the users dropdown
  if (sendStickerBtn) {
    sendStickerBtn.addEventListener("click", async () => {
      const recipientId = selectedRecipientId;
      const displayName = selectedRecipientName || "Unknown User";

      if (!recipientId) {
        alert("Please select a user to send a sticker to.");
        return;
      }

      // If the selected sticker is scary, enforce cooldown per recipient
      if (selectedStickerScary) {
        const check = canSendScary(recipientId);
        if (!check.ok) {
          const seconds = Math.ceil(check.remainingMs / 1000);
          alert(`You can only send scary stickers to this user once every ${Math.round(SCARY_COOLDOWN_MS/1000)}s. Please wait ${seconds}s.`);
          return;
        }
      }

      // Use the selected sticker if available
      if (selectedStickerUrl) {
        const ok = await handleUserClick(recipientId, displayName, selectedStickerUrl, selectedStickerScary);
        if (ok && selectedStickerScary) {
          setLastScarySent(recipientId, Date.now());
        }
      } else {
        // No sticker selected: ask to confirm using default (default is not scary)
        const okConfirm = confirm("No sticker selected. Send default sticker instead?");
        if (okConfirm) {
          const ok = await handleUserClick(recipientId, displayName, null, false);
          if (ok && false) {
            /* no-op */
          }
        }
      }
    });
  }

  // If the custom dropdown (usersList) is present, keep it hidden by default; native <select> handles selection.

  // Check auth state when popup opens
  checkAuthState();

  // Listen for auth state changes
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) {
      showLoggedInState(session.user);
    } else if (event === "SIGNED_OUT") {
      showLoginState();
      cleanupRealtimeSubscription();
      hideStickerBanner();
    }
  });
}

const addBtn = document.getElementById("addBtn");

addBtn.addEventListener("click", () => {
  console.log("Add button clicked");

  // Send a message to the content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    console.log("Right before send message");
    chrome.tabs.sendMessage(tabs[0].id, { action: "toggleOverlay" });
  });
});



